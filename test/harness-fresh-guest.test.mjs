// test/harness-fresh-guest.test.mjs
//
// docs/MISTAKES.md GQ-008 -- "a harness that navigates to the game must start from a known guest".
//
// The automation Chrome on 9224 uses a PERSISTENT profile (README's launch command), so localStorage
// survives between harness runs. `gq-guest-id` lives there. A harness that navigates without wiping
// it inherits whatever identity the previous run left behind -- and if that harness then kills a
// wolf, it awards a REAL Lantern Mark against someone else's guest.
//
// Twice measured, which is why this test exists rather than another sentence in a comment:
//   1. Phase Y (2026-08-14) found play-fight.mjs landing three rows on drive-relight's RESERVED
//      fixture identity `relight-probe-guest-0001`. Phase Z1's R1-A fixed play-fight.
//   2. Phase R3a (2026-08-15) found drive-two-clients.mjs doing the same thing and still unfixed --
//      mark:relight-probe-guest-0001:3/4/5/6 in the store, in PAIRS 87-220ms apart, because it runs
//      TWO tabs and both inherited the same stale id. drive-relight then failed its own "exactly 3
//      marks" assertion at marks 5, for a reason with nothing to do with relighting.
//
// Phase H1 made it reproducible rather than occasional: every harness now takes a server from one
// shared port pool, so they all share ONE origin and therefore one localStorage. The isolation that
// used to come by accident from sitting on different ports is now something each harness must do.
//
// THE RULE IS DELIBERATELY BROAD -- every harness that navigates, not only the ones that can award a
// mark. "Can this one award a mark?" is a judgement that goes stale the moment somebody adds an
// attack tap, and the detection is fragile in exactly the way that bit this phase: a first attempt at
// this scan looked for `attackX` and reported drive-two-clients as combat-free, because that file
// spells it `ATTACK_X`. A rule that needs a correct judgement about each file is not a ratchet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const harnessDir = join(repoRoot, 'tools', 'runtime-test');

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const files = readdirSync(harnessDir).filter((name) => name.endsWith('.mjs'));

test('every runtime-test harness that navigates to the game clears storage first (GQ-008)', () => {
  assert.ok(files.length >= 10,
    `only ${files.length} harnesses found -- the scan is broken, not the directory empty`);

  const violations = [];
  let navigating = 0;
  for (const name of files) {
    const source = stripComments(readFileSync(join(harnessDir, name), 'utf8'));
    // A harness is in scope if it drives a page to the game at all.
    if (!/Page\.navigate/.test(source)) continue;
    navigating += 1;
    if (!/Storage\.clearDataForOrigin/.test(source)) violations.push(name);
  }

  assert.ok(navigating >= 10,
    `only ${navigating} harnesses navigate -- expected essentially all of them; scan likely broken`);
  assert.deepEqual(violations, [],
    'these harnesses navigate to the game without clearing localStorage first, so they inherit '
    + 'whatever gq-guest-id the persistent automation profile is holding (docs/MISTAKES.md GQ-008). '
    + 'Add `await page.send(\'Storage.clearDataForOrigin\', { origin: ORIGIN_UNDER_TEST, '
    + 'storageTypes: \'local_storage\' })` before the first Page.navigate:\n  '
    + violations.join('\n  '));
});

test('the clear happens BEFORE the first navigation, not after it (GQ-008)', () => {
  // Order is the whole point: clearing after the page has already booted means the guest was already
  // minted and, if the run kills anything, already credited.
  const violations = [];
  for (const name of files) {
    const source = stripComments(readFileSync(join(harnessDir, name), 'utf8'));
    const firstNavigate = source.indexOf('Page.navigate');
    const firstClear = source.indexOf('Storage.clearDataForOrigin');
    if (firstNavigate === -1 || firstClear === -1) continue;
    if (firstClear > firstNavigate) violations.push(name);
  }
  assert.deepEqual(violations, [],
    'these harnesses clear localStorage only AFTER their first Page.navigate, by which point the '
    + 'guest has already been minted:\n  ' + violations.join('\n  '));
});

test('sabotage: the scan really does catch a harness with no clear', () => {
  // The control. A guard that cannot fail is not a guard -- this repo has shipped three tests that
  // passed on broken code because they restated what they were policing.
  const withClear = "await page.send('Page.navigate', {url}); await page.send('Storage.clearDataForOrigin', {});";
  const withoutClear = "await page.send('Page.navigate', { url: URL_UNDER_TEST });";
  assert.ok(/Page\.navigate/.test(withoutClear) && !/Storage\.clearDataForOrigin/.test(withoutClear),
    'the in-scope + missing-clear detection must fire on a navigating harness with no clear');
  // And the ordering check must fire on a clear that comes too late.
  assert.ok(withClear.indexOf('Storage.clearDataForOrigin') > withClear.indexOf('Page.navigate'),
    'the ordering detection must fire when the clear follows the first navigation');
});
