/**
 * AP1 / Finding 3 -- the hero attack pose flash, FIXED in AP2-A.
 *
 * WHAT WAS PROVEN. The hero's skeleton is written by three independent `THREE.AnimationMixer`s --
 * locomotion, reactions, swing -- arbitrated only by the order main.js updates them in. three.js
 * r170's mixer saves a bound property's value the first time an action activates it
 * (`PropertyMixer.saveOriginalState`, called from `_activateAction`) and writes that saved value BACK
 * when the last action using it deactivates (`restoreOriginalState`, from `_deactivateAction`).
 *
 * So `action.stop()` in swingClip.js does not merely stop writing. It actively restores the pose the
 * skeleton held at the instant the swing STARTED. Normally locomotion hides it: locomotion runs FIRST
 * and rewrites the whole pose every frame, so the stale values are overwritten one frame later and
 * the cost is an invisible single-frame pop.
 *
 * BUT main.js deliberately does not call locomotion while the hero is down (so the death clip is not
 * erased). In that window nothing corrected the restore, and a swing that ended while the hero was
 * down put the hero back in a full standing pose for exactly one frame, in the middle of dying.
 * Measured on the shipped rig before the fix: the head rose from 1.3098 m to 1.4520 m and fell to
 * 0.1439 m across three consecutive frames -- up and down again inside about 33 ms.
 *
 * THE FIX (AP2-A, main.js's per-frame update block): while the hero is down, swing.update() now runs
 * BEFORE reactions.update() instead of after. Any stale restore swing's action.stop() produces still
 * happens -- swingClip.js is untouched -- but it now lands before reactions writes the death pose, so
 * death's write is the one left standing at the end of the frame. "Death visually supersedes swing"
 * falls out of ordering alone; no combat authority, tick rate or SWING_SECONDS changed.
 * tools/foundry/diagnose_swing_arbitration.mjs's `down-mid-swing` scenario mirrors the same ordering.
 *
 * This file used to PIN the defect (assert what the code did, so a future fix would fail loudly and
 * point here) -- the same convention test/character-material.test.mjs still uses for the hero's
 * unfixed emissive/metalness export. Now that the fix has landed, it asserts the invariant the pin was
 * standing in for: no stale restore ever becomes visible on screen, in either order main.js can run.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as THREE from '../public/vendor/three.module.min.js';
import { loadRigScene } from '../tools/foundry/glb_anim_scene.mjs';
import { createLocomotionController } from '../public/src/character/locomotion.js';
import { createReactionAnimator } from '../public/src/character/reactClips.js';
import { createClipSwingAnimator } from '../public/src/character/swingClip.js';
import { SWING_SECONDS } from '../public/src/combat/encounter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HERO_GLB = join(HERE, '..', 'public', 'assets', 'hero', 'hero_lod1_ironwood_atlas.glb');
const FRAME = 1 / 60;

/** World position of every skin joint, which is what a viewer's eye is actually reading. */
function poseOf(root, jointNames) {
  root.updateMatrixWorld(true);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const out = new Map();
  for (const name of jointNames) {
    root.getObjectByName(name).matrixWorld.decompose(position, quaternion, scale);
    out.set(name, position.toArray());
  }
  return out;
}

function maxJointDifference(a, b) {
  let worst = { joint: null, metres: 0 };
  for (const [name, value] of a) {
    const other = b.get(name);
    const metres = Math.hypot(value[0] - other[0], value[1] - other[1], value[2] - other[2]);
    if (metres > worst.metres) worst = { joint: name, metres };
  }
  return worst;
}

/**
 * Stand, start a swing, go down a third of the way through it, and stay down past the swing's end --
 * the sequence a child produces by attacking a wolf and losing the trade.
 *
 * Reproduces main.js's ACTUAL per-frame ordering, fix included: swing before reactions while down,
 * reactions before swing otherwise. `beforeSwingWrite`/`after` bracket swing.update() specifically,
 * because that is precisely the moment three.js's saveOriginalState/restoreOriginalState fire.
 */
