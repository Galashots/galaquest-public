// G1: the Old Beacon approach and arrival.
//
// The interesting assertions in here are not "the maths works". They are the decisions that make
// this a place a child walks to rather than a prop beside the camp, each of which is easy to break
// by accident and none of which a screenshot can re-check on every commit:
//
//   1. The road actually GOES there, and the world is actually big enough to stand on when it does.
//   2. The Beacon is TALL enough to break the treeline and SHORT enough to stay inside a portrait
//      frame -- both derived from the follow camera, not chosen.
//   3. Its widest point is at the top, which is the one thing that stops it reading as a tree.
//   4. Nothing the game says at the Beacon promises a G2 action that does not exist.
//
// The objective ladder itself is pinned next door in test/dark-trail.test.mjs, beside the rest of
// the chip's states.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import * as THREE from '../public/vendor/three.module.min.js';
import {
  DEFAULT_DISTANCE, DEFAULT_PITCH,
} from '../public/src/camera/follow.js';
import { WORLD_LIMIT, WORLD_LIMIT_NORTH } from '../public/src/world/bounds.js';
import { groundBounds } from '../public/src/world/ground.js';
import { GATE_TOTAL_HEIGHT_METERS } from '../public/src/world/wildwoodGate.js';
import {
  BEACON_EMBER_COLD_COLOR,
  BEACON_GLOW_REST,
  BEACON_GLOW_STIR_PEAK,
  BEACON_IRON_COLOR,
  BEACON_SIGHT_HEIGHT_METERS,
  BEACON_STIR_SECONDS,
  BEACON_STONE_COLOR,
  BEACON_FIRE_TOP_METERS,
  BEACON_IGNITE_SECONDS,
  BEACON_TOTAL_HEIGHT_METERS,
  BEACON_TRIM_COLOR,
  FLAME_TIP_ABOVE_RIM_METERS,
  WAYSTONE_HEIGHT_METERS,
  beaconFlameBreath,
  beaconFlameParts,
  beaconFlameScale,
  beaconInFrame,
  beaconParts,
  beaconSight,
  beaconStirStrength,
  waystoneParts,
} from '../public/src/world/oldBeacon.js';
import {
  OBJECTIVE_BEACON_IS_COLD,
  OBJECTIVE_FIND_THE_BEACON,
} from '../public/src/world/quest.js';
import {
  ROWAN_LINE_BEACON_FOUND,
  ROWAN_LINE_CART_SEARCHED,
  ROWAN_LINE_INTRO,
  rowanLineFor,
  rowanSpeechState,
} from '../public/src/world/rowanSpeech.js';
import { BEACON_ARRIVAL_RECIPE_NAME, DIRECTLY_PLAYED_RECIPES, RECIPES } from '../public/src/audio/recipes.js';
import {
  BEACON_ROAD_LIGHTS,
  BEACON_WAYSTONES,
  CAMP,
  LANDMARKS,
  OLD_BEACON,
  PROPS,
  ROAD,
  ZONE,
} from '../public/src/world/zones/village.js';
import { WAKE_RADIUS_METERS } from '../public/src/world/trail.js';

// The same conservative circular half-extents test/zone-data.test.mjs measures against
// (tools/budget/measure_props.mjs, the shipped 1x-scale GLBs). Restated here rather than imported
// because that file declares them as a local const; the duplication is deliberate and bounded, and
// the check just below is what keeps the two from drifting into disagreement.
const FOOTPRINT_RADIUS_METERS = {
  'house-cottage': 1.500, 'house-longhouse': 2.050, 'stall-green': 0.500, 'stall-bench': 0.470,
  cart: 0.670, lantern: 0.112, fence: 0.500, 'fence-gate': 0.500, 'fence-broken': 0.500,
  tree: 0.512, 'tree-crooked': 0.512, 'rock-small': 0.663, 'rock-large': 0.835, 'rock-wide': 0.784,
};
const TREE_RAW_HEIGHT_METERS = 2.413;

function footprintRadius(placement) {
  if ('height' in placement) return (placement.height ?? 1) / 2;
  const name = placement.model.split('/').pop().replace('.glb', '');
  const radius = FOOTPRINT_RADIUS_METERS[name];
  if (radius == null) throw new Error(`no measured footprint radius for '${name}'`);
  return radius * (placement.scale ?? 1);
}

