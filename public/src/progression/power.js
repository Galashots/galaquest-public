// THE NUMBER A CHILD BRAGS ABOUT. Derived from real strength, never an input to it.
//
// Issue #41 is explicit about both halves and they are easy to get backwards: POWER exists because
// "the intended players respond strongly to obvious strength and status", AND "real combat stats are
// calculated first; combat must not derive HP/damage from POWER". A single number that goes up is
// the whole point; a single number the fight reads back is the defect this file's direction of
// dependency exists to prevent. progression/heroStats.js knows nothing about this module, and
// test/progression-power.test.mjs scans the fight, the reward path and the persistence layer to
// prove none of them import it.
//
// Pure, like everything else under progression/ -- no DOM, no storage, no clock -- so the server,
// the client, the Hero screen and the level-up ceremony all read one answer.
//
// ── THE MODEL, AND WHAT IS PROVISIONAL ABOUT IT ────────────────────────────────────────────────
//
// Two steps, deliberately separated, because the contract treats them as different kinds of
// decision (docs/product/PROGRESSION_CONTRACT_V0.md section 5):
//
//   1. REAL STRENGTH -- a scalar in real-combat space. Generalised readiness is how long you last
//      TIMES how fast you end it, each measured against the fixed Level-1 starter benchmark. A
//      product rather than a sum because the two genuinely multiply: a hero with twice the body and
//      twice the blow does not survive four times as much punishment, they win a fight roughly four
//      times as decisively. It is also what makes the invariant free -- raise either factor without
//      lowering the other and the product cannot fall.
//
//   2. DISPLAY TRANSFORM -- `round(1000 * realStrength)`, which is exaggeration by scale only.
//      P2 deliberately uses a linear transform: the contract permits a monotone presentation
//      exponent to make growth more dramatic, and choosing one is a tuning decision that wants a
//      child in front of it, not a first implementation. The seam is here for when that happens;
//      the invariants below hold for any monotone transform, so swapping it cannot break them.
//
// The benchmark denominators are IMPORTED (GQ-007). A hand-typed 30 and 10 here would be a snapshot
// of a relationship rather than the relationship: re-tune the starter sword and this file would go
// on dividing by the sword it used to be, and every POWER in the game would quietly be wrong by a
// constant nobody could see.

import { LEVEL_1_BASE_MAX_HP, LEVEL_1_STARTER_DAMAGE } from './heroStats.js';

/**
 * How big the kid-facing number is relative to real strength.
 *
 * 1000 rather than 1 so that a Level-1 hero reads POWER 1,000 rather than POWER 1, and so the first
 * real level-up moves the number by 400 rather than by 0.4. Issue #41's own worked example is a
 * four-digit value; this is the constant that makes the game's first one land on it.
 */
export const POWER_DISPLAY_SCALE = 1000;

function assertStat(value, what) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${what} must be a finite number > 0 to derive POWER, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Generalised combat readiness in REAL-strength space, where 1 is the Level-1 starter benchmark.
 *
 * Exported separately from the display value because the contract measures the Hero/gear/pet
 * strength budget in this space and explicitly forbids reading contribution percentages back out of
 * the displayed number (POWER invariant 7). A later package comparing gear's share against the
 * Hero's has to divide these, not those.
 *
 * @param stats.maxHp      resolved max HP, from heroStats.resolveHeroStats.
 * @param stats.heroDamage resolved per-blow damage, from the same call.
 */
export function realStrengthFor({ maxHp, heroDamage }) {
  assertStat(maxHp, 'maxHp');
  assertStat(heroDamage, 'heroDamage');
  return (maxHp / LEVEL_1_BASE_MAX_HP) * (heroDamage / LEVEL_1_STARTER_DAMAGE);
}

/**
 * The POWER value itself: an exact non-negative integer, deterministic for the same stats.
 *
 * Rounded rather than floored so the transform is symmetric about the benchmark and a stat pair
 * that lands a hair under a round number does not display one lower than a child would read off
 * the same fight. The FULL value is what every comparison uses -- formatPower below is presentation
 * only, so a ceremony that shows "12.4K" still knows the 12,412 underneath it.
 */
export function powerFor(stats) {
  return Math.round(POWER_DISPLAY_SCALE * realStrengthFor(stats));
}

// ── THE FORMATTER ───────────────────────────────────────────────────────────────────────────────
//
// One of it, used by every surface that prints POWER, because the alternative is the HUD and the
// Hero screen disagreeing about the same hero the moment one of them grows a comma.
//
// The contract requires a defined compact form "once raw numbers exceed ordinary digit lengths",
// and the reason is a real number rather than a style preference: a Level-1000 hero's POWER is
// 33,634,000, and eight digits in a HUD pill on a phone is a digit wall, not a readout.

/** Below this, the number is printed in full with thousands separators; at and above it, compacted.
 *  10,000 because four digits still read instantly ("1,400", "9,999") and five have started to be a
 *  shape rather than a value. */
export const POWER_COMPACT_FROM = 10_000;

// Deliberately not toLocaleString: its grouping and separator depend on the runtime's locale, so the
// same hero would print differently on two devices and a test could pass on one machine and fail on
// another. This is the one thing about presentation that has to be identical everywhere.
function groupThousands(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const COMPACT_UNITS = Object.freeze(['K', 'M', 'B', 'T', 'Qa', 'Qi']);

/**
 * POWER as a child reads it. `1,400`, `12.4K`, `3.2M`.
 *
 * One decimal below 100 of a unit and none above, so the compact form always carries three
 * significant figures and never four -- `12.4K` and `124K` are the same width to a glance, which is
 * what stops the HUD pill from resizing as a hero levels. A trailing `.0` is dropped (`20K`, not
 * `20.0K`) because it is a digit that says nothing.
 *
 * Past the last named unit -- which needs a level in the billions and cannot arise from play --
 * exponential notation, so the function is total: there is no input for which this returns
 * something unbounded, which is the "finite and representable" half of the contract's
 * outside-the-balanced-band requirement.
 */
export function formatPower(power) {
  if (!Number.isFinite(power)) return '—';
  const value = Math.max(0, Math.round(power));
  if (value < POWER_COMPACT_FROM) return groupThousands(value);

  let scaled = value;
  let unit = -1;
  while (scaled >= 1000 && unit < COMPACT_UNITS.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  if (scaled >= 1000) return value.toExponential(1);

  const text = scaled.toFixed(scaled < 100 ? 1 : 0);
  return `${text.endsWith('.0') ? text.slice(0, -2) : text}${COMPACT_UNITS[unit]}`;
}

/**
 * The before -> delta -> after shape both #41 and the P2 brief name for a POWER change.
 *
 * A tiny helper rather than three call sites building the same three strings, because the delta's
 * SIGN is the part that is easy to get subtly wrong: a sidegrade that lowers POWER is a legitimate
 * outcome the contract explicitly protects ("an item that improves one stat but reduces overall
 * POWER is a legitimate sidegrade"), so this must be able to say `-160` rather than assuming every
 * change is a gain.
 */
export function powerChange(beforePower, afterPower) {
  const delta = afterPower - beforePower;
  return {
    before: beforePower,
    after: afterPower,
    delta,
    beforeText: formatPower(beforePower),
    afterText: formatPower(afterPower),
    deltaText: `${delta < 0 ? '-' : '+'}${formatPower(Math.abs(delta))}`,
  };
}
