/**
 * The Character Studio's semantic review-state vocabulary (A1 Studio convergence).
 *
 * One descriptor per selectable loadout: which gear it mounts, on which bone, whether each piece is
 * SHIPPED or an unshipped CANDIDATE, and which single item the loadout exists to review
 * (`reviewTarget`). This is the seam the next task (Owner Fit) consumes -- a caller learns what is
 * being reviewed from these identifiers and from api.js's getState(), never by scraping DOM text or
 * guessing from a file path.
 *
 * Deliberately DATA, not scene code: no three.js objects, no DOM, no loading. scene.js owns how a
 * mesh actually gets mounted; this file only names the states. Every gear id and bone name is
 * imported from character/gear.js rather than restated (GQ-007), so a renamed gear id fails here
 * at import time instead of silently drifting.
 *
 * TRUTHFULNESS RULE, and it is the reason this file exists at all: a candidate must never
 * masquerade as shipped gear. So provenance is DERIVED from the gear list, never authored per
 * loadout -- a state is `contains-candidate` if and only if it mounts at least one candidate item,
 * which makes "the label says shipping but a candidate is mounted" unrepresentable rather than
 * merely discouraged.
 *
 * TWO DIFFERENT QUESTIONS, DELIBERATELY NOT SPELLED THE SAME WAY. getState() answers both, and they
 * are not synonyms:
 *   - `loadoutIsShipping` (pre-existing, protocol field): is this EXACTLY the `shipping` baseline
 *     state -- the one the game itself produces by default?
 *   - `loadoutGearProvenance` (this file): does this state mount any UNSHIPPED asset?
 * `shipping-sword-only` and `candidate-with-lantern` are the two states where the answers differ:
 * every mounted mesh is shipped gear (`shipping-only`), yet neither is the baseline
 * (`loadoutIsShipping === false`). The values are worded `shipping-only`/`contains-candidate` --
 * never a bare "shipping" -- precisely so neither field can be read as a restatement of the other.
 * test/studio-loadouts.test.mjs pins that divergence so the two can never quietly collapse into one
 * meaning.
 *
 * Loadout IDS are protocol vocabulary (tools/sol-review/request.schema.json pins them; renaming one
 * breaks every recorded review request), so 'candidate-with-lantern' keeps its historical id even
 * though everything it mounts is shipped gear. Its label and provenance tell the truth; the id is
 * compatibility.
 */
import {
  RIGID_TIER2_GEAR,
  RIGID_BELT_LANTERN,
  WILDWOOD_BLADE_CANDIDATE_BONE_NAME,
  WILDWOOD_BLADE_CANDIDATE_ID,
} from '../character/gear.js';

// Derived, not restated (the same invariant character/weaponLoadout.js documents): the shipping
// sword is whichever Tier 2 item shares the candidate blade's hand; the shield is the other one.
const SHIPPING_SWORD = RIGID_TIER2_GEAR.find((item) => item.boneName === WILDWOOD_BLADE_CANDIDATE_BONE_NAME);
const SHIPPING_SHIELD = RIGID_TIER2_GEAR.find((item) => item.boneName !== WILDWOOD_BLADE_CANDIDATE_BONE_NAME);

/** Per-ITEM provenance: this exact mesh either ships in the game or is an unshipped candidate. */
const SHIPPED = 'shipped';
const CANDIDATE = 'candidate';

/** Per-LOADOUT provenance, aggregated from the items. Worded so it can never be mistaken for
 *  `loadoutIsShipping` -- see this file's header. */
export const SHIPPING_ONLY = 'shipping-only';
export const CONTAINS_CANDIDATE = 'contains-candidate';

function gearEntry(id, bone, provenance) {
  return Object.freeze({ id, bone, provenance });
}

const sword = gearEntry(SHIPPING_SWORD.id, SHIPPING_SWORD.boneName, SHIPPED);
const shield = gearEntry(SHIPPING_SHIELD.id, SHIPPING_SHIELD.boneName, SHIPPED);
const lantern = gearEntry(RIGID_BELT_LANTERN.id, RIGID_BELT_LANTERN.boneName, SHIPPED);
const wildwoodBlade = gearEntry(WILDWOOD_BLADE_CANDIDATE_ID, WILDWOOD_BLADE_CANDIDATE_BONE_NAME, CANDIDATE);

function descriptor({ id, label, reviewTarget, gear, note = null }) {
  if (!gear.some((item) => item.id === reviewTarget)) {
    throw new Error(`loadout "${id}" reviews "${reviewTarget}" but does not mount it`);
  }
  return Object.freeze({
    id,
    label,
    reviewTarget,
    gear: Object.freeze([...gear]),
    // Derived, never authored: one candidate item makes the whole state a candidate review, so a
    // label and its contents cannot disagree about what is being looked at.
    gearProvenance: gear.some((item) => item.provenance === CANDIDATE) ? CONTAINS_CANDIDATE : SHIPPING_ONLY,
    note,
  });
}

/**
 * Every review state the public Studio can select. Order is presentation order in studio.html's
 * loadout menu. scene.js's setLoadout executes exactly these ids and nothing else (it derives its
 * own LOADOUTS list from here), and the sol-review request schema's loadout enum is pinned to this
 * list by test/studio-loadouts.test.mjs.
 */
export const STUDIO_LOADOUTS = Object.freeze([
  descriptor({
    id: 'shipping',
    label: 'shipping — Ironwood sword + shield',
    reviewTarget: SHIPPING_SWORD.id,
    gear: [sword, shield],
  }),
  descriptor({
    id: 'shipping-sword-only',
    label: 'shipping sword only — shield hidden',
    reviewTarget: SHIPPING_SWORD.id,
    gear: [sword],
    note: 'Review-only visibility state: the shipped shield is hidden so the sword silhouette reads unobstructed. Shipped gear only, but NOT the baseline state the game produces.',
  }),
  descriptor({
    id: 'candidate-with-lantern',
    label: 'shipping + belt lantern (post-unlock)',
    reviewTarget: RIGID_BELT_LANTERN.id,
    gear: [sword, shield, lantern],
    note: 'Historical protocol id. Everything mounted is shipped gear; this is the real post-unlock state the game produces after three Lantern Marks.',
  }),
  descriptor({
    id: 'candidate-wildwood-blade',
    label: 'Wildwood Blade CANDIDATE — replaces shipping sword',
    reviewTarget: WILDWOOD_BLADE_CANDIDATE_ID,
    gear: [wildwoodBlade, shield],
    note: 'W1-A candidate under assets/gear/candidates/. Unshipped and unproven; shown instead of the shipping sword, never alongside it.',
  }),
]);

export const LOADOUT_IDS = Object.freeze(STUDIO_LOADOUTS.map((entry) => entry.id));

const BY_ID = new Map(STUDIO_LOADOUTS.map((entry) => [entry.id, entry]));

/** Fail-closed lookup: an unknown id is null, never a guessed default. Callers decide whether
 *  null is a throw (scene.js's setLoadout) or a revert-to-shipping (studio.html's menu). */
export function loadoutDescriptor(id) {
  return BY_ID.get(id) ?? null;
}

/** Every distinct gear item any loadout can mount -- the list scene.js's gearVisibility() reports
 *  against, so "what is mounted right now" always covers the full vocabulary, not just the current
 *  selection. */
export const ALL_STUDIO_GEAR = Object.freeze([
  ...new Map(
    STUDIO_LOADOUTS.flatMap((entry) => entry.gear).map((item) => [item.id, item]),
  ).values(),
]);
