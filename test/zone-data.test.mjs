import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as VILLAGE from '../public/src/world/zones/village.js';

// V2: public/src/world/zones/ is PURE DATA, enforced the same way test/combat-purity.test.mjs
// enforces it for public/src/combat/ -- no three.js, no loader, not even a relative import of a
// sibling data file. A zone module that cannot import anything can be hand-tuned by reading it
// alone, which is the whole point of the brief's "Layout intent... fix placements in the zone data
// module if not [reading]; that is why it is data."

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const zonesDir = join(repoRoot, 'public', 'src', 'world', 'zones');
const assetsDir = join(repoRoot, 'public', 'assets');

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('world/zones/ files contain zero imports of any kind', () => {
  const files = readdirSync(zonesDir).filter((name) => /\.(js|mjs)$/.test(name));
  assert.ok(files.length > 0, 'expected at least one zone data module under world/zones/');
  const violations = [];
  for (const name of files) {
    const source = stripComments(readFileSync(join(zonesDir, name), 'utf8'));
    if (/\bimport\b/.test(source)) violations.push(name);
  }
  assert.deepEqual(violations, [],
    `zone data modules must import nothing at all (found an 'import' keyword in): ${violations.join(', ')}`);
});

test('village.js exports the shape the brief specifies', () => {
  assert.equal(VILLAGE.ZONE.size, 28);
  assert.deepEqual(VILLAGE.SPAWNS.heroes, [0, 0]);
  const openingWolf = VILLAGE.ENEMY_POPULATION.find((enemy) => enemy.enemyId === 'wolf-1');
  assert.ok(openingWolf, 'the canonical opening Wolf must be authored');
  assert.deepEqual(VILLAGE.SPAWNS.wolf, [openingWolf.home.x, openingWolf.home.z]);
  assert.ok(Array.isArray(VILLAGE.LANDMARKS) && VILLAGE.LANDMARKS.length > 0);
  assert.ok(Array.isArray(VILLAGE.PROPS) && VILLAGE.PROPS.length > 0);
  assert.equal(typeof VILLAGE.KEEPER.model, 'string');
});

// GP3: WORKSHOP_PROP is found by model path (village.js's own export comment explains why: it
// carries no other distinguishing field like the cart's own tiltZ). If house-longhouse.glb were
// ever renamed or removed from PROPS, .find() would silently resolve to undefined and main.js's own
// `VILLAGE.WORKSHOP_PROP.model` read would throw at zone-load time -- this is the guard against that.
test('WORKSHOP_PROP resolves to the unique longhouse the GP3 brief names, not undefined', () => {
  assert.ok(VILLAGE.WORKSHOP_PROP, 'WORKSHOP_PROP must resolve to a real PROPS entry');
  assert.equal(VILLAGE.WORKSHOP_PROP.model, 'props/village/house-longhouse.glb');
  assert.deepEqual(VILLAGE.WORKSHOP_PROP.at, [-7.5, -9.8]);
  // Exactly one match -- if a second longhouse were ever added, .find() would silently keep
  // returning only the first, which is worth failing loudly on rather than discovering by accident.
  const longhouses = VILLAGE.PROPS.filter((prop) => prop.model === 'props/village/house-longhouse.glb');
  assert.equal(longhouses.length, 1, 'WORKSHOP_PROP assumes exactly one shipped longhouse');
});

test('WORKSHOP_INTERACT is centred on WORKSHOP_PROP with a real, positive radius', () => {
  assert.deepEqual(VILLAGE.WORKSHOP_INTERACT.at, VILLAGE.WORKSHOP_PROP.at);
  assert.ok(VILLAGE.WORKSHOP_INTERACT.radiusMeters > 0);
});

// Phase Y/Task C: "one pure data definition for path/road control points" -- world/ground.js reads
// this directly (import { ROAD } from './zones/village.js'), so a malformed ROAD here is a broken
// ground mesh, not just bad data sitting unused.
/** Distance from (x, z) to the nearest point on a polyline -- the same measure ground.js paints
 *  the road with, restated here rather than imported because ground.js's own copy is not exported
 *  and this file must not depend on the render layer to check a data rule. */
