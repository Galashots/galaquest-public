// One walkable edge, two simulations. Written after the running game was measured with only the
// server enforcing it -- see public/src/world/bounds.js's header for the observation.
//
// SPLIT PER AXIS on 2026-08-15, when the world grew north for the Wildwood. Until then one
// clampToWorld() served both axes and was correct; the moment z stopped matching x it would have
// pinned a child at z = 13 with twenty-two metres of trail ahead of them, and every test here would
// still have passed. That is the failure this file now watches for explicitly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  WORLD_EDGE_MARGIN_METERS,
  WORLD_LIMIT,
  WORLD_LIMIT_EAST,
  WORLD_LIMIT_NORTH,
  clampToWorldX,
  clampToWorldZ,
} from '../public/src/world/bounds.js';
import { groundBounds } from '../public/src/world/ground.js';
import { HOLLOW, ZONE } from '../public/src/world/zones/village.js';
import * as gameServer from '../net/gameServer.mjs';

test('the limit keeps a hero a metre inside the ground plane the zone actually builds', () => {
  assert.equal(WORLD_LIMIT, ZONE.size / 2 - 1);
});

// The property that matters is not "north is 35" or "east is 25". It is that a hero can never walk
// off the mesh, on any edge, whatever the zone's numbers become -- so this is asserted against the
// geometry builder's own bounds rather than against numbers retyped from village.js. Three of the
// four edges are now different from each other, which is exactly why this is written as a loop over
// edges rather than as four numbers somebody has to keep in their head.
test('every walkable limit sits a full margin inside the ground mesh, on all four edges', () => {
  const bounds = groundBounds(ZONE);
  assert.equal(WORLD_LIMIT_EAST, bounds.maxX - WORLD_EDGE_MARGIN_METERS, 'east');
  assert.equal(-WORLD_LIMIT, bounds.minX + WORLD_EDGE_MARGIN_METERS, 'west');
  assert.equal(-WORLD_LIMIT, bounds.minZ + WORLD_EDGE_MARGIN_METERS, 'south');
  assert.equal(WORLD_LIMIT_NORTH, bounds.maxZ - WORLD_EDGE_MARGIN_METERS, 'north');
});

// ARC 2. The world grew east so the marker stone in Blackthorn Hollow stops being a liar -- it aims
// north-east, and until this the walkable world ended 1.8 m past the Hollow.
test('the world reaches east of the Hollow, because that is where the stone points', () => {
  assert.ok(WORLD_LIMIT_EAST > WORLD_LIMIT,
    'if these are equal the Ranger Lodge is unreachable and nobody will notice from the data');
  assert.ok(WORLD_LIMIT_EAST > HOLLOW.at[0],
    'a child must be able to stand east of the hollow the stone points out of');
  const eastEnd = ZONE.size / 2 + ZONE.eastMeters;
  assert.ok(WORLD_LIMIT_EAST < eastEnd, 'the clamp still has to sit inside the mesh');
});

// The world grew in ONE direction, again. Nobody built anything west, so nothing may quietly appear
// there -- a symmetric limit would hand back twelve metres of meadow that does not exist as content.
test('and it did NOT grow west', () => {
  assert.equal(clampToWorldX(-WORLD_LIMIT - 5), -WORLD_LIMIT, 'the western edge is exactly where it was');
  assert.equal(-WORLD_LIMIT, -(ZONE.size / 2 - WORLD_EDGE_MARGIN_METERS));
});

test('the world really is longer north than it is wide -- the Wildwood is reachable', () => {
  assert.ok(
    WORLD_LIMIT_NORTH > WORLD_LIMIT,
    'if these are equal the trail past the gate is unwalkable and nobody will notice from the data',
  );
  // The trail's own far end, from the zone that draws it, must be somewhere a hero can stand.
  const trailEnd = ZONE.size / 2 + ZONE.northMeters;
  assert.ok(WORLD_LIMIT_NORTH < trailEnd, 'the clamp still has to sit inside the mesh');
});

