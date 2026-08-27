// Issue #82: the Owner equipped the Wildwood Blade during the PR #80 family playtest and the hero
// kept holding the Ironwood sword. This file stands the full seam that gameplay actually exercised,
// end to end over a REAL WebSocket, the same discipline test/collect-drop-connection.test.mjs
// established for GQ-023: every prior equip test handed the itemId to rewards.applyEquip or the
// fold directly, so the protocol decoder and the connection-level consequences of a refusal never
// ran under test.
//
// Three claims, each one layer of the leg that failed on the playtest build:
//   1. A real client-minted equip identity -- `equip:<profileId>:<rev>:<uuid>`, minted by the SAME
//      mintEquipFact the Hero screen calls, at the longest legal profile id -- survives decode and
//      comes back on the wire as rewards[player].equippedWeaponId, with the socket, identity, and
//      snapshots all intact. The wire id then resolves through the SAME weaponMeshIdFor /
//      weaponVisibility rules main.js draws by, so "the wire said Blade" and "the hand shows Blade"
//      are proven to be one law, not two.
//   2. The decode seam is pinned against its cap the way GQ-023 prescribes: the longest REAL
//      producer is named and proven under EVENT_ID_MAX_LENGTH, so a future cap change meets a red
//      test instead of a family playtest.
//   3. An equip for an item this player does not own is refused CLEANLY -- no close, no second
//      welcome, equipped weapon unchanged. This is the claim-blade posture ("a refused claim is a
//      clean silence, not a disconnect") applied to equip, and it is not hypothetical: during the
//      same playtest, the GQ-023 socket close was reseating players as fresh identities that owned
//      nothing, so a legitimate EQUIP tap could land on a server that no longer credited the item.
//      A throw here costs the whole connection for a message an honest client can send.
//
// Staging convention (test/collect-drop-connection.test.mjs): ownership is granted via
// game.rewards.claimWildwoodBlade -- earning the blade is G4's subject, not this file's -- while
// everything asserted (decode, the equip, the rewards block, the refusal) rides the real socket.

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { attachGameServer } from '../net/gameServer.mjs';
import { decode, encode, equipMessage, joinMessage } from '../public/src/net/protocol.js';
import { createProfileStore } from '../public/src/progression/profiles.js';
import { DEFAULT_EQUIPPED_WEAPON_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
import {
  WILDWOOD_BLADE_CANDIDATE_ID,
  weaponMeshIdFor,
  weaponVisibility,
} from '../public/src/character/weaponLoadout.js';

// The ceilings the identity is built against, exercised at their maxima so this test stands where a
// production id would first die: a 64-char guest id (net/protocolCore.js GUEST_ID_PATTERN) and a
// 64-char profile id (the ceiling protocolCore's own EVENT_ID_MAX_LENGTH comment derives from).
const LONGEST_GUEST_ID = `g-equip-wire-${'x'.repeat(51)}`;
const LONGEST_PROFILE_ID = `p-equip-wire-${'y'.repeat(51)}`;

function mintRealEquipIdentity(profileId, itemId) {
  // The SAME mint the Hero screen's EQUIP tap uses (main.js equipHeroItem ->
  // profiles.mintEquipFact), on an isolated in-memory store: the point is the identity's real
  // production shape, not this device's journal.
  const profiles = createProfileStore({ storage: null });
  const fact = profiles.mintEquipFact(profileId, itemId);
  return { eventId: fact.eventId, rev: fact.rev };
}

async function withGameServer(body) {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-equip-wire-'));
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
  const closes = [];
  socket.addEventListener('message', (event) => messages.push(decode(event.data)));
  socket.addEventListener('close', (event) => closes.push({ code: event.code, reason: event.reason }));
  return {
    socket,
    messages,
    closes,
    open: () => new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('failed to open')), { once: true });
    }),
    send: (message) => socket.send(encode(message)),
    of: (type) => messages.filter((m) => m.type === type),
    waitForSnapshot: async (predicate, why, timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const match = messages.filter((m) => m.type === 'snapshot').find(predicate);
        if (match) return match;
        if (Date.now() > deadline) throw new Error(`timed out waiting for a snapshot where ${why}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
  };
}

test('a real client-minted Wildwood equip crosses the wire and resolves to the Blade in his hand', async () => {
  await withGameServer(async ({ url, game }) => {
    const child = client(url);
    await child.open();
    child.send(joinMessage('Luke', LONGEST_GUEST_ID));
    await child.waitForSnapshot(() => child.of('welcome').length > 0, 'welcome arrived');
    const playerId = child.of('welcome')[0].id;

    // Staging: he has earned the Blade (G4's subject, not this file's).
    game.rewards.claimWildwoodBlade(playerId);

    // The tap: the exact message, with the exact identity, the Hero screen sends.
    const identity = mintRealEquipIdentity(LONGEST_PROFILE_ID, WILDWOOD_BLADE_ID);
    child.send(equipMessage(WILDWOOD_BLADE_ID, identity));

    // The wire answers with the equip applied...
    const equipped = await child.waitForSnapshot(
      (m) => m.encounter?.rewards?.[playerId]?.equippedWeaponId === WILDWOOD_BLADE_ID,
      'the rewards block carries the Wildwood Blade as equipped');

    // ...on a connection that never paid for it.
    assert.deepEqual(child.closes, [], 'the server must not close the socket over a legitimate equip');
    assert.equal(child.socket.readyState, WebSocket.OPEN, 'socket still open after the equip');
    assert.equal(child.of('welcome').length, 1, 'exactly one welcome -- the identity survived');

    // And the id the wire carried IS the id the hand is drawn by -- one law, not two. This is the
    // exact join main.js makes every frame (equippedWeaponIdFromRewards -> ensureEquippedWeaponMesh
    // -> weaponVisibility), reproduced through the same exported rules.
    const wireWeaponId = equipped.encounter.rewards[playerId].equippedWeaponId;
    assert.equal(weaponMeshIdFor(wireWeaponId), WILDWOOD_BLADE_CANDIDATE_ID,
      'the wire id must resolve to the candidate Blade mesh');
    assert.deepEqual(weaponVisibility({ equippedItemId: wireWeaponId, candidateMounted: true }),
      { shipping: false, candidate: true },
      'with the GLB mounted, exactly the Blade is visible -- never the Ironwood sword, never both');
  });
});

test('the longest real equip identity fits the decode cap, with the producer named (GQ-023)', () => {
  // The producer: mintEquipFact at a 64-char profile id, an epoch-millis rev (13 digits until the
  // year 2286), and a 36-char UUID. If EVENT_ID_MAX_LENGTH ever shrinks below what this real mint
  // produces, THIS goes red -- not a family playtest (GQ-023: name the longest real producer).
  const identity = mintRealEquipIdentity(LONGEST_PROFILE_ID, WILDWOOD_BLADE_ID);
  assert.ok(identity.eventId.startsWith(`equip:${LONGEST_PROFILE_ID}:`),
    `expected the real production shape, got ${identity.eventId}`);
  const decoded = decode(encode(equipMessage(WILDWOOD_BLADE_ID, identity)));
  assert.equal(decoded.eventId, identity.eventId, 'the real identity must survive the real decoder');
  assert.equal(decoded.rev, identity.rev);
});

test('an equip for an unowned item is a clean refusal, never a disconnect', async () => {
  await withGameServer(async ({ url }) => {
    const child = client(url);
    await child.open();
    child.send(joinMessage('Henrik', LONGEST_GUEST_ID));
    await child.waitForSnapshot(() => child.of('welcome').length > 0, 'welcome arrived');
    const playerId = child.of('welcome')[0].id;

    // No claim staged: this player does NOT own the Blade. An honest client can still send this --
    // the playtest build's socket-close bug (GQ-023) was reseating players as fresh identities that
    // owned nothing, mid-session, while the Hero screen still offered the item the child had
    // legitimately earned moments earlier. Same class as a claim-blade arriving a beat early, and
    // the server's posture there is written down: a clean silence, not a disconnect.
    const identity = mintRealEquipIdentity(LONGEST_PROFILE_ID, WILDWOOD_BLADE_ID);
    child.send(equipMessage(WILDWOOD_BLADE_ID, identity));

    // The refusal must cost nothing: snapshots keep flowing on the SAME identity...
    const before = child.of('snapshot').length;
    await child.waitForSnapshot(() => child.of('snapshot').length > before + 3,
      'snapshots keep flowing after the refused equip');
    assert.deepEqual(child.closes, [], 'a refused equip must not close the connection');
    assert.equal(child.socket.readyState, WebSocket.OPEN, 'socket still open after the refusal');
    assert.equal(child.of('welcome').length, 1, 'no reconnect, no second welcome');

    // ...and the equipped weapon is simply unchanged.
    const latest = child.of('snapshot').at(-1);
    assert.equal(latest.encounter.rewards[playerId].equippedWeaponId, DEFAULT_EQUIPPED_WEAPON_ID,
      'the refused equip must leave the default weapon equipped');
  });
});
