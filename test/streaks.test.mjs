// progression/streaks.js -- pure, caller-clocked, no timers. Driven directly with hand-fed
// elapsed-seconds, the same style every other timer-shaped rule in this repo is tested with.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  STREAK_TIER_2_KILLS,
  STREAK_TIER_3_KILLS,
  STREAK_WINDOW_SECONDS,
  coinMultiplierForStreak,
  createStreakState,
  registerKill,
  stepStreak,
  streakStillActive,
} from '../public/src/progression/streaks.js';

test('a fresh streak is zero and inactive', () => {
  const state = createStreakState();
  assert.equal(state.streak, 0);
  assert.equal(streakStillActive(state), false);
});

test('the first kill starts a streak of one', () => {
  const state = registerKill(createStreakState());
  assert.equal(state.streak, 1);
  assert.equal(state.secondsSinceKill, 0);
  assert.equal(streakStillActive(state), true);
});

test('a second kill within the window continues the streak', () => {
  let state = registerKill(createStreakState());
  state = stepStreak(state, 10);
  state = registerKill(state);
  assert.equal(state.streak, 2);
  assert.equal(state.secondsSinceKill, 0);
});

test('timing edge: a kill at exactly the window boundary still continues the streak', () => {
  let state = registerKill(createStreakState());
  state = stepStreak(state, STREAK_WINDOW_SECONDS);
  assert.equal(state.streak, 1, 'exactly at the boundary must not have decayed yet');
  state = registerKill(state);
  assert.equal(state.streak, 2, '<=  window is still within it');
});

test('timing edge: a kill one instant past the window starts a fresh streak', () => {
  let state = registerKill(createStreakState());
  state = stepStreak(state, STREAK_WINDOW_SECONDS + 0.001);
  assert.equal(state.streak, 0, 'stepStreak itself must have already expired the streak');
  state = registerKill(state);
  assert.equal(state.streak, 1, 'a kill after the window is a fresh streak, not a 2');
});

test('stepStreak alone (no kill) collapses an expired streak to zero and inactive', () => {
  let state = registerKill(createStreakState());
  state = registerKill(stepStreak(state, 5));
  assert.equal(state.streak, 2);
  state = stepStreak(state, STREAK_WINDOW_SECONDS + 1);
  assert.equal(state.streak, 0);
  assert.equal(streakStillActive(state), false);
});

test('stepStreak never expires a streak still inside the window, across many small ticks', () => {
  let state = registerKill(createStreakState());
  // 20 seconds in 0.05s ticks -- the server's own tick cadence -- well inside the 30s window.
  for (let i = 0; i < 400; i += 1) state = stepStreak(state, 0.05);
  assert.equal(state.streak, 1, 'many small ticks must sum honestly, not round away the streak early');
  assert.ok(Math.abs(state.secondsSinceKill - 20) < 1e-6);
});

test('interrupted streak: a long gap between kills resets, a short gap does not', () => {
  let state = registerKill(createStreakState()); // streak 1
  state = registerKill(stepStreak(state, 2)); // streak 2, quick follow-up
  state = registerKill(stepStreak(state, 29)); // streak 3, just inside the window
  state = stepStreak(state, 31); // now well past the window with no kill
  assert.equal(state.streak, 0, 'a long idle gap must break the streak');
  state = registerKill(state);
  assert.equal(state.streak, 1, 'the next kill starts over, not from 3');
});

test('a non-positive deltaSeconds never rewinds the idle clock', () => {
  let state = registerKill(createStreakState());
  state = stepStreak(state, 5);
  const before = state.secondsSinceKill;
  state = stepStreak(state, -3);
  assert.equal(state.secondsSinceKill, before, 'a negative delta must not move the clock backwards');
});

test('coinMultiplierForStreak: x1 below tier 2, x2 from tier 2, x3 from tier 3', () => {
  assert.equal(coinMultiplierForStreak(0), 1);
  assert.equal(coinMultiplierForStreak(1), 1);
  assert.equal(coinMultiplierForStreak(STREAK_TIER_2_KILLS - 1), 1);
  assert.equal(coinMultiplierForStreak(STREAK_TIER_2_KILLS), 2);
  assert.equal(coinMultiplierForStreak(STREAK_TIER_2_KILLS + 1), 2);
  assert.equal(coinMultiplierForStreak(STREAK_TIER_3_KILLS - 1), 2);
  assert.equal(coinMultiplierForStreak(STREAK_TIER_3_KILLS), 3);
  assert.equal(coinMultiplierForStreak(STREAK_TIER_3_KILLS + 50), 3, 'the multiplier caps at x3');
});

test('a realistic hunt: five kills every four seconds crosses into the x2 tier', () => {
  let state = createStreakState();
  for (let i = 0; i < STREAK_TIER_2_KILLS; i += 1) {
    state = stepStreak(state, 4);
    state = registerKill(state);
  }
  assert.equal(state.streak, STREAK_TIER_2_KILLS);
  assert.equal(coinMultiplierForStreak(state.streak), 2);
});