function distanceToPolyline(x, z, points) {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared === 0 ? 0
      : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

test('ROAD is a valid polyline, and the hero spawns standing ON it', () => {
  assert.ok(VILLAGE.ROAD.widthMeters > 0);
  assert.ok(Array.isArray(VILLAGE.ROAD.points) && VILLAGE.ROAD.points.length >= 2,
    'a road needs at least 2 points to define a segment');
  for (const point of VILLAGE.ROAD.points) {
    assert.equal(point.length, 2);
    assert.ok(point.every((n) => Number.isFinite(n)), `non-finite road point: ${point}`);
  }
  // This used to assert `points[0]` was literally the hero spawn. That was a proxy for the real
  // rule, and it blocked the only sensible fix for the plaza's mud-smear: the old road doubled back
  // on itself because it had to BEGIN at the spawn, so both legs crowded the same ground. The rule
  // the game actually needs is that the spawn is on the road surface, wherever along it that falls.
  const [heroX, heroZ] = VILLAGE.SPAWNS.heroes;
  assert.ok(distanceToPolyline(heroX, heroZ, VILLAGE.ROAD.points) <= VILLAGE.ROAD.widthMeters / 2,
    'the hero must spawn on the road surface, not beside it');
});

// The defect that re-routing fixed, kept as a rule: a polyline that FOLDS BACK on itself paints as
// one wide blob instead of as a road, because both legs blend the same ground.
//
// "Folds back" has to be measured as arc length versus straight-line distance, not as segment
// index. A first version compared any two non-adjacent segments and failed the new road too -- on
// any curve, the segment after next is legitimately close, and rejecting that would only permit
// roads that are dead straight. What is NOT legitimate is two points that are a long way apart
// ALONG the road and close together in space: that is a fold, and only a fold.
const ROAD_FOLD_ARC_METERS = 6;
function tightestFold(points, arcApartMeters = ROAD_FOLD_ARC_METERS) {
  const samples = [];
  let arc = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const length = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d < length; d += 0.5) {
      const t = d / length;
      samples.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, arc: arc + d });
    }
    arc += length;
  }
  let tightest = Infinity;
  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 1; j < samples.length; j += 1) {
      if (samples[j].arc - samples[i].arc < arcApartMeters) continue;
      tightest = Math.min(tightest, Math.hypot(samples[i].x - samples[j].x, samples[i].z - samples[j].z));
    }
  }
  return tightest;
}

test('the road never folds back onto itself into a smear', () => {
  const tightest = tightestFold(VILLAGE.ROAD.points);
  assert.ok(tightest >= VILLAGE.ROAD.widthMeters,
    `two stretches ${ROAD_FOLD_ARC_METERS} m apart along the road come within ${tightest.toFixed(2)} m `
    + `of each other, inside its own ${VILLAGE.ROAD.widthMeters} m width`);
});

// Sabotage-verify against the EXACT old route, so the check is proven to catch the real defect
// rather than merely to pass on the current data.
test('sabotage: the fold check DOES fail against the old out-and-back plaza road', () => {
  const old = [[0, 0], [-2.0, -1.6], [-3.6, -3.0], [-4.6, -3.9], [-3.0, -2.2], [-1.2, -0.6], [0.4, 1.0]];
  const tightest = tightestFold(old);
  assert.ok(tightest < VILLAGE.ROAD.widthMeters,
    `the old route folded back to ${tightest.toFixed(2)} m; it should fail this check`);
});

// Sabotage-verify: a check that only looked at .length would pass a points array full of garbage.
test('sabotage: the ROAD shape check DOES fail against a non-finite point', () => {
  const sabotaged = { widthMeters: 4, points: [[0, 0], [NaN, 2]] };
  const offenders = sabotaged.points.filter((point) => !point.every((n) => Number.isFinite(n)));
  assert.equal(offenders.length, 1);
});

// Every model a placement names has to exist as a shipped GLB, or the loader's "missing file"
// fallback (a labelled console line, placement skipped) is silently the NORMAL case instead of the
// safety net it is meant to be. This is exactly the drift V1's test/zone-assets.test.mjs and V2's
// data module could develop independently of each other without this check tying them together.
function unshippedModels(zoneData) {
  const models = [
    ...zoneData.LANDMARKS.map((landmark) => landmark.model),
    ...zoneData.PROPS.map((prop) => prop.model),
    zoneData.KEEPER.model,
  ];
  return models.filter((model) => !existsSync(join(assetsDir, ...model.split('/'))));
}

test('every placement in village.js names a model V1 actually shipped', () => {
  assert.deepEqual(unshippedModels(VILLAGE), [],
    'a placement names a model with no file under public/assets/ -- data and assets have drifted apart');
});

// Sabotage-verify the check above against a deliberately broken zone object, so this test is
// proven able to fail rather than merely observed to pass once.
test('sabotage: the shipped-model check DOES fail against a placement naming a fake model', () => {
  const sabotaged = {
    LANDMARKS: [{ model: 'world/does-not-exist.glb' }],
    PROPS: [],
    KEEPER: { model: 'world/keeper.glb' },
  };
  assert.deepEqual(unshippedModels(sabotaged), ['world/does-not-exist.glb']);
});

