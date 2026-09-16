import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HEAVY_SMASH,
  WOLF_BITE_DAMAGE,
  createPartyEncounterState,
  enemyAttackForKind,
  enemyAttackFor,
  stepParty,
} from '../public/src/combat/encounter.js';
import { createSimulation } from '../net/gameServerCore.mjs';
import { encode, snapshotMessage } from '../public/src/net/protocolCore.js';

const STEP = 0.05;

function heavyWindup(heroPosition = { x: 0, z: 1.9 }) {
  let state = createPartyEncounterState({
    heroIds: ['child'],
    enemies: [{ enemyId: 'alpha', kind: 'alpha-wolf', level: 1, attackProfile: 'heavy', spawn: { x: 0, z: 0 } }],
  });
  const command = { heroes: { child: { position: heroPosition } } };
  for (let i = 0; i < 40 && state.enemies[0].mode !== 'bite'; i += 1) {
    state = stepParty(state, { ...command, deltaSeconds: STEP }).state;
  }
  assert.equal(state.enemies[0].mode, 'bite', 'Alpha must enter its committed attack when in reach');
  return { state, command };
}

test('Alpha attack geometry is a real heavy role, not ordinary bite or gremlin bash', () => {
  const alpha = enemyAttackFor({ kind: 'alpha-wolf', attackProfile: 'heavy' });
  const wolf = enemyAttackForKind('wolf');
  const gremlin = enemyAttackForKind('lava-gremlin');
  assert.deepEqual(alpha, HEAVY_SMASH);
  assert.ok(alpha.contactSeconds > gremlin.contactSeconds, 'heavy has the longest readable telegraph');
  assert.ok(alpha.durationSeconds > wolf.durationSeconds, 'heavy has a longer committed recovery');
  assert.ok(alpha.reach > wolf.reach, 'heavy threatens a larger space');
  assert.ok(alpha.halfArcRadians < wolf.halfArcRadians, 'heavy can be dodged by leaving its arc');
  assert.ok(alpha.cooldownSeconds > wolf.cooldownSeconds, 'heavy cannot be spammed');
});

test('Alpha commits its heading, misses a sidestep, and leaves a recovery window', () => {
  let { state, command } = heavyWindup();
  const committedHeading = state.enemies[0].heading;
  command.heroes.child.position = { x: 1.8, z: 0.4 };
  let result = stepParty(state, { ...command, deltaSeconds: HEAVY_SMASH.contactSeconds });
  assert.equal(result.state.enemies[0].heading, committedHeading);
  assert.equal(result.state.heroes.child.hp, 30, 'side-step outside the committed arc must dodge');
  assert.equal(result.events.filter((event) => event.type === 'bite-missed').length, 1);

  result = stepParty(result.state, { ...command, deltaSeconds: HEAVY_SMASH.durationSeconds - HEAVY_SMASH.contactSeconds });
  assert.equal(result.state.enemies[0].mode, 'idle', 'heavy ends into a punishable recovery');
  assert.ok(Math.abs(result.state.enemies[0].biteCooldown
    - (HEAVY_SMASH.cooldownSeconds - HEAVY_SMASH.durationSeconds)) < 1e-9);
});

test('standing in front of Alpha pays the heavy damage once at contact', () => {
  let { state, command } = heavyWindup();
  const result = stepParty(state, { ...command, deltaSeconds: HEAVY_SMASH.contactSeconds });
  assert.equal(result.state.heroes.child.hp, 30 - WOLF_BITE_DAMAGE * 2);
  assert.equal(result.events.filter((event) => event.type === 'hero-hurt').length, 1);
});

test('Emberworks snapshot advertises the server-owned heavy geometry per enemy', () => {
  const sim = createSimulation({ destinationId: 'emberworks-deep' });
  const frame = snapshotMessage(sim.tick, sim.snapshot(), sim.encounterSnapshot(), [], 'emberworks-deep');
  const enemies = JSON.parse(encode(frame)).encounter.enemies;
  assert.deepEqual(enemies.map((enemy) => enemy.kind), ['lava-gremlin', 'alpha-wolf']);
  assert.deepEqual(enemies[1].attack, HEAVY_SMASH);
});
