// IS THIS BETTER THAN WHAT I AM WEARING? -- the whole answer, computed once, for a child.
//
// #88 asks the compare treatment to show "the small number of actual meaningful stats", "current
// item versus selected item", "green/red stat deltas where appropriate", and a "truthful POWER
// comparison/delta". PROGRESSION_CONTRACT_V0 section 5 adds the rule that is easy to get wrong and
// expensive to get wrong: an item that raises one stat while lowering generalised readiness is a
// legitimate SIDEGRADE, and "the UI should not label it as strictly better merely because one stat
// rose".
//
// That rule is the reason this file exists instead of the arithmetic living in the DOM binder. A
// verdict a child reads as "yes, put it on" is a product claim, and a product claim belongs
// somewhere `node --test` can interrogate it without a browser. progression/heroScreen.js's DOM half
// now paints what this returns and decides none of it.
//
// PURE, like every neighbour under progression/: no DOM, no three.js, no clock, no I/O.
//
// ── THE DIRECTION OF DEPENDENCY, RESTATED BECAUSE THIS IS WHERE IT WOULD BREAK ─────────────────
//
// Real stats first, POWER afterwards (#41 invariant 1). This module resolves the hero's REAL stats
// for the candidate loadout through progression/heroStats.js -- the same call the fight is fed from
// -- and only then maps them through progression/power.js. Nothing here reads POWER and turns it
// back into a stat, and nothing outside presentation reads this module at all.
//
// The comparison holds the BODY STILL and moves ONE SLOT. That is not a shortcut, it is the
// question: "what would wearing this do", not "what would being a different hero do". Swapping only
// the candidate's slot into the equipped map and re-resolving is the same law the acquisition
// ceremony in main.js already uses, so the two cannot promise different numbers for the same swap.

import { WEAPON_SLOT, damageFor, itemDef } from './items.js';
import { damageReductionPercentForEquipment, resolvedHeroDamage } from './heroStats.js';
import { formatPower, powerChange, powerFor } from './power.js';
import { rarityFor, rarityLabelFor, rarityRankFor, itemIconSvgFor, itemIconUrlFor } from './itemArt.js';

/** The four verdicts a comparison can reach. Strings rather than a boolean, because "is it better"
 *  has four honest answers and a boolean can only carry two of them -- which is exactly how a
 *  sidegrade gets mislabelled as an upgrade. */
export const VERDICT_UPGRADE = 'upgrade';
export const VERDICT_SIDEGRADE = 'sidegrade';
export const VERDICT_DOWNGRADE = 'downgrade';
export const VERDICT_EQUIPPED = 'equipped';

/** What a child is told, per verdict. Short on purpose: this sits under a large item portrait, and
 *  a sentence there is a wall. */
export const VERDICT_LABELS = Object.freeze({
  [VERDICT_UPGRADE]: 'BETTER',
  [VERDICT_SIDEGRADE]: 'DIFFERENT',
  [VERDICT_DOWNGRADE]: 'WEAKER',
  [VERDICT_EQUIPPED]: 'WEARING IT',
});

/**
 * The two stats early gear is allowed to have, in the order they are shown.
 *
 * The contract caps early items at "no more than two simple stats" (section 6, OWNER-LOCKED), and
 * this is that cap made structural rather than remembered: a row exists only for a stat one of the
 * two items actually carries, so a helmet does not print "DAMAGE 0" and a sword does not print
 * "DAMAGE REDUCTION 0%". A third stat added to items.js without being added here simply does not
 * appear, which fails loudly in test/gear-compare.test.mjs rather than quietly shipping a card that
 * hides half an item.
 *
 * `higherIsBetter` is per stat rather than assumed, because the day an item carries a cost-shaped
 * stat (weight, cooldown) the green/red arrow has to be able to point the other way. `format`
 * carries the unit so the DOM binder never has to know that one of these is a percentage.
 */
const STAT_SPECS = Object.freeze([
  Object.freeze({
    key: 'damage',
    label: 'DAMAGE',
    higherIsBetter: true,
    valueFor: (itemId) => damageFor(itemId),
    format: (value) => String(value),
  }),
  Object.freeze({
    key: 'damageReductionPercent',
    label: 'ARMOR',
    higherIsBetter: true,
    // damageReductionPercentFor answers 0 for "this item has no such stat", which is the right
    // answer for the ARITHMETIC and the wrong one for "should this row exist" -- so presence is
    // decided from the catalogue entry itself, and only the value comes from the resolver.
    valueFor: (itemId) => (itemDef(itemId)?.damageReductionPercent ?? null),
    format: (value) => `${value}%`,
  }),
]);