// Phase Y/Task D: the radius checks below measure each placement's own BODY, not just its centre
// point -- found necessary the hard way. The pre-Task-D layout's rock-small at [6, 5] passed a
// centre-only version of the wolf-bowl check (4.61m from the wolf spawn, over the 4m floor) while
// its own ~0.66m half-width put its actual edge at 3.95m, INSIDE the bowl the check exists to keep
// clear. A centre-only check would pass that placement forever; only a body-aware one catches it.
//
// FOOTPRINT_RADIUS_METERS is a conservative CIRCULAR half-extent per model -- half the LARGER of
// each model's measured world-space width/depth (tools/budget/measure_props.mjs against the
// actually shipped, 1x-scale GLBs), not a rotation-aware rectangle. A circle can only over-estimate a
// rectangular footprint's reach along its shorter axis, never under-estimate it, so this stays
// conservative regardless of a placement's own rotY.
const FOOTPRINT_RADIUS_METERS = {
  'house-cottage': 1.500, 'house-longhouse': 2.050, 'stall-green': 0.500, 'stall-bench': 0.470,
  'cart': 0.670, 'lantern': 0.112, 'fence': 0.500, 'fence-gate': 0.500, 'fence-broken': 0.500,
  'tree': 0.512, 'tree-crooked': 0.512, 'rock-small': 0.663, 'rock-large': 0.835, 'rock-wide': 0.784,
};

/** A landmark's footprint scales with its own `height` field (scaleForHeight applies one uniform
 *  factor to every axis) rather than being fixed like a prop's -- lantern_tree.glb's raw bounds
 *  (tools/budget/measure_props.mjs) are W=1.000 D=0.563 at its own raw height 1.000, so the scale factor
 *  is height/1.000 and the larger raw axis (W) sets the conservative circular radius. Generalises
 *  to a future second landmark without hardcoding this one tree's numbers into the constant. */
function landmarkFootprintRadius(landmark) {
  const RAW_HEIGHT = 1.000;
  const RAW_LARGER_AXIS = 1.000;
  return ((landmark.height ?? RAW_HEIGHT) / RAW_HEIGHT) * RAW_LARGER_AXIS / 2;
}

function footprintRadius(placement) {
  if ('height' in placement) return landmarkFootprintRadius(placement);
  const name = placement.model.split('/').pop().replace('.glb', '');
  const radius = FOOTPRINT_RADIUS_METERS[name];
  if (radius == null) throw new Error(`no measured footprint radius for '${name}' -- add one to FOOTPRINT_RADIUS_METERS`);
  return radius * (placement.scale ?? 1);
}

test('no placement\'s BODY (not just centre) sits within radius 1.5 of the hero spawn (0, 0)', () => {
  const [heroX, heroZ] = VILLAGE.SPAWNS.heroes;
  const offenders = [...VILLAGE.LANDMARKS, ...VILLAGE.PROPS].filter((placement) => {
    const [x, z] = placement.at;
    return Math.hypot(x - heroX, z - heroZ) - footprintRadius(placement) < 1.5;
  });
  assert.deepEqual(offenders, []);
});

// EVERY spot on the patrol, not just the first. The wolf now respawns around a three-point loop, so
// a fight can start at any of them and each one needs the same clear bowl -- a prop standing in spot
// two would only be found by a child who got that far.
test('no placement\'s BODY (not just centre) sits within radius 4 of ANY wolf spawn, keeping every combat bowl prop-free', () => {
  for (const [wolfX, wolfZ] of VILLAGE.SPAWNS.patrol) {
    const offenders = [...VILLAGE.LANDMARKS, ...VILLAGE.PROPS].filter((placement) => {
      const [x, z] = placement.at;
      return Math.hypot(x - wolfX, z - wolfZ) - footprintRadius(placement) < 4;
    });
    assert.deepEqual(offenders, [], `props inside the bowl at [${wolfX}, ${wolfZ}]`);
  }
});

// Sabotage-verify: reproduce the exact pre-Task-D defect (a placement that passes a CENTRE-only
// check but fails a body-aware one) against a fixed object, so this class of bug is proven caught
// rather than merely absent from the current data by luck.
test('sabotage: the body-aware wolf-bowl check DOES fail against the old, centre-only-passing rock placement', () => {
  const oldPlacement = { model: 'props/village/rock-small.glb', at: [6, 5] };
  const centreDistance = Math.hypot(6 - 2.5, 5 - 8);
  assert.ok(centreDistance >= 4, 'the old placement should pass a centre-only check (that was the bug)');
  assert.ok(centreDistance - footprintRadius(oldPlacement) < 4,
    'the old placement\'s own body should fail a footprint-aware check');
});
