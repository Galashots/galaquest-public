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
  separateFromWolf,
  stepParty,
} from '../public/src/combat/encounter.js';
import { RUN_SPEED, groundSpeedForInput } from '../public/src/character/speed.js';
import { ProtocolError, decode, encode, leaveMessage, roundToWire, snapshotMessage, welcomeMessage }
  from '../public/src/net/protocol.js';
import { MARKS_TO_UNLOCK, createRewardLedger, foldEvents } from '../public/src/rewards/marks.js';
import {
  DEFAULT_EQUIPPED_WEAPON_ID, STARTER_SWORD_ID, isKnownWeapon, swingDamageFor,
} from '../public/src/progression/items.js';
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
  BEACON_ARENA, BEACON_WARDEN, CART_SEARCH, COLD_SEALS, HOLLOW, RANGER_CLAIM, ROWAN_CLAIM, WOLF_SPAWN,
  WOLF_SPAWNS,
} from '../public/src/world/zones/village.js';
import { rowanOwesBlade } from '../public/src/world/rowanSpeech.js';
import { rangerOwesCharm } from '../public/src/world/rangerSpeech.js';
import { WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
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

// ARC 2: what Ranger Wren's charm is worth, in hearts.
//
// ONE, and the number is the design. Three hearts is three mistakes; four is four, which is roughly
// a third more room and is exactly the note the child playtesters gave when they called the wolves
// "a little strong". Two would be a different game -- the Warden's own comment prices itself at
// "three mistakes, not one" and a six-heart child walks through that fight without learning its
// rhythm. A reward that removes the lesson is not a reward.
export const CHARM_BONUS_HEARTS = 1;

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
    if (!guestId) return { granted: false };
    const result = store.apply({
      guestId,
      heroId: playerId,
      type: 'gear-owned',
      eventId: `own:${guestId}:${WILDWOOD_BLADE_ID}`,
      value: WILDWOOD_BLADE_ID,
    });
    return { granted: result.applied };
  }

  /**
   * ARC 2: the fallen ranger's satchel, lifted off the floor of Blackthorn Hollow. Once per guest,
   * ever, and per guest rather than per world for the same reason the Blade is: two brothers each
   * pick it up for themselves. A satchel that only one child could ever carry would mean the other
   * one never gets to be the person who brings it back.
   */
  function claimSatchel(playerId) {
    const guestId = guestIdByPlayer.get(playerId);
    if (!guestId) return { granted: false };
    const result = store.apply({
      guestId, heroId: playerId, type: 'satchel-taken',
      eventId: `satchel:${guestId}`, value: null,
    });
    return { granted: result.applied };
  }

  /**
   * ARC 2: Wren's charm -- the fourth heart, and the first reward in this game that changes what a
   * hero IS rather than what they are holding.
   *
   * The row is the durable fact; combat/encounter.js's reconcileMaxHp is what makes it a heart, fed
   * from maxHpFor below. Nothing here writes hearts directly, which is the whole point of the seam:
   * a heart granted by the store rather than by the rules would be a number nobody's fight agreed to.
   */
  function claimCharm(playerId) {
    const guestId = guestIdByPlayer.get(playerId);
    if (!guestId) return { granted: false };
    const result = store.apply({
      guestId, heroId: playerId, type: 'charm-earned',
      eventId: `charm:${guestId}`, value: null,
    });
    return { granted: result.applied };
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
    if (!guestId) return { granted: 0 };
    let granted = 0;
    for (let index = 1; index <= HOLLOW_CACHE_SHARDS; index += 1) {
      const result = store.apply({
        guestId,
        heroId: playerId,
        type: 'shard-earned',
        eventId: `hollow-cache:${guestId}:${index}`,
        value: null,
      });
      if (result.applied) granted += 1;
    }
    return { granted };
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
  function applyEquip(playerId, itemId, identity) {
    if (!isKnownWeapon(itemId)) {
      throw new Error(`applyEquip got an unknown weapon id ${JSON.stringify(itemId)}`);
    }
    if (!ownedItemIdsFor(playerId).includes(itemId)) {
      throw new Error(`applyEquip: player ${playerId} does not own ${JSON.stringify(itemId)}`);
    }
    const guestId = guestIdByPlayer.get(playerId);
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
        guestId, heroId: playerId, type: 'weapon-equipped', eventId, value: itemId, rev,
      });
      // A repeated equip identity is a replay, not a failure: the child's choice is already on
      // record with the order it was made, and re-sending it must be the no-op INSERT OR IGNORE
      // already makes it. Only a server-minted identity is expected to be new every time.
      if (!result.applied && !identity?.eventId) {
        throw new Error(`applyEquip failed to record a new durable event for ${guestId}`);
      }
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
        const unlocked = store.apply({
          guestId, heroId: award.heroId, type: 'lantern-unlocked', eventId: `lantern:${guestId}`,
        });
        if (unlocked.applied) {
          events.push({ type: 'lantern-unlocked', heroId: award.heroId, eventId: `lantern:${guestId}` });
        }
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
    // randomUUID, not the fold's own life index: the index restarts at 0 with the process and would
    // recompute an eventId already on disk. See rewards/marks.js's header for both halves of that
    // lesson and for why the id is minted per LIFE rather than per contributor.
    const folded = foldEvents(ledger, events, { mintLifeId: () => randomUUID() });
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
          satchelCarried: store.satchelTakenFor(guestId),
          charmOwned: store.charmEarnedFor(guestId),
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
          // An equip-only connection has no durable identity, so it can never have picked anything
          // up or been given anything -- false is the truth for it, not a fallback.
          satchelCarried: false,
          charmOwned: false,
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
    recordBeaconLit,
    beaconLit,
    ownedItemIdsFor,
    /** What this hero is swinging, for the fight rules -- the same value rewardsFor puts on the
     *  wire, pulled out on its own because the tick needs it every frame and a whole rewards block
     *  per player per tick would be a lot of object for one string. Durable guests read the store;
     *  an equip-only connection reads its ephemeral slot; nobody at all gets null, which
     *  encounter.js resolves to the starter sword. */
    equippedWeaponIdFor(heroId) {
      const guestId = guestIdByPlayer.get(heroId);
      if (guestId) return store.equippedWeaponFor(guestId) ?? DEFAULT_EQUIPPED_WEAPON_ID;
      return ephemeralEquipped.get(heroId) ?? DEFAULT_EQUIPPED_WEAPON_ID;
    },
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
  const weaponIdFor = options.weaponIdFor ?? (() => null);
  // The same shape and the same reasoning for hearts: the simulation does not own who has earned a
  // charm, so it asks. Defaults to the constant every fight has always used, which is what keeps an
  // unwired createSimulation() -- every test in this repo that drives it directly -- unchanged.
  const maxHpFor = options.maxHpFor ?? (() => HERO_MAX_HP);
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

  // G2/G3: THE BEACON SIEGE, one for the whole simulation -- the same "one party, one wolf" shape
  // encounterState above already is, for the same reason: there is one Old Beacon and every joined
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
    // interface), THEN separateFromWolf per player (Design ruling 6 -- server owns body
    // separation, this is the teleport's death), THEN the existing world clamp -- a push away from
    // the wolf must not be able to shove a hero back out past WORLD_LIMIT.
    const commandHeroes = {};
    for (const player of players.values()) {
      commandHeroes[player.id] = {
        position: { x: player.x, z: player.z },
        heading: player.heading,
        // Resolved to a NUMBER here rather than passed on as an id: the rules layer is not allowed
        // to know the item catalogue exists (test/combat-purity.test.mjs), and this side of the seam
        // already knows both. swingDamageFor never returns null, so a swing always lands for
        // something even when nobody has said what is equipped.
        weaponDamage: swingDamageFor(weaponIdFor(player.id)),
        // ...and how many hearts this body has. Asked every tick for the same reason the weapon is:
        // a child can be handed Wren's charm mid-session, and a value copied at join would mean the
        // fourth heart only appeared after a reconnect.
        maxHp: maxHpFor(player.id),
      };
    }
    // The handoff runs BEFORE either engine steps, so a hero is never simulated for a tick by the
    // fight they have just walked out of.
    settleArenas();

    const partyResult = stepParty(encounterState, { deltaSeconds, heroes: commandHeroes });
    encounterState = partyResult.state;
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
    // G4, finally connected: the fight asks the reward store what is in the hand. Handed in as a
    // function rather than a snapshot because equipment changes mid-session -- a child can open the
    // Hero screen in the middle of a fight -- and a value copied at construction would mean the
    // sword you equipped only started working after a reconnect.
    weaponIdFor: (playerId) => rewards.equippedWeaponIdFor(playerId),
    // ARC 2, and the whole reason maxHp became a per-hero number: Wren's charm is a durable row, and
    // this is where a row becomes a heart.
    maxHpFor: (playerId) => (rewards.charmEarnedFor(playerId) ? HERO_MAX_HP + CHARM_BONUS_HEARTS : HERO_MAX_HP),
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
        rewards.claimWildwoodBlade(playerId);
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
        rewards.applyHollowCache(playerId);
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
        rewards.claimSatchel(playerId);
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
        rewards.claimCharm(playerId);
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
