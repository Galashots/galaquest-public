// public/src/world/blackthornHollow.js
//
// THE BLACKTHORN HOLLOW: a wall of blackthorn near the Old Beacon, visibly older and heavier than
// the trail's own bramble, with a small hidden pocket behind it.
//
// This is world/bramble.js's HEAVY SIBLING, and the difference between them is the whole point. The
// trail bramble taught "the world is yours to act on" -- any sword, three blows, gone. This one
// teaches the NEXT lesson: some of the world only answers to the right tool. The starter sword
// BOUNCES off it, honestly and harmlessly, every time; the Wildwood Blade tears it open in two. The
// Blade is a key wearing a sword's shape, and this wall is the first door it opens.
//
// Two blows, not one and not three, and the number is an argument: one blow is a switch -- the child
// never gets the moment where the FIRST cut says "it works!" and the second finishes the job. Three
// is the trail bramble's number (world/trail.js's BRAMBLE_BLOWS_TO_CUT), and matching it would say
// "same hedge, different colour". Two sits between: proof, then payoff, and unmistakably easier than
// the common bramble was with a lesser sword -- which is exactly what holding the right key should
// feel like.
//
// The file keeps bramble.js's own split, both halves living here because they are one idea:
//   -- PURE RULES first (no three.js, no DOM): blow counts, the tear latch, the chest latch, and the
//      same segment geometry world/trail.js provides for brambles, so main.js can reuse its whole
//      contact discipline (nearest-point aiming, extra reach, notice margin) unchanged.
//   -- PRESENTERS after: the barrier mesh, the tear, and the hidden pocket's dressing.
//
// Like the bramble, this is NOT a collision barrier -- nothing in this game collides (bramble.js's
// header owns that argument). It hides the pocket by HEIGHT and by standing in the one gap in the
// trees, and a child who squeezes around through the forest has merely found the pocket the sneaky
// way, which is its own kind of reward.

import * as THREE from '../../vendor/three.module.min.js';
import { mergeGeometries } from '../../vendor/utils/BufferGeometryUtils.js';
import { WORLD, setLayer } from '../render/layers.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { prefersReducedMotion } from '../render/motionPreference.js';
import { WILDWOOD_BLADE_ID } from '../progression/items.js';
import { SPARK_COLOR } from '../rewards/markSpark.js';
import { BRAMBLE_COLOR } from './bramble.js';
import { WILDWOOD_COLOR, METAL_COLOR } from './wildwoodBlade.js';
import { GATE_WOOD_COLOR } from './wildwoodGate.js';
import { BEACON_STONE_COLOR, BEACON_IRON_COLOR } from './oldBeacon.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// PURE RULES -- no three.js above the presenter line. Everything here runs under plain `node --test`
// and could run on the server, the same discipline world/trail.js and world/cartLoot.js keep.
// ═════════════════════════════════════════════════════════════════════════════════════════════════

// Two, and deliberately FEWER than the trail bramble's three (world/trail.js's own
// BRAMBLE_BLOWS_TO_CUT -- not imported, because this module owns its own number the same way
// bramble.js refuses to import trail.js's; test/blackthorn-hollow.test.mjs pins the contrast so the
// two files cannot drift into agreeing). The Blade is a key, not a grind: the first blow exists so
// the child gets one whole beat of "it WORKS" -- the cut event where every earlier swing bounced --
// and the second finishes it before that beat can curdle into labour.
export const BLACKTHORN_BLOWS_TO_TEAR = 2;

function freezeHollow(next) {
  return Object.freeze({
    barrierBlows: next.barrierBlows,
    barrierTorn: next.barrierTorn,
    chestOpened: next.chestOpened,
  });
}

/** Nothing struck, nothing torn, nothing opened. Frozen, like every state cartLoot.js publishes:
 *  the only way forward is through the transitions below, never a stray mutation. */
export function createHollowState() {
  return freezeHollow({ barrierBlows: 0, barrierTorn: false, chestOpened: false });
}

/**
 * Resolve one sword contact with the barrier.
 *
 * @param state             from createHollowState, then fed back in
 * @param equippedWeaponId  the hero's equipped weapon id (progression/items.js's vocabulary)
 * @returns { state, events }
 *
 * Three honest outcomes, and only three:
 *   -- the Wildwood Blade lands: `{ type: 'blackthorn-cut', blows }`, and on the finishing blow a
 *      `{ type: 'blackthorn-torn' }` follows in the same result. The tear LATCHES: once torn,
 *      further contacts return the same state and no events, because a door already open has nothing
 *      left to say.
 *   -- anything else lands: `{ type: 'blackthorn-tough' }`, state UNCHANGED (same reference, the
 *      no-op contract requestSearchCart keeps). Repeatable forever, zero damage, zero punishment --
 *      the bounce is information, not a fine. A child may test the wall with the starter sword ten
 *      times and the tenth answer is as honest as the first.
 *   -- an unknown or missing weapon id is treated as too-tough, not thrown: a stale client's
 *      message deserves cartLoot.js's "unknown is a clean no", never a crash. Only the ONE key id
 *      opens this, read from progression/items.js rather than restated (docs/MISTAKES.md GQ-007).
 */
