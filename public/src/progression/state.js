// GP1's client-side progression reads, in the same shape world/zoneLoader.js's
// lanternUnlockedFromRewards already established for reading one field off a `rewards[heroId]`
// entry: a tiny pure function per field, not a stateful "controller" object. main.js keeps holding
// its own online/offline branch inline (see its `rewardsForRelight`-style reads) rather than this
// module owning that branching -- copying the convention already in force there, not inventing a
// second one.

import { DEFAULT_EQUIPPED_WEAPON_ID, DEFAULT_OWNED_ITEM_IDS, isKnownWeapon } from './items.js';

/** The equipped weapon id off one hero's `rewards` entry -- online, `serverEncounter.rewards[id]`;
 *  offline, main.js's own local shape. Undefined/null (pre-welcome, or a hero with no entry yet)
 *  falls back to the starter sword: a hero always has SOME weapon equipped, there is no "unknown"
 *  state worth representing on the client any more than there was one worth representing on the
 *  server (see net/gameServer.mjs's rewardsFor, which fills the same default before this ever runs). */
export function equippedWeaponIdFromRewards(rewards) {
  const id = rewards?.equippedWeaponId;
  return typeof id === 'string' && id.length > 0 ? id : DEFAULT_EQUIPPED_WEAPON_ID;
}

/** GP1-C1: real ownership, read off the wire's `rewards[heroId].ownedItemIds` (net/gameServer.mjs's
 *  rewardsFor, additive field, net/protocol.js's decodeRewards). Falls back to
 *  DEFAULT_OWNED_ITEM_IDS (starter sword only) for every "not known yet" shape -- pre-welcome, an
 *  old fixture that never carried the field, or a malformed/empty array -- the same "always a safe
 *  default, never nothing" discipline equippedWeaponIdFromRewards already uses just above. */
export function ownedItemIdsFromRewards(rewards) {
  const ids = rewards?.ownedItemIds;
  return Array.isArray(ids) && ids.length > 0 ? ids : DEFAULT_OWNED_ITEM_IDS;
}

/** Whether requesting `itemId` is even worth sending -- a Hero screen only ever offers ids it
 *  already knows are legal weapons, but this is exported so main.js's equip handler and a runtime
 *  harness can both fail the same obviously-wrong request the same way, without either one having
 *  to reach into net/protocol.js or net/gameServer.mjs to know what "legal" means. */
export function canEquip(itemId) {
  return isKnownWeapon(itemId);
}
