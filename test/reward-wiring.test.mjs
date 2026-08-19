// D3: the wiring between combat events and durable marks -- net/gameServer.mjs's
// createRewardCoordinator(), driven directly against createSimulation() with no HTTP server and no
// real timers, the same "the simulation, with time injected" style test/gameServer-encounter.test.mjs
// already uses. This is what proves the brief's three D3 acceptance bullets:
//   - kill a wolf with two contributing heroes -> both persisted
//   - reconnect with the same guestId -> welcome (here: rewardsFor after a fresh coordinator) carries
//     the marks
//   - third kill -> lantern-unlocked exactly once, ever, even across a store restart

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WOLF_SPAWN, createRewardCoordinator, createSimulation } from '../net/gameServer.mjs';
import { SWING_CONTACT_SECONDS } from '../public/src/combat/encounter.js';
import { attackMessage, decode, encode } from '../public/src/net/protocol.js';
import { MARKS_TO_UNLOCK } from '../public/src/rewards/marks.js';
import { DEFAULT_EQUIPPED_WEAPON_ID, STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
import { COIN_KIND, SHARD_KIND } from '../public/src/world/cartLoot.js';
import { remainingVillageSupplies } from '../public/src/village/economy.js';
import { openRewardStore } from '../net/rewardStore.mjs';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-reward-wiring-'));
  return { dir, path: join(dir, 'rewards.db') };
}

// Best-effort. Windows can hold a just-closed SQLite file handle (or an antivirus scan of a
// freshly-written one) open for longer than any bounded retry loop here should wait on -- and
// cleanup succeeding or not is not part of what any test in this file is actually proving. The
// temp dir is OS scratch either way.
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

// Wolf is WOLF_MAX_HP (3) hp: two players trading swings from the same spot, alternating seq
// numbers, kills it in a handful of contact windows without either exceeding the attack cooldown.
function fightWolfToDeath(sim, players) {
  let seq = 1;
  let rounds = 0;
  while (sim.encounterSnapshot().wolf.hp > 0 && rounds < 20) {
    for (const player of players) attack(sim, player.id, seq++);
    stepTicks(sim, Math.ceil(SWING_CONTACT_SECONDS / 0.05) + 1);
    rounds += 1;
  }
}

