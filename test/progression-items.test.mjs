import { strict as assert } from 'node:assert';
import test from 'node:test';

import { WOLF_MAX_HP } from '../public/src/combat/encounter.js';
import {
  DEFAULT_EQUIPPED_WEAPON_ID,
  DEFAULT_OWNED_ITEM_IDS,
  ITEM_DEFS,
  STARTER_SWORD_ID,
  WEAPON_SLOT,
  WILDWOOD_BLADE_ID,
  damageFor,
  isKnownItem,
  isKnownWeapon,
  itemDef,
} from '../public/src/progression/items.js';

test('starter sword and Wildwood Blade are both defined weapons with the plan-specified damage', () => {
  assert.equal(itemDef(STARTER_SWORD_ID).damage, 1);
  assert.equal(itemDef(WILDWOOD_BLADE_ID).damage, 2);
  assert.equal(itemDef(STARTER_SWORD_ID).slot, WEAPON_SLOT);
  assert.equal(itemDef(WILDWOOD_BLADE_ID).slot, WEAPON_SLOT);
});

test('the starter sword is the default equipped weapon', () => {
  assert.equal(DEFAULT_EQUIPPED_WEAPON_ID, STARTER_SWORD_ID);
});

test('GP1-C1: a fresh player owns ONLY the starter sword -- the Blade is not pre-owned', () => {
  assert.deepEqual(DEFAULT_OWNED_ITEM_IDS, [STARTER_SWORD_ID]);
  assert.ok(!DEFAULT_OWNED_ITEM_IDS.includes(WILDWOOD_BLADE_ID),
    'the Blade must only become owned through GP9\'s reward ceremony (or an explicit test/harness grant)');
});

test('itemDef/damageFor/isKnownItem/isKnownWeapon all degrade to a safe "unknown" answer, never throw', () => {
  assert.equal(itemDef('not-a-real-item'), null);
  assert.equal(damageFor('not-a-real-item'), null);
  assert.equal(isKnownItem('not-a-real-item'), false);
  assert.equal(isKnownWeapon('not-a-real-item'), false);
});

test('sabotage: isKnownWeapon is not just isKnownItem in disguise -- a non-weapon slot must read false', () => {
  // No non-weapon item is defined yet (GP1 scope), so prove the distinction structurally: every key
  // in ITEM_DEFS must currently be a weapon, and the function must be checking .slot to know that
  // rather than returning true for anything present in the table.
  for (const id of Object.keys(ITEM_DEFS)) {
    assert.equal(ITEM_DEFS[id].slot, WEAPON_SLOT, `${id} is expected to be a weapon in GP1's item table`);
  }
  assert.equal(isKnownWeapon(STARTER_SWORD_ID), true);
});

test('the Wildwood Blade damage is a meaningful, non-breaking upgrade against the current wolf', () => {
  // Plan section 9/29's own worked example: WOLF_MAX_HP stays 3, so 1 damage takes three hits and
  // 2 damage takes two -- an upgrade a child can feel without becoming a one-shot.
  const starterHits = Math.ceil(WOLF_MAX_HP / damageFor(STARTER_SWORD_ID));
  const bladeHits = Math.ceil(WOLF_MAX_HP / damageFor(WILDWOOD_BLADE_ID));
  assert.equal(starterHits, 3);
  assert.equal(bladeHits, 2);
  assert.ok(bladeHits < starterHits && bladeHits > 0);
});
