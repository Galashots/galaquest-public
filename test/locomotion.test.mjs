import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from '../public/vendor/three.module.min.js';

import { createLocomotionController } from '../public/src/character/locomotion.js';

import {
  BREATH_PERIOD_SECONDS,
  BREATH_SPINE_RADIANS,
  breathingOffset,
  groundSpeedForInput,
  locomotionModeForSpeed,
  playbackRateForSpeed,
  RUN_DEFLECTION,
  RUN_SPEED,
  RUN_THRESHOLD,
  SWAY_PERIOD_SECONDS,
  SWAY_SPINE_RADIANS,
  WALK_SPEED,
} from '../public/src/character/locomotion.js';
import { TOUCH_RUN_DEFLECTION } from '../public/src/input/touch.js';

test('playback rate is numerically proportional to ground speed', () => {
  assert.equal(playbackRateForSpeed(WALK_SPEED / 2, WALK_SPEED), 0.5);
  assert.equal(playbackRateForSpeed(WALK_SPEED, WALK_SPEED), 1);
  assert.equal(playbackRateForSpeed(RUN_SPEED * 1.25, RUN_SPEED), 1.25);
  assert.equal(playbackRateForSpeed(0, WALK_SPEED), 0);
});

test('stick deflection scales ground speed instead of being read as on/off', () => {
  assert.equal(groundSpeedForInput(0, false), 0);
  // A full push with run false is exactly WALK_SPEED, which is what the KEYBOARD sends for a plain
  // WASD walk (input/keyboard.js puts run on Shift). This is the assertion that stops the analog
  // curve below from turning every keyboard walk into a sprint.
  assert.equal(groundSpeedForInput(1, false), WALK_SPEED);
  assert.equal(groundSpeedForInput(1, true), RUN_SPEED);
  // The property that was missing: a half push has to be slower than a full one.
  assert.ok(groundSpeedForInput(0.5, false) < groundSpeedForInput(1, false));
  // Over-deflection is clamped rather than allowed to outrun the clip.
  assert.equal(groundSpeedForInput(1.4, true), RUN_SPEED);
});

// This used to assert groundSpeedForInput(0.5, false) === WALK_SPEED / 2, i.e. that speed is
// magnitude x WALK_SPEED all the way up. That stopped being true on 2026-08-15 when the walk was
// re-scaled to reach WALK_SPEED at RUN_DEFLECTION rather than at the rim (younger players found the old
// curve too slow; see character/speed.js). The property that assertion was REALLY protecting -- the
// squared-magnitude defect of c75242c, where a half push travelled a quarter as far -- is what is
// checked here instead, and it is checked as linearity rather than as one hardcoded value, so it
// survives the next re-tune too.
test('the walk curve is LINEAR in deflection, not squared -- half the push, half the speed', () => {
  const quarter = groundSpeedForInput(RUN_DEFLECTION * 0.25, false);
  const half = groundSpeedForInput(RUN_DEFLECTION * 0.5, false);
  const full = groundSpeedForInput(RUN_DEFLECTION, false);
  assert.ok(Math.abs(half / quarter - 2) < 1e-9, `${half} / ${quarter} should be 2`);
  assert.ok(Math.abs(full / half - 2) < 1e-9, `${full} / ${half} should be 2`);
  assert.ok(Math.abs(full - WALK_SPEED) < 1e-9, 'the walk tops out at WALK_SPEED, at the run boundary');
});

// The change younger players' "too slow" bought, stated as the property rather than as a number: the middle
// of the stick -- where a young player's thumb actually rests -- moves him meaningfully faster
// than a magnitude x WALK_SPEED law did, while the RIM is untouched, which is older players' "fine".
test('mid-stick is faster than the old law, and the top speed is not', () => {
  assert.ok(groundSpeedForInput(0.5, false) > 0.5 * WALK_SPEED * 1.3, 'half a push barely moved before');
  assert.equal(groundSpeedForInput(1, true), RUN_SPEED, 'the rim must not change');
});

// And no cliff: the old law jumped from 1.19 m/s to 2.38 m/s the instant the stick crossed the run
// line, which is a step a thumb can sit either side of without noticing there is a far side.
test('there is no jump where walking becomes running', () => {
  const belowWalking = groundSpeedForInput(RUN_DEFLECTION - 1e-6, false);
  const atRunning = groundSpeedForInput(RUN_DEFLECTION, true);
  assert.ok(Math.abs(atRunning - belowWalking) < 1e-3, `${belowWalking} -> ${atRunning} is a cliff`);
});

test('a full stick push reaches run speed on touch, where there is no shift key', () => {
  const speed = groundSpeedForInput(1, TOUCH_RUN_DEFLECTION <= 1);
  assert.ok(
    speed >= RUN_THRESHOLD,
    `full deflection gives ${speed} m/s, below the ${RUN_THRESHOLD} run threshold`,
  );
  assert.equal(locomotionModeForSpeed(speed), 'run');
  // Just under the deflection boundary must still be a walk, or the boundary means nothing.
  assert.equal(locomotionModeForSpeed(groundSpeedForInput(TOUCH_RUN_DEFLECTION - 0.01, false)), 'walk');
});

test('playback rate varies once speed is analog, which it could not before', () => {
  const half = groundSpeedForInput(RUN_DEFLECTION * 0.5, false);
  assert.equal(playbackRateForSpeed(half, WALK_SPEED), 0.5);
});

