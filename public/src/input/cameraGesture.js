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

// The movement stick owns the lower-left of the screen, deliberately smaller than a quadrant: the
// owner's words were "the lower left area... I don't wanna say quadrant because it's not the full
// quadrant". Everything outside it is camera.
export const STICK_REGION_WIDTH_FRACTION = 0.4;
export const STICK_REGION_HEIGHT_FRACTION = 0.4;

export function isInStickRegion(x, y, width, height) {
  return x <= width * STICK_REGION_WIDTH_FRACTION
    && y >= height * (1 - STICK_REGION_HEIGHT_FRACTION);
}

export function orbitDeltaForDrag(dx, dy) {
  // Drag right turns the view right; drag up raises the camera so it looks further down at the hero.
  // If that reads backwards on the device it is these two signs and nothing else.
  return { yaw: dx * YAW_RADIANS_PER_PX, pitch: -dy * PITCH_RADIANS_PER_PX };
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
    if (isStickPointer(event)) return;
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
