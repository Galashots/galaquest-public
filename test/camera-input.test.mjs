import { strict as assert } from 'node:assert';
import test from 'node:test';

import * as THREE from '../public/vendor/three.module.min.js';
import { createFollowCamera } from '../public/src/camera/follow.js';
import {
  screenToWorld,
  worldDirectionForInput,
  worldVelocityForInput,
} from '../public/src/camera/rotation.js';
import { keysToScreenVector } from '../public/src/input/keyboard.js';

// The previous version of this test asserted right.x === cos(heading) -- the implementation's own
// formula restated. An inverted strafe axis satisfies that, and satisfies orthonormality too, so the
// test passed while pressing D moved the hero left. These assertions compare against the basis of a
// real PerspectiveCamera placed by the real follow rig, so the only way to pass is to agree with the
// camera three.js actually built.
const HEADINGS = [0, Math.PI / 6, Math.PI / 3, Math.PI / 2, Math.PI, -Math.PI / 2];

function cameraBasis(heading) {
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 100);
  const follow = createFollowCamera(camera);
  follow.setHeading(heading);
  follow.update(new THREE.Vector3(0, 0, 0));
  camera.updateMatrixWorld(true);

  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  // Movement is planar, so compare ground projections. The camera is pitched down at the hero, which
  // is why forward has to be re-normalised in XZ before it can be compared to a movement direction.
  right.y = 0;
  forward.y = 0;
  return { forward: forward.normalize(), right: right.normalize(), follow };
}

test('screen right is the camera right at six headings, not its mirror', () => {
  for (const heading of HEADINGS) {
    const { right, follow } = cameraBasis(heading);
    const moved = follow.screenToWorld({ x: 1, y: 0 });
    const dot = right.x * moved.x + right.z * moved.z;
    assert.ok(
      dot > 0.999,
      `heading ${heading}: screen-right maps to (${moved.x.toFixed(3)}, ${moved.z.toFixed(3)}) but the `
      + `camera's right is (${right.x.toFixed(3)}, ${right.z.toFixed(3)}); dot ${dot.toFixed(3)}`,
    );
  }
});

test('screen up is the camera forward at six headings', () => {
  for (const heading of HEADINGS) {
    const { forward, follow } = cameraBasis(heading);
    const moved = follow.screenToWorld({ x: 0, y: 1 });
    const dot = forward.x * moved.x + forward.z * moved.z;
    assert.ok(
      dot > 0.999,
      `heading ${heading}: screen-up maps to (${moved.x.toFixed(3)}, ${moved.z.toFixed(3)}) but the `
      + `camera's forward is (${forward.x.toFixed(3)}, ${forward.z.toFixed(3)}); dot ${dot.toFixed(3)}`,
    );
  }
});

test('the mapping stays orthonormal and length-preserving', () => {
  for (const heading of HEADINGS) {
    const { follow } = cameraBasis(heading);
    const forward = follow.screenToWorld({ x: 0, y: 1 });
    const right = follow.screenToWorld({ x: 1, y: 0 });
    assert.ok(Math.abs(Math.hypot(forward.x, forward.z) - 1) < 1e-12, `forward length at ${heading}`);
    assert.ok(Math.abs(Math.hypot(right.x, right.z) - 1) < 1e-12, `right length at ${heading}`);
    assert.ok(
      Math.abs(forward.x * right.x + forward.z * right.z) < 1e-12,
      `orthogonality at ${heading}`,
    );
  }
});

// The integration defect this pins down: screenToWorld preserves the stick magnitude AND
// groundSpeedForInput prices that magnitude in, so multiplying them gave magnitude^2 * speed.
// Measured in the touch harness before the fix: 0.72 m/s while the status line claimed 1.00.
test('the hero travels at exactly groundSpeed, whatever the stick deflection', () => {
  for (const heading of HEADINGS) {
    for (const magnitude of [0.1, 0.5, 40 / 56, 1]) {
      const screen = { x: 0.6 * magnitude, y: 0.8 * magnitude };
      const groundSpeed = 1.4 * magnitude;
      const velocity = worldVelocityForInput(screen, heading, groundSpeed);
      const actual = Math.hypot(velocity.x, velocity.z);
      assert.ok(
        Math.abs(actual - groundSpeed) < 1e-12,
        `heading ${heading} magnitude ${magnitude}: |velocity| ${actual} but groundSpeed ${groundSpeed}`,
      );
    }
  }
});

test('velocity points where screenToWorld points, and zero input is zero velocity', () => {
  const velocity = worldVelocityForInput({ x: 0.21, y: 0.35 }, 0.7, 1.1);
  const direction = screenToWorld({ x: 0.21, y: 0.35 }, 0.7);
  const dot = (velocity.x * direction.x + velocity.z * direction.z)
    / (Math.hypot(velocity.x, velocity.z) * Math.hypot(direction.x, direction.z));
  assert.ok(dot > 0.999999, `velocity disagrees with screenToWorld, dot ${dot}`);
  assert.deepEqual(worldVelocityForInput({ x: 0, y: 0 }, 1.2, 1.4), { x: 0, z: 0 });
  assert.deepEqual(worldVelocityForInput({ x: 0, y: 1 }, 1.2, 0), { x: 0, z: 0 });
});

// main.js walks the hero with worldDirectionForInput * groundSpeed and sends that same direction to
// the server, so these two must stay one law. If they ever diverge, the tests above would keep
// passing while the game did something else -- which is precisely how an inverted strafe axis and a
// squared magnitude both survived a green suite in this repo.
test('velocity is exactly the direction times the speed, at every deflection', () => {
  for (const heading of HEADINGS) {
    for (const magnitude of [0.1, 0.5, 40 / 56, 1]) {
      const screen = { x: 0.6 * magnitude, y: 0.8 * magnitude };
      const speed = 1.4 * magnitude;
      const direction = worldDirectionForInput(screen, heading);
      const velocity = worldVelocityForInput(screen, heading, speed);
      assert.ok(Math.abs(velocity.x - direction.x * speed) < 1e-12, `x at ${heading}/${magnitude}`);
      assert.ok(Math.abs(velocity.z - direction.z * speed) < 1e-12, `z at ${heading}/${magnitude}`);
      // And the direction the server is told is unit-or-zero, which the protocol requires.
      const length = Math.hypot(direction.x, direction.z);
      assert.ok(Math.abs(length - 1) < 1e-12, `direction length ${length} is not unit`);
    }
  }
  assert.deepEqual(worldDirectionForInput({ x: 0, y: 0 }, 1.2), { x: 0, z: 0 });
});

test('keyboard diagonals are normalized before camera rotation', () => {
  const vector = keysToScreenVector(new Set(['KeyW', 'KeyD']));
  assert.ok(Math.abs(vector.x - Math.SQRT1_2) < 1e-12, 'diagonal x');
  assert.ok(Math.abs(vector.y - Math.SQRT1_2) < 1e-12, 'diagonal y');
});
