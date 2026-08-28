// The swing release blend (swingClip.js's SWING_RELEASE_SECONDS header): when a swing ends, the
// last pose the clip wrote dissolves into the locomotion pose over one crossfade instead of
// vanishing between two frames. These tests drive the real animator against a miniature rig and a
// real clip, with "locomotion" simulated the way main.js orders it: the bones are rewritten to the
// locomotion pose BEFORE every swing.update call, because locomotion.update runs first each frame.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from '../public/vendor/three.module.min.js';

import { SWING_RELEASE_SECONDS, createClipSwingAnimator } from '../public/src/character/swingClip.js';
import { CROSSFADE_SECONDS } from '../public/src/character/locomotion.js';

const SWING_DURATION = 0.45;
const DT = 1 / 60;
const END_RADIANS = 1.2;

function buildRig() {
  const root = new THREE.Object3D();
  const arm = new THREE.Object3D();
  arm.name = 'Arm';
  root.add(arm);
  // A one-bone sword_slash: rotation about X from rest to END_RADIANS, and a small forward
  // translation, so both the slerp and the lerp halves of the blend are exercised.
  const qFrom = new THREE.Quaternion();
  const qTo = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), END_RADIANS);
  const clip = new THREE.AnimationClip('sword_slash_mini', 1.0, [
    new THREE.QuaternionKeyframeTrack('Arm.quaternion', [0, 1], [
      qFrom.x, qFrom.y, qFrom.z, qFrom.w, qTo.x, qTo.y, qTo.z, qTo.w,
    ]),
    new THREE.VectorKeyframeTrack('Arm.position', [0, 1], [0, 0, 0, 0, 0, 0.3]),
  ]);
  return { root, arm, clip };
}

function armAngle(arm) {
  // The rotation the blend actually left on the bone, as an angle from rest about any axis.
  return 2 * Math.acos(Math.min(1, Math.abs(arm.quaternion.w)));
}

function writeLocomotionPose(arm) {
  arm.quaternion.identity();
  arm.position.set(0, 0, 0);
}

function runFullSwing(animator, arm) {
  for (let t = 0; t <= SWING_DURATION + 1e-9; t += DT) {
    writeLocomotionPose(arm);
    animator.update(Math.min(t, SWING_DURATION), SWING_DURATION, DT);
  }
}

test('the release constant is the crossfade, imported rather than restated (GQ-007)', () => {
  assert.equal(SWING_RELEASE_SECONDS, CROSSFADE_SECONDS);
});

test('a finished swing dissolves into the locomotion pose instead of cutting to it', () => {
  const { root, arm, clip } = buildRig();
  const animator = createClipSwingAnimator(root, [clip]);
  assert.ok(animator, 'the mini clip must be found as a swing clip');

  runFullSwing(animator, arm);
  const endAngle = armAngle(arm);
  assert.ok(endAngle > 0.5, `the swing must have posed the arm (got ${endAngle.toFixed(3)} rad)`);

  // The swing is over. Frame by frame, locomotion writes rest and the release blend pulls the arm
  // part of the way back toward the swing's final pose, by less each frame.
  const angles = [];
  const positions = [];
  for (let i = 0; i < Math.ceil(SWING_RELEASE_SECONDS / DT) + 3; i += 1) {
    writeLocomotionPose(arm);
    const stillSwinging = animator.update(-1, SWING_DURATION, DT);
    assert.equal(stillSwinging, false, 'a released swing reports not-swinging');
    assert.equal(animator.isSwinging(), false, 'isSwinging stays gameplay-true: the swing is over');
    angles.push(armAngle(arm));
    positions.push(arm.position.z);
  }

  // Continuous: no single frame moves the arm by more than a modest fraction of the whole pose.
  // (The old behaviour -- action.stop() and nothing else -- moves it by endAngle in ONE frame; the
  // sabotage test below proves this detector sees exactly that.)
  let previous = endAngle;
  let largestStep = 0;
  for (const angle of angles) {
    largestStep = Math.max(largestStep, Math.abs(previous - angle));
    assert.ok(angle <= previous + 1e-9, 'the release must decay monotonically');
    previous = angle;
  }
  assert.ok(largestStep < endAngle * 0.35,
    `no release frame may jump more than 35% of the pose (largest ${largestStep.toFixed(3)} of ${endAngle.toFixed(3)})`);

  // Complete: after the window, the locomotion pose is exactly what remains, position included.
  assert.ok(angles.at(-1) < 1e-6, 'the blend must end at exactly the locomotion pose');
  assert.ok(Math.abs(positions.at(-1)) < 1e-9, 'the position lerp must also fully release');
});

test('sabotage: the discontinuity detector goes red against the old hard cut', () => {
  const { root, arm, clip } = buildRig();
  const animator = createClipSwingAnimator(root, [clip]);
  runFullSwing(animator, arm);
  const endAngle = armAngle(arm);

  // One frame whose delta swallows the whole release window is the old behaviour by construction:
  // the blend expires inside the frame and the bone lands at rest immediately.
  writeLocomotionPose(arm);
  animator.update(-1, SWING_DURATION, SWING_RELEASE_SECONDS * 2);
  const jump = endAngle - armAngle(arm);
  assert.ok(jump > endAngle * 0.35,
    `the detector must be able to see a hard cut (one-frame jump ${jump.toFixed(3)} rad)`);
});

test('a fresh swing pre-empts a release still in flight', () => {
  const { root, arm, clip } = buildRig();
  const animator = createClipSwingAnimator(root, [clip]);
  runFullSwing(animator, arm);

  // One release frame, then a new swing begins while the blend still has most of its window left.
  writeLocomotionPose(arm);
  animator.update(-1, SWING_DURATION, DT);
  writeLocomotionPose(arm);
  animator.update(0, SWING_DURATION, DT);
  assert.equal(animator.isSwinging(), true, 'the new swing owns the pose');

  // And that swing's own end starts a fresh, full-length release.
  runFullSwing(animator, arm);
  const endAngle = armAngle(arm);
  writeLocomotionPose(arm);
  animator.update(-1, SWING_DURATION, DT);
  assert.ok(armAngle(arm) > endAngle * 0.5, 'the second release starts from a full window');
});
