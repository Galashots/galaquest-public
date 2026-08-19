// public/src/world/bounds.js
//
// Where the walkable world ends, owned in ONE place because two simulations have to agree on it.
//
// This used to live only in net/gameServer.mjs, which meant the SERVER clamped a hero to the world
// and the client's own prediction did not. Measured consequence in the running game (probe at a
// 768x1024 iPad viewport, real touch, 2026-08-15): hold the stick against the south edge and the
// predicted hero keeps walking past z = -13 while authority stays pinned at it. The gap grows at
// walking speed until it passes net/client.js's SNAP_DRIFT_UNITS and the hero is TELEPORTED back --
// observed at 0.603 m drift with `snapped: true` on a 20 fps client, and 0.556 m (a hair under the
// snap line, so a visible rubber-band instead) at full speed. A child running to the edge of the
// map is not an exotic input; both testers will do it in the first minute.
//
// Kept out of zones/village.js because that module is PURE DATA with zero imports and zero
// functions by test-enforced rule (test/zone-data.test.mjs); kept out of gameServer.mjs because
// that module is server-only and the browser cannot import it. Same shape as character/speed.js,
// which the server already imports for exactly this reason: one law, two consumers.

import { ZONE } from './zones/village.js';

// A metre inside the ground plane's own edge, so a hero never stands half off the world. Derived
// from the zone's own size rather than restated as a magic 13 (docs/MISTAKES.md GQ-007) -- the
// number was written by hand in two places for long enough to become one of them being wrong.
export const WORLD_EDGE_MARGIN_METERS = 1;
export const WORLD_LIMIT = ZONE.size / 2 - WORLD_EDGE_MARGIN_METERS;
// The Wildwood. The world stopped being a square on 2026-08-15 -- see ZONE in zones/village.js for
// why -- so z has two different limits and x still has one. Derived from the same zone data the
// ground mesh is built from, for the same GQ-007 reason WORLD_LIMIT is.
export const WORLD_LIMIT_NORTH = ZONE.size / 2 + (ZONE.northMeters ?? 0) - WORLD_EDGE_MARGIN_METERS;

/**
 * Clamp along X. Unchanged: the world did not grow east or west.
 *
 * SPLIT FROM the old single clampToWorld() on 2026-08-15. One function clamping both axes was
 * correct exactly while the world was square, and silently wrong the moment it was not -- it would
 * have pinned a child at z = 13 with twenty-two metres of trail in front of them, and nothing in the
 * types or the tests would have said so. Two named functions cannot be called on the wrong axis by
 * accident, which is the whole reason this is two functions rather than one with a flag.
 */
export function clampToWorldX(value) {
  return Math.min(WORLD_LIMIT, Math.max(-WORLD_LIMIT, value));
}

/** Clamp along Z: the same southern limit, and the Wildwood's own to the north. */
export function clampToWorldZ(value) {
  return Math.min(WORLD_LIMIT_NORTH, Math.max(-WORLD_LIMIT, value));
}
