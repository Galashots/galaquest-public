// Camera control on touch, copying Roblox's mobile scheme: the lower-left area is the movement stick,
// one finger anywhere else turns the camera, two fingers pinch to zoom.
//
// The pinch is tracked from raw pointer events on purpose. eldoria-3d's diagnosed iOS trap was that a
// second thumb let Safari claim a *native* pinch and fire pointercancel on the movement stick. The fix
// there was `touch-action: none` plus preventDefault on Safari's proprietary gesture* events, and both
// are still in force -- see input/touch.js. Those suppress Safari's zoom without suppressing pointer
// events, so we can implement our own pinch on top of them. Suppressing the native gesture is what
// makes our pinch safe, not what prevents it.

export const YAW_RADIANS_PER_PX = 0.006;
export const PITCH_RADIANS_PER_PX = 0.004;
export const WHEEL_ZOOM_PER_NOTCH = 0.0015;
// A drag has to travel this far before it counts as a camera turn, so a tap meant for something else
// does not nudge the view.
export const DRAG_DEADZONE_PX = 4;

// The movement stick owns the lower-left of the screen -- big enough that the stick appears wherever
// a kid's thumb actually lands, the way Roblox's own mobile scheme does, rather than a kid having to
// find a small fixed circle first. Grown from 0.4/0.4 after the second child playtest: two children
// missed the old region often enough (a thumb landing a little high, or a little right, got no stick
// at all) that "smaller than a quadrant" cost more control than it protected. Still short of the full
// lower-left quadrant (0.5/0.5) on both axes, and specifically short of the bottom-right corner on the
// width axis, so the attack button's own corner is never claimed by the stick.
export const STICK_REGION_WIDTH_FRACTION = 0.45;
export const STICK_REGION_HEIGHT_FRACTION = 0.55;

export function isInStickRegion(x, y, width, height) {
  return x <= width * STICK_REGION_WIDTH_FRACTION
    && y >= height * (1 - STICK_REGION_HEIGHT_FRACTION);
}

export function orbitDeltaForDrag(dx, dy) {
  // Drag right turns the view left; drag up lowers the camera so it looks less down at the hero.
  return { yaw: -dx * YAW_RADIANS_PER_PX, pitch: dy * PITCH_RADIANS_PER_PX };
}

export function pinchSeparation(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Spreading the fingers apart pulls the camera in, which is the direction every map and photo app
// has already taught these kids.
export function zoomFactorForPinch(startSeparation, currentSeparation) {
  if (!(startSeparation > 0) || !(currentSeparation > 0)) return 1;
  return startSeparation / currentSeparation;
}

// THE UN-CLOSEABLE MENU CLASS OF BUG. The playtest's own report: the Hero screen and the Village
// Board could not be closed on a real iPad, and the family had to kill the app. This module's ONLY
// veto used to be isStickPointer -- so any other pointerdown on #game, including one on a full-screen
// overlay's own X button, was adopted as a camera-drag (or, while the Hero screen is open, a
// Hero-preview-turntable-drag) candidate. A tap always has a little natural finger travel, and once
// that travel crosses DRAG_DEADZONE_PX the world/preview spins UNDERNEATH the very button a child is
// trying to press -- main.js already worked around this one leaf button at a time before this
// existed (keeperSpeechSpeakElement and workshopInteractElement both carry their own
// `pointerdown -> event.stopPropagation()`, with a comment explaining exactly this), which means
// every NEW button had to remember the same line or inherit the same trap. hero-screen-close and
// village-board-close did not.
//
// Fixed here, once, generically: this module now refuses to adopt a pointer that landed on any
// native interactive control, or inside a UI surface tagged [data-thumb-surface]/[data-ui-surface].
// [data-ui-surface] is stamped on an overlay's ROOT (#hero-screen, #village-board-screen,
// #profile-gate in index.html), not on each piece of its chrome -- closest() still finds it from any
// descendant that actually received the event. The overlay's own deliberately click-through middle
// (index.html's own comment on #hero-screen: dragging the empty centre turns the Hero preview's
// turntable) is untouched by this, because pointer-events: none there means the DOM target of that
// tap was never inside the overlay's root in the first place -- it lands on #game/the canvas, same
// as it always did.
export function isInteractiveUiTarget(event) {
  const target = event?.target;
  if (!target || typeof target.closest !== 'function') return false;
  return target.closest(
    'button, input, textarea, select, a, label, [data-thumb-surface], [data-ui-surface]',
  ) !== null;
}

export function createCameraGesture(surface, follow, options = {}) {
  const isStickPointer = options.isStickPointer ?? (() => false);
  const pointers = new Map();
  let dragPointerId = null;
  let dragFrom = { x: 0, y: 0 };
  let dragTravel = 0;
  let pinch = null;

  function livePointers() {
    return [...pointers.values()];
  }

  function beginPinch() {
    const [a, b] = livePointers();
    pinch = {
      startSeparation: pinchSeparation(a, b),
      startDistance: follow.distance,
    };
    // A pinch is not a turn. Dropping the drag here stops the view from lurching as the second
    // finger lands.
    dragPointerId = null;
  }

  function onPointerDown(event) {
    if (isStickPointer(event) || isInteractiveUiTarget(event)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2) {
      beginPinch();
      return;
    }
    if (pointers.size === 1) {
      dragPointerId = event.pointerId;
      dragFrom = { x: event.clientX, y: event.clientY };
      dragTravel = 0;
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinch && pointers.size >= 2) {
      const [a, b] = livePointers();
      const separation = pinchSeparation(a, b);
      follow.setDistance(
        pinch.startDistance * zoomFactorForPinch(pinch.startSeparation, separation),
      );
      return;
    }
    if (event.pointerId !== dragPointerId) return;

    const dx = event.clientX - dragFrom.x;
    const dy = event.clientY - dragFrom.y;
    dragTravel += Math.hypot(dx, dy);
    dragFrom = { x: event.clientX, y: event.clientY };
    if (dragTravel < DRAG_DEADZONE_PX) return;

    const delta = orbitDeltaForDrag(dx, dy);
    follow.orbit(delta.yaw, delta.pitch);
  }

  function onPointerEnd(event) {
    pointers.delete(event.pointerId);
    if (event.pointerId === dragPointerId) dragPointerId = null;
    if (pointers.size < 2) pinch = null;
    // A finger lifting out of a pinch must not silently become a turn -- the remaining finger is
    // still down but was never the drag pointer, and re-adopting it would spin the camera.
    if (pointers.size === 1 && dragPointerId === null) {
      const [only] = [...pointers.keys()];
      dragPointerId = only;
      dragFrom = { ...pointers.get(only) };
      dragTravel = 0;
    }
  }

  function onWheel(event) {
    event.preventDefault();
    follow.zoomBy(1 + event.deltaY * WHEEL_ZOOM_PER_NOTCH);
  }

  surface.addEventListener('pointerdown', onPointerDown, { passive: false });
  surface.addEventListener('pointermove', onPointerMove, { passive: false });
  surface.addEventListener('pointerup', onPointerEnd, { passive: false });
  surface.addEventListener('pointercancel', onPointerEnd, { passive: false });
  surface.addEventListener('wheel', onWheel, { passive: false });

  return {
    get state() {
      return { pointers: pointers.size, dragging: dragPointerId !== null, pinching: Boolean(pinch) };
    },
    dispose() {
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerEnd);
      surface.removeEventListener('pointercancel', onPointerEnd);
      surface.removeEventListener('wheel', onWheel);
      pointers.clear();
      pinch = null;
      dragPointerId = null;
    },
  };
}