// The clip has to survive the new curve, not just the maths. A walk played at more than about 1.5x
// reads as a scuttle, and the fastest a WALK-mode speed can now be is the moment before it crosses
// RUN_THRESHOLD into the run clip.
test('the walk clip is never asked to play faster than it can carry', () => {
  const fastestWalk = RUN_THRESHOLD - 1e-6;
  assert.ok(playbackRateForSpeed(fastestWalk, WALK_SPEED) < 1.5,
    `walk clip would run at ${playbackRateForSpeed(fastestWalk, WALK_SPEED).toFixed(2)}x`);
});

// A standing hero was a single walk frame held forever, which reads as a freeze rather than a
// person. There is no idle clip to play -- the hero ships with walking and running only -- so the
// standing pose gets a small procedural breath on top of the held frame.
test('the breath starts at rest, so a hero who stops does not jump', () => {
  const start = breathingOffset(0);
  assert.equal(start.spinePitch, 0);
  assert.equal(start.spineYaw, 0);
});

test('the breath stays inside its stated amplitude', () => {
  for (let t = 0; t < 30; t += 0.05) {
    const { spinePitch, spineYaw } = breathingOffset(t);
    assert.ok(Math.abs(spinePitch) <= BREATH_SPINE_RADIANS + 1e-9, `pitch ${spinePitch} at t=${t}`);
    assert.ok(Math.abs(spineYaw) <= SWAY_SPINE_RADIANS + 1e-9, `yaw ${spineYaw} at t=${t}`);
  }
});

test('the breath is periodic, and small enough to read as breathing rather than motion', () => {
  const at = breathingOffset(1.1);
  const laterCycle = breathingOffset(1.1 + BREATH_PERIOD_SECONDS);
  assert.ok(Math.abs(at.spinePitch - laterCycle.spinePitch) < 1e-9, 'one period returns the pitch');

  // Roughly 1.6 degrees of spine pitch. Large enough to see at 90 CSS px, small enough that it is
  // not mistaken for the hero doing something.
  assert.ok(BREATH_SPINE_RADIANS < 0.04, `${BREATH_SPINE_RADIANS} rad is too much for a breath`);
});

test('breath and sway run on incommensurate periods so the idle does not visibly loop', () => {
  // Equal or simply-related periods make the pair repeat every cycle, which the eye picks up as a
  // mechanism. The ratio must not be a tidy fraction.
  const ratio = SWAY_PERIOD_SECONDS / BREATH_PERIOD_SECONDS;
  assert.ok(ratio > 1, 'the sway is the slower of the two');
  for (const tidy of [1, 1.5, 2, 2.5, 3]) {
    assert.ok(Math.abs(ratio - tidy) > 0.05, `ratio ${ratio} is too close to ${tidy}`);
  }
});

// A rig whose walk clip does not drive the spine, so a breath added on top of it compounds every
// frame instead of oscillating. Measured live in the browser before this test existed: the spine
// swung 1.82 radians -- 104 degrees -- against a 0.028 amplitude, while every unit test passed,
// because breathingOffset itself was always correct.
//
// CORRECTED 2026-08-12: this used to claim it reproduced "the exact rig condition" of the shipped
// hero, on the belief that its walk clip carried no Spine01 track. Re-measuring the GLB disproved
// that -- both hero clips carry 72 channels over all 24 joints, and decoding the keyframes shows
// Spine01's rotation genuinely varies. So this fixture is a SYNTHETIC worst case, not a replica of
// the hero. It still earns its place: it pins the accumulate-vs-set hazard for any rig or clip that
// does leave a bone undriven, which is the property the fix actually depends on.
function rigWhoseWalkClipIgnoresTheSpine() {
  const root = new THREE.Object3D();
  root.name = 'hero';
  const hips = new THREE.Object3D();
  hips.name = 'Hips';
  const spine = new THREE.Object3D();
  spine.name = 'Spine01';
  root.add(hips);
  root.add(spine);
  const clip = new THREE.AnimationClip('walking_man', 1, [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 1, 0]),
  ]);
  return { root, spine, clip };
}

test('standing still breathes without the spine drifting away frame by frame', () => {
  const { root, spine, clip } = rigWhoseWalkClipIgnoresTheSpine();
  const controller = createLocomotionController(root, [clip]);

  for (let frame = 0; frame < 600; frame += 1) controller.update(1 / 60, 0);

  assert.ok(
    Math.abs(spine.rotation.x) <= BREATH_SPINE_RADIANS + 1e-6,
    `after ten seconds of standing the spine pitch is ${spine.rotation.x}, outside the breath`,
  );
  assert.ok(
    Math.abs(spine.rotation.y) <= SWAY_SPINE_RADIANS + 1e-6,
    `after ten seconds of standing the spine yaw is ${spine.rotation.y}, outside the sway`,
  );
});

test('walking away and stopping again re-bases the breath instead of stacking on the last one', () => {
  const { root, spine, clip } = rigWhoseWalkClipIgnoresTheSpine();
  const controller = createLocomotionController(root, [clip]);

  for (let cycle = 0; cycle < 5; cycle += 1) {
    for (let frame = 0; frame < 120; frame += 1) controller.update(1 / 60, 0);
    for (let frame = 0; frame < 60; frame += 1) controller.update(1 / 60, WALK_SPEED);
  }
  for (let frame = 0; frame < 120; frame += 1) controller.update(1 / 60, 0);

  assert.ok(
    Math.abs(spine.rotation.x) <= BREATH_SPINE_RADIANS + 1e-6,
    `stop-start cycling drifted the spine pitch to ${spine.rotation.x}`,
  );
});

test('ground-speed thresholds select walk and run', () => {
  assert.equal(locomotionModeForSpeed(0), 'walk');
  assert.equal(locomotionModeForSpeed(WALK_SPEED), 'walk');
  assert.equal(locomotionModeForSpeed(2.0), 'run');
  assert.equal(locomotionModeForSpeed(RUN_SPEED), 'run');
});
