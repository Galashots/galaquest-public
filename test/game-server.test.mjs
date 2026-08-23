import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  STALE_INPUT_MS,
  WORLD_LIMIT,
  WORLD_LIMIT_EAST,
  WORLD_LIMIT_NORTH,
  attachGameServer,
  clampToWorldX,
  createRewardCoordinator,
  createSimulation,
} from '../net/gameServer.mjs';
import { RUN_SPEED, WALK_SPEED, groundSpeedForInput } from '../public/src/character/speed.js';
import {
  PROTOCOL_VERSION,
  collectLootMessage,
  encode,
  decode,
  equipMessage,
  inputMessage,
  joinMessage,
  searchCartMessage,
  snapshotMessage,
  villageUpgradePurchaseMessage,
} from '../public/src/net/protocol.js';
import { DEFAULT_EQUIPPED_WEAPON_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
import { CART_LOOT_TABLE, pickupWorldPosition } from '../public/src/world/cartLoot.js';
import { CART_SEARCH } from '../public/src/world/zones/village.js';
import { WORKSHOP_I_ID } from '../public/src/village/economy.js';
import { openRewardStore } from '../net/rewardStore.mjs';

// ── the simulation, with time injected so nothing has to sleep ─────────────────────────────────

test('the server moves a player at the same speed law the client predicts with', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  let now = 1000;
  sim.applyInput(player.id, decode(encode(inputMessage(1, 0, 1, 1, false))), now);

  // One second of walking, in 20 steps of 50ms, exactly as the real tick would.
  for (let i = 0; i < 20; i += 1) {
    now += 50;
    sim.step(0.05, now);
  }
  // The authority here is the shared function, not a number retyped from the client.
  const expected = groundSpeedForInput(1, false);
  assert.equal(expected, WALK_SPEED);
  assert.ok(Math.abs(player.z - expected) < 1e-9, `walked ${player.z}, expected ${expected}`);
  assert.equal(player.speed, WALK_SPEED);
});

test('a half-deflected stick travels half as far, not a quarter', () => {
  // The squared-magnitude defect (c75242c) fixed client-side would be just as wrong here, and the
  // server is the authority, so it gets its own guard.
  //
  // Checked as a RATIO between two pushes, not against a hardcoded WALK_SPEED / 2. It was the latter
  // until 2026-08-15, when the walk curve was re-scaled to reach WALK_SPEED at RUN_DEFLECTION (see
  // character/speed.js, and younger players' "too slow" in the private engineering archive) -- at which point the test
  // failed for a reason that had nothing to do with the defect it exists to catch. Linearity IS the
  // defect's absence, and it survives any re-tune of the constants.
  const walked = (magnitude) => {
    const sim = createSimulation();
    const player = sim.addPlayer('kid');
    sim.applyInput(player.id, decode(encode(inputMessage(1, 0, 1, magnitude, false))), 1000);
    for (let i = 0; i < 20; i += 1) sim.step(0.05, 1000 + i * 50);
    return player.z;
  };
  const quarter = walked(0.25);
  const half = walked(0.5);
  assert.ok(
    Math.abs(half / quarter - 2) < 1e-9,
    `half a push travelled ${half.toFixed(4)} against ${quarter.toFixed(4)} for a quarter push`,
  );
  // And one second at a full walking push still covers exactly WALK_SPEED, which is the keyboard's
  // own case and the anchor the ratio above hangs from.
  assert.ok(Math.abs(walked(1) - WALK_SPEED) < 1e-9);
});

test('running is faster than walking, by the shared law', () => {
  const walk = createSimulation();
  const run = createSimulation();
  const a = walk.addPlayer('a');
  const b = run.addPlayer('b');
  walk.applyInput(a.id, decode(encode(inputMessage(1, 0, 1, 1, false))), 1000);
  run.applyInput(b.id, decode(encode(inputMessage(1, 0, 1, 1, true))), 1000);
  for (let i = 0; i < 10; i += 1) {
    walk.step(0.05, 1000 + i * 50);
    run.step(0.05, 1000 + i * 50);
  }
  assert.ok(b.z > a.z, 'running should cover more ground');
  assert.ok(Math.abs(b.z / a.z - RUN_SPEED / WALK_SPEED) < 1e-9, 'ratio should be the speed ratio');
});

test('heading follows the direction of travel', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  // Straight along +X: atan2(dirX, dirZ) = atan2(1, 0) = PI/2.
  sim.applyInput(player.id, decode(encode(inputMessage(1, 1, 0, 1, false))), 1000);
  sim.step(0.05, 1050);
  assert.ok(Math.abs(player.heading - Math.PI / 2) < 1e-9, `heading ${player.heading}`);
  assert.ok(player.x > 0 && Math.abs(player.z) < 1e-12, 'should have moved along +X only');
});

test('a stale input stops the player, so a dropped connection cannot run forever', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  let now = 1000;
  const zAtRest = player.z;
  sim.applyInput(player.id, decode(encode(inputMessage(1, 0, 1, 1, true))), now);
  now += 100;
  sim.step(0.1, now);
  assert.ok(player.speed > 0, 'should be moving while the input is fresh');
  assert.ok(player.z > zAtRest, 'it did move while the input was fresh');

  // The client vanishes mid-stride: no release message ever arrives.
  now += STALE_INPUT_MS + 1;
  sim.step(0.05, now);
  assert.equal(player.speed, 0, 'a stale input must stop the player');
  const zAfterStale = player.z;
  now += 1000;
  for (let i = 0; i < 20; i += 1) sim.step(0.05, now + i * 50);
  assert.equal(player.z, zAfterStale, 'and it must stay stopped');
});

