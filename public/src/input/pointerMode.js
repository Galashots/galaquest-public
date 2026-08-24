// Whether this device has a thumb, or a mouse and a keyboard.
//
// The game ships a 112 px virtual stick and an ATTACK button unconditionally, on every device. On a
// desktop that is a large, obvious control that does nothing: input/touch.js listens for touch
// events, so a click never drives it, and the click falls through to the camera drag underneath --
// the player pushes the joystick and the world spins. A visible control that lies is worse than no
// control, and the Checkpoint 0 audit flagged it alongside the fact that NOTHING on screen has ever
// said the words WASD, Space, drag or scroll.
//
// THE RULE IS DELIBERATELY CONSERVATIVE, and the asymmetry is the point. A touchscreen laptop
// reports touch points and may still be driven with a mouse; showing it the stick is what happens
// today and costs that player a corner of the screen. Hiding the stick from someone who needs it
// costs them the game. So anything that reports even one touch point keeps the stick, and only a
// device that reports NONE is treated as mouse-and-keyboard.
//
// `navigator.maxTouchPoints` rather than a `(pointer: coarse)` media query, and that is measured
// rather than assumed: headless Chrome reports `(pointer: coarse)` false AND `(pointer: fine)` false
// -- no pointer at all -- so a media query would have decided this differently in CI than on a real
// machine, which is the worst possible property for a rule that hides controls. maxTouchPoints is
// also exactly what CDP's Emulation.setTouchEmulationEnabled sets, and all sixteen harnesses that
// drive the stick enable it, so they all keep the controls they reach for.

/** The device has a thumb: show the stick and the ATTACK button. */
export const POINTER_MODE_TOUCH = 'touch';
/** No touch at all: hide them, and say what the keys are instead. */
export const POINTER_MODE_MOUSE = 'mouse';

/**
 * @param maxTouchPoints  navigator.maxTouchPoints, or anything non-numeric when it cannot be read.
 * @returns POINTER_MODE_TOUCH | POINTER_MODE_MOUSE
 *
 * An unreadable value returns TOUCH, for the same asymmetry as above: not knowing is not a reason
 * to take a child's only controls away.
 */
export function pointerModeFor(maxTouchPoints) {
  if (!Number.isFinite(maxTouchPoints)) return POINTER_MODE_TOUCH;
  return maxTouchPoints > 0 ? POINTER_MODE_TOUCH : POINTER_MODE_MOUSE;
}
