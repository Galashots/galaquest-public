// public/src/world/zoneLoader.js
//
// Turns a zones/*.js data module into scene objects, reusing the GLTFLoader plumbing main.js
// already relies on for the hero and the wolf (world/assets.js's loadGLB -- one cache, one
// console.error-and-magenta-placeholder fallback on a 404). Landmarks and props sit on the WORLD
// render layer (render/layers.js), same as ground.js's placeholder geometry; the Keeper NPC sits on
// CHARACTER, same as the hero and the wolf, since it animates and the camera already enables both
// layers.

import * as THREE from '../../vendor/three.module.min.js';
import { normaliseCharacterMaterial } from '../character/hero.js';
import { CHARACTER, WORLD, setLayer } from '../render/layers.js';
import { createGlowSprite, glowTexture, setGlowStrength } from '../render/glow.js';
import { MARKER_LIFT_METERS, createQuestMarker, markerBob } from '../render/questMarker.js';
import { relightBeats } from './relight.js';
import { buildBramble } from './bramble.js';
import { buildWildwoodGate } from './wildwoodGate.js';
import { buildWildwoodBlade } from './wildwoodBlade.js';
import { buildBeaconWaystones, buildOldBeacon } from './oldBeacon.js';
import { buildColdSeals } from './coldSeals.js';
import { buildWarden } from '../enemies/warden.js';
import { buildBlackthornBarrier, buildHollowPocket } from './blackthornHollow.js';
import { buildVillagers } from './villagers.js';
import { buildRowan } from './rowan.js';
import { buildRanger } from './ranger.js';
import { loadGLB } from './assets.js';

const ASSET_PREFIX = 'assets/';

// The keeper's raw import measures 2.70m tall (T-pose bounding box) -- far taller than the 1.479m
// hero. 1.65m is the target world height, close enough to human scale to stand beside the hero
// without looming, tall enough to still read as an adult. Measured, not assumed: see the brief.
export const KEEPER_TARGET_HEIGHT_METERS = 1.65;
// Design ruling (brief V2): any hero within this radius of the keeper triggers `wave` once.
export const KEEPER_WAVE_RADIUS_METERS = 2.0;
// ...and "once" is enforced by a latch that re-arms only when the hero LEAVES, at a slightly wider
// radius than the one that fires it. The gap is hysteresis: a hero hovering exactly on the 2.0 m
// boundary, nudged back and forth by joystick drift or network correction, would otherwise re-arm
// and re-greet repeatedly. Sol's ruling of 2026-08-15 chose leaving over a timed cooldown, because
// a cooldown eventually waves at a child who is still standing there reading -- the same robotic
// behaviour, just less often.
export const KEEPER_GREET_REARM_RADIUS_METERS = 2.5;
// How close the hero must be for the EARNED relight to play. The shipped behaviour lit the tree on
// whatever frame the third mark landed, which is 18 m away at the wolf spawn with the camera behind
// the hero: the payoff for the whole quest happened off screen, behind the child's back. Held until
// they are back in the plaza -- 10 m is a little inside the hero spawn's own 9.2 m sightline to the
// tree, which is the framing .local/runtime-test/relight-unlocked-lit-tree.png was judged at, so
// the tree is a clear subject in frame when it catches.
export const RELIGHT_TRIGGER_RADIUS_METERS = 10;
// How far away the Keeper starts watching you. Three times the wave radius: he should turn his head
// while you are still walking up, so the wave at 2 m is the END of him noticing you rather than the
// whole of it. An NPC who stares rigidly at the horizon while a child walks a circle around him is
// the single cheapest way to look like furniture.
export const KEEPER_NOTICE_RADIUS_METERS = 6.0;
// Radians per second he turns. Slow enough to read as a person turning and not as a turret: a 90
// degree turn takes about a second.
export const KEEPER_TURN_RATE_RADIANS_PER_SECOND = 1.6;
const WAVE_CROSSFADE_SECONDS = 0.15;

// AP2-A: the native Idle_Turn_Left/Idle_Turn_Right clips, when a candidate GLB ships them.
//
// Below this, a request is left to the plain KEEPER_TURN_RATE_RADIANS_PER_SECOND rotation above --
// measured (tools/foundry/measure_root_motion.mjs) at roughly 119 degrees (left) and 104 degrees
// (right) of the clips' OWN authored rotation, playing one for a 20-30 degree adjustment would
// overshoot and then have to visibly correct back, which reads worse than never using it. Above it, a
// clip supplies a real "step and turn" flourish and whatever gap remains between its fixed throw and
// the actual request is closed afterward by the same continuous turnToward, unchanged.
export const KEEPER_TURN_CLIP_MIN_RADIANS = (55 * Math.PI) / 180;
const TURN_CROSSFADE_SECONDS = 0.15;

// ── pure helpers (unit-testable with no three.js, no DOM) ──────────────────────────────────────

/** Multiplier that scales a model measured at `measuredHeight` world units to stand `targetHeight`
 *  world units tall. Guards against a degenerate (zero or negative) measurement rather than
 *  dividing by it -- a model that measured zero tall stays at its authored scale instead of
 *  vanishing or exploding. */
export function scaleForHeight(measuredHeight, targetHeight) {
  if (!(measuredHeight > 0)) return 1;
  return targetHeight / measuredHeight;
}

/** World heading (radians) facing from (fromX, fromZ) toward (toX, toZ). Same atan2(dx, dz)
 *  convention main.js's own player.heading already uses (see camera/rotation.js's
 *  worldDirectionForInput) -- a keeper facing math that disagreed with the hero's own heading math
 *  would face the wrong way for a reason nobody could see by reading either file alone. */
