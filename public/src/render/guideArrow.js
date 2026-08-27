// public/src/render/guideArrow.js
//
// ONE ANSWER FOR THE WHOLE ON-SCREEN/OFF-SCREEN QUESTION, because main.js used to have two: an arrow
// that showed itself whenever the target was off screen (ui/offscreenPointer.js) and nothing at all
// when it was on screen. The playtest finding this file exists for is blunt -- "need much clearer
// arrows and dotted paths on where to go next... they should basically always be there" -- and a
// system that goes silent the moment the target scrolls into frame is not "always there", it is
// "there until it would actually help you confirm you are looking at the right thing". A child who
// glances at a lit street lantern still needs to know THAT is the one the game means.
//
// So this is the three-way switch the whole guidance HUD reads off: 'hidden' (nothing to point at),
// 'edge' (point at it, off screen), 'onscreen' (mark it, on screen). One function, driven by the
// same projected NDC main.js already computes for the old arrow-only path, so a caller cannot get an
// arrow and a marker disagreeing about which one the moment demands -- the same "one branch, not two
// hand-kept copies of it" discipline world/quest.js's own header explains at length (GQ-011).
//
// DELIBERATELY THIN: the actual off-screen projection maths -- the perspective-divide mirroring trap
// for a point behind the camera, the pixel-space bearing so a tall viewport does not skew the angle,
// the inset-rectangle clamp -- already exists, is already unit tested, and is reused rather than
// retyped. See ui/offscreenPointer.js's own header for why that maths is worth being careful about.
// This file adds exactly two things offscreenPointer.js cannot know on its own: the THIRD outcome
// (no target at all, distinct from "target exists and happens to be on screen"), and the distance in
// real metres, which needs the two world-space positions rather than only the projected ones.
//
// Pure, like offscreenPointer.js: no three.js import, so this tests with plain node and a camera is
// never needed to prove the branch is right.

import { DEFAULT_EDGE_MARGIN_PX, edgeIndicatorFor } from '../ui/offscreenPointer.js';

/**
 * How close counts as "basically there". Below this the child is standing next to the thing the
 * arrow would point at or the marker would sit over, and an indicator insisting they keep looking at
 * it is nagging rather than helping -- the same call render/guidePath.js makes for the ground trail,
 * and the same NUMBER, because a hero who has stopped needing the dotted path has, for the same
 * reason, stopped needing the arrow or the marker. Exported so guidePath.js imports this rather than
 * retyping it (GQ-007): the day someone tunes "close enough" they should have to tune it once.
 */
export const GUIDE_NEAR_METERS = 3;

/**
 * @param hasTarget   whether there is anywhere to point at all -- false for a null objective, a
 *   placeless one ("cut the bramble in front of you"), or a dynamic one the caller could not resolve
 *   this frame. Required rather than inferred from `targetX`/`targetZ` being present: a caller
 *   passing NaN by accident must not silently read as "no target" and go quiet.
 * @param ndcX,ndcY      what `Vector3.project(camera)` returned for the target, -1..1, +y UP.
 * @param behindCamera   whether the target is behind the camera plane. Passed through to
 *   edgeIndicatorFor unmodified -- see that file's header for why this cannot be inferred from the
 *   NDC alone and must be computed by the caller from the sign of the camera-space depth.
 * @param width,height   the overlay size in CSS pixels.
 * @param heroX,heroZ    where the child is standing, world metres.
 * @param targetX,targetZ where the objective is, world metres.
 * @param marginPx       how far in from the edge an off-screen indicator sits.
 *
 * @returns { mode, x, y, angle, meters }
 *   mode    'hidden'   nothing to show -- no HUD element should be visible.
 *           'edge'     draw an arrow at (x, y) rotated by `angle` radians (CSS `rotate()` ready,
 *                      the same +y-down convention edgeIndicatorFor already documents).
 *           'onscreen' draw a marker at (x, y) -- the target's own projected pixel position, so a
 *                      caller floats it a fixed offset above that point rather than needing to know
 *                      anything about the world.
 *   x, y    overlay pixels. 0 for 'hidden', where they are not meaningful.
 *   angle   radians for 'edge'; null otherwise -- null rather than 0, so a caller cannot mistake "no
 *           bearing" for "pointing right" the way edgeIndicatorFor's own doc already warns about.
 *   meters  the real distance, or null when there is no target to measure to. Unrounded -- rounding
 *           is a presentation choice, and formatGuideMeters below is where it happens.
 */
export function guideArrowFor({
  hasTarget,
  ndcX,
  ndcY,
  behindCamera,
  width,
  height,
  heroX,
  heroZ,
  targetX,
  targetZ,
  marginPx = DEFAULT_EDGE_MARGIN_PX,
}) {
  if (!hasTarget) return { mode: 'hidden', x: 0, y: 0, angle: null, meters: null };

  const meters = Math.hypot(targetX - heroX, targetZ - heroZ);
  // ARRIVED. The same threshold and the same reasoning ui/guidanceRescue.js's whole header is built
  // from applies here in miniature: a child standing on top of the objective does not need to be
  // told which way it is.
  if (Number.isFinite(meters) && meters <= GUIDE_NEAR_METERS) {
    return { mode: 'hidden', x: 0, y: 0, angle: null, meters };
  }

  const indicator = edgeIndicatorFor({ ndcX, ndcY, behindCamera, width, height, marginPx });
  if (indicator.onScreen) {
    return { mode: 'onscreen', x: indicator.x, y: indicator.y, angle: null, meters };
  }
  return { mode: 'edge', x: indicator.x, y: indicator.y, angle: indicator.angle, meters };
}

/**
 * The distance readout's own words -- "23m", never "23.4m" or "23 m" with a space. A child reading
 * this at a glance is reading a HUD number, not a measurement; the whole-metre rounding and the
 * tight unit are the same "reads at a glance" rule world/quest.js's own header states for the
 * objective chip, applied to a number instead of a sentence. Negative and non-finite input (no
 * target, or a caller's arithmetic gone wrong) come back as an empty string rather than "NaNm" or
 * "-3m" leaking onto a child's screen -- the same defensive posture quest.js takes toward a bad mark
 * count.
 */
export function formatGuideMeters(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '';
  return `${Math.round(meters)}m`;
}
