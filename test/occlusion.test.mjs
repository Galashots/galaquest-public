// "Get out of the way." The pure half of the Keeper's occlusion fade -- whether something standing
// at a given spot is between this camera and this hero. The material fade that follows it is
// three.js and is judged in captures.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OCCLUDED_OPACITY,
  OCCLUSION_RADIUS_METERS,
  occlusionOpacity,
} from '../public/src/world/zoneLoader.js';

const CAMERA = { x: 0, z: -16 };
const HERO = { x: 0, z: 0 };

test('something standing on the line between the camera and the hero is in the way', () => {
  assert.equal(occlusionOpacity(CAMERA, HERO, { x: 0, z: -8 }), OCCLUDED_OPACITY);
  assert.equal(occlusionOpacity(CAMERA, HERO, { x: 0.9, z: -8 }), OCCLUDED_OPACITY);
});

test('something beside the line is solid, and the edge is where the radius says', () => {
  assert.equal(occlusionOpacity(CAMERA, HERO, { x: OCCLUSION_RADIUS_METERS + 0.01, z: -8 }), 1);
  assert.equal(occlusionOpacity(CAMERA, HERO, { x: OCCLUSION_RADIUS_METERS - 0.01, z: -8 }), OCCLUDED_OPACITY);
});

// The half that a plain distance-to-line test gets wrong, and the reason the projection is clamped:
// the Keeper standing five metres BEHIND the camera is exactly on the line and blocks nothing.
test('behind the camera, or past the hero, is never in the way however close to the line', () => {
  assert.equal(occlusionOpacity(CAMERA, HERO, { x: 0, z: -20 }), 1, 'behind the camera');
  assert.equal(occlusionOpacity(CAMERA, HERO, { x: 0, z: 5 }), 1, 'past the hero');
  assert.equal(occlusionOpacity(CAMERA, HERO, { x: 0, z: -16 }), 1, 'exactly at the camera');
  assert.equal(occlusionOpacity(CAMERA, HERO, { x: 0, z: 0 }), 1, 'exactly at the hero');
});

test('it works on any heading, not just the one it was written against', () => {
  // Same geometry rotated 90 degrees: camera east of the hero, subject halfway.
  const camera = { x: 16, z: 0 };
  const hero = { x: 0, z: 0 };
  assert.equal(occlusionOpacity(camera, hero, { x: 8, z: 0 }), OCCLUDED_OPACITY);
  assert.equal(occlusionOpacity(camera, hero, { x: 8, z: 3 }), 1);
  // ...and on a diagonal.
  const diagCamera = { x: -11, z: -11 };
  assert.equal(occlusionOpacity(diagCamera, hero, { x: -5.5, z: -5.5 }), OCCLUDED_OPACITY);
  assert.equal(occlusionOpacity(diagCamera, hero, { x: -5.5, z: -2 }), 1);
});

test('a camera sitting exactly on the hero degrades to solid rather than dividing by zero', () => {
  const result = occlusionOpacity(HERO, HERO, { x: 0, z: 0 });
  assert.equal(result, 1);
  assert.ok(Number.isFinite(result));
});

test('the faded value is see-through but not invisible', () => {
  assert.ok(OCCLUDED_OPACITY > 0, 'a fully invisible quest-giver is worse than one in the way');
  assert.ok(OCCLUDED_OPACITY < 0.5, 'it has to actually get out of the way');
});
