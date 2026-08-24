// The frame a mount is BAKED in has to be the frame it is ATTACHED in, or the numbers lie.
//
// `RIGID_TIER2_GEAR.restRelativeToHeroRoot` is a RIG-ROOT REST transform. attachRigidTier2Gear
// resolves it with one line that decides everything:
//
//     const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(world);
//
// `bone.matrixWorld` is read in whatever pose the skeleton happens to be in at that instant. In
// production that instant is inside loadHero(), immediately after the GLTF parse and before any
// clip has been applied -- the BIND pose. So the baked number is only meaningful against bind.
//
// The bake side already knows this. tools/runtime-test/fit-sword.mjs calls `skeleton.pose()` and
// says so: "Bake in bind pose". fit-wildwood-blade.mjs documents the same requirement.
//
// WHY THIS FILE EXISTS. The private 2026-08-17 Owner remediation for the Ironwood sword records
// that its exact root-relative result was "measured in the live Studio AT IDLE and baked below".
// Not in bind. Replaying that transform in the current runtime puts the sword through the hand
// wrongly even though the hero bytes, the sword bytes, the pose regime and the numbers themselves
// are all identical -- which is the observation that sent two earlier diagnoses down blind alleys
// (a rig-cannot-grip theory, and an Idle_02 -> Idle_11 pose-drift theory, both since withdrawn).
//
// These tests do not touch the shipping values and do not assert any transform is correct. They
// pin the CONTRACT: a bake taken in a posed frame does not survive a reload that attaches in bind,
// and the size of the error is a property of how far the bone moved, not of the numbers chosen.
//
// Deliberately driven through the real attachRigidTier2Gear rather than a local copy of its
// arithmetic. A test that reimplements the thing it is testing proves only that two derivations
// agree (GQ-015).

import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from '../public/vendor/three.module.min.js';

import { RIG_ROOT_NAME, RIGID_TIER2_GEAR, attachRigidTier2Gear, rigidAnchorName }
  from '../public/src/character/gear.js';

/**
 * The smallest tree attachRigidTier2Gear will accept: a named rig root, a real Bone per mount, and
 * a gear node per item sitting at identity. Deliberately not the shipped GLB -- the contract under
 * test is frame arithmetic, and a synthetic rig makes "the bone moved by exactly this much" an
 * input rather than something to measure.
 */
function buildRig({ posed = false } = {}) {
  const heroRoot = new THREE.Group();
  const rigRoot = new THREE.Group();
  rigRoot.name = RIG_ROOT_NAME;
  // A rig root that is not at the origin, so a bug that silently drops rigRoot.matrixWorld cannot
  // pass by coincidence.
  rigRoot.position.set(0.25, 1.5, -0.75);
  rigRoot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
  heroRoot.add(rigRoot);

  for (const item of RIGID_TIER2_GEAR) {
    const bone = new THREE.Bone();
    bone.name = item.boneName;
    bone.position.set(0.3, 1.1, 0.05);
    bone.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2);
    // THE POSE. Bind is the transform above; "posed" is the same bone after a clip has moved it,
    // which is what a live Studio frame at idle looks like.
    if (posed) {
      bone.position.set(0.42, 0.98, 0.17);
      bone.quaternion.setFromAxisAngle(new THREE.Vector3(0.3, 0.8, 0.5).normalize(), 0.55);
    }
    rigRoot.add(bone);

    const gear = new THREE.Group();
    gear.name = item.id;
    heroRoot.add(gear);
  }
  heroRoot.updateMatrixWorld(true);
  return heroRoot;
}

const anchorOf = (heroRoot, item) =>
  heroRoot.getObjectByName(rigidAnchorName(item.id, item.boneName));

/** Position/quaternion of a solved anchor, as attach left it on the bone. */
function solvedLocal(posed) {
  const heroRoot = buildRig({ posed });
  attachRigidTier2Gear(heroRoot);
  const out = {};
  for (const item of RIGID_TIER2_GEAR) {
    const anchor = anchorOf(heroRoot, item);
    out[item.id] = {
      position: anchor.position.clone(),
      quaternion: anchor.quaternion.clone(),
    };
  }
  return out;
}

test('the fixture is real: attach actually solves an anchor for every shipped mount', () => {
  const heroRoot = buildRig();
  const mounted = attachRigidTier2Gear(heroRoot);
  assert.equal(mounted.length, RIGID_TIER2_GEAR.length);
  for (const item of RIGID_TIER2_GEAR) {
    const anchor = anchorOf(heroRoot, item);
    assert.ok(anchor, `no anchor solved for ${item.id}`);
    assert.equal(anchor.parent.name, item.boneName, 'the anchor must hang off its bone');
    assert.equal(anchor.children[0].name, item.id, 'the gear must be reparented under the anchor');
  }
});

