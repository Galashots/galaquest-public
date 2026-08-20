// public/src/enemies/warden.js
//
// THE BEACON WARDEN: the corrupted guardian standing over the cold Beacon, as a body.
//
// THIS BODY IS A STAND-IN. The Warden's logical identity is 'beacon_warden' and it is stable; the
// geometry below is a procedural placeholder built from the owner's canonical brief, and a generated
// GLB (Meshy, owner-authorised spend only -- AGENTS.md) may replace it later WITHOUT the presenter
// API in this file changing. Everything the game wires against -- buildWarden's returned surface,
// the mode names, the exported constants -- is the contract; the boxes are not.
//
// The brief, binding (owner's canonical art direction):
//   stylized low-poly humanoid corrupted guardian. Broad chest and shoulders, SHORT neck, LONG
//   arms, narrower legs, planted heavy stance. Weathered dark iron, ash-grey stone, aged timber.
//   EXACTLY ONE cold pale-cyan accent: the asymmetrical shoulder-mounted beacon housing on its
//   LEFT shoulder -- a thick iron box and a small open cresset echoing the Old Beacon's own basket,
//   so a child reads the kinship before anyone explains it. No antlers, no cape, no chains, no
//   floating parts, no thin filigree, no weapon (the maul is a later separate asset; the arms end
//   in heavy stone-gauntlet fists). ~2.6 m against the 1.48 m hero.
//
// Every colour is imported, none restated (docs/MISTAKES.md GQ-007): the Warden is built from the
// Beacon's own iron and stone and the Wildwood Gate's own timber, because it is a thing the same
// world made -- a guardian assembled from the materials of the places it guards.
//
// FOUR DRAW CALLS PLUS THE GLOW, and the four are justified: everything static in this game merges
// to one call (oldBeacon.js's whole tower is one mesh), but this is the one built structure in the
// game that ANIMATES, and limbs that move independently cannot share a geometry with the trunk they
// move against. So: legs+pelvis merged to one mesh, torso+head+shoulder-housing to one, each arm to
// one -- the minimum split that still lets the poses below read. The pulse ring is a fifth mesh that
// is visible only for the fraction of a second the pulse attack needs it.
//
// Modes are driven PROCEDURALLY off (mode, modeSeconds) -- no clips, because there is no rig. The
// same contract enemies/wolf.js keeps with encounter.js: the rules own the timing and publish mode
// plus how long it has held; this file only reads it, so online (mirrored state) and offline (local
// rules) draw the same monster with no second source of truth. wardenPose() is pure and exported so
// every pose the rules can ask for is assertable under plain `node --test`.

import * as THREE from '../../vendor/three.module.min.js';
import { mergeGeometries } from '../../vendor/utils/BufferGeometryUtils.js';
import { CHARACTER, setLayer } from '../render/layers.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { prefersReducedMotion } from '../render/motionPreference.js';
import {
  BEACON_GLOW_COLOR,
  BEACON_IRON_COLOR,
  BEACON_STONE_COLOR,
} from '../world/oldBeacon.js';
import { GATE_WOOD_COLOR } from '../world/wildwoodGate.js';
import { bakePart } from '../world/coldSeals.js';

// ── the body's numbers ────────────────────────────────────────────────────────────────────────────

// Head-top height. 2.6 m against the 1.48 m hero: 1.76x, unmistakably bigger without breaking the
// 6.1 m Beacon's own scale hierarchy -- the Warden must loom over the child and still stand UNDER
// the tower it failed to keep lit. The brazier cresset rides a little above this, the way the
// Beacon's own widest point is its top.
export const WARDEN_HEIGHT_METERS = 2.6;
// Where the torso rotates from -- inside the hip mass, so bows and sweeps hinge where a body does.
const TORSO_PIVOT_Y = 1.42;
// The left shoulder, where the brazier lives. Character faces local +Z, so its own left is +X.
const BRAZIER_X = 0.7;
const SHOULDER_LOCAL_Y = 0.78; // torso-local; world 2.2 when standing
const ARM_LENGTH_METERS = 1.4; // shoulder to fist bottom -- LONG: fists hang by the knees

/**
 * Every part of the Warden, split by the sub-mesh it merges into. Coordinates:
 *   legs      group-local, y = 0 the ground
 *   torso     local to the torso pivot (TORSO_PIVOT_Y up when standing)
 *   armLeft / armRight   local to their shoulder pivot, hanging down -Y
 * Exported so the silhouette the brief demands -- height band, shoulders over hips, one accent, one
 * shoulder -- is assertable without a browser. Same split oldBeacon.js's beaconParts() makes.
 */
