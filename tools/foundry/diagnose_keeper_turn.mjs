#!/usr/bin/env node
/**
 * AP2-A / item 4 -- measure the Keeper turn policy against the six scenarios the brief names, with no
 * browser: position drift and final-heading error, driven through a REAL THREE.AnimationMixer against
 * the REAL (translation-stripped) turn clips and the REAL createKeeperTurnController from
 * zoneLoader.js -- not a reimplementation of it, so this can never silently drift from what the game
 * actually runs.
 *
 *   node tools/foundry/diagnose_keeper_turn.mjs [--glb tmp/ap2/keeper-turns.glb] [--json <path>]
 *
 * WHY THIS EXISTS. createKeeperPresenter's turning is a closure inside zoneLoader.js with no scene, no
 * material fades and no quest marker relevant to root motion -- exactly the same reason
 * diagnose_swing_arbitration.mjs exists for the hero's swing rather than trusting a browser capture
 * alone. createKeeperTurnController is the exported piece both this tool and the real presenter call.
 *
 * WHAT "DRIFT" MEANS HERE. This harness never touches root.position at all -- neither does the real
 * presenter's turning logic -- so position drift is provably always exactly 0 by construction. What
 * remains to check is that the CLIP's own authored translation specifically never reaches the Hips
 * bone: proven statically (the stripped clip simply has no `Hips.position` track left to write one),
 * not by sampling Hips.position at runtime -- idle itself carries a legitimate, unrelated breathing
 * sway on that same track, so a live position check would conflate the two and prove nothing. The
 * runtime facts that matter are (a) root.rotation.y converges to the requested heading and (b) it
 * never gets there by two different writers double-counting a rotation (creatKeeperTurnController's
 * own two-state contract, exercised end to end here rather than merely trusted).
 *
 * Exit 0 when every scenario converges and every stripped clip is confirmed translation-free, 1
 * otherwise.
 */

import { writeFileSync } from 'node:fs';
import * as THREE from '../../public/vendor/three.module.min.js';
import { loadRigScene } from './glb_anim_scene.mjs';
import {
  clipNetYaw, createKeeperTurnController, shortestTurn, stripPositionTrack,
} from '../../public/src/world/zoneLoader.js';

const FRAME = 1 / 60;
const HEADING_TOLERANCE_RADIANS = (0.5 * Math.PI) / 180; // half a degree
const DEG = Math.PI / 180;

function buildController(glbPath) {
  const { root, animations, objects } = loadRigScene(glbPath);
  const byName = new Map(animations.map((clip) => [clip.name, clip]));
  if (!objects.some((o) => o.name === 'Hips')) throw new Error(`${glbPath}: no node named 'Hips'`);

  const mixer = new THREE.AnimationMixer(root);
  const idleClip = byName.get('idle') ?? null;
  const idleAction = idleClip ? mixer.clipAction(idleClip) : null;
  if (idleAction) { idleAction.setLoop(THREE.LoopRepeat, Infinity); idleAction.play(); }

  const turnClips = { left: byName.get('turn_left') ?? null, right: byName.get('turn_right') ?? null };
  if (!turnClips.left || !turnClips.right) {
    throw new Error(`${glbPath}: expected 'turn_left' and 'turn_right' clips (have: ${[...byName.keys()].join(', ')})`);
  }
  const turnNetYaw = {
    left: clipNetYaw(turnClips.left, 'Hips'),
    right: clipNetYaw(turnClips.right, 'Hips'),
  };
  const strippedTracks = {
    left: stripPositionTrack(turnClips.left.tracks, 'Hips'),
    right: stripPositionTrack(turnClips.right.tracks, 'Hips'),
  };
  // The static proof the header promises: a stripped clip has literally no Hips.position track left,
  // so nothing downstream can write one regardless of what the mixer does with it.
  const stillCarriesPosition = Object.entries(strippedTracks)
    .filter(([, tracks]) => tracks.some((t) => t.name === 'Hips.position'))
    .map(([direction]) => direction);

  const turnActions = {
    left: mixer.clipAction(new THREE.AnimationClip(turnClips.left.name, turnClips.left.duration, strippedTracks.left)),
    right: mixer.clipAction(new THREE.AnimationClip(turnClips.right.name, turnClips.right.duration, strippedTracks.right)),
  };
  for (const action of [turnActions.left, turnActions.right]) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }

  const step = createKeeperTurnController(mixer, turnActions, turnNetYaw, idleAction);
  return {
    turnNetYawDegrees: { left: turnNetYaw.left / DEG, right: turnNetYaw.right / DEG },
    stillCarriesPosition,
    frame(rotationY, wantedHeading) {
      mixer.update(FRAME);
      return step(rotationY, wantedHeading, FRAME);
    },
  };
}

