import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  BASE_HERO_DAMAGE,
  DEATH_SECONDS,
  WOLF_MAX_HP,
  WOLF_RESPAWN_SECONDS,
  createPartyEncounterState,
  requestPartyAttack,
  stepParty,
} from '../public/src/combat/encounter.js';

const STEP = 1 / 60;
const HERO = { position: { x: 0, z: -1 }, heading: 0, targetable: true };

function twoWolves(order = ['wolf-b', 'wolf-a']) {
  return order.map((enemyId) => ({
    enemyId,
    kind: 'wolf',
    patrol: [{ x: enemyId === 'wolf-a' ? -0.4 : 0.4, z: 0 }],
  }));
}

function advanceToContact(state, heroes = { H: HERO }) {
  let next = state;
  const seen = [];
  for (let elapsed = 0; elapsed < 0.7; elapsed += STEP) {
    const result = stepParty(next, { deltaSeconds: STEP, heroes });
    next = result.state;
    seen.push(...result.events);
  }
  return { state: next, events: seen };
}

test('canonical authority is an identified enemy collection with derived Wolf compatibility only', () => {
  const state = createPartyEncounterState({ enemies: twoWolves(), heroIds: ['H'] });
  assert.equal(state.enemies.length, 2);
  assert.deepEqual(state.enemies.map((enemy) => enemy.enemyId), ['wolf-b', 'wolf-a']);
  assert.ok(state.enemies.every((enemy) => enemy.kind === 'wolf'));
  assert.equal(state.wolf.enemyId, undefined, 'legacy wolf view must not become a second identified authority');
  assert.equal(state.wolf.x, state.enemies[0].x);
});

test('one swing damages at most one enemy: nearest first, stable enemyId breaks an exact tie', () => {
  let state = createPartyEncounterState({ enemies: twoWolves(), heroIds: ['H'] });
  state = requestPartyAttack(state, 'H', 'swing-1').state;
  const result = advanceToContact(state);

  const hits = result.events.filter((event) => event.type === 'wolf-hit');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].enemyId, 'wolf-a', 'equal-distance tie must choose stable identity, not array order');
  assert.equal(hits[0].kind, 'wolf');

  const byId = Object.fromEntries(result.state.enemies.map((enemy) => [enemy.enemyId, enemy]));
  assert.equal(byId['wolf-a'].hp, WOLF_MAX_HP - BASE_HERO_DAMAGE);
  assert.equal(byId['wolf-b'].hp, WOLF_MAX_HP);
});

test('reordering serialized enemies cannot retarget an equal-distance swing', () => {
  function targetFor(order) {
    let state = createPartyEncounterState({ enemies: twoWolves(order), heroIds: ['H'] });
    state = requestPartyAttack(state, 'H', 'swing').state;
    return advanceToContact(state).events.find((event) => event.type === 'wolf-hit')?.enemyId;
  }
  assert.equal(targetFor(['wolf-b', 'wolf-a']), 'wolf-a');
  assert.equal(targetFor(['wolf-a', 'wolf-b']), 'wolf-a');
});

test('ordinary enemies keep independent hit/lifecycle state and respawn with the same stable id', () => {
  const definitions = [
    { enemyId: 'wolf-a', kind: 'wolf', patrol: [{ x: 0, z: 0 }, { x: 5, z: 5 }] },
    { enemyId: 'wolf-b', kind: 'wolf', patrol: [{ x: 20, z: 20 }] },
  ];
  let state = createPartyEncounterState({ enemies: definitions, heroIds: ['H'] });

  state = requestPartyAttack(state, 'H', 'kill').state;
  ({ state } = advanceToContact(state, {
    H: { ...HERO, heroDamage: WOLF_MAX_HP },
  }));
  let byId = Object.fromEntries(state.enemies.map((enemy) => [enemy.enemyId, enemy]));
  assert.equal(byId['wolf-a'].mode, 'dying');
  assert.equal(byId['wolf-b'].hp, WOLF_MAX_HP);
  assert.equal(byId['wolf-b'].mode, 'idle');

  const seen = [];
  const seconds = DEATH_SECONDS + WOLF_RESPAWN_SECONDS + 0.2;
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    const result = stepParty(state, {
      deltaSeconds: STEP,
      wolfHostile: false,
      heroes: { H: { position: { x: 100, z: 100 }, heading: 0 } },
    });
    state = result.state;
    seen.push(...result.events);
  }
  byId = Object.fromEntries(state.enemies.map((enemy) => [enemy.enemyId, enemy]));
  assert.ok(seen.some((event) => event.type === 'wolf-respawned' && event.enemyId === 'wolf-a'));
  assert.equal(byId['wolf-a'].enemyId, 'wolf-a');
  assert.equal(byId['wolf-a'].spawnIndex, 1);
  assert.equal(byId['wolf-a'].x, 5);
  assert.equal(byId['wolf-a'].z, 5);
  assert.equal(byId['wolf-b'].spawnIndex, 0);
  assert.equal(byId['wolf-b'].x, 20);
  assert.equal(byId['wolf-b'].z, 20);
});

test('defeat event carries stable identity and kind for contribution/reward consumers', () => {
  let state = createPartyEncounterState({
    enemies: [{ enemyId: 'collection-wolf', kind: 'wolf', patrol: [{ x: 0, z: 0 }] }],
    heroIds: ['H'],
  });
  state = requestPartyAttack(state, 'H', 'kill').state;
  const result = advanceToContact(state, { H: { ...HERO, heroDamage: WOLF_MAX_HP } });
  const defeat = result.events.find((event) => event.type === 'wolf-defeated');
  assert.deepEqual(
    { enemyId: defeat.enemyId, kind: defeat.kind, heroId: defeat.heroId },
    { enemyId: 'collection-wolf', kind: 'wolf', heroId: 'H' },
  );
});