// --- the contract itself ------------------------------------------------------------------------

test('the SAME baked number resolves to a DIFFERENT anchor when the bone is posed', () => {
  const bind = solvedLocal(false);
  const posed = solvedLocal(true);

  for (const item of RIGID_TIER2_GEAR) {
    const moved = bind[item.id].position.distanceTo(posed[item.id].position);
    assert.ok(moved > 1e-3,
      `${item.id}: attaching in a posed frame produced the same anchor as bind (${moved}), so this `
      + 'test can no longer detect the defect it exists for');
  }
});

test('a bake taken in a POSED frame does not survive a reload that attaches in BIND', () => {
  // What an authoring tool does: the Owner drags the sword until it looks right IN THE FRAME ON
  // SCREEN, and the tool records where the anchor ended up. Model that as "the anchor solved in the
  // posed frame is the look the Owner approved".
  const approved = solvedLocal(true);

  // Reload. attachRigidTier2Gear runs inside loadHero(), before any clip -- always bind.
  const reloaded = solvedLocal(false);

  for (const item of RIGID_TIER2_GEAR) {
    const drift = approved[item.id].position.distanceTo(reloaded[item.id].position);
    assert.ok(drift > 1e-3,
      `${item.id}: expected the posed-frame bake to come back wrong on reload, drift was ${drift}`);
  }
});

// RED-CAPABLE, stated rather than assumed (GQ-022). The test above asserts that something FAILS to
// round-trip, and an assertion of failure is exactly the shape that goes quiet for the wrong reason
// -- a fixture that stopped posing the bone would pass it while proving nothing. So: run the same
// comparison with the "posed" frame set equal to bind, and require it to find NO drift. That is the
// only configuration in which the previous test should be unable to fire.
test('red-capable: with the posed frame equal to bind, the same comparison finds nothing', () => {
  const a = solvedLocal(false);
  const b = solvedLocal(false);
  for (const item of RIGID_TIER2_GEAR) {
    const drift = a[item.id].position.distanceTo(b[item.id].position);
    assert.ok(drift < 1e-12,
      `${item.id}: identical frames must produce identical anchors, drift was ${drift} -- if this `
      + 'fires, the posed-frame test above is measuring noise rather than the frame');
  }
});

test('a bake taken in BIND round-trips through a reload exactly', () => {
  // Twice through the real attach, both in bind: byte-for-byte the same anchor. This is the half
  // that proves the contract is satisfiable, not merely that the other half fails.
  const first = solvedLocal(false);
  const second = solvedLocal(false);

  for (const item of RIGID_TIER2_GEAR) {
    assert.ok(first[item.id].position.distanceTo(second[item.id].position) < 1e-12,
      `${item.id}: bind-frame attach is not deterministic`);
    assert.ok(Math.abs(first[item.id].quaternion.dot(second[item.id].quaternion)) > 1 - 1e-12,
      `${item.id}: bind-frame attach rotation is not deterministic`);
  }
});

test('the error tracks how far the bone moved, so it is the FRAME and not the numbers', () => {
  // The mechanism claim, made falsifiable: if the defect were about the particular values baked
  // into gear.js, a bone that barely moves would still break it. It does not -- the reload drift
  // collapses toward zero as the posed frame approaches bind.
  function driftForBoneOffset(delta) {
    const build = (posed) => {
      const heroRoot = new THREE.Group();
      const rigRoot = new THREE.Group();
      rigRoot.name = RIG_ROOT_NAME;
      heroRoot.add(rigRoot);
      for (const item of RIGID_TIER2_GEAR) {
        const bone = new THREE.Bone();
        bone.name = item.boneName;
        bone.position.set(0.3 + (posed ? delta : 0), 1.1, 0.05);
        rigRoot.add(bone);
        const gear = new THREE.Group();
        gear.name = item.id;
        heroRoot.add(gear);
      }
      heroRoot.updateMatrixWorld(true);
      attachRigidTier2Gear(heroRoot);
      return anchorOf(heroRoot, RIGID_TIER2_GEAR[0]).position.clone();
    };
    return build(true).distanceTo(build(false));
  }

  const big = driftForBoneOffset(0.2);
  const small = driftForBoneOffset(0.002);
  assert.ok(big > small * 10,
    `drift should scale with how far the bone moved: ${big} at 0.2 vs ${small} at 0.002`);
  assert.ok(small < 1e-2, `a nearly-bind frame should nearly round-trip, got ${small}`);
});
