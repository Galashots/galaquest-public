import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from '../public/vendor/three.module.min.js';
import {
  RIG_ROOT_NAME, RIGID_TIER2_GEAR, attachRigidTier2Gear, rigidAnchorName,
} from '../public/src/character/gear.js';
import { runtimeRestTransform, runtimeRestSource } from '../public/src/forge/runtimeBake.js';

/**
 * The Forge authors a bone-local anchor; character/gear.js stores a rig-root-relative rest
 * transform. runtimeRestTransform is the bridge, and the only thing that makes it trustworthy is
 * that it is the exact INVERSE of attachRigidTier2Gear -- feed it the anchor that attach produced
 * from a shipped constant and the shipped constant must come back.
 *
 * Both directions are driven through the real functions. Neither the attach arithmetic nor the bake
 * arithmetic is restated here (GQ-015): a test that recomputes the transform it is checking proves
 * only that the author can do matrix algebra twice.
 */

const BIND = { position: [0.3, 1.1, 0.05], axis: [1, 0, 0], angle: 0.2 };
const POSED = { position: [0.42, 0.98, 0.17], axis: [0.3, 0.8, 0.5], angle: 0.55 };

function placeBone(bone, frame) {
  bone.position.set(...frame.position);
  bone.quaternion.setFromAxisAngle(new THREE.Vector3(...frame.axis).normalize(), frame.angle);
}

/** A rig whose live bones stand in `frame` while the skeleton still records BIND. */
function buildRig(frame = BIND) {
  const heroRoot = new THREE.Group();
  const rigRoot = new THREE.Group();
  rigRoot.name = RIG_ROOT_NAME;
  // A rig root away from the origin, carrying the shipped 0.01 Armature scale, so a bake that
  // silently drops either cannot round-trip by coincidence.
  rigRoot.position.set(0.25, 1.5, -0.75);
  rigRoot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
  rigRoot.scale.setScalar(0.01);
  heroRoot.add(rigRoot);

  const bones = [];
  const inverses = [];
  for (const item of RIGID_TIER2_GEAR) {
    const bone = new THREE.Bone();
    bone.name = item.boneName;
    placeBone(bone, frame);
    rigRoot.add(bone);
    bones.push(bone);

    const bindRoot = new THREE.Group();
    bindRoot.position.copy(rigRoot.position);
    bindRoot.quaternion.copy(rigRoot.quaternion);
    bindRoot.scale.copy(rigRoot.scale);
    const bindBone = new THREE.Bone();
    placeBone(bindBone, BIND);
    bindRoot.add(bindBone);
    bindRoot.updateMatrixWorld(true);
    inverses.push(new THREE.Matrix4().copy(bindBone.matrixWorld).invert());

    const gear = new THREE.Group();
    gear.name = item.id;
    heroRoot.add(gear);
  }

  const skinned = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  skinned.skeleton = new THREE.Skeleton(bones, inverses);
  heroRoot.add(skinned);

  heroRoot.updateMatrixWorld(true);
  return heroRoot;
}

const anchorOf = (heroRoot, item) =>
  heroRoot.getObjectByName(rigidAnchorName(item.id, item.boneName));

test('the bake is the exact inverse of the attach: a shipped constant round-trips', () => {
  const heroRoot = buildRig();
  attachRigidTier2Gear(heroRoot);

  for (const item of RIGID_TIER2_GEAR) {
    const baked = runtimeRestTransform(heroRoot, anchorOf(heroRoot, item));
    const stored = item.restRelativeToHeroRoot;

    assert.equal(baked.boneName, item.boneName);
    for (let i = 0; i < 3; i += 1) {
      assert.ok(Math.abs(baked.position[i] - stored.position[i]) < 1e-4,
        `${item.id} position[${i}]: baked ${baked.position[i]} vs stored ${stored.position[i]}`);
      assert.ok(Math.abs(baked.scale[i] - stored.scale[i]) < 1e-4,
        `${item.id} scale[${i}]: baked ${baked.scale[i]} vs stored ${stored.scale[i]}`);
    }
    // Quaternions are double-covered: q and -q are the same rotation.
    const dot = baked.quaternion.reduce((sum, n, i) => sum + n * stored.quaternion[i], 0);
    assert.ok(Math.abs(dot) > 1 - 1e-9,
      `${item.id} rotation did not round-trip: dot ${dot}`);
  }
});

test('red-capable: moving the anchor the way an Owner fit does changes the baked number', () => {
  // If the bake echoed the stored constant instead of reading the anchor, the test above would pass
  // and be worthless. Nudge the anchor and require the bake to follow.
  const heroRoot = buildRig();
  attachRigidTier2Gear(heroRoot);
  const item = RIGID_TIER2_GEAR[0];
  const anchor = anchorOf(heroRoot, item);

  const before = runtimeRestTransform(heroRoot, anchor);
  anchor.position.x += 0.05;
  anchor.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.25));
  const after = runtimeRestTransform(heroRoot, anchor);

  const moved = Math.hypot(...[0, 1, 2].map((i) => after.position[i] - before.position[i]));
  assert.ok(moved > 1e-3, `the bake did not follow the anchor: moved ${moved}`);
  const dot = after.quaternion.reduce((sum, n, i) => sum + n * before.quaternion[i], 0);
  assert.ok(Math.abs(dot) < 1 - 1e-6, `the bake did not follow the rotation: dot ${dot}`);
});

test('the bake is the same whether or not a clip is playing when the Owner exports', () => {
  // The whole reason this module reads bind out of boneInverses. An Owner inspecting `run` and
  // hitting Copy Fit JSON must get the same number as one sitting in the fit pose -- the
  // 2026-08-17 remediation was measured "in the live Studio at idle" and did not.
  const item = RIGID_TIER2_GEAR[0];

  const bakeIn = (frame) => {
    const heroRoot = buildRig(frame);
    attachRigidTier2Gear(heroRoot);
    const anchor = anchorOf(heroRoot, item);
    // The same authored bone-local fit in both frames: bone-local is what the Forge stores.
    anchor.position.set(-1.2, 5.5, 0.4);
    anchor.quaternion.setFromAxisAngle(new THREE.Vector3(0.2, 0.9, 0.3).normalize(), 0.9);
    anchor.scale.setScalar(47);
    return runtimeRestTransform(heroRoot, anchor);
  };

  const bind = bakeIn(BIND);
  const posed = bakeIn(POSED);
  assert.deepEqual(posed.position, bind.position, 'the baked position depended on the live pose');
  assert.deepEqual(posed.scale, bind.scale, 'the baked scale depended on the live pose');
  const dot = posed.quaternion.reduce((sum, n, i) => sum + n * bind.quaternion[i], 0);
  assert.ok(Math.abs(dot) > 1 - 1e-9, `the baked rotation depended on the live pose: dot ${dot}`);
});

test('the bake refuses an anchor that is not on a bone', () => {
  const heroRoot = buildRig();
  const loose = new THREE.Group();
  heroRoot.add(loose);
  assert.throws(() => runtimeRestTransform(heroRoot, loose), /must be parented to a Bone/);
});

test('the paste-ready source names the three fields gear.js actually stores', () => {
  const heroRoot = buildRig();
  attachRigidTier2Gear(heroRoot);
  const source = runtimeRestSource(runtimeRestTransform(heroRoot, anchorOf(heroRoot, RIGID_TIER2_GEAR[0])));
  for (const field of ['position', 'quaternion', 'scale']) {
    assert.match(source, new RegExp(`${field}: Object\\.freeze\\(\\[`), `missing ${field}`);
  }
});
