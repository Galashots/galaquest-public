import test from 'node:test';
import assert from 'node:assert/strict';
import { WOLF_BITE_DAMAGE, createPartyEncounterState, stepParty } from '../public/src/combat/encounter.js';
import { createSimulation } from '../net/gameServerCore.mjs';
import { encode, snapshotMessage } from '../public/src/net/protocolCore.js';

test('the wire publishes the same bash geometry and timing used for contact', () => {
  const sim = createSimulation({ destinationId: 'emberworks-deep' });
  const frame = snapshotMessage(sim.tick, sim.snapshot(), sim.encounterSnapshot(), [], 'emberworks-deep');
  const attack = JSON.parse(encode(frame)).encounter.enemies[0].attack;
  assert.deepEqual(attack, { contactSeconds: .64, durationSeconds: 1.06, cooldownSeconds: 2.4, reach: 1.45, halfArcRadians: Math.PI * .2 });
});

function windup({ kind = 'lava-gremlin', recoverySanctuary, heroPosition = { x: 0, z: 1.25 }, enemyPosition = { x: 0, z: 0 } } = {}) {
  let state = createPartyEncounterState({
    heroIds: ['child', 'sibling'], recoverySanctuary,
    enemies: [{ enemyId: 'opponent', kind, level: 1, spawn: enemyPosition }],
  });
  const command = {
    heroes: { child: { position: heroPosition }, sibling: { position: { x: 10, z: 10 } } },
  };
  for (let i = 0; i < 15 && state.enemies[0].mode !== 'bite'; i++) {
    state = stepParty(state, { ...command, deltaSeconds: .05 }).state;
  }
  assert.equal(state.enemies[0].mode, 'bite');
  return { state, command };
}

test('gremlin bash gives a visible windup before one contact and a recovery opening', () => {
  let { state, command } = windup();
  let result = stepParty(state, { ...command, deltaSeconds: .60 });
  assert.equal(result.state.heroes.child.hp, 30, 'the authored windup has not reached contact');
  result = stepParty(result.state, { ...command, deltaSeconds: .05 });
  assert.equal(result.state.heroes.child.hp, 24);
  assert.equal(result.events.filter(event => event.type === 'hero-hurt').length, 1);
  result = stepParty(result.state, { ...command, deltaSeconds: .35 });
  assert.equal(result.state.enemies[0].mode, 'bite', 'recovery still belongs to this attack');
  assert.equal(result.state.heroes.child.hp, 24, 'no repeated contact while recovering');
  result = stepParty(result.state, { ...command, deltaSeconds: .1 });
  assert.equal(result.state.enemies[0].mode, 'idle');
});

test('side-stepping the committed bash arc dodges it without requiring a dodge button', () => {
  const { state, command } = windup();
  command.heroes.child.position = { x: .9, z: .9 }; // In range, outside the 36-degree half arc.
  command.heroes.sibling.position = { x: 0, z: 1 }; // A different child does not inherit a committed target.
  const result = stepParty(state, { ...command, deltaSeconds: .65 });
  assert.equal(result.state.enemies[0].heading, 0);
  assert.equal(result.state.heroes.child.hp, 30);
  assert.equal(result.state.heroes.sibling.hp, 30);
  assert.equal(result.events.filter(event => event.type === 'bite-missed').length, 1);
});

test('entering recovery sanctuary during a windup prevents its contact', () => {
  const { state, command } = windup({
    recoverySanctuary: { at: { x: 0, z: 4 }, radiusMeters: 2 },
    heroPosition: { x: 0, z: 6.1 }, enemyPosition: { x: 0, z: 7.2 },
  });
  command.heroes.child.position = { x: 0, z: 5.9 };
  const result = stepParty(state, { ...command, deltaSeconds: .65 });
  assert.equal(result.state.heroes.child.hp, 30);
});

test('existing wolf contact timing is preserved', () => {
  const { state, command } = windup({ kind: 'wolf' });
  const result = stepParty(state, { ...command, deltaSeconds: .46 });
  assert.equal(result.state.heroes.child.hp, 30 - WOLF_BITE_DAMAGE);
});
