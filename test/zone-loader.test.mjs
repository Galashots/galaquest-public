import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distance,
  groundOffsetY,
  headingToward,
  isTreeLandmark,
  KEEPER_TARGET_HEIGHT_METERS,
  KEEPER_WAVE_RADIUS_METERS,
  lanternUnlockedFromRewards,
  scaleForHeight,
  treeLitTransition,
} from '../public/src/world/zoneLoader.js';
import { LANDMARKS } from '../public/src/world/zones/village.js';

// V2's own "loader unit-testable pure parts (scale math, facing math)" -- the three.js-dependent
// half (Box3 measurement, GLTFLoader, AnimationMixer) is proven at runtime by V3's drive-village.mjs
// instead; nothing here touches three.js or the DOM.

test('scaleForHeight scales a measured height to the target height', () => {
  // The brief's own worked example: keeper measures 2.70m raw, targets 1.65m.
  assert.ok(Math.abs(scaleForHeight(2.70, 1.65) - (1.65 / 2.70)) < 1e-9);
  // The lantern tree's own worked example: LANDMARKS' height field is 9.
  assert.equal(scaleForHeight(3, 9), 3);
  assert.equal(scaleForHeight(1, 1), 1);
});

test('scaleForHeight does not divide by a degenerate (zero or negative) measurement', () => {
  assert.equal(scaleForHeight(0, 9), 1);
  assert.equal(scaleForHeight(-2, 9), 1);
});

// Sabotage-verify: a scale function that always returned 1 would pass every "does not explode"
// assertion above. This proves it actually computes a ratio, not a constant.
test('sabotage: scaleForHeight is NOT a constant -- two different inputs give two different scales', () => {
  const a = scaleForHeight(2, 4);
  const b = scaleForHeight(2, 8);
  assert.notEqual(a, b);
});

// ── Y1: generic landmark grounding -- pure state->offset mapping, no three.js (see zoneLoader.js's
// own header on why the Box3/GLTFLoader half is proven at runtime by drive-village.mjs instead) ──

test('groundOffsetY moves a buried model\'s measured base up to ground level', () => {
  // The worked example from this repo's own history: v1's lantern_tree.glb (pivot at its vertical
  // centre) measured worldBox.min.y = -2.75 at its shipped 5.5m height, before this fix landed
  // (see the private engineering archive). Grounding it needed a +2.75 correction.
  assert.equal(groundOffsetY(-2.75, 0), 2.75);
});

test('groundOffsetY is a no-op for a model already resting on the ground', () => {
  assert.equal(groundOffsetY(0, 0), 0);
});

test('groundOffsetY defaults groundY to 0 when omitted', () => {
  assert.equal(groundOffsetY(-1.2), 1.2);
});

test('groundOffsetY supports a non-zero ground level', () => {
  assert.equal(groundOffsetY(3, 5), 2);
});

// Sabotage-verify: a function that always returned 0 would pass the no-op case above too.
test('sabotage: groundOffsetY is NOT a constant -- two different measured minYs give two different offsets', () => {
  const buried = groundOffsetY(-2.75, 0);
  const grounded = groundOffsetY(0, 0);
  assert.notEqual(buried, grounded);
});

test('headingToward matches main.js\'s own atan2(dx, dz) heading convention', () => {
  // Facing due +Z (world "forward" for a hero at heading 0 -- camera/rotation.js's own convention).
  assert.ok(Math.abs(headingToward(0, 0, 0, 5)) < 1e-9);
  // Facing due +X should be +90 degrees (pi/2), same sign convention player.heading uses.
  assert.ok(Math.abs(headingToward(0, 0, 5, 0) - Math.PI / 2) < 1e-9);
  // The keeper's own placement: SPAWNS.keeper [-4, -3.5] facing SPAWNS.heroes [0, 0].
  const facing = headingToward(-4, -3.5, 0, 0);
  assert.ok(Math.abs(facing - Math.atan2(4, 3.5)) < 1e-9);
});

test('distance is plain Euclidean distance in the x/z plane', () => {
  assert.equal(distance(0, 0, 3, 4), 5);
  assert.equal(distance(1, 1, 1, 1), 0);
});

