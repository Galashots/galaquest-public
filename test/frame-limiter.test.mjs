import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createFrameLimiter, MAX_FPS } from '../public/src/render/renderer.js';

// Feed the limiter a display's vsync timestamps and count how many it lets through. The original
// limiter compared against the frame interval exactly, which at a true 60Hz rejected roughly one
// vsync in three and turned a 60fps cap into ~40fps. Percentages, not a threshold on fps, because
// what matters is whether the limiter drops frames the display was ready to show.
function presentedRatio(vsyncAt, frames = 600) {
  const limiter = createFrameLimiter();
  let presented = 0;
  for (let i = 0; i < frames; i += 1) {
    if (limiter.shouldRender(vsyncAt(i))) presented += 1;
  }
  return presented / frames;
}

test('a 60Hz display presents every vsync', () => {
  const exact = presentedRatio((i) => i * (1000 / 60));
  const quantized = presentedRatio((i) => Math.round(i * (1000 / 60) * 10) / 10);
  const jittered = presentedRatio((i) => i * (1000 / 60) + (((i * 2654435761) % 97) / 97 - 0.5) * 0.3);

  assert.ok(exact > 0.99, `exact 60Hz presented ${(exact * 100).toFixed(1)}% of vsyncs`);
  assert.ok(quantized > 0.99, `quantized 60Hz presented ${(quantized * 100).toFixed(1)}% of vsyncs`);
  assert.ok(jittered > 0.99, `jittered 60Hz presented ${(jittered * 100).toFixed(1)}% of vsyncs`);
});

test('a 120Hz display is capped to every second vsync, not every third', () => {
  const ratio = presentedRatio((i) => i * (1000 / 120));
  assert.ok(
    Math.abs(ratio - 0.5) < 0.02,
    `120Hz presented ${(ratio * 100).toFixed(1)}% of vsyncs; expected ~50% (60fps)`,
  );
});

test('the cap is 60', () => {
  assert.equal(MAX_FPS, 60);
});
