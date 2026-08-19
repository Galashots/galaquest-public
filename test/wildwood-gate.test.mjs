// The Wildwood Gate has to be a gate: something a child can see from down the lane, walk under, and
// recognise as the way out. Every check here is one of those three sentences turned into a number.
//
// It is also the only structure in the game built out of boxes rather than loaded from a GLB, which
// means nothing measures it at load time the way zoneLoader.js measures a model's bounding box --
// if a size constant here is wrong, the only thing that notices is a screenshot. So the proportions
// are pinned against the things the gate stands next to (the hero, the road, the treeline), not
// against themselves.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  GATE_TOTAL_HEIGHT_METERS,
  POST_HEIGHT_METERS,
  POST_THICKNESS_METERS,
  gateParts,
} from '../public/src/world/wildwoodGate.js';
import { PROPS, ROAD, SPAWNS, WILDWOOD_GATE } from '../public/src/world/zones/village.js';

// The shipped hero, measured (character/hero.js's own target height).
const HERO_HEIGHT_METERS = 1.48;
const ARCH = WILDWOOD_GATE.arch;

test('the zone actually asks for an arch, with the three numbers the builder needs', () => {
  assert.ok(ARCH, 'no arch in WILDWOOD_GATE -- the gate is two lamp posts again');
  assert.equal(ARCH.at.length, 2);
  assert.ok(ARCH.at.every(Number.isFinite));
  assert.ok(Number.isFinite(ARCH.rotY));
  assert.ok(ARCH.spanMeters > 0);
});

test('a child can walk through it without the road being pinched', () => {
  const clearOpening = ARCH.spanMeters - POST_THICKNESS_METERS;
  assert.ok(clearOpening >= ROAD.widthMeters,
    `the gateway's clear opening is ${clearOpening.toFixed(2)} m but the road it stands on is `
    + `${ROAD.widthMeters} m wide -- the posts would stand in the road`);
});

test('a child can walk UNDER it, hanging lamp and all', () => {
  const { parts, lampAt } = gateParts(ARCH.spanMeters);
  const lamp = parts.find((p) => p.name === 'lamp');
  const lampUnderside = lampAt[1] - lamp.size[1] / 2;
  assert.ok(lampUnderside > HERO_HEIGHT_METERS,
    `the hanging lamp's underside is ${lampUnderside.toFixed(2)} m and the hero is `
    + `${HERO_HEIGHT_METERS} m -- they would walk face-first into it`);
  const collar = parts.find((p) => p.name === 'collar');
  assert.ok(collar.at[1] - collar.size[1] / 2 > HERO_HEIGHT_METERS, 'the collar beam is at head height');
});

// It is a landmark or it is scenery. The treeline behind it is 2.4 m of tree at up to scale 1.35,
// so the arch has to clear roughly 3.3 m of trees to break the horizon a child is looking at.
test('it stands taller than the treeline it is set into', () => {
  const TALLEST_TREE_METERS = 2.413 * 1.35;
  assert.ok(GATE_TOTAL_HEIGHT_METERS > TALLEST_TREE_METERS,
    `the gate tops out at ${GATE_TOTAL_HEIGHT_METERS.toFixed(2)} m against ${TALLEST_TREE_METERS.toFixed(2)} m `
    + 'of tree -- it would disappear into the treeline');
  // ...and not SO tall it stops being a village-scale thing next to the 5.5 m Lantern Tree.
  assert.ok(GATE_TOTAL_HEIGHT_METERS < 5.5, 'the gate must not out-scale the Lantern Tree');
});

test('every piece is a real box, above the ground, and none is a zero', () => {
  const { parts } = gateParts(ARCH.spanMeters);
  assert.ok(parts.length >= 8, 'a gate with fewer than two posts, a lintel and two braces is a doorframe');
  for (const part of parts) {
    assert.equal(part.size.length, 3, `${part.name} is not a box`);
    for (const side of part.size) assert.ok(side > 0.05, `${part.name} has a ${side} m side -- invisible`);
    assert.ok(part.at[1] - part.size[1] / 2 >= -1e-9, `${part.name} is sunk into the ground`);
    assert.ok(part.at[1] + part.size[1] / 2 <= GATE_TOTAL_HEIGHT_METERS + 1e-9,
      `${part.name} pokes out above the gate's own stated height`);
  }
});

