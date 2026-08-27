// world/enemyDrops.js -- pure, rng-injected, isomorphic the same way world/cartLoot.js's own
// pickups are. Driven directly with hand-built states and scripted rng sequences so every branch of
// the roll table is exercised deterministically rather than statistically.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  COIN_DROP_KIND,
  COLLECTED_LINGER_SECONDS,
  DROP_COLLECT_RADIUS_METERS,
  DROP_EXPIRE_SECONDS,
  GEAR_DROP_KIND,
  HEART_DROP_KIND,
  HEART_HEAL_HP,
  MAX_CONCURRENT_DROPS,
  createEnemyDropsState,
  requestCollectEnemyDrop,
  requestEnemyDrop,
  stepEnemyDrops,
} from '../public/src/world/enemyDrops.js';
import { SHIELD_IRONWOOD_ID, SHOULDER_SILVERGUARD_ID } from '../public/src/progression/items.js';
import {
  HERO_MAX_HP, createPartyEncounterState, requestHeroHeal,
} from '../public/src/combat/encounter.js';
import { decode, encode, snapshotMessage } from '../public/src/net/protocol.js';
import { isClientRestorableProfileFact } from '../public/src/progression/facts.js';

/** A scripted rng: returns each queued value in order, then keeps returning the last one -- fine for
 *  every test here, none needs more draws than it queues. */
function scripted(...values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : values[values.length - 1]);
}

function kill(overrides = {}) {
  return {
    enemyId: 'wolf-1', lifeId: 'life-1', kind: 'wolf', x: 10, z: 20, ...overrides,
  };
}

test('spawn-on-defeat: a common kill always drops coins, scattered near the death spot', () => {
  // heartChance 0.25 for commons -- 0.99 always misses it; no gearChance for commons at all.
  const rng = scripted(0.4, 0.99);
  const { state, spawned } = requestEnemyDrop(createEnemyDropsState(), kill(), rng);
  assert.ok(spawned.length >= 2, 'the base coin count floor is 2');
  assert.ok(spawned.every((drop) => drop.kind === COIN_DROP_KIND));
  assert.equal(state.drops.length, spawned.length);
  for (const drop of spawned) {
    const distance = Math.hypot(drop.x - 10, drop.z - 20);
    assert.ok(distance >= 0.5 - 1e-9 && distance <= 1.0 + 1e-9,
      `drop scattered ${distance}m from the death spot, expected 0.5-1.0m`);
  }
});

test('commons: the heart roll can land, independent of the coin roll', () => {
  // coin roll first (min), then heart roll under its own 0.25 chance.
  const rng = scripted(0.0, 0.1);
  const { spawned } = requestEnemyDrop(createEnemyDropsState(), kill(), rng);
  assert.ok(spawned.some((drop) => drop.kind === HEART_DROP_KIND));
});

test('frost-wolf adds a gear roll on top of the commons table', () => {
  const rng = scripted(
    0.0, // coin roll -> min count
    0.99, // heart roll misses (0.25 chance)
    0.1, // gear roll hits (0.2 chance)
    0.0, // which gear item (index 0)
  );
  const { spawned } = requestEnemyDrop(createEnemyDropsState(), kill({ kind: 'frost-wolf' }), rng);
  const gear = spawned.find((drop) => drop.kind === GEAR_DROP_KIND);
  assert.ok(gear, 'frost-wolf must be able to roll gear');
  assert.equal(gear.itemId, SHIELD_IRONWOOD_ID);
});

