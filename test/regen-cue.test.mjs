import { strict as assert } from 'node:assert';
import test from 'node:test';

import { isOutOfCombatRegenRise } from '../public/src/combat/feedback.js';

test('a rise of exactly 1 hp reads as regen', () => {
  assert.equal(isOutOfCombatRegenRise(10, 11), true);
});

test('a bigger rise (a kill heal or a heart) does not read as regen', () => {
  assert.equal(isOutOfCombatRegenRise(10, 20), false); // VICTORY_HEAL_HP-sized
  assert.equal(isOutOfCombatRegenRise(10, 30), false); // HEART_HEAL_HP-sized
});

test('a fall, no change, or non-finite input never reads as regen', () => {
  assert.equal(isOutOfCombatRegenRise(10, 9), false);
  assert.equal(isOutOfCombatRegenRise(10, 10), false);
  assert.equal(isOutOfCombatRegenRise(NaN, 11), false);
  assert.equal(isOutOfCombatRegenRise(10, undefined), false);
});
