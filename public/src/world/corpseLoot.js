// public/src/world/corpseLoot.js
//
// #87: PERSONAL corpse loot. A defeated loot-bearing enemy leaves a corpse that carries an
// INDEPENDENT gear claim per eligible hero, rather than the first-to-walk-over-it ground pickup
// world/enemyDrops.js's own GEAR_DROP_KIND has always been. One sibling collecting their own claim
// must never remove another sibling's -- the whole point of this module existing separately from
// enemyDrops.js's shared, anyone-can-grab-it ground state.
//
// SCOPE, corrected after the Owner running-game FAIL at d575f240 (this paragraph used to say coins
// were unchanged and this module owned GEAR ONLY, which is what made the defect invisible): personal
// corpse loot owns the ordinary NON-HEALTH reward receipt -- COINS always, GEAR when its existing
// roll succeeds. Gear alone was not enough, because the game's own opening enemy is kind 'wolf' and
// dropTableForKind('wolf') gives gearChance 0, so the first fight every child has could never
// produce a claim at all. See CORPSE_COIN_KIND below for the full argument and for why HEARTS
// deliberately stay physical.
//
// ELIGIBILITY: this module does not decide who is eligible -- it trusts `kill.eligibleHeroIds`,
// which net/gameServerCore.mjs derives from the SAME participation rule rewards/killXp.js already
// uses to award kill XP (every hero who landed at least one hit during the life that ends in the
// kill, not only whoever landed the killing blow). Killing-blow ownership is deliberately not the
// law here either, matching #87's own required outcome list.
//
// PURE: no I/O, no clock, no wall-clock randomness -- the same discipline enemyDrops.js documents at
// length. `rng` is a caller-supplied `() => number in [0, 1)` (the server passes Math.random; a test
// passes a scripted sequence), kept at the seam so a roll is reproducible in a test at all.
//
// EPHEMERAL WORLD STATE, not a durable reward-store fact -- the identical posture enemyDrops.js's own
// header takes and for the identical reason: a corpse's own claim ("hero X may take item Y from
// corpse Z") carries no durable identity worth recovering across a restart. The durable fact is the
// eventual gear-owned grant the caller applies once a claim is actually taken (net/gameServerCore.mjs
// routes that through the existing reward store, exactly as a ground gear pickup already did). A
// server restart losing an un-looted corpse is the same honest answer enemyDrops.js already gives for
// an un-collected ground drop -- this module does not invent a second persistence system.
//
// IDENTITY NOTE: a claim is keyed by the hero's own connection-scoped heroId, the same identity every
// other piece of live combat state (position, HP, a ground drop's own `collectedBy`) already uses.
// A full reconnect mints a fresh heroId in this codebase's current architecture (net/gameServerCore.
// mjs's own addPlayer), so a hero who disconnects before looting and reconnects becomes a new body
// with no claim on the old one -- an existing, pre-#87 limitation of the whole live-combat identity
// model, not a new one this module introduces. CORPSE_LOOT_EXPIRE_SECONDS below is the mitigation:
// generous enough that stepping away and walking back (the common case) still finds the loot, without
// the corpse existing forever.

import { GEAR_DROP_POOL, dropTableForKind } from './enemyDrops.js';

export const CORPSE_GEAR_KIND = 'gear';

// #87, Owner running-game FAIL at d575f240: this module was GEAR-ONLY, and the game's own opening
// enemy is kind 'wolf', whose dropTableForKind gives gearChance 0. So requestCorpseLoot returned
// spawned:null on every ordinary kill and the natural first fight could NEVER show a LOOT
// affordance -- the child's whole introduction to #87 was unreachable, deterministically, not
// unluckily. Personal corpse loot now owns the ordinary NON-HEALTH reward receipt: coins always,
// gear when its existing roll succeeds.
//
// Hearts deliberately stay physical ground pickups. A heart is immediate combat sustain -- you want
// it in the middle of a fight, by running over it, not behind a modal that stops you fighting.
// Moving it here for architectural symmetry would make the game worse.
//
// ONE ROW, NOT N. A claim carries a single coin item with an AMOUNT, because a child reads
// "Coins x 3" and taps once; three separate rows to tap is a worse panel and blows the wire's own
// MAX_CORPSE_ITEMS_PER_CLAIM. The durable ledger still records one row per coin -- see
// net/gameServerCore.mjs, which derives that many distinct eventIds from this one item id, so
// rewardStore's COUNT(*)-based coinsFor is unchanged and a replayed collect still pays once.
export const CORPSE_COIN_KIND = 'coin';

