import * as THREE from '../../vendor/three.module.min.js';
import { rigidAnchorName } from '../character/gear.js';
import { OPEN_FACE_HELMET_PROFILE_V1 } from './gearFitProfiles.js';

// PR #26 asset-forge candidates. Their source bytes live outside public/assets so the game payload
// stays shipping-only; the server exposes this fixed Studio-review route on demand.
export const DAWNWARDEN_SWORD_CANDIDATE = Object.freeze({
  id: 'sword_dawnwarden_v1',
  boneName: 'RightHand',
  url: 'studio-candidates/dawnwarden-sword-v1.glb',
  kind: 'sword',
  // Tier 4 is intentionally a larger silhouette than Ironwood/Silverguard. This is only an initial
  // Studio normalization target; the accepted fit is judged from pixels, not from this number.
  targetWorldLongest: 0.9,
  gripFractionFromMin: 0.12,
  ownerFit: Object.freeze({
    schema: 'galaquest.asset-forge-fit/1',
    sourceSha: '687f903f33def5dddc7662e9093de4d80f55fc12',
    savedAt: '2026-08-21T03:58:44.884Z',
    delta: Object.freeze({
      positionWorld: Object.freeze([0.09, -0.020000000000000007, 0]),
      rotationDeg: Object.freeze([-64, -13, 40]),
      scale: 0,
    }),
    baseline: Object.freeze({
      localPosition: Object.freeze([-2.009597310113718, 14.788167245852243, 0.15963204044194867]),
      localRotationQuaternion: Object.freeze([-0.16554002113104888, 0.8902172759576535, 0.009114995682822861, -0.4242954429524562]),
      localScale: Object.freeze([47.38742650536052, 47.38742650536052, 47.38742650536052]),
    }),
    effective: Object.freeze({
      localPosition: Object.freeze([-1.6385421309043957, 5.85455133950245, 2.4074804446994165]),
      localScale: Object.freeze([47.38742650536052, 47.38742650536052, 47.38742650536052]),
    }),
  }),
});

