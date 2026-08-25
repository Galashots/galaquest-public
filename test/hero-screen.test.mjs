import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DEFAULT_EQUIPPED_WEAPON_ID,
  DEFAULT_OWNED_ITEM_IDS,
  HELMET_SILVERGUARD_ID,
  SHIELD_IRONWOOD_ID,
  STARTER_SWORD_ID,
  WILDWOOD_BLADE_ID,
  damageFor,
} from '../public/src/progression/items.js';
import { heroScreenViewModel, swatchFor, swatchHexFor } from '../public/src/progression/heroScreen.js';
import { resolveHeroStats } from '../public/src/progression/heroStats.js';
import { formatPower, powerFor } from '../public/src/progression/power.js';
import { cumulativeXpForLevel } from '../public/src/progression/levels.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// A fresh, real player: starter sword only. This is BASE deliberately, not a "granted" variant --
// GP1-C1's whole point is that this is the common case, and GRANTED below is the one that needs a
// name calling out that it required an explicit fixture grant.
const BASE = { equippedWeaponId: DEFAULT_EQUIPPED_WEAPON_ID, ownedItemIds: DEFAULT_OWNED_ITEM_IDS };
// The GP1-C1 fixture shape: a guest a harness/dev tool durably granted the Blade to (see
// net/rewardStore.mjs's 'gear-owned' event and tools/runtime-test/drive-hero-screen.mjs's own
// seeded-guest section). Only ever this shape in production for a guest GP9's reward ceremony has
// actually run for.
const GRANTED = { equippedWeaponId: DEFAULT_EQUIPPED_WEAPON_ID, ownedItemIds: [STARTER_SWORD_ID, WILDWOOD_BLADE_ID] };

