import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from '../public/vendor/three.module.min.js';

import {
  createLocomotionController,
  IDLE_ARM_SETTLE,
  IDLE_SETTLE_SECONDS,
  WALK_SPEED,
} from '../public/src/character/locomotion.js';

// The idle arm settle (locomotion.js, 2026-08-14). the owner's note was that the hero "does look
// awkward... the arms hang wide and straight and the pose reads stiff"; Idle_02 holds the sword hand
// about 46 degrees off vertical, which is halfway to a T-pose. The settle is a small rotation layered
// on the clip while standing.
//
// AP2-A retired this as the shipped default (Idle_02, the pose it was tuned against, is gone --
// see locomotion.js's own doc comment on `applyIdleSettle`), so every test below that exercises the
// mechanism itself now opts in explicitly with `{ applyIdleSettle: true }`. The mechanism is still
// real, still tested, and still available -- only its default flipped.
//
// Every test here was checked to FAIL when the property it names is sabotaged -- the file's own
// convention, and the reason `test/encounter-trace.test.mjs` exists. Sabotages used:
//   - applyArmSettle() removed from the idle branch          -> "reaches full strength" fails
//   - applyArmSettle() removed from the walking branch       -> "does not snap" fails
//   - settleWeight clamped to 1 instead of blended           -> "arrives over a crossfade" fails
//   - the += in applyArmSettle left running on a paused clip -> "does not accumulate" fails
//
// A rig, built to the shape the settle actually reaches for. The clip drives every settled bone, the
// way the hero's own clips drive all 24 joints, because the settle's safety argument depends on the
// mixer rewriting these bones from the clip every frame.
function riggedHero() {
  const root = new THREE.Object3D();
  root.name = 'hero';
  const bones = {};
  for (const name of ['Hips', 'Spine01', 'RightArm', 'LeftArm', 'RightForeArm', 'LeftForeArm']) {
    const bone = new THREE.Object3D();
    bone.name = name;
    bones[name] = bone;
    root.add(bone);
  }
  const tracks = (clipName) => [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, clipName === 'idle' ? 0.1 : 1, 0]),
    // The settled bones are driven by the clip, at a constant zero, so anything non-zero found on
    // them after an update came from the settle and nothing else.
    ...['RightArm', 'LeftArm', 'RightForeArm', 'LeftForeArm'].map(
      (b) => new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    ),
  ];
  const clips = [
    new THREE.AnimationClip('walking_man', 1, tracks('walking_man')),
    new THREE.AnimationClip('idle', 1, tracks('idle')),
  ];
  return { root, bones, clips };
}

const settleFor = (boneName) => IDLE_ARM_SETTLE.find((entry) => entry.bone === boneName);

test('the settle reaches full strength on a hero who is standing still', () => {
  const { root, bones, clips } = riggedHero();
  const controller = createLocomotionController(root, clips, { applyIdleSettle: true });

  for (let frame = 0; frame < 120; frame += 1) controller.update(1 / 60, 0);

  assert.equal(controller.getState().activeMode, 'idle');
  assert.ok(controller.getState().settleWeight > 0.999, 'settle never reached full weight');
  for (const entry of IDLE_ARM_SETTLE) {
    assert.ok(
      Math.abs(bones[entry.bone].rotation[entry.axis] - entry.radians) < 1e-6,
      `${entry.bone}.${entry.axis} is ${bones[entry.bone].rotation[entry.axis]}, expected ${entry.radians}`,
    );
  }
});

test('the settle arrives over a crossfade rather than snapping on in one frame', () => {
  const { root, bones, clips } = riggedHero();
  const controller = createLocomotionController(root, clips, { applyIdleSettle: true });

  // One frame of standing. If the settle were applied at full weight immediately, the arms would
  // jump inward the instant the child let go of the stick -- which is exactly what the first
  // version did and what IDLE_SETTLE_SECONDS exists to prevent.
  controller.update(1 / 60, 0);
  const right = settleFor('RightArm');
  const afterOneFrame = bones.RightArm.rotation[right.axis];

  assert.ok(afterOneFrame > 0, 'the settle did not start at all');
  assert.ok(
    afterOneFrame < right.radians * 0.5,
    `one frame moved the arm ${afterOneFrame} of ${right.radians} radians, which is a snap`,
  );
  // And it does get there, within about one blend, so the ramp is a ramp and not a stall.
  const framesInABlend = Math.ceil(IDLE_SETTLE_SECONDS * 60);
  for (let frame = 0; frame < framesInABlend + 2; frame += 1) controller.update(1 / 60, 0);
  assert.ok(controller.getState().settleWeight > 0.999, 'the settle never finished blending in');
});

test('walking off does not snap the arms back out on the first moving frame', () => {
  const { root, bones, clips } = riggedHero();
  const controller = createLocomotionController(root, clips, { applyIdleSettle: true });

  for (let frame = 0; frame < 120; frame += 1) controller.update(1 / 60, 0);
  const right = settleFor('RightArm');
  const standing = bones.RightArm.rotation[right.axis];

  controller.update(1 / 60, WALK_SPEED);
  const firstMovingFrame = bones.RightArm.rotation[right.axis];

  assert.ok(
    firstMovingFrame > standing * 0.5,
    `the settle fell from ${standing} to ${firstMovingFrame} in one frame, which is a snap`,
  );
  // It does go away, or the walk would carry an idle pose forever.
  for (let frame = 0; frame < 120; frame += 1) controller.update(1 / 60, WALK_SPEED);
  assert.equal(controller.getState().settleWeight, 0);
  for (const entry of IDLE_ARM_SETTLE) {
    assert.ok(
      Math.abs(bones[entry.bone].rotation[entry.axis]) < 1e-6,
      `${entry.bone} kept ${bones[entry.bone].rotation[entry.axis]} radians of settle while walking`,
    );
  }
});

