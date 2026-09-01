import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deadlineAfter,
  movementPulseMillis,
  pollUntilDeadline,
  subjectLifetime,
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

// A harness that observes something with a LIFETIME (a corpse claim, a ground drop, a knockdown)
// spends that lifetime while it works. drive-corpse-loot went red hosted at a20fcd7 for exactly
// this and nothing else: every gameplay assertion it managed to run passed, and then its own
// re-approach/poll choreography spent all 180 seconds of CORPSE_LOOT_EXPIRE_SECONDS, so the tap it
// finally made landed on a corpse that no longer existed. Five hosted cycles read the resulting
// cascade as an interaction bug because no number in the run said how much of the subject was left.
test('a wait is clamped to what the subject has left to live, not to what the caller wanted', () => {
  let clock = 0;
  const claim = subjectLifetime({ bornAtMillis: 0, lifetimeSeconds: 180, now: () => clock });

  assert.equal(claim.budgetFor(60_000), 60_000, 'an early wait it can afford is granted in full');

  clock = 150_000;
  assert.equal(claim.budgetFor(60_000), 30_000,
    'the same 60s wait must shrink to the 30s the subject actually has left');
});

test('an outlived subject budgets zero rather than a negative wait', () => {
  let clock = 0;
  const claim = subjectLifetime({ bornAtMillis: 0, lifetimeSeconds: 180, now: () => clock });

  clock = 188_600; // the exact hosted overshoot at a20fcd7
  assert.equal(claim.expired(), true);
  assert.equal(claim.remainingMillis(), 0);
  assert.equal(claim.budgetFor(60_000), 0, 'never hand back a negative deadline as a huge one');
});

test('a reserve stops an early phase from spending the lifetime the later phases still need', () => {
  let clock = 0;
  const claim = subjectLifetime({ bornAtMillis: 0, lifetimeSeconds: 180, now: () => clock });

  clock = 60_000; // 120s left
  assert.equal(claim.budgetFor(90_000, { reserveMillis: 45_000 }), 75_000,
    'the approach may have 120s minus the 45s the two collects still need');
  assert.equal(claim.budgetFor(90_000, { reserveMillis: 200_000 }), 0,
    'a reserve larger than what is left leaves nothing, not a negative wait');
});

test('elapsed/remaining report the subject in the units the run is spending', () => {
  let clock = 5_000;
  const claim = subjectLifetime({ bornAtMillis: 5_000, lifetimeSeconds: 180, now: () => clock });
  assert.equal(claim.elapsedSeconds(), 0);

  clock = 92_600; // the hosted moment the panel was open with a named, hit-testable TAKE button
  assert.equal(claim.elapsedSeconds(), 87.6);
  assert.equal(claim.remainingMillis(), 92_400);
  assert.equal(claim.expired(), false);
});
