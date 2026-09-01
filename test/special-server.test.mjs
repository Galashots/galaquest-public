import { strict as assert } from 'node:assert';
import test from 'node:test';

import { SPECIAL_ATTACK_CONTACT_SECONDS } from '../public/src/combat/specialAttack.js';
import { createSimulation } from '../net/gameServerCore.mjs';

function levelFiveStats() {
  return { level: 5, maxHp: 50, heroDamage: 18, damageReductionPercent: 0 };
}

test('the authoritative simulation accepts Wildwood Burst only for a Level-5 hero', () => {
  const simulation = createSimulation({
    enemies: [
      { enemyId: 'wolf-a', spawn: { x: 0, z: 1 } },
      { enemyId: 'wolf-b', spawn: { x: 0, z: 2 } },
      { enemyId: 'wolf-c', spawn: { x: 0, z: 3 } },
    ],
    heroStatsFor: () => levelFiveStats(),
  });
  const player = simulation.addPlayer('level-five');
  assert.equal(simulation.applySpecial(player.id, { seq: 1 }), true);
  assert.equal(simulation.applySpecial(player.id, { seq: 1 }), false, 'replay is ignored');

  simulation.step(SPECIAL_ATTACK_CONTACT_SECONDS, 0);
  const events = simulation.drainEvents();
  assert.equal(events.filter((event) => event.type === 'special-hit').length, 3);
  assert.equal(events.filter((event) => event.type === 'wolf-defeated').length, 3);
  assert.equal(simulation.applySpecial(player.id, { seq: 2 }), false, 'cooldown is authoritative');
  assert.ok(simulation.encounterSnapshot().heroes[player.id].specialCooldown > 0);
});

test('the authoritative simulation rejects a special from a Level-4 hero', () => {
  const simulation = createSimulation({ heroStatsFor: () => ({
    level: 4, maxHp: 45, heroDamage: 16, damageReductionPercent: 0,
  }) });
  const player = simulation.addPlayer('level-four');
  assert.equal(simulation.applySpecial(player.id, { seq: 1 }), false);
  assert.deepEqual(simulation.drainEvents(), []);
});
