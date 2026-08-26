// THE ONE COMBAT-XP LAW. Pure, and imported by both sides of the online/offline split rather than
// restated on either -- see net/gameServerCore.mjs's createRewardCoordinator (the server adjudicator)
// and rewards/offlineProgress.js (the local-first fallback). Neither of those two knows the other
// exists; both ask HERE what a kill is worth, which is what makes "the offline path produces the same
// logical result as the server" true by construction rather than by two implementations somebody has
// to keep in step (docs/MISTAKES.md GQ-007 hit 7 -- "a rule with two implementations is a constant
// with two copies").
//
// Pure by the discipline rewards/marks.js, progression/facts.js and progression/levels.js all keep:
// no DOM, no storage, no clock, no three.js, no Math.random. This module in particular must never read
// POWER, a hero's own current-level requirement, or an XP total -- the brief's reward-basis invariant
// is that combat XP is priced off the ENEMY's content level and the level GAP alone, never off how
// strong the fight already made this hero look. test/progression-r1-c1.test.mjs pins that by scanning
// this file's own source for a power.js import, the same technique test/combat-purity.test.mjs uses
// against public/src/combat/.
//
// WHAT THIS FILE DOES NOT DECIDE: whether a kill happened, who contributed, or which enemy died --
// rewards/marks.js's foldEvents still owns all three, off combat/encounter.js's own events. This file
// only prices an already-decided award, which is why it takes `{ heroLevel, enemyLevel }` rather than
// a hero id or a raw event.

import { LEVEL_ONE } from '../progression/levels.js';
// Read for its DATA only -- the canonical authored enemy-level table (E2), never a rule or a random
// seam. This is the direction progression/heroStats.js already reads combat/encounter.js's own
// HERO_MAX_HP: test/combat-purity.test.mjs's ban is on what combat/ may import, never on who may read
// combat/'s own pure data back out. See MAX_COMBAT_XP_PER_KILL below for the one thing this file
// needs it for.
import { WOLF_LEVEL_STATS } from '../combat/enemyStats.js';
// R1-C2: the catalogue's OWN derived eligible-id list, read for data only -- exactly the same
// "authority owns the data, this file only prices/decides against it" relationship this file already
// has with WOLF_LEVEL_STATS above. items.js decides what CAN ever be an ordinary drop (currently
// nothing); this file decides WHETHER one is granted this kill, never which items exist.
import { ORDINARY_DROP_ITEM_IDS } from '../progression/items.js';

function assertLevel(level, name) {
  if (!Number.isSafeInteger(level) || level < LEVEL_ONE) {
    throw new TypeError(`${name} must be a safe integer >= ${LEVEL_ONE}, got ${JSON.stringify(level)}`);
  }
  return level;
}

// ── BASE XP BY ENEMY CONTENT LEVEL, AS TUNABLE V0 DATA ─────────────────────────────────────────────
//
// docs/briefs/PROGRESSION_R1_COMBAT_XP_LOOT_REWARD_SEAM.md names this the R1 starting tuning target,
// not an Owner-locked law -- re-tunable with beat-budget evidence, the same posture levels.js's own
// curve constants take. It is a function of the ENEMY's own authored level (E2: five stable ordinary
// Wolves, levels 1/1/2/2/4) and nothing about the hero, so a harder authored enemy is worth more before
// the gap modifier below ever runs.
export const BASE_COMBAT_XP = 10;
export const COMBAT_XP_PER_ENEMY_LEVEL = 5;

/** What a kill of this enemy level is worth before the Hero/enemy gap is applied. */
export function baseCombatXp(enemyLevel) {
  assertLevel(enemyLevel, 'enemyLevel');
  return BASE_COMBAT_XP + COMBAT_XP_PER_ENEMY_LEVEL * enemyLevel;
}

// ── THE HERO/ENEMY LEVEL-GAP MODIFIER, AS A TABLE RATHER THAN A CHAIN OF LITERALS ──────────────────
//
// `gap = heroLevel - enemyLevel`. Outleveled content pays MORE (a Level-1 hero meeting a Level-4 Wolf
// early), even content pays full, and content the hero has grown well past pays LESS and then nothing
// -- "old enemies remain fixed-level and eventually become trivial", not a permanently viable grind.
//
// Written as data plus a lookup rather than an if/else chain of the same six numbers, so a future
// reader (or test) can enumerate the whole law by reading LEVEL_GAP_MULTIPLIERS once, and so
// ZERO_REWARD_LEVEL_GAP below is DERIVED from the table's own highest tabled gap rather than typed as
// a second fact that could quietly stop matching it (GQ-007).
export const LEVEL_GAP_MULTIPLIERS = Object.freeze([
  Object.freeze({ gap: -2, multiplier: 1.25 }), // and every gap below -2
  Object.freeze({ gap: -1, multiplier: 1.10 }),
  Object.freeze({ gap: 0, multiplier: 1.00 }),
  Object.freeze({ gap: 1, multiplier: 0.60 }),
  Object.freeze({ gap: 2, multiplier: 0.25 }),
]);

