// public/src/render/guidePath.js
//
// The dotted glowing trail on the ground, from near the hero's feet toward whatever the objective
// chip is naming. THE PLAYTEST FINDING THIS FILE ANSWERS: "need much clearer arrows and dotted paths
// on where to go next and what to do; they should basically always be there." An arrow at the screen
// edge and a dial in the corner (ui/offscreenPointer.js, ui/minimap.js) both ask a child to read a
// symbol and translate it into a direction to walk. A trail of lit dots laid on the actual ground a
// child is actually walking on asks nothing to be read at all -- it is the same vocabulary as the
// street lanterns already lighting the village, and the game already taught it once.
//
// WORLD SPACE, NOT SCREEN SPACE, on purpose: the arrow and the marker (render/guideArrow.js) answer
// "which way do I turn"; this answers "what does the ground under my feet look like", and a HUD
// overlay cannot answer that -- a dot pasted on the screen does not turn to follow the road the way a
// dot standing IN the road does when the camera does. It is a trail, and it has to live where trails
// live.
//
// A STRAIGHT LINE, DELIBERATELY. World/bounds.js and world/ground.js both describe one flat plane;
// there is no pathfinding graph in this game and building one to draw a line straighter than a
// straight line already is would be solving a problem the terrain does not have. If the ground ever
// grows an obstacle a straight line cannot see around, that is the day this file needs a route to
// follow instead of a vector -- not before.
//
// SPRITES FROM A SHARED POOL, THE SAME SHAPE render/impactBurst.js ALREADY USES: fourteen small
// glow sprites created once at boot and repositioned every frame, rather than an allocation per dot
// per frame. This game has to hold a frame budget on a tablet through a boss fight; a guidance trail
// that is redrawn every frame is exactly the kind of steady garbage that shows up as a hitch on the
// frame a child is looking hardest at their own thumb.
//
// GLOW SPRITES, NOT MESHES: render/glow.js's createGlowSprite already IS "a small billboarded disc,
// additive, reads at dusk" -- it is the exact same trick the street lanterns and the impact bursts
// use to look lit without becoming a real light three.js has to shade every frame. Building a new
// disc geometry here would be a second implementation of a solved problem.

import { createGlowSprite, setGlowStrength } from './glow.js';
import { prefersReducedMotion } from './motionPreference.js';
import { clampToWorldX, clampToWorldZ } from '../world/bounds.js';
import { GUIDE_NEAR_METERS } from './guideArrow.js';

// ── THE PURE HALF: where the dots go, how bright, how alive ──────────────────────────────────────
// No three.js below this line until createGuidePath -- everything above it tests with plain node.

/** Small enough to read as a bead of light on the ground and not as a prop; the brief's own number. */
export const GUIDE_DOT_SIZE_METERS = 0.12;
/** How far apart the dots sit. Close enough to read as a continuous trail rather than scattered
 *  crumbs at a walking child's eye height and viewing angle; the brief's own number. */
export const GUIDE_DOT_SPACING_METERS = 1.5;
/** The pool size, and the hard cap on how many are ever placed in one frame. Sixteen dots at 1.5 m
 *  spacing covers 24 m of trail -- comfortably past the longest single leg in the village (the
 *  Keeper-to-Lantern-Tree walk, measured at 9.19 m in ui/minimap.js's own comment) -- and a fixed
 *  pool this size is cheap to hold allocated for the life of the page. */
export const GUIDE_MAX_DOTS = 16;
/** Re-exported at the point of use rather than re-imported by every caller: this is the SAME number
 *  render/guideArrow.js hides its own arrow/marker at, imported from there rather than typed twice
 *  (GQ-007) -- a child close enough that the arrow has already gone quiet has no use for a trail
 *  ending at their own feet either. */
export const GUIDE_HIDE_RADIUS_METERS = GUIDE_NEAR_METERS;
/** The first dot starts a little out from the hero's own position, not on top of it -- a dot drawn
 *  exactly under a child's feet is invisible under their own model and reads as the trail starting
 *  nowhere. */
