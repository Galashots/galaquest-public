// The one sentence the game never said.
//
// Measured against the real rules, driving stepEncounter for sixty seconds:
//
//   a child who freezes and never swings   7 knockouts, 14.1 s on the ground, wolf untouched
//   a child who freezes and MASHES attack  wolf dead in 3.85 s, no knockouts, full health
//   a child who walks away                 escapes cleanly
//
// The entire distance between "stuck forever" and "won in four seconds" is whether the child
// discovered the ATTACK button. **Nothing in the game has ever mentioned it.** Not the Keeper, who
// says "The wolves out there are carrying its light! Bring me three Lantern Marks" and never says
// how; not a banner; not a hint. An exhaustive search for coaching text found none.
//
// So the defect the Checkpoint 0 audit called a combat hurt-loop is, measured, a TEACHING failure
// wearing a combat costume. The loop is real -- knocked down every ~8.5 seconds, making no progress
// forever -- but it is not a balance problem, because the fight is trivially winnable and trivially
// escapable. It is only unwinnable for a child who does not know the verb.
//
// LIVES IN ui/ RATHER THAN combat/, and that was not my first guess. It went in combat/ because the
// defect is a combat one, and test/combat-purity.test.mjs immediately failed it: combat/ may not
// import outside itself, and this needs input/pointerMode.js to know which control to name. The
// guard was right and the placement was wrong -- this decides what a child READS, which is a UI
// question about a combat situation, not a rule of the fight. The rules do not know there is a
// screen.
//
// SAID ONCE, on the first bite. Not on a timer and not repeated: a child who has been told and is
// now fighting does not need telling again, and a game that repeats itself is a game they stop
// reading. The first bite is the moment they know something is happening and the moment the
// sentence is about them, rather than a tooltip fired at a child who was doing fine.

import { POINTER_MODE_MOUSE } from '../input/pointerMode.js';

/** What a thumb does. */
export const COACH_TAP_TO_FIGHT = '🗡️ Tap ATTACK to fight back!';
/** What a keyboard does -- the ATTACK button is not on screen for a device with no touch, so naming
 *  it there would point at nothing. input/pointerMode.js owns which device is which. */
export const COACH_PRESS_TO_FIGHT = '🗡️ Press Space to fight back!';

/**
 * @param pointerMode one of input/pointerMode.js's two values.
 * @returns the line to show, naming a control the child can actually see.
 */
export function firstHurtCoachingLine(pointerMode) {
  return pointerMode === POINTER_MODE_MOUSE ? COACH_PRESS_TO_FIGHT : COACH_TAP_TO_FIGHT;
}
