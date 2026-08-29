// public/src/enemies/warden.js
//
// THE BEACON WARDEN: the corrupted guardian standing over the cold Beacon, as a body.
//
// THE BODY IS NOW THE OWNER'S REAL RIGGED GLB. It replaced a procedural box stand-in in BW1, and it
// arrived through exactly the seam this file's old header promised it would: `buildWarden`'s returned
// surface, the mode names and the exported constants are the contract, and NONE of them changed. The
// boxes were never the contract, so they are simply gone -- with them went `wardenParts()` and the
// palette/silhouette assertions that described them, because a test that pins the dimensions of
// deleted geometry is not a test, it is a fossil.
//
// WHAT THE ASSET ACTUALLY OWNS, measured from the file rather than hoped for (docs/pipeline's
// "measure the body/clip you will actually ship"): ONE attack clip, one walk and one run, on the
// standard 24-joint Meshy biped. That is three clips against the ten modes world/beaconSiege.js can
// publish, and it is the single fact that shapes everything below.
//
// So the drive is deliberately split in two:
//
//   * modes the asset HAS a clip for play that clip on its OWN rig (WARDEN_MODE_CLIPS);
//   * every other mode is posed at the GROUP level from wardenPose(), which already existed, is
//     already pure, and is already tested browserlessly.
//
// No Hero or Keeper clip is grafted on. The joint names happen to match those characters exactly --
// this is the same 24-joint Meshy biped -- and that is precisely the trap docs/pipeline/characters-npcs.md
// warns about: matching names are necessary but never sufficient, and borrowing a hero's walk to fill
// a boss's empty idle would be a lie about what this creature is. An empty mode holds its own rest
// pose instead.
//
// The group-level adapter is also a deliberate axis-safety choice. Meshy exports this rig with a
// rotated Armature (its Hips carry a large authored quaternion), so a bone's local X is NOT the
// character's pitch axis and "rotate the spine forward" cannot be typed from intuition -- it has to be
// measured. Leaning/sinking the whole body needs no such measurement, costs one Euler, and reads at
// gameplay distance, which is where this fight is actually judged. The cost is recorded honestly: the
// overhead's raised arms are the one silhouette that did not survive the swap, and the follow-up that
// wants it back owes a measured per-bone axis calibration first.
//
// WHAT THE PLAYTEST ASKED FOR, and what finally answered it. Real children, two on one server, were
// blunt about the box body: it "needs to look much cooler and actually look like an enemy" (#79).
// The stand-in answered that with a jagged crown, frost-spike shoulders, glowing eyes and an icy
// aura -- geometry and sprites bolted on to make a stack of boxes read as a threat. The real body
// makes all of that unnecessary, so it is gone: the eyes and the shoulder brazier were anchored to
// box coordinates that no longer exist, and re-siting a pale-cyan sprite onto a bronze-and-moss
// creature would make it read WORSE, not better. What survives is what is not decoration:
//
//   * THE PULSE RING, because the area it claims is gameplay information, not flourish;
//   * ONE whole-body aura, scaled off the body rather than off a deleted box, still carrying the
//     phase escalation so "this is getting more dangerous" is still said with light;
//   * the phase-3 seam emissive, now written onto the asset's own materials.
//
// Modes are still driven off (mode, modeSeconds, phase) and nothing else. The same contract
// enemies/wolf.js keeps with encounter.js: the rules own the timing and publish mode plus how long
// it has held; this file only reads it, so online (mirrored state) and offline (local rules) draw the
// same monster with no second source of truth. wardenPose() is pure and exported so every pose the
// rules can ask for is still assertable under plain `node --test`, with no browser and no GLB.

import * as THREE from '../../vendor/three.module.min.js';
import { clone as cloneSkinned } from '../../vendor/utils/SkeletonUtils.js';
import { CHARACTER, setLayer } from '../render/layers.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { prefersReducedMotion } from '../render/motionPreference.js';
import { normaliseCharacterMaterial } from '../character/hero.js';
import { loadGLB } from '../world/assets.js';
import { BEACON_GLOW_COLOR } from '../world/oldBeacon.js';

/** The shipped Warden body. Named for the ROLE, not for the provider's own asset name -- a source or
 *  vendor name is not a runtime identifier (docs/MISTAKES.md). Provenance lives in ASSET-LICENSES.md. */
