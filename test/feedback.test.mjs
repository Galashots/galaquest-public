import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createEncounterFeedback,
  ENCOUNTER_EVENT_TYPES,
  flashIntensity,
  healthReadout,
  REDUCED_MOTION_FLASH_SECONDS,
  WOLF_DEFEAT_FLASH_SECONDS,
  WOLF_HIT_FLASH_SECONDS,
} from '../public/src/combat/feedback.js';
import { HERO_MAX_HP } from '../public/src/combat/encounter.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The guarantee this file exists for: a new event type in encounter.js cannot go unhandled the way
// hero-hurt did before feedback.js existed. Reads encounter.js's own source rather than trusting a
// hand-maintained duplicate list, so the two are checked against each other instead of by eye.
test('ENCOUNTER_EVENT_TYPES matches every event type encounter.js actually raises', () => {
  const source = readFileSync(resolve(repoRoot, 'public/src/combat/encounter.js'), 'utf8');
  const raised = new Set([...source.matchAll(/type:\s*'([\w-]+)'/g)].map((match) => match[1]));

  assert.ok(raised.size > 0, 'the regex matched nothing -- it has drifted from encounter.js\'s style');
  assert.deepEqual(
    [...raised].sort(),
    [...ENCOUNTER_EVENT_TYPES].sort(),
    'a new event type in encounter.js has no feedback entry, or a stale entry no longer fires',
  );
});

