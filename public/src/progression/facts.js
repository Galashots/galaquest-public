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
// rather than an accumulation. It carries `rev`, a DURABLE revision, and ties break on eventId --
// see latestEquippedWeaponId for the reading law, and the note below for what the revision means.
//
// `rev` is not a counter and not a row index, because it was both of those first and both were
// wrong at exactly the boundary this file exists for. A counter held in memory restarts at zero on
// the next page load; an index reconstructed from whichever database is currently readable restarts
// when that database is replaced. Either way a NEW equip is minted with a number beneath an OLD one
// and "latest wins" quietly returns the weapon the child stopped holding.
//
// So `rev` is WHEN the child chose: epoch milliseconds stamped at the action itself, guarded to stay
// strictly above that profile's own history so a clock knocked backwards still orders that device's
// own equips. Surviving a wipe is not what makes the number mean something -- being minted at the
// only moment that describes the choice is. The device journal does outlive a server wipe, but two
// devices that have not spoken both start from an empty journal and both number their first offline
// equip identically; that is a tie, and a tie is not chronology. A clock is the one ordering both
// writers already share. progression/profiles.js mints it, and it then TRAVELS with the fact through
// journal and server alike -- neither store recomputes it, which is what keeps the two sides from
// disagreeing about an order neither of them authored.
//
// Pure: no DOM, no storage, no clock, no three.js. net/gameServer.mjs already imports files under
// public/src/progression/ directly (items.js), so anything here has to stay importable there.

/** One profile's own earnings. `village-upgrade` and `beacon-lit` are deliberately absent: those are
 *  world facts, not one profile's earnings, and folding them into a personal state would be a
 *  category error. */
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

/** Facts about the WORLD rather than about one child. Durable and guest-stamped (the row records who
 *  did it), but shared: two brothers stand under one lit Beacon, not two. A device may not restore
 *  one -- see net/gameServer.mjs's restoreProfileFacts -- but the server publishes them on welcome,
 *  because a guest's rows are selected by guest id and these are among them. */
export const WORLD_FACT_TYPES = Object.freeze([
  'village-upgrade',
  'beacon-lit',
]);

/**
 * EVERY durable fact type, and the one list of them.
 *
 * net/rewardStore.mjs used to keep its own hand-written copy of this under the name
 * KNOWN_AWARD_TYPES, and the two lists disagreed about exactly one entry: this file recognised and
 * folded `xp-earned` while the store refused it as unknown, so XP could be named by the client and
 * never written to disk. Nobody noticed because nothing awarded XP yet -- a placeholder that looks
 * like a working durable fact is worse than a missing one, because every reader assumes it works.
 *
 * Derived rather than restated (docs/MISTAKES.md GQ-007) so that split cannot come back: adding a
 * type to either list above now adds it to the store, the wire, and the fold in one edit.
 */
export const DURABLE_FACT_TYPES = Object.freeze([...PROFILE_FACT_TYPES, ...WORLD_FACT_TYPES]);

const PROFILE_FACT_TYPE_SET = new Set(PROFILE_FACT_TYPES);
const DURABLE_FACT_TYPE_SET = new Set(DURABLE_FACT_TYPES);

/** Whether this is a durable fact type at all -- profile or world. The check the wire boundary makes,
 *  where a world fact riding a welcome message is legitimate and an invented type is not. */
export function isDurableFactType(type) {
  return typeof type === 'string' && DURABLE_FACT_TYPE_SET.has(type);
}

/** The largest total XP that can be counted exactly. Past this, integers stop being integers. */
export const MAX_TOTAL_XP = Number.MAX_SAFE_INTEGER;

/**
 * THE one reading of what an `xp-earned` fact's value means. Returns the amount, or null.
 *
 * XP rides in the same TEXT `value` column every other payload fact uses, so it arrives as a string
 * and has to be READ rather than assumed. It used to be read with `Number.parseInt(value, 10)`,
 * which is not a validator and never was: it reads "12abc" as 12, "1e6" as 1, "2.5" as 2 and -- the
 * one that matters -- "-40" as -40. A durable progression currency that accepts a negative amount is
 * one a corrupt or hand-edited journal can run BACKWARDS, and it would present as a child losing
 * levels they had earned, with nothing anywhere logging why.
 *
 * So the rules are narrow and stated in one place, and every layer that folds or accepts XP calls
 * this rather than parsing for itself:
 *
 *   - a canonical decimal integer with no sign, no leading zero, no fraction, no exponent, no
 *     whitespace -- one amount has exactly one spelling, which is what lets two stores compare
 *     copies of the same fact without normalising first;
 *   - strictly positive, because a fact recording that nothing was earned is not a fact;
 *   - within exact integer range, so a total can be counted rather than approximated.
 */
