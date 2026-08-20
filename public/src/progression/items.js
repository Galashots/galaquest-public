// Progression item definitions. Pure data, no three.js, no DOM, no I/O -- the same discipline
// combat/encounter.js and rewards/marks.js already keep, and for the same reason: net/gameServer.mjs
// imports files under public/src/ directly (see e.g. its own import of rewards/marks.js), so anything
// the server needs to validate against has to stay framework-free to be importable there at all.
//
// GP1 scope only: weapon slot, two items. The Hero screen (GalaQuest_Gameplay_Expansion_Stream_Plan
// section 8) explicitly wants a small, data-driven Hero surface rather than a 30-slot inventory --
// Shield/Helmet/Shoulders/Chest slots exist in the UI as empty/locked placeholders (ui/heroScreen.js)
// with no items defined here yet. Add a definition here the moment a real one is needed; do not
// pre-populate slots nobody can fill.
//
// Damage values are read off this file, never restated (GQ-007) -- both by the Hero screen's
// comparison card and, from GP9 on, by the combat rules that decide what a landed hit is worth.
// GP1 itself does NOT wire equippedWeaponId into combat/encounter.js: the work order names that GP9's
// job ("Wildwood Blade reward + actual damage change"), and wolf.hp still reads WOLF_DAMAGE_PER_HIT
// as a flat constant until then. Verified against the current rules before writing these numbers:
// WOLF_MAX_HP is 3 and the existing per-hit damage constant is 1, so 1 -> 2 DAMAGE takes a
// three-hit kill to two, exactly the plan's own worked example in section 29.

export const WEAPON_SLOT = 'weapon';

export const STARTER_SWORD_ID = 'starter_sword';
export const WILDWOOD_BLADE_ID = 'wildwood_blade';

export const ITEM_DEFS = Object.freeze({
  [STARTER_SWORD_ID]: Object.freeze({
    id: STARTER_SWORD_ID,
    slot: WEAPON_SLOT,
    name: 'Starter Sword',
    damage: 1,
  }),
  // Provisional/test damage value (plan section 8's own phrase): the real reward ceremony and its
  // final geometry are GP9's job. The clearing already carries a physical placeholder for this item
  // -- world/wildwoodBlade.js's planted prop, in the same WILDWOOD_COLOR -- so the Hero screen's item
  // card reuses that colour rather than inventing a second opinion about what this weapon looks like.
  [WILDWOOD_BLADE_ID]: Object.freeze({
    id: WILDWOOD_BLADE_ID,
    slot: WEAPON_SLOT,
    name: 'Wildwood Blade',
    damage: 2,
  }),
});

export const DEFAULT_EQUIPPED_WEAPON_ID = STARTER_SWORD_ID;

// GP1-C1 (the 2026-08-16 engagement/reward quality-gate review): a fresh player owns ONLY the
// starter sword. The Wildwood Blade becomes owned exclusively through GP9's authored reward
// ceremony -- shipping it pre-owned, as GP1's first draft did to exercise the compare/equip UI
// before that ceremony existed, would let a normal player equip a weapon they never earned. A
// harness or explicit dev fixture that needs to exercise the owned-Blade path grants it durably
// (net/rewardStore.mjs's 'gear-owned' event, seeded directly the same way
// tools/runtime-test/drive-relight.mjs seeds marks for its own fixture guest) rather than reading
// this constant differently -- this IS the real default for every code path, test and production
// alike.
export const DEFAULT_OWNED_ITEM_IDS = Object.freeze([STARTER_SWORD_ID]);

export function itemDef(itemId) {
  return ITEM_DEFS[itemId] ?? null;
}

export function isKnownItem(itemId) {
  return Object.prototype.hasOwnProperty.call(ITEM_DEFS, itemId);
}

export function isKnownWeapon(itemId) {
  const def = itemDef(itemId);
  return def !== null && def.slot === WEAPON_SLOT;
}

export function damageFor(itemId) {
  return itemDef(itemId)?.damage ?? null;
}

/**
 * What one landed blow from `itemId` is worth, with the starter sword as the floor.
 *
 * THIS IS THE SEAM. combat/encounter.js and world/beaconSiege.js resolve a swing against a NUMBER
 * handed in on the per-hero command; they never see an item id and never import this file.
 * test/combat-purity.test.mjs enforces that in as many words -- "route the randomness or time
 * through the command/event seam instead of weakening this list" -- and an item catalogue is
 * exactly what the pure rules layer exists not to know about. So the translation lives here, with
 * the catalogue, and every caller that already knows what a hero has equipped (net/gameServer.mjs
 * for the online fight, main.js for the offline fallback) calls this on the way in.
 *
 * Never null. `damageFor` returning null means "no such item, or an item with no damage" -- a real
 * answer to a different question. A swing, though, always lands for SOMETHING: a hero always has a
 * weapon, and a bookkeeping gap must never turn into a sword that stopped working. So an unknown or
 * absent id resolves to the starter sword, which is what every caller written before equipment was
 * wired up was already getting.
 */
export function swingDamageFor(itemId) {
  return damageFor(itemId) ?? damageFor(DEFAULT_EQUIPPED_WEAPON_ID);
}