// ASCII hyphen, not a typographic minus, and deliberately: progression/power.js's own
// powerChange formats its delta with '-', and the two sit on adjacent lines of the same
// card. A U+2212 on the stat row beside a U+002D on the POWER row is one surface holding two
// opinions about what "negative" looks like -- and the typographically nicer one is the wrong
// one to keep, because power.js is the shared authority the ceremony and the HUD already read.
function signed(value) {
  return `${value < 0 ? '-' : '+'}${Math.abs(value)}`;
}

/**
 * One stat row: what the worn item has, what the candidate has, and which way that moves.
 *
 * `direction` is 'up' | 'down' | 'same' rather than a boolean isUpgrade, for the reason the verdict
 * is four-valued: a row that did not change is a real state and colouring it green would be a small
 * lie repeated on every card.
 */
function statRows(currentId, candidateId) {
  const rows = [];
  for (const spec of STAT_SPECS) {
    const current = currentId === null ? null : spec.valueFor(currentId);
    const candidate = spec.valueFor(candidateId);
    if (current === null && candidate === null) continue;
    const currentValue = current ?? 0;
    const candidateValue = candidate ?? 0;
    const delta = candidateValue - currentValue;
    const better = spec.higherIsBetter ? delta > 0 : delta < 0;
    const worse = spec.higherIsBetter ? delta < 0 : delta > 0;
    rows.push({
      key: spec.key,
      label: spec.label,
      currentValue,
      candidateValue,
      currentText: spec.format(currentValue),
      candidateText: spec.format(candidateValue),
      delta,
      deltaText: delta === 0 ? null : signed(delta) + (spec.key === 'damageReductionPercent' ? '%' : ''),
      direction: better ? 'up' : (worse ? 'down' : 'same'),
    });
  }
  return rows;
}

/**
 * Everything the compare treatment needs about ONE candidate item, against what is worn in its slot.
 *
 * @param options.candidateItemId  the item the child tapped.
 * @param options.equippedItemIds  the whole equipped-per-slot map (the same shape heroScreen and the
 *                                 fight read).
 * @param options.stats            the RESOLVED hero stats from heroStats.resolveHeroStats -- the
 *                                 same object the combat seam is fed. Optional: a caller with no
 *                                 hero yet gets `power: null` rather than an invented hero.
 * @returns null when the id is not a known item; a UI has nothing to compare and should draw nothing.
 */
export function gearComparison({ candidateItemId, equippedItemIds = {}, stats = null } = {}) {
  const candidate = itemDef(candidateItemId);
  if (candidate === null) return null;

  const currentId = equippedItemIds[candidate.slot] ?? null;
  const current = currentId === null ? null : itemDef(currentId);
  const isEquipped = currentId === candidate.id;

  // POWER, from real stats, for the loadout that would exist AFTER the swap. Null without a hero:
  // "we do not know yet" and "no change" are different statements and only one of them is true.
  let power = null;
  if (stats) {
    const before = powerFor(stats);
    const afterEquipped = { ...equippedItemIds, [candidate.slot]: candidate.id };
    const after = powerFor({
      maxHp: stats.maxHp,
      heroDamage: resolvedHeroDamage(stats.level, afterEquipped[WEAPON_SLOT]),
      damageReductionPercent: damageReductionPercentForEquipment(afterEquipped),
    });
    power = powerChange(before, after);
  }

  const rows = isEquipped ? [] : statRows(currentId, candidate.id);
  const verdict = gearVerdict({ isEquipped, rows, power });

  return {
    slot: candidate.slot,
    candidate: {
      id: candidate.id,
      name: candidate.name,
      rarity: rarityFor(candidate.id),
      rarityRank: rarityRankFor(candidate.id),
      rarityLabel: rarityLabelFor(candidate.id),
      iconUrl: itemIconUrlFor(candidate.id),
      iconSvg: itemIconSvgFor(candidate.id),
    },
    // Null when the slot is empty -- "you are wearing nothing here" is a first-fill, and a card that
    // invented a 0-stat phantom item to compare against would make every first-fill read as an
    // upgrade over something the child never had.
    current: current === null ? null : {
      id: current.id,
      name: current.name,
      rarity: rarityFor(current.id),
      rarityLabel: rarityLabelFor(current.id),
      iconUrl: itemIconUrlFor(current.id),
      iconSvg: itemIconSvgFor(current.id),
    },
    isEquipped,
    isFirstFill: current === null,
    stats: rows,
    power,
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
  };
}

