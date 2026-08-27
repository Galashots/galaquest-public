import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from '../public/vendor/three.module.min.js';
import { HERO_URL } from '../public/src/character/hero.js';
import {
  BELT_LANTERN_BONE_NAME,
  RIGID_BELT_LANTERN,
  RIGID_SILVERGUARD_HELMET,
  RIGID_TIER2_GEAR,
  SILVERGUARD_HELMET_BONE_NAME,
  SILVERGUARD_HELMET_HIDES_ANATOMY,
  attachBeltLantern,
  attachRigidTier2Gear,
  attachSilverguardHelmet,
  rigidAnchorName,
} from '../public/src/character/gear.js';

const EPSILON = 1e-6;

function readGlbJson(path) {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'GLB starts with a JSON chunk');
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
}

function assertNear(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: expected ${expected}, got ${actual}`);
}

function assertMatrixNear(actual, expected, message) {
  actual.elements.forEach((value, index) => assertNear(value, expected.elements[index], `${message} element ${index}`));
}

function restMatrix(item) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...item.restRelativeToHeroRoot.position),
    new THREE.Quaternion(...item.restRelativeToHeroRoot.quaternion),
    new THREE.Vector3(...item.restRelativeToHeroRoot.scale),
  );
}

function makeHero() {
  const hero = new THREE.Group();
  hero.name = 'hero';
  hero.position.set(6, -2, 9);
  hero.rotation.set(0.2, -0.35, 0.1);

  const armature = new THREE.Group();
  armature.name = 'Armature';
  // This is the exported rig scale measured in the shipped GLB, not a test convenience.
  armature.scale.setScalar(0.01);
  hero.add(armature);

  const spine = new THREE.Bone();
  spine.name = 'Spine';
  spine.position.set(0, 80, 0);
  armature.add(spine);

  const rightHand = new THREE.Bone();
  rightHand.name = 'RightHand';
  rightHand.position.set(-24, 38, 4);
  rightHand.rotation.set(0.1, -0.2, 0.3);
  // Non-unit bone scales prove the implementation solves from the live bone matrix;
  // a copied 47 or 45 local scale would be visibly wrong here.
  rightHand.scale.setScalar(1.6);
  spine.add(rightHand);

  const leftHand = new THREE.Bone();
  leftHand.name = 'LeftHand';
  leftHand.position.set(24, 31, 8);
  leftHand.rotation.set(-0.15, 0.1, -0.25);
  leftHand.scale.setScalar(0.75);
  spine.add(leftHand);

  for (const item of RIGID_TIER2_GEAR) {
    const gear = new THREE.Group();
    gear.name = item.id;
    hero.add(gear);
  }

  hero.updateMatrixWorld(true);
  return { hero, armature, rightHand, leftHand };
}

test('rigid Tier 2 gear reaches the tracer transform through live bone matrices', () => {
  const { hero, armature, rightHand, leftHand } = makeHero();
  const expectedWorldById = new Map(
    RIGID_TIER2_GEAR.map((item) => [
      item.id,
      new THREE.Matrix4().multiplyMatrices(armature.matrixWorld, restMatrix(item)),
    ]),
  );

  const attachments = attachRigidTier2Gear(hero);
  hero.updateMatrixWorld(true);

  assert.equal(attachments.length, 2);
  for (const item of RIGID_TIER2_GEAR) {
    const attachment = attachments.find((candidate) => candidate.id === item.id);
    const gear = hero.getObjectByName(item.id);
    const expectedBone = item.boneName === 'RightHand' ? rightHand : leftHand;

    assert.equal(attachment.bone, expectedBone);
    assert.equal(gear.parent, attachment.anchor);
    assert.equal(attachment.anchor.parent, expectedBone);
    assertMatrixNear(gear.matrixWorld, expectedWorldById.get(item.id), `${item.id} world transform`);

    const expectedLocalScale = item.restRelativeToHeroRoot.scale[0] / expectedBone.scale.x;
    assertNear(attachment.anchor.scale.x, expectedLocalScale, `${item.id} local X scale`);
    assertNear(attachment.anchor.scale.y, expectedLocalScale, `${item.id} local Y scale`);
    assertNear(attachment.anchor.scale.z, expectedLocalScale, `${item.id} local Z scale`);
  }
});

test('rigid Tier 2 attachment rejects a non-canonical gear node transform', () => {
  const { hero } = makeHero();
  hero.getObjectByName('sword_ironwood').position.x = 1;

  assert.throws(
    () => attachRigidTier2Gear(hero),
    /sword_ironwood must have an identity node transform/,
  );
});

// ── Phase D: the belt lantern (D4) ──────────────────────────────────────────────────────────────

// Separate from makeHero() above on purpose: makeHero()'s fixture has no Hips bone (RIGID_TIER2_GEAR
// only ever needs RightHand/LeftHand), and other tests depend on that exact shape staying unchanged.
function makeHeroWithHips() {
  const hero = new THREE.Group();
  hero.name = 'hero';
  hero.position.set(-3, 4, 1);
  hero.rotation.set(-0.1, 0.4, 0.2);

  const armature = new THREE.Group();
  armature.name = 'Armature';
  armature.scale.setScalar(0.01);
  hero.add(armature);

  const hips = new THREE.Bone();
  hips.name = 'Hips';
  hips.position.set(0, 92, 0);
  hips.rotation.set(0.05, -0.1, 0.02);
  hips.scale.setScalar(1.2);
  armature.add(hips);

  hero.updateMatrixWorld(true);
  return { hero, armature, hips };
}

function restMatrixFor(item) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...item.restRelativeToHeroRoot.position),
    new THREE.Quaternion(...item.restRelativeToHeroRoot.quaternion),
    new THREE.Vector3(...item.restRelativeToHeroRoot.scale),
  );
}

test('the belt lantern mounts onto the Hips bone through the live bone matrix', () => {
  const { hero, armature, hips } = makeHeroWithHips();
  const lanternRoot = new THREE.Group();
  lanternRoot.name = 'lantern_belt';

  const expectedWorld = new THREE.Matrix4().multiplyMatrices(armature.matrixWorld, restMatrixFor(RIGID_BELT_LANTERN));

  const attachment = attachBeltLantern(hero, lanternRoot);
  hero.updateMatrixWorld(true);

  assert.equal(attachment.bone, hips);
  assert.equal(attachment.id, 'lantern_belt');
  assert.equal(lanternRoot.parent, attachment.anchor);
  assert.equal(attachment.anchor.parent, hips);
  assertMatrixNear(lanternRoot.matrixWorld, expectedWorld, 'lantern world transform');
});

test('attachBeltLantern parents in a freshly-loaded root rather than requiring one already present', () => {
  // Unlike attachRigidTier2Gear, the lantern is never pre-parented under heroRoot -- proven here by
  // confirming it is NOT a descendant of hero before the call.
  const { hero } = makeHeroWithHips();
  const lanternRoot = new THREE.Group();
  lanternRoot.name = 'freshly-loaded-lantern';
  assert.equal(hero.getObjectByName('freshly-loaded-lantern'), undefined,
    'must not already be reachable from the hero root before attaching');

  attachBeltLantern(hero, lanternRoot);
  assert.equal(hero.getObjectByName('freshly-loaded-lantern'), lanternRoot,
    'the lantern should be reachable from the hero root once attached');
});

test('attachBeltLantern throws a clear error when the rig has no Hips bone', () => {
  const hero = new THREE.Group();
  hero.name = 'hero';
  const armature = new THREE.Group();
  armature.name = 'Armature';
  hero.add(armature);
  // Deliberately no Hips bone at all.

  assert.throws(
    () => attachBeltLantern(hero, new THREE.Group()),
    new RegExp(`missing bone ${BELT_LANTERN_BONE_NAME}`),
  );
});

test('attachBeltLantern throws if the named node exists but is not actually a Bone', () => {
  const hero = new THREE.Group();
  hero.name = 'hero';
  const armature = new THREE.Group();
  armature.name = 'Armature';
  hero.add(armature);
  const notABone = new THREE.Group();
  notABone.name = 'Hips';
  armature.add(notABone);

  assert.throws(() => attachBeltLantern(hero, new THREE.Group()), /Hips is not a Bone/);
});

// ── G1-C3: the Silverguard Helmet ────────────────────────────────────────────────────────────────

// The Head bone the shipped rig actually names, on the same 0.01 Armature the other fixtures use. No
// SkinnedMesh, so attachSilverguardHelmet's bindPoseMatrixWorld degrades to the live bone matrix --
// which is exactly the synthetic-rig fallback its own comment documents, so the expected world is the
// same armature.matrixWorld x rest the lantern's is.
function makeHeroWithHead() {
  const hero = new THREE.Group();
  hero.name = 'hero';
  hero.position.set(2, -1, 5);
  hero.rotation.set(0.15, -0.25, -0.1);

  const armature = new THREE.Group();
  armature.name = 'Armature';
  armature.scale.setScalar(0.01);
  hero.add(armature);

  const head = new THREE.Bone();
  head.name = 'Head';
  head.position.set(0, 150, 6);
  head.rotation.set(-0.08, 0.12, 0.03);
  head.scale.setScalar(1.3);
  armature.add(head);

  hero.updateMatrixWorld(true);
  return { hero, armature, head };
}

test('the Silverguard Helmet mounts onto the Head bone through the bind-frame bone matrix', () => {
  const { hero, armature, head } = makeHeroWithHead();
  const helmetRoot = new THREE.Group();
  helmetRoot.name = 'helmet_silverguard';

  const expectedWorld = new THREE.Matrix4().multiplyMatrices(armature.matrixWorld, restMatrixFor(RIGID_SILVERGUARD_HELMET));

  const attachment = attachSilverguardHelmet(hero, helmetRoot);
  hero.updateMatrixWorld(true);

  assert.equal(attachment.bone, head);
  assert.equal(attachment.id, 'helmet_silverguard');
  assert.equal(attachment.anchor.name, rigidAnchorName('helmet_silverguard', SILVERGUARD_HELMET_BONE_NAME));
  assert.equal(helmetRoot.parent, attachment.anchor);
  assert.equal(attachment.anchor.parent, head);
  assertMatrixNear(helmetRoot.matrixWorld, expectedWorld, 'helmet world transform');
});

test('attachSilverguardHelmet parents in a freshly-loaded root rather than requiring one already present', () => {
  const { hero } = makeHeroWithHead();
  const helmetRoot = new THREE.Group();
  helmetRoot.name = 'freshly-loaded-helmet';
  assert.equal(hero.getObjectByName('freshly-loaded-helmet'), undefined,
    'must not already be reachable from the hero root before attaching');

  attachSilverguardHelmet(hero, helmetRoot);
  assert.equal(hero.getObjectByName('freshly-loaded-helmet'), helmetRoot,
    'the helmet should be reachable from the hero root once attached');
});

test('attachSilverguardHelmet throws a clear error when the rig has no Head bone', () => {
  const hero = new THREE.Group();
  hero.name = 'hero';
  const armature = new THREE.Group();
  armature.name = 'Armature';
  hero.add(armature);

  assert.throws(
    () => attachSilverguardHelmet(hero, new THREE.Group()),
    new RegExp(`missing bone ${SILVERGUARD_HELMET_BONE_NAME}`),
  );
});

test('attachSilverguardHelmet throws if the named node exists but is not actually a Bone', () => {
  const hero = new THREE.Group();
  hero.name = 'hero';
  const armature = new THREE.Group();
  armature.name = 'Armature';
  hero.add(armature);
  const notABone = new THREE.Group();
  notABone.name = 'Head';
  armature.add(notABone);

  assert.throws(() => attachSilverguardHelmet(hero, new THREE.Group()), /Head is not a Bone/);
});

test('the Helmet occludes exactly the hair and ears while worn -- an open-face read', () => {
  assert.deepEqual([...SILVERGUARD_HELMET_HIDES_ANATOMY], ['hair', 'ears']);
  assert.equal(RIGID_SILVERGUARD_HELMET.boneName, 'Head');
  assert.equal(RIGID_SILVERGUARD_HELMET.id, 'helmet_silverguard');
});

test('hero loading uses the passing one-image equipped GLB', () => {
  assert.equal(HERO_URL, 'assets/hero/hero_lod1_ironwood_atlas.glb');
});

test('the equipped GLB exposes canonical source-space gear nodes under the 0.01 Armature', () => {
  // Deliberately parse the GLB JSON; Blender import fabricates an Icosphere and
  // is not evidence for what the browser loader receives.
  const json = readGlbJson('public/assets/hero/hero_lod1_ironwood_atlas.glb');
  const nodeByName = new Map(json.nodes.map((node) => [node.name, node]));
  const armature = nodeByName.get('Armature');

  assertNear(armature.scale[0], 0.01, 'Armature X scale');
  assertNear(armature.scale[1], 0.01, 'Armature Y scale');
  assertNear(armature.scale[2], 0.01, 'Armature Z scale');
  for (const item of RIGID_TIER2_GEAR) {
    const node = nodeByName.get(item.id);
    assert.ok(node, `${item.id} node exists`);
    assert.deepEqual(node.translation ?? [0, 0, 0], [0, 0, 0]);
    assert.deepEqual(node.rotation ?? [0, 0, 0, 1], [0, 0, 0, 1]);
    assert.deepEqual(node.scale ?? [1, 1, 1], [1, 1, 1]);
  }
});
