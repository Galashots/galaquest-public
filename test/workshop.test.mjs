import { strict as assert } from 'node:assert';
import test from 'node:test';

import { workshopTransition } from '../public/src/world/workshop.js';

// Same discipline zone-loader.test.mjs's own treeLitTransition tests use -- workshopTransition is
// deliberately built to the identical shape, so its tests are the identical shape too.

test('workshopTransition flips OFF -> ON as a real, changed transition', () => {
  assert.deepEqual(workshopTransition(false, true), { changed: true, built: true });
});

test('workshopTransition flips ON -> OFF as a real, changed transition', () => {
  assert.deepEqual(workshopTransition(true, false), { changed: true, built: false });
});

// Workshop I can never be un-bought (net/rewardStore.mjs's own durable idempotency), so this
// direction never fires in production -- proven anyway, the same way treeLitTransition proves its
// own OFF branch even though the relight only ever goes one way in practice today.
test('workshopTransition is idempotent: calling with the same value twice reports no change the second time', () => {
  assert.deepEqual(workshopTransition(true, true), { changed: false, built: true });
  assert.deepEqual(workshopTransition(false, false), { changed: false, built: false });
});

test('workshopTransition treats a non-boolean nextBuilt the same way Boolean-ish truthiness would', () => {
  assert.deepEqual(workshopTransition(false, undefined), { changed: false, built: false });
  assert.deepEqual(workshopTransition(false, 1), { changed: false, built: false });
});

// Sabotage-verify: a transition function that always reported changed:true would pass the two
// "flips" tests above too -- prove the idempotent branch really is reachable and distinct.
test('sabotage: workshopTransition\'s changed flag is not always true -- the idempotent case really differs', () => {
  const flip = workshopTransition(false, true);
  const repeat = workshopTransition(true, true);
  assert.notEqual(flip.changed, repeat.changed);
});