// Same discipline test/feedback.test.mjs's "index.html draws exactly HERO_MAX_HP hearts" uses: the
// markup is hand-written, not generated, so this is what makes the coupling between it and the view
// model's own 5-slot list safe rather than merely commented.
test('index.html hardcodes the 5 slots; weapon/shield/helmet unlocked, shoulders/chest locked (G1-C3)', () => {
  const source = readFileSync(resolve(repoRoot, 'public/index.html'), 'utf8');
  const slotIds = [...source.matchAll(/class="hero-slot" data-slot="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(slotIds, ['weapon', 'shield', 'helmet', 'shoulders', 'chest']);
  // The three slots the catalogue now has items for (weapon, Shield, Helmet) must not be statically
  // locked -- renderSlots drives them live, and a stale lock glyph would flash before the first frame.
  for (const id of ['weapon', 'shield', 'helmet']) {
    assert.ok(!new RegExp(`data-slot="${id}"[^>]*data-locked`).test(source), `${id} must not render locked`);
  }
  // The two slots with no item yet stay locked until their first item ships.
  for (const id of ['shoulders', 'chest']) {
    assert.ok(new RegExp(`data-slot="${id}"[^>]*data-locked="true"`).test(source), `${id} must render locked`);
  }
});

test('five slots render; weapon/shield/helmet unlock from the catalogue, shoulders/chest stay locked', () => {
  const view = heroScreenViewModel({ ...BASE, selectedItemId: null });
  assert.equal(view.slots.length, 5);
  const byId = Object.fromEntries(view.slots.map((s) => [s.id, s]));
  assert.equal(byId.weapon.locked, false);
  assert.equal(byId.weapon.filled, true);
  assert.equal(byId.weapon.name, 'Starter Sword');
  // The baseline Shield is a real, equipped item, so its slot is truthful rather than a lock -- the
  // hero visibly carries it in the running game, and the screen must not deny that (G1-C3).
  assert.equal(byId.shield.locked, false);
  assert.equal(byId.shield.filled, true);
  assert.equal(byId.shield.name, 'Ironwood Shield');
  // The Helmet slot unlocks because a helmet item now exists, but a fresh player has none equipped:
  // unlocked-and-empty, not locked, and not filled.
  assert.equal(byId.helmet.locked, false);
  assert.equal(byId.helmet.filled, false);
  for (const id of ['shoulders', 'chest']) {
    assert.equal(byId[id].locked, true, `${id} must be locked (no item defined)`);
    assert.equal(byId[id].filled, false);
  }
});

test('G1-C3: the owned strip shows every owned item -- a fresh player has the starter sword AND the baseline Shield, but not the Blade', () => {
  const view = heroScreenViewModel({ ...BASE, selectedItemId: null });
  const ids = view.items.map((i) => i.id);
  assert.ok(ids.includes(STARTER_SWORD_ID), 'the starter sword is owned');
  assert.ok(ids.includes(SHIELD_IRONWOOD_ID), 'the baseline Shield is owned and now appears in the strip');
  assert.ok(!ids.includes(WILDWOOD_BLADE_ID), 'the Blade is not owned by a fresh player and is not there to tap');
});

test('GP1-C1: trying to select an unowned item (e.g. a stale button, or a hand-crafted id) is not possible -- it falls back to equipped', () => {
  // No real button for this exists in the strip (the test above proves that), but the view model
  // itself is the second line of defence: even handed the id directly, it must not resolve to it.
  const view = heroScreenViewModel({ ...BASE, selectedItemId: WILDWOOD_BLADE_ID });
  assert.equal(view.selected.id, STARTER_SWORD_ID);
  assert.equal(view.comparison, null, 'an unowned selection must never produce a comparison card');
});

test('once granted, both weapons appear in the strip, with equipped/selected flagged independently', () => {
  const view = heroScreenViewModel({ ...GRANTED, selectedItemId: WILDWOOD_BLADE_ID });
  const starter = view.items.find((w) => w.id === STARTER_SWORD_ID);
  const blade = view.items.find((w) => w.id === WILDWOOD_BLADE_ID);
  assert.equal(starter.equipped, true);
  assert.equal(starter.selected, false);
  assert.equal(blade.equipped, false);
  assert.equal(blade.selected, true, 'the explicitly selected item must be flagged, not the equipped one');
});

test('an absent selection falls back to the equipped weapon, never a blank card', () => {
  const noSelection = heroScreenViewModel({ ...BASE, selectedItemId: null });
  assert.equal(noSelection.selected.id, DEFAULT_EQUIPPED_WEAPON_ID);

  const staleSelection = heroScreenViewModel({ ...GRANTED, selectedItemId: 'not-owned-anymore' });
  assert.equal(staleSelection.selected.id, DEFAULT_EQUIPPED_WEAPON_ID);
});

test('comparing the equipped item against itself yields no comparison card', () => {
  const view = heroScreenViewModel({ ...BASE, selectedItemId: STARTER_SWORD_ID });
  assert.equal(view.comparison, null);
  assert.equal(view.selected.isEquipped, true);
});

test('once granted, comparing the Wildwood Blade against the equipped Starter Sword reads an upgrade', () => {
  const view = heroScreenViewModel({ ...GRANTED, selectedItemId: WILDWOOD_BLADE_ID });
  // Read off the catalogue rather than typed. The test title used to name the numbers -- "reads
  // 1 -> 2 DAMAGE" -- and P2's rescale made both of them wrong; a card that prints the catalogue's
  // real values is the property, and which values those are is items.js's business (GQ-007).
  assert.deepEqual(view.comparison, {
    fromDamage: damageFor(STARTER_SWORD_ID),
    toDamage: damageFor(WILDWOOD_BLADE_ID),
    isUpgrade: true,
  });
  assert.equal(view.selected.isEquipped, false);
});

test('sabotage: equipping the Blade then selecting the Starter Sword reads a DOWNGRADE, not an upgrade', () => {
  const view = heroScreenViewModel({
    equippedWeaponId: WILDWOOD_BLADE_ID, ownedItemIds: GRANTED.ownedItemIds, selectedItemId: STARTER_SWORD_ID,
  });
  assert.equal(view.comparison.isUpgrade, false, 'comparison must react to which item is EQUIPPED, not be hardcoded');
});

test('every defined item has a distinct swatch, and an unknown id degrades to a neutral one', () => {
  assert.notEqual(swatchFor(STARTER_SWORD_ID), swatchFor(WILDWOOD_BLADE_ID));
  assert.doesNotThrow(() => swatchFor('not-a-real-item'));
});

test('swatchHexFor is the single source of truth swatchFor\'s CSS string is derived from', () => {
  assert.equal(typeof swatchHexFor(STARTER_SWORD_ID), 'number');
  assert.equal(swatchFor(STARTER_SWORD_ID), `#${swatchHexFor(STARTER_SWORD_ID).toString(16).padStart(6, '0')}`);
  assert.equal(swatchFor(WILDWOOD_BLADE_ID), `#${swatchHexFor(WILDWOOD_BLADE_ID).toString(16).padStart(6, '0')}`);
});


// ── P2: WHO THIS HERO IS ────────────────────────────────────────────────────────────────────────
//
// The contract puts POWER "prominently on the Hero/equipment surface", and the brief adds that the
// screen "must not lie about normalized weapon damage". The second half is the one with teeth: every
// number on this screen is individually true of SOMETHING, and the failure mode is printing a number
// that is true of the item while a child reads it as being about themselves.

const LEVELLED = resolveHeroStats({
  totalXp: cumulativeXpForLevel(2), equippedWeaponId: STARTER_SWORD_ID,
});

test('the identity panel reports the RESOLVED hero, not the catalogue', () => {
  const view = heroScreenViewModel({
    equippedWeaponId: STARTER_SWORD_ID,
    ownedItemIds: [STARTER_SWORD_ID],
    selectedItemId: STARTER_SWORD_ID,
    stats: LEVELLED,
  });
  assert.equal(view.identity.level, 2);
  assert.equal(view.identity.maxHp, LEVELLED.maxHp);
  assert.equal(view.identity.damage, LEVELLED.heroDamage);
  assert.equal(view.identity.power, powerFor(LEVELLED));
  assert.equal(view.identity.powerText, formatPower(powerFor(LEVELLED)));

  // THE ONE THAT MATTERS. A Level-2 hero holding the starter sword hits for 12; the sword itself is
  // worth 10. A screen that printed the sword's number as the hero's would be true about the item
  // and false about the child -- the version of GQ-013 that is hardest to notice, because every
  // individual number in it is correct.
  assert.notEqual(view.identity.damage, damageFor(STARTER_SWORD_ID));
  assert.equal(view.selected.damage, damageFor(STARTER_SWORD_ID),
    'the item card still reports the ITEM, which is its job');
});

test('a screen with no hero yet shows no identity rather than a made-up one', () => {
  const view = heroScreenViewModel({
    equippedWeaponId: STARTER_SWORD_ID, ownedItemIds: [STARTER_SWORD_ID], selectedItemId: null,
  });
  assert.equal(view.identity, null, 'an empty POWER panel reads as "you have no power", which is a '
    + 'different and untrue statement from "this is not known yet"');
  assert.equal(view.powerComparison, null, 'a POWER change needs a hero to happen to');
});

test('the equip comparison says what it would do to POWER, from the same law the ceremony uses', () => {
  const view = heroScreenViewModel({
    ...GRANTED, selectedItemId: WILDWOOD_BLADE_ID, stats: LEVELLED,
  });
  assert.equal(view.powerComparison.from, powerFor(LEVELLED));
  assert.ok(view.powerComparison.delta > 0, 'the Blade is a real upgrade at any level');
  assert.equal(view.powerComparison.deltaText, `+${formatPower(view.powerComparison.delta)}`);
  assert.equal(view.powerComparison.fromText, formatPower(view.powerComparison.from));
});

test('comparing the equipped item against itself yields no POWER comparison either', () => {
  const view = heroScreenViewModel({
    ...GRANTED, selectedItemId: STARTER_SWORD_ID, stats: LEVELLED,
  });
  assert.equal(view.powerComparison, null, 'nothing to compare against itself');
});

test('the POWER comparison holds the BODY still and moves only the weapon', () => {
  // The equip question is "what would this sword do", not "what would this sword and a level do".
  // Holding max HP fixed is what makes the delta answerable at all.
  const view = heroScreenViewModel({
    ...GRANTED, selectedItemId: WILDWOOD_BLADE_ID, stats: LEVELLED,
  });
  const sameBodyBladeArm = powerFor({
    maxHp: LEVELLED.maxHp,
    heroDamage: LEVELLED.heroDamage + (damageFor(WILDWOOD_BLADE_ID) - damageFor(STARTER_SWORD_ID)),
  });
  assert.equal(view.powerComparison.to, sameBodyBladeArm);
});

test('a sidegrade that lowers POWER is reported as a loss, not silently as an upgrade', () => {
  // The contract protects this explicitly. No item in the current catalogue can produce it, so the
  // property is proved against the direction rather than against a fixture that does not exist:
  // equipping DOWN from the Blade to the starter sword must read as negative.
  const bladeHero = resolveHeroStats({
    totalXp: cumulativeXpForLevel(2), equippedWeaponId: WILDWOOD_BLADE_ID,
  });
  const view = heroScreenViewModel({
    equippedWeaponId: WILDWOOD_BLADE_ID,
    ownedItemIds: GRANTED.ownedItemIds,
    selectedItemId: STARTER_SWORD_ID,
    stats: bladeHero,
  });
  assert.ok(view.powerComparison.delta < 0);
  assert.ok(view.powerComparison.deltaText.startsWith('-'),
    `a downgrade must not be labelled "+": got ${view.powerComparison.deltaText}`);
});

test('every existing field survives the identity being added', () => {
  // GQ-017: adding a field to a view model is a type change, and the callers that already read the
  // old shape are the ones nobody looks at. This pins that the old contract is untouched.
  const withStats = heroScreenViewModel({ ...GRANTED, selectedItemId: WILDWOOD_BLADE_ID, stats: LEVELLED });
  const without = heroScreenViewModel({ ...GRANTED, selectedItemId: WILDWOOD_BLADE_ID });
  assert.deepEqual(withStats.slots, without.slots);
  assert.deepEqual(withStats.items, without.items);
  assert.deepEqual(withStats.selected, without.selected);
  assert.deepEqual(withStats.comparison, without.comparison);
});