test('stop-start cycling does not accumulate the settle', () => {
  const { root, bones, clips } = riggedHero();
  const controller = createLocomotionController(root, clips, { applyIdleSettle: true });

  // The hazard this pins is the one locomotion.js's breath already paid for once: an offset ADDED
  // every frame drifts without bound if the thing it is added to is not rewritten from the clip.
  for (let cycle = 0; cycle < 8; cycle += 1) {
    for (let frame = 0; frame < 90; frame += 1) controller.update(1 / 60, 0);
    for (let frame = 0; frame < 90; frame += 1) controller.update(1 / 60, WALK_SPEED);
  }
  for (let frame = 0; frame < 90; frame += 1) controller.update(1 / 60, 0);

  for (const entry of IDLE_ARM_SETTLE) {
    assert.ok(
      Math.abs(bones[entry.bone].rotation[entry.axis] - entry.radians) < 1e-6,
      `after eight stop-start cycles ${entry.bone}.${entry.axis} is `
      + `${bones[entry.bone].rotation[entry.axis]}, not the ${entry.radians} it settles to`,
    );
  }
});

test('a rig with no idle clip keeps its old behaviour and never settles', () => {
  // The fallback path pauses the action and calls mixer.update(0), which locomotion.js records as
  // not reliably re-applying the binding. Adding an offset there WOULD accumulate, so the settle
  // must stay off entirely rather than be merely small.
  const { root, bones, clips } = riggedHero();
  const walkOnly = clips.filter((clip) => clip.name === 'walking_man');
  const controller = createLocomotionController(root, walkOnly);

  for (let frame = 0; frame < 600; frame += 1) controller.update(1 / 60, 0);

  assert.equal(controller.getState().settleWeight, 0);
  for (const entry of IDLE_ARM_SETTLE) {
    assert.equal(
      bones[entry.bone].rotation[entry.axis], 0,
      `${entry.bone} was settled on a rig with no idle clip`,
    );
  }
});

test('a rig missing a settled bone is skipped rather than throwing', () => {
  const { root, bones, clips } = riggedHero();
  root.remove(bones.LeftForeArm);
  const controller = createLocomotionController(root, clips, { applyIdleSettle: true });

  assert.doesNotThrow(() => {
    for (let frame = 0; frame < 60; frame += 1) controller.update(1 / 60, 0);
  });
  const right = settleFor('RightArm');
  assert.ok(bones.RightArm.rotation[right.axis] > 0, 'the bones that do exist stopped settling too');
});

// `applyIdleSettle: false` is now the default (AP2-A), but still worth pinning explicitly: this is
// the exact behaviour review-hero-idle11.mjs's RAW column captured and Sol approved.
test('applyIdleSettle: false suppresses the settle entirely, even standing still indefinitely', () => {
  const { root, bones, clips } = riggedHero();
  const controller = createLocomotionController(root, clips, { applyIdleSettle: false });

  for (let frame = 0; frame < 120; frame += 1) controller.update(1 / 60, 0);

  assert.equal(controller.getState().activeMode, 'idle', 'the idle clip itself must still be selected and playing');
  assert.equal(controller.getState().settleWeight, 0, 'settleWeight must never leave 0 with the option off');
  for (const entry of IDLE_ARM_SETTLE) {
    assert.equal(
      bones[entry.bone].rotation[entry.axis], 0,
      `${entry.bone}.${entry.axis} was settled despite applyIdleSettle: false`,
    );
  }
});

test('sabotage: applyIdleSettle defaults to false -- omitting options must reproduce the shipped (unsettled) hero', () => {
  const { root, bones, clips } = riggedHero();
  const controller = createLocomotionController(root, clips); // no third argument at all

  for (let frame = 0; frame < 120; frame += 1) controller.update(1 / 60, 0);

  assert.equal(controller.getState().settleWeight, 0, 'omitting the option must not enable the settle');
  for (const entry of IDLE_ARM_SETTLE) {
    assert.equal(
      bones[entry.bone].rotation[entry.axis], 0,
      `${entry.bone}.${entry.axis} was settled despite omitting applyIdleSettle`,
    );
  }
});

test('applyIdleSettle: true still reaches the full, exact settle pose (the mechanism itself is untouched)', () => {
  const { root, bones, clips } = riggedHero();
  const controller = createLocomotionController(root, clips, { applyIdleSettle: true });

  for (let frame = 0; frame < 120; frame += 1) controller.update(1 / 60, 0);

  assert.ok(controller.getState().settleWeight > 0.999, 'opting in must still reach full weight');
  const right = settleFor('RightArm');
  assert.ok(Math.abs(bones.RightArm.rotation[right.axis] - right.radians) < 1e-6);
});

test('the settle table names one axis per bone and stays within a plausible range', () => {
  // Numbers this large are poses, not tweaks: a stray zero would put an arm through the torso and
  // no unit test downstream would notice. The bound is deliberately loose -- it catches a typo, not
  // a taste disagreement.
  const seen = new Set();
  for (const entry of IDLE_ARM_SETTLE) {
    const key = `${entry.bone}.${entry.axis}`;
    assert.ok(!seen.has(key), `${key} appears twice, so the two entries silently add`);
    seen.add(key);
    assert.ok(['x', 'y', 'z'].includes(entry.axis), `${entry.bone} has axis ${entry.axis}`);
    assert.ok(
      Math.abs(entry.radians) > 0 && Math.abs(entry.radians) < Math.PI / 2,
      `${key} is ${entry.radians} radians, outside a quarter turn`,
    );
  }
});
