// The wire seam for #87's personal corpse loot, pinned end to end at the protocol layer -- the
// identical discipline test/collect-drop-wire.test.mjs already holds enemyDrops.js's own kill-drop
// ids to, after that file's own real-device playtest lesson: a minted id has to survive the ROUND
// TRIP through the real encode/decode pair, not merely look short enough by inspection.

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import {
  ProtocolError,
  collectCorpseAllMessage,
  collectCorpseItemMessage,
  decode,
  encode,
  snapshotMessage,
} from '../public/src/net/protocol.js';
import { createCorpseLootState, requestCorpseLoot } from '../public/src/world/corpseLoot.js';
import { ENEMY_POPULATION } from '../public/src/world/zones/village.js';

const roundTrip = (message) => decode(encode(message));

/** Real production ids for one kill of the given authored enemy, rolled with the SAME
 *  requestCorpseLoot the server's own integration calls, guaranteeing at least one claim item so
 *  every id shape (corpse id, claim item id) actually gets minted and exercised. */
function mintedCorpse(enemy, eligibleHeroIds) {
  const { spawned } = requestCorpseLoot(createCorpseLootState(), {
    enemyId: enemy.enemyId,
    lifeId: randomUUID(),
    kind: enemy.kind,
    x: 0,
    z: 0,
    eligibleHeroIds,
    guaranteedItemIds: ['quest-item'], // forces a real claim regardless of the ordinary gearChance
  }, () => 0.999999);
  assert.ok(spawned, `expected a corpse from a ${enemy.kind} kill`);
  return spawned;
}

test('every authored loot-bearing enemy\'s real minted corpse/claim ids survive the round trip', () => {
  const heroIds = ['hero-alexandra-the-first', 'hero-b'];
  for (const enemy of ENEMY_POPULATION) {
    const corpse = mintedCorpse(enemy, heroIds);
    const itemDecoded = roundTrip(collectCorpseItemMessage(corpse.id, corpse.claims[0].items[0].id));
    assert.equal(itemDecoded.type, 'collect-corpse-item');
    assert.equal(itemDecoded.corpseId, corpse.id);
    assert.equal(itemDecoded.claimItemId, corpse.claims[0].items[0].id);

    const allDecoded = roundTrip(collectCorpseAllMessage(corpse.id));
    assert.equal(allDecoded.type, 'collect-corpse-all');
    assert.equal(allDecoded.corpseId, corpse.id);
  }
});

test('the corpse id cap is pinned at the exact boundary: 96 accepted, 97 rejected', () => {
  const atCap = `corpse:${'x'.repeat(96 - 'corpse::'.length - 36)}:${randomUUID()}`;
  assert.equal(atCap.length, 96, 'fixture must sit exactly on the wire cap');
  assert.equal(roundTrip(collectCorpseItemMessage(atCap, 'item')).corpseId, atCap);
  assert.equal(roundTrip(collectCorpseAllMessage(atCap)).corpseId, atCap);
  const overCap = `${atCap}x`;
  assert.throws(() => roundTrip(collectCorpseItemMessage(overCap, 'item')), ProtocolError);
  assert.throws(() => roundTrip(collectCorpseAllMessage(overCap)), ProtocolError);
});

test('the claim item id cap is pinned at the exact boundary: 160 accepted, 161 rejected', () => {
  const atCap = `corpse-item:${'x'.repeat(160 - 'corpse-item::'.length - 36)}:${randomUUID()}`;
  assert.equal(atCap.length, 160, 'fixture must sit exactly on the wire cap');
  assert.equal(roundTrip(collectCorpseItemMessage('corpse:x', atCap)).claimItemId, atCap);
  const overCap = `${atCap}x`;
  assert.throws(() => roundTrip(collectCorpseItemMessage('corpse:x', overCap)), ProtocolError);
});

test('empty ids are rejected on both messages', () => {
  assert.throws(() => roundTrip(collectCorpseItemMessage('', 'item')), ProtocolError);
  assert.throws(() => roundTrip(collectCorpseItemMessage('corpse:x', '')), ProtocolError);
  assert.throws(() => roundTrip(collectCorpseAllMessage('')), ProtocolError);
});

test('a full snapshot carrying real corpses survives the round trip', () => {
  const corpse = mintedCorpse(ENEMY_POPULATION.find((e) => e.kind === 'frost-wolf'), ['hero-a']);
  const message = snapshotMessage(1, [], { revision: 1, enemies: [], heroes: {}, corpses: [corpse] }, []);
  const decoded = roundTrip(message);
  assert.equal(decoded.encounter.corpses.length, 1);
  const [decodedCorpse] = decoded.encounter.corpses;
  assert.equal(decodedCorpse.id, corpse.id);
  assert.equal(decodedCorpse.claims.length, corpse.claims.length);
  assert.equal(decodedCorpse.claims[0].items[0].itemId, corpse.claims[0].items[0].itemId);
  assert.equal(decodedCorpse.claims[0].items[0].taken, false);
});

test('an encounter with no corpses field decodes to an empty corpse list -- additive, not a version bump', () => {
  const message = snapshotMessage(1, [], { revision: 1, enemies: [], heroes: {} }, []);
  const decoded = roundTrip(message);
  assert.deepEqual(decoded.encounter.corpses, []);
});

test('a snapshot with too many corpses is rejected', () => {
  const many = Array.from({ length: 17 }, (_, i) => ({
    id: `corpse:wolf-${i}:${randomUUID()}`,
    x: 0,
    z: 0,
    claims: [{ heroId: 'a', items: [{ id: `item-${i}`, kind: 'gear', itemId: 'shield-ironwood', taken: false }] }],
  }));
  const message = snapshotMessage(1, [], { revision: 1, enemies: [], heroes: {}, corpses: many }, []);
  assert.throws(() => roundTrip(message), ProtocolError);
});

test('a duplicate corpse id on the same snapshot is rejected', () => {
  const corpse = {
    id: 'corpse:dup:1',
    x: 0,
    z: 0,
    claims: [{ heroId: 'a', items: [{ id: 'item-1', kind: 'gear', itemId: 'shield-ironwood', taken: false }] }],
  };
  const message = snapshotMessage(1, [], { revision: 1, enemies: [], heroes: {}, corpses: [corpse, corpse] }, []);
  assert.throws(() => roundTrip(message), ProtocolError);
});