export const GUIDE_START_OFFSET_METERS = 1;
/** Lifted clear of the ground plane so it never z-fights with it, and low enough that it still reads
 *  as ON the ground rather than floating at head height. */
export const GUIDE_GROUND_LIFT_METERS = 0.14;

/**
 * Where the dots sit, in world space, for one frame.
 *
 * @param heroX,heroZ     where the child is standing.
 * @param targetX,targetZ where the objective is.
 * @param spacingMeters   distance between consecutive dots.
 * @param maxDots         the hard cap on how many come back.
 * @param startOffsetMeters how far the first dot sits from the hero.
 * @param hideRadiusMeters below this distance the trail is not drawn at all -- see the module
 *   header's cross reference to render/guideArrow.js for why the two files share one number.
 * @param clampX,clampZ   applied to every dot so a trail can never point a child at a coordinate
 *   outside the walkable world -- world/bounds.js's own clamps, passed in rather than imported here
 *   by default so this stays testable with plain numbers and no assumption about which zone is
 *   loaded. The caller (createGuidePath below) supplies the real ones.
 *
 * @returns an array of `{ x, z, t }`, closest-to-hero first. `t` runs 0 (at the hero) to 1 (at the
 *   target) and is what guideDotOpacity/guideDotPulse below key their fade and shimmer off, so a
 *   caller never has to re-derive "how far along the trail is this one" from raw coordinates.
 */
export function guideDotPlacements({
  heroX,
  heroZ,
  targetX,
  targetZ,
  spacingMeters = GUIDE_DOT_SPACING_METERS,
  maxDots = GUIDE_MAX_DOTS,
  startOffsetMeters = GUIDE_START_OFFSET_METERS,
  hideRadiusMeters = GUIDE_HIDE_RADIUS_METERS,
  clampX = (x) => x,
  clampZ = (z) => z,
}) {
  if (![heroX, heroZ, targetX, targetZ].every(Number.isFinite)) return [];

  const dx = targetX - heroX;
  const dz = targetZ - heroZ;
  const distance = Math.hypot(dx, dz);
  // ARRIVED, or as good as. See GUIDE_HIDE_RADIUS_METERS above for why this is the same number the
  // arrow/marker use.
  if (!(distance > hideRadiusMeters)) return [];

  const usable = distance - startOffsetMeters;
  if (usable <= 0) return [];

  const dirX = dx / distance;
  const dirZ = dz / distance;
  const count = Math.min(maxDots, Math.floor(usable / spacingMeters) + 1);

  const dots = [];
  for (let i = 0; i < count; i += 1) {
    const alongMeters = startOffsetMeters + i * spacingMeters;
    dots.push({
      x: clampX(heroX + dirX * alongMeters),
      z: clampZ(heroZ + dirZ * alongMeters),
      t: alongMeters / distance,
    });
  }
  return dots;
}

/**
 * How bright a dot at trail-position `t` (0 at the hero, 1 at the target) is, before the pulse.
 *
 * FADES BOTH ENDS. The dot nearest the hero ramps in rather than snapping to full strength -- a
 * trail that begins at full brightness one metre from a child's own feet reads as a bright thing
 * sitting on top of them, not as a path leading away. The dot nearest the target eases out the same
 * way, so the trail visually resolves INTO the destination instead of stopping with a hard edge just
 * short of it.
 */
export function guideDotOpacity(t) {
  const fadeIn = t / 0.12;
  const fadeOut = (1 - t) / 0.12;
  const strength = Math.min(fadeIn, fadeOut, 1);
  return strength < 0 ? 0 : strength > 1 ? 1 : strength;
}

/** How fast the shimmer travels, in cycles per second. Slow enough to read as "gently alive" rather
 *  than as an alarm -- the same register questMarker.js's own bob picks for the same reason. */
export const GUIDE_PULSE_HZ = 0.7;

/**
 * A gentle per-dot shimmer, offset by index so the whole trail does not flash in lockstep -- that
 * would read as one blinking line rather than as a path with motion drifting along it, which is the
 * "alive" the brief asks for. Returns a multiplier in [0.7, 1], never fully dark, so a pulsing dot is
 * still a dot and not a flicker that reads as broken.
 */
