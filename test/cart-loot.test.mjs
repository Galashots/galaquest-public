import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  CART_LOOT_COIN_COUNT,
  CART_LOOT_SHARD_COUNT,
  CART_LOOT_TABLE,
  COIN_KIND,
  PICKUP_COLLECT_RADIUS_METERS,
  SHARD_KIND,
  createCartLootState,
  pickupDef,
  pickupWorldPosition,
  requestCollectLoot,
  requestSearchCart,
} from '../public/src/world/cartLoot.js';

const CART_AT = [-2.9, 32.4];

test('GP2: the first authored cart haul is exactly 3 coins and 2 shards, deterministic every time', () => {
  assert.equal(CART_LOOT_COIN_COUNT, 3);
  assert.equal(CART_LOOT_SHARD_COUNT, 2);
  assert.equal(CART_LOOT_TABLE.length, 5);
  assert.equal(CART_LOOT_TABLE.filter((p) => p.kind === COIN_KIND).length, 3);
  assert.equal(CART_LOOT_TABLE.filter((p) => p.kind === SHARD_KIND).length, 2);
  // Every id is unique -- the whole "cannot be awarded twice" guarantee (both here and in
  // net/rewardStore.mjs's own idempotent eventId) depends on that.
  assert.equal(new Set(CART_LOOT_TABLE.map((p) => p.id)).size, CART_LOOT_TABLE.length);
});

test('a fresh cart has not been searched and nothing collected', () => {
  const state = createCartLootState();
  assert.equal(state.spawned, false);
  assert.deepEqual(state.collected, {});
});

test('requestSearchCart spawns the haul exactly once -- idempotent on every later call', () => {
  const fresh = createCartLootState();
  const spawned = requestSearchCart(fresh);
  assert.equal(spawned.spawned, true);
  assert.deepEqual(spawned.collected, {}, 'searching does not itself collect anything');

  const spawnedAgain = requestSearchCart(spawned);
  assert.equal(spawnedAgain, spawned, 'a second search returns the SAME state reference -- a true no-op');
});

test('pickupWorldPosition is derived from the shared cart anchor, not restated per pickup', () => {
  const coin = CART_LOOT_TABLE.find((p) => p.kind === COIN_KIND);
  const at = pickupWorldPosition(coin, CART_AT);
  assert.equal(at.x, CART_AT[0] + coin.offsetX);
  assert.equal(at.z, CART_AT[1] + coin.offsetZ);
});

test('pickupDef resolves a known id and returns null for an unknown one', () => {
  const first = CART_LOOT_TABLE[0];
  assert.equal(pickupDef(first.id), first);
  assert.equal(pickupDef('not-a-real-pickup'), null);
});

test('collecting before the cart has been searched is rejected', () => {
  const fresh = createCartLootState();
  const pickup = CART_LOOT_TABLE[0];
  const at = pickupWorldPosition(pickup, CART_AT);
  const result = requestCollectLoot(fresh, 'p1', pickup.id, at, CART_AT);
  assert.equal(result.accepted, false);
  assert.equal(result.state, fresh, 'a rejected request never mutates the published state');
});

test('collecting an unknown pickupId is rejected, not thrown', () => {
  const spawned = requestSearchCart(createCartLootState());
  const result = requestCollectLoot(spawned, 'p1', 'not-a-real-pickup', { x: 0, z: 0 }, CART_AT);
  assert.equal(result.accepted, false);
});

test('collecting out of reach is rejected -- the server owns physical truth, not the client\'s claim', () => {
  const spawned = requestSearchCart(createCartLootState());
  const pickup = CART_LOOT_TABLE[0];
  const farAway = { x: -9999, z: 9999 };
  const result = requestCollectLoot(spawned, 'p1', pickup.id, farAway, CART_AT);
  assert.equal(result.accepted, false);
  assert.equal(result.state, spawned);
});

test('collecting exactly at the pickup succeeds, and just past the radius fails', () => {
  const spawned = requestSearchCart(createCartLootState());
  const pickup = CART_LOOT_TABLE[0];
  const at = pickupWorldPosition(pickup, CART_AT);

  const justInside = requestCollectLoot(
    spawned, 'p1', pickup.id,
    { x: at.x + PICKUP_COLLECT_RADIUS_METERS * 0.99, z: at.z }, CART_AT,
  );
  assert.equal(justInside.accepted, true);

  const justOutside = requestCollectLoot(
    spawned, 'p1', pickup.id,
    { x: at.x + PICKUP_COLLECT_RADIUS_METERS * 1.05, z: at.z }, CART_AT,
  );
  assert.equal(justOutside.accepted, false);
});

test('a successful collect records who collected it', () => {
  const spawned = requestSearchCart(createCartLootState());
  const pickup = CART_LOOT_TABLE[0];
  const at = pickupWorldPosition(pickup, CART_AT);
  const result = requestCollectLoot(spawned, 'p1', pickup.id, at, CART_AT);
  assert.equal(result.accepted, true);
  assert.equal(result.state.collected[pickup.id], 'p1');
  // The pickup THIS test did not touch stays untouched -- collect is per-pickup, not a blanket sweep.
  const other = CART_LOOT_TABLE[1];
  assert.equal(other.id in result.state.collected, false);
});

test('the physical loot cannot be awarded twice -- first request to arrive wins, every later one is refused', () => {
  const spawned = requestSearchCart(createCartLootState());
  const pickup = CART_LOOT_TABLE[0];
  const at = pickupWorldPosition(pickup, CART_AT);

  const first = requestCollectLoot(spawned, 'p1', pickup.id, at, CART_AT);
  assert.equal(first.accepted, true);

  // A second, different hero reaching the same physical spot.
  const second = requestCollectLoot(first.state, 'p2', pickup.id, at, CART_AT);
  assert.equal(second.accepted, false, 'p2 must not also collect what p1 already took');
  assert.equal(second.state, first.state, 'a rejected collect never mutates published state');
  assert.equal(second.state.collected[pickup.id], 'p1', 'p1 remains the one and only collector');

  // The SAME hero retrying (a resend, or a reconnect replaying its own last request) is refused too.
  const retry = requestCollectLoot(first.state, 'p1', pickup.id, at, CART_AT);
  assert.equal(retry.accepted, false, 'even the original collector cannot collect the same pickup again');
});

test('the five pickups scatter clear of every other pickup and read as a real burst, not a pile', () => {
  // Not a physics check -- just confirms the authored offsets are not all the same point, so a
  // "burst" visually reads as five distinct objects rather than one overlapping cluster.
  const positions = CART_LOOT_TABLE.map((pickup) => pickupWorldPosition(pickup, CART_AT));
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      const distance = Math.hypot(positions[i].x - positions[j].x, positions[i].z - positions[j].z);
      assert.ok(distance > 0.3, `pickups ${i} and ${j} are only ${distance.toFixed(2)}m apart`);
    }
  }
});