function distanceToSegment(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
// EVERY POLYLINE THE ROAD IS MADE OF, not just its spine.
//
// This walked ROAD.points alone, which was the whole road for three chapters and stopped being it
// the moment Arc 2 forked east to the Ranger Lodge (ROAD.branches). A guard that only knows the
// spine cannot see a rock standing in the middle of the new road -- and did not: moving the Lodge's
// forecourt south put one squarely on it and this file reported no offenders at all.
//
// Kept as a local walk rather than calling ground.js's distanceToRoadNetwork on purpose. This is a
// guard, and a guard that shares its implementation with the thing it guards proves only that they
// agree. The segment maths below is the independent second opinion; what it now shares with the
// game is the DATA, which is the part that must not drift.
function distanceToRoad(x, z) {
  let min = Infinity;
  for (const line of [ROAD.points, ...(ROAD.branches ?? []).map((branch) => branch.points)]) {
    for (let i = 0; i < line.length - 1; i += 1) {
      min = Math.min(min, distanceToSegment(x, z, line[i], line[i + 1]));
    }
  }
  return min;
}
/** Everything G1 added: north of the camp's own trigger, which is where the new stretch starts. */
const NEW_PLACEMENTS = PROPS.filter((prop) => prop.at[1] > CAMP.at[1] + CAMP.radiusMeters);

// ── the road actually goes there ────────────────────────────────────────────────────────────────

test('the road reaches the Beacon rather than stopping in a field short of it', () => {
  const end = ROAD.points[ROAD.points.length - 1];
  const gap = Math.hypot(end[0] - OLD_BEACON.at[0], end[1] - OLD_BEACON.at[1]);
  assert.ok(gap <= 2.5, `the road ends ${gap.toFixed(2)} m from the Beacon`);
  assert.ok(
    distanceToRoad(OLD_BEACON.at[0], OLD_BEACON.at[1]) <= ROAD.widthMeters / 2,
    'the Beacon has to stand ON the road it terminates, not beside it',
  );
});

// The whole point of G1 is that the child TRAVELS. A Beacon within a few strides of the cart would
// satisfy every other check in this file and fail the brief completely.
test('the Beacon is a real walk from the camp, and a short one', () => {
  const walk = Math.hypot(OLD_BEACON.at[0] - CAMP.at[0], OLD_BEACON.at[1] - CAMP.at[1]);
  assert.ok(walk >= 12, `only ${walk.toFixed(1)} m from the camp -- that is a prop, not a destination`);
  assert.ok(walk <= 26, `${walk.toFixed(1)} m is a long empty run, not a dense stretch`);
});

test('the world grew enough to stand at the Beacon and walk past it', () => {
  const bounds = groundBounds(ZONE);
  assert.ok(
    OLD_BEACON.at[1] + OLD_BEACON.radiusMeters < WORLD_LIMIT_NORTH,
    `the arrival radius reaches z ${(OLD_BEACON.at[1] + OLD_BEACON.radiusMeters).toFixed(1)}, `
    + `past the clamp at ${WORLD_LIMIT_NORTH}`,
  );
  assert.ok(
    WORLD_LIMIT_NORTH - OLD_BEACON.at[1] >= 3,
    'a child who walks past the Beacon must have somewhere to walk to',
  );
  assert.ok(WORLD_LIMIT_NORTH < bounds.maxZ, 'the clamp still has to sit inside the ground mesh');
});

// The defect this whole slice exists to remove, stated as a property: the far end of the world has
// to be closed by WOOD, not by the ground running out. Two rows behind the Beacon, spanning it.
test('the wood closes behind the Beacon instead of the ground simply ending', () => {
  const behind = NEW_PLACEMENTS.filter((prop) => prop.at[1] > OLD_BEACON.at[1] + 2 && /tree/.test(prop.model));
  assert.ok(behind.length >= 8, `only ${behind.length} trees stand behind the Beacon`);
  const spanEast = behind.filter((prop) => prop.at[0] > OLD_BEACON.at[0]).length;
  const spanWest = behind.filter((prop) => prop.at[0] < OLD_BEACON.at[0]).length;
  assert.ok(spanEast >= 2 && spanWest >= 2, `back stand is lopsided: ${spanWest} west, ${spanEast} east`);
  const furthest = Math.max(...behind.map((prop) => prop.at[1]));
  assert.ok(
    furthest >= WORLD_LIMIT_NORTH,
    `the furthest tree is at z ${furthest}, inside the clamp at ${WORLD_LIMIT_NORTH} -- `
    + 'a child could walk past the whole wood and stand in open grass at the edge',
  );
});

// ── every new placement is somewhere legal ──────────────────────────────────────────────────────

test('every new placement\'s BODY sits inside the ground plane', () => {
  const bounds = groundBounds(ZONE);
  const offenders = NEW_PLACEMENTS.filter((placement) => {
    const [x, z] = placement.at;
    const r = footprintRadius(placement);
    return Math.abs(x) + r > bounds.maxX || z + r > bounds.maxZ;
  });
  assert.deepEqual(offenders, []);
});

test('no new placement\'s BODY stands on the road surface', () => {
  const halfWidth = ROAD.widthMeters / 2;
  const offenders = NEW_PLACEMENTS.filter(
    (placement) => distanceToRoad(placement.at[0], placement.at[1]) - footprintRadius(placement) < halfWidth,
  );
  assert.deepEqual(offenders, [], 'a tree in the road is a tree a child walks through');
});

test('no new placement\'s BODY stands inside the Beacon\'s own arrival radius', () => {
  const offenders = NEW_PLACEMENTS.filter((placement) => {
    const [x, z] = placement.at;
    return Math.hypot(x - OLD_BEACON.at[0], z - OLD_BEACON.at[1]) - footprintRadius(placement)
      < OLD_BEACON.radiusMeters;
  });
  assert.deepEqual(offenders, [], 'arriving inside a tree is not arriving');
});

test('no two new placements overlap each other', () => {
  const all = [...PROPS, ...LANDMARKS];
  const offenders = [];
  for (const placement of NEW_PLACEMENTS) {
    for (const other of all) {
      if (other === placement) continue;
      const gap = Math.hypot(placement.at[0] - other.at[0], placement.at[1] - other.at[1])
        - footprintRadius(placement) - footprintRadius(other);
      if (gap < 0.5) offenders.push([placement.at, other.at, +gap.toFixed(2)]);
    }
  }
  assert.deepEqual(offenders, []);
});

// Sabotage-verify: the checks above are proven able to fail, not merely observed to pass once.
test('sabotage: the road-surface check DOES fail against a tree planted in the new road', () => {
  const inTheRoad = { model: 'props/village/tree.glb', at: ROAD.points[ROAD.points.length - 2] };
  assert.ok(
    distanceToRoad(inTheRoad.at[0], inTheRoad.at[1]) - footprintRadius(inTheRoad) < ROAD.widthMeters / 2,
  );
});

// ── the lamps that lead you there ───────────────────────────────────────────────────────────────

test('the Beacon road lamps continue the trail\'s own chain rather than inventing a spacing', () => {
  const NEAREST_THAT_STILL_READS_METERS = 9;
  const chain = [CAMP.at, ...BEACON_ROAD_LIGHTS];
  for (let i = 1; i < chain.length; i += 1) {
    const gap = Math.hypot(chain[i][0] - chain[i - 1][0], chain[i][1] - chain[i - 1][1]);
    assert.ok(gap > WAKE_RADIUS_METERS, `lamps ${i} and ${i + 1} are ${gap.toFixed(2)} m apart -- one wakes the other`);
    assert.ok(gap <= NEAREST_THAT_STILL_READS_METERS,
      `lamps ${i} and ${i + 1} are ${gap.toFixed(2)} m apart -- too far to follow`);
  }
});

test('every Beacon road lamp stands beside the road, not in it and not lost in the wood', () => {
  for (const [x, z] of BEACON_ROAD_LIGHTS) {
    const offset = distanceToRoad(x, z);
    assert.ok(offset >= ROAD.widthMeters / 2, `a lamp ${offset.toFixed(2)} m from the centreline is in the road`);
    assert.ok(offset <= 3.0, `a lamp ${offset.toFixed(2)} m off the centreline no longer lights the path`);
  }
});

// THE OLD LIGHTS DO NOT REACH THE BEACON, and this is the check that keeps it that way. A lamp
// inside the arrival radius fires its relight chime on the same frame as the arrival banner and the
// arrival sound -- three one-time beats stacked on one frame, which is how a payoff becomes noise.
// Found by walking the road with a third lamp on it, not by reading the numbers.
test('no Beacon road lamp stands inside the arrival radius, and the last one is still in sight of it', () => {
  for (const [x, z] of BEACON_ROAD_LIGHTS) {
    const gap = Math.hypot(x - OLD_BEACON.at[0], z - OLD_BEACON.at[1]);
    assert.ok(
      gap > OLD_BEACON.radiusMeters,
      `a lamp ${gap.toFixed(2)} m out is inside the ${OLD_BEACON.radiusMeters} m arrival radius`,
    );
  }
  const last = BEACON_ROAD_LIGHTS[BEACON_ROAD_LIGHTS.length - 1];
  const gap = Math.hypot(last[0] - OLD_BEACON.at[0], last[1] - OLD_BEACON.at[1]);
  assert.ok(gap <= 9, `the warm chain stops ${gap.toFixed(2)} m out, too far to still be leading anywhere`);
});

// ── the waystones ───────────────────────────────────────────────────────────────────────────────

test('the waystones stand clear of the road and of every prop body', () => {
  const WAYSTONE_RADIUS_METERS = 0.45;
  for (const stone of BEACON_WAYSTONES) {
    const [x, z] = stone.at;
    assert.ok(
      distanceToRoad(x, z) - WAYSTONE_RADIUS_METERS >= ROAD.widthMeters / 2,
      `a waystone ${distanceToRoad(x, z).toFixed(2)} m from the centreline stands in the road`,
    );
    for (const prop of PROPS) {
      const gap = Math.hypot(x - prop.at[0], z - prop.at[1]) - WAYSTONE_RADIUS_METERS - footprintRadius(prop);
      assert.ok(gap >= 0.4, `a waystone is ${gap.toFixed(2)} m from ${prop.model} at ${prop.at}`);
    }
  }
});

test('one waystone marks the way out of the camp and one marks the bend, not two in the same place', () => {
  assert.equal(BEACON_WAYSTONES.length, 2);
  const [first, second] = BEACON_WAYSTONES;
  assert.ok(first.at[1] < second.at[1], 'the first one has to be the one a child reaches first');
  assert.ok(
    Math.hypot(second.at[0] - first.at[0], second.at[1] - first.at[1]) >= 4,
    'two markers within a few strides of each other mark nothing',
  );
  // Short enough that it can never be mistaken for the Beacon at distance, tall enough to be a thing.
  assert.ok(WAYSTONE_HEIGHT_METERS > 1.48, 'a waystone below hero height reads as a rock');
  assert.ok(WAYSTONE_HEIGHT_METERS < BEACON_TOTAL_HEIGHT_METERS / 3);
});

// ── the Beacon's own shape ──────────────────────────────────────────────────────────────────────

// Cross-checked through a genuinely separate code path (summing the parts' own extents) rather than
// re-reading the constant the builder used -- docs/MISTAKES.md, "a cross-check whose expected and
// actual values come from the same expression proves nothing".
test('BEACON_TOTAL_HEIGHT_METERS really is the top of the built stack', () => {
  const { parts } = beaconParts();
  const top = Math.max(...parts
    .filter((part) => part.name !== 'brace' && part.name !== 'fallen' && part.name !== 'step')
    .map((part) => part.at[1] + (part.kind === 'box' ? part.size[1] : part.height) / 2));
  assert.ok(Math.abs(top - BEACON_TOTAL_HEIGHT_METERS) < 1e-9,
    `parts reach ${top}, constant says ${BEACON_TOTAL_HEIGHT_METERS}`);
});

// THE NUMBER WITH A REASON, AND THE MARGIN IT NEEDS. The follow camera sits DEFAULT_DISTANCE back
// at DEFAULT_PITCH and the vertical FOV is 42 degrees, so a tall object's top projects at a
// computable ndcY and is off-screen past 1. The Beacon was FIRST BUILT at 6.4 m, which projects at
// ndcY 0.991 in the worst case -- inside the frame by arithmetic, and sliced off the top edge in the
// actual arrival capture, because 0.9% of half a frame is not a budget.
//
// So this pins the HEADROOM rather than the height: a future Beacon (or any other landmark that
// tries to be impressive by being taller) has to keep a tenth of the frame in hand, and fails here
// rather than in a screenshot somebody may or may not open.
const CAMERA_FOV_DEGREES = 42;
const CAMERA_BACK_METERS = Math.cos(DEFAULT_PITCH) * DEFAULT_DISTANCE;
const CAMERA_HEIGHT_METERS = Math.sin(DEFAULT_PITCH) * DEFAULT_DISTANCE + 0.7;

/** Where a point `height` metres up and `distance` metres away lands vertically in the frame:
 *  -1 is the bottom edge, +1 the top, and anything past 1 is cropped. */
function ndcYOfTop(height, distance) {
  const half = (CAMERA_FOV_DEGREES / 2) * (Math.PI / 180);
  return Math.tan(Math.atan((height - CAMERA_HEIGHT_METERS) / distance) + DEFAULT_PITCH) / Math.tan(half);
}

test('the whole Beacon fits a portrait frame with real headroom, from anywhere a child can stand', () => {
  // Worst case: the hero is standing ON the Beacon, so the camera is exactly its trailing distance
  // away and nothing is further up the screen than this.
  const worst = ndcYOfTop(BEACON_TOTAL_HEIGHT_METERS, CAMERA_BACK_METERS);
  assert.ok(worst <= 0.95,
    `standing at its base the top projects at ndcY ${worst.toFixed(3)} -- too close to the edge to `
    + 'survive the hero\'s own footing, and 0.991 is what actually got cropped');
  // And at the moment of arrival, which is the frame the banner appears over.
  const onArrival = ndcYOfTop(BEACON_TOTAL_HEIGHT_METERS, CAMERA_BACK_METERS + OLD_BEACON.radiusMeters * 0.8);
  assert.ok(onArrival <= 0.93, `the arrival frame crops at ndcY ${onArrival.toFixed(3)}`);
});

// Sabotage-verify: the headroom check is proven to reject the height that actually got cropped.
test('sabotage: the headroom check DOES fail against the 6.4 m first version', () => {
  assert.ok(ndcYOfTop(6.4, CAMERA_BACK_METERS) > 0.95);
});

test('the Beacon is the tallest thing in the world, so it breaks the treeline it stands in', () => {
  const tallestTree = Math.max(...PROPS
    .filter((prop) => /tree/.test(prop.model))
    .map((prop) => TREE_RAW_HEIGHT_METERS * (prop.scale ?? 1)));
  const tallestLandmark = Math.max(...LANDMARKS.map((landmark) => landmark.height ?? 0));
  assert.ok(BEACON_TOTAL_HEIGHT_METERS > tallestTree * 1.5,
    `${BEACON_TOTAL_HEIGHT_METERS} m against a ${tallestTree.toFixed(2)} m tree is not a landmark`);
  assert.ok(BEACON_TOTAL_HEIGHT_METERS > tallestLandmark, 'and it outranks the Lantern Tree');
  assert.ok(BEACON_TOTAL_HEIGHT_METERS > GATE_TOTAL_HEIGHT_METERS, 'and the Wildwood Gate');
});

// REFERENCE RULE 2, the one thing that stops a tower reading as a tree: a tree is widest at the
// bottom and tapers up, a cresset beacon does the opposite. Break this and the silhouette merges
// into the wood at exactly the distance it is supposed to separate at.
test('the widest point above the plinth is the cresset at the very top', () => {
  const { parts } = beaconParts();
  const widthOf = (part) => (part.kind === 'box'
    ? Math.max(part.size[0], part.size[2])
    : Math.max(part.radiusTop, part.radiusBottom) * 2);
  const cresset = parts.find((part) => part.name === 'cresset');
  const tower = parts.filter((part) => !['plinth', 'step', 'fallen', 'brace'].includes(part.name));
  for (const part of tower) {
    if (part === cresset) continue;
    assert.ok(widthOf(part) < widthOf(cresset),
      `'${part.name}' is ${widthOf(part).toFixed(2)} m wide against the cresset's ${widthOf(cresset).toFixed(2)}`);
  }
  assert.ok(cresset.at[1] > BEACON_TOTAL_HEIGHT_METERS * 0.8, 'and it has to be at the TOP, not two thirds up');
  assert.equal(cresset.openEnded, true, 'a capped cresset is a cup, not a fire basket');
});

test('the sight probe aims at the cresset, which is the part that is visible over the trees', () => {
  assert.ok(BEACON_SIGHT_HEIGHT_METERS > BEACON_TOTAL_HEIGHT_METERS * 0.8);
  assert.ok(BEACON_SIGHT_HEIGHT_METERS < BEACON_TOTAL_HEIGHT_METERS);
});

// Colour separation, the same distance check test/wildwood-blade.test.mjs makes for the blade: two
// tones read as two materials only if they disagree by more than a shade.
test('the Beacon\'s stone is measurably not the meadow, not the gate\'s timber, and not its own iron', () => {
  const distance = (a, b) => {
    const ca = new THREE.Color(a);
    const cb = new THREE.Color(b);
    return Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b);
  };
  const GRASS = 0x8fb583;
  assert.ok(distance(BEACON_STONE_COLOR, GRASS) > 0.12, 'the tower must not sink into the field');
  assert.ok(distance(BEACON_STONE_COLOR, 0xb87758) > 0.2, 'nor read as the same stuff as the gate');
  assert.ok(distance(BEACON_STONE_COLOR, BEACON_IRON_COLOR) > 0.3, 'the basket has to read as iron');
  assert.ok(distance(BEACON_STONE_COLOR, BEACON_TRIM_COLOR) > 0.15, 'the accent band has to be an accent');
  // Dead fire is cold. If the embers ever warm up they start promising a fire that is not built.
  const ember = new THREE.Color(BEACON_EMBER_COLD_COLOR);
  assert.ok(ember.b > ember.r, 'the dead embers must stay cooler than they are warm');
});