export function strikeBarrier(state, equippedWeaponId) {
  if (state.barrierTorn) return { state, events: [] };
  if (equippedWeaponId !== WILDWOOD_BLADE_ID) {
    return { state, events: [{ type: 'blackthorn-tough' }] };
  }
  const blows = state.barrierBlows + 1;
  const torn = blows >= BLACKTHORN_BLOWS_TO_TEAR;
  const events = [{ type: 'blackthorn-cut', blows }];
  if (torn) events.push({ type: 'blackthorn-torn' });
  return { state: freezeHollow({ ...state, barrierBlows: blows, barrierTorn: torn }), events };
}

/**
 * Open the secret chest. Idempotent: the first call raises `{ type: 'hollow-chest-opened' }`, every
 * later call returns the same state and no events.
 *
 * WHAT IS INSIDE IS NOT DECIDED HERE. This module owns the physical fact "the chest was opened";
 * the loot itself (the shard bundle) is awarded by the integrator against the server-authoritative
 * reward store when this event fires -- the same seam cartLoot.js draws between "a pickup exists in
 * the world" and "currency was durably credited". A presenter that also priced its own contents
 * would be a client deciding what it is owed.
 */
export function openChest(state) {
  if (state.chestOpened) return { state, events: [] };
  return { state: freezeHollow({ ...state, chestOpened: true }), events: [{ type: 'hollow-chest-opened' }] };
}

// ── barrier geometry, mirroring trail.js's bramble helpers ───────────────────────────────────────
//
// The same shapes with the same names, so main.js reuses its whole bramble contact discipline --
// nearest-point aiming for the swing arc, line distance for the extra reach, notice margin for the
// objective chip -- by swapping one word. The barrier is `{ at: [x, z], rotY, spanMeters }`, exactly
// a bramble's spec, because it IS a bramble spec: the heavier sibling differs in rules and dress,
// not in how it lies across the world.

// Same arm's-length-plus-a-step margin trail.js measured for the bramble chip; the "talk about it
// when they can see it" argument there transfers whole.
export const BLACKTHORN_NOTICE_MARGIN_METERS = 2.5;

/** The two ends of the barrier in world x/z. Local +X maps to (cos rotY, -sin rotY) -- the identical
 *  convention trail.js's brambleEnds records, because barrierParts below lays its canes out along X
 *  the same way bramble.js does. */
export function barrierEnds(barrier) {
  const half = barrier.spanMeters / 2;
  const alongX = Math.cos(barrier.rotY ?? 0) * half;
  const alongZ = -Math.sin(barrier.rotY ?? 0) * half;
  const [x, z] = barrier.at;
  return [[x - alongX, z - alongZ], [x + alongX, z + alongZ]];
}

function closestOnSegment(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared));
  return [ax + t * dx, az + t * dz];
}

/**
 * The point ON the barrier nearest the hero -- what a swing is aimed at. Against the line, never the
 * centre: trail.js's nearestPointOnBramble records the bug that aiming at the middle of a wide hedge
 * creates (standing at one end reads as swinging sideways), and this wall is WIDER than any bramble,
 * so the fix matters more here, not less.
 */
export function nearestPointOnBarrier(barrier, heroX, heroZ) {
  const [from, to] = barrierEnds(barrier);
  return closestOnSegment(heroX, heroZ, from, to);
}

/** How far the hero is from the barrier's own body, for the strike-reach check -- main.js adds
 *  trail.js's BRAMBLE_EXTRA_REACH_METERS on top exactly as it does for brambles, and for the same
 *  measured no-collision reason recorded there. */
export function distanceToBarrier(barrier, heroX, heroZ) {
  const [x, z] = nearestPointOnBarrier(barrier, heroX, heroZ);
  return Math.hypot(heroX - x, heroZ - z);
}

/** Close enough to a still-standing barrier for the game to be talking about it (the objective chip,
 *  Rowan's "too tough" hint line). Pure geometry: the caller checks barrierTorn itself, because
 *  "near" and "standing" are two different questions. */
export function nearBarrier(barrier, heroX, heroZ) {
  return distanceToBarrier(barrier, heroX, heroZ) <= BLACKTHORN_NOTICE_MARGIN_METERS;
}