export const WARDEN_URL = 'assets/enemies/beacon_warden.glb';

/**
 * The clips this asset actually contains, by their EXACT names in the file. Read out of the GLB with
 * `node tools/foundry/clip_inventory.mjs`, never guessed from what a boss "should" have -- the walk
 * really is called `Armature|walking_man|baselayer`, and a prettier name here would simply fail to
 * bind at runtime while looking correct in review.
 */
export const WARDEN_CLIPS = Object.freeze({
  walk: 'Armature|walking_man|baselayer',
  attack: 'attack_spin',
  run: 'run',
});

/**
 * Which fight mode plays which of the Warden's OWN clips.
 *
 * Both melee attacks map to the one attack clip the asset owns, because it owns exactly one and
 * inventing a second would mean grafting another character's motion onto this rig. The two attacks
 * stay mechanically distinct where it matters -- different reach arc, different contact timing,
 * different damage spread -- and the pulse keeps its ring as its own tell.
 *
 * Every mode ABSENT here has no native clip and is posed from wardenPose() at the group level. That
 * absence is the asset's, not an oversight: there is no idle, kneel, hit or death clip to play.
 */
export const WARDEN_MODE_CLIPS = Object.freeze({
  walk: WARDEN_CLIPS.walk,
  overhead: WARDEN_CLIPS.attack,
  sweep: WARDEN_CLIPS.attack,
});

// ── the body's numbers ────────────────────────────────────────────────────────────────────────────

// Head-top height. 2.6 m against the 1.48 m hero: 1.76x, unmistakably bigger without breaking the
// 6.1 m Beacon's own scale hierarchy -- the Warden must loom over the child and still stand UNDER
// the tower it failed to keep lit.
//
// This survived the body swap UNCHANGED, and that is load-bearing rather than lucky: main.js anchors
// the boss bar at WARDEN_HEIGHT_METERS + 0.32 by importing this very constant, so holding the height
// fixed and scaling the asset to it is what keeps the health/name plate on the Warden's head with no
// HUD change at all. The asset is authored at its own height; buildWarden measures that and divides.
export const WARDEN_HEIGHT_METERS = 2.6;

// How far the body sinks when wardenPose() fully compresses the legs (legs01 -> 0.6 at the kneel).
// The merged box body bent its knees by scaling one mesh; a skinned mesh cannot be squashed that way
// without deforming the whole creature, so the kneel is bought by DROPPING and FOLDING the body
// instead. At gameplay distance a huge shape hunched low over the seals reads as kneeling, which is
// the same trade the box version's own comment recorded making -- and the wake still visibly rises.
const CROUCH_SINK_METERS = 0.55;

// ── the timings the rules will mirror ─────────────────────────────────────────────────────────────

/** Rising from the kneel. Two seconds, eased at both ends -- a statue waking must never pop. */
export const WARDEN_WAKE_SECONDS = 2.0;
/** Overhead: a LONG readable windup, then a slam faster than the windup by an order of magnitude --
 *  the asymmetry (slow up, fast down) is what makes weight, same reason the walk bob is low-Hz. */
export const WARDEN_OVERHEAD_WINDUP_SECONDS = 1.1;
export const WARDEN_OVERHEAD_SLAM_SECONDS = 0.14;
export const WARDEN_OVERHEAD_HOLD_SECONDS = 0.35;
/** Sweep: wind right, swing left across the front arc. A different silhouette from the overhead --
 *  rotation where the overhead is elevation -- so a child can tell which dodge is being asked for. */
export const WARDEN_SWEEP_WIND_SECONDS = 0.42;
export const WARDEN_SWEEP_SWING_SECONDS = 0.26;
/** Pulse: compress while the brazier surges (the tell IS the light), then the cold ring. */
export const WARDEN_PULSE_CROUCH_SECONDS = 1.6;
export const WARDEN_PULSE_RING_SECONDS = 0.8;
export const WARDEN_PULSE_RING_RADIUS_METERS = 3.4;
export const WARDEN_HIT_SECONDS = 0.25;
/** Fold forward and sink into the ground. Longer than any attack: the death is the payoff of the
 *  whole arc and it has to be WATCHABLE, the same trade BRAMBLE_FALL_SECONDS records. */
