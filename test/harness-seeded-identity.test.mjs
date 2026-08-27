// A harness that seeds a durable identity must pin it from a device that has no profiles yet.
//
// This is the second time the family profile gate silently orphaned a seeded guest, and the two
// failures looked nothing alike, which is the reason this guard exists rather than a third comment.
//
// The mechanism is one sentence: BOOTING THE APP MINTS A PROFILE. `progression/profiles.js` folds a
// legacy `gq-guest-id` into a profile whose id IS that guest string -- but only while the device
// holds none yet, because `migrateLegacyGuest()` returns null the moment one exists. So a guest id
// written into localStorage AFTER the app has already booted once is not an identity at all. It is
// a dead string sitting beside a profile the boot minted, and every seeded reward row stays on the
// server under a name nothing on the device points at.
//
// What makes it worth a mechanical guard is how it surfaces. Nothing reports a missing identity.
// drive-ranger reported an empty speech bubble and a ranger who would not talk; fit-lantern reported
// `lantern mesh never appeared under its anchor -- is this profile unlocked and the GLB shipped?`,
// which sent me looking at the asset pipeline. Both were the same defect wearing the costume of
// whatever the seeded state happened to unlock. A failure that names the wrong subsystem costs more
// than one that names nothing.
//
// The rule: between the last navigation that BOOTS THE GAME and the write of a guest id, there must
// be a `Storage.clearDataForOrigin`. Clearing puts the device back to "no profiles", which is the
// only state the migration is defined for. The `favicon.ico` hop every harness uses is deliberately
// NOT a boot -- it exists precisely to get a same-origin document that can hold localStorage without
// starting the app, and that is why it does not count against this rule.
//
// LIMIT, stated rather than left to be discovered: this reads source order, not control flow. A pin
// inside a helper called twice, or reached by a branch, is beyond what a lexical scan can model.
// It catches the shape that has actually gone wrong twice, and it cannot catch every shape that
// could. A guard that overstates its reach is the failure mode this repo's ledger calls GQ-015.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const HARNESS_DIR = join(import.meta.dirname, '..', 'tools', 'runtime-test');

/** Scan code only. This file's own header quotes the forbidden shapes, and so do the repaired
 *  harnesses' explanations of why they were wrong -- the same reason test/harness-game-url.test.mjs
 *  strips comments before matching. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Sources rather than literals, so every use below builds a FRESH regex. A /g regex carries
// `lastIndex` between calls, and reusing one across files makes `.test()` skip roughly every other
// one -- which showed up here as the coverage guard claiming drive-ranger no longer pins anything.
const NAVIGATE_SRC = String.raw`Page\.navigate'\s*,\s*\{\s*url:\s*(\x60[^\x60]*\x60|[^,}\n]+)`;
const CLEAR_SRC = String.raw`Storage\.clearDataForOrigin`;
// Deliberately loose about HOW the key is spelled at the call. Harnesses write it as a bare
// literal, and drive-ranger writes it as `${JSON.stringify(GUEST_ID_STORAGE_KEY)}` because GQ-007
// says import the key rather than retype it -- an alternation over the spellings I happened to
// have seen missed exactly the file that followed the rule best. Over-matching is the safe
// direction here: the cost is checking a harness that did not need it.
const PIN_SRC = String.raw`localStorage\.setItem\([\s\S]{0,60}?(?:gq-guest-id|GUEST_ID_STORAGE_KEY)`;

/** The url expression has to be captured WHOLE, and that is the reason for the alternation above.
 *  A template literal contains `${...}`, so a lazy scan up to the first `}` stops inside it and
 *  hands back "`${origin" -- which does not contain the word favicon, so the deliberate same-origin
 *  hop gets classified as a boot and every correctly-written harness in the tree fails. */
const globally = (source) => new RegExp(source, 'g');

/** A navigation that starts the game, as opposed to the deliberate same-origin hop that does not.
 *  Classified by the url EXPRESSION rather than by the resolved address, because the harness sources
 *  are what this test can see. */
function bootsTheGame(urlExpression) {
  return !/favicon|about:blank/.test(urlExpression);
}

