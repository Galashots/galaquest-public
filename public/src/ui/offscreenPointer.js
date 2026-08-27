// Where to draw an indicator for something the child cannot currently see, and which way it points.
//
// CP2 PREPARATION. Pure maths, unit tested, and deliberately not wired into anything yet: the
// checkpoint it belongs to is not open, and this half of it does not depend on the open design
// question about how an objective names its destination. Whatever answers "where is the objective",
// this answers "and where does the arrow go".
//
// It exists because Checkpoint 0 found that one thumb-drag destroys all spatial guidance with no
// recovery path: the only world marker in the game is a sprite over the Keeper, and a sprite that
// leaves the frustum simply stops being drawn. Nothing tells a child which way to turn.
//
// THE TRAP THIS FILE IS MOSTLY ABOUT. three.js's `Vector3.project(camera)` performs the perspective
// divide and DOES NOT CLIP. For a point behind the camera the clip-space w is negative, so dividing
// by it negates both axes: the point comes back mirrored through the origin, and a target directly
// behind the hero reports as being directly in front, comfortably on screen, at a perfectly
// plausible coordinate. An indicator built on the raw result is not merely wrong at the edges -- it
// confidently points a child in exactly the wrong direction, which is worse than no indicator,
// because a child who sees nothing looks around and a child who sees an arrow follows it.
//
// So `behindCamera` is a required input rather than something inferred from the NDC, because it
// CANNOT be inferred from the NDC: that is the whole nature of the defect. The caller computes it
// from the sign of the camera-space depth -- in three.js terms, the dot of (point - camera.position)
// with the camera's forward vector being negative -- and hands it in.
//
// Pixels, not NDC, on the way out: the overlay this drives is a DOM layer the size of the game
// surface, and render/screenProjection.js already owns the one conversion between the two. Reusing
// it rather than repeating the Y-flip is GQ-007, and that flip is the other thing a naive port gets
// backwards.

import { ndcToOverlayPixels } from '../render/screenProjection.js';

/** How far in from the edge the indicator sits, in CSS pixels. Far enough that the whole marker is
 *  drawn rather than half-clipped by the viewport, which is what makes it read as a thing pointing
 *  somewhere rather than as a graphical artefact at the border. */
export const DEFAULT_EDGE_MARGIN_PX = 36;

/**
 * A target that is behind the camera and lands exactly on the screen centre once mirrored has no
 * direction at all -- the vector from centre to target is zero and its angle is undefined. That is
 * reachable: it is what "the objective is directly behind you" looks like after the mirror.
 *
 * Pointing straight DOWN is the honest answer. In an overlay whose +y is downward, down is toward
 * the player's own feet -- "it is behind you, turn around" -- and it is the one direction that is
 * never a plausible on-screen heading, so it cannot be mistaken for a real bearing.
 */
const BEHIND_YOU_ANGLE_RADIANS = Math.PI / 2;

/**
 * @param options.ndcX,ndcY    what Vector3.project(camera) returned, -1..1, +y UP.
 * @param options.behindCamera whether the point is behind the camera plane. REQUIRED and not
 *   optional-with-a-default: a caller that forgets it gets the defect this file exists to prevent,
 *   and a default of `false` would make forgetting silent.
 * @param options.width,height the overlay size in CSS pixels.
 * @param options.marginPx     how far in from the edge a clamped indicator sits.
 *
 * @returns { onScreen, x, y, angle } -- pixels in the overlay's own coordinates, and `angle` in
 *   radians measured the way atan2(dy, dx) measures in a +y-down space, so it can go straight onto
 *   a CSS rotate(). `angle` is null when the target is on screen, because an indicator sitting on
 *   the thing it indicates is not pointing anywhere.
 */
export function edgeIndicatorFor({
  ndcX,
  ndcY,
  behindCamera,
  width,
  height,
  marginPx = DEFAULT_EDGE_MARGIN_PX,
}) {
  // Undo the perspective divide's sign flip. After this the NDC describes the direction the target
  // really lies in, though its magnitude is meaningless for a behind-camera point -- which is fine,
  // because everything below such a point uses only its direction.
  const x = behindCamera ? -ndcX : ndcX;
  const y = behindCamera ? -ndcY : ndcY;

  const centreX = width / 2;
  const centreY = height / 2;
  // The rectangle an off-screen indicator is pinned to. Collapses to the centre point rather than
  // inverting when the margin is wider than half the viewport -- a phone in landscape with a
  // generous margin is a real configuration and an inside-out rectangle is not.
  const halfW = Math.max(0, centreX - marginPx);
  const halfH = Math.max(0, centreY - marginPx);

  const pixels = ndcToOverlayPixels(x, y, width, height);

  // On screen means: in front of the camera, AND inside the frame. Both, because either alone is
  // the bug -- the first without the second draws an indicator over a target the child can already
  // see, and the second without the first is the mirrored-point defect in full.
  const insideFrame = x >= -1 && x <= 1 && y >= -1 && y <= 1;
  if (!behindCamera && insideFrame) {
    return { onScreen: true, x: pixels.x, y: pixels.y, angle: null };
  }

  // Off screen: pin it to the inset rectangle, along the line from the centre to where the target
  // lies. Computed in PIXELS rather than NDC so a non-square viewport does not skew the bearing --
  // the same 45 degrees in NDC is not 45 degrees on a 768x1024 screen, and the arrow has to agree
  // with what the child sees rather than with the projection's own aspect.
  let dx = pixels.x - centreX;
  let dy = pixels.y - centreY;

  if (dx === 0 && dy === 0) {
    // Directly behind, exactly. See BEHIND_YOU_ANGLE_RADIANS.
    return {
      onScreen: false,
      x: centreX,
      y: centreY + halfH,
      angle: BEHIND_YOU_ANGLE_RADIANS,
    };
  }

  const angle = Math.atan2(dy, dx);
  // Scale the direction until it touches the nearer of the two bounds. Guarding each axis against a
  // zero component keeps a perfectly horizontal or vertical bearing from producing Infinity.
  const scaleX = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);

  return {
    onScreen: false,
    x: centreX + dx * scale,
    y: centreY + dy * scale,
    angle,
  };
}