// ── colours and proportions, derived, never restated ─────────────────────────────────────────────

/** hex -> hex with each channel scaled. Pure arithmetic rather than THREE.Color, so the derived
 *  constants stay usable above the presenter line and in browserless tests. */
function darkenHex(hex, factor) {
  const r = Math.round(((hex >> 16) & 255) * factor);
  const g = Math.round(((hex >> 8) & 255) * factor);
  const b = Math.round((hex & 255) * factor);
  return (r << 16) | (g << 8) | b;
}

// The bramble's own bruised violet, driven toward black -- DERIVED from BRAMBLE_COLOR, not restated
// (GQ-007), so if the bramble's colour ever moves this stays its darker elder. Same family so a
// child reads "that stuff again, but old"; darker so the difference registers before the first
// swing does. Not all the way to pure black: bramble.js already recorded why a true black flattens
// to a hole in the picture, and the lesson transfers whole.
export const BLACKTHORN_COLOR = darkenHex(BRAMBLE_COLOR, 0.6);
// Pale dead-grey thorn tips, the one value jump on the whole wall. Old thorn dies grey at the
// points, and a few pale ticks against the near-black mass are what read as AGE rather than as
// merely "a darker bush".
export const BLACKTHORN_THORN_TIP_COLOR = 0x8d8878;

// Over the 1.48 m hero's head at the middle of the span -- the OPPOSITE choice from bramble.js's
// deliberately chest-high 1.15, and both are right: the trail bramble must show the trail continuing
// behind it or it reads as the end of the world, while this wall exists to HIDE what is behind it.
// Concealment is the whole point of a secret; a blackthorn you could see the chest over would be a
// spoiler with thorns on.
export const BLACKTHORN_HEIGHT_METERS = 1.6;
const CANE_THICKNESS_METERS = 0.26;
const CANE_SPACING_METERS = 0.3;
const THORN_LENGTH_METERS = 0.42;
const THORN_THICKNESS_METERS = 0.1;

/**
 * Every box in the barrier, in its own local space: the wall runs along X, the gap-to-be along Z.
 * Exported so the proportions can be checked without a browser (the wildwoodBlade.js split).
 *
 * bramble.js's lattice idea, made HEAVY: thicker canes, packed closer (one every 30 cm against the
 * bramble's 38), taller, three runners instead of two. The height profile PEAKS in the middle --
 * where the child will stand and where the pocket hides behind -- and falls toward the ends, so the
 * silhouette reads as a grown mass rather than a built fence. Index-driven, never random: both
 * players' iPads must draw the same wall.
 *
 * Every part carries `half: 'left' | 'right'` (which side of the coming split it belongs to), and
 * the full-span runners are pre-cut into two half-span boxes for the same reason: the tear pulls the
 * two halves apart, and a box cannot straddle a split.
 */
export function barrierParts(spanMeters) {
  const parts = [];
  const canes = Math.max(5, Math.round(spanMeters / CANE_SPACING_METERS));
  for (let i = 0; i < canes; i += 1) {
    const t = canes === 1 ? 0.5 : i / (canes - 1);
    const x = (t - 0.5) * spanMeters;
    const half = t <= 0.5 ? 'left' : 'right';
    const lean = (i % 2 === 0 ? 1 : -1) * (0.3 + (i % 3) * 0.08);
    // Peak at the centre (sin of pi*t), ragged by index -- the dip alternates so no two neighbours
    // share a top edge, but the middle canes always clear the hero's head.
    const height = BLACKTHORN_HEIGHT_METERS * (0.76 + 0.24 * Math.sin(Math.PI * t)) - (i % 2) * 0.07;
    const depth = ((i % 4) - 1.5) * 0.24;
    parts.push({
      name: 'cane',
      size: [CANE_THICKNESS_METERS, height, CANE_THICKNESS_METERS],
      at: [x, height / 2, depth],
      roll: lean,
      color: BLACKTHORN_COLOR,
      half,
    });
    // A thorn out of each cane's upper third; every third one wears the dead-grey tip.
    parts.push({
      name: i % 3 === 0 ? 'thorn-tip' : 'thorn',
      size: [THORN_LENGTH_METERS, THORN_THICKNESS_METERS, THORN_THICKNESS_METERS],
      at: [x - Math.sign(lean) * THORN_LENGTH_METERS * 0.45, height * 0.74, depth],
      roll: -lean * 0.6,
      color: i % 3 === 0 ? BLACKTHORN_THORN_TIP_COLOR : BLACKTHORN_COLOR,
      half,
    });
  }
  // Three runners (the bramble ties itself with two), each split at the centre so the halves part
  // cleanly. Low, middle, high: the high one is what makes the top read as woven rather than picketed.
  for (const [y, roll] of [[0.3, 0.05], [0.78, -0.04], [1.18, 0.03]]) {
    const runnerHalf = spanMeters / 2;
    for (const [sign, half] of [[-1, 'left'], [1, 'right']]) {
      parts.push({
        name: 'runner',
        size: [runnerHalf, CANE_THICKNESS_METERS * 0.85, CANE_THICKNESS_METERS * 0.85],
        at: [sign * runnerHalf / 2, y, 0.1],
        roll,
        color: BLACKTHORN_COLOR,
        half,
      });
    }
  }
  return parts;
}

