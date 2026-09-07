// The one planar movement slice CP2 authorizes inside Emberworks Deep.
//
// This is deliberately import-free zone data. It is not a collider export, navmesh, encounter map,
// or promise that the whole greybox is traversable. The route stops before the elevated Lava Express
// bridge so CP2 does not invent stacked-floor or jumping rules.

export const EMBERWORKS_DEEP_DESTINATION_ID = 'emberworks-deep';

// Identity mapping to the checked-in Unity scene: server x/z are Unity x/z, in metres.
export const EMBERWORKS_DEEP_HERO_SPAWN = Object.freeze({ x: 0, z: 4 });

// Cinder Gate -> immediate-action cavern -> the flat approach to Lava Express.
export const EMBERWORKS_DEEP_MOVEMENT_BOUNDS = Object.freeze({
  minX: -10,
  maxX: 10,
  minZ: 3,
  maxZ: 22,
});

// The greybox primitives carry Unity's default colliders because they were created as primitives,
// but they are presentation geometry, not CP2 traversal authority. No true gameplay blocker is
// required on this deliberately flat route; the authored envelope above is the whole server seam.
export const EMBERWORKS_DEEP_MOVEMENT_OBSTACLES = Object.freeze([]);
