// The village has people in it, and one of them is the one you are supposed to talk to.
//
// Two things are worth pinning here and neither is "does three.js work". The first is that the
// villagers are actually DIFFERENT from each other -- the first pass shipped three clones of one
// rig tinted within a few percent of each other and standing within 12 cm in height, and the
// capture read as four identical old men. That is a data mistake, it is invisible in a diff, and it
// is exactly the kind of thing that quietly comes back when somebody adds a fourth villager.
//
// The second is that they stand somewhere sane: clear of the props, clear of the combat bowls, and
// clear of the circle a child spawns into.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { LOOK_SWING_RADIANS, lookOffset01 } from '../public/src/world/villagers.js';
import {
  MARKER_BOB_METERS,
  MARKER_LIFT_METERS,
  MARKER_SIZE_METERS,
  markerBob,
} from '../public/src/render/questMarker.js';
import { PROPS, SPAWNS, VILLAGERS } from '../public/src/world/zones/village.js';

const FOOTPRINT_RADIUS_METERS = {
  'house-cottage': 1.500, 'house-longhouse': 2.050, 'stall-green': 0.500, 'stall-bench': 0.470,
  'cart': 0.670, 'lantern': 0.112, 'fence': 0.500, 'fence-gate': 0.500, 'fence-broken': 0.500,
  'tree': 0.512, 'tree-crooked': 0.512, 'rock-small': 0.663, 'rock-large': 0.835, 'rock-wide': 0.784,
};
// A standing person, conservatively. Wider than a body so a villager never looks wedged into a wall.
const VILLAGER_RADIUS_METERS = 0.35;

test('the village is inhabited at all', () => {
  assert.ok(VILLAGERS.length >= 3,
    'fewer than three villagers and the place still reads as abandoned from the road');
});

test('no two villagers are the same person', () => {
  const heights = VILLAGERS.map((v) => v.heightMeters);
  const spread = Math.max(...heights) - Math.min(...heights);
  assert.ok(spread >= 0.2,
    `the tallest and shortest villager are ${spread.toFixed(2)} m apart -- at gameplay distance `
    + 'that is the same silhouette repeated');

  // Tints have to differ by something a screen can show. Compared channel-wise rather than as one
  // number, because 0xa0b0c0 and 0xc0b0a0 differ by a lot as integers and not at all in brightness.
  for (let i = 0; i < VILLAGERS.length; i += 1) {
    for (let j = i + 1; j < VILLAGERS.length; j += 1) {
      const a = VILLAGERS[i].tint;
      const b = VILLAGERS[j].tint;
      const apart = Math.abs((a >> 16 & 255) - (b >> 16 & 255))
        + Math.abs((a >> 8 & 255) - (b >> 8 & 255))
        + Math.abs((a & 255) - (b & 255));
      assert.ok(apart >= 40,
        `villagers ${i} and ${j} are tinted ${a.toString(16)} and ${b.toString(16)} -- `
        + `${apart}/765 apart, which is the same robe`);
    }
  }

  // ...and they must not breathe in unison, which is the tell that gives away a clone army even
  // when the colours are right.
  const phases = VILLAGERS.map((v) => v.phase01);
  assert.equal(new Set(phases).size, phases.length, 'two villagers share an animation phase');
});

test('every villager is looking at something, and it is a real place', () => {
  for (const villager of VILLAGERS) {
    assert.equal(villager.at.length, 2);
    assert.equal(villager.facing.length, 2);
    assert.ok([...villager.at, ...villager.facing].every(Number.isFinite));
    const span = Math.hypot(villager.facing[0] - villager.at[0], villager.facing[1] - villager.at[1]);
    assert.ok(span > 0.5,
      `a villager at [${villager.at}] is facing [${villager.facing}], which is where they already are`);
    assert.ok(villager.lookPeriodSeconds >= 6,
      'a villager who looks around faster than every six seconds reads as a turret');
  }
});

