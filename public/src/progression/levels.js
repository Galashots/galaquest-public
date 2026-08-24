// THE XP -> HERO LEVEL LAW. One of it, for everybody.
//
// This module exists because of the specific failure docs/product/PROGRESSION_CONTRACT_V0.md was
// written to prevent: Hero levels, gear, pets, enemies and the kid-facing POWER number each
// inventing their own idea of how big a level is. A threshold restated in a HUD, a server check and
// a test is three laws that agree on the day they were typed (docs/MISTAKES.md GQ-007), and the
// first time one of them is re-tuned the game starts contradicting itself in front of a child --
// a level-up banner over a bar that is not full, a reward gate that disagrees with the number
// beside it.
//
// So: every caller that needs to know what a total XP means asks HERE, and nobody else computes it.
//
// Pure by the same discipline items.js and facts.js keep -- no DOM, no storage, no clock, no
// three.js -- because net/gameServer.mjs imports files under public/src/progression/ directly and
// anything here has to stay importable there.
//
// WHAT THIS IS NOT. P1 establishes the authority and its durability; it deliberately ships no
// player-facing level UI, no level-derived HP or damage, and no XP source. Those are P2 and later
// packages, and they must re-tune THIS file rather than add a second opinion beside it.

/** The floor. A hero who has earned nothing is Level 1, not Level 0 -- there is no state in which a
 *  child is shown a zero, and every caller can rely on that rather than clamping for itself. */
export const LEVEL_ONE = 1;

// ── THE CURVE, AS TUNABLE v0 DATA ──────────────────────────────────────────────────────────────
//
// Advancing from Level L to L+1 costs `BASE + STEP * (L - 1)`: 100, 150, 200, 250, ... so the first
// levels are quick and each one after costs a little more, which is the Owner decision the contract
// records ("early levels are deliberately fast; after Level 5 the curve begins lengthening").
//
// Linear-growth steps rather than geometric ON PURPOSE. A geometric curve reaches numbers a child
// cannot read and a float cannot hold within a couple of hundred levels; an arithmetic one keeps
// the cumulative total quadratic, which stays an exact safe integer into the millions of levels.
// That is what lets the contract's "no baked-in low technical cap" be true rather than aspirational.
//
// These two constants are the tuning surface. `docs/briefs/PROGRESSION_P1_XP_LEVEL_AUTHORITY.md` is
// explicit that P2/V1 may change them once authored-beat pacing has actually been measured. Changing
// them here changes the whole game at once, which is the entire point of the module.
export const BASE_XP_TO_ADVANCE = 100;
export const XP_TO_ADVANCE_STEP = 50;

function assertLevel(level) {
  if (!Number.isSafeInteger(level) || level < LEVEL_ONE) {
    throw new TypeError(`level must be a safe integer >= ${LEVEL_ONE}, got ${JSON.stringify(level)}`);
  }
  return level;
}

/**
 * Is this a total XP a hero could actually have?
 *
 * Exported as a predicate as well as being enforced below, because the callers that need to REFUSE
 * bad input (a decode boundary, a store write) want to answer without catching an exception, and the
 * callers that need an answer want the throw. One rule, two shapes.
 *
 * Zero is valid: a hero who has earned nothing has earned nothing. Negative, fractional, infinite,
 * NaN, and anything past exact integer representation are not totals -- they are corruption wearing
 * a number's clothes, and normalising them into Level 1 would turn a broken journal into a plausible
 * hero that nobody would ever think to look at.
 */
export function isValidTotalXp(totalXp) {
  return Number.isSafeInteger(totalXp) && totalXp >= 0;
}

function assertTotalXp(totalXp) {
  if (!isValidTotalXp(totalXp)) {
    throw new TypeError(`total xp must be a safe integer >= 0, got ${JSON.stringify(totalXp)}`);
  }
  return totalXp;
}

/** What advancing FROM `level` to the next one costs. The curve itself, in one line. */
export function xpToAdvanceFrom(level) {
  assertLevel(level);
  return BASE_XP_TO_ADVANCE + XP_TO_ADVANCE_STEP * (level - 1);
}