export const WARDEN_DYING_SECONDS = 2.6;
/** Full stride cycles per second. Deliberately low -- a heavy thing takes slow steps, and the bob
 *  frequency is most of what "heavy" means at gameplay distance. */
export const WARDEN_GAIT_HZ = 0.55;

// ── the brazier's numbers ─────────────────────────────────────────────────────────────────────────

// Rest strength of the shoulder brazier. Below the gate lamp's lit 0.9 and below the Beacon stir's
// 0.62 -- the Warden CARRIES cold light, it is not a lantern -- but above the seals' 0.22 rest: it
// is the largest wrongness in the arc and reads as its centre.
export const WARDEN_BRAZIER_REST = 0.5;
export const WARDEN_BRAZIER_SIZE_METERS = 0.85;
// Phase 1/2/3 escalation, multiplied into every mode's strength: the fight getting more dangerous
// is said with the same light that says everything else in this game.
export const WARDEN_BRAZIER_BY_PHASE = [0.6, 0.8, 1.0];
// At phase 3 the accent seams catch: a faint cold emissive across the torso mesh, in the accent's
// own colour. Faint, because emissive here rims every facet edge the flat shading draws -- at 0.14
// it reads as frost light in the seams, above ~0.3 it reads as a ghost.
export const WARDEN_PHASE3_SEAM_GLOW = 0.14;

// ── the poses, pure ───────────────────────────────────────────────────────────────────────────────

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t) => { const c = clamp01(t); return c * c * (3 - 2 * c); };

function basePose() {
  return {
    visible: true,
    legs01: 1, // vertical compression of the legs mesh: 1 standing, less is bent knees
    rootY: 0, // extra sink of the whole body (dying)
    bobY: 0, // gait bob added to the torso
    torsoPitch: 0.06, // slight forward set even at rest -- a guardian, not a soldier at attention
    torsoYaw: 0,
    torsoRoll: 0,
    breath: 1,
    armPitchL: 0.08, // radians forward-and-up from hanging; PI is overhead
    armPitchR: 0.08,
    brazier: 1, // multiplier on the brazier's base strength
    ring: null, // { radius01, opacity } while the pulse ring is out
  };
}

// The kneel. One merged legs mesh cannot put one knee down, so the dormant read is bought with what
// the rig HAS: legs compressed, torso bowed deep, one fist forward as if resting on the raised knee.
// At gameplay distance that is a kneeling statue; the GLB will owe the real knee.
function dormantPose() {
  const pose = basePose();
  pose.legs01 = 0.6;
  pose.torsoPitch = 0.62;
  pose.armPitchR = 0.55;
  pose.armPitchL = 0.12;
  pose.brazier = 0.3; // faint -- a cold statue a child walks past and wonders about
  return pose;
}

function mixPoses(a, b, t) {
  const pose = basePose();
  for (const key of Object.keys(pose)) {
    if (typeof pose[key] === 'number') pose[key] = mix(a[key], b[key], t);
  }
  return pose;
}

/**
 * The Warden's whole pose as a pure function of (mode, modeSeconds) -- the one exported surface the
 * tests drive, and the reason no pose below needs a browser to prove. `reducedMotion` is threaded
 * as an argument rather than read here so the function stays pure; the presenter passes the live
 * preference per frame, the way wolf.js re-reads it per flash.
 */