export function headingToward(fromX, fromZ, toX, toZ) {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

export function distance(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

// How close to the camera-to-hero line something has to be before it counts as in the way, and how
// see-through it goes when it is. 1.1 m is about a body's width -- narrow enough that the Keeper
// standing beside the road is solid and only the one actually blocking the shot fades.
export const OCCLUSION_RADIUS_METERS = 1.1;
export const OCCLUDED_OPACITY = 0.22;
// Per second. Fast enough not to lag a walking child, slow enough not to strobe when they graze the
// edge of the test.
export const OCCLUSION_FADE_PER_SECOND = 5;

/**
 * How opaque something at `subject` should be, given a camera at `camera` looking at `hero`.
 * 1 = solid, OCCLUDED_OPACITY = in the way.
 *
 * The test is "between, and near the line": a point BEHIND the camera or PAST the hero is never in
 * the way however close to the line it is, which is what the 0..1 clamp on the projection is for.
 * All in the x/z plane -- height is irrelevant here, since anything tall enough to matter is
 * standing on the same ground.
 */
export function occlusionOpacity(camera, hero, subject, radiusMeters = OCCLUSION_RADIUS_METERS) {
  const dx = hero.x - camera.x;
  const dz = hero.z - camera.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return 1;
  const t = ((subject.x - camera.x) * dx + (subject.z - camera.z) * dz) / lengthSquared;
  if (t <= 0 || t >= 1) return 1;
  const nearestX = camera.x + dx * t;
  const nearestZ = camera.z + dz * t;
  return Math.hypot(subject.x - nearestX, subject.z - nearestZ) <= radiusMeters
    ? OCCLUDED_OPACITY
    : 1;
}

/** The signed shortest way round from one heading to another, in (-PI, PI]. Turning "toward" an
 *  angle by naive subtraction takes the long way round whenever the two straddle +/-PI, which for a
 *  character standing at the south of a plaza is most of the interesting cases -- he would spin
 *  350 degrees the wrong way to greet someone who walked up on his left. */
export function shortestTurn(fromRadians, toRadians) {
  let delta = (toRadians - fromRadians) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** Rotate `fromRadians` toward `toRadians` by at most `maxStepRadians`, the shortest way. Returns
 *  `toRadians` exactly once it is within one step, so a watching NPC settles instead of hunting. */
export function turnToward(fromRadians, toRadians, maxStepRadians) {
  const delta = shortestTurn(fromRadians, toRadians);
  if (Math.abs(delta) <= maxStepRadians) return toRadians;
  return fromRadians + Math.sign(delta) * maxStepRadians;
}

// ── AP2-A: native-clip turning, root-motion policy ──────────────────────────────────────────────
//
// A turn clip's Hips track carries real root motion (measure_root_motion.mjs): net yaw of roughly
// +119 degrees (Idle_Turn_Left) or -104 degrees (Idle_Turn_Right), monotonic, plus a genuine but
// smaller translation (up to ~16 cm at runtime scale). The policy below plays the clip for its
// ROTATION only -- the whole visual point -- while the translation is stripped so it can never drag
// the Keeper sideways inside a stationary Object3D, and the game's own root (root.position,
// root.rotation.y) never moves or rotates WHILE the clip is playing. What the clip visibly rotates is
// banked into root.rotation.y in one step the instant the clip stops owning the turn (finishes, or is
// interrupted by a reversed request), with the bone handed back to idle in the same instant -- so
// there is exactly one write to root.rotation.y per turn, never a clip rotation layered on top of an
// already-turning root. That is what rules out the double-rotation/sliding risk of combining
// `worldRoot.rotate()` with a full root-motion clip: this never does both at once.

/** Yaw (radians) a quaternion [x, y, z, w] implies. Matches tools/foundry/measure_root_motion.mjs's
 *  yawOf exactly, so an offline measurement of a clip and a value read from its own baked keyframes
 *  agree with each other. */
export function quaternionYaw([x, y, z, w]) {
  return Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y));
}

/** The net yaw (radians) a clip's own `${nodeName}.quaternion` track carries from its first keyframe
 *  to its last. NOT unwrapped across multiple half-turns: every clip this is used for is measured
 *  (measure_root_motion.mjs) to be monotonic and well under 180 degrees, so a direct difference
 *  cannot fold over the +/-PI seam shortestTurn exists to handle for arbitrary live headings. Returns
 *  0 for a clip with no rotation track on that node, so a malformed candidate degrades to "no turn"
 *  rather than throwing. */
export function clipNetYaw(clip, nodeName) {
  const track = clip.tracks.find((t) => t.name === `${nodeName}.quaternion`);
  if (!track || track.values.length < 8) return 0;
  const first = Array.from(track.values.slice(0, 4));
  const last = Array.from(track.values.slice(track.values.length - 4));
  return quaternionYaw(last) - quaternionYaw(first);
}

/** A clip's tracks with `${nodeName}.position` removed, so playing it can never move that node's
 *  bone away from the rig's rest translation. Rotation and scale tracks on the same node are left
 *  alone. Pure -- takes and returns a plain track array, so it is testable without a mixer or a rig. */
export function stripPositionTrack(tracks, nodeName) {
  const targetName = `${nodeName}.position`;
  return tracks.filter((track) => track.name !== targetName);
}

/**
 * "Greet once per approach": whether proximity should fire a greeting wave this frame, and what the
 * latch's state becomes. Pure, and exported, for the same reason `turnClipDirection` is a function
 * rather than an inline branch -- the rule is then testable without a mixer, a rig or a browser, and
 * the defect it exists to prevent (a Keeper who waves in a continuous loop, starving his own talk
 * clip) is pinned by a test rather than by a comment asking the next reader to be careful.
 *
 * Fires when the nearest hero is inside `waveRadius` and this approach has not been greeted yet.
 * Re-arms only once the nearest hero is beyond the WIDER `rearmRadius` -- see
 * KEEPER_GREET_REARM_RADIUS_METERS for why the two radii differ.
 */
export function greetingLatch(
  nearestDistance,
  greeted,
  waveRadius = KEEPER_WAVE_RADIUS_METERS,
  rearmRadius = KEEPER_GREET_REARM_RADIUS_METERS,
) {
  const stillGreeted = nearestDistance > rearmRadius ? false : greeted;
  const fire = !stillGreeted && nearestDistance <= waveRadius;
  return { greeted: fire || stillGreeted, fire };
}

/**
 * Which native turn clip, if any, a requested heading change should play: 'left', 'right' or null.
 * See KEEPER_TURN_CLIP_MIN_RADIANS for why there is a floor at all.
 */
export function turnClipDirection(deltaRadians, minRadians = KEEPER_TURN_CLIP_MIN_RADIANS) {
  if (!(Math.abs(deltaRadians) >= minRadians)) return null;
  return deltaRadians > 0 ? 'left' : 'right';
}

/**
 * The turning state machine, factored out of createKeeperPresenter so a diagnostic or a test can
 * drive it directly against a real mixer and real turn actions -- no scene, no material fades, no
 * quest marker. `turnActions` is `{ left, right }` (either may be null -- a rig missing a clip simply
 * never enters that branch). `idleAction` may be omitted; when present it gets a short crossfade on
 * both ends of a clip turn, purely cosmetic and irrelevant to the position/heading facts below.
 *
 * Owns exactly two states -- see turnClipDirection's header for why a clip and the plain procedural
 * turnToward are never both live at once:
 *   PROCEDURAL: turnToward moves root.rotation.y directly, exactly as it always has.
 *   CLIP: a turn action owns the visible rotation (mixer.update, called by the caller before this,
 *     already advanced it); root.rotation.y is returned UNCHANGED until the clip finishes or a
 *     reversed request interrupts it, at which point the rotation it visibly showed is banked into
 *     root.rotation.y in the same step that hands the bone back to idle.
 *
 * Returns a `step(currentRotationY, wantedHeading, deltaSeconds)` function -- call once per frame,
 * after mixer.update(), with whatever root.rotation.y currently is; use its return value as the new
 * root.rotation.y.
 */
export function createKeeperTurnController(mixer, turnActions, turnNetYaw, idleAction = null) {
  let turningDirection = null;
  let turnFrozenHeading = 0;
  let turnFinished = false;
  if (turnActions.left || turnActions.right) {
    mixer.addEventListener('finished', (event) => {
      if (event.action === turnActions.left || event.action === turnActions.right) turnFinished = true;
    });
  }

  return function step(currentRotationY, wantedHeading, deltaSeconds) {
    if (turningDirection) {
      const action = turnActions[turningDirection];
      const clipDuration = action.getClip().duration;
      const progress = clipDuration > 0 ? Math.min(1, action.time / clipDuration) : 1;
      const bankedHeading = turnFrozenHeading + turnNetYaw[turningDirection] * progress;
      const residual = shortestTurn(turnFrozenHeading, wantedHeading);
      const reversed = Math.abs(residual) > 1e-6
        && Math.sign(residual) !== (turningDirection === 'left' ? 1 : -1);
      if (!turnFinished && !reversed) return currentRotationY;

      // Banked in one write, in the same instant the bone hands rotation back to idle -- a rapid
      // reversal (a new heading arriving mid-turn) bails out here too, which is what makes repeated
      // left/right/left turns and an interrupted turn both land without a snap.
      if (idleAction) action.crossFadeTo(idleAction.reset().play(), TURN_CROSSFADE_SECONDS, false);
      else action.stop();
      turningDirection = null;
      turnFinished = false;
      return bankedHeading;
    }

    const delta = shortestTurn(currentRotationY, wantedHeading);
    const candidate = turnClipDirection(delta);
    const clipDirection = candidate && turnActions[candidate] ? candidate : null;
    if (!clipDirection) {
      return turnToward(currentRotationY, wantedHeading, KEEPER_TURN_RATE_RADIANS_PER_SECOND * deltaSeconds);
    }
    turningDirection = clipDirection;
    turnFrozenHeading = currentRotationY;
    const action = turnActions[clipDirection];
    action.reset().play();
    if (idleAction) idleAction.crossFadeTo(action, TURN_CROSSFADE_SECONDS, false);
    // Unchanged this frame -- the clip's own rotation has not been evaluated by the mixer yet; it
    // takes over starting with the caller's NEXT mixer.update() call.
    return currentRotationY;
  };
}

/** The Y offset that moves a model whose measured WORLD-space bounding-box minimum is
 *  `measuredMinY` so its base rests at `groundY` (default 0, the shared ground plane every
 *  landmark/prop in this zone is placed on). A model already resting on the ground
 *  (measuredMinY === groundY) returns 0 -- this is what makes the grounding rule a no-op on a
 *  model that was never buried, not only a fix for one that was. */
export function groundOffsetY(measuredMinY, groundY = 0) {
  return groundY - measuredMinY;
}

// ── Y1: generic landmark grounding ───────────────────────────────────────────────────────────
//
// v1's lantern_tree.glb shipped with its pivot at its vertical centre (measured bounds
// y ∈ [-0.5, +0.5]) rather than at its base. Placing a landmark's root at world Y=0 therefore
// buried the lower half of the model -- for the tree specifically, the trunk -- below the ground
// plane; only the top half was ever visible, which is why the shipped tree read as a boulder pile
// with no trunk instead of the 3.7x-hero landmark village.js's own sizing comment described. v2
// (Y1) ships with the SAME centred pivot (measured the same way before this fix landed), so this
// had to be a loader-level rule, not a v2-specific offset: measure the source bounds, scale to the
// requested world height, update world matrices, measure the SCALED bounds, then translate
// vertically so the visible model's bounding-box minY rests at ground level. A model whose pivot
// is already at its base gets a ~0 correction via groundOffsetY and is visually unaffected.

/** Moves `root` vertically so its measured WORLD-space bounding-box minY rests at `groundY`. Call
 *  after scale/position/rotation are set on `root` (and after it is parented, so world matrices
 *  compose correctly). Generic across any landmark -- not tree-specific -- so a future landmark
 *  with a base-pivoted source model is corrected by the same ~0 no-op this applies to one already
 *  standing on the ground. */
function groundLandmark(root, groundY = 0) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  root.position.y += groundOffsetY(box.min.y, groundY);
  root.updateMatrixWorld(true);
}

