import * as THREE from '../../vendor/three.module.min.js';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
export const FORGE_FIT_SCHEMA = 'galaquest.asset-forge-fit/2';
export const FORGE_ROTATION_SPACE = 'world';

function baselineFor(anchor) {
  const stored = anchor.userData?.gqForgeFitBaseline;
  if (stored) {
    return Object.freeze({
      position: new THREE.Vector3().fromArray(stored.position),
      quaternion: new THREE.Quaternion().fromArray(stored.quaternion),
      scale: new THREE.Vector3().fromArray(stored.scale),
      parentMatrixWorld: new THREE.Matrix4().fromArray(stored.parentMatrixWorld),
      parentWorldQuaternion: new THREE.Quaternion().fromArray(stored.parentWorldQuaternion),
    });
  }

  anchor.parent.updateMatrixWorld(true);
  const parentWorldQuaternion = new THREE.Quaternion();
  anchor.parent.getWorldQuaternion(parentWorldQuaternion);
  const baseline = {
    position: anchor.position.clone(),
    quaternion: anchor.quaternion.clone(),
    scale: anchor.scale.clone(),
    parentMatrixWorld: anchor.parent.matrixWorld.clone(),
    parentWorldQuaternion,
  };
  anchor.userData.gqForgeFitBaseline = {
    position: baseline.position.toArray(),
    quaternion: baseline.quaternion.toArray(),
    scale: baseline.scale.toArray(),
    parentMatrixWorld: baseline.parentMatrixWorld.toArray(),
    parentWorldQuaternion: baseline.parentWorldQuaternion.toArray(),
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
  const worldQuaternion = new THREE.Quaternion();
  anchor.getWorldPosition(world);
  anchor.getWorldQuaternion(worldQuaternion);
  return {
    localPosition: anchor.position.toArray(),
    worldPosition: world.toArray(),
    localRotationDeg: [euler.x * DEG, euler.y * DEG, euler.z * DEG],
    worldRotationQuaternion: worldQuaternion.toArray(),
    localScale: anchor.scale.toArray(),
  };
}

/**
 * Create one non-destructive authoring session around an existing mounted gear anchor.
 *
 * The Forge is a visual fitting tool, so its axes must mean what the reviewer sees:
 *   - position deltas are WORLD X/Y/Z;
 *   - rotation deltas are WORLD X/Y/Z, composed on top of the locked candidate baseline;
 *   - scale is uniform and multiplicative around that baseline.
 *
 * The conversion frame is captured once when the pristine baseline is first seen and stored beside
 * the baseline on the anchor. That matters when animations are playing: changing an unrelated field
 * must never recalculate the local transform from whichever hand/head pose happened to be on screen
 * during that keystroke. Every apply therefore uses the same reference parent frame and is fully
 * baseline-relative. Animation can move the bone afterwards; the fitted local transform simply
 * follows it like normal rigid gear.
 */
export function createFitSession(anchor) {
  if (!anchor?.isObject3D || !anchor.parent) throw new Error('fit authoring requires a mounted THREE.Object3D anchor');

  const baseline = baselineFor(anchor);
  const parentWorldInverse = baseline.parentMatrixWorld.clone().invert();
  const parentWorldQuaternionInverse = baseline.parentWorldQuaternion.clone().invert();
  const baselineWorldPosition = baseline.position.clone().applyMatrix4(baseline.parentMatrixWorld);
  const baselineWorldQuaternion = baseline.parentWorldQuaternion.clone().multiply(baseline.quaternion);

  let delta = {
    positionWorld: [0, 0, 0],
    rotationDeg: [0, 0, 0],
    rotationSpace: FORGE_ROTATION_SPACE,
    scale: 0,
  };

  function apply(next = delta) {
    delta = {
      positionWorld: finite3(next.positionWorld, delta.positionWorld),
      rotationDeg: finite3(next.rotationDeg, delta.rotationDeg),
      rotationSpace: FORGE_ROTATION_SPACE,
      scale: Math.max(-0.9, finiteNumber(next.scale, delta.scale)),
    };

    // Translate along the Forge's stable reference WORLD axes, then convert back to the bone-local
    // transform that the runtime actually stores.
    const targetWorld = baselineWorldPosition.clone().add(new THREE.Vector3(...delta.positionWorld));
    anchor.position.copy(targetWorld.applyMatrix4(parentWorldInverse));

    // World-space authoring is intentionally PRE-multiplied. A +Y edit means yaw around the screen/
    // scene Y axis even when the hand bone and the sword baseline are already strongly rotated.
    const deltaWorldQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      delta.rotationDeg[0] * RAD,
      delta.rotationDeg[1] * RAD,
      delta.rotationDeg[2] * RAD,
      'XYZ',
    ));
    const targetWorldQuaternion = deltaWorldQuaternion.multiply(baselineWorldQuaternion.clone());
    anchor.quaternion.copy(parentWorldQuaternionInverse).multiply(targetWorldQuaternion).normalize();

    const factor = 1 + delta.scale;
    anchor.scale.copy(baseline.scale).multiplyScalar(factor);
    anchor.updateMatrixWorld(true);

    return snapshot();
  }

  function reset() {
    delta = {
      positionWorld: [0, 0, 0],
      rotationDeg: [0, 0, 0],
      rotationSpace: FORGE_ROTATION_SPACE,
      scale: 0,
    };
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

  function nudgeRotation(axis, amountDegrees) {
    const index = { x: 0, y: 1, z: 2 }[axis];
    if (index === undefined) throw new Error(`unknown fit rotation axis ${axis}`);
    const rotationDeg = [...delta.rotationDeg];
    rotationDeg[index] += finiteNumber(amountDegrees);
    return apply({ ...delta, rotationDeg });
  }

  function nudgeScale(amount) {
    return apply({ ...delta, scale: delta.scale + finiteNumber(amount) });
  }

  function snapshot() {
    return {
      schema: FORGE_FIT_SCHEMA,
      delta: {
        positionWorld: [...delta.positionWorld],
        rotationDeg: [...delta.rotationDeg],
        rotationSpace: delta.rotationSpace,
        scale: delta.scale,
      },
      baseline: {
        localPosition: baseline.position.toArray(),
        localRotationQuaternion: baseline.quaternion.toArray(),
        localScale: baseline.scale.toArray(),
      },
      reference: {
        parentName: anchor.parent?.name ?? null,
        parentMatrixWorld: baseline.parentMatrixWorld.toArray(),
        parentWorldQuaternion: baseline.parentWorldQuaternion.toArray(),
      },
      effective: transformOut(anchor),
    };
  }

  return Object.freeze({ apply, nudge, nudgeRotation, nudgeScale, reset, snapshot });
}
