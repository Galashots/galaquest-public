// public/src/world/corpseLoot.js
//
// #87: PERSONAL corpse loot. A defeated loot-bearing enemy leaves a corpse that carries an
// INDEPENDENT gear claim per eligible hero, rather than the first-to-walk-over-it ground pickup
// world/enemyDrops.js's own GEAR_DROP_KIND has always been. One sibling collecting their own claim
// must never remove another sibling's -- the whole point of this module existing separately from
// enemyDrops.js's shared, anyone-can-grab-it ground state.
//
// SCOPE: coins and hearts are UNCHANGED and keep scattering physically through enemyDrops.js exactly
// as before. This module only owns GEAR, because gear is where #87's actual reported fairness bugs
// live: only the killing blow got a shot at the roll, and whoever reached the ground pickup first
// took it regardless of who actually fought for it. Replacing the coin/heart ambient scatter with a
// second corpse-UI moment is a separate, later visual/product decision, not a correctness law this
// package is gating on -- see the PR body for the explicit exclusion.
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
 * everybody eligible has looted" rule) retires immediately, no lingering needed; anything else
 * retires once it has sat unresolved for CORPSE_LOOT_EXPIRE_SECONDS (the disconnect/abandonment
 * safety net, not the normal path).
 */
export function stepCorpseLoot(state, deltaSeconds) {
  const step = Math.max(0, deltaSeconds ?? 0);
  const corpses = [];
  for (const corpse of state.corpses) {
    const allTaken = corpse.claims.every((claim) => claim.items.every((item) => item.taken));
    if (allTaken) continue;
    const ageSeconds = corpse.ageSeconds + step;
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