// ── W2: the relight ──────────────────────────────────────────────────────────────────────────

/** Matches a landmark by its model path rather than by array position -- LANDMARKS could grow a
 *  second entry some day, and "the tree" should stay whichever placement actually ships the
 *  lantern_tree model, not "whatever is first". */
const TREE_MODEL_MARKER = 'lantern_tree';
export function isTreeLandmark(landmark) {
  return typeof landmark?.model === 'string' && landmark.model.includes(TREE_MODEL_MARKER);
}

/** The current guest's unlock flag, read off the SAME `{ marks, lanternUnlocked }` shape main.js's
 *  own `rewards()` already returns online (net/protocol.js decodeRewards, delivered on the welcome
 *  message and every snapshot after) and offline (the local D1 fold) -- a rewards object with no
 *  guest yet, or a guest with no unlock, both read as "not lit" rather than throwing. This is the
 *  one function that decides state -> lit; main.js calls it, never re-derives the flag itself. */
export function lanternUnlockedFromRewards(rewards) {
  return rewards?.lanternUnlocked === true;
}

/** Pure state machine behind `setTreeLit`: whether calling it with `nextLit` should actually touch
 *  the light/materials, and what the resulting lit flag is. `changed: false` on a repeat of the
 *  same value is what makes "reversible and idempotent -- calling twice is harmless" (brief W2) a
 *  property of the state transition itself, provable with no three.js in this test at all -- the
 *  light/material mutation underneath is taste, judged in captures, but WHETHER it runs is not. */
export function treeLitTransition(currentlyLit, nextLit) {
  const resolved = nextLit === true;
  return { changed: resolved !== (currentlyLit === true), lit: resolved };
}

// Fraction up the tree's own measured, VISIBLE bounding box the canopy centre sits at -- see
// createTreePresenter's own comment on `visibleMinY` for why "visible" and "raw" are not the same
// box for this model. The shipped model is one merged mesh (no separate "canopy" node to target),
// so this is a measured SPLIT of the whole silhouette rather than a per-node lookup -- the same
// "derive from the real bounding box, don't hardcode a magic scale" discipline scaleForHeight
// already uses above, just applied on the vertical axis instead of to a height ratio.
const TREE_CANOPY_HEIGHT_FRACTION = 0.75;

// Tuned by eye in drive-village.mjs-style captures against the references named in the brief
// (search queries and what they taught: see the private engineering archive) -- Sol's
// ruling is that these values are taste, not a physical calculation, exactly like the brief says.
// Warm amber, not white: every reference is unanimous that a "the light came back" beat reads as
// warm firelight, not a cool or neutral glow. The intensity numbers themselves went through two
// real, measured corrections before landing here (both recorded in progress.md, not just this
// comment): (1) an emissive-only pass at intensity 0.6 flooded the WHOLE canopy to a flat pale
// wash, because this scene's own key/fill lights (ground.js: hemisphere 1.8, directional 2.2)
// already leave the canopy fairly bright, and emissive is added AFTER lighting, unshaded and
// uniform -- a large addition on top of an already-lit surface overexposes rather than warms it,
// the same mechanism normaliseCharacterMaterial's header describes for the white-silhouette defect,
// self-inflicted here instead of shipped in an asset; (2) the point light itself read as nearly
// invisible at first because its position was computed off the tree's RAW (ground-buried) bounding
// box -- see createTreePresenter. With both fixed, TREE_LIGHT_INTENSITY carries most of the visible
// "the light is back" read (a real, falling-off point light that relights the canopy's own sculpted
// shading) and TREE_EMISSIVE_INTENSITY is a modest top-up so the far side of the canopy is warm
// too, not lit on one side and still cold-grey on the other.
const TREE_LIGHT_COLOR = 0xffab5e;
const TREE_LIGHT_INTENSITY = 22;
// A second, smaller warm light that CLIMBS the trunk during the relight and then stays as a pool
// at the tree's foot. Created at load with intensity 0 rather than added when the ceremony starts:
// three.js recompiles every material's shader when the scene's light count changes, and taking that
// hitch in the middle of the one three-second moment the whole quest builds to is the worst
// possible place for it.
const TRUNK_LIGHT_INTENSITY = 9;
const TRUNK_LIGHT_DISTANCE = 6;
// Where it comes to rest: low, warm, under the canopy, so the ground around the trunk reads lit
// instead of the canopy floating over cold grass.
const TRUNK_LIGHT_REST_HEIGHT_METERS = 0.8;

