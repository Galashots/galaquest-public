// public/src/world/oldBeacon.js
//
// THE OLD BEACON, and the two marker stones that tell you the road to it was BUILT.
//
// Why this exists, from playing the finished trail to its end and looking at the last screenshot:
// the child reaches Rowan's camp, searches the cart, and the game says "Guard the camp for Rowan" --
// an instruction with no verb attached, over a frame containing nothing at all in front of the
// hero. The road's own dirt simply stops in the clearing. That was an honest temporary ending; it
// is still the shape of a dead end, and it is the third time this project has shipped "the road
// terminates in a field" as a defect (the gate, the trail, and now this).
//
// This slice is the APPROACH and the ARRIVAL only. The Beacon is cold and it stays cold: waking it
// is a later beat, and nothing in this file may pretend otherwise -- see world/quest.js's own
// OBJECTIVE_BEACON_IS_COLD for the same rule applied to the words on screen.
//
// ── REFERENCE FIRST, convention recorded before any number below was tuned ───────────────────────
//
// Beacon form (Historic England's beacon listings, the UCL Early Medieval Atlas' Anglo-Saxon
// signalling work, and the surviving Sedgley beacon tower):
//
//   1. A beacon is identified by its CRESSET -- an open iron fire basket -- not by the thing holding
//      it up. Every historic variant (stone beehive, stone turret, iron basket on a pole) shares the
//      basket and nothing else. So the top of this object must read as an open bowl with something
//      in it, never as a roof or a spire.
//   2. It is deliberately SLENDER and its widest element is at the TOP. Sedgley's tower is 50 ft on
//      a 7 ft diameter. That inverted profile is the whole reason a beacon separates from a treeline:
//      a tree is widest low and tapers up, this does the opposite. (The same rule
//      docs/GALAQUEST_VISUAL_AUTHORITY.md derived the hard way from the Tier 3 helmet -- a volume's
//      brief must state where the widest point sits, or it comes back a shapeless lump.)
//   3. It stands on a low built MOUND with a flat top -- the reference mounds are about 2 m high and
//      up to 16 m across. This game's ground is flat and its hero has no terrain height, so the mound
//      is a knee-high stone PLINTH the child walks up beside rather than onto: a built place, with no
//      geometry pretending to be climbable ground.
//   4. Beacons come in CHAINS, and their entire design property is intervisibility. The child has
//      spent the last twenty-two metres waking a chain of lanterns. The Old Beacon is the last and
//      largest link in the same chain, which is why the approach is lit by two more of the same
//      lamps rather than by some new vocabulary -- and why that warm chain deliberately stops six
//      metres short of the Beacon itself (see BEACON_ROAD_LIGHTS in the zone data).
//
// Wayfinding (The Level Design Book's wayfinding chapter, MY.GAMES' breadcrumb write-up, and the
// WoW zone-pathing material AGENTS.md's "World of Warcraft first" rule points at):
//
//   5. "Beacon" is itself the name of the landmark class that points at the exact goal, and the
//      landmarks that actually work are the ones ON ROUTE and AT DECISION POINTS. Hence one large
//      object at the destination and one small waystone at the turn.
//   6. Lit entrances and exits ARE wayfinding; breadcrumbs imply the path. The dormant lamps do that
//      job here, and they cost this file nothing because the game already owns them.
//   7. Funnel with a tall landmark plus a wide sightline plus colour contrast. Everything in this
//      world is warm brown, cream or green; this is cold pale slate with one slate-blue band, so it
//      separates from the wood by HUE as well as by shape.
//
// ── the arithmetic the reference left us to do ───────────────────────────────────────────────────
//
// BEACON_TOTAL_HEIGHT_METERS is 6.1 and that number was derived from the camera, then CORRECTED
// against a photograph of the running game. The follow camera sits DEFAULT_DISTANCE 16 back at
// DEFAULT_PITCH 0.3 rad, which is 15.285 m behind the hero and 5.428 m above his feet, and the
// vertical FOV is 42 degrees -- so the top edge of frame is only about 3.83 degrees above horizontal
// (render/sky.js measured the same thing for the sky gradient). Projecting the top of the tower at
// the worst case -- a child standing at its own base, where the camera is exactly its trailing
// distance away and nothing is higher up the screen -- gives:
//
//     6.4 m -> ndcY 0.991     6.25 m -> 0.962     6.1 m -> 0.933     6.0 m -> 0.914
//
// The first version WAS 6.4, on the arithmetic that 0.991 is inside the frame. It is not, in
// practice: the arrival capture came back with the cresset sliced off the top edge, because a
// budget with 0.9% of the frame in hand is not a budget. 6.1 keeps 6.7% and photographs whole. The
// cresset is the entire identity of this object (reference rule 1) and cropping it at the exact
// moment of arrival is the one framing failure this height is chosen to avoid.
//
// test/old-beacon.test.mjs pins the MARGIN, not the height, so a future taller Beacon fails the
// check that caught this rather than rediscovering it in a screenshot.
//
// It is still 1.7x the tallest tree in the zone (2.413 x 1.45 = 3.5 m) and taller than the Lantern
// Tree's 5.5 m, so it breaks the treeline from the camp -- 18 m up the road, where fog is about 14%
// and it reads as a pale shape on the horizon rather than as a prop fifty metres away. Measured from
// the camp in the running game: the cresset projects at ndcY 0.84, high in frame and dead centre.
//
// ONE MESH AND ONE DRAW CALL for the whole structure, and one more for the glow. Every part is
// merged into a single BufferGeometry carrying its colour as a VERTEX attribute -- the same trick
// world/ground.js uses to put a road and a meadow on one surface -- so slate, slate-blue, iron and
// timber cost one draw call between them instead of four. This is an iPad.