// ── seeing it before you touch it ───────────────────────────────────────────────────────────────

test('beaconInFrame rejects a point behind the camera, which is the case a naive version passes', () => {
  assert.equal(beaconInFrame({ ndcX: 0, ndcY: 0, ndcZ: 0.5 }), true);
  assert.equal(beaconInFrame({ ndcX: 0, ndcY: 0, ndcZ: 1.4 }), false, 'past the far plane');
  assert.equal(beaconInFrame({ ndcX: 0, ndcY: 0, ndcZ: -1.2 }), false, 'behind the near plane');
  assert.equal(beaconInFrame({ ndcX: 1.6, ndcY: 0, ndcZ: 0.5 }), false, 'off the side');
  assert.equal(beaconInFrame({ ndcX: 0, ndcY: -1.4, ndcZ: 0.5 }), false, 'off the bottom');
});

// The G1 promise, checked against a real camera rather than against arithmetic about one: a child
// standing at Rowan's camp can SEE the Beacon, and a child standing at the village cannot.
/** A follow camera parked behind a hero at (x, z) who is facing (towardX, towardZ) -- the real
 *  DEFAULT_DISTANCE/DEFAULT_PITCH geometry, so this is the frame a child actually gets, not an
 *  idealised one. */
function followCameraLooking(fromX, fromZ, towardX, towardZ, aspect = 768 / 1024) {
  const camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 100);
  const heading = Math.atan2(towardX - fromX, towardZ - fromZ);
  const back = Math.cos(DEFAULT_PITCH) * DEFAULT_DISTANCE;
  const up = Math.sin(DEFAULT_PITCH) * DEFAULT_DISTANCE;
  camera.position.set(fromX - Math.sin(heading) * back, up + 0.7, fromZ - Math.cos(heading) * back);
  camera.lookAt(fromX, 0.7, fromZ);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