test('clampToWorldX holds a position inside the world in both directions', () => {
  assert.equal(clampToWorldX(0), 0);
  assert.equal(clampToWorldX(WORLD_LIMIT_EAST + 5), WORLD_LIMIT_EAST, 'east stops at the new edge');
  assert.equal(clampToWorldX(-WORLD_LIMIT - 5), -WORLD_LIMIT, 'west is unchanged');
  assert.equal(clampToWorldX(WORLD_LIMIT + 4), WORLD_LIMIT + 4,
    'four metres past the old eastern edge is walkable now -- the road to the Lodge runs through it');
});

test('clampToWorldZ stops at the south edge but lets the hero walk on into the Wildwood', () => {
  assert.equal(clampToWorldZ(0), 0);
  assert.equal(clampToWorldZ(-WORLD_LIMIT - 5), -WORLD_LIMIT, 'south is unchanged');
  assert.equal(clampToWorldZ(WORLD_LIMIT_NORTH + 5), WORLD_LIMIT_NORTH, 'north stops at the new edge');
  assert.equal(clampToWorldZ(WORLD_LIMIT + 4), WORLD_LIMIT + 4, 'four metres past the old edge is walkable now');
});

// Sabotage-verify the split itself: prove the two functions genuinely disagree, so a future refactor
// that quietly collapses them back into one fails here instead of in a child's hands.
//
// The old witness for this was "four metres past the old edge": z allowed it and x did not. Arc 2
// made x allow it too, so that witness stopped proving anything -- it would now pass against a
// single shared clamp. The honest witness is the place the two limits genuinely differ, which is the
// far north-east: z reaches 57 and x reaches 25, so a point at 40 lands on different numbers.
test('sabotage: the two clamps are NOT the same function in disguise', () => {
  assert.notEqual(WORLD_LIMIT_EAST, WORLD_LIMIT_NORTH,
    'this test is only meaningful while the two edges are different distances out');
  const wayOut = Math.max(WORLD_LIMIT_EAST, WORLD_LIMIT_NORTH) + 10;
  assert.equal(clampToWorldX(wayOut), WORLD_LIMIT_EAST);
  assert.equal(clampToWorldZ(wayOut), WORLD_LIMIT_NORTH);
  assert.notEqual(clampToWorldZ(wayOut), clampToWorldX(wayOut));
  // ...and they still agree where they SHOULD: the south and west edges are the same number, and a
  // split that got those wrong would be just as broken as one that collapsed.
  assert.equal(clampToWorldX(-999), clampToWorldZ(-999));
});

test('the server clamps with the SAME functions, not copies of them', () => {
  assert.equal(gameServer.clampToWorldX, clampToWorldX);
  assert.equal(gameServer.clampToWorldZ, clampToWorldZ);
  assert.equal(gameServer.WORLD_LIMIT, WORLD_LIMIT);
  assert.equal(gameServer.WORLD_LIMIT_NORTH, WORLD_LIMIT_NORTH);
});

test("the client's own prediction clamps too -- the half that was missing", () => {
  // A source scan, because main.js is a browser bootstrap with no exported step to call. It is the
  // same shape test/feedback.test.mjs already uses to pin encounter.js's event list, and it is here
  // because the defect was precisely that the clamp existed on one side only.
  const main = readFileSync(fileURLToPath(new URL('../public/src/main.js', import.meta.url)), 'utf8');
  assert.match(main, /import \{ clampToWorldX, clampToWorldZ \} from '\.\/world\/bounds\.js'/);
  // Per AXIS, and this is the assertion that would have caught calling the X clamp on Z.
  assert.match(main, /player\.position\.x = clampToWorldX\(/);
  assert.match(main, /player\.position\.z = clampToWorldZ\(/);
  assert.doesNotMatch(main, /player\.position\.z = clampToWorldX\(/);
});
