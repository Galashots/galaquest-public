// public/src/world/cartLoot.js
//
// GP2: Rowan's cart, searched once, bursts a FIXED haul of coins and Wildwood Shards into the world
// around it. Isomorphic (client renders from it, server enforces it) the same way
// combat/encounter.js's own party engine is a shared authority seam -- but that file is scoped
// tightly to the wolf/hero fight (its own header says so, and public/src/combat/ is a guarded
// directory this stream does not edit), so this is a SIBLING pure module, not a new corner of it.
//
// DETERMINISTIC ON PURPOSE (the Engagement & Reward Quality Gate's own GP2 rule): the whole point of
// a first authored haul is that GP3's first Workshop cost can be set against a KNOWN number, not a
// random one. See the private engineering archive's GP2 section for the exact recorded amounts this table
// produces.
//
// Deliberately carries no `events` array the way encounter.js's command results do. Every fact a
// client needs (has the cart been searched, which pickups are gone, who took them) is already
// present, in full, in the state this module publishes -- so main.js drives the burst/collect/despawn
// sequence by DIFFING that published state frame to frame (the same technique zoneLoader.js's
// treeLitTransition and world/trail.js's per-bramble blow-count already use), not by chasing a
// transient event a client could miss on a dropped packet or a mid-session join. A reconnecting or
// late-joining client that has never seen a single loot event still renders the correct picture the
// instant its first snapshot arrives, for free.

import { CART_SEARCH } from './zones/village.js';

export const COIN_KIND = 'coin';
export const SHARD_KIND = 'shard';

// The exact, guaranteed first-cart haul: 3 coins + 2 shards, 5 objects total. Enough to read as a
// burst; few enough a child can watch each one land and be gone before it turns into noise. Offsets
// are relative to CART_SEARCH.at (imported, not restated -- the same "derive it" rule CART_SEARCH
// itself already follows against PROPS), scattered EAST/SOUTH-EAST of the cart: the only clutter
// nearby is the broken fence at dx roughly -1.7 (west), so every offset below keeps offsetX >= +1.0,
// comfortably clear of it, of Rowan (CART_SEARCH.at + [3.7, -0.8] roughly), and of the planted
// Wildwood Blade prop.
export const CART_LOOT_TABLE = Object.freeze([
  Object.freeze({ id: 'cart-loot:coin:0', kind: COIN_KIND, offsetX: 1.6, offsetZ: 0.4 }),
  Object.freeze({ id: 'cart-loot:coin:1', kind: COIN_KIND, offsetX: 1.9, offsetZ: -0.6 }),
  Object.freeze({ id: 'cart-loot:coin:2', kind: COIN_KIND, offsetX: 1.0, offsetZ: 1.5 }),
  Object.freeze({ id: 'cart-loot:shard:0', kind: SHARD_KIND, offsetX: 2.2, offsetZ: 0.9 }),
  Object.freeze({ id: 'cart-loot:shard:1', kind: SHARD_KIND, offsetX: 2.0, offsetZ: -1.3 }),
]);

export const CART_LOOT_COIN_COUNT = CART_LOOT_TABLE.filter((pickup) => pickup.kind === COIN_KIND).length;
export const CART_LOOT_SHARD_COUNT = CART_LOOT_TABLE.filter((pickup) => pickup.kind === SHARD_KIND).length;

const PICKUP_BY_ID = new Map(CART_LOOT_TABLE.map((pickup) => [pickup.id, pickup]));

/** A pickup's own definition, or null for an id nobody defined -- the same "unknown is a clean no",
 *  not a throw, that a stale or hostile client's message deserves (isKnownWeapon's own posture). */
export function pickupDef(pickupId) {
  return PICKUP_BY_ID.get(pickupId) ?? null;
}

// Generous, the same "a trigger for a thumb, not a keyhole" reasoning CART_SEARCH's own radius is
// built on -- collecting one coin off the ground is a smaller ask than finding the cart in the first
// place, so this is tighter than CART_SEARCH's 2.4m but still forgiving of an imprecise young player
// tap-and-walk.
export const PICKUP_COLLECT_RADIUS_METERS = 1.3;

/** A pickup's absolute world position, from the shared cart anchor. Imported by both the server (the
 *  collect-radius check below) and the client (rendering) so there is exactly one scatter geometry,
 *  never a second guess at where "cart-loot:coin:0" actually sits. */
export function pickupWorldPosition(pickup, cartAt = CART_SEARCH.at) {
  return { x: cartAt[0] + pickup.offsetX, z: cartAt[1] + pickup.offsetZ };
}

