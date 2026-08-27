import { RUN_DEFLECTION } from '../character/speed.js';
import { isInStickRegion } from './cameraGesture.js';

// Grown from 56 alongside the enlarged stick REGION (cameraGesture.js's STICK_REGION_*_FRACTION):
// the second child playtest's own report was that the stick felt small under a real thumb once it
// could appear anywhere in the bigger region, not only in a small marked circle a kid had trained on.
// The ring/knob are re-measured off this constant everywhere they are drawn (renderKnob and
// index.html's #touch-stick, which still measures the RESTING marker's size independently -- see its
// own comment), so raising it here is the one edit that keeps them in sync.
export const STICK_RADIUS_PX = 64;
// Deflection past which the stick means "run". Touch previously hardcoded run: false, so the run
// clip could not be reached on the iPad at all.
//
// RE-EXPORTED, not declared: the value moved into character/speed.js on 2026-08-15 because the speed
// curve itself now needs it (see groundSpeedForInput), and speed.js may not import anything, so it
// has to be the owner. This name stays so the existing callers and tests keep one import site --
// the same shape locomotion.js already uses to re-export the speed law.
export const TOUCH_RUN_DEFLECTION = RUN_DEFLECTION;

export function clampStick(deltaX, deltaY, radius = STICK_RADIUS_PX) {
  const distance = Math.hypot(deltaX, deltaY);
  const scale = distance > radius ? radius / distance : 1;
  const x = (deltaX * scale) / radius;
  const y = (-deltaY * scale) / radius;
  return {
    x: x === 0 ? 0 : x,
    y: y === 0 ? 0 : y,
  };
}

// `surface` is the whole game surface, not the visible ring. The stick claims a touch anywhere in the
// lower-left region and re-centres itself under the thumb, so a child does not have to find a 112px
// circle; everything outside that region belongs to the camera.
export function createTouchInput(surface, ring, knob, gestureTarget = window) {
  let pointerId = null;
  let origin = { x: 0, y: 0 };
  let screen = { x: 0, y: 0 };

  surface.style.touchAction = 'none';
  surface.style.userSelect = 'none';
  surface.style.webkitUserSelect = 'none';

  function renderKnob() {
    knob.style.transform = `translate(calc(-50% + ${screen.x * STICK_RADIUS_PX}px), calc(-50% - ${screen.y * STICK_RADIUS_PX}px))`;
    // THE STICK SAYS WHEN YOU ARE RUNNING. The other half of the movement fix: lowering the
    // threshold puts a run within reach of a young player's thumb, and this is what tells him it
    // is there. Nothing in the game said so before -- the only feedback for crossing into a run was
    // the hero going faster, which you cannot notice if you never crossed. The ring brightens and
    // the knob swells under the thumb that is already there and already being looked at, which is
    // the same reasoning combat/feedback.js gives for pulsing the ATTACK button on a miss.
    //
    // Keyed on the STICK's own run band, not on the run CLIP. Those are not quite the same line:
    // speed.js hands back WALK_SPEED at this deflection and only reaches RUN_THRESHOLD (and so the
    // run animation) around 0.78, so between 0.62 and 0.78 the ring is lit while the hero is still
    // playing a fast walk. That is deliberate and it is the right way round for a young player:
    // this cue's job is "push further and you go faster", which becomes true the moment the band is
    // entered, and putting the cue where the CLIP changes would move it back to almost exactly the
    // 0.85 that younger players never reached.
    const running = Math.hypot(screen.x, screen.y) >= TOUCH_RUN_DEFLECTION;
    if (running) ring.dataset.run = 'true';
    else delete ring.dataset.run;
  }

  function moveRingTo(x, y) {
    ring.style.left = `${x - STICK_RADIUS_PX}px`;
    ring.style.top = `${y - STICK_RADIUS_PX}px`;
    ring.style.bottom = 'auto';
  }

  function restoreRing() {
    ring.style.left = '';
    ring.style.top = '';
    ring.style.bottom = '';
  }

  function clearMovement() {
    pointerId = null;
    screen = { x: 0, y: 0 };
    renderKnob();
    restoreRing();
  }

  // The camera gesture asks this before adopting a pointer, so one touch can never both drive the
  // hero and turn the view.
  function ownsPointer(event) {
    if (event.pointerId === pointerId) return true;
    // The stick only ever adopts touch and pen, so claiming a mouse in the region would leave a dead
    // rectangle where desktop drag-to-turn silently stops working.
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return false;
    if (pointerId !== null) return false;
    return isInStickRegion(
      event.clientX,
      event.clientY,
      surface.clientWidth,
      surface.clientHeight,
    );
  }

  function onPointerDown(event) {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if (pointerId !== null) return;
    if (!isInStickRegion(event.clientX, event.clientY, surface.clientWidth, surface.clientHeight)) {
      return;
    }
    event.preventDefault();
    // No double-tap guard. It was inherited from eldoria-3d's iOS pinch diagnosis, but the actual
    // fixes for that are `touch-action: none` on every thumb surface plus the gesture* handlers
    // below -- both still in force, and both suppress Safari's zoom without discarding input.
    // Dropping the second tap defended nothing and cost a live stick: measured in the touch harness,
    // two pointerdowns 42ms apart left the stick at touchActive=false, speed=0.00, which is a child
    // jabbing the stick and getting a hero that will not move.
    pointerId = event.pointerId;
    origin = { x: event.clientX, y: event.clientY };
    surface.setPointerCapture?.(pointerId);
    screen = { x: 0, y: 0 };
    moveRingTo(event.clientX, event.clientY);
    renderKnob();
  }

  function onPointerMove(event) {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    screen = clampStick(event.clientX - origin.x, event.clientY - origin.y);
    renderKnob();
  }

  function onPointerEnd(event) {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    surface.releasePointerCapture?.(pointerId);
    clearMovement();
  }

  function preventSafariGesture(event) {
    event.preventDefault();
  }

  surface.addEventListener('pointerdown', onPointerDown, { passive: false });
  surface.addEventListener('pointermove', onPointerMove, { passive: false });
  surface.addEventListener('pointerup', onPointerEnd, { passive: false });
  surface.addEventListener('pointercancel', onPointerEnd, { passive: false });
  for (const gesture of ['gesturestart', 'gesturechange', 'gestureend']) {
    gestureTarget.addEventListener(gesture, preventSafariGesture, { passive: false });
  }

  return {
    ownsPointer,
    read() {
      return {
        active: pointerId !== null,
        run: Math.hypot(screen.x, screen.y) >= TOUCH_RUN_DEFLECTION,
        screen: { ...screen },
      };
    },
    dispose() {
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerEnd);
      surface.removeEventListener('pointercancel', onPointerEnd);
      for (const gesture of ['gesturestart', 'gesturechange', 'gestureend']) {
        gestureTarget.removeEventListener(gesture, preventSafariGesture);
      }
      clearMovement();
    },
  };
}
