// Stage 1 / Checkpoint 1: one player, one durable identity, one reward per fact.
//
// The bug this file was written to catch, found by reading net/gameServer.mjs's reward coordinator
// and then PROVED by running it rather than argued from the source: a single guestId held by two
// live connections earns TWO durable Lantern Marks for ONE wolf kill. Two tabs in one browser share
// localStorage, so they share the guestId -- this is an ordinary thing a child does ("it looked
// frozen so I opened it again"), not a contrived race, and MARKS_TO_UNLOCK is 3, so it unlocks the
// lantern in two kills instead of three.
//
// The causal chain, all three links verified against this checkout:
//   1. createRewardCoordinator's join() is an unconditional Map.set with no uniqueness check, so
//      two playerIds can both claim one guestId;
//   2. rewards/marks.js's foldEvents credits contributors keyed by heroId, so two heroIds produce
//      two awards for the one wolf-life;
//   3. applyMarkAward derives its durable eventId from `store.marksFor(guestId)` read FRESH on each
//      call, so the second award computes a DIFFERENT key and INSERT OR IGNORE lets it through.
//
// No concurrency is needed to reproduce it -- processTick applies awards sequentially on one tick,
// and step 3 re-reads the count in between. That is why this test needs no timers and no sockets.
//
// It is deliberately written against the SAME seam test/reward-wiring.test.mjs already uses
// (createSimulation + createRewardCoordinator, no HTTP, no real clock) rather than through a
// WebSocket, because the defect lives in the reward coordinator and a socket would only add noise
// between the cause and the assertion.

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WOLF_SPAWN, createRewardCoordinator, createSimulation } from '../net/gameServer.mjs';
import { SWING_CONTACT_SECONDS } from '../public/src/combat/encounter.js';
import { attackMessage, decode, encode } from '../public/src/net/protocol.js';
import { openRewardStore } from '../net/rewardStore.mjs';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-profile-identity-'));
  return { dir, path: join(dir, 'rewards.db') };
}

// Best-effort, and for the reason test/reward-wiring.test.mjs already records: Windows can hold a
// just-closed SQLite handle open longer than any bounded retry here should wait, and whether the
// scratch directory got removed is not part of what any test in this file proves.
function cleanupTempDb(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.warn(`[test cleanup] could not remove ${dir}: ${error.message}`);
  }
}

function meleeSpot(offset = 1) {
  return { x: WOLF_SPAWN.x, z: WOLF_SPAWN.z - offset };
}

function attack(sim, playerId, seq) {
  return sim.applyAttack(playerId, decode(encode(attackMessage(seq))));
}

function stepTicks(sim, count, deltaSeconds = 0.05, startAtMs = 1000) {
  let now = startAtMs;
  for (let i = 0; i < count; i += 1) {
    now += deltaSeconds * 1000;
    sim.step(deltaSeconds, now);
  }
}

function fightWolfToDeath(sim, players) {
  let seq = 1;
  let rounds = 0;
  while (sim.encounterSnapshot().wolf.hp > 0 && rounds < 20) {
    for (const player of players) attack(sim, player.id, seq += 1);
    stepTicks(sim, Math.ceil(SWING_CONTACT_SECONDS / 0.05) + 1);
    rounds += 1;
  }
}

test('one guestId on two connections earns ONE mark for one wolf kill, not two', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });

    // Two tabs in one browser: one localStorage, therefore one guestId, but two distinct playerIds.
    const shared = 'guest-two-tabs-one-child';
    const tabA = sim.addPlayer('tab-a', meleeSpot());
    const tabB = sim.addPlayer('tab-b', meleeSpot());
    rewards.join(tabA.id, shared);
    rewards.join(tabB.id, shared);
    assert.notEqual(tabA.id, tabB.id, 'the two tabs must be distinct players for this to mean anything');

    fightWolfToDeath(sim, [tabA, tabB]);
    assert.equal(sim.encounterSnapshot().wolf.hp, 0, 'the wolf must actually be dead for this test to mean anything');

    rewards.processTick(sim.drainEvents());

    // The durable record is the thing that matters: one child, one kill, one mark. Read from a
    // brand-new store at the same path so this is the state on disk, not the coordinator's opinion.
    const reopened = openRewardStore(path);
    const durable = reopened.marksFor(shared);
    reopened.close();
    rewards.close();

    assert.equal(durable, 1, `one wolf kill by one child must record exactly one mark, got ${durable}`);
  } finally {
    cleanupTempDb(dir);
  }
});

test('two DIFFERENT guests killing one wolf together still each earn their own mark', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    const b = sim.addPlayer('b', meleeSpot());
    rewards.join(a.id, 'guest-brother-aaa');
    rewards.join(b.id, 'guest-brother-bbb');

    fightWolfToDeath(sim, [a, b]);
    assert.equal(sim.encounterSnapshot().wolf.hp, 0, 'the wolf must actually be dead for this test to mean anything');

    rewards.processTick(sim.drainEvents());

    const reopened = openRewardStore(path);
    const aMarks = reopened.marksFor('guest-brother-aaa');
    const bMarks = reopened.marksFor('guest-brother-bbb');
    reopened.close();
    rewards.close();

    // The guard above must not be bought by breaking co-op: participation credit is the existing,
    // deliberate rule (rewards/marks.js is explicit that it is "kinder than killing-blow"), and two
    // brothers who both land a hit must both be paid.
    assert.equal(aMarks, 1, 'the first brother earned his own mark');
    assert.equal(bMarks, 1, 'the second brother earned his own mark');
  } finally {
    cleanupTempDb(dir);
  }
});
