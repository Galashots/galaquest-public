import * as THREE from '../../vendor/three.module.min.js';

export const POSITION_TUNING_BOUND_METERS = 0.08;

function clamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-POSITION_TUNING_BOUND_METERS, Math.min(POSITION_TUNING_BOUND_METERS, n));
}

export function normalizeWorldPositionOffset(offset = [0, 0, 0]) {
  if (!Array.isArray(offset) || offset.length !== 3) {
    throw new Error('world position offset must be [x, y, z]');
  }
  return offset.map(clamp);
}

/**
 * Apply a non-destructive Studio-only world-axis translation to a mounted gear anchor.
 *
 * The baseline is captured once from the anchor's pristine local position. Every later nudge is
 * recomputed from that baseline, so adjustments never accumulate numerical drift. The requested
 * offset is expressed in Studio/world metres: +X right, +Y up, +Z toward the Studio's positive Z.
 * We convert that desired world-space displacement back into the anchor parent's local space so
 * this also works under rotated/scaled bones (the Hero armature carries scale and non-trivial axes).
 */
export function applyWorldPositionOffset(anchor, offset = [0, 0, 0]) {
  if (!anchor?.parent) return null;
  const normalized = normalizeWorldPositionOffset(offset);

  if (!anchor.userData.gqStudioPositionBaselineLocal) {
    anchor.userData.gqStudioPositionBaselineLocal = anchor.position.clone();
  }

  const parent = anchor.parent;
  parent.updateWorldMatrix(true, false);
  const baselineLocal = anchor.userData.gqStudioPositionBaselineLocal;
  const baselineWorld = parent.localToWorld(baselineLocal.clone());
  const desiredWorld = baselineWorld.add(new THREE.Vector3(...normalized));
  const desiredLocal = parent.worldToLocal(desiredWorld.clone());

  anchor.position.copy(desiredLocal);
  anchor.updateMatrixWorld(true);

  const effectiveWorld = new THREE.Vector3();
  anchor.getWorldPosition(effectiveWorld);
  return {
    worldOffset: normalized,
    localPosition: anchor.position.toArray(),
    effectiveWorldPosition: effectiveWorld.toArray(),
  };
}

export function resetWorldPositionOffset(anchor) {
  return applyWorldPositionOffset(anchor, [0, 0, 0]);
}
