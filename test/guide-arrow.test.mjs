// The three-way switch the always-on guidance HUD reads off: nothing to point at, point at it off
// screen, mark it on screen. Reuses ui/offscreenPointer.js's own tested edge-indicator maths rather
// than re-proving it here -- what this file proves is the part offscreenPointer.js cannot know on
// its own: the third state, and the metres.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_EDGE_MARGIN_PX, edgeIndicatorFor } from '../public/src/ui/offscreenPointer.js';
import { GUIDE_NEAR_METERS, formatGuideMeters, guideArrowFor } from '../public/src/render/guideArrow.js';

const VIEW = { width: 768, height: 1024, marginPx: DEFAULT_EDGE_MARGIN_PX };

const arrowAt = (ndcX, ndcY, extra = {}) => guideArrowFor({
  hasTarget: true,
  ndcX,
  ndcY,
  behindCamera: false,
  heroX: 0,
  heroZ: 0,
  targetX: 10,
  targetZ: 0,
  ...VIEW,
  ...extra,
});

test('no target at all is hidden, whatever the projection says', () => {
  const it = guideArrowFor({ hasTarget: false, ndcX: 0, ndcY: 0, behindCamera: false, heroX: 0, heroZ: 0, targetX: 5, targetZ: 5, ...VIEW });
  assert.equal(it.mode, 'hidden');
  assert.equal(it.x, 0);
  assert.equal(it.y, 0);
  assert.equal(it.angle, null);
  assert.equal(it.meters, null);
});

test('a target off screen is the edge mode, matching offscreenPointer.js exactly', () => {
  const it = arrowAt(3, 0);
  const reference = edgeIndicatorFor({ ndcX: 3, ndcY: 0, behindCamera: false, ...VIEW });
  assert.equal(it.mode, 'edge');
  assert.equal(it.x, reference.x);
  assert.equal(it.y, reference.y);
  assert.equal(it.angle, reference.angle);
});

test('a target on screen -- and far enough away to matter -- is the onscreen mode, not hidden', () => {
  const it = arrowAt(0, 0);
  assert.equal(it.mode, 'onscreen');
  assert.equal(it.x, 384);
  assert.equal(it.y, 512);
  assert.equal(it.angle, null, 'a marker sitting on the thing does not need a bearing');
});

test('the distance is the real world distance, not the screen distance', () => {
  const it = arrowAt(0, 0);
  assert.equal(it.meters, 10);
});

test('close enough to have arrived hides the indicator even while on screen', () => {
  const it = guideArrowFor({
    hasTarget: true, ndcX: 0, ndcY: 0, behindCamera: false,
    heroX: 0, heroZ: 0, targetX: GUIDE_NEAR_METERS, targetZ: 0, ...VIEW,
  });
  assert.equal(it.mode, 'hidden');
  assert.equal(it.meters, GUIDE_NEAR_METERS);
});

test('close enough to have arrived hides it even while off screen', () => {
  const it = guideArrowFor({
    hasTarget: true, ndcX: 3, ndcY: 0, behindCamera: false,
    heroX: 0, heroZ: 0, targetX: 1, targetZ: 0, ...VIEW,
  });
  assert.equal(it.mode, 'hidden');
});

test('just past the arrival radius still shows', () => {
  const it = guideArrowFor({
    hasTarget: true, ndcX: 0, ndcY: 0, behindCamera: false,
    heroX: 0, heroZ: 0, targetX: GUIDE_NEAR_METERS + 0.01, targetZ: 0, ...VIEW,
  });
  assert.notEqual(it.mode, 'hidden');
});

test('a target behind the camera still resolves through the edge maths correctly', () => {
  // Mirrors offscreenPointer.js's own behind-camera coverage: a point behind the camera and directly
  // ahead once mirrored must not be read as "on screen" just because guideArrowFor adds a branch.
  const it = arrowAt(0, 0, { behindCamera: true });
  assert.equal(it.mode, 'edge');
});

test('formatGuideMeters reads at a glance: whole metres, no unit space, no sign', () => {
  assert.equal(formatGuideMeters(23.4), '23m');
  assert.equal(formatGuideMeters(0.4), '0m');
  assert.equal(formatGuideMeters(6), '6m');
});

test('formatGuideMeters never leaks a bad number onto the screen', () => {
  for (const bad of [Number.NaN, undefined, null, -3, Infinity]) {
    assert.equal(formatGuideMeters(bad), '');
  }
});
