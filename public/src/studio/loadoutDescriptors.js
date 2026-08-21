/**
 * The Character Studio's semantic review-state vocabulary (A1 Studio convergence).
 *
 * One descriptor per selectable loadout: which gear it mounts, on which bone, whether each piece is
 * SHIPPED or an unshipped CANDIDATE, and which single item the loadout exists to review
 * (`reviewTarget`). This is the seam review tooling consumes -- a caller learns what is being
 * reviewed from these identifiers and from api.js's getState(), never by scraping DOM text or
 * guessing from a file path.
 *
 * Deliberately DATA, not scene code: no three.js objects, no DOM, no loading. scene.js owns how a
 * mesh actually gets mounted; this file only names the states. Every gear id and bone name comes
 * from the module that owns the corresponding mount rather than being hand-typed here.
 *
 * TRUTHFULNESS RULE: a candidate must never masquerade as shipped gear. Provenance is DERIVED from
 * the gear list, never authored per loadout -- a state is `contains-candidate` if and only if it
 * mounts at least one candidate item.
 */
import {
  RIGID_TIER2_GEAR,
  RIGID_BELT_LANTERN,
  WILDWOOD_BLADE_CANDIDATE_BONE_NAME,
  WILDWOOD_BLADE_CANDIDATE_ID,
} from '../character/gear.js';
import { normalizeHiddenRegions } from '../character/anatomyOcclusion.js';
import {
  DAWNWARDEN_HELMET_CANDIDATE,
  DAWNWARDEN_SWORD_CANDIDATE,
} from './candidateGear.js';

// Derived, not restated: the shipping sword is whichever Tier 2 item shares the candidate blade's
// hand; the shield is the other one.
const SHIPPING_SWORD = RIGID_TIER2_GEAR.find((item) => item.boneName === WILDWOOD_BLADE_CANDIDATE_BONE_NAME);
const SHIPPING_SHIELD = RIGID_TIER2_GEAR.find((item) => item.boneName !== WILDWOOD_BLADE_CANDIDATE_BONE_NAME);

/** Per-ITEM provenance: this exact mesh either ships in the game or is an unshipped candidate. */
const SHIPPED = 'shipped';
const CANDIDATE = 'candidate';

/** Per-LOADOUT provenance, aggregated from the items. */
export const SHIPPING_ONLY = 'shipping-only';
export const CONTAINS_CANDIDATE = 'contains-candidate';

function gearEntry(id, bone, provenance, hideAnatomy = []) {
  return Object.freeze({
    id,
    bone,
    provenance,
    hideAnatomy: Object.freeze(normalizeHiddenRegions(hideAnatomy)),
  });
}

const sword = gearEntry(SHIPPING_SWORD.id, SHIPPING_SWORD.boneName, SHIPPED);
const shield = gearEntry(SHIPPING_SHIELD.id, SHIPPING_SHIELD.boneName, SHIPPED);
const lantern = gearEntry(RIGID_BELT_LANTERN.id, RIGID_BELT_LANTERN.boneName, SHIPPED);
const wildwoodBlade = gearEntry(WILDWOOD_BLADE_CANDIDATE_ID, WILDWOOD_BLADE_CANDIDATE_BONE_NAME, CANDIDATE);
const dawnwardenSword = gearEntry(
  DAWNWARDEN_SWORD_CANDIDATE.id,
  DAWNWARDEN_SWORD_CANDIDATE.boneName,
  CANDIDATE,
);
const dawnwardenHelmet = gearEntry(
  DAWNWARDEN_HELMET_CANDIDATE.id,
  DAWNWARDEN_HELMET_CANDIDATE.boneName,
  CANDIDATE,
  DAWNWARDEN_HELMET_CANDIDATE.hideAnatomy,
);

function descriptor({ id, label, reviewTarget, gear, note = null }) {
  if (!gear.some((item) => item.id === reviewTarget)) {
    throw new Error(`loadout "${id}" reviews "${reviewTarget}" but does not mount it`);
  }
  return Object.freeze({
    id,
    label,
    reviewTarget,
    gear: Object.freeze([...gear]),
    gearProvenance: gear.some((item) => item.provenance === CANDIDATE) ? CONTAINS_CANDIDATE : SHIPPING_ONLY,
    hideAnatomy: Object.freeze(normalizeHiddenRegions(gear.flatMap((item) => item.hideAnatomy))),
    note,
  });
}

/**
 * Every review state the public Studio can select. Order is presentation order in studio.html's
 * loadout menu. scene.js executes exactly this vocabulary and the Sol-review schema is pinned to it
 * by test/studio-loadouts.test.mjs.
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
  descriptor({
    id: 'candidate-dawnwarden-sword',
    label: 'Dawnwarden Sword CANDIDATE — replaces shipping sword',
    reviewTarget: DAWNWARDEN_SWORD_CANDIDATE.id,
    gear: [dawnwardenSword, shield],
    note: 'PR #26 Tier-4 candidate. The Studio mount is an inspection baseline only until multi-angle, animation, and gameplay review accept the fit.',
  }),
  descriptor({
    id: 'candidate-dawnwarden-helmet',
    label: 'Dawnwarden Helmet CANDIDATE — over shipping loadout',
    reviewTarget: DAWNWARDEN_HELMET_CANDIDATE.id,
    gear: [sword, shield, dawnwardenHelmet],
    note: 'PR #26 Tier-4 candidate. Keeps the shipping weapon/shield constant so the helmet is the only visual variable.',
  }),
]);

export const LOADOUT_IDS = Object.freeze(STUDIO_LOADOUTS.map((entry) => entry.id));

const BY_ID = new Map(STUDIO_LOADOUTS.map((entry) => [entry.id, entry]));

/** Fail-closed lookup: an unknown id is null, never a guessed default. */
export function loadoutDescriptor(id) {
  return BY_ID.get(id) ?? null;
}

/** Every distinct gear item any loadout can mount. */
export const ALL_STUDIO_GEAR = Object.freeze([
  ...new Map(
    STUDIO_LOADOUTS.flatMap((entry) => entry.gear).map((item) => [item.id, item]),
  ).values(),
]);