test('the Beacon is on screen from the camp, in portrait, before the walk starts', () => {
  const camera = followCameraLooking(CAMP.at[0], CAMP.at[1], OLD_BEACON.at[0], OLD_BEACON.at[1]);
  const sight = beaconSight(camera, OLD_BEACON.at, { x: CAMP.at[0], z: CAMP.at[1] });
  assert.equal(sight.onScreen, true,
    `not visible from the camp: ndc [${sight.ndcX.toFixed(2)}, ${sight.ndcY.toFixed(2)}]`);
  assert.ok(sight.metersFromHero > 12, 'and it has to be genuinely far off when it is');
  // Portrait's horizontal FOV is the tight one (32 degrees against landscape's 54), so a route that
  // reads in landscape and not in portrait would pass a landscape-only version of this check.
  const landscape = followCameraLooking(CAMP.at[0], CAMP.at[1], OLD_BEACON.at[0], OLD_BEACON.at[1], 1024 / 768);
  assert.equal(beaconSight(landscape, OLD_BEACON.at, { x: CAMP.at[0], z: CAMP.at[1] }).onScreen, true);
});

// It stays visible for the WHOLE walk, not just from the two ends -- the failure this catches is a
// route whose middle swings the destination off the side of a portrait screen, which is exactly what
// a more scenic S-curve would have done.
test('the Beacon stays on screen from every point along the road it is at the end of', () => {
  const newLegs = ROAD.points.filter(([, z]) => z > CAMP.at[1]);
  for (let i = 0; i < newLegs.length - 1; i += 1) {
    const [x, z] = newLegs[i];
    const [aheadX, aheadZ] = newLegs[i + 1];
    const camera = followCameraLooking(x, z, aheadX, aheadZ);
    const sight = beaconSight(camera, OLD_BEACON.at, { x, z });
    assert.equal(sight.onScreen, true,
      `walking from [${x}, ${z}] toward [${aheadX}, ${aheadZ}] loses the Beacon: `
      + `ndc [${sight.ndcX.toFixed(2)}, ${sight.ndcY.toFixed(2)}]`);
  }
});

