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

// #87: CORRECTION -- this comment used to claim "gear no longer becomes a ground pickup at all". That
// was true only briefly: net/gameServerCore.mjs's own tick comment ("Correction (was: gear no longer
// becomes a ground pickup)") records that the ground merge was put BACK, deliberately, because no
// client presenter existed yet to collect a corpse claim at all -- stripping gear from the ground with
// nothing able to read it off a corpse would have made ordinary gear unobtainable online. The client
// presenter now exists (world/corpseLootPresenter.js, ui/corpseLootPanel.js, wired in main.js), but the
// ground path was deliberately KEPT rather than retired on the same PR that added the presenter -- see
// this repo's PR #105 body for the causal argument: the killer's own ground drop and their own corpse
// claim always carry the IDENTICAL itemId (requestCorpseLoot reuses killerGearItemId rather than
// re-rolling), and net/gameServerCore.mjs's own grantOwnership keys its durable event on
// `own:<guestId>:<itemId>` -- so collecting the same item through both paths grants it exactly ONCE,
// never twice, proven below in "shadow mode safety". This comment was stale relative to the shipped
// code for a while (GQ-002); a passing "gear kind allowed" assertion at this file's own top
// (spawn-on-defeat) never contradicted the drift, which is why it went unnoticed until this pass.
//
// These two tests prove the CORPSE half of gear's grant/conversion wiring (the ground half is proven
// by the coin/heart tests above it, which share the same collect-and-grant shape). The "already-owned
// converts to coins instead" half retired with the OLD single-roll-per-kill shape -- corpseLoot.js's
// own ownership-aware suppression (proven in test/corpse-loot.test.mjs) simply omits the claim rather
// than converting it, which the second test below proves is actually wired end to end through the real
// reward coordinator.
test('a corpse claim for an unowned item grants it durably through the real reward store', () => {
  let corpse = null;
  let sim = null;
  let player = null;
  let rewards = null;
  let dir = null;
  for (let attemptNumber = 0; attemptNumber < 80 && !corpse; attemptNumber += 1) {
    const fixture = tempDb();
    dir = fixture.dir;
    sim = singleEnemySimulation('frost-wolf', 'target');
    rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
    player = sim.addPlayer('a', { x: 0, z: 7 });
    rewards.join(player.id, `guest-gear-${attemptNumber}`);
    fightToDeath(sim, [player], 'target');
    corpse = sim.corpsesSnapshot().find((c) => c.claims.some((claim) => claim.heroId === player.id)) ?? null;
    if (!corpse) { rewards.close(); cleanupTempDb(dir); }
  }
  assert.ok(corpse, 'no corpse spawned across 80 frost-wolf kills -- the roll table has likely regressed');
  walkOntoDeathSpot(sim, player.id, 'target', 5000);

  try {
    const claim = corpse.claims.find((c) => c.heroId === player.id);
    const item = claim.items[0];
    const { accepted, item: taken } = sim.applyClaimCorpseItem(player.id, corpse.id, item.id);
    assert.equal(accepted, true);
    const facts = rewards.grantOwnership(player.id, taken.itemId);
    assert.equal(facts[0]?.type, 'gear-owned');
    assert.ok(rewards.ownedItemIdsFor(player.id).includes(taken.itemId));
  } finally {
    rewards.close();
    cleanupTempDb(dir);
  }
});

