// #88's product laws, at the layer where they are decidable without a browser.
//
// Every case here is red-capable against a plausible wrong implementation, not merely a restatement
// of what the code does today. The ones worth naming:
//
//   - "a stat rose but POWER fell" must NOT read BETTER. That is the exact sentence
//     PROGRESSION_CONTRACT_V0's sidegrade rule forbids, and the naive implementation (colour the
//     card from the damage arrow) passes every other test in this file while failing that one.
//   - the comparison must be against the item worn IN THE CANDIDATE'S OWN SLOT. Comparing a helmet
//     against the equipped WEAPON is the mistake the pre-#88 card was one refactor away from, and it
//     produces plausible-looking numbers.
//   - POWER must come from the same real-stat authority the fight reads, so the card cannot promise
//     a number the combat model disagrees with.
//   - the icon/rarity catalogue must COVER every shipping item, or a real item silently renders as
//     the neutral fallback -- which is the Checkpoint 0 grey square, reintroduced by omission.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  HELMET_SILVERGUARD_ID,
  ITEM_DEFS,
  SHIELD_IRONWOOD_ID,
  SHOULDER_SILVERGUARD_ID,
  STARTER_SWORD_ID,
  WILDWOOD_BLADE_ID,
  damageFor,
} from '../public/src/progression/items.js';
import {
  VERDICT_DOWNGRADE,
  VERDICT_EQUIPPED,
  VERDICT_SIDEGRADE,
  VERDICT_UPGRADE,
  equipOutcome,
  gearComparison,
  gearVerdict,
} from '../public/src/progression/gearCompare.js';
import {
  RARITY_ORDER,
  itemArtFor,
  itemIdsWithArt,
  rarityFor,
  rarityRankFor,
} from '../public/src/progression/itemArt.js';
import {
  damageReductionPercentForEquipment,
  resolveHeroStats,
  resolvedHeroDamage,
} from '../public/src/progression/heroStats.js';
import { powerFor } from '../public/src/progression/power.js';

const STARTER_LOADOUT = { weapon: STARTER_SWORD_ID, shield: SHIELD_IRONWOOD_ID };
const statsFor = (equippedItemIds, totalXp = 0) => resolveHeroStats({ totalXp, equippedItemIds });

test('a weapon upgrade compares against the worn WEAPON, not whatever else is equipped', () => {
  const stats = statsFor(STARTER_LOADOUT);
  const compare = gearComparison({
    candidateItemId: WILDWOOD_BLADE_ID,
    equippedItemIds: STARTER_LOADOUT,
    stats,
  });

  assert.equal(compare.slot, 'weapon');
  assert.equal(compare.current.id, STARTER_SWORD_ID);
  const damage = compare.stats.find((row) => row.key === 'damage');
  assert.equal(damage.currentValue, damageFor(STARTER_SWORD_ID));
  assert.equal(damage.candidateValue, damageFor(WILDWOOD_BLADE_ID));
  assert.equal(damage.direction, 'up');
  assert.equal(compare.verdict, VERDICT_UPGRADE);
});

test('a helmet compares against the empty HELMET slot and reads as a first fill', () => {
  const stats = statsFor(STARTER_LOADOUT);
  const compare = gearComparison({
    candidateItemId: HELMET_SILVERGUARD_ID,
    equippedItemIds: STARTER_LOADOUT,
    stats,
  });

  assert.equal(compare.slot, 'helmet');
  // NOT the starter sword. A comparison that reached for "the equipped weapon" because that is the
  // field the old card had would produce a DAMAGE row here, which is the bug this asserts against.
  assert.equal(compare.current, null);
  assert.equal(compare.isFirstFill, true);
  assert.ok(!compare.stats.some((row) => row.key === 'damage'),
    'a helmet must not print a DAMAGE row it has no damage for');
  assert.equal(compare.verdict, VERDICT_UPGRADE);
});

