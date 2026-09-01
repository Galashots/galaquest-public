import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createSimulation } from '../net/gameServer.mjs';
import {
  PROTOCOL_VERSION,
  ProtocolError,
  decode,
  encode,
  snapshotMessage,
} from '../public/src/net/protocol.js';
import { createRewardLedger, foldEvents } from '../public/src/rewards/marks.js';

function enemy(overrides = {}) {
  return {
    enemyId: 'wolf-1',
    kind: 'wolf',
    x: 2.5,
    z: 8,
    heading: 0,
    hp: 3,
    mode: 'idle',
    modeSeconds: 0,
    targetId: null,
    ...overrides,
  };
}

function encounter(enemies = [enemy()]) {
  return {
    revision: 1,
    enemies,
    heroes: {},
    rewards: {},
    loot: { spawned: false, collected: {} },
    village: { coins: 0, shards: 0, workshopOwned: false },
    siege: {
      seals: [],
      warden: {
        x: 0, z: 0, heading: 0, hp: 0, mode: 'dormant', modeSeconds: 0, phase: 1, targetId: null,
      },
      beaconLit: false,
    },
  };
}

function decodeEncounter(enemies) {
  return decode(encode(snapshotMessage(1, [], encounter(enemies), []))).encounter;
}

test('protocol v4 carries stable enemy identity and exposes only a derived C2 Wolf bridge', () => {
  assert.equal(PROTOCOL_VERSION, 4);
  const decoded = decodeEncounter([
    enemy({ enemyId: 'wolf-a', x: 1 }),
    enemy({ enemyId: 'wolf-b', x: 4, mode: 'walk' }),
  ]);

  assert.deepEqual(decoded.enemies.map(({ enemyId, kind }) => ({ enemyId, kind })), [
    { enemyId: 'wolf-a', kind: 'wolf' },
    { enemyId: 'wolf-b', kind: 'wolf' },
  ]);
  assert.equal(decoded.wolf, decoded.enemies[0], 'C2 bridge is derived from the decoded collection');
  assert.equal(Object.keys(decoded).includes('wolf'), false, 'bridge is not a serialized second authority');
});

test('protocol v4 rejects malformed, duplicate, unsupported-kind, and invalid-mode enemies', () => {
  assert.throws(() => decodeEncounter([enemy({ enemyId: '' })]), ProtocolError);
  assert.throws(() => decodeEncounter([
    enemy({ enemyId: 'wolf-a' }),
    enemy({ enemyId: 'wolf-a', x: 6 }),
  ]), ProtocolError);
  assert.throws(() => decodeEncounter([enemy({ enemyId: 'spriggan-1', kind: 'spriggan' })]), ProtocolError);
  assert.throws(() => decodeEncounter([enemy({ mode: 'teleporting' })]), ProtocolError);

  // The builder has a temporary C2 input bridge for older in-process callers, but literal v4 bytes
  // are collection-only. Prove the decoder itself will not guess an old singular Wolf into v4.
  assert.throws(() => decode(encode({
    v: PROTOCOL_VERSION,
    type: 'snapshot',
    tick: 1,
    players: [],
    encounter: {
      revision: 1,
      wolf: { x: 0, z: 0, heading: 0, hp: 3, mode: 'idle', targetId: null },
      heroes: {},
    },
    events: [],
  })), ProtocolError);
});

test('server default snapshot contains the authored R1 population and no singular wire slot', () => {
  const simulation = createSimulation();
  const snapshot = simulation.encounterSnapshot();

  // R1 grew this to twelve bodies across four kinds -- see village.js's own ENEMY_POPULATION header.
  // Before the first tick (this is the fresh boot snapshot) the order is still authoring order, not
  // stepParty's own stable-id sort, which is why this list is not simply alphabetical.
  assert.deepEqual(snapshot.enemies.map((enemy) => enemy.enemyId), [
    'wolf-1', 'wolf-2', 'wolf-3', 'wolf-4', 'wolf-5', 'wolf-6', 'wolf-7',
    'ember-wolf-1', 'ember-wolf-2', 'frost-wolf-1', 'frost-wolf-2', 'alpha-wolf-1',
  ]);
  assert.deepEqual(snapshot.enemies.map((enemy) => enemy.kind), [
    'wolf', 'wolf', 'wolf', 'wolf', 'wolf', 'wolf', 'wolf',
    'ember-wolf', 'ember-wolf', 'frost-wolf', 'frost-wolf', 'alpha-wolf',
  ]);
  assert.equal(Object.keys(snapshot).includes('wolf'), false, 'derived C2 bridge is not enumerable/wire state');
  assert.equal(JSON.stringify(snapshot).includes('\"wolf\":'), false, 'singular Wolf is absent from serialized server state');
});

test('server fixture can own two stable ordinary enemies through the same collection seam', () => {
  const simulation = createSimulation({
    enemies: [
      { enemyId: 'wolf-a', kind: 'wolf', spawn: { x: -2, z: 8 } },
      { enemyId: 'wolf-b', kind: 'wolf', spawn: { x: 3, z: 9 } },
    ],
  });
  assert.deepEqual(simulation.encounterSnapshot().enemies.map((item) => item.enemyId), ['wolf-a', 'wolf-b']);
});

test('mark contributors are isolated by enemy life and non-Wolf defeats mint no Lantern Mark', () => {
  let ledger = createRewardLedger();

  let folded = foldEvents(ledger, [
    { type: 'wolf-hit', enemyId: 'wolf-a', kind: 'wolf', heroId: 'hero-a' },
    { type: 'wolf-hit', enemyId: 'wolf-b', kind: 'wolf', heroId: 'hero-b' },
    { type: 'wolf-defeated', enemyId: 'wolf-a', kind: 'wolf', heroId: 'hero-a' },
  ], { mintLifeId: () => 'life-a' });
  ledger = folded.ledger;
  assert.deepEqual(folded.awards.map((award) => [award.heroId, award.lifeId]), [['hero-a', 'life-a']]);

  folded = foldEvents(ledger, [
    { type: 'wolf-defeated', enemyId: 'wolf-b', kind: 'wolf', heroId: 'hero-b' },
  ], { mintLifeId: () => 'life-b' });
  ledger = folded.ledger;
  assert.deepEqual(folded.awards.map((award) => [award.heroId, award.lifeId]), [['hero-b', 'life-b']]);

  folded = foldEvents(ledger, [
    { type: 'wolf-hit', enemyId: 'spriggan-1', kind: 'spriggan', heroId: 'hero-a' },
    { type: 'wolf-defeated', enemyId: 'spriggan-1', kind: 'spriggan', heroId: 'hero-a' },
  ], { mintLifeId: () => 'must-not-mint' });
  assert.deepEqual(folded.awards, []);
});
