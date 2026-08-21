// Character Studio loadout vocabulary is the semantic review-state seam. These tests protect the
// properties that make it trustworthy: fail-closed lookup, truthful shipped/candidate provenance,
// the one-sword rule, and cross-boundary schema/scene sync.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  ALL_STUDIO_GEAR,
  CONTAINS_CANDIDATE,
  LOADOUT_IDS,
  SHIPPING_ONLY,
  STUDIO_LOADOUTS,
  loadoutDescriptor,
} from '../public/src/studio/loadoutDescriptors.js';
import {
  BELT_LANTERN_URL,
  RIGID_BELT_LANTERN,
  RIGID_TIER2_GEAR,
  WILDWOOD_BLADE_CANDIDATE_BONE_NAME,
  WILDWOOD_BLADE_CANDIDATE_ID,
  WILDWOOD_BLADE_CANDIDATE_URL,
} from '../public/src/character/gear.js';
import { STUDIO_CANDIDATE_GEAR } from '../public/src/studio/candidateGear.js';
import { LOADOUTS as SCENE_LOADOUTS } from '../public/src/studio/scene.js';

test('an unknown loadout fails closed: null, not a guessed default and not a throw', () => {
  assert.equal(loadoutDescriptor('helmet-of-wishes'), null);
  assert.equal(loadoutDescriptor(''), null);
  assert.equal(loadoutDescriptor(undefined), null);
});

test('every selectable id resolves to its own descriptor', () => {
  for (const id of LOADOUT_IDS) {
    const descriptor = loadoutDescriptor(id);
    assert.ok(descriptor, `no descriptor for "${id}"`);
    assert.equal(descriptor.id, id);
  }
});

test('scene.js executes exactly the descriptor vocabulary -- no orphan states in either direction', () => {
  assert.deepEqual([...SCENE_LOADOUTS], [...LOADOUT_IDS]);
});

test('the sol-review protocol loadout enums are pinned to the descriptor vocabulary', () => {
  const schema = JSON.parse(readFileSync('tools/sol-review/request.schema.json', 'utf8'));
  const capture = schema.else.then.properties.request.properties.loadout.enum;
  const envelope = schema.else.else.else.then.properties.request.properties.loadout.enum;
  assert.deepEqual(capture, [...LOADOUT_IDS]);
  assert.deepEqual(envelope, [...LOADOUT_IDS]);
});

test('every descriptor mounts its own review target', () => {
  for (const descriptor of STUDIO_LOADOUTS) {
    assert.ok(
      descriptor.gear.some((item) => item.id === descriptor.reviewTarget),
      `"${descriptor.id}" reviews ${descriptor.reviewTarget} but does not mount it`,
    );
  }
});

test('exactly one sword per loadout: never two blades in the weapon hand, never an empty hand', () => {
  for (const descriptor of STUDIO_LOADOUTS) {
    const inWeaponHand = descriptor.gear.filter((item) => item.bone === WILDWOOD_BLADE_CANDIDATE_BONE_NAME);
    assert.equal(
      inWeaponHand.length, 1,
      `"${descriptor.id}" puts ${inWeaponHand.length} items in the weapon hand: ${inWeaponHand.map((i) => i.id).join(', ')}`,
    );
  }
});

test('provenance is derived and truthful: contains-candidate iff a candidate item is mounted', () => {
  for (const descriptor of STUDIO_LOADOUTS) {
    const mountsCandidate = descriptor.gear.some((item) => item.provenance === 'candidate');
    assert.equal(
      descriptor.gearProvenance, mountsCandidate ? CONTAINS_CANDIDATE : SHIPPING_ONLY,
      `"${descriptor.id}" claims ${descriptor.gearProvenance} but mountsCandidate=${mountsCandidate}`,
    );
  }
});

test('baseline-ness and gear provenance are different questions with different answers', () => {
  const diverging = ['shipping-sword-only', 'candidate-with-lantern'];
  for (const id of diverging) {
    const descriptor = loadoutDescriptor(id);
    assert.equal(descriptor.gearProvenance, SHIPPING_ONLY, `${id} mounts only shipped meshes`);
    assert.notEqual(id, 'shipping', `${id} is not the baseline loadout`);
  }
  assert.equal(loadoutDescriptor('shipping').gearProvenance, SHIPPING_ONLY);
  assert.equal(loadoutDescriptor('candidate-wildwood-blade').gearProvenance, CONTAINS_CANDIDATE);
  assert.equal(loadoutDescriptor('candidate-dawnwarden-sword').gearProvenance, CONTAINS_CANDIDATE);
  assert.equal(loadoutDescriptor('candidate-dawnwarden-helmet').gearProvenance, CONTAINS_CANDIDATE);
});

test('the provenance vocabulary never uses a bare "shipping" that could read as the baseline', () => {
  assert.equal(SHIPPING_ONLY, 'shipping-only');
  assert.equal(CONTAINS_CANDIDATE, 'contains-candidate');
  for (const descriptor of STUDIO_LOADOUTS) {
    assert.notEqual(descriptor.gearProvenance, 'shipping');
  }
});

