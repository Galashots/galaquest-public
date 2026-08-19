import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from '../public/vendor/three.module.min.js';

import { SWING_CONTACT_SECONDS, SWING_SECONDS } from '../public/src/combat/encounter.js';
import {
  createSwingAnimator,
  FOLLOW_THROUGH_RADIANS,
  RECOVER_FROM,
  swingPose,
  WINDUP_PEAK_AT,
  WINDUP_RADIANS,
} from '../public/src/character/swing.js';

test('the swing starts and ends at the pose the locomotion clip produced', () => {
  const start = swingPose(0);
  // Compared by magnitude, not equality: -1.35 * 0 is -0, which strict equality separates from 0
  // while the arm is in exactly the same place.
  assert.ok(Math.abs(start.shoulderPitch) < 1e-12, 'a swing must not snap the arm on the button press');
  assert.ok(Math.abs(start.forearmPitch) < 1e-12);
  const end = swingPose(1);
  assert.ok(Math.abs(end.shoulderPitch) < 1e-9, `arm left at ${end.shoulderPitch} after the swing`);
  assert.ok(Math.abs(end.forearmPitch) < 1e-9);
});

// This is the one that matters for how the fight feels. encounter.js applies damage at
// SWING_CONTACT_SECONDS; if the blade has not reached the target by then, the wolf flinches before
// the sword arrives and the game reads as cheating.
test('the blade is at its target when the rules say contact happens', () => {
  const contactProgress = SWING_CONTACT_SECONDS / SWING_SECONDS;
  assert.ok(
    contactProgress > WINDUP_PEAK_AT && contactProgress < RECOVER_FROM,
    `contact at ${contactProgress.toFixed(3)} falls outside the strike phase `
      + `${WINDUP_PEAK_AT}..${RECOVER_FROM}, so the blade is not moving when damage lands`,
  );
  // Wound up (negative) before contact, followed through (positive) after it.
  assert.ok(swingPose(contactProgress - 0.08).shoulderPitch < 0, 'still winding up just before contact');
  assert.ok(swingPose(contactProgress + 0.08).shoulderPitch > 0, 'past the target just after contact');
});

test('the arm winds up before it strikes, rather than jabbing straight out', () => {
  assert.ok(swingPose(WINDUP_PEAK_AT).shoulderPitch <= -WINDUP_RADIANS + 1e-9, 'reaches the top of the arc');
  assert.ok(swingPose(0.1).shoulderPitch < 0, 'travelling backwards early');
});

test('the swing stays inside its stated travel, so the arm cannot wrap through the body', () => {
  for (let t = 0; t <= 1; t += 0.005) {
    const { shoulderPitch } = swingPose(t);
    assert.ok(
      shoulderPitch >= -WINDUP_RADIANS - 1e-9 && shoulderPitch <= FOLLOW_THROUGH_RADIANS + 1e-9,
      `shoulder reached ${shoulderPitch} at t=${t}`,
    );
  }
});

test('a progress value outside the swing is a no-op rather than an extrapolation', () => {
  for (const bad of [-1, 1.5, Number.NaN]) {
    const pose = swingPose(bad);
    assert.ok(Math.abs(pose.shoulderPitch) < 1e-12, `progress ${bad} moved the arm`);
  }
});

function rigWithAnArm() {
  const root = new THREE.Object3D();
  for (const name of ['RightArm', 'RightForeArm', 'Spine01']) {
    const bone = new THREE.Object3D();
    bone.name = name;
    root.add(bone);
  }
  return root;
}

// The same hazard that let the idle breath drift 104 degrees in the running game while every unit
// test passed: applying an offset on top of the bone's current value, frame after frame.
test('swinging over and over leaves the arm exactly where it started', () => {
  const root = rigWithAnArm();
  const arm = root.getObjectByName('RightArm');
  // .z, because that is the measured swing axis on this rig -- see the axis table in swing.js.
  arm.rotation.z = 0.21; // a pose the locomotion clip might have produced
  const animator = createSwingAnimator(root);

  for (let swing = 0; swing < 25; swing += 1) {
    for (let t = 0; t < SWING_SECONDS; t += 1 / 60) animator.update(t, SWING_SECONDS);
    animator.update(-1, SWING_SECONDS); // encounter.js reports -1 between swings
  }

  assert.ok(
    Math.abs(arm.rotation.z - 0.21) < 1e-9,
    `twenty-five swings drifted the arm to ${arm.rotation.z}`,
  );
  // And the axis it must NOT have touched.
  assert.equal(arm.rotation.x, 0, 'the swing moved an axis it does not own');
});

test('a rig with no right arm is left alone instead of throwing', () => {
  const root = new THREE.Object3D();
  const animator = createSwingAnimator(root);
  assert.doesNotThrow(() => animator.update(0.1, SWING_SECONDS));
});