// The drifting light motes. Not decoration for its own sake -- the tree's hanging lanterns are
// painted into a single merged texture with no node or material of their own (measured: one mesh,
// one material, one base-colour atlas), so there is nothing addressable to switch on. Motes give
// the canopy moving warm light that cannot mis-align with anything, which a sprite pinned at a
// guessed lantern position absolutely could.
// Fewer and bigger than the first pass (26 at 0.34 m), which photographed as white specks drifting
// in a warm tree -- snow, not firelight. Two things were wrong and both are fixed here: the sprite
// was small enough that only render/glow.js's hot white core was on screen (hence the 'mote'
// profile, which has no core), and there were enough of them to read as weather rather than as a
// handful of lights.
const MOTE_COUNT = 15;
const MOTE_COLOR = 0xffb050;
const MOTE_SIZE_METERS = 0.62;
const MOTE_RISE_METERS_PER_SECOND = 0.22;
// How much of the canopy's own measured half-width the motes are scattered across.
const MOTE_SPREAD_FRACTION = 0.8;
// Distance-limited (brief W2: "so the village doesn't wash out") -- big enough that the canopy
// itself and the ground right under it read lit, small enough that the street lanterns and houses
// further into the village plaza keep their own separate, unlit read.
const TREE_LIGHT_DISTANCE = 9;
const TREE_LIGHT_DECAY = 2;
const TREE_EMISSIVE_COLOR = new THREE.Color(0xff9c46);
// Was 0.3, lowered after looking at the two captures side by side. The tree ships as ONE merged
// material, so this warms bark, foliage and lantern housings by the same amount at once -- at 0.3
// the lit tree read as an autumn tree rather than a lit one (green canopy -> uniformly orange
// canopy, which is a season change, not a light). At 0.18 the canopy keeps its own colour and the
// point lights do the work of saying where the light is coming FROM.
const TREE_EMISSIVE_INTENSITY = 0.18;

// THE TREE HAS TO LOOK LIKE IT WENT DARK. Put the two captures side by side and the shipped "dark"
// tree is a perfectly healthy green tree with unlit lamps in it -- so the Keeper says "our Lantern
// Tree has gone dark" while the child looks at a tree that is manifestly fine, and the premise of
// the entire quest does not land. Nothing about the model says anything is wrong with it.
//
// The dark phase now drains the colour out of the whole tree toward a cool slate. That is the
// oldest shorthand there is for "the life has gone out of this" and it needs no new asset, no
// second material and no shader: `material.color` multiplies the base texture, so a lerp toward a
// desaturated blue-grey darkens and cools every part of it at once. It also doubles the relight's
// value -- the ceremony now restores COLOUR as well as adding light, so the tree does not merely
// brighten, it comes back to life.
//
// 0.55 rather than something heavier: at full drain the canopy reads as dead rather than dimmed,
// and the brief's north star is magical, not grim.
const TREE_DARK_COLOR = new THREE.Color(0x6d7a86);
const TREE_DARK_MIX = 0.55;

/** Builds the relight controller for one already-placed, already-scaled tree landmark `root`, with
 *  its measured WORLD-space bounding box `worldBox` (post scale/rotation/position -- see
 *  loadLandmark's `root.updateMatrixWorld(true)` call). Adds one warm PointLight at the canopy's
 *  measured centre, off by default (intensity 0, matching the shipped dark-phase tree), and
 *  captures each mesh material's ORIGINAL emissive so ON -> OFF -> ON never drifts from the
 *  shipped dark-phase look -- the same "capture the original, restore it exactly" discipline
 *  gear.js's own belt-lantern mount relies on for its own no-op guard. */
function createTreePresenter(scene, root, worldBox) {
  // `root` has already been through `groundLandmark` by the time this runs (see loadLandmark), so
  // worldBox.min.y is ~0, not buried -- the tree used to ship with its pivot at its vertical
  // centre, which put worldBox.min.y at -2.75 for a model authored 5.5m tall and put this
  // function's canopy-centre calculation inside solid, ground-buried geometry (a first tuning pass
  // at fraction 0.7-0.92 of the full box barely moved the light relative to what a player could
  // actually see, because the whole box was wrong, not the fraction). The Math.max(worldBox.min.y,
  // 0) clamp below is kept as a defensive guard rather than load-bearing, in case a future
  // landmark's grounding is ever bypassed -- it is a ~0 no-op against an already-grounded box.
  const visibleMinY = Math.max(worldBox.min.y, 0);
  const canopyCenter = new THREE.Vector3(
    (worldBox.min.x + worldBox.max.x) / 2,
    visibleMinY + (worldBox.max.y - visibleMinY) * TREE_CANOPY_HEIGHT_FRACTION,
    (worldBox.min.z + worldBox.max.z) / 2,
  );
  const light = new THREE.PointLight(TREE_LIGHT_COLOR, 0, TREE_LIGHT_DISTANCE, TREE_LIGHT_DECAY);
  light.name = 'lantern-tree-light';
  setLayer(light, WORLD);
  light.position.copy(canopyCenter);
  scene.add(light);

  const trunkLight = new THREE.PointLight(TREE_LIGHT_COLOR, 0, TRUNK_LIGHT_DISTANCE, TREE_LIGHT_DECAY);
  trunkLight.name = 'lantern-tree-trunk-light';
  setLayer(trunkLight, WORLD);
  trunkLight.position.set(canopyCenter.x, visibleMinY + TRUNK_LIGHT_REST_HEIGHT_METERS, canopyCenter.z);
  scene.add(trunkLight);

  const motes = createCanopyMotes(canopyCenter, worldBox, visibleMinY);
  scene.add(motes.points);

  const materials = [];
  root.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of [].concat(object.material)) {
      if (!material || !material.emissive) continue;
      materials.push({
        material,
        originalEmissive: material.emissive.clone(),
        originalIntensity: material.emissiveIntensity ?? 1,
        // Captured so the drain is reversible EXACTLY, the same discipline the emissive already
        // follows -- a tint applied on top of a tint would darken further on every ON/OFF cycle.
        originalColor: material.color ? material.color.clone() : null,
      });
    }
  });

  // Street lanterns, nearest the tree first, handed over by loadZone once every prop has settled.
  // The tree does not go looking for them: it is told, so a zone with none still relights fine.
  let lanternGlows = [];

  // `canopy01` is the ceremony's own multiplier on the steady intensity: 0 dark, 1 fully lit, and
  // briefly past 1 at the bloom's peak. Everything the two paths (instant and ceremony) share is
  // written here exactly once, so an already-unlocked guest arriving at a lit tree and a guest who
  // just earned it end at the same picture -- which is what makes drive-relight's two captures
  // comparable.
  function paint({ canopy01, trunkHeight01, trunkGlow01, motes01, lanternsLit }) {
    light.intensity = TREE_LIGHT_INTENSITY * canopy01;
    trunkLight.intensity = TRUNK_LIGHT_INTENSITY * trunkGlow01;
    const restY = visibleMinY + TRUNK_LIGHT_REST_HEIGHT_METERS;
    trunkLight.position.y = restY + (canopyCenter.y - restY) * trunkHeight01;
    motes.setStrength(motes01);
    const warmth = Math.min(1, canopy01);
    for (const entry of materials) {
      if (warmth <= 0) {
        entry.material.emissive.copy(entry.originalEmissive);
        entry.material.emissiveIntensity = entry.originalIntensity;
      } else {
        entry.material.emissive.copy(entry.originalEmissive)
          .add(TREE_SCRATCH_COLOR.copy(TREE_EMISSIVE_COLOR).multiplyScalar(warmth));
        entry.material.emissiveIntensity = TREE_EMISSIVE_INTENSITY;
      }
      // The colour comes back with the light: fully drained at warmth 0, the model's own colour at
      // warmth 1, and everything between during the ceremony's own bloom.
      if (entry.originalColor) {
        entry.material.color.copy(entry.originalColor)
          .lerp(TREE_DARK_COLOR, TREE_DARK_MIX * (1 - warmth));
      }
    }
    for (let i = 0; i < lanternGlows.length; i += 1) lanternGlows[i].setLit(i < lanternsLit);
  }

  const DARK = { canopy01: 0, trunkHeight01: 0, trunkGlow01: 0, motes01: 0, lanternsLit: 0 };
  const STEADY_LIT = () => ({
    canopy01: 1, trunkHeight01: 0, trunkGlow01: 1, motes01: 1, lanternsLit: lanternGlows.length,
  });

  let lit = false;
  let ceremonySeconds = -1;
  // Painted dark ONCE at construction, not left to the first setTreeLit(false): that call is a
  // no-op on an already-dark tree by treeLitTransition's own idempotence, so without this the
  // colour drain would never be applied to a fresh guest's tree at all -- it would only ever appear
  // after an ON->OFF cycle no player can cause.
  paint(DARK);

  /** The INSTANT path: no ceremony, used when a returning guest arrives at a tree that was already
   *  lit before they got here (and to force it dark). Deliberately not the same entry point as
   *  beginRelight -- a relight that plays every page load stops being a moment. */
  function setTreeLit(nextLit) {
    const transition = treeLitTransition(lit, nextLit);
    if (!transition.changed) return;
    lit = transition.lit;
    ceremonySeconds = -1;
    paint(lit ? STEADY_LIT() : DARK);
  }

  /** The EARNED path: the three-second beat. Idempotent -- calling it on an already-lit or already
   *  running tree does nothing, so main.js's frame loop can call it without tracking edges itself. */
  function beginRelight() {
    if (lit || ceremonySeconds >= 0) return;
    ceremonySeconds = 0;
    paint(relightBeatsFor(0));
  }

  function relightBeatsFor(seconds) {
    const beats = relightBeats(seconds, lanternGlows.length);
    return {
      canopy01: beats.canopy01,
      trunkHeight01: beats.trunkRise01,
      trunkGlow01: beats.trunkGlow01,
      motes01: beats.motes01,
      lanternsLit: beats.lanternsLit,
    };
  }

  function update(deltaSeconds) {
    motes.advance(deltaSeconds);
    if (ceremonySeconds < 0) return;
    ceremonySeconds += deltaSeconds;
    const beats = relightBeats(ceremonySeconds, lanternGlows.length);
    if (beats.done) {
      ceremonySeconds = -1;
      lit = true;
      paint(STEADY_LIT());
      return;
    }
    paint(relightBeatsFor(ceremonySeconds));
  }

  return {
    setTreeLit,
    beginRelight,
    update,
    isTreeLit: () => lit,
    isRelighting: () => ceremonySeconds >= 0,
    /** Called once by loadZone with the street lanterns in the order they should catch. */
    attachLanterns(glows) {
      lanternGlows = glows;
      if (lit) for (const glow of lanternGlows) glow.setLit(true);
    },
  };
}

