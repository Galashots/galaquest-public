// public/src/net/prediction.js
//
// How much simulated time one rendered frame is allowed to move the locally-predicted hero.
//
// The problem this exists to solve, measured rather than imagined. main.js clamped its frame delta
// to 0.1 s ("so a hitch cannot teleport the hero") and then integrated the hero's own position with
// that clamped value. net/gameServer.mjs clamps at 0.25 s and integrates real elapsed wall time.
// So every frame longer than 100 ms threw away movement ON THE CLIENT ONLY while the server walked
// the hero the whole distance. The two drift apart by exactly the time discarded, and once that
// exceeds net/client.js's SNAP_DRIFT_UNITS the hero is teleported forward.
//
// It is not a theoretical hitch. A single 900 ms stall with a thumb on the stick -- a texture
// upload, a shader compile, a GC pause, iOS backgrounding Safari for a moment -- discards 800 ms,
// which at walking speed is 2.2 m: over three times the snap threshold. This was first seen on CI,
// where the whole runner is ~5x slow and drive-relight.mjs's hero was dragged metres away from the
// Keeper right after arriving at him (RP1-C, commit 9081fc1).
//
// The fix is not to remove the clamp -- a 5 s catch-up in one frame really would teleport the hero
// through the wolf. It is to CARRY the unspent time forward and spend it over the following frames,
// so a slow client integrates the same total time the server did, just in smaller bites.
//
// Pure: no three.js, no DOM, no clock of its own. main.js owns the mutable backlog.

// The largest slice of time EITHER simulation integrates in one step. net/gameServer.mjs imports
// this same constant for its own tick clamp, so the agreement is structural rather than a comment
// that two files promise to keep.
//
// It was 0.1 on the client and 0.25 on the server, and that difference alone was half the defect: a
// backlog cannot rescue a client whose per-frame cap is below its own frame time, because the debt
// saturates and every frame still spends only the cap. Measured while writing this file's tests --
// a sustained 5 fps client integrated exactly 3.0 s of a 6.0 s walk both before and after the
// backlog was added, until the cap moved. At 0.25 s a sustained 5 fps client keeps up exactly, and
// the anti-teleport property survives: 0.25 s is one stride, and separateFromWolf still runs after
// every step.
export const MAX_PREDICTION_STEP_SECONDS = 0.25;

// The server stops integrating a player's intent once it is this stale (net/gameServer.mjs's
// STALE_INPUT_MS, 1000 ms, which it enforces per tick). Time beyond that was never walked by
// authority either, so catching up on it would push the prediction PAST the server rather than
// back level with it. Restated here as seconds rather than imported because gameServer.mjs is
// server-only and the browser cannot load it; test/prediction-step.test.mjs asserts the two agree.
export const MAX_PREDICTION_BACKLOG_SECONDS = 1;

/**
 * One frame's movement budget.
 *
 * @param rawDeltaSeconds  real time since the previous rendered frame, unclamped
 * @param backlogSeconds   time carried over from previous frames (0 on the first)
 * @param moving           whether the hero has any input THIS frame
 * @param wasMoving        whether the hero had input on the PREVIOUS frame
 * @param maxStepSeconds     the largest slice integrated in one frame. Defaulted; declared because
 *   it is read, and a caller building its argument from this list alone must be able to see it.
 * @param maxBacklogSeconds  how much carried-over time may accumulate before the rest is dropped.
 *   Same reasoning.
 * @returns `{ deltaSeconds, backlogSeconds }` -- how much to integrate now, and what to carry
 *
 * Two gates, and they are different questions:
 *
 * `moving: false` discards the backlog rather than banking it. The server does not move a hero with
 * zero magnitude either, so there is nothing to catch up on, and banking it would give the hero a
 * phantom lurch the moment the child next touched the stick.
 *
 * `wasMoving: false` credits NOTHING for this frame's elapsed gap, because the hero was standing
 * still for all of it -- and so was the server's copy of him. This gate was missing in the first
 * version of this module and the running game showed it immediately: after idling, the first frame
 * with a thumb on the stick spent a whole step cap at once, jumping the predicted hero 0.68 m past
 * an authority that had only just received the intent, and reconciliation snapped him straight back
 * (observed drift 0.608 m, `snapped: true`, on the very first sample of a throttled walk). Both
 * simulations start walking at the same instant; the time before that instant belongs to neither.
 */
export function predictionStep({
  rawDeltaSeconds,
  backlogSeconds = 0,
  moving = true,
  wasMoving = true,
  maxStepSeconds = MAX_PREDICTION_STEP_SECONDS,
  maxBacklogSeconds = MAX_PREDICTION_BACKLOG_SECONDS,
}) {
  const raw = rawDeltaSeconds > 0 ? rawDeltaSeconds : 0;
  if (!moving) return { deltaSeconds: Math.min(raw, maxStepSeconds), backlogSeconds: 0 };
  // Credit only the time authority also spent walking: a gap longer than the staleness window left
  // the server standing still for the remainder of it, and a gap before the thumb landed at all was
  // stationary end to end.
  const credited = wasMoving ? Math.min(raw, maxBacklogSeconds) : 0;
  const budget = Math.min(credited + backlogSeconds, maxBacklogSeconds);
  const deltaSeconds = Math.min(budget, maxStepSeconds);
  return { deltaSeconds, backlogSeconds: budget - deltaSeconds };
}
