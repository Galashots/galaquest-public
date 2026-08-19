// public/src/village/economy.js
//
// GP3: Village Supplies -- one shared coin/Wildwood-Shard balance, and the first thing it can buy.
// Pure and isomorphic the same way world/cartLoot.js is (that file's own header explains the
// reasoning): no I/O, no knowledge of SQLite or the wire, just the numbers and the one rule ("can
// this be bought") a client's own Board UI and the server's purchase handler both have to agree on,
// so they can never quietly disagree about whether the UPGRADE button should be enabled.
//
// Sibling of world/cartLoot.js, not a corner of it: this module knows nothing about pickups, carts,
// or the physical world -- only about the shared totals cartLoot's own coin-earned/shard-earned
// events resolve to (net/rewardStore.mjs's totalCoinsEarned/totalShardsEarned), and what they can
// buy.

// The brief's own naming (GalaQuest_GP3_Village_Board_FINAL_2026-08-16.md, section 2.3): the
// event's own existence is both proof of ownership and the reason its cost was subtracted, so this
// id doubles as the durable eventId net/rewardStore.mjs's apply() records it under.
export const WORKSHOP_I_ID = 'village-upgrade:workshop:1';

// Section 3: Workshop I costs 2 coins + 1 Wildwood Shard. Against the guaranteed 3-coin/2-shard GP2
// haul, that deliberately leaves 1 coin + 1 shard -- "I found resources -> I can use them now -> the
// Village changed -> I still have something left" is the brief's own worked lesson, not incidental.
export const WORKSHOP_I_COST = Object.freeze({ coins: 2, shards: 1 });

/**
 * True when the shared Village Supplies balance covers Workshop I's cost and it is not already
 * owned. The one affordability rule both a client's own "is UPGRADE enabled" question and the
 * server's purchase handler run against.
 */
export function canAffordWorkshopI(totalCoins, totalShards, workshopOwned) {
  if (workshopOwned) return false;
  return totalCoins >= WORKSHOP_I_COST.coins && totalShards >= WORKSHOP_I_COST.shards;
}

/**
 * The shared balance actually left to spend/display: totals earned, minus Workshop I's cost once
 * it is owned. Does not itself decide ownership -- callers pass workshopOwned from wherever they
 * already have it (the village wire block, or net/rewardStore.mjs's own villageUpgradeOwned).
 */
export function remainingVillageSupplies(totalCoins, totalShards, workshopOwned) {
  if (!workshopOwned) return { coins: totalCoins, shards: totalShards };
  return { coins: totalCoins - WORKSHOP_I_COST.coins, shards: totalShards - WORKSHOP_I_COST.shards };
}
