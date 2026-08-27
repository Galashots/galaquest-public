// A family's save has to survive the server database being gone, not merely the server being down.
//
// The reconnect path added at 13c355a covers the easy half: the server still knows this child, and a
// choice it never heard about is re-sent. The hard half is the one the local-first design exists for
// -- `data/rewards.db` is deleted, replaced, or has simply never seen this profile, and the only
// record of what the child earned is on the device.
//
// Re-sending the equip alone cannot work there, and the reason is worth stating because it is a
// property of the server being CORRECT rather than a bug: net/gameServer.mjs's applyEquip refuses a
// weapon the guest does not own. Against an empty store the child owns nothing but the starter
// sword, so the recovered choice is rejected and the hero is snapped back to a weapon the child
// stopped holding. The ownership has to be restored with -- or before -- the choice that depends on
// it. That ordering is the whole subject of this file.
//
// The trust boundary is deliberate and narrow. A restored fact is recorded with its origin, so a
// client-attested row stays distinguishable from one the server adjudicated, forever. The server
// still decides every LIVE question: did that hit land, is this affordable, is this claim in range.
// What a device may do is tell the server what it already held. For a same-device family game with
// no accounts and no competitive stakes that is the trade AGENTS.md already records; the cost of
// refusing it is a child losing their sword because a database file was replaced.

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { attachGameServer } from '../net/gameServer.mjs';
import { openRewardStore } from '../net/rewardStore.mjs';
import {
  ProtocolError,
  decode,
  encode,
  equipMessage,
  joinMessage,
  restoreProfileMessage,
} from '../public/src/net/protocol.js';
import { createProfileStore } from '../public/src/progression/profiles.js';
import { STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';

const GUEST = 'p-recovery-1111-2222-3333';

/** A tablet that has been played on: it owns the Blade, it is holding the Blade, and it has two
 *  marks. Everything here was earned on a server that no longer exists. */
function playedOnDevice() {
  const memory = new Map();
  let uuid = 0;
  const store = createProfileStore({
    storage: {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => { memory.set(k, String(v)); },
      removeItem: (k) => { memory.delete(k); },
    },
    randomUUID: () => `uuid-${uuid += 1}`,
    now: () => new Date(1_700_000_000_000 + (uuid += 1) * 1000),
  });
  store.recordFacts(GUEST, [
    { eventId: 'mark:old:one', type: 'mark-earned' },
    { eventId: 'mark:old:two', type: 'mark-earned' },
    { eventId: `own:${GUEST}:${WILDWOOD_BLADE_ID}`, type: 'gear-owned', value: WILDWOOD_BLADE_ID },
  ]);
  const equip = store.mintEquipFact(GUEST, WILDWOOD_BLADE_ID);
  return { store, equip };
}

/** A server whose reward database has never seen anybody. */
async function withEmptyServer(body) {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-empty-recovery-'));
  const httpServer = createServer((_request, response) => response.writeHead(404).end());
  const game = attachGameServer(httpServer, {
    rewardStorePath: join(dir, 'rewards.db'),
    allowMissingOrigin: true,
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  try {
    return await body({ url: `ws://127.0.0.1:${port}/ws`, storePath: join(dir, 'rewards.db') });
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
    waitFor: async (type, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = messages.find((m) => m.type === type);
        if (found) return found;
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${type}; saw ${JSON.stringify(messages.map((m) => m.type))}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    /** Rejoin on a fresh connection and read what the server now believes. This is how a real device
     *  finds out, so it is how the tests ask. */
    close: () => socket.close(),
  };
}

async function rejoinAndRead(url, guestId = GUEST) {
  const c = client(url);
  await c.open();
  c.send(joinMessage('kid-again', guestId));
  const welcome = await c.waitFor('welcome');
  c.close();
  return welcome;
}

test('the premise: against an empty store, re-sending only the equip loses the weapon', async () => {
  await withEmptyServer(async ({ url }) => {
    const device = playedOnDevice();

    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    const welcome = await c.waitFor('welcome');
    assert.deepEqual(welcome.profileFacts, [], 'the premise: this server has never seen this child');

    // Exactly what 13c355a's reconnect path does, and it is not enough here.
    c.send(equipMessage(device.equip.value, device.equip));
    await new Promise((resolve) => setTimeout(resolve, 300));

    const second = await rejoinAndRead(url);
    assert.notEqual(
      second.encounter.rewards[second.id]?.equippedWeaponId,
      WILDWOOD_BLADE_ID,
      'the server is right to refuse: on this store the child owns no Blade to equip',
    );
    c.close();
  });
});

test('restoring the journal first is what lets the recovered choice stand', async () => {
  await withEmptyServer(async ({ url }) => {
    const device = playedOnDevice();

    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    await c.waitFor('welcome');

    // The whole journal, ownership and choice together, in one message. Sent as one rather than as
    // "ownership, then equip" so the server can validate the two against each other -- see the
    // integrity case below.
    c.send(restoreProfileMessage(device.store.journalFor(GUEST)));
    await new Promise((resolve) => setTimeout(resolve, 300));

    const welcome = await rejoinAndRead(url);
    const own = welcome.encounter.rewards[welcome.id];
    assert.equal(own.marks, 2, 'the marks came back');
    assert.ok(own.ownedItemIds.includes(WILDWOOD_BLADE_ID), 'the Blade is owned again');
    assert.equal(own.equippedWeaponId, WILDWOOD_BLADE_ID, 'and the hero is holding what the child chose');

    c.close();
  });
});

test('a restored fact is recorded as client-attested, and stays distinguishable', async () => {
  await withEmptyServer(async ({ url, storePath }) => {
    const device = playedOnDevice();

    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    await c.waitFor('welcome');
    c.send(restoreProfileMessage(device.store.journalFor(GUEST)));
    await new Promise((resolve) => setTimeout(resolve, 300));
    c.close();

    // Read the rows back out of the database itself: the attestation has to be a property of the
    // record, not of anyone's memory of how it got there.
    const audit = openRewardStore(storePath);
    try {
      const facts = audit.profileFactsFor(GUEST);
      assert.ok(facts.length >= 4, `expected the restored history, got ${JSON.stringify(facts)}`);
      for (const fact of facts) {
        assert.equal(fact.origin, 'client', `${fact.eventId} must be marked as attested by the device`);
      }
    } finally {
      audit.close();
    }
  });
});

test('a server-adjudicated fact is NOT marked client-attested', async () => {
  // The other half of the distinction: if everything were labelled the label would say nothing.
  await withEmptyServer(async ({ url, storePath }) => {
    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    await c.waitFor('welcome');
    // A real equip of a weapon the child genuinely owns by default -- adjudicated, not restored.
    c.send(equipMessage(STARTER_SWORD_ID, { eventId: `equip:${GUEST}:5:server-side`, rev: 5 }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    c.close();

    const audit = openRewardStore(storePath);
    try {
      const fact = audit.profileFactsFor(GUEST).find((f) => f.type === 'weapon-equipped');
      assert.ok(fact, 'the equip was recorded');
      assert.equal(fact.origin, undefined, 'a fact the server adjudicated carries no client attestation');
    } finally {
      audit.close();
    }
  });
});

test('a restore cannot claim a weapon it does not also restore ownership of', async () => {
  await withEmptyServer(async ({ url }) => {
    const device = playedOnDevice();
    // The equip, but not the gear-owned that justifies it.
    const equipOnly = device.store.journalFor(GUEST).filter((fact) => fact.type !== 'gear-owned');

    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    await c.waitFor('welcome');
    c.send(restoreProfileMessage(equipOnly));
    await new Promise((resolve) => setTimeout(resolve, 300));

    const welcome = await rejoinAndRead(url);
    const own = welcome.encounter.rewards[welcome.id];
    assert.equal(own.marks, 2, 'the marks are still restorable -- they depend on nothing');
    assert.notEqual(
      own.equippedWeaponId,
      WILDWOOD_BLADE_ID,
      'an equip with no matching ownership must not stand: derived state would contradict itself',
    );
    c.close();
  });
});

test('restoring twice does not double anything', async () => {
  await withEmptyServer(async ({ url }) => {
    const device = playedOnDevice();
    const journal = device.store.journalFor(GUEST);

    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    await c.waitFor('welcome');
    c.send(restoreProfileMessage(journal));
    c.send(restoreProfileMessage(journal));
    await new Promise((resolve) => setTimeout(resolve, 400));

    const welcome = await rejoinAndRead(url);
    assert.equal(welcome.encounter.rewards[welcome.id].marks, 2, 'two marks, restored twice, is two marks');
    c.close();
  });
});

test('a connection with no durable identity has nothing to restore into', async () => {
  await withEmptyServer(async ({ url }) => {
    const device = playedOnDevice();
    const c = client(url);
    await c.open();
    c.send(joinMessage('kid')); // no guestId: ephemeral
    await c.waitFor('welcome');
    c.send(restoreProfileMessage(device.store.journalFor(GUEST)));
    await new Promise((resolve) => setTimeout(resolve, 300));

    // The connection survives -- a refused restore is not a protocol violation -- and nothing was
    // written under a guest this connection never claimed.
    const asGuest = await rejoinAndRead(url);
    assert.deepEqual(asGuest.profileFacts, [], 'an ephemeral connection must not be able to write a profile');
    c.close();
  });
});

// ── wire shape ─────────────────────────────────────────────────────────────────────────────────

test('the restore message validates its facts rather than forwarding whatever arrives', () => {
  assert.throws(() => decode(encode({ ...restoreProfileMessage([]), facts: 'nope' })), ProtocolError);
  assert.throws(
    () => decode(encode({ ...restoreProfileMessage([]), facts: [{ type: 'mark-earned' }] })),
    ProtocolError,
    'a fact with no eventId has no name to be idempotent under',
  );

  const ok = decode(encode(restoreProfileMessage([
    { eventId: 'mark:one', type: 'mark-earned' },
    { eventId: 'equip:a', type: 'weapon-equipped', value: WILDWOOD_BLADE_ID, rev: 9 },
  ])));
  assert.equal(ok.facts.length, 2);
  assert.equal(ok.facts[1].rev, 9);
});