// ── the tear, as a pure curve ────────────────────────────────────────────────────────────────────

// Long enough to WATCH the wall come apart -- this is the payoff for having earned the Blade, and it
// deserves more ceremony than the common bramble's 0.55 s collapse -- short enough that a child is
// walking through the gap before the thought "can I go now?" forms.
export const BLACKTHORN_TEAR_SECONDS = 0.8;
const TEAR_LEAN_RADIANS = 0.55;
const TEAR_SINK_METERS = 0.42;

function ease(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * One frame of the tear, from seconds elapsed. Split from the presenter so the SHAPE of the opening
 * can be asserted under plain `node --test` -- the same split oldBeacon.js's beaconStirStrength makes
 * and credits, for the same reason.
 *
 *   leanRadians  how far each half has laid over, AWAY from the split (caller negates for the left)
 *   sinkMeters   how far both halves have settled into the ground
 *   opacity      1 -> 0, fading late (1 - t^2) so the halves are seen MOVING before they are seen going
 *   done         the gap is fully open
 */
export function tearCurve(seconds) {
  const t = Math.min(1, Math.max(0, seconds / BLACKTHORN_TEAR_SECONDS));
  const eased = ease(t);
  return {
    leanRadians: eased * TEAR_LEAN_RADIANS,
    sinkMeters: eased * TEAR_SINK_METERS,
    opacity: 1 - t * t,
    done: t >= 1,
  };
}

// The tear's spark burst, fanned out of the split point. Deterministic and index-driven like every
// other effect both iPads must agree on.
export const TEAR_SPARK_COUNT = 7;
const TEAR_SPARK_SECONDS = 0.6;
const TEAR_SPARK_REACH_METERS = 1.4;

/**
 * One frame of one tear-spark's flight: sparks fan upward and outward from the split in a half-circle,
 * rewards/markSpark.js's idiom (a pure per-frame beat driving a pooled glow sprite) pointed at a
 * burst instead of a delivery.
 */
export function tearSparkFrame(elapsedSeconds, index, count = TEAR_SPARK_COUNT) {
  const t = Math.min(1, Math.max(0, elapsedSeconds) / TEAR_SPARK_SECONDS);
  const angle = Math.PI * (0.15 + 0.7 * (count <= 1 ? 0.5 : index / (count - 1)));
  const reach = ease(t) * TEAR_SPARK_REACH_METERS;
  return {
    outMeters: Math.cos(angle) * reach,
    upMeters: Math.sin(angle) * reach - t * t * 0.35,
    strength01: t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.85),
    sizeMeters: 0.45 - 0.25 * t,
    done: t >= 1,
  };
}

// ── the hidden pocket's own numbers (pure, test-visible) ─────────────────────────────────────────

const CHEST_WIDTH_METERS = 0.66;
const CHEST_DEPTH_METERS = 0.44;
const CHEST_BASE_HEIGHT_METERS = 0.34;
const CHEST_LID_HEIGHT_METERS = 0.16;
// Knee-high on the hero. A secret chest smaller than the child who finds it reads as findable
// treasure; one their own size reads as furniture somebody forgot.
export const CHEST_TOTAL_HEIGHT_METERS = CHEST_BASE_HEIGHT_METERS + CHEST_LID_HEIGHT_METERS;
export const CHEST_OPEN_SECONDS = 0.5;
const CHEST_LID_OPEN_RADIANS = -1.9;
const CHEST_GLOW_RISE_METERS = 0.9;

/**
 * Every box of the secret chest, split into the still half and the moving half:
 *   base   in chest-local space, y = 0 on the ground
 *   lid    in LID-local space, relative to the hinge -- the lid's mesh sits AT the hinge and rotates
 *          about local X, so its boxes are expressed forward (+z) and up from that line
 *   hingeAt  where the hinge line sits in chest-local space
 *
 * Aged gate timber with ONE brass band: GATE_WOOD_COLOR is the wood every built thing in this zone
 * shares, and METAL_COLOR is the Wildwood Blade's own fitting brass -- both imported, never restated
 * (GQ-007). The chest rhymes with world/cartLoot.js's physical haul on purpose: same "a container in
 * the world holds the reward" grammar, one step more ceremonial because this one had to be earned
 * through a locked door.
 */
