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
  WORLD_LIMIT_NORTH,
  clampToWorldX,
  clampToWorldZ,
} from '../public/src/world/bounds.js';
import { groundBounds } from '../public/src/world/ground.js';
import { ZONE } from '../public/src/world/zones/village.js';
import * as gameServer from '../net/gameServer.mjs';

test('the limit keeps a hero a metre inside the ground plane the zone actually builds', () => {
  assert.equal(WORLD_LIMIT, ZONE.size / 2 - 1);
});

// The property that matters is not "north is 35". It is that a hero can never walk off the mesh, on
// any edge, whatever the zone's numbers become -- so this is asserted against the geometry builder's
// own bounds rather than against a number retyped from village.js.
test('every walkable limit sits a full margin inside the ground mesh, on all four edges', () => {
  const bounds = groundBounds(ZONE);
  assert.equal(WORLD_LIMIT, bounds.maxX - WORLD_EDGE_MARGIN_METERS, 'east');
  assert.equal(-WORLD_LIMIT, bounds.minX + WORLD_EDGE_MARGIN_METERS, 'west');
  assert.equal(-WORLD_LIMIT, bounds.minZ + WORLD_EDGE_MARGIN_METERS, 'south');
  assert.equal(WORLD_LIMIT_NORTH, bounds.maxZ - WORLD_EDGE_MARGIN_METERS, 'north');
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
  assert.equal(clampToWorldX(WORLD_LIMIT + 5), WORLD_LIMIT);
  assert.equal(clampToWorldX(-WORLD_LIMIT - 5), -WORLD_LIMIT);
});

test('clampToWorldZ stops at the south edge but lets the hero walk on into the Wildwood', () => {
  assert.equal(clampToWorldZ(0), 0);
  assert.equal(clampToWorldZ(-WORLD_LIMIT - 5), -WORLD_LIMIT, 'south is unchanged');
  assert.equal(clampToWorldZ(WORLD_LIMIT_NORTH + 5), WORLD_LIMIT_NORTH, 'north stops at the new edge');
  assert.equal(clampToWorldZ(WORLD_LIMIT + 4), WORLD_LIMIT + 4, 'four metres past the old edge is walkable now');
});

// Sabotage-verify the split itself: prove the two functions genuinely disagree, so a future refactor
// that quietly collapses them back into one fails here instead of in a child's hands.
test('sabotage: the two clamps are NOT the same function in disguise', () => {
  const pastTheOldEdge = WORLD_LIMIT + 4;
  assert.equal(clampToWorldX(pastTheOldEdge), WORLD_LIMIT);
  assert.notEqual(clampToWorldZ(pastTheOldEdge), clampToWorldX(pastTheOldEdge));
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
