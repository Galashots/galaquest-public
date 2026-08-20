// A1 Studio convergence: the loadout vocabulary (public/src/studio/loadoutDescriptors.js) is the
// semantic review-state seam the A2 Owner Fit work will consume. These tests protect the properties
// that make it trustworthy: fail-closed lookup, truthful shipping/candidate classification, the
// one-sword rule, and the cross-boundary syncs (scene execution list, sol-review protocol enum)
// that would otherwise drift silently. Wherever possible the expected value comes from a DIFFERENT
// module than the one under test, so a bad implementation can actually disagree.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  ALL_STUDIO_GEAR,
  LOADOUT_IDS,
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
  // The worker advertises supportedLoadouts from LOADOUT_IDS; the schema is what actually accepts
  // or rejects a request. If these drift, the bridge advertises states it refuses to execute --
  // the exact viewportPreset failure docs/MISTAKES.md records.
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

test('classification is derived and truthful: candidate iff a candidate item is mounted', () => {
  for (const descriptor of STUDIO_LOADOUTS) {
    const mountsCandidate = descriptor.gear.some((item) => item.classification === 'candidate');
    assert.equal(
      descriptor.classification, mountsCandidate ? 'candidate' : 'shipping',
      `"${descriptor.id}" claims ${descriptor.classification} but mountsCandidate=${mountsCandidate}`,
    );
  }
});

test('the candidate/shipping labels match where the assets actually live on disk', () => {
  // The one candidate item is the Wildwood Blade, and its GLB genuinely sits in the quarantined
  // candidates/ directory -- while everything classified shipping either ships in the hero atlas
  // (no separate file) or sits directly in assets/gear/. Checked against the real files so a
  // reclassification (or a sneaky asset move) fails here rather than reading as an aesthetic call.
  const candidates = ALL_STUDIO_GEAR.filter((item) => item.classification === 'candidate');
  assert.deepEqual(candidates.map((item) => item.id), [WILDWOOD_BLADE_CANDIDATE_ID]);
  assert.match(WILDWOOD_BLADE_CANDIDATE_URL, /^assets\/gear\/candidates\//);
  assert.ok(existsSync(`public/${WILDWOOD_BLADE_CANDIDATE_URL}`), 'candidate GLB missing from candidates/');
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

test('the lantern loadout is honestly shipping despite its historical candidate- id', () => {
  const descriptor = loadoutDescriptor('candidate-with-lantern');
  assert.equal(descriptor.classification, 'shipping');
  assert.ok(descriptor.note?.length > 0, 'the id/label mismatch needs its explanation recorded');
});

test('shipping-sword-only mounts only shipped gear and only the sword', () => {
  const descriptor = loadoutDescriptor('shipping-sword-only');
  assert.equal(descriptor.classification, 'shipping');
  assert.deepEqual(descriptor.gear.map((item) => item.id), [descriptor.reviewTarget]);
  assert.equal(descriptor.reviewTarget, loadoutDescriptor('shipping').reviewTarget);
});

test('the wildwood loadout keeps the shield -- the locked comparison varies only the sword', () => {
  const wildwood = loadoutDescriptor('candidate-wildwood-blade');
  const shipping = loadoutDescriptor('shipping');
  const shieldId = shipping.gear.find((item) => item.bone !== WILDWOOD_BLADE_CANDIDATE_BONE_NAME).id;
  assert.ok(wildwood.gear.some((item) => item.id === shieldId), 'shield missing from the wildwood comparison state');
  assert.equal(wildwood.reviewTarget, WILDWOOD_BLADE_CANDIDATE_ID);
});

test('descriptors are deeply frozen data -- a consumer cannot quietly reclassify a candidate', () => {
  const descriptor = loadoutDescriptor('candidate-wildwood-blade');
  assert.throws(() => { descriptor.classification = 'shipping'; }, TypeError);
  assert.throws(() => { descriptor.gear[0].classification = 'shipping'; }, TypeError);
  assert.throws(() => { STUDIO_LOADOUTS.push({}); }, TypeError);
});

test('Studio sources reference only assets that exist in public/ -- no private-era paths', () => {
  // The A1 boundary rule: the public Studio must never grow a reference to private owner gear or
  // to the private review-custody routes (/__review/...) that deliberately were not ported. Every
  // literal asset path reachable from the Studio's own modules must resolve inside public/.
  const sources = [
    'public/studio.html',
    'public/src/studio/main.js',
    'public/src/studio/scene.js',
    'public/src/studio/api.js',
    'public/src/studio/loadoutDescriptors.js',
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
