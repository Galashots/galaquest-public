import { strict as assert } from 'node:assert';
import test from 'node:test';

import { WOLF_MAX_HP } from '../public/src/combat/encounter.js';
import {
  DEFAULT_EQUIPPED_WEAPON_ID,
  DEFAULT_OWNED_ITEM_IDS,
  HELMET_SILVERGUARD_ID,
  ITEM_DEFS,
  SHIELD_IRONWOOD_ID,
  STARTER_SWORD_ID,
  WEAPON_SLOT,
  WILDWOOD_BLADE_ID,
  damageFor,
  isKnownItem,
  isKnownWeapon,
  itemDef,
  swingDamageFor,
} from '../public/src/progression/items.js';

test('starter sword and Wildwood Blade are both defined weapons with the brief-specified damage', () => {
  // P2's values (docs/briefs/PROGRESSION_P2_FIRST_HERO_LEVEL_UP.md). They were 1 and 2 -- hit
  // counters against a 3hp wolf -- and the rescale is what gives a Hero level room to be worth +2
  // damage on top of a weapon. The RATIO is the promise and it is unchanged; see the blow-count
  // tests below, which is where that promise is actually pinned.
  assert.equal(itemDef(STARTER_SWORD_ID).damage, 10);
  assert.equal(itemDef(WILDWOOD_BLADE_ID).damage, 20);
  assert.equal(itemDef(STARTER_SWORD_ID).slot, WEAPON_SLOT);
  assert.equal(itemDef(WILDWOOD_BLADE_ID).slot, WEAPON_SLOT);
});

test('the starter sword is the default equipped weapon', () => {
  assert.equal(DEFAULT_EQUIPPED_WEAPON_ID, STARTER_SWORD_ID);
});

test('G1-C1: a fresh player owns the starter sword and truthful baseline Shield -- the Blade/Helmet are not pre-owned', () => {
  assert.deepEqual(DEFAULT_OWNED_ITEM_IDS, [STARTER_SWORD_ID, SHIELD_IRONWOOD_ID]);
  assert.ok(!DEFAULT_OWNED_ITEM_IDS.includes(WILDWOOD_BLADE_ID),
    'the Blade must only become owned through GP9\'s reward ceremony (or an explicit test/harness grant)');
  assert.ok(!DEFAULT_OWNED_ITEM_IDS.includes(HELMET_SILVERGUARD_ID),
    'the Helmet must only become owned through G1\'s reward ceremony (or an explicit test/harness grant)');
});

test('itemDef/damageFor/isKnownItem/isKnownWeapon all degrade to a safe "unknown" answer, never throw', () => {
  assert.equal(itemDef('not-a-real-item'), null);
  assert.equal(damageFor('not-a-real-item'), null);
  assert.equal(isKnownItem('not-a-real-item'), false);
  assert.equal(isKnownWeapon('not-a-real-item'), false);
});

test('sabotage: isKnownWeapon is not just isKnownItem in disguise -- non-weapon slots read false', () => {
  for (const id of Object.keys(ITEM_DEFS)) {
    assert.equal(isKnownWeapon(id), ITEM_DEFS[id].slot === WEAPON_SLOT,
      `${id} must be classified by its slot`);
  }
  assert.equal(isKnownWeapon(STARTER_SWORD_ID), true);
  assert.equal(isKnownWeapon(SHIELD_IRONWOOD_ID), false);
  assert.equal(isKnownWeapon(HELMET_SILVERGUARD_ID), false);
});

test('the Wildwood Blade damage is a meaningful, non-breaking upgrade against the current wolf', () => {
  // THE PROMISE, and it survived the P2 rescale unchanged because it was always about blow COUNTS:
  // the starter sword takes three and the Blade takes two -- an upgrade a child can feel without
  // becoming a one-shot. Both the wolf and both weapons moved by ten; this test did not have to.
  const starterHits = Math.ceil(WOLF_MAX_HP / damageFor(STARTER_SWORD_ID));
  const bladeHits = Math.ceil(WOLF_MAX_HP / damageFor(WILDWOOD_BLADE_ID));
  assert.equal(starterHits, 3);
  assert.equal(bladeHits, 2);
  assert.ok(bladeHits < starterHits && bladeHits > 0);
});

// ── THE SEAM BETWEEN THE CATALOGUE AND THE FIGHT ───────────────────────────────────────────────
//
// swingDamageFor exists here, and not in combat/, because test/combat-purity.test.mjs forbids the
// rules layer from importing anything outside itself and says what to do instead: "route ... through
// the command/event seam". So the fight is handed a NUMBER, and this is the only function allowed to
// turn an item id into one.

test('swingDamageFor reads the catalogue, and never answers "nothing"', () => {
  assert.equal(swingDamageFor(STARTER_SWORD_ID), damageFor(STARTER_SWORD_ID));
  assert.equal(swingDamageFor(WILDWOOD_BLADE_ID), damageFor(WILDWOOD_BLADE_ID));
  assert.ok(swingDamageFor(WILDWOOD_BLADE_ID) > swingDamageFor(STARTER_SWORD_ID),
    'the reward at the end of the longest promise in the game has to be worth more than the start');
  // damageFor returns null for "no such item" -- a true answer to a different question. A SWING,
  // though, always lands for something: a hero always has a weapon, and a bookkeeping gap must
  // never become a sword that stopped working.
  for (const nothing of [null, undefined, '', 'no_such_item', 42]) {
    assert.equal(swingDamageFor(nothing), damageFor(DEFAULT_EQUIPPED_WEAPON_ID),
      `an unnamed weapon is the starter sword, not zero damage (got it for ${JSON.stringify(nothing)})`);
  }
});

test('the Wildwood Blade turns a three-blow wolf into a two-blow wolf', () => {
  // The number that makes the reward mean something, stated where a reader can check it against
  // WOLF_MAX_HP without running a fight. encounter-party.test.mjs proves the rules actually do it.
  assert.equal(Math.ceil(WOLF_MAX_HP / swingDamageFor(STARTER_SWORD_ID)), 3);
  assert.equal(Math.ceil(WOLF_MAX_HP / swingDamageFor(WILDWOOD_BLADE_ID)), 2);
});
