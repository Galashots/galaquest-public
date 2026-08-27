import { strict as assert } from 'node:assert';
import test from 'node:test';

import { xpToastText } from '../public/src/rewards/xpToastView.js';
import { killXpForKind } from '../public/src/combat/enemyStats.js';

test('formats every real kind\'s own award', () => {
  assert.equal(xpToastText(killXpForKind('wolf')), '+20 XP');
  assert.equal(xpToastText(killXpForKind('ember-wolf')), '+30 XP');
  assert.equal(xpToastText(killXpForKind('frost-wolf')), '+40 XP');
  assert.equal(xpToastText(killXpForKind('alpha-wolf')), '+100 XP');
});

test('refuses a non-positive or non-integer amount rather than printing a false toast', () => {
  assert.throws(() => xpToastText(0), TypeError);
  assert.throws(() => xpToastText(-20), TypeError);
  assert.throws(() => xpToastText(1.5), TypeError);
  assert.throws(() => xpToastText(null), TypeError);
});
