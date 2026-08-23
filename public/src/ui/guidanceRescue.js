// When to offer a lost child help, and — harder — when to shut up.
//
// Pure and unit tested, and WIRED: main.js holds one createRescueWatch() and feeds it the live
// distance every frame, showing #guidance-rescue when it offers. (The header said "wired to
// nothing" for longer than it was true, which the Director caught -- a stale comment about what
// calls a module is a lie about the blast radius of changing it.) Third of the three "never lost"
// pieces: ui/offscreenPointer.js says where the arrow goes, ui/minimap.js says where the dial puts
// it, and this says whether the child needs either of them offered rather than merely available.
//
// THE MEASURE IS PROGRESS, NOT MOVEMENT, AND NOT DIRECTION.
//
// The obvious rule is "are they walking away from it", and it is wrong twice over. A child rounding
// a house walks away from the Lantern Tree for four seconds and is not lost. A child running in a
// tight circle two metres from the Keeper is moving constantly, is never far away, and is
// completely stuck. Frame-to-frame heading answers neither case.
//
// So the question is: HAS THIS CHILD EVER BEEN CLOSER TO THE THING THAN THEY ARE NOW, and how long
// has it been since that changed. Getting nearer than your own best resets the clock. Wandering,
// circling, backtracking and standing still all fail to reset it, without needing to be told apart.
// One number covers every shape of stuck.
//
// WHY THE HARD PART IS THE SILENCE. A hint a child did not ask for, arriving repeatedly, teaches
// them the game talks over them; the brief's own camera doctrine says the player owns the camera,
// and the same respect applies to the screen. So the watch offers ONCE per stretch of being stuck,
// stays quiet while the child does something about it, and needs real progress before it may speak
// again -- not merely the passage of time.
//
// It decides nothing about presentation and reads no clock of its own: the caller feeds it
// deltaSeconds, which is what lets a test run twenty simulated minutes in a millisecond and what
// keeps the frame clamp in main.js from making "ten seconds" mean two different things.

/** How long without getting nearer before a child is offered help. Provisional tuning, in the
 *  brief's sense: implementable and testable, not an Owner decision. Long enough that looking
 *  around, reading a sign, or fighting the wolf that wandered over is not treated as being lost --
 *  the opening's own walk from spawn to the Keeper is about 8 seconds. */
export const DEFAULT_PATIENCE_SECONDS = 12;

/** How much nearer counts as getting nearer. Prediction reconciliation nudges the hero by a tenth of
 *  its error per snapshot even while a child stands perfectly still, so a zero threshold would read
 *  that drift as progress and the offer would never come. Comfortably above that and far below any
 *  step a walking child takes. */
export const PROGRESS_EPSILON_METERS = 0.25;

/**
 * @param options.patienceSeconds       how long without progress before offering.
 * @param options.progressEpsilonMeters how much nearer counts as nearer.
 *
 * @returns a watch with:
 *   update({ distanceMeters, objectiveId, targetKey, deltaSeconds })
 *              -> { offering, secondsStuck, bestMeters }. `targetKey` is the identity of the
 *              PLACE, from targetKeyFor -- separate from objectiveId because one objective can
 *              point at six different lights in turn.
 *   accept()   the child took the help. Silent until they get genuinely stuck again.
 *   dismiss()  the child waved it away. Same, and deliberately not a shorter fuse: someone who has
 *              just said no is the last person to ask again sooner.
 *   reset()    start over, for a caller that knows something this cannot see.
 */
/**
 * The most one update may add to the clock, however long the gap really was.
 *
 * PATIENCE IS WALL-CLOCK, and this is the bound that makes that safe. A child who has been staring
 * at an unchanging screen for twelve seconds has been staring for twelve seconds whether the device
 * managed sixty frames a second or two -- so the caller must NOT feed this the movement clamp.
 * main.js clamps its own deltaSeconds to 0.1 so a hitch cannot teleport the hero, which is a physics
 * concern; feeding that here makes a starved device count time at 40% of real, and it did: measured
 * in a browser, this clock reached 5.97 s over 15 wall-clock seconds and the offer never came.
 *
 * But raw wall-clock has its own failure, in the other direction. A tablet put down for five minutes
 * hands back a single 300-second frame when it wakes, and a child returning to their game would be
 * met instantly by an offer of help for standing still while the screen was off. They were not
 * staring at it; they were not there. A gap longer than a second is not a slow frame, it is an
 * absence, and it is credited as one second rather than as nothing so a genuinely slow device is
 * still counted honestly.
 */
export const MAX_CREDITED_SECONDS = 1;

/**
 * The identity of a PLACE, for a watch that has to know when the thing it is measuring moved.
 *
 * BY VALUE, NOT BY REFERENCE, and that is the whole reason this exists as a function rather than as
 * an `===` on the place itself. The two dynamic destinations -- the next dark light, the next
 * unbroken seal -- are resolved by mapping a filtered list into fresh `{ x, z }` objects EVERY
 * FRAME, so reference equality reports a brand-new target sixty times a second and the watch would
 * restart forever. A fixed destination, by contrast, returns the same frozen object each time. Two
 * different answers to "is this the same place" for two kinds of place is exactly the sort of split
 * this repo keeps paying for, so neither caller gets to decide: a place is its coordinate.
 *
 * Exported so main.js and the tests cannot each invent a format that agrees today (GQ-007).
 */