export function chestParts() {
  const base = [
    {
      name: 'chest-body',
      size: [CHEST_WIDTH_METERS, CHEST_BASE_HEIGHT_METERS, CHEST_DEPTH_METERS],
      at: [0, CHEST_BASE_HEIGHT_METERS / 2, 0],
      color: GATE_WOOD_COLOR,
    },
    // The one brass band, wrapped proud of the body on width and depth only -- the single large
    // accent the visual authority's detail floor allows a minor prop. Same height as the body, never
    // taller: a band proud on Y would poke below the ground the chest sits on.
    {
      name: 'chest-band',
      size: [CHEST_WIDTH_METERS * 0.14, CHEST_BASE_HEIGHT_METERS, CHEST_DEPTH_METERS + 0.03],
      at: [0, CHEST_BASE_HEIGHT_METERS / 2, 0],
      color: METAL_COLOR,
    },
    // Two skids so it sits ON the ground rather than IN it.
    {
      name: 'chest-skid',
      size: [CHEST_WIDTH_METERS * 0.9, 0.05, 0.08],
      at: [0, 0.025, CHEST_DEPTH_METERS / 2 - 0.06],
      color: GATE_WOOD_COLOR,
    },
    {
      name: 'chest-skid',
      size: [CHEST_WIDTH_METERS * 0.9, 0.05, 0.08],
      at: [0, 0.025, -(CHEST_DEPTH_METERS / 2 - 0.06)],
      color: GATE_WOOD_COLOR,
    },
  ];
  const lid = [
    {
      name: 'chest-lid',
      size: [CHEST_WIDTH_METERS, CHEST_LID_HEIGHT_METERS, CHEST_DEPTH_METERS],
      at: [0, CHEST_LID_HEIGHT_METERS / 2, CHEST_DEPTH_METERS / 2],
      color: GATE_WOOD_COLOR,
    },
    {
      name: 'chest-lid-band',
      size: [CHEST_WIDTH_METERS * 0.14, CHEST_LID_HEIGHT_METERS + 0.02, CHEST_DEPTH_METERS + 0.03],
      at: [0, CHEST_LID_HEIGHT_METERS / 2, CHEST_DEPTH_METERS / 2],
      color: METAL_COLOR,
    },
  ];
  return { base, lid, hingeAt: [0, CHEST_BASE_HEIGHT_METERS, -CHEST_DEPTH_METERS / 2] };
}

// Which way the marker stone's carved groove points: north-east, in WORLD terms. North is -Z in this
// world and east is +X, and local +X under rotY maps to (cos, -sin) in x/z (trail.js's own
// convention), so pi/4 aims the groove along (+1, -1)/sqrt(2). The builder counter-rotates the stone
// against the pocket's own rotY so this stays true however the pocket is turned: the tease aims at
// GEOGRAPHY, not at set dressing.
export const HOLLOW_MARKER_ROT_Y = Math.PI / 4;

/**
 * The pocket's dressing, every part in pocket-local space (y = 0 the ground), each with an optional
 * yaw. Exported for browserless proportion and colour checks.
 *
 * (a) THE FALLEN RANGER'S SATCHEL, dropped by the marker stone. Nobody says whose it was. An
 *     environmental clue is a sentence the child assembles themselves -- somebody came here, marked
 *     the way, and left without their bag -- and it lands harder unassembled.
 * (b) THE MARKER STONE, waystone-like (oldBeacon.js's waystones are this stone's cousins, and it
 *     borrows their slate on purpose -- BEACON_STONE_COLOR, imported), with one carved arrow groove
 *     aiming north-east at nothing the child can reach yet. THIS IS ARC 2's SEED: the Ranger Lodge
 *     lies that way, and this stone is the first and only mention. Deliberately unexplained -- no
 *     chip, no banner, no line. A question a game refuses to answer is the cheapest desire it can
 *     manufacture.
 * (c) Dressing: an old rope coil and a broken lantern -- COLD, never lit, no glow sprite ever
 *     attaches to it: a lit lantern is this game's word for "alive", and this pocket's word is "left".
 */
