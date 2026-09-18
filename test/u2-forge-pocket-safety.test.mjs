import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, RUNE_FORGE_POSITION, RUNE_FORGE_REACH_METERS } from '../net/gameServerCore.mjs';
import { EMBERWORKS_DEEP_ENEMIES } from '../public/src/world/zones/emberworksDeep.js';
import { enemyAttackFor } from '../public/src/combat/encounter.js';
import { movementWorldForDestination, resolveMovementWorldPosition } from '../public/src/world/movementWorld.js';

const alphaAuthored = () => EMBERWORKS_DEEP_ENEMIES.find(enemy => enemy.kind === 'alpha-wolf');
// The territory center is the authored home when one exists, else the visible spawn -- the same
// center the encounter engine leashes pursuit against.
const territoryCenter = (enemy) => enemy.home ?? enemy.spawn;

test('authored heavy leash plus contact reach stays outside the Forge interaction pocket', () => {
  const alpha = alphaAuthored();
  const center = territoryCenter(alpha);
  const distance = Math.hypot(center.x - RUNE_FORGE_POSITION.x, center.z - RUNE_FORGE_POSITION.z);
  assert.ok(distance - alpha.leashRadius - enemyAttackFor(alpha).reach > RUNE_FORGE_REACH_METERS,
    'A respawning heavy must not reach a child standing at the learning controls.');
});

// The closest point on the Forge interaction circle toward the Alpha territory: the most exposed
// legal reader, not just a cardinal sample.
function closestForgeCirclePointTowardAlpha() {
  const center = territoryCenter(alphaAuthored());
  const dx = center.x - RUNE_FORGE_POSITION.x;
  const dz = center.z - RUNE_FORGE_POSITION.z;
  const distance = Math.hypot(dx, dz);
  return {
    x: RUNE_FORGE_POSITION.x + (dx / distance) * RUNE_FORGE_REACH_METERS,
    z: RUNE_FORGE_POSITION.z + (dz / distance) * RUNE_FORGE_REACH_METERS,
  };
}

function assertSafeForLearningInterval(at) {
  const sim = createSimulation({ destinationId: 'emberworks-deep' });
  const player = sim.addPlayer('forge-reader');
  player.x = at.x; player.z = at.z;
  let minimum = sim.encounterSnapshot().heroes[player.id].hp;
  const initial = minimum;
  for (let i=1;i<=900;i++) {
    sim.step(.05,i*50);
    minimum = Math.min(minimum, sim.encounterSnapshot().heroes[player.id].hp);
  }
  assert.equal(minimum,initial,'The real server must not repeatedly attack the stationary reader.');
}

for (const [name, dx, dz] of [['station',0,0],['west approach',-3,0],['south approach',0,-3],['east approach',2.3,0]]) {
  test(`real encounter leaves the ${name} safe for an uninterrupted learning interval`, () => {
    assertSafeForLearningInterval({ x: RUNE_FORGE_POSITION.x + dx, z: RUNE_FORGE_POSITION.z + dz });
  });
}

test('real encounter leaves the closest Forge-circle point toward the Alpha safe', () => {
  const at = closestForgeCirclePointTowardAlpha();
  const world = movementWorldForDestination('emberworks-deep');
  const resolved = resolveMovementWorldPosition(at, world);
  assert.ok(Math.hypot(resolved.x - at.x, resolved.z - at.z) < 1e-9,
    'The closest circle point must itself be legal standing, not inside a wall or bound.');
  assertSafeForLearningInterval(at);
});