const LOWEST_TABLED_GAP = LEVEL_GAP_MULTIPLIERS[0].gap;
const MULTIPLIER_BY_GAP = new Map(LEVEL_GAP_MULTIPLIERS.map((entry) => [entry.gap, entry.multiplier]));

/** One past the table's own highest tabled gap: every gap from here on is not diminishing any more,
 *  it is zero -- the bounded finite point the brief requires so no amount of outleveled grinding is
 *  ever the optimal way to level. */
export const ZERO_REWARD_LEVEL_GAP = LEVEL_GAP_MULTIPLIERS[LEVEL_GAP_MULTIPLIERS.length - 1].gap + 1;

/** The gap multiplier for `heroLevel - enemyLevel`. A gap below the table's lowest tabled entry
 *  clamps to that entry (content this far outleveled-the-other-way does not keep paying MORE forever);
 *  a gap at or past ZERO_REWARD_LEVEL_GAP is exactly zero. */
export function levelGapMultiplier(gap) {
  if (!Number.isSafeInteger(gap)) {
    throw new TypeError(`level gap must be a safe integer, got ${JSON.stringify(gap)}`);
  }
  if (gap >= ZERO_REWARD_LEVEL_GAP) return 0;
  return MULTIPLIER_BY_GAP.get(Math.max(gap, LOWEST_TABLED_GAP));
}

/**
 * THE AWARD, for one hero killing one enemy. Never reads POWER, an XP total, or a kill count --
 * only the two levels the brief's reward-basis invariant names.
 *
 * ONE rounding site, right here, so "how much XP did this kill pay" has exactly one answer regardless
 * of which caller asks. Clamped at 0 rather than trusting the multiplier table to never go negative,
 * because a clamp that is never exercised costs nothing and a reward law that CAN mint negative XP is
 * a reward law that can run progression backwards (progression/facts.js's parseXpFactAmount pins the
 * same worry one layer downstream, at the point a fact is about to become durable).
 */
export function combatXpFor({ heroLevel, enemyLevel }) {
  assertLevel(heroLevel, 'heroLevel');
  assertLevel(enemyLevel, 'enemyLevel');
  const gap = heroLevel - enemyLevel;
  const amount = Math.round(baseCombatXp(enemyLevel) * levelGapMultiplier(gap));
  return Math.max(0, amount);
}

/**
 * THE DURABLE NAME for one profile's combat-XP fact from one enemy life.
 *
 * `profileId` is the owning identity (a guestId online, a local profileId offline) and `lifeId` is the
 * enemy-life identity rewards/marks.js already mints once per defeat -- the SAME lifeId the paired
 * mark-earned award carries, so a combat-XP fact and its mark can always be traced back to the one
 * kill that earned them both without either module knowing about the other.
 *
 * Nothing MUTABLE rides in this name (docs/MISTAKES.md GQ-014): not an XP total, not a kill count, not
 * a wall-clock timestamp. `lifeId` is minted once, at the moment of the kill, and never recomputed --
 * see marks.js's own header for why a life INDEX or a store-read COUNT both failed this exact test
 * before landing on that design.
 */
export function combatXpEventId(profileId, lifeId) {
  return `xp:combat:${profileId}:${lifeId}`;
}