export function guideDotPulse(seconds, index) {
  const phase = index * 0.4;
  return 0.85 + 0.15 * Math.sin(seconds * GUIDE_PULSE_HZ * Math.PI * 2 - phase);
}

/** How far the dots bob, and how fast -- small and slow, the same register as GUIDE_PULSE_HZ. */
export const GUIDE_BOB_METERS = 0.025;
export const GUIDE_BOB_HZ = 0.55;

/** A slight vertical drift per dot, offset by index for the same "not lockstep" reason the pulse is. */
export function guideDotBob(seconds, index) {
  const phase = index * 0.6;
  return Math.sin(seconds * GUIDE_BOB_HZ * Math.PI * 2 + phase) * GUIDE_BOB_METERS;
}

// ── THE PRESENTER: three.js sprites driven by the pure maths above ───────────────────────────────

/** Warm gold, matching the lantern motif this whole HUD already speaks: the exact colour
 *  ui/minimap.js's own objective dot and #objective-pointer-arrow already use (index.html), so the
 *  dial, the edge arrow and the ground trail all read as ONE guidance system rather than three
 *  differently-tinted ones that happen to appear near each other. */
export const GUIDE_PATH_COLOR = 0xf2b33d;

/**
 * @param scene the world scene; dots are added to it directly, in world space, so they sit in the
 *   ground the hero is actually walking rather than riding any other object.
 */
export function createGuidePath(scene) {
  const dots = Array.from({ length: GUIDE_MAX_DOTS }, () => {
    const sprite = createGlowSprite(GUIDE_PATH_COLOR, GUIDE_DOT_SIZE_METERS, 'mote');
    // Just off the ground and well under the hero and every prop; nothing here needs to win a
    // depth fight against the world, so no renderOrder override the way questMarker.js needs one --
    // this is meant to read as PART of the ground, not as a UI layer floating over it.
    scene.add(sprite);
    return sprite;
  });

  let elapsedSeconds = 0;

  return {
    /**
     * @param deltaSeconds how much time passed this frame, for the pulse/bob animation.
     * @param hasTarget    whether there is anywhere to draw a trail to at all -- false hides every
     *   dot outright, the same three-state switch render/guideArrow.js's `hasTarget` drives.
     * @param heroX,heroZ,targetX,targetZ world positions, ignored when `hasTarget` is false.
     */
    update(deltaSeconds, { hasTarget, heroX, heroZ, targetX, targetZ }) {
      elapsedSeconds += deltaSeconds;
      const placements = hasTarget
        ? guideDotPlacements({ heroX, heroZ, targetX, targetZ, clampX: clampToWorldX, clampZ: clampToWorldZ })
        : [];
      // Read once per frame rather than per dot: a live toggle mid-frame would draw some dots bobbing
      // and others not, which is a worse tell than either state on its own.
      const reduced = prefersReducedMotion();

      for (let i = 0; i < dots.length; i += 1) {
        const sprite = dots[i];
        const dot = placements[i];
        if (!dot) {
          setGlowStrength(sprite, 0);
          continue;
        }
        const bob = reduced ? 0 : guideDotBob(elapsedSeconds, i);
        sprite.position.set(dot.x, GUIDE_GROUND_LIFT_METERS + bob, dot.z);
        // A player who asked for less motion still gets the trail -- it is information, not
        // decoration, the same call render/impactBurst.js makes for its own bursts -- it just stops
        // shimmering and holds a steady brightness.
        const pulse = reduced ? 1 : guideDotPulse(elapsedSeconds, i);
        setGlowStrength(sprite, guideDotOpacity(dot.t) * pulse);
      }
    },

    /** For a harness: how many dots are actually lit right now, observable without a screenshot. */
    liveCount() {
      return dots.filter((sprite) => sprite.visible).length;
    },

    dispose() {
      for (const sprite of dots) {
        scene.remove(sprite);
        sprite.material.dispose();
      }
    },
  };
}