export function wardenPose(mode, modeSeconds, reducedMotion = false) {
  const s = Number.isFinite(modeSeconds) ? Math.max(0, modeSeconds) : 0;
  const pose = basePose();

  switch (mode) {
    case 'dormant':
      return dormantPose();

    case 'waking': {
      // Under reduced motion the rise is skipped whole: the state change (kneeling -> standing)
      // still lands, only the movement is gone -- the Beacon stir's own contract.
      if (reducedMotion) { pose.brazier = 1; return pose; }
      const t = smooth(s / WARDEN_WAKE_SECONDS);
      const rising = mixPoses(dormantPose(), basePose(), t);
      // The brazier flares as it wakes: brightest mid-rise, settling to its standing rest.
      rising.brazier = mix(0.3, 1, t) + Math.sin(Math.PI * clamp01(s / WARDEN_WAKE_SECONDS)) * 0.6;
      return rising;
    }

    case 'idle': {
      if (reducedMotion) return pose;
      // Slow heavy breath: a hair of scale and a hair of rock, at well under 1 Hz.
      pose.breath = 1 + Math.sin(s * Math.PI * 2 * 0.22) * 0.015;
      pose.torsoPitch += Math.sin(s * Math.PI * 2 * 0.22 + 1) * 0.012;
      return pose;
    }

    case 'walk': {
      const swing = Math.sin(s * Math.PI * 2 * WARDEN_GAIT_HZ);
      // Arm counter-swing reads "walking" even under reduced motion; the bob and rock are the
      // nonessential flourish and are the part that gets skipped.
      pose.armPitchL = 0.08 + swing * 0.38;
      pose.armPitchR = 0.08 - swing * 0.38;
      if (!reducedMotion) {
        pose.torsoRoll = swing * 0.07;
        // FEET NEED WEIGHT: the bob bottoms out on each footfall, twice per stride, still slow.
        pose.bobY = Math.abs(Math.cos(s * Math.PI * 2 * WARDEN_GAIT_HZ)) * 0.045;
      }
      return pose;
    }

    case 'overhead': {
      const slamAt = WARDEN_OVERHEAD_WINDUP_SECONDS;
      const holdAt = slamAt + WARDEN_OVERHEAD_SLAM_SECONDS;
      const doneAt = holdAt + WARDEN_OVERHEAD_HOLD_SECONDS;
      if (s < slamAt) {
        const t = smooth(s / slamAt);
        pose.armPitchL = mix(0.08, 2.95, t);
        pose.armPitchR = mix(0.08, 2.95, t);
        pose.torsoPitch = mix(0.06, -0.18, t); // leans back under the raise
        pose.brazier = 1 + t * 0.3;
        return pose;
      }
      const slammed = basePose();
      slammed.armPitchL = 0.55;
      slammed.armPitchR = 0.55;
      slammed.torsoPitch = 0.42;
      if (s < holdAt) {
        // The slam itself: LINEAR, not eased -- eased would be gentle, and this is the contact.
        const t = (s - slamAt) / WARDEN_OVERHEAD_SLAM_SECONDS;
        pose.armPitchL = mix(2.95, 0.55, t);
        pose.armPitchR = mix(2.95, 0.55, t);
        pose.torsoPitch = mix(-0.18, 0.42, t);
        return pose;
      }
      if (s < doneAt) return slammed; // the brief hold: let the frame be read
      return mixPoses(slammed, basePose(), smooth((s - doneAt) / 0.3));
    }

    case 'sweep': {
      const swingAt = WARDEN_SWEEP_WIND_SECONDS;
      const doneAt = swingAt + WARDEN_SWEEP_SWING_SECONDS;
      const wound = basePose();
      wound.torsoYaw = -0.75; // wound to its right
      wound.torsoPitch = 0.2;
      wound.armPitchL = 1.05;
      wound.armPitchR = 1.05; // arms carried forward, the whole upper body is the blade
      if (s < swingAt) return mixPoses(basePose(), wound, smooth(s / swingAt));
      const swung = { ...wound, torsoYaw: 0.95 };
      if (s < doneAt) {
        const t = (s - swingAt) / WARDEN_SWEEP_SWING_SECONDS;
        return mixPoses(wound, swung, t); // linear again: the swing is the contact
      }
      return mixPoses(swung, basePose(), smooth((s - doneAt) / 0.4));
    }

    case 'pulse': {
      const ringAt = WARDEN_PULSE_CROUCH_SECONDS;
      if (s < ringAt) {
        const t = smooth(s / ringAt);
        pose.legs01 = mix(1, 0.78, t);
        pose.torsoPitch = mix(0.06, 0.32, t);
        pose.armPitchL = mix(0.08, 0.4, t);
        pose.armPitchR = mix(0.08, 0.4, t);
        pose.brazier = 1 + t * 1.4; // the surge IS the tell
        return pose;
      }
      const ringT = clamp01((s - ringAt) / WARDEN_PULSE_RING_SECONDS);
      const release = smooth(Math.min(1, ringT * 2.5));
      pose.legs01 = mix(0.78, 1, release);
      pose.torsoPitch = mix(0.32, 0.06, release);
      pose.brazier = mix(2.4, 1, ringT);
      if (ringT < 1) {
        // Reduced motion: the ring APPEARS at full size for a beat instead of scaling out -- the
        // area it claims is gameplay information and must not be lost with the animation.
        pose.ring = reducedMotion
          ? (ringT < 0.45 ? { radius01: 1, opacity: 0.55 } : null)
          : { radius01: 1 - (1 - ringT) * (1 - ringT), opacity: 1 - ringT };
      }
      return pose;
    }

    case 'hit': {
      const env = Math.sin(Math.PI * clamp01(s / WARDEN_HIT_SECONDS));
      pose.torsoPitch = 0.06 - env * 0.2; // a short flinch back
      pose.torsoRoll = env * 0.09;
      pose.brazier = 1 + env * 0.5;
      return pose;
    }

    case 'dying': {
      const t = clamp01(s / WARDEN_DYING_SECONDS);
      const fold = smooth(Math.min(1, t * 1.7)); // folds first, then keeps sinking
      pose.torsoPitch = mix(0.06, 1.25, fold);
      pose.legs01 = mix(1, 0.55, fold);
      pose.armPitchL = mix(0.08, 0.6, fold);
      pose.armPitchR = mix(0.08, 0.6, fold);
      pose.rootY = -(t * t) * 2.2; // into the ground it failed to guard
      pose.brazier = Math.max(0, 1 - t * 1.15); // the glow collapses to NOTHING before the body is gone
      return pose;
    }

    case 'dead':
      pose.visible = false;
      pose.brazier = 0;
      return pose;

    default:
      // An unknown mode is a standing Warden, not an exception -- the wolf's own fallback rule: a
      // monster standing still is a bug you can see and play past.
      return pose;
  }
}