export const DAWNWARDEN_HELMET_CANDIDATE = Object.freeze({
  id: 'helmet_dawnwarden_v1',
  boneName: 'Head',
  url: 'studio-candidates/dawnwarden-helmet-v1.glb',
  kind: 'helmet',
  // Dawnwarden is the owner-locked reference for this open-face fit family. The profile captures the
  // approved seat/orientation and becomes the starting frame for later open-face helmet candidates.
  fitProfile: OPEN_FACE_HELMET_PROFILE_V1,
  hideAnatomy: OPEN_FACE_HELMET_PROFILE_V1.hideAnatomy,
  targetWorldLongest: OPEN_FACE_HELMET_PROFILE_V1.targetWorldLongest,
  ownerFit: Object.freeze({
    schema: 'galaquest.asset-forge-fit/1',
    sourceSha: '687f903f33def5dddc7662e9093de4d80f55fc12',
    savedAt: '2026-08-21T04:00:09.002Z',
    delta: Object.freeze({
      positionWorld: Object.freeze([0, 0.045, 0]),
      rotationDeg: Object.freeze([0, 0, 0]),
      scale: 0,
    }),
    baseline: Object.freeze({
      localPosition: Object.freeze([-0.08865604226265456, 9.535664418259842, -3.0105247062169873]),
      localRotationQuaternion: Object.freeze([-0.15227835255560962, -0.0053021111882924805, 0.005302196102046388, 0.9883092014676261]),
      localScale: Object.freeze([20.009290639414257, 20.009290639414257, 20.009290639414257]),
    }),
    effective: Object.freeze({
      localPosition: Object.freeze([-0.12855126128084882, 13.826713406476742, -4.365260824014637]),
      localScale: Object.freeze([20.009290639414257, 20.009290639414257, 20.009290639414257]),
    }),
  }),
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
  // Put the generated helmet's geometric centre on the mount point. The fit profile owns where that
  // normalized helmet centre sits relative to the Hero; new candidates start in the accepted frame.
  payload.position.copy(bounds.center).multiplyScalar(-1);
  payload.add(assetRoot);
  return payload;
}

function applyHelmetFitProfile(anchor, bone, bounds, profile, fallbackTargetWorldLongest) {
  if (!profile) return false;
  if (profile.boneName !== bone.name) {
    throw new Error(`Studio candidate mount: fit profile ${profile.id} targets ${profile.boneName}, not ${bone.name}`);
  }
  if (!Array.isArray(profile.anchorLocalPosition) || profile.anchorLocalPosition.length !== 3
      || !Array.isArray(profile.anchorLocalQuaternion) || profile.anchorLocalQuaternion.length !== 4) {
    throw new Error(`Studio candidate mount: malformed fit profile ${profile.id}`);
  }
  anchor.position.fromArray(profile.anchorLocalPosition);
  anchor.quaternion.fromArray(profile.anchorLocalQuaternion).normalize();
  anchor.scale.setScalar(localScaleForWorldExtent(
    bone,
    bounds.longest,
    profile.targetWorldLongest ?? fallbackTargetWorldLongest,
  ));
  anchor.userData.gqFitProfile = profile.id;
  return true;
}

function applyOwnerFit(anchor, ownerFit) {
  if (!ownerFit) return;
  // v1 packets used local-XYZ rotation deltas. Preserve that historical interpretation when baking
  // the already-approved Dawnwarden placements; new authoring packets use the Forge v2 world frame.
  const rotationDeg = ownerFit.delta?.rotationDeg ?? [0, 0, 0];
  const baselineQ = ownerFit.baseline?.localRotationQuaternion;
  const effectivePosition = ownerFit.effective?.localPosition;
  const effectiveScale = ownerFit.effective?.localScale;
  if (!Array.isArray(baselineQ) || baselineQ.length !== 4
      || !Array.isArray(effectivePosition) || effectivePosition.length !== 3
      || !Array.isArray(effectiveScale) || effectiveScale.length !== 3) {
    throw new Error(`Studio candidate mount: malformed owner fit for ${anchor.name}`);
  }
  const radians = rotationDeg.map((value) => Number(value) * Math.PI / 180);
  const deltaQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...radians, 'XYZ'));
  anchor.position.fromArray(effectivePosition);
  anchor.quaternion.fromArray(baselineQ).multiply(deltaQ).normalize();
  anchor.scale.fromArray(effectiveScale);
  anchor.userData.gqOwnerFit = {
    schema: ownerFit.schema,
    sourceSha: ownerFit.sourceSha,
    savedAt: ownerFit.savedAt,
  };
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
    const usedProfile = applyHelmetFitProfile(anchor, bone, bounds, spec.fitProfile, spec.targetWorldLongest);
    if (!usedProfile) {
      const boneWorldPos = new THREE.Vector3();
      const boneWorldQ = new THREE.Quaternion();
      const heroWorldQ = new THREE.Quaternion();
      bone.getWorldPosition(boneWorldPos);
      bone.getWorldQuaternion(boneWorldQ);
      heroRoot.getWorldQuaternion(heroWorldQ);

      const desiredWorldPos = boneWorldPos.clone().add(new THREE.Vector3(0, spec.worldUpOffset ?? 0, 0));
      anchor.position.copy(bone.worldToLocal(desiredWorldPos.clone()));
      anchor.quaternion.copy(boneWorldQ.clone().invert().multiply(heroWorldQ));
      anchor.scale.setScalar(localScaleForWorldExtent(bone, bounds.longest, spec.targetWorldLongest));
    }
    anchor.add(normalizeHelmetPayload(assetRoot, bounds));
  } else {
    throw new Error(`Studio candidate mount: unsupported kind ${spec.kind}`);
  }

  applyOwnerFit(anchor, spec.ownerFit);

  bone.add(anchor);
  anchor.visible = false;
  anchor.updateMatrixWorld(true);
  return { id: spec.id, anchor, bone, gear: assetRoot, spec };
}