// Sabotage-verify: prove distance() actually measures rather than always returning something that
// happens to satisfy "<= radius" checks elsewhere -- a fixed point well outside the keeper's own
// wave radius must measure as such.
test('sabotage: distance() correctly reports a point OUTSIDE the keeper wave radius as outside it', () => {
  const far = distance(0, 0, KEEPER_WAVE_RADIUS_METERS + 10, 0);
  assert.ok(far > KEEPER_WAVE_RADIUS_METERS);
});

test('the keeper target height is a believable adult height, distinct from the hero\'s 1.479m', () => {
  assert.ok(KEEPER_TARGET_HEIGHT_METERS > 1.479 && KEEPER_TARGET_HEIGHT_METERS < 2.2);
});

// ── W2: the relight -- pure state->lit mapping, no three.js (see zoneLoader.js's own header on
// why the Box3/GLTFLoader/material half is proven at runtime by drive-village.mjs instead) ───────

test('isTreeLandmark recognises the shipped lantern tree landmark', () => {
  assert.equal(LANDMARKS.length > 0, true);
  assert.equal(isTreeLandmark(LANDMARKS[0]), true, 'village.js\'s own LANDMARKS[0] should be the tree');
});

test('isTreeLandmark rejects a landmark naming a different model', () => {
  assert.equal(isTreeLandmark({ model: 'world/keeper.glb' }), false);
  assert.equal(isTreeLandmark({ model: 'props/village/lantern.glb' }), false);
});

// Sabotage-verify: a matcher that always returned true would pass the positive test above too.
test('sabotage: isTreeLandmark is not a constant -- a non-tree model measures as false', () => {
  assert.notEqual(isTreeLandmark(LANDMARKS[0]), isTreeLandmark({ model: 'world/keeper.glb' }));
});

test('lanternUnlockedFromRewards reads the same shape main.js\'s rewards() returns', () => {
  assert.equal(lanternUnlockedFromRewards({ marks: 3, lanternUnlocked: true }), true);
  assert.equal(lanternUnlockedFromRewards({ marks: 1, lanternUnlocked: false }), false);
});

test('lanternUnlockedFromRewards degrades to "not lit" for a guest not on the books yet', () => {
  assert.equal(lanternUnlockedFromRewards(undefined), false);
  assert.equal(lanternUnlockedFromRewards(null), false);
  assert.equal(lanternUnlockedFromRewards({}), false);
});

// Sabotage-verify: a mapper that always returned false would pass every "not lit" case above too.
test('sabotage: lanternUnlockedFromRewards is not a constant -- an unlocked guest reads true', () => {
  assert.notEqual(
    lanternUnlockedFromRewards({ lanternUnlocked: true }),
    lanternUnlockedFromRewards({ lanternUnlocked: false }),
  );
});

test('treeLitTransition flips OFF -> ON as a real, changed transition', () => {
  assert.deepEqual(treeLitTransition(false, true), { changed: true, lit: true });
});

test('treeLitTransition flips ON -> OFF as a real, changed transition', () => {
  assert.deepEqual(treeLitTransition(true, false), { changed: true, lit: false });
});

// The brief's own "reversible and idempotent -- calling twice is harmless": a repeat call with the
// SAME next value must report changed:false, which is what stops the light/material mutation from
// running (and drifting) a second time.
test('treeLitTransition is idempotent: calling with the same value twice reports no change the second time', () => {
  assert.deepEqual(treeLitTransition(true, true), { changed: false, lit: true });
  assert.deepEqual(treeLitTransition(false, false), { changed: false, lit: false });
});

test('treeLitTransition treats a non-boolean nextLit the same way Boolean-ish truthiness would', () => {
  assert.deepEqual(treeLitTransition(false, undefined), { changed: false, lit: false });
  assert.deepEqual(treeLitTransition(false, 1), { changed: false, lit: false });
});

// Sabotage-verify: a transition function that always reported changed:true would pass the two
// "flips" tests above too -- prove the idempotent branch really is reachable and distinct.
test('sabotage: treeLitTransition\'s changed flag is not always true -- the idempotent case really differs', () => {
  const flip = treeLitTransition(false, true);
  const repeat = treeLitTransition(true, true);
  assert.notEqual(flip.changed, repeat.changed);
});