export function pocketParts() {
  const leather = darkenHex(GATE_WOOD_COLOR, 0.55);
  const rope = darkenHex(GATE_WOOD_COLOR, 0.8);
  const groove = darkenHex(BEACON_STONE_COLOR, 0.55);
  return [
    // (b) the marker stone: a leaning slate slab with a small cap, groove on its NE face.
    {
      name: 'marker-shaft',
      size: [0.42, 1.15, 0.3],
      at: [1.2, 0.575, -0.9],
      roll: 0.06,
      color: BEACON_STONE_COLOR,
    },
    {
      name: 'marker-cap',
      size: [0.34, 0.14, 0.26],
      at: [1.2, 1.2, -0.9],
      color: BEACON_STONE_COLOR,
    },
    // The carved arrow groove: a thin dark chevron proud of the face, chest-high on the hero so it
    // is the first thing read on the stone.
    {
      name: 'marker-groove',
      size: [0.3, 0.07, 0.05],
      at: [1.2, 0.95, -0.9 + 0.18],
      yaw: HOLLOW_MARKER_ROT_Y,
      color: groove,
    },
    // (a) the satchel, fallen at the stone's foot: body, flap, and the strap it was dropped by.
    {
      name: 'satchel-body',
      size: [0.4, 0.14, 0.28],
      at: [0.72, 0.07, -0.55],
      yaw: 0.7,
      color: leather,
    },
    {
      name: 'satchel-flap',
      size: [0.42, 0.05, 0.2],
      at: [0.72, 0.16, -0.5],
      yaw: 0.7,
      roll: 0.12,
      color: leather,
    },
    {
      name: 'satchel-strap',
      size: [0.62, 0.04, 0.07],
      at: [0.45, 0.03, -0.3],
      yaw: 1.3,
      color: leather,
    },
    // (c) the rope coil: two squat rings stacked slightly askew read as a coil at this fidelity.
    {
      name: 'rope-coil',
      size: [0.38, 0.09, 0.38],
      at: [-0.9, 0.045, 0.5],
      color: rope,
    },
    {
      name: 'rope-coil',
      size: [0.32, 0.08, 0.32],
      at: [-0.87, 0.125, 0.53],
      yaw: 0.5,
      color: rope,
    },
    // (c) the broken lantern, on its side, the Beacon's own dead iron. Cold forever -- see above.
    {
      name: 'broken-lantern',
      size: [0.16, 0.24, 0.16],
      at: [-0.55, 0.08, -0.7],
      roll: Math.PI / 2 - 0.2,
      color: BEACON_IRON_COLOR,
    },
    {
      name: 'broken-lantern-cap',
      size: [0.2, 0.05, 0.2],
      at: [-0.72, 0.1, -0.72],
      roll: Math.PI / 2 - 0.2,
      color: BEACON_IRON_COLOR,
    },
  ];
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// PRESENTERS -- three.js from here down. How it looks, never whether it opens: the rules above own
// that, the same seam bramble.js draws under trail.js.
// ═════════════════════════════════════════════════════════════════════════════════════════════════

const SHUDDER_SECONDS = 0.26;
// FIXED amplitude, deliberately unlike bramble.js's per-blow HIT_SHRINK_BY_BLOW ladder: the
// bramble's flinch grows because the child IS getting somewhere, and this shudder must never grow
// because they are NOT. Ten starter-sword swings must look exactly as futile as one, or the wall is
// lying about being a door for the wrong key.
const SHUDDER_TILT_RADIANS = 0.03;

/** One box baked into local space with its colour written as a vertex attribute -- oldBeacon.js's
 *  bakedPart trick, boxes only, so a many-coloured prop merges into ONE geometry. */
function bakedBox(part) {
  const geometry = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
  const matrix = new THREE.Matrix4();
  matrix.makeRotationFromEuler(new THREE.Euler(0, part.yaw ?? 0, part.roll ?? 0, 'YZX'));
  matrix.setPosition(part.at[0], part.at[1], part.at[2]);
  geometry.applyMatrix4(matrix);
  const color = new THREE.Color(part.color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function thornMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    flatShading: true,
    // Transparent from the START, never flipped mid-session: bramble.js records why (the material
    // re-evaluation hitch would land on the exact frame of the winning blow).
    transparent: true,
    depthWrite: true,
  });
}

/**
 * Build the blackthorn barrier and put it in the scene.
 *
 * @param scene the scene to add to
 * @param spec  `{ at: [x, z], rotY, spanMeters }` from the zone data -- a bramble spec, on purpose
 * @returns `{ at, shudder(), tear(), update(deltaSeconds), isGone() }`
 *
 * TWO MESHES, not bramble.js's one, and the second draw call is paid for the same reason
 * wildwoodBlade.js pays its own: the prop cannot say what it must with one. The tear splits the
 * lattice FROM THE MIDDLE OUTWARD -- two halves leaning apart is the picture of "torn open", where a
 * uniform collapse is the picture of "fell over" -- and halves that move apart cannot share a
 * geometry. They do share one material.
 */
