import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DEFAULT_EQUIPPED_WEAPON_ID,
  DEFAULT_OWNED_ITEM_IDS,
  STARTER_SWORD_ID,
  WILDWOOD_BLADE_ID,
} from '../public/src/progression/items.js';
import { heroScreenViewModel, swatchFor, swatchHexFor } from '../public/src/progression/heroScreen.js';

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
test('index.html hardcodes exactly the 5 GP1 slots, weapon unlocked and the rest locked', () => {
  const source = readFileSync(resolve(repoRoot, 'public/index.html'), 'utf8');
  const slotIds = [...source.matchAll(/class="hero-slot" data-slot="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(slotIds, ['weapon', 'shield', 'helmet', 'shoulders', 'chest']);
  assert.ok(!/data-slot="weapon"[^>]*data-locked/.test(source), 'the weapon slot must not be locked');
  for (const id of ['shield', 'helmet', 'shoulders', 'chest']) {
    const re = new RegExp(`data-slot="${id}"[^>]*data-locked="true"`);
    assert.ok(re.test(source), `${id} must render locked in GP1`);
  }
});

test('five slots always render, only the weapon slot is unlocked in GP1', () => {
  const view = heroScreenViewModel({ ...BASE, selectedItemId: null });
  assert.equal(view.slots.length, 5);
  const weaponSlot = view.slots.find((s) => s.id === 'weapon');
  assert.equal(weaponSlot.locked, false);
  assert.equal(weaponSlot.filled, true);
  assert.equal(weaponSlot.name, 'Starter Sword');
  for (const slot of view.slots) {
    if (slot.id === 'weapon') continue;
    assert.equal(slot.locked, true, `${slot.id} must be locked in GP1`);
    assert.equal(slot.filled, false);
  }
});

test('GP1-C1: a fresh (non-granted) player sees ONLY the starter sword in the strip -- the Blade is not there to tap', () => {
  const view = heroScreenViewModel({ ...BASE, selectedItemId: null });
  assert.equal(view.weapons.length, 1);
  assert.equal(view.weapons[0].id, STARTER_SWORD_ID);
  assert.ok(!view.weapons.some((w) => w.id === WILDWOOD_BLADE_ID));
});

test('GP1-C1: trying to select an unowned item (e.g. a stale button, or a hand-crafted id) is not possible -- it falls back to equipped', () => {
  // No real button for this exists in the strip (the test above proves that), but the view model
  // itself is the second line of defence: even handed the id directly, it must not resolve to it.
  const view = heroScreenViewModel({ ...BASE, selectedItemId: WILDWOOD_BLADE_ID });
  assert.equal(view.selected.id, STARTER_SWORD_ID);
  assert.equal(view.comparison, null, 'an unowned selection must never produce a comparison card');
});

test('once granted (GP1-C1 fixture shape), both weapons appear in the strip, with equipped/selected flagged independently', () => {
  const view = heroScreenViewModel({ ...GRANTED, selectedItemId: WILDWOOD_BLADE_ID });
  assert.equal(view.weapons.length, 2);
  const starter = view.weapons.find((w) => w.id === STARTER_SWORD_ID);
  const blade = view.weapons.find((w) => w.id === WILDWOOD_BLADE_ID);
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

test('once granted, comparing the Wildwood Blade against the equipped Starter Sword reads 1 -> 2 DAMAGE, an upgrade', () => {
  const view = heroScreenViewModel({ ...GRANTED, selectedItemId: WILDWOOD_BLADE_ID });
  assert.deepEqual(view.comparison, { fromDamage: 1, toDamage: 2, isUpgrade: true });
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
