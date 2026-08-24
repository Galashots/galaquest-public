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
const MOTION_CONFIRM_FRAMES = 3;
const SETTLE_FRAMES = 6;

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
    phase: extra.phase ?? 'settled',
    motionFrames: extra.motionFrames ?? 0,
    settleFrames: extra.settleFrames ?? 0,
    motionTrendX: extra.motionTrendX ?? 0,
    motionTrendZ: extra.motionTrendZ ?? 0,
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
  const previousPhase = companion?.phase
    ?? (companion?.mode === 'walk' || companion?.mode === 'run' ? 'moving' : 'settled');
  const previousMotionFrames = Math.max(0, finite(companion?.motionFrames));
  const previousSettleFrames = Math.max(0, finite(companion?.settleFrames));
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
  // hero has actually settled. A few consecutive motion observations are required to leave the
  // settled phase; this is a stateful seam, not a larger idle band, and filters one-frame position
  // noise from reconciliation or floating-point drift without delaying real movement perceptibly.
  const observedMotion = heroMoved || slotMoved;
  const motionDeltaX = heroMoved
    ? safeHero.x - companion.lastHeroX
    : slot.x - companion.lastSlotX;
  const motionDeltaZ = heroMoved
    ? safeHero.z - companion.lastHeroZ
    : slot.z - companion.lastSlotZ;
  const trendContinues = previousMotionFrames > 0
    && (motionDeltaX * finite(companion?.motionTrendX)
      + motionDeltaZ * finite(companion?.motionTrendZ)) > 0;
  const motionFrames = observedMotion
    ? (trendContinues ? previousMotionFrames + 1 : 1)
    : 0;
  const settleFrames = observedMotion ? 0 : previousSettleFrames + 1;
  const confirmedMotion = previousPhase === 'moving'
    ? observedMotion
    : motionFrames >= MOTION_CONFIRM_FRAMES;
  const phase = confirmedMotion
    ? 'moving'
    : (previousPhase === 'moving' || (previousPhase === 'settling' && settleFrames < SETTLE_FRAMES))
      ? 'settling'
      : 'settled';
  const motionState = {
    phase,
    motionFrames,
    settleFrames,
    motionTrendX: observedMotion ? motionDeltaX : 0,
    motionTrendZ: observedMotion ? motionDeltaZ : 0,
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

  if (distanceToSlot <= COMPANION_FORMATION.idleBandMeters && phase === 'settled') {
    return stateAtPoint(current, safeHero, { distanceToSlot, ...motionState });
  }

  if (distanceToSlot <= Number.EPSILON) {
    return {
      ...stateAtPoint(current, safeHero, { distanceToSlot, ...motionState }),
      mode: phase === 'moving' ? 'walk' : 'idle',
    };
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