test('a common (wolf/ember-wolf) kind never rolls gear, however the dice fall', () => {
  const rng = scripted(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  const { spawned } = requestEnemyDrop(createEnemyDropsState(), kill({ kind: 'wolf' }), rng);
  assert.equal(spawned.some((drop) => drop.kind === GEAR_DROP_KIND), false);
  const { spawned: ember } = requestEnemyDrop(createEnemyDropsState(), kill({ kind: 'ember-wolf' }), rng);
  assert.equal(ember.some((drop) => drop.kind === GEAR_DROP_KIND), false);
});

test('alpha-wolf: guaranteed gear-or-heart, never both, never neither, plus a bigger coin haul', () => {
  const gearRng = scripted(0.0, 0.2, 0.0); // coin min, guaranteed-roll -> gear (< 0.5), item index 0
  const gearRoll = requestEnemyDrop(createEnemyDropsState(), kill({ kind: 'alpha-wolf' }), gearRng);
  assert.equal(gearRoll.spawned.filter((d) => d.kind === GEAR_DROP_KIND).length, 1);
  assert.equal(gearRoll.spawned.filter((d) => d.kind === HEART_DROP_KIND).length, 0);
  assert.ok(gearRoll.spawned.filter((d) => d.kind === COIN_DROP_KIND).length >= 4,
    'the alpha coin floor is 4, well above the common floor of 2');

  const heartRng = scripted(0.0, 0.9); // coin min, guaranteed-roll -> heart (>= 0.5)
  const heartRoll = requestEnemyDrop(createEnemyDropsState(), kill({ kind: 'alpha-wolf' }), heartRng);
  assert.equal(heartRoll.spawned.filter((d) => d.kind === HEART_DROP_KIND).length, 1);
  assert.equal(heartRoll.spawned.filter((d) => d.kind === GEAR_DROP_KIND).length, 0);
});

test('the streak multiplier scales the coin COUNT, never a coin\'s own value', () => {
  const rng = scripted(0.0, 0.99); // min base count (2), heart misses
  const { spawned } = requestEnemyDrop(createEnemyDropsState(), kill({ streakMultiplier: 3 }), rng);
  const coins = spawned.filter((d) => d.kind === COIN_DROP_KIND);
  assert.equal(coins.length, 6, '2 base coins x3 streak multiplier');
  assert.ok(coins.every((d) => d.value === undefined), 'a coin never carries a value field -- it is always worth exactly one');
});

test('a gear drop for an already-owned item converts to coins instead of a second copy', () => {
  const rng = scripted(0.0, 0.99, 0.1, 0.0); // coin min, heart miss, gear hit, item index 0
  const withoutOwnership = requestEnemyDrop(
    createEnemyDropsState(), kill({ kind: 'frost-wolf' }), scripted(0.0, 0.99, 0.1, 0.0),
  );
  const coinsWithoutOwnership = withoutOwnership.spawned.filter((d) => d.kind === COIN_DROP_KIND).length;
  assert.equal(withoutOwnership.spawned.some((d) => d.kind === GEAR_DROP_KIND), true);

  const { spawned } = requestEnemyDrop(
    createEnemyDropsState(),
    kill({ kind: 'frost-wolf', killerOwnedItemIds: [SHIELD_IRONWOOD_ID] }),
    rng,
  );
  assert.equal(spawned.some((d) => d.kind === GEAR_DROP_KIND), false, 'no gear pickup for an owned item');
  const coinsWithOwnership = spawned.filter((d) => d.kind === COIN_DROP_KIND).length;
  assert.equal(coinsWithOwnership, coinsWithoutOwnership + 5, 'the converted gear becomes 5 extra coins');
});

test('collect authorization: unknown id, already collected, and out of reach are all refused', () => {
  const spawnRng = scripted(0.0, 0.99);
  let { state } = requestEnemyDrop(createEnemyDropsState(), kill(), spawnRng);
  const dropId = state.drops[0].id;
  const at = { x: state.drops[0].x, z: state.drops[0].z };

  const unknown = requestCollectEnemyDrop(state, 'hero-a', 'drop:not-real:1:0', at);
  assert.equal(unknown.accepted, false);

  const tooFar = requestCollectEnemyDrop(state, 'hero-a', dropId, { x: at.x + 50, z: at.z });
  assert.equal(tooFar.accepted, false);
  assert.equal(tooFar.state, state, 'a rejected collect must not mutate state');

  const ok = requestCollectEnemyDrop(state, 'hero-a', dropId, at);
  assert.equal(ok.accepted, true);
  assert.equal(ok.drop.collectedBy, 'hero-a');
  state = ok.state;

  const secondCollector = requestCollectEnemyDrop(state, 'hero-b', dropId, at);
  assert.equal(secondCollector.accepted, false, 'first collector wins, same as cartLoot\'s own rule');
});

test('collect radius matches the exported constant exactly', () => {
  const spawnRng = scripted(0.0, 0.99);
  const { state } = requestEnemyDrop(createEnemyDropsState(), kill(), spawnRng);
  assert.ok(state.drops.length >= 2, 'need at least two drops for two independent radius checks');
  const [dropA, dropB] = state.drops;

  const justInside = requestCollectEnemyDrop(
    state, 'hero-a', dropA.id, { x: dropA.x + DROP_COLLECT_RADIUS_METERS - 0.01, z: dropA.z },
  );
  assert.equal(justInside.accepted, true);

  const justOutside = requestCollectEnemyDrop(
    state, 'hero-b', dropB.id, { x: dropB.x + DROP_COLLECT_RADIUS_METERS + 0.01, z: dropB.z },
  );
  assert.equal(justOutside.accepted, false);
});

test('heart heal capping: HEART_HEAL_HP never carries a hero past their own maxHp', () => {
  let state = createPartyEncounterState({
    enemies: [{ enemyId: 'w', kind: 'wolf', patrol: [{ x: 0, z: 0 }] }],
    heroIds: ['A'],
  });
  // A hero standing 6 hp under a Level-1 max: HEART_HEAL_HP (20) would overshoot without the cap.
  const almostFull = { ...state.heroes.A, hp: HERO_MAX_HP - 6 };
  state = { ...state, heroes: { A: almostFull } };
  // requestHeroHeal reads state.heroes directly, so this hand-built shape is enough without a real
  // fight -- the same "construct a valid state object by hand" move this repo's own server adapter
  // makes (net/gameServerCore.mjs's own transferWolfHeroBody comment).
  const result = requestHeroHeal(state, 'A', HEART_HEAL_HP);
  assert.equal(result.state.heroes.A.hp, HERO_MAX_HP, 'healing must clamp at maxHp, not overshoot it');
  assert.equal(result.events[0].type, 'hero-healed');
  assert.equal(result.events[0].remaining, HERO_MAX_HP);
});

test('heart heal capping: a hero already at full hp is untouched and raises no event', () => {
  const state = createPartyEncounterState({
    enemies: [{ enemyId: 'w', kind: 'wolf', patrol: [{ x: 0, z: 0 }] }],
    heroIds: ['A'],
  });
  const result = requestHeroHeal(state, 'A', HEART_HEAL_HP);
  assert.equal(result.state, state, 'a no-op heal must not publish a new state');
  assert.deepEqual(result.events, []);
});

test('expiry: an uncollected drop vanishes at DROP_EXPIRE_SECONDS, not a tick before', () => {
  const { state } = requestEnemyDrop(createEnemyDropsState(), kill(), scripted(0.0, 0.99));
  const before = stepEnemyDrops(state, DROP_EXPIRE_SECONDS - 0.01);
  assert.ok(before.drops.length > 0, 'must not expire early');
  const after = stepEnemyDrops(before, 0.02);
  assert.equal(after.drops.length, 0, 'must be gone once past the expiry window');
});

test('a collected drop lingers COLLECTED_LINGER_SECONDS then is gone, regardless of the expiry clock', () => {
  const spawnRng = scripted(0.0, 0.99);
  let { state } = requestEnemyDrop(createEnemyDropsState(), kill(), spawnRng);
  const dropId = state.drops[0].id;
  const at = { x: state.drops[0].x, z: state.drops[0].z };
  const collected = requestCollectEnemyDrop(state, 'hero-a', dropId, at);
  assert.equal(collected.accepted, true);
  state = collected.state;

  const stillLingering = stepEnemyDrops(state, COLLECTED_LINGER_SECONDS - 0.01);
  assert.ok(stillLingering.drops.some((d) => d.id === dropId), 'must still be visible during the linger window');
  const gone = stepEnemyDrops(stillLingering, 0.02);
  assert.equal(gone.drops.some((d) => d.id === dropId), false);
});

test('the concurrent-drop cap evicts the oldest first', () => {
  let state = createEnemyDropsState();
  // Spawn MAX_CONCURRENT_DROPS + 5 individual coin drops one kill at a time, aging existing ones in
  // between so "oldest" is unambiguous.
  for (let i = 0; i < MAX_CONCURRENT_DROPS + 5; i += 1) {
    state = stepEnemyDrops(state, 1);
    const rolled = requestEnemyDrop(state, kill({ enemyId: `w-${i}`, lifeId: '0' }), scripted(0.0, 0.99, 1, 1));
    state = rolled.state;
  }
  assert.equal(state.drops.length, MAX_CONCURRENT_DROPS);
  // The very first kill's own drops must be gone; the very last kill's own drops must remain.
  assert.equal(state.drops.some((d) => d.id.startsWith('drop:w-0:')), false);
  assert.ok(state.drops.some((d) => d.id.startsWith(`drop:w-${MAX_CONCURRENT_DROPS + 4}:`)));
});

test('wire round-trip: a live drop and a just-collected one both decode intact', () => {
  const first = requestEnemyDrop(createEnemyDropsState(), kill({ enemyId: 'w-a' }), scripted(0.0, 0.99));
  const withGear = requestEnemyDrop(
    first.state, kill({ enemyId: 'w-b', kind: 'frost-wolf' }), scripted(0.0, 0.99, 0.0, 0.99),
  );
  const collected = requestCollectEnemyDrop(
    withGear.state, 'hero-a', withGear.state.drops[0].id,
    { x: withGear.state.drops[0].x, z: withGear.state.drops[0].z },
  );
  const wire = collected.state.drops.map((d) => ({
    id: d.id, kind: d.kind, x: d.x, z: d.z, ...(d.itemId ? { itemId: d.itemId } : {}),
    ...(d.collectedBy ? { collectedBy: d.collectedBy } : {}),
  }));
  const message = snapshotMessage(1, [], {
    revision: 0, enemies: [], heroes: {}, drops: wire,
  }, []);
  const decoded = decode(encode(message));
  assert.deepEqual(decoded.encounter.drops.map((d) => d.id).sort(), wire.map((d) => d.id).sort());
  const collectedOnWire = decoded.encounter.drops.find((d) => d.id === collected.drop.id);
  assert.equal(collectedOnWire.collectedBy, 'hero-a');
  const gearOnWire = decoded.encounter.drops.find((d) => d.kind === GEAR_DROP_KIND);
  assert.equal(gearOnWire.itemId, SHOULDER_SILVERGUARD_ID);
});

// H1: drops resolve into coin-earned/gear-owned facts through the EXISTING durable paths
// (net/gameServerCore.mjs reuses applyLootAward/grantOwnership verbatim), so the same shared-world
// refusal those paths already enforce covers a drop's own payout automatically -- this is the
// regression guard that keeps that true rather than assumed.
test('H1: a coin drop\'s payout type can never be client-restored, whatever its eventId looks like', () => {
  assert.equal(
    isClientRestorableProfileFact({ eventId: 'drop:wolf-1:life-1:0', type: 'coin-earned' }, 'guest-a'),
    false,
    'coin-earned is refused by TYPE (CLIENT_RESTORE_REFUSED_TYPES), independent of the eventId shape',
  );
});
