/**
 * AP2-A -- the ORDINARY hero attack flicker (distinct from the death-mid-swing defect in
 * test/swing-arbitration.test.mjs), proven and fixed.
 *
 * WHAT WAS PROVEN. Every scenario in tools/foundry/diagnose_swing_arbitration.mjs updates
 * hero.swingSeconds on EVERY simulated frame, because that is what the OFFLINE rules tick actually
 * does. Online, swingSeconds is mirrored from the server's snapshot (net/protocol.js SNAPSHOT_HZ,
 * 10 Hz) and simply holds its last value between snapshots, while the render loop keeps calling
 * swing.update() at up to 60 Hz (render/renderer.js MAX_FPS). Nothing in this repo had ever simulated
 * that gap before AP2-A, which is exactly why AP1's proof of the flicker came from a browser capture
 * (review-hero-attack.mjs) rather than from this offline harness.
 *
 * Read directly out of public/vendor/three.module.min.js (PropertyMixer.apply): a binding is only
 * written when the value just accumulated differs from the one the PREVIOUS apply() produced. Two
 * consecutive render frames with an unchanged action.time accumulate the identical pose, so the
 * second apply() is a silent no-op -- whatever locomotion wrote earlier THAT SAME frame (it runs
 * first and always advances) is what stays on screen. On the one render frame in three where
 * swingSeconds actually ticks, the value differs and the swing pose reasserts. That is AP1's exact
 * measurement: a real swing pose on the tick frame, a near-rest locomotion pose on the frames either
 * side of it, 19 alternations across one 1.5 s attack.
 *
 * THE FIX (swingClip.js): a render-rate visual clock, `visualSeconds`, that advances by real
 * deltaSeconds on every update() call regardless of whether swingSeconds changed, and is pulled
 * forward (never back) to swingSeconds whenever a fresh tick arrives. action.time is set from
 * visualSeconds, not swingSeconds directly, so it changes -- and the mixer keeps writing -- on every
 * single render frame.
 *
 * HOW THIS IS PROVEN HERE. A reference animator is driven by an UNQUANTIZED swingSeconds that
 * advances by exactly one render frame's worth every render frame -- what a genuinely 60 Hz-authoritative
 * swing would look like. The animator under test is driven by the SAME wall-clock time but with
 * swingSeconds QUANTIZED to SNAPSHOT_HZ, holding its value between ticks exactly as the online path
 * does. If the fix works, the two skeletons should stay close together throughout the swing --
 * `visualSeconds` extrapolating the held value is a good approximation of the true continuous one. If
 * the fix is reverted, the quantized animator repeatedly collapses toward the locomotion/idle pose on
 * every frame between ticks, and the divergence spikes to the same magnitude AP1 measured.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as THREE from '../public/vendor/three.module.min.js';
import { loadRigScene } from '../tools/foundry/glb_anim_scene.mjs';
import { createLocomotionController } from '../public/src/character/locomotion.js';
import { createClipSwingAnimator } from '../public/src/character/swingClip.js';
import { SWING_SECONDS } from '../public/src/combat/encounter.js';
import { SNAPSHOT_HZ } from '../public/src/net/protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HERO_GLB = join(HERE, '..', 'public', 'assets', 'hero', 'hero_lod1_ironwood_atlas.glb');
const RENDER_HZ = 60;
const FRAME = 1 / RENDER_HZ;

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

/** A rig driven by a real locomotion controller and a real clip swing animator, standing still. */
function buildRig() {
  const { root, animations, jointNames } = loadRigScene(HERO_GLB);
  const locomotion = createLocomotionController(root, animations);
  const swing = createClipSwingAnimator(root, animations);
  return { root, jointNames, locomotion, swing };
}

const STILL_FRAMES = 20;
const SWING_RENDER_FRAMES = Math.round(SWING_SECONDS / FRAME);
const FRAMES_PER_TICK = Math.round(RENDER_HZ / SNAPSHOT_HZ);

const reference = buildRig();
const quantized = buildRig();

let worstDuringSwing = 0;
let worstFrame = -1;
let tickSwingSeconds = 0;

for (let i = 0; i < STILL_FRAMES; i += 1) {
  reference.locomotion.update(FRAME, 0);
  reference.swing.update(-1, SWING_SECONDS, FRAME);
  quantized.locomotion.update(FRAME, 0);
  quantized.swing.update(-1, SWING_SECONDS, FRAME);
}

for (let i = 0; i <= SWING_RENDER_FRAMES; i += 1) {
  // Reference: swingSeconds advances every render frame, as true 60 Hz authority would.
  const continuousSwingSeconds = Math.min(SWING_SECONDS, i * FRAME);
  reference.locomotion.update(FRAME, 0);
  reference.swing.update(continuousSwingSeconds, SWING_SECONDS, FRAME);

  // Under test: swingSeconds only advances once every FRAMES_PER_TICK renders, exactly like a
  // client mirroring SNAPSHOT_HZ server snapshots while rendering at RENDER_HZ.
  if (i % FRAMES_PER_TICK === 0) tickSwingSeconds = continuousSwingSeconds;
  quantized.locomotion.update(FRAME, 0);
  quantized.swing.update(tickSwingSeconds, SWING_SECONDS, FRAME);

  const difference = maxJointDifference(
    poseOf(reference.root, reference.jointNames),
    poseOf(quantized.root, quantized.jointNames),
  );
  if (difference.metres > worstDuringSwing) {
    worstDuringSwing = difference.metres;
    worstFrame = i;
  }
}

test('a render loop faster than the authoritative tick tracks the true swing pose, not the flicker', () => {
  assert.ok(SWING_RENDER_FRAMES > FRAMES_PER_TICK * 3, 'the scenario needs several ticks inside one swing to mean anything');
  // AP1's measured flicker was on the order of 0.13 m at the head alone and well over 0.4 m at the
  // hand -- this tolerance is far under that, and far under the legitimate ~0.05 m/frame busiest
  // swing motion diagnose_swing_arbitration.mjs's own JUMP_METRES header derives. If the visual clock
  // regresses to setting action.time straight from the quantized value again, this fails by roughly
  // an order of magnitude, not narrowly.
  assert.ok(
    worstDuringSwing < 0.08,
    `quantized-input swing diverged from the true continuous swing by ${worstDuringSwing.toFixed(4)} m `
    + `at render frame ${worstFrame} -- the render-rate visual clock is not tracking authority`,
  );
});

test('the quantized swing never collapses back toward the standing/idle pose between ticks', () => {
  // A second, independent signal: an idle-only control with no swing at all. If the flicker were
  // present, some frame between ticks would land close to THIS rather than to the reference swing.
  const idleControl = buildRig();
  for (let i = 0; i < STILL_FRAMES + SWING_RENDER_FRAMES + 1; i += 1) {
    idleControl.locomotion.update(FRAME, 0);
    idleControl.swing.update(-1, SWING_SECONDS, FRAME);
  }
  const idlePose = poseOf(idleControl.root, idleControl.jointNames);
  const quantizedPose = poseOf(quantized.root, quantized.jointNames);
  const swingPose = poseOf(reference.root, reference.jointNames);

  const distanceToIdle = maxJointDifference(quantizedPose, idlePose).metres;
  const distanceToSwing = maxJointDifference(quantizedPose, swingPose).metres;
  assert.ok(
    distanceToSwing < distanceToIdle,
    `on the final sampled frame the quantized rig should read closer to the true swing pose `
    + `(${distanceToSwing.toFixed(4)} m) than to standing idle (${distanceToIdle.toFixed(4)} m)`,
  );
});