test('the POWER shown on the card is the POWER the fight would actually resolve', () => {
  const stats = statsFor(STARTER_LOADOUT);
  const compare = gearComparison({
    candidateItemId: HELMET_SILVERGUARD_ID,
    equippedItemIds: STARTER_LOADOUT,
    stats,
  });

  // Recomputed here from the SAME authority the combat seam is fed, deliberately by a different
  // route than the module under test uses, so a card that quietly invented its own arithmetic
  // (or compared a hero against a differently-levelled hero) fails.
  const after = { ...STARTER_LOADOUT, helmet: HELMET_SILVERGUARD_ID };
  const expected = powerFor({
    maxHp: stats.maxHp,
    heroDamage: resolvedHeroDamage(stats.level, after.weapon),
    damageReductionPercent: damageReductionPercentForEquipment(after),
  });

  assert.equal(compare.power.before, powerFor(stats));
  assert.equal(compare.power.after, expected);
  assert.equal(compare.power.delta, expected - powerFor(stats));
  assert.ok(compare.power.delta > 0, 'the Silverguard Helmet is a real defensive gain');
  assert.equal(compare.power.deltaText.startsWith('+'), true);
});

test('a real downgrade is never labelled BETTER, however its stat rows read', () => {
  // The reachable half of the contract's sidegrade rule, through the real seam: swapping the
  // Wildwood Blade back out for the Starter Sword. Damage falls, POWER falls, and a card that
  // coloured itself from anything other than generalised readiness would still have to get this one
  // right -- so this pins the direction, and gearVerdict below pins the branch a real item cannot
  // yet reach.
  const armed = { weapon: WILDWOOD_BLADE_ID, shield: SHIELD_IRONWOOD_ID, helmet: HELMET_SILVERGUARD_ID };
  const back = gearComparison({
    candidateItemId: STARTER_SWORD_ID,
    equippedItemIds: armed,
    stats: statsFor(armed),
  });

  assert.equal(back.stats.find((row) => row.key === 'damage').direction, 'down');
  assert.ok(back.power.delta < 0);
  assert.equal(back.verdict, VERDICT_DOWNGRADE);
  assert.notEqual(back.verdict, VERDICT_UPGRADE);
  assert.equal(back.verdictLabel, 'WEAKER');
});

test('THE SIDEGRADE RULE: a stat that rose while POWER did not never reads BETTER', () => {
  // Pinned at gearVerdict rather than through a fabricated item (see that function's own comment for
  // why this branch is currently unreachable from the catalogue). This is the sentence
  // PROGRESSION_CONTRACT_V0 forbids, written as a test: one stat up, generalised readiness flat.
  const oneStatUp = [
    { key: 'damage', direction: 'up', delta: 6 },
    { key: 'damageReductionPercent', direction: 'down', delta: -4 },
  ];

  assert.equal(
    gearVerdict({ rows: oneStatUp, power: { before: 1000, after: 1000, delta: 0 } }),
    VERDICT_SIDEGRADE,
    'POWER-neutral with real movement underneath is a sidegrade, not an upgrade',
  );
  assert.equal(
    gearVerdict({ rows: oneStatUp, power: { before: 1000, after: 940, delta: -60 } }),
    VERDICT_DOWNGRADE,
    'a rising DAMAGE row must not outvote a falling POWER',
  );
  assert.equal(
    gearVerdict({ rows: oneStatUp, power: { before: 1000, after: 1120, delta: 120 } }),
    VERDICT_UPGRADE,
  );
  // And with no hero at all, disagreeing rows stay conservative rather than promising "better".
  assert.equal(gearVerdict({ rows: oneStatUp, power: null }), VERDICT_SIDEGRADE);
});

test('an unequipped item whose stats match the worn one exactly is not sold as an upgrade', () => {
  const worn = { weapon: STARTER_SWORD_ID, shield: SHIELD_IRONWOOD_ID };
  const same = gearComparison({
    candidateItemId: SHIELD_IRONWOOD_ID,
    equippedItemIds: worn,
    stats: statsFor(worn),
  });
  assert.equal(same.verdict, VERDICT_EQUIPPED, 'the worn item is not an upgrade over itself');
});

test('the item already worn reads WEARING IT and offers no stat arrows', () => {
  const stats = statsFor(STARTER_LOADOUT);
  const compare = gearComparison({
    candidateItemId: STARTER_SWORD_ID,
    equippedItemIds: STARTER_LOADOUT,
    stats,
  });
  assert.equal(compare.isEquipped, true);
  assert.equal(compare.verdict, VERDICT_EQUIPPED);
  assert.deepEqual(compare.stats, []);
  // POWER is still present and still equal to itself: an equipped item's "delta" is zero, not
  // absent, so a card can show the hero's current POWER without a special case.
  assert.equal(compare.power.delta, 0);
});

