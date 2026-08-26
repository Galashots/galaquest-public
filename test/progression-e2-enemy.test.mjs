import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  createEncounterState,
  stepEncounter,
  createPartyEncounterState,
  stepParty,
} from '../public/src/combat/encounter.js';
import { WOLF_LEVEL_STATS, wolfStatsForLevel } from '../public/src/combat/enemyStats.js';
import { ENEMY_POPULATION, RECOVERY_SANCTUARY } from '../public/src/world/zones/village.js';
import { decode, encode, snapshotMessage } from '../public/src/net/protocol.js';
import { createSimulation } from '../net/gameServerCore.mjs';

test('E2 C1 authors exactly five Wolves with the locked level mix and separated homes', () => {
  assert.equal(ENEMY_POPULATION.length, 5);
  assert.deepEqual(ENEMY_POPULATION.map((enemy) => enemy.level).sort((a, b) => a - b), [1, 1, 2, 2, 4]);
  assert.equal(new Set(ENEMY_POPULATION.map((enemy) => enemy.enemyId)).size, 5);
  for (const enemy of ENEMY_POPULATION) {
    assert.equal(enemy.kind, 'wolf');
    assert.ok(enemy.leashRadius > 0);
    assert.ok(
      Math.hypot(enemy.home.x - RECOVERY_SANCTUARY.at.x, enemy.home.z - RECOVERY_SANCTUARY.at.z)
        > enemy.leashRadius + RECOVERY_SANCTUARY.radiusMeters,
      `${enemy.enemyId} territory must not reach the recovery sanctuary`,
    );
  }
  for (let i = 0; i < ENEMY_POPULATION.length; i += 1) {
    for (let j = i + 1; j < ENEMY_POPULATION.length; j += 1) {
      const a = ENEMY_POPULATION[i].home;
      const b = ENEMY_POPULATION[j].home;
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 6,
        `${ENEMY_POPULATION[i].enemyId}/${ENEMY_POPULATION[j].enemyId} can chain-pull from stacked homes`);
    }
  }
});

test('E2 C1 has one canonical Wolf level/stat table and preserves Level 1', () => {
  assert.deepEqual(WOLF_LEVEL_STATS, {
    1: { level: 1, maxHp: 30, biteDamage: 10, speed: 1.15 },
    2: { level: 2, maxHp: 40, biteDamage: 12, speed: 1.15 },
    4: { level: 4, maxHp: 60, biteDamage: 18, speed: 1.15 },
  });
  assert.throws(() => wolfStatsForLevel(3), /unsupported Wolf level/);
});

test('E2 C1 keeps level and strength independent across simultaneous Wolves', () => {
  const definitions = [
    { enemyId: 'wolf-low', kind: 'wolf', level: 1, home: { x: 0, z: 5 }, leashRadius: 8 },
    { enemyId: 'wolf-high', kind: 'wolf', level: 4, home: { x: 20, z: 5 }, leashRadius: 8 },
  ];
  const state = createPartyEncounterState({ enemies: definitions, heroIds: ['low', 'high'] });
  const low = state.enemies.find((enemy) => enemy.level === 1);
  const high = state.enemies.find((enemy) => enemy.level === 4);
  assert.equal(low.maxHp, 30);
  assert.equal(low.biteDamage, 10);
  assert.equal(high.maxHp, 60);
  assert.equal(high.biteDamage, 18);
  assert.notEqual(low.enemyId, high.enemyId);

  let current = state;
  let events = [];
  for (let i = 0; i < 100; i += 1) {
    const result = stepParty(current, {
      deltaSeconds: 1 / 20,
      heroes: {
        low: { position: { x: 0, z: 5 }, heading: 0 },
        high: { position: { x: 20, z: 5 }, heading: 0 },
      },
    });
    current = result.state;
    events = events.concat(result.events);
  }
  const lowHurt = events.find((event) => event.type === 'hero-hurt' && event.heroId === 'low');
  const highHurt = events.find((event) => event.type === 'hero-hurt' && event.heroId === 'high');
  assert.equal(lowHurt.remaining, 20);
  assert.equal(highHurt.remaining, 12);
  assert.equal(events.some((event) => event.type === 'xp-earned' || event.type === 'loot-dropped'), false);
});

test('E2 C1 carries enemy level/max health through the wire and rejects dishonest values', () => {
  const state = createEncounterState({ enemies: ENEMY_POPULATION, recoverySanctuary: RECOVERY_SANCTUARY });
  const stepped = stepEncounter(state, { deltaSeconds: 0.05, heroPosition: { x: 0, z: 0 } }).state;
  const message = snapshotMessage(1, [], {
    revision: stepped.revision,
    enemies: stepped.enemies.map(({ enemyId, kind, level, maxHp, x, z, heading, hp, mode, modeSeconds }) => ({
      enemyId, kind, level, maxHp, x, z, heading, hp, mode, modeSeconds, targetId: null,
    })),
    heroes: {},
  }, []);
  const decoded = decode(encode(message));
  assert.deepEqual(decoded.encounter.enemies.map((enemy) => [enemy.enemyId, enemy.level, enemy.maxHp]),
    stepped.enemies.map((enemy) => [enemy.enemyId, enemy.level, enemy.maxHp]));
  assert.throws(() => decode(encode(snapshotMessage(1, [], {
    ...message.encounter,
    enemies: [{ ...message.encounter.enemies[0], level: 3 }],
  }, []))), /supported Wolf level/);
  assert.throws(() => decode(encode(snapshotMessage(1, [], {
    ...message.encounter,
    enemies: [{ ...message.encounter.enemies[0], maxHp: 999 }],
  }, []))), /maxHp/);
});

test('E2 C1 server default consumes the same five authored definitions as offline', () => {
  const simulation = createSimulation();
  const serverEnemies = simulation.encounterSnapshot().enemies;
  assert.deepEqual(serverEnemies.map((enemy) => [enemy.enemyId, enemy.level, enemy.maxHp]),
    ENEMY_POPULATION.map((enemy) => [enemy.enemyId, enemy.level, wolfStatsForLevel(enemy.level).maxHp]));
});
