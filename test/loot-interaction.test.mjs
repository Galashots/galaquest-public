// Issue #124: one missed interaction must be ONE red, and the retry must follow the verified
// post-condition rather than a fixed attempt count.
//
// `drive-corpse-loot` used to give every interaction exactly three attempts. On the hosted matrix
// both recorded signatures spent that budget (`attempts:2` and `attempts:3`), `clickLanded` was
// false in both, and the harness then asserted the product consequences of a collect that never
// happened -- about nine FAIL lines from one missed tap. The retry rule now lives in
// tools/runtime-test/loot-interaction.mjs, pure and injectable, so it can be proven here without a
// browser. These tests are what would go red if the count came back or if a miss were reclassified
// as a product refusal.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectUntilEffect,
  interactionClassReason,
} from '../tools/runtime-test/loot-interaction.mjs';

/** A clock that only moves when something waits or explicitly advances it. */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    advance: (ms) => { t += ms; },
  };
}

const landedTap = { found: true, hitIsTarget: true, clickLanded: true };
const missedTap = { found: true, hitIsTarget: false, clickLanded: false };
const hiddenTap = { found: false };

test('retries past the old three-attempt cap until the verified post-condition holds', async () => {
  const clock = fakeClock();
  let taps = 0;
  let recoveries = 0;
  const result = await collectUntilEffect({
    now: clock.now,
    sleep: clock.sleep,
    deadline: 60_000,
    confirmTimeoutMs: 1_000,
    attempt: async () => {
      taps += 1;
      clock.advance(150); // a real CDP tap costs wall clock; keep the fake clock honest
      return taps < 6 ? missedTap : landedTap;
    },
    recover: async () => { recoveries += 1; return true; },
    confirm: async () => ({ verified: true, wire: { untaken: 1 } }),
  });

  assert.equal(result.collected, true);
  assert.equal(result.outcome, 'collected');
  assert.equal(taps, 6, 'five misses then one hit must still converge under a deadline');
  assert.equal(recoveries, 5, 'recovery runs between attempts, never before the first');
});

test('a landed in-range click the wire never confirms is a PRODUCT refusal, not a miss', async () => {
  const clock = fakeClock();
  let taps = 0;
  let confirms = 0;
  const result = await collectUntilEffect({
    now: clock.now,
    sleep: clock.sleep,
    deadline: 30_000,
    confirmTimeoutMs: 1_000,
    pollIntervalMs: 100,
    attempt: async () => { taps += 1; return landedTap; },
    recover: async () => true,
    confirm: async () => {
      confirms += 1;
      return { verified: false, gone: false, outOfReach: false, wire: { untaken: 2 } };
    },
  });

  assert.equal(result.collected, false);
  assert.equal(result.outcome, 'refused');
  assert.ok(taps > 3, `the old three-attempt cap must not decide the outcome (taps=${taps})`);
  assert.ok(confirms > taps, 'every landed click must be checked against the authoritative wire');
  assert.match(interactionClassReason(result), /#113 shape/);
});

test('taps that never reach a control are an instrument miss and never wait on a receipt', async () => {
  const clock = fakeClock();
  let taps = 0;
  const result = await collectUntilEffect({
    now: clock.now,
    sleep: clock.sleep,
    deadline: 5_000,
    confirmTimeoutMs: 1_000,
    attempt: async () => { taps += 1; clock.advance(300); return missedTap; },
    recover: async () => true,
    confirm: async () => { throw new Error('confirm must not run when the tap never landed'); },
  });

  assert.equal(result.collected, false);
  assert.equal(result.outcome, 'missed');
  assert.ok(taps > 3, `retry is bounded by the subject, not by the old cap (taps=${taps})`);
  assert.match(interactionClassReason(result), /instrument miss/);
});

test('a tap whose control vanished entirely is also a miss, not a product failure', async () => {
  const clock = fakeClock();
  const result = await collectUntilEffect({
    now: clock.now,
    sleep: clock.sleep,
    deadline: 2_000,
    attempt: async () => { clock.advance(400); return hiddenTap; },
    recover: async () => true,
    confirm: async () => { throw new Error('confirm must not run for a hidden control'); },
  });

  assert.equal(result.outcome, 'missed');
  assert.equal(result.collected, false);
});

test('the subject leaving the wire ends the retry as an instrument outcome', async () => {
  const clock = fakeClock();
  let confirms = 0;
  const result = await collectUntilEffect({
    now: clock.now,
    sleep: clock.sleep,
    deadline: 30_000,
    attempt: async () => landedTap,
    recover: async () => true,
    confirm: async () => {
      confirms += 1;
      return { verified: false, gone: true, outOfReach: false, wire: null };
    },
  });

  assert.equal(result.collected, false);
  assert.equal(result.outcome, 'gone');
  assert.equal(confirms, 1, 'a vanished claim is terminal; do not keep tapping at an empty scene');
  assert.match(interactionClassReason(result), /left the wire/);
});

test('the subject lifetime, not an attempt count, is the ultimate bound', async () => {
  const clock = fakeClock();
  let expired = false;
  let taps = 0;
  const result = await collectUntilEffect({
    now: clock.now,
    sleep: clock.sleep,
    deadline: 1_000_000, // far away: the subject dies first
    confirmTimeoutMs: 1_000,
    attempt: async () => { taps += 1; clock.advance(200); return missedTap; },
    expired: () => expired,
    recover: async () => { expired = true; return true; },
    confirm: async () => { throw new Error('confirm must not run'); },
  });

  assert.equal(result.collected, false);
  assert.equal(result.outcome, 'expired');
  assert.equal(taps, 1, 'expiry is observed before the next tap is dispatched');
});

test('an already-dead subject does not dispatch even one attempt', async () => {
  let taps = 0;
  const result = await collectUntilEffect({
    deadline: 10_000,
    attempt: async () => { taps += 1; return landedTap; },
    expired: () => true,
    confirm: async () => ({ verified: true }),
  });

  assert.equal(taps, 0);
  assert.equal(result.collected, false);
  assert.equal(result.outcome, 'expired');
  assert.equal(result.attempts, 0);
});

test('a click that reached a control but was refused on reach is not recorded as a refusal', async () => {
  const clock = fakeClock();
  const result = await collectUntilEffect({
    now: clock.now,
    sleep: clock.sleep,
    deadline: 2_000,
    attempt: async () => { clock.advance(400); return landedTap; },
    recover: async () => true,
    confirm: async () => ({ verified: false, gone: false, outOfReach: true, wire: { untaken: 2 } }),
  });

  assert.equal(result.collected, false);
  assert.equal(result.outcome, 'out-of-reach');
  assert.equal(result.sawOutOfReach, true);
  assert.match(interactionClassReason(result), /out of interact reach/);
});
