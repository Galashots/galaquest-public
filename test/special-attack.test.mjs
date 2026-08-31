import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  SPECIAL_ATTACK_CONTACT_SECONDS,
  SPECIAL_ATTACK_COOLDOWN_SECONDS,
  SPECIAL_ATTACK_MAX_TARGETS,
  canUseSpecialAttack,
  isWithinSpecialStrike,
  specialAttackDamageFor,
  specialAttackTargets,
} from '../public/src/combat/specialAttack.js';
import {
  createEncounterState,
  requestSpecialAttack,
  stepEncounter,
} from '../public/src/combat/encounter.js';
import { decode, encode, specialMessage } from '../public/src/net/protocol.js';

test('Wildwood Burst is Level 5 gated and has an honest cooldown', () => {
  const locked = { level: 4, specialCooldown: 0, specialSeconds: -1, downSeconds: -1, swingSeconds: -1 };
  assert.equal(canUseSpecialAttack(locked), false);
  assert.equal(canUseSpecialAttack({ ...locked, level: 5 }), true);
  assert.equal(canUseSpecialAttack({ ...locked, level: 5, specialCooldown: 0.1 }), false);
  assert.equal(canUseSpecialAttack({ ...locked, level: 5, specialSeconds: 0 }), false);
});

test('the special command is a replay-safe protocol peer of attack', () => {
  assert.deepEqual(decode(encode(specialMessage(7))), {
    v: 4, type: 'special', seq: 7,
  });
});

test('Wildwood Burst selects at most three nearby targets in stable nearest order', () => {
  const enemies = [
    { enemyId: 'wolf-c', x: 0, z: 3, mode: 'idle' },
    { enemyId: 'wolf-a', x: 0, z: 1, mode: 'idle' },
    { enemyId: 'wolf-b', x: 0, z: 2, mode: 'idle' },
    { enemyId: 'wolf-far', x: 0, z: 5, mode: 'idle' },
    { enemyId: 'wolf-dead', x: 0, z: 1, mode: 'dead' },
  ];
  assert.deepEqual(
    specialAttackTargets(enemies, { x: 0, z: 0 }, 0).map((enemy) => enemy.enemyId),
    ['wolf-a', 'wolf-b', 'wolf-c'],
  );
  assert.equal(specialAttackTargets(enemies, { x: 0, z: 0 }, Math.PI).length, 0);
  assert.equal(SPECIAL_ATTACK_MAX_TARGETS, 3);
  assert.equal(isWithinSpecialStrike({ x: 0, z: 0 }, 0, { x: 0, z: 4 }), true);
  assert.equal(isWithinSpecialStrike({ x: 0, z: 0 }, 0, { x: 0, z: 4.51 }), false);
});

test('Wildwood Burst resolves one Level-5 press into a multi-enemy power proof', () => {
  const initial = createEncounterState({ enemies: [
    { enemyId: 'wolf-a', spawn: { x: 0, z: 1 } },
    { enemyId: 'wolf-b', spawn: { x: 0, z: 2 } },
    { enemyId: 'wolf-c', spawn: { x: 0, z: 3 } },
  ] });
  const requested = requestSpecialAttack(initial, 5, 1);
  assert.equal(requested.accepted, true);
  assert.deepEqual(requested.events.map((event) => event.type), ['special-start']);

  const stepped = stepEncounter(requested.state, {
    commandId: 2,
    deltaSeconds: SPECIAL_ATTACK_CONTACT_SECONDS,
    heroPosition: { x: 0, z: 0 },
    heroHeading: 0,
    heroDamage: 18,
  });
  assert.equal(stepped.events.filter((event) => event.type === 'special-hit').length, 3);
  assert.equal(stepped.events.filter((event) => event.type === 'wolf-defeated').length, 3);
  assert.equal(stepped.state.enemies.every((enemy) => enemy.mode === 'dying'), true);
  assert.equal(
    stepped.events.find((event) => event.type === 'special-hit').damage,
    specialAttackDamageFor(18),
  );
  const repeated = requestSpecialAttack(stepped.state, 5, 3);
  assert.equal(repeated.accepted, false);
  assert.ok(repeated.state.hero.specialCooldown > 0);
  assert.ok(repeated.state.hero.specialCooldown < SPECIAL_ATTACK_COOLDOWN_SECONDS);
});
