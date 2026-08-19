import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from '../public/vendor/three.module.min.js';
import { createLootPickups } from '../public/src/world/lootPickups.js';
import { CART_LOOT_TABLE } from '../public/src/world/cartLoot.js';
import { CART_SEARCH } from '../public/src/world/zones/village.js';

function visiblePickupIds(scene) {
  return CART_LOOT_TABLE
    .filter((pickup) => scene.getObjectByName(`loot-pickup-${pickup.id}`)?.visible)
    .map((pickup) => pickup.id);
}

test('already-collected loot hydrates gone and never replays the cart burst', () => {
  const scene = new THREE.Scene();
  const presenter = createLootPickups(scene, CART_SEARCH.at);
  const collected = Object.fromEntries(CART_LOOT_TABLE.map((pickup) => [pickup.id, 'restored']));
  const loot = { spawned: true, collected };

  assert.deepEqual(presenter.update(0.016, loot, 'p1', { x: 0, z: 0 }), []);
  assert.deepEqual(visiblePickupIds(scene), [], 'the first hydrated frame must not flash spent loot');

  presenter.update(2, loot, 'p1', { x: 0, z: 0 });
  assert.deepEqual(visiblePickupIds(scene), [], 'spent loot must remain gone after the whole burst window');
  presenter.dispose();
});

test('fresh uncollected loot still begins the authored burst ceremony', () => {
  const scene = new THREE.Scene();
  const presenter = createLootPickups(scene, CART_SEARCH.at);
  const loot = { spawned: true, collected: {} };

  presenter.update(0.016, loot, 'p1', { x: 0, z: 0 });
  assert.deepEqual(visiblePickupIds(scene), [CART_LOOT_TABLE[0].id],
    'only the zero-stagger pickup should have launched on the first frame');
  presenter.dispose();
});
