import { strict as assert } from 'node:assert';
import test from 'node:test';

import * as THREE from '../public/vendor/three.module.min.js';
import {
  isInStickRegion,
  orbitDeltaForDrag,
  pinchSeparation,
  zoomFactorForPinch,
} from '../public/src/input/cameraGesture.js';
import {
  createFollowCamera,
  MAX_DISTANCE,
  MAX_PITCH,
  MIN_DISTANCE,
  MIN_PITCH,
} from '../public/src/camera/follow.js';

test('the stick owns the lower-left area and nothing else', () => {
  const w = 1000;
  const h = 800;
  assert.equal(isInStickRegion(60, 760, w, h), true, 'bottom-left corner');
  assert.equal(isInStickRegion(60, 100, w, h), false, 'top-left is camera');
  assert.equal(isInStickRegion(900, 760, w, h), false, 'bottom-right is camera');
  assert.equal(isInStickRegion(500, 400, w, h), false, 'centre is camera');
  // Smaller than a quadrant, which is what the owner asked for: the midpoint of the bottom edge and
  // the midpoint of the left edge both belong to the camera.
  assert.equal(isInStickRegion(w / 2, h - 1, w, h), false, 'bottom edge midpoint');
  assert.equal(isInStickRegion(1, h / 2, w, h), false, 'left edge midpoint');
});

test('dragging right turns right, and dragging up looks further down', () => {
  assert.ok(orbitDeltaForDrag(100, 0).yaw > 0, 'drag right yaws positive');
  assert.ok(orbitDeltaForDrag(-100, 0).yaw < 0, 'drag left yaws negative');
  assert.ok(orbitDeltaForDrag(0, -100).pitch > 0, 'drag up raises the camera');
  assert.ok(orbitDeltaForDrag(0, 100).pitch < 0, 'drag down lowers the camera');
});

test('spreading the fingers pulls the camera in', () => {
  const a = { x: 100, y: 100 };
  const b = { x: 200, y: 100 };
  assert.equal(pinchSeparation(a, b), 100);
  assert.ok(zoomFactorForPinch(100, 200) < 1, 'spread apart zooms in');
  assert.ok(zoomFactorForPinch(200, 100) > 1, 'pinch together zooms out');
  assert.equal(zoomFactorForPinch(100, 100), 1, 'no change is no zoom');
  assert.equal(zoomFactorForPinch(0, 100), 1, 'a degenerate start cannot divide by zero');
});

test('orbit and zoom stay inside their limits however hard they are pushed', () => {
  const follow = createFollowCamera(new THREE.PerspectiveCamera());
  for (let i = 0; i < 200; i += 1) follow.orbit(0, 1);
  assert.ok(follow.pitch <= MAX_PITCH + 1e-12, `pitch ran past max: ${follow.pitch}`);
  for (let i = 0; i < 400; i += 1) follow.orbit(0, -1);
  assert.ok(follow.pitch >= MIN_PITCH - 1e-12, `pitch ran past min: ${follow.pitch}`);
  for (let i = 0; i < 200; i += 1) follow.zoomBy(1.5);
  assert.ok(follow.distance <= MAX_DISTANCE + 1e-12, `distance ran past max: ${follow.distance}`);
  for (let i = 0; i < 400; i += 1) follow.zoomBy(0.5);
  assert.ok(follow.distance >= MIN_DISTANCE - 1e-12, `distance ran past min: ${follow.distance}`);
});

test('the camera never falls below the hero, at any pitch or zoom', () => {
  const camera = new THREE.PerspectiveCamera();
  const follow = createFollowCamera(camera);
  const feet = new THREE.Vector3(0, 0, 0);
  for (const pitchPushes of [0, 20, 200]) {
    for (const zoom of [0.5, 1, 1.5]) {
      const fresh = createFollowCamera(camera);
      for (let i = 0; i < pitchPushes; i += 1) fresh.orbit(0, 0.05);
      fresh.zoomBy(zoom);
      fresh.update(feet);
      assert.ok(
        camera.position.y > 0.1,
        `camera sank to y=${camera.position.y.toFixed(3)} at pitch ${fresh.pitch.toFixed(3)}`,
      );
    }
  }
  follow.update(feet);
});

// Turning the camera has to turn what "up on the stick" means, or the scheme is not camera-relative.
test('orbiting the camera re-aims the movement input', () => {
  const follow = createFollowCamera(new THREE.PerspectiveCamera());
  const before = follow.screenToWorld({ x: 0, y: 1 });
  follow.orbit(Math.PI / 2, 0);
  const after = follow.screenToWorld({ x: 0, y: 1 });
  const dot = before.x * after.x + before.z * after.z;
  assert.ok(Math.abs(dot) < 1e-9, `a quarter turn should make forward orthogonal, dot ${dot}`);
});
