import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  BAD_P90_MS,
  BAD_WINDOW_LIMIT,
  GOOD_P90_MS,
  GOOD_WINDOW_LIMIT,
  MISSED_FRAME_DELTA_FACTOR,
  MISSED_FRAME_FRACTION_LIMIT,
  QUALITY_WINDOW_FRAMES,
  TARGET_FRAME_INTERVAL_MS,
  createQualityLadder,
} from '../public/src/render/quality.js';
import { MAX_FPS } from '../public/src/render/renderer.js';

function windowOf(value, size = 3) {
  return Array.from({ length: size }, () => value);
}

test('quality ladder uses two bad 120-frame windows and sustained headroom', () => {
  assert.equal(QUALITY_WINDOW_FRAMES, 120);
  assert.equal(BAD_WINDOW_LIMIT, 2);
  assert.equal(GOOD_WINDOW_LIMIT, 4);
  assert.equal(BAD_P90_MS, 16.7);
  assert.equal(GOOD_P90_MS, 12.0);

  const transitions = [];
  const ladder = createQualityLadder({
    windowSize: 3,
    onLevelChange: (result) => transitions.push(result.transition),
  });
  assert.equal(ladder.level.name, 'high');
  assert.equal(ladder.recordWindow(windowOf(17)).transition, null);
  assert.equal(ladder.level.name, 'high');
  assert.equal(ladder.recordWindow(windowOf(17)).transition, 'down');
  assert.equal(ladder.level.name, 'medium');

  // Between 12.0 and 16.7 is intentionally neutral: it resets both counters.
  assert.equal(ladder.recordWindow(windowOf(14)).transition, null);
  assert.equal(ladder.recordWindow(windowOf(11)).transition, null);
  assert.equal(ladder.recordWindow(windowOf(11)).transition, null);
  assert.equal(ladder.recordWindow(windowOf(11)).transition, null);
  assert.equal(ladder.recordWindow(windowOf(11)).transition, 'up');
  assert.equal(ladder.level.name, 'high');
  assert.deepEqual(transitions, ['down', 'up']);
});

// The ladder used to watch only JS frame cost. A GPU-bound iPad shows up as long gaps between
// rendered frames while JS cost stays tiny, so cost-only numbers call a stuttering device healthy --
// which is exactly how this project shipped a 60fps cap that presented ~40fps and measured 0.32ms
// mean cost while doing it.
test('the missed-frame threshold is derived from the renderer cap it has to police', () => {
  // If these drift apart, the ladder polices a frame rate the renderer is not targeting.
  assert.equal(TARGET_FRAME_INTERVAL_MS, 1000 / MAX_FPS);
  assert.equal(MISSED_FRAME_DELTA_FACTOR, 1.6);
  assert.equal(MISSED_FRAME_FRACTION_LIMIT, 0.05);
});

test('a GPU stall steps the ladder down even though JS frame cost is tiny', () => {
  const ladder = createQualityLadder({ windowSize: 10 });
  // 2ms of JS work per frame -- far under the 12ms "good" bar -- but frames arriving 33ms apart,
  // which is one rendered frame per two vsync periods.
  const stalled = () => ladder.recordWindow(windowOf(2, 10), windowOf(33.4, 10));
  assert.equal(stalled().transition, null, 'one bad window must not move the ladder');
  assert.equal(ladder.level.name, 'high');
  const second = stalled();
  assert.equal(second.transition, 'down', 'two bad windows should step down');
  assert.equal(ladder.level.name, 'medium');
  assert.ok(second.missedFraction > MISSED_FRAME_FRACTION_LIMIT, 'window should report the misses');
  assert.ok(second.p90Ms < GOOD_P90_MS, 'and the cost signal alone would have called this healthy');
});

// Differential proof that the new signal is what catches the stall, not the old one. Disabling the
// missed-frame limit reproduces the cost-only ladder this replaced; on the identical window it sees
// nothing wrong and even calls it good enough to climb.
test('the cost-only ladder is blind to the same GPU stall', () => {
  const blind = createQualityLadder({ windowSize: 10, missedFractionLimit: Infinity });
  for (let i = 0; i < 4; i += 1) {
    const result = blind.recordWindow(windowOf(2, 10), windowOf(33.4, 10));
    assert.equal(result.bad, false, 'cost-only logic should not notice the stall');
    assert.equal(result.good, true, 'cost-only logic calls a stalling device healthy');
  }
  assert.equal(blind.level.name, 'high', 'and so it never steps down');
});

test('a 60fps-capped window on a 120Hz panel is healthy, not a stall', () => {
  // The limiter caps at 60, so on ProMotion the rendered frames are ~16.7ms apart by design. That
  // must not read as a missed frame, or every ProMotion device would ratchet itself to low quality.
  const ladder = createQualityLadder({ windowSize: 10 });
  for (let i = 0; i < 6; i += 1) {
    const result = ladder.recordWindow(windowOf(3, 10), windowOf(16.7, 10));
    assert.notEqual(result.transition, 'down', `stepped down on a healthy window at window ${i}`);
    assert.equal(result.missedFraction, 0, 'a 16.7ms delta is not a miss');
  }
  assert.equal(ladder.level.name, 'high');
});

test('missed frames also block stepping back up, so the ladder cannot climb into a stutter', () => {
  const ladder = createQualityLadder({ windowSize: 10 });
  // Get to medium on cost alone.
  ladder.recordWindow(windowOf(18, 10));
  ladder.recordWindow(windowOf(18, 10));
  assert.equal(ladder.level.name, 'medium');
  // Now JS cost is excellent but frames are still being missed: not headroom.
  for (let i = 0; i < GOOD_WINDOW_LIMIT + 2; i += 1) {
    const result = ladder.recordWindow(windowOf(2, 10), windowOf(33.4, 10));
    assert.notEqual(result.transition, 'up', `climbed while missing frames at window ${i}`);
  }
});

test('a window just under the missed-frame limit is not bad', () => {
  const ladder = createQualityLadder({ windowSize: 20 });
  // 1 of 20 deltas long = 5%, which is at the limit and must not trip it (the limit is exclusive).
  const deltas = windowOf(16.7, 20);
  deltas[7] = 40;
  for (let i = 0; i < 4; i += 1) {
    const result = ladder.recordWindow(windowOf(3, 20), deltas);
    assert.equal(result.missedFraction, 0.05, 'expected exactly 5% missed');
    assert.notEqual(result.transition, 'down', 'at exactly the limit the ladder should hold');
  }
  assert.equal(ladder.level.name, 'high');
});

test('quality ladder can step down again only after another pair of bad windows', () => {
  const ladder = createQualityLadder({ windowSize: 2 });
  ladder.recordWindow(windowOf(18, 2));
  ladder.recordWindow(windowOf(18, 2));
  assert.equal(ladder.level.name, 'medium');
  ladder.recordWindow(windowOf(18, 2));
  assert.equal(ladder.level.name, 'medium');
  ladder.recordWindow(windowOf(18, 2));
  assert.equal(ladder.level.name, 'low');
});
