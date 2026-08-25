import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  DEFAULT_EQUIPPED_ITEM_IDS,
  HELMET_SILVERGUARD_ID,
  SHIELD_IRONWOOD_ID,
  STARTER_SWORD_ID,
  WILDWOOD_BLADE_ID,
  itemDef,
} from '../public/src/progression/items.js';
import {
  damageReductionPercentForEquipment,
  resolveHeroStats,
  resolvedHeroDamage,
} from '../public/src/progression/heroStats.js';
import { powerChange, powerFor } from '../public/src/progression/power.js';
import { heroScreenViewModel } from '../public/src/progression/heroScreen.js';
import {
  HELMET_ICON_SVG,
  SWORD_ICON_SVG,
  unlockCardState,
} from '../public/src/ui/unlockCard.js';

// G1-C3 is the child-visible half of the armour vertical: the acquisition card and the Hero screen.
// The server-side ownership -> equip -> mitigation -> POWER -> combat chain is already pinned by
// test/progression-g1-c2.test.mjs (10 -> 9, POWER 1000 -> 1111, isolation, recovery); these prove the
// two SURFACES a child actually reads say the same truth, computed from the same law (GQ-007/GQ-013).

// The POWER a fresh L1 hero moves to by putting the Helmet on, built exactly as main.js's ceremony
// builds it: hold the body and the arm still, move only the defence into the helmet slot.
function helmetAcquisitionPower() {
  const before = resolveHeroStats({});
  const afterEquipped = { ...DEFAULT_EQUIPPED_ITEM_IDS, helmet: HELMET_SILVERGUARD_ID };
  const after = powerFor({
    maxHp: before.maxHp,
    heroDamage: before.heroDamage,
    damageReductionPercent: damageReductionPercentForEquipment(afterEquipped),
  });
  return powerChange(powerFor(before), after);
}

// ── The acquisition card ──────────────────────────────────────────────────────────────────────────

test('the Helmet card names SILVERGUARD HELMET and reads its worth as a POWER move, not a DAMAGE line', () => {
  const power = helmetAcquisitionPower();
  const state = unlockCardState({
    itemName: itemDef(HELMET_SILVERGUARD_ID).name,
    power,
    prompt: 'EQUIP NOW?',
  });
  assert.equal(state.eyebrow, 'UNLOCKED');
  assert.equal(state.name, 'SILVERGUARD HELMET');
  assert.equal(state.comparison, `${power.beforeText} → ${power.afterText} POWER`);
  assert.match(state.comparison, /POWER$/);
  assert.ok(!state.comparison.includes('DAMAGE'), 'a helmet has no damage to compare');
});

test('the Helmet really is an upgrade today, and isUpgrade agrees with the POWER delta rather than assuming it', () => {
  const power = helmetAcquisitionPower();
  assert.ok(power.delta > 0, 'a 10% mitigation raises POWER, or this ceremony\'s premise changed');
  assert.equal(unlockCardState({ itemName: 'Silverguard Helmet', power, prompt: 'EQUIP NOW?' }).isUpgrade, true);
});

test('sabotage: a defensive change that LOWERS POWER reads as not an upgrade -- the flag reacts to the delta', () => {
  const down = unlockCardState({ itemName: 'X', power: powerChange(2000, 1000), prompt: 'EQUIP NOW?' });
  assert.equal(down.isUpgrade, false);
  assert.equal(down.comparison, '2,000 → 1,000 POWER', 'the line still tells the truth about the numbers it was handed');
});

test('the card ASKS rather than auto-equipping: it carries the EQUIP NOW? prompt', () => {
  const state = unlockCardState({ itemName: 'Silverguard Helmet', power: helmetAcquisitionPower(), prompt: 'EQUIP NOW?' });
  assert.equal(state.prompt, 'EQUIP NOW?');
  // No gear-pill hint on the offering card: the buttons are the affordance.
  assert.equal(state.hint, null);
});

test('the Helmet card is hearable: spoken as a sentence, arrow-free and shout-free, and it asks to equip', () => {
  const power = helmetAcquisitionPower();
  const state = unlockCardState({ itemName: 'Silverguard Helmet', power, prompt: 'EQUIP NOW?' });
  assert.ok(state.spoken.startsWith('Unlocked!'), state.spoken);
  assert.ok(state.spoken.includes('Silverguard Helmet'), 'the spoken name is the readable one');
  assert.ok(!state.spoken.includes('SILVERGUARD HELMET'), 'a voice should not shout');
  assert.ok(!state.spoken.includes('→'), 'an arrow read aloud is the word "arrow"');
  assert.ok(state.spoken.includes(power.beforeText) && state.spoken.includes(power.afterText),
    `the POWER move must be spoken: ${state.spoken}`);
  assert.ok(state.spoken.includes('Equip it now?'), `the offer must be spoken: ${state.spoken}`);
});

test('a POWER card with no prompt does not invent the offer wording', () => {
  const state = unlockCardState({ itemName: 'Silverguard Helmet', power: helmetAcquisitionPower() });
  assert.equal(state.prompt, null);
  assert.ok(!state.spoken.includes('Equip it now?'), state.spoken);
});