test('a player is clamped inside the world instead of walking off it', () => {
  assert.equal(clampToWorldX(WORLD_LIMIT_EAST + 5), WORLD_LIMIT_EAST);
  assert.equal(clampToWorldX(-WORLD_LIMIT - 5), -WORLD_LIMIT);
  assert.equal(clampToWorldX(0), 0);

  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  let now = 1000;
  // Run at the boundary for a minute of simulated time, refreshing the input so it never goes stale.
  // NORTH, and the expected value is WORLD_LIMIT_NORTH since 2026-08-15: the world grew that way for
  // the Wildwood. This line used to read WORLD_LIMIT and would have gone on passing against a server
  // that clamped z with the x limit -- exactly the defect the two-clamp split exists to prevent --
  // because the two numbers were equal right up until the day they were not.
  for (let i = 0; i < 1200; i += 1) {
    now += 50;
    sim.applyInput(player.id, decode(encode(inputMessage(i + 1, 0, 1, 1, true))), now);
    sim.step(0.05, now);
  }
  assert.equal(player.z, WORLD_LIMIT_NORTH, `escaped to ${player.z}`);
  assert.ok(Number.isFinite(player.x) && Number.isFinite(player.z), 'position stayed finite');
});

// EAST, and the expected value is WORLD_LIMIT_EAST since 2026-08-20 -- the world grew that way for
// Arc 2's road to the Ranger Lodge. This test used to be titled "the world only grew north" and
// asserted WORLD_LIMIT, which was true right up until the day it was not; it is kept (rather than
// deleted as obsolete) precisely because a server that clamped x with the WEST limit would sail
// through a test that only ever walked west, and the two numbers are no longer the same.
test('a player walking EAST is stopped at the new eastern edge, not the old village one', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  let now = 1000;
  for (let i = 0; i < 1200; i += 1) {
    now += 50;
    sim.applyInput(player.id, decode(encode(inputMessage(i + 1, 1, 0, 1, true))), now);
    sim.step(0.05, now);
  }
  assert.equal(player.x, WORLD_LIMIT_EAST, `escaped to ${player.x}`);
  assert.notEqual(WORLD_LIMIT_EAST, WORLD_LIMIT,
    'this assertion is only load-bearing while the two edges differ');
});

test('and a player walking WEST is still stopped where the village always ended', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  let now = 1000;
  for (let i = 0; i < 1200; i += 1) {
    now += 50;
    sim.applyInput(player.id, decode(encode(inputMessage(i + 1, -1, 0, 1, true))), now);
    sim.step(0.05, now);
  }
  assert.equal(player.x, -WORLD_LIMIT, `escaped to ${player.x}`);
});

test('replayed or out-of-order input is ignored', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  sim.applyInput(player.id, decode(encode(inputMessage(5, 0, 1, 1, false))), 1000);
  assert.equal(sim.applyInput(player.id, decode(encode(inputMessage(4, 1, 0, 1, false))), 1001),
    false, 'an older seq should be refused');
  assert.equal(sim.applyInput(player.id, decode(encode(inputMessage(5, 1, 0, 1, false))), 1001),
    false, 'a replayed seq should be refused');
  assert.equal(player.input.dirZ, 1, 'the newer direction should survive');
  assert.equal(sim.applyInput(player.id, decode(encode(inputMessage(6, 1, 0, 1, false))), 1002),
    true, 'a newer seq should be accepted');
});

test('snapshots round-trip through the protocol the client will decode with', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  sim.applyInput(player.id, decode(encode(inputMessage(1, 0, 1, 1, false))), 1000);
  sim.step(0.05, 1050);
  const decoded = decode(encode(snapshotMessage(sim.tick, sim.snapshot())));
  assert.equal(decoded.players.length, 1);
  assert.equal(decoded.players[0].id, player.id);
  assert.ok(decoded.players[0].z > 0);
});

// ── end to end, over a real socket ─────────────────────────────────────────────────────────────

// Every attachGameServer() in this file gets its own reward store under the OS temp dir -- never
// data/rewards.db. The real children's save must never be touched by a test run (data/README.md).
/**
 * @param options.seedOwnership  [{ guestId, itemId }], written durably BEFORE the server opens the
 *   store -- the same "seed, then start" order tools/runtime-test/drive-hero-screen.mjs uses against
 *   the real running game (net/rewardStore.mjs's own 'gear-owned' event), so a GP1-C1 fixture guest
 *   can equip an item this test grants it without a client message ever having to exist for "give
 *   yourself gear" (see net/gameServer.mjs's grantOwnership header for why that message is deliberately
 *   absent from the wire).
 */
