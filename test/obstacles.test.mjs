// test/obstacles.test.mjs
//
// The Beacon collision fix: kids were walking straight through the Old Beacon's own stone base on
// two different devices in a real playtest. world/obstacles.js is the shared pure resolver both
// main.js's own client-side prediction and net/gameServerCore.mjs's authoritative hero movement
// import -- see that file's own header for why "shared" and "pure" are not negotiable here (the same
// world/bounds.js rubber-band world/bounds.js's own header measured, one boundary over).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BEACON_OBSTACLE_RADIUS_METERS,
  LANTERN_TREE_OBSTACLE_RADIUS_METERS,
  resolveObstacleCollisions,
  worldObstacles,
} from '../public/src/world/obstacles.js';
import { OLD_BEACON, LANDMARKS } from '../public/src/world/zones/village.js';

test('worldObstacles carries the Beacon and the Lantern Tree, from the zone\'s own data', () => {
  const obstacles = worldObstacles();
  assert.equal(obstacles.length, 2, 'exactly the Beacon and the Lantern Tree -- no more, no fewer');

  const beacon = obstacles.find((o) => o.at === OLD_BEACON.at);
  assert.ok(beacon, 'the Beacon obstacle must be built from OLD_BEACON.at itself, not a restated copy');
  assert.equal(beacon.radiusMeters, BEACON_OBSTACLE_RADIUS_METERS);

  const tree = LANDMARKS.find((landmark) => landmark.model.includes('lantern_tree'));
  const treeObstacle = obstacles.find((o) => o.at === tree.at);
  assert.ok(treeObstacle, 'the Lantern Tree obstacle must be built from its own LANDMARKS entry');
  assert.equal(treeObstacle.radiusMeters, LANTERN_TREE_OBSTACLE_RADIUS_METERS);
});

test('a hero standing outside every obstacle is left exactly where they were', () => {
  const obstacles = [{ at: [0, 0], radiusMeters: 2 }];
  const far = { x: 10, z: -4 };
  assert.deepEqual(resolveObstacleCollisions(far, obstacles), far);
});

test('a hero standing exactly on the rim is left untouched (>= radius is outside)', () => {
  const obstacles = [{ at: [0, 0], radiusMeters: 2 }];
  const onRim = { x: 2, z: 0 };
  assert.deepEqual(resolveObstacleCollisions(onRim, obstacles), onRim);
});

test('a hero who stepped inside is pushed straight back out to the rim, along the same line', () => {
  const obstacles = [{ at: [5, 5], radiusMeters: 2 }];
  // Due east of centre, 0.5 m inside the 2 m radius.
  const inside = { x: 6.5, z: 5 };
  const pushed = resolveObstacleCollisions(inside, obstacles);
  assert.ok(Math.abs(pushed.x - 7) < 1e-9, `expected x=7 (the rim), got ${pushed.x}`);
  assert.equal(pushed.z, 5, 'pushed straight out along the same radial line, no sideways drift');
  // Landing exactly on the rim, never inside it and never overshooting past it.
  const distance = Math.hypot(pushed.x - 5, pushed.z - 5);
  assert.ok(Math.abs(distance - 2) < 1e-9);
});

test('a hero teleported to the exact centre still gets a stable, defined push', () => {
  const obstacles = [{ at: [3, -1], radiusMeters: 1.5 }];
  const centre = { x: 3, z: -1 };
  const pushed = resolveObstacleCollisions(centre, obstacles);
  assert.equal(pushed.x, 3);
  assert.equal(pushed.z, -1 + 1.5, 'the distance-zero tie-break is a stable, arbitrary +Z push');
});

test('sliding along the edge: a step that stays inside the circle keeps landing on the rim, not snapping to one spot', () => {
  const obstacles = [{ at: [0, 0], radiusMeters: 2 }];
  // Walk a quarter turn around the inside of the circle, one small step at a time, the way a hero
  // running a thumbstick along a landmark's edge actually moves -- every single step must resolve to
  // ITS OWN nearest point on the rim, not collapse to a single corner.
  const angles = [0.1, 0.3, 0.6, 0.9, 1.2, 1.5];
  const seen = new Set();
  for (const angle of angles) {
    // 1.9 m out (inside the 2 m radius) at this angle.
    const attempted = { x: Math.cos(angle) * 1.9, z: Math.sin(angle) * 1.9 };
    const pushed = resolveObstacleCollisions(attempted, obstacles);
    const distance = Math.hypot(pushed.x, pushed.z);
    assert.ok(Math.abs(distance - 2) < 1e-9, `angle ${angle}: expected to land on the rim, got distance ${distance}`);
    seen.add(`${pushed.x.toFixed(3)},${pushed.z.toFixed(3)}`);
  }
  assert.equal(seen.size, angles.length, 'each angle along the edge must resolve to its own distinct point on the rim');
});

test('two obstacles compose: pushed out of one, still free to walk near the other', () => {
  const obstacles = [
    { at: [0, 0], radiusMeters: 2 },
    { at: [50, 50], radiusMeters: 2 },
  ];
  const insideFirst = { x: 1, z: 0 };
  const pushed = resolveObstacleCollisions(insideFirst, obstacles);
  assert.ok(Math.abs(Math.hypot(pushed.x, pushed.z) - 2) < 1e-9);
  // Nowhere near the second obstacle, so it must be untouched by it.
  assert.ok(Math.hypot(pushed.x - 50, pushed.z - 50) > 2);
});

test('no obstacles list is a no-op, not a throw', () => {
  assert.deepEqual(resolveObstacleCollisions({ x: 1, z: 2 }, []), { x: 1, z: 2 });
  assert.deepEqual(resolveObstacleCollisions({ x: 1, z: 2 }, undefined), { x: 1, z: 2 });
});
