// The pure half of GP1-C5: the shape of an impact burst, and the claim that a kill is not a hit
// held longer.
//
// What is NOT tested here, and cannot be: whether the burst reads as "I GOT HIM" to a ten-year-old.
// That is accepted by opening tools/runtime-test/play-fight.mjs's captures against the baseline kept
// in .local/combat-baseline/, per this repo's standing rule for anything you have to look at.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  burstOpacity,
  burstScaleMeters,
  HIT_BURST_END_METERS,
  HIT_BURST_SECONDS,
  HIT_BURST_START_METERS,
  KILL_BURST_END_METERS,
  KILL_BURST_SECONDS,
  KILL_BURST_START_METERS,
  WOLF_DEFEAT_FLASH_SECONDS,
  WOLF_HIT_FLASH_SECONDS,
} from '../public/src/combat/feedback.js';
import { BURST_PROFILES, HIT_BURST_COLOR, KILL_BURST_COLOR } from '../public/src/render/impactBurst.js';
import { WOLF_SPARK_COLOR } from '../public/src/enemies/wolf.js';

test('a burst starts at its start size and ends at its end size', () => {
  assert.equal(burstScaleMeters(0, 1, 0.5, 4), 0.5);
  assert.equal(burstScaleMeters(1, 1, 0.5, 4), 4);
});

test('a burst clamps instead of running away past its own duration', () => {
  // A frame-rate hiccup can tick a burst well past its end before the caller retires it. The ring
  // must stop at its final size, not keep growing to the size of the village.
  assert.equal(burstScaleMeters(9, 1, 0.5, 4), 4);
});

test('a burst grows monotonically', () => {
  let previous = -Infinity;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const size = burstScaleMeters(t, 1, 0.5, 4);
    assert.ok(size >= previous, `shrank at t=${t.toFixed(2)}: ${size} < ${previous}`);
    previous = size;
  }
});

// The whole reason it is ease-out and not linear: it has to look like something that BURST.
test('most of a burst happens immediately -- over half the growth in the first third', () => {
  const third = burstScaleMeters(1 / 3, 1, 0, 1);
  assert.ok(third > 0.5, `only ${(third * 100).toFixed(1)}% of the way out at one third of the way through`);
});

test('a burst is full brightness at impact and gone at the end', () => {
  assert.equal(burstOpacity(0, 1), 1);
  assert.equal(burstOpacity(1, 1), 0);
  assert.equal(burstOpacity(2, 1), 0);
});

// Quadratic, not linear: a linear fade spends its middle at half brightness, which on an additive
// sprite is a smear sitting over the wolf rather than a flash leaving it.
test('a burst holds bright early and leaves fast, unlike a linear fade', () => {
  assert.ok(burstOpacity(0.25, 1) > 0.5, 'should still be over half bright a quarter of the way in');
  assert.ok(burstOpacity(0.75, 1) < 0.1, 'should be nearly gone three quarters of the way in');
});

test('a burst answers safely for input nobody should be passing', () => {
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(burstOpacity(bad, 1), 0, `opacity for elapsed=${bad}`);
  }
  assert.equal(burstOpacity(0.5, 0), 0, 'a zero-length burst is not visible');
  assert.equal(burstScaleMeters(0.5, 0, 2, 9), 2, 'a zero-length burst stays at its start size');
});

// ── the regression this whole phase exists for ───────────────────────────────────────────────────
//
// WOLF_DEFEAT_FLASH_SECONDS shipped with a comment claiming that being longer than the hit flash was
// enough to stop a kill reading as another hit. It was not: both flashes tinted the same materials
// the same white, so on any single frame -- which is all a child gets -- they were the same picture.
// These are the checks that would have caught that, and that stop it coming back.

test('a kill is not a hit held longer: the two bursts differ in SIZE, not just duration', () => {
  assert.ok(KILL_BURST_END_METERS > HIT_BURST_END_METERS * 2,
    `kill ends at ${KILL_BURST_END_METERS}m, hit at ${HIT_BURST_END_METERS}m -- not distinguishable at a glance`);
  assert.ok(KILL_BURST_SECONDS > HIT_BURST_SECONDS);
  assert.ok(KILL_BURST_START_METERS > 0 && HIT_BURST_START_METERS > 0);
});

test('a kill is not a hit held longer: the two bursts are different COLOURS', () => {
  assert.notEqual(KILL_BURST_COLOR, HIT_BURST_COLOR);
});

test('the kill burst IS the wolf\'s stolen light, so retuning the spark cannot leave them disagreeing', () => {
  assert.equal(KILL_BURST_COLOR, WOLF_SPARK_COLOR);
});

test('the outgoing hit colour is warm, not the red the screen uses when the player is hurt', () => {
  // #hero-hurt-flash is rgb(200 20 20) -- red-dominant with little green or blue. An outgoing hit
  // must not be, or the two events teach a child the same colour. Checked as a property of the
  // channels rather than against a second hardcoded hex, so retuning the gold cannot silently pass.
  const red = (HIT_BURST_COLOR >> 16) & 0xff;
  const green = (HIT_BURST_COLOR >> 8) & 0xff;
  const blue = HIT_BURST_COLOR & 0xff;
  assert.ok(green > 200 && blue > 150, `hit colour #${HIT_BURST_COLOR.toString(16)} is not warm-bright`);
  assert.ok(red - blue < 120, `hit colour #${HIT_BURST_COLOR.toString(16)} reads as red`);
});

test('sabotage: the hit and kill burst constants are not accidentally the same object', () => {
  // Guards the copy-paste failure mode that produced the original defect -- a second profile that
  // was really the first one under a new name.
  assert.notDeepEqual(
    [HIT_BURST_SECONDS, HIT_BURST_START_METERS, HIT_BURST_END_METERS],
    [KILL_BURST_SECONDS, KILL_BURST_START_METERS, KILL_BURST_END_METERS],
  );
  assert.notEqual(WOLF_HIT_FLASH_SECONDS, WOLF_DEFEAT_FLASH_SECONDS);
});

test('a kill is not a hit held longer: the two bursts are different SHAPES', () => {
  // The last and least reversible of the three differences. Colour can be argued about and size can
  // be tuned, but a hollow travelling edge and a soft bloom are not the same picture at any size --
  // which is what makes "was that a hit or did I kill it" answerable from one glanced frame.
  assert.notEqual(BURST_PROFILES.hit.profile, BURST_PROFILES.kill.profile);
  assert.equal(BURST_PROFILES.hit.profile, 'shock');
  assert.equal(BURST_PROFILES.kill.profile, 'lamp');
});
