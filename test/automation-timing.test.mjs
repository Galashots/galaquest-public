import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deadlineAfter,
  movementPulseMillis,
  pollUntilDeadline,
} from '../tools/runtime-test/automation-timing.mjs';

test('pollUntilDeadline is bounded by elapsed time rather than a sample count', async () => {
  let clock = 0;
  let reads = 0;
  const read = async () => {
    reads += 1;
    clock += 430; // Simulate a slow CDP Runtime.evaluate call.
    return reads;
  };
  const sleep = async (ms) => { clock += ms; };

  const result = await pollUntilDeadline(read, () => false, {
    intervalMs: 25,
    timeoutMs: 1000,
    sleep,
    now: () => clock,
  });

  assert.equal(result, 3);
  assert.equal(reads, 3);
  assert.ok(clock < 1600, `slow reads must not multiply a nominal 1s wait into a sample-count loop: ${clock}ms`);
});

test('pollUntilDeadline returns immediately when the first sample satisfies the predicate', async () => {
  let slept = false;
  const result = await pollUntilDeadline(async () => ({ ready: true }), (value) => value.ready, {
    sleep: async () => { slept = true; },
  });
  assert.deepEqual(result, { ready: true });
  assert.equal(slept, false);
});

test('movement pulse duration shrinks near a target and remains bounded', () => {
  assert.equal(movementPulseMillis(0), 70);
  assert.equal(movementPulseMillis(1), 70);
  assert.equal(movementPulseMillis(2), 110);
  assert.equal(movementPulseMillis(100), 300);
});

test('deadlineAfter uses the supplied clock', () => {
  assert.equal(deadlineAfter(750, () => 1000), 1750);
});
