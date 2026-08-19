import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  DEFAULT_EQUIPPED_WEAPON_ID,
  DEFAULT_OWNED_ITEM_IDS,
  STARTER_SWORD_ID,
  WILDWOOD_BLADE_ID,
} from '../public/src/progression/items.js';
import {
  canEquip,
  equippedWeaponIdFromRewards,
  ownedItemIdsFromRewards,
} from '../public/src/progression/state.js';

test('equippedWeaponIdFromRewards reads the wire field straight through', () => {
  assert.equal(equippedWeaponIdFromRewards({ equippedWeaponId: WILDWOOD_BLADE_ID }), WILDWOOD_BLADE_ID);
});

test('equippedWeaponIdFromRewards falls back to the starter sword for every "not known yet" shape', () => {
  assert.equal(equippedWeaponIdFromRewards(undefined), DEFAULT_EQUIPPED_WEAPON_ID);
  assert.equal(equippedWeaponIdFromRewards(null), DEFAULT_EQUIPPED_WEAPON_ID);
  assert.equal(equippedWeaponIdFromRewards({}), DEFAULT_EQUIPPED_WEAPON_ID);
  assert.equal(equippedWeaponIdFromRewards({ marks: 2, lanternUnlocked: false }), DEFAULT_EQUIPPED_WEAPON_ID);
  assert.equal(equippedWeaponIdFromRewards({ equippedWeaponId: '' }), DEFAULT_EQUIPPED_WEAPON_ID,
    'an empty string is not a real item id either');
});

test('GP1-C1: ownedItemIdsFromRewards falls back to starter-sword-only for every "not known yet" shape', () => {
  assert.deepEqual(ownedItemIdsFromRewards(undefined), DEFAULT_OWNED_ITEM_IDS);
  assert.deepEqual(ownedItemIdsFromRewards({ marks: 3 }), DEFAULT_OWNED_ITEM_IDS);
  assert.deepEqual(ownedItemIdsFromRewards({ ownedItemIds: [] }), DEFAULT_OWNED_ITEM_IDS,
    'an empty array is not real ownership data either');
  assert.ok(ownedItemIdsFromRewards().includes(STARTER_SWORD_ID));
  assert.ok(!ownedItemIdsFromRewards().includes(WILDWOOD_BLADE_ID));
});

test('GP1-C1: ownedItemIdsFromRewards reads the real wire field when a guest was granted the Blade', () => {
  const granted = ownedItemIdsFromRewards({ ownedItemIds: [STARTER_SWORD_ID, WILDWOOD_BLADE_ID] });
  assert.deepEqual(granted, [STARTER_SWORD_ID, WILDWOOD_BLADE_ID]);
});

test('canEquip accepts only known weapons', () => {
  assert.equal(canEquip(STARTER_SWORD_ID), true);
  assert.equal(canEquip(WILDWOOD_BLADE_ID), true);
  assert.equal(canEquip('not-a-real-item'), false);
  assert.equal(canEquip(undefined), false);
});
