import * as THREE from '../../vendor/three.module.min.js';
import { RIG_ROOT_NAME, bindPoseMatrixWorld } from '../character/gear.js';

/**
 * Turn a fit the Owner approved in the Forge into the number the RUNTIME stores.
 *
 * The Forge authors a bone-local anchor, which is frame-invariant -- an anchor parented to a bone
 * rides the bone. character/gear.js instead stores `restRelativeToHeroRoot`, a transform relative to
 * the rig root, which attachRigidTier2Gear converts back through a bone matrix at mount time. The
 * conversion between the two representations therefore CONSUMES a bone matrix, and it only produces
 * the right answer if it uses the same one the runtime will use.
 *
 * attachRigidTier2Gear runs inside loadHero(), before the AnimationMixer's first update, so the
 * matrix it uses is always the bind pose. This function reads bind directly out of the skeleton's
 * boneInverses rather than from the live bone, which makes the bake correct no matter what clip the
 * Owner happens to be inspecting when they export -- and removes the failure mode that produced the
 * 2026-08-17 remediation, which was measured "in the live Studio at idle" and baked into a contract
 * that is read in bind. test/gear-bake-frame-contract.test.mjs is the proof of that contract;
 * test/forge-runtime-bake.test.mjs proves this function is its inverse.
 *
 * No unit conversion is applied, deliberately. This is the exact algebraic inverse of the attach, so
 * whatever units attachRigidTier2Gear consumes are the units it returns -- and because the rig root's
 * own matrix appears inverted on the left while the bone's appears on the right, any transform
 * applied ABOVE the rig root cancels: the Studio may place or scale the Hero however it likes and
 * the baked number is unchanged. The first draft of this function multiplied position and scale by
 * 100, copying tools/runtime-test/fit-sword.mjs, which compensates there for its own rig lookup;
 * here it put the shipped constant back a hundred times too large, and the round-trip test caught it.
 */
export function runtimeRestTransform(heroRoot, anchor) {
  const rigRoot = heroRoot.getObjectByName(RIG_ROOT_NAME);
  if (!rigRoot) throw new Error(`runtime bake: missing rig root ${RIG_ROOT_NAME}`);
  const bone = anchor?.parent;
  if (!bone?.isBone) throw new Error('runtime bake: the anchor must be parented to a Bone');

  heroRoot.updateMatrixWorld(true);
  anchor.updateMatrix();

  const rest = new THREE.Matrix4()
    .copy(rigRoot.matrixWorld).invert()
    .multiply(bindPoseMatrixWorld(heroRoot, bone))
    .multiply(anchor.matrix);

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  rest.decompose(position, quaternion, scale);
  quaternion.normalize();

  return {
    boneName: bone.name,
    position: position.toArray().map((n) => Number(n.toFixed(5))),
    quaternion: quaternion.toArray().map((n) => Number(n.toFixed(12))),
    scale: scale.toArray().map((n) => Number(n.toFixed(5))),
  };
}

/** The same numbers as a paste-ready gear.js literal, so a bake never has to be retyped by hand. */
export function runtimeRestSource(rest) {
  return [
    `position: Object.freeze([${rest.position.join(', ')}]),`,
    `quaternion: Object.freeze([${rest.quaternion.join(', ')}]),`,
    `scale: Object.freeze([${rest.scale.join(', ')}]),`,
  ].join('\n');
}
