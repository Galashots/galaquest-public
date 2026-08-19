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
// sword's was solved by fit-carry.mjs and is Sol-approved. This file only ever decides which of two
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
 * Force a CLONED hero to the shipping sword.
 *
 * net/remotes.js builds every other player's avatar by SkeletonUtils-cloning the LOCAL hero, and a
 * clone inherits whatever was mounted and whatever was visible at the instant it was taken. Without
 * this, a sibling who joined AFTER you equipped the Blade would appear holding YOUR blade, while one
 * who joined before would be holding the Ironwood -- the same player rendered two different ways
 * depending on join order. The wire carries no per-player equipment (net/protocol.js), so there is no
 * honest way to draw someone else's actual weapon yet; every remote getting the same shipping sword
 * is the one answer that is at least consistent and never a lie about a specific item.
 *
 * Works on names rather than on the mount records attach* returned, because a clone has entirely new
 * object identities -- see rigidAnchorName's own comment.
 *
 * Takes any object with getObjectByName, so a plain fake exercises it in a unit test.
 */
export function forceShippingWeaponOnClone(clonedRoot) {
  const shipping = clonedRoot.getObjectByName(rigidAnchorName(SHIPPING_SWORD_MESH_ID, WEAPON_BONE_NAME));
  const candidate = clonedRoot.getObjectByName(rigidAnchorName(WILDWOOD_BLADE_CANDIDATE_ID, WEAPON_BONE_NAME));
  if (shipping) shipping.visible = true;
  if (candidate) candidate.visible = false;
  return { shipping: shipping !== null && shipping !== undefined, candidate: candidate !== null && candidate !== undefined };
}
