// Which sword is in his hand. The pure half of GP1-C4 -- the mapping from an equipped progression id
// to a mesh, and the visibility rule that guarantees exactly one blade exists at a time.
//
// The MESH itself (does it sit in the fist, does the blade clip the leg) is not judged here and
// cannot be: that is a solved transform in character/gear.js and it is accepted by looking at
// captures of the running game, per this repo's standing rule for anything gear-shaped.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHIPPING_SWORD_MESH_ID,
  WEAPON_BONE_NAME,
  WILDWOOD_BLADE_CANDIDATE_ID,
  cloneWeaponAnchors,
  showWeaponOnClone,
  weaponMeshIdFor,
  weaponVisibility,
} from '../public/src/character/weaponLoadout.js';
import { rigidAnchorName } from '../public/src/character/gear.js';
import { STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';

test('the shipping sword is found from the gear table, not written down a second time', () => {
  assert.equal(SHIPPING_SWORD_MESH_ID, 'sword_ironwood');
  assert.equal(WEAPON_BONE_NAME, 'RightHand');
  assert.notEqual(SHIPPING_SWORD_MESH_ID, WILDWOOD_BLADE_CANDIDATE_ID);
});

test('the equipped item decides the mesh', () => {
  assert.equal(weaponMeshIdFor(STARTER_SWORD_ID), SHIPPING_SWORD_MESH_ID);
  assert.equal(weaponMeshIdFor(WILDWOOD_BLADE_ID), WILDWOOD_BLADE_CANDIDATE_ID);
});

// The same "always a safe fallback, never a blank" discipline progression/state.js applies to the
// equipped-weapon field itself. A weapon whose mesh has not shipped is drawn as the sword he owns.
test('anything unknown, null, or not a weapon falls back to the shipping sword', () => {
  for (const id of [null, undefined, '', 'not_an_item', 'shield_of_nothing']) {
    assert.equal(weaponMeshIdFor(id), SHIPPING_SWORD_MESH_ID, `${JSON.stringify(id)} did not fall back`);
  }
});

// The whole point of the rule, stated as an invariant rather than as three cases.
test('EXACTLY ONE sword is visible in every reachable state -- never two, never none', () => {
  for (const equippedItemId of [STARTER_SWORD_ID, WILDWOOD_BLADE_ID, null, 'not_an_item']) {
    for (const candidateMounted of [false, true]) {
      const visible = weaponVisibility({ equippedItemId, candidateMounted });
      const count = Number(visible.shipping) + Number(visible.candidate);
      assert.equal(count, 1, `${equippedItemId} / mounted=${candidateMounted} showed ${count} swords`);
    }
  }
  assert.equal(weaponVisibility().shipping, true, 'called with nothing at all, he still holds a sword');
});

test('equipping the Blade shows the Blade -- once its mesh has actually landed', () => {
  assert.deepEqual(weaponVisibility({ equippedItemId: WILDWOOD_BLADE_ID, candidateMounted: true }),
    { shipping: false, candidate: true });
});

// A disappear-then-appear across a GLB download is a bug a child would read as "my sword broke".
test('while the Blade mesh is still downloading he keeps holding the sword he has', () => {
  assert.deepEqual(weaponVisibility({ equippedItemId: WILDWOOD_BLADE_ID, candidateMounted: false }),
    { shipping: true, candidate: false });
});

test('switching back to the Starter Sword restores the Ironwood even with the Blade mounted', () => {
  assert.deepEqual(weaponVisibility({ equippedItemId: STARTER_SWORD_ID, candidateMounted: true }),
    { shipping: true, candidate: false });
});

// A fake with exactly the one method net/remotes.js's clone offers this helper. Deliberately not a
// three.js Object3D: the rule under test is "find these two anchors by name and set two booleans",
// and nothing about it should need a scene graph to prove.
function fakeClone(names) {
  const objects = new Map(names.map((name) => [name, { name, visible: null }]));
  return { objects, getObjectByName: (name) => objects.get(name) ?? undefined };
}

test('a cloned remote is drawn holding the sword the wire says they hold', () => {
  const shippingName = rigidAnchorName(SHIPPING_SWORD_MESH_ID, WEAPON_BONE_NAME);
  const candidateName = rigidAnchorName(WILDWOOD_BLADE_CANDIDATE_ID, WEAPON_BONE_NAME);
  const clone = fakeClone([shippingName, candidateName]);
  const anchors = cloneWeaponAnchors(clone);

  assert.deepEqual(showWeaponOnClone(anchors, WILDWOOD_BLADE_ID), { shipping: false, candidate: true });
  assert.equal(clone.objects.get(shippingName).visible, false);
  assert.equal(clone.objects.get(candidateName).visible, true);

  // ...and back, on the same anchors: a sibling who swaps is redrawn, not frozen at what they joined
  // holding. This is the case the old forceShippingWeaponOnClone could not express at all.
  assert.deepEqual(showWeaponOnClone(anchors, STARTER_SWORD_ID), { shipping: true, candidate: false });
  assert.equal(clone.objects.get(shippingName).visible, true);
  assert.equal(clone.objects.get(candidateName).visible, false);
});

// The ordinary case: a remote cloned before anyone ever equipped the Blade has no candidate anchor
// in its hierarchy at all. That must be a no-op, not a crash on the join path -- and the sibling
// keeps the sword he is already holding rather than being handed an empty fist.
test('a clone with no Blade anchor keeps the shipping sword rather than throwing', () => {
  const shippingName = rigidAnchorName(SHIPPING_SWORD_MESH_ID, WEAPON_BONE_NAME);
  const clone = fakeClone([shippingName]);
  const anchors = cloneWeaponAnchors(clone);

  assert.equal(anchors.candidate, null);
  assert.deepEqual(showWeaponOnClone(anchors, WILDWOOD_BLADE_ID), { shipping: true, candidate: false });
  assert.equal(clone.objects.get(shippingName).visible, true);
});

test('sabotage: the anchor names really are the ones gear.js builds, not a second guess at them', () => {
  assert.equal(rigidAnchorName(SHIPPING_SWORD_MESH_ID, WEAPON_BONE_NAME), 'InterimAdapter_sword_ironwood_RightHand');
  assert.equal(rigidAnchorName(WILDWOOD_BLADE_CANDIDATE_ID, WEAPON_BONE_NAME),
    'InterimAdapter_sword_wildwood_w1a_RightHand');
});
