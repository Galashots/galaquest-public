// The wire seam the enemy-drop tests bypassed, pinned end to end at the protocol layer.
//
// Found by the Owner's real-device playtest, diagnosed by Sol's independent review, and proven red
// at c84d9dd: world/enemyDrops.js mints `drop:<enemyId>:<lifeId>:<index>` with the server's own
// randomUUID() as lifeId -- 50 characters for the SHORTEST real enemy id, 56 for a frost wolf --
// while protocolCore's `collect-drop` decoder capped dropId at PICKUP_ID_MAX_LENGTH (48), a limit
// sized for authored cart tokens like "cart-loot:shard:1". Every legitimate kill-drop collection
// therefore died in decode; gameServerCore's message handler turns that ProtocolError into a 1008
// close, the client reconnects as a NEW player, and simulation.addPlayer seats new players at
// {x:0,z:0} -- so the child experiences "I picked up my loot and got teleported to the start".
//
// The enemy-drops-server tests never saw it because they call requestCollectEnemyDrop directly on
// the world module; the drops themselves reached clients fine because the server->client leg
// (decodeDrop) already used DROP_ID_MAX_LENGTH (96). One id, two directions, two different caps --
// this file exists so the two legs can never drift apart again.
//
// GQ-007 throughout: ids are minted by the real requestEnemyDrop with a real randomUUID lifeId,
// never retyped; the round trip is the real encode/decode pair.

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import { ProtocolError, collectDropMessage, decode, encode } from '../public/src/net/protocol.js';
import { createEnemyDropsState, requestEnemyDrop } from '../public/src/world/enemyDrops.js';
import { ENEMY_POPULATION } from '../public/src/world/zones/village.js';

const roundTrip = (message) => decode(encode(message));

/**
 * Real production ids for one kill of the given authored enemy: the same requestEnemyDrop the
 * server's fold calls, with the same randomUUID lifeId shape it mints. rng pinned high so the
 * table's chance rolls all land and at least one drop always spawns.
 */
function mintedDropIds(enemy) {
  const { state } = requestEnemyDrop(createEnemyDropsState(), {
    enemyId: enemy.enemyId,
    lifeId: randomUUID(),
    kind: enemy.kind,
    x: 0,
    z: 0,
  }, () => 0.999999);
  assert.ok(state.drops.length > 0, `expected at least one drop from a ${enemy.kind} kill`);
  return state.drops.map((drop) => drop.id);
}

test('every authored enemy\'s real minted drop id survives the collect-drop round trip', () => {
  // The whole authored population, not a sample: the id embeds enemyId, so the longest authored
  // name is the one that breaks first, and a future rename must not quietly re-open this hole.
  for (const enemy of ENEMY_POPULATION) {
    for (const id of mintedDropIds(enemy)) {
      const decoded = roundTrip(collectDropMessage(id));
      assert.equal(decoded.type, 'collect-drop');
      assert.equal(decoded.dropId, id,
        `production drop id ${JSON.stringify(id)} (${id.length} chars) must decode intact`);
    }
  }
});

test('the client->server cap matches the server->client cap for the same id', () => {
  // decodeDrop (server->client, encounter.drops[].id) accepts up to DROP_ID_MAX_LENGTH. The same
  // physical id comes straight back in collect-drop, so the return leg must accept everything the
  // outbound leg can carry. Pinned at the exact boundary: 96 accepted, 97 rejected.
  const atCap = `drop:${'x'.repeat(96 - 'drop:::0'.length - 36)}:${randomUUID()}:0`;
  assert.equal(atCap.length, 96, 'fixture must sit exactly on the outbound cap');
  assert.equal(roundTrip(collectDropMessage(atCap)).dropId, atCap);
  const overCap = `${atCap}x`;
  assert.throws(() => roundTrip(collectDropMessage(overCap)), ProtocolError,
    'a dropId past the shared cap must still be rejected -- the fix widens to the existing wire authority, it does not uncap');
});
