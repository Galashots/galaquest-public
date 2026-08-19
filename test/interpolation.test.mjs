import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  BUFFER_MS,
  INTERPOLATION_DELAY_MS,
  STARVATION_DECAY_MS,
  createSnapshotBuffer,
  lerpAngle,
} from '../public/src/net/interpolation.js';
import { SNAPSHOT_HZ } from '../public/src/net/protocol.js';

const SNAPSHOT_MS = 1000 / SNAPSHOT_HZ;

// A player walking in a straight line at a known speed, so the test can compare against physics
// rather than against the interpolator's own arithmetic.
function walkingSnapshots({ count, startMs, intervalMs = SNAPSHOT_MS, speed = 1.4, id = 'p1' }) {
  return Array.from({ length: count }, (_, i) => ({
    receivedAtMs: startMs + i * intervalMs,
    snapshot: {
      tick: i,
      players: [{ id, x: 0, z: (i * intervalMs * speed) / 1000, heading: 0, speed }],
    },
  }));
}

test('the delay is longer than one snapshot interval, which is what tolerates jitter', () => {
  // At exactly one interval there is no slack and the first late packet stutters.
  assert.ok(INTERPOLATION_DELAY_MS > SNAPSHOT_MS,
    `delay ${INTERPOLATION_DELAY_MS}ms must exceed the ${SNAPSHOT_MS}ms snapshot interval`);
  assert.ok(INTERPOLATION_DELAY_MS < SNAPSHOT_MS * 2,
    'and should stay under two intervals, which would be visibly laggy');
});

test('steady 10 Hz snapshots interpolate to the physically correct position', () => {
  const buffer = createSnapshotBuffer();
  const speed = 1.4;
  const feed = walkingSnapshots({ count: 10, startMs: 1000, speed });
  for (const { receivedAtMs, snapshot } of feed) buffer.record(snapshot, receivedAtMs);

  // Sample at times BETWEEN snapshot arrivals -- the whole point is the frames nobody sent.
  for (const offset of [0, 17, 33, 50, 67, 83]) {
    const nowMs = 1500 + offset;
    const sampled = buffer.sample(nowMs);
    const player = sampled.get('p1');
    assert.ok(player, `nothing sampled at +${offset}`);
    // Where the walker truly was at (now - delay), from the speed, independent of the interpolator.
    const trueElapsedMs = nowMs - INTERPOLATION_DELAY_MS - 1000;
    const trueZ = (trueElapsedMs * speed) / 1000;
    assert.ok(
      Math.abs(player.z - trueZ) < 1e-9,
      `at +${offset}ms interpolated z=${player.z.toFixed(6)}, physics says ${trueZ.toFixed(6)}`,
    );
    assert.equal(player.interpolated, true);
  }
});

test('motion is smooth and monotonic across a whole second of frames', () => {
  // The failure this catches is a position that jumps every 100ms -- i.e. no interpolation at all --
  // which a single sample cannot see.
  const buffer = createSnapshotBuffer();
  for (const { receivedAtMs, snapshot } of walkingSnapshots({ count: 15, startMs: 1000 })) {
    buffer.record(snapshot, receivedAtMs);
  }
  // Sample only moments the buffer can actually serve. Recording all 15 snapshots before sampling
  // means the oldest are already trimmed, and asking for a moment whose history is gone correctly
  // returns a held position -- which is not stutter, but would look like it to this assertion. In a
  // live session snapshots arrive as time passes and the retained window is ~8x the delay, so the
  // case cannot arise; the next test pins that margin.
  let previous = -Infinity;
  const steps = [];
  for (let nowMs = 1550; nowMs <= 2400; nowMs += 16.7) {
    const z = buffer.sample(nowMs).get('p1').z;
    assert.ok(z >= previous - 1e-9, `position went backwards at ${nowMs}`);
    if (previous > -Infinity) steps.push(z - previous);
    previous = z;
  }
  assert.ok(steps.length > 45, `expected a full second of frames, got ${steps.length}`);
  const largest = Math.max(...steps);
  const smallest = Math.min(...steps);
  // At a constant walk every 16.7ms frame should advance by the same amount. Allow a little slack for
  // the frame that straddles a snapshot boundary.
  assert.ok(largest - smallest < 0.002,
    `steps varied from ${smallest.toFixed(5)} to ${largest.toFixed(5)}, which would read as stutter`);
});

