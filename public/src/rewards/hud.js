// The pure translation from a mark count to filled/empty pips -- combat/feedback.js's heartsForHp,
// copied in shape rather than imported, because this module lives outside public/src/combat/ on
// purpose (see rewards/marks.js's header) and heartsForHp is scoped to HERO_MAX_HP hearts, not
// MARKS_TO_UNLOCK pips. No DOM, no three.js: main.js is the only place this ever meets a <span>.

import { MARKS_TO_UNLOCK } from './marks.js';

/**
 * Filled/empty lantern-mark pips for a mark total, lowest index first. Clamped at both ends the
 * same way heartsForHp is, so a caller can pass a mid-frame or over-max value without checking
 * first.
 */
export function pipsForMarks(marks, maxMarks = MARKS_TO_UNLOCK) {
  const filled = Math.max(0, Math.min(maxMarks, Math.round(marks)));
  return Array.from({ length: maxMarks }, (_, index) => index < filled);
}