/**
 * THE SIDEGRADE RULE, in one place.
 *
 * EXPORTED, and exported for a reason worth stating rather than as a convenience: with today's
 * catalogue the SIDEGRADE branch is UNREACHABLE through gearComparison. Every real swap moves either
 * heroDamage or damageReductionPercent, so POWER always moves with it, and two stat-identical items
 * produce no changed rows at all. The branch is defensive -- it is the rule
 * PROGRESSION_CONTRACT_V0 asks for, waiting for the first item that can reach it. Testing it through
 * gearComparison would therefore require inventing a fake item in the test, which pins the fake
 * rather than the law; testing it here pins the law itself. test/gear-compare.test.mjs does both:
 * the reachable verdicts through the real seam, this branch directly.
 *
 * POWER is "the game's official single-number estimate of generalized combat readiness"
 * (PROGRESSION_CONTRACT_V0, V0 sidegrade rule), so when a hero is known it is the authority for
 * better/worse and the individual stat arrows are detail underneath it. The case the contract is
 * actually protecting against is a card that reads BETTER because DAMAGE went up while the loadout
 * as a whole got weaker -- so an item whose POWER falls is never labelled an upgrade here, whatever
 * its rows did.
 *
 * POWER unchanged with rows that moved is the honest SIDEGRADE: something is genuinely different and
 * generalised readiness did not move. Today's catalogue can reach it through a same-armor swap; the
 * label exists so that stays truthful when it stops being hypothetical.
 *
 * With NO hero (pre-welcome, no resolved stats) there is no POWER to read, so the verdict falls back
 * to the stat rows alone -- and says SIDEGRADE, not UPGRADE, when they disagree with each other.
 * Refusing to promise "better" on incomplete information is the conservative direction, and it is
 * the direction the contract points.
 */
export function gearVerdict({ isEquipped = false, rows = [], power = null } = {}) {
  if (isEquipped) return VERDICT_EQUIPPED;
  if (power !== null) {
    if (power.delta > 0) return VERDICT_UPGRADE;
    if (power.delta < 0) return VERDICT_DOWNGRADE;
    return rows.some((row) => row.direction !== 'same') ? VERDICT_SIDEGRADE : VERDICT_EQUIPPED;
  }
  const up = rows.some((row) => row.direction === 'up');
  const down = rows.some((row) => row.direction === 'down');
  if (up && !down) return VERDICT_UPGRADE;
  if (down && !up) return VERDICT_DOWNGRADE;
  if (up && down) return VERDICT_SIDEGRADE;
  return VERDICT_EQUIPPED;
}

/**
 * THE EQUIP MOMENT'S OWN NUMBERS: before, delta, after, plus what left the slot.
 *
 * Separate from gearComparison because it answers a different question at a different time. The
 * comparison is a PREDICTION shown while a child is deciding; this is the RECEIPT of a swap that
 * already happened, and #41 wants it loud: "major equipment upgrades should show a clear
 * before -> delta -> after POWER moment".
 *
 * Both read powerChange, so the number the card promised and the number the moment celebrates are
 * the same arithmetic -- the failure this shares a shape with is a ceremony that shows +560 for a
 * swap the Gear screen said was +540.
 *
 * @returns { power, replacedItemId, replacedName } -- replacedItemId is null on a first fill.
 */
export function equipOutcome({ itemId, equippedItemIdsBefore = {}, stats = null } = {}) {
  const def = itemDef(itemId);
  if (def === null) return null;
  const replacedItemId = equippedItemIdsBefore[def.slot] ?? null;
  const after = { ...equippedItemIdsBefore, [def.slot]: def.id };
  let power = null;
  if (stats) {
    power = powerChange(
      powerFor({
        maxHp: stats.maxHp,
        heroDamage: resolvedHeroDamage(stats.level, equippedItemIdsBefore[WEAPON_SLOT]),
        damageReductionPercent: damageReductionPercentForEquipment(equippedItemIdsBefore),
      }),
      powerFor({
        maxHp: stats.maxHp,
        heroDamage: resolvedHeroDamage(stats.level, after[WEAPON_SLOT]),
        damageReductionPercent: damageReductionPercentForEquipment(after),
      }),
    );
  }
  return {
    slot: def.slot,
    itemId: def.id,
    itemName: def.name,
    replacedItemId: replacedItemId === itemId ? null : replacedItemId,
    replacedName: replacedItemId === itemId ? null : (itemDef(replacedItemId)?.name ?? null),
    power,
    powerText: power === null ? null : formatPower(power.after),
  };
}