// Reused rather than allocated per material per frame: paint() runs every frame of the ceremony.
const TREE_SCRATCH_COLOR = new THREE.Color();

/** The drifting motes, as one Points object (one draw call) sharing render/glow.js's texture. They
 *  rise slowly and wrap back to the bottom of the canopy, so the effect never ends and never needs
 *  respawning logic beyond a modulo. */
function createCanopyMotes(canopyCenter, worldBox, visibleMinY) {
  const spread = ((worldBox.max.x - worldBox.min.x) / 2) * MOTE_SPREAD_FRACTION;
  const bottom = visibleMinY + (canopyCenter.y - visibleMinY) * 0.55;
  const height = Math.max(0.5, worldBox.max.y - bottom);
  const positions = new Float32Array(MOTE_COUNT * 3);
  for (let i = 0; i < MOTE_COUNT; i += 1) {
    // A deterministic scatter (golden-angle spiral), not Math.random: two clients, or the same
    // client reloaded for a before/after capture, should show the same tree.
    const angle = i * 2.39996;
    const radius = spread * Math.sqrt((i + 0.5) / MOTE_COUNT);
    positions[i * 3] = canopyCenter.x + Math.cos(angle) * radius;
    positions[i * 3 + 1] = bottom + height * ((i + 0.5) / MOTE_COUNT);
    positions[i * 3 + 2] = canopyCenter.z + Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: glowTexture('mote'),
    color: MOTE_COLOR,
    size: MOTE_SIZE_METERS,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'lantern-tree-motes';
  points.visible = false;
  setLayer(points, WORLD);

  return {
    points,
    setStrength(strength01) {
      const strength = strength01 < 0 ? 0 : strength01 > 1 ? 1 : strength01;
      material.opacity = strength;
      points.visible = strength > 0;
    },
    advance(deltaSeconds) {
      if (!points.visible) return;
      const attribute = geometry.getAttribute('position');
      for (let i = 0; i < MOTE_COUNT; i += 1) {
        let y = attribute.getY(i) + MOTE_RISE_METERS_PER_SECOND * deltaSeconds;
        if (y > bottom + height) y = bottom;
        attribute.setY(i, y);
      }
      attribute.needsUpdate = true;
    },
  };
}

// ── loading ──────────────────────────────────────────────────────────────────────────────────

function measuredHeight(root) {
  const box = new THREE.Box3().setFromObject(root);
  return box.max.y - box.min.y;
}

/** loadGLB() already logs `[assets] failed to load <url>` and hands back a magenta-placeholder
 *  scene on a 404 (world/assets.js) -- exactly the "one labelled console line" the brief asks for.
 *  What THIS wraps adds is the zone's own bookkeeping: `counts` and "skip the placement entirely"
 *  rather than adding the magenta box to a zone that is meant to read as a real place. */
async function loadTracked(url, counts) {
  counts.requested += 1;
  const gltf = await loadGLB(url);
  if (gltf.userData?.loadError) {
    counts.failed += 1;
    return null;
  }
  counts.loaded += 1;
  return gltf;
}

/** Returns the tree's relight presenter for the ONE landmark that is the lantern tree (see
 *  isTreeLandmark), `undefined` for every other landmark -- `undefined`, not `null`, only because
 *  that is what falls out of not returning anything, and loadZone's own `.find()` below treats
 *  both the same way. */
async function loadLandmark(scene, landmark, counts) {
  const url = `${ASSET_PREFIX}${landmark.model}`;
  const gltf = await loadTracked(url, counts);
  if (!gltf) return undefined;
  const root = setLayer(gltf.scene, WORLD);
  root.name = `landmark-${landmark.model}`;
  root.scale.setScalar(scaleForHeight(measuredHeight(gltf.scene), landmark.height));
  root.position.set(landmark.at[0], 0, landmark.at[1]);
  root.rotation.y = landmark.rotY ?? 0;
  scene.add(root);
  groundLandmark(root);
  if (!isTreeLandmark(landmark)) return undefined;
  // World-space box AFTER scale/position/rotation/grounding are set: updateMatrixWorld works
  // standalone (no parent required) since root's own local matrix is already correct, so this
  // needs no dependency on render-loop timing or on `root` already being under `scene` in the
  // graph. groundLandmark already called updateMatrixWorld itself, but a second call here is
  // cheap and keeps this line correct even if grounding's own implementation changes.
  root.updateMatrixWorld(true);
  const worldBox = new THREE.Box3().setFromObject(root);
  return createTreePresenter(scene, root, worldBox);
}

// One load per unique model, one clone per placement (brief V2: "Per-model cache, clone per
// placement (InstancedMesh is an optimization for later -- measure first)"). The cache is keyed on
// the resolved url and shared across every placement of the same model, so five street lanterns
// cost one GLTFLoader request and five cheap clones, not five requests.
async function loadProp(scene, cache, prop, counts) {
  const url = `${ASSET_PREFIX}${prop.model}`;
  if (!cache.has(url)) cache.set(url, loadTracked(url, counts));
  const gltf = await cache.get(url);
  if (!gltf) return undefined;
  const root = setLayer(gltf.scene.clone(true), WORLD);
  root.name = `prop-${prop.model}`;
  root.scale.setScalar(prop.scale ?? 1);
  root.position.set(prop.at[0], 0, prop.at[1]);
  root.rotation.y = prop.rotY ?? 0;
  // TIPPED OVER. Optional, and there is exactly one of these in the game: the cart at the abandoned
  // camp (zones/village.js). An upright cart in a clearing is a cart; a cart on its side is the
  // whole "somebody left in a hurry" beat, told in one number and no new asset. Applied AFTER rotY
  // in three.js's default XYZ order, so the roll is about the world's own Z and the cart lies down
  // whichever way it is facing -- and the placement is lifted by half its own measured height so the
  // body sits ON the grass rather than half buried in it.
  if (prop.tiltZ) {
    root.rotation.z = prop.tiltZ;
    root.updateMatrixWorld(true);
    const laidOut = new THREE.Box3().setFromObject(root);
    root.position.y = -laidOut.min.y;
  }
  scene.add(root);
  return isStreetLantern(prop) ? attachLanternGlow(scene, root, prop) : undefined;
}

/** Matched on the model path, the same way isTreeLandmark matches the tree, so a zone can add a
 *  sixth lantern by placing one in PROPS and nothing here needs editing. */
const STREET_LANTERN_MODEL_MARKER = 'lantern';
export function isStreetLantern(prop) {
  return typeof prop?.model === 'string' && prop.model.includes(STREET_LANTERN_MODEL_MARKER);
}

// Where up the lantern's own measured height the flame sits. The Kenney lantern is a post with the
// lamp housing at the top; 0.86 lands inside the glass rather than on the finial above it.
const LANTERN_FLAME_HEIGHT_FRACTION = 0.86;
const LANTERN_GLOW_COLOR = 0xffc477;
const LANTERN_GLOW_SIZE_METERS = 0.9;
// Deliberately gentler than the tree's. Five street lamps as bright as the landmark would flatten
// the village into one even brightness and cost the Lantern Tree its job as the thing you look at.
const LANTERN_GLOW_STRENGTH = 0.72;

/** One additive glow sprite inside a street lantern's lamp head, dark until the relight reaches it.
 *  A sprite and not a light -- see render/glow.js for why five more PointLights is the wrong trade
 *  on an iPad. */
function attachLanternGlow(scene, root, prop) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const sprite = createGlowSprite(LANTERN_GLOW_COLOR, LANTERN_GLOW_SIZE_METERS);
  sprite.name = `lantern-glow-${prop.at[0]}-${prop.at[1]}`;
  setLayer(sprite, WORLD);
  sprite.position.set(
    (box.min.x + box.max.x) / 2,
    box.min.y + (box.max.y - box.min.y) * LANTERN_FLAME_HEIGHT_FRACTION,
    (box.min.z + box.max.z) / 2,
  );
  scene.add(sprite);
  return {
    at: prop.at,
    setLit(nextLit) { setGlowStrength(sprite, nextLit ? LANTERN_GLOW_STRENGTH : 0); },
  };
}