test('ownership-aware suppression is wired: a killer who already owns the whole pool gets no corpse claim', () => {
  // Not statistical: this proves the SEAM (ownedItemIdsFor is actually threaded from the reward
  // coordinator into world/corpseLoot.js's own roll), not the roll's own suppression logic (already
  // proven deterministically in test/corpse-loot.test.mjs). If a guest who already owns BOTH gear
  // items in the pool ever receives a corpse claim from a solo frost-wolf kill, the wiring itself has
  // a defect -- this asserts that never happens across enough tries to be confident the seam works.
  const { dir, path } = tempDb();
  try {
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    let sim = null;
    let player = null;
    for (let attemptNumber = 0; attemptNumber < 40; attemptNumber += 1) {
      sim = singleEnemySimulation('frost-wolf', 'target', rewards);
      player = sim.addPlayer(`p${attemptNumber}`, { x: 0, z: 7 });
      rewards.join(player.id, 'guest-already-owns-everything');
      // Grant BOTH pool items up front so any real gear roll this kill produces must be suppressed.
      rewards.grantOwnership(player.id, SHIELD_IRONWOOD_ID);
      rewards.grantOwnership(player.id, SHOULDER_SILVERGUARD_ID);
      fightToDeath(sim, [player], 'target');
      const corpses = sim.corpsesSnapshot();
      assert.equal(corpses.length, 0,
        'a solo guest who already owns the whole gear pool must never see a corpse spawn at all');
    }
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

// Correction: every prior corpse-loot test in this file drives a SOLO kill. The riskiest new server
// logic this package adds -- deriving eligibility from a second foldKillXpEvents ledger
// (corpseContribFold in net/gameServerCore.mjs) -- has no coverage at the real-simulation level for
// more than one contributor, so a wrong event source feeding that fold (the arena-filtered
// pendingEvents instead of partyResult.events, say) would silently collapse eligibility to the
// killing-blow hero alone while every other test in this file and in test/corpse-loot.test.mjs
// (which hands eligibleHeroIds in directly) stayed green.
test('#87 seam: two real, independently-attacking players both receive their own corpse claim', () => {
  let corpse = null;
  let sim = null;
  let playerA = null;
  let playerB = null;
  for (let attemptNumber = 0; attemptNumber < 80 && !corpse; attemptNumber += 1) {
    sim = singleEnemySimulation('frost-wolf', 'target');
    playerA = sim.addPlayer('a', { x: 0, z: 7 });
    playerB = sim.addPlayer('b', { x: 0.3, z: 7 });
    fightToDeath(sim, [playerA, playerB], 'target');
    corpse = sim.corpsesSnapshot().find((c) => c.claims.length >= 2) ?? null;
  }
  assert.ok(corpse, 'no corpse with two independent claims spawned across 80 two-player frost-wolf kills');

  const claimA = corpse.claims.find((c) => c.heroId === playerA.id);
  const claimB = corpse.claims.find((c) => c.heroId === playerB.id);
  assert.ok(claimA && claimB,
    'both real contributing heroIds must hold their own claim on the same corpse -- proves the '
    + 'corpseContribFold derivation actually credits both hits, not only the killing blow');

  const { accepted } = sim.applyClaimCorpseItem(playerA.id, corpse.id, claimA.items[0].id);
  assert.equal(accepted, true);
  const after = sim.corpsesSnapshot().find((c) => c.id === corpse.id);
  const stillClaimB = after?.claims.find((c) => c.heroId === playerB.id);
  assert.ok(stillClaimB, 'B\'s own claim must still exist on the corpse after A collects');
  assert.ok(stillClaimB.items.every((item) => !item.taken),
    'A collecting their own claim must never resolve B\'s own claim');
});

// #87 shadow-mode safety: the PRODUCT DIRECTOR asked whether the ground-gear shadow path could be
// retired now that the corpse presenter exists. This is the causal evidence for the answer "not
// retired, and here is why that is still safe": the killer's ground drop and their own corpse claim
// are never two independent rolls -- world/corpseLoot.js's own requestCorpseLoot reuses
// killerGearItemId verbatim rather than re-rolling (see that file's own comment on the killer's
// branch), so both paths name the IDENTICAL itemId, and net/gameServerCore.mjs's own grantOwnership
// keys its durable 'gear-owned' fact on `own:<guestId>:<itemId>` -- a fact that already exists announces
// nothing a second time (announcementFor's own `result.applied` check). So a child who grabs the
// ground copy first and then opens the corpse loses nothing and gains nothing extra: the corpse claim
// still visibly resolves (taken flips true, so the panel and glow correctly stop offering it), but the
// SECOND grantOwnership call for the same itemId is a silent no-op, never a duplicate benefit.
test('shadow mode safety: the killer\'s ground drop and corpse claim share one itemId, so taking both grants ownership exactly once', () => {
  const { dir, path } = tempDb();
  try {
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    let sim = null;
    let player = null;
    let groundGearDrop = null;
    let corpse = null;
    for (let attemptNumber = 0; attemptNumber < 80 && !groundGearDrop; attemptNumber += 1) {
      sim = singleEnemySimulation('frost-wolf', 'target', rewards);
      player = sim.addPlayer(`p${attemptNumber}`, { x: 0, z: 7 });
      rewards.join(player.id, `guest-shadow-${attemptNumber}`);
      fightToDeath(sim, [player], 'target');
      groundGearDrop = sim.dropsSnapshot().find((d) => d.kind === GEAR_DROP_KIND) ?? null;
      corpse = groundGearDrop
        ? sim.corpsesSnapshot().find((c) => c.claims.some((claim) => claim.heroId === player.id)) ?? null
        : null;
      if (!groundGearDrop || !corpse) { groundGearDrop = null; corpse = null; }
    }
    assert.ok(groundGearDrop && corpse,
      'no kill produced BOTH a ground gear drop and a corpse claim for the killer across 80 tries -- '
      + 'the shadow-mode duplication this test is proving safe may have already been retired for real');

    const claim = corpse.claims.find((c) => c.heroId === player.id);
    const corpseItem = claim.items.find((item) => item.itemId === groundGearDrop.itemId);
    assert.ok(corpseItem,
      'the corpse claim\'s own item must name the SAME itemId as the ground drop -- if this ever '
      + 'fails, the two paths have started rolling independently and the "safe because idempotent" '
      + 'argument this test exists to prove no longer holds');

    walkOntoDeathSpot(sim, player.id, 'target', 5000);

    // Path 1: the ground pickup, exactly as an un-migrated child playing today would experience it.
    const groundResult = sim.applyCollectDrop(player.id, groundGearDrop.id);
    assert.equal(groundResult.accepted, true);
    const firstGrantFacts = rewards.grantOwnership(player.id, groundResult.drop.itemId);
    assert.equal(firstGrantFacts.length, 1, 'the FIRST grant of a real item must be a real, announced fact');
    assert.equal(firstGrantFacts[0].type, 'gear-owned');

    // Path 2: the SAME child then opens the corpse too (the new presenter never hides an already-
    // ground-collected item -- taken tracks the CLAIM, not reward ownership) and taps TAKE.
    const corpseResult = sim.applyClaimCorpseItem(player.id, corpse.id, corpseItem.id);
    assert.equal(corpseResult.accepted, true, 'the corpse claim itself is independent physical state -- taking it must still succeed');
    const secondGrantFacts = rewards.grantOwnership(player.id, corpseResult.item.itemId);
    assert.equal(secondGrantFacts.length, 0,
      'the SECOND grant of the identical itemId must be a silent no-op -- this is the actual safety '
      + 'property: no duplicate durable fact, no double benefit, from either collection order');

    assert.ok(rewards.ownedItemIdsFor(player.id).includes(groundGearDrop.itemId),
      'the item is owned exactly once, regardless of which path told the truth first');
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
