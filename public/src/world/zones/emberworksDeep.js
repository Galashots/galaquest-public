// The opening planar route inside Emberworks Deep.
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
  // The raised Express bridge and track ties begin beyond this flat approach.
  maxZ: 20,
});

// The greybox primitives carry Unity's default colliders because they were created as primitives,
// but movement is authoritative on the server. M1 binds the upright walls and gate pillars to
// their measured scene bounds. Floor/threshold meshes are walkable, not upright blockers.
export const EMBERWORKS_DEEP_HERO_CLEARANCE = 0.35;
export const EMBERWORKS_DEEP_MOVEMENT_OBSTACLES = Object.freeze([
  { name: 'GatePillarLeft', minX: -8.25, maxX: -5.75, minZ: 1.75, maxZ: 4.25 },
  { name: 'GatePillarRight', minX: 5.75, maxX: 8.25, minZ: 1.75, maxZ: 4.25 },
  { name: 'ImmediateActionCavernBack', minX: -15, maxX: 1, minZ: 18.9, maxZ: 20.1 },
  { name: 'ImmediateActionCavernWingL', minX: -14.7, maxX: -13.3, minZ: 12.5, maxZ: 19.5 },
  { name: 'ImmediateActionCavernWingR', minX: -0.7, maxX: 0.7, minZ: 12.5, maxZ: 19.5 },
].map(Object.freeze));