/** idle loops forever; wave is a LoopOnce flourish that crossfades back to idle when it finishes.
 *  Both clips are optional -- a keeper export missing one still stands (or still waves), the same
 *  "degrade to something visible, never throw" convention wolf.js's WOLF_CLIP_FOR_MODE follows. */
function createKeeperPresenter(root, animations, restingHeading, scene) {
  const mixer = new THREE.AnimationMixer(root);

  // WHICH ONE IS ALDRIC. The village has three other robed figures in it now, and from the road
  // they are four identical silhouettes -- the objective chip says "Talk to Keeper Aldric" and
  // nothing in the world said which one he was. The marker floats over the one who has the quest,
  // and goes out the moment he has given it.
  const marker = createQuestMarker();
  setLayer(marker, CHARACTER);
  const markerRestY = KEEPER_TARGET_HEIGHT_METERS + MARKER_LIFT_METERS;
  marker.position.set(root.position.x, markerRestY, root.position.z);
  if (scene) scene.add(marker);
  let markerSeconds = 0;

  // He stands beside the road out of the village, and the follow camera sits 16 m behind the hero,
  // so walking north from spawn -- the route to the wolf, taken over and over -- puts a 1.65 m robed
  // man squarely between the child and their own hero. Seen in four separate captures before this
  // was written; at that distance he is the biggest thing on screen and he is facing away.
  //
  // He goes see-through when he is in the way. Materials are marked transparent AT LOAD rather than
  // when the fade starts: flipping `transparent` mid-session is the kind of change that makes
  // three.js re-evaluate a material, and taking that hitch the first time a child walks past an NPC
  // is worse than paying for one transparent-pass draw all session. depthWrite stays on, so his own
  // robe and beard still sort against each other correctly at full opacity.
  const fadeMaterials = [];
  root.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of [].concat(object.material)) {
      if (!material) continue;
      material.transparent = true;
      material.depthWrite = true;
      fadeMaterials.push(material);
    }
  });
  let opacity = 1;
  const clipByName = new Map(animations.map((clip) => [clip.name, clip]));
  const idleAction = clipByName.has('idle') ? mixer.clipAction(clipByName.get('idle')) : null;
  const waveAction = clipByName.has('wave') ? mixer.clipAction(clipByName.get('wave')) : null;
  // AP2-A: the native `talk` clip (Talk_Passionately, renamed at merge time -- see state.md), gated
  // on clip presence exactly like idle/wave. Unlike wave, this is a HELD state rather than a one-shot
  // flourish: it plays for as long as `setTalking(true)` is asked for (main.js drives that from the
  // dialogue banner's own visibility, keeperSpeechState's `visible`), and crossfades back to idle the
  // instant it is asked to stop.
  const talkAction = clipByName.has('talk') ? mixer.clipAction(clipByName.get('talk')) : null;

  if (idleAction) {
    idleAction.setLoop(THREE.LoopRepeat, Infinity);
    idleAction.play();
  }
  if (waveAction) {
    waveAction.setLoop(THREE.LoopOnce, 1);
    waveAction.clampWhenFinished = false;
  }
  if (talkAction) talkAction.setLoop(THREE.LoopRepeat, Infinity);

  // Wave and talk trigger off the SAME proximity radius (KEEPER_WAVE_RADIUS_METERS feeds both
  // keeperSpeechState's radius and the wave check below), so a child crossing into range can make
  // both eligible on the same frame. Wave wins: it is the shorter, one-shot greeting, and it is what
  // `wantsTalking` exists for -- `setTalking` records the request even while a wave is playing, and
  // the wave's own 'finished' handler resumes talk from there rather than dropping the request.
  let waving = false;
  let talking = false;
  let wantsTalking = false;
  // Has this approach already been greeted? Set when proximity fires the wave, cleared only when the
  // nearest hero is back outside KEEPER_GREET_REARM_RADIUS_METERS. See the update() call site.
  let greeted = false;
  const currentBodyAction = () => (waving ? waveAction : talking ? talkAction : idleAction);

  function startWave() {
    if (!waveAction || waving) return false;
    const from = currentBodyAction();
    talking = false;
    waving = true;
    waveAction.reset().play();
    if (from) from.crossFadeTo(waveAction, WAVE_CROSSFADE_SECONDS, false);
    return true;
  }
  if (waveAction) {
    mixer.addEventListener('finished', (event) => {
      if (event.action !== waveAction) return;
      waving = false;
      const resumeTalking = wantsTalking && Boolean(talkAction);
      const back = resumeTalking ? talkAction : idleAction;
      talking = resumeTalking;
      if (back) waveAction.crossFadeTo(back.reset().play(), WAVE_CROSSFADE_SECONDS, false);
      else waveAction.stop();
    });
  }

  function setTalking(active) {
    wantsTalking = active;
    if (!talkAction || waving) return; // deferred -- picked up by the wave 'finished' handler above
    if (active && !talking) {
      talking = true;
      talkAction.reset().play();
      if (idleAction) idleAction.crossFadeTo(talkAction, WAVE_CROSSFADE_SECONDS, false);
    } else if (!active && talking) {
      talking = false;
      if (idleAction) talkAction.crossFadeTo(idleAction.reset().play(), WAVE_CROSSFADE_SECONDS, false);
      else talkAction.stop();
    }
  }

  // AP2-A native turning. Optional, same degrade-gracefully contract as idle/wave above: today's
  // shipped keeper.glb (v1) carries neither clip, so turnActions.left/right stay null and every
  // Keeper in the game keeps rotating exactly as before -- this only activates on a future body that
  // ships them. `KEEPER_TURN_CLIP_MIN_RADIANS`'s header above and measure_root_motion.mjs cover why
  // the policy looks the way it does; this is only the mixer wiring for it.
  const turnClips = { left: clipByName.get('turn_left') ?? null, right: clipByName.get('turn_right') ?? null };
  const turnNetYaw = {
    left: turnClips.left ? clipNetYaw(turnClips.left, 'Hips') : 0,
    right: turnClips.right ? clipNetYaw(turnClips.right, 'Hips') : 0,
  };
  const turnActions = {
    left: turnClips.left
      ? mixer.clipAction(new THREE.AnimationClip(
        turnClips.left.name, turnClips.left.duration, stripPositionTrack(turnClips.left.tracks, 'Hips'),
      ))
      : null,
    right: turnClips.right
      ? mixer.clipAction(new THREE.AnimationClip(
        turnClips.right.name, turnClips.right.duration, stripPositionTrack(turnClips.right.tracks, 'Hips'),
      ))
      : null,
  };
  for (const action of [turnActions.left, turnActions.right]) {
    if (!action) continue;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }
  const resolveTurn = createKeeperTurnController(mixer, turnActions, turnNetYaw, idleAction);

  return {
    /**
     * @param heroPositions [{x, z}, ...] -- local hero and/or remote published positions.
     * @param view `{ camera: {x, z}, hero: {x, z} }` for the occlusion fade, or omitted to skip it
     *   (a caller whose hero mesh has not loaded yet still gets the wave and the watching-turn).
     */
    update(deltaSeconds, heroPositions, view) {
      mixer.update(deltaSeconds);
      if (marker.visible) {
        markerSeconds += deltaSeconds;
        marker.position.y = markerRestY + markerBob(markerSeconds);
      }

      const wantedOpacity = view
        ? occlusionOpacity(view.camera, view.hero, root.position)
        : 1;
      if (opacity !== wantedOpacity) {
        const step = OCCLUSION_FADE_PER_SECOND * deltaSeconds;
        opacity = Math.abs(wantedOpacity - opacity) <= step
          ? wantedOpacity
          : opacity + Math.sign(wantedOpacity - opacity) * step;
        for (const material of fadeMaterials) material.opacity = opacity;
      }

      // He watches whoever is nearest, and turns back to his resting heading when everyone leaves.
      // Body rotation rather than a head bone: this rig's `Head` is driven every frame by the idle
      // clip's own rotation track, so anything written to it is overwritten before it renders (the
      // mixer-versus-procedural-offset trap AGENTS.md already records for the hero's idle arms).
      // Turning the root is outside the mixer's reach and costs nothing.
      let nearest = null;
      let nearestDistance = Infinity;
      for (const p of heroPositions) {
        const d = distance(root.position.x, root.position.z, p.x, p.z);
        if (d < nearestDistance) { nearestDistance = d; nearest = p; }
      }
      const watching = nearest !== null && nearestDistance <= KEEPER_NOTICE_RADIUS_METERS;
      const wanted = watching
        ? headingToward(root.position.x, root.position.z, nearest.x, nearest.z)
        : restingHeading;

      // mixer.update() above already advanced whichever turn action is active; resolveTurn only
      // decides what root.rotation.y should be this frame -- see createKeeperTurnController's header.
      root.rotation.y = resolveTurn(root.rotation.y, wanted, deltaSeconds);

      // The greeting latch. Without it this re-fired the wave on the very frame the 'finished'
      // handler cleared `waving`, so `waving` was never observably false from outside and he waved
      // in a continuous loop for as long as anyone stood near him -- measured before the fix at
      // 200/200 samples over 10 s against a 1.967 s clip. Worse than robotic-looking: `startWave()`
      // clears `talking`, and keeperSpeech.js reads this SAME radius, so the exact moment a child
      // was close enough to read the quest line was the moment `talk` was starved forever and
      // Talk_Passionately could never play at all.
      //
      // Re-arm is on LEAVING, never a timer (Sol's ruling) -- and at the wider rearm radius, so
      // jitter on the boundary cannot re-greet. `celebrate()` deliberately does NOT consult this
      // latch: the Lantern Tree lighting is its own authored event and must fire regardless of
      // whether the child happens to have been greeted already.
      const greeting = greetingLatch(nearestDistance, greeted);
      greeted = greeting.greeted;
      if (!waveAction || waving) return;
      if (!greeting.fire) return;
      startWave();
    },
    /** The Keeper's own reaction to the tree catching light, fired from main.js at the moment the
     *  ceremony starts. Same clip as the greeting wave -- an NPC who stands perfectly still while the
     *  thing he asked for finally happens is worse than one who reuses a gesture. */
    celebrate: () => startWave(),
    isWaving: () => waving,
    /** Whether the Keeper's dialogue banner is currently on screen. main.js owns the answer -- only
     *  it knows keeperSpeechState's `visible` -- and calls this every frame, same as setQuestMarker. */
    setTalking,
    isTalking: () => talking,
    /** Show or hide the "talk to me" marker. main.js owns the answer, because only main.js knows
     *  whether this player has heard his line yet. */
    setQuestMarker(show) { marker.visible = show === true; },
    hasQuestMarker: () => marker.visible,
    /** For a harness: how see-through he is right now, so "he got out of the way" is observable
     *  without reading pixels out of a screenshot. */
    opacity: () => opacity,
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
    mixer,
  };
}