export function targetKeyFor(place) {
  return place ? `${place.x},${place.z}` : null;
}

export function createRescueWatch({
  patienceSeconds = DEFAULT_PATIENCE_SECONDS,
  progressEpsilonMeters = PROGRESS_EPSILON_METERS,
} = {}) {
  let bestMeters = Infinity;
  let secondsStuck = 0;
  let offering = false;
  // Set when the child answers an offer. Cleared only by real progress -- never by a timer -- which
  // is what makes "shut up until something changes" true rather than "shut up for a while".
  let answered = false;
  let watchingObjectiveId = null;
  let watchingTargetKey = null;

  function startFresh(objectiveId, targetKey, distanceMeters) {
    watchingObjectiveId = objectiveId;
    watchingTargetKey = targetKey;
    bestMeters = Number.isFinite(distanceMeters) ? distanceMeters : Infinity;
    secondsStuck = 0;
    offering = false;
    answered = false;
  }

  function update({ distanceMeters, objectiveId = null, targetKey = null, deltaSeconds = 0 }) {
    // A NEW OBJECTIVE IS A NEW QUESTION. Carrying the old one's stuck clock across would offer help
    // for the previous errand the instant a child finishes it -- the moment they are least lost.
    //
    // It falls THROUGH rather than returning, so this frame's delta is counted like any other. An
    // early version returned here, which made the first sample of every objective free and left
    // "twelve seconds of patience" meaning twelve seconds sometimes and thirteen samples other
    // times, depending on whether the caller had just switched. One frame is nothing; a rule that
    // means two things is not.
    if (objectiveId !== watchingObjectiveId) {
      startFresh(objectiveId, targetKey, distanceMeters);
    } else if (targetKey !== watchingTargetKey) {
      // THE ERRAND DID NOT CHANGE BUT THE PLACE DID. "Wake the dark lights" and "N cold seals left"
      // keep one name across six lights and three seals; the child finishes one and the SAME
      // objective now points twenty metres away. Carrying the old best across is the defect: a
      // child who walked right up to light A holds a best of one metre, and then every honest step
      // toward light B reads as failing to get nearer. They would be offered help for walking
      // exactly where they were sent -- and offered it at the worst possible moment, seconds after
      // succeeding at something.
      //
      // ONLY THE BEST DISTANCE RESTARTS. The stuck clock does NOT, and the asymmetry with a change
      // of objective above is deliberate:
      //
      //   A new OBJECTIVE means the child finished a whole beat -- there is a banner, a ceremony,
      //   something the game just said to them. Nagging a second later is the failure the "new
      //   errand" rule exists to prevent, so everything restarts.
      //
      //   A new TARGET inside one objective means the errand pointed somewhere else. The child has
      //   not finished anything the game made a fuss about, and if they were stuck a moment ago
      //   they are still stuck -- the thing they are stuck ON simply moved. Zeroing the clock here
      //   would make "stand between two unlit lights" permanently silent: whichever is nearest
      //   flips as they drift, and a clock that restarts on every flip never reaches the patience.
      //   That is a rescue that can never fire, which looks exactly like restraint.
      //
      // The clock being kept is safe in the direction that matters, because reaching a light is how
      // you light it: a child who completed A got nearer to A to do it, and getting nearer is the
      // one thing that zeroes the clock. So at the moment a target changes by completion, the clock
      // is already at zero and there is nothing to carry.
      watchingTargetKey = targetKey;
      bestMeters = Number.isFinite(distanceMeters) ? distanceMeters : Infinity;
    }

    // No distance to measure against -- an objective with no place, like cutting the bramble in
    // front of you. Not stuck, not offering: this watch has nothing to say about it, and saying
    // nothing is different from saying no.
    if (!Number.isFinite(distanceMeters)) {
      secondsStuck = 0;
      offering = false;
      return { offering, secondsStuck, bestMeters };
    }

    if (distanceMeters < bestMeters - progressEpsilonMeters) {
      bestMeters = distanceMeters;
      secondsStuck = 0;
      offering = false;
      // Real progress is the ONE thing that earns the right to speak again.
      answered = false;
      return { offering, secondsStuck, bestMeters };
    }

    secondsStuck += Math.min(MAX_CREDITED_SECONDS, Math.max(0, deltaSeconds));
    offering = !answered && secondsStuck >= patienceSeconds;
    return { offering, secondsStuck, bestMeters };
  }

  return {
    update,
    accept() { answered = true; offering = false; },
    dismiss() { answered = true; offering = false; },
    reset() { startFresh(watchingObjectiveId, watchingTargetKey, Infinity); },
    /** For a harness: observable without being able to drive it, the same posture main.js's runtime
     *  object takes toward the rules. */
    debugState: () => ({
      offering, secondsStuck, bestMeters, answered, watchingObjectiveId, watchingTargetKey,
    }),
  };
}