test('the retained buffer is far longer than the interpolation delay', () => {
  // If these ever converged, the interpolator would routinely ask for history that had been trimmed
  // and fall back to a held position -- smooth motion replaced by 10 Hz steps, which is the exact
  // failure this module exists to prevent. Caught while writing the smoothness test above.
  assert.ok(BUFFER_MS >= INTERPOLATION_DELAY_MS * 4,
    `buffer ${BUFFER_MS}ms is not a comfortable margin over a ${INTERPOLATION_DELAY_MS}ms delay`);
});

test('jittered arrival still produces monotonic motion', () => {
  // Real packets do not arrive every exactly-100ms. +/-40ms is heavy jitter for a LAN.
  const buffer = createSnapshotBuffer();
  const jitter = [0, 38, -35, 12, -28, 40, -18, 25, -40, 8, 30, -22, 15, -10, 20];
  const speed = 1.4;
  jitter.forEach((offset, i) => {
    // The position is a function of the tick, not of arrival time: the server sent it on schedule
    // even though the network delivered it late.
    buffer.record(
      { tick: i, players: [{ id: 'p1', x: 0, z: (i * SNAPSHOT_MS * speed) / 1000, heading: 0, speed }] },
      1000 + i * SNAPSHOT_MS + offset,
    );
  });

  let previous = -Infinity;
  let samples = 0;
  for (let nowMs = 1300; nowMs <= 2100; nowMs += 16.7) {
    const player = buffer.sample(nowMs).get('p1');
    assert.ok(player, `nothing sampled at ${nowMs}`);
    assert.ok(Number.isFinite(player.z), `non-finite position at ${nowMs}`);
    assert.ok(player.z >= previous - 1e-9,
      `jitter made the remote walk backwards at ${nowMs}: ${previous} -> ${player.z}`);
    previous = player.z;
    samples += 1;
  }
  assert.ok(samples > 40, 'expected plenty of samples');
});

test('a 500ms gap holds position instead of extrapolating through it', () => {
  const buffer = createSnapshotBuffer();
  const speed = 2.8;
  for (const { receivedAtMs, snapshot } of walkingSnapshots({ count: 5, startMs: 1000, speed })) {
    buffer.record(snapshot, receivedAtMs);
  }
  const lastArrivalMs = 1000 + 4 * SNAPSHOT_MS;
  const lastZ = (4 * SNAPSHOT_MS * speed) / 1000;

  // Sample deep into the gap. Extrapolating at 2.8 m/s for half a second would put the remote 1.4
  // units past where the server ever said it was -- through a wall, then snapped back.
  const duringGap = buffer.sample(lastArrivalMs + INTERPOLATION_DELAY_MS + 500).get('p1');
  assert.ok(Math.abs(duringGap.z - lastZ) < 1e-9,
    `extrapolated to ${duringGap.z} instead of holding at ${lastZ}`);
  assert.equal(duringGap.interpolated, false, 'a held position is not interpolated');
  assert.ok(duringGap.starvedMs > 400, `starvation should be reported, got ${duringGap.starvedMs}`);
});

test('speed decays to idle during starvation so the pose settles', () => {
  // Holding position but keeping speed would leave a remote running on the spot forever.
  const buffer = createSnapshotBuffer();
  buffer.record({ tick: 1, players: [{ id: 'p1', x: 0, z: 0, heading: 0, speed: 2.8 }] }, 1000);
  buffer.record({ tick: 2, players: [{ id: 'p1', x: 0, z: 0.28, heading: 0, speed: 2.8 }] }, 1100);

  const base = 1100 + INTERPOLATION_DELAY_MS;
  const halfway = buffer.sample(base + STARVATION_DECAY_MS / 2).get('p1');
  assert.ok(halfway.speed > 0 && halfway.speed < 2.8, `expected partial decay, got ${halfway.speed}`);
  const after = buffer.sample(base + STARVATION_DECAY_MS + 50).get('p1');
  assert.equal(after.speed, 0, 'speed should reach exactly zero, not merely get small');
  const muchLater = buffer.sample(base + 5000).get('p1');
  assert.equal(muchLater.speed, 0, 'and stay there');
  assert.ok(Math.abs(muchLater.z - 0.28) < 1e-9, 'while holding the last known position');
});

