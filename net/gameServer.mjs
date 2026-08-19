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
  addHero,
  createPartyEncounterState,
  removeHero,
  requestPartyAttack,
  separateFromWolf,
  stepParty,
} from '../public/src/combat/encounter.js';
import { RUN_SPEED, groundSpeedForInput } from '../public/src/character/speed.js';
import { ProtocolError, decode, encode, leaveMessage, roundToWire, snapshotMessage, welcomeMessage }
  from '../public/src/net/protocol.js';
import { MARKS_TO_UNLOCK, createRewardLedger, foldEvents } from '../public/src/rewards/marks.js';
import { DEFAULT_EQUIPPED_WEAPON_ID, STARTER_SWORD_ID, isKnownWeapon } from '../public/src/progression/items.js';
import {
  COIN_KIND, createCartLootState, pickupDef, requestCollectLoot, requestSearchCart,
  restoreCartLootState,
} from '../public/src/world/cartLoot.js';
import { WORKSHOP_I_COST, WORKSHOP_I_ID } from '../public/src/village/economy.js';
import { CART_SEARCH, WOLF_SPAWN, WOLF_SPAWNS } from '../public/src/world/zones/village.js';
import { WORLD_LIMIT, WORLD_LIMIT_NORTH, clampToWorldX, clampToWorldZ } from '../public/src/world/bounds.js';
import { MAX_PREDICTION_STEP_SECONDS } from '../public/src/net/prediction.js';
import { openRewardStore } from './rewardStore.mjs';
import { attachWebSocketServer } from './wsServer.mjs';

export const TICK_HZ = 20;
export const SNAPSHOT_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;

// The walkable bounds are IMPORTED, not declared here (see public/src/world/bounds.js): the client
// has to clamp its own prediction to the same edge or reconciliation snaps the hero back off the
// world's rim, and a browser cannot import this server-only module. Re-exported so this module's
// existing callers and tests keep their single import site, exactly as WOLF_SPAWN is below.
export { WORLD_LIMIT, WORLD_LIMIT_NORTH, clampToWorldX, clampToWorldZ };

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
 */
