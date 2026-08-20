// A1 Studio convergence: the standard review views. The camera vocabulary lives in
// public/src/review/cameraPresets.js and is executed by Character Studio, the review harnesses and
// the Sol bridge alike. These tests check the GEOMETRY of the new bearings independently (plain
// trig on the returned positions, not re-imports of the same expression), pin the original trio's
// exact angles as an evidence-binding ratchet, and hold the sol-review schema to the same
// vocabulary so the bridge never advertises a view it refuses to execute.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BEARINGS,
  CLOSEUP_DISTANCE,
  GAMEPLAY_DISTANCE,
  INSPECTION_DISTANCE,
  SCALE_DISTANCES,
  TAU,
  bearingRadians,
  cameraPositionFor,
  distanceForScale,
} from '../public/src/review/cameraPresets.js';

const EPS = 1e-9;

test('bearing names are unique and their angles are distinct points on the circle', () => {
  const names = BEARINGS.map(([name]) => name);
  assert.equal(new Set(names).size, names.length, 'duplicate bearing name');
  const angles = BEARINGS.map(([, angle]) => ((angle % TAU) + TAU) % TAU);
  assert.equal(new Set(angles.map((a) => a.toFixed(12))).size, angles.length, 'two bearings share an angle');
});

test('the original trio keeps its exact angles -- every existing capture sheet binds to them', () => {
  assert.equal(bearingRadians('front'), 0);
  assert.equal(bearingRadians('three-quarter'), TAU * 0.125);
  assert.equal(bearingRadians('back'), TAU * 0.5);
});

test('the A1 gear-review bearings stand where their names claim', () => {
  // Verified through cameraPositionFor's actual output, with plain trig expectations written out
  // here: bearing 0 is +Z (in front of a +Z-facing subject), angles run through +X. 'side' must be
  // purely +X, 'opposite-side' purely -X, 'rear-three-quarter' behind and to the +X side.
  const d = INSPECTION_DISTANCE;
  const side = cameraPositionFor('inspection', 'side', 0);
  assert.ok(Math.abs(side[0] - d) < EPS && Math.abs(side[2]) < EPS, `side is at ${side}`);
  const opposite = cameraPositionFor('inspection', 'opposite-side', 0);
  assert.ok(Math.abs(opposite[0] + d) < EPS && Math.abs(opposite[2]) < EPS, `opposite-side is at ${opposite}`);
  const rear = cameraPositionFor('inspection', 'rear-three-quarter', 0);
  assert.ok(rear[0] > 0 && rear[2] < 0, `rear-three-quarter is at ${rear}, expected +X -Z quadrant`);
  assert.ok(Math.abs(Math.abs(rear[0]) - Math.abs(rear[2])) < EPS, 'rear-three-quarter is not a true 45-degree quarter');
});

test('every bearing/scale pair stands exactly its scale distance from the subject', () => {
  for (const [bearingName] of BEARINGS) {
    for (const [scale, expected] of Object.entries(SCALE_DISTANCES)) {
      const [x, , z] = cameraPositionFor(scale, bearingName, 0.9, [0, 0, 0]);
      assert.ok(
        Math.abs(Math.hypot(x, z) - expected) < EPS,
        `${scale}/${bearingName} stands ${Math.hypot(x, z)} from the subject, expected ${expected}`,
      );
    }
  }
});

test('camera framing is deterministic: same inputs, identical output', () => {
  assert.deepEqual(
    cameraPositionFor('closeup', 'rear-three-quarter', 0.4, [1, 2, 3]),
    cameraPositionFor('closeup', 'rear-three-quarter', 0.4, [1, 2, 3]),
  );
});

test('closeup is genuinely closer than inspection, which is closer than gameplay', () => {
  assert.ok(CLOSEUP_DISTANCE < INSPECTION_DISTANCE);
  assert.ok(INSPECTION_DISTANCE < GAMEPLAY_DISTANCE);
  assert.equal(distanceForScale('closeup'), CLOSEUP_DISTANCE);
});

test('unknown bearings and scales fail closed with a throw, not a silent default', () => {
  assert.throws(() => bearingRadians('dutch-angle'), /unknown bearing/);
  assert.throws(() => distanceForScale('macro'), /unknown scale/);
  assert.throws(() => cameraPositionFor('inspection', 'dutch-angle'), /unknown bearing/);
});

test('the sol-review schema view enums are pinned to the executed camera vocabulary', () => {
  const schema = JSON.parse(readFileSync('tools/sol-review/request.schema.json', 'utf8'));
  const view = schema.else.then.properties.request.properties.views.items.properties;
  assert.deepEqual(view.bearing.enum, BEARINGS.map(([name]) => name));
  assert.deepEqual(view.scale.enum, Object.keys(SCALE_DISTANCES));
});

test('the shipping-assets sheet keeps its historical trio instead of inheriting every new bearing', () => {
  const src = readFileSync('tools/runtime-test/review-shipping-assets.mjs', 'utf8');
  assert.doesNotMatch(
    src, /of BEARINGS\)/,
    'review-shipping-assets iterates raw BEARINGS -- the A1 bearings would silently double its capture sheet',
  );
  assert.match(src, /SHEET_BEARINGS/, 'the pinned sheet subset is gone');
});

test('studio.html leaves its vocabulary menus empty for main.js to populate from the real modules', () => {
  // The menus are filled from loadoutDescriptors.js / cameraPresets.js / scene.js at boot so the
  // UI can never offer a state the Studio refuses. A hand-typed <option> here would reintroduce
  // exactly the drift that design removes.
  const html = readFileSync('public/studio.html', 'utf8');
  for (const id of ['loadout-select', 'scale-select', 'bearing-select', 'overlay-select']) {
    assert.match(html, new RegExp(`<select id="${id}"></select>`), `${id} must be populated from modules, not hand-typed options`);
  }
});