import * as THREE from '../../vendor/three.module.min.js';
import { mergeGeometries } from '../../vendor/utils/BufferGeometryUtils.js';
import { WORLD, setLayer } from '../render/layers.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { prefersReducedMotion } from '../render/motionPreference.js';
import { GATE_WOOD_COLOR } from './wildwoodGate.js';

// Cool pale slate. Deliberately DARKER and COOLER than the Kenney rock props it will stand near
// (they read around 0xb8bec7 in the running game) so a child does not read the Beacon as one more
// boulder, and far enough off the meadow's greens to separate by hue at fog distance.
export const BEACON_STONE_COLOR = 0x8e97a4;
// The one large accent shape the detail floor allows (docs/GALAQUEST_VISUAL_AUTHORITY.md: "A major
// piece gets one base colour, two or three broad value planes, and at most one large accent shape").
// GalaQuest's own slate blue, the colour already tying the hero's collar to the shield rim to the
// helmet brow -- so the Beacon belongs to this world rather than to a separate art pack.
export const BEACON_TRIM_COLOR = 0x4d6b91;
// The cresset itself. Dark warm iron -- and it started at 0x2f2a2c, which photographed as a HOLE
// PUNCHED IN THE SKY rather than as a basket: at that value the flat-shaded facets all clamped to
// the same near-black and the shape lost every one of its internal value planes, which is exactly
// what docs/GALAQUEST_VISUAL_AUTHORITY.md's own "pure black flattens to a hole in the picture" warns
// about (world/bramble.js records the same correction for the same reason). Lightened until the
// facets separate while it is still unmistakably the darkest thing on the tower.
export const BEACON_IRON_COLOR = 0x453e41;
// WHAT IS WRONG HERE, said in one colour. Dead fire is not black, it is a cold grey-blue: the same
// "not warm" reading world/bramble.js's bruised violet uses, in the one place a child is looking.
export const BEACON_EMBER_COLD_COLOR = 0x5b6b7a;

// The stack, bottom to top. Every band is expressed against the one above and below it rather than
// as an absolute y, so changing one height cannot silently leave a gap.
const PLINTH_RADIUS_METERS = 2.05;
// KNEE-HIGH IS TOO HIGH, and the number is the difference between a built place and a bug. Nothing
// in this game collides -- world/bramble.js's header says so plainly, and a child already walks
// through houses and trees -- but a broad flat octagon reads as a FLOOR in a way a tree trunk never
// does, so a hero standing on it is not "clipping scenery", they are sunk into the ground. At 0.5 m
// the arrival capture showed the hero buried to just below the knee with their boots gone and half
// the shield inside the stone, at exactly the moment this whole slice is built for. At 0.22 m the
// same step is ankle-deep and invisible at gameplay distance, and the octagon still does all the
// "somebody built this" work -- that read comes from its SHAPE, not from its height.
// The 0.28 m came off the plinth and went back into the shaft, so the tower's total height and its
// portrait framing budget are untouched.
const PLINTH_HEIGHT_METERS = 0.22;
const SHAFT_HEIGHT_METERS = 4.53;
const SHAFT_BOTTOM_RADIUS_METERS = 0.92;
const SHAFT_TOP_RADIUS_METERS = 0.56;
const COLLAR_HEIGHT_METERS = 0.28;
const COLLAR_RADIUS_METERS = 1.02;
const CRESSET_HEIGHT_METERS = 1.07;
const CRESSET_BOTTOM_RADIUS_METERS = 0.66;
// The widest point of the whole tower, at the very top -- reference rule 2. 2.28 m across against
// the shaft's 1.84 m: an unmistakable flare rather than a taper that merely stops.
const CRESSET_TOP_RADIUS_METERS = 1.14;
// THE DEAD FIRE, and it FILLS the basket rather than sitting as a pebble at the bottom of it. A
// cresset with a small lump in it reads as empty; one packed with cold grey ash reads as a fire that
// went out, which is the whole sentence this object has to say before anybody speaks. Sized to stop
// 0.17 m below the rim and 0.16 m inside the wall at every height, so it never breaks the flare that
// makes the silhouette.
const EMBER_BOTTOM_RADIUS_METERS = 0.68;
const EMBER_TOP_RADIUS_METERS = 0.98;
const EMBER_HEIGHT_METERS = 0.72;
const EMBER_RISE_METERS = 0.18;
const BAND_HEIGHT_METERS = 0.35;
const BAND_RADIUS_METERS = 0.78;
// Eight sides, not sixteen. At the distance this is looked at, the extra facets are invisible and
// the flat shading is what makes it read as CUT STONE rather than as a smooth cylinder.
const RADIAL_SEGMENTS = 8;

export const BEACON_TOTAL_HEIGHT_METERS = PLINTH_HEIGHT_METERS + SHAFT_HEIGHT_METERS
  + COLLAR_HEIGHT_METERS + CRESSET_HEIGHT_METERS;

// The cold halo around the dead cresset. Pale cyan, and the colour matters more than the strength:
// every other glow in this game is the lanterns' warm 0xffc477, so this one can never be misread as
// "the Beacon is lit". It is here because a child eighteen metres away at the camp needs ONE pixel
// of "that thing is not just scenery", and because a beacon that is merely absent of light is
// indistinguishable from a chimney.
export const BEACON_GLOW_COLOR = 0x9fd0e8;
export const BEACON_GLOW_SIZE_METERS = 1.6;
/** What the cold cresset sits at, always. Well under the gate lamp's own 0.9 -- this is a wrong,
 *  faint thing, not a light. */
