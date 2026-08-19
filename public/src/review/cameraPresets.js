/**
 * The canonical review camera presets -- gameplay/inspection distances and the three compass
 * bearings Sol's rulings have asked for since AP1 (front / three-quarter / back). Framework-free
 * (no three.js import) so it loads in the browser (Character Studio, public/src/studio/) and in
 * Node (tools/runtime-test/review-shipping-assets.mjs) without duplication -- CSB's own brief.md:
 * "reuse those numbers, do not redefine them."
 */

// follow.js's DEFAULT_DISTANCE -- the real gameplay framing a player actually sees.
export const GAMEPLAY_DISTANCE = 16;
// Close enough to judge one character's pose/material without being a macro shot.
export const INSPECTION_DISTANCE = 3.0;

export const TAU = Math.PI * 2;

// Bearings are compass-style around the subject, matching frame()'s own convention in every
// existing review harness: sin/cos of the bearing against a fixed distance and a slight downward
// pitch (height + distance * 0.10).
export const BEARINGS = Object.freeze([
  Object.freeze(['front', 0]),
  Object.freeze(['three-quarter', TAU * 0.125]),
  Object.freeze(['back', TAU * 0.5]),
]);

export function bearingRadians(name) {
  const found = BEARINGS.find(([n]) => n === name);
  if (!found) throw new Error(`unknown bearing "${name}" -- expected one of ${BEARINGS.map(([n]) => n).join(', ')}`);
  return found[1];
}

export function distanceForScale(scale) {
  if (scale === 'gameplay') return GAMEPLAY_DISTANCE;
  if (scale === 'inspection') return INSPECTION_DISTANCE;
  throw new Error(`unknown scale "${scale}" -- expected "gameplay" or "inspection"`);
}

/**
 * The camera position every review harness's frame()/orbit logic already computes, relative to a
 * subject at `origin` (default the world origin, matching Character Studio's `hero.root.position`
 * convention) -- extracted so SR5's readability measurements (does the shield face point toward the
 * review camera?) use the EXACT same camera math a capture does, not a second approximation of it.
 */
export function cameraPositionFor(scale, bearingName, height = 0.9, origin = [0, 0, 0]) {
  const distance = distanceForScale(scale);
  const bearing = bearingRadians(bearingName);
  return [
    origin[0] + Math.sin(bearing) * distance,
    origin[1] + height + distance * 0.10,
    origin[2] + Math.cos(bearing) * distance,
  ];
}

// The same iPad viewport every review harness photographs at (review-shipping-assets.mjs and its
// siblings), so Studio captures line up with the sheets already in the repo.
export const PORTRAIT_VIEWPORT = Object.freeze({ width: 768, height: 1024, deviceScaleFactor: 1, mobile: true });
export const LANDSCAPE_VIEWPORT = Object.freeze({ width: 1024, height: 768, deviceScaleFactor: 1, mobile: true });