test('the Helmet card wears its own icon, distinct from the sword', () => {
  assert.notEqual(HELMET_ICON_SVG, SWORD_ICON_SVG);
  assert.ok(HELMET_ICON_SVG.includes('currentColor'), 'the icon takes the card accent rather than a baked colour');
});

// ── The Hero screen ─────────────────────────────────────────────────────────────────────────────

const OWNS_HELMET = [STARTER_SWORD_ID, SHIELD_IRONWOOD_ID, HELMET_SILVERGUARD_ID];

test('with the Helmet equipped, the Helmet slot is truthful -- filled, named, unlocked', () => {
  const equipped = { ...DEFAULT_EQUIPPED_ITEM_IDS, helmet: HELMET_SILVERGUARD_ID };
  const stats = resolveHeroStats({ equippedItemIds: equipped });
  const view = heroScreenViewModel({
    equippedItemIds: equipped, ownedItemIds: OWNS_HELMET, selectedItemId: HELMET_SILVERGUARD_ID, stats,
  });
  const helmet = view.slots.find((s) => s.id === 'helmet');
  assert.equal(helmet.locked, false);
  assert.equal(helmet.filled, true);
  assert.equal(helmet.name, 'Silverguard Helmet');
  // The equipped Helmet's card reads its DEFENCE, not a weapon's damage, and offers no equip.
  assert.equal(view.selected.slot, 'helmet');
  assert.equal(view.selected.damageReductionPercent, 10);
  assert.equal(view.selected.damage, null);
  assert.equal(view.selected.isEquipped, true);
  assert.equal(view.comparison, null, 'a defensive item has no DAMAGE arrow');
  assert.equal(view.powerComparison, null, 'nothing to compare an equipped item against itself');
});

test('the baseline Shield slot is truthful without any grant -- the hero visibly carries it', () => {
  const stats = resolveHeroStats({});
  const view = heroScreenViewModel({
    equippedItemIds: DEFAULT_EQUIPPED_ITEM_IDS, ownedItemIds: OWNS_HELMET, selectedItemId: null, stats,
  });
  const shield = view.slots.find((s) => s.id === 'shield');
  assert.equal(shield.locked, false);
  assert.equal(shield.filled, true);
  assert.equal(shield.name, 'Ironwood Shield');
});

test('an owned-but-unequipped Helmet is selectable and reads a real POWER gain, holding the body still', () => {
  const equipped = { ...DEFAULT_EQUIPPED_ITEM_IDS }; // no helmet on yet
  const stats = resolveHeroStats({ equippedItemIds: equipped });
  const view = heroScreenViewModel({
    equippedItemIds: equipped, ownedItemIds: OWNS_HELMET, selectedItemId: HELMET_SILVERGUARD_ID, stats,
  });
  // Owned, so it is in the strip and selectable; not equipped, so the slot is empty.
  assert.ok(view.items.some((i) => i.id === HELMET_SILVERGUARD_ID), 'the owned Helmet is in the strip to equip later');
  assert.equal(view.slots.find((s) => s.id === 'helmet').filled, false);
  assert.equal(view.selected.isEquipped, false);
  assert.equal(view.comparison, null, 'a helmet has no DAMAGE line to draw');
  assert.ok(view.powerComparison, 'a defensive item still offers a POWER comparison');
  assert.ok(view.powerComparison.delta > 0, 'equipping the Helmet raises POWER');
  // Hold the body and the arm still, move only the defence: the same law the ceremony used.
  const expectedAfter = powerFor({
    maxHp: stats.maxHp,
    heroDamage: stats.heroDamage,
    damageReductionPercent: damageReductionPercentForEquipment({ ...equipped, helmet: HELMET_SILVERGUARD_ID }),
  });
  assert.equal(view.powerComparison.to, expectedAfter);
});

test('with the Helmet ON, comparing a weapon holds the DEFENCE still -- it is not read as a POWER drop', () => {
  // The latent bug this pins: an `after` that dropped DR to 0 would make selecting a weapon while
  // wearing the Helmet look like a loss. The comparison must keep the Helmet on and move only the arm.
  const owned = [STARTER_SWORD_ID, WILDWOOD_BLADE_ID, SHIELD_IRONWOOD_ID, HELMET_SILVERGUARD_ID];
  const equipped = { weapon: STARTER_SWORD_ID, shield: SHIELD_IRONWOOD_ID, helmet: HELMET_SILVERGUARD_ID };
  const stats = resolveHeroStats({ equippedItemIds: equipped });
  const view = heroScreenViewModel({
    equippedItemIds: equipped, ownedItemIds: owned, selectedItemId: WILDWOOD_BLADE_ID, stats,
  });
  const expectedAfter = powerFor({
    maxHp: stats.maxHp,
    heroDamage: resolvedHeroDamage(stats.level, WILDWOOD_BLADE_ID),
    damageReductionPercent: damageReductionPercentForEquipment(equipped), // Helmet stays on: 10%
  });
  assert.equal(view.powerComparison.to, expectedAfter);
  assert.ok(view.powerComparison.delta > 0, 'the Blade is still an upgrade with the Helmet on');
});
