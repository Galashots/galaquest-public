#!/usr/bin/env node
/**
 * AP1 / Finding 3 -- characterise the hero attack defect the owner saw as the character "flashing in and
 * out of reality" during a playtest.
 *
 *   node tools/foundry/diagnose_swing_arbitration.mjs [--frames-around N] [--json <path>]
 *
 * IT LIVES IN tools/foundry AND NOT IN tools/runtime-test, deliberately. Everything in
 * `tools/runtime-test/` drives a real browser and is enrolled in the shared review suites
 * (`review-suites.mjs`, pinned by `test/review-suite.test.mjs`). This opens no browser, needs no
 * server, and is an instrument for inspecting a rig -- the same job as `pose_anatomy.mjs` and
 * `verify_native_clip.mjs`, which are its neighbours here.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. It is a mixer-arbitration instrument. It drives the three REAL
 * character modules -- locomotion.js, reactClips.js, swingClip.js -- over the REAL hero rig and the
 * REAL clips, in the REAL order main.js updates them, and records where every joint ended up on
 * every frame. It runs in plain Node with no browser, which is the point: the hypothesis under test
 * is about three.js's AnimationMixer bookkeeping, and that bookkeeping is identical with or without
 * a renderer.
 *
 * It is NOT a visual proof and cannot become one. AGENTS.md is explicit that a claim about how the
 * game LOOKS comes from the running game. What this can establish is mechanical: whether the
 * skeleton is being driven to a pose it should never hold, on which frame, and by which of the three
 * writers. That is the half a screenshot is worst at and a harness is best at.
 *
 * THE HYPOTHESIS (from the AP1 brief). three.js r170's AnimationMixer saves each bound property's
 * value the first time an action activates it (`PropertyMixer.saveOriginalState`, via
 * `_activateAction`) and writes that saved value BACK when the last action using it deactivates
 * (`restoreOriginalState`, via `_deactivateAction`). Three mixers share one skeleton here, so a
 * mixer that stops can restore a pose captured many frames earlier, over the top of whatever the
 * other two just wrote. Ordering -- locomotion, then reactions, then swing -- is the only thing
 * arbitrating them.
 *
 * WHAT IT MEASURES, chosen to separate the candidate causes the brief lists rather than to confirm
 * one of them:
 *   - `visible` on every node          -> is the character actually being hidden?
 *   - the Armature's world position    -> is the whole rig jumping out of frame?
 *   - the Armature's world scale       -> is the rig collapsing or exploding?
 *   - each joint's world position      -> is the POSE jumping while the rig stays put?
 *   - the gear anchors' world position -> is the sword moving independently of the hand?
 * A frame is reported when any joint moves further in one frame than a human limb can, which is
 * what "flashing" would have to look like to a skeleton.
 *
 * Exit code 0 when no anomaly is found, 1 when one is. That makes it usable as a gate later; today
 * it is a diagnostic, and the report is the product.
 */

import { writeFileSync } from 'node:fs';
import * as THREE from '../../public/vendor/three.module.min.js';
import { loadRigScene } from './glb_anim_scene.mjs';
import { createLocomotionController } from '../../public/src/character/locomotion.js';
import { createReactionAnimator } from '../../public/src/character/reactClips.js';
import { createClipSwingAnimator } from '../../public/src/character/swingClip.js';
import { SWING_SECONDS, RESPAWN_SECONDS } from '../../public/src/combat/encounter.js';
import { SNAPSHOT_HZ } from '../../public/src/net/protocol.js';

const HERO_GLB = 'public/assets/hero/hero_lod1_ironwood_atlas.glb';
const FRAME = 1 / 60;

/**
 * How far a joint may travel in one 60 Hz frame before we call it a jump, in metres of world space.
 *
 * Not a taste threshold. The hero is 1.479 m tall and a hand at full swing speed covers well under
 * 0.1 m per frame -- the whole `sword_slash` arc is about 1.2 m of hand travel over 1.5 s at
 * authored speed, and the runtime compresses it into 1.5 s of rules time, so ~0.05 m/frame is the
 * busiest legitimate frame in the game. 0.25 m in one frame is a sixth of the character's height
 * moving between two adjacent frames: not a fast animation, a discontinuity.
 */