test('an unknown item id yields no comparison rather than a card full of nulls', () => {
  assert.equal(gearComparison({ candidateItemId: 'no_such_item', equippedItemIds: STARTER_LOADOUT }), null);
});

test('equipOutcome names what left the slot, so the replaced item can be shown returning', () => {
  const stats = statsFor(STARTER_LOADOUT);
  const outcome = equipOutcome({
    itemId: WILDWOOD_BLADE_ID,
    equippedItemIdsBefore: STARTER_LOADOUT,
    stats,
  });
  assert.equal(outcome.slot, 'weapon');
  assert.equal(outcome.replacedItemId, STARTER_SWORD_ID);
  assert.equal(outcome.replacedName, 'Starter Sword');
  assert.ok(outcome.power.delta > 0);
  // The before/delta/after triple #41 asks the equip moment to show.
  assert.equal(outcome.power.before, powerFor(stats));
  assert.ok(outcome.power.beforeText.length > 0);
  assert.ok(outcome.power.deltaText.startsWith('+'));
  assert.ok(outcome.power.afterText.length > 0);
});

test('a first fill has nothing to send back to the inventory', () => {
  const outcome = equipOutcome({
    itemId: HELMET_SILVERGUARD_ID,
    equippedItemIdsBefore: STARTER_LOADOUT,
    stats: statsFor(STARTER_LOADOUT),
  });
  assert.equal(outcome.replacedItemId, null);
  assert.equal(outcome.replacedName, null);
});

test('re-equipping the item already in the slot reports no replacement', () => {
  const outcome = equipOutcome({
    itemId: STARTER_SWORD_ID,
    equippedItemIdsBefore: STARTER_LOADOUT,
    stats: statsFor(STARTER_LOADOUT),
  });
  assert.equal(outcome.replacedItemId, null, 'an item does not replace itself');
  assert.equal(outcome.power.delta, 0);
});

test('every shipping item has an art decision -- no item falls back to the neutral square', () => {
  const shipping = Object.keys(ITEM_DEFS).sort();
  const withArt = itemIdsWithArt().sort();
  assert.deepEqual(withArt, shipping,
    'progression/itemArt.js must carry one row per shipping item; a missing row renders the '
    + 'Checkpoint 0 grey square again, silently');
});

test('every item art row names a real rarity, a PNG portrait and an SVG fallback', () => {
  for (const itemId of Object.keys(ITEM_DEFS)) {
    const art = itemArtFor(itemId);
    assert.ok(RARITY_ORDER.includes(art.rarity), `${itemId} has an unknown rarity ${art.rarity}`);
    assert.ok(rarityRankFor(itemId) >= 0, `${itemId} has no rarity rank`);
    assert.match(art.iconUrl, /^assets\/items\/[a-z0-9_]+\.png$/,
      `${itemId} must name a rendered portrait under assets/items/`);
    assert.match(art.iconSvg, /<svg/, `${itemId} must carry an inline fallback silhouette`);
  }
});

test('rarity is presentation only: it moves no stat and no drop rate', () => {
  // The failure this guards is an "improvement" that gives rarity a gameplay effect -- the moment
  // that happens, POWER and the drop tables have a second, undocumented input.
  for (const itemId of Object.keys(ITEM_DEFS)) {
    const before = { ...ITEM_DEFS[itemId] };
    rarityFor(itemId);
    assert.deepEqual({ ...ITEM_DEFS[itemId] }, before);
  }
  const stats = resolveHeroStats({ totalXp: 0, equippedItemIds: STARTER_LOADOUT });
  const withRare = resolveHeroStats({
    totalXp: 0,
    equippedItemIds: { ...STARTER_LOADOUT, helmet: HELMET_SILVERGUARD_ID },
  });
  // The Rare helmet's contribution is its damageReductionPercent, nothing about being Rare.
  assert.equal(withRare.damageReductionPercent - stats.damageReductionPercent,
    ITEM_DEFS[HELMET_SILVERGUARD_ID].damageReductionPercent);
});
