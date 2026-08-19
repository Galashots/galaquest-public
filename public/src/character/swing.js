// A sword swing for a hero who has no attack clip.
//
// hero_lod1_ironwood_atlas.glb ships exactly two animations, walking_man and running. There is no
// attack, no hit reaction and no death. Authoring or sourcing a real attack clip is the proper fix;
// this is the cheap one that lets the fight read while that is outstanding.
//
// The arc is the ordinary third-person melee shape: wind up over the shoulder, whip down and across
// the body, settle. The blade passes through the target at the moment encounter.js says contact
// happens, so what the child sees and what the rules did are the same event -- get that wrong and the
// wolf flinches before the sword arrives, which reads as the game cheating.
//
// Pure and unit-testable on purpose. The applier below is the only part that touches three.js.

// Fractions of the total swing. CONTACT_AT must match SWING_CONTACT_SECONDS / SWING_SECONDS in
// encounter.js; swing.test.mjs asserts that rather than trusting this comment.
export const WINDUP_PEAK_AT = 0.25;
export const RECOVER_FROM = 0.55;

export const WINDUP_RADIANS = 1.35;
export const FOLLOW_THROUGH_RADIANS = 0.95;
// The forearm cocks back with the shoulder and straightens through the strike, which is what stops
// the arm reading as one stiff plank rotating about the shoulder.
export const FOREARM_WINDUP_RADIANS = 0.75;
// A little torso rotation. Small, because the spine also carries the idle breath.
export const TORSO_TWIST_RADIANS = 0.28;

const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

/**
 * Where the arm is, as a fraction of the way through a swing.
 *
 * `progress` is 0 at the button press and 1 when the swing ends. Returns radians to ADD to whatever
 * pose the locomotion clip produced.
 */
export function swingPose(progress) {
  if (!(progress >= 0) || progress > 1) {
    return { shoulderPitch: 0, forearmPitch: 0, torsoTwist: 0 };
  }

  let shoulderPitch;
  if (progress < WINDUP_PEAK_AT) {
    // Up and back, decelerating into the top of the arc.
    shoulderPitch = -WINDUP_RADIANS * easeOut(progress / WINDUP_PEAK_AT);
  } else if (progress < RECOVER_FROM) {
    // The strike. Crosses zero -- the blade at its target -- part way through, which is where
    // encounter.js lands its damage.
    const t = (progress - WINDUP_PEAK_AT) / (RECOVER_FROM - WINDUP_PEAK_AT);
    shoulderPitch = -WINDUP_RADIANS + (WINDUP_RADIANS + FOLLOW_THROUGH_RADIANS) * easeInOut(t);
  } else {
    // Settle back to the locomotion pose.
    const t = (progress - RECOVER_FROM) / (1 - RECOVER_FROM);
    shoulderPitch = FOLLOW_THROUGH_RADIANS * (1 - easeOut(t));
  }

  // The forearm leads the wind-up and is straight by the strike.
  const forearmPitch = progress < WINDUP_PEAK_AT
    ? -FOREARM_WINDUP_RADIANS * easeOut(progress / WINDUP_PEAK_AT)
    : -FOREARM_WINDUP_RADIANS * Math.max(0, 1 - (progress - WINDUP_PEAK_AT) / (RECOVER_FROM - WINDUP_PEAK_AT));

  // Torso follows the shoulder at a fraction of its travel.
  const torsoTwist = (shoulderPitch / WINDUP_RADIANS) * TORSO_TWIST_RADIANS;

  return { shoulderPitch, forearmPitch, torsoTwist };
}

export const SWING_ARM_BONE = 'RightArm';
export const SWING_FOREARM_BONE = 'RightForeArm';
export const SWING_TORSO_BONE = 'Spine01';

// WHICH AXIS SWINGS THE ARM, measured on the live rig rather than assumed.
//
// A forward/back swing is a rotation about the hero's own left-right axis, so the right bone axis is
// whichever of the bone's local axes is most parallel to it. Measured against the hero frame:
//
//     RightArm       local X 0.194   local Y 0.130   local Z 0.972   <- Z
//     RightForeArm   local X 0.026   local Y 0.288   local Z 0.957   <- Z
//     Spine01        local X 0.993   local Y 0.033   local Z 0.114
//
// So the arm and forearm swing about their local Z. The first version of this used rotation.x on
// both, which is 0.194 aligned -- the sword slid around the hip and never lifted, and the capture
// showed a hero waving a blade through his own thigh. Same error as fitting the shield to the fist:
// a plausible axis, assumed instead of measured.
//
// The torso is different and rotation.y is correct there: a twist is a rotation about the hero's UP
// axis, and Spine01's local Y sits at (-0.033, 0.999, 0.007) -- essentially hero-up exactly. The idle
// breath's sway uses that same axis for the same reason.
const ARM_SWING_AXIS = 'z';
const TORSO_TWIST_AXIS = 'y';

/**
 * Apply swingPose() to the rig, on top of whatever the locomotion mixer just wrote.
 *
 * Set from a captured base, never accumulated. The idle breath learned this the expensive way: added
 * onto the bone's current value it compounded to 1.82 radians -- 104 degrees -- in the running game
 * while every unit test passed. Capturing when the swing starts and restoring when it ends is safe
 * whether or not the locomotion clip happens to rewrite these bones on any given frame, which is the
 * property that matters, because "the clip rewrites it" is exactly the assumption that failed before.
 */
export function createSwingAnimator(root) {
  const arm = root.getObjectByName(SWING_ARM_BONE) ?? null;
  const forearm = root.getObjectByName(SWING_FOREARM_BONE) ?? null;
  const torso = root.getObjectByName(SWING_TORSO_BONE) ?? null;
  let base = null;

  function capture() {
    base = {
      arm: arm ? arm.rotation[ARM_SWING_AXIS] : 0,
      forearm: forearm ? forearm.rotation[ARM_SWING_AXIS] : 0,
      torso: torso ? torso.rotation[TORSO_TWIST_AXIS] : 0,
    };
  }

  function restore() {
    if (base === null) return;
    if (arm) arm.rotation[ARM_SWING_AXIS] = base.arm;
    if (forearm) forearm.rotation[ARM_SWING_AXIS] = base.forearm;
    if (torso) torso.rotation[TORSO_TWIST_AXIS] = base.torso;
    base = null;
  }

  return {
    /** @param swingSeconds encounter.hero.swingSeconds -- negative when no swing is running. */
    update(swingSeconds, swingDurationSeconds) {
      if (swingSeconds < 0) {
        restore();
        return false;
      }
      if (base === null) capture();
      const { shoulderPitch, forearmPitch, torsoTwist } = swingPose(swingSeconds / swingDurationSeconds);
      if (arm) arm.rotation[ARM_SWING_AXIS] = base.arm + shoulderPitch;
      if (forearm) forearm.rotation[ARM_SWING_AXIS] = base.forearm + forearmPitch;
      if (torso) torso.rotation[TORSO_TWIST_AXIS] = base.torso + torsoTwist;
      return true;
    },
    isSwinging() {
      return base !== null;
    },
  };
}
