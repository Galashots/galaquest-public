import * as THREE from '../../vendor/three.module.min.js';
import { rigidAnchorName } from '../character/gear.js';

// PR #26 asset-forge candidates. These paths deliberately stay under candidates/ until visual fit,
// animation sweeps, runtime pixels, and final owner acceptance say otherwise.
export const DAWNWARDEN_SWORD_CANDIDATE = Object.freeze({
  id: 'sword_dawnwarden_v1',
  boneName: 'RightHand',
  url: 'assets/gear/candidates/dawnwarden-sword-v1.glb',
  kind: 'sword',
  // Tier 4 is intentionally a larger silhouette than Ironwood/Silverguard. This is only an initial
  // Studio normalization target; the accepted fit is judged from pixels, not from this number.
  targetWorldLongest: 0.9,
  gripFractionFromMin: 0.12,
});

export const DAWNWARDEN_HELMET_CANDIDATE = Object.freeze({
  id: 'helmet_dawnwarden_v1',
  boneName: 'Head',
  url: 'assets/gear/candidates/dawnwarden-helmet-v1.glb',
  kind: 'helmet',
  // Semantic coverage is authored gear data, not a global "head slot" assumption. This open-face
  // helm must clear the Hero's hair and ears while preserving the face/eyes/brows. Runtime occlusion
  // will consume these names once the Hero carries the matching _GQ_REGION anatomy tags.
  hideAnatomy: Object.freeze(['hair', 'ears']),
  targetWorldLongest: 0.38,
  worldUpOffset: 0.10,
});

export const STUDIO_CANDIDATE_GEAR = Object.freeze([
  DAWNWARDEN_SWORD_CANDIDATE,
  DAWNWARDEN_HELMET_CANDIDATE,
]);

const AXES = Object.freeze([
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
]);

function requiredBone(heroRoot, name) {
  const bone = heroRoot.getObjectByName(name);
  if (!bone) throw new Error(`Studio candidate mount: missing bone ${name}`);
  if (!bone.isBone) throw new Error(`Studio candidate mount: ${name} is not a Bone`);
  return bone;
}

function sourceBounds(assetRoot) {
  assetRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(assetRoot);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || longest <= 1e-6) {
    throw new Error('Studio candidate mount: candidate has no usable bounds');
  }
  return { box, size, center, longest };
}

function localScaleForWorldExtent(bone, sourceLongest, targetWorldLongest) {
  const parentScale = new THREE.Vector3();
  bone.getWorldScale(parentScale);
  const inherited = (Math.abs(parentScale.x) + Math.abs(parentScale.y) + Math.abs(parentScale.z)) / 3;
  if (!Number.isFinite(inherited) || inherited <= 1e-9) {
    throw new Error('Studio candidate mount: invalid inherited bone scale');
  }
  return targetWorldLongest / sourceLongest / inherited;
}

function normalizeSwordPayload(assetRoot, bounds, gripFractionFromMin) {
  const dims = [bounds.size.x, bounds.size.y, bounds.size.z];
  const longestIndex = dims.indexOf(Math.max(...dims));
  const sourceAxis = AXES[longestIndex];
  // Shipping sword source convention is local +Y. Normalize arbitrary Meshy output to that before
  // reusing the already-proven hand-seat/orientation anchor.
  const toLocalY = new THREE.Quaternion().setFromUnitVectors(sourceAxis, AXES[1]);

  const grip = bounds.center.clone();
  grip.setComponent(
    longestIndex,
    bounds.box.min.getComponent(longestIndex) + dims[longestIndex] * gripFractionFromMin,
  );
  const rotatedGrip = grip.clone().applyQuaternion(toLocalY);

  const payload = new THREE.Group();
  payload.name = 'StudioCandidateSwordNormalization';
  payload.quaternion.copy(toLocalY);
  payload.position.copy(rotatedGrip).multiplyScalar(-1);
  payload.add(assetRoot);
  return payload;
}

function normalizeHelmetPayload(assetRoot, bounds) {
  const payload = new THREE.Group();
  payload.name = 'StudioCandidateHelmetNormalization';
  // Put the generated helmet's geometric centre on the mount point. We then place that mount point
  // just above the real Head bone. Fine fit is intentionally left to Studio pixels.
  payload.position.copy(bounds.center).multiplyScalar(-1);
  payload.add(assetRoot);
  return payload;
}

/**
 * Mount one explicitly named unshipped PR candidate for Character Studio inspection.
 *
 * This is not a production attachment API. It exists so the Director can visually iterate on real
 * candidate bytes while preserving the shipping gear/runtime until a candidate is accepted.
 */
export function attachStudioCandidate(heroRoot, spec, assetRoot) {
  const bone = requiredBone(heroRoot, spec.boneName);
  heroRoot.updateMatrixWorld(true);
  const bounds = sourceBounds(assetRoot);

  const anchor = new THREE.Group();
  anchor.name = rigidAnchorName(spec.id, spec.boneName);

  if (spec.kind === 'sword') {
    const shipping = heroRoot.getObjectByName(rigidAnchorName('sword_ironwood', 'RightHand'));
    if (!shipping) throw new Error('Studio Dawnwarden sword baseline: shipping sword anchor missing');
    anchor.position.copy(shipping.position);
    anchor.quaternion.copy(shipping.quaternion);
    anchor.scale.setScalar(localScaleForWorldExtent(bone, bounds.longest, spec.targetWorldLongest));
    anchor.add(normalizeSwordPayload(assetRoot, bounds, spec.gripFractionFromMin));
  } else if (spec.kind === 'helmet') {
    const boneWorldPos = new THREE.Vector3();
    const boneWorldQ = new THREE.Quaternion();
    const heroWorldQ = new THREE.Quaternion();
    bone.getWorldPosition(boneWorldPos);
    bone.getWorldQuaternion(boneWorldQ);
    heroRoot.getWorldQuaternion(heroWorldQ);

    const desiredWorldPos = boneWorldPos.clone().add(new THREE.Vector3(0, spec.worldUpOffset, 0));
    anchor.position.copy(bone.worldToLocal(desiredWorldPos.clone()));
    anchor.quaternion.copy(boneWorldQ.clone().invert().multiply(heroWorldQ));
    anchor.scale.setScalar(localScaleForWorldExtent(bone, bounds.longest, spec.targetWorldLongest));
    anchor.add(normalizeHelmetPayload(assetRoot, bounds));
  } else {
    throw new Error(`Studio candidate mount: unsupported kind ${spec.kind}`);
  }

  bone.add(anchor);
  anchor.visible = false;
  anchor.updateMatrixWorld(true);
  return { id: spec.id, anchor, bone, gear: assetRoot, spec };
}
