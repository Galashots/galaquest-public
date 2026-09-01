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
import { CORPSE_COIN_KIND } from '../public/src/world/corpseLoot.js';
import { COIN_KIND } from '../public/src/world/cartLoot.js';

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

/** A scripted rng: returns each queued value in order, then keeps returning the last one. Same
 *  helper, same contract, as test/enemy-drops.test.mjs's own -- that file drives world/enemyDrops.js
 *  directly with scripted sequences, this one drives the same roll through the real simulation. */
function scripted(...values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : values[values.length - 1]);
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
function singleEnemySimulation(kind, enemyId, rewards, options = {}) {
  return createSimulation({
    ...options,
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

// #87 moved the ordinary COIN receipt off the ground and onto the personal corpse claim, so this
// test was rewritten rather than deleted: it now pins BOTH halves of the new law in one place, so
// a future change that quietly puts coins back on the ground (double-paying every kill) fails here.
test('spawn-on-defeat: an ordinary kill pays coins to the personal claim, never to the ground', () => {
  // Heart misses, so the only thing that could reach the ground is a coin -- which is exactly what
  // must no longer be there.
  const rng = scripted(0.0, 0.99);
  const sim = singleEnemySimulation('wolf', 'target', null, { rng });
  const player = sim.addPlayer('a', { x: 0, z: 7 });
  fightToDeath(sim, [player], 'target');

  const drops = sim.dropsSnapshot();
  assert.equal(drops.some((d) => d.kind === COIN_DROP_KIND), false,
    'an ordinary kill must not scatter ground coins online -- they would double-pay against the claim, and they auto-collect on proximity so the killer would absorb them before ever seeing LOOT');
  assert.ok(drops.every((d) => d.kind === HEART_DROP_KIND || d.kind === GEAR_DROP_KIND),
    'hearts and gear are the only kinds still allowed on the ground');
  assert.ok(drops.every((d) => typeof d.x === 'number' && typeof d.z === 'number'));

  const claim = sim.corpsesSnapshot()[0]?.claims.find((c) => c.heroId === player.id);
  assert.ok(claim, 'and the kill must leave this hero a real personal claim instead');
  const coins = claim.items.find((item) => item.kind === CORPSE_COIN_KIND);
  assert.equal(coins?.amount, 2, 'carrying the same count the ground roll would have paid');
});

test('collect authorization: the server checks the PLAYER\'S OWN position, not a client claim', () => {
  const { dir, path } = tempDb();
  try {
    // Coins go to the personal claim now, so a HEART is the only ground drop an ordinary kill
    // still makes. Rolled deterministically rather than hoped for -- 0.0 clears the heart chance.
    const rng = scripted(0.0, 0.0);
    const sim = singleEnemySimulation('wolf', 'target', null, { rng });
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

// #87 moved the ordinary coin receipt onto the personal claim, so this test follows it there. The
// property is unchanged and still load-bearing -- a collected coin has to reach the durable store
// AND the communal Village total -- but the claim pays an AMOUNT in one action, so it also pins
// the thing that shape introduces: N coins means exactly N rows, once.
test('a collected corpse coin credits the reward store AND the communal Village total, exactly once', () => {
  const { dir, path } = tempDb();
  try {
    const rng = scripted(0.0, 0.99); // min coin band (2), heart misses
    const sim = singleEnemySimulation('wolf', 'target', null, { rng });
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const player = sim.addPlayer('a', { x: 0, z: 7 });
    rewards.join(player.id, 'guest-coin');
    fightToDeath(sim, [player], 'target');
    walkOntoDeathSpot(sim, player.id, 'target', 5000);

    const before = rewards.villageSnapshot().coins;
    const corpse = sim.corpsesSnapshot()[0];
    const claim = corpse.claims.find((c) => c.heroId === player.id);
    const coins = claim.items.find((item) => item.kind === CORPSE_COIN_KIND);
    assert.equal(coins.amount, 2, 'the ordinary band, so the numbers below are not accidental');

    const { accepted, item } = sim.applyClaimCorpseItem(player.id, corpse.id, coins.id);
    assert.equal(accepted, true);
    // Exactly what net/gameServerCore.mjs's own awardCorpseClaimItem does for a coin row: one
    // durable eventId per coin, derived from the claim item's own globally-unique id.
    const facts = [];
    for (let i = 0; i < item.amount; i += 1) {
      facts.push(...rewards.applyLootAward(player.id, `${item.id}#${i}`, COIN_KIND));
    }
    assert.equal(facts.length, 2, 'two coins, two announced facts');
    assert.ok(facts.every((fact) => fact.type === 'coin-earned'));

    assert.equal(rewards.rewardsFor([player.id])[player.id].coins, 2);
    assert.equal(rewards.villageSnapshot().coins, before + 2,
      'claim coins fund the shared Village economy exactly as ground coins did');

    // A resent collect must not mint a second payout. Same item, same derived ids, INSERT OR
    // IGNORE -- this is the idempotency the whole one-row-carrying-an-amount shape rests on.
    for (let i = 0; i < item.amount; i += 1) {
      assert.deepEqual(rewards.applyLootAward(player.id, `${item.id}#${i}`, COIN_KIND), [],
        'a replayed corpse-coin award announces nothing, because it applied nothing');
    }
    assert.equal(rewards.rewardsFor([player.id])[player.id].coins, 2,
      'and the hero is no richer for the replay');
    assert.equal(rewards.villageSnapshot().coins, before + 2);

    const reopened = openRewardStore(path);
    assert.equal(reopened.coinsFor('guest-coin'), 2, 'the coins are durable across a fresh store open');
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
// Deterministic since #87 moved coins onto the claim, for two reasons. The old 80-kill hunt for a
// gear claim now exits on the FIRST kill whether or not gear was rolled -- every kill leaves a coin
// claim -- so it silently stopped testing gear at all and started handing a coin row to
// grantOwnership. And an unseeded hunt on a required gate is the flake class this suite already
// threw out once. The scripted roll lands gear on the pool item a fresh guest does not own.
test('a corpse claim for an unowned item grants it durably through the real reward store', () => {
  const { dir, path } = tempDb();
  const rng = scripted(
    0.0, // coin roll -> min band
    0.99, // heart roll misses
    0.1, // gear roll HITS (frost-wolf, 0.2 chance)
    0.9, // which gear item -> index 1, the one a fresh guest does NOT already own
  );
  const rewards = createRewardCoordinator({ rewardStorePath: path });
  const sim = singleEnemySimulation('frost-wolf', 'target', rewards, { rng });
  const player = sim.addPlayer('a', { x: 0, z: 7 });
  rewards.join(player.id, 'guest-gear');
  fightToDeath(sim, [player], 'target');
  const corpse = sim.corpsesSnapshot()
    .find((c) => c.claims.some((claim) => claim.heroId === player.id)) ?? null;
  assert.ok(corpse, 'the kill must leave this hero a claim');
  walkOntoDeathSpot(sim, player.id, 'target', 5000);

  try {
    const claim = corpse.claims.find((c) => c.heroId === player.id);
    // The GEAR row specifically -- items[0] is no longer guaranteed to be one.
    const item = claim.items.find((candidate) => candidate.kind === 'gear');
    assert.ok(item, 'the scripted roll must have produced a real gear claim item');
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

// BLOCKER correction: net/gameServerCore.mjs's own applyClaimCorpseItem adjudicates a collect message
// OUT OF BAND from simulation.step() -- a real client only ever learns anything through a real
// corpsesSnapshot(), built inside step(). Before this correction, retiring a fully-resolved corpse on
// the very next step() removed it from the simulation BEFORE that step's own snapshot was built, so a
// real client's next real snapshot never carried the taken:false -> true transition at all. This test
// drives the REAL seam end to end (a real simulation, a real accepted collect, a real step(), a real
// corpsesSnapshot()) rather than a hand-built array, exactly the seam-level proof the corpse-retirement
// bug slipped through without.
test('#87 seam: taking a corpse\'s last item is still visible on a REAL corpsesSnapshot() one real tick later', () => {
  let corpse = null;
  let sim = null;
  let player = null;
  for (let attemptNumber = 0; attemptNumber < 80 && !corpse; attemptNumber += 1) {
    sim = singleEnemySimulation('frost-wolf', 'target');
    player = sim.addPlayer('a', { x: 0, z: 7 });
    fightToDeath(sim, [player], 'target');
    corpse = sim.corpsesSnapshot().find((c) => c.claims.some((claim) => claim.heroId === player.id)) ?? null;
  }
  assert.ok(corpse, 'no corpse spawned across 80 frost-wolf kills -- the roll table has likely regressed');
  walkOntoDeathSpot(sim, player.id, 'target', 5000);

  const claim = corpse.claims.find((c) => c.heroId === player.id);
  const item = claim.items[0];
  const { accepted } = sim.applyClaimCorpseItem(player.id, corpse.id, item.id);
  assert.equal(accepted, true);

  // One real tick, the same shape a real running server takes between two snapshots.
  stepTicks(sim, 1);

  const nextSnapshot = sim.corpsesSnapshot();
  const stillThere = nextSnapshot.find((c) => c.id === corpse.id);
  assert.ok(stillThere,
    'the just-resolved corpse must still be on a REAL corpsesSnapshot() one real tick later, or a '
    + 'real client can never diff the taken transition at all');
  assert.equal(stillThere.claims.find((c) => c.heroId === player.id)?.items.find((i) => i.id === item.id)?.taken,
    true, 'the real snapshot must actually carry taken:true, not merely still contain the corpse');
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
      // The law is about GEAR suppression, and it had to be restated when #87 moved the coin
      // receipt onto the claim: an ordinary kill now always leaves a corpse, so "no corpse at all"
      // stopped being a truthful way to say "no gear was granted".
      const claim = sim.corpsesSnapshot()[0]?.claims.find((c) => c.heroId === player.id);
      assert.ok(claim, 'the kill still owes this hero their ordinary coins');
      assert.equal(claim.items.some((item) => item.kind === 'gear'), false,
        'a guest who already owns the whole gear pool must never be granted a gear claim item');
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
  // This test is about CONTRIBUTOR ELIGIBILITY, not whether two independent 20% gear rolls happen
  // to land on the same kill. Use #87's existing test-only guaranteed-item seam to make the claim
  // contents deterministic while keeping the fight, hit ledger, corpse creation, eligibility fold,
  // per-hero claims, and collection isolation real. The seam defaults off and has its own opt-in
  // regression below, so this does not alter shipped drop behaviour.
  const sim = singleEnemySimulation('frost-wolf', 'target', undefined, {
    guaranteedCorpseItemIds: [SHIELD_IRONWOOD_ID],
  });
  const playerA = sim.addPlayer('a', { x: 0, z: 7 });
  const playerB = sim.addPlayer('b', { x: 0.3, z: 7 });
  fightToDeath(sim, [playerA, playerB], 'target');
  const corpse = sim.corpsesSnapshot().find((c) => c.claims.length >= 2) ?? null;
  assert.ok(corpse, 'both real contributors must deterministically receive a claim on the same corpse');

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

// #87 HARNESS SEAM, both halves. tools/runtime-test/drive-corpse-loot.mjs cannot prove anything about
// the loot panel until a real personal claim exists, and whether one exists was decided by an unseeded
// 20% dice roll -- which is why the hosted matrix job burned its whole budget re-killing an enemy and
// went red having never opened the panel once. net/gameServerCore.mjs's own guaranteedCorpseItemIds
// option (routed from server.mjs's GALAQUEST_TEST_GUARANTEED_CORPSE_ITEMS, set by nothing else in the
// tree) hands the server a fixed item list instead.
//
// The FIRST test is the one that matters for safety, and it is deliberately written to go red if this
// seam ever stops being opt-in: a common `wolf` has gearChance 0 (world/enemyDrops.js's own
// dropTableForKind), and world/corpseLoot.js refuses to create an empty corpse at all, so an unwired
// simulation must produce NO corpse whatsoever from a real, fully-fought wolf kill. If a future change
// ever defaults this option on, or leaks a production caller into it, this assertion fails immediately
// rather than quietly handing every child free gear.
// The seam is still opt-in, but "opt-in" can no longer be spelled "no corpse at all": every ordinary
// kill now leaves a coin claim by design. So the property is stated where it actually lives -- an
// unwired simulation hands out no GUARANTEED item.
test('#87 harness seam is opt-in: an unwired kill grants no guaranteed item, only its ordinary coins', () => {
  const sim = createSimulation({ enemies: [{ enemyId: 'target', kind: 'wolf', spawn: { x: 0, z: 8 } }] });
  const player = sim.addPlayer('a', { x: 0, z: 7 });
  fightToDeath(sim, [player], 'target');

  assert.equal(sim.encounterSnapshot().enemies.find((e) => e.enemyId === 'target').hp, 0,
    'the wolf must actually be dead, or this proves nothing about what its death did or did not spawn');
  const claim = sim.corpsesSnapshot()[0]?.claims.find((c) => c.heroId === player.id);
  assert.ok(claim, 'an ordinary kill always leaves this hero something personal to loot');
  assert.equal(claim.items.some((item) => item.guaranteed), false,
    'a guaranteed item here means guaranteedCorpseItemIds stopped being opt-in');
  assert.deepEqual(claim.items.map((item) => item.kind), [CORPSE_COIN_KIND],
    'and a common wolf has gearChance 0, so coins are the whole claim');
});

test('#87 harness seam: guaranteedCorpseItemIds puts a real, takeable personal claim on the corpse', () => {
  const sim = createSimulation({
    enemies: [{ enemyId: 'target', kind: 'wolf', spawn: { x: 0, z: 8 } }],
    guaranteedCorpseItemIds: [SHIELD_IRONWOOD_ID, SHOULDER_SILVERGUARD_ID],
  });
  const player = sim.addPlayer('a', { x: 0, z: 7 });
  fightToDeath(sim, [player], 'target');

  const corpse = sim.corpsesSnapshot()[0];
  assert.ok(corpse, 'the same kill that spawns nothing unwired must spawn a real corpse once the seam is set');
  const claim = corpse.claims.find((c) => c.heroId === player.id);
  assert.ok(claim, 'the real contributing hero must hold the claim -- not some synthesized fixture hero');
  assert.deepEqual(
    claim.items.filter((item) => item.kind === 'gear').map((item) => item.itemId),
    [SHIELD_IRONWOOD_ID, SHOULDER_SILVERGUARD_ID],
    'the claim carries exactly the requested items, in order, so the harness knows what to assert on screen');
  assert.ok(claim.items.some((item) => item.kind === CORPSE_COIN_KIND),
    'and the kill\'s ordinary coins ride the same claim -- the seam adds gear, it does not replace the normal reward');
  assert.ok(claim.items.filter((item) => item.kind === 'gear')
    .every((item) => item.guaranteed === true && item.taken === false),
    'the seam\'s own items ride the already-tested guaranteed path and start untaken');
  assert.equal(claim.items.find((item) => item.kind === CORPSE_COIN_KIND).guaranteed, false,
    'the ordinary coin reward is NOT a guaranteed item -- it is the normal roll, and mislabelling it would let a future guaranteed-reward rule quietly capture every kill\'s coins');

  // The harness's own flow: take one individually, then the LAST one -- the exact shape of the
  // corpse-retirement blocker corrected at dd7ce2e, driven here through the real server entry points.
  assert.equal(sim.applyClaimCorpseItem(player.id, corpse.id, claim.items[0].id).accepted, true);
  const midway = sim.corpsesSnapshot().find((c) => c.id === corpse.id);
  assert.deepEqual(midway.claims[0].items.map((item) => item.taken), [true, false, false],
    'taking one item must resolve exactly that item and leave the others -- the second guaranteed item AND the ordinary coin row -- still offered');
  assert.equal(sim.applyClaimCorpseItem(player.id, corpse.id, claim.items[1].id).accepted, true);
});

// #87 shadow-mode safety: the PRODUCT DIRECTOR asked whether the ground-gear shadow path could be
// retired now that the corpse presenter exists. This is the causal evidence for the answer "not
// retired, and here is why that is still safe": the killer's ground drop and their own corpse claim
// are never two independent rolls -- world/corpseLoot.js's own requestCorpseLoot reuses
// killerGearItemId verbatim rather than re-rolling (see that file's own comment on the killer's
// branch), so both paths name the IDENTICAL itemId, and net/gameServerCore.mjs's own grantOwnership
// keys its durable 'gear-owned' fact on `own:<guestId>:<itemId>` -- a fact that already exists announces
// nothing a second time (announcementFor's own `result.applied` check).
//
// MAJOR correction (shadow-mode-retirement): this test used to end here and separately tap the corpse
// claim's own TAKE for the identical item, asserting `accepted: true` with a silent zero-fact grant --
// proving no DOUBLE AWARD, but not proving the child ever saw anything sensible. In the killer's own
// real flow (walking from the kill spot to the corpse) the ground copy auto-collects first, well
// inside CORPSE_LOOT_INTERACT_RADIUS_METERS, so that "second tap" was not a hypothetical: it was the
// literal next thing that happens, and it used to hand back a live, enabled TAKE button that granted
// nothing and (before the corpse-retirement correction elsewhere in this file) showed nothing either --
// a dead button teaching "this is broken". net/gameServerCore.mjs's own applyCollectDrop now calls
// world/corpseLoot.js's own resolveGroundCollectedClaimItems the instant the ground copy is collected,
// syncing this hero's own matching claim item to taken WITHOUT granting anything a second time -- so by
// the time this child would even reach the corpse, that claim item already reads taken and the corpse
// presenter (world/corpseLootPresenter.js's own hasUnclaimedLoot) never offers it as a live TAKE at
// all. This test now proves THAT sync, not merely idempotent ownership.
test('shadow mode safety: collecting the ground copy resolves the matching corpse claim, so the corpse never offers a dead TAKE for the same item', () => {
  const { dir, path } = tempDb();
  try {
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    // ONE kill, not up to eighty. This used to fight real kills in a loop waiting for an unseeded
    // 20% gear roll to land, which made a REQUIRED gate probabilistic: it failed hosted on a head
    // whose other `test` trigger passed on the identical SHA. A gate that flakes is not a gate, and
    // raising 80 to 200 would only move the failure rate, not remove it.
    //
    // `rng` is createSimulation's own opt-in determinism seam (default Math.random), which exists
    // because world/enemyDrops.js's requestEnemyDrop has always documented its third parameter as
    // "the server passes Math.random; a test passes a scripted" one. Scripted by VALUE with the same
    // annotated-sequence convention test/enemy-drops.test.mjs already uses against this exact
    // function, so the intent of each draw is readable rather than implied.
    //
    // The gear index matters and is the whole reason the old loop needed so many tries: a freshly
    // joined guest already owns GEAR_DROP_POOL[0] (`shield_ironwood`) as a STARTER item, and a roll
    // landing on an owned item converts to coins instead of spawning gear. So the old test was
    // really waiting on a 20% gear roll AND a coin-flip landing on index 1 -- about one kill in ten.
    const rng = scripted(
      0.0, // coin roll -> min count
      0.99, // heart roll misses (0.25 chance)
      0.1, // gear roll HITS (0.2 chance)
      0.9, // which gear item -> index 1, the one a fresh guest does NOT already own
    );
    //
    // WHAT THIS DOES NOT FAKE, which is the whole point: it decides only how the DICE came down. The
    // kill is a real fought kill through the real simulation, the ground drop is spawned by the real
    // requestEnemyDrop against the real ownership lookup, the corpse claim is minted by the real
    // requestCorpseLoot, and the identity this test exists to prove -- that the claim reuses the
    // killer's own rolled itemId rather than re-rolling -- is still produced by production code, not
    // asserted into place here.
    const sim = singleEnemySimulation('frost-wolf', 'target', rewards, { rng });
    const player = sim.addPlayer('p-shadow', { x: 0, z: 7 });
    rewards.join(player.id, 'guest-shadow');
    fightToDeath(sim, [player], 'target');

    const groundGearDrop = sim.dropsSnapshot().find((d) => d.kind === GEAR_DROP_KIND) ?? null;
    assert.ok(groundGearDrop,
      'a determinized gear roll must put a real ground gear drop on the wire -- if this fails, gear '
      + 'has stopped reaching dropsState at all and the shadow-mode duplication this test proves safe '
      + 'may already have been retired for real');
    const corpse = sim.corpsesSnapshot()
      .find((c) => c.claims.some((claim) => claim.heroId === player.id)) ?? null;
    assert.ok(corpse, 'the same kill must also mint this hero\'s own personal corpse claim');

    const claim = corpse.claims.find((c) => c.heroId === player.id);
    const corpseItem = claim.items.find((item) => item.itemId === groundGearDrop.itemId);
    assert.ok(corpseItem,
      'the corpse claim\'s own item must name the SAME itemId as the ground drop -- if this ever '
      + 'fails, the two paths have started rolling independently and the "safe because idempotent" '
      + 'argument this test exists to prove no longer holds');
    assert.equal(corpseItem.taken, false, 'sanity: the corpse claim starts untaken, before any collect at all');

    walkOntoDeathSpot(sim, player.id, 'target', 5000);

    // Path 1: the ground pickup, exactly as an un-migrated child playing today would experience it --
    // and, in the killer's real flow, the thing that happens automatically on the walk to the corpse.
    const groundResult = sim.applyCollectDrop(player.id, groundGearDrop.id);
    assert.equal(groundResult.accepted, true);
    const firstGrantFacts = rewards.grantOwnership(player.id, groundResult.drop.itemId);
    assert.equal(firstGrantFacts.length, 1, 'the FIRST grant of a real item must be a real, announced fact');
    assert.equal(firstGrantFacts[0].type, 'gear-owned');

    // The corpse claim's own matching item must already be resolved -- synced by the ground collect
    // itself, before this child ever taps anything on the corpse.
    const corpseAfterGroundCollect = sim.corpsesSnapshot().find((c) => c.id === corpse.id);
    const claimAfterGroundCollect = corpseAfterGroundCollect?.claims.find((c) => c.heroId === player.id);
    assert.equal(claimAfterGroundCollect?.items.find((item) => item.id === corpseItem.id)?.taken, true,
      'the ground collect must resolve the matching corpse claim item, not merely grant ownership silently');

    // So the corpse itself can no longer offer a live TAKE for it: the exact same physical request
    // that used to succeed-but-grant-nothing is now cleanly refused, the identical shape every other
    // already-taken/replayed collect in this codebase already takes -- not a special "already owned"
    // branch, just the ordinary taken:true rejection.
    const corpseResult = sim.applyClaimCorpseItem(player.id, corpse.id, corpseItem.id);
    assert.equal(corpseResult.accepted, false,
      'a claim item the ground path already resolved must be refused, not accepted-but-empty');

    assert.ok(rewards.ownedItemIdsFor(player.id).includes(groundGearDrop.itemId),
      'the item is owned exactly once, regardless of which path told the truth first');
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('expiry: an uncollected drop is gone from the wire after DROP_EXPIRE_SECONDS of real ticks', () => {
  // Coins go to the personal claim now, so a HEART is the only ground drop an ordinary kill still
  // makes. Rolled deterministically rather than hoped for -- 0.0 clears the 0.25 heart chance.
  const rng = scripted(0.0, 0.0);
  const sim = singleEnemySimulation('wolf', 'target', null, { rng });
  const player = sim.addPlayer('a', { x: 0, z: 7 });
  fightToDeath(sim, [player], 'target');
  assert.ok(sim.dropsSnapshot().length > 0);
  stepTicks(sim, Math.ceil((DROP_EXPIRE_SECONDS + 1) / 0.05));
  assert.equal(sim.dropsSnapshot().length, 0, 'every uncollected drop must have expired');
});

// ── THE OWNER FAILURE, AS A TEST ────────────────────────────────────────────────────────────────
// Owner running-game gate FAIL at d575f240: he verified /source-sha.json, played the natural opening
// fight, and saw no LOOT affordance at all. Not bad luck -- a deterministic spec gap. Production
// ENEMY_POPULATION authors wolf-1 as kind 'wolf'; dropTableForKind('wolf') gives gearChance 0; and
// world/corpseLoot.js was gear-only, returning spawned:null when nobody ended up holding gear. So the
// game's own opening enemy could NEVER create a claim or show #87's UI, however many times it died.
//
// That is #87's selected outcome failing on the one fight every child has first. This test is the
// exact shape of what the Owner did, with the dice pinned so it can never pass by luck.
test('#87 Owner path: the ordinary opening Wolf always leaves a personal corpse claim carrying its coins', () => {
  const { dir, path } = tempDb();
  try {
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    // The production opening kind, and a roll with NO bonus of any sort: minimum coins, heart misses,
    // and 'wolf' has gearChance 0 so gear cannot happen at all. If a claim still appears, it appears
    // because the ordinary coin reward is genuinely personal now -- not because the dice were kind.
    const rng = scripted(
      0.0, // coin roll -> minimum of the [2,4] band
      0.99, // heart roll misses (0.25 chance)
    );
    const sim = singleEnemySimulation('wolf', 'target', rewards, { rng });
    const player = sim.addPlayer('p-owner', { x: 0, z: 7 });
    rewards.join(player.id, 'guest-owner');
    fightToDeath(sim, [player], 'target');

    const corpse = sim.corpsesSnapshot()
      .find((c) => c.claims.some((claim) => claim.heroId === player.id)) ?? null;
    assert.ok(corpse,
      'the ordinary opening Wolf must leave a corpse this hero can loot -- this is the Owner-visible '
      + 'failure at d575f240, where a common Wolf produced no claim and therefore no LOOT affordance');

    const claim = corpse.claims.find((c) => c.heroId === player.id);
    const coinItems = claim.items.filter((item) => item.kind === CORPSE_COIN_KIND);
    assert.equal(coinItems.length, 1, 'coins present as ONE presentable row, not one row per coin');
    assert.equal(coinItems[0].amount, 2, 'and carrying the same count the ground roll would have paid');
    assert.equal(coinItems[0].taken, false);
    assert.equal(claim.items.some((item) => item.kind === 'gear'), false,
      'no gear on a common Wolf -- gearChance is 0 and this test must not be secretly proving gear');
  } finally {
    cleanupTempDb(dir);
  }
});

// #87 economy: the owned-gear conversion is real money and must not evaporate when the receipt moves.
// enemyDrops.js pays OWNED_GEAR_COIN_CONVERSION extra coins when a gear roll lands on something the
// hero already has ("never a wasted roll"). Those coins used to reach the child as ground pickups; now
// they can only reach them through the claim, so if requestEnemyDrop's post-conversion count were not
// the number handed to the claim, a hero would silently lose the whole conversion.
test('#87 economy: an owned-gear conversion still pays, through the personal claim', () => {
  const { dir, path } = tempDb();
  try {
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const rng = scripted(
      0.0, // coin roll -> min band (2 for frost-wolf)
      0.99, // heart roll misses
      0.1, // gear roll HITS
      0.0, // which gear item -> index 0, shield_ironwood, which a fresh guest ALREADY OWNS
    );
    const sim = singleEnemySimulation('frost-wolf', 'target', rewards, { rng });
    const player = sim.addPlayer('p-convert', { x: 0, z: 7 });
    rewards.join(player.id, 'guest-convert');
    assert.ok(rewards.ownedItemIdsFor(player.id).includes(SHIELD_IRONWOOD_ID),
      'precondition: a joined guest starts owning the shield, which is what makes this roll a conversion');
    fightToDeath(sim, [player], 'target');

    const claim = sim.corpsesSnapshot()[0]?.claims.find((c) => c.heroId === player.id);
    assert.ok(claim, 'the kill still leaves a claim');
    assert.equal(claim.items.some((item) => item.kind === 'gear'), false,
      'the already-owned roll must be suppressed as gear -- that is the suppression law');
    const coins = claim.items.find((item) => item.kind === CORPSE_COIN_KIND);
    // 2 from the band + OWNED_GEAR_COIN_CONVERSION (5). Asserted as "more than the plain band"
    // rather than a restated literal, so a future conversion re-tuning does not silently pass here.
    assert.ok(coins.amount > 2,
      `the conversion coins must ride the claim, not vanish -- got ${coins.amount}, expected more than the plain band of 2`);
    assert.equal(coins.amount, 7, '2 from the band plus the 5-coin owned-gear conversion');
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

// #87 co-op: each eligible contributor gets their OWN ordinary loot, and the killing blow does not
// monopolise it. The dispatch asked whether preserving streak semantics for a non-killer needed a new
// progression subsystem: it does not. streakByPlayer is already a truthful per-player authority, so a
// contributor's coins are rolled from the same band at their own honest multiplier.
test('#87 co-op: both contributors get their own coin claim, and the killer does not monopolise it', () => {
  const { dir, path } = tempDb();
  try {
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const rng = scripted(0.0, 0.99); // min band, heart misses, no gear on a common wolf
    const sim = singleEnemySimulation('wolf', 'target', rewards, { rng });
    const a = sim.addPlayer('hero-a', { x: 0, z: 7 });
    const b = sim.addPlayer('hero-b', { x: 0.6, z: 7 });
    rewards.join(a.id, 'guest-a');
    rewards.join(b.id, 'guest-b');
    fightToDeath(sim, [a, b], 'target');

    const corpse = sim.corpsesSnapshot()[0];
    assert.ok(corpse, 'a real two-contributor kill must leave a corpse');
    for (const hero of [a, b]) {
      const claim = corpse.claims.find((c) => c.heroId === hero.id);
      assert.ok(claim, `every eligible contributor holds their own claim (missing for ${hero.id})`);
      const coins = claim.items.find((item) => item.kind === CORPSE_COIN_KIND);
      assert.ok(coins && coins.amount > 0,
        `an assisting contributor must receive real coins of their own, not nothing (${hero.id})`);
    }
    // Independent objects, not a shared one: distinct item ids are what makes A's collect incapable
    // of touching B's (the isolation law test/corpse-loot.test.mjs proves at the claim level).
    const [claimA, claimB] = [a, b].map((hero) => corpse.claims.find((c) => c.heroId === hero.id));
    const coinIdA = claimA.items.find((item) => item.kind === CORPSE_COIN_KIND).id;
    const coinIdB = claimB.items.find((item) => item.kind === CORPSE_COIN_KIND).id;
    assert.notEqual(coinIdA, coinIdB, 'each hero\'s coin row is their own object with its own id');

    // And A taking theirs leaves B's untouched.
    assert.equal(sim.applyClaimCorpseItem(a.id, corpse.id, coinIdA).accepted, true);
    const after = sim.corpsesSnapshot().find((c) => c.id === corpse.id);
    const bAfter = after.claims.find((c) => c.heroId === b.id);
    assert.equal(bAfter.items.every((item) => item.taken === false), true,
      'one sibling collecting must never resolve the other sibling\'s coins');
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});
