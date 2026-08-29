// world/corpseLoot.js -- pure, rng-injected, the same discipline test/enemy-drops.test.mjs already
// holds that module to. Driven directly with hand-built states and scripted rng sequences so every
// branch (eligibility, ownership-aware suppression, guaranteed rewards, personal claim isolation,
// retirement) is exercised deterministically rather than statistically.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  CORPSE_GEAR_KIND,
  CORPSE_LOOT_EXPIRE_SECONDS,
  CORPSE_LOOT_INTERACT_RADIUS_METERS,
  MAX_CONCURRENT_CORPSES,
  createCorpseLootState,
  requestClaimAllCorpseLoot,
  requestClaimCorpseItem,
  requestCorpseLoot,
  stepCorpseLoot,
} from '../public/src/world/corpseLoot.js';
import { SHIELD_IRONWOOD_ID, SHOULDER_SILVERGUARD_ID } from '../public/src/progression/items.js';

/** A scripted rng: returns each queued value in order, then keeps returning the last one. */
function scripted(...values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : values[values.length - 1]);
}

function kill(overrides = {}) {
  return {
    enemyId: 'wolf-1', lifeId: 'life-1', kind: 'frost-wolf', x: 10, z: 20,
    eligibleHeroIds: ['a'], ownedItemIdsFor: () => [], ...overrides,
  };
}

test('two eligible players receive independent personal state', () => {
  // frost-wolf gearChance is 0.2: both rolls hit (0.1 < 0.2), each picks pool index 0.
  const rng = scripted(0.1, 0.0, 0.1, 0.0);
  const { spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a', 'b'],
  }), rng);
  assert.ok(spawned, 'a corpse must spawn when eligible heroes actually roll something');
  assert.equal(spawned.claims.length, 2);
  const claimA = spawned.claims.find((c) => c.heroId === 'a');
  const claimB = spawned.claims.find((c) => c.heroId === 'b');
  assert.ok(claimA && claimB, 'each eligible hero gets their own claim entry');
  assert.notEqual(claimA.items[0].id, claimB.items[0].id, 'claim item ids must not collide across heroes');
});

test('A loots; B\'s claim remains untouched', () => {
  const rng = scripted(0.1, 0.0, 0.1, 0.0);
  const { state: spawnedState, spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a', 'b'],
  }), rng);
  const claimA = spawned.claims.find((c) => c.heroId === 'a');
  const { state: afterA, accepted } = requestClaimCorpseItem(
    spawnedState, 'a', spawned.id, claimA.items[0].id, { x: 10, z: 20 },
  );
  assert.equal(accepted, true);

  const corpseAfter = afterA.corpses.find((c) => c.id === spawned.id);
  const stillClaimB = corpseAfter.claims.find((c) => c.heroId === 'b');
  assert.equal(stillClaimB.items[0].taken, false, 'B\'s own item must still be sitting there, untaken');
  const nowClaimA = corpseAfter.claims.find((c) => c.heroId === 'a');
  assert.equal(nowClaimA.items[0].taken, true);
});

test('one player\'s claim cannot be taken through another player\'s heroId', () => {
  const rng = scripted(0.1, 0.0, 0.1, 0.0);
  const { state: spawnedState, spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a', 'b'],
  }), rng);
  const claimB = spawned.claims.find((c) => c.heroId === 'b');
  // 'a' tries to take the exact item id that actually belongs to 'b's own claim.
  const { state, accepted, item } = requestClaimCorpseItem(
    spawnedState, 'a', spawned.id, claimB.items[0].id, { x: 10, z: 20 },
  );
  assert.equal(accepted, false, 'a hero must never be able to consume a sibling\'s personal loot');
  assert.equal(item, null);
  assert.equal(state, spawnedState, 'a rejected claim must not mutate state at all');
});

test('no killing-blow monopoly: a non-killer contributor gets their own independent gear chance', () => {
  // heroId 'b' is eligible but never the killer, and its own roll (0.1 < 0.2 frost-wolf gearChance)
  // hits independently of whatever the killer's own pre-rolled item was (or was not).
  const rng = scripted(0.1, 0.0);
  const { spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a', 'b'],
    killerHeroId: 'a',
    killerGearItemId: null, // the killing blow's own ground roll produced no gear this kill
  }), rng);
  assert.ok(spawned, 'a contributor who did not land the killing blow must still be able to loot gear');
  assert.equal(spawned.claims.length, 1);
  assert.equal(spawned.claims[0].heroId, 'b');
});