// THE PIP ROW IS GONE, AND THIS IS THE TEST THAT KEEPS IT GONE.
//
// index.html used to hardcode one <span class="heart"> per pip, and the test here pinned the count
// to HERO_MAX_HP_CEILING so the markup and the ceiling could not drift apart. P2 makes every Hero
// level grant max HP (docs/product/PROGRESSION_CONTRACT_V0.md supersedes the four-heart ceiling), so
// there is no ceiling left to pin and a fixed row of icons cannot draw a body that grows.
//
// The test changes job rather than being deleted, exactly the way test/shared-constants.test.mjs
// once did: it now proves the markup carries the SCALABLE readout -- one bar, one current, one max
// -- and that no pip row has come back. A reintroduced `class="heart"` row would be a HUD that can
// only tell the truth for the first thirty hit points a child ever has.
test('index.html draws a scalable health readout, not a fixed row of pips', () => {
  // Comments stripped first, and not as a convenience: the markup's own comment explains what the
  // pip row WAS, quoting the element it used to draw, and a scan that counts a quoted example finds
  // a defect in the explanation of why the defect is gone.
  const source = readFileSync(resolve(repoRoot, 'public/index.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');

  assert.equal((source.match(/class="heart"/g) ?? []).length, 0,
    'the fixed heart-pip row is superseded by per-level max HP -- it must not come back');
  assert.equal((source.match(/class="health-fill"/g) ?? []).length, 1,
    'exactly one bar fill, which main.js sizes from healthReadout');
  assert.equal((source.match(/id="health-current"/g) ?? []).length, 1, 'one current-HP readout');
  assert.equal((source.match(/id="health-max"/g) ?? []).length, 1, 'one max-HP readout');
  // The numerals are the channel that survives reduced motion and colour-blindness alike, so they
  // have to be real text nodes main.js can write into rather than a CSS-only or title-attribute
  // treatment. Asserted as "the ids exist in the markup" above; asserted here as "nothing else is
  // pretending to be them".
  assert.ok(/aria-label="Hero health"/.test(source), 'the readout keeps its accessible name');
});

// The scale itself, pinned where a reader of the HUD test will see it: a body is no longer a small
// countable integer, which is the entire reason the row above stopped being pips.
test('a Level-1 body is large enough that a bar is the honest readout', () => {
  assert.ok(HERO_MAX_HP >= 10,
    `HERO_MAX_HP is ${HERO_MAX_HP}; below about ten, countable icons would be the better readout `
    + 'and combat/feedback.js\'s reference research would have to be revisited rather than ignored');
});

test('createEncounterFeedback refuses to build with a missing handler', () => {
  const incomplete = Object.fromEntries(ENCOUNTER_EVENT_TYPES.slice(1).map((type) => [type, () => {}]));
  assert.throws(
    () => createEncounterFeedback(incomplete),
    /swing/,
    'the error must name the missing type, not just fail generically',
  );
});

test('createEncounterFeedback accepts a complete handler table and dispatches by type', () => {
  const seen = [];
  const callbacks = Object.fromEntries(
    ENCOUNTER_EVENT_TYPES.map((type) => [type, (event) => seen.push(event)]),
  );
  const onEncounterEvent = createEncounterFeedback(callbacks);

  for (const type of ENCOUNTER_EVENT_TYPES) onEncounterEvent({ type, remaining: 2 });

  assert.deepEqual(seen.map((event) => event.type), [...ENCOUNTER_EVENT_TYPES]);
});

test('an event type outside the known set is logged rather than crashing the frame loop', () => {
  const onEncounterEvent = createEncounterFeedback(
    Object.fromEntries(ENCOUNTER_EVENT_TYPES.map((type) => [type, () => {}])),
  );
  assert.doesNotThrow(() => onEncounterEvent({ type: 'not-a-real-event' }));
});

test('healthReadout reports the current, the max, and the fraction between them', () => {
  assert.deepEqual(healthReadout(30, 30), { current: 30, max: 30, fraction: 1 });
  assert.deepEqual(healthReadout(15, 30), { current: 15, max: 30, fraction: 0.5 });
  assert.deepEqual(healthReadout(0, 30), { current: 0, max: 30, fraction: 0 });
});

// The clamping is the load-bearing half: main.js calls this from a frame loop, where hp arrives
// mid-reconciliation and is briefly whatever the last snapshot and the local prediction disagree
// about. None of those may become a bar wider than its track or a number a child reads as "-3".
test('healthReadout clamps rather than overflowing the bar or printing a negative', () => {
  assert.deepEqual(healthReadout(-4, 30), { current: 0, max: 30, fraction: 0 },
    'a mid-frame negative hp is not a crash and not a backwards bar');
  assert.deepEqual(healthReadout(44, 30), { current: 30, max: 30, fraction: 1 },
    'healing past max does not draw past the end of the track');
  assert.equal(healthReadout(12.4, 30).current, 12, 'a fractional hp is rounded, not printed');
});

// A body that has grown is the whole point of the change: the same hp against a bigger max has to
// read as a SHORTER bar, because that is what levelling actually did to the child's safety margin.
test('healthReadout scales with the body rather than assuming a fixed maximum', () => {
  assert.deepEqual(healthReadout(30, 35), { current: 30, max: 35, fraction: 30 / 35 });
  assert.deepEqual(healthReadout(125, 125), { current: 125, max: 125, fraction: 1 },
    'a Level-20 body is a legal readout, not an overflow');
});

test('healthReadout survives a caller that has no body yet', () => {
  assert.deepEqual(healthReadout(undefined, undefined), { current: 0, max: 1, fraction: 0 },
    'no state yet must not divide by zero');
  assert.equal(healthReadout(5, 0).max, 1, 'there is no legal body of size zero');
});

test('flashIntensity is full strength at the instant of impact', () => {
  assert.equal(flashIntensity(0, 0.2), 1);
});

test('flashIntensity fades linearly to zero and stays there', () => {
  assert.ok(Math.abs(flashIntensity(0.1, 0.2) - 0.5) < 1e-9, 'halfway through, half strength');
  assert.equal(flashIntensity(0.2, 0.2), 0, 'exactly at the duration, spent');
  assert.equal(flashIntensity(0.5, 0.2), 0, 'well past the duration, still spent');
});

// The same no-op-outside-its-domain shape swingPose() uses for a progress value outside 0..1.
test('flashIntensity is a no-op outside its domain rather than an extrapolation', () => {
  assert.equal(flashIntensity(-0.1, 0.2), 0, 'before impact cannot happen, but must not go negative');
  assert.equal(flashIntensity(0.1, 0), 0, 'a zero-length flash is off, not a division by zero');
  assert.equal(flashIntensity(0.1, -1), 0, 'a negative duration is nonsense, not a sign flip');
  assert.equal(flashIntensity(Number.NaN, 0.2), 0);
});

test('the defeat flash outlasts the hit flash, so the finishing blow reads as distinct', () => {
  assert.ok(
    WOLF_DEFEAT_FLASH_SECONDS > WOLF_HIT_FLASH_SECONDS,
    'wolf-defeated must not look like just another wolf-hit',
  );
});

test('the reduced-motion flash changes the state without animating it', () => {
  assert.ok(REDUCED_MOTION_FLASH_SECONDS > 0, 'reduced motion changes state, it does not remove it');
  assert.ok(REDUCED_MOTION_FLASH_SECONDS < WOLF_HIT_FLASH_SECONDS, 'and it reads as near-instant');
});