export function parseXpFactAmount(value) {
  if (typeof value !== 'string') return null;
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : null;
}

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
 * everything except `rev` -- which foldFacts resolves by maximum and then by eventId, never by
 * position, precisely so this function never has to care.
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
      } else if (numberOr(fact.rev, -1) > numberOr(existing.rev, -1)) {
        // The same fact reached us from both stores and only one copy knows its revision -- the
        // journal has stamped it, the server's copy never carried one. Keep the better-informed
        // copy: dropping the revision here would hand the ordering back to iteration order, which
        // is the failure this whole field exists to prevent.
        byId.set(fact.eventId, fact);
      }
    }
  }
  return [...byId.values()];
}

/**
 * Order two equip facts. Higher revision wins; a tie breaks on eventId.
 *
 * The tiebreaker is not decoration. Two tabs, or an offline equip meeting a server one, can
 * genuinely mint the same revision, and "whichever the loop happened to reach last" would then make
 * the child's weapon depend on which store was read first -- so a reload could silently change it.
 * Comparing the ids is arbitrary but total and stable, which is all a tiebreak has to be.
 */
function equipOutranks(fact, bestRev, bestEventId) {
  const rev = numberOr(fact.rev, -1);
  if (rev !== bestRev) return rev > bestRev;
  return bestEventId === null || fact.eventId > bestEventId;
}

/**
 * THE law for "which equip fact is the current one", exported so there is exactly one of it.
 *
 * Both readers of the durable rows have to answer this identically or the game contradicts itself:
 * net/rewardStore.mjs answers it for the rewards block and for live combat damage, and the device
 * answers it for the profile it recovered. They had drifted -- the store ordered by `rowid DESC`,
 * the arrival order of the rows, while the fold ordered by the order the child actually chose in.
 * Whenever a newer choice reached the table first (two tabs on one profile, a reconnect, an import
 * writing facts long after the moment they describe) the two gave different weapons from the same
 * rows. Arrival is not chronology; that is the whole reason `rev` exists.
 *
 * @param facts  weapon-equipped facts IN ARRIVAL ORDER (rowid ascending for the store, journal order
 *               for the device). Order only decides the legacy case below.
 *
 * Two tiers, because the store predates the ordering:
 *   - Any fact carrying a `rev` outranks every fact that carries none. A row written before schema
 *     v3 describes a choice made before the ordering existed, so it cannot claim to be the newer one
 *     however late it was written down.
 *   - Among revved facts: highest `rev`, ties broken on `eventId` -- arbitrary but total and stable,
 *     so two tabs minting the same millisecond cannot resolve differently on the two sides.
 *   - Among un-revved facts only: the last to arrive, which is the only order they have ever had.
 */
export function latestEquippedFact(facts) {
  let bestRev = -1;
  let bestEventId = null;
  let best = null;
  let legacy = null;

  for (const fact of facts) {
    if (!isProfileFact(fact) || fact.type !== 'weapon-equipped') continue;
    if (typeof fact.value !== 'string' || fact.value.length === 0) continue;

    if (typeof fact.rev === 'number' && Number.isFinite(fact.rev)) {
      if (equipOutranks(fact, bestRev, bestEventId)) {
        bestRev = fact.rev;
        bestEventId = fact.eventId;
        best = fact;
      }
    } else {
      // Last one seen wins among the un-revved, which is why this takes arrival order as its input
      // rather than sorting: there is nothing else about these rows to sort BY.
      legacy = fact;
    }
  }

  return best ?? legacy;
}

/**
 * Which weapon that fact names -- the answer almost every caller actually wants.
 *
 * A thin wrapper rather than a second loop, and that is the point: the reading law had two
 * implementations once already (the store's `ORDER BY rowid DESC` against the fold's revision order)
 * and the two gave different weapons from the same rows. A caller that needs the whole fact -- to
 * re-send an equip the server has not heard about, identity and order intact -- must not have to
 * re-derive "which one is latest" to get it, because a second derivation is a second law (GQ-007).
 */
export function latestEquippedWeaponId(facts) {
  return latestEquippedFact(facts)?.value ?? null;
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
        // Read through the one shared parser, never with parseInt -- see parseXpFactAmount for the
        // four ways that quietly went wrong. A malformed amount is DROPPED rather than counted or
        // thrown on: this fold runs against a journal recovered from device storage, so a single
        // corrupt row must degrade to "slightly less XP" and not to a hero who cannot be loaded.
        const amount = parseXpFactAmount(fact.value);
        // Saturating rather than wrapping into float territory: two enormous valid amounts can sum
        // past exact integer range, and a total that stops being an integer stops being countable.
        // Clamping keeps the total monotone and keeps it a legal input to progression/levels.js,
        // which refuses anything that is not a safe integer.
        if (amount !== null) xp = Math.min(MAX_TOTAL_XP, xp + amount);
        break;
      }
      // weapon-equipped is resolved by latestEquippedWeaponId below, not here: it is the one field
      // that is a choice rather than an accumulation, and its law is shared with the server.
      default: break;
    }
  }

  return {
    marks,
    lanternUnlocked,
    equippedWeaponId: latestEquippedWeaponId(merged) ?? defaults.equippedWeaponId ?? null,
    ownedItemIds: [...ownedItemIds],
    coins,
    shards,
    satchelCarried,
    charmOwned,
    xp,
  };
}