export function wardenParts() {
  const iron = BEACON_IRON_COLOR;
  const stone = BEACON_STONE_COLOR;
  const wood = GATE_WOOD_COLOR;

  const legs = [{ name: 'pelvis', kind: 'box', size: [0.88, 0.34, 0.48], at: [0, 1.36, 0], color: iron }];
  for (const side of [1, -1]) {
    // Narrower than the chest, heavier than a man's: the planted stance is FEET, wide and flat.
    legs.push({ name: 'thigh', kind: 'box', size: [0.36, 0.55, 0.4], at: [side * 0.3, 0.98, 0], color: stone });
    legs.push({ name: 'shin', kind: 'box', size: [0.3, 0.55, 0.34], at: [side * 0.31, 0.45, 0], color: iron });
    legs.push({ name: 'foot', kind: 'box', size: [0.46, 0.18, 0.62], at: [side * 0.31, 0.09, 0.08], color: stone });
  }

  const torso = [
    { name: 'belly', kind: 'box', size: [0.92, 0.5, 0.56], at: [0, 0.18, 0], color: stone },
    // The broad chest -- the widest soft-part of the silhouette, iron over stone.
    { name: 'chest', kind: 'box', size: [1.16, 0.56, 0.68], at: [0, 0.62, 0.02], color: iron },
    // Aged timber: a carrying yoke across the back and a belt beam, the gate's own wood. Somebody
    // BUILT this thing, and timber lashed to iron says so the way the Beacon's brace does.
    { name: 'yoke', kind: 'box', size: [1.3, 0.18, 0.12], at: [0, 0.74, -0.36], color: wood },
    { name: 'belt', kind: 'box', size: [0.96, 0.16, 0.1], at: [0, -0.04, 0.3], color: wood },
    { name: 'pauldron', kind: 'box', size: [0.42, 0.28, 0.52], at: [BRAZIER_X, 0.86, 0], color: iron },
    { name: 'pauldron', kind: 'box', size: [0.42, 0.28, 0.52], at: [-BRAZIER_X, 0.86, 0], color: iron },
    // SHORT neck: the head sits 0.06 m INTO the chest top, no neck part at all. Head top is the
    // 2.6 m the constant states.
    { name: 'head', kind: 'box', size: [0.34, 0.34, 0.38], at: [0, 1.01, 0.06], color: stone },
    // The brazier: thick iron box, then a small OPEN cresset flaring upward -- openEnded and wider
    // at the top, the Old Beacon's basket in miniature (oldBeacon.js reference rule 1: a beacon is
    // identified by its cresset). One shoulder only. Asymmetry is the brief's word, not a whim.
    { name: 'brazier-housing', kind: 'box', size: [0.36, 0.26, 0.36], at: [BRAZIER_X, 1.13, 0], color: iron },
    {
      name: 'brazier-cresset',
      kind: 'cylinder',
      radiusBottom: 0.12,
      radiusTop: 0.18,
      height: 0.18,
      openEnded: true,
      at: [BRAZIER_X, 1.33, 0],
      color: iron,
      radialSegments: 8,
    },
    // THE ONE ACCENT. The cold coal in the cresset, in the Beacon halo's own colour -- the only
    // pale-cyan part on the whole body, and the glow sprite sits right on it.
    {
      name: 'brazier-ember',
      kind: 'cylinder',
      radiusBottom: 0.11,
      radiusTop: 0.11,
      height: 0.07,
      at: [BRAZIER_X, 1.31, 0],
      color: BEACON_GLOW_COLOR,
      radialSegments: 8,
    },
  ];

  // LONG arms, iron over timber-splinted forearms, ending in stone-gauntlet fists (no weapon --
  // the maul is a later separate asset). Both arms are the same build; the asymmetry lives on the
  // shoulder, not in the limbs.
  const arm = [
    { name: 'upper-arm', kind: 'box', size: [0.3, 0.62, 0.32], at: [0, -0.33, 0], color: BEACON_IRON_COLOR },
    { name: 'forearm', kind: 'box', size: [0.26, 0.55, 0.28], at: [0, -0.86, 0.02], color: wood },
    { name: 'fist', kind: 'box', size: [0.4, 0.36, 0.42], at: [0, -1.22, 0.05], color: stone },
  ];

  return {
    legs,
    torso,
    armLeft: arm.map((part) => ({ ...part })),
    armRight: arm.map((part) => ({ ...part })),
    torsoPivotY: TORSO_PIVOT_Y,
    shoulderPivots: {
      left: [BRAZIER_X, SHOULDER_LOCAL_Y, 0],
      right: [-BRAZIER_X, SHOULDER_LOCAL_Y, 0],
    },
    armLengthMeters: ARM_LENGTH_METERS,
  };
}

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

function wardenMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
    // DoubleSide for the same one part oldBeacon.js needs it for: the open cresset's far wall.
    side: THREE.DoubleSide,
  });
}

/**
 * Build the Warden and put it in the scene.
 *
 * @param scene the scene to add to
 * @param at    `[x, z]` where it stands (or kneels)
 * @returns `{ group, setMode(mode, modeSeconds, phase), setHeading(heading), setPosition(x, z),
 *            update(deltaSeconds), setBrazier(strength) }`
 *
 * The presenter owns LOOKS only: the siege rules own which mode holds and for how long, and publish
 * (mode, modeSeconds, phase) the way encounter.js publishes the wolf's. setMode may be called every
 * frame with authoritative seconds or once per transition -- update() keeps its own clock between
 * calls, so either wiring draws the same monster.
 */
