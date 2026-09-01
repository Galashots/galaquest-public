// The pure half of the dotted glowing ground trail: where the dots sit, how bright each one is, and
// the shimmer/bob that makes it read as alive rather than as a static decal. What is NOT tested here,
// and cannot be: whether it actually reads as a path at dusk lighting on a real device -- that is a
// running-game/visual question, the same split every other render/ presenter in this repo draws.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GUIDE_DOT_SPACING_METERS,
  GUIDE_HIDE_RADIUS_METERS,
  GUIDE_MAX_DOTS,
  GUIDE_START_OFFSET_METERS,
  guideDotBob,
  guideDotOpacity,
  guideDotPlacements,
  guideDotPulse,
} from '../public/src/render/guidePath.js';
import { GUIDE_NEAR_METERS } from '../public/src/render/guideArrow.js';

const straight = (targetX) => guideDotPlacements({ heroX: 0, heroZ: 0, targetX, targetZ: 0 });

test('shares its arrival radius with the arrow rather than retyping the number', () => {
  assert.equal(GUIDE_HIDE_RADIUS_METERS, GUIDE_NEAR_METERS);
});

test('no trail at all once the child has basically arrived', () => {
  assert.deepEqual(straight(GUIDE_HIDE_RADIUS_METERS), []);
  assert.deepEqual(straight(0.4), []);
});

test('a trail appears just past the arrival radius', () => {
  const dots = straight(GUIDE_HIDE_RADIUS_METERS + 0.5);
  assert.ok(dots.length >= 1);
});

test('a nonsense position produces no dots rather than NaN coordinates', () => {
  for (const bad of [Number.NaN, undefined, Infinity]) {
    assert.deepEqual(guideDotPlacements({ heroX: 0, heroZ: 0, targetX: bad, targetZ: 0 }), []);
  }
});

test('dots start away from the hero, not on top of them', () => {
  const [first] = straight(20);
  assert.ok(first.x >= GUIDE_START_OFFSET_METERS - 1e-9, 'the first dot must clear the hero');
});

test('dots are spaced GUIDE_DOT_SPACING_METERS apart along the line to the target', () => {
  const dots = straight(20);
  for (let i = 1; i < dots.length; i += 1) {
    assert.ok(Math.abs((dots[i].x - dots[i - 1].x) - GUIDE_DOT_SPACING_METERS) < 1e-9);
  }
});

test('a far target is capped at GUIDE_MAX_DOTS rather than drawing the whole trail', () => {
  const dots = straight(1000);
  assert.equal(dots.length, GUIDE_MAX_DOTS);
});

test('the trail follows the real direction, not just the x axis', () => {
  const dots = guideDotPlacements({ heroX: 0, heroZ: 0, targetX: 0, targetZ: 20 });
  assert.ok(dots.length >= 1);
  for (const dot of dots) {
    assert.ok(Math.abs(dot.x) < 1e-9, 'a due-north target should not drift the trail sideways');
    assert.ok(dot.z > 0);
  }
});

test('t runs from near 0 (at the hero) to near 1 (at the target)', () => {
  const dots = straight(20);
  assert.ok(dots[0].t > 0 && dots[0].t < 0.2);
  assert.ok(dots.at(-1).t > 0.8 && dots.at(-1).t <= 1);
  for (let i = 1; i < dots.length; i += 1) assert.ok(dots[i].t > dots[i - 1].t, 't must increase along the trail');
});

test('every dot is passed through the caller-supplied world clamp', () => {
  const dots = guideDotPlacements({
    heroX: 0, heroZ: 0, targetX: 20, targetZ: 0,
    clampX: () => 1234, clampZ: () => 5678,
  });
  assert.ok(dots.length >= 1);
  for (const dot of dots) {
    assert.equal(dot.x, 1234);
    assert.equal(dot.z, 5678);
  }
});

// ── brightness and motion ──────────────────────────────────────────────────────────────────────

test('opacity fades in near the hero and fades out near the target, full in the middle', () => {
  assert.ok(guideDotOpacity(0) < 0.1);
  assert.ok(guideDotOpacity(1) < 0.1);
  assert.ok(guideDotOpacity(0.5) > 0.9);
});

test('opacity never leaves [0, 1]', () => {
  for (let t = -0.2; t <= 1.2; t += 0.05) {
    const o = guideDotOpacity(t);
    assert.ok(o >= 0 && o <= 1, `opacity(${t}) = ${o} out of range`);
  }
});

test('the pulse stays a dim glow at worst, never fully dark', () => {
  for (let seconds = 0; seconds < 5; seconds += 0.1) {
    for (let index = 0; index < GUIDE_MAX_DOTS; index += 1) {
      const p = guideDotPulse(seconds, index);
      assert.ok(p > 0.5 && p <= 1, `pulse(${seconds}, ${index}) = ${p}`);
    }
  }
});

test('neighbouring dots are out of phase, so the trail does not blink as one unit', () => {
  const a = guideDotPulse(1.23, 0);
  const b = guideDotPulse(1.23, 1);
  assert.notEqual(a, b);
});

test('the bob is small and centred on zero, so dots hover rather than drift away', () => {
  let min = Infinity;
  let max = -Infinity;
  for (let seconds = 0; seconds < 5; seconds += 0.05) {
    const b = guideDotBob(seconds, 3);
    min = Math.min(min, b);
    max = Math.max(max, b);
  }
  assert.ok(min < 0 && max > 0, 'a bob that never goes negative is a drift, not a bob');
  assert.ok(Math.abs(min) < 0.1 && Math.abs(max) < 0.1, 'the bob should be a few centimetres, not a hop');
});

test('GUIDE_DOT_SPACING_METERS and GUIDE_MAX_DOTS are sane numbers, not accidental zeros', () => {
  assert.ok(GUIDE_DOT_SPACING_METERS > 0.5 && GUIDE_DOT_SPACING_METERS < 5);
  assert.ok(GUIDE_MAX_DOTS >= 8 && GUIDE_MAX_DOTS <= 24);
});
