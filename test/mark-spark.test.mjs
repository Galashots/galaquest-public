// The Lantern Mark's flight curve. Pure -- the sprite pool that follows it needs three.js and is
// judged in captures; the shape of the arc is arithmetic and belongs here.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPARK_END_SIZE_METERS,
  SPARK_FLIGHT_SECONDS,
  SPARK_HOP_METERS,
  SPARK_START_SIZE_METERS,
  sparkFlight,
} from '../public/src/rewards/markSpark.js';

test('a spark starts at the wolf and finishes at the hero, exactly', () => {
  assert.equal(sparkFlight(0).travel01, 0);
  assert.equal(sparkFlight(SPARK_FLIGHT_SECONDS).travel01, 1);
  assert.equal(sparkFlight(0).done, false);
  assert.equal(sparkFlight(SPARK_FLIGHT_SECONDS).done, true);
});

test('the arc lands ON the target rather than hovering above it', () => {
  // The hop has to be zero at BOTH ends or the spark finishes a metre over the hero's head.
  assert.ok(Math.abs(sparkFlight(0).hopMeters) < 1e-9);
  assert.ok(Math.abs(sparkFlight(SPARK_FLIGHT_SECONDS).hopMeters) < 1e-9);
  // ...and it really does loft in between, or it is a bullet and not a gift.
  const mid = sparkFlight(SPARK_FLIGHT_SECONDS / 2).hopMeters;
  assert.ok(Math.abs(mid - SPARK_HOP_METERS) < 1e-9, `mid-flight hop was ${mid}`);
});

test('travel never goes backwards, and never overshoots', () => {
  let previous = -1;
  for (let t = 0; t <= SPARK_FLIGHT_SECONDS + 0.2; t += SPARK_FLIGHT_SECONDS / 40) {
    const beat = sparkFlight(t);
    assert.ok(beat.travel01 >= previous - 1e-12, `travel went backwards at ${t}`);
    assert.ok(beat.travel01 <= 1 + 1e-12, `travel overshot at ${t}`);
    previous = beat.travel01;
  }
});

test('it brightens, holds, and fades out -- never negative, never over full', () => {
  assert.ok(sparkFlight(0).strength01 <= 0.01, 'it must not pop on at full brightness');
  assert.ok(sparkFlight(SPARK_FLIGHT_SECONDS * 0.4).strength01 > 0.99, 'it should be full mid-flight');
  assert.ok(sparkFlight(SPARK_FLIGHT_SECONDS * 0.99).strength01 < 0.1, 'it should be nearly gone on arrival');
  for (let t = -0.5; t <= SPARK_FLIGHT_SECONDS + 0.5; t += 0.05) {
    const s = sparkFlight(t).strength01;
    assert.ok(s >= 0 && s <= 1, `strength ${s} out of range at ${t}`);
  }
});

test('it shrinks as it arrives, so it reads as absorbed and not as passing through', () => {
  assert.ok(Math.abs(sparkFlight(0).sizeMeters - SPARK_START_SIZE_METERS) < 1e-9);
  assert.ok(Math.abs(sparkFlight(SPARK_FLIGHT_SECONDS).sizeMeters - SPARK_END_SIZE_METERS) < 1e-9);
  assert.ok(SPARK_END_SIZE_METERS < SPARK_START_SIZE_METERS);
});

test('a negative or absurd elapsed time is clamped rather than producing a stray sprite', () => {
  const before = sparkFlight(-2);
  assert.equal(before.travel01, 0);
  assert.equal(before.strength01, 0);
  const after = sparkFlight(1000);
  assert.equal(after.travel01, 1);
  assert.equal(after.done, true);
});

test('a zero-length flight resolves instead of dividing by zero', () => {
  const beat = sparkFlight(0, 0);
  assert.equal(beat.travel01, 1);
  assert.equal(beat.done, true);
  assert.ok(Number.isFinite(beat.hopMeters));
});