function freezeLoot(next) {
  return Object.freeze({ spawned: next.spawned, collected: Object.freeze({ ...next.collected }) });
}

/** A fresh cart: not yet searched, nothing collected. */
export function createCartLootState() {
  return freezeLoot({ spawned: false, collected: {} });
}

// GP3-0: the collector heroId a restored pickup is stamped with. The real heroId that originally
// collected it lived only in that past server process's in-memory players map (net/gameServer.mjs's
// `p1`, `p2`, ... never survive a restart, unlike the durable award itself) -- so nobody live can
// recover it, and nobody needs to: world/lootPickups.js's presenter only ever compares
// `collectedBy === selfHeroId` to decide "is this MY attraction flight", and no hero connecting to a
// freshly booted process was ever assigned this string, so every present client takes the "someone
// else's pickup, despawn silently" branch for it -- exactly right for a pickup nobody here collected.
export const RESTORED_COLLECTOR_ID = 'restored';

/**
 * Rebuild cart state from pickup ids already durably credited (net/rewardStore.mjs's
 * creditedLootIds()), for server boot only. This is the fix for GP2's restart-coherence defect: the
 * lootState this module's own createCartLootState() produces lives in memory and forgets everything
 * on restart, but a credited pickup's durable award does not -- without this, an already-paid-for
 * pickup would present as fresh collectible loot again, and a client tapping it would get the burst
 * animation but no currency, because the durable store's own idempotency silently swallows the
 * replayed award.
 *
 * An id this table does not define is ignored rather than thrown -- the same "unknown is a clean no"
 * posture pickupDef itself already takes on a stale/unrecognised id, kept here so a future award type
 * that happens to reuse the coin-earned/shard-earned durable types (see rewardStore.mjs's own
 * creditedLootIds comment) cannot crash a boot.
 *
 * The cart presents as searched (spawned: true) whenever at least one id restores -- a durable
 * coin-earned/shard-earned row can only exist if SEARCH already fired in some earlier run. Zero
 * credited ids restores a plain createCartLootState() (spawned: false): a cart that was searched but
 * had nothing collected before a restart is allowed to look genuinely fresh again for this slice
 * (see this repo's GP3 brief, section 1) -- only an ALREADY-CREDITED pickup may never look fresh.
 */
export function restoreCartLootState(creditedPickupIds) {
  const collected = {};
  for (const pickupId of creditedPickupIds) {
    if (pickupDef(pickupId)) collected[pickupId] = RESTORED_COLLECTOR_ID;
  }
  return freezeLoot({ spawned: Object.keys(collected).length > 0, collected });
}

/**
 * SEARCH the cart. Idempotent: the first call ever spawns the whole authored haul; every call after
 * that -- a second player reaching the cart, or a reconnecting client resending its own local trigger
 * -- is a plain no-op returning the SAME state reference. This IS "the physical loot exists once in
 * the shared world and reconnect/retry cannot award it again" for the SPAWN half of that rule; the
 * COLLECT half is requestCollectLoot's job, below.
 *
 * No heroId parameter, unlike requestPartyAttack: whoever searches first, the world reacts the same
 * way for every connected client, so there is no "whose event is this" question to answer.
 */
export function requestSearchCart(state) {
  if (state.spawned) return state;
  return freezeLoot({ ...state, spawned: true });
}

/**
 * Ask to collect one pickup. Rejected (state unchanged, accepted: false) when: the cart has not been
 * searched yet, pickupId names no known pickup, it is already collected by someone (first request to
 * arrive for a given id wins -- this is the actual "cannot be awarded twice" enforcement, sitting in
 * the same pure, server-run state a reconnect cannot bypass), or heroPosition is not actually close
 * enough -- the same "server owns physical truth" posture combat/encounter.js's isWithinStrike
 * already takes for a sword's reach, applied here to a walk-up-and-grab instead of a swing.
 */
export function requestCollectLoot(state, heroId, pickupId, heroPosition, cartAt = CART_SEARCH.at) {
  if (!state.spawned) return { state, accepted: false };
  const pickup = pickupDef(pickupId);
  if (!pickup) return { state, accepted: false };
  if (Object.prototype.hasOwnProperty.call(state.collected, pickupId)) return { state, accepted: false };

  const at = pickupWorldPosition(pickup, cartAt);
  const distance = Math.hypot(heroPosition.x - at.x, heroPosition.z - at.z);
  if (distance > PICKUP_COLLECT_RADIUS_METERS) return { state, accepted: false };

  const collected = { ...state.collected, [pickupId]: heroId };
  return { state: freezeLoot({ ...state, collected }), accepted: true };
}