async function loadKeeper(scene, zoneData, counts) {
  const url = `${ASSET_PREFIX}${zoneData.KEEPER.model}`;
  const gltf = await loadTracked(url, counts);
  if (!gltf) return null;
  // The villagers come off this same load, and they have to be cloned BEFORE the Keeper's own
  // materials are normalised and his root is scaled and moved -- SkeletonUtils.clone copies the
  // scene graph as it finds it, so cloning afterwards would hand every villager the Keeper's
  // position, his height and his transparent-when-in-the-way materials.
  const villagers = buildVillagers(scene, gltf, zoneData.VILLAGERS ?? []);
  // Rowan too, cloned off this SAME load before the Keeper's own root is scaled and moved -- the
  // same ordering reason villagers.js's own comment gives.
  const rowan = zoneData.ROWAN ? buildRowan(scene, gltf, zoneData.ROWAN) : null;
  // ...and Wren, off the SAME load and for the same ordering reason -- she is built here and hidden,
  // not built later when the Beacon lights. world/ranger.js's header has the whole argument: a clone
  // taken after the Keeper's root is scaled and moved would inherit all three of those things.
  const ranger = zoneData.RANGER ? buildRanger(scene, gltf, zoneData.RANGER) : null;
  const root = setLayer(gltf.scene, CHARACTER);
  root.name = 'keeper';
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
    // The keeper ships the same white-silhouette export defect the hero and wolf originally
    // shipped with (see test/glb-materials.test.mjs); this is the load path that neutralises it.
    for (const material of [].concat(object.material)) normaliseCharacterMaterial(material);
  });
  root.scale.setScalar(scaleForHeight(measuredHeight(gltf.scene), KEEPER_TARGET_HEIGHT_METERS));
  const [keeperX, keeperZ] = zoneData.SPAWNS.keeper;
  const [heroX, heroZ] = zoneData.SPAWNS.heroes;
  root.position.set(keeperX, 0, keeperZ);
  // Facing the hero spawn is where he STANDS when nobody is near; the presenter turns him away from
  // it to watch whoever walks up, and brings him back here when they leave.
  const restingHeading = headingToward(keeperX, keeperZ, heroX, heroZ);
  root.rotation.y = restingHeading;
  scene.add(root);
  return { ...createKeeperPresenter(root, gltf.animations ?? [], restingHeading, scene), villagers, rowan, ranger };
}

