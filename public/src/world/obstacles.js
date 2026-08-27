// public/src/world/obstacles.js
//
// CIRCULAR COLLISION BLOCKERS, as pure rules -- the one deliberate exception to world/bramble.js's
// own "nothing in this game collides" rule, and the reason it is an exception rather than a change
// of mind is a real playtest: two children walked straight INTO the Old Beacon's own stone base, on
// camera, on two different devices. A landmark a child can stand half inside does not read as an
// open world the way walking through a house or a tree does -- the plinth is a knee-high, ankle-deep
// FLOOR by design (oldBeacon.js's own PLINTH_HEIGHT_METERS comment), and a hero sunk into it reads as
// broken scenery, not as freedom of movement. So: the built, load-bearing landmarks a child arrives
// AT (the Beacon's own stone, the plaza's own Lantern Tree trunk) get a simple circular blocker; the
// dozens of ordinary houses, market stalls and background trees keep the old rule exactly as it was.
//
// PURE, in world/bounds.js's own sense and for the identical reason: the client's own movement
// prediction and the server's authoritative step have to agree pixel for pixel on where a hero may
// stand, or the predicted hero and the authoritative one drift apart until net/client.js's own
// SNAP_DRIFT_UNITS teleports it back -- the exact rubber-band bounds.js's header measured for the
// world's outer edge, now the same risk at the Beacon's own front step. One law, two consumers,
// exactly the shape character/speed.js and world/bounds.js both already are.
//
// Deliberately NOT importing world/zoneLoader.js's own isTreeLandmark: that module pulls in
// vendor/three.module.min.js to build meshes, and a pure rules module the server has to import
// (net/gameServerCore.mjs has no browser and no three.js) can never depend on one that does -- the
// same boundary bounds.js's own header draws against zones/village.js needing zero imports. The
// landmark's own model path is matched directly here instead, against the SAME marker string
// zoneLoader.js's own TREE_MODEL_MARKER uses, so a future landmark reshuffle that renames the model
// breaks both call sites' tests rather than only one silently going stale.

import { OLD_BEACON, LANDMARKS } from './zones/village.js';
import { PLINTH_RADIUS_METERS } from './oldBeacon.js';

// A hero's own footwork needs a little clearance BEYOND the stone itself, or "pushed out of the
// plinth" reads as "pinned against an invisible wall flush with the geometry" -- the same reason a
// hitbox is always a hair bigger than the thing it protects. Modest on purpose: this is a landmark a
// child should still be able to walk right up beside, not a fortress with a moat.
const HERO_CLEARANCE_METERS = 0.35;

export const BEACON_OBSTACLE_RADIUS_METERS = PLINTH_RADIUS_METERS + HERO_CLEARANCE_METERS;

// The Lantern Tree ships as a GLB (world/lantern_tree.glb, scaled to LANDMARKS' own `height: 5.5`)
// rather than built procedurally like the Beacon, so there is no authored PLINTH_RADIUS_METERS
// sibling to import for it -- this is a genuinely new number, not a restatement of one that already
// exists elsewhere (GQ-007 governs restating an EXISTING measurement, not authoring a first one).
// Estimated from the tree's own footprint: a landmark trunk read as "3-4x character height" (the
// LANDMARKS comment's own reference sweep) reads a trunk on the close order of half a metre through,
// and 0.55 m plus the same hero clearance keeps a child from visibly sinking into the bark without
// turning the plaza's own centrepiece into an obstacle course.
const LANTERN_TREE_TRUNK_RADIUS_METERS = 0.55;
export const LANTERN_TREE_OBSTACLE_RADIUS_METERS = LANTERN_TREE_TRUNK_RADIUS_METERS + HERO_CLEARANCE_METERS;

const TREE_MODEL_MARKER = 'lantern_tree';

/**
 * The Village's own circular blockers, as `{ at: [x, z], radiusMeters }` -- everywhere both the
 * client's prediction and the server's authority must push a hero's feet back out from. Derived from
 * the SAME zone data every other consumer of OLD_BEACON/LANDMARKS already imports (GQ-007) rather
 * than typed a second time, so a landmark that moves in zones/village.js moves its own blocker with
 * it for free.
 */
export function worldObstacles() {
  const obstacles = [{ at: OLD_BEACON.at, radiusMeters: BEACON_OBSTACLE_RADIUS_METERS }];
  const tree = LANDMARKS.find((landmark) => (
    typeof landmark?.model === 'string' && landmark.model.includes(TREE_MODEL_MARKER)
  ));
  if (tree) obstacles.push({ at: tree.at, radiusMeters: LANTERN_TREE_OBSTACLE_RADIUS_METERS });
  return obstacles;
}

/**
 * Push `{ x, z }` out of every obstacle it has stepped inside, one at a time, in list order.
 *
 * PURE and DETERMINISTIC: no three.js, no DOM, nothing but arithmetic, so a node process (the
 * server) and a browser (every client's own prediction) run the identical resolver and can never
 * disagree about where a hero's feet actually end up -- the same "byte for byte" contract
 * world/beaconSiege.js's own header holds itself to.
 *
 * Applied one obstacle after another rather than as a single combined correction: the Village's own
 * blockers do not overlap (the Beacon and the Lantern Tree are tens of metres apart), so a hero can
 * only ever be inside one of them at a time, and folding the loop this way means a THIRD obstacle
 * added later composes for free without this function's own logic changing.
 *
 * On the exact centre (distance === 0, a hero teleported or spawned dead on the landmark's own
 * origin) there is no direction to push along, so it pushes due +Z -- an arbitrary but STABLE choice,
 * the same tie-break world/bramble.js's own reference and combat/encounter.js's separateFromEnemy
 * both already make for their own distance-zero cases.
 */
export function resolveObstacleCollisions({ x, z }, obstacles) {
  let nextX = x;
  let nextZ = z;
  for (const obstacle of obstacles ?? []) {
    const [ox, oz] = obstacle.at;
    const radius = obstacle.radiusMeters;
    const dx = nextX - ox;
    const dz = nextZ - oz;
    const distance = Math.hypot(dx, dz);
    if (distance >= radius) continue; // outside (or exactly on the rim): untouched
    if (distance === 0) {
      nextX = ox;
      nextZ = oz + radius;
      continue;
    }
    // Slide the hero to the rim along the same line from the obstacle's centre through its current
    // position -- pushing straight OUT, never sideways, which is what makes running along the edge
    // of the blocker feel like sliding past a rounded body rather than snagging on a corner.
    nextX = ox + (dx / distance) * radius;
    nextZ = oz + (dz / distance) * radius;
  }
  return { x: nextX, z: nextZ };
}
