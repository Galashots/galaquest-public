// WHICH SWORD IS ACTUALLY IN HIS HAND.
//
// The Hero screen has said WILDWOOD BLADE / EQUIPPED / DAMAGE 2 since GP1, and the boy in the 3D
// world has been holding the Ironwood sword the whole time. That contradiction was survivable while
// the preview was a close-up of whatever the camera happened to be pointing at; GP1-C3 made the
// character legible from anywhere, which made it glaring instead. This module closes it.
//
// It is the JOIN between two things that should not import each other. progression/items.js owns
// what a child can own and equip (pure data, no three.js). character/gear.js owns how a mesh is
// seated on a bone (solved transforms, measured against the running game, locked). Neither should
// grow a dependency on the other just to answer "so which mesh do I draw" -- that question lives
// here, and it is pure: no three.js, no DOM, no scene graph, unit tested directly.
//
// NOTHING HERE MOVES A MESH. The Wildwood transform was solved by tools/runtime-test/
// fit-wildwood-blade.mjs and baked into gear.js's RIGID_WILDWOOD_BLADE_CANDIDATE; the shipping
// sword's was re-fitted in the Forge on 2026-08-24 after the Owner rejected the earlier carry. This
// file only ever decides which of two
// already-solved anchors is VISIBLE.

import {
  RIGID_TIER2_GEAR,
  WILDWOOD_BLADE_CANDIDATE_BONE_NAME,
  WILDWOOD_BLADE_CANDIDATE_ID,
  rigidAnchorName,
} from './gear.js';
import { WEAPON_SLOT, itemDef } from '../progression/items.js';

// Derived, not restated (GQ-007): the shipping weapon is whichever Tier 2 item is mounted on the
// same hand the candidate blade goes to. That phrasing is also the invariant -- if a future weapon
// ever mounted on the other hand, this would stop finding it rather than quietly returning a shield.
const SHIPPING_WEAPON = RIGID_TIER2_GEAR.find((item) => item.boneName === WILDWOOD_BLADE_CANDIDATE_BONE_NAME);
export const SHIPPING_SWORD_MESH_ID = SHIPPING_WEAPON.id;
export const WEAPON_BONE_NAME = WILDWOOD_BLADE_CANDIDATE_BONE_NAME;

// One row per weapon the runtime can actually DRAW. Keyed by the progression item id, because that
// is what the server's equip mirror carries. Any weapon item without a row falls back to the
// shipping sword -- which is the honest answer for an item whose mesh has not shipped yet, and the
// same "always a safe fallback, never a blank" discipline progression/state.js already applies to
// the equipped-weapon field itself.
const WEAPON_MESH_BY_ITEM_ID = Object.freeze({
  starter_sword: SHIPPING_SWORD_MESH_ID,
  wildwood_blade: WILDWOOD_BLADE_CANDIDATE_ID,
});

export { WILDWOOD_BLADE_CANDIDATE_ID };

/**
 * Pure. Progression item id in, the id of the mesh that should be in his hand out.
 * A non-weapon id, an unknown id or null all resolve to the shipping sword.
 */
export function weaponMeshIdFor(equippedItemId) {
  const def = itemDef(equippedItemId);
  if (def === null || def.slot !== WEAPON_SLOT) return SHIPPING_SWORD_MESH_ID;
  return WEAPON_MESH_BY_ITEM_ID[def.id] ?? SHIPPING_SWORD_MESH_ID;
}

/**
 * Pure. The whole visibility rule, as one function, so the two properties that matter are provable
 * without a GPU:
 *
 *   EXACTLY ONE sword is ever visible. Never two -- a second blade growing out of the same fist for
 *   even one frame is the ugliest possible outcome here. Never zero either: a child who taps EQUIP
 *   and gets an empty hand while a GLB downloads has been shown a bug, not a loading state.
 *
 * `candidateMounted` is false until the Wildwood GLB has actually landed AND been attached. Until
 * then the answer is deliberately "keep holding the old sword": the swap happens in ONE step, on the
 * frame the new mesh genuinely exists, rather than as a disappear-then-appear across a network wait.
 */
export function weaponVisibility({ equippedItemId, candidateMounted = false } = {}) {
  const candidate = weaponMeshIdFor(equippedItemId) === WILDWOOD_BLADE_CANDIDATE_ID && candidateMounted === true;
  return { shipping: !candidate, candidate };
}

/**
 * The two sword anchors on a CLONED hero, looked up once.
 *
 * net/remotes.js builds every other player's avatar by SkeletonUtils-cloning the LOCAL hero, and a
 * clone has entirely new object identities -- so the anchors are found by NAME, the same way
 * rigidAnchorName's own comment describes. Returned rather than acted on, and cached by the caller,
 * because the alternative is walking a whole rig per remote per frame to set two booleans.
 *
 * `candidate` is null on the ordinary clone: the Wildwood GLB is fetched lazily, only when the hero
 * it was cloned from had already equipped the Blade. A caller that can mount one may do so and
 * replace the field; a caller that cannot gets the honest fallback from showWeaponOnClone below.
 *
 * Takes any object with getObjectByName, so a plain fake exercises it in a unit test.
 */
export function cloneWeaponAnchors(clonedRoot) {
  return {
    shipping: clonedRoot.getObjectByName(rigidAnchorName(SHIPPING_SWORD_MESH_ID, WEAPON_BONE_NAME)) ?? null,
    candidate: clonedRoot.getObjectByName(rigidAnchorName(WILDWOOD_BLADE_CANDIDATE_ID, WEAPON_BONE_NAME)) ?? null,
  };
}

/**
 * Draw a cloned hero holding `equippedItemId`, by the same rule the local hero is drawn by.
 *
 * THIS REPLACED forceShippingWeaponOnClone, whose comment said exactly why it existed: "The wire
 * carries no per-player equipment, so there is no honest way to draw someone else's actual weapon
 * yet; every remote getting the same shipping sword is the one answer that is at least consistent
 * and never a lie about a specific item." That was right, and it stopped being right when the wire
 * grew `players[].weaponId`. The old function is gone rather than kept beside this one: a superseded
 * rule left in place reads as a live alternative, and this repo has paid for that before.
 *
 * The invariant it protected is unchanged and is weaponVisibility's, not a second copy of it:
 * EXACTLY ONE sword, never two out of the same fist, never an empty hand. An unmounted candidate
 * still resolves to the shipping sword -- so a sibling holding a Blade this client has no mesh for
 * keeps the sword he was already holding rather than losing one.
 */
export function showWeaponOnClone(anchors, equippedItemId) {
  const visible = weaponVisibility({ equippedItemId, candidateMounted: anchors.candidate !== null });
  if (anchors.shipping) anchors.shipping.visible = visible.shipping;
  if (anchors.candidate) anchors.candidate.visible = visible.candidate;
  return visible;
}