test('nobody is standing inside a market stall, a wall or a rock', () => {
  const offenders = [];
  for (const villager of VILLAGERS) {
    for (const prop of PROPS) {
      const name = prop.model.split('/').pop().replace('.glb', '');
      const radius = FOOTPRINT_RADIUS_METERS[name];
      assert.ok(radius != null, `no measured footprint radius for '${name}'`);
      const gap = Math.hypot(villager.at[0] - prop.at[0], villager.at[1] - prop.at[1])
        - radius * (prop.scale ?? 1) - VILLAGER_RADIUS_METERS;
      if (gap < 0.15) offenders.push(`villager at [${villager.at}] is ${gap.toFixed(2)} m from ${name}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('nobody is standing in a fight, or on top of the child at spawn', () => {
  const [heroX, heroZ] = SPAWNS.heroes;
  for (const villager of VILLAGERS) {
    assert.ok(Math.hypot(villager.at[0] - heroX, villager.at[1] - heroZ) > 1.5 + VILLAGER_RADIUS_METERS,
      `a villager at [${villager.at}] is standing in the hero's spawn circle`);
    for (const [wolfX, wolfZ] of SPAWNS.patrol) {
      const gap = Math.hypot(villager.at[0] - wolfX, villager.at[1] - wolfZ) - VILLAGER_RADIUS_METERS;
      assert.ok(gap >= 4,
        `a villager at [${villager.at}] is ${gap.toFixed(2)} m from the wolf spawn [${wolfX}, ${wolfZ}] `
        + '-- they would be standing in the fight');
    }
  }
});

// ── the behaviour, without a scene ───────────────────────────────────────────────────────────────

test('a villager looks one way, holds it, then looks the other way', () => {
  const PERIOD = 10;
  // A square wave: it must HOLD, not sweep. Sampled across a whole half-cycle.
  for (const t of [0.1, 1, 2, 3, 4, 4.9]) {
    assert.equal(lookOffset01(t, PERIOD), 1, `at ${t}s it should still be looking one way`);
  }
  for (const t of [5.1, 6, 7, 8, 9.9]) {
    assert.equal(lookOffset01(t, PERIOD), -1, `at ${t}s it should have looked back`);
  }
  assert.equal(lookOffset01(10.1, PERIOD), 1, 'the cycle should repeat');
});

test('two villagers on different phases are not looking the same way', () => {
  const PERIOD = 10;
  const apart = [0, 0.37].map((phase) => lookOffset01(2, PERIOD, phase));
  assert.notEqual(apart[0], apart[1], 'phase offsets are doing nothing');
});

test('a zero or negative look period stands still rather than dividing by zero', () => {
  assert.equal(lookOffset01(3, 0), 0);
  assert.equal(lookOffset01(3, -5), 0);
});

test('the look swing is a glance, not a spin', () => {
  assert.ok(LOOK_SWING_RADIANS > 0.2, 'too small to see');
  assert.ok(LOOK_SWING_RADIANS < Math.PI / 4, 'a villager who swings 45 degrees is doing a drill');
});

// ── the quest marker ─────────────────────────────────────────────────────────────────────────────

test('the marker floats clear of the head it belongs to and stays there', () => {
  // The Keeper is 1.65 m; the marker is drawn centred on its own position, so half of it hangs down.
  assert.ok(MARKER_LIFT_METERS - MARKER_SIZE_METERS / 2 - MARKER_BOB_METERS > 0.15,
    'at the bottom of its bob the marker overlaps the hood it is supposed to float above');
});

test('the bob is a bob', () => {
  const samples = Array.from({ length: 64 }, (_, i) => markerBob(i / 8));
  assert.ok(Math.max(...samples) > MARKER_BOB_METERS * 0.9, 'it never rises');
  assert.ok(Math.min(...samples) < -MARKER_BOB_METERS * 0.9, 'it never falls');
  for (const s of samples) {
    assert.ok(Math.abs(s) <= MARKER_BOB_METERS + 1e-9, 'the bob overshoots its own stated amplitude');
  }
  assert.equal(markerBob(0), 0, 'it should start at rest, not mid-air');
});
