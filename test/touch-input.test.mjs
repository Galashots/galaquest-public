import { strict as assert } from 'node:assert';
import test from 'node:test';

import { STICK_RADIUS_PX, clampStick, TOUCH_RUN_DEFLECTION } from '../public/src/input/touch.js';

test('touch stick clamps to a unit circle and preserves screen-up semantics', () => {
  assert.deepEqual(clampStick(0, 0), { x: 0, y: 0 });
  assert.deepEqual(clampStick(STICK_RADIUS_PX, 0), { x: 1, y: 0 });
  assert.deepEqual(clampStick(0, -STICK_RADIUS_PX), { x: 0, y: 1 });
  const diagonal = clampStick(100, 100);
  assert.ok(Math.hypot(diagonal.x, diagonal.y) <= 1 + 1e-12);
});

// The double-tap guard and its test were removed on 2026-08-11. It dropped the second of two taps
// inside 320ms, which left the stick dead when a child re-grabbed it -- measured in the touch
// harness at 42ms apart: touchActive=false, speed=0.00. Safari's zoom is suppressed by
// `touch-action: none` and the gesture* handlers, neither of which discards input. The replacement
// check is a live one in tools/runtime-test/drive-touch.mjs, because the property that matters is
// "the hero still moves", which a unit test on a timestamp comparison cannot see.

test('the run threshold is reachable by a thumb that has not hit the rim', () => {
  // Deflection is clamped to a unit circle, so a threshold at or above 1 would make running
  // impossible on touch; it was hardcoded unreachable once already.
  assert.ok(TOUCH_RUN_DEFLECTION < 1, `run threshold ${TOUCH_RUN_DEFLECTION} is not reachable`);
  assert.ok(TOUCH_RUN_DEFLECTION > 0.5, `run threshold ${TOUCH_RUN_DEFLECTION} is too easy to trip`);
  const nearRim = clampStick(0, -0.9 * STICK_RADIUS_PX);
  assert.ok(
    Math.hypot(nearRim.x, nearRim.y) >= TOUCH_RUN_DEFLECTION,
    'a 90% push should reach a run',
  );
});