/**
 * The cumulative XP at which `level` BEGINS.
 *
 * Closed form rather than a loop, because the loop is O(level) and this is called with 1000 in the
 * tests and could be called with anything at all by a future caller:
 *
 *     sum(i = 1 .. L-1) of (BASE + STEP*(i-1))
 *   = BASE*(L-1) + STEP*(L-1)(L-2)/2
 *
 * With BASE 100 and STEP 50 that collapses to 25*(L-1)*(L+2), but it is written out in terms of the
 * constants above rather than as the collapsed literal -- a hard-coded 25 would be a number that
 * only happens to satisfy a relationship, which is the version of GQ-007 that hides best (hit 6:
 * "a constant DERIVED from other modules' numbers is the same defect wearing a hat"). Re-tune the
 * two constants and this stays correct; re-tune them against a collapsed literal and it silently
 * does not.
 *
 * Integer-exact for every level whose result is a safe integer: (L-1)(L-2) is always even, so the
 * halving never introduces a fraction.
 */
export function cumulativeXpForLevel(level) {
  assertLevel(level);
  const advanced = level - 1;
  return BASE_XP_TO_ADVANCE * advanced + (XP_TO_ADVANCE_STEP * advanced * (advanced - 1)) / 2;
}

/**
 * The level a total XP has reached.
 *
 * Seeded from the closed-form inverse of the quadratic above and then CORRECTED with exact integer
 * comparisons. The correction is not defensive decoration: `Math.sqrt` is exact only for perfect
 * squares, so the seed drifts by one at large totals long before Number.MAX_SAFE_INTEGER does, and
 * an off-by-one here is a child being shown the wrong level. Seeding makes it O(1); correcting makes
 * it right. Neither alone is both.
 *
 * Solving BASE*a + STEP*a*(a-1)/2 <= xp for a = level - 1 gives
 *     a <= (-(2*BASE - STEP) + sqrt((2*BASE - STEP)^2 + 8*STEP*xp)) / (2*STEP)
 */
export function levelForXp(totalXp) {
  assertTotalXp(totalXp);
  const b = 2 * BASE_XP_TO_ADVANCE - XP_TO_ADVANCE_STEP;
  const seed = (-b + Math.sqrt(b * b + 8 * XP_TO_ADVANCE_STEP * totalXp)) / (2 * XP_TO_ADVANCE_STEP);
  let level = Math.max(LEVEL_ONE, Math.floor(seed) + 1);
  // Two exact walks, each of which normally runs zero times.
  while (level > LEVEL_ONE && cumulativeXpForLevel(level) > totalXp) level -= 1;
  while (cumulativeXpForLevel(level + 1) <= totalXp) level += 1;
  return level;
}

/**
 * Everything a caller could want to know about where a hero stands, from one call.
 *
 * One call rather than six exported helpers because six helpers is six chances for a caller to
 * combine them slightly differently -- the HUD taking its numerator from one and its denominator
 * from another is exactly how a progress bar ends up disagreeing with the level printed next to it.
 * The fields here are guaranteed consistent with each other:
 *
 *     xpIntoLevel + xpToNextLevel === xpForLevel
 *     progress === xpIntoLevel / xpForLevel, always in [0, 1)
 *
 * `progress` is normalised for presentation and is the ONLY float here; every other field is an
 * exact integer, so nothing that needs to be counted is ever read off a rounded number.
 */
export function levelStateForXp(totalXp) {
  assertTotalXp(totalXp);
  const level = levelForXp(totalXp);
  const levelStartXp = cumulativeXpForLevel(level);
  const nextLevelXp = cumulativeXpForLevel(level + 1);
  const xpForLevel = nextLevelXp - levelStartXp;
  const xpIntoLevel = totalXp - levelStartXp;
  return {
    level,
    totalXp,
    levelStartXp,
    nextLevelXp,
    xpForLevel,
    xpIntoLevel,
    xpToNextLevel: xpForLevel - xpIntoLevel,
    progress: xpIntoLevel / xpForLevel,
  };
}