// ── the presenter ─────────────────────────────────────────────────────────────────────────────────

/**
 * Prepare an independent, correctly-scaled, correctly-lit copy of the Warden body.
 *
 * Cloned with SkeletonUtils for the reason wolf.js states: `loadGLB` caches one GLTF scene, and a
 * presenter needs its OWN bones and its OWN materials or a phase-3 seam glow would tint every other
 * copy sharing the cached material. Geometry and textures stay shared, which is the cheap path.
 *
 * The scale is MEASURED, not typed. The asset is authored at its own height; dividing
 * WARDEN_HEIGHT_METERS by the measured bounding box means a re-export at a different size still lands
 * at exactly the height the boss bar and the fight already agree on, instead of silently drifting
 * behind a hard-coded factor that was only true on the day it was typed (GQ-007's "a literal that
 * only happens to satisfy a relationship is a snapshot of that relationship").
 */
function prepareWardenRoot(source) {
  const root = cloneSkinned(source);
  root.name = 'warden-body';
  // UPDATE THE MATRICES BEFORE MEASURING, and this line is the whole reason the first attempt at
  // this function shipped an invisible boss. A freshly cloned, not-yet-parented hierarchy still
  // carries stale world matrices, so Box3 measured this body as 0.023 m rather than its authored
  // 2.3 -- a clean factor of 100 out of the Armature's own 0.01 scale. The scale factor came back as
  // 113x instead of 1.13x, three.js happily submitted all 3,898 triangles every frame, and the
  // creature was skinned to a height of about 150 metres somewhere off camera. Nothing threw and no
  // console error was logged.
  root.updateMatrixWorld(true);
  const authored = new THREE.Box3().setFromObject(root);
  const authoredHeight = authored.max.y - authored.min.y;
  const scale = authoredHeight > 0 ? WARDEN_HEIGHT_METERS / authoredHeight : 1;
  root.scale.setScalar(scale);
  // The asset grounds at its own origin (feet at y = 0, measured), so no pivot correction is needed
  // -- but a body whose origin sat at its centre would bury half of itself, so this subtracts the
  // measured floor rather than assuming it is zero.
  root.position.y = -authored.min.y * scale;
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => material?.clone?.() ?? material);
    } else if (object.material?.clone) {
      object.material = object.material.clone();
    }
    // The same Meshy export defects the hero and the wolf both carried: an emissiveFactor of
    // [1,1,1] pointing at the base-colour atlas, and metallic/roughness omitted so glTF defaults
    // both to 1.0. Left alone the Warden renders as a white silhouette.
    for (const material of [].concat(object.material)) normaliseCharacterMaterial(material);
  });
  return { root, scale };
}