// And a child in the village must not be able to see the end of Chapter 2 from the plaza.
test('the Beacon is far enough from the village to be a later chapter, not a skyline', () => {
  const camera = followCameraLooking(0, 0, OLD_BEACON.at[0], OLD_BEACON.at[1]);
  const sight = beaconSight(camera, OLD_BEACON.at, { x: 0, z: 0 });
  assert.ok(sight.metersFromHero > 45,
    `${sight.metersFromHero.toFixed(1)} m from spawn is not far enough to be a later chapter`);
});

// Sabotage-verify: the sight check is proven able to say NO, not merely observed to say yes.
test('sabotage: the sight check DOES fail for a child who has turned their back on the road', () => {
  const camera = followCameraLooking(CAMP.at[0], CAMP.at[1], CAMP.at[0], CAMP.at[1] - 10);
  assert.equal(beaconSight(camera, OLD_BEACON.at, { x: CAMP.at[0], z: CAMP.at[1] }).onScreen, false);
});

// ── the arrival, and what it is allowed to say ──────────────────────────────────────────────────

test('the stir rises, falls, and puts the Beacon back to cold', () => {
  assert.equal(beaconStirStrength(-1), BEACON_GLOW_REST, 'before it starts');
  assert.equal(beaconStirStrength(0), BEACON_GLOW_REST, 'and it begins from rest');
  let peak = 0;
  let peakAt = 0;
  for (let t = 0; t <= BEACON_STIR_SECONDS; t += 0.01) {
    const strength = beaconStirStrength(t);
    assert.ok(strength >= BEACON_GLOW_REST - 1e-9, `dipped below rest at ${t.toFixed(2)}s`);
    if (strength > peak) { peak = strength; peakAt = t; }
  }
  assert.ok(Math.abs(peak - BEACON_GLOW_STIR_PEAK) < 1e-9, `peaked at ${peak}`);
  // Up fast, down slow -- the shape of something failing to catch, not of something igniting.
  assert.ok(peakAt < BEACON_STIR_SECONDS * 0.4, `peaked at ${peakAt.toFixed(2)}s, too late to read as a flare`);
  assert.equal(beaconStirStrength(BEACON_STIR_SECONDS), BEACON_GLOW_REST, 'and it has to end at cold');
  assert.equal(beaconStirStrength(BEACON_STIR_SECONDS + 5), BEACON_GLOW_REST, 'and stay there');
});