// How close a hero must stand to actually take an item off a corpse. Generous like enemyDrops.js's
// own DROP_COLLECT_RADIUS_METERS (1.3m, "a thumb, not a keyhole"), a little larger because opening a
// corpse is a deliberate richer interaction (read the panel, choose Take All) rather than a walk-
// through grab. PROVISIONAL implementation tuning, not a locked product law -- #87 itself lists "exact
// nearby eligibility radius" as an open question.
export const CORPSE_LOOT_INTERACT_RADIUS_METERS = 2.5;

// How long an unresolved corpse waits before it gives up on a missing/disconnected eligible hero.
// Generous enough that a child who steps away mid-fight (to help a sibling, to answer a parent) can
// still walk back for their own loot; short enough that a corpse from an hour-old fight does not
// litter the world forever. PROVISIONAL, the same tuning-not-law posture as the radius above.
export const CORPSE_LOOT_EXPIRE_SECONDS = 180;

// Server-side cap on concurrently live corpses -- the same "a busy fight must never grow an
// unbounded pile" reasoning enemyDrops.js's own MAX_CONCURRENT_DROPS gives, sized well under the
// wire's own MAX_WIRE_CORPSES headroom (net/protocolCore.js).
export const MAX_CONCURRENT_CORPSES = 12;

// BLOCKER correction: how long a corpse every eligible hero has fully resolved still lingers on the
// wire before it actually retires, mirroring world/enemyDrops.js's own COLLECTED_LINGER_SECONDS (1s)
// for the identical reason -- net/gameServerCore.mjs adjudicates a collect message (applyClaimCorpseItem
// /applyClaimAllCorpseLoot) OUT OF BAND from its own tick loop, flipping `taken` the instant it accepts
// the request. Retiring a fully-resolved corpse on the VERY NEXT step() (the old, un-lingered
// behaviour) removed it from corpseLootState BEFORE that tick's own corpsesSnapshot() was ever built,
// so the client's next snapshot never contained the item's own false -> true transition at all --
// world/corpseLootPresenter.js's own newlyTakenItems (a pure snapshot diff, the only signal driving
// the acquired-item toast/Hero-button pulse/pickup sound) saw nothing to report, and the panel found
// its own corpseId gone and silently closed. Taking the LAST item on a corpse -- always true in solo
// play, and always true for whichever eligible hero loots last in co-op -- produced a real accepted
// collect with ZERO player-visible confirmation. Lingering here costs nothing new: the corpse's own
// glow/prompt already stop offering it the instant every one of THIS hero's own items reads taken
// (world/corpseLootPresenter.js's own hasUnclaimedLoot), so a lingering, fully-resolved corpse is
// inert on every client's screen -- it exists on the wire for exactly long enough that one more real
// snapshot carries the transition before this module drops it for good.
export const CORPSE_LOOT_RESOLVED_LINGER_SECONDS = 1;

// Correction: mirrors net/protocolCore.js's own MAX_CORPSE_CLAIMS (8) exactly. Not imported --
// world/ stays a leaf the net/ layer imports FROM, never the reverse -- but this module must never
// mint a corpse the wire's own decoder would refuse. Nine or more eligible heroes contributing to a
// single kill (already reachable today with enough connected players, and trivially reachable once a
// guaranteed reward grants a claim to every eligible hero unconditionally) used to produce a corpse
// with more claims than the wire allows; decodeCorpses would then fail on every client and the whole
// snapshot -- positions, enemies, everything -- got silently dropped until the corpse retired.
export const MAX_CLAIMS_PER_CORPSE = 8;

