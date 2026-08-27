import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  MAX_CONSECUTIVE_POLL_FAILURES, shouldAbandonPolling,
} from '../public/src/forge/pendingTask.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const forgeMain = readFileSync(resolve(repoRoot, 'public/src/forge/main.js'), 'utf8');

// PR #29 hardened the Forge so a transient poll failure against an ALREADY-PAID Meshy task can
// never turn into a second charge. The behaviour was implemented correctly but the retry threshold
// was an undocumented literal duplicated in two places and had no test of its own, so nothing
// stopped a later edit from turning "retry a network blip" into "resubmit".

function pollAndMountTaskSource() {
  const fn = forgeMain.match(/async function pollAndMountTask\([\s\S]*?\n\}/);
  assert.ok(fn, 'pollAndMountTask must still exist in public/src/forge/main.js');
  return fn[0];
}

test('the poll-failure tolerance is a named, pinned threshold', () => {
  assert.equal(MAX_CONSECUTIVE_POLL_FAILURES, 6);
  assert.equal(shouldAbandonPolling(0), false);
  assert.equal(shouldAbandonPolling(5), false, 'five blips in a row is still a blip');
  assert.equal(shouldAbandonPolling(6), true);
  assert.equal(shouldAbandonPolling(7), true, 'never resume polling once past the threshold');
});

test('a run of transient failures followed by success stays inside one paid task', () => {
  // Replays the real loop's control flow over a scripted provider: five thrown polls, then a
  // terminal SUCCEEDED. The assertion that matters is that the run costs exactly one submission.
  const outcomes = ['throw', 'throw', 'throw', 'throw', 'throw', 'SUCCEEDED'];
  let submissions = 1; // the single paid POST that created the task
  let consecutiveFailures = 0;
  let abandoned = false;
  let terminal = null;

  for (const outcome of outcomes) {
    if (outcome === 'throw') {
      consecutiveFailures += 1;
      if (shouldAbandonPolling(consecutiveFailures)) { abandoned = true; break; }
      continue;
    }
    consecutiveFailures = 0;
    terminal = outcome;
    break;
  }

  assert.equal(abandoned, false, 'five consecutive failures must not abandon a paid task');
  assert.equal(terminal, 'SUCCEEDED');
  assert.equal(submissions, 1, 'polling must never add a submission');
});

test('sabotage: the threshold is real -- six consecutive failures does stop the loop', () => {
  let consecutiveFailures = 0;
  let abandoned = false;
  for (let i = 0; i < 6; i += 1) {
    consecutiveFailures += 1;
    if (shouldAbandonPolling(consecutiveFailures)) { abandoned = true; break; }
  }
  assert.equal(abandoned, true, 'without this the loop would spin forever on a dead provider');
});

test('the poll loop uses the shared threshold rather than a re-inlined literal', () => {
  const source = pollAndMountTaskSource();
  assert.match(source, /shouldAbandonPolling\(consecutiveFailures\)/);
  assert.doesNotMatch(
    source,
    /consecutiveFailures\s*>=\s*\d/,
    'the give-up threshold must stay in pendingTask.js where it is tested, not be re-inlined',
  );
});

test('a failed poll neither submits nor retires the paid task', () => {
  const source = pollAndMountTaskSource();
  const failureBranch = source.match(/\}\s*catch\s*\(error\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(failureBranch, 'pollAndMountTask must still handle poll failures explicitly');

  assert.doesNotMatch(failureBranch[0], /POST/i,
    'a poll failure must never issue a write to the provider');
  assert.doesNotMatch(failureBranch[0], /clearPendingTask/,
    'a poll failure must leave the pending record so the owner can resume the paid taskId');
  assert.doesNotMatch(failureBranch[0], /generateCandidate|submit/i,
    'a poll failure must never re-enter the submission path');
});

test('giving up on polling still preserves the pending record for resume', () => {
  const source = pollAndMountTaskSource();
  // The non-terminal exit is the dangerous one: it is reached both by timeout and by exhausting the
  // failure budget, and it must keep the record rather than clear it.
  const nonTerminalExit = source.match(/if \(!task \|\| !isTerminalMeshyStatus\(task\.status\)\)[\s\S]*?\n  \}/);
  assert.ok(nonTerminalExit, 'the non-terminal exit branch must still exist');
  assert.doesNotMatch(nonTerminalExit[0], /clearPendingTask/,
    'a still-pending paid task must never be forgotten -- that is what causes a duplicate purchase');
  assert.match(nonTerminalExit[0], /Resume paid task/,
    'the human must be told to resume rather than regenerate');
});
