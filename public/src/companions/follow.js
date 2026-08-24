// Pure companion formation/follow math. This file deliberately knows nothing about Three.js,
// combat, networking, persistence, or the temporary model used to present the companion.

export const COMPANION_FORMATION = Object.freeze({
  behindMeters: 1.25,
  lateralMeters: 0.55,
  idleBandMeters: 0.35,
  catchupSpeedMetersPerSecond: 5.2,
  runDistanceMeters: 2.4,
  snapDistanceMeters: 7.5,
  recoveryBehindMeters: 1.8,
  recoveryLateralMeters: 0.65,
});
const MOTION_EPSILON_METERS = 0.0001;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function headingVectors(heading) {
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  return {
    forwardX,
    forwardZ,
    rightX: Math.cos(heading),
    rightZ: -Math.sin(heading),
  };
}

function pointInFormation(hero, behindMeters, lateralMeters) {
  const x = finite(hero?.x);
  const z = finite(hero?.z);
  const heading = finite(hero?.heading);
  const { forwardX, forwardZ, rightX, rightZ } = headingVectors(heading);
  return {
    x: x - forwardX * behindMeters + rightX * lateralMeters,
    z: z - forwardZ * behindMeters + rightZ * lateralMeters,
    heading,
  };
}

export function companionSlotForHero(hero, options = {}) {
  return pointInFormation(
    hero,
    options.behindMeters ?? COMPANION_FORMATION.behindMeters,
    options.lateralMeters ?? COMPANION_FORMATION.lateralMeters,
  );
}

function nearHeroRecoverySlot(hero) {
  return pointInFormation(
    hero,
    COMPANION_FORMATION.recoveryBehindMeters,
    COMPANION_FORMATION.recoveryLateralMeters,
  );
}

function distanceBetween(a, b) {
  return Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));
}

function stateAtPoint(point, hero, extra = {}) {
  return {
    x: point.x,
    z: point.z,
    heading: finite(point.heading, finite(hero?.heading)),
    speed: 0,
    mode: 'idle',
    snapped: false,
    initialized: true,
    distanceToSlot: extra.distanceToSlot ?? 0,
    distanceToHero: distanceBetween(point, hero),
    lastHeroX: finite(extra.lastHeroX, finite(hero?.x)),
    lastHeroZ: finite(extra.lastHeroZ, finite(hero?.z)),
    lastSlotX: finite(extra.lastSlotX, point.x),
    lastSlotZ: finite(extra.lastSlotZ, point.z),
  };
}

/**
 * Compute one companion movement intent/state from the local hero and the previous companion state.
 * The returned position advances by at most catchup speed * deltaSeconds during ordinary movement.
 * A clearly unreasonable separation is treated as a discontinuity and recovers at a deterministic
 * near-hero slot instead of making the companion run across the map.
 */
export function nextCompanionState({ hero, companion, deltaSeconds }) {
  const safeHero = {
    x: finite(hero?.x),
    z: finite(hero?.z),
    heading: finite(hero?.heading),
  };
  const current = {
    x: finite(companion?.x, safeHero.x),
    z: finite(companion?.z, safeHero.z),
    heading: finite(companion?.heading, safeHero.heading),
  };
  const slot = companionSlotForHero(safeHero);
  const distanceToSlot = distanceBetween(current, slot);
  const stepSeconds = Math.max(0, Math.min(finite(deltaSeconds), 0.25));
  const hasPreviousMotionState = companion?.initialized === true
    && Number.isFinite(companion?.lastHeroX)
    && Number.isFinite(companion?.lastHeroZ)
    && Number.isFinite(companion?.lastSlotX)
    && Number.isFinite(companion?.lastSlotZ);
  const heroMoved = hasPreviousMotionState && distanceBetween(
    { x: companion.lastHeroX, z: companion.lastHeroZ },
    safeHero,
  ) > MOTION_EPSILON_METERS;
  const slotMoved = hasPreviousMotionState && distanceBetween(
    { x: companion.lastSlotX, z: companion.lastSlotZ },
    slot,
  ) > MOTION_EPSILON_METERS;
  // Carry the previous hero/slot positions in the pure state so the idle band only holds when the
  // hero has actually settled. Without this seam, a moving slot repeatedly crosses the band and
  // produces the visible hold -> dart -> hold cadence the checkpoint is meant to avoid.
  const heroMoving = heroMoved || slotMoved;
  const motionState = {
    lastHeroX: safeHero.x,
    lastHeroZ: safeHero.z,
    lastSlotX: slot.x,
    lastSlotZ: slot.z,
  };

  if (companion?.initialized !== true) {
    return {
      ...stateAtPoint(slot, safeHero, { distanceToSlot, ...motionState }),
      snapped: true,
    };
  }

  if (distanceToSlot >= COMPANION_FORMATION.snapDistanceMeters) {
    return {
      ...stateAtPoint(nearHeroRecoverySlot(safeHero), safeHero, { distanceToSlot, ...motionState }),
      snapped: true,
    };
  }

  if (distanceToSlot <= COMPANION_FORMATION.idleBandMeters && !heroMoving) {
    return stateAtPoint(current, safeHero, { distanceToSlot, ...motionState });
  }

  const dx = slot.x - current.x;
  const dz = slot.z - current.z;
  const directionHeading = Math.atan2(dx, dz);
  const step = Math.min(distanceToSlot, COMPANION_FORMATION.catchupSpeedMetersPerSecond * stepSeconds);
  const next = {
    x: current.x + (dx / distanceToSlot) * step,
    z: current.z + (dz / distanceToSlot) * step,
    heading: directionHeading,
  };
  return {
    ...next,
    speed: stepSeconds > 0 ? step / stepSeconds : 0,
    mode: distanceToSlot >= COMPANION_FORMATION.runDistanceMeters ? 'run' : 'walk',
    snapped: false,
    initialized: true,
    distanceToSlot: distanceBetween(next, slot),
    distanceToHero: distanceBetween(next, safeHero),
    ...motionState,
  };
}
