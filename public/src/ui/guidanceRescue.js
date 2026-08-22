// When to offer a lost child help, and — harder — when to shut up.
//
// CP2 PREPARATION. Pure, unit tested, wired to nothing. Third of the three "never lost" pieces whose
// maths do not depend on the destination-identity question still open with the Director:
// ui/offscreenPointer.js says where the arrow goes, ui/minimap.js says where the dial puts it, and
// this says whether the child needs either of them offered rather than merely available.
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
 *   update({ distanceMeters, objectiveId, deltaSeconds }) -> { offering, secondsStuck, bestMeters }
 *   accept()   the child took the help. Silent until they get genuinely stuck again.
 *   dismiss()  the child waved it away. Same, and deliberately not a shorter fuse: someone who has
 *              just said no is the last person to ask again sooner.
 *   reset()    start over, for a caller that knows something this cannot see.
 */
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

  function startFresh(objectiveId, distanceMeters) {
    watchingObjectiveId = objectiveId;
    bestMeters = Number.isFinite(distanceMeters) ? distanceMeters : Infinity;
    secondsStuck = 0;
    offering = false;
    answered = false;
  }

  function update({ distanceMeters, objectiveId = null, deltaSeconds = 0 }) {
    // A NEW OBJECTIVE IS A NEW QUESTION. Carrying the old one's stuck clock across would offer help
    // for the previous errand the instant a child finishes it -- the moment they are least lost.
    //
    // It falls THROUGH rather than returning, so this frame's delta is counted like any other. An
    // early version returned here, which made the first sample of every objective free and left
    // "twelve seconds of patience" meaning twelve seconds sometimes and thirteen samples other
    // times, depending on whether the caller had just switched. One frame is nothing; a rule that
    // means two things is not.
    if (objectiveId !== watchingObjectiveId) startFresh(objectiveId, distanceMeters);

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

    secondsStuck += Math.max(0, deltaSeconds);
    offering = !answered && secondsStuck >= patienceSeconds;
    return { offering, secondsStuck, bestMeters };
  }

  return {
    update,
    accept() { answered = true; offering = false; },
    dismiss() { answered = true; offering = false; },
    reset() { startFresh(watchingObjectiveId, Infinity); },
    /** For a harness: observable without being able to drive it, the same posture main.js's runtime
     *  object takes toward the rules. */
    debugState: () => ({ offering, secondsStuck, bestMeters, answered, watchingObjectiveId }),
  };
}
