// The authoritative simulation. Clients send intent; this decides where everyone actually is.
//
// Spec section 3 fixes the shape: server-authoritative, clients send intent only. That is not
// premature rigour -- retrofitting authority onto a trusting server means rewriting every system
// built on top of it, and the alternative here is two children who can walk through each other.
//
// The speed law is imported from the client's own locomotion module rather than restated. If the two
// ever disagree, the hero rubber-bands on every snapshot, and a duplicated constant is the most
// likely way for that to happen quietly.

import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import {
  HERO_MAX_HP,
  addHero,
  createPartyEncounterState,
  removeHero,
  requestPartyAttack,
  separateFromEnemies,
  stepParty,
} from '../public/src/combat/encounter.js';
import { RUN_SPEED, groundSpeedForInput } from '../public/src/character/speed.js';
import { ProtocolError, decode, encode, leaveMessage, roundToWire, snapshotMessage, welcomeMessage }
  from '../public/src/net/protocol.js';
import { MARKS_TO_UNLOCK, createRewardLedger, foldEvents } from '../public/src/rewards/marks.js';
// R1-C1: the one combat-XP law, imported rather than restated -- see combatRewards.js's own header
// for why the offline fallback (public/src/rewards/offlineProgress.js) asks the SAME two functions.
// R1-C2 adds decideCombatReward: the SAME law, extended to also decide gear ownership -- see its own
// header for the eligibility-before-chance-before-selection contract this file never re-implements.
import {
  MAX_COMBAT_XP_PER_KILL, combatXpEventId, combatXpFor, decideCombatReward, gearOwnedEventId,
} from '../public/src/rewards/combatRewards.js';
import {
  DEFAULT_EQUIPPED_ITEM_IDS, DEFAULT_EQUIPPED_WEAPON_ID, DEFAULT_OWNED_ITEM_IDS,
  ORDINARY_DROP_ITEM_IDS, isKnownItem, itemDef,
} from '../public/src/progression/items.js';
// One authority for "is this a fact a profile can durably own" (GQ-007). rewardStore.mjs already
// imports latestEquippedWeaponId from this module for the same reason -- the rule lives in one file
// and the server consumes it rather than keeping a second list that drifts.
import {
  isClientRestorableProfileFact, isSemanticallyValidEquipmentFact, parseXpFactAmount, pendingLanternXpFact,
} from '../public/src/progression/facts.js';
import { LEVEL_1_STARTER_STATS, resolveHeroStats } from '../public/src/progression/heroStats.js';
import {
  COIN_KIND, createCartLootState, pickupDef, requestCollectLoot, requestSearchCart,
  restoreCartLootState,
} from '../public/src/world/cartLoot.js';
import { WORKSHOP_I_COST, WORKSHOP_I_ID } from '../public/src/village/economy.js';
// G2/G3: the Beacon siege's rules, imported exactly the way the wolf's are -- the server owns the
// fight because the fight is SHARED (one boss, one health bar, two children hitting it), and
// world/beaconSiege.js is framework-free for precisely this reason.
import {
  addSiegeHero,
  createSiegeState,
  removeSiegeHero,
  requestSiegeAttack,
  restoreLitSiege,
  siegeHeroBody,
  stepSiege,
  transferSiegeHeroBody,
} from '../public/src/world/beaconSiege.js';
import {
  BEACON_ARENA, BEACON_WARDEN, CART_SEARCH, COLD_SEALS, ENEMY_POPULATION, HERO_SPAWN, HOLLOW,
  RANGER_CLAIM, RECOVERY_SANCTUARY, ROWAN_CLAIM, WOLF_SPAWN, WOLF_SPAWNS,
} from '../public/src/world/zones/village.js';
import { rowanOwesBlade } from '../public/src/world/rowanSpeech.js';
import { rangerOwesCharm, rangerSanctuaryHolds } from '../public/src/world/rangerSpeech.js';
import { HELMET_SILVERGUARD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
import {
  WORLD_LIMIT, WORLD_LIMIT_EAST, WORLD_LIMIT_NORTH, clampToWorldX, clampToWorldZ,
} from '../public/src/world/bounds.js';
import { MAX_PREDICTION_STEP_SECONDS } from '../public/src/net/prediction.js';
import { openRewardStore } from './rewardStore.mjs';
import { attachWebSocketServer } from './wsServer.mjs';

// G5: what the Blackthorn Hollow's chest pays. Three, because it is a SECRET and not a quest reward
// -- enough to feel like a find next to the cart's own haul, not so much that skipping the arc's
// authored rewards in favour of hunting caches would ever be the better play.
export const HOLLOW_CACHE_SHARDS = 3;

// ARC 2's CHARM_BONUS_HEARTS USED TO LIVE HERE, and it does not any more.
//
// It was "one heart" against a three-heart body -- roughly a third more room, which is exactly the
// note the child playtesters gave when they called the wolves "a little strong". P2 makes max HP a
// derived Hero stat rather than a count of pips, and a charm is a durable fact about a BODY: the
// offline fallback in public/src/main.js has to resolve the same body from the same law, and it
// cannot import this server-only module. So the number moved to the one place both sides can read
// it -- progression/heroStats.js's WREN_CHARM_MAX_HP_BONUS -- with its meaning preserved exactly
// (10 of a 30hp body is the same third) rather than re-tuned on the way past.

export const TICK_HZ = 20;
export const SNAPSHOT_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;

// The walkable bounds are IMPORTED, not declared here (see public/src/world/bounds.js): the client
// has to clamp its own prediction to the same edge or reconciliation snaps the hero back off the
// world's rim, and a browser cannot import this server-only module. Re-exported so this module's
// existing callers and tests keep their single import site, exactly as WOLF_SPAWN is below.
export { WORLD_LIMIT, WORLD_LIMIT_EAST, WORLD_LIMIT_NORTH, clampToWorldX, clampToWorldZ };

// Where the wolf stands. IMPORTED from the zone that places it, not declared here (Phase R2,
// docs/MISTAKES.md GQ-007): this used to be a hand-written `{ x: 2.5, z: 8 }` and main.js used to be
// a second one, kept equal only by a human noticing and by a test that watched them for drift.
// Task B3's binding interface -- the online and offline wolves standing on the same square metre of
// ground -- is now true by construction rather than by vigilance.
//
// Re-exported so this module's own callers and tests keep a single import site, and because a server
// consumer asking the SERVER where the wolf spawns is the sensible seam; the value it hands back
// just isn't invented here any more.
export { WOLF_SPAWN, WOLF_SPAWNS };

// An input older than this stops the player. Without it a dropped connection leaves a hero running
// forever -- a client that vanishes mid-stride never sends the zero-magnitude release.
export const STALE_INPUT_MS = 1000;

// Resolved relative to this file, not process.cwd(), so `node server.mjs` behaves the same whatever
// directory it is launched from -- the same reasoning server.mjs's own PUBLIC_DIR already uses.
// data/ is net/'s sibling at the repo root; data/README.md is the custody record for what lives here.
export const DEFAULT_REWARD_STORE_PATH = fileURLToPath(new URL('../data/rewards.db', import.meta.url));


/**
 * The reward wiring, kept separate from createSimulation() on purpose: guestId is a CONNECTION
 * concept (which socket claimed which persistent identity), not a combat-rules concept, and
 * createSimulation() has no business knowing it. This is the seam a test can drive directly --
 * join()/processTick()/rewardsFor()/leave() -- with no HTTP server and no real timers, the same way
 * createSimulation() itself is tested directly in test/gameServer-encounter.test.mjs, so proving
 * "kill a wolf, guest gets a mark, restart the store, mark survives" does not need a real fight
 * played out over real sockets and real wall-clock seconds.
 *
 * @param options.rewardStorePath  defaults to DEFAULT_REWARD_STORE_PATH (the real, tracked data/
 *   directory). Tests always override this to a path under the OS temp dir.
 * @param options.random  R1-C2: the RNG source applyCombatRewards' gear-drop decision rolls against.
 *   Defaults to Math.random -- production's real answer -- and is injected here (rather than called
 *   directly anywhere in this file) purely so a test can hand in a scripted sequence. It is passed
 *   straight through to rewards/combatRewards.js's decideCombatReward, which is the only place it is
 *   ever actually called, and never inside public/src/combat/ (test/combat-purity.test.mjs's own ban).
 * @param options.dropCatalogue  R1-C2: the ordinary-drop eligible-id list applyCombatRewards checks
 *   against. Defaults to progression/items.js's ORDINARY_DROP_ITEM_IDS -- production's real answer,
 *   currently EMPTY -- and exists ONLY so a test can prove the full server round trip (a real store,
 *   a real transactional batch, a real reward event) with a fixture id, without R1 shipping actual
 *   drop content. Never read from anywhere else in this file; this is the one seam.
 */
export function createRewardCoordinator(options = {}) {
  const store = openRewardStore(options.rewardStorePath ?? DEFAULT_REWARD_STORE_PATH);
  const random = options.random ?? Math.random;
  const dropCatalogue = options.dropCatalogue ?? ORDINARY_DROP_ITEM_IDS;
  // playerId -> guestId, for connections that supplied one at join. A playerId with no entry here
  // is ephemeral: still rewarded for the session (`ephemeral` below), never persisted.
  const guestIdByPlayer = new Map();
  // playerId -> { marks, unlocked, seenEventIds } for guestId-less connections. Lost on disconnect,
  // by construction -- see brief D3: "absent -> server treats the connection as ephemeral (no
  // persistence, marks still count in-memory for the session)".
  const ephemeral = new Map();
  let ledger = createRewardLedger();
  // playerId -> itemId, for the ephemeral (guestId-less) equip fallback -- mirrors `ephemeral` above,
  // kept as its own map rather than folded into that one's shape because equip has nothing to do with
  // marks/lantern and every one of that map's three fields (marks, unlocked, seenEventIds) would sit
  // unused on an equip-only connection.
  const ephemeralEquipment = new Map();
  // playerId -> { coins, shards }, the GP2 ephemeral (guestId-less) fallback -- mirrors `ephemeral`
  // above, kept as its own map for the same reason ephemeralEquipped is: an equip-or-loot-only
  // connection has nothing to do with marks/lantern, and every field of `ephemeral`'s own shape would
  // sit unused on it.
  const ephemeralLoot = new Map();
  // GP3 shared state rides every 10 Hz snapshot. Seed the durable truth once; update this mirror
  // only when store.apply() actually inserts a globally-idempotent event. A restart reconstructs
  // the exact same state from SQLite here without paying three synchronous reads every snapshot.
  let villageCoinsEarned = store.totalCoinsEarned();
  let villageShardsEarned = store.totalShardsEarned();
  let workshopOwned = store.villageUpgradeOwned(WORKSHOP_I_ID);

  function join(playerId, guestId) {
    if (typeof guestId === 'string' && guestId.length > 0) guestIdByPlayer.set(playerId, guestId);
  }

  function hasDurableIdentity(playerId) {
    return guestIdByPlayer.has(playerId);
  }

  function leave(playerId) {
    guestIdByPlayer.delete(playerId);
    ephemeral.delete(playerId);
    ephemeralEquipment.delete(playerId);
    ephemeralLoot.delete(playerId);
  }

  /**
   * GP1-C1's fixture hook, and ONLY that -- no client message ever calls this (see net/protocol.js:
   * `equip` exists on the wire, a `grant`/`own` message deliberately does not, because there is no
   * legitimate production trigger for "give yourself an item" until GP9's reward ceremony exists).
   * A guested connection's grant is durable (net/rewardStore.mjs's 'gear-owned' event, the same
   * table equip/marks/lantern use); an ephemeral one has no durable path to grant into and this is a
   * no-op for it, consistent with ownedItemIdsFor's own treatment of ephemeral connections.
   */
  /**
   * Announce a durable fact the store has just accepted, under the id it was written with.
   *
   * One helper rather than the same three lines in five grant paths, because the rule is one rule:
   * a profile fact the device is not TOLD about is one it can only learn from the next welcome, and
   * a reward database lost in between takes it with it. A count on the rewards block cannot stand in
   * -- fold a count into a grow-only set and every reconnect adds it again. Only a named fact merges.
   *
   * Returns an array so a caller can hand it straight to simulation.announceRewardFacts, and an
   * EMPTY one when the write was a replay: re-claiming is not a second grant and must not announce
   * one. Announcing is deliberately separate from writing -- the store decides what is true, this
   * only decides who hears about it.
   */
  function announcementFor(result, fact) {
    return result.applied ? [fact] : [];
  }

  function grantOwnership(playerId, itemId) {
    const guestId = guestIdByPlayer.get(playerId);
    if (!guestId) return [];
    const eventId = `own:${guestId}:${itemId}`;
    const result = store.apply({ guestId, heroId: playerId, type: 'gear-owned', eventId, value: itemId });
    return announcementFor(result, { type: 'gear-owned', heroId: playerId, eventId, value: itemId });
  }

  /**
   * G4: Rowan keeps his word. Grants the Wildwood Blade durably to whoever asked, ONCE, and reports
   * whether this call is the one that actually did it -- the caller uses that to decide whether to
   * fire the unlock ceremony, so a resend (or a second child claiming their own) never replays
   * somebody else's fanfare.
   *
   * Ownership is PER GUEST and the eventId carries the guestId, which is the whole co-op rule from
   * the design brief made mechanical: one brother claiming his Blade cannot consume the other's.
   * Deliberately reuses grantOwnership's own `own:` id shape, so claiming twice is one row.
   *
   * An ephemeral (guestId-less) connection gets `granted: false` and no error: it has no durable
   * identity to own anything with, the same posture ownedItemIdsFor already takes -- and the
   * ceremony is silently skipped rather than played for a possession that will not survive the tab.
   */
  function claimWildwoodBlade(playerId) {
    const guestId = guestIdByPlayer.get(playerId);
    if (!guestId) return { granted: false, facts: [] };
    const result = store.apply({
      guestId,
      heroId: playerId,
      type: 'gear-owned',
      eventId: `own:${guestId}:${WILDWOOD_BLADE_ID}`,
      value: WILDWOOD_BLADE_ID,
    });
    return {
      granted: result.applied,
      facts: announcementFor(result, {
        type: 'gear-owned',
        heroId: playerId,
        eventId: `own:${guestId}:${WILDWOOD_BLADE_ID}`,
        value: WILDWOOD_BLADE_ID,
      }),
    };
  }

  /**
   * ARC 2: the fallen ranger's satchel, lifted off the floor of Blackthorn Hollow. Once per guest,
   * ever, and per guest rather than per world for the same reason the Blade is: two brothers each
   * pick it up for themselves. A satchel that only one child could ever carry would mean the other
   * one never gets to be the person who brings it back.
   */
  function claimSatchel(playerId) {
    const guestId = guestIdByPlayer.get(playerId);
    if (!guestId) return { granted: false, facts: [] };
    const result = store.apply({
      guestId, heroId: playerId, type: 'satchel-taken',
      eventId: `satchel:${guestId}`, value: null,
    });
    return {
      granted: result.applied,
      facts: announcementFor(result, {
        type: 'satchel-taken', heroId: playerId, eventId: `satchel:${guestId}`,
      }),
    };
  }

  /**
   * ARC 2: Wren's charm -- the first reward in this game that changed what a hero IS rather than
   * what they are holding. Since P2 it is no longer the only one; every Hero level does it too.
   *
   * The row is the durable fact; combat/encounter.js's reconcileMaxHp is what makes it a bigger body,
   * fed from heroStatsFor below. Nothing here writes health directly, which is the whole point of the
   * seam: a body granted by the store rather than by the rules would be a number nobody's fight
   * agreed to.
   */
  function claimCharm(playerId) {
    const guestId = guestIdByPlayer.get(playerId);
    if (!guestId) return { granted: false, facts: [] };
    const result = store.apply({
      guestId, heroId: playerId, type: 'charm-earned',
      eventId: `charm:${guestId}`, value: null,
    });
    return {
      granted: result.applied,
      facts: announcementFor(result, {
        type: 'charm-earned', heroId: playerId, eventId: `charm:${guestId}`,
      }),
    };
  }

  /**
   * G5: the hollow's cache -- three Wildwood Shards, once per guest, ever.
   *
   * Deliberately reuses the ordinary `shard-earned` row rather than inventing a hollow-specific
   * award type: what a child owns at the end of it is shards, and the Village's shared supply should
   * grow from a secret exactly the way it grows from the cart. The eventIds are fixed and
   * guest-scoped, so a resend is a no-op and two brothers each get their own three.
   *
   * Returns how many rows this call actually wrote, so a caller could tell a first claim from a
   * replay. Nothing reads it today; it costs nothing and beats returning undefined.
   */
  function applyHollowCache(playerId) {
    const guestId = guestIdByPlayer.get(playerId);
    if (!guestId) return { granted: 0, facts: [] };
    let granted = 0;
    const facts = [];
    for (let index = 1; index <= HOLLOW_CACHE_SHARDS; index += 1) {
      const eventId = `hollow-cache:${guestId}:${index}`;
      const result = store.apply({
        guestId,
        heroId: playerId,
        type: 'shard-earned',
        eventId,
        value: null,
      });
      if (result.applied) granted += 1;
      facts.push(...announcementFor(result, { type: 'shard-earned', heroId: playerId, eventId }));
    }
    facts.push(...grantOwnership(playerId, HELMET_SILVERGUARD_ID));
    return { granted, facts };
  }

  /** G3: write down that the Old Beacon is burning. A WORLD fact, so the row is not what makes it
   *  true for one guest -- net/rewardStore.mjs's beaconLit() reads it for everybody (see its own
   *  comment). Idempotent on a fixed eventId: the Beacon lights once, ever. The guestId on the row
   *  is provenance only ("who was standing there when it happened"), never a scope. */
  function recordBeaconLit(playerId) {
    const guestId = guestIdByPlayer.get(playerId) ?? null;
    if (!guestId) return { applied: false };
    return store.apply({
      guestId, heroId: playerId, type: 'beacon-lit', eventId: 'beacon-lit:old-beacon', value: null,
    });
  }

  /** Whether the Old Beacon is already burning according to the durable store -- read once at boot
   *  (see attachGameServer) so a restart does not put the fire out. */
  function beaconLit() {
    return store.beaconLit();
  }

  /** Every item this player's guest owns, including the default starter weapon and baseline Shield.
   *  The store deliberately reports only earned rows; this coordinator supplies construction defaults
   *  for both durable and ephemeral profiles. */
  function ownedItemIdsFor(playerId) {
    const guestId = guestIdByPlayer.get(playerId);
    if (!guestId) return [...DEFAULT_OWNED_ITEM_IDS];
    return [...new Set([...DEFAULT_OWNED_ITEM_IDS, ...store.ownedItemIdsFor(guestId)])];
  }

  /** GP3-0: passthrough to the durable store's own creditedLootIds() -- attachGameServer's boot
   *  sequence is the one real caller, reading this BEFORE createSimulation() so the fresh in-memory
   *  cart lootState can be seeded from it (world/cartLoot.js's restoreCartLootState). Exposed here
   *  rather than handing the raw store out, the same "narrow passthrough, not the whole store" shape
   *  every other method on this object already takes. */
  function creditedLootIds() {
    return store.creditedLootIds();
  }

  /**
   * GP3: Village Supplies -- the shared coin/shard totals plus whether Workshop I is owned, exactly
   * the shape net/protocol.js's decodeVillage expects on the wire. Deliberately NOT keyed by heroId
   * the way rewardsFor is: this is one shared number for the whole simulation, not a per-hero view
   * of it (see the GP3 brief's "economy ruling", section 2.1 -- who collected a pickup stays
   * personal provenance via coinsFor/shardsFor; what the Village can spend is communal).
   */
  function villageSnapshot() {
    return {
      coins: villageCoinsEarned,
      shards: villageShardsEarned,
      workshopOwned,
    };
  }

  /**
   * GP3: attempt to purchase Workshop I. Server-authoritative, and intrinsically idempotent the same
   * way applyLootAward's own eventId already is (see that function's header) -- store.apply()'s
   * INSERT OR IGNORE on WORKSHOP_I_ID's fixed eventId is the actual "cannot be bought twice"
   * enforcement, not the funds/ownership pre-check below. The pre-check exists only so an
   * insufficient-funds or already-bought attempt gets an honest accepted:false instead of a wasted
   * write attempt; even if two requests both somehow passed it (they cannot -- Node's single
   * threaded event loop already serialises one onMessage call fully before the next begins, so there
   * is no window for a genuine race here), only the FIRST apply() call would ever see
   * result.applied === true.
   *
   * A guestId-less (ephemeral) connection has no durable identity to record as "who pressed
   * UPGRADE", and Village Supplies only ever counts DURABLE coin/shard events in the first place
   * (villageSnapshot above) -- an ephemeral pickup never reaches the store, so it never contributes
   * to the balance a purchase spends against either. Refused the same clean way insufficient funds
   * is, not a special case.
   *
   * Throws only for an upgradeId this slice does not define at all -- the same "stale or hostile
   * client" posture applyEquip already takes for an unknown weapon id. Workshop I is the only
   * upgrade GP3 defines; a real client only ever sends this id (village/economy.js's WORKSHOP_I_ID).
   */
  function applyVillageUpgradePurchase(playerId, upgradeId) {
    if (upgradeId !== WORKSHOP_I_ID) {
      throw new Error(`applyVillageUpgradePurchase got an unknown upgrade id ${JSON.stringify(upgradeId)}`);
    }
    const guestId = guestIdByPlayer.get(playerId);
    if (!guestId) return { accepted: false };
    if (workshopOwned) return { accepted: false };
    if (villageCoinsEarned < WORKSHOP_I_COST.coins || villageShardsEarned < WORKSHOP_I_COST.shards) return { accepted: false };
    const result = store.apply({ guestId, heroId: playerId, type: 'village-upgrade', eventId: upgradeId, value: null });
    if (result.applied) workshopOwned = true;
    return { accepted: result.applied };
  }

  /**
   * An equipment choice, applied durably (guestId known) or in-memory (ephemeral). Unlike
   * applyMarkAward, this never folds combat events -- it is called directly off an incoming `equip`
   * message (see attachGameServer's onMessage below), the same "applied the instant it arrives"
   * treatment applyAttack gives attack.
   *
   * Rejects an itemId nobody defined the same way rewardStore.mjs's own apply() does for the durable
   * path -- checked HERE too, before touching the store, so the ephemeral path (which never reaches
   * the store at all) gets the identical guarantee rather than a silently more permissive one.
   *
   * GP1-C1: also rejects an itemId this player does not OWN. The Hero screen never offers a button
   * for an unowned item (heroScreenViewModel filters the strip to ownedItemIds), so a legitimate
   * client can never produce this message -- this is the same "stale or hostile client" posture
   * attack/input already take on a message that is shaped correctly but makes no sense.
   */
  function applyEquip(playerId, itemId, identity) {
    if (!isKnownItem(itemId)) {
      // Keep the long-standing client/test contract while this seam widens from weapon-only to
      // slot-generic equipment. The value is still rejected before either durable or ephemeral
      // state is touched.
      throw new Error(`applyEquip got an unknown weapon id ${JSON.stringify(itemId)}`);
    }
    if (!ownedItemIdsFor(playerId).includes(itemId)) {
      throw new Error(`applyEquip: player ${playerId} does not own ${JSON.stringify(itemId)}`);
    }
    const guestId = guestIdByPlayer.get(playerId);
    const slot = itemDef(itemId).slot;
    if (guestId) {
      // WHEN the child chose this weapon is a fact about the choice, so it is created with the
      // choice -- on the device, before the message is sent -- and merely persisted here. Deriving
      // it on this side instead was wrong four separate ways (docs/MISTAKES.md GQ-014); the last of
      // them, ordering by arrival, cannot tell an older equip delivered late from a newer one,
      // because arrival is not chronology.
      //
      // Trusting a client number is safe here and nowhere near as broad as it sounds: `rev` orders
      // this profile's own equips against each other and nothing else. Ownership is still re-checked
      // above, the weapon must still be real, and the worst a lie achieves is choosing which of the
      // child's OWN swords their hero draws. The identity is still bounded and validated on the wire
      // (net/protocol.js), and the PRIMARY KEY still makes a replay a no-op.
      //
      // A caller that supplies nothing -- an older client, a harness, a test -- still equips, and the
      // server mints an identity ABOVE this guest's existing history so it cannot land in the middle
      // of it. That fallback is a compatibility path, not the product path.
      const eventId = identity?.eventId ?? `equip:${guestId}:${randomUUID()}`;
      const rev = Number.isInteger(identity?.rev) ? identity.rev : store.maxEquipRevFor(guestId) + 1;
      const result = store.apply({
        guestId,
        heroId: playerId,
        type: slot === 'weapon' ? 'weapon-equipped' : 'gear-equipped',
        eventId,
        value: itemId,
        rev,
      });
      // A repeated equip identity is a replay, not a failure: the child's choice is already on
      // record with the order it was made, and re-sending it must be the no-op INSERT OR IGNORE
      // already makes it. Only a server-minted identity is expected to be new every time.
      if (!result.applied && !identity?.eventId) {
        throw new Error(`applyEquip failed to record a new durable event for ${guestId}`);
      }
    } else {
      ephemeralEquipment.set(playerId, {
        ...DEFAULT_EQUIPPED_ITEM_IDS,
        ...(ephemeralEquipment.get(playerId) ?? {}),
        [slot]: itemId,
      });
    }
  }

  /**
   * GP2: credit one physical pickup's currency to whoever just collected it. Called ONLY after
   * world/cartLoot.js's requestCollectLoot already accepted the collect (see attachGameServer's
   * onMessage below) -- this function does not re-check ownership, reach, or "already gone" itself.
   *
   * eventId is `pickupId` VERBATIM, not guestId-prefixed the way equip's own eventId is: a pickup is
   * a single physical object collectible by exactly one guest ever, so the id is already globally
   * unique by construction (world/cartLoot.js's CART_LOOT_TABLE has exactly one row per object).
   * That is what makes store.apply()'s ordinary INSERT OR IGNORE idempotency double as "this physical
   * loot cannot be awarded twice" at the durable layer too -- a defence-in-depth guarantee independent
   * of the in-memory lootState check that decided to call this in the first place, the same posture
   * applyMarkAward's own durable eventId takes against a replayed mark.
   */
  function applyLootAward(playerId, pickupId, kind) {
    const type = kind === COIN_KIND ? 'coin-earned' : 'shard-earned';
    const guestId = guestIdByPlayer.get(playerId);
    if (guestId) {
      const result = store.apply({ guestId, heroId: playerId, type, eventId: pickupId, value: null });
      if (result.applied) {
        if (kind === COIN_KIND) villageCoinsEarned += 1;
        else villageShardsEarned += 1;
        // Announced with the id the row was keyed on, the same way applyMarkAward announces a mark.
        // Until this existed the device learned its coins only as a COUNT on the rewards block, and
        // a count cannot be journalled -- fold "coins: 3" into a grow-only set and every reconnect
        // adds three more. The pickup id is already globally unique by construction (see this
        // function's header), so there is no identity to mint here, only one that was kept private.
        //
        // Only on `applied`: a replayed collect is not a second coin, and must not announce one.
        return [{ type, heroId: playerId, eventId: pickupId }];
      }
      return [];
    }
    // No durable path for an ephemeral connection (same caveat ownedItemIdsFor's own comment gives) --
    // in-memory only, lost on disconnect. The simulation-layer lootState check is still what prevents
    // a double-credit here: this function is only ever reached once per pickupId, full stop.
    const state = ephemeralLoot.get(playerId) ?? { coins: 0, shards: 0 };
    if (kind === COIN_KIND) state.coins += 1; else state.shards += 1;
    ephemeralLoot.set(playerId, state);
    // Nothing durable happened, so nothing durable is announced. An ephemeral connection's HUD
    // still updates from the rewards block exactly as before; what it does not get is a named fact,
    // because there is no row anywhere for that name to refer to.
    return [];
  }

  /** One mark-earned award, applied durably or in-memory, plus the lantern-unlocked check that
   * rides every mark (not just the third) -- store.apply()'s own idempotent eventId is what makes
   * checking on every kill safe: only the FIRST time marksFor crosses MARKS_TO_UNLOCK does the
   * lantern:<guestId> insert actually take, so "exactly once, ever" holds even across a restart
   * (D2's own close+reopen guarantee is what this is built on).
   *
   * The durable key is `mark:<guestId>:<lifeId>` -- the guest who is owed, and the wolf-life they
   * are owed FOR. Both halves matter and each replaced a broken predecessor:
   *
   *   - `mark:<heroId>:<lifeIndex>` (the fold's own id) is unique only within one process. Both
   *     components reset on a restart, so the first kill after one recomputes an id already on
   *     record and INSERT OR IGNORE swallows a real kill. Found by a failing test
   *     (test/reward-wiring.test.mjs, "the third kill unlocks the lantern... across a store restart").
   *   - Reading `store.marksFor(guestId)` here instead cured the restart case but was not idempotent:
   *     two heroIds can map to ONE guestId (two tabs share localStorage, hence the guestId), the
   *     fold credits each contributor separately, and this count was re-read BETWEEN the two awards
   *     -- so the second computed a different key and inserted. One kill, two marks, and the lantern
   *     unlocking in two kills instead of three. Proved by test/profile-identity.test.mjs.
   *
   * marks.js now mints one lifeId per wolf-defeated, so every contributor to a life carries the same
   * one: one guest's two bodies collapse to a single durable key, while two different guests keep
   * their own -- participation credit intact, duplication impossible. The count is not read at all
   * any more; nothing here derives an identity from a number that the act of paying changes.
   *
   * D1's own award.eventId keeps its documented job for the ephemeral (guestId-less) fallback below,
   * where per-process state is exactly right since that state does not survive a restart either.
   */
  function applyMarkAward(award) {
    const guestId = guestIdByPlayer.get(award.heroId);
    const events = [];

    if (guestId) {
      const durableEventId = `mark:${guestId}:${award.lifeId}`;
      const result = store.apply({ guestId, heroId: award.heroId, type: 'mark-earned', eventId: durableEventId });
      // The durable eventId rides the event so the client can journal THIS fact under the same id
      // the store used. That is what makes the device's copy mergeable with this one rather than a
      // second opinion -- see public/src/progression/facts.js's union law.
      if (result.applied) events.push({ type: 'mark-earned', heroId: award.heroId, eventId: durableEventId });
      if (store.marksFor(guestId) >= MARKS_TO_UNLOCK) {
        events.push(...applyLanternUnlock(guestId, award.heroId));
      }
      return events;
    }

    const state = ephemeral.get(award.heroId) ?? { marks: 0, unlocked: false, seenEventIds: new Set() };
    if (!state.seenEventIds.has(award.eventId)) {
      state.seenEventIds.add(award.eventId);
      state.marks += 1;
      events.push({ type: 'mark-earned', heroId: award.heroId });
    }
    if (!state.unlocked && state.marks >= MARKS_TO_UNLOCK) {
      state.unlocked = true;
      events.push({ type: 'lantern-unlocked', heroId: award.heroId });
    }
    ephemeral.set(award.heroId, state);
    return events;
  }

  /**
   * P2: THE LANTERN UNLOCK, AND THE ONE XP AWARD THAT RIDES WITH IT.
   *
   * The Lantern was already a latch keyed on `lantern:<guestId>`, so "exactly once, ever" was
   * already true of it across restarts. What P2 adds is that the same moment is worth 100 XP -- the
   * first level -- and that the two facts must be inseparable.
   *
   * WRITTEN AS ONE BATCH, and that is the whole design rather than a tidiness. The brief's stop
   * condition is precise: "a transient ordering/write failure must not create a normal state where a
   * newly-earned Lantern is permanently present but its deterministic P2 XP can never be recovered."
   * Two `apply()` calls in sequence create exactly that state -- the unlock commits, the process
   * dies, and the child owns a Lantern that is worth nothing forever, because the unlock is a latch
   * and will never fire again. `applyAll` validates the whole batch and writes it inside one
   * transaction, so the pair either both land or neither does.
   *
   * THE XP FACT'S NAME COMES FROM THE LANTERN'S, through the shared law in progression/facts.js.
   * Nothing here decides what the award is worth or what it is called; this only asks what this
   * profile is owed and writes it. That is what lets the offline path (rewards/offlineProgress.js)
   * mint the same award from the same rule without either side knowing about the other.
   *
   * AND IT REPAIRS. `pendingLanternXpFact` is a pure function of the facts on record, so a guest
   * whose Lantern predates P2 -- or whose XP row was somehow lost -- is owed it the next time this
   * runs, and a guest who already holds it is owed nothing. "Award" and "repair" are one operation,
   * which is why there is no separate migration anywhere in this change.
   *
   * `hadLantern` is read BEFORE the write rather than taken from an applied-count afterwards:
   * applyAll reports how many rows landed, not which, and the two events below have to be raised
   * independently -- a repair on an existing Lantern raises the XP event and must not re-announce an
   * unlock the child watched happen a week ago.
   */
  function applyLanternUnlock(guestId, heroId) {
    const lanternEventId = `lantern:${guestId}`;
    const lanternFact = { eventId: lanternEventId, type: 'lantern-unlocked' };
    const existing = store.profileFactsFor(guestId);
    const hadLantern = existing.some((fact) => fact.type === 'lantern-unlocked');
    const xpFact = pendingLanternXpFact([...existing, lanternFact]);

    const batch = [{ guestId, heroId, type: 'lantern-unlocked', eventId: lanternEventId }];
    if (xpFact) {
      batch.push({ guestId, heroId, type: 'xp-earned', eventId: xpFact.eventId, value: xpFact.value });
    }
    store.applyAll(batch);

    const events = [];
    // The durable eventId rides each event so the client journals THIS fact under the id the store
    // used -- what makes the device's copy mergeable with this one rather than a second opinion.
    if (!hadLantern) events.push({ type: 'lantern-unlocked', heroId, eventId: lanternEventId });
    if (xpFact) {
      events.push({ type: 'xp-earned', heroId, eventId: xpFact.eventId, value: xpFact.value });
    }
    return events;
  }

  /**
   * P2: HOW STRONG THIS HERO ACTUALLY IS -- `{ maxHp, heroDamage }`, resolved numbers.
   *
   * Hoisted here as a plain function declaration -- see the shorthand `heroStatsFor,` reference and
   * full doc comment further down, at this function's original method-literal home in the object this
   * closure returns -- so that R1-C1's applyCombatRewards, defined right below, can call the SAME
   * authority for a combat award's hero level rather than a second lookup. Function declarations
   * hoist within this closure, so nothing about calling this before its "real" doc comment appears
   * further down changes what it does.
   */
  function heroStatsFor(heroId) {
    const guestId = guestIdByPlayer.get(heroId);
    if (guestId) {
      return resolveHeroStats({
        totalXp: store.xpFor(guestId),
        equippedItemIds: store.equippedItemsFor(guestId),
        charmOwned: store.charmEarnedFor(guestId),
      });
    }
    return resolveHeroStats({
      equippedItemIds: ephemeralEquipment.get(heroId) ?? DEFAULT_EQUIPPED_ITEM_IDS,
    });
  }

  /**
   * R1-C1 FIX 1 (Opus ruling on Sonnet B's adversarial pass, corrects the original C1 shipment): the
   * hero level EVERY kill in one batch (one processTick's folded.awards) is priced at, captured ONCE
   * at the top of processTick -- BEFORE any of that batch's own rewards (an earlier mark, an earlier
   * kill's combat XP, a lantern unlock landing mid-batch) are applied.
   *
   * Sonnet B reproduced why sequential repricing -- reading heroStatsFor fresh for each award as this
   * function walked them, in whatever order the grouping Map happened to iterate -- is still
   * order-dependent: which award is "first" is an artifact of event order and Map iteration, not of
   * the kills themselves, so two guests each contributing to two enemies in one tick would price
   * differently depending on which the loop reached first. That is the exact fragility class
   * docs/MISTAKES.md keeps recording fixes for.
   *
   * A server tick is 50ms; every kill in a batch died within that window. Treating the hero as having
   * levelled BETWEEN two kills 50ms apart is a fiction -- "the level they fought it at" is the honest
   * input, and it is what rewards/offlineProgress.js's recordKills now also snapshots once, at the top
   * of its own batch (one call), for the identical reason. Snapshotting makes the two paths agree BY
   * CONSTRUCTION rather than by keeping two orderings in step (GQ-007), which is the whole reason the
   * pricing law lives in one shared module in the first place.
   *
   * One entry per DISTINCT guestId represented in the batch: heroStatsFor's result for a guestId does
   * not depend on WHICH of that guest's heroIds resolved it, only on the store's xp for that guestId,
   * which has not moved yet -- so this only needs to be computed once per guest, not once per award.
   */
  function snapshotHeroLevelsForBatch(awards) {
    const heroLevelByGuest = new Map();
    for (const award of awards) {
      if (award.type !== 'mark-earned') continue;
      const guestId = guestIdByPlayer.get(award.heroId);
      if (!guestId || heroLevelByGuest.has(guestId)) continue;
      heroLevelByGuest.set(guestId, heroStatsFor(award.heroId).level);
    }
    return heroLevelByGuest;
  }

  /**
   * R1-C1: COMBAT XP, priced off the SAME awards applyMarkAward already walks -- not a second kill
   * ledger. rewards/marks.js's D1 generalization stamps `enemyId`/`enemyLevel` and the shared `lifeId`
   * onto every mark-earned award, which is everything this needs to price and name an XP fact; this
   * function only groups, dedupes and prices, never re-folds a single combat event.
   *
   * TWO DEDUPES, in a specific order and for different reasons:
   *   1. by guestId, computed while grouping and therefore BEFORE combatXpFor -- and, since R1-C2,
   *      the gear-drop roll -- is ever run for a guest: two heroIds/tabs sharing one guestId are ONE
   *      distinct profile and must get ONE price and AT MOST ONE loot roll, never two. Doing this
   *      before pricing/rolling (rather than after, and trusting the store's own INSERT OR IGNORE to
   *      absorb the second row) is what keeps a second tab from ever consuming a second random draw
   *      -- rolling and then discarding the second roll would still have consumed one nobody asked for.
   *   2. the store's own idempotent write, per guest per lifeId -- a reprocessed tick or a redelivered
   *      wolf-defeated must mint nothing a second time and must not re-announce an already-durable fact.
   *
   * An ephemeral (guestId-less) contributor earns no combat XP and rolls no loot, on the same posture
   * every other durable fact in this file already takes: there is no durable identity to write either
   * one under, so zero/none is the truth for it rather than a fallback (see rewardsFor's own comment
   * on the same question).
   *
   * @param awards           folded.awards straight off foldEvents -- the SAME array applyMarkAward walks.
   * @param heroLevelByGuest snapshotHeroLevelsForBatch's own return, taken before applyMarkAward ran
   *                         for this batch. THE pricing input -- heroStatsFor is deliberately not
   *                         called again in here; see snapshotHeroLevelsForBatch's header for why.
   */
  function applyCombatRewards(awards, heroLevelByGuest) {
    const groupsByLife = new Map();
    for (const award of awards) {
      // R1 rides the existing mark-earned contributor fold; a future award TYPE here would need its
      // own pricing law rather than silently folding into this one.
      if (award.type !== 'mark-earned') continue;
      const guestId = guestIdByPlayer.get(award.heroId);
      if (!guestId) continue;

      let group = groupsByLife.get(award.lifeId);
      if (!group) {
        group = { enemyLevel: award.enemyLevel, heroIdsByGuest: new Map() };
        groupsByLife.set(award.lifeId, group);
      }
      const heroIds = group.heroIdsByGuest.get(guestId) ?? [];
      heroIds.push(award.heroId);
      group.heroIdsByGuest.set(guestId, heroIds);
    }

    const rewardEvents = [];
    for (const [lifeId, group] of groupsByLife) {
      for (const [guestId, heroIds] of group.heroIdsByGuest) {
        // Lowest heroId by stable string compare: deterministic, so the event this profile hears
        // about is always addressed to the same representative hero, whichever tab's hit the fold
        // happened to see first, and reproducible across a reprocessed tick.
        const heroId = [...heroIds].sort()[0];
        // FIX 1: the batch-start snapshot, not a fresh heroStatsFor call -- see this function's own
        // header and snapshotHeroLevelsForBatch's for the ruling. Every guestId reaching this line
        // passed the identical filter snapshotHeroLevelsForBatch used, so this is always present.
        const heroLevel = heroLevelByGuest.get(guestId);

        // R1-C2: ONE reward decision for this guest/life -- XP (C1's law, unchanged) and whether
        // this kill also grants gear ownership (D6), decided TOGETHER so the drop roll -- if the
        // eligible set is non-empty at all -- happens exactly once per guest per enemy life, per
        // dedupe #1 above. ownedItemIdsFor is read fresh here (current true ownership, including
        // any grant this SAME tick's earlier lifeId group already committed), never cached across
        // the tick: eligibility is a real-time "what does this guest currently own" question, not a
        // price that needs batch-start stabilizing the way heroLevel does.
        const { xp, gearItemId } = decideCombatReward({
          heroLevel,
          enemyLevel: group.enemyLevel,
          ownedItemIds: ownedItemIdsFor(heroId),
          random,
          catalogue: dropCatalogue,
        });

        const xpEventId = combatXpEventId(guestId, lifeId);
        // grantOwnership's OWN identity shape, through the shared helper rather than a second inline
        // copy of it (GQ-007): a duplicate can never be minted, and eligibility already excluded
        // owned items above, so this can never re-promise something already owned. The offline path
        // calls the identical function, which is what makes a later journal/server union collapse
        // one item to one fact instead of two.
        const gearEventId = gearItemId ? gearOwnedEventId(guestId, gearItemId) : null;

        // A one-or-two-row batch: C2 appends the gear-owned row (D6) to the SAME array the XP row
        // lands in, so the pair cannot half-land -- see applyLanternUnlock's own header for the
        // permanently half-landed state two sequential apply() calls would create, which applies
        // here identically to a combat-XP-plus-gear pair.
        const batch = [];
        if (xp > 0) batch.push({ guestId, heroId, type: 'xp-earned', eventId: xpEventId, value: String(xp) });
        if (gearEventId) batch.push({ guestId, heroId, type: 'gear-owned', eventId: gearEventId, value: gearItemId });
        if (batch.length === 0) continue;

        const result = store.applyAll(batch);
        // Only a row the store actually inserted is announced -- checked by eventId, off applyAll's
        // own appliedEventIds, rather than the aggregate `applied` count: a replayed lifeId (a
        // reprocessed tick, a redelivered wolf-defeated) must not raise a second event for a fact
        // that is already on disk, and with two possible rows in one batch, the count alone cannot
        // say WHICH row was new.
        if (xp > 0 && result.appliedEventIds.includes(xpEventId)) {
          rewardEvents.push({ type: 'xp-earned', heroId, eventId: xpEventId, value: String(xp) });
        }
        if (gearEventId && result.appliedEventIds.includes(gearEventId)) {
          rewardEvents.push({ type: 'gear-owned', heroId, eventId: gearEventId, value: gearItemId });
        }
      }
    }
    return rewardEvents;
  }

  /**
   * Fold one drainEvents() batch into awards (D1) and apply each (D2/D3), returning the events to
   * append to the SAME outgoing snapshot the combat events ride, per the brief: clients hear
   * mark-earned/lantern-unlocked "the way they hear wolf-defeated" -- one array, one broadcast.
   */
  function processTick(events) {
    // randomUUID, not the fold's own life index: the index restarts at 0 with the process and would
    // recompute an eventId already on disk. See rewards/marks.js's header for both halves of that
    // lesson and for why the id is minted per LIFE rather than per contributor.
    //
    // PROPERTY, STATED HONESTLY (Sonnet B adversarial pass -- documented, not changed; Opus routed the
    // fix itself to the Production Director as a side quest, since it needs a durable mark-identity
    // migration the brief names as an explicit stop condition): `randomUUID()` mints an id that is
    // unique PER MINT, not one DERIVED from the enemy life it names. A genuinely re-delivered
    // `wolf-defeated` for the same life -- as opposed to a replayed/redrained batch, which this file's
    // own tests do cover -- would mint a second, different lifeId and therefore a second mark/combat-XP
    // award; nothing here can tell the two apart by id alone. What actually prevents that in production
    // today is upstream of this line: drainEvents() splices its queue rather than re-delivering, and a
    // server restart does not replay historical encounter events (combat/encounter.js generates them
    // live), so the redelivery this identity can't detect is not a reachable path, not a proven-safe
    // one. Idempotency in the reachable cases rests on foldEvents's own object-identity/ledger guard
    // and on drainEvents's splice, never on this id being derived rather than minted.
    const folded = foldEvents(ledger, events, { mintLifeId: () => randomUUID() });
    ledger = folded.ledger;
    // FIX 1: captured BEFORE applyMarkAward runs for this batch -- see snapshotHeroLevelsForBatch's
    // header. Every kill in this tick prices off the level the hero fought it at, not a level an
    // earlier kill/mark/lantern in the SAME tick raised a moment before.
    const heroLevelByGuest = snapshotHeroLevelsForBatch(folded.awards);
    const rewardEvents = [];
    for (const award of folded.awards) rewardEvents.push(...applyMarkAward(award));
    // R1-C1: one grouping pass over the SAME awards marks already folded -- see applyCombatRewards'
    // own header for why this is not a second kill ledger.
    rewardEvents.push(...applyCombatRewards(folded.awards, heroLevelByGuest));
    return rewardEvents;
  }

  /** The wire's rewards block (net/protocol.js's decodeRewards):
   *  { [heroId]: { marks, lanternUnlocked, equippedWeaponId, equippedItemIds, ownedItemIds, coins, shards } }.
   *  equippedWeaponId always carries a value (DEFAULT_EQUIPPED_WEAPON_ID when nobody has equipped
   *  anything yet) rather than riding as absent -- unlike the wire's OWN optional-field treatment of
   *  it, a hero always has SOME weapon equipped, so there is no "not yet known" state to represent
   *  the way an as-yet-unearned mark count legitimately starts at zero. ownedItemIds is the same
   *  always-present treatment, for the same reason: a hero always owns the baseline equipment.
   *  coins/shards start at 0 like marks -- nothing to fall back to, nothing owned by construction. */
  function rewardsFor(heroIds) {
    const rewards = {};
    for (const heroId of heroIds) {
      const guestId = guestIdByPlayer.get(heroId);
      if (guestId) {
        rewards[heroId] = {
          marks: store.marksFor(guestId),
          lanternUnlocked: store.unlockedFor(guestId),
          equippedWeaponId: store.equippedWeaponFor(guestId) ?? DEFAULT_EQUIPPED_WEAPON_ID,
          equippedItemIds: store.equippedItemsFor(guestId),
          ownedItemIds: ownedItemIdsFor(heroId),
          coins: store.coinsFor(guestId),
          shards: store.shardsFor(guestId),
          satchelCarried: store.satchelTakenFor(guestId),
          charmOwned: store.charmEarnedFor(guestId),
          // P2: folded from this guest's own rows, never a stored counter -- see the store's xpFor.
          xp: store.xpFor(guestId),
        };
      } else {
        const state = ephemeral.get(heroId);
        const lootState = ephemeralLoot.get(heroId);
        const equipment = ephemeralEquipment.get(heroId) ?? DEFAULT_EQUIPPED_ITEM_IDS;
        rewards[heroId] = {
          marks: state?.marks ?? 0,
          lanternUnlocked: state?.unlocked ?? false,
          equippedWeaponId: equipment.weapon ?? DEFAULT_EQUIPPED_WEAPON_ID,
          equippedItemIds: equipment,
          ownedItemIds: ownedItemIdsFor(heroId),
          coins: lootState?.coins ?? 0,
          shards: lootState?.shards ?? 0,
          // An equip-only connection has no durable identity, so it can never have picked anything
          // up or been given anything -- false is the truth for it, not a fallback.
          satchelCarried: false,
          charmOwned: false,
          // ...and can never have earned any, for the same reason. Zero is the truth, not a default.
          xp: 0,
        };
      }
    }
    return rewards;
  }

  return {
    join,
    hasDurableIdentity,
    leave,
    processTick,
    applyEquip,
    grantOwnership,
    claimWildwoodBlade,
    claimSatchel,
    claimCharm,
    applyHollowCache,
    /** Is this child carrying the satchel, and have they been given the charm. Read by the claim
     *  handlers (which re-check the same conditions the client asked on) and by the tick, which
     *  needs the charm every frame to tell the fight how many hearts this body has. */
    satchelTakenFor(heroId) {
      const guestId = guestIdByPlayer.get(heroId);
      return guestId ? store.satchelTakenFor(guestId) : false;
    },
    charmEarnedFor(heroId) {
      const guestId = guestIdByPlayer.get(heroId);
      return guestId ? store.charmEarnedFor(guestId) : false;
    },
    /** Every durable fact this hero's profile owns, for the client to merge into its own local
     *  journal. Facts, not totals: a device that keeps its own copy of family progress has to be
     *  able to union the two sets by id (public/src/progression/facts.js), and a count cannot be
     *  unioned with anything -- it can only overwrite or be overwritten, which is precisely the
     *  ambiguity local-first is supposed to remove. Empty for an ephemeral, guestId-less hero,
     *  which genuinely owns nothing durable. */
    profileFactsFor(heroId) {
      const guestId = guestIdByPlayer.get(heroId);
      return guestId ? store.profileFactsFor(guestId) : [];
    },
    /**
     * Take back the durable facts a DEVICE still holds, for a store that has lost them.
     *
     * This is the empty-store half of local-first recovery, and it exists because re-sending the
     * equip alone provably cannot work: applyEquip refuses a weapon the guest does not own, and
     * against a wiped store the child owns the baseline equipment. The recovered choice is
     * rejected and the hero snaps back to a weapon the child stopped holding. The ownership has to
     * arrive with the choice that depends on it, which is why this takes the whole set at once
     * rather than one fact at a time -- the two are validated against each other below.
     *
     * WHAT A DEVICE MAY SAY, precisely:
     *   - only about the guest THIS CONNECTION claimed; an ephemeral connection has no profile to
     *     restore into and is refused outright;
     *   - only profile facts the shared recovery boundary allows. Client-restored coin/shard rows
     *     are refused because those currencies author the communal Village economy, and a personal
     *     fact may not use a server-authored shared-world event namespace;
     *   - only real items, checked the same way the store checks an adjudicated award;
     *   - and only a weapon-equipped whose item the profile will actually own once this restore
     *     lands. Without that last check the derived state contradicts itself: a hero holding a
     *     weapon the same rows say they do not own.
     *
     * WHAT IT IS NOT. It is not live adjudication and does not touch it. The server still decides
     * every question asked in the present tense -- did that hit land, is this affordable, is this
     * claim in range -- and nothing here is consulted for any of them. Every row written is stamped
     * `origin: 'client'` and stays distinguishable from an adjudicated one forever.
     *
     * The residual trust is real and worth naming rather than burying: a device can assert it earned
     * marks it did not. For a same-device family game with no accounts and no competitive stakes,
     * that is the trade AGENTS.md already records, and the alternative -- refusing -- costs a child
     * their sword because a database file was replaced. Tightening it (a signed journal, a
     * server-side high-water mark) is a product decision, not something to smuggle in here.
     */
    restoreProfileFacts(heroId, facts) {
      const guestId = guestIdByPlayer.get(heroId);
      // Nothing durable to restore into, and no way to know whose facts these are. Refused rather
      // than thrown: a device that lost its storage mid-session is confused, not hostile, and
      // dropping its connection over it would be a worse answer than ignoring the message.
      if (!guestId) return { restored: 0, refused: Array.isArray(facts) ? facts.length : 0 };

      const candidates = (Array.isArray(facts) ? facts : []).filter((fact) => (
        isClientRestorableProfileFact(fact, guestId)
        && !(fact.type === 'gear-owned' && !isKnownItem(fact.value))
        && !((fact.type === 'weapon-equipped' || fact.type === 'gear-equipped') && !isKnownItem(fact.value))
        && !((fact.type === 'weapon-equipped' || fact.type === 'gear-equipped')
          && !isSemanticallyValidEquipmentFact(fact))
        // Checked through the same reader the fold and the store use, so a device cannot restore an
        // amount that would later be counted differently -- or, before this check existed, counted
        // NEGATIVELY. Filtered rather than thrown on, exactly like the two lines above it: a device
        // handing back a journal with one bad row is confused, not hostile, and losing the other
        // fifty facts over it would be the worse answer.
        && !(fact.type === 'xp-earned' && parseXpFactAmount(fact.value) === null)
        // R1-C1: a combat-XP identity is profile-scoped (progression/facts.js's
        // PROFILE_SCOPED_EVENT_ID_PREFIXES), which means the SUBMITTING profile can name any lifeId it
        // invents -- unlike the Lantern's one enumerable latch, there is no fixed identity to check
        // this fact against. What there IS to check is the amount: no real kill against the currently
        // authored enemy field can ever be worth more than MAX_COMBAT_XP_PER_KILL, so an amount past
        // that ceiling is refused the same shape-not-value-blind way the line above refuses a
        // malformed amount, rather than clamped into a smaller fact nobody actually earned.
        //
        // FIX 4 (Sonnet B adversarial pass -- documenting scope, not expanding it; Opus ruling): read
        // this guard for exactly what it is and is not.
        //   - It bounds the VALUE of ONE fact, checked one row at a time as `candidates` is filtered.
        //     It is NOT an aggregate bound: Sonnet B restored five separate `xp:combat:` facts, each
        //     individually at or under the ceiling, in one restore batch and had all five land --
        //     24,320 XP from five restore messages is exactly what "per-fact, not per-batch" means,
        //     and it is accepted under the V0 local-first trust posture this same function's own
        //     header already records ("a device can assert marks it did not earn"). Rate-limiting
        //     restore batches or capping a profile's aggregate restored XP is a real hardening a
        //     future package could add; it is explicitly NOT this fix's job (see the brief's stop
        //     conditions), so it is not added here.
        //   - It is FAMILY-SPECIFIC to the literal `xp:combat:` eventId prefix. An `xp-earned` fact
        //     under any OTHER eventId -- an unreserved custom name a hacked device invents (e.g.
        //     `my-custom-xp-fact-1`), or even a differently-cased `Xp:Combat:...` that fails the exact
        //     `startsWith('xp:combat:')` compare -- skips this line entirely and restores at whatever
        //     amount `parseXpFactAmount` accepts, unbounded. Sonnet B confirmed this identical gap
        //     already exists on the pre-R1 baseline for every other `xp-earned` identity family (the
        //     Lantern's own `lantern:<guestId>`-derived xp id included) -- it is pre-existing, not
        //     introduced by R1, and not this fix's job to close for every family; only to be honest,
        //     here, about the one family this line actually bounds.
        && !(fact.type === 'xp-earned' && fact.eventId.startsWith('xp:combat:')
          && parseXpFactAmount(fact.value) > MAX_COMBAT_XP_PER_KILL)
      ));

      // What this profile owns once the restore lands: what the store already knows, plus whatever
      // ownership this message brings. Computed BEFORE anything is written so the equip check below
      // sees the same final picture regardless of the order the facts happen to be listed in.
      const ownedAfter = new Set(store.ownedItemIdsFor(guestId));
      for (const fact of candidates) {
        if (fact.type === 'gear-owned') ownedAfter.add(fact.value);
      }

      // ACCEPTED FIRST, WRITTEN SECOND, and that order is the whole repair.
      //
      // This loop used to call store.apply() per fact, so the set was decided and committed at the
      // same time: anything that threw part way through -- a refusal, a disk error, a lock -- left
      // every fact before it durably on disk and every fact after it missing. An append-only table
      // cannot take those rows back, so the profile stayed a fragment that is neither what the
      // device sent nor what the server had, with nothing recording that it is one.
      //
      // Now the whole accepted set is decided here and handed to the store as one batch, which
      // validates all of it before writing any of it and writes the rest inside a transaction. A
      // request either lands completely or leaves the durable state exactly as it found it.
      let refused = 0;
      const accepted = [];
      for (const fact of candidates) {
        if ((fact.type === 'weapon-equipped' || fact.type === 'gear-equipped') && !ownedAfter.has(fact.value)) {
          refused += 1;
          continue;
        }
        accepted.push({
          guestId,
          heroId,
          type: fact.type,
          eventId: fact.eventId,
          value: fact.value,
          ...(Number.isInteger(fact.rev) ? { rev: fact.rev } : {}),
          origin: 'client',
        });
      }
      // Facts the store already held are not failures and are not counted -- restoring twice has to
      // be the same as restoring once, which is the INSERT OR IGNORE the whole design rests on, so
      // `applied` is rows actually added rather than rows offered.
      const { applied } = store.applyAll(accepted);
      return {
        restored: applied,
        refused: refused + ((Array.isArray(facts) ? facts.length : 0) - candidates.length),
      };
    },
    recordBeaconLit,
    beaconLit,
    ownedItemIdsFor,
    /** What this hero is swinging, for the fight rules -- the same value rewardsFor puts on the
     *  wire, pulled out on its own because the tick needs it every frame and a whole rewards block
     *  per player per tick would be a lot of object for one string. Durable guests read the store;
     *  an equip-only connection reads its ephemeral slot; nobody at all gets null, which
     *  progression/items.js resolves to the starter sword. */
    equippedWeaponIdFor(heroId) {
      const guestId = guestIdByPlayer.get(heroId);
      if (guestId) return store.equippedWeaponFor(guestId) ?? DEFAULT_EQUIPPED_WEAPON_ID;
      return ephemeralEquipment.get(heroId)?.weapon ?? DEFAULT_EQUIPPED_WEAPON_ID;
    },

    /**
     * P2: HOW STRONG THIS HERO ACTUALLY IS -- `{ maxHp, heroDamage }`, resolved numbers.
     *
     * ONE lookup rather than three, because the three answers have to agree. The simulation used to
     * ask `weaponIdFor` and `maxHpFor` separately, which was fine while the two came from unrelated
     * rows; a level moves BOTH, and two lookups against a store that could be written between them
     * is a hero whose body and arm briefly disagree about what level they are. Resolved through one
     * progression/heroStats.js call, so what the fight is handed is internally consistent by
     * construction -- that module's own comment gives the same reason for returning one object.
     *
     * The fight is handed NUMBERS, never a level or an item id: combat/ may not know that XP or an
     * item catalogue exist (test/combat-purity.test.mjs), and this is the side of the seam that
     * knows both.
     *
     * An ephemeral connection has no durable identity, so it has no XP and no charm -- Level 1 with
     * whatever it has equipped in memory, which is the truth for it rather than a fallback.
     *
     * DEFINED ABOVE as `function heroStatsFor` (see this file's earlier declaration, just before
     * applyCombatRewards) rather than as a method literal here, since R1-C1: applyCombatRewards needs
     * this SAME authority for a combat award's hero level, never a second lookup. This is a shorthand
     * reference to that one function, not a second implementation.
     */
    heroStatsFor,
    applyLootAward,
    creditedLootIds,
    villageSnapshot,
    applyVillageUpgradePurchase,
    rewardsFor,
    close() {
      store.close();
    },
  };
}

/**
 * The simulation, with no sockets in it. `now` is injected so tests can drive time exactly rather
 * than sleeping, which is what makes the stale-input and tick-rate behaviour testable at all.
 */
export function createSimulation(options = {}) {
  const staleInputMs = options.staleInputMs ?? STALE_INPUT_MS;
  // WHICH SWORD IS IN WHICH HAND, asked rather than remembered.
  //
  // The simulation does not own equipment and must not start: what a guest owns and has equipped is
  // durable, per-guest reward-store truth, and guestId is a CONNECTION fact this factory has no
  // business knowing (see the header on createRewards for the same split, stated at length). So the
  // owner of that truth hands in a lookup, and the tick asks it once per player.
  //
  // Defaults to "nothing to say", which every test that drives createSimulation() directly relies
  // on: encounter.js resolves an unnamed weapon to the starter sword, so an unwired simulation
  // fights exactly as it did before any of this existed.
  // P2: ONE lookup, not two. It was `weaponIdFor` plus `maxHpFor`, which was fine while the two came
  // from unrelated durable rows -- but a Hero LEVEL moves both, and asking twice is a hero whose body
  // and arm can briefly disagree about what level they are. `{ maxHp, heroDamage }`, resolved on the
  // other side of the seam by progression/heroStats.js and handed here as plain numbers, because
  // combat/ may not know that XP or an item catalogue exist (test/combat-purity.test.mjs).
  //
  // Defaults to the Level-1 starter hero, which every test that drives createSimulation() directly
  // relies on: an unwired simulation fights exactly the fight it always fought.
  const heroStatsFor = options.heroStatsFor ?? (() => LEVEL_1_STARTER_STATS);
  const players = new Map();
  let nextPlayerNumber = 0;
  let tick = 0;

  // Hero id = player id (Task B3's binding interface). One ordinary-enemy collection for the whole
  // simulation. Production authors the fixed E2 population; `options.enemies` remains a bounded
  // test/config seam for alternate authored collections.
  const ordinaryEnemyOptions = Array.isArray(options.enemies)
    ? { enemies: options.enemies }
    : { enemies: ENEMY_POPULATION };
  let encounterState = createPartyEncounterState({
    ...ordinaryEnemyOptions,
    heroIds: [],
    heroSpawn: HERO_SPAWN,
    recoverySanctuary: RECOVERY_SANCTUARY,
    resetEnemiesOnPartyWipe: options.resetEnemiesOnPartyWipe ?? false,
  });
  // Events accumulate here from both requestPartyAttack (on attack arrival) and stepParty (each
  // tick) and are drained only when a snapshot broadcasts -- Design ruling 7, "events ride
  // snapshots". Nothing here is time-based, so nothing needs `now`.
  const pendingEvents = [];
  // The last seq each player's attack was accepted or rejected at, so a resent/out-of-order
  // attack message never reaches requestPartyAttack a second time -- on top of, not instead of,
  // that function's own commandId replay guard (which alone would not catch an OUT-OF-ORDER
  // replay, only an exact repeat of the most recent commandId).
  const lastAttackSeq = new Map();

  // GP2: the shared physical cart, one for the whole simulation -- same shared-world-state shape
  // the ordinary encounter collection already is above, just for a different piece of shared world truth. Lives here
  // (not folded into encounterState) because world/cartLoot.js is deliberately a sibling of
  // combat/encounter.js, not a corner of it -- see that file's own header.
  //
  // GP3-0: seeded from options.creditedLootIds when the caller supplies any -- attachGameServer's
  // real boot passes the durable store's own creditedLootIds() here (queried BEFORE this function
  // runs, since a fresh in-memory lootState has no way to ask the store itself). Every existing
  // caller that omits the option (every test in this repo that drives createSimulation() directly
  // for anything other than restart coherence) is unaffected: an empty/absent list is exactly
  // createCartLootState()'s own fresh state.
  let lootState = options.creditedLootIds?.length > 0
    ? restoreCartLootState(options.creditedLootIds)
    : createCartLootState();

  // G2/G3: THE BEACON SIEGE, one for the whole simulation -- the same shared-authority shape
  // the ordinary encounter collection above already is, for the same reason: there is one Old Beacon and every joined
  // player is standing at the same one. This is what makes "we beat it" true rather than two
  // children each privately beating their own copy of a boss.
  //
  // Seeded straight from the zone data both sides already import (GQ-007) rather than from constants
  // restated here, exactly as the wolf's own patrol is.
  //
  // `beaconLit` is restored from the durable store on boot when the caller supplies it
  // (attachGameServer reads rewards.beaconLit() before this runs, the same sequencing GP3-0 uses for
  // creditedLootIds) -- a server restart must not put the fire out. A restored siege comes back with
  // its seals broken and its Warden dead, because a world where the Beacon burns is a world where
  // both of those already happened; anything else would offer a second child a boss fight whose
  // outcome is already painted on the sky.
  let siegeState = createSiegeState({
    arena: BEACON_ARENA,
    sealsAt: COLD_SEALS,
    wardenAt: BEACON_WARDEN.at,
    heroIds: [],
  });
  if (options.beaconLit === true) siegeState = restoreLitSiege(siegeState);

  // ── WHICH FIGHT EACH CHILD'S BODY IS CURRENTLY IN ──────────────────────────────────────────────
  //
  // playerId -> 'wolf' | 'siege'. This is the whole answer to "a child has one body": the two
  // engines each keep their own hero clocks because each has to resolve its own swings, but exactly
  // ONE of them is authoritative for a given hero at a given moment, and crossing the arena boundary
  // is an explicit HANDOFF rather than a change of which copy gets published.
  //
  // Publishing by selection alone was the first version of this and it was wrong in a way that only
  // shows up in play: take wolf damage, walk to the Beacon, and the siege's untouched copy publishes
  // full hearts; walk back and the wolf's copy resurrects the old state. Down and cooldown jump the
  // same way. Selection is not continuity.
  const arenaByPlayer = new Map();

  const WOLF_ARENA = 'wolf';
  const SIEGE_ARENA = 'siege';

  /** The persistent half of a hero's body inside the wolf engine -- the mirror of
   *  beaconSiege.js's own siegeHeroBody, written here rather than there because public/src/combat/
   *  is a guarded directory this repo does not edit (see AGENTS.md). Same three fields, same
   *  reasoning: hearts, being down, and the cooldown travel; the swing does not. */
  function wolfHeroBody(heroId) {
    const hero = encounterState.heroes[heroId];
    return hero ? { hp: hero.hp, downSeconds: hero.downSeconds, cooldown: hero.cooldown } : null;
  }

  /** Write a body into the wolf engine's hero and cancel any swing it was mid-way through. Rebuilt
   *  by spreading published state rather than through a setter, for the guarded-directory reason
   *  above -- the same "construct a valid state object by hand" move main.js already makes for its
   *  own offline mirror. */
  function transferWolfHeroBody(heroId, body) {
    const existing = encounterState.heroes[heroId];
    if (!existing) return;
    const hero = Object.freeze({
      ...existing,
      hp: Number.isFinite(body?.hp) ? body.hp : existing.hp,
      downSeconds: Number.isFinite(body?.downSeconds) ? body.downSeconds : existing.downSeconds,
      cooldown: Number.isFinite(body?.cooldown) ? body.cooldown : existing.cooldown,
      swingSeconds: -1,
      swingLanded: false,
    });
    const heroes = Object.freeze({ ...encounterState.heroes, [heroId]: hero });
    encounterState = Object.freeze({ ...encounterState, heroes });
  }

  /** Move every player whose arena changed since the last tick, carrying their body with them. Run
   *  BEFORE the two engines step, so a hero never spends a tick being simulated by the fight they
   *  have just left. */
  function settleArenas() {
    for (const player of players.values()) {
      const next = inBeaconArena(player) ? SIEGE_ARENA : WOLF_ARENA;
      const previous = arenaByPlayer.get(player.id) ?? WOLF_ARENA;
      if (next === previous) continue;
      arenaByPlayer.set(player.id, next);
      if (next === SIEGE_ARENA) {
        siegeState = transferSiegeHeroBody(siegeState, player.id, wolfHeroBody(player.id));
      } else {
        transferWolfHeroBody(player.id, siegeHeroBody(siegeState, player.id));
      }
    }
  }

  /** Which engine owns this hero's body right now. Defaults to the wolf's, which is where every
   *  player starts (the village) and where an unknown id harmlessly lands. */
  function arenaOf(heroId) {
    return arenaByPlayer.get(heroId) ?? WOLF_ARENA;
  }

  // Events that describe A HERO'S OWN BODY rather than the world. Only the engine currently holding
  // that body may speak for it -- otherwise the idle engine's copy narrates hearts nobody lost and
  // swings nobody threw. World events (a wolf dying, a seal bursting, the Beacon catching) carry no
  // such restriction: everyone present should hear those, whichever fight they are standing in.
  const WOLF_BODY_EVENTS = new Set([
    'swing', 'swing-missed', 'swing-dropped', 'hero-hurt', 'hero-down', 'hero-respawned', 'hero-healed',
  ]);
  const SIEGE_BODY_EVENTS = new Set([
    'siege-swing', 'siege-swing-missed', 'siege-swing-dropped', 'warden-hurt-hero',
    'hero-down', 'hero-respawned', 'hero-healed',
  ]);

  function keepEvent(event, bodyEvents, arena) {
    if (event.heroId == null) return true;
    if (!bodyEvents.has(event.type)) return true;
    return arenaOf(event.heroId) === arena;
  }

  function addPlayer(name, at = { x: 0, z: 0 }) {
    const id = `p${nextPlayerNumber += 1}`;
    const player = {
      id,
      name: typeof name === 'string' && name.length > 0 ? name.slice(0, 32) : id,
      x: at.x,
      z: at.z,
      heading: 0,
      speed: 0,
      // Last accepted intent. dir is unit-or-zero, already validated by the protocol decoder.
      input: { seq: -1, dirX: 0, dirZ: 0, magnitude: 0, run: false, atMs: -Infinity },
    };
    players.set(id, player);
    encounterState = addHero(encounterState, id);
    // Every joined player is in BOTH fights at once, and that is not a contradiction: they are
    // twenty-two metres apart. A hero's swing is resolved against whichever of the two is actually
    // in front of them (see applyAttack), and the one they are nowhere near simply never matches.
    siegeState = addSiegeHero(siegeState, id);
    return player;
  }

  function removePlayer(id) {
    const removed = players.delete(id);
    lastAttackSeq.delete(id);
    encounterState = removeHero(encounterState, id);
    arenaByPlayer.delete(id);
    // Clears wolf.targetId's siege equivalent too (world/beaconSiege.js's removeSiegeHero), so a
    // Warden mid-swing at somebody who just closed their iPad does not resolve against a ghost.
    siegeState = removeSiegeHero(siegeState, id);
    return removed;
  }

  /**
   * A decoded `attack` message applied the instant it arrives -- not batched to the tick, per the
   * brief: "requestAttack exists precisely because button-press and clock are different
   * commands." `message` is the protocol layer's decoded shape, `{ seq }`, mirroring applyInput's
   * own (id, message, ...) signature.
   */
  function applyAttack(id, message) {
    const player = players.get(id);
    if (!player) return false;
    const seq = message.seq;
    const last = lastAttackSeq.get(id) ?? -1;
    if (seq <= last) return false;
    lastAttackSeq.set(id, seq);
    // ONE BUTTON, TWO FIGHTS, and the routing is by DISTANCE rather than by a mode flag the client
    // would have to send and could get wrong. A hero standing in the Beacon clearing is 20 m from
    // the wolf's patrol and a hero hunting wolves is 20 m from the Beacon, so the two can never both
    // be plausible -- the arena's own radius is the whole test, and it comes from the zone data both
    // sides already share.
    //
    // A swing that reaches neither is still ASKED FOR against the wolf engine, deliberately: that is
    // the engine that owns the hero's swing clock and raises `swing`/`swing-missed`, so a child
    // swinging at nothing in the middle of a field still gets an arm that moves and a button that
    // goes on cooldown. The siege only ever takes the swing when the child is standing in it.
    if (arenaOf(id) === SIEGE_ARENA || inBeaconArena(player)) {
      const siegeResult = requestSiegeAttack(siegeState, id, `${id}:${seq}`);
      siegeState = siegeResult.state;
      if (siegeResult.events.length > 0) pendingEvents.push(...siegeResult.events);
      return siegeResult.accepted;
    }
    const result = requestPartyAttack(encounterState, id, `${id}:${seq}`);
    encounterState = result.state;
    if (result.events.length > 0) pendingEvents.push(...result.events);
    return result.accepted;
  }

  /** Is this player standing in the Beacon's own fight? One definition, three callers (applyAttack,
   *  step, and the claim handlers below), so "which fight am I in" can never be answered two ways. */
  function inBeaconArena(player) {
    return Math.hypot(player.x - BEACON_ARENA.at[0], player.z - BEACON_ARENA.at[1])
      <= BEACON_ARENA.radiusMeters;
  }

  /** A decoded `search-cart` message, applied instantly like applyAttack. Idempotent (see
   *  requestSearchCart's own comment): a second player reaching the cart, or the same player's client
   *  resending its own local trigger, is a clean no-op rather than a second haul. */
  function applySearchCart(id) {
    const player = players.get(id);
    if (!player) return false;
    const distance = Math.hypot(player.x - CART_SEARCH.at[0], player.z - CART_SEARCH.at[1]);
    if (distance > CART_SEARCH.radiusMeters) return false;
    lootState = requestSearchCart(lootState);
    return true;
  }

  /**
   * A decoded `collect-loot` message. Reads the player's OWN current authoritative position (never a
   * position the client supplies) for the reach check -- the same "server owns physical truth"
   * posture applyAttack takes via isWithinStrike, just against a pickup instead of a wolf.
   */
  function applyCollectLoot(id, pickupId) {
    const player = players.get(id);
    if (!player) return { accepted: false, kind: null };
    const pickup = pickupDef(pickupId);
    const result = requestCollectLoot(lootState, id, pickupId, { x: player.x, z: player.z });
    lootState = result.state;
    return { accepted: result.accepted, kind: pickup?.kind ?? null };
  }

  function applyInput(id, message, nowMs) {
    const player = players.get(id);
    if (!player) return false;
    // Out-of-order or replayed input is ignored rather than trusted. WebSocket delivery is ordered,
    // so this only fires on a replay or a buggy client, but accepting a stale seq would let an old
    // direction override a newer one.
    if (message.seq <= player.input.seq) return false;
    player.input = {
      seq: message.seq,
      dirX: message.dirX,
      dirZ: message.dirZ,
      magnitude: message.magnitude,
      run: message.run,
      atMs: nowMs,
    };
    return true;
  }

  function step(deltaSeconds, nowMs) {
    tick += 1;
    for (const player of players.values()) {
      const input = player.input;
      const stale = nowMs - input.atMs > staleInputMs;
      const magnitude = stale ? 0 : input.magnitude;

      // The same law the client predicts with, imported not restated.
      let speed = groundSpeedForInput(magnitude, input.run);
      // A ceiling regardless of what a client claims: the protocol already bounds magnitude to
      // [0,1], and this is the second line of defence on the value that actually moves a hero.
      speed = Math.min(speed, RUN_SPEED);

      if (speed > 0 && (input.dirX !== 0 || input.dirZ !== 0)) {
        player.x = clampToWorldX(player.x + input.dirX * speed * deltaSeconds);
        player.z = clampToWorldZ(player.z + input.dirZ * speed * deltaSeconds);
        player.heading = Math.atan2(input.dirX, input.dirZ);
      }
      player.speed = speed;
    }

    // stepParty once per tick with every player's current position/heading (Task B3's binding
    // interface), THEN separate each player from the canonical ordinary-enemy collection (Design
    // ruling 6 -- server owns body separation), THEN apply the existing world clamp.
    const commandHeroes = {};
    for (const player of players.values()) {
      const stats = heroStatsFor(player.id);
      commandHeroes[player.id] = {
        position: { x: player.x, z: player.z },
        heading: player.heading,
        // Resolved to NUMBERS on the other side of the seam: the rules layer is not allowed to know
        // that an item catalogue or an XP journal exists (test/combat-purity.test.mjs), and this side
        // knows both. Asked every tick rather than copied at join, because a child can equip a sword
        // mid-fight, be handed Wren's charm, or cross a level while standing in front of the wolf --
        // and a value copied at join would mean the stronger hero only appeared after a reconnect.
        heroDamage: stats.heroDamage,
        maxHp: stats.maxHp,
        damageReductionPercent: stats.damageReductionPercent,
        // ...and whether the wolf may pick this hero at all. Derived HERE, on the side of the seam
        // that knows both where everyone is standing and whether the Beacon is burning, from the
        // same RANGER_CLAIM radius the charm handover is already adjudicated against. Nothing new
        // goes on the wire for it: the authoritative server owns both inputs already, so a client
        // could not tell it anything about this that it does not know better.
        //
        // Per hero, deliberately. A sibling out in the open is still a target on the very same
        // tick, and the wolf keeps hunting them -- this is a sanctuary, not a truce.
        targetable: !rangerSanctuaryHolds({
          heroX: player.x,
          heroZ: player.z,
          rangerX: RANGER_CLAIM.at[0],
          rangerZ: RANGER_CLAIM.at[1],
          claimRadiusMeters: RANGER_CLAIM.radiusMeters,
          beaconLit: siegeState.beaconLit,
        }),
      };
    }
    // The handoff runs BEFORE either engine steps, so a hero is never simulated for a tick by the
    // fight they have just walked out of.
    settleArenas();

    const partyResult = stepParty(encounterState, { deltaSeconds, heroes: commandHeroes });
    encounterState = partyResult.state;
    for (const event of partyResult.events) {
      if (event.type !== 'hero-respawned') continue;
      const player = players.get(event.heroId);
      if (!player) continue;
      player.x = encounterState.heroSpawn.x;
      player.z = encounterState.heroSpawn.z;
      player.heading = 0;
      player.speed = 0;
    }
    for (const event of partyResult.events) {
      if (keepEvent(event, WOLF_BODY_EVENTS, WOLF_ARENA)) pendingEvents.push(event);
    }

    // The siege runs on the SAME tick and the same command shape, every tick, whether or not anybody
    // is standing in it -- a Warden mid-death-animation with nobody watching still has to finish
    // dying, and a dormant one costs a handful of comparisons. Its events join the same pending list
    // the wolf's do, so they ride the same snapshot and arrive in the order they happened.
    const siegeResult = stepSiege(siegeState, { deltaSeconds, heroes: commandHeroes });
    siegeState = siegeResult.state;
    for (const event of siegeResult.events) {
      if (keepEvent(event, SIEGE_BODY_EVENTS, SIEGE_ARENA)) pendingEvents.push(event);
    }

    for (const player of players.values()) {
      const separated = separateFromEnemies({ x: player.x, z: player.z }, encounterState.enemies);
      player.x = clampToWorldX(separated.x);
      player.z = clampToWorldZ(separated.z);
    }

    return tick;
  }

  function snapshot() {
    return [...players.values()].map((player) => ({
      id: player.id,
      // Rounded to the millimetre by protocol.js's roundToWire -- three decimals is far below what a
      // 90-CSS-px hero can express, and it keeps a snapshot's JSON from tripling in size on
      // irrational float tails. That rule used to be written out four times here and a fifth time as
      // a private roundToWire(); it is a property of the WIRE, so it lives in protocol.js now (GQ-007).
      x: roundToWire(player.x),
      z: roundToWire(player.z),
      heading: roundToWire(player.heading),
      speed: roundToWire(player.speed),
    }));
  }

  // The wire's encounter block is collection-shaped in protocol v4. Only presenter/network fields
  // leave the server; patrol/spawn cursors and bite/swing internals remain simulation authority.
  // Stable enemyId + kind ride every ordinary entity so events and C3 presenters never infer identity
  // from array order. modeSeconds still rides for one-shot Wolf animation re-entry.
  function encounterSnapshot() {
    const heroes = {};
    for (const [heroId, hero] of Object.entries(encounterState.heroes)) {
      // ONE HERO, ONE SET OF HEARTS -- published from whichever fight this hero is actually IN.
      //
      // Both engines keep hero clocks, because both have to resolve their own swings and their own
      // damage. But a hero has one body, and the wire carries one hero block; publishing the wolf
      // engine's copy unconditionally would mean the Warden could knock a child down while their
      // hearts stayed full and the "you went down" veil never appeared. The two can never disagree
      // about a hero who matters, because a hero cannot be in both places -- the fights are twenty
      // metres apart, which is the same fact applyAttack routes a swing on. Same test, one answer.
      // Published from whichever engine currently HOLDS this body (settleArenas above moved it
      // there), not from a fresh distance test: the handoff is the fact, and re-deriving it here
      // would put the publish one boundary-crossing out of step with the transfer.
      const source = (arenaOf(heroId) === SIEGE_ARENA && siegeState.heroes[heroId]) || hero;
      heroes[heroId] = {
        hp: source.hp,
        // Published beside hp because a heart count is only meaningful against its own ceiling:
        // Wren's charm makes 3 a different number for two children standing side by side.
        maxHp: source.maxHp ?? HERO_MAX_HP,
        swingSeconds: roundToWire(source.swingSeconds),
        cooldown: roundToWire(source.cooldown),
        downSeconds: roundToWire(source.downSeconds),
        protectionSeconds: roundToWire(source.protectionSeconds ?? 0),
      };
    }
    return {
      revision: encounterState.revision,
      enemies: encounterState.enemies.map((enemy) => ({
        enemyId: enemy.enemyId,
        kind: enemy.kind,
        level: enemy.level,
        maxHp: enemy.maxHp,
        x: roundToWire(enemy.x),
        z: roundToWire(enemy.z),
        heading: roundToWire(enemy.heading),
        hp: enemy.hp,
        mode: enemy.mode,
        modeSeconds: roundToWire(enemy.modeSeconds),
        targetId: enemy.targetId,
      })),
      heroes,
    };
  }

  // GP2's wire block: which pickups are gone and who took them, plus whether the cart has been
  // searched at all -- see protocol.js's decodeLoot for why kind/position never ride here (derivable
  // from world/cartLoot.js's own table, not restated on the wire).
  function lootSnapshot() {
    return { spawned: lootState.spawned, collected: { ...lootState.collected } };
  }

  /**
   * G2/G3's wire block (protocol.js's decodeSiege): the shared boss, rounded like every other
   * numeric field and carrying ONLY what a presenter needs.
   *
   * The seals ride as `{ blows, burst }` index-aligned with the zone's own COLD_SEALS -- their
   * coordinates are not restated here for the same reason a pickup's position is not (lootSnapshot's
   * own comment): both sides import the same zone data, and a second copy on the wire is a second
   * copy free to disagree.
   *
   * The heroes' own clocks deliberately do NOT ride here a second time. A hero has one set of hearts
   * and one swing whichever fight they are standing in, and the encounter block already carries
   * them -- publishing a second copy would give a client two answers to "how much health do I have"
   * and no rule for which wins. world/beaconSiege.js keeps its own hero clocks for the same reason
   * the wolf engine does (it has to resolve its own swings), but the WIRE has one hero.
   */
  function siegeSnapshot() {
    const warden = siegeState.warden;
    return {
      seals: siegeState.seals.map((seal) => ({ blows: seal.blows, burst: seal.burst })),
      warden: {
        x: roundToWire(warden.x),
        z: roundToWire(warden.z),
        heading: roundToWire(warden.heading),
        hp: warden.hp,
        mode: warden.mode,
        modeSeconds: roundToWire(warden.modeSeconds),
        phase: warden.phase,
        targetId: warden.targetId,
      },
      beaconLit: siegeState.beaconLit,
    };
  }

  /** Whether the Beacon has just been lit and not yet been written down. attachGameServer polls this
   *  once per tick to turn a one-time in-memory victory into a durable world fact -- see its own
   *  call site for why the simulation does not reach into the reward store itself. */
  function beaconIsLit() {
    return siegeState.beaconLit === true;
  }

  // Drains events accumulated since the last drain (from applyAttack and step alike) so a caller
  // can fold them into exactly one outgoing snapshot's `events` array, per Design ruling 7.
  function drainEvents() {
    return pendingEvents.splice(0, pendingEvents.length);
  }

  /**
   * Put an already-recorded durable fact onto the next snapshot.
   *
   * Deliberately narrow, and the narrowness is the point. Everything else that reaches
   * `pendingEvents` is raised BY the rules -- a swing, a bite, a defeat -- and this repo is careful
   * that a caller holding the simulation gets published state rather than a handle on those rules
   * (see the runtime object's own comment in main.js). This does not move the fight: it carries a
   * fact the reward store has ALREADY written, so the client can journal it under the store's id
   * instead of waiting for the next welcome to hear about it.
   *
   * Used by the reward paths that run off a message rather than off the tick -- loot collection
   * lands in a WebSocket handler, whereas a mark is folded inside the tick and can push directly.
   */
  function announceRewardFacts(events) {
    if (!Array.isArray(events) || events.length === 0) return;
    pendingEvents.push(...events);
  }

  /**
   * G4: is this player standing close enough to Rowan, under a lit Beacon, to be owed the Wildwood
   * Blade right now?
   *
   * The simulation answers the POSITION half (only it knows where a hero actually is -- a client
   * saying "I am at Rowan" is exactly the claim a server must never take on trust); the reward
   * coordinator answers the OWNERSHIP half, because only it can see the durable store. Neither half
   * is enough alone, which is why this returns a question rather than granting anything.
   *
   * The condition itself is world/rowanSpeech.js's own rowanOwesBlade -- the same function the
   * client calls to decide whether to ask at all, so the ask and the allow are literally one rule.
   */
  function rowanClaimState(id) {
    const player = players.get(id);
    if (!player) return { inRange: false, beaconLit: siegeState.beaconLit };
    const distance = Math.hypot(player.x - ROWAN_CLAIM.at[0], player.z - ROWAN_CLAIM.at[1]);
    return { inRange: distance <= ROWAN_CLAIM.radiusMeters, beaconLit: siegeState.beaconLit };
  }

  /** G5: the same position half for the hollow's chest -- the reward coordinator owns whether this
   *  guest has already been paid for it, exactly as it does for a cart pickup. */
  function atHollowChest(id) {
    const player = players.get(id);
    if (!player) return false;
    return Math.hypot(player.x - HOLLOW.chestAt[0], player.z - HOLLOW.chestAt[1]) <= HOLLOW.radiusMeters;
  }

  /** ARC 2: the position half of the satchel claim -- the same shape atHollowChest already is, and
   *  aimed at the CLUE rather than the chest. They are 2.2 m apart in the same pocket, and a child
   *  who opened the chest has not necessarily crossed to the marker stone where the satchel lies. */
  function atHollowClue(id) {
    const player = players.get(id);
    if (!player) return false;
    return Math.hypot(player.x - HOLLOW.clueAt[0], player.z - HOLLOW.clueAt[1]) <= HOLLOW.radiusMeters;
  }

  /** ARC 2: and the position half of the charm claim -- standing in front of Wren. Paired with the
   *  world fact the way rowanClaimState is, so the caller re-checks exactly what the client asked
   *  on (world/rangerSpeech.js's rangerOwesCharm) rather than a hand-copied opinion of it. */
  function rangerClaimState(id) {
    const player = players.get(id);
    if (!player) return { inRange: false, beaconLit: siegeState.beaconLit };
    const distance = Math.hypot(player.x - RANGER_CLAIM.at[0], player.z - RANGER_CLAIM.at[1]);
    return { inRange: distance <= RANGER_CLAIM.radiusMeters, beaconLit: siegeState.beaconLit };
  }

  return {
    players,
    addPlayer,
    removePlayer,
    applyInput,
    applyAttack,
    applySearchCart,
    applyCollectLoot,
    step,
    snapshot,
    encounterSnapshot,
    lootSnapshot,
    siegeSnapshot,
    beaconIsLit,
    rowanClaimState,
    atHollowChest,
    atHollowClue,
    rangerClaimState,
    drainEvents,
    announceRewardFacts,
    get tick() {
      return tick;
    },
  };
}

/**
 * Wire the simulation to a WebSocket endpoint on an existing http server.
 * Returns { stop() } so tests and the process can shut the interval down.
 */
export function attachGameServer(httpServer, options = {}) {
  // rewards opens first, deliberately -- GP3-0 needs its creditedLootIds() BEFORE the simulation's
  // own in-memory cart lootState is constructed, so an already-awarded pickup from a previous
  // process can be seeded in as already-collected rather than reappearing as fresh loot.
  const rewards = createRewardCoordinator({ rewardStorePath: options.rewardStorePath });
  // G3: the same before-the-simulation-exists read GP3-0 does for creditedLootIds, and for the
  // identical reason -- a fresh in-memory siege has no way to ask the store itself, so the one
  // durable world fact it needs is handed in at construction. Without this a server restart puts the
  // Old Beacon out, which is the exact "reload should not pretend the player never won" failure the
  // whole payoff is built against.
  const simulation = createSimulation({
    ...options,
    creditedLootIds: rewards.creditedLootIds(),
    beaconLit: rewards.beaconLit(),
    // G4, finally connected, and P2's whole point: the fight asks the reward store how strong this
    // hero actually is. Handed in as a function rather than a snapshot because every input changes
    // mid-session -- a child can equip a sword from the Hero screen, be handed Wren's charm, or earn
    // the XP that levels them, all without the socket dropping -- and a value copied at construction
    // would mean the stronger hero only started existing after a reconnect. That is the exact defect
    // docs/MISTAKES.md GQ-013 is about: a reward the rules never read.
    heroStatsFor: (playerId) => rewards.heroStatsFor(playerId),
  });
  // Whether the durable row has been written for the victory this process is currently watching.
  // Seeded from the store so an already-lit Beacon never re-writes, and flipped by the one tick that
  // sees the siege turn it on -- see the tick loop below.
  let beaconLitRecorded = rewards.beaconLit();
  const now = options.now ?? (() => Date.now());
  const snapshotEveryTicks = Math.max(1, Math.round(TICK_HZ / (options.snapshotHz ?? SNAPSHOT_HZ)));
  let lastStepAt = now();
  let ticksSinceSnapshot = 0;

  // The wire's encounter block, with rewards (D3) and GP2's loot state folded on: every reader of
  // encounterSnapshot()/lootSnapshot() above stays untouched, this is the one seam that adds the
  // fields the wire actually carries.
  function encounterSnapshotWithRewards() {
    const encounter = simulation.encounterSnapshot();
    return {
      ...encounter,
      rewards: rewards.rewardsFor(Object.keys(encounter.heroes)),
      loot: simulation.lootSnapshot(),
      village: rewards.villageSnapshot(),
      siege: simulation.siegeSnapshot(),
    };
  }

  const ws = attachWebSocketServer(httpServer, {
    onMessage(client, text) {
      // A ProtocolError thrown here is caught by wsServer, which closes that client with 1008. That
      // is deliberate: a client sending malformed messages is broken or hostile, and either way the
      // simulation should not be guessing what it meant.
      const message = decode(text);

      if (message.type === 'join') {
        if (client.data.playerId) throw new ProtocolError('already joined');
        const player = simulation.addPlayer(message.name);
        client.data.playerId = player.id;
        // Hero id = player id (Task B3's binding interface), so the mapping is keyed the same way
        // everything else in this file keys a hero. Absent guestId (a pre-D3 client, or a client
        // whose localStorage threw) leaves this player ephemeral -- see createRewardCoordinator's
        // own comment.
        rewards.join(player.id, message.guestId);
        // The current encounter block, not the empty placeholder -- a late joiner has to see a
        // mid-fight wolf correctly (Design ruling 7). Now including that guest's own persisted
        // marks, so a reconnect (same guestId, new playerId) sees them immediately on welcome --
        // the "marks survive a refresh" acceptance the brief's D6 harness exercises live.
        // ...and that guest's DURABLE facts, each with the eventId the store keyed it on. The
        // rewards block above is derived -- counts and a resolved weapon -- which a device cannot
        // journal, because a fact with no stable name cannot be deduplicated. These are what
        // progression/profiles.js's ingestServerFacts needs to recover a profile whose device has
        // never seen it, and to settle each fact's revision BEFORE local progression mints above it.
        // Ephemeral connections get [] from profileFactsFor, so nobody is handed anyone else's save.
        client.send(encode(welcomeMessage(
          player.id, simulation.tick, simulation.snapshot(), encounterSnapshotWithRewards(),
          rewards.profileFactsFor(player.id),
        )));
        return;
      }

      if (message.type === 'input') {
        // Inputs before joining have nowhere to go. Refusing is honest; silently dropping them would
        // present as "the hero does not move" with nothing in any log.
        if (!client.data.playerId) throw new ProtocolError('input before join');
        simulation.applyInput(client.data.playerId, message, now());
        return;
      }

      if (message.type === 'attack') {
        // Same reasoning as input-before-join: refusing is honest, silently dropping is not.
        if (!client.data.playerId) throw new ProtocolError('attack before join');
        // Applied the instant it arrives, not batched to the tick -- see applyAttack's comment.
        simulation.applyAttack(client.data.playerId, message);
        return;
      }

      if (message.type === 'restore-profile') {
        // Same before-join posture as every other durable action: refusing is honest, silently
        // dropping is not. Past that, restoreProfileFacts decides -- including refusing an
        // ephemeral connection, which is a legitimate state rather than a protocol error.
        if (!client.data.playerId) throw new ProtocolError('restore-profile before join');
        rewards.restoreProfileFacts(client.data.playerId, message.facts);
        return;
      }

      if (message.type === 'equip') {
        // Same reasoning as input-before-join: refusing is honest, silently dropping is not.
        if (!client.data.playerId) throw new ProtocolError('equip before join');
        // applyEquip throws (closing this connection, same as any other rejected message -- see the
        // ProtocolError comment above this handler) for an itemId nobody defined. GP1's real client
        // only ever sends an id it already has loaded from progression/items.js, so this only ever
        // fires for a stale or hostile client, the same posture attack/input already take.
        // The device's own identity for this choice rides through when it sent one; protocol.js
        // has already validated both halves, or refused the message.
        rewards.applyEquip(client.data.playerId, message.itemId,
          message.eventId === undefined ? undefined : { eventId: message.eventId, rev: message.rev });
        return;
      }

      if (message.type === 'search-cart') {
        // Same reasoning as input-before-join: refusing is honest, silently dropping is not.
        if (!client.data.playerId) throw new ProtocolError('search-cart before join');
        simulation.applySearchCart(client.data.playerId);
        return;
      }

      // G4: "you promised me a sword." Every fact that decides whether that is true is checked HERE,
      // server-side, because none of them are the client's to assert: where the hero is standing
      // (the simulation owns position), whether the Beacon is actually burning (shared world state),
      // and whether this guest already owns it (the durable store). The client sends no payload at
      // all -- there is nothing for it to lie about.
      //
      // A refused claim is a clean silence, not a disconnect: a child walking toward Rowan while the
      // Warden is still falling can legitimately produce one of these a beat early, the same way a
      // collect-loot can legitimately race a sibling. Same posture, same non-answer.
      if (message.type === 'claim-blade') {
        if (!client.data.playerId) throw new ProtocolError('claim-blade before join');
        const playerId = client.data.playerId;
        const { inRange, beaconLit } = simulation.rowanClaimState(playerId);
        const bladeOwned = rewards.ownedItemIdsFor(playerId).includes(WILDWOOD_BLADE_ID);
        // The client's own ask and this allow are the SAME function (world/rowanSpeech.js), so the
        // two can never drift into "the game offered it and the server refused".
        if (!rowanOwesBlade({ inRange, beaconLit, bladeOwned })) return;
        simulation.announceRewardFacts(rewards.claimWildwoodBlade(playerId).facts);
        return;
      }

      // G5: the hollow's chest. Same posture as claim-blade: position re-checked here, the award is
      // idempotent per guest, and a refusal is a clean silence rather than a disconnect.
      //
      // Paid in Wildwood Shards through the SAME durable path cart loot uses -- a shard is a shard
      // wherever it was found, and routing it here means the Village's shared supply grows from the
      // hollow too (net/rewardStore.mjs counts shard-earned rows regardless of guest). The eventId is
      // per guest, so each child earns their own cache without consuming the other's.
      if (message.type === 'claim-hollow') {
        if (!client.data.playerId) throw new ProtocolError('claim-hollow before join');
        const playerId = client.data.playerId;
        if (!rewards.hasDurableIdentity(playerId)) return;
        if (!simulation.atHollowChest(playerId)) return;
        simulation.announceRewardFacts(rewards.applyHollowCache(playerId).facts);
        return;
      }

      // ARC 2. Both re-check server-side, and both re-check through the SAME pure function the
      // client asked on -- world/rangerSpeech.js's rangerOwesCharm -- rather than a hand-copied
      // opinion of it, the exact discipline claim-blade already follows for rowanOwesBlade. A
      // refused claim is a clean silence: a child walking toward Wren can legitimately produce one a
      // beat early, and disconnecting them for arriving fast is not a rule anybody wants.
      if (message.type === 'claim-satchel') {
        if (!client.data.playerId) throw new ProtocolError('claim-satchel before join');
        const playerId = client.data.playerId;
        if (!rewards.hasDurableIdentity(playerId)) return;
        // Standing over the marker stone where it fell. Position alone, exactly like 'claim-hollow'
        // directly above: the blackthorn is client-side presentation and the server does not model
        // it, so the chest and the satchel are guarded the same way rather than one of them pretending
        // to a check the server cannot actually make.
        if (!simulation.atHollowClue(playerId)) return;
        simulation.announceRewardFacts(rewards.claimSatchel(playerId).facts);
        return;
      }

      if (message.type === 'claim-charm') {
        if (!client.data.playerId) throw new ProtocolError('claim-charm before join');
        const playerId = client.data.playerId;
        if (!rewards.hasDurableIdentity(playerId)) return;
        const { inRange, beaconLit: lit } = simulation.rangerClaimState(playerId);
        if (!rangerOwesCharm({
          inRange,
          beaconLit: lit,
          satchelCarried: rewards.satchelTakenFor(playerId),
          charmOwned: rewards.charmEarnedFor(playerId),
        })) return;
        simulation.announceRewardFacts(rewards.claimCharm(playerId).facts);
        return;
      }

      if (message.type === 'collect-loot') {
        if (!client.data.playerId) throw new ProtocolError('collect-loot before join');
        // A guestId-less connection cannot create a durable pickup award. Letting it mutate the
        // shared physical state first permanently consumed the globally unique haul while Village
        // Supplies stayed unchanged, leaving Workshop I unaffordable until restart. Refuse before
        // the simulation mutation; a durable sibling can still collect the object normally.
        if (!rewards.hasDurableIdentity(client.data.playerId)) return;
        // Only credited (rewards.applyLootAward) when the simulation itself accepted the collect --
        // already searched, a real pickup, not already gone, and this player actually in reach. A
        // stale or hostile client asking for a pickupId that fails any of those checks gets no credit
        // and no error either: same "a rejected command is a clean no, not a disconnect" posture
        // requestPartyAttack's own accepted:false already takes for a swing outside reach.
        const { accepted, kind } = simulation.applyCollectLoot(client.data.playerId, message.pickupId);
        if (accepted) {
          // The award's own announcement rides the next snapshot, so the device journals this coin
          // under the store's id as it happens rather than learning it from the next welcome.
          simulation.announceRewardFacts(
            rewards.applyLootAward(client.data.playerId, message.pickupId, kind),
          );
        }
        return;
      }

      if (message.type === 'village-upgrade-purchase') {
        if (!client.data.playerId) throw new ProtocolError('village-upgrade-purchase before join');
        // applyVillageUpgradePurchase throws (closing this connection) only for an upgradeId GP3
        // does not define at all -- same posture applyEquip already takes for an unknown weapon id.
        // Insufficient funds/already-owned are a clean accepted:false, not an error: a legitimate
        // client can hit either (a sibling bought it a tick earlier), same as collect-loot's own
        // accepted:false for a pickup someone else just took.
        rewards.applyVillageUpgradePurchase(client.data.playerId, message.upgradeId);
        return;
      }

      // welcome/snapshot/leave are server-to-client only. A client sending one is confused.
      throw new ProtocolError(`clients may not send ${message.type}`);
    },

    onClose(client) {
      const id = client.data.playerId;
      if (!id) return;
      simulation.removePlayer(id);
      rewards.leave(id);
      ws.broadcast(encode(leaveMessage(id)));
    },
  }, {
    ...options,
    // The shipped game is browser-only. Browsers always send Origin on a WebSocket upgrade, so the
    // runtime rejects origin-less raw clients by default while tests/tools may opt in explicitly.
    allowMissingOrigin: options.allowMissingOrigin ?? false,
  });

  const timer = setInterval(() => {
    const nowMs = now();
    // Real elapsed time, not the nominal tick: a busy event loop delivers late intervals, and using
    // the nominal value would make everyone drift slower than the speed they are told they have.
    // The cap is the SHARED one (public/src/net/prediction.js), not a literal: it used to be 0.25
    // here and 0.1 in the client's own prediction, and that gap is what dragged a slow client's
    // hero back off the Keeper. Neither side may move it alone now.
    const deltaSeconds = Math.min((nowMs - lastStepAt) / 1000, MAX_PREDICTION_STEP_SECONDS);
    lastStepAt = nowMs;
    const tick = simulation.step(deltaSeconds, nowMs);

    // G3: THE ONE TICK THE BEACON CATCHES FIRE ON, written down before anybody is told about it.
    //
    // Polled off the simulation's own flag rather than driven by the `beacon-ignited` event, and the
    // difference matters: events are drained only on snapshot ticks, so an event-driven write would
    // sit unwritten for up to a tenth of a second -- and a crash inside that window would light the
    // Beacon on every client's screen and forget it forever. This runs every tick, and the flag is a
    // latch, so the row lands on the first tick it is true. `recordBeaconLit` is itself idempotent on
    // a fixed eventId, making this belt and braces rather than the only guard.
    if (!beaconLitRecorded && simulation.beaconIsLit()) {
      // Provenance only: whoever happens to be connected when the world changed. The row is a WORLD
      // fact and is read for everybody (net/rewardStore.mjs's beaconLit), so any joined guest will
      // do.
      //
      // THE LATCH ONLY CLOSES ON A REAL WRITE, and that distinction is the whole bug this shape
      // fixes. It used to latch unconditionally after trying every connected player -- so a victory
      // won entirely by guestId-less (ephemeral) clients marked itself recorded, having written
      // nothing, and then stopped trying. A durable child joining a minute later would find the
      // Beacon burning on screen with no row behind it, and the next restart would put it out.
      //
      // Leaving the latch open is exactly right for that case: there is nothing to write yet, and
      // this runs every tick, so the moment a player with a durable identity is connected the row
      // lands by itself. `applied: false` from an ALREADY-WRITTEN row cannot stall it either --
      // beaconLitRecorded is seeded from the store at boot, so a world that is already recorded
      // never enters this branch at all.
      for (const player of simulation.players.values()) {
        if (rewards.recordBeaconLit(player.id).applied) {
          beaconLitRecorded = true;
          break;
        }
      }
    }

    ticksSinceSnapshot += 1;
    if (ticksSinceSnapshot >= snapshotEveryTicks) {
      ticksSinceSnapshot = 0;
      // Events accumulated across every tick since the last broadcast (Design ruling 7) -- drained
      // here, once, so they ride out with the snapshot that reflects the state they resulted in.
      const events = simulation.drainEvents();
      // D1's fold, applied through D2's store (or the ephemeral fallback), BEFORE broadcast -- the
      // brief's own ordering. rewardEvents joins the same array combat events ride, so a client
      // hears mark-earned/lantern-unlocked exactly the way it hears wolf-defeated: one events array,
      // one snapshot, no separate channel to wire up.
      const rewardEvents = rewards.processTick(events);
      // One encode for everyone rather than per client.
      ws.broadcast(encode(snapshotMessage(
        tick, simulation.snapshot(), encounterSnapshotWithRewards(), [...events, ...rewardEvents],
      )));
    }
  }, TICK_MS);
  // Do not hold the process open on this interval alone; the http server is what should keep it up.
  timer.unref?.();

  return {
    simulation,
    ws,
    // Exposed for tests that want to assert on persisted state directly, and for a future debug
    // surface -- never read by this file itself once construction is done.
    rewards,
    stop() {
      clearInterval(timer);
      ws.closeAll();
      ws.detach();
      rewards.close();
    },
  };
}
