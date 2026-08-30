// The full seam the Owner's playtest actually exercised, end to end over a REAL WebSocket:
// join -> kill a real enemy -> read its real minted drop id off a real snapshot -> send
// collect-drop back through the actual encoded/decoded wire -> and the connection SURVIVES.
//
// This file exists because every prior drop test stopped one layer short. world/enemyDrops.js's
// own fold, and test/enemy-drops-server.test.mjs's `sim.applyCollectDrop(...)`, both hand the
// dropId to the simulation directly -- so the protocol decoder never ran, and a decoder that
// rejected every production drop id (test/collect-drop-wire.test.mjs's red: `dropId is longer than
// 48 characters`) stayed green all the way to a family playtest. The failure it produced there was
// not "the pickup didn't work": gameServerCore's message loop turns a ProtocolError into a 1008
// close, the client reconnects as a brand-new player, and addPlayer seats new players at {x:0,z:0}
// -- the child is teleported to spawn as the price of touching their own loot.
//
// So the assertions here are about the CONNECTION and the IDENTITY, read off the wire only:
//   - the socket never closes;
//   - no second welcome ever arrives (the playerId that joined is the playerId that collected);
//   - the authoritative body stays at the fight, never back at spawn;
//   - and the collect itself is processed (the same drop comes back `collectedBy` this player).
//
// Staging convention: like test/beacon-siege-multiplayer.test.mjs, the body is REPOSITIONED via
// game.simulation for staging (walking is not this file's subject), while everything asserted --
// snapshots, drops, welcome, the collect -- rides the real socket.

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { attachGameServer } from '../net/gameServer.mjs';
import {
  attackMessage,
  collectCorpseItemMessage, collectDropMessage,
  decode,
  encode,
  joinMessage,
} from '../public/src/net/protocol.js';
import { SWING_SECONDS } from '../public/src/combat/encounter.js';

// Outside RECOVERY_SANCTUARY (3m at HERO_SPAWN) so the fight is a real fight, near enough to spawn
// that "was the hero sent back to {0,0}" is a sharp question rather than a rounding argument.
const WOLF_SPAWN = { x: 0, z: 8 };

async function withGameServer(body) {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-drop-conn-'));
  const httpServer = createServer((_request, response) => response.writeHead(404).end());
  const game = attachGameServer(httpServer, {
    rewardStorePath: join(dir, 'rewards.db'),
    allowMissingOrigin: true,
    enemies: [{ enemyId: 'wolf-1', kind: 'wolf', spawn: WOLF_SPAWN }],
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

test('collecting a real kill drop over the real wire never costs the connection, the identity, or the position', async () => {
  await withGameServer(async ({ url, game }) => {
    const child = client(url);
    await child.open();
    child.send(joinMessage('Luke'));
    const welcome = await child.waitForSnapshot(() => child.of('welcome').length > 0, 'welcome arrived')
      .then(() => child.of('welcome')[0]);
    const playerId = welcome.id;

    // Stage the body at the wolf (the staging convention above), then kill it over the real wire:
    // attack messages through the socket, at the swing cadence the rules accept.
    const wolfDead = () => {
      const latest = child.of('snapshot').at(-1);
      const wolf = latest?.encounter?.enemies?.find((e) => e.enemyId === 'wolf-1');
      return wolf != null && wolf.hp === 0;
    };
    const deadline = Date.now() + 30000;
    let seq = 0;
    while (!wolfDead()) {
      if (Date.now() > deadline) throw new Error('the wolf survived 30s of swings');
      const body = game.simulation.players.get(playerId);
      body.x = WOLF_SPAWN.x - 0.8;
      body.z = WOLF_SPAWN.z;
      body.heading = Math.PI / 2;
      child.send(attackMessage(seq += 1));
      await new Promise((resolve) => setTimeout(resolve, Math.round((SWING_SECONDS + 0.15) * 1000)));
    }

    // THIS TEST FOLLOWED ITS OWN SUBJECT. GQ-023 was about a long, dynamically-minted reward id
    // crossing the decoder on a real kill: the inbound cap was 48, production ids were longer,
    // every legitimate pickup died in decode, the server closed the socket, and the child woke up
    // back at spawn. Nothing about that lesson is specific to GROUND drops -- it is about where a
    // kill's reward ids live. #87 moved the ordinary reward onto the personal corpse claim, and an
    // ordinary Wolf now scatters nothing collectible at all, so waiting for `encounter.drops` here
    // waited forever and proved nothing.
    //
    // So it stands where the bug stands now, and the guard got STRONGER for it: a corpse claim item
    // id (`corpse-item:<enemyId>:<lifeId>:<heroId>:coins`) is longer than the drop id that broke
    // this in the first place, and it crosses its own inbound cap on collect-corpse-item.
    const withClaim = await child.waitForSnapshot(
      (m) => (m.encounter?.corpses?.length ?? 0) > 0,
      'the kill\'s personal corpse claim rides a snapshot');
    const corpse = withClaim.encounter.corpses[0];
    const claim = corpse.claims.find((c) => c.heroId === playerId);
    assert.ok(claim, 'the killing hero must hold a claim on their own kill');
    const claimItem = claim.items[0];
    assert.ok(corpse.id.startsWith('corpse:wolf-1:'), `expected a minted corpse id, got ${corpse.id}`);
    assert.ok(claimItem.id.length > 48,
      `a production claim-item id must exceed the old 48-char cap to prove this seam (got ${claimItem.id.length})`);

    // Stand the body on the corpse and collect THROUGH THE SOCKET -- the same class of message the
    // old decoder rejected, on the path a kill now actually pays out through.
    const body = game.simulation.players.get(playerId);
    body.x = corpse.x;
    body.z = corpse.z;
    child.send(collectCorpseItemMessage(corpse.id, claimItem.id));

    // Award processed: the same item comes back on the wire as taken (the linger window
    // world/corpseLoot.js keeps a resolved corpse visible for exactly this transition).
    await child.waitForSnapshot(
      (m) => m.encounter?.corpses?.some((c) => c.id === corpse.id
        && c.claims.some((cl) => cl.heroId === playerId
          && cl.items.some((i) => i.id === claimItem.id && i.taken))),
      'the collected claim item reads taken for this player');

    // The connection survived: no close ever fired, and the socket still streams live snapshots.
    assert.deepEqual(child.closes, [], 'the server must not close the socket over a legitimate collect');
    assert.equal(child.socket.readyState, WebSocket.OPEN, 'socket still open after the collect');
    const before = child.of('snapshot').length;
    await child.waitForSnapshot(() => child.of('snapshot').length > before, 'snapshots keep flowing');

    // The identity survived: one welcome, ever. A rejected collect used to mean reconnect -> a
    // SECOND welcome with a fresh playerId; that is the teleport's identity half.
    assert.equal(child.of('welcome').length, 1, 'exactly one welcome for the whole life of the fight');

    // And the body stayed AT THE FIGHT: the authoritative position on the latest snapshot is the
    // drop's neighbourhood, not {0,0} -- the position half of "picked up my loot, woke up at spawn".
    const latest = child.of('snapshot').at(-1);
    const me = latest.players.find((p) => p.id === playerId);
    assert.ok(me, 'this player still rides every snapshot');
    const distanceToSpawn = Math.hypot(me.x, me.z);
    assert.ok(distanceToSpawn > 4,
      `the hero must still be at the fight (~8m out), not returned toward spawn -- ${distanceToSpawn.toFixed(2)}m from {0,0}`);
  });
});
