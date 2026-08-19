import * as THREE from '../../vendor/three.module.min.js';
import { screenToWorld } from './rotation.js';

export { screenToWorld };

// Orbit limits. Pitch is measured from horizontal, positive looking down at the hero.
export const MIN_PITCH = 0.05;
export const MAX_PITCH = 1.15;
export const MIN_DISTANCE = 1.6;
// 18, not 8, so the design's playing-distance framing is reachable at all. Measured: the hero is
// 1.500 units tall, and at a 42 degree vertical FOV he stands 422 CSS px tall on an 820-tall iPad at
// distance 3.8, and still 200 px at distance 8. The art contract is calibrated for ~87-107 CSS px on
// that 820-tall reference -- the same fraction of screen height (10.6%-13.1%) is 109-134 px on this
// repo's own established 1024-tall harness viewport (tools/runtime-test's VIEWPORT), which is the
// number that actually matters since that is what every capture in this repo is taken at.
export const MAX_DISTANCE = 18;
export const DEFAULT_PITCH = 0.3;
// Phase Y/Task B, measured 2026-08-14: tools/runtime-test/drive-village.mjs captured the same
// spawn-facing-tree establishing shot at 12/14/16/18 (same heading/pitch/viewport, only distance
// varied) and every capture was opened and judged, not chosen from the arithmetic alone. 18 was
// disqualified outright -- the wolf itself enters the bottom of frame from spawn at that distance,
// directly against this task's own "wolf/wilderness does not become the visual focus" criterion.
// 16 lands the hero at a measured 125 px (12.2% of the 1024-tall viewport), inside the rescaled
// 10.6%-13.1% target band, with only a wilderness rock's tip at the frame edge (no wolf), the
// Lantern Tree fully readable, both houses and the fence in frame, and the keeper findable beside
// the tree without dominating it. 12 and 14 read closer to the old inspection framing (166.7 px and
// 142.9 px respectively -- above the target band) and were not chosen. See
// the private engineering archive for the four captures this measured
// against (village-camera-12/14/16/18.png).
export const DEFAULT_DISTANCE = 16;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createFollowCamera(camera, options = {}) {
  const targetHeight = options.targetHeight ?? 0.7;
  let distance = clamp(options.distance ?? DEFAULT_DISTANCE, MIN_DISTANCE, MAX_DISTANCE);
  let pitch = clamp(options.pitch ?? DEFAULT_PITCH, MIN_PITCH, MAX_PITCH);
  let heading = options.heading ?? 0;
  const target = new THREE.Vector3();

  return {
    get heading() {
      return heading;
    },
    get pitch() {
      return pitch;
    },
    get distance() {
      return distance;
    },
    setHeading(nextHeading) {
      heading = nextHeading;
    },
    // Camera heading is NOT re-aimed when the hero moves. That is deliberate and matches Roblox:
    // the player owns the camera, and movement is interpreted relative to wherever they left it.
    orbit(yawDelta, pitchDelta) {
      heading += yawDelta;
      pitch = clamp(pitch + pitchDelta, MIN_PITCH, MAX_PITCH);
    },
    zoomBy(factor) {
      distance = clamp(distance * factor, MIN_DISTANCE, MAX_DISTANCE);
    },
    setDistance(nextDistance) {
      distance = clamp(nextDistance, MIN_DISTANCE, MAX_DISTANCE);
    },
    screenToWorld(screen) {
      return screenToWorld(screen, heading);
    },
    update(targetPosition) {
      target.copy(targetPosition);
      // Pitch only shortens the horizontal reach and lifts the camera, so the ground projection of
      // the camera basis stays a pure function of heading -- which is what keeps screenToWorld planar.
      const horizontal = Math.cos(pitch) * distance;
      camera.position.set(
        target.x - Math.sin(heading) * horizontal,
        target.y + targetHeight + Math.sin(pitch) * distance,
        target.z - Math.cos(heading) * horizontal,
      );
      camera.lookAt(target.x, target.y + targetHeight, target.z);
    },
  };
}