test('heading takes the short way round instead of unwinding', () => {
  assert.ok(Math.abs(lerpAngle(0, Math.PI / 2, 0.5) - Math.PI / 4) < 1e-9);
  // Just under PI to just over: the difference is small, the naive lerp would travel nearly 2PI.
  const from = Math.PI - 0.1;
  const to = -Math.PI + 0.1;
  const middle = lerpAngle(from, to, 0.5);
  // Should pass through PI (or -PI, the same bearing), never through 0.
  const asBearing = Math.atan2(Math.sin(middle), Math.cos(middle));
  assert.ok(Math.abs(Math.abs(asBearing) - Math.PI) < 1e-9,
    `turned the long way round: ${middle}`);
  assert.equal(lerpAngle(1, 1, 0.5), 1, 'no rotation is no rotation');
});

test('a spinning remote never turns the wrong way between snapshots', () => {
  const buffer = createSnapshotBuffer();
  // Sweep past the +PI/-PI seam, which is where the naive lerp visibly spins the wrong way.
  const headings = [2.9, 3.0, 3.1, -3.1, -3.0, -2.9, -2.8];
  headings.forEach((heading, i) => {
    buffer.record({ tick: i, players: [{ id: 'p1', x: 0, z: 0, heading, speed: 1 }] },
      1000 + i * SNAPSHOT_MS);
  });
  let previous = null;
  for (let nowMs = 1150; nowMs <= 1600; nowMs += 16.7) {
    const heading = buffer.sample(nowMs).get('p1').heading;
    if (previous !== null) {
      const step = Math.abs(((heading - previous + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      // A frame of a slow turn is a small step. A wrong-way unwind is a huge one.
      assert.ok(step < 0.2, `heading jumped ${step.toFixed(3)} rad in one frame at ${nowMs}`);
    }
    previous = heading;
  }
});

test('a player who leaves stops being sampled, and one who joins appears at once', () => {
  const buffer = createSnapshotBuffer();
  buffer.record({ tick: 1, players: [
    { id: 'a', x: 0, z: 0, heading: 0, speed: 0 },
    { id: 'b', x: 1, z: 1, heading: 0, speed: 0 },
  ] }, 1000);
  buffer.record({ tick: 2, players: [{ id: 'a', x: 0, z: 0.1, heading: 0, speed: 1 }] }, 1100);
  buffer.record({ tick: 3, players: [
    { id: 'a', x: 0, z: 0.2, heading: 0, speed: 1 },
    { id: 'c', x: 5, z: 5, heading: 0, speed: 0 },
  ] }, 1200);

  const mid = buffer.sample(1100 + INTERPOLATION_DELAY_MS);
  assert.ok(mid.has('a'), 'a is still here');
  assert.ok(!mid.has('b'), 'b left and must not be frozen in place as a ghost');

  const later = buffer.sample(1150 + INTERPOLATION_DELAY_MS);
  assert.ok(later.has('c'), 'c joined and should be visible immediately');
  assert.deepEqual([later.get('c').x, later.get('c').z], [5, 5], 'at its own position');
});

test('the first snapshot of a session shows immediately rather than 120ms later', () => {
  // Otherwise a remote pops into existence a fifth of a second after the server said it exists.
  const buffer = createSnapshotBuffer();
  buffer.record({ tick: 1, players: [{ id: 'p1', x: 3, z: 4, heading: 1, speed: 0 }] }, 1000);
  const immediately = buffer.sample(1000).get('p1');
  assert.ok(immediately, 'expected the remote to be visible at once');
  assert.deepEqual([immediately.x, immediately.z], [3, 4]);
  assert.equal(immediately.interpolated, false);
});

test('an empty buffer samples to nothing rather than throwing', () => {
  const buffer = createSnapshotBuffer();
  assert.equal(buffer.sample(1000).size, 0);
  assert.equal(buffer.length, 0);
  assert.equal(buffer.latest, null);
});

test('the buffer trims without ever dropping what the interpolator still needs', () => {
  const buffer = createSnapshotBuffer({ bufferMs: 300 });
  for (let i = 0; i < 100; i += 1) {
    buffer.record({ tick: i, players: [{ id: 'p1', x: 0, z: i * 0.14, heading: 0, speed: 1.4 }] },
      1000 + i * SNAPSHOT_MS);
    // Even while trimming aggressively, a sample at the interpolation delay must still bracket.
    const nowMs = 1000 + i * SNAPSHOT_MS;
    const player = buffer.sample(nowMs).get('p1');
    assert.ok(player, `lost the player at snapshot ${i}`);
    assert.ok(Number.isFinite(player.z), `non-finite at snapshot ${i}`);
  }
  assert.ok(buffer.length <= 6, `buffer grew to ${buffer.length} despite a 300ms window`);
});
