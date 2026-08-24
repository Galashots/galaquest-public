import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as THREE from '../public/vendor/three.module.min.js';
import {
  RIG_ROOT_NAME,
  RIGID_BELT_LANTERN,
  RIGID_WILDWOOD_BLADE_CANDIDATE,
  attachBeltLantern,
  attachWildwoodBladeCandidate,
  rigidAnchorName,
} from '../public/src/character/gear.js';

/**
 * A rest transform is only meaningful in the frame it was baked in.
 *
 * test/gear-bake-frame-contract.test.mjs proves that for attachRigidTier2Gear, which gets the bind
 * frame FOR FREE: its only caller is loadHero() (character/hero.js), which runs before the
 * AnimationMixer's first update. This file is about the mounts that do NOT get it for free -- the
 * ones that happen lazily, after an `await loadGLB(...)`, with a clip already playing:
 *
 *   - main.js's ensureLanternMounted   -> attachBeltLantern on the local hero, mid-play, the moment
 *                                         the reward unlocks;
 *   - main.js's mountGearOnRemote      -> attachBeltLantern / attachWildwoodBladeCandidate on a
 *                                         sibling's cloned root;
 *   - studio/scene.js's setLoadout     -> the same two, on demand.
 *
 * Every one of those lands mid-clip. Measured on the shipped rig
 * (public/assets/hero/hero_lod1_ironwood_atlas.glb), the Hips bone leaves its bind pose in EVERY
 * shipped clip -- least in `idle` (3.57 units of translation, 12.20 degrees of rotation away from
 * bind at its extreme), most in `death` (80.03 units, 97.03 degrees). So "mid-clip" is never
 * "near enough to bind for it not to matter".
 *
 * attachWildwoodBladeCandidate already solves this: it reads the bind-pose bone matrix out of the
 * skeleton's own boneInverses rather than the live bone.matrixWorld (see its comment for why
 * skeleton.pose() is NOT the fix on this rig). It is the control side here -- the proof that the
 * measurement below can come back clean, and that the fix is a pattern this file already accepts.
 */

// One perturbation, applied identically to both functions, so neither can look better than the
// other by being measured more gently.
const BIND = { position: [0.3, 1.1, 0.05], axis: [1, 0, 0], angle: 0.2 };
const POSED = { position: [0.42, 0.98, 0.17], axis: [0.3, 0.8, 0.5], angle: 0.55 };

function placeBone(bone, frame) {
  bone.position.set(...frame.position);
  bone.quaternion.setFromAxisAngle(new THREE.Vector3(...frame.axis).normalize(), frame.angle);
}

/**
 * A rig whose LIVE bone is in `frame` but whose skeleton still records BIND, which is exactly the
 * state a lazy mount finds: the clip has moved the bone, the bind pose is still on the skeleton.
 */
function buildRig(boneName, frame, { withSkeleton = true } = {}) {
  const heroRoot = new THREE.Group();
  const rigRoot = new THREE.Group();
  rigRoot.name = RIG_ROOT_NAME;
  rigRoot.position.set(0.25, 1.5, -0.75);
  rigRoot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
  heroRoot.add(rigRoot);

  const bone = new THREE.Bone();
  bone.name = boneName;
  placeBone(bone, frame);
  rigRoot.add(bone);

  if (withSkeleton) {
    // boneInverses are authored at bind and never move, so build them from a throwaway copy of the
    // rig standing in BIND -- not from the live bone, which is the whole point.
    const bindRoot = new THREE.Group();
    bindRoot.position.copy(rigRoot.position);
    bindRoot.quaternion.copy(rigRoot.quaternion);
    const bindBone = new THREE.Bone();
    bindBone.name = boneName;
    placeBone(bindBone, BIND);
    bindRoot.add(bindBone);
    bindRoot.updateMatrixWorld(true);

    const skinned = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    skinned.skeleton = new THREE.Skeleton(
      [bone],
      [new THREE.Matrix4().copy(bindBone.matrixWorld).invert()],
    );
    heroRoot.add(skinned);
  }

  heroRoot.updateMatrixWorld(true);
  return heroRoot;
}

const MOUNTS = [
  {
    label: 'attachBeltLantern',
    id: RIGID_BELT_LANTERN.id,
    boneName: RIGID_BELT_LANTERN.boneName,
    attach: (heroRoot) => attachBeltLantern(heroRoot, new THREE.Group()),
  },
  {
    label: 'attachWildwoodBladeCandidate',
    id: RIGID_WILDWOOD_BLADE_CANDIDATE.id,
    boneName: RIGID_WILDWOOD_BLADE_CANDIDATE.boneName,
    attach: (heroRoot) => attachWildwoodBladeCandidate(heroRoot, new THREE.Group()),
  },
];

/** The bone-local anchor a lazy mount solves, with the live bone standing in `frame`. */
function solvedIn(mount, frame, options) {
  const heroRoot = buildRig(mount.boneName, frame, options);
  mount.attach(heroRoot);
  const anchor = heroRoot.getObjectByName(rigidAnchorName(mount.id, mount.boneName));
  assert.ok(anchor, `${mount.label}: no anchor solved`);
  return { position: anchor.position.clone(), quaternion: anchor.quaternion.clone() };
}

