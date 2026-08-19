/**
 * AP2-A -- createKeeperTurnController, pinned against a synthetic rig rather than the Keeper v2 body.
 *
 * WHY SYNTHETIC. The real turn clips only exist in this session's tmp/ scratch (tmp/ap2/keeper-
 * turns.glb, built by merge_clips.mjs from the Meshy pack) -- Keeper v2 has not shipped, so nothing
 * under test/ can depend on that file existing. tools/foundry/diagnose_keeper_turn.mjs is the tool
 * that proves the policy against the REAL asset and REAL measured throws (119.32/-104.42 degrees);
 * this file proves the CONTROLLER's own state machine is correct against hand-authored fixtures that
 * ship with the repo regardless of what the Keeper's body turns out to be, using the exact same
 * export zoneLoader.js's real presenter calls -- not a reimplementation of it.
 *
 * A two-node rig (root, and a child named 'Hips' -- the only name the controller or clipNetYaw/
 * stripPositionTrack ever look for) with two 90-degree turn clips, each carrying a deliberate
 * Hips.position track so "translation never reaches the bone" is a real, checked fact here and not
 * an assumption.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from '../public/vendor/three.module.min.js';
import {
  KEEPER_TURN_RATE_RADIANS_PER_SECOND,
  clipNetYaw,
  createKeeperTurnController,
  shortestTurn,
  stripPositionTrack,
} from '../public/src/world/zoneLoader.js';

const FRAME = 1 / 60;
const CLIP_SECONDS = 1;
const DEG = Math.PI / 180;

/** [x, y, z, w] for a pure yaw of `degrees`. */
function yawQuaternion(degrees) {
  const half = (degrees * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

/** A rig with `root` and a child Object3D named 'Hips', plus a mixer already bound to both. */
function buildRig() {
  const root = new THREE.Object3D();
  root.name = 'root';
  const hips = new THREE.Object3D();
  hips.name = 'Hips';
  root.add(hips);
  return { root, hips, mixer: new THREE.AnimationMixer(root) };
}

/**
 * A turn clip carrying a genuine root-motion translation on Hips (0,0,0 -> ROOT_MOTION_OFFSET) AND a
 * pure yaw rotation (0 -> yawDegrees), both over CLIP_SECONDS. The translation is deliberate: it is
 * exactly what stripPositionTrack has to remove, and a clip fixture with no translation at all would
 * prove nothing about the stripping.
 */
const ROOT_MOTION_OFFSET = [0.3, 0, -0.2];
function buildTurnClip(name, yawDegrees) {
  const times = [0, CLIP_SECONDS];
  const rotationTrack = new THREE.QuaternionKeyframeTrack(
    'Hips.quaternion', times, [...yawQuaternion(0), ...yawQuaternion(yawDegrees)],
  );
  const positionTrack = new THREE.VectorKeyframeTrack(
    'Hips.position', times, [0, 0, 0, ...ROOT_MOTION_OFFSET],
  );
  return new THREE.AnimationClip(name, CLIP_SECONDS, [rotationTrack, positionTrack]);
}

function buildController(rig) {
  const turnClips = { left: buildTurnClip('turn_left', 90), right: buildTurnClip('turn_right', -90) };
  const turnNetYaw = { left: clipNetYaw(turnClips.left, 'Hips'), right: clipNetYaw(turnClips.right, 'Hips') };
  const turnActions = {
    left: rig.mixer.clipAction(new THREE.AnimationClip(
      'turn_left', CLIP_SECONDS, stripPositionTrack(turnClips.left.tracks, 'Hips'),
    )),
    right: rig.mixer.clipAction(new THREE.AnimationClip(
      'turn_right', CLIP_SECONDS, stripPositionTrack(turnClips.right.tracks, 'Hips'),
    )),
  };
  for (const action of [turnActions.left, turnActions.right]) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }
  const step = createKeeperTurnController(rig.mixer, turnActions, turnNetYaw, null);
  return { turnActions, turnNetYaw, step };
}

function run(rig, controller, rotationY, wantedDegrees, seconds) {
  const wanted = wantedDegrees * DEG;
  const steps = Math.round(seconds / FRAME);
  let y = rotationY;
  for (let i = 0; i < steps; i += 1) {
    rig.mixer.update(FRAME);
    y = controller.step(y, wanted, FRAME);
  }
  return y;
}

test('a request below the clip threshold never touches the turn actions', () => {
  const rig = buildRig();
  const controller = buildController(rig);
  const finalY = run(rig, controller, 0, 20, 5); // 20 degrees, well under the 55-degree floor
  assert.ok(!controller.turnActions.left.isRunning());
  assert.ok(!controller.turnActions.right.isRunning());
  assert.ok(Math.abs(shortestTurn(finalY, 20 * DEG)) < 1e-6, 'plain turnToward must still converge');
});

test('a request above the threshold freezes rotationY until the clip finishes, then banks it exactly', () => {
  const rig = buildRig();
  const controller = buildController(rig);

  // Partway through the 1s clip: rotationY must not have moved AT ALL yet.
  const midway = run(rig, controller, 0, 90, 0.5);
  assert.equal(midway, 0, 'root.rotation.y is frozen while the clip visibly owns the turn');
  assert.ok(controller.turnActions.left.isRunning());

  // Run past the clip's own duration -- it finishes, banks, and hands off to idle.
  const finalY = run(rig, controller, midway, 90, 1);
  assert.ok(Math.abs(finalY - 90 * DEG) < 1e-4, `expected ~90 deg banked, got ${(finalY / DEG).toFixed(3)} deg`);
  assert.ok(!controller.turnActions.left.isRunning(), 'the clip must hand rotation back once banked');
});

test('the translation on a turn clip never reaches the Hips bone -- stripPositionTrack actually worked', () => {
  const rig = buildRig();
  const controller = buildController(rig);
  const restPosition = rig.hips.position.clone();

  let worstDrift = 0;
  const wanted = 90 * DEG;
  for (let i = 0; i < Math.round(1.5 / FRAME); i += 1) {
    rig.mixer.update(FRAME);
    controller.step(0, wanted, FRAME); // rotationY itself is irrelevant to this test
    worstDrift = Math.max(worstDrift, rig.hips.position.distanceTo(restPosition));
  }
  // The fixture's own root-motion offset is 0.36 m (hypot(0.3, 0.2)) -- if stripping failed this
  // would read close to that, not 0.
  assert.ok(worstDrift < 1e-9, `Hips moved ${worstDrift.toFixed(6)} m -- the clip still carries its position track`);
});

test('a rapid reversal mid-turn banks the PARTIAL rotation rather than the full clip throw', () => {
  const rig = buildRig();
  const controller = buildController(rig);

  // 0.3s into a 1s left turn (90 degrees authored): interrupt with a request needing right instead.
  const afterInterrupt = run(rig, controller, 0, 90, 0.3);
  assert.equal(afterInterrupt, 0, 'still frozen -- the interrupt has not been evaluated yet');

  const bankedAtReversal = run(rig, controller, afterInterrupt, -90, FRAME); // one frame: detect + bank
  const expectedPartial = 90 * 0.3 * DEG; // progress fraction * the clip's own net yaw
  assert.ok(
    bankedAtReversal > 0 && bankedAtReversal < 90 * DEG,
    `expected a partial bank strictly between 0 and 90 deg, got ${(bankedAtReversal / DEG).toFixed(2)} deg`,
  );
  assert.ok(
    Math.abs(bankedAtReversal - expectedPartial) < 5 * DEG,
    `expected roughly ${(expectedPartial / DEG).toFixed(1)} deg (30% of the clip), `
    + `got ${(bankedAtReversal / DEG).toFixed(2)} deg`,
  );

  // And it actually gets to the new target afterward.
  const finalY = run(rig, controller, bankedAtReversal, -90, 5);
  assert.ok(Math.abs(shortestTurn(finalY, -90 * DEG)) < 1e-4);
});

test('once settled, an unchanged wanted heading never re-triggers a clip', () => {
  const rig = buildRig();
  const controller = buildController(rig);
  const settled = run(rig, controller, 0, 90, 3);
  assert.ok(!controller.turnActions.left.isRunning());

  const stillY = run(rig, controller, settled, 90, 2);
  assert.equal(stillY, settled);
  assert.ok(!controller.turnActions.left.isRunning());
  assert.ok(!controller.turnActions.right.isRunning());
});

test('sabotage: KEEPER_TURN_RATE_RADIANS_PER_SECOND is actually used by the below-threshold path', () => {
  // If the procedural fallback silently teleported instead of stepping, this would still "converge"
  // on the coarse checks above -- pin the RATE itself by checking a single-frame step's size directly.
  const rig = buildRig();
  const controller = buildController(rig);
  const oneFrame = controller.step(0, 20 * DEG, FRAME);
  assert.ok(oneFrame > 0 && oneFrame < 20 * DEG, 'one frame must be a step, not the whole 20 degrees');
  assert.ok(
    Math.abs(oneFrame - KEEPER_TURN_RATE_RADIANS_PER_SECOND * FRAME) < 1e-9,
    `expected exactly one turnToward step (${(KEEPER_TURN_RATE_RADIANS_PER_SECOND * FRAME).toFixed(6)} rad), `
    + `got ${oneFrame.toFixed(6)}`,
  );
});