test('candidate/shipped labels match where the assets actually live on disk', () => {
  const candidates = ALL_STUDIO_GEAR.filter((item) => item.provenance === 'candidate');
  const expectedIds = [WILDWOOD_BLADE_CANDIDATE_ID, ...STUDIO_CANDIDATE_GEAR.map((item) => item.id)].sort();
  assert.deepEqual(candidates.map((item) => item.id).sort(), expectedIds);

  assert.match(WILDWOOD_BLADE_CANDIDATE_URL, /^assets\/gear\/candidates\//);
  assert.ok(existsSync(`public/${WILDWOOD_BLADE_CANDIDATE_URL}`), 'Wildwood candidate GLB missing');
  for (const candidate of STUDIO_CANDIDATE_GEAR) {
    assert.match(candidate.url, /^assets\/gear\/candidates\//);
    assert.ok(existsSync(`public/${candidate.url}`), `${candidate.id} candidate GLB missing`);
  }

  assert.doesNotMatch(BELT_LANTERN_URL, /candidates/);
  assert.ok(existsSync(`public/${BELT_LANTERN_URL}`), 'shipped lantern GLB missing');
});

test('gear identities come from the shipping mount records, not restated strings', () => {
  const tier2Ids = RIGID_TIER2_GEAR.map((item) => item.id);
  const shipping = loadoutDescriptor('shipping');
  assert.deepEqual(shipping.gear.map((item) => item.id).sort(), [...tier2Ids].sort());
  for (const item of shipping.gear) {
    const record = RIGID_TIER2_GEAR.find((entry) => entry.id === item.id);
    assert.equal(item.bone, record.boneName, `${item.id} descriptor bone disagrees with gear.js`);
  }
  const lanternLoadout = loadoutDescriptor('candidate-with-lantern');
  const lantern = lanternLoadout.gear.find((item) => item.id === RIGID_BELT_LANTERN.id);
  assert.ok(lantern, 'lantern loadout does not mount the lantern');
  assert.equal(lantern.bone, RIGID_BELT_LANTERN.boneName);
  assert.equal(lanternLoadout.reviewTarget, RIGID_BELT_LANTERN.id);
});

test('the lantern loadout is honestly shipped gear despite its historical candidate- id', () => {
  const descriptor = loadoutDescriptor('candidate-with-lantern');
  assert.equal(descriptor.gearProvenance, SHIPPING_ONLY);
  assert.ok(descriptor.note?.length > 0, 'the id/label mismatch needs its explanation recorded');
});

test('shipping-sword-only mounts only shipped gear and only the sword', () => {
  const descriptor = loadoutDescriptor('shipping-sword-only');
  assert.equal(descriptor.gearProvenance, SHIPPING_ONLY);
  assert.deepEqual(descriptor.gear.map((item) => item.id), [descriptor.reviewTarget]);
  assert.equal(descriptor.reviewTarget, loadoutDescriptor('shipping').reviewTarget);
});

test('weapon candidate comparisons keep the shipping shield and replace only the sword', () => {
  const shipping = loadoutDescriptor('shipping');
  const shieldId = shipping.gear.find((item) => item.bone !== WILDWOOD_BLADE_CANDIDATE_BONE_NAME).id;
  for (const id of ['candidate-wildwood-blade', 'candidate-dawnwarden-sword']) {
    const candidate = loadoutDescriptor(id);
    assert.ok(candidate.gear.some((item) => item.id === shieldId), `${id}: shield missing`);
    assert.equal(candidate.gear.filter((item) => item.bone === WILDWOOD_BLADE_CANDIDATE_BONE_NAME).length, 1);
  }
});

test('Dawnwarden helmet comparison keeps the complete shipping loadout and adds only the helmet candidate', () => {
  const shippingIds = loadoutDescriptor('shipping').gear.map((item) => item.id).sort();
  const helmet = loadoutDescriptor('candidate-dawnwarden-helmet');
  const candidateIds = helmet.gear.filter((item) => item.provenance === 'candidate').map((item) => item.id);
  assert.equal(candidateIds.length, 1);
  assert.ok(STUDIO_CANDIDATE_GEAR.some((item) => item.id === candidateIds[0] && item.kind === 'helmet'));
  assert.deepEqual(helmet.gear.filter((item) => item.provenance === 'shipped').map((item) => item.id).sort(), shippingIds);
});

test('descriptors are deeply frozen data -- a consumer cannot quietly relabel a candidate', () => {
  const descriptor = loadoutDescriptor('candidate-dawnwarden-sword');
  assert.throws(() => { descriptor.gearProvenance = SHIPPING_ONLY; }, TypeError);
  assert.throws(() => { descriptor.gear[0].provenance = 'shipped'; }, TypeError);
  assert.throws(() => { STUDIO_LOADOUTS.push({}); }, TypeError);
});

test('Studio sources reference only assets that exist in public/ -- no private-era paths', () => {
  const sources = [
    'public/studio.html',
    'public/src/studio/main.js',
    'public/src/studio/scene.js',
    'public/src/studio/api.js',
    'public/src/studio/loadoutDescriptors.js',
    'public/src/studio/candidateGear.js',
    'public/src/character/gear.js',
  ];
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /__review\//, `${file} references a private review route`);
    for (const [, assetPath] of text.matchAll(/["'`](assets\/[A-Za-z0-9._/-]+\.(?:glb|png|jpg|webp))["'`]/g)) {
      assert.ok(existsSync(`public/${assetPath}`), `${file} references missing public asset ${assetPath}`);
    }
  }
});
