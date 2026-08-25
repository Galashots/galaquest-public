// The pure translation from a mark count to filled/empty pips.
//
// It was copied in SHAPE from combat/feedback.js's heartsForHp -- which no longer exists. P2 made
// max HP a per-level Hero stat, so the hero's own readout became a bar and a number
// (feedback.js's healthReadout) and the pip shape stayed HERE, where it is still right: marks are a
// small FIXED integer (MARKS_TO_UNLOCK is 3), which is exactly the case feedback.js's reference
// research says countable icons were built for. The two were never one function to share -- this
// module lives outside public/src/combat/ on purpose (see rewards/marks.js's header) -- and now they
// are not even the same kind of readout. No DOM, no three.js: main.js is the only place this ever
// meets a <span>.

import { MARKS_TO_UNLOCK } from './marks.js';

/**
 * Filled/empty lantern-mark pips for a mark total, lowest index first. Clamped at both ends the
 * same way healthReadout clamps its own inputs, so a caller can pass a mid-frame or over-max value
 * without checking first.
 */
export function pipsForMarks(marks, maxMarks = MARKS_TO_UNLOCK) {
  const filled = Math.max(0, Math.min(maxMarks, Math.round(marks)));
  return Array.from({ length: maxMarks }, (_, index) => index < filled);
}
