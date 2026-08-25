// WHAT A HERO IS, AT A LEVEL, HOLDING A WEAPON. One of it, for everybody.
//
// progression/levels.js answers "what level is this total XP". This file answers the question
// immediately after it -- "so how big is this body and how hard does it hit" -- and it exists for
// the same reason levels.js does. Before P2 the answer was three unrelated constants: encounter.js
// held a 3hp hero, items.js held a 1-damage sword, and net/gameServer.mjs held a charm worth one
// heart. None of them knew a level existed, so "every Hero level grants more maximum HP and more
// Hero damage" (docs/product/PROGRESSION_CONTRACT_V0.md, OWNER-LOCKED) had nowhere to be written
// down without being written down three times.
//
// So: every caller that needs to know how strong a hero actually is asks HERE, and nobody else
// computes it. The server does it for the online fight, main.js does it for the offline one, the
// Hero screen does it for its card, and progression/power.js does it for the number a child brags
// about -- one law, four readers.
//
// Pure by the same discipline levels.js, items.js and facts.js keep -- no DOM, no storage, no
// clock, no three.js -- because net/gameServer.mjs imports files under public/src/progression/
// directly and anything here has to stay importable there.
//
// ── WHY THE TWO BASELINES ARE IMPORTED RATHER THAN TYPED ────────────────────────────────────────
//
// A Level-1 hero with the starter sword is the benchmark this whole file (and all of power.js) is
// measured against, so the two numbers that define it must be the SAME numbers the fight and the
// catalogue actually use, not a copy that agreed on the day it was typed (docs/MISTAKES.md GQ-007,
// and specifically hit 6: "a constant DERIVED from other modules' numbers is the same defect
// wearing a hat").
//
//   - The BODY comes from public/src/combat/encounter.js. That module may import nothing outside
//     combat/ (test/combat-purity.test.mjs enforces it in as many words), so it cannot import this
//     one, which means the dependency has to point this way: the rules layer owns the neutral body
//     it falls back to, and progression names that body "Level 1". world/beaconSiege.js already
//     imports HERO_MAX_HP for exactly this reason; this is the same edge, not a new one.
//   - The WEAPON comes from progression/items.js, which the P2 brief names as the authority for
//     item-specific damage. The starter sword is the floor a hero swings with, so it is also the
//     denominator every POWER comparison is taken against.
//
// The one relationship neither import can express -- that the rules layer's own no-weapon-named
// fallback is worth exactly what the starter sword is worth -- is pinned by
// test/progression-hero-stats.test.mjs rather than left to a comment, per GQ-007's "derive it, or
// pin the relationship in a test. Prose in a comment is neither."

import { HERO_MAX_HP } from '../combat/encounter.js';
import {
  DEFAULT_EQUIPPED_ITEM_IDS,
  DEFAULT_EQUIPPED_WEAPON_ID,
  STARTER_SWORD_ID,
  damageReductionPercentFor,
  swingDamageFor,
} from './items.js';
import { LEVEL_ONE, levelStateForXp } from './levels.js';

/** The body a hero has at Level 1, before any level, charm or other durable bonus. THE SAME NUMBER
 *  the fight falls back to when nobody has told it otherwise -- see this file's header for why the
 *  import points this way rather than the other. */
export const LEVEL_1_BASE_MAX_HP = HERO_MAX_HP;

/** What one blow from a Level-1 hero with the starter sword is worth. The denominator of the POWER
 *  benchmark, read off the catalogue that owns it rather than restated (GQ-007). */
export const LEVEL_1_STARTER_DAMAGE = swingDamageFor(STARTER_SWORD_ID);

// ── THE PER-LEVEL GRANTS, AS TUNABLE v0 DATA ───────────────────────────────────────────────────
//
// Both are OWNER-LOCKED in kind and V0 in amount: the contract fixes that every level grants more
// max HP AND more damage, and `docs/briefs/PROGRESSION_P2_FIRST_HERO_LEVEL_UP.md` fixes these two
// numbers as P2's starting tuning. V1 may re-tune them once the opening's authored beats have
// actually been measured; nothing else in the game may.
//
// Additive rather than multiplicative ON PURPOSE, for the reason levels.js gives for choosing an
// arithmetic XP curve over a geometric one: a hero at Level 1000 has 5,025 max HP and 2,008 damage,
// numbers that are still exact integers and still fit in a HUD. A percentage-per-level curve
// reaches values a child cannot read and a float cannot hold inside the "no baked-in low technical
// cap" range the contract requires the architecture to survive.
export const MAX_HP_PER_LEVEL = 5;
export const HERO_DAMAGE_PER_LEVEL = 2;

