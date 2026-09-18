// The opening planar route inside Emberworks Deep.
//
// This is deliberately import-free zone data. It is not a collider export, navmesh, encounter map,
// or promise that the whole greybox is traversable. The route stops before the elevated Lava Express
// bridge so CP2 does not invent stacked-floor or jumping rules.

export const EMBERWORKS_DEEP_DESTINATION_ID = 'emberworks-deep';

// Identity mapping to the checked-in Unity scene: server x/z are Unity x/z, in metres.
export const EMBERWORKS_DEEP_HERO_SPAWN = Object.freeze({ x: 0, z: 4 });

export const EMBERWORKS_DEEP_RECOVERY_SANCTUARY = Object.freeze({
  at: EMBERWORKS_DEEP_HERO_SPAWN, radiusMeters: 2,
});

export const EMBERWORKS_DEEP_ENEMIES = Object.freeze([
  Object.freeze({ enemyId: 'emberworks-gremlin-1', kind: 'lava-gremlin', level: 1,
    spawn: Object.freeze({ x: -4, z: 9 }), leashRadius: 7 }),
  // The existing Alpha presentation gives this authored heavy a readable silhouette without
  // introducing an asset/provider dependency. Its rules role is distinct in encounter.js: a long,
  // committed smash that can be sidestepped and punished during recovery.
  // The visible spawn stays at (4, 9) while the authored home/territory center sits southwest at
  // (2.5, 5.25) with leash 6: the spawn is strictly inside the territory (4.04 < 6, so no
  // spawn-time return), the leash covers the full aggro range (6 >= 6, so ordinary pursuit cannot
  // trip an unintended return/full-heal), and territory plus Heavy reach still stops 1.49m short
  // of the Rune Forge interaction pocket (12.84 - 6 - 2.1 > 3.25). The home stays outside the
  // recovery sanctuary and clear of the gate pillars and cavern wings.
  Object.freeze({ enemyId: 'emberworks-alpha-1', kind: 'alpha-wolf', level: 1, attackProfile: 'heavy',
    spawn: Object.freeze({ x: 4, z: 9 }), home: Object.freeze({ x: 2.5, z: 5.25 }),
    leashRadius: 6 }),
]);

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
