// The rule this file exists to keep: a slow client's predicted hero must end up where the SERVER
// walked him, not short of it. Written after the running game was measured doing the opposite --
// see public/src/net/prediction.js's header for the observation and the two probe numbers.
//
// Sabotage check for each test below was done by reverting predictionStep to the old behaviour
// (`Math.min(raw, 0.1)`, no backlog): "a hitch does not lose distance" and "a slow client walks as
// far as the server" both fail, the anti-teleport and staleness tests still pass.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PREDICTION_BACKLOG_SECONDS,
  MAX_PREDICTION_STEP_SECONDS,
  predictionStep,
} from '../public/src/net/prediction.js';
import { STALE_INPUT_MS } from '../net/gameServer.mjs';

/** Total simulated time a client integrates across a sequence of real frame gaps, while moving. */
function integratedSeconds(frameGapsSeconds) {
  let backlogSeconds = 0;
  let total = 0;
  for (const rawDeltaSeconds of frameGapsSeconds) {
    const step = predictionStep({ rawDeltaSeconds, backlogSeconds, moving: true, wasMoving: true });
    backlogSeconds = step.backlogSeconds;
    total += step.deltaSeconds;
  }
  return total;
}

test('a healthy frame spends its whole delta and banks nothing', () => {
  const step = predictionStep({ rawDeltaSeconds: 1 / 60, backlogSeconds: 0, moving: true });
  assert.equal(step.deltaSeconds, 1 / 60);
  assert.equal(step.backlogSeconds, 0);
});

test('no single frame may advance the hero more than the anti-teleport cap', () => {
  for (const rawDeltaSeconds of [0.2, 0.5, 1, 30]) {
    const step = predictionStep({ rawDeltaSeconds, backlogSeconds: 0.9, moving: true });
    assert.ok(step.deltaSeconds <= MAX_PREDICTION_STEP_SECONDS,
      `${rawDeltaSeconds}s frame stepped ${step.deltaSeconds}s`);
  }
});

test('a hitch does not lose distance -- it is repaid over the frames that follow', () => {
  // One 400 ms stall, then two seconds of healthy 60 fps frames. Total wall clock 2.4 s.
  const gaps = [0.4, ...Array.from({ length: 120 }, () => 1 / 60)];
  const wallClock = gaps.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(integratedSeconds(gaps) - wallClock) < 1e-9,
    `integrated ${integratedSeconds(gaps)}s of ${wallClock}s`);
});

test('a client stuck at 5 fps still walks as far as the server does', () => {
  // 200 ms frames, held for six seconds. The old code clamped each of them to 0.1 s and integrated
  // exactly 3.0 s of the 6.0 s -- the hero fell more than a metre behind authority every second,
  // and reconciliation snapped him forward to close it.
  const gaps = Array.from({ length: 30 }, () => 0.2);
  const wallClock = 6;
  const integrated = integratedSeconds(gaps);
  assert.ok(Math.abs(integrated - wallClock) < 1e-9, `integrated ${integrated}s of ${wallClock}s`);
});

test('the prediction never runs AHEAD of the wall clock, whatever the frame pattern', () => {
  // The catch-up must only ever repay time that really elapsed. A backlog that over-credited would
  // put the predicted hero past authority, which is the same rubber-band with the sign flipped.
  const patterns = [
    Array.from({ length: 60 }, () => 1 / 60),
    [0.4, ...Array.from({ length: 60 }, () => 1 / 60)],
    Array.from({ length: 40 }, (_, i) => (i % 7 === 0 ? 0.3 : 1 / 60)),
    Array.from({ length: 20 }, () => 0.2),
  ];
  for (const gaps of patterns) {
    const wallClock = gaps.reduce((a, b) => a + b, 0);
    assert.ok(integratedSeconds(gaps) <= wallClock + 1e-9,
      `integrated ${integratedSeconds(gaps)}s of a ${wallClock}s wall clock`);
  }
});

test('time the server never walked is not credited -- the backlog stops at the staleness window', () => {
  // A backgrounded tab: one 30-second gap with the stick still held. The server stopped this hero
  // after STALE_INPUT_MS, so catching up on 30 s would shoot him across the map.
  let backlogSeconds = 0;
  let total = 0;
  const first = predictionStep({ rawDeltaSeconds: 30, backlogSeconds, moving: true });
  backlogSeconds = first.backlogSeconds;
  total += first.deltaSeconds;
  for (let i = 0; i < 600; i += 1) {
    const step = predictionStep({ rawDeltaSeconds: 1 / 60, backlogSeconds, moving: true });
    backlogSeconds = step.backlogSeconds;
    total += step.deltaSeconds;
  }
  // 1 s of catch-up plus the 10 s of real frames that followed, and not a second of the other 29.
  assert.ok(total <= MAX_PREDICTION_BACKLOG_SECONDS + 10 + 1e-9, `caught up ${total}s`);
});

test('the staleness window this module restates matches the one the server enforces', () => {
  assert.equal(MAX_PREDICTION_BACKLOG_SECONDS, STALE_INPUT_MS / 1000);
});

test('standing still discards the backlog rather than banking a lurch', () => {
  const hitched = predictionStep({ rawDeltaSeconds: 0.5, backlogSeconds: 0, moving: true });
  assert.ok(hitched.backlogSeconds > 0);
  const released = predictionStep({ rawDeltaSeconds: 1 / 60, backlogSeconds: hitched.backlogSeconds, moving: false });
  assert.equal(released.backlogSeconds, 0);
  assert.equal(released.deltaSeconds, 1 / 60);
});

test('the first frame of a walk does not spend the idle time before the thumb landed', () => {
  // The regression this catches, seen in the running game: after standing around, one long frame
  // gap (a throttled page, a backgrounded tab, a hitch) followed by the child pushing the stick
  // spent a whole step cap at once and shot the predicted hero past authority.
  const started = predictionStep({ rawDeltaSeconds: 1.5, backlogSeconds: 0, moving: true, wasMoving: false });
  assert.equal(started.deltaSeconds, 0);
  assert.equal(started.backlogSeconds, 0);
  // ...and the frame AFTER that is credited normally, so nothing is permanently lost.
  const next = predictionStep({ rawDeltaSeconds: 0.2, backlogSeconds: 0, moving: true, wasMoving: true });
  assert.equal(next.deltaSeconds, 0.2);
});

test('a negative or zero gap is treated as no time at all, not as an error', () => {
  for (const rawDeltaSeconds of [0, -1]) {
    const step = predictionStep({ rawDeltaSeconds, backlogSeconds: 0, moving: true });
    assert.equal(step.deltaSeconds, 0);
    assert.equal(step.backlogSeconds, 0);
  }
});