export const BEACON_GLOW_REST = 0.26;
/** What the arrival stir peaks at before falling back to BEACON_GLOW_REST. Chosen so that even the
 *  peak stays below the gate lamp's lit strength: arriving must not look like winning. */
export const BEACON_GLOW_STIR_PEAK = 0.62;
/** How long the stir takes, in seconds. One breath: up fast, down slow, and finished. */
export const BEACON_STIR_SECONDS = 1.6;
// ── G3: the Beacon alight ───────────────────────────────────────────────────────────────────────
//
// The warm half of this object's whole life. Every colour here is the deliberate opposite of the
// cold one it replaces, because the single sentence this payoff has to say -- across a clearing, to
// a child who may be looking at the ground -- is "it is WARM now".
//
// The ember colour is the lanterns' own warm gold rather than a new orange: the Beacon is the last
// and largest link in the chain of lights the child has been waking since Chapter 2 (this file's own
// reference rule 4), so when it finally catches it must look like the same fire.
export const BEACON_EMBER_WARM_COLOR = 0xffb347;
export const BEACON_GLOW_WARM_COLOR = 0xffc477;
/** What a lit Beacon holds, forever. Above the gate lamp's own 0.9 -- this is the biggest light in
 *  the world now, and it is the one thing in the zone allowed to outshine the Lantern Tree's road. */
export const BEACON_GLOW_LIT = 1.15;
/** How long the catch takes. Longer than the stir (1.6 s) on purpose: a stir is a shiver and this is
 *  an event, and the extra second is what a child needs to stop moving and look up. */
export const BEACON_IGNITE_SECONDS = 2.4;
const STIR_RISE_FRACTION = 0.25;

// ── THE FIRE YOU CAN ACTUALLY SEE ──────────────────────────────────────────────────────────────
//
// The Beacon "lit" and, from the ground, nothing happened.
//
// That is not a figure of speech: the ignition repaints the EMBERS, and the embers are packed inside
// an openEnded cresset whose top radius (1.14 m) is the widest point of the whole tower and whose
// ash stops 0.17 m BELOW the rim -- deliberately, so the flare that makes the silhouette is never
// broken. Every one of those decisions is right, and together they mean the fire sits in a bowl a
// child standing at the foot of a six-metre tower is looking at from underneath. The post-win
// screenshot is a black basket against a blue sky with a banner underneath it reading "The Old
// Beacon is burning!". The largest payoff in the game, and the game was the only one who could see
// it.
//
// So the fire has to LEAVE THE BASKET. These three tongues start inside the ash and rise past the
// rim, which is the one place a flame can be and still be a flame.
//
// THREE CONES, NOT A PARTICLE SYSTEM. This is an iPad, and the whole object has spent its life
// paying for one draw call; a flame that cost twenty would be a strange place to stop caring. Three
// nested cones merged into one geometry give exactly what
// docs/GALAQUEST_VISUAL_AUTHORITY.md asks a major piece for -- "two or three broad value planes" --
// and the shape does the rest: a cone IS the silhouette of a flame, at every distance this is
// looked at, which a sprite billboard is not once you walk around it.
const FLAME_ROOT_SINK_METERS = 0.14;
const FLAME_BODY_HEIGHT_METERS = 1.24;
const FLAME_HEART_HEIGHT_METERS = 1.62;
const FLAME_TIP_HEIGHT_METERS = 1.94;
const FLAME_BODY_RADIUS_METERS = 0.84;
const FLAME_HEART_RADIUS_METERS = 0.5;
const FLAME_TIP_RADIUS_METERS = 0.24;
// Amber at the base, the lanterns' own gold through the middle, near-white at the tip -- the same
// hot-core reading render/glow.js's 'lamp' profile is built on, said in geometry instead of pixels.
// The base colour is BEACON_EMBER_WARM_COLOR itself, imported from the ash it grows out of, so the
// flame and the coals can never drift apart into two different fires (GQ-007).
const FLAME_HEART_COLOR = 0xffd489;
const FLAME_TIP_COLOR = 0xfff3d2;
/** How far the flame's own tip stands above the cresset rim. Not a tuning knob -- it is the entire
 *  reason this geometry exists, and test/old-beacon.test.mjs asserts it stays positive. */
export const FLAME_TIP_ABOVE_RIM_METERS = FLAME_TIP_HEIGHT_METERS - FLAME_ROOT_SINK_METERS
  - (CRESSET_HEIGHT_METERS - EMBER_RISE_METERS - EMBER_HEIGHT_METERS);
// A second, much larger halo for the lit Beacon, hung at the flame's own middle rather than at the
// cresset. The existing sprite is 1.6 m across and sits at the basket: perfect for "that thing is
// not just scenery" at eighteen metres, far too small to be a bonfire on a tower. This one is the
// light a child sees from the camp without looking up.
export const BEACON_FIRE_GLOW_SIZE_METERS = 4.2;
/** Slow, and deliberately not a flicker. A flame that strobes reads as a broken light; a flame that
 *  BREATHES reads as alive, and the difference at gameplay distance is entirely the frequency. Two
 *  incommensurable sines so the loop never visibly repeats -- no Math.random anywhere near it, for
 *  the same reason the rules modules refuse it: a thing that cannot be reproduced cannot be tested. */
const FLAME_BREATH_A_HZ = 0.63;
const FLAME_BREATH_B_HZ = 1.47;
const FLAME_BREATH_RISE = 0.075;
const FLAME_BREATH_WIDTH = 0.035;

