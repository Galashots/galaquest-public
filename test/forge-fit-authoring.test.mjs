import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.min.js';
import {
  createFitSession,
  FORGE_FIT_SCHEMA,
  FORGE_ROTATION_SPACE,
} from '../public/src/forge/fitAuthoring.js';

function fixture() {
  const root = new THREE.Group();
  const parent = new THREE.Bone();
  parent.name = 'Head';
  parent.position.set(0.2, 1.1, -0.1);
  parent.rotation.z = Math.PI / 5; // prove Forge world axes are not accidentally parent-local axes
  root.add(parent);
  const anchor = new THREE.Group();
  anchor.name = 'InterimAdapter_test_Head';
  anchor.position.set(0.03, 0.08, -0.02);
  anchor.rotation.y = 0.2;
  anchor.scale.setScalar(0.7);
  parent.add(anchor);
  const marker = new THREE.Object3D();
  marker.position.set(0.25, 0.04, -0.03);
  anchor.add(marker);
  root.updateMatrixWorld(true);
  return { root, parent, anchor, marker };
}

function worldPosition(object) {
  const p = new THREE.Vector3();
  object.getWorldPosition(p);
  return p;
}

function near(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) <= epsilon;
}

function nearVector(actual, expected, epsilon = 1e-8) {
  assert.ok(actual.distanceTo(expected) <= epsilon, `expected ${expected.toArray()}, got ${actual.toArray()}`);
}

test('Forge fit packets use v2 world-space authoring semantics', () => {
  const { anchor } = fixture();
  const shot = createFitSession(anchor).snapshot();
  assert.equal(shot.schema, FORGE_FIT_SCHEMA);
  assert.equal(FORGE_FIT_SCHEMA, 'galaquest.asset-forge-fit/2');
  assert.equal(shot.delta.rotationSpace, FORGE_ROTATION_SPACE);
  assert.equal(FORGE_ROTATION_SPACE, 'world');
  assert.equal(shot.reference.parentName, 'Head');
});

test('Forge +Y nudge means world up even under a rotated bone', () => {
  const { root, anchor } = fixture();
  const before = worldPosition(anchor);
  const fit = createFitSession(anchor);
  fit.nudge('y', 0.01);
  root.updateMatrixWorld(true);
  const after = worldPosition(anchor);
  assert.ok(Math.abs(after.x - before.x) < 1e-9, `x drifted ${after.x - before.x}`);
  assert.ok(Math.abs((after.y - before.y) - 0.01) < 1e-9, `expected +0.01 world Y, got ${after.y - before.y}`);
  assert.ok(Math.abs(after.z - before.z) < 1e-9, `z drifted ${after.z - before.z}`);
});

test('Forge world Z rotation visibly rotates mounted payload around world Z', () => {
  const { root, anchor, marker } = fixture();
  const anchorBefore = worldPosition(anchor);
  const markerBefore = worldPosition(marker);
  const relativeBefore = markerBefore.sub(anchorBefore);

  const fit = createFitSession(anchor);
  fit.apply({ rotationDeg: [0, 0, 90] });
  root.updateMatrixWorld(true);

  const anchorAfter = worldPosition(anchor);
  const markerAfter = worldPosition(marker);
  const relativeAfter = markerAfter.sub(anchorAfter);
  const expected = relativeBefore.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  nearVector(relativeAfter, expected, 1e-8);
});

test('rotation nudges change the actual anchor orientation', () => {
  const { anchor } = fixture();
  const fit = createFitSession(anchor);
  const before = anchor.quaternion.clone();
  const shot = fit.nudgeRotation('x', 15);
  assert.equal(shot.delta.rotationDeg[0], 15);
  assert.ok(1 - Math.abs(before.dot(anchor.quaternion)) > 1e-6, 'anchor quaternion did not change');
});

test('scale nudges are multiplicative around the pristine baseline', () => {
  const { anchor } = fixture();
  const fit = createFitSession(anchor);
  const shot = fit.nudgeScale(0.05);
  assert.equal(shot.delta.scale, 0.05);
  for (const value of shot.effective.localScale) assert.ok(near(value, 0.735));
});

test('repeated apply is baseline-relative and never accumulates drift', () => {
  const { anchor } = fixture();
  const fit = createFitSession(anchor);
  const first = fit.apply({ positionWorld: [0, 0.02, 0], rotationDeg: [0, 10, 0], scale: 0.1 });
  const second = fit.apply({ positionWorld: [0, 0.02, 0], rotationDeg: [0, 10, 0], scale: 0.1 });
  assert.deepEqual(second, first);
});

test('the same fit delta produces the same local transform even if animation moves the parent', () => {
  const { root, parent, anchor } = fixture();
  const fit = createFitSession(anchor);
  const first = fit.apply({ positionWorld: [0.04, -0.03, 0.02], rotationDeg: [17, -22, 31], scale: 0.08 });
  const firstLocal = {
    position: [...first.effective.localPosition],
    quaternion: anchor.quaternion.toArray(),
    scale: [...first.effective.localScale],
  };

  // Simulate an animation frame changing the owning bone after the authoring frame was captured.
  parent.position.add(new THREE.Vector3(0.4, -0.2, 0.3));
  parent.rotation.set(0.7, -0.45, 1.1);
  root.updateMatrixWorld(true);

  const second = fit.apply({ positionWorld: [0.04, -0.03, 0.02], rotationDeg: [17, -22, 31], scale: 0.08 });
  assert.deepEqual(second.effective.localPosition, firstLocal.position);
  assert.deepEqual(anchor.quaternion.toArray(), firstLocal.quaternion);
  assert.deepEqual(second.effective.localScale, firstLocal.scale);
});

test('a new session on the same edited anchor still knows the pristine candidate baseline', () => {
  const { anchor } = fixture();
  const pristine = {
    position: anchor.position.toArray(),
    quaternion: anchor.quaternion.toArray(),
    scale: anchor.scale.toArray(),
  };
  createFitSession(anchor).apply({ positionWorld: [0.04, 0.03, -0.02], rotationDeg: [5, 8, 12], scale: 0.2 });
  const secondSession = createFitSession(anchor);
  secondSession.reset();
  assert.deepEqual(anchor.position.toArray(), pristine.position);
  assert.deepEqual(anchor.quaternion.toArray(), pristine.quaternion);
  assert.deepEqual(anchor.scale.toArray(), pristine.scale);
});

test('scale delta is bounded so authoring cannot invert the gear', () => {
  const { anchor } = fixture();
  const fit = createFitSession(anchor);
  const result = fit.apply({ scale: -100 });
  assert.equal(result.delta.scale, -0.9);
  assert.ok(result.effective.localScale.every((value) => value > 0));
});

test('unknown position and rotation nudge axes fail loudly', () => {
  const { anchor } = fixture();
  const fit = createFitSession(anchor);
  assert.throws(() => fit.nudge('banana', 0.01), /unknown fit axis/);
  assert.throws(() => fit.nudgeRotation('banana', 1), /unknown fit rotation axis/);
});
