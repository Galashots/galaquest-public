// The ground-speed law: how far the stick is pushed becomes how fast the hero travels.
//
// Split out of locomotion.js so the node game server can import it without pulling in three.js --
// locomotion.js owns the AnimationMixer and needs THREE, a headless server needs neither. The point
// is that client prediction and server authority use the SAME function, not two that agree today.
// A duplicated constant here would present as the hero rubber-banding on every snapshot.
//
// Pure functions only. Nothing in this file may import anything.

// RAISED 2026-08-27, after the second child playtest: the continuous curve below (2026-08-15) fixed
// the WALK/RUN cliff, but both speeds were still just slow -- two kids on real iPads described the
// hero as "sluggish" even at full stick deflection, which is a different complaint from the one that
// curve fixed. 1.4/2.8 -> 1.7/3.6, a bigger jump for the run than the walk, since the run is the
// deliberate the-kid-really-means-it push and has more room to reward it.
export const WALK_SPEED = 1.7;
export const RUN_SPEED = 3.6;
// RUN_THRESHOLD is DERIVED, not retyped, so it keeps the SAME fractional position along the
// WALK_SPEED..RUN_SPEED range that it held before this speed-up -- 0.6 m/s over the old 1.4 WALK_SPEED,
// out of the old 1.4 m/s WALK_SPEED..RUN_SPEED span, i.e. 3/7 of the way up. Retyping a bare 2.0 here
// would have silently moved the point on the STICK where the run clip triggers (it used to fire at a
// ~0.78 push, see RUN_DEFLECTION's own comment) without anyone changing the stick at all.
const RUN_THRESHOLD_FRACTION = 3 / 7;
export const RUN_THRESHOLD = WALK_SPEED + (RUN_SPEED - WALK_SPEED) * RUN_THRESHOLD_FRACTION;

// HOW FAR THE STICK HAS TO GO TO MEAN "RUN". Lives here, with the speed law it is part of, and is
// imported by input/touch.js rather than declared there (GQ-007) -- the curve below needs it, and
// speed.js may not import anything.
//
// 0.62, down from the 0.85 that shipped to the first child playtest. younger players said their character
// moved too slowly; older players said the speed was fine. Both are true, and the constant is why: at
// 0.85 the run lived in the outer 15% of a 56 px stick, which is a deliberate, sustained push to the
// rim. An older player holds it there. A younger one rests a thumb around half deflection and, at
// the old law, walked the entire game at about 0.7 m/s -- half the walk speed -- without ever
// discovering that the game had a run in it at all.
export const RUN_DEFLECTION = 0.62;

/**
 * Ground speed from how far the stick is pushed.
 *
 * THE CURVE IS CONTINUOUS NOW, and that is the change. The old law was
 * `min(magnitude, 1) * (run ? RUN_SPEED : WALK_SPEED)`, which stepped from 1.19 m/s to 2.38 m/s at
 * the run boundary -- the comment here used to defend that step as "push it all the way to run is a
 * rule a child can feel", and it flagged itself as a design choice to check on the device. The
 * device checked it: one of the two children never found the far side of the step.
 *
 * Now the stick reaches WALK_SPEED at RUN_DEFLECTION and then climbs to RUN_SPEED at the rim, with
 * no jump anywhere:
 *
 *     push  0.25 -> 0.69 m/s     (was 0.56 before the 2026-08-27 speed-up, 0.35 before the curve)
 *     push  0.50 -> 1.37 m/s     (was 1.13, 0.70)
 *     push  0.62 -> 1.70 m/s     (was 1.40, 0.87)   <- walk speed, at the run boundary
 *     push  0.80 -> 2.60 m/s     (was 1.86, 1.12)
 *     push  1.00 -> 3.60 m/s     (was 2.80, 2.80)
 *
 * 2026-08-27 raised WALK_SPEED and RUN_SPEED again (see their own comment) -- this table is the
 * SHAPE of the curve, which that change did not touch: every push still lands at the same FRACTION
 * of the way from WALK_SPEED to RUN_SPEED it did before, only the two endpoints moved.
 *
 * `run` still does real work rather than being ignored in favour of magnitude alone, and it has to:
 * the KEYBOARD reports magnitude 1 with run false for a plain WASD walk (input/keyboard.js puts run
 * on Shift), so a curve that read magnitude only would make every keyboard walk a sprint. Below the
 * threshold the push is normalised by RUN_DEFLECTION and clamped, which is what lets a full-magnitude
 * walk still be exactly WALK_SPEED.
 */
export function groundSpeedForInput(magnitude, run) {
  const push = magnitude > 1 ? 1 : magnitude;
  if (!(push > 0)) return 0;
  if (run !== true) return Math.min(push / RUN_DEFLECTION, 1) * WALK_SPEED;
  const over = (push - RUN_DEFLECTION) / (1 - RUN_DEFLECTION);
  return WALK_SPEED + Math.min(Math.max(over, 0), 1) * (RUN_SPEED - WALK_SPEED);
}

export function playbackRateForSpeed(groundSpeed, nominalSpeed) {
  if (groundSpeed <= 0) return 0;
  return groundSpeed / nominalSpeed;
}

export function locomotionModeForSpeed(groundSpeed) {
  return groundSpeed >= RUN_THRESHOLD ? 'run' : 'walk';
}