/**
 * The flame in the Beacon's own local space, in the shape bakedPart() consumes.
 *
 * Exported and pure for the same reason beaconParts() is: the thing most likely to go wrong here is
 * a number -- specifically, a tip that fails to clear the rim, which is the ONLY property this
 * geometry exists to have and the one a screenshot proved was missing.
 */
export function beaconFlameParts() {
  const cressetBase = PLINTH_HEIGHT_METERS + SHAFT_HEIGHT_METERS + COLLAR_HEIGHT_METERS;
  const root = cressetBase + EMBER_RISE_METERS + EMBER_HEIGHT_METERS - FLAME_ROOT_SINK_METERS;
  // Each tongue is yawed off its neighbours so three eight-sided cones do not line their facets up
  // into one smooth cone with stripes on it.
  return [
    {
      name: 'flame-body',
      kind: 'cylinder',
      radiusBottom: FLAME_BODY_RADIUS_METERS,
      radiusTop: 0,
      height: FLAME_BODY_HEIGHT_METERS,
      at: [0, root + FLAME_BODY_HEIGHT_METERS / 2, 0],
      color: BEACON_EMBER_WARM_COLOR,
    },
    {
      name: 'flame-heart',
      kind: 'cylinder',
      radiusBottom: FLAME_HEART_RADIUS_METERS,
      radiusTop: 0,
      height: FLAME_HEART_HEIGHT_METERS,
      at: [0, root + FLAME_HEART_HEIGHT_METERS / 2, 0],
      color: FLAME_HEART_COLOR,
      yaw: Math.PI / 8,
    },
    {
      name: 'flame-tip',
      kind: 'cylinder',
      radiusBottom: FLAME_TIP_RADIUS_METERS,
      radiusTop: 0,
      height: FLAME_TIP_HEIGHT_METERS,
      at: [0, root + FLAME_TIP_HEIGHT_METERS / 2, 0],
      color: FLAME_TIP_COLOR,
      yaw: Math.PI / 16,
    },
  ];
}

/** The flame's own top, in metres above the Beacon's ground. Above BEACON_TOTAL_HEIGHT_METERS by
 *  construction -- see FLAME_TIP_ABOVE_RIM_METERS. */
export const BEACON_FIRE_TOP_METERS = PLINTH_HEIGHT_METERS + SHAFT_HEIGHT_METERS
  + COLLAR_HEIGHT_METERS + EMBER_RISE_METERS + EMBER_HEIGHT_METERS
  - FLAME_ROOT_SINK_METERS + FLAME_TIP_HEIGHT_METERS;

/**
 * How tall the flame stands at `seconds` into the ignition, as a fraction of full.
 *
 * Starts at nothing and overshoots slightly before settling, which is what a fire that CATCHES does
 * -- it flares as it takes hold and then finds its height. Pure, so the curve is testable.
 */
export function beaconFlameScale(seconds) {
  if (!(seconds >= 0)) return 0;
  if (seconds >= BEACON_IGNITE_SECONDS) return 1;
  const t = seconds / BEACON_IGNITE_SECONDS;
  return Math.sin(t * Math.PI * 0.5) * (1 + 0.18 * Math.sin(t * Math.PI));
}

/** The breathing multiplier for a settled flame, at `seconds` since it took hold. */
export function beaconFlameBreath(seconds) {
  const a = Math.sin(seconds * Math.PI * 2 * FLAME_BREATH_A_HZ);
  const b = Math.sin(seconds * Math.PI * 2 * FLAME_BREATH_B_HZ);
  const wave = (a * 0.65 + b * 0.35);
  return { rise: 1 + wave * FLAME_BREATH_RISE, width: 1 - wave * FLAME_BREATH_WIDTH };
}

/**
 * Every part of the Beacon in its own local space: y = 0 is the ground, local +Z points back down
 * the road the child arrives along, and each part carries the colour it is built from.
 *
 * Exported so its proportions can be asserted without a browser -- the thing most likely to go wrong
 * here is a number, not a matrix. Same split wildwoodGate.js's own gateParts() makes.
 */
