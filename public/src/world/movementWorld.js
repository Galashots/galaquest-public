import {
  HERO_SPAWN as VILLAGE_HERO_SPAWN,
} from './zones/village.js';
import {
  WORLD_LIMIT,
  WORLD_LIMIT_EAST,
  WORLD_LIMIT_NORTH,
} from './bounds.js';
import { resolveObstacleCollisions, worldObstacles } from './obstacles.js';
import {
  EMBERWORKS_DEEP_DESTINATION_ID,
  EMBERWORKS_DEEP_HERO_SPAWN,
  EMBERWORKS_DEEP_MOVEMENT_BOUNDS,
  EMBERWORKS_DEEP_MOVEMENT_OBSTACLES,
} from './zones/emberworksDeep.js';

export const VILLAGE_DESTINATION_ID = 'village';

const VILLAGE_MOVEMENT_WORLD = Object.freeze({
  destinationId: VILLAGE_DESTINATION_ID,
  heroSpawn: VILLAGE_HERO_SPAWN,
  bounds: Object.freeze({
    minX: -WORLD_LIMIT,
    maxX: WORLD_LIMIT_EAST,
    minZ: -WORLD_LIMIT,
    maxZ: WORLD_LIMIT_NORTH,
  }),
  obstacles: Object.freeze(worldObstacles()),
  villageInteractions: true,
});

const EMBERWORKS_DEEP_MOVEMENT_WORLD = Object.freeze({
  destinationId: EMBERWORKS_DEEP_DESTINATION_ID,
  heroSpawn: EMBERWORKS_DEEP_HERO_SPAWN,
  bounds: EMBERWORKS_DEEP_MOVEMENT_BOUNDS,
  obstacles: EMBERWORKS_DEEP_MOVEMENT_OBSTACLES,
  villageInteractions: false,
});

const MOVEMENT_WORLDS = Object.freeze({
  [VILLAGE_DESTINATION_ID]: VILLAGE_MOVEMENT_WORLD,
  [EMBERWORKS_DEEP_DESTINATION_ID]: EMBERWORKS_DEEP_MOVEMENT_WORLD,
});

export { EMBERWORKS_DEEP_DESTINATION_ID };

export function movementWorldForDestination(destinationId = VILLAGE_DESTINATION_ID) {
  const world = MOVEMENT_WORLDS[destinationId];
  if (!world) throw new RangeError(`unknown destination ${JSON.stringify(destinationId)}`);
  return world;
}

export function clampMovementWorldPosition({ x, z }, world) {
  return {
    x: Math.min(world.bounds.maxX, Math.max(world.bounds.minX, x)),
    z: Math.min(world.bounds.maxZ, Math.max(world.bounds.minZ, z)),
  };
}

export function resolveMovementWorldPosition(position, world) {
  return clampMovementWorldPosition(resolveObstacleCollisions(position, world.obstacles), world);
}
