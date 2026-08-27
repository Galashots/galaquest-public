// R1: the server wiring between a real kill and a real drop -- net/gameServerCore.mjs driven
// directly, no HTTP server, the same style test/kill-xp-award.test.mjs already uses. world/
// enemyDrops.js's own pure fold (test/enemy-drops.test.mjs) already proves every branch of the roll
// table with scripted rng; this file proves the SEAM: a real kill spawns real drops on the wire, a
// real collect pays out through the real reward paths, and the server's own reach/authorization
// check is not bypassable by a client-supplied position.

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createRewardCoordinator, createSimulation } from '../net/gameServerCore.mjs';
import { SWING_CONTACT_SECONDS, HERO_MAX_HP } from '../public/src/combat/encounter.js';
import {
  COIN_DROP_KIND, DROP_EXPIRE_SECONDS, GEAR_DROP_KIND, HEART_DROP_KIND, HEART_HEAL_HP,
} from '../public/src/world/enemyDrops.js';
import { attackMessage, decode, encode } from '../public/src/net/protocol.js';
import { openRewardStore } from '../net/rewardStore.mjs';
import { SHIELD_IRONWOOD_ID, SHOULDER_SILVERGUARD_ID } from '../public/src/progression/items.js';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-drops-server-'));
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

// Spawned well clear of RECOVERY_SANCTUARY (HERO_SPAWN, radius 3m): a fight staged inside it is not
// a real fight -- nearestTargetableHero refuses a sanctuary-standing hero as a target at all, so the
// enemy would only ever be swung at, never bite back, and every "was the hero actually hurt" claim
// below would be untestable by construction.
function singleEnemySimulation(kind, enemyId, rewards) {
  return createSimulation({
    enemies: [{ enemyId, kind, spawn: { x: 0, z: 8 } }],
    ...(rewards ? { ownedItemIdsFor: (playerId) => rewards.ownedItemIdsFor(playerId) } : {}),
  });
}

function fightToDeath(sim, players, enemyId) {
  let seq = 1;
  let rounds = 0;
  const alive = () => sim.encounterSnapshot().enemies.find((e) => e.enemyId === enemyId)?.hp > 0;
  while (alive() && rounds < 30) {
    for (const player of players) attack(sim, player.id, seq++);
    stepTicks(sim, Math.ceil(SWING_CONTACT_SECONDS / 0.05) + 1);
    rounds += 1;
  }
}

// Walks the player directly onto the (now-dead) enemy's own last position, so every drop that kill
// spawned (scattered at most ~1m away, world/enemyDrops.js's own SCATTER_MAX_METERS) sits well
// inside DROP_COLLECT_RADIUS_METERS regardless of which one a test happens to pick -- rather than
// each test hand-deriving whether its own fixed player position was close enough.
function walkOntoDeathSpot(sim, playerId, enemyId, startAtMs) {
  const deathSpot = sim.encounterSnapshot().enemies.find((e) => e.enemyId === enemyId);
  let now = startAtMs;
  for (let i = 0; i < 40; i += 1) {
    const player = sim.snapshot().find((p) => p.id === playerId);
    const dx = deathSpot.x - player.x;
    const dz = deathSpot.z - player.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.05) break;
    sim.applyInput(playerId, {
      seq: 10_000 + i, dirX: dx / distance, dirZ: dz / distance, magnitude: 1, run: true,
    }, now);
    now += 50;
    sim.step(0.05, now);
  }
  return now;
}

test('spawn-on-defeat: killing a wolf puts real drops on the wire', () => {
  const sim = singleEnemySimulation('wolf', 'target');
  const player = sim.addPlayer('a', { x: 0, z: 7 });
  fightToDeath(sim, [player], 'target');
  const drops = sim.dropsSnapshot();
  assert.ok(drops.length >= 2, 'a common kill always drops at least two coins');
  assert.ok(drops.every((d) => d.kind === COIN_DROP_KIND || d.kind === HEART_DROP_KIND
    || d.kind === GEAR_DROP_KIND));
  assert.ok(drops.every((d) => typeof d.x === 'number' && typeof d.z === 'number'));
});

