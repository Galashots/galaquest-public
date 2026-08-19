// Rowan's placement in the world, and the cart he sends a child to search.
//
// What is worth pinning here is not taste (where exactly he stands) but the two design rules that
// would silently break the beat if broken by accident:
//   1. Rowan actually stands where the camp trigger already fires -- a story NPC placed just outside
//      CAMP's own radius would greet a child who, by every other signal in the game, has not "found"
//      anything yet.
//   2. CART_SEARCH is DERIVED from the cart prop already in PROPS, not a second typed-out coordinate
//      (docs/MISTAKES.md GQ-007) -- so moving the cart can never leave the search trigger behind.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  CAMP, CART_SEARCH, PROPS, ROAD, ROWAN, TRAIL_LIGHTS, WILDWOOD_BLADE,
} from '../public/src/world/zones/village.js';

const distance = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

test('Rowan stands inside the camp trigger, not just near it', () => {
  assert.ok(distance(ROWAN.at[0], ROWAN.at[1], CAMP.at[0], CAMP.at[1]) <= CAMP.radiusMeters);
});

test('Rowan reuses the Keeper model rather than a second GLB we do not own', () => {
  assert.match(ROWAN.model, /keeper\.glb$/);
});

test('Rowan\'s resting heading is derived from a real trail light, not a duplicated coordinate', () => {
  assert.deepEqual([...ROWAN.facing], [...TRAIL_LIGHTS[TRAIL_LIGHTS.length - 2]]);
});

test('Rowan stands clear of every camp prop\'s own body', () => {
  const CLEARANCE_METERS = 1.0;
  for (const prop of PROPS) {
    if (prop.dormant === true) continue;
    const d = distance(ROWAN.at[0], ROWAN.at[1], prop.at[0], prop.at[1]);
    assert.ok(d >= CLEARANCE_METERS, `Rowan is ${d.toFixed(2)}m from ${prop.model} at [${prop.at}]`);
  }
});

test('CART_SEARCH is the cart\'s own placement, not retyped', () => {
  const cart = PROPS.find((prop) => prop.tiltZ != null);
  assert.ok(cart, 'expected a tipped-over cart in PROPS');
  assert.deepEqual([...CART_SEARCH.at], [...cart.at]);
  assert.ok(CART_SEARCH.radiusMeters > 0);
});

test('the Wildwood Blade stands close enough to Rowan for "see that sword" to read', () => {
  const d = distance(WILDWOOD_BLADE.at[0], WILDWOOD_BLADE.at[1], ROWAN.at[0], ROWAN.at[1]);
  assert.ok(d <= 3, `the blade is ${d.toFixed(2)}m from Rowan -- too far to gesture at`);
});

test('the Wildwood Blade stands clear of every camp prop and off the road surface', () => {
  const CLEARANCE_METERS = 1.0;
  for (const prop of PROPS) {
    if (prop.dormant === true) continue;
    const d = distance(WILDWOOD_BLADE.at[0], WILDWOOD_BLADE.at[1], prop.at[0], prop.at[1]);
    assert.ok(d >= CLEARANCE_METERS, `the blade is ${d.toFixed(2)}m from ${prop.model} at [${prop.at}]`);
  }
  const half = ROAD.widthMeters / 2;
  const toSegment = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax; const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
  };
  const d = Math.min(...ROAD.points.slice(0, -1)
    .map((p, i) => toSegment(WILDWOOD_BLADE.at[0], WILDWOOD_BLADE.at[1], p[0], p[1], ROAD.points[i + 1][0], ROAD.points[i + 1][1])));
  assert.ok(d > half, `the blade sits ${d.toFixed(2)}m off the road's centre -- standing in the path`);
});