const JUMP_METRES = 0.25;

/** Bones whose world position is sampled. All 24, because a defect that spares one is still a defect. */
function sampleSkeleton(root, jointNames, gearNames) {
  root.updateMatrixWorld(true);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  const joints = {};
  for (const name of jointNames) {
    const node = root.getObjectByName(name);
    node.matrixWorld.decompose(position, quaternion, scale);
    joints[name] = position.toArray();
  }
  const gear = {};
  for (const name of gearNames) {
    const node = root.getObjectByName(name);
    if (!node) continue;
    node.matrixWorld.decompose(position, quaternion, scale);
    gear[name] = position.toArray();
  }

  const armature = root.getObjectByName('Armature');
  armature.matrixWorld.decompose(position, quaternion, scale);

  let hidden = 0;
  root.traverse((object) => { if (!object.visible) hidden += 1; });

  return {
    joints,
    gear,
    armatureWorldPosition: position.toArray(),
    armatureWorldScale: scale.toArray(),
    hiddenNodeCount: hidden,
  };
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The largest single-frame movement of any joint, and which joint it was. */
function biggestJump(previous, next) {
  let worst = { joint: null, metres: 0 };
  for (const name of Object.keys(next.joints)) {
    const metres = distance(previous.joints[name], next.joints[name]);
    if (metres > worst.metres) worst = { joint: name, metres };
  }
  return worst;
}

/**
 * One frame of main.js's animation block, in main.js's order and with main.js's two conditionals.
 *
 * The `heroIsDown` locomotion skip is not an embellishment: main.js deliberately does not call
 * locomotion while the hero is down, because a full idle pose written every frame is what used to
 * erase the death clip. Reproducing the defect requires reproducing that asymmetry.
 *
 * The reactions/swing SWAP while down is AP2-A's fix for the death-mid-swing stale restore (see
 * swingClip.js's header and main.js's own comment at the same call site): running swing first means
 * any stale restoreOriginalState lands before reactions writes the death pose, so death's write
 * survives the frame. Not swapped while up, so an ordinary hit-flinch still loses to an active swing.
 */
function stepFrame({ locomotion, reactions, swing }, { groundSpeed, hero }) {
  const heroIsDown = hero.downSeconds >= 0;
  if (!heroIsDown) locomotion.update(FRAME, groundSpeed);
  if (heroIsDown) {
    swing.update(hero.swingSeconds, SWING_SECONDS, FRAME);
    reactions?.update(FRAME, hero);
  } else {
    reactions?.update(FRAME, hero);
    swing.update(hero.swingSeconds, SWING_SECONDS, FRAME);
  }
}

/**
 * Scenarios are plain frame scripts: each entry says what the world looked like on that frame.
 * Written as data so the report can name the exact frame and so a scenario can be replayed.
 */
function scenarioFrames(name) {
  const frames = [];
  const still = (count, extra = {}) => {
    for (let i = 0; i < count; i += 1) {
      frames.push({ groundSpeed: 0, hero: { swingSeconds: -1, downSeconds: -1 }, ...extra });
    }
  };
  const walk = (count, speed = 1.6) => {
    for (let i = 0; i < count; i += 1) {
      frames.push({ groundSpeed: speed, hero: { swingSeconds: -1, downSeconds: -1 } });
    }
  };
  /** One full swing, driven the way the rules drive it: 0 -> SWING_SECONDS, then back to -1. */
  const swingOnce = (groundSpeed = 0) => {
    const steps = Math.round(SWING_SECONDS / FRAME);
    for (let i = 0; i <= steps; i += 1) {
      frames.push({ groundSpeed, hero: { swingSeconds: Math.min(SWING_SECONDS, i * FRAME), downSeconds: -1 } });
    }
  };

  switch (name) {
    // The brief's first case: repeated attacks from idle. Three in a row, because a defect in the
    // activate/deactivate pair only shows on the SECOND activation -- the first has nothing stale
    // to restore.
    case 'repeated-attacks-from-idle':
      still(30);
      for (let i = 0; i < 3; i += 1) { swingOnce(0); still(20); }
      break;

    // Attack immediately after locomotion stops, and immediately after it starts. This is the case
    // where locomotion's own crossfade and arm settle are mid-blend when the swing activates.
    case 'attack-on-stop-and-start':
      still(20);
      walk(40);
      still(2);          // stopped one frame ago: crossfade and settle both mid-blend
      swingOnce(0);
      still(20);
      walk(2);           // started one frame ago
      swingOnce(1.6);
      walk(20);
      still(20);
      break;

    // Attack with a hit reaction in flight. triggerHit is REFUSED while swinging (the owner's precedence
    // rule), so the reproducible ordering is hit first, swing immediately after -- which is exactly
    // the transition where the reaction mixer is still writing and the swing mixer activates.
    case 'attack-during-hit-reaction':
      still(30);
      frames.push({ groundSpeed: 0, hero: { swingSeconds: -1, downSeconds: -1 }, triggerHit: true });
      still(6);
      swingOnce(0);
      still(30);
      break;

    // Going down mid-swing. main.js stops calling locomotion the moment downSeconds >= 0, so this is
    // the one case where the swing mixer's restore lands with no locomotion write underneath it.
    case 'down-mid-swing': {
      still(30);
      const steps = Math.round(SWING_SECONDS / FRAME);
      for (let i = 0; i <= steps; i += 1) {
        const swingSeconds = Math.min(SWING_SECONDS, i * FRAME);
        // Down from a third of the way through the swing onward.
        const downSeconds = i > steps / 3 ? (i - Math.floor(steps / 3)) * FRAME : -1;
        frames.push({ groundSpeed: 0, hero: { swingSeconds, downSeconds } });
      }
      for (let i = 0; i < Math.round(RESPAWN_SECONDS / FRAME); i += 1) {
        frames.push({ groundSpeed: 0, hero: { swingSeconds: -1, downSeconds: RESPAWN_SECONDS * 0.9 } });
      }
      still(40);
      break;
    }

    // AP2-A / THE FLICKER. Every scenario above updates hero.swingSeconds on EVERY simulated frame,
    // which is what the rules tick actually does OFFLINE -- and why this file never caught a defect
    // AP1 proved in the browser. Online, hero.swingSeconds is mirrored from the server's snapshot
    // (net/protocol.js SNAPSHOT_HZ, 10 Hz) and simply holds its value between snapshots while the
    // render loop keeps calling this update() at up to 60 Hz. This is the scenario that actually
    // reproduces that gap: 60 Hz frames, a swingSeconds value that only advances once every
    // 60/SNAPSHOT_HZ frames and sits frozen the rest of the time -- exactly what a real online swing
    // looks like from swingClip.js's point of view.
    case 'render-faster-than-authoritative-tick': {
      still(20);
      const framesPerTick = Math.round(60 / SNAPSHOT_HZ);
      const steps = Math.round(SWING_SECONDS / FRAME);
      let tickSwingSeconds = 0;
      for (let i = 0; i <= steps; i += 1) {
        if (i % framesPerTick === 0) tickSwingSeconds = Math.min(SWING_SECONDS, i * FRAME);
        frames.push({ groundSpeed: 0, hero: { swingSeconds: tickSwingSeconds, downSeconds: -1 } });
      }
      still(20);
      break;
    }
    default:
      throw new Error(`unknown scenario ${name}`);
  }
  return frames;
}

function runScenario(name, framesAround) {
  const { root, animations, jointNames } = loadRigScene(HERO_GLB);
  const gearNames = ['sword_ironwood', 'shield_ironwood'];

  const locomotion = createLocomotionController(root, animations);
  const reactions = createReactionAnimator(root, animations);
  const swing = createClipSwingAnimator(root, animations);
  if (!swing) throw new Error('hero ships no sword_slash clip -- this diagnostic has nothing to test');

  const frames = scenarioFrames(name);
  const samples = [];
  const anomalies = [];
  let previous = sampleSkeleton(root, jointNames, gearNames);

  frames.forEach((frame, index) => {
    if (frame.triggerHit) reactions?.triggerHit({ swinging: swing.isSwinging() });
    stepFrame({ locomotion, reactions, swing }, frame);
    const sample = sampleSkeleton(root, jointNames, gearNames);
    const jump = biggestJump(previous, sample);

    samples.push({
      frame: index,
      swingSeconds: frame.hero.swingSeconds,
      downSeconds: frame.hero.downSeconds,
      groundSpeed: frame.groundSpeed,
      swinging: swing.isSwinging(),
      worstJointJumpMetres: jump.metres,
      worstJoint: jump.joint,
      armatureWorldScale: sample.armatureWorldScale,
      hiddenNodeCount: sample.hiddenNodeCount,
    });

    if (jump.metres > JUMP_METRES) {
      anomalies.push({
        scenario: name,
        frame: index,
        joint: jump.joint,
        metres: jump.metres,
        swingSeconds: frame.hero.swingSeconds,
        downSeconds: frame.hero.downSeconds,
        groundSpeed: frame.groundSpeed,
        swingingNow: swing.isSwinging(),
      });
    }
    previous = sample;
  });

  // Context around each anomaly, so a reader can see what the frames either side were doing.
  const context = anomalies.map((anomaly) => ({
    anomaly,
    frames: samples.slice(
      Math.max(0, anomaly.frame - framesAround),
      Math.min(samples.length, anomaly.frame + framesAround + 1),
    ),
  }));

  return { name, frameCount: frames.length, samples, anomalies, context };
}

const args = process.argv.slice(2);
const framesAround = Number(args[args.indexOf('--frames-around') + 1]) || 3;
const jsonPath = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const SCENARIOS = [
  'repeated-attacks-from-idle',
  'attack-on-stop-and-start',
  'attack-during-hit-reaction',
  'down-mid-swing',
  'render-faster-than-authoritative-tick',
];

console.log('AP1 Finding 3 -- hero attack mixer-arbitration diagnostic');
console.log(`rig ${HERO_GLB}`);
console.log(`three.js r${THREE.REVISION}, ${SCENARIOS.length} scenarios, jump threshold ${JUMP_METRES} m/frame\n`);

const results = SCENARIOS.map((name) => runScenario(name, framesAround));
let total = 0;

for (const result of results) {
  const worst = result.samples.reduce((a, b) => (b.worstJointJumpMetres > a.worstJointJumpMetres ? b : a));
  const hidden = result.samples.some((s) => s.hiddenNodeCount > 0);
  const scaleRange = result.samples.reduce((acc, s) => {
    const value = s.armatureWorldScale[0];
    return [Math.min(acc[0], value), Math.max(acc[1], value)];
  }, [Infinity, -Infinity]);

  total += result.anomalies.length;
  console.log(`${result.name}`);
  console.log(`  frames                 ${result.frameCount}`);
  console.log(`  worst joint jump       ${worst.worstJointJumpMetres.toFixed(4)} m `
    + `(${worst.worstJoint}, frame ${worst.frame})`);
  console.log(`  armature world scale   ${scaleRange[0].toFixed(6)} .. ${scaleRange[1].toFixed(6)}`);
  console.log(`  any node hidden        ${hidden ? 'YES' : 'no'}`);
  console.log(`  anomalies (> ${JUMP_METRES} m) ${result.anomalies.length}`);
  for (const anomaly of result.anomalies.slice(0, 6)) {
    console.log(`      frame ${String(anomaly.frame).padStart(4)}  ${anomaly.joint.padEnd(14)}`
      + ` ${anomaly.metres.toFixed(4)} m   swingSeconds=${anomaly.swingSeconds.toFixed(3)}`
      + ` down=${anomaly.downSeconds.toFixed(2)} speed=${anomaly.groundSpeed}`);
  }
  if (result.anomalies.length > 6) console.log(`      ... and ${result.anomalies.length - 6} more`);
  console.log('');
}

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({ threshold: JUMP_METRES, results }, null, 2));
  console.log(`full per-frame record written to ${jsonPath}`);
}

console.log(total
  ? `${total} anomal${total === 1 ? 'y' : 'ies'} across ${results.length} scenarios`
  : `no anomaly above ${JUMP_METRES} m/frame in any scenario`);
process.exit(total ? 1 : 0);