export function buildWarden(scene, at) {
  const spec = wardenParts();
  const group = new THREE.Group();
  group.name = 'beacon-warden';
  group.position.set(at[0], 0, at[1]);

  const merge = (parts) => mergeGeometries(parts.map(bakePart), false);

  const legs = new THREE.Mesh(merge(spec.legs), wardenMaterial());
  legs.name = 'warden-legs';
  group.add(legs);

  const torsoGroup = new THREE.Group();
  torsoGroup.name = 'warden-torso-pivot';
  torsoGroup.position.y = spec.torsoPivotY;
  group.add(torsoGroup);

  const torsoMaterial = wardenMaterial();
  const torso = new THREE.Mesh(merge(spec.torso), torsoMaterial);
  torso.name = 'warden-torso';
  torsoGroup.add(torso);

  // Arms pivot at the shoulders and are CHILDREN of the torso pivot, so a sweep carries them and a
  // bow lowers them -- the cheapest possible forward kinematics, and enough.
  const armL = new THREE.Group();
  armL.position.set(...spec.shoulderPivots.left);
  armL.add(new THREE.Mesh(merge(spec.armLeft), wardenMaterial()));
  armL.name = 'warden-arm-left';
  const armR = new THREE.Group();
  armR.position.set(...spec.shoulderPivots.right);
  armR.add(new THREE.Mesh(merge(spec.armRight), wardenMaterial()));
  armR.name = 'warden-arm-right';
  torsoGroup.add(armL, armR);

  // The brazier's light, sitting on the ember part itself so every bow and sweep carries it.
  const ember = spec.torso.find((part) => part.name === 'brazier-ember');
  const brazier = createGlowSprite(BEACON_GLOW_COLOR, WARDEN_BRAZIER_SIZE_METERS);
  brazier.name = 'warden-brazier-glow';
  brazier.position.set(ember.at[0], ember.at[1] + 0.06, ember.at[2]);
  torsoGroup.add(brazier);

  // The pulse ring: unit outer radius, scaled out to WARDEN_PULSE_RING_RADIUS_METERS while it
  // plays. Additive and depthWrite-off like every light in this game (render/glow.js's reasoning),
  // basic rather than standard because an expanding shockwave must not pick up scene lighting.
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

  function applyPhaseSeams() {
    // Phase 3: the accent catches in the torso's seams. Written to the material rather than baked,
    // so it can come on mid-fight without a geometry swap.
    if (phase >= 3) {
      torsoMaterial.emissive.set(BEACON_GLOW_COLOR).multiplyScalar(WARDEN_PHASE3_SEAM_GLOW);
    } else {
      torsoMaterial.emissive.set(0x000000);
    }
  }

  return {
    group,
    /** The rules publish (mode, how long it has held, phase). Safe to call every frame. */
    setMode(nextMode, modeSeconds = 0, nextPhase = phase) {
      mode = nextMode;
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
    /** Direct brazier override for the integrator (e.g. dim it while a seal still holds). The
     *  phase gain and the mode's own surge multiply on top of this base. */
    setBrazier(strength) {
      brazierBase = clamp01(strength);
    },
    update(deltaSeconds) {
      modeClock += deltaSeconds;
      const pose = wardenPose(mode, modeClock, prefersReducedMotion());
      group.visible = pose.visible;
      if (!pose.visible) {
        setGlowStrength(brazier, 0);
        ring.visible = false;
        return;
      }
      group.position.y = pose.rootY;
      // Compressing the legs mesh about its ground-level origin bends the knees without a knee:
      // feet stay planted, the pelvis comes down, and the torso pivot rides it.
      legs.scale.y = pose.legs01;
      torsoGroup.position.y = spec.torsoPivotY * pose.legs01 + pose.bobY;
      torsoGroup.rotation.set(pose.torsoPitch, pose.torsoYaw, pose.torsoRoll);
      torsoGroup.scale.setScalar(pose.breath);
      // rotation.x is negated because the arms hang -Y: see the pitch convention on armPitchL.
      armL.rotation.x = -pose.armPitchL;
      armR.rotation.x = -pose.armPitchR;

      const gain = WARDEN_BRAZIER_BY_PHASE[Math.min(WARDEN_BRAZIER_BY_PHASE.length, Math.max(1, phase)) - 1];
      setGlowStrength(brazier, clamp01(brazierBase * gain * pose.brazier));

      if (pose.ring) {
        ring.visible = true;
        const radius = Math.max(0.001, pose.ring.radius01) * WARDEN_PULSE_RING_RADIUS_METERS;
        ring.scale.set(radius, radius, 1);
        ring.material.opacity = pose.ring.opacity;
      } else {
        ring.visible = false;
      }
    },
    /** For a harness. */
    getState: () => ({ mode, modeSeconds: modeClock, phase }),
  };
}
