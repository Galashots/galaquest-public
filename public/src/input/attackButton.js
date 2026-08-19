/**
 * The primary action control: one big button under the right thumb.
 *
 * Placement follows Microsoft's touch-layout guidance, which was written from over 200 streamed
 * titles: the left inner wheel is locomotion, and the right inner wheel is reserved for exactly ONE
 * control -- the most frequently used action -- kept out near the grip, because a thumb cannot reach
 * far toward the middle of the screen. Our stick already owns the lower left, so attack mirrors it
 * in the lower right at the same size.
 *
 * It reports edges, not levels. `takeAttack()` returns true once per press, so holding the button
 * down does not queue a swing every frame; the rate limit still lives in encounter.js, which is the
 * only place that knows what a swing costs.
 */
export function createAttackInput(button) {
  let pressedPointerId = null;
  let pending = false;

  function press(event) {
    // Only the first finger down counts. A second thumb landing on the button while the first is
    // still held must not fire a second swing.
    if (pressedPointerId !== null) return;
    event.preventDefault();
    pressedPointerId = event.pointerId;
    button.setPointerCapture?.(event.pointerId);
    button.dataset.pressed = 'true';
    pending = true;
  }

  function release(event) {
    if (event.pointerId !== pressedPointerId) return;
    event.preventDefault();
    button.releasePointerCapture?.(pressedPointerId);
    pressedPointerId = null;
    button.dataset.pressed = 'false';
  }

  button.addEventListener('pointerdown', press, { passive: false });
  button.addEventListener('pointerup', release, { passive: false });
  button.addEventListener('pointercancel', release, { passive: false });
  // Safari fires a synthetic click after a touch. Swallow it, or every tap counts twice.
  button.addEventListener('click', (event) => event.preventDefault());

  return {
    /** The camera gesture asks this before adopting a pointer, exactly as it does for the stick. */
    ownsPointer(event) {
      if (event.pointerId === pressedPointerId) return true;
      return event.target === button || button.contains(event.target);
    },
    /** True once per press. Clears itself, so a held button is one swing. */
    takeAttack() {
      if (!pending) return false;
      pending = false;
      return true;
    },
    /** Grey the button while the swing is on cooldown, so a mashed button reads as "not yet". */
    setReady(ready) {
      button.dataset.ready = ready ? 'true' : 'false';
    },
    dispose() {
      button.removeEventListener('pointerdown', press);
      button.removeEventListener('pointerup', release);
      button.removeEventListener('pointercancel', release);
    },
  };
}