export function buildBlackthornBarrier(scene, spec) {
  const group = new THREE.Group();
  group.name = `blackthorn-${spec.at[0]}-${spec.at[1]}`;
  group.position.set(spec.at[0], 0, spec.at[1]);
  group.rotation.y = spec.rotY ?? 0;

  const parts = barrierParts(spec.spanMeters);
  const material = thornMaterial();
  const halves = {};
  for (const side of ['left', 'right']) {
    const geometries = parts.filter((part) => part.half === side).map(bakedBox);
    const mesh = new THREE.Mesh(mergeGeometries(geometries, false), material);
    mesh.name = `blackthorn-${side}`;
    group.add(mesh);
    halves[side] = mesh;
  }
  setLayer(group, WORLD);
  scene.add(group);

  // The tear's sparks, built now and dark rather than at tear time: creating sprites on the exact
  // frame of the winning blow is the same hitch the transparent-from-start material avoids. The
  // colour is WILDWOOD_COLOR -- the Blade's OWN teal doing the cutting, so the burst reads as "MY
  // sword did this" rather than as generic debris. Imported, never restated.
  const sparks = [];
  for (let i = 0; i < TEAR_SPARK_COUNT; i += 1) {
    const sprite = createGlowSprite(WILDWOOD_COLOR, 0.45);
    sprite.name = `blackthorn-spark-${i}`;
    setLayer(sprite, WORLD);
    setGlowStrength(sprite, 0);
    sprite.position.set(spec.at[0], 0, spec.at[1]);
    scene.add(sprite);
    sparks.push(sprite);
  }
  // Where the burst erupts: the split point, at the wall's visual middle height.
  const splitX = spec.at[0];
  const splitZ = spec.at[1];
  const splitY = BLACKTHORN_HEIGHT_METERS * 0.55;
  // Sparks fan across the wall's own span: local +X in world terms (trail.js's convention).
  const alongX = Math.cos(spec.rotY ?? 0);
  const alongZ = -Math.sin(spec.rotY ?? 0);

  let shudderSeconds = -1;
  let tearSeconds = -1;
  let gone = false;

  return {
    at: spec.at,
    /** The too-tough response: a brief, fixed shake and nothing else -- see SHUDDER_TILT_RADIANS for
     *  why it never scales. Reduced motion skips it entirely; the 'blackthorn-tough' event still
     *  drives whatever words the integrator puts on screen, so nothing is LOST but the wobble. */
    shudder() {
      if (prefersReducedMotion()) return;
      if (tearSeconds >= 0 || gone) return;
      shudderSeconds = 0;
    },
    /** The Blade's payoff. Permanent for the session: there is no untear. Under reduced motion the
     *  wall simply IS open -- the gap is the point and must not be withheld, only the movement is. */
    tear() {
      if (tearSeconds >= 0 || gone) return;
      if (prefersReducedMotion()) {
        gone = true;
        group.visible = false;
        return;
      }
      tearSeconds = 0;
      shudderSeconds = -1;
      group.rotation.z = 0;
    },
    isGone: () => gone,
    update(deltaSeconds) {
      if (tearSeconds >= 0 && !gone) {
        tearSeconds += deltaSeconds;
        const beat = tearCurve(tearSeconds);
        // The halves lean AWAY from each other and settle: torn open, not knocked down.
        halves.left.rotation.z = beat.leanRadians;
        halves.right.rotation.z = -beat.leanRadians;
        halves.left.position.y = -beat.sinkMeters;
        halves.right.position.y = -beat.sinkMeters;
        material.opacity = beat.opacity;
        for (let i = 0; i < sparks.length; i += 1) {
          const frame = tearSparkFrame(tearSeconds, i);
          const out = (i % 2 === 0 ? 1 : -1) * frame.outMeters;
          sparks[i].position.set(splitX + alongX * out, splitY + frame.upMeters, splitZ + alongZ * out);
          sparks[i].scale.setScalar(frame.sizeMeters);
          setGlowStrength(sparks[i], frame.done ? 0 : frame.strength01);
        }
        if (beat.done) {
          gone = true;
          group.visible = false;
          for (const spark of sparks) setGlowStrength(spark, 0);
        }
        return;
      }
      if (shudderSeconds >= 0) {
        shudderSeconds += deltaSeconds;
        const t = Math.min(1, shudderSeconds / SHUDDER_SECONDS);
        // A tight tremor that dies out: sin ramps the frequency, (1 - t) kills it, and the whole
        // group ends exactly at rest so repeated bounces can never drift it.
        group.rotation.z = Math.sin(t * Math.PI * 6) * SHUDDER_TILT_RADIANS * (1 - t);
        if (t >= 1) {
          shudderSeconds = -1;
          group.rotation.z = 0;
        }
      }
    },
  };
}