export function createRewardCoordinator(options = {}) {
  const store = openRewardStore(options.rewardStorePath ?? DEFAULT_REWARD_STORE_PATH);
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
  const ephemeralEquipped = new Map();
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
    ephemeralEquipped.delete(playerId);
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
  function grantOwnership(playerId, itemId) {
    const guestId = guestIdByPlayer.get(playerId);
    if (!guestId) return;
    const eventId = `own:${guestId}:${itemId}`;
    store.apply({ guestId, heroId: playerId, type: 'gear-owned', eventId, value: itemId });
  }

  /** Every item this player's guest owns, starter sword included -- the one place that constant is
   *  prepended (rewardStore.mjs's own ownedItemIdsFor deliberately does not carry it; see its
   *  comment). An ephemeral (guestId-less) connection has no durable grant path at all today -- GP1-C1
   *  only asks for a harness/dev fixture to be able to seed OWNERSHIP for a guested test fixture, not
   *  a production "gain gear" flow, so ephemeral players simply always own the starter sword. */
  function ownedItemIdsFor(playerId) {
    const guestId = guestIdByPlayer.get(playerId);
    if (!guestId) return [STARTER_SWORD_ID];
    return [STARTER_SWORD_ID, ...store.ownedItemIdsFor(guestId)];
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
   * A weapon-equipped choice, applied durably (guestId known) or in-memory (ephemeral). Unlike
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
  function applyEquip(playerId, itemId) {
    if (!isKnownWeapon(itemId)) {
      throw new Error(`applyEquip got an unknown weapon id ${JSON.stringify(itemId)}`);
    }
    if (!ownedItemIdsFor(playerId).includes(itemId)) {
      throw new Error(`applyEquip: player ${playerId} does not own ${JSON.stringify(itemId)}`);
    }
    const guestId = guestIdByPlayer.get(playerId);
    if (guestId) {
      // The old process-local sequence restarted at 1 on every server boot, repeating a durable
      // primary key and making INSERT OR IGNORE silently discard the new choice. A UUID is an actual
      // cross-process idempotency key; rewardStore orders equip choices by SQLite insertion order,
      // not by trying to smuggle chronology into this identifier.
      const eventId = `equip:${guestId}:${randomUUID()}`;
      const result = store.apply({ guestId, heroId: playerId, type: 'weapon-equipped', eventId, value: itemId });
      if (!result.applied) throw new Error(`applyEquip failed to record a new durable event for ${guestId}`);
    } else {
      ephemeralEquipped.set(playerId, itemId);
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
      }
      return;
    }
    // No durable path for an ephemeral connection (same caveat ownedItemIdsFor's own comment gives) --
    // in-memory only, lost on disconnect. The simulation-layer lootState check is still what prevents
    // a double-credit here: this function is only ever reached once per pickupId, full stop.
    const state = ephemeralLoot.get(playerId) ?? { coins: 0, shards: 0 };
    if (kind === COIN_KIND) state.coins += 1; else state.shards += 1;
    ephemeralLoot.set(playerId, state);
  }

  /** One mark-earned award, applied durably or in-memory, plus the lantern-unlocked check that
   * rides every mark (not just the third) -- store.apply()'s own idempotent eventId is what makes
   * checking on every kill safe: only the FIRST time marksFor crosses MARKS_TO_UNLOCK does the
   * lantern:<guestId> insert actually take, so "exactly once, ever" holds even across a restart
   * (D2's own close+reopen guarantee is what this is built on).
   *
   * DELIBERATE DEVIATION from using award.eventId verbatim as the durable key, found by a failing
   * test (test/reward-wiring.test.mjs, "the third kill unlocks the lantern... across a store
   * restart") rather than assumed: D1's `mark:<heroId>:<lifeIndex>` is only unique WITHIN one
   * server process's lifetime. Both of its components reset on a real restart -- `lifeIndex` comes
   * from marks.js's own in-memory ledger (starts at 0 again), and heroId is `p<n>` off
   * createSimulation's own nextPlayerNumber (also starts at 0 again) -- so a kill immediately after
   * a restart recomputes an eventId ALREADY on record from a previous run, and INSERT OR IGNORE
   * silently swallows it as a replay. It is not a replay; it is a new kill that never gets its mark.
   * The durable key instead anchors on guestId (the one identity that genuinely survives a restart)
   * plus the store's OWN current count for that guest, read immediately before applying -- a value
   * that can only ever grow, so it can never collide with a row already on record. D1's own
   * award.eventId keeps its documented job for the ephemeral (guestId-less) fallback below, where
   * per-process state is exactly right since that state does not survive a restart either.
   */
  function applyMarkAward(award) {
    const guestId = guestIdByPlayer.get(award.heroId);
    const events = [];

    if (guestId) {
      const durableEventId = `mark:${guestId}:${store.marksFor(guestId)}`;
      const result = store.apply({ guestId, heroId: award.heroId, type: 'mark-earned', eventId: durableEventId });
      if (result.applied) events.push({ type: 'mark-earned', heroId: award.heroId });
      if (store.marksFor(guestId) >= MARKS_TO_UNLOCK) {
        const unlocked = store.apply({
          guestId, heroId: award.heroId, type: 'lantern-unlocked', eventId: `lantern:${guestId}`,
        });
        if (unlocked.applied) events.push({ type: 'lantern-unlocked', heroId: award.heroId });
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
   * Fold one drainEvents() batch into awards (D1) and apply each (D2/D3), returning the events to
   * append to the SAME outgoing snapshot the combat events ride, per the brief: clients hear
   * mark-earned/lantern-unlocked "the way they hear wolf-defeated" -- one array, one broadcast.
   */
  function processTick(events) {
    const folded = foldEvents(ledger, events);
    ledger = folded.ledger;
    const rewardEvents = [];
    for (const award of folded.awards) rewardEvents.push(...applyMarkAward(award));
    return rewardEvents;
  }

  /** The wire's rewards block (net/protocol.js's decodeRewards):
   *  { [heroId]: { marks, lanternUnlocked, equippedWeaponId, ownedItemIds, coins, shards } }.
   *  equippedWeaponId always carries a value (DEFAULT_EQUIPPED_WEAPON_ID when nobody has equipped
   *  anything yet) rather than riding as absent -- unlike the wire's OWN optional-field treatment of
   *  it, a hero always has SOME weapon equipped, so there is no "not yet known" state to represent
   *  the way an as-yet-unearned mark count legitimately starts at zero. ownedItemIds is the same
   *  always-present treatment, for the same reason: a hero always owns AT LEAST the starter sword.
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
          ownedItemIds: ownedItemIdsFor(heroId),
          coins: store.coinsFor(guestId),
          shards: store.shardsFor(guestId),
        };
      } else {
        const state = ephemeral.get(heroId);
        const lootState = ephemeralLoot.get(heroId);
        rewards[heroId] = {
          marks: state?.marks ?? 0,
          lanternUnlocked: state?.unlocked ?? false,
          equippedWeaponId: ephemeralEquipped.get(heroId) ?? DEFAULT_EQUIPPED_WEAPON_ID,
          ownedItemIds: ownedItemIdsFor(heroId),
          coins: lootState?.coins ?? 0,
          shards: lootState?.shards ?? 0,
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
    ownedItemIdsFor,
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
  const players = new Map();
  let nextPlayerNumber = 0;
  let tick = 0;

  // Hero id = player id (Task B3's binding interface). One party for the whole simulation --
  // there is one wolf and every joined player is in the same fight.
  let encounterState = createPartyEncounterState({ wolfSpawn: WOLF_SPAWN, wolfSpawns: WOLF_SPAWNS, heroIds: [] });
  // Events accumulate here from both requestPartyAttack (on attack arrival) and stepParty (each
  // tick) and are drained only when a snapshot broadcasts -- Design ruling 7, "events ride
  // snapshots". Nothing here is time-based, so nothing needs `now`.
  const pendingEvents = [];
  // The last seq each player's attack was accepted or rejected at, so a resent/out-of-order
  // attack message never reaches requestPartyAttack a second time -- on top of, not instead of,
  // that function's own commandId replay guard (which alone would not catch an OUT-OF-ORDER
  // replay, only an exact repeat of the most recent commandId).
  const lastAttackSeq = new Map();

  // GP2: the shared physical cart, one for the whole simulation -- same "one party, one wolf" shape
  // encounterState already is above, just for a different piece of shared world truth. Lives here
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
    return player;
  }

  function removePlayer(id) {
    const removed = players.delete(id);
    lastAttackSeq.delete(id);
    encounterState = removeHero(encounterState, id);
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
    const result = requestPartyAttack(encounterState, id, `${id}:${seq}`);
    encounterState = result.state;
    if (result.events.length > 0) pendingEvents.push(...result.events);
    return result.accepted;
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
    // interface), THEN separateFromWolf per player (Design ruling 6 -- server owns body
    // separation, this is the teleport's death), THEN the existing world clamp -- a push away from
    // the wolf must not be able to shove a hero back out past WORLD_LIMIT.
    const commandHeroes = {};
    for (const player of players.values()) {
      commandHeroes[player.id] = { position: { x: player.x, z: player.z }, heading: player.heading };
    }
    const partyResult = stepParty(encounterState, { deltaSeconds, heroes: commandHeroes });
    encounterState = partyResult.state;
    if (partyResult.events.length > 0) pendingEvents.push(...partyResult.events);

    for (const player of players.values()) {
      const separated = separateFromWolf({ x: player.x, z: player.z }, encounterState.wolf);
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

  // The wire's encounter block (protocol.js's decodeEncounter/decodeWolf/decodeHeroes): rounded
  // like player positions, and only the fields the wire carries -- internal-only fields
  // (biteCooldown, biteLanded, swingLanded, lastCommandId) never leave the server, same boundary
  // protocol.js already draws for what canHeroAttack is allowed to read. modeSeconds is the one
  // exception (Task B4.5): enemies/wolf.js's presenter needs it to restart a one-shot clip on mode
  // re-entry, so it rides here rounded to 3 decimals like every other numeric wolf field.
  function encounterSnapshot() {
    const wolf = encounterState.wolf;
    const heroes = {};
    for (const [heroId, hero] of Object.entries(encounterState.heroes)) {
      heroes[heroId] = {
        hp: hero.hp,
        swingSeconds: roundToWire(hero.swingSeconds),
        cooldown: roundToWire(hero.cooldown),
        downSeconds: roundToWire(hero.downSeconds),
      };
    }
    return {
      revision: encounterState.revision,
      wolf: {
        x: roundToWire(wolf.x),
        z: roundToWire(wolf.z),
        heading: roundToWire(wolf.heading),
        hp: wolf.hp,
        mode: wolf.mode,
        modeSeconds: roundToWire(wolf.modeSeconds),
        targetId: wolf.targetId,
      },
      heroes,
    };
  }

  // GP2's wire block: which pickups are gone and who took them, plus whether the cart has been
  // searched at all -- see protocol.js's decodeLoot for why kind/position never ride here (derivable
  // from world/cartLoot.js's own table, not restated on the wire).
  function lootSnapshot() {
    return { spawned: lootState.spawned, collected: { ...lootState.collected } };
  }

  // Drains events accumulated since the last drain (from applyAttack and step alike) so a caller
  // can fold them into exactly one outgoing snapshot's `events` array, per Design ruling 7.
  function drainEvents() {
    return pendingEvents.splice(0, pendingEvents.length);
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
    drainEvents,
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
  const simulation = createSimulation({ ...options, creditedLootIds: rewards.creditedLootIds() });
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
        client.send(encode(welcomeMessage(
          player.id, simulation.tick, simulation.snapshot(), encounterSnapshotWithRewards(),
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

      if (message.type === 'equip') {
        // Same reasoning as input-before-join: refusing is honest, silently dropping is not.
        if (!client.data.playerId) throw new ProtocolError('equip before join');
        // applyEquip throws (closing this connection, same as any other rejected message -- see the
        // ProtocolError comment above this handler) for an itemId nobody defined. GP1's real client
        // only ever sends an id it already has loaded from progression/items.js, so this only ever
        // fires for a stale or hostile client, the same posture attack/input already take.
        rewards.applyEquip(client.data.playerId, message.itemId);
        return;
      }

      if (message.type === 'search-cart') {
        // Same reasoning as input-before-join: refusing is honest, silently dropping is not.
        if (!client.data.playerId) throw new ProtocolError('search-cart before join');
        simulation.applySearchCart(client.data.playerId);
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
        if (accepted) rewards.applyLootAward(client.data.playerId, message.pickupId, kind);
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