async function withGameServer(body, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-game-server-'));
  const rewardStorePath = join(dir, 'rewards.db');
  if (options.seedOwnership?.length > 0) {
    const seedStore = openRewardStore(rewardStorePath);
    for (const { guestId, itemId } of options.seedOwnership) {
      seedStore.apply({ guestId, type: 'gear-owned', eventId: `own:${guestId}:${itemId}`, value: itemId });
    }
    seedStore.close();
  }
  const httpServer = createServer((_request, response) => response.writeHead(404).end());
  const game = attachGameServer(httpServer, { rewardStorePath, allowMissingOrigin: true });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  try {
    return await body({ url: `ws://127.0.0.1:${port}/ws`, game });
  } finally {
    game.stop();
    await new Promise((resolve) => httpServer.close(resolve));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function client(url) {
  const socket = new WebSocket(url);
  const messages = [];
  socket.addEventListener('message', (event) => messages.push(decode(event.data)));
  return {
    socket,
    messages,
    open: () => new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('failed to open')), { once: true });
    }),
    send: (message) => socket.send(encode(message)),
    of: (type) => messages.filter((m) => m.type === type),
    waitFor: async (type, count = 1, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      while (messages.filter((m) => m.type === type).length < count) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${count} ${type}; got `
            + JSON.stringify(messages.map((m) => m.type)));
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return messages.filter((m) => m.type === type);
    },
    // Wait for a snapshot that actually shows something, rather than for a number of snapshots to
    // have arrived. `waitFor` counts from the start of the session and returns everything seen so
    // far, so once the count is already satisfied it does not wait at all and `.at(-1)` hands back
    // whatever the newest snapshot happens to be -- which may predate the thing being asserted.
    waitForSnapshot: async (predicate, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const match = messages.filter((m) => m.type === 'snapshot').find(predicate);
        if (match) return match;
        if (Date.now() > deadline) throw new Error('timed out waiting for a matching snapshot');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
  };
}

test('two clients join, one walks, and both are told the same truth', async () => {
  await withGameServer(async ({ url }) => {
    const a = client(url);
    const b = client(url);
    await Promise.all([a.open(), b.open()]);
    a.send(joinMessage('kid-a'));
    b.send(joinMessage('kid-b'));
    const [welcomeA] = await a.waitFor('welcome');
    const [welcomeB] = await b.waitFor('welcome');
    assert.notEqual(welcomeA.id, welcomeB.id, 'ids must be distinct');

    // B's welcome should already list A, since A joined first.
    assert.ok(welcomeB.players.some((p) => p.id === welcomeA.id),
      'the second player should see the first in its welcome');

    // A walks forward for ~600ms of real time, resending input as a real client would.
    const started = Date.now();
    let seq = 0;
    while (Date.now() - started < 600) {
      a.send(inputMessage(seq += 1, 0, 1, 1, false));
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    const snapshotsB = await b.waitFor('snapshot', 3);
    const latest = snapshotsB.at(-1);
    assert.equal(latest.players.length, 2, 'both players should be in the snapshot');

    const aFromB = latest.players.find((p) => p.id === welcomeA.id);
    const bFromB = latest.players.find((p) => p.id === welcomeB.id);
    assert.ok(aFromB.z > 0.3, `A should have walked; snapshot says z=${aFromB.z}`);
    assert.equal(bFromB.z, 0, 'B never sent an input and must not have moved');

    // Both clients must be told the same thing about A -- that is what authoritative means.
    const latestFromA = (await a.waitFor('snapshot', 3)).at(-1);
    const aFromA = latestFromA.players.find((p) => p.id === welcomeA.id);
    assert.ok(Math.abs(aFromA.z - aFromB.z) < 1.0,
      `the two clients disagree about A: ${aFromA.z} vs ${aFromB.z}`);

    // Distance travelled has to be consistent with the shared speed law, not merely non-zero.
    const elapsedSeconds = (Date.now() - started) / 1000;
    assert.ok(aFromB.z <= WALK_SPEED * elapsedSeconds + 0.2,
      `travelled ${aFromB.z} in ${elapsedSeconds.toFixed(2)}s, faster than ${WALK_SPEED} m/s allows`);

    a.socket.close();
    b.socket.close();
  });
});

test('releasing the stick stops the hero on the server too', async () => {
  await withGameServer(async ({ url }) => {
    const a = client(url);
    await a.open();
    a.send(joinMessage('kid'));
    await a.waitFor('welcome');
    for (let i = 0; i < 6; i += 1) {
      a.send(inputMessage(i + 1, 0, 1, 1, false));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // The one zero-magnitude message a real client sends on release.
    a.send(inputMessage(100, 0, 0, 0, false));

    // Sample the resting position from the first snapshot that reports the stop, not from a
    // snapshot count. The walk lasts ~300ms and snapshots arrive every 100ms, so three have
    // usually landed before the release is even sent; asking for two of them returned instantly
    // with a mid-walk position, and the remaining walk distance then read as a slide. That is
    // what made this test fail roughly half of all runs.
    const stopped = await a.waitForSnapshot((snapshot) => snapshot.players[0].speed === 0);
    const before = stopped.players[0].z;

    // The actual claim is that a stopped hero stays stopped, so keep watching after the stop.
    const seen = a.of('snapshot').length;
    const after = (await a.waitFor('snapshot', seen + 4)).at(-1).players[0];
    assert.equal(after.speed, 0, 'speed should be zero after release');
    assert.ok(Math.abs(after.z - before) < 0.05,
      `kept sliding after release: ${before} -> ${after.z}`);
    a.socket.close();
  });
});

test('leaving broadcasts a leave to everyone still connected', async () => {
  await withGameServer(async ({ url }) => {
    const a = client(url);
    const b = client(url);
    await Promise.all([a.open(), b.open()]);
    a.send(joinMessage('kid-a'));
    b.send(joinMessage('kid-b'));
    const [welcomeA] = await a.waitFor('welcome');
    await b.waitFor('welcome');

    a.socket.close();
    const [leave] = await b.waitFor('leave');
    assert.equal(leave.id, welcomeA.id, 'B should be told exactly who left');

    // And the departed player must be gone from the simulation, not merely announced.
    const afterLeave = (await b.waitFor('snapshot', b.of('snapshot').length + 2)).at(-1);
    assert.ok(!afterLeave.players.some((p) => p.id === welcomeA.id),
      'the departed player should be out of the snapshots');
    b.socket.close();
  });
});

test('GP1: welcome carries the starter sword as the default equipped weapon', async () => {
  await withGameServer(async ({ url }) => {
    const a = client(url);
    await a.open();
    a.send(joinMessage('kid'));
    const [welcome] = await a.waitFor('welcome');
    assert.equal(welcome.encounter.rewards[welcome.id].equippedWeaponId, DEFAULT_EQUIPPED_WEAPON_ID);
    a.socket.close();
  });
});

test('GP1: equipping rides the next snapshot for every connected client, not just the sender', async () => {
  // GP1-C1: the Blade must be OWNED to equip it, so this fixture guest is granted it durably before
  // the server ever opens the store -- the coordinator-level equivalent of
  // tools/runtime-test/drive-hero-screen.mjs seeding the real running game's store directly.
  const guestId = 'guest-equip-snapshot-fixture';
  await withGameServer(async ({ url }) => {
    const a = client(url);
    const b = client(url);
    await Promise.all([a.open(), b.open()]);
    a.send(joinMessage('kid-a', guestId));
    b.send(joinMessage('kid-b'));
    const [welcomeA] = await a.waitFor('welcome');
    await b.waitFor('welcome');

    a.send(equipMessage(WILDWOOD_BLADE_ID));

    const seenByB = await b.waitForSnapshot(
      (snapshot) => snapshot.encounter.rewards[welcomeA.id]?.equippedWeaponId === WILDWOOD_BLADE_ID,
    );
    assert.equal(seenByB.encounter.rewards[welcomeA.id].equippedWeaponId, WILDWOOD_BLADE_ID,
      'B must see A\'s equip through the authoritative snapshot, the same as any other reward field');
    a.socket.close();
    b.socket.close();
  }, { seedOwnership: [{ guestId, itemId: WILDWOOD_BLADE_ID }] });
});

test('GP1-C1: equipping an item this player does not own is refused rather than silently accepted', async () => {
  await withGameServer(async ({ url }) => {
    const a = client(url);
    await a.open();
    a.send(joinMessage('kid', 'guest-equip-unowned-fixture'));
    await a.waitFor('welcome');
    const closed = new Promise((resolve) => {
      a.socket.addEventListener('close', (event) => resolve(event.code), { once: true });
    });
    a.send(equipMessage(WILDWOOD_BLADE_ID));
    assert.equal(await closed, 1008, 'expected a policy-violation close, same as any other rejected message');
  });
});

test('GP1: equipping an item nobody defined is refused rather than silently accepted', async () => {
  await withGameServer(async ({ url }) => {
    const a = client(url);
    await a.open();
    a.send(joinMessage('kid'));
    await a.waitFor('welcome');
    const closed = new Promise((resolve) => {
      a.socket.addEventListener('close', (event) => resolve(event.code), { once: true });
    });
    a.send(equipMessage('not-a-real-weapon'));
    assert.equal(await closed, 1008, 'expected a policy-violation close, same as any other rejected message');
  });
});

test('an equip before joining is refused rather than silently dropped', async () => {
  await withGameServer(async ({ url }) => {
    const a = client(url);
    await a.open();
    const closed = new Promise((resolve) => {
      a.socket.addEventListener('close', (event) => resolve(event.code), { once: true });
    });
    a.send(equipMessage(WILDWOOD_BLADE_ID));
    assert.equal(await closed, 1008, 'expected a policy-violation close');
  });
});

test('an input before joining is refused rather than silently dropped', async () => {
  await withGameServer(async ({ url }) => {
    const a = client(url);
    await a.open();
    const closed = new Promise((resolve) => {
      a.socket.addEventListener('close', (event) => resolve(event.code), { once: true });
    });
    a.send(inputMessage(1, 0, 1, 1, false));
    assert.equal(await closed, 1008, 'expected a policy-violation close');
  });
});

test('a client sending a server-only message is refused', async () => {
  await withGameServer(async ({ url }) => {
    const a = client(url);
    await a.open();
    const closed = new Promise((resolve) => {
      a.socket.addEventListener('close', (event) => resolve(event.code), { once: true });
    });
    // The CURRENT version, imported not restated -- at a stale hardcoded version this frame
    // fails the version gate instead, which still closes the socket but stops testing the
    // property this test is named for. That happened once, at the protocol-3 bump.
    a.send({ v: PROTOCOL_VERSION, type: 'snapshot', tick: 1, players: [] });
    assert.equal(await closed, 1008, 'clients may not send snapshots');
  });
});

// ── GP2: Rowan's cart ────────────────────────────────────────────────────────────────────────────

test('GP2: searching spawns the loot exactly once, idempotent on a resend', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  player.x = CART_SEARCH.at[0];
  player.z = CART_SEARCH.at[1];
  assert.equal(sim.lootSnapshot().spawned, false);
  assert.equal(sim.applySearchCart(player.id), true);
  assert.equal(sim.lootSnapshot().spawned, true);
  // A second search (a resend, or a second player also reaching the cart) is a no-op, not a second
  // haul -- there is nothing here that could even represent "a second batch" to check against.
  assert.equal(sim.applySearchCart(player.id), true, 'the message itself is still accepted (the player exists)');
  assert.deepEqual(sim.lootSnapshot(), { spawned: true, collected: {} });
});

test('GP2: searching the cart requires authoritative server proximity', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  assert.equal(sim.applySearchCart(player.id), false, 'the default spawn is nowhere near Rowan\'s cart');
  assert.equal(sim.lootSnapshot().spawned, false, 'a remote request must not spawn the shared haul');

  player.x = CART_SEARCH.at[0] + CART_SEARCH.radiusMeters;
  player.z = CART_SEARCH.at[1];
  assert.equal(sim.applySearchCart(player.id), true, 'the edge of the authored radius is accepted');
  assert.equal(sim.lootSnapshot().spawned, true);
});

test('GP2: searching before joining is refused rather than silently dropped', () => {
  const sim = createSimulation();
  assert.equal(sim.applySearchCart('nobody'), false);
  assert.equal(sim.lootSnapshot().spawned, false);
});

test('GP2: collecting requires the player to actually be near the pickup -- the server checks, not the client', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  player.x = CART_SEARCH.at[0];
  player.z = CART_SEARCH.at[1];
  sim.applySearchCart(player.id);
  const pickup = CART_LOOT_TABLE[0];

  // Still at the default spawn, nowhere near the cart.
  player.x = 0;
  player.z = 0;
  const tooFar = sim.applyCollectLoot(player.id, pickup.id);
  assert.equal(tooFar.accepted, false);

  const at = pickupWorldPosition(pickup, CART_SEARCH.at);
  player.x = at.x;
  player.z = at.z;
  const inReach = sim.applyCollectLoot(player.id, pickup.id);
  assert.equal(inReach.accepted, true);
  assert.equal(inReach.kind, pickup.kind);
  assert.equal(sim.lootSnapshot().collected[pickup.id], player.id);
});

test('GP2: welcome and snapshot both carry the loot block, in the shape protocol.js decodes', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  player.x = CART_SEARCH.at[0];
  player.z = CART_SEARCH.at[1];
  sim.applySearchCart(player.id);
  const decoded = decode(encode(snapshotMessage(sim.tick, sim.snapshot(), {
    revision: 0, wolf: { x: 0, z: 0, heading: 0, hp: 0, mode: 'idle', targetId: null },
    heroes: {}, rewards: {}, loot: sim.lootSnapshot(),
  })));
  assert.equal(decoded.encounter.loot.spawned, true);
  assert.deepEqual(decoded.encounter.loot.collected, {});
});

test('a malformed message drops that client and leaves the other playing', async () => {
  await withGameServer(async ({ url }) => {
    const good = client(url);
    const bad = client(url);
    await Promise.all([good.open(), bad.open()]);
    good.send(joinMessage('kid-good'));
    bad.send(joinMessage('kid-bad'));
    await Promise.all([good.waitFor('welcome'), bad.waitFor('welcome')]);

    const badClosed = new Promise((resolve) => {
      bad.socket.addEventListener('close', (event) => resolve(event.code), { once: true });
    });
    // Magnitude 9 is outside [0,1]; the protocol decoder throws and wsServer closes with 1008.
    // Version imported not restated, so the MAGNITUDE check is what fires -- a stale hardcoded
    // version fails the version gate first and this test stops testing what its name says.
    bad.socket.send(encode({ v: PROTOCOL_VERSION, type: 'input', seq: 1, dirX: 0, dirZ: 1, magnitude: 9, run: false }));
    assert.equal(await badClosed, 1008);

    // The other child keeps playing.
    good.send(inputMessage(1, 0, 1, 1, false));
    const snapshots = await good.waitFor('snapshot', good.of('snapshot').length + 2);
    assert.ok(snapshots.at(-1).players.length >= 1, 'the surviving player is still simulated');
    good.socket.close();
  });
});

// ── GP2, end to end over a real socket ──────────────────────────────────────────────────────────
//
// Position, here, is set by reaching into game.simulation.players directly rather than by walking a
// real client there over real wall-clock time (CART_SEARCH.at is ~30m from the default spawn, and
// attachGameServer's tick timer runs on real time, unlike createSimulation()'s own `now`-injected
// tests above) -- a test-only teleport, the same kind of white-box shortcut withGameServer's own
// seedOwnership option already takes to seed durable state without a client message existing for it.

function teleportToPickup(game, playerId, pickup) {
  const player = game.simulation.players.get(playerId);
  const at = pickupWorldPosition(pickup, CART_SEARCH.at);
  player.x = at.x;
  player.z = at.z;
}

function teleportToCart(game, playerId) {
  const player = game.simulation.players.get(playerId);
  player.x = CART_SEARCH.at[0];
  player.z = CART_SEARCH.at[1];
}

/**
 * Teleport, request collect-loot, and AWAIT the server actually landing it before returning.
 * Required whenever a test collects more than one pickup with the SAME player: teleportToPickup
 * mutates the live player object synchronously, with no relation to which of that socket's
 * already-queued messages has actually reached the server yet (WebSocket send() is async). Firing
 * teleport+send in a tight loop with no await between iterations moves the player to the LAST
 * pickup's position before the FIRST collect-loot message is even processed, so every earlier
 * request in the batch fails its reach check against the wrong, later position -- this is what
 * failed the very first attempt at GP3's multi-pickup tests.
 */
async function collectAndAwait(clientHandle, game, playerId, pickup) {
  teleportToPickup(game, playerId, pickup);
  clientHandle.send(collectLootMessage(pickup.id));
  await clientHandle.waitForSnapshot((s) => s.encounter.loot.collected[pickup.id] != null);
}

test('GP2: searching the cart rides the next snapshot for every connected client, not just the sender', async () => {
  await withGameServer(async ({ url, game }) => {
    const a = client(url);
    const b = client(url);
    await Promise.all([a.open(), b.open()]);
    a.send(joinMessage('kid-a'));
    b.send(joinMessage('kid-b'));
    const [welcomeA] = await a.waitFor('welcome');
    await b.waitFor('welcome');

    teleportToCart(game, welcomeA.id);
    a.send(searchCartMessage());

    const seenByB = await b.waitForSnapshot((snapshot) => snapshot.encounter.loot.spawned === true);
    assert.equal(seenByB.encounter.loot.spawned, true,
      'B must see the shared cart burst through the authoritative snapshot, having done nothing itself');
    a.socket.close();
    b.socket.close();
  });
});

test('GP2: collecting an unowned/unreachable pickup is refused without closing the connection', async () => {
  await withGameServer(async ({ url, game }) => {
    const a = client(url);
    await a.open();
    a.send(joinMessage('kid'));
    const [welcome] = await a.waitFor('welcome');
    const closed = [];
    a.socket.addEventListener('close', (event) => closed.push(event.code));

    // Before the cart has even been searched.
    a.send(collectLootMessage(CART_LOOT_TABLE[0].id));
    // An id nobody defined.
    a.send(collectLootMessage('not-a-real-pickup'));
    // Search legitimately, then move the authoritative player back to spawn before collecting.
    teleportToCart(game, welcome.id);
    a.send(searchCartMessage());
    await a.waitForSnapshot((snapshot) => snapshot.encounter.loot.spawned === true);
    const player = game.simulation.players.get(welcome.id);
    player.x = 0;
    player.z = 0;
    a.send(collectLootMessage(CART_LOOT_TABLE[0].id));

    // Proven by the connection surviving long enough to do something ordinary afterward -- a
    // malformed/hostile message closes with 1008 (see the equip/input tests above); a well-formed
    // but merely-not-currently-true request must not.
    a.send(inputMessage(1, 0, 1, 1, false));
    await a.waitFor('snapshot', 2);
    assert.deepEqual(closed, [], 'none of the three rejected collect attempts should have closed the socket');
    a.socket.close();
  });
});

test('GP2/GP3: a guestId-less socket cannot consume shared loot or strand Village Supplies', async () => {
  await withGameServer(async ({ url, game }) => {
    const ephemeral = client(url);
    const durable = client(url);
    await Promise.all([ephemeral.open(), durable.open()]);
    ephemeral.send(joinMessage('guestless-kid'));
    durable.send(joinMessage('durable-kid', 'guest-durable-after-ephemeral'));
    const [ephemeralWelcome] = await ephemeral.waitFor('welcome');
    const [durableWelcome] = await durable.waitFor('welcome');

    teleportToCart(game, ephemeralWelcome.id);
    ephemeral.send(searchCartMessage());
    await ephemeral.waitForSnapshot((snapshot) => snapshot.encounter.loot.spawned === true);

    const pickup = CART_LOOT_TABLE[0];
    teleportToPickup(game, ephemeralWelcome.id, pickup);
    const priorSnapshots = ephemeral.of('snapshot').length;
    ephemeral.send(collectLootMessage(pickup.id));
    ephemeral.send(inputMessage(1, 0, 0, 0, false));
    await ephemeral.waitFor('snapshot', priorSnapshots + 2);

    assert.equal(game.simulation.lootSnapshot().collected[pickup.id], undefined,
      'the shared pickup must remain available when no durable award can be recorded');
    assert.deepEqual(game.rewards.villageSnapshot(), { coins: 0, shards: 0, workshopOwned: false });
    assert.equal(game.rewards.rewardsFor([ephemeralWelcome.id])[ephemeralWelcome.id].coins, 0,
      'the rejected collection must not create a private ephemeral currency shadow either');

    await collectAndAwait(durable, game, durableWelcome.id, pickup);
    assert.equal(game.simulation.lootSnapshot().collected[pickup.id], durableWelcome.id,
      'a durable player can still collect the same object after the guestless attempt');
    assert.deepEqual(game.rewards.villageSnapshot(), { coins: 1, shards: 0, workshopOwned: false });

    ephemeral.socket.close();
    durable.socket.close();
  });
});

test('GP2: the same physical pickup cannot be collected twice -- two real clients racing it, only one wins', async () => {
  await withGameServer(async ({ url, game }) => {
    const guestA = 'guest-cart-race-a';
    const guestB = 'guest-cart-race-b';
    const a = client(url);
    const b = client(url);
    await Promise.all([a.open(), b.open()]);
    a.send(joinMessage('kid-a', guestA));
    b.send(joinMessage('kid-b', guestB));
    const [welcomeA] = await a.waitFor('welcome');
    const [welcomeB] = await b.waitFor('welcome');

    teleportToCart(game, welcomeA.id);
    a.send(searchCartMessage());
    await a.waitForSnapshot((snapshot) => snapshot.encounter.loot.spawned === true);
    await b.waitForSnapshot((snapshot) => snapshot.encounter.loot.spawned === true);

    const pickup = CART_LOOT_TABLE[0];
    teleportToPickup(game, welcomeA.id, pickup);
    teleportToPickup(game, welcomeB.id, pickup);

    // Both ask for the SAME physical pickup, back to back -- as close to simultaneous as two real
    // messages on two real sockets get.
    a.send(collectLootMessage(pickup.id));
    b.send(collectLootMessage(pickup.id));

    const settled = await a.waitForSnapshot((snapshot) => snapshot.encounter.loot.collected[pickup.id] != null);
    const collector = settled.encounter.loot.collected[pickup.id];
    assert.ok(collector === welcomeA.id || collector === welcomeB.id, 'exactly one of the two racers won it');

    // Both clients must agree on WHICH one won -- that is what "authoritative, not per-client" means.
    const settledForB = await b.waitForSnapshot((snapshot) => snapshot.encounter.loot.collected[pickup.id] != null);
    assert.equal(settledForB.encounter.loot.collected[pickup.id], collector,
      'A and B must see the identical outcome of the race, not two different winners');

    // And the currency itself was credited to exactly the winner, not to both.
    const rewardsSnapshot = await a.waitForSnapshot(
      (snapshot) => (snapshot.encounter.rewards[welcomeA.id]?.coins ?? 0)
        + (snapshot.encounter.rewards[welcomeB.id]?.coins ?? 0) > 0,
    );
    const coinsA = rewardsSnapshot.encounter.rewards[welcomeA.id]?.coins ?? 0;
    const coinsB = rewardsSnapshot.encounter.rewards[welcomeB.id]?.coins ?? 0;
    assert.equal(coinsA + coinsB, 1, 'exactly one coin was credited in total, to whichever guest actually won it');
    assert.equal(collector === welcomeA.id ? coinsA : coinsB, 1, 'the credited guest must be the recorded collector');

    a.socket.close();
    b.socket.close();
  });
});

test('GP2: reconnecting with the same guestId cannot re-collect an already-taken pickup', async () => {
  const guestId = 'guest-cart-reconnect-fixture';
  await withGameServer(async ({ url, game }) => {
    const first = client(url);
    await first.open();
    first.send(joinMessage('kid', guestId));
    const [welcome1] = await first.waitFor('welcome');

    teleportToCart(game, welcome1.id);
    first.send(searchCartMessage());
    await first.waitForSnapshot((snapshot) => snapshot.encounter.loot.spawned === true);
    const pickup = CART_LOOT_TABLE[0];
    teleportToPickup(game, welcome1.id, pickup);
    first.send(collectLootMessage(pickup.id));
    await first.waitForSnapshot((snapshot) => (snapshot.encounter.rewards[welcome1.id]?.coins ?? 0) >= 1);

    first.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // A genuine reconnect: same guestId, a NEW connection/playerId, same as a real page reload.
    const second = client(url);
    await second.open();
    second.send(joinMessage('kid', guestId));
    const [welcome2] = await second.waitFor('welcome');
    assert.notEqual(welcome2.id, welcome1.id, 'a reconnect gets a fresh playerId, same as any other rejoin');
    assert.equal(welcome2.encounter.rewards[welcome2.id]?.coins, 1,
      'the durably-earned coin must still be there after reconnecting');

    // The reconnecting client's own local trigger could plausibly resend the collect for the same
    // pickup it already has (e.g. a stale local `cartSearched`-style flag) -- must still be a no-op.
    teleportToPickup(game, welcome2.id, pickup);
    second.send(collectLootMessage(pickup.id));
    second.send(inputMessage(1, 0, 1, 1, false));
    await second.waitFor('snapshot', 2);
    assert.equal(game.rewards.rewardsFor([welcome2.id])[welcome2.id].coins, 1,
      'a reconnect must not be able to re-collect a pickup it (or anyone else) already took');

    second.socket.close();
  });
});

// ── GP3-1: Village Supplies and Workshop I, over real sockets ──────────────────────────────────

test('GP3: two real clients -- one buys Workshop I, both see the identical shared village state', async () => {
  await withGameServer(async ({ url, game }) => {
    const a = client(url);
    const b = client(url);
    await Promise.all([a.open(), b.open()]);
    a.send(joinMessage('kid-a', 'guest-village-a'));
    b.send(joinMessage('kid-b', 'guest-village-b'));
    const [welcomeA] = await a.waitFor('welcome');
    const [welcomeB] = await b.waitFor('welcome');

    teleportToCart(game, welcomeA.id);
    a.send(searchCartMessage());
    await a.waitForSnapshot((snapshot) => snapshot.encounter.loot.spawned === true);
    await b.waitForSnapshot((snapshot) => snapshot.encounter.loot.spawned === true);

    // Split the guaranteed haul across BOTH brothers -- provenance stays personal per pickup, but
    // Village Supplies pools it (the brief's own "if either brother collects a pickup, it
    // contributes to the same Workshop budget"). Each collect is awaited before the next -- see
    // collectAndAwait's own comment for why that matters whenever one player takes more than one.
    const [coin0, coin1, coin2, shard0, shard1] = CART_LOOT_TABLE;
    await collectAndAwait(a, game, welcomeA.id, coin0);
    await collectAndAwait(a, game, welcomeA.id, coin1);
    await collectAndAwait(b, game, welcomeB.id, coin2);
    await collectAndAwait(a, game, welcomeA.id, shard0);
    await collectAndAwait(b, game, welcomeB.id, shard1);

    await a.waitForSnapshot((s) => s.encounter.village.coins === 3 && s.encounter.village.shards === 2);
    await b.waitForSnapshot((s) => s.encounter.village.coins === 3 && s.encounter.village.shards === 2);

    // B buys it -- proving spend rights are communal too, not limited to whoever physically
    // collected the pickups.
    b.send(villageUpgradePurchaseMessage(WORKSHOP_I_ID));

    const boughtA = await a.waitForSnapshot((s) => s.encounter.village.workshopOwned === true);
    const boughtB = await b.waitForSnapshot((s) => s.encounter.village.workshopOwned === true);
    assert.deepEqual(boughtA.encounter.village, boughtB.encounter.village,
      'both clients must see the IDENTICAL shared village state, not two private views');
    assert.deepEqual(boughtA.encounter.village, { coins: 3, shards: 2, workshopOwned: true });

    a.socket.close();
    b.socket.close();
  });
});

test('GP3: two simultaneous purchase requests over real sockets -- only one is accepted, funds spend once', async () => {
  await withGameServer(async ({ url, game }) => {
    const a = client(url);
    const b = client(url);
    await Promise.all([a.open(), b.open()]);
    a.send(joinMessage('kid-a', 'guest-race-buy-a'));
    b.send(joinMessage('kid-b', 'guest-race-buy-b'));
    const [welcomeA] = await a.waitFor('welcome');
    const [welcomeB] = await b.waitFor('welcome');

    teleportToCart(game, welcomeA.id);
    a.send(searchCartMessage());
    await a.waitForSnapshot((s) => s.encounter.loot.spawned === true);
    for (const pickup of CART_LOOT_TABLE) {
      await collectAndAwait(a, game, welcomeA.id, pickup);
    }
    await b.waitForSnapshot((s) => s.encounter.village.coins === 3 && s.encounter.village.shards === 2);

    // Both fire the purchase back to back -- as close to simultaneous as two real sockets get.
    a.send(villageUpgradePurchaseMessage(WORKSHOP_I_ID));
    b.send(villageUpgradePurchaseMessage(WORKSHOP_I_ID));

    const settled = await a.waitForSnapshot((s) => s.encounter.village.workshopOwned === true);
    assert.equal(settled.encounter.village.coins, 3, 'the shared total is never double-spent');
    assert.equal(settled.encounter.village.shards, 2);

    const settledForB = await b.waitForSnapshot((s) => s.encounter.village.workshopOwned === true);
    assert.deepEqual(settledForB.encounter.village, settled.encounter.village);

    a.socket.close();
    b.socket.close();
  });
});

test('GP3: village-upgrade-purchase before joining is refused rather than silently dropped', async () => {
  await withGameServer(async ({ url }) => {
    const a = client(url);
    await a.open();
    const closed = [];
    a.socket.addEventListener('close', (event) => closed.push(event.code));
    a.send(villageUpgradePurchaseMessage(WORKSHOP_I_ID));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(closed, [1008], 'a message before join is a protocol violation, closed like any other');
  });
});

test('GP3: Village Supplies and Workshop I both survive a real server restart, and the cart never reappears fresh', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-game-server-village-restart-'));
  const rewardStorePath = join(dir, 'rewards.db');
  const guestId = 'guest-full-restart';
  try {
    // ── First process: earn the full guaranteed haul and buy Workshop I ─────────────────────────
    const httpServer1 = createServer((_request, response) => response.writeHead(404).end());
    const game1 = attachGameServer(httpServer1, { rewardStorePath, allowMissingOrigin: true });
    await new Promise((resolve) => httpServer1.listen(0, '127.0.0.1', resolve));
    const port1 = httpServer1.address().port;
    const a = client(`ws://127.0.0.1:${port1}/ws`);
    await a.open();
    a.send(joinMessage('kid', guestId));
    const [welcome] = await a.waitFor('welcome');
    teleportToCart(game1, welcome.id);
    a.send(searchCartMessage());
    await a.waitForSnapshot((s) => s.encounter.loot.spawned === true);
    for (const pickup of CART_LOOT_TABLE) {
      await collectAndAwait(a, game1, welcome.id, pickup);
    }
    a.send(villageUpgradePurchaseMessage(WORKSHOP_I_ID));
    await a.waitForSnapshot((s) => s.encounter.village.workshopOwned === true);

    a.socket.close();
    game1.stop();
    await new Promise((resolve) => httpServer1.close(resolve));

    // ── Second process, same store: everything already earned/bought must read that way from the
    //    very first welcome, and the cart's five pickups must not present as fresh again (GP3-0) ──
    const httpServer2 = createServer((_request, response) => response.writeHead(404).end());
    const game2 = attachGameServer(httpServer2, { rewardStorePath, allowMissingOrigin: true });
    await new Promise((resolve) => httpServer2.listen(0, '127.0.0.1', resolve));
    const port2 = httpServer2.address().port;
    const b = client(`ws://127.0.0.1:${port2}/ws`);
    await b.open();
    b.send(joinMessage('kid-again', guestId));
    const [welcomeAgain] = await b.waitFor('welcome');

    assert.deepEqual(welcomeAgain.encounter.village, { coins: 3, shards: 2, workshopOwned: true });
    assert.equal(welcomeAgain.encounter.loot.spawned, true);
    assert.equal(Object.keys(welcomeAgain.encounter.loot.collected).length, CART_LOOT_TABLE.length,
      'GP3-0: all five previously credited pickups must still read collected, not fresh');

    // A replayed purchase attempt, and a replayed collect on the very first pickup, must both be
    // clean no-ops -- neither may change the shared totals or ownership.
    b.send(villageUpgradePurchaseMessage(WORKSHOP_I_ID));
    teleportToPickup(game2, welcomeAgain.id, CART_LOOT_TABLE[0]);
    b.send(collectLootMessage(CART_LOOT_TABLE[0].id));
    b.send(inputMessage(1, 0, 1, 1, false));
    await b.waitFor('snapshot', 2);
    const finalSnapshot = b.messages.filter((m) => m.type === 'snapshot').at(-1);
    assert.deepEqual(finalSnapshot.encounter.village, { coins: 3, shards: 2, workshopOwned: true },
      'a replayed purchase attempt after restart must not change the shared totals or ownership');

    b.socket.close();
    game2.stop();
    await new Promise((resolve) => httpServer2.close(resolve));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ── the Beacon's durable row is only latched by a REAL write (Director gate, PR #14) ────────────
//
// A victory won entirely by guestId-less (ephemeral) clients has nothing durable to write. The bug
// this pins: the tick loop used to mark the world "recorded" after merely TRYING every connected
// player, so an all-ephemeral win latched having written nothing and then stopped trying. A durable
// child joining a minute later found the Beacon burning with no row behind it -- and the next
// restart put it out.
test('an ephemeral-only Beacon victory is written down as soon as a durable guest is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-beacon-durable-'));
  const rewardStorePath = join(dir, 'rewards.db');
  try {
    const rewards = createRewardCoordinator({ rewardStorePath });
    try {
      // An ephemeral connection: joined with no guestId at all.
      rewards.join('p1', undefined);
      assert.equal(rewards.recordBeaconLit('p1').applied, false, 'nothing durable to write yet');
      assert.equal(rewards.beaconLit(), false, 'and nothing was written');

      // A durable child joins later. The row must land now, not never.
      rewards.join('p2', 'guest-durable-1');
      assert.equal(rewards.recordBeaconLit('p2').applied, true, 'the write finally happens');
      assert.equal(rewards.beaconLit(), true);

      // Idempotent on a fixed eventId: the Beacon lights once, ever.
      assert.equal(rewards.recordBeaconLit('p2').applied, false, 'a second win writes no second row');
    } finally {
      rewards.close();
    }

    // RESTART: a fresh coordinator over the same file still knows the Beacon is burning, which is
    // the whole point of writing it down.
    const restarted = createRewardCoordinator({ rewardStorePath });
    try {
      assert.equal(restarted.beaconLit(), true, 'reload must not pretend the player never won');
    } finally {
      restarted.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