/**
 * Build the hidden pocket's dressing and put it in the scene.
 *
 * @param scene the scene to add to
 * @param spec  `{ at: [x, z], rotY }` from the zone data -- the pocket's anchor behind the barrier
 * @returns `{ at, open(), isOpen(), update(deltaSeconds) }`
 *
 * Everything still is ONE merged mesh -- chest base, satchel, marker stone, rope, dead lantern, one
 * draw call between them (oldBeacon.js's buildBeaconWaystones bakes multiple placements the same
 * way). The lid is the one moving part and so the one extra mesh, plus one warm glow sprite that
 * only exists once the chest opens.
 *
 * open() is APPEARANCE only: the integrator calls it when the rules' openChest() accepts, and the
 * loot itself is a server-authoritative award raised off the 'hollow-chest-opened' event -- this
 * builder neither knows nor decides what was inside (see openChest's own comment).
 */
export function buildHollowPocket(scene, spec) {
  const rotY = spec.rotY ?? 0;
  const place = new THREE.Matrix4()
    .makeRotationY(rotY)
    .setPosition(spec.at[0], 0, spec.at[1]);

  const { base, lid, hingeAt } = chestParts();
  const geometries = [];
  for (const part of base) geometries.push(bakedBox(part));
  for (const part of pocketParts()) {
    // The marker's groove holds its NE heading whatever the pocket's own rotY says -- counter-rotate
    // it here so HOLLOW_MARKER_ROT_Y stays a WORLD fact (see its own comment: geography, not
    // dressing).
    const adjusted = part.name === 'marker-groove'
      ? { ...part, yaw: (part.yaw ?? 0) - rotY }
      : part;
    geometries.push(bakedBox(adjusted));
  }
  const still = new THREE.Mesh(mergeGeometries(geometries, false), new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
  }));
  still.name = 'hollow-pocket';
  still.applyMatrix4(place);
  setLayer(still, WORLD);
  scene.add(still);

  // The lid, parented at its hinge line so opening is one rotation about local X.
  const lidMesh = new THREE.Mesh(
    mergeGeometries(lid.map(bakedBox), false),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true }),
  );
  lidMesh.name = 'hollow-chest-lid';
  const lidPivot = new THREE.Group();
  lidPivot.add(lidMesh);
  lidPivot.position.set(hingeAt[0], hingeAt[1], hingeAt[2]);
  const chestRoot = new THREE.Group();
  chestRoot.name = 'hollow-chest';
  chestRoot.add(lidPivot);
  chestRoot.applyMatrix4(place);
  setLayer(chestRoot, WORLD);
  scene.add(chestRoot);

  // The reward warmth, dark until the lid moves. rewards/markSpark.js's own SPARK_COLOR (imported,
  // never restated -- GQ-007): the exact gold this game already means "that was worth something" in,
  // because a chest that glowed any other colour would be answering "was this good?" wrongly.
  const glow = createGlowSprite(SPARK_COLOR, 0.7);
  glow.name = 'hollow-chest-glow';
  setLayer(glow, WORLD);
  setGlowStrength(glow, 0);
  const glowBase = new THREE.Vector3(hingeAt[0], CHEST_BASE_HEIGHT_METERS * 0.7, 0).applyMatrix4(place);
  glow.position.copy(glowBase);
  scene.add(glow);

  let opened = false;
  let openSeconds = -1;

  return {
    at: spec.at,
    open() {
      if (opened) return;
      opened = true;
      if (prefersReducedMotion()) {
        // The open STATE lands whole; only the tip-back and the rising glow are skipped. A soft
        // resting warmth still marks the chest as spent.
        lidPivot.rotation.x = CHEST_LID_OPEN_RADIANS;
        setGlowStrength(glow, 0.3);
        return;
      }
      openSeconds = 0;
    },
    isOpen: () => opened,
    update(deltaSeconds) {
      if (openSeconds < 0) return;
      openSeconds += deltaSeconds;
      const t = Math.min(1, openSeconds / CHEST_OPEN_SECONDS);
      lidPivot.rotation.x = ease(t) * CHEST_LID_OPEN_RADIANS;
      // The glow rises with the lid and settles to a low ember: opened, and STAYS read as opened.
      glow.position.y = glowBase.y + ease(t) * CHEST_GLOW_RISE_METERS;
      setGlowStrength(glow, t < 0.7 ? t / 0.7 : 1 - (t - 0.7) * 2);
      if (t >= 1) {
        openSeconds = -1;
        setGlowStrength(glow, 0.3);
      }
    },
  };
}
