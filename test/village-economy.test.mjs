// GP3: public/src/village/economy.js -- the pure affordability/remaining-balance rules a client's
// Board UI and net/gameServer.mjs's purchase handler both run against, so they can never quietly
// disagree about whether Workshop I is affordable or what is left after buying it.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  WORKSHOP_I_COST, WORKSHOP_I_ID, canAffordWorkshopI, remainingVillageSupplies,
} from '../public/src/village/economy.js';

test('WORKSHOP_I_COST matches the brief exactly: 2 coins + 1 Wildwood Shard', () => {
  assert.deepEqual(WORKSHOP_I_COST, { coins: 2, shards: 1 });
});

test('WORKSHOP_I_ID is the durable eventId the brief names', () => {
  assert.equal(WORKSHOP_I_ID, 'village-upgrade:workshop:1');
});

test('the guaranteed GP2 haul (3 coins, 2 shards) affords Workshop I', () => {
  assert.equal(canAffordWorkshopI(3, 2, false), true);
});

test('exactly the cost, no more, still affords it', () => {
  assert.equal(canAffordWorkshopI(2, 1, false), true);
});

test('one short on either resource does not afford it', () => {
  assert.equal(canAffordWorkshopI(1, 1, false), false, 'one coin short');
  assert.equal(canAffordWorkshopI(2, 0, false), false, 'one shard short');
});

test('zero of everything does not afford it', () => {
  assert.equal(canAffordWorkshopI(0, 0, false), false);
});

test('already owned is never affordable again, even with ample funds', () => {
  assert.equal(canAffordWorkshopI(99, 99, true), false);
});

test('remainingVillageSupplies reports the full total when Workshop I is not yet owned', () => {
  assert.deepEqual(remainingVillageSupplies(3, 2, false), { coins: 3, shards: 2 });
});

test('remainingVillageSupplies subtracts the cost once Workshop I is owned -- the brief\'s exact worked example', () => {
  assert.deepEqual(remainingVillageSupplies(3, 2, true), { coins: 1, shards: 1 });
});

test('sabotage: canAffordWorkshopI is not a constant -- affording and not-affording both occur', () => {
  const outcomes = new Set([
    canAffordWorkshopI(0, 0, false),
    canAffordWorkshopI(2, 1, false),
  ]);
  assert.deepEqual([...outcomes].sort(), [false, true]);
});