export function beaconParts() {
  const parts = [];
  const shaftBase = PLINTH_HEIGHT_METERS;
  const collarBase = shaftBase + SHAFT_HEIGHT_METERS;
  const cressetBase = collarBase + COLLAR_HEIGHT_METERS;

  parts.push({
    name: 'plinth',
    kind: 'cylinder',
    radiusBottom: PLINTH_RADIUS_METERS,
    radiusTop: PLINTH_RADIUS_METERS * 0.94,
    height: PLINTH_HEIGHT_METERS,
    at: [0, PLINTH_HEIGHT_METERS / 2, 0],
    color: BEACON_STONE_COLOR,
  });
  // The way in. A single worn step on the road side, so the plinth has a front and a child can see
  // which way the builders meant you to come at it.
  parts.push({
    name: 'step',
    kind: 'box',
    size: [2.4, 0.16, 0.9],
    at: [0, 0.08, PLINTH_RADIUS_METERS + 0.3],
    color: BEACON_STONE_COLOR,
  });
  parts.push({
    name: 'shaft',
    kind: 'cylinder',
    radiusBottom: SHAFT_BOTTOM_RADIUS_METERS,
    radiusTop: SHAFT_TOP_RADIUS_METERS,
    height: SHAFT_HEIGHT_METERS,
    at: [0, shaftBase + SHAFT_HEIGHT_METERS / 2, 0],
    color: BEACON_STONE_COLOR,
  });
  parts.push({
    name: 'band',
    kind: 'cylinder',
    radiusBottom: BAND_RADIUS_METERS,
    radiusTop: BAND_RADIUS_METERS,
    height: BAND_HEIGHT_METERS,
    at: [0, shaftBase + SHAFT_HEIGHT_METERS * 0.72, 0],
    color: BEACON_TRIM_COLOR,
  });
  parts.push({
    name: 'collar',
    kind: 'cylinder',
    radiusBottom: COLLAR_RADIUS_METERS,
    radiusTop: COLLAR_RADIUS_METERS,
    height: COLLAR_HEIGHT_METERS,
    at: [0, collarBase + COLLAR_HEIGHT_METERS / 2, 0],
    color: BEACON_STONE_COLOR,
  });
  // THE CRESSET. Open at both ends (`openEnded`), which is what makes it a basket rather than a cup
  // and is the one part of this object a child has to be able to name.
  parts.push({
    name: 'cresset',
    kind: 'cylinder',
    radiusBottom: CRESSET_BOTTOM_RADIUS_METERS,
    radiusTop: CRESSET_TOP_RADIUS_METERS,
    height: CRESSET_HEIGHT_METERS,
    openEnded: true,
    at: [0, cressetBase + CRESSET_HEIGHT_METERS / 2, 0],
    color: BEACON_IRON_COLOR,
  });
  parts.push({
    name: 'embers',
    kind: 'cylinder',
    radiusBottom: EMBER_BOTTOM_RADIUS_METERS,
    radiusTop: EMBER_TOP_RADIUS_METERS,
    height: EMBER_HEIGHT_METERS,
    at: [0, cressetBase + EMBER_RISE_METERS + EMBER_HEIGHT_METERS / 2, 0],
    color: BEACON_EMBER_COLD_COLOR,
  });
  // A timber prop leaning on the shaft, in the Wildwood Gate's OWN wood colour (imported, not
  // restated -- docs/MISTAKES.md GQ-007). Somebody shored this up, which is a whole sentence of
  // story for one box, and it breaks the tower's symmetry so the silhouette is not a lamp post.
  parts.push({
    name: 'brace',
    kind: 'box',
    size: [0.19, 3.1, 0.19],
    at: [-1.28, 1.42, 0.34],
    roll: 0.42,
    color: GATE_WOOD_COLOR,
  });
  // FALLEN KERB, the escalation cue: the same slate starts appearing beside the road a few metres
  // out, so the last stretch of the walk is already the Beacon's own ruin rather than more forest.
  // Local +Z is back down the road, so these are strung out along the way the child comes in.
  // Sizes and angles all differ: four identical boxes read as crates somebody stacked, and the
  // thing they have to read as is a wall that came down.
  for (const [x, z, width, depth, height, yaw, roll] of [
    [2.35, 1.05, 0.86, 0.52, 0.32, 0.6, 0.13],
    [-2.2, -0.9, 0.64, 0.6, 0.26, 2.1, -0.09],
    [1.9, 3.2, 0.95, 0.44, 0.22, 1.2, 0.2],
    [-1.7, 4.6, 0.7, 0.58, 0.34, 0.3, -0.16],
    [-2.9, 2.1, 0.5, 0.46, 0.2, 1.9, 0.07],
  ]) {
    parts.push({
      name: 'fallen',
      kind: 'box',
      size: [width, height, depth],
      at: [x, height / 2, z],
      yaw,
      roll,
      color: BEACON_STONE_COLOR,
    });
  }
  return {
    parts,
    topMeters: BEACON_TOTAL_HEIGHT_METERS,
    cressetAt: [0, cressetBase + CRESSET_HEIGHT_METERS * 0.45, 0],
  };
}

/** The whole waystone in its own local space -- see WAYSTONE_HEIGHT_METERS for what it is for. */
const WAYSTONE_SHAFT_HEIGHT_METERS = 1.34;
const WAYSTONE_CAP_HEIGHT_METERS = 0.16;
const WAYSTONE_BASE_HEIGHT_METERS = 0.16;
export const WAYSTONE_HEIGHT_METERS = WAYSTONE_BASE_HEIGHT_METERS + WAYSTONE_SHAFT_HEIGHT_METERS
  + WAYSTONE_CAP_HEIGHT_METERS;

/**
 * A marker stone: the Beacon's own slate, knee-to-shoulder high, standing beside the road.
 *
 * Two of them, and their job is reference rule 5 -- a landmark at a decision point. The first stands
 * where the road leaves Rowan's camp, so the way out reads as a MADE way rather than as a gap
 * between two trees; the second stands on the outside of the bend, where a child has to choose. They
 * are also the first slate a child sees, seven and eleven metres before the Beacon's own, which is
 * what turns the walk into an approach.
 *
 * Deliberately just over the 1.48 m hero: tall enough to be a thing, short enough that it can never
 * be mistaken for the Beacon itself at distance.
 */
export function waystoneParts() {
  return [
    {
      name: 'base',
      kind: 'cylinder',
      radiusBottom: 0.42,
      radiusTop: 0.36,
      height: WAYSTONE_BASE_HEIGHT_METERS,
      at: [0, WAYSTONE_BASE_HEIGHT_METERS / 2, 0],
      color: BEACON_STONE_COLOR,
      radialSegments: 6,
    },
    {
      name: 'shaft',
      kind: 'cylinder',
      radiusBottom: 0.3,
      radiusTop: 0.2,
      height: WAYSTONE_SHAFT_HEIGHT_METERS,
      at: [0, WAYSTONE_BASE_HEIGHT_METERS + WAYSTONE_SHAFT_HEIGHT_METERS / 2, 0],
      color: BEACON_STONE_COLOR,
      radialSegments: 6,
    },
    {
      name: 'cap',
      kind: 'cylinder',
      radiusBottom: 0.26,
      radiusTop: 0.22,
      height: WAYSTONE_CAP_HEIGHT_METERS,
      at: [0, WAYSTONE_BASE_HEIGHT_METERS + WAYSTONE_SHAFT_HEIGHT_METERS + WAYSTONE_CAP_HEIGHT_METERS / 2, 0],
      color: BEACON_TRIM_COLOR,
      radialSegments: 6,
    },
  ];
}

