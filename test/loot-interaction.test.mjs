// Issue #124: one missed interaction must be ONE red, and the retry must follow the verified
// post-condition rather than a fixed attempt count.
//
// `drive-corpse-loot` used to give every interaction exactly three attempts. On the hosted matrix
// both recorded signatures spent that budget (`attempts:2` and `attempts:3`), `clickLanded` was
// false in both, and the harness then asserted the product consequences of a collect that never
// happened -- about nine FAIL lines from one missed tap. The retry rule now lives in
// tools/runtime-test/loot-interaction.mjs, pure and injectable, so it can be proven here without a
// browser. These tests are what would go red if the count came back, if a miss were reclassified
// as a product refusal, or if signature B (reached, no click) were reclassified as a
// never-reached miss.
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
// #124 signature B verbatim: the probe saw the tap ON the real control, but no click followed.
const reachedNoClickTap = { found: true, hitIsTarget: true, clickLanded: false };

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

test('an early failed recovery does not leave `recovered` false once a later one succeeds', async () => {
  const clock = fakeClock();
  let recoveries = 0;
  const result = await collectUntilEffect({
    now: clock.now,
    sleep: clock.sleep,
    deadline: 60_000,
    confirmTimeoutMs: 100,
    pollIntervalMs: 10,
    attempt: async () => landedTap,
    recover: async () => { recoveries += 1; return recoveries > 1; },
    confirm: async () => (recoveries >= 2
      ? { verified: true, wire: { untaken: 1 } }
      : { verified: false, gone: false, outOfReach: false, wire: { untaken: 2 } }),
  });

  assert.equal(result.collected, true);
  assert.equal(result.outcome, 'collected');
  assert.equal(recoveries, 2, 'the first recovery fails; only the second puts the hero back in range');
  assert.equal(result.recovered, true,
    'a failed recovery early in the run must not stay sticky on a later successful collect');
});

test('a landed in-range click the wire never confirms is an INFERRED product refusal, not a miss', async () => {
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
  assert.match(interactionClassReason(result), /INFERRED|inferred/,
    'an in-range confirm timeout is an inference of refusal, never proof of a product refusal');
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

test('a subject whose budget is already gone dispatches nothing and is a no-budget outcome', async () => {
  let taps = 0;
  const result = await collectUntilEffect({
    deadline: 0, // the budget is spent before the loop begins, but the subject has not expired
    attempt: async () => { taps += 1; return landedTap; },
    expired: () => false,
    confirm: async () => { throw new Error('confirm must not run when no touch was dispatched'); },
  });

  assert.equal(taps, 0);
  assert.equal(result.attempts, 0);
  assert.equal(result.collected, false);
  assert.equal(result.outcome, 'no-budget');
  assert.match(interactionClassReason(result), /ran out of budget/);
  assert.match(interactionClassReason(result), /zero attempts/);
  assert.doesNotMatch(interactionClassReason(result), /dispatched touch/,
    'the reason must not claim a dispatched touch when none was ever dispatched');
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

test('signature B (reached, no click) is classified and worded distinctly from signature A (never reached)', async () => {
  // At exact-head CI the B-shaped TAKE (hitIsTarget:true, clickLanded:false, attempts:7) was
  // classified `missed` and stamped "no dispatched touch ever reached a loot control" -- a
  // sentence its own payload contradicts, laundering a possibly-product event into CI noise.
  //
  // Red-capability, stated so a future reader can tell whether this test still earns it: the
  // outcome INEQUALITY below names no B-side string, so any re-merge of the two buckets fails it
  // no matter what the merged bucket is called; the wording assertions fail if the old
  // never-reached sentence returns, no matter which outcome carries it. The one exact string
  // pinned ('reached-no-click') is the caller contract drive-corpse-loot.mjs branches on for its
  // loud gating name -- not the convention under test.
  const runScenario = async (tap) => {
    const clock = fakeClock();
    return collectUntilEffect({
      now: clock.now,
      sleep: clock.sleep,
      deadline: 5_000,
      confirmTimeoutMs: 1_000,
      attempt: async () => { clock.advance(300); return tap; },
      recover: async () => true,
      confirm: async () => { throw new Error('confirm must not run when no click landed'); },
    });
  };
  const sigA = await runScenario(missedTap);
  const sigB = await runScenario(reachedNoClickTap);

  assert.equal(sigA.collected, false);
  assert.equal(sigA.outcome, 'missed');
  assert.equal(sigA.sawReachedNoClick, false);
  assert.match(interactionClassReason(sigA), /no dispatched touch ever reached a loot control/,
    'signature A keeps the instrument-miss wording: the genuine miss behaviour must not regress');
  assert.equal(sigB.collected, false);
  assert.notEqual(sigB.outcome, sigA.outcome,
    'signature B must never share signature A\'s classification');
  assert.equal(sigB.outcome, 'reached-no-click');
  assert.equal(sigB.sawReachedNoClick, true);
  const reason = interactionClassReason(sigB);
  assert.doesNotMatch(reason, /ever reached a loot control/,
    'B reached the control; the never-reached sentence contradicts the evidence');
  assert.doesNotMatch(reason, /never reached/,
    'neither the recorded sentence nor its plain paraphrase may describe B');
  assert.doesNotMatch(reason, /instrument miss/,
    'B may be product (#124 leaves #113 open); it must never read as noise');
  assert.match(reason, /reached the .*control/,
    'the reason must state the reach the probe actually observed');
});

test('one reached-but-clickless tap anywhere in the run outranks pure misses', async () => {
  const clock = fakeClock();
  let taps = 0;
  const result = await collectUntilEffect({
    now: clock.now,
    sleep: clock.sleep,
    deadline: 5_000,
    confirmTimeoutMs: 1_000,
    attempt: async () => {
      taps += 1;
      clock.advance(300);
      return taps === 3 ? reachedNoClickTap : missedTap; // mostly canvas, one B
    },
    recover: async () => true,
    confirm: async () => { throw new Error('confirm must not run when no click landed'); },
  });

  assert.equal(result.collected, false);
  assert.equal(result.outcome, 'reached-no-click',
    'reach evidence anywhere in the run contradicts the missed sentence for the whole run');
  assert.doesNotMatch(interactionClassReason(result), /ever reached a loot control|instrument miss/);
});

test('a landed click refused on reach outranks reached-but-clickless taps', async () => {
  const clock = fakeClock();
  let taps = 0;
  const result = await collectUntilEffect({
    now: clock.now,
    sleep: clock.sleep,
    deadline: 5_000,
    confirmTimeoutMs: 1_000,
    pollIntervalMs: 100,
    attempt: async () => {
      taps += 1;
      clock.advance(200);
      return taps === 1 ? reachedNoClickTap : landedTap;
    },
    recover: async () => true,
    confirm: async () => ({ verified: false, gone: false, outOfReach: true, wire: { untaken: 2 } }),
  });

  assert.equal(result.collected, false);
  assert.equal(result.outcome, 'out-of-reach',
    'a landed click says strictly more than a reached one');
  assert.equal(result.sawReachedNoClick, true, 'the B evidence is still recorded');
});