function freezeItem(item) {
  return Object.freeze({ ...item });
}

function freezeClaim(claim) {
  return Object.freeze({ ...claim, items: Object.freeze(claim.items.map(freezeItem)) });
}

function freezeCorpse(corpse) {
  return Object.freeze({ ...corpse, claims: Object.freeze(corpse.claims.map(freezeClaim)) });
}

function freezeState(next) {
  return Object.freeze({ corpses: Object.freeze(next.corpses.map(freezeCorpse)) });
}

/** A fresh, empty ground: nobody has left a corpse yet. */
export function createCorpseLootState() {
  return freezeState({ corpses: [] });
}

/** Oldest-first eviction once a roll would push the live count over MAX_CONCURRENT_CORPSES, the
 *  identical "keep the youngest, cap the total" rule enemyDrops.js's own enforceDropCap applies. */
function enforceCorpseCap(corpses) {
  if (corpses.length <= MAX_CONCURRENT_CORPSES) return corpses;
  return [...corpses].sort((a, b) => a.ageSeconds - b.ageSeconds).slice(0, MAX_CONCURRENT_CORPSES);
}

/**
 * One hero's independent ordinary gear roll for `kind`, ownership-aware. Reuses world/enemyDrops.
 * js's own dropTableForKind/GEAR_DROP_POOL so there is one authority for "does this kind drop gear,
 * how often, from which pool" rather than a second table free to drift from that one.
 *
 * Suppresses (returns null) rather than granting a duplicate when every pool item this hero does not
 * already own is exhausted -- PROGRESSION_CONTRACT_V0.md section 6's own rule: "do not roll a
 * duplicate and silently make the drop disappear... suppress the gear roll rather than lying".
 */
