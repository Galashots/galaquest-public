// Progression item definitions. Pure data, no three.js, no DOM, no I/O -- the same discipline
// combat/encounter.js and rewards/marks.js already keep, and for the same reason: net/gameServer.mjs
// imports files under public/src/ directly (see e.g. its own import of rewards/marks.js), so anything
// the server needs to validate against has to stay framework-free to be importable there at all.
//
// G1 keeps the catalogue small and data-driven: the shipping starter/Blade weapons plus the truthful
// baseline Shield and the first earned Helmet. This is item authority, not an inventory UI or loot
// table; slots that have no real G1 item remain absent.
//
// Damage values are read off this file, never restated (GQ-007) -- by the Hero screen's comparison
// card, by progression/heroStats.js when it adds what a hero's LEVEL is worth on top, and through
// that by the combat rules that decide what a landed hit costs.
//
// ── THE P2 RESCALE ──────────────────────────────────────────────────────────────────────────────
//
// These were 1 and 2, and they were hit counters rather than damage: a wolf had 3 hp, so "2" meant
// "half a wolf". That resolution cannot express a Hero level being worth +2 damage on top of a
// weapon, which is why docs/product/PROGRESSION_CONTRACT_V0.md names scalable stat resolution as a
// hard predecessor to honest level tuning.
//
// So both are multiplied by ten alongside combat/encounter.js's own rescale, and the RELATIONSHIPS
// the old pair established are preserved exactly rather than re-derived: against a 30hp wolf, 10
// still takes three blows and 20 still takes two. test/level-one-preservation.test.mjs pins that,
// because a preserved promise nobody checks is a promise until the next re-tune.

export const WEAPON_SLOT = 'weapon';
export const SHIELD_SLOT = 'shield';
export const HELMET_SLOT = 'helmet';

export const EQUIPMENT_SLOTS = Object.freeze([WEAPON_SLOT, SHIELD_SLOT, HELMET_SLOT]);

export const STARTER_SWORD_ID = 'starter_sword';
export const WILDWOOD_BLADE_ID = 'wildwood_blade';
export const SHIELD_IRONWOOD_ID = 'shield_ironwood';
export const HELMET_SILVERGUARD_ID = 'helmet_silverguard';

// Each def below may optionally carry `ordinaryDrop: true` (see ORDINARY_DROP_ITEM_IDS further down
// this file) -- absent, on every item currently defined, means false. None does yet; that is R1's
// deliberately honest starting state, not an oversight.
export const ITEM_DEFS = Object.freeze({
  [STARTER_SWORD_ID]: Object.freeze({
    id: STARTER_SWORD_ID,
    slot: WEAPON_SLOT,
    name: 'Starter Sword',
    damage: 10,
  }),
  // TWICE THE STARTER SWORD, which is the promise G4's reward ceremony actually made to a child and
  // the one P2's rescale had to carry over intact. Written as its own catalogue value rather than as
  // `starter * 2`: what an item is worth is this file's to state, and the day a third weapon exists
  // it will not be a multiple of anything. The clearing already carries a physical placeholder for
  // this item -- world/wildwoodBlade.js's planted prop, in the same WILDWOOD_COLOR -- so the Hero
  // screen's item card reuses that colour rather than inventing a second opinion about what this
  // weapon looks like.
  [WILDWOOD_BLADE_ID]: Object.freeze({
    id: WILDWOOD_BLADE_ID,
    slot: WEAPON_SLOT,
    name: 'Wildwood Blade',
    damage: 20,
  }),
  [SHIELD_IRONWOOD_ID]: Object.freeze({
    id: SHIELD_IRONWOOD_ID,
    slot: SHIELD_SLOT,
    name: 'Ironwood Shield',
    damageReductionPercent: 0,
  }),
  [HELMET_SILVERGUARD_ID]: Object.freeze({
    id: HELMET_SILVERGUARD_ID,
    slot: HELMET_SLOT,
    name: 'Silverguard Helmet',
    damageReductionPercent: 10,
  }),
});

// ── R1-C2: THE ORDINARY-DROP SEAM, AS A GENERIC METADATA FLAG ──────────────────────────────────────
//
// A MECHANISM, not content: `ordinaryDrop: true` on an item def marks it eligible to be granted
// through rewards/combatRewards.js's low-probability ordinary-combat drop roll (absent, the default
// on every item above, means false -- opt-IN, never opt-out). R1 adds the seam and deliberately
// leaves it empty; G2 is the package that populates it with actual qualified content. See
// docs/briefs/PROGRESSION_R1_COMBAT_XP_LOOT_REWARD_SEAM.md's "production content boundary": it is
// acceptable, and correct, for the live R1 eligible set to be empty until then.
export const ORDINARY_DROP_ITEM_IDS = Object.freeze(
  Object.values(ITEM_DEFS)
    .filter((def) => def.ordinaryDrop === true)
    .map((def) => def.id),
);

// HARD GUARD, at module load rather than trusted as a convention: Rowan's Wildwood Blade and
// Blackthorn Hollow's Silverguard Helmet are AUTHORED, guaranteed rewards (G1/G4/ARC2's own reward
// ceremonies), never an ordinary-combat coin flip. A future edit that adds `ordinaryDrop: true` to
// either item def is a bug the moment the module loads, not a bug somebody notices the first time a
// child gets the wrong drop -- the same "throw at the boundary, not downstream" posture
// test/combat-purity.test.mjs and this file's own isKnownItem/isKnownWeapon guards already keep.
for (const signatureItemId of [WILDWOOD_BLADE_ID, HELMET_SILVERGUARD_ID]) {
  if (ORDINARY_DROP_ITEM_IDS.includes(signatureItemId)) {
    throw new Error(
      `${signatureItemId} must never carry ordinaryDrop: true -- it is an authored signature reward, `
      + 'not an ordinary-combat drop (docs/briefs/PROGRESSION_R1_COMBAT_XP_LOOT_REWARD_SEAM.md)',
    );
  }
}

export const DEFAULT_EQUIPPED_WEAPON_ID = STARTER_SWORD_ID;
export const DEFAULT_EQUIPPED_ITEM_IDS = Object.freeze({
  [WEAPON_SLOT]: DEFAULT_EQUIPPED_WEAPON_ID,
  [SHIELD_SLOT]: SHIELD_IRONWOOD_ID,
});

// G1-C1: a fresh player owns the starter sword and truthful baseline Shield. The Wildwood Blade
// becomes owned exclusively through GP9's authored reward
// ceremony -- shipping it pre-owned, as GP1's first draft did to exercise the compare/equip UI
// before that ceremony existed, would let a normal player equip a weapon they never earned. A
// harness or explicit dev fixture that needs to exercise the owned-Blade path grants it durably
// (net/rewardStore.mjs's 'gear-owned' event, seeded directly the same way
// tools/runtime-test/drive-relight.mjs seeds marks for its own fixture guest) rather than reading
// this constant differently -- this IS the real default for every code path, test and production
// alike.
export const DEFAULT_OWNED_ITEM_IDS = Object.freeze([STARTER_SWORD_ID, SHIELD_IRONWOOD_ID]);

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

export function isKnownEquipment(itemId) {
  return itemDef(itemId) !== null;
}

export function damageFor(itemId) {
  return itemDef(itemId)?.damage ?? null;
}

export function damageReductionPercentFor(itemId) {
  return itemDef(itemId)?.damageReductionPercent ?? 0;
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
