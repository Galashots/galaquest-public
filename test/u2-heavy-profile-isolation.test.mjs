import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartyEncounterState, enemyAttackForKind, stepParty } from '../public/src/combat/encounter.js';
import { createSimulation } from '../net/gameServerCore.mjs';

const definition = profile => ({ enemyId: 'alpha-control', kind: 'alpha-wolf', level: 1,
  spawn: { x: 0, z: 0 }, ...(profile ? { attackProfile: profile } : {}) });

test('unprofiled Alpha keeps the original ordinary bite contract', () => {
  const alpha = enemyAttackForKind('alpha-wolf');
  assert.equal(alpha.contactSeconds, .45, 'An Emberworks increment must not retune every existing Alpha.');
  assert.equal(alpha.durationSeconds, 1.2);
  assert.equal(alpha.cooldownSeconds, 2.6);
});

test('authored heavy profile survives stepping and a respawn', () => {
  let state = createPartyEncounterState({ heroIds: ['child'], enemies: [definition('heavy')] });
  assert.equal(state.enemies[0].attackProfile, 'heavy');
  state = { ...state, enemies: [{ ...state.enemies[0], mode: 'dead', modeSeconds: 100 }] };
  state = stepParty(state, { deltaSeconds: .05, heroes: { child: { position: { x: 50, z: 50 } } } }).state;
  assert.equal(state.enemies[0].mode, 'idle');
  assert.equal(state.enemies[0].attackProfile, 'heavy', 'A respawn must not lose authored counterplay.');
});

test('invalid or cross-kind heavy profiles fail before combat', () => {
  assert.throws(() => createPartyEncounterState({ enemies: [definition('typo')] }), /attackProfile/);
  assert.throws(() => createPartyEncounterState({ enemies: [{ ...definition('heavy'), kind: 'wolf' }] }), /attackProfile/);
});

test('Emberworks publishes actual per-instance heavy geometry without changing gremlin', () => {
  const sim = createSimulation({ destinationId: 'emberworks-deep' });
  const enemies = sim.encounterSnapshot().enemies;
  const alpha = enemies.find(enemy => enemy.enemyId === 'emberworks-alpha-1');
  const gremlin = enemies.find(enemy => enemy.kind === 'lava-gremlin');
  assert.equal(alpha.attack.contactSeconds, .95);
  assert.equal(alpha.attack.durationSeconds, 1.75);
  assert.equal(gremlin.attack.contactSeconds, .64);
  assert.equal(gremlin.attack.durationSeconds, 1.06);
});
