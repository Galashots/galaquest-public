import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createEncounterFeedback,
  ENCOUNTER_EVENT_TYPES,
  flashIntensity,
  heartsForHp,
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

// index.html hardcodes three <span class="heart"> elements rather than generating them, because
// HERO_MAX_HP has been 3 since the combat slice landed -- see the comment beside them. This is the
// test that makes that coupling safe instead of merely commented.
test('index.html draws exactly HERO_MAX_HP hearts', () => {
  const source = readFileSync(resolve(repoRoot, 'public/index.html'), 'utf8');
  const hearts = source.match(/class="heart"/g) ?? [];
  assert.equal(hearts.length, HERO_MAX_HP, 'the markup must be updated by hand if HERO_MAX_HP changes');
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

test('heartsForHp fills from the left and leaves the rest empty', () => {
  assert.deepEqual(heartsForHp(3, 3), [true, true, true]);
  assert.deepEqual(heartsForHp(2, 3), [true, true, false]);
  assert.deepEqual(heartsForHp(1, 3), [true, false, false]);
  assert.deepEqual(heartsForHp(0, 3), [false, false, false]);
});

test('heartsForHp clamps instead of drawing a negative or a fourth heart', () => {
  assert.deepEqual(heartsForHp(-1, 3), [false, false, false], 'a mid-frame negative hp is not a crash');
  assert.deepEqual(heartsForHp(5, 3), [true, true, true], 'healing past max does not draw a fourth heart');
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