test('the killer\'s own claim reuses the exact item enemyDrops.js already rolled and ownership-checked', () => {
  const rng = scripted(0.99); // the non-killer contributor's own independent roll misses
  const { spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a', 'b'],
    killerHeroId: 'a',
    killerGearItemId: SHOULDER_SILVERGUARD_ID,
  }), rng);
  assert.equal(spawned.claims.length, 1, 'only the killer has anything to loot this kill');
  assert.equal(spawned.claims[0].heroId, 'a');
  assert.equal(spawned.claims[0].items[0].itemId, SHOULDER_SILVERGUARD_ID);
});

test('ownership-aware: a hero who already owns the whole gear pool is suppressed, not duplicated', () => {
  const rng = scripted(0.1, 0.0); // would otherwise hit and pick index 0
  const { spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a'],
    ownedItemIdsFor: () => [SHIELD_IRONWOOD_ID, SHOULDER_SILVERGUARD_ID],
  }), rng);
  assert.equal(spawned, null, 'nobody eligible ended up with anything -- no corpse should spawn at all');
});

test('the killer\'s reused item is still ownership-checked here, not merely re-trusted', () => {
  const rng = scripted(0.99); // the only other hero's own roll misses
  const { spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a', 'b'],
    killerHeroId: 'a',
    killerGearItemId: SHIELD_IRONWOOD_ID,
    ownedItemIdsFor: (heroId) => (heroId === 'a' ? [SHIELD_IRONWOOD_ID] : []),
  }), rng);
  assert.equal(spawned, null, 'a killer who already owns the reused item must not receive a duplicate claim');
});

test('a common kind (0% gearChance) never produces an ordinary claim, however the dice fall', () => {
  const rng = scripted(0.0, 0.0, 0.0, 0.0);
  const { spawned } = requestCorpseLoot(createCorpseLootState(), kill({ kind: 'wolf', eligibleHeroIds: ['a'] }), rng);
  assert.equal(spawned, null);
});

test('guaranteed critical reward path: every eligible hero receives it, independent of the ordinary roll', () => {
  const rng = scripted(0.99, 0.99); // both heroes' own ordinary rolls miss
  const { spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    kind: 'wolf', // 0% ordinary gearChance -- proves the guaranteed item does not ride the ordinary roll
    eligibleHeroIds: ['a', 'b'],
    guaranteedItemIds: ['quest-sword'],
  }), rng);
  assert.ok(spawned, 'a guaranteed reward must produce a corpse even when ordinary gearChance is 0');
  assert.equal(spawned.claims.length, 2);
  for (const claim of spawned.claims) {
    assert.equal(claim.items.length, 1);
    assert.equal(claim.items[0].itemId, 'quest-sword');
    assert.equal(claim.items[0].guaranteed, true);
  }
});

test('a guaranteed item and an independently-rolled ordinary item can both ride the same claim', () => {
  const rng = scripted(0.1, 0.0); // the one eligible hero's own ordinary roll hits
  const { spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a'],
    guaranteedItemIds: ['quest-sword'],
  }), rng);
  assert.equal(spawned.claims[0].items.length, 2);
  assert.ok(spawned.claims[0].items.some((item) => item.guaranteed && item.itemId === 'quest-sword'));
  assert.ok(spawned.claims[0].items.some((item) => !item.guaranteed && item.kind === CORPSE_GEAR_KIND));
});

test('Take All resolves ONLY the current player\'s items', () => {
  const rng = scripted(0.1, 0.0, 0.1, 0.0);
  const { state: spawnedState, spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a', 'b'],
  }), rng);
  const { state, accepted, items } = requestClaimAllCorpseLoot(spawnedState, 'a', spawned.id, { x: 10, z: 20 });
  assert.equal(accepted, true);
  assert.equal(items.length, 1);

  const corpseAfter = state.corpses.find((c) => c.id === spawned.id);
  assert.ok(corpseAfter.claims.find((c) => c.heroId === 'a').items.every((item) => item.taken));
  assert.ok(corpseAfter.claims.find((c) => c.heroId === 'b').items.every((item) => !item.taken),
    'Take All must never resolve a sibling\'s own claim');
});

