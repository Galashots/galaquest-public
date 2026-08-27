// public/src/progression/streaks.js
//
// KILL STREAKS: rolling 30-second momentum, feeding a coin multiplier on kill drops. Part of the
// "maximum dopamine" combat push -- more kills feel like MORE than the sum of their own coins when
// they land close together, which is the whole reason world/enemyDrops.js takes a streak multiplier
// rather than a flat coin count per kill.
//
// Pure and CALLER-CLOCKED, the same discipline combat/encounter.js's own stepParty keeps for its
// timers: no Date.now, no setInterval, no wall clock read anywhere in this file. A caller (the
// server's own tick, or main.js's offline fallback running its own frame clock) hands in elapsed or
// now-style seconds and gets a deterministic answer back -- which is what makes this testable without
// sleeping and usable identically online and offline, the same seam every other timer-shaped rule in
// this game already takes (rewards/marks.js's own header explains the same trade for a different
// reason: two engines computing the same thing from the same inputs cannot quietly disagree).
//
// Not gated behind combat/'s own purity rules (this lives in progression/, a sibling the way
// rewards/ is), but held to the same no-clock, no-randomness bar anyway -- a streak rule that reached
// for Date.now would be exactly as untestable as a combat rule that did, for the identical reason.

/** How long a streak survives with no new kill. Chosen to reward a child who is actively hunting
 *  (moving fight to fight) without asking for combo-game timing precision from a young player -- 30s
 *  is "still in the fight", not "still holding the last hit's exact rhythm". */
export const STREAK_WINDOW_SECONDS = 30;

/** Streak counts at which the coin multiplier steps up. Two tiers past the baseline: enough to feel
 *  like an escalating reward for staying on a hunt, not so many a child has to track a number to
 *  understand what is happening -- x1 is "playing", x2 is "on a roll", x3 is "on fire", and those are
 *  the only three states a coin pickup's own presentation ever has to distinguish. */
export const STREAK_TIER_2_KILLS = 5;
export const STREAK_TIER_3_KILLS = 10;

/**
 * A fresh streak, held nowhere: no kills yet, and therefore no clock running against anything.
 * `secondsSinceKill` starts at +Infinity rather than 0 so a caller that immediately asks
 * `streakStillActive` on a hero who has never landed a kill gets the honest answer (false) instead
 * of a fresh streak reading as "just active".
 */
export function createStreakState() {
  return Object.freeze({ streak: 0, secondsSinceKill: Infinity });
}

/**
 * Advance the idle clock by `deltaSeconds`. A streak that has run clear of STREAK_WINDOW_SECONDS
 * with no new kill collapses to zero here -- this is the one place a streak actually EXPIRES, as
 * opposed to registerKill below merely deciding whether a NEW kill continues or restarts one.
 *
 * Calling this every tick (even when nothing died) is what lets a later HUD read a live "your streak
 * is about to expire" state rather than only ever learning about expiry in arrears, on the next kill.
 *
 * @param state          the streak state from the previous call, or createStreakState().
 * @param deltaSeconds   seconds elapsed since the last call; a non-positive value is treated as 0
 *                        rather than rewinding the clock.
 */
export function stepStreak(state, deltaSeconds) {
  const secondsSinceKill = (state.secondsSinceKill ?? Infinity) + Math.max(0, deltaSeconds ?? 0);
  if (state.streak > 0 && secondsSinceKill > STREAK_WINDOW_SECONDS) {
    return Object.freeze({ streak: 0, secondsSinceKill });
  }
  return Object.freeze({ streak: state.streak, secondsSinceKill });
}

/**
 * Record one kill. Continues the existing streak if the last kill is still within the window,
 * otherwise starts a fresh one at 1 -- the same "was I still on a roll" question stepStreak's own
 * decay answers, asked at the one moment a caller actually needs the answer for real (a kill just
 * landed and something has to decide what multiplier it earns).
 *
 * Deliberately reads `state.secondsSinceKill` as it stood BEFORE this tick's own stepStreak call --
 * a caller wiring this in should register the kill first, off the idle time since the PREVIOUS kill,
 * then step the clock forward for the next one. Combining the two into one call was considered and
 * rejected: a server folding several kills out of one tick's events needs to call this once per
 * kill, each continuing from the last, which a combined step+register could not express cleanly.
 */
export function registerKill(state) {
  const withinWindow = state.streak > 0 && (state.secondsSinceKill ?? Infinity) <= STREAK_WINDOW_SECONDS;
  return Object.freeze({ streak: withinWindow ? state.streak + 1 : 1, secondsSinceKill: 0 });
}

/**
 * Whether a streak is still alive right now, for a presenter deciding whether to show a meter at
 * all. A streak of zero is never "active" even at secondsSinceKill 0 -- there is nothing to show a
 * meter for before the first kill of a run.
 */
export function streakStillActive(state) {
  return state.streak > 0 && (state.secondsSinceKill ?? Infinity) <= STREAK_WINDOW_SECONDS;
}

/**
 * The coin multiplier a streak count earns: x1 below STREAK_TIER_2_KILLS, x2 from there to just
 * below STREAK_TIER_3_KILLS, x3 at STREAK_TIER_3_KILLS and beyond. A caller (world/enemyDrops.js's
 * own rollDropsForKill) applies this to the base coin COUNT a kill would otherwise drop, never to a
 * coin's own value -- every coin this game has ever dropped is worth exactly one, and a streak makes
 * more of them land rather than inventing a coin worth more than one.
 */
export function coinMultiplierForStreak(streak) {
  if (streak >= STREAK_TIER_3_KILLS) return 3;
  if (streak >= STREAK_TIER_2_KILLS) return 2;
  return 1;
}
