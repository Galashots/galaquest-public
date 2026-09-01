// R1: the wiring between combat events and durable kill XP -- net/gameServerCore.mjs's
// createRewardCoordinator(), driven directly against createSimulation() with no HTTP server and no
// real timers, the same style test/reward-wiring.test.mjs already uses for Lantern Marks. This
// proves the package's own acceptance shape:
//   - kill an ordinary enemy with two contributing heroes -> both persisted, by kind's own amount
//   - an ephemeral (guestId-less) connection earns no durable xp-earned fact
//   - the SAME events batch processed twice (a replay) mints no extra XP
//   - the durable row survives a fresh store open at the same path

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createRewardCoordinator, createSimulation } from '../net/gameServerCore.mjs';
import { SWING_CONTACT_SECONDS } from '../public/src/combat/encounter.js';
import { killXpForKind } from '../public/src/combat/enemyStats.js';
import { attackMessage, decode, encode } from '../public/src/net/protocol.js';
import { openRewardStore } from '../net/rewardStore.mjs';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-kill-xp-'));
  return { dir, path: join(dir, 'rewards.db') };
}

function cleanupTempDb(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.warn(`[test cleanup] could not remove ${dir}: ${error.message}`);
  }
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

// Kills the one enemy in a custom single-enemy simulation. Every level-1 ordinary enemy this game
// defines is well under the starter sword's own damage times a handful of contact windows, so this
// generalises test/reward-wiring.test.mjs's own fightWolfToDeath without needing a per-kind hp table.
function fightToDeath(sim, players, enemyId) {
  let seq = 1;
  let rounds = 0;
  const alive = () => sim.encounterSnapshot().enemies.find((enemy) => enemy.enemyId === enemyId)?.hp > 0;
  while (alive() && rounds < 30) {
    for (const player of players) attack(sim, player.id, seq++);
    stepTicks(sim, Math.ceil(SWING_CONTACT_SECONDS / 0.05) + 1);
    rounds += 1;
  }
}

function singleEnemySimulation(kind, enemyId = 'target') {
  return createSimulation({ enemies: [{ enemyId, kind, spawn: { x: 0, z: 0 } }] });
}

function meleeSpot() {
  return { x: 0, z: -1 };
}

test('two contributing heroes killing one wolf both earn kill XP, durably', () => {
  const { dir, path } = tempDb();
  try {
    const sim = singleEnemySimulation('wolf');
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    const b = sim.addPlayer('b', meleeSpot());
    rewards.join(a.id, 'guest-aaaaaaaa');
    rewards.join(b.id, 'guest-bbbbbbbb');

    fightToDeath(sim, [a, b], 'target');
    assert.equal(sim.encounterSnapshot().enemies.find((e) => e.enemyId === 'target').hp, 0);

    const rewardEvents = rewards.processTick(sim.drainEvents());
    assert.ok(rewardEvents.some((e) => e.type === 'xp-earned' && e.heroId === a.id));
    assert.ok(rewardEvents.some((e) => e.type === 'xp-earned' && e.heroId === b.id));

    const amount = killXpForKind('wolf');
    const snapshot = rewards.rewardsFor([a.id, b.id]);
    assert.equal(snapshot[a.id].xp, amount);
    assert.equal(snapshot[b.id].xp, amount);

    // Durable: a brand-new store opened at the SAME path, independent of the coordinator, sees it.
    const reopened = openRewardStore(path);
    assert.equal(reopened.xpFor('guest-aaaaaaaa'), amount);
    assert.equal(reopened.xpFor('guest-bbbbbbbb'), amount);
    reopened.close();

    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('kill XP is priced per kind, matching combat/enemyStats.js exactly', () => {
  for (const kind of ['wolf', 'ember-wolf', 'frost-wolf', 'alpha-wolf']) {
    const { dir, path } = tempDb();
    try {
      const sim = singleEnemySimulation(kind);
      const rewards = createRewardCoordinator({ rewardStorePath: path });
      const player = sim.addPlayer('a', meleeSpot());
      rewards.join(player.id, `guest-${kind}`);

      fightToDeath(sim, [player], 'target');
      // <= 0, not === 0: only kinds whose maxHp is an exact multiple of the starter sword's own 10
      // damage (ember-wolf's 40, alpha-wolf's 90) land on exactly zero -- frost-wolf's 55 does not,
      // and the fight rules never clamp a landed blow's overkill (combat/encounter.js's own
      // `target.hp -= damage`), so "defeated" is honestly <= 0 for every kind.
      assert.ok(sim.encounterSnapshot().enemies.find((e) => e.enemyId === 'target').hp <= 0,
        `${kind} was not actually killed -- this test proves nothing without a real kill`);

      rewards.processTick(sim.drainEvents());
      assert.equal(rewards.rewardsFor([player.id])[player.id].xp, killXpForKind(kind), `${kind}`);
      rewards.close();
    } finally {
      cleanupTempDb(dir);
    }
  }
});

test('an ephemeral (guestId-less) connection earns no durable kill XP', () => {
  const { dir, path } = tempDb();
  try {
    const sim = singleEnemySimulation('wolf');
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const player = sim.addPlayer('a', meleeSpot());
    // Deliberately never joined with a guestId -- the ephemeral posture rewardsFor's own header
    // documents for XP specifically ("Level 1 with whatever it has equipped in memory... for the
    // same reason", and rewardsFor's ephemeral branch has always hard-coded xp: 0).

    fightToDeath(sim, [player], 'target');
    const rewardEvents = rewards.processTick(sim.drainEvents());
    assert.equal(rewardEvents.some((e) => e.type === 'xp-earned'), false,
      'an ephemeral connection must never announce a durable xp-earned fact');
    assert.equal(rewards.rewardsFor([player.id])[player.id].xp, 0);
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('idempotency under replay: processing the SAME drained events batch twice does not double-pay', () => {
  const { dir, path } = tempDb();
  try {
    const sim = singleEnemySimulation('wolf');
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const player = sim.addPlayer('a', meleeSpot());
    rewards.join(player.id, 'guest-replay');

    fightToDeath(sim, [player], 'target');
    const events = sim.drainEvents();
    const first = rewards.processTick(events);
    assert.ok(first.some((e) => e.type === 'xp-earned'));

    // The identical array of event OBJECTS, handed to the SAME coordinator a second time -- exactly
    // a resent snapshot or a retried tick would look like. The fold's own processedEvents WeakSet
    // (and, one layer further in, the store's own INSERT OR IGNORE on the durable eventId) must
    // both refuse to pay this twice.
    const second = rewards.processTick(events);
    assert.equal(second.some((e) => e.type === 'xp-earned'), false,
      'replaying the same event objects must announce no second xp-earned fact');

    assert.equal(rewards.rewardsFor([player.id])[player.id].xp, killXpForKind('wolf'),
      'the durable total must still be exactly one kill\'s worth');
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});