// ── THE CEILING: what any single supported kill can ever be worth ─────────────────────────────────
//
// Adding `xp:combat:` to progression/facts.js's PROFILE_SCOPED_EVENT_ID_PREFIXES lets a profile's own
// client restore claim `xp:combat:<itself>:<any lifeId it invents>` -- unlike the Lantern's single
// latch identity, a lifeId is not enumerable ahead of time, so net/gameServerCore.mjs's
// restoreProfileFacts cannot refuse a forged one by name. What it CAN refuse is an amount no real kill
// could ever have produced: parseXpFactAmount already bounds the SHAPE (a canonical positive integer);
// this bounds the VALUE.
//
// DERIVED, never typed (GQ-007): the true ceiling is what LEVEL_ONE -- the lowest legal hero level,
// and combatXpFor is non-increasing as hero level rises, so LEVEL_ONE always maximizes the award for
// a fixed enemy level -- earns from the single HIGHEST-paying enemy level combat/enemyStats.js's own
// table currently authors. Read the table rather than restate its levels here: E2 owns which enemy
// levels exist at all, and a future authored level (a Level-6 Wolf, a new archetype) raises this
// ceiling automatically rather than silently staying stale beside a hand-typed number.
export const MAX_COMBAT_XP_PER_KILL = Math.max(
  ...Object.values(WOLF_LEVEL_STATS).map(
    (stats) => combatXpFor({ heroLevel: LEVEL_ONE, enemyLevel: stats.level }),
  ),
);

// ── R1-C2: THE ORDINARY-DROP DECISION -- MECHANISM, NOT CONTENT ────────────────────────────────────
//
// The starting per-distinct-eligible-profile, per-defeated-enemy-life chance
// docs/briefs/PROGRESSION_R1_COMBAT_XP_LOOT_REWARD_SEAM.md names as V0 tuning. Re-tunable with
// rationale the same way BASE_COMBAT_XP is; not Owner-locked.
export const ORDINARY_DROP_CHANCE = 0.1;

/**
 * The unowned subset of `catalogue` this profile could still be granted -- eligibility, computed
 * BEFORE any chance roll ever happens, per the brief's own ordering ("determine the profile's
 * eligible unowned ordinary-drop items first"). Owned items are never re-promised; there is nothing
 * else this function is for.
 *
 * SORTED, deliberately: `catalogue` is authored order (object insertion order via
 * `Object.values(ITEM_DEFS)`, indirectly), which is stable but not itself a meaningful sequence for
 * selection. Sorting makes `decideCombatReward`'s `Math.floor(random() * eligible.length)` index into
 * the SAME array regardless of catalogue insertion order or Set/Map iteration quirks -- i.e.
 * deterministic given the same ownedItemIds and the same injected random stream, which is what makes
 * the fixture-proof path in test/progression-r1-c2.test.mjs reproducible at all.
 */
export function eligibleOrdinaryDropItemIds(ownedItemIds, catalogue = ORDINARY_DROP_ITEM_IDS) {
  const owned = new Set(ownedItemIds);
  return catalogue.filter((itemId) => !owned.has(itemId)).sort();
}

/**
 * ONE combat reward decision -- the XP this kill is worth (combatXpFor, unchanged from C1) PLUS
 * whether it also grants gear ownership. Pure: `random` is injected (never `Math.random` called
 * directly, see the structural test below), `catalogue` is injected (so the gear branch is provable
 * by fixture without R1 shipping fake production content), and nothing here writes anything --
 * callers (net/gameServerCore.mjs's createRewardCoordinator, rewards/offlineProgress.js) decide what
 * to do with the returned `{ xp, gearItemId }`.
 *
 * THE ORDER IS THE CONTRACT, and it is enforced by the shape of this function, not merely documented:
 *   1. eligibility first (`eligibleOrdinaryDropItemIds`);
 *   2. an EMPTY eligible set returns `gearItemId: null` immediately and calls `random` ZERO times --
 *      an honest suppression (no gear promise, ever, when nothing could legitimately be granted) that
 *      also keeps an injected RNG stream deterministic: a caller feeding a scripted sequence of
 *      random() values does not have to account for a draw that silently didn't happen;
 *   3. only once eligibility is known does the chance roll happen: `random() < chance`;
 *   4. only on success is a selection made: `eligible[Math.floor(random() * eligible.length)]`.
 * Selection is ownership-only -- this returns an itemId, never an equip fact; equipping remains the
 * existing G1 choice/equip law's job alone, and this function has no way to bypass it even if a
 * caller wanted to.
 */
export function decideCombatReward({
  heroLevel,
  enemyLevel,
  ownedItemIds,
  random,
  chance = ORDINARY_DROP_CHANCE,
  catalogue = ORDINARY_DROP_ITEM_IDS,
}) {
  const xp = combatXpFor({ heroLevel, enemyLevel });

  const eligible = eligibleOrdinaryDropItemIds(ownedItemIds, catalogue);
  if (eligible.length === 0) return { xp, gearItemId: null };

  if (random() < chance) {
    return { xp, gearItemId: eligible[Math.floor(random() * eligible.length)] };
  }
  return { xp, gearItemId: null };
}
