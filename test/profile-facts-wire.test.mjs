// The welcome message has to hand a returning device the facts it needs to recover a profile.
//
// progression/profiles.js's ingestServerFacts is the reconnect contract: journal what the server
// knows, settle each fact's revision durably, and only THEN let local progression mint anything
// above it. A device that mints before ingesting numbers a new choice beneath history it has not
// heard about yet, which is GQ-014 one level up (docs/MISTAKES.md).
//
// That contract was unreachable from a real client. `rewardStore.profileFactsFor` existed and
// net/gameServer.mjs's coordinator exposed it, but nothing put the result on the wire, so the only
// durable state a joining client ever saw was the encounter's DERIVED rewards block -- counts and a
// resolved weapon id, with no eventIds. Counts cannot be journalled: a fact with no stable name
// cannot be deduplicated, so a device folding them into its own grow-only set would double every
// mark it had already recorded. The recovery path could therefore be unit-tested and could not
// actually run.
//
// These tests are written against the wire and against the device's real store, not against a
// hand-built fact array, because that is exactly the gap GQ-015 names: a test that hand-feeds a pure
// function proves the function, not where its inputs come from.

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { attachGameServer } from '../net/gameServer.mjs';
import { openRewardStore } from '../net/rewardStore.mjs';
import {
  PROTOCOL_VERSION,
  ProtocolError,
  decode,
  encode,
  equipMessage,
  joinMessage,
  welcomeMessage,
} from '../public/src/net/protocol.js';
import { createProfileStore } from '../public/src/progression/profiles.js';
import { latestEquippedFact } from '../public/src/progression/facts.js';
import { STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';

const GUEST = 'p-wire-1111-2222-3333';

/** The seeded equip's durable revision. Deliberately far ABOVE the fake clock the test devices run
 *  on, so "ingest before you mint" is load-bearing rather than incidentally satisfied: a device that
 *  mints without ingesting stamps its own clock and loses to this, which is the defect. */
const SEEDED_EQUIP_REV = 5_000_000;

/** A device with nothing on it: memory-backed storage, deterministic uuid and clock, so what comes
 *  back is a property of the facts rather than of the machine the test ran on. */
function freshDevice(startMillis = 1_000_000) {
  const memory = new Map();
  let uuid = 0;
  let clock = startMillis;
  return {
    storage: {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => { memory.set(k, String(v)); },
      removeItem: (k) => { memory.delete(k); },
    },
    store: createProfileStore({
      storage: {
        getItem: (k) => (memory.has(k) ? memory.get(k) : null),
        setItem: (k, v) => { memory.set(k, String(v)); },
        removeItem: (k) => { memory.delete(k); },
      },
      randomUUID: () => `uuid-${uuid += 1}`,
      now: () => new Date(clock += 1000),
    }),
  };
}

async function withSeededServer(seed, body) {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-profile-facts-wire-'));
  const rewardStorePath = join(dir, 'rewards.db');
  const seedStore = openRewardStore(rewardStorePath);
  for (const award of seed) seedStore.apply(award);
  seedStore.close();

  const httpServer = createServer((_request, response) => response.writeHead(404).end());
  const game = attachGameServer(httpServer, { rewardStorePath, allowMissingOrigin: true });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  try {
    return await body({ url: `ws://127.0.0.1:${port}/ws` });
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
    open: () => new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('failed to open')), { once: true });
    }),
    send: (message) => socket.send(encode(message)),
    waitFor: async (type, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = messages.find((m) => m.type === type);
        if (found) return found;
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${type}; got ${JSON.stringify(messages.map((m) => m.type))}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
  };
}

/** Two marks, a blade owned, and a blade equipped at a known revision. Deliberately a mix of the
 *  counted, the set-valued and the ordered, because the three fold differently. */
const SEEDED_HISTORY = [
  { guestId: GUEST, heroId: 'p1', type: 'mark-earned', eventId: 'mark:one' },
  { guestId: GUEST, heroId: 'p1', type: 'mark-earned', eventId: 'mark:two' },
  { guestId: GUEST, heroId: 'p1', type: 'gear-owned', eventId: `own:${GUEST}:${WILDWOOD_BLADE_ID}`, value: WILDWOOD_BLADE_ID },
  { guestId: GUEST, heroId: 'p1', type: 'coin-earned', eventId: 'coin:one' },
  {
    guestId: GUEST, heroId: 'p1', type: 'weapon-equipped',
    eventId: `equip:${GUEST}:${SEEDED_EQUIP_REV}:aaa`, value: WILDWOOD_BLADE_ID, rev: SEEDED_EQUIP_REV,
  },
];