function runDownMidSwing() {
  const { root, animations, jointNames } = loadRigScene(HERO_GLB);
  const locomotion = createLocomotionController(root, animations);
  const reactions = createReactionAnimator(root, animations);
  const swing = createClipSwingAnimator(root, animations);

  const steps = Math.round(SWING_SECONDS / FRAME);
  const frames = [];
  for (let i = 0; i < 30; i += 1) frames.push({ swingSeconds: -1, downSeconds: -1 });
  for (let i = 0; i <= steps; i += 1) {
    frames.push({
      swingSeconds: Math.min(SWING_SECONDS, i * FRAME),
      downSeconds: i > steps / 3 ? (i - Math.floor(steps / 3)) * FRAME : -1,
    });
  }
  for (let i = 0; i < 30; i += 1) frames.push({ swingSeconds: -1, downSeconds: 1.9 });

  let savedAtSwingStart = null;
  let poseOnStopFrame = null;
  let poseFrameBeforeStop = null;
  let poseFrameAfterStop = null;
  let stopIndex = -1;

  frames.forEach((frame, index) => {
    const down = frame.downSeconds >= 0;
    const wasSwinging = swing.isSwinging();

    if (!down) locomotion.update(FRAME, 0);

    let beforeSwingWrite;
    let after;
    if (down) {
      // AP2-A ordering: swing first, so any stale restore is overwritten by reactions' death pose
      // before the frame ends.
      beforeSwingWrite = poseOf(root, jointNames);
      swing.update(frame.swingSeconds, SWING_SECONDS, FRAME);
      reactions.update(FRAME, { downSeconds: frame.downSeconds });
      after = poseOf(root, jointNames);
    } else {
      reactions.update(FRAME, { downSeconds: frame.downSeconds });
      beforeSwingWrite = poseOf(root, jointNames);
      swing.update(frame.swingSeconds, SWING_SECONDS, FRAME);
      after = poseOf(root, jointNames);
    }

    if (!wasSwinging && swing.isSwinging()) savedAtSwingStart = beforeSwingWrite;
    if (wasSwinging && !swing.isSwinging()) {
      stopIndex = index;
      poseOnStopFrame = after;
      poseFrameBeforeStop = beforeSwingWrite;
    } else if (stopIndex >= 0 && index === stopIndex + 1) {
      poseFrameAfterStop = after;
    }
  });

  return {
    savedAtSwingStart, poseOnStopFrame, poseFrameBeforeStop, poseFrameAfterStop, stopIndex, jointNames,
  };
}

const result = runDownMidSwing();

test('the swing mixer still restores its stale pose internally, but it never reaches the screen', () => {
  assert.ok(result.stopIndex > 0, 'the scenario must actually run a swing to completion');

  // The mechanism itself is untouched -- swingClip.js's action.stop() still restores whatever pose
  // three.js saved when the swing activated. What changed is that reactions.update() now runs AFTER
  // it while down, so that stale write is not what poseOnStopFrame (captured after BOTH have run)
  // ends up holding.
  const difference = maxJointDifference(result.savedAtSwingStart, result.poseOnStopFrame);
  assert.notEqual(
    difference.metres, 0,
    'the frame the swing stops while the hero is down must NOT show the pose the swing started with '
    + '-- if this is 0 again, the ordering fix in main.js was reverted or bypassed',
  );
});

test('the frame the swing stops while down shows the death pose, not a standing one', () => {
  const head = (pose) => pose.get('head_end')[1];
  const before = head(result.poseFrameBeforeStop);
  const on = head(result.poseOnStopFrame);
  const after = head(result.poseFrameAfterStop);

  // Before the fix `on` was > 1.2 m -- the stale restore standing the hero back up. Now every frame
  // in this window, including the stop frame itself, should read as "down" (well under standing
  // height), because reactions' death write is what survives the frame.
  assert.ok(on < 0.5, `expected the death pose on the stop frame, head_end was ${on.toFixed(4)} m`);
  // And no more one-frame spike: the three frames should agree with each other, not alternate.
  assert.ok(
    Math.abs(on - before) < 0.3,
    `expected the stop frame to agree with the frame before it, diverged by ${Math.abs(on - before).toFixed(4)} m`,
  );
  assert.ok(
    Math.abs(on - after) < 0.3,
    `expected the stop frame to agree with the frame after it, diverged by ${Math.abs(on - after).toFixed(4)} m`,
  );
});

test('the ordinary attack-from-standing case recovers on the next frame', () => {
  // Never goes down, so this exercises the UNCHANGED (reactions, then swing) ordering -- attack still
  // takes precedence over a mere hit flinch, and the pose still returns to locomotion alone.
  const { root, animations, jointNames } = loadRigScene(HERO_GLB);
  const locomotion = createLocomotionController(root, animations);
  const reactions = createReactionAnimator(root, animations);
  const swing = createClipSwingAnimator(root, animations);

  const steps = Math.round(SWING_SECONDS / FRAME);
  const control = loadRigScene(HERO_GLB);
  const controlLocomotion = createLocomotionController(control.root, control.animations);

  let worstAfterRecovery = 0;
  for (let index = 0; index < 30 + steps + 30; index += 1) {
    const swinging = index >= 30 && index <= 30 + steps;
    const swingSeconds = swinging ? Math.min(SWING_SECONDS, (index - 30) * FRAME) : -1;

    locomotion.update(FRAME, 0);
    reactions.update(FRAME, { downSeconds: -1 });
    swing.update(swingSeconds, SWING_SECONDS, FRAME);
    controlLocomotion.update(FRAME, 0);

    // Two frames after the swing ends, a locomotion-only control and the real thing should agree.
    if (index > 30 + steps + 1) {
      const difference = maxJointDifference(
        poseOf(root, jointNames),
        poseOf(control.root, control.jointNames),
      );
      worstAfterRecovery = Math.max(worstAfterRecovery, difference.metres);
    }
  }

  assert.ok(
    worstAfterRecovery < 0.05,
    `after a swing ends the pose should return to what locomotion alone would produce; `
    + `worst divergence was ${worstAfterRecovery.toFixed(4)} m`,
  );
});
