// public/src/progression/streakView.js
//
// R1: the pure view-model for the kill-streak meter, over progression/streaks.js's own state. Kept
// separate from that module the same way progression/heroScreen.js's heroScreenViewModel is kept
// separate from heroStats.js -- streaks.js owns the RULE (what a streak counts as, when it expires,
// what multiplier it earns); this owns the READOUT (should a meter be on screen at all, what tier
// label and how full a ring), so a DOM binder in main.js never has to re-derive either.
//
// No DOM, no three.js, no clock of its own -- pure translation of the state streaks.js already hands
// back, unit tested directly.

import {
  STREAK_TIER_2_KILLS, STREAK_TIER_3_KILLS, STREAK_WINDOW_SECONDS, coinMultiplierForStreak, streakStillActive,
} from './streaks.js';

/**
 * @param state  a progression/streaks.js state -- `{ streak, secondsSinceKill }`.
 * @returns null when there is nothing to show (no streak yet, or it has expired); otherwise
 *   `{ streak, multiplier, tierLabel, ringFraction }`.
 *
 * `ringFraction` counts DOWN from 1 to 0 over the window since the last kill -- a shrinking ring
 * reads as "time is running out" without a child having to read a number, the same wordless-countdown
 * convention combat/feedback.js's own reference research already establishes for this game (a bar
 * that depletes, not a clock that ticks).
 *
 * `tierLabel` is exactly one of three short strings a young player reads in one glance -- streaks.js's
 * own header names this precisely: "x1 is playing, x2 is on a roll, x3 is on fire, and those are the
 * only three states a coin pickup's own presentation ever has to distinguish."
 */
export function streakMeterView(state) {
  if (!streakStillActive(state)) return null;
  const multiplier = coinMultiplierForStreak(state.streak);
  const tierLabel = multiplier >= 3 ? 'ON FIRE' : multiplier >= 2 ? 'ON A ROLL' : 'STREAK';
  const secondsSinceKill = Number.isFinite(state.secondsSinceKill) ? state.secondsSinceKill : 0;
  const ringFraction = Math.max(0, Math.min(1, 1 - secondsSinceKill / STREAK_WINDOW_SECONDS));
  return {
    streak: state.streak,
    multiplier,
    tierLabel,
    countText: `x${multiplier}`,
    ringFraction,
    // Which of the two tier thresholds this kill just crossed, if any -- main.js pulses the meter
    // harder on a tier-up than on an ordinary kill within the same tier, the same "escalating reward"
    // streaks.js's own header describes for the multiplier itself, carried through to the meter's feel.
    justReachedTier2: state.streak === STREAK_TIER_2_KILLS,
    justReachedTier3: state.streak === STREAK_TIER_3_KILLS,
  };
}
