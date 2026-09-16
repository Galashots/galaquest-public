import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, RUNE_FORGE_POSITION, RUNE_FORGE_REACH_METERS } from '../net/gameServerCore.mjs';
import { EMBERWORKS_DEEP_ENEMIES } from '../public/src/world/zones/emberworksDeep.js';
import { enemyAttackFor } from '../public/src/combat/encounter.js';

test('authored heavy leash plus contact reach stays outside the Forge interaction pocket', () => {
  const alpha = EMBERWORKS_DEEP_ENEMIES.find(enemy => enemy.kind === 'alpha-wolf');
  const distance = Math.hypot(alpha.spawn.x - RUNE_FORGE_POSITION.x, alpha.spawn.z - RUNE_FORGE_POSITION.z);
  assert.ok(distance - alpha.leashRadius - enemyAttackFor(alpha).reach > RUNE_FORGE_REACH_METERS,
    'A respawning heavy must not reach a child standing at the learning controls.');
});

for (const [name, dx, dz] of [['station',0,0],['west approach',-3,0],['south approach',0,-3],['east approach',2.3,0]]) {
  test(`real encounter leaves the ${name} safe for an uninterrupted learning interval`, () => {
    const sim = createSimulation({ destinationId: 'emberworks-deep' });
    const player = sim.addPlayer('forge-reader');
    player.x = RUNE_FORGE_POSITION.x + dx; player.z = RUNE_FORGE_POSITION.z + dz;
    let minimum = sim.encounterSnapshot().heroes[player.id].hp;
    const initial = minimum;
    for (let i=1;i<=900;i++) {
      sim.step(.05,i*50);
      minimum = Math.min(minimum, sim.encounterSnapshot().heroes[player.id].hp);
    }
    assert.equal(minimum,initial,'The real server must not repeatedly attack the stationary reader.');
  });
}