/**
 * Ranger Wren's charm, on the P2 combat scale.
 *
 * It was `CHARM_BONUS_HEARTS = 1` in net/gameServer.mjs, against a three-heart body: one more
 * mistake before going down, a third again as much body. P2 rescales the fight from a hit counter
 * to integers, and this number is what PRESERVES that established meaning rather than reinventing
 * it -- 10 of a 30hp body is the same third. The brief states the same value; the invariant it has
 * to satisfy (a charmed Level-1 hero survives one more Wolf bite than an uncharmed one) is pinned
 * in test/progression-hero-stats.test.mjs.
 *
 * It lives HERE rather than in the server because a charm is a durable fact about a BODY, and the
 * offline fallback in main.js has to resolve the same body from the same law -- which is exactly
 * the split that let the server own it while nothing else could see it.
 */
export const WREN_CHARM_MAX_HP_BONUS = 10;

function assertLevel(level) {
  if (!Number.isSafeInteger(level) || level < LEVEL_ONE) {
    throw new TypeError(`level must be a safe integer >= ${LEVEL_ONE}, got ${JSON.stringify(level)}`);
  }
  return level;
}

/**
 * Refuse a result that has stopped being countable.
 *
 * levels.js refuses a total XP that is not a safe integer rather than normalising it, on the
 * grounds that "corruption wearing a number's clothes" must not resolve into a plausible hero. The
 * same argument applies at the far end: a level large enough that 30 + 5*(L-1) leaves exact integer
 * range would return a max HP that silently stops being the number it prints. The contract only
 * asks that behaviour past the balanced band stay "finite, monotone, and representable"; this is
 * where representable is enforced instead of assumed.
 */
