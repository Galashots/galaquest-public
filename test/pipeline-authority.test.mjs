/**
 * AP1 / Finding 1 -- the character lane's runbook is authority, so its dangerous claims get a
 * ratchet rather than another paragraph.
 *
 * AGENTS.md: "When a rule gets broken, the fix is a test, not a stronger sentence." Both claims
 * corrected here had already been contradicted IN THE SAME FILE by a later edit, and both survived
 * anyway, because prose does not fail. This does.
 *
 * TWO CLAIMS ARE POLICED, and only two. This is not a style checker.
 *
 *   1. That matching joint names make a clip transferable between characters. They do not. Keeper v1
 *      and v2 share all 24 joint names, hierarchy AND order and are still different skeletons; Meshy
 *      clips carry a translation track per joint, so a graft re-proportions the body every frame
 *      (measured: forearms +45%/+39%, feet +51%/+50%, shoulders -48%). The rule that replaces it is
 *      "necessary but not sufficient", enforced by verify_native_clip.mjs and merge_clips.mjs.
 *
 *   2. That there is a safe default idle clip to reach for. There is not, and the specific one this
 *      file used to name -- Idle_02 -- measured as the worst standing clip we own. The lane has no
 *      default on purpose now, so re-introducing ANY named default is the regression.
 *
 * The mechanical half of claim 1 is already covered and is not duplicated here:
 * `test/native-clip-verifier.test.mjs` proves rigDifferences() rejects two bodies that share every
 * joint name. This file guards the DOCUMENT, which is the part that told an operator to try it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RUNBOOK = fileURLToPath(new URL('../docs/pipeline/characters-npcs.md', import.meta.url));
const source = readFileSync(RUNBOOK, 'utf8');
const lines = source.split(/\r?\n/);

/**
 * A line is HISTORY, not advice, when it says so. The corrections deliberately quote the sentences
 * they overturn -- that is how a reader learns the trap existed -- so a scanner that cannot tell a
 * quotation from an instruction would force the corrections to be vague.
 *
 * Deliberately narrow: only these words, and they have to be on the same line as the claim.
 */
const REFUTATION = /\b(false|removed|used to|no longer|until 2026|Do not|never|not sufficient)\b/i;

function offendingLines(pattern) {
  return lines
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => pattern.test(text) && !REFUTATION.test(text));
}

test('the runbook does not claim clips transfer between bodies by joint name', () => {
  // The shape of the original false claim: clips moving between characters on the strength of names.
  const claim = /(between any two|any two of these)|(graft\w*\s+clips?\b(?![^.]*\bnot\b))/i;
  const offenders = offendingLines(claim);
  assert.deepEqual(
    offenders.map((o) => `${o.line}: ${o.text.trim()}`),
    [],
    'docs/pipeline/characters-npcs.md is telling an operator that shared joint names make a clip '
    + 'transferable. They do not -- Keeper v1 and v2 share all 24 names, the hierarchy and the order '
    + 'and are still different skeletons. Prove rest-skeleton compatibility with '
    + 'tools/foundry/verify_native_clip.mjs before any cross-body merge.',
  );
});

test('the runbook still carries the rule that replaced it, and names the tool that enforces it', () => {
  // A ratchet that only forbids can be satisfied by deleting the section. This is the other half.
  assert.match(
    source,
    /necessary but not sufficient/i,
    'the "matching joint names are NECESSARY BUT NOT SUFFICIENT" rule has gone missing from the '
    + 'character runbook',
  );
  assert.match(
    source,
    /verify_native_clip\.mjs/,
    'the runbook must point at tools/foundry/verify_native_clip.mjs as the acceptance-time proof',
  );
  assert.match(
    source,
    /merge_clips\.mjs/,
    'the runbook must point at tools/foundry/merge_clips.mjs as the merge-time refusal',
  );
});

test('the runbook recommends no default idle clip', () => {
  // "default to <clip>" in any form. The lane has no default on purpose: the one it used to name
  // looked safe and measured worst. Naming a replacement would be the same mistake with a new noun.
  const claim = /default\s+(to|choice|is)\s+\S/i;
  const offenders = offendingLines(claim);
  assert.deepEqual(
    offenders.map((o) => `${o.line}: ${o.text.trim()}`),
    [],
    'docs/pipeline/characters-npcs.md is recommending a default clip again. It must not: Idle_02 '
    + 'was the previous default and is the worst-scoring standing clip we own. Measure the candidate '
    + 'you actually picked with tools/foundry/pose_anatomy.mjs instead.',
  );
});

test('sabotage: the scanners really do fire on the sentences that were removed', () => {
  // The control. This repo has shipped tests that passed on broken code because they restated what
  // they were policing -- so both patterns are run against the exact prose this phase deleted.
  const oldTransferClaim = 'That means `tools/foundry/merge_clips.mjs` grafts clips between any two '
    + 'of these characters by node name, and the whole lane runs end-to-end through the API.';
  const oldDefaultClaim = 'Preview the clip against the character and default to Idle_02 for anyone '
    + 'calm, clothed, or old.';

  assert.ok(
    /(between any two|any two of these)/i.test(oldTransferClaim) && !REFUTATION.test(oldTransferClaim),
    'the transfer scanner must catch the sentence AP1 removed',
  );
  assert.ok(
    /default\s+(to|choice|is)\s+\S/i.test(oldDefaultClaim) && !REFUTATION.test(oldDefaultClaim),
    'the default-clip scanner must catch the sentence AP1 removed',
  );
  // And it must NOT fire on the corrections themselves, or the file could not explain the trap.
  const correction = 'This paragraph used to say the shared names meant it grafts clips between any '
    + 'two of these characters by node name. That is false.';
  assert.ok(REFUTATION.test(correction), 'a line that refutes the claim must be readable as history');
});