test('welcome carries the joining profile durable facts, with the ids that make them mergeable', async () => {
  await withSeededServer(SEEDED_HISTORY, async ({ url }) => {
    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    const welcome = await c.waitFor('welcome');

    assert.ok(Array.isArray(welcome.profileFacts), 'welcome must carry the profile facts array');
    assert.equal(welcome.profileFacts.length, SEEDED_HISTORY.length,
      `every seeded fact should ride the wire; got ${JSON.stringify(welcome.profileFacts)}`);

    // The ids are the whole point -- they are what make a second copy mergeable rather than double
    // counted. Assert on the ids themselves, not merely on the count.
    const byId = new Map(welcome.profileFacts.map((fact) => [fact.eventId, fact]));
    for (const award of SEEDED_HISTORY) {
      assert.ok(byId.has(award.eventId), `missing ${award.eventId} on the wire`);
      assert.equal(byId.get(award.eventId).type, award.type);
    }

    // And the equip's durable revision has to survive the trip, or the device numbers it on arrival
    // -- which measures delivery, not chronology.
    assert.equal(
      byId.get(`equip:${GUEST}:${SEEDED_EQUIP_REV}:aaa`).rev,
      SEEDED_EQUIP_REV,
      'the equip revision must be carried, not dropped',
    );

    c.socket.close();
  });
});

test('a device with an empty journal recovers the whole profile from what welcome handed it', async () => {
  await withSeededServer(SEEDED_HISTORY, async ({ url }) => {
    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    const welcome = await c.waitFor('welcome');

    // The real recovery case: a tablet that has never seen this profile, handed only what the wire
    // said. No hand-built facts -- these are the bytes the server actually sent.
    const device = freshDevice();
    const state = device.store.ingestServerFacts(GUEST, welcome.profileFacts);

    assert.equal(state.marks, 2, 'both marks recovered');
    assert.equal(state.coins, 1, 'the coin recovered');
    assert.ok(state.ownedItemIds.includes(WILDWOOD_BLADE_ID), 'the owned blade recovered');
    assert.equal(state.equippedWeaponId, WILDWOOD_BLADE_ID, 'the equipped weapon recovered');

    // Idempotent: the same welcome replayed (a reconnect delivering the same history) must not
    // double anything. This is the property that makes holding two copies safe at all.
    const again = device.store.ingestServerFacts(GUEST, welcome.profileFacts);
    assert.equal(again.marks, 2, 'a replayed welcome must not double the marks');
    assert.equal(again.coins, 1, 'a replayed welcome must not double the coins');

    c.socket.close();
  });
});

test('ingesting welcome before equipping is what keeps a new choice above the delivered history', async () => {
  await withSeededServer(SEEDED_HISTORY, async ({ url }) => {
    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    const welcome = await c.waitFor('welcome');

    // The contract in one test: ingest first, then mint. The seeded equip sits far above this
    // device's clock on purpose, so the guard in mintEquipFact is what has to save it -- and that
    // guard can only see history the device has actually WRITTEN DOWN. Skip the ingest and the new
    // choice is numbered beneath a fact the device was told about in the very same message.
    const device = freshDevice(1000);
    device.store.ingestServerFacts(GUEST, welcome.profileFacts);
    const minted = device.store.mintEquipFact(GUEST, STARTER_SWORD_ID);

    assert.ok(
      minted.rev > SEEDED_EQUIP_REV,
      `a new choice must outrank the delivered history, got rev ${minted.rev} against ${SEEDED_EQUIP_REV}`,
    );
    assert.equal(
      device.store.stateFor(GUEST).equippedWeaponId,
      STARTER_SWORD_ID,
      'the weapon the child just picked is the one the hero holds',
    );

    c.socket.close();
  });
});

test('a client that never sends a guestId gets no profile facts rather than someone else\'s', async () => {
  await withSeededServer(SEEDED_HISTORY, async ({ url }) => {
    const c = client(url);
    await c.open();
    // No guestId: an ephemeral connection (private browsing, or a pre-profile client).
    c.send(joinMessage('kid'));
    const welcome = await c.waitFor('welcome');

    assert.ok(Array.isArray(welcome.profileFacts), 'the field should still be present and well-shaped');
    assert.equal(welcome.profileFacts.length, 0, 'an ephemeral connection owns no durable facts');

    c.socket.close();
  });
});

// ── protocol shape: additive, and validated rather than trusted ────────────────────────────────