test('collect authorization: the server checks the PLAYER\'S OWN position, not a client claim', () => {
  const { dir, path } = tempDb();
  try {
    const sim = singleEnemySimulation('wolf', 'target');
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const player = sim.addPlayer('a', { x: 0, z: 7 });
    rewards.join(player.id, 'guest-reach');
    fightToDeath(sim, [player], 'target');
    walkOntoDeathSpot(sim, player.id, 'target', 5000);
    const dropId = sim.dropsSnapshot()[0].id;

    // The player just walked onto the death spot, well within reach. Move a DIFFERENT player far
    // away server-side and confirm the SAME drop is refused from THAT position, proving the check
    // reads the server's own authoritative player record rather than trusting a client claim.
    const farPlayer = sim.addPlayer('b', { x: 500, z: 500 });
    const farResult = sim.applyCollectDrop(farPlayer.id, dropId);
    assert.equal(farResult.accepted, false, 'a player 500m away must not be able to collect');

    const nearResult = sim.applyCollectDrop(player.id, dropId);
    assert.equal(nearResult.accepted, true, 'the player actually standing at the death spot must succeed');
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('a collected coin drop credits the reward store AND the communal Village total', () => {
  const { dir, path } = tempDb();
  try {
    const sim = singleEnemySimulation('wolf', 'target');
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const player = sim.addPlayer('a', { x: 0, z: 7 });
    rewards.join(player.id, 'guest-coin');
    fightToDeath(sim, [player], 'target');
    walkOntoDeathSpot(sim, player.id, 'target', 5000);

    const before = rewards.villageSnapshot().coins;
    const coinDrop = sim.dropsSnapshot().find((d) => d.kind === COIN_DROP_KIND);
    const { accepted, drop } = sim.applyCollectDrop(player.id, coinDrop.id);
    assert.equal(accepted, true);
    const facts = rewards.applyLootAward(player.id, drop.id, drop.kind);
    assert.equal(facts[0]?.type, 'coin-earned');

    assert.equal(rewards.rewardsFor([player.id])[player.id].coins, 1);
    assert.equal(rewards.villageSnapshot().coins, before + 1,
      'a kill-drop coin funds the shared Village economy the same way cart-loot coins do');

    const reopened = openRewardStore(path);
    assert.equal(reopened.coinsFor('guest-coin'), 1, 'the coin is durable across a fresh store open');
    reopened.close();
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('a collected heart drop heals through combat/encounter.js\'s own requestHeroHeal, capped at maxHp', () => {
  // Fight several frost-wolves (25% heart chance each) until a heart actually drops -- high
  // confidence within a bounded number of tries rather than a scripted rng, since the server's own
  // Math.random is not injectable from here (the pure roll table's every branch is already proven
  // deterministically in test/enemy-drops.test.mjs).
  let heartDrop = null;
  let sim = null;
  let player = null;
  for (let attemptNumber = 0; attemptNumber < 60 && !heartDrop; attemptNumber += 1) {
    sim = singleEnemySimulation('frost-wolf', 'target');
    player = sim.addPlayer('a', { x: 0, z: 7 });
    fightToDeath(sim, [player], 'target');
    heartDrop = sim.dropsSnapshot().find((d) => d.kind === HEART_DROP_KIND) ?? null;
  }
  assert.ok(heartDrop, 'no heart dropped across 60 frost-wolf kills -- the roll table has likely regressed');
  walkOntoDeathSpot(sim, player.id, 'target', 5000);

  const hpBeforeCollect = sim.encounterSnapshot().heroes[player.id].hp;
  assert.ok(hpBeforeCollect < HERO_MAX_HP, 'the fight itself must have cost some health for a heal to mean anything');
  const { accepted, drop } = sim.applyCollectDrop(player.id, heartDrop.id);
  assert.equal(accepted, true);
  // applyCollectDrop only adjudicates the PHYSICAL collect (the same split applyCollectLoot's own
  // collect-loot handler takes) -- the payout is one layer up, in attachGameServer's onMessage
  // handler for 'collect-drop'. Driving the simulation directly here (no HTTP server, no message
  // layer) means this test has to take that second step itself, the same way the coin test above
  // calls rewards.applyLootAward explicitly rather than relying on a message dispatch that never ran.
  assert.equal(drop.kind, HEART_DROP_KIND);
  sim.applyHeroHeal(player.id, HEART_HEAL_HP);
  const hpAfterCollect = sim.encounterSnapshot().heroes[player.id].hp;
  assert.ok(hpAfterCollect > hpBeforeCollect, 'a collected heart must actually heal');
  assert.ok(hpAfterCollect <= HERO_MAX_HP, 'a heart must never carry a hero past their own maxHp');
});

// The "already-owned converts to coins instead" half is proven by the wiring test right after this
// one -- this test only needs the unowned-grant path, since the conversion arithmetic itself is
// already pinned deterministically in test/enemy-drops.test.mjs.
test('a collected gear drop for an unowned item grants it durably through the real reward store', () => {
  let gearDrop = null;
  let sim = null;
  let player = null;
  let rewards = null;
  let dir = null;
  for (let attemptNumber = 0; attemptNumber < 80 && !gearDrop; attemptNumber += 1) {
    const fixture = tempDb();
    dir = fixture.dir;
    sim = singleEnemySimulation('frost-wolf', 'target');
    rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
    player = sim.addPlayer('a', { x: 0, z: 7 });
    rewards.join(player.id, `guest-gear-${attemptNumber}`);
    fightToDeath(sim, [player], 'target');
    gearDrop = sim.dropsSnapshot().find((d) => d.kind === GEAR_DROP_KIND) ?? null;
    if (!gearDrop) { rewards.close(); cleanupTempDb(dir); }
  }
  assert.ok(gearDrop, 'no gear dropped across 80 frost-wolf kills -- the roll table has likely regressed');
  walkOntoDeathSpot(sim, player.id, 'target', 5000);

  try {
    const { accepted } = sim.applyCollectDrop(player.id, gearDrop.id);
    assert.equal(accepted, true);
    const facts = rewards.grantOwnership(player.id, gearDrop.itemId);
    assert.equal(facts[0]?.type, 'gear-owned');
    assert.ok(rewards.ownedItemIdsFor(player.id).includes(gearDrop.itemId));
  } finally {
    rewards.close();
    cleanupTempDb(dir);
  }
});

test('the owned-gear-to-coins conversion is wired: the killer\'s own ownership feeds the roll', () => {
  // Not statistical: this proves the SEAM (ownedItemIdsFor is actually threaded from the reward
  // coordinator into world/enemyDrops.js's own roll), not the roll's own conversion arithmetic
  // (already proven deterministically in test/enemy-drops.test.mjs). If a guest who already owns
  // BOTH gear items in the pool ever collects a fresh 'gear' drop, the wiring itself has a defect --
  // this asserts that never happens across enough tries to be confident the seam works.
  const { dir, path } = tempDb();
  try {
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    let sim = null;
    let player = null;
    for (let attemptNumber = 0; attemptNumber < 40; attemptNumber += 1) {
      sim = singleEnemySimulation('frost-wolf', 'target', rewards);
      player = sim.addPlayer(`p${attemptNumber}`, { x: 0, z: 7 });
      rewards.join(player.id, 'guest-already-owns-everything');
      // Grant BOTH pool items up front so any real gear roll this kill produces must convert.
      rewards.grantOwnership(player.id, SHIELD_IRONWOOD_ID);
      rewards.grantOwnership(player.id, SHOULDER_SILVERGUARD_ID);
      fightToDeath(sim, [player], 'target');
      const drops = sim.dropsSnapshot();
      assert.equal(drops.some((d) => d.kind === GEAR_DROP_KIND), false,
        'a guest who already owns the whole gear pool must never see a live gear pickup on the ground');
    }
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('expiry: an uncollected drop is gone from the wire after DROP_EXPIRE_SECONDS of real ticks', () => {
  const sim = singleEnemySimulation('wolf', 'target');
  const player = sim.addPlayer('a', { x: 0, z: 7 });
  fightToDeath(sim, [player], 'target');
  assert.ok(sim.dropsSnapshot().length > 0);
  stepTicks(sim, Math.ceil((DROP_EXPIRE_SECONDS + 1) / 0.05));
  assert.equal(sim.dropsSnapshot().length, 0, 'every uncollected drop must have expired');
});
