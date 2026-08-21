// The durable facts a profile has earned, and the one law for turning a set of them into state.
//
// This exists because Stage 1 keeps progression in TWO places -- a local per-profile journal on the
// device and the server's reward_events table -- and a family's progress must survive either one
// going away. Two stores is normally how you get two competing truths; it is safe here only because
// of a property net/rewardStore.mjs already has and states in its own header: the table is
// append-only and every durable fact is DERIVED by counting or existence over it, never stored as a
// mutable counter.
//
// That makes the reconciliation a set union rather than a sync protocol:
//
//     state = foldFacts(unionFacts(localJournal, serverFacts))
//
// A union of two grow-only sets keyed by a stable id is order-independent and idempotent, so there
// is no last-writer-wins arbitration to get wrong and no ordering the two sides have to agree on.
// Merge a fact twice, in either order, from either origin: the same state comes out.
//
// The one field that is not additive is the equipped weapon, which is a single latest-wins value
// rather than an accumulation. It carries `seq` and is resolved by highest seq -- see foldFacts.
//
// Pure: no DOM, no storage, no clock, no three.js. net/gameServer.mjs already imports files under
// public/src/progression/ directly (items.js), so anything here has to stay importable there.

/** Mirrors net/rewardStore.mjs's KNOWN_AWARD_TYPES for the per-profile subset, plus xp-earned.
 *  `village-upgrade` and `beacon-lit` are deliberately absent: those are world facts, not one
 *  profile's earnings, and folding them into a personal state would be a category error. */
export const PROFILE_FACT_TYPES = Object.freeze([
  'mark-earned',
  'lantern-unlocked',
  'weapon-equipped',
  'gear-owned',
  'coin-earned',
  'shard-earned',
  'satchel-taken',
  'charm-earned',
  'xp-earned',
]);

const PROFILE_FACT_TYPE_SET = new Set(PROFILE_FACT_TYPES);

/** Whether this is a fact a profile can durably own. Anything else -- a world fact, a transient
 *  combat event, a malformed row recovered from storage -- is refused rather than folded, so a
 *  corrupted journal degrades to "fewer facts" instead of to a wrong number. */
export function isProfileFact(fact) {
  return Boolean(
    fact
    && typeof fact.eventId === 'string' && fact.eventId.length > 0
    && typeof fact.type === 'string' && PROFILE_FACT_TYPE_SET.has(fact.type),
  );
}

/**
 * Union two fact sequences by eventId, keeping the FIRST occurrence of each id.
 *
 * First-wins rather than last-wins on purpose: the same eventId is by construction the same fact
 * (that is what makes it an idempotency key at the store layer), so the two copies cannot disagree
 * about anything that matters, and first-wins makes the result independent of argument order for
 * everything except `seq` -- which foldFacts resolves by maximum, not by position, precisely so this
 * function never has to care.
 *
 * Non-profile facts are dropped here rather than at fold time so a caller can trust the union.
 */
export function unionFacts(...sequences) {
  const byId = new Map();
  for (const sequence of sequences) {
    if (!sequence) continue;
    for (const fact of sequence) {
      if (!isProfileFact(fact)) continue;
      const existing = byId.get(fact.eventId);
      if (existing === undefined) {
        byId.set(fact.eventId, fact);
      } else if (numberOr(fact.seq, -1) > numberOr(existing.seq, -1)) {
        // Same fact, but one copy carries a later sequence than the other. Keep the better-informed
        // copy so equip ordering survives a union in either direction.
        byId.set(fact.eventId, fact);
      }
    }
  }
  return [...byId.values()];
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Fold a set of facts into the same shape net/gameServer.mjs's rewardsFor() puts on the wire, so a
 * profile recovered purely from the local journal and a profile read from the server render through
 * exactly one code path on the client. Any divergence between those two shapes would show up as a
 * HUD that lies when the server is missing, which is the specific failure this whole design exists
 * to prevent.
 *
 * Counting rather than trusting a stored total is the point: fold the same fact twice and the count
 * does not move, because the union already collapsed it by eventId.
 *
 * @param facts        any iterable of facts; duplicates and non-profile facts are tolerated.
 * @param defaults.equippedWeaponId  what a hero holds when they have never equipped anything.
 * @param defaults.ownedItemIds      what a hero owns before earning anything (the starter weapon).
 */
export function foldFacts(facts, defaults = {}) {
  const merged = unionFacts(facts);

  let marks = 0;
  let coins = 0;
  let shards = 0;
  let xp = 0;
  let lanternUnlocked = false;
  let satchelCarried = false;
  let charmOwned = false;
  const ownedItemIds = new Set(defaults.ownedItemIds ?? []);
  let equippedWeaponId = null;
  let equippedSeq = -1;

  for (const fact of merged) {
    switch (fact.type) {
      case 'mark-earned': marks += 1; break;
      case 'coin-earned': coins += 1; break;
      case 'shard-earned': shards += 1; break;
      case 'lantern-unlocked': lanternUnlocked = true; break;
      case 'satchel-taken': satchelCarried = true; break;
      case 'charm-earned': charmOwned = true; break;
      case 'gear-owned':
        if (typeof fact.value === 'string' && fact.value.length > 0) ownedItemIds.add(fact.value);
        break;
      case 'xp-earned': {
        // Stored as text in the same `value` column every other award uses (rewardStore's
        // SCHEMA_VERSION 2 added it for weapon-equipped), so it is parsed, not assumed numeric.
        const amount = Number.parseInt(fact.value, 10);
        if (Number.isFinite(amount)) xp += amount;
        break;
      }
      case 'weapon-equipped': {
        // Latest-wins, resolved by an explicit sequence rather than by iteration order -- a Map's
        // insertion order is a fact about how the union was built, not about when the child equipped
        // something, and leaning on it would make the answer depend on which store was read first.
        const seq = numberOr(fact.seq, 0);
        if (typeof fact.value === 'string' && fact.value.length > 0 && seq >= equippedSeq) {
          equippedWeaponId = fact.value;
          equippedSeq = seq;
        }
        break;
      }
      default: break;
    }
  }

  return {
    marks,
    lanternUnlocked,
    equippedWeaponId: equippedWeaponId ?? defaults.equippedWeaponId ?? null,
    ownedItemIds: [...ownedItemIds],
    coins,
    shards,
    satchelCarried,
    charmOwned,
    xp,
  };
}