function assertRepresentable(value, what, level) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} for level ${level} is not an exact integer (${value})`);
  }
  return value;
}

/** The body a hero has at `level`, before charm or any other durable bonus. */
export function maxHpForLevel(level) {
  assertLevel(level);
  return assertRepresentable(
    LEVEL_1_BASE_MAX_HP + MAX_HP_PER_LEVEL * (level - LEVEL_ONE), 'max hp', level,
  );
}

/**
 * The body a hero actually has: their level's, plus whatever durable bonuses they carry.
 *
 * `charmOwned` is the only bonus today. It is a named option rather than a positional number so
 * that armour (G1/G2's package, explicitly out of P2 scope) adds a field here instead of adding a
 * second function beside this one.
 *
 * @param level       the Hero level, from progression/levels.js. Never derived here.
 * @param bonuses.charmOwned  whether Ranger Wren has given this child her charm.
 */
export function resolvedMaxHp(level, { charmOwned = false } = {}) {
  return maxHpForLevel(level) + (charmOwned ? WREN_CHARM_MAX_HP_BONUS : 0);
}

/**
 * What one landed blow is worth: the weapon in the hand, plus what the levels added to the arm.
 *
 * THE ITEM HALF IS NOT COMPUTED HERE. `swingDamageFor` is progression/items.js's own seam and stays
 * the authority for what a given weapon is worth (including the "an unknown id is the starter
 * sword" floor); this only adds the part that is about the HERO. Two authorities, one for each
 * half of the sentence, and neither restates the other.
 *
 * @param level            the Hero level.
 * @param equippedWeaponId what they are holding. Unknown/absent resolves to the starter sword.
 */
export function resolvedHeroDamage(level, equippedWeaponId = DEFAULT_EQUIPPED_WEAPON_ID) {
  assertLevel(level);
  return assertRepresentable(
    swingDamageFor(equippedWeaponId) + HERO_DAMAGE_PER_LEVEL * (level - LEVEL_ONE), 'hero damage', level,
  );
}

/** Resolve the one canonical defensive stat from what is EQUIPPED, never from ownership. */
export function damageReductionPercentForEquipment(equippedItemIds = DEFAULT_EQUIPPED_ITEM_IDS) {
  const values = equippedItemIds && typeof equippedItemIds === 'object'
    ? Object.values(equippedItemIds)
    : [];
  const reduction = values.reduce((total, itemId) => total + damageReductionPercentFor(itemId), 0);
  if (!Number.isFinite(reduction) || reduction < 0 || reduction >= 100) {
    throw new TypeError(`damageReductionPercent must be finite and in [0, 100), got ${reduction}`);
  }
  return reduction;
}

/**
 * EVERYTHING about how strong a hero is, from one call, off their durable state.
 *
 * One call rather than three exported helpers for exactly the reason levels.js gives for
 * levelStateForXp: three helpers is three chances for a caller to combine them slightly
 * differently, and a fight that reads its damage from one place and its body from another is how
 * the online and offline hero end up being different heroes. Every field below is guaranteed
 * consistent with every other, and with the `level` reported beside them.
 *
 * DELIBERATELY DOES NOT RETURN POWER. Real stats come first and POWER is derived from them
 * afterwards (docs/product/PROGRESSION_CONTRACT_V0.md, POWER invariant 1) -- so progression/power.js
 * imports this module and never the other way round, and no caller can accidentally read a display
 * number back into the fight.
 *
 * @param state.totalXp          the folded durable XP total (progression/facts.js's foldFacts).
 * @param state.equippedWeaponId compatibility weapon field.
 * @param state.equippedItemIds current item per slot.
 * @param state.charmOwned       whether they carry Wren's charm.
 */
export function resolveHeroStats({
  totalXp = 0,
  equippedWeaponId,
  equippedItemIds = DEFAULT_EQUIPPED_ITEM_IDS,
  charmOwned = false,
} = {}) {
  // Through the P1 authority, never re-derived. levelStateForXp also refuses a malformed total,
  // which is the check this function would otherwise have to invent a second copy of.
  const levelState = levelStateForXp(totalXp);
  const resolvedWeaponId = equippedWeaponId ?? equippedItemIds?.weapon ?? DEFAULT_EQUIPPED_WEAPON_ID;
  const resolvedEquipment = {
    ...DEFAULT_EQUIPPED_ITEM_IDS,
    ...(equippedItemIds ?? {}),
    weapon: resolvedWeaponId,
  };
  return {
    level: levelState.level,
    levelState,
    maxHp: resolvedMaxHp(levelState.level, { charmOwned }),
    heroDamage: resolvedHeroDamage(levelState.level, resolvedWeaponId),
    damageReductionPercent: damageReductionPercentForEquipment(resolvedEquipment),
    equippedItemIds: resolvedEquipment,
  };
}

/**
 * WHETHER A LEVEL A PRESENTER IS ABOUT TO SHOW DESERVES A CEREMONY.
 *
 * Pure state machine, exactly the shape world/zoneLoader.js's treeLitTransition already uses and for
 * the same reason: WHETHER the one-shot beat runs is a rule, and a rule belongs somewhere it can be
 * proved with no browser in the room. What the beat looks like is taste, judged in captures.
 *
 * THE `null` CASE IS THE WHOLE POINT. `docs/MISTAKES.md`: "Hydration restores state; it must not
 * replay the ceremony that created it." A hero's level is folded from durable facts, so the FIRST
 * frame of every session already knows it -- from the local journal, from a server welcome, from a
 * reconnect to a store that has just been taught the child's own facts back. A presenter that
 * treated "I did not know, now I do" as a rise would fire a LEVEL UP at a child every time they
 * opened the game, for something they did last week. So a caller that has not yet seen a level
 * ADOPTS it silently, and only a rise observed inside one live session is a transition.
 *
 * A FALL is adopted silently too. Nothing in the game can lower a level -- death costs no XP by
 * explicit Owner decision -- so this is not a case that occurs; it is two words that guarantee a
 * corrupted or rolled-back total can never leave the presenter stuck above the hero it is drawing,
 * silently disagreeing with the meter beside it.
 *
 * @param seenLevel the level this presenter last showed, or null/undefined if it has shown none.
 * @param nextLevel the level the hero is at now.
 */
export function levelUpTransition(seenLevel, nextLevel) {
  assertLevel(nextLevel);
  const hydrating = !Number.isSafeInteger(seenLevel);
  return {
    celebrate: !hydrating && nextLevel > seenLevel,
    from: hydrating ? null : seenLevel,
    to: nextLevel,
  };
}

/** The Level-1 starter benchmark every POWER comparison is taken against, as a stats object of the
 *  same shape resolveHeroStats returns -- so power.js's benchmark and a real hero's stats are the
 *  same kind of thing rather than two shapes that have to be kept in step by hand. */
export const LEVEL_1_STARTER_STATS = Object.freeze({
  maxHp: LEVEL_1_BASE_MAX_HP,
  heroDamage: LEVEL_1_STARTER_DAMAGE,
  damageReductionPercent: 0,
});