test('the posts stand at the ends of the span, one on each side', () => {
  const { parts } = gateParts(ARCH.spanMeters);
  const posts = parts.filter((p) => p.name === 'post');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.map((p) => p.at[0]).sort((a, b) => a - b),
    [-ARCH.spanMeters / 2, ARCH.spanMeters / 2]);
  for (const post of posts) assert.equal(post.size[1], POST_HEIGHT_METERS);
});

// ── where it stands ─────────────────────────────────────────────────────────────────────────────
//
// The clearances below were solved rather than eyeballed, and the ONE thing most likely to undo
// them is somebody moving a treeline tree. These are the same measured footprints
// test/zone-data.test.mjs uses; restated here because that file's table is not exported and this
// one is about the gate, not about the props.

const FOOTPRINT_RADIUS_METERS = {
  'house-cottage': 1.500, 'house-longhouse': 2.050, 'stall-green': 0.500, 'stall-bench': 0.470,
  'cart': 0.670, 'lantern': 0.112, 'fence': 0.500, 'fence-gate': 0.500, 'fence-broken': 0.500,
  'tree': 0.512, 'tree-crooked': 0.512, 'rock-small': 0.663, 'rock-large': 0.835, 'rock-wide': 0.784,
};
// Conservative circular half-extent of a square post, same convention as the table above.
const POST_RADIUS_METERS = (POST_THICKNESS_METERS * Math.SQRT2) / 2;

function postPositions() {
  const dx = Math.cos(ARCH.rotY);
  const dz = -Math.sin(ARCH.rotY);
  const half = ARCH.spanMeters / 2;
  return [
    [ARCH.at[0] - dx * half, ARCH.at[1] - dz * half],
    [ARCH.at[0] + dx * half, ARCH.at[1] + dz * half],
  ];
}

test('the road runs through the gateway rather than past it', () => {
  const distanceToRoad = (x, z) => {
    let best = Infinity;
    for (let i = 0; i + 1 < ROAD.points.length; i += 1) {
      const [ax, az] = ROAD.points[i];
      const [bx, bz] = ROAD.points[i + 1];
      const dx = bx - ax; const dz = bz - az;
      const lengthSquared = dx * dx + dz * dz;
      const t = lengthSquared === 0 ? 0
        : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
      best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
    }
    return best;
  };
  assert.ok(distanceToRoad(ARCH.at[0], ARCH.at[1]) <= ROAD.widthMeters / 2,
    'the arch does not straddle the road -- a child would walk past it, not through it');
});

test('neither post grows out of a tree, a rock or a lantern', () => {
  const offenders = [];
  for (const [px, pz] of postPositions()) {
    for (const prop of PROPS) {
      const name = prop.model.split('/').pop().replace('.glb', '');
      const radius = FOOTPRINT_RADIUS_METERS[name];
      assert.ok(radius != null, `no measured footprint radius for '${name}'`);
      const gap = Math.hypot(px - prop.at[0], pz - prop.at[1]) - radius * (prop.scale ?? 1) - POST_RADIUS_METERS;
      if (gap < 0.2) offenders.push(`${name}@[${prop.at}] is ${gap.toFixed(2)} m from a gate post`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('neither post stands in a combat bowl', () => {
  const offenders = [];
  for (const [px, pz] of postPositions()) {
    for (const [wolfX, wolfZ] of SPAWNS.patrol) {
      const gap = Math.hypot(px - wolfX, pz - wolfZ) - POST_RADIUS_METERS;
      if (gap < 4) offenders.push(`a gate post is ${gap.toFixed(2)} m from the wolf spawn [${wolfX}, ${wolfZ}]`);
    }
  }
  assert.deepEqual(offenders, []);
});

// Sabotage: the clearance check has to actually bite. The tree at [5.4, 13] was the tight one when
// the gate was placed -- put a tree back where an earlier candidate would have driven a post
// through one and prove the check catches it.
test('sabotage: the post-clearance check DOES fail against a post inside a tree', () => {
  const [px, pz] = postPositions()[1];
  const insideIt = { model: 'props/village/tree.glb', at: [px + 0.2, pz + 0.2], scale: 1.3 };
  const gap = Math.hypot(px - insideIt.at[0], pz - insideIt.at[1])
    - FOOTPRINT_RADIUS_METERS.tree * insideIt.scale - POST_RADIUS_METERS;
  assert.ok(gap < 0.2, 'a tree 0.28 m from a gate post should read as a collision');
});