test('profileFacts is additive -- a welcome without it still decodes, at protocol 4', () => {
  // A pre-1b server's exact bytes: a real welcome with the new key removed, rather than a
  // hand-built object that could differ from one in some other way and pass for the wrong reason.
  const legacy = { ...welcomeMessage('p1', 0, []) };
  delete legacy.profileFacts;
  assert.equal('profileFacts' in legacy, false, 'the fixture must genuinely lack the field');

  const decoded = decode(encode(legacy));
  assert.equal(decoded.v, PROTOCOL_VERSION, 'carrying facts must not bump the protocol version');
  assert.equal(PROTOCOL_VERSION, 4, 'and the version this remains additive against after E1 is 4');
  assert.deepEqual(decoded.profileFacts, [], 'an absent field reads as no facts, not as a failure');
});

test('the wire validates a fact rather than storing whatever arrives', () => {
  const withFacts = (profileFacts) => encode({
    ...welcomeMessage('p1', 0, []),
    profileFacts,
  });

  assert.throws(() => decode(withFacts('not-an-array')), ProtocolError, 'a non-array must be refused');
  assert.throws(() => decode(withFacts([{ type: 'mark-earned' }])), ProtocolError, 'a fact with no eventId must be refused');
  assert.throws(() => decode(withFacts([{ eventId: 'x' }])), ProtocolError, 'a fact with no type must be refused');
  assert.throws(
    () => decode(withFacts([{ eventId: 'x', type: 'mark-earned', rev: 1.5 }])),
    ProtocolError,
    'a non-integer revision must be refused -- it orders rows in a column that holds integers',
  );

  // The legal shape round trips unchanged, including an absent-rather-than-null rev.
  const ok = decode(withFacts([
    { eventId: 'mark:one', type: 'mark-earned' },
    { eventId: 'equip:a', type: 'weapon-equipped', value: STARTER_SWORD_ID, rev: 7 },
  ]));
  assert.equal(ok.profileFacts.length, 2);
  assert.equal(ok.profileFacts[0].rev, undefined, 'a fact with no order must not gain one on the wire');
  assert.equal(ok.profileFacts[1].rev, 7);
});

// ── the round trip that makes an offline choice survive ────────────────────────────────────────

test('an equip made with no server survives the reconnect that had never heard of it', async () => {
  // Seeded: this guest owns the blade (they earned it in an earlier session) but has never equipped
  // anything. The server therefore believes they are holding the starter sword.
  const seed = [
    {
      guestId: GUEST, heroId: 'p1', type: 'gear-owned',
      eventId: `own:${GUEST}:${WILDWOOD_BLADE_ID}`, value: WILDWOOD_BLADE_ID,
    },
  ];

  await withSeededServer(seed, async ({ url }) => {
    // The child equips the blade with no network at all. Nothing is sent; the fact is journalled.
    const device = freshDevice();
    const offlineChoice = device.store.mintEquipFact(GUEST, WILDWOOD_BLADE_ID);
    assert.equal(device.store.stateFor(GUEST).equippedWeaponId, WILDWOOD_BLADE_ID,
      'the child is holding the blade before the server is ever told');

    // Now the tablet finds a server.
    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    const welcome = await c.waitFor('welcome');

    // The reconnect contract, exactly as main.js's ingestWelcome runs it.
    device.store.ingestServerFacts(GUEST, welcome.profileFacts);
    const knownToServer = new Set(welcome.profileFacts.map((fact) => fact.eventId));
    assert.equal(knownToServer.has(offlineChoice.eventId), false,
      'the premise: the server has never heard of this choice');

    const localEquip = latestEquippedFact(device.store.journalFor(GUEST));
    assert.equal(localEquip.eventId, offlineChoice.eventId, 'the choice to re-send is the one just made');
    c.send(equipMessage(localEquip.value, localEquip));

    // Read the result back through the wire this change added, rather than by reaching into the
    // database file: a second connection's welcome IS how a real returning device learns what the
    // server kept, so proving it there proves the path a child actually travels.
    const returning = client(url);
    await returning.open();
    returning.send(joinMessage('kid-again', GUEST));
    const second = await returning.waitFor('welcome');

    const stored = second.profileFacts.find((fact) => fact.type === 'weapon-equipped');
    assert.ok(stored, 'the server kept the equip the device re-sent');
    // The SAME identity and order the device minted -- not a second equip invented on arrival,
    // which is exactly what would make the two copies disagree about which weapon is current.
    assert.equal(stored.eventId, offlineChoice.eventId, "the server stored the device's identity");
    assert.equal(stored.rev, offlineChoice.rev, "and the device's order, not one minted on arrival");
    assert.equal(stored.value, WILDWOOD_BLADE_ID);

    // And the derived block the HUD reads agrees, which is the property a child would notice.
    const ownRewards = second.encounter.rewards[second.id];
    assert.equal(ownRewards?.equippedWeaponId, WILDWOOD_BLADE_ID,
      'the hero is still holding the blade the child chose while offline');

    c.socket.close();
    returning.socket.close();
  });
});
