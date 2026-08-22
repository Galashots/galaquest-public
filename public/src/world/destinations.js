// Where an objective IS. The other half of CP2's keystone.
//
// world/quest.js decides what a child is doing and gives that decision a name; this turns the name
// into a place. The pairing is deliberate and it is the whole design: there is ONE branch, and the
// words and the arrow are two views of its answer, so they cannot disagree. The alternative --
// a second module re-deriving the same branch, kept honest by a test that compares them -- is
// GQ-011 verbatim, and the day somebody edits one and not the other is the day nobody notices.
//
// NOT ALL OBJECTIVES HAVE A PLACE, and that is a real answer rather than a gap. "Cut the black
// bramble" is the thing directly in front of you; "Keep the wolves away" is an animal that moves.
// Those map to an explicit `null` WITH A STATED REASON, so "has no destination" and "nobody filled
// this in" stay distinguishable -- the same distinction net/rewardStore.mjs's `origin` column draws
// between a fact the server adjudicated and one a device attested.
//
// SOME PLACES ARE DYNAMIC. The next dark light to wake is whichever is nearest and still out; a
// caller knows that and this file cannot. Those entries are functions of a context the caller
// supplies, rather than coordinates baked in here -- which keeps this file from growing a copy of
// world state that could go stale against the real one.
//
// EVERY STATIC COORDINATE IS IMPORTED, never retyped. The map is id -> existing constant, so it
// cannot drift from the world the way a second set of numbers would (GQ-007). Moving the Beacon
// moves the arrow, with nothing to remember.
//
// CP2 PREPARATION: nothing calls this yet.

import {
  BEACON_WARDEN,
  BLACKTHORN,
  CAMP,
  CART_SEARCH,
  HOLLOW,
  LANDMARKS,
  LODGE,
  OLD_BEACON,
  ROWAN,
  SPAWNS,
  WILDWOOD_GATE,
} from './zones/village.js';

/** The Lantern Tree, found by what it IS rather than by where it happens to sit in the list. An
 *  index into LANDMARKS would be a second fact about the world that nothing keeps true; the model
 *  name is the thing that actually identifies it. Its uniqueness is asserted in the test file, which
 *  is the ledger's own rule for a name-fragment lookup. */
const LANTERN_TREE = LANDMARKS.find((landmark) => landmark.model.includes('lantern_tree'));

/** A place, from whichever shape the world happens to export it. `at` is a [x, z] pair everywhere in
 *  zones/village.js, and normalising here rather than at every call site means a caller never has to
 *  know which of these constants is a prop, a landmark or a trigger volume. */
const place = ([x, z]) => Object.freeze({ x, z });

/** No place, and WHY. The reason is not decoration: it is what stops a future reader treating a null
 *  as an oversight and "fixing" it by inventing a coordinate for something that does not have one. */
const nowhere = (because) => Object.freeze({ x: null, z: null, because });

/**
 * id -> where it is.
 *
 * Keys are the ids world/quest.js mints. A value is one of:
 *   - a frozen { x, z }               a fixed place
 *   - a function (context) => place   a place only the caller can know
 *   - nowhere('reason')               genuinely placeless, with the reason recorded
 */
const DESTINATIONS = Object.freeze({
  // ── Chapter 1: the village ────────────────────────────────────────────────────────────────
  'meet-the-keeper': place(SPAWNS.keeper),
  'find-marks': nowhere('the wolf moves; a fixed arrow would point at where it used to be'),
  'light-the-tree': place(LANTERN_TREE.at),
  'find-the-gate': place(WILDWOOD_GATE.at),

  // ── Chapter 2: the dark trail ─────────────────────────────────────────────────────────────
  'follow-the-dark-trail': place(CAMP.at),
  // The nearest light still out. Dynamic because "nearest" is a fact about where the child is
  // standing, and "still out" is a fact about what they have already done.
  'wake-lights': (context) => context?.nearestUnlitLight ?? null,
  'cut-the-bramble': nowhere('it is the thing directly in front of the child; an arrow adds nothing'),
  'the-camp': place(CAMP.at),
  'search-the-cart': place(CART_SEARCH.at),
  'find-the-beacon': place(OLD_BEACON.at),

  // ── The Beacon ────────────────────────────────────────────────────────────────────────────
  'beacon-is-cold': place(OLD_BEACON.at),
  // The nearest seal not yet broken -- same reasoning as the trail lights.
  'break-seals': (context) => context?.nearestUnbrokenSeal ?? null,
  'something-answered': place(BEACON_WARDEN.at),
  'fight-the-warden': nowhere('the Warden is fighting the child; they can see exactly where it is'),
  'return-to-rowan': place(ROWAN.at),

  // ── Arc 2: the hollow and the lodge ───────────────────────────────────────────────────────
  'cut-the-blackthorn': place(BLACKTHORN.at),
  'search-the-hollow': place(HOLLOW.at),
  'find-the-lodge': place(LODGE.at),

  // ── The open-ended one ────────────────────────────────────────────────────────────────────
  'keep-the-village-safe': nowhere('a standing instruction, not an errand; there is nowhere to send them'),
});

/** Every id this file knows about. Exported so a test can hold it against what quest.js can
 *  actually produce, which is the completeness check that makes the pairing trustworthy. */
export const DESTINATION_IDS = Object.freeze(Object.keys(DESTINATIONS));

/**
 * Where the objective is, or null if it has no place.
 *
 * @param objective the value world/quest.js returned -- the whole thing, not its id, so a caller
 *   cannot accidentally ask about a name that never came from the branch.
 * @param context   whatever the caller knows that this file cannot: `nearestUnlitLight`,
 *   `nearestUnbrokenSeal`, each a { x, z } or null.
 *
 * @returns { x, z } | null. Null covers three genuinely different cases -- no objective, an
 *   objective with no place, and a dynamic place the caller could not supply -- and they are the
 *   same answer to the only question an arrow asks, which is "where do I point".
 */
export function destinationFor(objective, context = {}) {
  const entry = objective?.id === undefined ? undefined : DESTINATIONS[objective.id];
  if (entry === undefined) return null;
  if (typeof entry === 'function') return entry(context) ?? null;
  return entry.x === null ? null : entry;
}

/**
 * Why an objective has no place, when it has none by design.
 *
 * Separate from destinationFor because a caller drawing an arrow only needs the coordinate, while a
 * caller trying to understand a blank -- a test, or somebody reading a diagnostic -- needs the
 * difference between "this one deliberately has nowhere" and "this id is unknown to me".
 */
export function placelessReasonFor(objective) {
  const entry = objective?.id === undefined ? undefined : DESTINATIONS[objective.id];
  if (entry === undefined || typeof entry === 'function') return null;
  return entry.because ?? null;
}