/** Every event this rule cares about, in the order the file writes them. */
function timeline(code) {
  const events = [];
  for (const m of code.matchAll(globally(NAVIGATE_SRC))) {
    if (bootsTheGame(m[1])) events.push({ at: m.index, kind: 'boot', detail: m[1].trim() });
  }
  for (const m of code.matchAll(globally(CLEAR_SRC))) events.push({ at: m.index, kind: 'clear' });
  for (const m of code.matchAll(globally(PIN_SRC))) events.push({ at: m.index, kind: 'pin' });
  return events.sort((a, b) => a.at - b.at);
}

/** The offending pins in one harness: a guest id written while a boot stands between it and the
 *  most recent clear. */
function unclearedPins(code) {
  const offenders = [];
  let bootSinceClear = null;
  for (const event of timeline(code)) {
    if (event.kind === 'clear') bootSinceClear = null;
    else if (event.kind === 'boot') bootSinceClear = event.detail;
    else if (event.kind === 'pin' && bootSinceClear) offenders.push(bootSinceClear);
  }
  return offenders;
}

const harnesses = readdirSync(HARNESS_DIR).filter((file) => file.endsWith('.mjs'));

test('a seeded guest id is always pinned onto a device with no profiles', () => {
  const offenders = [];
  for (const file of harnesses) {
    for (const boot of unclearedPins(stripComments(readFileSync(join(HARNESS_DIR, file), 'utf8')))) {
      offenders.push(`${file}: pins a guest id after navigating to ${boot} with no clear between`);
    }
  }
  assert.deepEqual(offenders, [],
    `these harnesses seed an identity the app will ignore, and will fail as if the CONTENT were missing:\n  ${offenders.join('\n  ')}`);
});

test('the scan actually finds the harnesses that pin an identity', () => {
  // The guard on the guard. If the pin pattern stops matching -- a harness renames the key, or the
  // call shape changes -- the rule above goes quietly green over zero files while reading as
  // coverage. Named harnesses rather than a count, so deleting one is a deliberate edit here.
  const pinning = harnesses.filter((file) => new RegExp(PIN_SRC).test(stripComments(readFileSync(join(HARNESS_DIR, file), 'utf8'))));
  for (const expected of ['fit-lantern.mjs', 'drive-ranger.mjs', 'drive-relight.mjs', 'drive-hero-screen.mjs']) {
    assert.ok(pinning.includes(expected), `${expected} pins a guest id and the scan no longer sees it`);
  }
});

test('the favicon hop is not a boot, and a real navigation is', () => {
  // The distinction the whole rule rests on. If `favicon.ico` were classified as a boot, every
  // correctly-written harness in the tree would fail; if a real navigation were not, nothing would.
  assert.equal(bootsTheGame('`${origin}/favicon.ico`'), false);
  assert.equal(bootsTheGame("'about:blank'"), false);
  assert.equal(bootsTheGame('URL_UNDER_TEST'), true);
  assert.equal(bootsTheGame('gameUrlFor(origin)'), true);
});

test('the rule goes red on the shape that actually shipped', () => {
  // fit-lantern's exact defect, reduced. It cleared, booted, and only then pinned -- so the pin
  // landed beside a profile the boot had already minted.
  const shipped = `
    await page.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage' });
    await page.send('Page.navigate', { url: URL_UNDER_TEST });
    await page.eval("localStorage.setItem('gq-guest-id', GUEST)");
    await page.send('Page.navigate', { url: URL_UNDER_TEST });
  `;
  assert.deepEqual(unclearedPins(shipped), ['URL_UNDER_TEST']);

  const repaired = `
    await page.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage' });
    await page.send('Page.navigate', { url: URL_UNDER_TEST });
    await page.send('Page.navigate', { url: \`\${ORIGIN}/favicon.ico\` });
    await page.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage' });
    await page.eval("localStorage.setItem('gq-guest-id', GUEST)");
    await page.send('Page.navigate', { url: URL_UNDER_TEST });
  `;
  assert.deepEqual(unclearedPins(repaired), []);
});