// Sabotage-verify: a curve that is secretly a constant would pass every bound above.
test('sabotage: the stir is not a constant -- it really moves', () => {
  assert.notEqual(beaconStirStrength(BEACON_STIR_SECONDS * 0.25), beaconStirStrength(BEACON_STIR_SECONDS * 0.75));
});

// Even at its brightest the Beacon must not look like it worked. G2 owns lighting it.
test('the stir never reaches a strength that could read as "the Beacon is lit"', () => {
  const GATE_LAMP_LIT_STRENGTH = 0.9;
  assert.ok(BEACON_GLOW_STIR_PEAK < GATE_LAMP_LIT_STRENGTH);
  assert.ok(BEACON_GLOW_REST < BEACON_GLOW_STIR_PEAK);
});

// The reduced-motion path is a branch in the PRESENTER (which needs a canvas), so it is proven in
// the running game by tools/runtime-test/drive-old-beacon.mjs's own reduced-motion phase rather than
// here. What this file can pin is the half that matters if that branch is ever removed: suppressing
// the stir leaves the Beacon in its real state rather than in a half-lit one.
test('the state a suppressed stir leaves behind is the Beacon\'s real, cold one', () => {
  assert.equal(beaconStirStrength(-1), BEACON_GLOW_REST);
  assert.equal(beaconStirStrength(Number.NaN), BEACON_GLOW_REST);
});

