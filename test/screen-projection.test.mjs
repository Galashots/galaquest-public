import { strict as assert } from 'node:assert';
import test from 'node:test';

import { ndcToOverlayPixels } from '../public/src/render/screenProjection.js';

// three.js's own convention (Vector3.project(camera)): NDC x/y run -1..1, +1 is right/up. CSS pixel
// space runs 0..width and 0..height, +y DOWN the screen -- the one axis a naive port gets backwards,
// because both "up" and "down" read as reasonable answers to someone who has not looked at the
// three.js docs for project() while writing it.
test('the NDC origin lands at the centre of the overlay', () => {
  assert.deepEqual(ndcToOverlayPixels(0, 0, 768, 1024), { x: 384, y: 512 });
});

test('NDC top-left (-1, 1) lands at pixel (0, 0), not (0, height)', () => {
  assert.deepEqual(ndcToOverlayPixels(-1, 1, 768, 1024), { x: 0, y: 0 });
});

test('NDC bottom-right (1, -1) lands at pixel (width, height)', () => {
  assert.deepEqual(ndcToOverlayPixels(1, -1, 768, 1024), { x: 768, y: 1024 });
});

// sabotage: proves the Y axis is actually flipped somewhere in the function, rather than the test
// above passing by coincidence because 0 and 1024 both satisfy a bug that never touches y at all.
test('sabotage: a positive NDC y measures LOWER on screen (smaller pixel y) than a negative one', () => {
  const up = ndcToOverlayPixels(0, 0.5, 768, 1024);
  const down = ndcToOverlayPixels(0, -0.5, 768, 1024);
  assert.ok(up.y < down.y, `expected up.y (${up.y}) < down.y (${down.y})`);
});

test('a point behind or outside the camera frustum still maps linearly -- clamping is the caller\'s job', () => {
  assert.deepEqual(ndcToOverlayPixels(-2, 0, 768, 1024), { x: -384, y: 512 });
});
