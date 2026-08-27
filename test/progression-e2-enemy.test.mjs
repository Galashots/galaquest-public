import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  createEncounterState,
  stepEncounter,
  createPartyEncounterState,
  stepParty,
  WOLF_AGGRO_RANGE,
} from '../public/src/combat/encounter.js';
import { WOLF_LEVEL_STATS, enemyStatsForLevel, wolfStatsForLevel } from '../public/src/combat/enemyStats.js';
import { ENEMY_POPULATION, RECOVERY_SANCTUARY, ROAD, ROWAN, WOLF_SPAWN } from '../public/src/world/zones/village.js';
import { decode, encode, snapshotMessage } from '../public/src/net/protocol.js';
import { createSimulation } from '../net/gameServerCore.mjs';

// R1 (the density push) grew this from FIVE authored Wolves to TWELVE authored bodies across four
// kinds -- the original five's own ids, levels and homes are unchanged (see ENEMY_POPULATION's own
// header in village.js for why), so this test now pins the ENLARGED population's shape rather than
// the original locked mix, while keeping every structural rule the original test enforced: unique
// stable ids, a real positive leash, sanctuary clearance, and pairwise spacing so no two bodies can
// chain-pull each other.
test('R1 authors twelve ordinary enemies across four kinds, with separated homes and no sanctuary overlap', () => {
  assert.equal(ENEMY_POPULATION.length, 12);
  assert.equal(new Set(ENEMY_POPULATION.map((enemy) => enemy.enemyId)).size, 12,
    'every enemyId must be unique');
  assert.deepEqual(
    ENEMY_POPULATION.map((enemy) => enemy.kind).sort(),
    ['alpha-wolf', 'ember-wolf', 'ember-wolf', 'frost-wolf', 'frost-wolf',
      'wolf', 'wolf', 'wolf', 'wolf', 'wolf', 'wolf', 'wolf'],
  );
  // The original five's own locked level mix, unmoved.
  const wolves = ENEMY_POPULATION.filter((enemy) => enemy.kind === 'wolf');
  assert.equal(wolves.length, 7);
  assert.deepEqual(
    wolves.map((enemy) => enemy.level).sort((a, b) => a - b),
    [1, 1, 1, 1, 2, 2, 4],
  );
  for (const enemy of ENEMY_POPULATION) {
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

function distanceToPolyline(x, z, points) {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const projection = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
    best = Math.min(best, Math.hypot(x - (ax + projection * dx), z - (az + projection * dz)));
  }
  return best;
}

test('E2 keeps the opening Wolf outside the north-lane aggro envelope', () => {
  const opening = ENEMY_POPULATION.find((enemy) => enemy.enemyId === 'wolf-1');
  assert.ok(opening);
  const laneDistance = distanceToPolyline(opening.home.x, opening.home.z, ROAD.points);
  assert.ok(laneDistance > WOLF_AGGRO_RANGE,
    `wolf-1 is ${laneDistance.toFixed(2)}m from the route, inside the ${WOLF_AGGRO_RANGE}m aggro range`);
});

test('E2 keeps Rowan approach outside the Level-4 Wolf aggro envelope', () => {
  const wolf = ENEMY_POPULATION.find((enemy) => enemy.enemyId === 'wolf-5');
  assert.ok(wolf);
  assert.ok(
    Math.hypot(wolf.home.x - ROWAN.at[0], wolf.home.z - ROWAN.at[1]) > WOLF_AGGRO_RANGE + 2,
    'the Rowan approach needs speech-radius clearance from the recovery-test Wolf',
  );
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
  // Selected by stable id, not array index: stepParty canonicalises enemy order by enemyId
  // (stable-sort, not authoring order), so R1's variants can sort ahead of wolf-1 alphabetically
  // ("alpha-wolf-1" < "wolf-1"). Pinning to the Wolf specifically keeps this test's own "level 3 is
  // not a supported WOLF level" claim honest -- a variant's own supported level set differs.
  const wolfOne = message.encounter.enemies.find((enemy) => enemy.enemyId === 'wolf-1');
  assert.ok(wolfOne, 'wolf-1 must still be present in the authored twelve');
  assert.throws(() => decode(encode(snapshotMessage(1, [], {
    ...message.encounter,
    enemies: [{ ...wolfOne, level: 3 }],
  }, []))), /supported Wolf level/);
  assert.throws(() => decode(encode(snapshotMessage(1, [], {
    ...message.encounter,
    enemies: [{ ...wolfOne, maxHp: 999 }],
  }, []))), /maxHp/);
});

test('E2 C1 server default consumes the same twelve authored definitions as offline', () => {
  const simulation = createSimulation();
  const serverEnemies = simulation.encounterSnapshot().enemies;
  assert.deepEqual(serverEnemies.map((enemy) => [enemy.enemyId, enemy.level, enemy.maxHp]),
    // enemyStatsForLevel, not wolfStatsForLevel: R1's variants share the level NUMBER 1 with the
    // opening Wolves but not their stat row (enemyStats.js's own header explains why the lookup is
    // kind-aware) -- reading the wrong table here would silently re-pin every variant's hp to the
    // Wolf's own 30, and this test would go on passing against the wrong number.
    ENEMY_POPULATION.map((enemy) => [enemy.enemyId, enemy.level, enemyStatsForLevel(enemy.kind, enemy.level).maxHp]));
});

test('E2 production recovery preserves opening-Wolf damage across a solo party wipe', () => {
  const simulation = createSimulation();
  const player = simulation.addPlayer('recovery kid', { x: WOLF_SPAWN.x, z: WOLF_SPAWN.z - 1 });
  assert.equal(simulation.applyAttack(player.id, { seq: 1 }), true);
  let nowMs = 0;
  let downed = false;
  for (let tick = 0; tick < 240; tick += 1) {
    nowMs += 50;
    simulation.step(0.05, nowMs);
    const hero = simulation.encounterSnapshot().heroes[player.id];
    const opening = simulation.encounterSnapshot().enemies.find((enemy) => enemy.enemyId === 'wolf-1');
    if (!downed && hero.downSeconds >= 0) {
      downed = true;
      assert.equal(opening.hp, opening.maxHp - 10, 'the first opening hit must remain credited before recovery');
    }
    if (downed && hero.downSeconds < 0) {
      assert.equal(opening.hp, opening.maxHp - 10,
        'production recovery must not party-wipe/reset the partially damaged opening Wolf');
      assert.equal(opening.targetId, null);
      return;
    }
  }
  assert.fail('the production recovery fixture never completed a down/up cycle');
});

test('E2 C2 leash clears pursuit, suppresses bites, and restores the authored home body', () => {
  let state = createPartyEncounterState({
    enemies: [{ enemyId: 'wolf-leash', kind: 'wolf', level: 4, home: { x: 0, z: 0 }, leashRadius: 2 }],
    heroIds: ['hero'],
  });
  let sawReturning = false;
  let eventsWhileReturning = [];

  for (let tick = 0; tick < 200; tick += 1) {
    const result = stepParty(state, {
      deltaSeconds: 0.1,
      heroes: { hero: { position: { x: 0, z: 5 }, heading: 0 } },
    });
    state = result.state;
    const enemy = state.enemies[0];
    if (enemy.mode === 'returning') {
      sawReturning = true;
      eventsWhileReturning = eventsWhileReturning.concat(result.events);
      break;
    }
  }
  assert.equal(sawReturning, true, 'the Wolf must cross its explicit leash and enter returning mode');
  assert.equal(eventsWhileReturning.some((event) => event.type === 'hero-hurt'), false);
  assert.equal(state.enemies[0].targetId, null);
  assert.equal(state.enemies[0].enemyId, 'wolf-leash');
  assert.equal(state.enemies[0].level, 4);

  let reachedHome = false;
  for (let tick = 0; tick < 100; tick += 1) {
    state = stepParty(state, {
      deltaSeconds: 0.1,
      heroes: { hero: { position: { x: 0, z: 5 }, heading: 0 } },
    }).state;
    if (state.enemies[0].mode === 'idle'
      && state.enemies[0].x === 0 && state.enemies[0].z === 0) {
      reachedHome = true;
      break;
    }
  }
  assert.equal(reachedHome, true, 'the returning Wolf must reach its authored home');
  const home = state.enemies[0];
  assert.equal(home.mode, 'idle');
  assert.equal(home.targetId, null);
  assert.equal(home.x, 0);
  assert.equal(home.z, 0);
  assert.equal(home.hp, home.maxHp);
});

test('E2 C2 recovery relocates one hero into protection without resetting a living sibling', () => {
  const sanctuary = { at: { x: 0, z: 0 }, radiusMeters: 2 };
  let state = createPartyEncounterState({
    enemies: [{ enemyId: 'wolf-recovery', kind: 'wolf', level: 1, home: { x: 0, z: 3 }, leashRadius: 8 }],
    heroIds: ['downed', 'sibling'],
    heroSpawn: { x: 0, z: 0 },
    recoverySanctuary: sanctuary,
  });
  const siblingPosition = { x: 20, z: 0 };
  let downed = false;
  let siblingHp = state.heroes.sibling.hp;

  for (let tick = 0; tick < 200; tick += 1) {
    const result = stepParty(state, {
      deltaSeconds: 0.1,
      heroes: {
        downed: { position: { x: 0, z: 3 }, heading: 0 },
        sibling: { position: siblingPosition, heading: 0 },
      },
    });
    state = result.state;
    if (state.heroes.downed.downSeconds >= 0) {
      downed = true;
      break;
    }
  }
  assert.equal(downed, true, 'the ordinary Wolf must be able to down the exposed hero');
  assert.equal(state.heroes.sibling.hp, siblingHp);

  let respawned = false;
  for (let tick = 0; tick < 40; tick += 1) {
    state = stepParty(state, {
      deltaSeconds: 0.1,
      heroes: {
        downed: { position: { x: 0, z: 0 }, heading: 0 },
        sibling: { position: siblingPosition, heading: 0 },
      },
    }).state;
    if (state.heroes.downed.protectionSeconds > 0) {
      respawned = true;
      break;
    }
  }
  assert.equal(respawned, true);
  assert.equal(state.heroes.downed.hp, state.heroes.downed.maxHp);
  assert.equal(state.heroes.sibling.hp, siblingHp);

  const protectedHp = state.heroes.downed.hp;
  for (let tick = 0; tick < 10; tick += 1) {
    state = stepParty(state, {
      deltaSeconds: 0.1,
      heroes: {
        downed: { position: { x: 0, z: 0 }, heading: 0 },
        sibling: { position: siblingPosition, heading: 0 },
      },
    }).state;
  }
  assert.equal(state.heroes.downed.hp, protectedHp, 'sanctuary/protection must suppress immediate re-hits');
  assert.equal(state.heroes.sibling.hp, siblingHp, 'one child recovery must not reset another child');
});

test('E2 C2 server recovery moves only the downed player to HERO_SPAWN', () => {
  const simulation = createSimulation({
    enemies: [{ enemyId: 'wolf-server-recovery', kind: 'wolf', level: 1, home: { x: 0, z: 3 }, leashRadius: 8 }],
  });
  const downed = simulation.addPlayer('downed', { x: 0, z: 3 });
  const sibling = simulation.addPlayer('sibling', { x: 20, z: 0 });
  const siblingHp = simulation.encounterSnapshot().heroes[sibling.id].hp;
  let protectionSeen = false;

  for (let tick = 0; tick < 300; tick += 1) {
    simulation.step(0.1, 1000 + tick * 100);
    const hero = simulation.encounterSnapshot().heroes[downed.id];
    if (hero.protectionSeconds > 0) {
      protectionSeen = true;
      break;
    }
  }
  assert.equal(protectionSeen, true);
  const wire = JSON.parse(JSON.stringify(simulation.encounterSnapshot()));
  assert.ok(wire.heroes[downed.id].protectionSeconds > 0, 'server recovery protection must survive the authoritative wire');
  const relocated = simulation.snapshot().find((player) => player.id === downed.id);
  assert.deepEqual({ x: relocated.x, z: relocated.z }, { x: 0, z: 0 });
  assert.equal(simulation.encounterSnapshot().heroes[sibling.id].hp, siblingHp);
  assert.equal(simulation.encounterSnapshot().heroes[downed.id].downSeconds, -1);
});