/** One part baked into local space with its colour written into a vertex attribute, so a whole
 *  multi-coloured structure merges into ONE geometry and therefore ONE draw call. */
function bakedPart(part) {
  const geometry = part.kind === 'box'
    ? new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2])
    : new THREE.CylinderGeometry(
      part.radiusTop, part.radiusBottom, part.height,
      part.radialSegments ?? RADIAL_SEGMENTS, 1, part.openEnded === true,
    );
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Euler(0, part.yaw ?? 0, part.roll ?? 0, 'YZX');
  matrix.makeRotationFromEuler(rotation);
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
  // mergeGeometries refuses a set whose attributes disagree, and CylinderGeometry ships a uv the
  // BoxGeometry also ships but an openEnded cylinder does not always index identically -- dropping
  // uv from every part keeps the merge total and costs nothing, since nothing here is textured.
  geometry.deleteAttribute('uv');
  return geometry;
}

function stoneMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
    // The cresset is an open tube, so its far wall has to be drawn. Free at ~250 triangles, and it
    // is what stops the basket reading as a half-pipe from the north side.
    side: THREE.DoubleSide,
  });
}

/**
 * The stir's own curve, as a pure function of how far into it we are.
 *
 * Split out of the presenter because the presenter needs a canvas (render/glow.js paints its sprite
 * texture into one) and this does not -- so the SHAPE of the response can be asserted under plain
 * `node --test` while the wiring is proven in the running game by
 * tools/runtime-test/drive-old-beacon.mjs. The same split world/trail.js and world/relight.js already
 * make, and for the same reason.
 *
 * @param seconds  how far into the stir, in seconds. Negative or past the end means "at rest".
 * @returns the glow strength to hold this frame.
 */
/**
 * The ignition's own curve: a fast catch and then a long steady climb to a light that stays.
 *
 * Written as the OPPOSITE of beaconStirStrength below, deliberately, because those are the two
 * things this object can do and a child has to be able to tell them apart instantly. The stir goes
 * up fast and sags back to nothing -- something failing. This goes up and NEVER COMES DOWN.
 *
 * Pure, for the same reason the stir's curve is: the shape can be asserted under plain `node --test`
 * while the wiring is proven in the running game.
 *
 * @param seconds  how far into the ignition. Past the end holds BEACON_GLOW_LIT forever.
 */
export function beaconIgniteStrength(seconds) {
  if (!(seconds >= 0)) return BEACON_GLOW_REST;
  if (seconds >= BEACON_IGNITE_SECONDS) return BEACON_GLOW_LIT;
  const t = seconds / BEACON_IGNITE_SECONDS;
  // Catches hard in the first fifth (the moment the fire takes), then eases the rest of the way, so
  // the beat lands immediately and the swell afterwards is the part that feels big.
  const shape = t < 0.2 ? (t / 0.2) * 0.7 : 0.7 + ((t - 0.2) / 0.8) * 0.3;
  return BEACON_GLOW_REST + (BEACON_GLOW_LIT - BEACON_GLOW_REST) * shape;
}

export function beaconStirStrength(seconds) {
  if (!(seconds >= 0) || seconds >= BEACON_STIR_SECONDS) return BEACON_GLOW_REST;
  const t = seconds / BEACON_STIR_SECONDS;
  // Up fast, down slow: the shape of something stirring and FAILING, not of something igniting.
  const shape = t < STIR_RISE_FRACTION
    ? t / STIR_RISE_FRACTION
    : 1 - (t - STIR_RISE_FRACTION) / (1 - STIR_RISE_FRACTION);
  return BEACON_GLOW_REST + (BEACON_GLOW_STIR_PEAK - BEACON_GLOW_REST) * shape;
}

/**
 * Where a "can the player actually SEE it" probe is aimed: the middle of the cresset, which is the
 * part of this object that carries its identity. Aiming at the base would answer a question nobody
 * asked -- the base is behind trees for most of the approach and the top is the whole point.
 */
export const BEACON_SIGHT_HEIGHT_METERS = PLINTH_HEIGHT_METERS + SHAFT_HEIGHT_METERS
  + COLLAR_HEIGHT_METERS + CRESSET_HEIGHT_METERS * 0.5;

/**
 * Is a projected point actually inside the frame?
 *
 * PURE, so "the Beacon is visible before you touch it" can be asserted in a plain `node --test` as
 * well as against the running game, and so the one part a naive version gets wrong -- forgetting
 * that a point BEHIND the camera still lands inside the -1..1 box on x and y -- has a test rather
 * than a comment. `ndcZ` outside -1..1 is behind the near plane or past the far one.
 */
export function beaconInFrame({ ndcX, ndcY, ndcZ }) {
  return ndcZ > -1 && ndcZ < 1 && Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1;
}

const SIGHT_PROBE = new THREE.Vector3();

/**
 * Where the Beacon's cresset is on screen right now, from a given camera.
 *
 * Free of the presenter (and so of the canvas render/glow.js needs) on purpose: this is the one G1
 * question a screenshot can ask but not answer repeatably -- did the child SEE this before they
 * walked into it -- and it has to be answerable from a bare camera in a test as well as from the
 * live one in the running game. Reported as numbers rather than as a boolean alone so a harness that
 * says "not visible" can also say how far off frame it was.
 */