/**
 * Kick off the whole zone's loads. Returns immediately with a live `counts` object (mutated as
 * each load settles) and a `ready` promise -- callers that only need "is it done yet" poll
 * `counts` (the brief's `window.__galaQuestRuntime.zoneDebug()`); callers that need the keeper
 * presenter await `ready`.
 */
export function loadZone(scene, zoneData) {
  const counts = { requested: 0, loaded: 0, failed: 0 };
  const propCache = new Map();
  const ready = (async () => {
    const landmarkCount = zoneData.LANDMARKS.length;
    const [keeper, ...rest] = await Promise.all([
      loadKeeper(scene, zoneData, counts),
      ...zoneData.LANDMARKS.map((landmark) => loadLandmark(scene, landmark, counts)),
      ...zoneData.PROPS.map((prop) => loadProp(scene, propCache, prop, counts)),
    ]);
    // Landmark results and prop results are sliced apart by position rather than searched over
    // `rest` as a whole, so a prop that happens to shape-match `{ setTreeLit }` could never be
    // picked up as the tree (and now, vice versa).
    const tree = rest.slice(0, landmarkCount).find((result) => result !== undefined) ?? null;
    // The relight runs OUT from the tree along the road, so the lanterns catch nearest-first. Sorted
    // here, once, rather than by the presenter -- the tree owns the beat, the zone owns the layout.
    // Sliced apart by INDEX against zoneData.PROPS, so a lantern's glow and the placement that
    // produced it cannot be mismatched. `dormant` lamps are the Dark Trail's own (world/trail.js):
    // they are street lanterns in every other respect, which is exactly why they have to be pulled
    // out here -- otherwise lighting the Lantern Tree would light the whole of Chapter 2 from the
    // village plaza, and the one thing the trail lights have to mean is "your light did this".
    const propResults = rest.slice(landmarkCount);
    const lanterns = [];
    const trailLights = [];
    // G1: a THIRD bucket, split off the same `dormant` marker by the same `road: 'beacon'` field
    // zones/village.js uses to keep BEACON_ROAD_LIGHTS out of TRAIL_LIGHTS. Two lists rather than one
    // because each has to stay index-aligned with its OWN coordinate list -- world/trail.js addresses
    // a woken light by index, so a single interleaved array would light the wrong lamp the moment
    // anybody added a prop between the two blocks.
    const beaconRoadLights = [];
    for (let i = 0; i < propResults.length; i += 1) {
      if (!propResults[i]) continue;
      const placement = zoneData.PROPS[i];
      if (placement?.dormant !== true) lanterns.push(propResults[i]);
      else if (placement.road === 'beacon') beaconRoadLights.push(propResults[i]);
      else trailLights.push(propResults[i]);
    }
    for (const light of [...trailLights, ...beaconRoadLights]) light.setLit(false);
    // The Wildwood Gate's own hanging lamp joins that list as just another light. It is the furthest
    // thing in the zone from the tree, so the sort below makes it the LAST one to catch: the
    // ceremony ends by lighting the way out of the village. Built rather than loaded, so it costs
    // nothing in `counts` and cannot fail a fetch.
    const gate = zoneData.WILDWOOD_GATE?.arch
      ? buildWildwoodGate(scene, zoneData.WILDWOOD_GATE.arch)
      : null;
    if (gate) lanterns.push(gate);
    // The black brambles. Built, not loaded, for the same reason the gate is -- boxes we own beat a
    // model we do not -- so they cost nothing in `counts` and cannot fail a fetch.
    const brambles = (zoneData.BRAMBLES ?? []).map((spec) => buildBramble(scene, spec));
    // Rowan's own reward, standing in the clearing before it is ever handed over. Built, not loaded,
    // for the same reason the gate and the brambles are.
    const wildwoodBlade = zoneData.WILDWOOD_BLADE
      ? buildWildwoodBlade(scene, zoneData.WILDWOOD_BLADE)
      : null;
    // G1: the Old Beacon and its two waystones. Built, not loaded, for the fourth time and the same
    // reason -- so they cost nothing in `counts` and cannot fail a fetch. Deliberately NOT pushed
    // into `lanterns`: the gate's lamp joins the relight chain because lighting the way out of the
    // village is the ceremony's own last beat, and the whole point of this one is that it does NOT
    // light.
    const oldBeacon = zoneData.OLD_BEACON ? buildOldBeacon(scene, zoneData.OLD_BEACON) : null;
    const beaconWaystones = buildBeaconWaystones(scene, zoneData.BEACON_WAYSTONES);
    // G2..G5: the three cold seals, the Warden kneeling beside them, and the blackthorn wall with
    // its pocket behind it. The seals and the wall are built, not loaded, for the same reason
    // everything above is -- no fetch to fail and nothing in `counts`.
    //
    // The WARDEN is the exception as of BW1, and deliberately so: it was procedural precisely so the
    // encounter could ship without waiting on a generated asset, and that asset now exists, so it
    // loads like the hero and the wolf do (enemies/warden.js).
    const coldSeals = buildColdSeals(scene, zoneData.COLD_SEALS ?? []);
    // AWAITED since BW1: the Warden is a real fetched GLB now, not boxes. It is awaited rather than
    // fired-and-forgotten so `ready` genuinely means "the arc's bodies are in the scene" -- and
    // buildWarden degrades to loadGLB's own magenta placeholder rather than rejecting, so a failed
    // fetch still resolves this zone instead of taking the whole village down with it.
    const warden = zoneData.BEACON_WARDEN ? await buildWarden(scene, zoneData.BEACON_WARDEN.at) : null;
    if (warden && zoneData.BEACON_WARDEN.rotY != null) warden.setHeading(zoneData.BEACON_WARDEN.rotY);
    const blackthorn = zoneData.BLACKTHORN ? buildBlackthornBarrier(scene, zoneData.BLACKTHORN) : null;
    const hollow = zoneData.HOLLOW
      ? buildHollowPocket(scene, { at: zoneData.HOLLOW.at, rotY: zoneData.HOLLOW.rotY ?? 0 })
      : null;
    if (tree) {
      const [treeX, treeZ] = zoneData.LANDMARKS.find(isTreeLandmark)?.at ?? [0, 0];
      lanterns.sort((a, b) => distance(treeX, treeZ, a.at[0], a.at[1])
        - distance(treeX, treeZ, b.at[0], b.at[1]));
      tree.attachLanterns(lanterns);
    }
    // The villagers ride in on the keeper's load (same rig, cloned before he is dressed) but they
    // are nothing to do with him, so callers get them at the top level rather than reaching through
    // him. A zone with no villagers -- or a keeper model that failed to load -- still ticks.
    const villagers = keeper?.villagers ?? { update() {}, count: 0, headingOffsets: () => [] };
    // Same shape again: Rowan rides in on the keeper's own load, so a keeper model that failed to
    // load leaves them null rather than throwing, the same degrade-to-nothing rule villagers follow.
    const rowan = keeper?.rowan ?? null;
    const ranger = keeper?.ranger ?? null;
    return {
      keeper, tree, lanterns, gate, villagers, rowan, ranger, trailLights, brambles, wildwoodBlade,
      beaconRoadLights, oldBeacon, beaconWaystones, coldSeals, warden, blackthorn, hollow,
    };
  })();
  return { counts, ready };
}