function separation(a, b) {
  return {
    metres: a.position.distanceTo(b.position),
    degrees: 2 * Math.acos(Math.min(1, Math.abs(a.quaternion.dot(b.quaternion)))) * 180 / Math.PI,
  };
}

test('the fixture is real: every lazy mount actually solves an anchor on its own bone', () => {
  for (const mount of MOUNTS) {
    const heroRoot = buildRig(mount.boneName, BIND);
    const mounted = mount.attach(heroRoot);
    const anchor = heroRoot.getObjectByName(rigidAnchorName(mount.id, mount.boneName));
    assert.equal(mounted.id, mount.id);
    assert.equal(anchor.parent.name, mount.boneName, `${mount.label}: anchor must hang off its bone`);
  }
});

// --- the contract --------------------------------------------------------------------------------

for (const mount of MOUNTS) {
  test(`${mount.label} solves the same anchor whether or not a clip has moved the bone`, () => {
    const bind = solvedIn(mount, BIND);
    const posed = solvedIn(mount, POSED);
    const { metres, degrees } = separation(bind, posed);
    // Tolerances taken from the measured noise floor rather than picked: the control side
    // (attachWildwoodBladeCandidate, which already reads bind) comes back at exactly 0 translation
    // and 1.01e-5 degrees, that last from extracting a quaternion back out of an inverted Matrix4.
    // These bars sit two orders above that noise and four below the defect they exist to catch
    // (18.24 translation, 30.04 degrees), so neither rounding nor a real regression can hide.
    assert.ok(metres < 1e-6 && degrees < 1e-3,
      `${mount.label}: the anchor moved with the live bone instead of staying with bind `
      + `(${metres.toFixed(6)} translation, ${degrees.toFixed(4)} degrees). A lazy mount would bake `
      + 'whatever pose happened to be on screen into the anchor permanently.');
  });
}

// RED-CAPABLE, stated rather than assumed (GQ-022). The assertions above are "no difference", which
// is the shape that passes for the wrong reason when the fixture stops perturbing anything. So:
// prove the same measurement DOES fire when the bone frame is genuinely read live.
test('red-capable: the same measurement catches a mount that reads the live bone', () => {
  // A stand-in for the defect, built from the same parts: solve the anchor from bone.matrixWorld,
  // which is what attachBeltLantern did before this contract existed.
  function liveFrameAnchor(frame) {
    const heroRoot = buildRig(RIGID_BELT_LANTERN.boneName, frame);
    const rigRoot = heroRoot.getObjectByName(RIG_ROOT_NAME);
    const bone = heroRoot.getObjectByName(RIGID_BELT_LANTERN.boneName);
    const rest = new THREE.Matrix4().compose(
      new THREE.Vector3(...RIGID_BELT_LANTERN.restRelativeToHeroRoot.position),
      new THREE.Quaternion(...RIGID_BELT_LANTERN.restRelativeToHeroRoot.quaternion),
      new THREE.Vector3(...RIGID_BELT_LANTERN.restRelativeToHeroRoot.scale),
    );
    const world = new THREE.Matrix4().multiplyMatrices(rigRoot.matrixWorld, rest);
    const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(world);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    local.decompose(position, quaternion, new THREE.Vector3());
    return { position, quaternion };
  }

  const { metres, degrees } = separation(liveFrameAnchor(BIND), liveFrameAnchor(POSED));
  assert.ok(metres > 1e-3 && degrees > 1,
    'this fixture can no longer tell a live-frame mount from a bind-frame one, so the assertions '
    + `above prove nothing (${metres} translation, ${degrees} degrees)`);
});

test('a rig with no SkinnedMesh still mounts rather than throwing', () => {
  // Every test hero in test/gear-attachment.test.mjs is bones-only. Reading the bind pose must
  // DEGRADE on such a rig, not require a skeleton that a synthetic fixture has no reason to build.
  for (const mount of MOUNTS) {
    assert.doesNotThrow(() => solvedIn(mount, BIND, { withSkeleton: false }), mount.label);
  }
});

test('the lantern rest transform it reconciles against was itself baked in bind', () => {
  // Bind-frame attach is only the right answer because the stored number is a bind-frame number.
  // Source-pinned rather than asserted about the values, because the bake happens in a browser:
  // tools/runtime-test/fit-lantern.mjs poses the skeleton before measuring.
  const source = new URL('../tools/runtime-test/fit-lantern.mjs', import.meta.url);
  const text = readFileSync(source, 'utf8');
  const bakeIndex = text.indexOf('skeleton.pose()', text.indexOf('__bake'));
  assert.ok(bakeIndex !== -1,
    'fit-lantern.mjs no longer poses the skeleton before baking -- if the lantern rest transform is '
    + 'now measured in some other frame, attachBeltLantern must be reconciled against THAT frame');
});
