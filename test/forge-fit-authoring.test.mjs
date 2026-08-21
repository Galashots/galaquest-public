import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.min.js';
import { createFitSession } from '../public/src/forge/fitAuthoring.js';

function fixture() {
  const root = new THREE.Group();
  const parent = new THREE.Bone();
  parent.name = 'Head';
  parent.position.set(0.2, 1.1, -0.1);
  parent.rotation.z = Math.PI / 5; // prove Forge world-Y is not accidentally parent-local Y
  root.add(parent);
  const anchor = new THREE.Group();
  anchor.name = 'InterimAdapter_test_Head';
  anchor.position.set(0.03, 0.08, -0.02);
  anchor.rotation.y = 0.2;
  anchor.scale.setScalar(0.7);
  parent.add(anchor);
  root.updateMatrixWorld(true);
  return { root, parent, anchor };
}

function worldPosition(anchor) {
  const p = new THREE.Vector3();
  anchor.getWorldPosition(p);
  return p;
}

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

test('repeated apply is baseline-relative and never accumulates drift', () => {
  const { anchor } = fixture();
  const fit = createFitSession(anchor);
  const first = fit.apply({ positionWorld: [0, 0.02, 0], rotationDeg: [0, 10, 0], scale: 0.1 });
  const second = fit.apply({ positionWorld: [0, 0.02, 0], rotationDeg: [0, 10, 0], scale: 0.1 });
  assert.deepEqual(second.effective, first.effective);
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

test('unknown nudge axes fail loudly', () => {
  const { anchor } = fixture();
  const fit = createFitSession(anchor);
  assert.throws(() => fit.nudge('banana', 0.01), /unknown fit axis/);
});
