// How big a thing has to be before a child can reliably hit it.
//
// This is a product law with a number attached, and the number was written down in three places
// before this file existed: `TAP_TARGET_FLOOR_PX = 44` in one harness, a bare `44` in another, and
// English prose in index.html's own CSS comments. GQ-007 -- one rule, several implementations, and
// nothing that makes them agree. The floor lives here now and everything that enforces it imports
// it, so raising it is one edit rather than a search.
//
// WHY 44. It is the platform accessibility floor on both tablet platforms, and it is roughly a
// centimetre, which is about the accuracy of a five-year-old's aim. The Checkpoint 0 audit found
// exactly two controls in the game beneath it -- both ✕ close buttons at 36 px, both on overlays a
// child has to dismiss to get back to playing. A control you cannot close is a control that traps
// you, and being trapped in a menu is indistinguishable from the game being broken.
//
// WHAT IT IS NOT: a rule about how big things should LOOK. The glyph inside a close button is
// readable at 1rem; what has to reach 44 px is the region a thumb can land in.

/** The floor, in CSS pixels. */
export const TAP_TARGET_FLOOR_PX = 44;

/**
 * Sub-pixel slack, and the reason it exists rather than a strict comparison.
 *
 * A real 44 px button measures 44 exactly, but layout that involves a border, a transform or a
 * fractional device pixel ratio can hand back 43.999998 from getBoundingClientRect. Failing that is
 * testing IEEE-754 and the browser's layout rounding, not testing whether a child can hit the
 * button. A twentieth of a pixel is far below the thing this rule is actually about.
 */
export const MEASUREMENT_SLACK_PX = 0.05;

/**
 * Which of these measured targets a child cannot reliably hit.
 *
 * @param targets  [{ label, width, height, visible? }] -- `visible: false` is skipped, because a
 *   control that is not on screen has no tap target to be too small. Absent means visible: a caller
 *   that does not track visibility should not have its targets silently ignored.
 * @param floorPx  overridable so a test can prove the rule reacts to the floor rather than to 44.
 *
 * @returns the offenders, each carrying `shortBy` so a failure message can say how far off it is.
 *   A list rather than a boolean: "something is too small" is not an actionable failure.
 */
export function undersizedTargets(targets, floorPx = TAP_TARGET_FLOOR_PX) {
  const offenders = [];
  for (const target of targets) {
    if (target.visible === false) continue;
    const smallest = Math.min(target.width, target.height);
    if (smallest >= floorPx - MEASUREMENT_SLACK_PX) continue;
    offenders.push({ ...target, smallest, shortBy: Number((floorPx - smallest).toFixed(2)) });
  }
  return offenders;
}

/** One line a human can act on, for a harness check's detail field or a test's message. */
export function describeUndersized(offenders) {
  return offenders
    .map((o) => `${o.label} is ${o.smallest}px (${o.shortBy}px under the ${TAP_TARGET_FLOOR_PX}px floor)`)
    .join('; ');
}
