// A coin a child picks up has to reach the device as a NAMED fact, not only as a bigger number.
//
// Director correction 4 lists primary currency among the durable state a same-device family save
// must keep. It very nearly does already: the server writes a `coin-earned` row keyed on the
// pickup's own id, and `welcome.profileFacts` hands the whole set to the device on the next connect.
// The hole is the gap in between. Marks and the lantern ride the snapshot as identified events and
// are journalled the moment they happen; coins and shards ride nothing at all, so the device learns
// them only from the NEXT welcome. A reward database lost inside one session takes that session's
// coins with it.
//
// The distinction that makes this fixable at all is the same one facts.js's header opens with: the
// rewards block carries a COUNT, and a count cannot be journalled. Fold "coins: 3" into a grow-only
// set and every reconnect adds three more. Only a named fact can be merged, which is why this is
// about the eventId riding the wire rather than about the number already on it.
//
// The pickup id IS the durable id, deliberately, and net/gameServer.mjs's applyLootAward already
// explains why: one physical object, collectible once, globally unique by construction. So there is
// no new identity to mint here -- only one that was being kept private.

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { attachGameServer } from '../net/gameServer.mjs';
import {
  collectLootMessage,
  decode,
  encode,
  joinMessage,
  searchCartMessage,
} from '../public/src/net/protocol.js';
import { CART_LOOT_TABLE, pickupWorldPosition } from '../public/src/world/cartLoot.js';
import { CART_SEARCH } from '../public/src/world/zones/village.js';
import { createProfileStore } from '../public/src/progression/profiles.js';
import { PROFILE_FACT_TYPES } from '../public/src/progression/facts.js';
import { WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
import { REWARD_EVENT_TYPES } from '../public/src/rewards/feedback.js';

const GUEST = 'p-currency-1111-2222-3333';

async function withServer(body) {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-currency-facts-'));
  const httpServer = createServer((_request, response) => response.writeHead(404).end());
  const game = attachGameServer(httpServer, {
    rewardStorePath: join(dir, 'rewards.db'),
    allowMissingOrigin: true,
  });
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
    /** Every event seen on every snapshot so far -- events ride snapshots and are drained per
     *  broadcast, so a test that samples one snapshot can miss the one it is about. */
    allEvents: () => messages.filter((m) => m.type === 'snapshot').flatMap((m) => m.events ?? []),
    waitFor: async (predicate, what, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = predicate();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
  };
}

function teleportTo(game, playerId, pickup) {
  const player = game.simulation.players.get(playerId);
  const at = pickupWorldPosition(pickup, CART_SEARCH.at);
  player.x = at.x;
  player.z = at.z;
}

/** Search the cart and collect one pickup, as a child does. Returns the pickup taken. */
async function collectOne(c, game, playerId) {
  const player = game.simulation.players.get(playerId);
  player.x = CART_SEARCH.at[0];
  player.z = CART_SEARCH.at[1];
  c.send(searchCartMessage());
  await c.waitFor(
    () => c.messages.some((m) => m.type === 'snapshot' && m.encounter?.loot?.spawned),
    'the cart to be searched',
  );

  const pickup = CART_LOOT_TABLE[0];
  teleportTo(game, playerId, pickup);
  c.send(collectLootMessage(pickup.id));
  await c.waitFor(
    () => c.messages.some((m) => m.type === 'snapshot' && m.encounter?.loot?.collected?.[pickup.id] != null),
    'the pickup to be collected',
  );
  return pickup;
}

test('collecting a pickup announces an identified currency fact, not just a bigger count', async () => {
  await withServer(async ({ url, game }) => {
    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    const welcome = await c.waitFor(() => c.messages.find((m) => m.type === 'welcome'), 'welcome');

    const pickup = await collectOne(c, game, welcome.id);

    const currency = await c.waitFor(
      () => c.allEvents().find((event) => event.type === 'coin-earned' || event.type === 'shard-earned'),
      'a currency event on a snapshot',
    );

    // The id is the whole point: without it the device has a number it cannot deduplicate.
    assert.equal(currency.eventId, pickup.id,
      'the durable id must ride the event -- it is the pickup id the store already keyed the row on');
    assert.equal(currency.heroId, welcome.id, 'and it must say whose it is');

    c.socket.close();
  });
});

test('a device journalling that event has the coin immediately, and once', async () => {
  await withServer(async ({ url, game }) => {
    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    const welcome = await c.waitFor(() => c.messages.find((m) => m.type === 'welcome'), 'welcome');
    await collectOne(c, game, welcome.id);

    const currency = await c.waitFor(
      () => c.allEvents().find((event) => event.type === 'coin-earned' || event.type === 'shard-earned'),
      'a currency event on a snapshot',
    );

    // Exactly what main.js's dispatcher does with any identified fact.
    const memory = new Map();
    const device = createProfileStore({
      storage: {
        getItem: (k) => (memory.has(k) ? memory.get(k) : null),
        setItem: (k, v) => { memory.set(k, String(v)); },
        removeItem: (k) => { memory.delete(k); },
      },
      randomUUID: () => 'uuid-1',
      now: () => new Date(1_700_000_000_000),
    });
    device.recordFacts(GUEST, [{ eventId: currency.eventId, type: currency.type }]);

    const state = device.stateFor(GUEST);
    const total = state.coins + state.shards;
    assert.equal(total, 1, `one pickup is one unit of currency, got coins ${state.coins} shards ${state.shards}`);

    // The same event arriving again -- a resend, a replayed snapshot -- must not pay twice. This is
    // the property a count could never have had.
    device.recordFacts(GUEST, [{ eventId: currency.eventId, type: currency.type }]);
    const again = device.stateFor(GUEST);
    assert.equal(again.coins + again.shards, 1, 'a replayed currency fact is the same fact');

    c.socket.close();
  });
});

test('a currency event is one the reward dispatcher knows how to route', () => {
  // createRewardFeedback throws at construction for a missing handler, and anything not in this
  // table falls through to the combat dispatcher, which logs "no handler" to the console -- which is
  // itself a harness failure ("no console errors across the whole run"). So a new reward event type
  // is only half-added until it is here.
  assert.ok(REWARD_EVENT_TYPES.includes('coin-earned'), 'coin-earned must be a known reward event');
  assert.ok(REWARD_EVENT_TYPES.includes('shard-earned'), 'shard-earned must be a known reward event');
});

test('an ephemeral collector announces nothing durable, because it earned nothing durable', async () => {
  await withServer(async ({ url, game }) => {
    const c = client(url);
    await c.open();
    c.send(joinMessage('kid')); // no guestId
    const welcome = await c.waitFor(() => c.messages.find((m) => m.type === 'welcome'), 'welcome');

    // A guestId-less connection is refused the collect outright (it would consume a globally unique
    // pickup with nowhere to credit it), so there is nothing to announce and the cart stays full.
    const player = game.simulation.players.get(welcome.id);
    player.x = CART_SEARCH.at[0];
    player.z = CART_SEARCH.at[1];
    c.send(searchCartMessage());
    await c.waitFor(
      () => c.messages.some((m) => m.type === 'snapshot' && m.encounter?.loot?.spawned),
      'the cart to be searched',
    );
    teleportTo(game, welcome.id, CART_LOOT_TABLE[0]);
    c.send(collectLootMessage(CART_LOOT_TABLE[0].id));
    await new Promise((resolve) => setTimeout(resolve, 400));

    const currency = c.allEvents().filter((e) => e.type === 'coin-earned' || e.type === 'shard-earned');
    assert.deepEqual(currency, [], 'no durable identity, no durable fact');

    c.socket.close();
  });
});

// ── the rest of correction 4's durable list ────────────────────────────────────────────────────

test('every profile fact type the coordinator can write is one the client can route', () => {
  // The completeness rule, stated as a relationship rather than as a list. A durable fact the
  // server writes but the client's dispatcher does not know falls through to the COMBAT dispatcher
  // and logs "no handler" -- which is a console error, which is a harness failure. So "the server
  // can write it" and "the client can route it" have to stay the same set, minus the two that
  // legitimately never ride this path.
  const announceable = PROFILE_FACT_TYPES.filter((type) => (
    // Minted by the DEVICE at the equip action and journalled there, so it never arrives as a
    // server announcement (docs/MISTAKES.md GQ-014).
    type !== 'weapon-equipped'
    // Durable and recordable since P1 (the XP/Level authority package), but nothing AWARDS XP yet --
    // no quest, combat or learning source mints one, so there is nothing for the server to announce.
    // The client handler arrives with the first real XP source, which is a later package's job.
    && type !== 'xp-earned'
  ));

  const unroutable = announceable.filter((type) => !REWARD_EVENT_TYPES.includes(type));
  assert.deepEqual(unroutable, [],
    `these durable facts have no client handler, so announcing one would log a console error: ${unroutable.join(', ')}`);
});

test('claiming the Blade announces the ownership fact under the store id', async () => {
  await withServer(async ({ url, game }) => {
    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    const welcome = await c.waitFor(() => c.messages.find((m) => m.type === 'welcome'), 'welcome');

    // Granted through the coordinator directly rather than by walking to Rowan with a lit Beacon:
    // what is under test is the ANNOUNCEMENT, and the claim's own preconditions have their own
    // tests. The grant path is the same store write either way.
    game.simulation.announceRewardFacts(game.rewards.grantOwnership(welcome.id, WILDWOOD_BLADE_ID));

    const owned = await c.waitFor(
      () => c.allEvents().find((event) => event.type === 'gear-owned'),
      'a gear-owned event on a snapshot',
    );
    assert.equal(owned.eventId, `own:${GUEST}:${WILDWOOD_BLADE_ID}`, 'the store id rides the event');
    assert.equal(owned.value, WILDWOOD_BLADE_ID, 'and it names WHICH gear -- without that it names nothing');

    // A second grant is a replay, not a second item, and must announce nothing.
    const before = c.allEvents().filter((e) => e.type === 'gear-owned').length;
    game.simulation.announceRewardFacts(game.rewards.grantOwnership(welcome.id, WILDWOOD_BLADE_ID));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(
      c.allEvents().filter((e) => e.type === 'gear-owned').length,
      before,
      're-granting an item already owned must not announce a second acquisition',
    );

    c.socket.close();
  });
});