test('repeat/replay does not duplicate a resolved claim', () => {
  const rng = scripted(0.1, 0.0);
  const { state: spawnedState, spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a'],
  }), rng);
  const claimItemId = spawned.claims[0].items[0].id;
  const first = requestClaimCorpseItem(spawnedState, 'a', spawned.id, claimItemId, { x: 10, z: 20 });
  assert.equal(first.accepted, true);
  // The exact same request, replayed (a resend, a reconnect racing its own prior request) -- must
  // not grant the item a second time.
  const second = requestClaimCorpseItem(first.state, 'a', spawned.id, claimItemId, { x: 10, z: 20 });
  assert.equal(second.accepted, false);
  assert.equal(second.state, first.state, 'a rejected replay must not mutate state at all');
});

test('reach: the server checks distance to the corpse, not a client claim', () => {
  const rng = scripted(0.1, 0.0);
  const { state: spawnedState, spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a'],
  }), rng);
  const claimItemId = spawned.claims[0].items[0].id;
  const far = requestClaimCorpseItem(spawnedState, 'a', spawned.id, claimItemId, { x: 500, z: 500 });
  assert.equal(far.accepted, false);
  const justInside = requestClaimCorpseItem(
    spawnedState, 'a', spawned.id, claimItemId,
    { x: 10 + CORPSE_LOOT_INTERACT_RADIUS_METERS - 0.1, z: 20 },
  );
  assert.equal(justInside.accepted, true);
});

test('corpse retirement: fully resolved retires immediately, no lingering needed', () => {
  const rng = scripted(0.1, 0.0);
  const { state: spawnedState, spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a'],
  }), rng);
  const claimItemId = spawned.claims[0].items[0].id;
  const { state: looted } = requestClaimCorpseItem(spawnedState, 'a', spawned.id, claimItemId, { x: 10, z: 20 });
  const stepped = stepCorpseLoot(looted, 0.05);
  assert.equal(stepped.corpses.length, 0, 'a corpse every eligible hero has fully looted must retire at once');
});

test('corpse retirement: an unresolved corpse expires after CORPSE_LOOT_EXPIRE_SECONDS', () => {
  const rng = scripted(0.1, 0.0);
  const { state: spawnedState } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a'],
  }), rng);
  const before = stepCorpseLoot(spawnedState, CORPSE_LOOT_EXPIRE_SECONDS - 1);
  assert.equal(before.corpses.length, 1, 'must not expire early -- a stepping-away child needs this window');
  const after = stepCorpseLoot(before, 2);
  assert.equal(after.corpses.length, 0, 'an abandoned corpse must eventually give up the ground it sits on');
});

test('cap: oldest-first eviction once a roll would push the live count over MAX_CONCURRENT_CORPSES', () => {
  let state = createCorpseLootState();
  for (let i = 0; i < MAX_CONCURRENT_CORPSES + 3; i += 1) {
    const rng = scripted(0.1, 0.0);
    const result = requestCorpseLoot(state, kill({ enemyId: `wolf-${i}`, lifeId: `life-${i}`, eligibleHeroIds: ['a'] }), rng);
    state = result.state;
    state = stepCorpseLoot(state, 1); // age every existing corpse by 1s so "oldest" is well-defined
  }
  assert.equal(state.corpses.length, MAX_CONCURRENT_CORPSES);
});

test('a hero with no claim on a real corpse cannot take anything from it', () => {
  const rng = scripted(0.1, 0.0);
  const { state: spawnedState, spawned } = requestCorpseLoot(createCorpseLootState(), kill({
    eligibleHeroIds: ['a'],
  }), rng);
  const { accepted } = requestClaimCorpseItem(
    spawnedState, 'stranger', spawned.id, spawned.claims[0].items[0].id, { x: 10, z: 20 },
  );
  assert.equal(accepted, false);
});

test('an unknown corpse id is rejected cleanly', () => {
  const state = createCorpseLootState();
  const result = requestClaimCorpseItem(state, 'a', 'corpse:missing:1', 'anything', { x: 0, z: 0 });
  assert.equal(result.accepted, false);
  assert.equal(result.item, null);
  const all = requestClaimAllCorpseLoot(state, 'a', 'corpse:missing:1', { x: 0, z: 0 });
  assert.equal(all.accepted, false);
  assert.deepEqual(all.items, []);
});