test('two contributing heroes killing one wolf both get a mark, durably', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    const b = sim.addPlayer('b', meleeSpot());
    rewards.join(a.id, 'guest-aaaaaaaa');
    rewards.join(b.id, 'guest-bbbbbbbb');

    fightWolfToDeath(sim, [a, b]);
    assert.equal(sim.encounterSnapshot().wolf.hp, 0, 'the wolf must actually be dead for this test to mean anything');

    const events = sim.drainEvents();
    const rewardEvents = rewards.processTick(events);
    assert.ok(rewardEvents.some((e) => e.type === 'mark-earned' && e.heroId === a.id));
    assert.ok(rewardEvents.some((e) => e.type === 'mark-earned' && e.heroId === b.id));

    const snapshot = rewards.rewardsFor([a.id, b.id]);
    assert.equal(snapshot[a.id].marks, 1);
    assert.equal(snapshot[b.id].marks, 1);

    // Durable: a brand-new store opened at the SAME path, independent of the coordinator, sees it.
    const reopened = openRewardStore(path);
    assert.equal(reopened.marksFor('guest-aaaaaaaa'), 1);
    assert.equal(reopened.marksFor('guest-bbbbbbbb'), 1);
    reopened.close();

    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('reconnecting with the same guestId sees the persisted marks immediately, under a new playerId', () => {
  const { dir, path } = tempDb();
  try {
    // One long-lived simulation and coordinator, the same as a real server that keeps running
    // across a dropped connection -- createSimulation's own playerId counter (`p1`, `p2`, ...)
    // never resets while the process is alive, so a genuine reconnect always lands on a fresh id.
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a1 = sim.addPlayer('a', meleeSpot());
    rewards.join(a1.id, 'guest-reconnect1');

    fightWolfToDeath(sim, [a1]);
    const rewardEvents1 = rewards.processTick(sim.drainEvents());
    assert.ok(rewardEvents1.some((e) => e.type === 'mark-earned' && e.heroId === a1.id));
    assert.equal(rewards.rewardsFor([a1.id])[a1.id].marks, 1);

    // The connection drops (onClose) and reconnects (a fresh join) -- exactly gameServer.mjs's own
    // onClose/join handlers, at the level this coordinator is actually driven from.
    sim.removePlayer(a1.id);
    rewards.leave(a1.id);

    const a2 = sim.addPlayer('a', meleeSpot());
    assert.notEqual(a2.id, a1.id, 'a reconnect gets a fresh playerId -- the guestId is what persists');
    rewards.join(a2.id, 'guest-reconnect1');

    const welcomeRewards = rewards.rewardsFor([a2.id]);
    assert.equal(welcomeRewards[a2.id].marks, 1, 'the reconnected guest must see its persisted mark immediately');
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('the third kill unlocks the lantern exactly once, even across a store restart', () => {
  const { dir, path } = tempDb();
  try {
    const guestId = 'guest-lantern-01';

    // Kills 1 and 2: no unlock yet.
    for (let life = 0; life < 2; life += 1) {
      const sim = createSimulation();
      const rewards = createRewardCoordinator({ rewardStorePath: path });
      const player = sim.addPlayer('a', meleeSpot());
      rewards.join(player.id, guestId);
      fightWolfToDeath(sim, [player]);
      const events = rewards.processTick(sim.drainEvents());
      assert.equal(events.filter((e) => e.type === 'lantern-unlocked').length, 0,
        `no unlock expected before ${MARKS_TO_UNLOCK} marks (life ${life})`);
      rewards.close();
    }

    // Kill 3, in its own fresh coordinator (a "restart"): the unlock must fire exactly once, here.
    {
      const sim = createSimulation();
      const rewards = createRewardCoordinator({ rewardStorePath: path });
      const player = sim.addPlayer('a', meleeSpot());
      rewards.join(player.id, guestId);
      fightWolfToDeath(sim, [player]);
      const events = rewards.processTick(sim.drainEvents());
      const unlocks = events.filter((e) => e.type === 'lantern-unlocked');
      assert.equal(unlocks.length, 1, `expected exactly one lantern-unlocked, got ${JSON.stringify(events)}`);
      assert.equal(rewards.rewardsFor([player.id])[player.id].marks, MARKS_TO_UNLOCK);
      assert.equal(rewards.rewardsFor([player.id])[player.id].lanternUnlocked, true);
      rewards.close();
    }

    // Kill 4, ANOTHER restart: already unlocked, so no second lantern-unlocked event, ever.
    {
      const sim = createSimulation();
      const rewards = createRewardCoordinator({ rewardStorePath: path });
      const player = sim.addPlayer('a', meleeSpot());
      rewards.join(player.id, guestId);
      fightWolfToDeath(sim, [player]);
      const events = rewards.processTick(sim.drainEvents());
      assert.equal(events.filter((e) => e.type === 'lantern-unlocked').length, 0,
        'a fourth kill must not unlock the lantern a second time');
      rewards.close();
    }
  } finally {
    cleanupTempDb(dir);
  }
});

test('a guestId-less (ephemeral) hero still earns marks for the session, but nothing persists', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const player = sim.addPlayer('a', meleeSpot());
    // No rewards.join() call at all -- an ephemeral connection, same as a pre-D3 client or one
    // whose localStorage threw.

    fightWolfToDeath(sim, [player]);
    const events = rewards.processTick(sim.drainEvents());
    assert.ok(events.some((e) => e.type === 'mark-earned' && e.heroId === player.id));
    assert.equal(rewards.rewardsFor([player.id])[player.id].marks, 1);
    rewards.close();

    // Nothing was ever written to the durable store -- an ephemeral hero leaves no trace there.
    const reopened = openRewardStore(path);
    // No guestId was ever used, so there is nothing to look up by; the store itself must simply be
    // empty of mark-earned rows for any guest this session invented.
    assert.equal(reopened.marksFor('guest-never-joined'), 0);
    reopened.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP1: a fresh hero reads the starter sword equipped, with no equip ever sent', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    rewards.join(a.id, 'guest-equip-default');
    assert.equal(rewards.rewardsFor([a.id])[a.id].equippedWeaponId, DEFAULT_EQUIPPED_WEAPON_ID);
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP1-C1: a fresh guested hero cannot equip the Blade -- it is not owned until granted', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    rewards.join(a.id, 'guest-equip-unowned');
    assert.throws(() => rewards.applyEquip(a.id, WILDWOOD_BLADE_ID), /does not own/i);
    assert.equal(rewards.rewardsFor([a.id])[a.id].equippedWeaponId, DEFAULT_EQUIPPED_WEAPON_ID,
      'a rejected equip must not have changed anything');
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP1: equipping a guested hero persists durably and survives a coordinator restart', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    rewards.join(a.id, 'guest-equip-durable');
    // GP1-C1: the Blade is not owned by default -- this coordinator-level fixture hook is the same
    // seam a browser harness reaches by seeding net/rewardStore.mjs directly (drive-hero-screen.mjs);
    // no client message can do this (see grantOwnership's own header comment in net/gameServer.mjs).
    rewards.grantOwnership(a.id, WILDWOOD_BLADE_ID);

    rewards.applyEquip(a.id, WILDWOOD_BLADE_ID);
    assert.equal(rewards.rewardsFor([a.id])[a.id].equippedWeaponId, WILDWOOD_BLADE_ID);
    rewards.close();

    // A brand-new coordinator (same store path) sees it immediately -- same "reconnect sees persisted
    // state" guarantee marks already carry, proven the same way that test proves it above.
    const restarted = createRewardCoordinator({ rewardStorePath: path });
    const b = sim.addPlayer('b', meleeSpot());
    restarted.join(b.id, 'guest-equip-durable');
    assert.equal(restarted.rewardsFor([b.id])[b.id].equippedWeaponId, WILDWOOD_BLADE_ID);
    restarted.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP1: restart, equip again, restart preserves the NEW choice rather than replaying an old event id', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const guestId = 'guest-equip-after-restart';

    const first = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    first.join(a.id, guestId);
    first.grantOwnership(a.id, WILDWOOD_BLADE_ID);
    first.applyEquip(a.id, WILDWOOD_BLADE_ID);
    first.close();

    const second = createRewardCoordinator({ rewardStorePath: path });
    const b = sim.addPlayer('b', meleeSpot());
    second.join(b.id, guestId);
    assert.equal(second.rewardsFor([b.id])[b.id].equippedWeaponId, WILDWOOD_BLADE_ID);
    second.applyEquip(b.id, STARTER_SWORD_ID);
    assert.equal(second.rewardsFor([b.id])[b.id].equippedWeaponId, STARTER_SWORD_ID,
      'the post-restart equip must be applied immediately, not swallowed by INSERT OR IGNORE');
    second.close();

    const third = createRewardCoordinator({ rewardStorePath: path });
    const c = sim.addPlayer('c', meleeSpot());
    third.join(c.id, guestId);
    assert.equal(third.rewardsFor([c.id])[c.id].equippedWeaponId, STARTER_SWORD_ID,
      'the newer post-restart choice must survive another restart');
    third.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP1: switching weapons switches back -- the latest equip wins, not the first', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    rewards.join(a.id, 'guest-equip-switch');
    rewards.grantOwnership(a.id, WILDWOOD_BLADE_ID);

    rewards.applyEquip(a.id, WILDWOOD_BLADE_ID);
    rewards.applyEquip(a.id, STARTER_SWORD_ID);
    assert.equal(rewards.rewardsFor([a.id])[a.id].equippedWeaponId, STARTER_SWORD_ID);
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP1: an ephemeral (guestId-less) hero can equip the item it already owns (starter sword) for the session, no persistence', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    // No rewards.join() -- ephemeral, same convention every other test in this file uses for it.

    rewards.applyEquip(a.id, STARTER_SWORD_ID);
    assert.equal(rewards.rewardsFor([a.id])[a.id].equippedWeaponId, STARTER_SWORD_ID);
    rewards.close();

    const reopened = openRewardStore(path);
    assert.equal(reopened.equippedWeaponFor('guest-never-joined-equip'), null);
    reopened.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP1-C1: an ephemeral hero cannot equip the Blade -- there is no durable path to grant it ownership', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    // grantOwnership is a no-op with no guestId (see its own header comment) -- confirming that here
    // rather than only asserting the resulting throw, so a future change that silently makes grants
    // "work" for ephemeral connections is caught even if applyEquip's own check is ever loosened.
    rewards.grantOwnership(a.id, WILDWOOD_BLADE_ID);
    assert.throws(() => rewards.applyEquip(a.id, WILDWOOD_BLADE_ID), /does not own/i);
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP1: equipping an unknown item id throws rather than silently accepting garbage', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    rewards.join(a.id, 'guest-equip-garbage');
    assert.throws(() => rewards.applyEquip(a.id, 'not-a-real-weapon'), /unknown weapon id/i);
    // The rejected attempt must not have overwritten anything.
    assert.equal(rewards.rewardsFor([a.id])[a.id].equippedWeaponId, DEFAULT_EQUIPPED_WEAPON_ID);
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP1: leaving clears the in-memory ephemeral-equip bookkeeping, not just the map entry for a stranger', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a1 = sim.addPlayer('a', meleeSpot());
    // GP1-C1 note: ephemeral connections can only ever legally equip the starter sword (no durable
    // grant path -- see grantOwnership's own header), which is also the default, so this can no
    // longer distinguish "equipped, then cleared" from "never set" by VALUE alone the way it could
    // pre-C1 with the Blade. What it still genuinely proves: leave() does not throw or leave a
    // dangling reference that a later rewardsFor() call for the SAME (departed) playerId would trip
    // over -- a real regression class (a Map entry outliving its connection) even though the value
    // happens to be unobservable here.
    rewards.applyEquip(a1.id, STARTER_SWORD_ID);
    rewards.leave(a1.id);
    assert.doesNotThrow(() => rewards.rewardsFor([a1.id]));
    assert.equal(rewards.rewardsFor([a1.id])[a1.id].equippedWeaponId, DEFAULT_EQUIPPED_WEAPON_ID);
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

// ── GP2: Rowan's cart's coins and Wildwood Shards ───────────────────────────────────────────────

test('GP2: a collected coin and shard persist durably and survive a coordinator restart', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    rewards.join(a.id, 'guest-cart-durable');

    rewards.applyLootAward(a.id, 'cart-loot:coin:0', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:shard:0', SHARD_KIND);
    assert.equal(rewards.rewardsFor([a.id])[a.id].coins, 1);
    assert.equal(rewards.rewardsFor([a.id])[a.id].shards, 1);
    rewards.close();

    // A brand-new coordinator (same store path) sees it immediately -- same "reconnect sees
    // persisted state" guarantee marks/equip already carry, proven the same way.
    const restarted = createRewardCoordinator({ rewardStorePath: path });
    const b = sim.addPlayer('b', meleeSpot());
    restarted.join(b.id, 'guest-cart-durable');
    assert.equal(restarted.rewardsFor([b.id])[b.id].coins, 1);
    assert.equal(restarted.rewardsFor([b.id])[b.id].shards, 1);
    restarted.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP2: two different pickups of the same kind both count -- coins accumulate, they do not just flip a flag', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    rewards.join(a.id, 'guest-cart-accumulate');
    rewards.applyLootAward(a.id, 'cart-loot:coin:0', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:coin:1', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:coin:2', COIN_KIND);
    assert.equal(rewards.rewardsFor([a.id])[a.id].coins, 3);
    assert.equal(rewards.rewardsFor([a.id])[a.id].shards, 0, 'no shard was ever awarded to this guest');
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP2: an ephemeral (guestId-less) hero still gets its coins/shards for the session, no persistence', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    // No rewards.join() -- ephemeral, same convention every other test in this file uses for it.
    rewards.applyLootAward(a.id, 'cart-loot:coin:0', COIN_KIND);
    assert.equal(rewards.rewardsFor([a.id])[a.id].coins, 1, 'still counted for the live session');
    rewards.close();

    // Nothing durable was ever written -- there was no guestId to write it under.
    const reopened = openRewardStore(path);
    assert.equal(reopened.coinsFor('guest-never-joined-cart'), 0);
    reopened.close();
  } finally {
    cleanupTempDb(dir);
  }
});

// ── GP3-0: restart coherence ─────────────────────────────────────────────────────────────────

test('GP3-0: already-credited pickups do not reappear as fresh collectible loot after a restart', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    rewards.join(a.id, 'guest-cart-restart');

    rewards.applyLootAward(a.id, 'cart-loot:coin:0', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:shard:0', SHARD_KIND);
    assert.deepEqual(
      [...rewards.creditedLootIds()].sort(),
      ['cart-loot:coin:0', 'cart-loot:shard:0'],
    );
    rewards.close();

    // The exact wiring net/gameServer.mjs's attachGameServer performs at real boot: a fresh
    // simulation seeded from whatever the reopened store already knows is durably credited.
    const restartedRewards = createRewardCoordinator({ rewardStorePath: path });
    const restartedSim = createSimulation({ creditedLootIds: restartedRewards.creditedLootIds() });

    const loot = restartedSim.lootSnapshot();
    assert.equal(loot.spawned, true, 'a cart with any credited pickup must present as already searched');
    assert.equal(Object.keys(loot.collected).length, 2, 'both previously credited pickups stay collected');
    assert.ok(loot.collected['cart-loot:coin:0'] != null, 'the credited coin stays marked collected');
    assert.ok(loot.collected['cart-loot:shard:0'] != null, 'the credited shard stays marked collected');
    // Only the two ALREADY-credited pickups are pinned collected -- an untouched one is still there
    // to find, so a restart does not silently empty the whole cart.
    assert.equal(loot.collected['cart-loot:coin:1'], undefined);

    const b = restartedSim.addPlayer('b', meleeSpot());
    const result = restartedSim.applyCollectLoot(b.id, 'cart-loot:coin:0');
    assert.equal(result.accepted, false, 'an already-credited pickup cannot be collected again after restart');
    restartedRewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP3-0: an untouched cart restarts genuinely fresh -- nothing credited, nothing pinned', () => {
  const { dir, path } = tempDb();
  try {
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    assert.deepEqual(rewards.creditedLootIds(), []);
    rewards.close();

    const restartedRewards = createRewardCoordinator({ rewardStorePath: path });
    const restartedSim = createSimulation({ creditedLootIds: restartedRewards.creditedLootIds() });
    const loot = restartedSim.lootSnapshot();
    assert.equal(loot.spawned, false);
    assert.deepEqual(loot.collected, {});
    restartedRewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP2: leaving clears the in-memory ephemeral-loot bookkeeping without throwing', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    rewards.applyLootAward(a.id, 'cart-loot:coin:0', COIN_KIND);
    rewards.leave(a.id);
    assert.doesNotThrow(() => rewards.rewardsFor([a.id]));
    assert.equal(rewards.rewardsFor([a.id])[a.id].coins, 0, 'the departed connection\'s ephemeral count is gone');
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

// ── GP3-1: Village Supplies (shared) and the Workshop I purchase ────────────────────────────────

test('GP3-1: villageSnapshot starts at zero/unowned, then tracks the shared total across BOTH guests', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    const b = sim.addPlayer('b', meleeSpot());
    rewards.join(a.id, 'guest-brother-a');
    rewards.join(b.id, 'guest-brother-b');

    assert.deepEqual(rewards.villageSnapshot(), { coins: 0, shards: 0, workshopOwned: false });

    // The guaranteed GP2 haul, split across both brothers -- provenance stays personal, but the
    // Village Supplies total pools it (the brief's own "if either brother collects a pickup, it
    // contributes to the same Workshop budget").
    rewards.applyLootAward(a.id, 'cart-loot:coin:0', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:coin:1', COIN_KIND);
    rewards.applyLootAward(b.id, 'cart-loot:coin:2', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:shard:0', SHARD_KIND);
    rewards.applyLootAward(b.id, 'cart-loot:shard:1', SHARD_KIND);

    assert.deepEqual(rewards.villageSnapshot(), { coins: 3, shards: 2, workshopOwned: false });
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP3-1: buying Workshop I spends 2 coins + 1 shard, leaving exactly 1 coin + 1 shard, per the brief', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    rewards.join(a.id, 'guest-buyer');
    rewards.applyLootAward(a.id, 'cart-loot:coin:0', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:coin:1', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:coin:2', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:shard:0', SHARD_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:shard:1', SHARD_KIND);

    const result = rewards.applyVillageUpgradePurchase(a.id, 'village-upgrade:workshop:1');
    assert.equal(result.accepted, true);
    // GP3-1 does not itself subtract a stored balance -- villageSnapshot's coins/shards stay the
    // TOTAL EARNED (2.2's "preferred minimal architecture": no second mutable truth). "1 coin / 1
    // shard left" is what village/economy.js's remainingVillageSupplies derives from this exact
    // snapshot -- proven against the real snapshot shape here, not just in the pure module's own
    // isolated unit tests.
    const snapshot = rewards.villageSnapshot();
    assert.deepEqual(snapshot, { coins: 3, shards: 2, workshopOwned: true });
    assert.deepEqual(
      remainingVillageSupplies(snapshot.coins, snapshot.shards, snapshot.workshopOwned),
      { coins: 1, shards: 1 },
    );
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP3-1: Workshop I cannot be bought without enough Village Supplies', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    rewards.join(a.id, 'guest-broke');
    rewards.applyLootAward(a.id, 'cart-loot:coin:0', COIN_KIND); // 1 coin, 0 shards -- short on both

    const result = rewards.applyVillageUpgradePurchase(a.id, 'village-upgrade:workshop:1');
    assert.equal(result.accepted, false);
    assert.deepEqual(rewards.villageSnapshot(), { coins: 1, shards: 0, workshopOwned: false });
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP3-1: two simultaneous purchase attempts (the sibling race) -- only one buys, funds spend once', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    const b = sim.addPlayer('b', meleeSpot());
    rewards.join(a.id, 'guest-race-a');
    rewards.join(b.id, 'guest-race-b');
    rewards.applyLootAward(a.id, 'cart-loot:coin:0', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:coin:1', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:coin:2', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:shard:0', SHARD_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:shard:1', SHARD_KIND);

    // Node's single-threaded event loop already serialises these two calls -- there is no real
    // interleaving to force -- so this proves the OUTCOME a genuine race would need to hold: exactly
    // one of the two requests wins, and Village Supplies is spent exactly once, not twice.
    const first = rewards.applyVillageUpgradePurchase(a.id, 'village-upgrade:workshop:1');
    const second = rewards.applyVillageUpgradePurchase(b.id, 'village-upgrade:workshop:1');
    assert.equal(first.accepted, true, 'the first request to arrive buys it');
    assert.equal(second.accepted, false, 'the second request must not also buy it');
    assert.deepEqual(rewards.villageSnapshot(), { coins: 3, shards: 2, workshopOwned: true });
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP3-1: Workshop I ownership and Village Supplies survive a coordinator restart', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    rewards.join(a.id, 'guest-restart-buyer');
    rewards.applyLootAward(a.id, 'cart-loot:coin:0', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:coin:1', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:coin:2', COIN_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:shard:0', SHARD_KIND);
    rewards.applyLootAward(a.id, 'cart-loot:shard:1', SHARD_KIND);
    rewards.applyVillageUpgradePurchase(a.id, 'village-upgrade:workshop:1');
    rewards.close();

    const restarted = createRewardCoordinator({ rewardStorePath: path });
    assert.deepEqual(restarted.villageSnapshot(), { coins: 3, shards: 2, workshopOwned: true });
    // And it stays refused -- a reconnecting sibling cannot re-buy an already-owned Workshop I.
    const b = sim.addPlayer('b', meleeSpot());
    restarted.join(b.id, 'guest-restart-sibling');
    const replay = restarted.applyVillageUpgradePurchase(b.id, 'village-upgrade:workshop:1');
    assert.equal(replay.accepted, false);
    restarted.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP3-1: an ephemeral (guestId-less) hero cannot purchase -- there is no durable identity to record', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    // No rewards.join() -- ephemeral, same convention every other test in this file uses for it.
    // An ephemeral pickup never reaches the store either (applyLootAward's own ephemeral branch), so
    // there is nothing durable to spend against in the first place.
    const result = rewards.applyVillageUpgradePurchase(a.id, 'village-upgrade:workshop:1');
    assert.equal(result.accepted, false);
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});

test('GP3-1: an unknown upgrade id throws rather than silently accepting garbage', () => {
  const { dir, path } = tempDb();
  try {
    const sim = createSimulation();
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    const a = sim.addPlayer('a', meleeSpot());
    rewards.join(a.id, 'guest-hostile');
    assert.throws(() => rewards.applyVillageUpgradePurchase(a.id, 'village-upgrade:not-a-real-upgrade'));
    rewards.close();
  } finally {
    cleanupTempDb(dir);
  }
});