/**
 * Build the Warden and put it in the scene.
 *
 * @param scene the scene to add to
 * @param at    `[x, z]` where it stands (or kneels)
 * @returns `{ group, setMode(mode, modeSeconds, phase), setHeading(heading), setPosition(x, z),
 *            update(deltaSeconds), setBrazier(strength) }`
 *
 * ASYNC now, because the body is a fetched asset rather than boxes -- that is the one shape change
 * the swap forced on any caller, and world/zoneLoader.js already builds inside an async block. A
 * failed fetch still returns a working presenter: `loadGLB` resolves to a magenta placeholder rather
 * than rejecting, so the fight stays winnable and the missing body is loudly visible instead of
 * throwing during zone load.
 *
 * The presenter owns LOOKS only: the siege rules own which mode holds and for how long, and publish
 * (mode, modeSeconds, phase) the way encounter.js publishes the wolf's. setMode may be called every
 * frame with authoritative seconds or once per transition -- update() keeps its own clock between
 * calls, so either wiring draws the same monster.
 */
export async function buildWarden(scene, at) {
  const gltf = await loadGLB(WARDEN_URL);
  const group = new THREE.Group();
  group.name = 'beacon-warden';
  group.position.set(at[0], 0, at[1]);

  // Heading lives on `group`, body lean/sink on `body`. Split deliberately: folding a dying Warden
  // forward and turning it to face a child are different rotations about different axes, and putting
  // both on one object makes the result depend on Euler order rather than on either intent.
  const body = new THREE.Group();
  body.name = 'warden-body-pivot';
  group.add(body);

  const { root } = prepareWardenRoot(gltf.scene);
  body.add(root);

  // Every clip the asset actually shipped, bound by name. Attacks are one-shot and clamp on their
  // last frame so a slam holds instead of snapping back; the walk loops.
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map();
  for (const clip of gltf.animations ?? []) {
    const action = mixer.clipAction(clip);
    if (clip.name === WARDEN_CLIPS.walk || clip.name === WARDEN_CLIPS.run) {
      action.setLoop(THREE.LoopRepeat, Infinity);
    } else {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    actions.set(clip.name, action);
  }

  // Each material's OWN emissive, captured once so the phase-3 seam glow can be applied and removed
  // against whatever the asset actually authored rather than assuming black -- the same capture-then-
  // restore rule wolf.js's hit flash follows, and for the same reason: an authored glow must not be
  // silently erased the first time the boss changes phase.
  const seamTargets = [];
  root.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of [].concat(object.material)) {
      if (material?.emissive) seamTargets.push({ base: material.emissive.clone(), material });
    }
  });

  // THE ICY AURA. One big soft additive quad hanging around the whole body, sized off the body rather
  // than off any deleted box. Parented to `group`, not `body`: a fold or a lean must not drag the
  // whole-body aura sideways, the same reason the pulse ring below is parented to `group` too.
  const aura = createGlowSprite(BEACON_GLOW_COLOR, WARDEN_HEIGHT_METERS * 1.05, 'mote');
  aura.name = 'warden-aura';
  aura.position.y = WARDEN_HEIGHT_METERS * 0.42;
  group.add(aura);

  // The pulse ring: unit outer radius, scaled out to WARDEN_PULSE_RING_RADIUS_METERS while it plays.
  // Additive and depthWrite-off like every light in this game, basic rather than standard because an
  // expanding shockwave must not pick up scene lighting.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1, 32),
    new THREE.MeshBasicMaterial({
      color: BEACON_GLOW_COLOR,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.name = 'warden-pulse-ring';
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.visible = false;
  group.add(ring);

  setLayer(group, CHARACTER);
  scene.add(group);

  let mode = 'dormant';
  let modeClock = 0;
  let phase = 1;
  let brazierBase = WARDEN_BRAZIER_REST;
  let auraClock = 0;
  let playing = null;

  function applyPhaseSeams() {
    for (const { base, material } of seamTargets) {
      if (phase >= 3) {
        material.emissive.set(BEACON_GLOW_COLOR).multiplyScalar(WARDEN_PHASE3_SEAM_GLOW);
      } else {
        material.emissive.copy(base);
      }
    }
  }

  /**
   * Play the clip this mode owns, or stop clips entirely when it owns none.
   *
   * Restarted only on a CHANGE of clip, never every frame: `setMode` is documented as safe to call
   * per-frame with authoritative seconds, and resetting an action every frame would freeze it on its
   * first frame forever -- an attack that never advances while every state check still reads correct.
   */
  function selectClip(nextMode) {
    const wanted = WARDEN_MODE_CLIPS[nextMode] ?? null;
    if (wanted === playing) return;
    if (playing && actions.has(playing)) actions.get(playing).stop();
    playing = wanted;
    if (wanted && actions.has(wanted)) actions.get(wanted).reset().play();
  }

  return {
    group,
    /** The rules publish (mode, how long it has held, phase). Safe to call every frame. */
    setMode(nextMode, modeSeconds = 0, nextPhase = phase) {
      if (nextMode !== mode) {
        mode = nextMode;
        selectClip(nextMode);
      }
      modeClock = Number.isFinite(modeSeconds) ? modeSeconds : 0;
      if (nextPhase !== phase) {
        phase = nextPhase;
        applyPhaseSeams();
      }
    },
    setHeading(heading) {
      group.rotation.y = heading;
    },
    setPosition(x, z) {
      group.position.x = x;
      group.position.z = z;
    },
    /** Direct cold-light override for the integrator (e.g. dim it while a seal still holds). The
     *  phase gain and the mode's own surge multiply on top of this base. */
    setBrazier(strength) {
      brazierBase = clamp01(strength);
    },
    update(deltaSeconds) {
      modeClock += deltaSeconds;
      const pose = wardenPose(mode, modeClock, prefersReducedMotion());
      group.visible = pose.visible;
      if (!pose.visible) {
        setGlowStrength(aura, 0);
        ring.visible = false;
        return;
      }

      mixer.update(deltaSeconds);

      // Group-level pose. Applied for every mode, including the ones a clip is driving: `rootY` and
      // the sink are world placement rather than animation, and wardenPose leaves both at rest for
      // walk and the attacks, so a clip is never fought for control of the same value.
      group.position.y = pose.rootY;
      body.position.y = -(1 - pose.legs01) * CROUCH_SINK_METERS;
      if (playing) {
        // A clip owns the body's own motion; leaning the whole creature on top of it would double
        // every lean the animator already authored.
        body.rotation.set(0, 0, 0);
      } else {
        body.rotation.set(pose.torsoPitch, pose.torsoYaw, pose.torsoRoll);
      }

      const gain = WARDEN_BRAZIER_BY_PHASE[Math.min(WARDEN_BRAZIER_BY_PHASE.length, Math.max(1, phase)) - 1];
      auraClock += deltaSeconds;
      const shimmer = prefersReducedMotion() ? 0 : Math.sin(auraClock * Math.PI * 2 * 0.18) * 0.05;
      // The aura carries what the shoulder brazier used to: the mode's own surge (pose.brazier is the
      // pulse's tell), the phase escalation, and the integrator's base.
      setGlowStrength(aura, clamp01(brazierBase * gain * pose.brazier * 0.3 + shimmer));

      if (pose.ring) {
        ring.visible = true;
        const radius = Math.max(0.001, pose.ring.radius01) * WARDEN_PULSE_RING_RADIUS_METERS;
        ring.scale.set(radius, radius, 1);
        ring.material.opacity = pose.ring.opacity;
      } else {
        ring.visible = false;
      }
    },
    /**
     * For a harness.
     *
     * `headMeters` is the world height of the rig's own `Head` BONE, and it exists because the first
     * version of this presenter scaled the body 113x and put it 150 m in the air, where every state
     * check still read perfectly and the whole siege harness passed against a boss nobody could see.
     * A bone is the right authority for that question: Box3 over a skinned mesh reports the geometry
     * box under the mesh's matrix, which stayed reassuringly ~2.6 m while the bones that actually
     * place the vertices were two orders of magnitude away. Derived from the live scene graph rather
     * than from the scale factor, so it cannot agree with the bug that produced it.
     */
    getState() {
      const head = root.getObjectByName('Head');
      return {
        mode,
        modeSeconds: modeClock,
        phase,
        clip: playing,
        headMeters: head ? head.getWorldPosition(new THREE.Vector3()).y : null,
      };
    },
  };
}
