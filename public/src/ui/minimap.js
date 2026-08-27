// Where a world point sits on a hero-centred, camera-up minimap.
//
// CP2 PREPARATION. Pure maths, unit tested, and deliberately not wired into anything: the checkpoint
// is not open, and like ui/offscreenPointer.js this half does not depend on the design question
// still outstanding about how an objective names its destination. Whatever answers "where is the
// objective", this answers "and where does it sit on the dial".
//
// Checkpoint 0's finding was blunt: there is no minimap. The map button opens a non-spatial menu.
// Nothing in the game can show a child where anything is relative to where they are standing.
//
// TWO DECISIONS, BOTH OF THEM ABOUT BEING FIVE.
//
// Hero at the centre, camera forward pointing UP. Not north-up. A north-up map requires the reader
// to hold a rotation in their head and apply it to their own body, which is a skill children acquire
// years after they can play this game -- and it is why "no compass concept required" is in the
// brief. With camera-up, a thing drawn to the right of the dot is to the child's right. There is
// nothing to work out.
//
// Out-of-range markers are pinned to the RIM rather than dropped. A child who cannot see the thing
// they are looking for still needs to know which way it is; a marker that vanishes at the range
// boundary makes the map go blank exactly when it is most needed. The same reasoning as the
// off-screen pointer, on a circle instead of a rectangle.
//
// It is NOT enemy radar. That is a deliberate scope line from the brief and it is a design choice
// rather than an omission: a dial that shows where the wolf is turns an encounter a child is
// supposed to look up and see into a chart they read instead.

import { worldToScreen } from '../camera/rotation.js';

/** Provisional tuning, and labelled as such: the brief's own 22 m, tuned from the integrated
 *  opening rather than ratified here. It has to cover the Keeper-to-Lantern-Tree leg of the first
 *  objective, which the Checkpoint 0 survey measured at 9.19 m, with room to see the next thing
 *  before arriving at this one. */
export const DEFAULT_RANGE_METERS = 22;

/**
 * @param options.heroX,heroZ    where the child is standing.
 * @param options.worldX,worldZ  the thing being placed.
 * @param options.heading        the follow camera's heading. Camera forward becomes UP on the dial.
 * @param options.rangeMeters    how far the rim is, in world metres.
 * @param options.radiusPx       the dial's radius in CSS pixels; the hero sits at (r, r).
 * @param options.clampToRim     whether a marker beyond the range is pinned to the rim. True for a
 *   single marker, which must still say which way. False for a polyline vertex -- see
 *   minimapPolyline. Its own flag rather than something a caller can fake with a huge range,
 *   because the first draft of the polyline DID fake it, by passing Infinity, and
 *   `radiusPx / Infinity` is zero: every vertex of the road collapsed onto the hero's dot. The
 *   scale and the clamp are two different questions, and conflating them cost the whole shape.
 *
 * @returns { x, y, distanceMeters, withinRange, angle }
 *   x,y            pixels inside a 2r box, +y DOWN like every other overlay coordinate here.
 *   distanceMeters the real distance, unclamped -- a caller may want to label it, and clamping it
 *                  here would make "on the rim" and "exactly at the range" indistinguishable.
 *   withinRange    false once the marker has been pinned to the rim.
 *   angle          bearing on the dial, atan2(dy, dx) in the same +y-down space, so it can drive a
 *                  CSS rotate() for a marker that points outward. Null when the thing is under the
 *                  hero's own dot, where a bearing would be noise from floating-point dust.
 */
export function minimapPlacement({
  heroX,
  heroZ,
  worldX,
  worldZ,
  heading,
  rangeMeters = DEFAULT_RANGE_METERS,
  radiusPx,
  clampToRim = true,
}) {
  const offsetX = worldX - heroX;
  const offsetZ = worldZ - heroZ;
  const distanceMeters = Math.hypot(offsetX, offsetZ);

  // Rotate the world offset into camera space. +y is forward, +x is the camera's right -- see
  // camera/rotation.js, which owns the one trig definition this shares.
  const relative = worldToScreen({ x: offsetX, z: offsetZ }, heading);

  const metresToPixels = radiusPx / rangeMeters;
  // The hero's own dot. A marker within a pixel of it has no meaningful bearing: the direction would
  // be decided by rounding rather than by where the thing is.
  const CENTRE_EPSILON_PX = 1;

  let px = relative.x * metresToPixels;
  // Screen +y is forward; pixel +y is DOWN. The flip is the thing a naive port gets backwards, and
  // getting it wrong draws every marker on the opposite side of the child from where it is.
  let py = -relative.y * metresToPixels;

  const withinRange = distanceMeters <= rangeMeters;
  if (!withinRange && clampToRim) {
    // Pin to the rim along the same bearing, so an out-of-range marker still says which way.
    const length = Math.hypot(px, py);
    if (length > 0) {
      px = (px / length) * radiusPx;
      py = (py / length) * radiusPx;
    }
  }

  const angle = Math.hypot(px, py) <= CENTRE_EPSILON_PX ? null : Math.atan2(py, px);

  return {
    x: radiusPx + px,
    y: radiusPx + py,
    distanceMeters,
    withinRange,
    angle,
  };
}

/**
 * Place a run of world points -- the road, a trail of lights -- in one pass.
 *
 * Separate from the single-point form because a POLYLINE must not be rim-clamped: a road whose
 * far-off vertices are all pinned to the rim stops being a road and becomes a starburst. Out-of-range
 * points keep their true position and are marked, so a caller can clip the line properly instead of
 * bending it.
 */
export function minimapPolyline(points, options) {
  return points.map(([worldX, worldZ]) => {
    const placed = minimapPlacement({ ...options, worldX, worldZ, clampToRim: false });
    return { x: placed.x, y: placed.y, withinRange: placed.withinRange };
  });
}