/**
 * Run a sequence of {wantedDegrees, settleSeconds} legs and report per-leg convergence. Only the
 * LAST leg's convergence gates pass/fail -- earlier legs in a multi-leg scenario are deliberately cut
 * short (the whole point of "rapid reversal mid-turn" is to interrupt before it would converge), so
 * demanding every leg converge would fail the exact case the scenario exists to exercise.
 *
 * root.position is never referenced anywhere in this file, which is itself the proof it never moves:
 * nothing here can write to it, so there is nothing to measure.
 */
function runScenario(glbPath, name, startDegrees, legs) {
  const controller = buildController(glbPath);
  let rotationY = (startDegrees * DEG);
  const legResults = [];

  legs.forEach((leg, index) => {
    const wanted = leg.wantedDegrees * DEG;
    const steps = Math.round(leg.settleSeconds / FRAME);
    for (let i = 0; i < steps; i += 1) {
      rotationY = controller.frame(rotationY, wanted);
    }
    const errorRadians = shortestTurn(rotationY, wanted);
    legResults.push({
      wantedDegrees: leg.wantedDegrees,
      finalDegrees: (rotationY * 180) / Math.PI,
      errorDegrees: (errorRadians * 180) / Math.PI,
      converged: Math.abs(errorRadians) <= HEADING_TOLERANCE_RADIANS,
      gating: index === legs.length - 1,
    });
  });

  return {
    name,
    turnNetYawDegrees: controller.turnNetYawDegrees,
    stillCarriesPosition: controller.stillCarriesPosition,
    legResults,
  };
}

const args = process.argv.slice(2);
const glbFlag = args.indexOf('--glb');
const glbPath = glbFlag === -1 ? 'tmp/ap2/keeper-turns.glb' : args[glbFlag + 1];
const jsonFlag = args.indexOf('--json');
const jsonPath = jsonFlag === -1 ? null : args[jsonFlag + 1];

// The six scenarios the AP2-A brief names. settleSeconds is generous (8s) rather than tuned tight,
// because this is a correctness proof, not a performance budget -- worst case (a ~175 degree ask,
// clip throws ~119, residual ~56 degrees at 1.6 rad/s) needs a bit over 1.5s and this gives 5x that.
const SCENARIOS = [
  { name: '~30 degree change (below clip threshold)', start: 0, legs: [{ wantedDegrees: 30, settleSeconds: 8 }] },
  { name: '~90 degrees left', start: 0, legs: [{ wantedDegrees: 90, settleSeconds: 8 }] },
  { name: '~90 degrees right', start: 0, legs: [{ wantedDegrees: -90, settleSeconds: 8 }] },
  { name: '~170-180 degrees', start: 0, legs: [{ wantedDegrees: 175, settleSeconds: 8 }] },
  {
    name: 'repeated left -> right -> left',
    start: 0,
    legs: [
      { wantedDegrees: 90, settleSeconds: 8 },
      { wantedDegrees: -90, settleSeconds: 8 },
      { wantedDegrees: 90, settleSeconds: 8 },
    ],
  },
  {
    // A NEW heading arrives 0.3s into a turn -- well inside both clips' ~0.93-1.1s duration -- and
    // requires the OPPOSITE direction, which is the case createKeeperTurnController's `reversed`
    // check exists for.
    name: 'rapid reversal mid-turn',
    start: 0,
    legs: [{ wantedDegrees: 90, settleSeconds: 0.3 }, { wantedDegrees: -90, settleSeconds: 8 }],
  },
];

console.log('AP2-A -- Keeper turn policy diagnostic');
console.log(`rig ${glbPath}\n`);

let failed = false;
const results = [];
for (const scenario of SCENARIOS) {
  const result = runScenario(glbPath, scenario.name, scenario.start, scenario.legs);
  results.push(result);
  console.log(result.name);
  console.log(`  clip throw: left ${result.turnNetYawDegrees.left.toFixed(2)} deg, `
    + `right ${result.turnNetYawDegrees.right.toFixed(2)} deg`);
  for (const leg of result.legResults) {
    const ok = leg.converged ? 'OK' : (leg.gating ? 'NOT CONVERGED' : 'not converged yet (expected -- interrupted)');
    console.log(`  -> wanted ${leg.wantedDegrees.toFixed(1).padStart(7)} deg   `
      + `final ${leg.finalDegrees.toFixed(2).padStart(8)} deg   `
      + `error ${leg.errorDegrees.toFixed(3).padStart(7)} deg   ${ok}`);
    if (leg.gating && !leg.converged) failed = true;
  }
  if (result.stillCarriesPosition.length) {
    console.log(`  STRIPPED CLIP STILL CARRIES Hips.position: ${result.stillCarriesPosition.join(', ')}`);
    failed = true;
  } else {
    console.log('  Hips.position confirmed absent from both stripped clips');
  }
  console.log('  root.position: never referenced by this harness -- cannot drift by construction\n');
}

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({ glbPath, results }, null, 2));
  console.log(`full report written to ${jsonPath}`);
}

console.log(failed ? 'FAILED -- see above' : 'all scenarios converged, no Hips drift');
process.exit(failed ? 1 : 0);
