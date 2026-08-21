import './responsive.js';
import * as THREE from '../../vendor/three.module.min.js';

const DEG = 180 / Math.PI;

function baselineFor(anchor) {
  const stored = anchor.userData?.gqForgeFitBaseline;
  if (stored) {
    return Object.freeze({
      position: new THREE.Vector3().fromArray(stored.position),
      quaternion: new THREE.Quaternion().fromArray(stored.quaternion),
      scale: new THREE.Vector3().fromArray(stored.scale),
    });
  }

  const baseline = {
    position: anchor.position.clone(),
    quaternion: anchor.quaternion.clone(),
    scale: anchor.scale.clone(),
  };
  anchor.userData.gqForgeFitBaseline = {
    position: baseline.position.toArray(),
    quaternion: baseline.quaternion.toArray(),
    scale: baseline.scale.toArray(),
  };
  return Object.freeze(baseline);
}

function finite3(value, fallback = [0, 0, 0]) {
  const source = Array.isArray(value) ? value : fallback;
  return [0, 1, 2].map((index) => Number.isFinite(Number(source[index])) ? Number(source[index]) : fallback[index]);
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function transformOut(anchor) {
  const euler = new THREE.Euler().setFromQuaternion(anchor.quaternion, 'XYZ');
  const world = new THREE.Vector3();
  anchor.getWorldPosition(world);
  return {
    localPosition: anchor.position.toArray(),
    worldPosition: world.toArray(),
    localRotationDeg: [euler.x * DEG, euler.y * DEG, euler.z * DEG],
    localScale: anchor.scale.toArray(),
  };
}

/**
 * Create one non-destructive authoring session around an existing mounted gear anchor.
 *
 * Position deltas are WORLD axes because the human-facing Forge deliberately promises that +Y means
 * "move the helmet up" regardless of how the Head bone is oriented. The resulting transform is still
 * stored on the anchor in parent-local space, so it follows the bone normally once the animation runs.
 * Rotation deltas are local XYZ, composed on top of the captured candidate baseline. Uniform scale is
 * multiplicative around the baseline. Every apply starts from the original baseline: edits never drift.
 * The pristine baseline is stored on the anchor itself so switching candidates away/back cannot turn a
 * temporary Forge edit into a new baseline.
 */
export function createFitSession(anchor) {
  if (!anchor?.isObject3D || !anchor.parent) throw new Error('fit authoring requires a mounted THREE.Object3D anchor');

  const baseline = baselineFor(anchor);
  let delta = {
    positionWorld: [0, 0, 0],
    rotationDeg: [0, 0, 0],
    scale: 0,
  };

  function apply(next = delta) {
    delta = {
      positionWorld: finite3(next.positionWorld),
      rotationDeg: finite3(next.rotationDeg),
      scale: Math.max(-0.9, finiteNumber(next.scale)),
    };

    const parent = anchor.parent;
    parent.updateMatrixWorld(true);

    // Rebuild from the pristine local baseline on every edit, then move that point along intuitive
    // world axes before converting it back into the bone's local frame.
    const baselineWorld = baseline.position.clone().applyMatrix4(parent.matrixWorld);
    const targetWorld = baselineWorld.clone().add(new THREE.Vector3(...delta.positionWorld));
    anchor.position.copy(parent.worldToLocal(targetWorld));

    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      delta.rotationDeg[0] / DEG,
      delta.rotationDeg[1] / DEG,
      delta.rotationDeg[2] / DEG,
      'XYZ',
    ));
    anchor.quaternion.copy(baseline.quaternion).multiply(rotation);

    const factor = 1 + delta.scale;
    anchor.scale.copy(baseline.scale).multiplyScalar(factor);
    anchor.updateMatrixWorld(true);

    return snapshot();
  }

  function reset() {
    delta = { positionWorld: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 0 };
    anchor.position.copy(baseline.position);
    anchor.quaternion.copy(baseline.quaternion);
    anchor.scale.copy(baseline.scale);
    anchor.updateMatrixWorld(true);
    return snapshot();
  }

  function nudge(axis, amountMeters) {
    const index = { x: 0, y: 1, z: 2 }[axis];
    if (index === undefined) throw new Error(`unknown fit axis ${axis}`);
    const positionWorld = [...delta.positionWorld];
    positionWorld[index] += finiteNumber(amountMeters);
    return apply({ ...delta, positionWorld });
  }

  function snapshot() {
    return {
      delta: {
        positionWorld: [...delta.positionWorld],
        rotationDeg: [...delta.rotationDeg],
        scale: delta.scale,
      },
      baseline: {
        localPosition: baseline.position.toArray(),
        localRotationQuaternion: baseline.quaternion.toArray(),
        localScale: baseline.scale.toArray(),
      },
      effective: transformOut(anchor),
    };
  }

  return Object.freeze({ apply, nudge, reset, snapshot });
}