function rollOrdinaryGear(kind, ownedItemIds, rng) {
  const table = dropTableForKind(kind);
  // Correction: a table with guaranteedGearOrHeart (today only alpha-wolf) sets gearChance to 0 on
  // purpose for enemyDrops.js's OWN killer-only roll -- see requestEnemyDrop's own guaranteed
  // branch, which flips a coin between gear and a heart instead of reading gearChance at all. A
  // non-killer eligible hero's independent ordinary roll here must not read that literal 0 -- doing
  // so made the game's single highest-value enemy the one kind that could NEVER grant a contributor
  // gear, exactly backwards from #87's own fairness goal (a killing-blow monopoly on gear, on the
  // Alpha specifically). Mirrors the killer's own odds instead: the same 0.5 coin-flip shot at gear;
  // the other half of that flip is enemyDrops.js's own heart, which sits outside this module's scope
  // (see this file's header), so it simply produces nothing here.
  const gearChance = table.guaranteedGearOrHeart ? 0.5 : table.gearChance;
  if (gearChance <= 0 || rng() >= gearChance) return null;
  const candidates = GEAR_DROP_POOL.filter((itemId) => !ownedItemIds.includes(itemId));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

/**
 * Roll and spawn the personal corpse one loot-bearing enemy's defeat earns.
 *
 * @param state    the current corpse-loot state.
 * @param kill
 *   enemyId, lifeId       identity of the life that just ended -- the same caller-minted lifeId
 *                         discipline every other R1 reward source takes (the server passes
 *                         randomUUID(), never a restart-fragile in-process counter).
 *   kind                  the enemy's own kind, read against enemyDrops.js's own dropTableForKind.
 *   x, z                  where it died.
 *   eligibleHeroIds       every hero credited as a contributor to this life. See this file's own
 *                         header for where net/gameServerCore.mjs derives this from.
 *   killerHeroId          the hero who landed the killing blow, or null.
 *   coinAmountFor(heroId) how many ordinary coins THIS hero's own claim carries. The caller owns
 *                         this because coin counts are per-hero: the killer's is the exact count
 *                         enemyDrops.js's own roll already produced for this kill (reused verbatim,
 *                         never re-rolled, the same discipline killerGearItemId keeps below), and a
 *                         non-killing contributor's is rolled from the same band at THEIR own
 *                         streak. Defaults to none, so every existing caller and fixture behaves
 *                         exactly as it did before coins existed here.
 *   killerGearItemId      an item id already rolled AND ownership-checked by enemyDrops.js's own
 *                         requestEnemyDrop for the killing blow, or null if that roll produced no
 *                         gear (or there is no killer). Reused rather than re-rolled here, so the
 *                         killing hero's own gear ODDS do not change across this package -- only
 *                         where the item is collected from does.
 *   guaranteedItemIds     item ids every eligible hero receives unconditionally, independent of the
 *                         ordinary roll and never suppressed for ownership here -- the generic seam
 *                         a future quest/progression-critical reward (#90's Beacon Warden sword) can
 *                         hand a real item id through. Defaults to none: this package does not wire
 *                         any production caller of it. A caller wanting ownership-aware suppression
 *                         for a specific guaranteed reward makes that decision itself before calling,
 *                         since a quest-unique item's duplicate policy is a product decision this
 *                         generic seam should not hardcode.
 *   ownedItemIdsFor       (heroId) => string[] -- each eligible hero's own current ownership, read
 *                         only to keep the independent ordinary roll ownership-aware. Defaults to
 *                         "owns nothing" for a caller that has not wired ownership.
 * @param rng      `() => number in [0, 1)`.
 * @returns { state, spawned } -- `spawned` is the corpse this call created, or null when nobody
 *   eligible ended up with anything to loot (an empty corpse is worse UX than no corpse at all, so
 *   this never creates one).
 */
export function requestCorpseLoot(state, kill, rng) {
  const {
    enemyId, lifeId, kind, x, z, eligibleHeroIds = [], killerHeroId = null,
    killerGearItemId = null, guaranteedItemIds = [], ownedItemIdsFor = () => [],
    coinAmountFor = () => 0,
  } = kill;

  // Correction: cap how many eligible heroes this corpse actually processes at MAX_CLAIMS_PER_CORPSE
  // -- BEFORE any rolling happens, so a 9th-or-later eligible hero never even takes a roll it could
  // not keep. The killing hero, when eligible, is always kept (unshifted to the front) rather than
  // left to alphabetic/insertion luck, since losing the killer's own claim to a headcount overflow
  // would be a strictly worse failure than losing an assisting contributor's.
  const boundedHeroIds = (killerHeroId != null && eligibleHeroIds.includes(killerHeroId)
    ? [killerHeroId, ...eligibleHeroIds.filter((heroId) => heroId !== killerHeroId)]
    : eligibleHeroIds
  ).slice(0, MAX_CLAIMS_PER_CORPSE);

  const claims = [];
  for (const heroId of boundedHeroIds) {
    const owned = ownedItemIdsFor(heroId) ?? [];
    const items = [];

    guaranteedItemIds.forEach((itemId, index) => {
      items.push({
        id: `corpse-item:${enemyId}:${lifeId}:${heroId}:guaranteed:${index}`,
        kind: CORPSE_GEAR_KIND,
        itemId,
        guaranteed: true,
        taken: false,
      });
    });

    // The killer's own ordinary gear odds come SOLELY from enemyDrops.js's already-made roll, never
    // a second independent one here -- otherwise the killing blow would get two shots (its own
    // ground-roll reuse plus this file's own dice) at the identical pool, inflating its own gear
    // odds beyond what R1's balance already proved out.
    const ordinaryItemId = heroId === killerHeroId
      ? (killerGearItemId != null && !owned.includes(killerGearItemId) ? killerGearItemId : null)
      : rollOrdinaryGear(kind, owned, rng);
    if (ordinaryItemId != null) {
      items.push({
        id: `corpse-item:${enemyId}:${lifeId}:${heroId}:ordinary`,
        kind: CORPSE_GEAR_KIND,
        itemId: ordinaryItemId,
        guaranteed: false,
        taken: false,
      });
    }

    // Coins last, so the gear a child is actually excited about reads at the top of the panel.
    const coinAmount = Math.max(0, Math.floor(Number(coinAmountFor(heroId)) || 0));
    if (coinAmount > 0) {
      items.push({
        id: `corpse-item:${enemyId}:${lifeId}:${heroId}:coins`,
        kind: CORPSE_COIN_KIND,
        amount: coinAmount,
        guaranteed: false,
        taken: false,
      });
    }

    if (items.length > 0) claims.push({ heroId, items });
  }

  if (claims.length === 0) return { state, spawned: null };

  const corpse = freezeCorpse({
    id: `corpse:${enemyId}:${lifeId}`, enemyId, lifeId, x, z, ageSeconds: 0, claims,
  });
  return {
    state: freezeState({ corpses: enforceCorpseCap([...state.corpses, corpse]) }),
    spawned: corpse,
  };
}

/**
 * Advance every corpse's own clock by `deltaSeconds`, and retire whichever no longer belongs on the
 * ground: fully resolved (every claim's every item taken -- the actual "corpse stops glowing once
 * everybody eligible has looted" rule) lingers CORPSE_LOOT_RESOLVED_LINGER_SECONDS past the tick it
 * first read fully-resolved, then retires -- see that constant's own comment for why the linger is
 * load-bearing, not cosmetic. Anything still unresolved retires once it has sat that way for
 * CORPSE_LOOT_EXPIRE_SECONDS (the disconnect/abandonment safety net, not the normal path).
 */
export function stepCorpseLoot(state, deltaSeconds) {
  const step = Math.max(0, deltaSeconds ?? 0);
  const corpses = [];
  for (const corpse of state.corpses) {
    const allTaken = corpse.claims.every((claim) => claim.items.every((item) => item.taken));
    const ageSeconds = corpse.ageSeconds + step;
    if (allTaken) {
      // First tick this corpse reads fully-resolved: anchor the linger clock to its age as of the
      // START of this step (before `step` is added), the same "age as of the last real tick, not a
      // guessed moment" discipline this whole module already keeps -- the actual resolving action
      // (a collect message) always lands strictly between two step() calls, out of band, never inside
      // one, so the corpse's own pre-step age is the honest anchor.
      const resolvedAtSeconds = corpse.resolvedAtSeconds ?? corpse.ageSeconds;
      if (ageSeconds - resolvedAtSeconds >= CORPSE_LOOT_RESOLVED_LINGER_SECONDS) continue;
      corpses.push({ ...corpse, ageSeconds, resolvedAtSeconds });
      continue;
    }
    if (ageSeconds >= CORPSE_LOOT_EXPIRE_SECONDS) continue;
    corpses.push({ ...corpse, ageSeconds });
  }
  return freezeState({ corpses });
}

function replaceItem(state, corpseId, heroId, predicate, mutate) {
  const corpseIndex = state.corpses.findIndex((corpse) => corpse.id === corpseId);
  if (corpseIndex === -1) return null;
  const corpse = state.corpses[corpseIndex];
  const claimIndex = corpse.claims.findIndex((claim) => claim.heroId === heroId);
  if (claimIndex === -1) return null;
  const claim = corpse.claims[claimIndex];
  const matched = claim.items.filter(predicate);
  if (matched.length === 0) return null;

  const nextItems = claim.items.map((item) => (predicate(item) ? mutate(item) : item));
  const nextClaims = [...corpse.claims];
  nextClaims[claimIndex] = { ...claim, items: nextItems };
  const nextCorpses = [...state.corpses];
  nextCorpses[corpseIndex] = { ...corpse, claims: nextClaims };
  return { state: freezeState({ corpses: nextCorpses }), items: matched };
}

/**
 * Ask to take ONE named item off a corpse. Rejected (state unchanged, accepted: false, item: null)
 * when: no corpse with this id is on the ground, this hero holds no claim on it at all (never
 * someone else's claim -- the actual "cannot consume a sibling's personal loot" enforcement), no
 * item with this id sits in that claim, it is already taken (first request to arrive wins, the
 * identical "cannot be awarded twice" shape world/enemyDrops.js's own requestCollectEnemyDrop
 * already takes -- this is also what makes a resend/replay after this succeeds a safe no-op), or
 * heroPosition is not actually close enough -- the same "server owns physical truth" posture
 * enemyDrops.js's own reach check and combat/encounter.js's own isWithinStrike both already take.
 */
export function requestClaimCorpseItem(state, heroId, corpseId, claimItemId, heroPosition) {
  const corpse = state.corpses.find((candidate) => candidate.id === corpseId);
  if (!corpse) return { state, accepted: false, item: null };
  const distance = Math.hypot(heroPosition.x - corpse.x, heroPosition.z - corpse.z);
  if (distance > CORPSE_LOOT_INTERACT_RADIUS_METERS) return { state, accepted: false, item: null };

  const result = replaceItem(
    state, corpseId, heroId,
    (item) => item.id === claimItemId && !item.taken,
    (item) => ({ ...item, taken: true }),
  );
  if (!result) return { state, accepted: false, item: null };
  return { state: result.state, accepted: true, item: result.items[0] };
}

/**
 * Ask to take EVERY still-untaken item off a corpse for one hero -- the `Take All` action. Resolves
 * ONLY that hero's own items, the same claim-scoped lookup requestClaimCorpseItem above uses, so
 * pressing Take All can never reach into another eligible hero's claim on the same corpse. Rejected
 * (accepted: false, items: []) under the identical conditions as a single claim: unknown corpse, no
 * claim for this hero, nothing left untaken, or too far away.
 */
export function requestClaimAllCorpseLoot(state, heroId, corpseId, heroPosition) {
  const corpse = state.corpses.find((candidate) => candidate.id === corpseId);
  if (!corpse) return { state, accepted: false, items: [] };
  const distance = Math.hypot(heroPosition.x - corpse.x, heroPosition.z - corpse.z);
  if (distance > CORPSE_LOOT_INTERACT_RADIUS_METERS) return { state, accepted: false, items: [] };

  const result = replaceItem(
    state, corpseId, heroId,
    (item) => !item.taken,
    (item) => ({ ...item, taken: true }),
  );
  if (!result) return { state, accepted: false, items: [] };
  return { state: result.state, accepted: true, items: result.items };
}

/**
 * MAJOR correction: mark every still-untaken item THIS hero's own claim(s) hold that name `itemId` as
 * taken -- WITHOUT granting anything itself (the caller's own idempotent grantOwnership already owns
 * the actual award). net/gameServerCore.mjs calls this the moment the identical item is collected
 * through world/enemyDrops.js's own ground-gear path, which the ground-gear shadow mode this codebase
 * still runs makes possible: the killer's own corpse claim always reuses that SAME roll's own itemId
 * verbatim rather than re-rolling (requestCorpseLoot's own killer branch above), and ground gear
 * auto-collects on proximity with no tap at all (world/enemyDrops.js's own DROP_COLLECT_RADIUS_METERS,
 * smaller than this file's own CORPSE_LOOT_INTERACT_RADIUS_METERS) -- so a killer routinely picks the
 * ground copy up on the walk TO the corpse, before ever opening it. Left unsynced, the corpse claim
 * kept offering that already-owned item as a live, enabled TAKE: accepted by the server, but a grant
 * of an itemId already owned announces nothing (idempotent by design, proven safe by
 * test/enemy-drops-server.test.mjs's own "shadow mode safety" test) and taking it was, until this
 * correction, the last untaken item on a solo killer's own claim -- exactly the corpse-retirement race
 * this file's own CORPSE_LOOT_RESOLVED_LINGER_SECONDS exists to survive, just triggered from the
 * ground side instead of a corpse-panel tap. Syncing `taken` here the instant the ground copy is
 * actually collected means the corpse never offers that dead button at all: this hero's own
 * hasUnclaimedLoot (world/corpseLootPresenter.js) and stepCorpseLoot's own retirement rule both fall
 * out for free from state that is simply already true, with no second "already owned" branch needed
 * anywhere in the presenter.
 *
 * Scoped by itemId rather than a specific corpseId on purpose: a ground drop and a corpse claim are
 * never correlated by any shared id (their own lifeIds are independently minted randomUUIDs, see
 * net/gameServerCore.mjs's own kill-drop tick) -- the identical itemId IS the only correlation this
 * codebase has ever drawn between the two paths, the same one the shadow-mode-safety test already
 * relies on. A no-op (returns `state` unchanged) when this hero holds no untaken claim naming
 * `itemId` on any live corpse -- the ordinary case for every kind that never scatters gear at all.
 */
export function resolveGroundCollectedClaimItems(state, heroId, itemId) {
  let changed = false;
  const corpses = state.corpses.map((corpse) => {
    const claimIndex = corpse.claims.findIndex((claim) => claim.heroId === heroId);
    if (claimIndex === -1) return corpse;
    const claim = corpse.claims[claimIndex];
    if (!claim.items.some((item) => item.itemId === itemId && !item.taken)) return corpse;
    changed = true;
    const nextItems = claim.items.map(
      (item) => (item.itemId === itemId && !item.taken ? { ...item, taken: true } : item),
    );
    const nextClaims = [...corpse.claims];
    nextClaims[claimIndex] = { ...claim, items: nextItems };
    return { ...corpse, claims: nextClaims };
  });
  if (!changed) return state;
  return freezeState({ corpses });
}

/**
 * Correction: reattach every still-live claim keyed to `fromHeroId` onto `toHeroId` instead --
 * a reconnect fix. A full reconnect mints a NEW heroId (net/gameServerCore.mjs's own addPlayer,
 * connection-scoped), but a corpse claim was earned by the same guest, keyed by their own durable
 * `ownedItemIdsFor`/reward-store identity. Without this, a claim minted before a reload/wifi blip
 * became permanently unreachable (the new heroId holds no claim, the old one is gone) AND kept
 * occupying that corpse's own slot toward MAX_CONCURRENT_CORPSES for the full expiry window, even
 * though nothing was actually being duplicated.
 *
 * The caller (net/gameServerCore.mjs) is the one that actually knows a guestId maps
 * old-heroId -> new-heroId; this module only ever deals in heroIds, so it takes both explicitly
 * rather than reaching for a guestId concept of its own.
 *
 * A no-op (returns `state` unchanged) when nothing is owed: no live corpse holds a claim under
 * `fromHeroId`, or a corpse already holds a claim under BOTH ids (should not happen in practice --
 * a heroId is retired the instant its own connection drops -- but a caller mistake here fails safe,
 * leaving the existing claims alone, rather than silently merging or dropping one).
 */
export function reassignClaimHero(state, fromHeroId, toHeroId) {
  if (fromHeroId === toHeroId) return state;
  let changed = false;
  const corpses = state.corpses.map((corpse) => {
    const claimIndex = corpse.claims.findIndex((claim) => claim.heroId === fromHeroId);
    if (claimIndex === -1) return corpse;
    if (corpse.claims.some((claim) => claim.heroId === toHeroId)) return corpse;
    changed = true;
    const nextClaims = [...corpse.claims];
    nextClaims[claimIndex] = { ...nextClaims[claimIndex], heroId: toHeroId };
    return { ...corpse, claims: nextClaims };
  });
  if (!changed) return state;
  return freezeState({ corpses });
}