// ── what the game SAYS at the end of G1 ─────────────────────────────────────────────────────────

test('nothing G1 says at the Beacon names an action the game has not built', () => {
  const PROMISES = /(light it|wake the|relight|repair|defend|fight|guard the)/i;
  assert.doesNotMatch(OBJECTIVE_BEACON_IS_COLD, PROMISES);
  assert.doesNotMatch(ROWAN_LINE_BEACON_FOUND, PROMISES);
  // The one place a promise IS allowed is Rowan's locked intro prose, where it is a character's hope
  // rather than the game's instruction -- and that line is untouched by G1.
  assert.match(ROWAN_LINE_INTRO, /Wake the Beacon/);
});

test('the objective chip names the destination on the way and asks a question once you are there', () => {
  assert.match(OBJECTIVE_FIND_THE_BEACON, /Beacon/);
  assert.match(OBJECTIVE_BEACON_IS_COLD, /Beacon/);
  assert.notEqual(OBJECTIVE_FIND_THE_BEACON, OBJECTIVE_BEACON_IS_COLD);
  // Every objective in this game leads with a symbol, because it reads before it is read.
  for (const line of [OBJECTIVE_FIND_THE_BEACON, OBJECTIVE_BEACON_IS_COLD]) {
    assert.doesNotMatch(line[0], /[A-Za-z]/, `'${line}' has to lead with its symbol`);
    assert.ok(line.split(' ').length <= 6, `'${line}' is too long to read at a glance`);
  }
});

// GQ-002, applied to a line rather than to a file header: Rowan used to say "The Beacon must wait
// for now", which was true exactly as long as there was no road. It is the road's own commit that
// has to fix it.
test('Rowan stops saying the Beacon must wait, and starts giving directions', () => {
  assert.doesNotMatch(ROWAN_LINE_CART_SEARCHED, /must wait/i);
  assert.match(ROWAN_LINE_CART_SEARCHED, /north/i, 'a direction is the one thing this line owes a child');
  assert.equal(rowanLineFor(false, false), ROWAN_LINE_INTRO);
  assert.equal(rowanLineFor(true, false), ROWAN_LINE_CART_SEARCHED);
  assert.equal(rowanLineFor(true, true), ROWAN_LINE_BEACON_FOUND);
  // Finding the Beacon outranks the cart, the same "arriving beats collecting" rule the chip follows.
  assert.equal(rowanLineFor(false, true), ROWAN_LINE_BEACON_FOUND);
});

test('rowanSpeechState still only speaks in range, and carries the new state through', () => {
  const base = { heroX: 0, heroZ: 0, rowanX: 0, rowanZ: 0, radiusMeters: 2, cartSearched: true };
  assert.deepEqual(
    rowanSpeechState({ ...base, beaconFound: true }),
    { visible: true, line: ROWAN_LINE_BEACON_FOUND },
  );
  assert.deepEqual(
    rowanSpeechState({ ...base, heroZ: 9, beaconFound: true }),
    { visible: false, line: null },
  );
  // Every existing caller passes no beaconFound at all and must keep the old answer.
  assert.deepEqual(rowanSpeechState(base), { visible: true, line: ROWAN_LINE_CART_SEARCHED });
});

// ── the sound of arriving ───────────────────────────────────────────────────────────────────────

// Written as the OPPOSITE of victory-sting on purpose (see the recipe's own comment): those are the
// two sounds this moment could be confused between, and it must never be the first one.
test('the arrival sound is unresolved, and is not the victory sting wearing a different name', () => {
  const recipe = RECIPES[BEACON_ARRIVAL_RECIPE_NAME];
  assert.ok(Array.isArray(recipe) && recipe.length > 0);
  assert.ok(DIRECTLY_PLAYED_RECIPES.includes(BEACON_ARRIVAL_RECIPE_NAME),
    'a recipe nothing declares is a recipe the unused-recipe check cannot see');
  const pitches = recipe.filter((step) => step.type === 'tone').map((step) => step.frequencyStart);
  // NO THIRD ANYWHERE. A third is the interval that makes a chord major or minor -- happy or sad --
  // and this arrival is allowed to be neither. Every pair here has to be a unison, a fourth, a fifth
  // or an octave, which is what leaves it hanging.
  const interval = (a, b) => Math.abs(Math.round(12 * Math.log2(Math.max(a, b) / Math.min(a, b)))) % 12;
  for (let i = 0; i < pitches.length; i += 1) {
    for (let j = i + 1; j < pitches.length; j += 1) {
      const semitones = interval(pitches[i], pitches[j]);
      assert.ok([0, 5, 7].includes(semitones),
        `${pitches[i]} against ${pitches[j]} is ${semitones} semitones -- that resolves`);
    }
  }
  assert.equal(interval(Math.min(...pitches), Math.max(...pitches)), 7, 'the stack has to top out on a fifth');
  const victory = RECIPES['victory-sting'];
  assert.ok(
    Math.max(...recipe.map((s) => s.gainPeak)) < Math.max(...victory.map((s) => s.gainPeak)),
    'and arriving somewhere must be quieter than winning something',
  );
});

