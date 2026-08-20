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
// A gear-inspection crop (A1 Studio convergence): close enough that a sword's seating or a
// shield's cant fills the frame instead of being a few dozen pixels of an inspection shot. Still a
// deterministic Studio camera, not a gameplay framing and not a visual-acceptance shortcut.
export const CLOSEUP_DISTANCE = 1.35;

export const TAU = Math.PI * 2;

// Bearings are compass-style around the subject, matching frame()'s own convention in every
// existing review harness: sin/cos of the bearing against a fixed distance and a slight downward
// pitch (height + distance * 0.10).
//
// The original trio (front / three-quarter / back) keeps its exact angles -- every existing capture
// sheet and Sol ruling binds to them. The A1 Studio convergence adds the side and rear angles gear
// review genuinely needs (a sword's pitch only reads from the side; the shield strap only reads
// from the shield-arm side, which is 'opposite-side' on this rig). Adding a name here is not enough
// on its own: tools/sol-review/request.schema.json's bearing enum must list it too, or the worker
// would advertise a bearing it refuses to execute -- test/studio-review-views.test.mjs pins the two
// lists together.
export const BEARINGS = Object.freeze([
  Object.freeze(['front', 0]),
  Object.freeze(['three-quarter', TAU * 0.125]),
  Object.freeze(['side', TAU * 0.25]),
  Object.freeze(['rear-three-quarter', TAU * 0.375]),
  Object.freeze(['back', TAU * 0.5]),
  Object.freeze(['opposite-side', TAU * 0.75]),
]);

export function bearingRadians(name) {
  const found = BEARINGS.find(([n]) => n === name);
  if (!found) throw new Error(`unknown bearing "${name}" -- expected one of ${BEARINGS.map(([n]) => n).join(', ')}`);
  return found[1];
}

// One map, exported, so the sol-review worker's supportedViewScales and the request schema's own
// enum can be pinned against the real vocabulary instead of hand-typed copies of it (GQ-007).
export const SCALE_DISTANCES = Object.freeze({
  gameplay: GAMEPLAY_DISTANCE,
  inspection: INSPECTION_DISTANCE,
  closeup: CLOSEUP_DISTANCE,
});

export function distanceForScale(scale) {
  const distance = SCALE_DISTANCES[scale];
  if (distance === undefined) {
    throw new Error(`unknown scale "${scale}" -- expected one of ${Object.keys(SCALE_DISTANCES).join(', ')}`);
  }
  return distance;
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
