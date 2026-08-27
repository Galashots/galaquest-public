import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createStreakState, registerKill, stepStreak } from '../public/src/progression/streaks.js';
import { streakMeterView } from '../public/src/progression/streakView.js';

test('a fresh streak state shows no meter', () => {
  assert.equal(streakMeterView(createStreakState()), null);
});

test('one kill shows the meter at x1, a full ring, and no tier crossed', () => {
  const state = registerKill(createStreakState());
  const view = streakMeterView(state);
  assert.equal(view.streak, 1);
  assert.equal(view.multiplier, 1);
  assert.equal(view.tierLabel, 'STREAK');
  assert.equal(view.countText, 'x1');
  assert.equal(view.ringFraction, 1);
  assert.equal(view.justReachedTier2, false);
  assert.equal(view.justReachedTier3, false);
});

test('the ring drains as the window elapses, and the meter disappears once it expires', () => {
  let state = registerKill(createStreakState());
  state = stepStreak(state, 15);
  assert.equal(streakMeterView(state).ringFraction, 0.5);
  state = stepStreak(state, 15.01);
  assert.equal(streakMeterView(state), null, 'a streak past the window is gone, not a ring at zero');
});

test('tier 2 at five kills reads ON A ROLL and reports the crossing; tier 3 at ten reads ON FIRE', () => {
  let state = createStreakState();
  for (let i = 0; i < 4; i += 1) state = registerKill(state);
  assert.equal(streakMeterView(state).multiplier, 1);

  state = registerKill(state); // 5th kill
  const tier2 = streakMeterView(state);
  assert.equal(tier2.multiplier, 2);
  assert.equal(tier2.tierLabel, 'ON A ROLL');
  assert.equal(tier2.justReachedTier2, true);
  assert.equal(tier2.justReachedTier3, false);

  for (let i = 0; i < 5; i += 1) state = registerKill(state);
  const tier3 = streakMeterView(state);
  assert.equal(tier3.streak, 10);
  assert.equal(tier3.multiplier, 3);
  assert.equal(tier3.tierLabel, 'ON FIRE');
  assert.equal(tier3.justReachedTier3, true);
  assert.equal(tier3.justReachedTier2, false, 'only the tier crossed THIS kill is flagged');
});