// ── waystone parts ──────────────────────────────────────────────────────────────────────────────

test('WAYSTONE_HEIGHT_METERS really is the top of the waystone stack', () => {
  const top = Math.max(...waystoneParts().map((part) => part.at[1] + part.height / 2));
  assert.ok(Math.abs(top - WAYSTONE_HEIGHT_METERS) < 1e-9, `parts reach ${top}`);
});

test('the waystones are made of the Beacon\'s own stone, which is what makes them a clue', () => {
  const colours = new Set(waystoneParts().map((part) => part.color));
  assert.ok(colours.has(BEACON_STONE_COLOR));
  assert.ok(colours.has(BEACON_TRIM_COLOR));
});

// ── nothing G1 did broke the world's own southern half ──────────────────────────────────────────

test('growing the world north left the village\'s own limits alone', () => {
  assert.equal(WORLD_LIMIT, ZONE.size / 2 - 1);
  assert.ok(WORLD_LIMIT_NORTH > WORLD_LIMIT);
  assert.deepEqual([...CAMP.at], [3.5, 33.1], 'the camp did not move');
});


// ── THE FIRE HAS TO CLEAR THE BASKET ───────────────────────────────────────────────────────────
//
// These exist because the Beacon shipped "lit" and a screenshot of the winning moment showed a black
// bowl. Everything the code said was true -- isLit(), the warm ember colour, the halo at 1.15 -- and
// none of it was visible, because the ash sits 0.17 m below a rim 1.14 m wide and the child is
// underneath it. That is the whole class of defect this file's own header calls "a number, not a
// matrix", so it is pinned as a number here rather than re-discovered in another capture.

test('the flame clears the cresset rim, which is the only reason it exists', () => {
  assert.ok(FLAME_TIP_ABOVE_RIM_METERS > 0.5,
    `the flame's tip must stand clear of the rim a child is looking up at, not peek over it; `
    + `it stands ${FLAME_TIP_ABOVE_RIM_METERS.toFixed(2)} m above`);
  assert.ok(BEACON_FIRE_TOP_METERS > BEACON_TOTAL_HEIGHT_METERS,
    'a lit Beacon must be TALLER than a cold one -- the fire is part of the silhouette');
});

test('the flame is three broad value planes, not one cone with stripes', () => {
  const parts = beaconFlameParts();
  assert.equal(parts.length, 3);
  const colours = new Set(parts.map((part) => part.color));
  assert.equal(colours.size, 3, 'amber, gold and near-white -- see GALAQUEST_VISUAL_AUTHORITY');
  // Every tongue is a cone (radiusTop 0): a flame that ends flat reads as a chimney.
  for (const part of parts) assert.equal(part.radiusTop, 0, `${part.name} must taper to a point`);
  // ...and each is narrower and taller than the one it grows out of, so the shape reads as a fire
  // rather than as three lumps.
  for (let i = 1; i < parts.length; i += 1) {
    assert.ok(parts[i].radiusBottom < parts[i - 1].radiusBottom, 'each tongue is narrower');
    assert.ok(parts[i].height > parts[i - 1].height, 'each tongue is taller');
  }
});

test('the flame starts at nothing, flares as it catches, and settles at exactly full', () => {
  assert.equal(beaconFlameScale(-1), 0, 'a cold Beacon has no fire on it at all');
  assert.equal(beaconFlameScale(0), 0);
  assert.equal(beaconFlameScale(BEACON_IGNITE_SECONDS), 1);
  assert.equal(beaconFlameScale(BEACON_IGNITE_SECONDS * 10), 1, 'and it stays -- the world remembers');
  const peak = Math.max(...Array.from({ length: 97 }, (_, i) => beaconFlameScale((i / 96) * BEACON_IGNITE_SECONDS)));
  assert.ok(peak > 1.02, 'a fire that CATCHES flares past its resting height on the way up');
  assert.ok(peak < 1.3, 'flares, does not explode');
});

test('the flame breathes rather than strobing, and conserves its own volume', () => {
  const samples = Array.from({ length: 400 }, (_, i) => beaconFlameBreath(i / 40));
  const rises = samples.map((s) => s.rise);
  assert.ok(Math.max(...rises) < 1.09 && Math.min(...rises) > 0.91, 'a gentle breath, not a flicker');
  // Rise and width move in opposite directions: a flame that got taller AND fatter would read as
  // the whole object being scaled, which is a zoom, not a fire.
  for (const sample of samples) {
    assert.ok((sample.rise - 1) * (sample.width - 1) <= 1e-12,
      'taller means narrower -- the flame is drawn up, not inflated');
  }
  // Deterministic, and therefore reproducible in a capture: no Math.random anywhere in it.
  assert.deepEqual(beaconFlameBreath(3.25), beaconFlameBreath(3.25));
});