export function beaconSight(camera, beaconAt, heroPosition) {
  SIGHT_PROBE.set(beaconAt[0], BEACON_SIGHT_HEIGHT_METERS, beaconAt[1]);
  const metersFromHero = Math.hypot(SIGHT_PROBE.x - heroPosition.x, SIGHT_PROBE.z - heroPosition.z);
  SIGHT_PROBE.project(camera);
  const ndc = { ndcX: SIGHT_PROBE.x, ndcY: SIGHT_PROBE.y, ndcZ: SIGHT_PROBE.z };
  return { ...ndc, metersFromHero, onScreen: beaconInFrame(ndc) };
}

/**
 * Build the Beacon and put it in the scene.
 *
 * @param scene   the scene to add to
 * @param beacon  `{ at: [x, z], rotY }` -- see OLD_BEACON in the zone data
 * @returns `{ at, stir, update, isStirring, glowStrength }`
 *
 * THE STIR IS NOT A CEREMONY WITH AN AUDIENCE PROBLEM (docs/MISTAKES.md, "a one-time ceremony fired
 * off a server edge plays to whoever happens to be looking"). Its trigger is this player's own
 * arrival inside the Beacon's radius, so the player is standing in front of it by construction.
 */
export function buildOldBeacon(scene, beacon) {
  const { parts, cressetAt } = beaconParts();
  const baked = parts.map(bakedPart);
  // WHERE THE DEAD FIRE LIVES INSIDE ONE MERGED GEOMETRY.
  //
  // The whole tower is a single mesh carrying its colours as a vertex attribute (this file's own
  // header explains why: this is an iPad). That is still the right trade after G3 -- but exactly one
  // part of it has to change colour when the Beacon catches, so the ignition needs to know which
  // slice of the merged buffer those vertices are. Computed from the same `parts` list in the same
  // order mergeGeometries consumes it, rather than by hunting for grey-blue vertices afterwards:
  // one source of truth, and it stays correct if a part is ever added above the embers.
  let emberVertexStart = 0;
  let emberVertexCount = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const count = baked[index].getAttribute('position').count;
    if (parts[index].name === 'embers') { emberVertexCount = count; break; }
    emberVertexStart += count;
  }
  const mesh = new THREE.Mesh(mergeGeometries(baked, false), stoneMaterial());
  mesh.name = 'old-beacon';
  setLayer(mesh, WORLD);
  mesh.position.set(beacon.at[0], 0, beacon.at[1]);
  mesh.rotation.y = beacon.rotY ?? 0;
  scene.add(mesh);

  const sprite = createGlowSprite(BEACON_GLOW_COLOR, BEACON_GLOW_SIZE_METERS);
  sprite.name = 'old-beacon-glow';
  setLayer(sprite, WORLD);
  sprite.position.set(beacon.at[0], cressetAt[1], beacon.at[1]);
  setGlowStrength(sprite, BEACON_GLOW_REST);
  scene.add(sprite);

  // THE FIRE, BUILT COLD. It exists from the first frame and is simply not drawn -- a hidden mesh
  // costs nothing per frame, and building it on ignition instead would mean compiling geometry
  // during the one event in the game nobody is allowed to see stutter. Its own group carries the
  // scale, so breathing never touches the tower it sits on.
  const flame = new THREE.Group();
  flame.name = 'old-beacon-flame';
  const flameMesh = new THREE.Mesh(
    mergeGeometries(beaconFlameParts().map(bakedPart), false),
    // UNLIT, on purpose. Fire is not a surface being lit by something else; a MeshStandardMaterial
    // here would take its value from the scene's own lighting and go dim at dusk, which is exactly
    // backwards for the brightest thing in the world. Basic + vertex colours holds the three value
    // planes beaconFlameParts() built at whatever hour the child is playing.
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  );
  flame.add(flameMesh);
  setLayer(flame, WORLD);
  flame.position.set(beacon.at[0], 0, beacon.at[1]);
  flame.rotation.y = beacon.rotY ?? 0;
  flame.visible = false;
  flame.scale.set(0, 0, 0);
  scene.add(flame);

  // ...and the halo that carries it across the clearing. Hung at the flame's middle rather than at
  // the basket, and two and a half times the cold sprite's size: the small one says "not scenery"
  // from the camp, this one says "it is BURNING" from the same place without looking up.
  const fireGlow = createGlowSprite(BEACON_GLOW_WARM_COLOR, BEACON_FIRE_GLOW_SIZE_METERS);
  fireGlow.name = 'old-beacon-fire-glow';
  setLayer(fireGlow, WORLD);
  fireGlow.position.set(beacon.at[0], BEACON_FIRE_TOP_METERS - FLAME_TIP_HEIGHT_METERS * 0.45, beacon.at[1]);
  setGlowStrength(fireGlow, 0);
  scene.add(fireGlow);

  let stirSeconds = -1;
  let strength = BEACON_GLOW_REST;
  // Seconds since the flame finished taking hold, which is what the breathing runs off. Separate
  // from litSeconds so a restored-lit client (which starts past the ignition) breathes from zero
  // rather than from wherever its clock happened to be.
  let burnSeconds = 0;
  const applyFlame = (scale, breath) => {
    const rise = breath?.rise ?? 1;
    const width = breath?.width ?? 1;
    flame.scale.set(scale * width, scale * rise, scale * width);
  };
  // G3: the payoff. `litSeconds` runs the ignition once and then stays at its end, because unlike
  // the stir this is not a thing that falls back -- the world REMEMBERS. -1 means cold.
  let litSeconds = -1;
  return {
    at: beacon.at,
    sight: (camera, heroPosition) => beaconSight(camera, beacon.at, heroPosition),
    /** The arrival response. Under reduced motion it is a no-op that leaves the cold rest glow
     *  exactly where it was -- the banner and the objective still land, so nothing is LOST, only the
     *  nonessential movement. */
    stir() {
      if (prefersReducedMotion()) return;
      stirSeconds = 0;
    },
    /**
     * THE OLD BEACON CATCHES. Cold, dead grey-blue -> warm, alive, and it STAYS.
     *
     * Idempotent: a client that learns the Beacon is already lit (a late joiner, a reload, a
     * restarted server -- see net/gameServer.mjs's own restore path) calls this exactly the same way
     * the child who just won calls it, and gets a burning Beacon either way. Whether a CEREMONY is
     * played is main.js's decision, not this presenter's, for the same reason the Lantern Tree's own
     * relight splits those two questions: only the client knows whether it watched the Beacon be
     * cold. Under reduced motion the transition is instant rather than absent -- the world state is
     * never withheld, only the movement.
     */
    ignite() {
      if (litSeconds >= 0) return;
      litSeconds = prefersReducedMotion() ? BEACON_IGNITE_SECONDS : 0;
      // The dead ash becomes fire, in the one place the whole object has been pointing at since G1.
      // Repainted in place on the merged buffer -- one draw call in, one draw call out.
      const colors = mesh.geometry.getAttribute('color');
      const warm = new THREE.Color(BEACON_EMBER_WARM_COLOR);
      for (let i = emberVertexStart; i < emberVertexStart + emberVertexCount; i += 1) {
        colors.setXYZ(i, warm.r, warm.g, warm.b);
      }
      colors.needsUpdate = true;
      // Stops any stir mid-flight: the cresset does not get to shiver while it is catching.
      stirSeconds = -1;
      flame.visible = true;
      if (litSeconds >= BEACON_IGNITE_SECONDS) {
        strength = BEACON_GLOW_LIT;
        sprite.material.color.setHex(BEACON_GLOW_WARM_COLOR);
        setGlowStrength(sprite, strength);
        applyFlame(1);
        setGlowStrength(fireGlow, BEACON_GLOW_LIT);
      } else {
        applyFlame(beaconFlameScale(0));
      }
    },
    update(deltaSeconds) {
      // The ignition owns the glow while it runs -- it is the bigger event, and two curves writing
      // one sprite is the kind of thing that reads as a flicker.
      if (litSeconds >= 0) {
        if (litSeconds < BEACON_IGNITE_SECONDS) {
          litSeconds += deltaSeconds;
          const t = Math.min(1, litSeconds / BEACON_IGNITE_SECONDS);
          strength = beaconIgniteStrength(litSeconds);
          // Crossfades the halo from the cold pale-cyan to the lanterns' own warm gold, so the
          // Beacon visibly JOINS the chain of lights it has been the dead end of.
          sprite.material.color.setHex(t >= 0.5 ? BEACON_GLOW_WARM_COLOR : BEACON_GLOW_COLOR);
          setGlowStrength(sprite, strength);
          applyFlame(beaconFlameScale(litSeconds));
          setGlowStrength(fireGlow, strength);
          return;
        }
        // SETTLED, AND STILL ALIVE. The Beacon burns for the rest of the session, so this is the one
        // animation in the file with no end: everything else here is an event that finishes.
        burnSeconds += deltaSeconds;
        if (!prefersReducedMotion()) {
          const breath = beaconFlameBreath(burnSeconds);
          applyFlame(1, breath);
        }
        return;
      }
      if (stirSeconds < 0) return;
      stirSeconds += deltaSeconds;
      strength = beaconStirStrength(stirSeconds);
      setGlowStrength(sprite, strength);
      if (stirSeconds >= BEACON_STIR_SECONDS) stirSeconds = -1;
    },
    isStirring: () => stirSeconds >= 0,
    isLit: () => litSeconds >= 0,
    glowStrength: () => strength,
    /** What a screenshot would show: the flame is drawn, and how tall it currently stands. A
     *  harness that can only read `isLit` can be told the Beacon is burning by an object with no
     *  fire on it, which is precisely the failure this whole section exists to close. */
    fireHeightMeters: () => (flame.visible ? BEACON_FIRE_TOP_METERS * flame.scale.y : 0),
    fireTopMeters: () => BEACON_FIRE_TOP_METERS,
  };
}

/**
 * Build every waystone as ONE merged mesh -- they never move and they are all the same stone, so
 * two of them cost one draw call between them rather than one each.
 *
 * @param scene      the scene to add to
 * @param waystones  `[{ at: [x, z], rotY, leanRadians }, ...]` -- see BEACON_WAYSTONES in the zone data
 */
export function buildBeaconWaystones(scene, waystones) {
  if (!waystones || waystones.length === 0) return null;
  const geometries = [];
  for (const stone of waystones) {
    // Baked into WORLD space rather than parented, which is the whole reason they can share a mesh.
    const place = new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(0, stone.rotY ?? 0, stone.leanRadians ?? 0, 'YZX'))
      .setPosition(stone.at[0], 0, stone.at[1]);
    for (const part of waystoneParts()) {
      const geometry = bakedPart(part);
      geometry.applyMatrix4(place);
      geometries.push(geometry);
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(geometries, false), stoneMaterial());
  mesh.name = 'beacon-waystones';
  setLayer(mesh, WORLD);
  scene.add(mesh);
  return { count: waystones.length };
}
