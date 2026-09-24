import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrderBoard, getOpenOrders, canFulfillOrder, fulfillOrder } from '../../src/depth/orders.js';

const offers = [
  { id: 'quick', band: 'older', wants: { dewmelon: 3 }, coins: 9 },
  { id: 'middle', band: 'older', wants: { pumpkin: 4 }, coins: 12 },
  { id: 'save', band: 'older', wants: { wheat: 10 }, coins: 25 },
  { id: 'extra', band: 'older', wants: { sunberry: 4 }, coins: 12 },
  { id: 'young', band: 'younger', wants: { carrot: 3 }, coins: 6 },
];

test('board is deterministic, band-limited, and includes quick and save-up choices', () => {
  const a = createOrderBoard({ offers, band: 'older', seed: 17 });
  const b = createOrderBoard({ offers, band: 'older', seed: 17 });
  assert.deepEqual(a, b);
  assert.equal(a.open.length, 3);
  assert.deepEqual(new Set(a.open.map((order) => order.offerId)).size, 3);
  assert.ok(a.open.some((order) => order.offerId === 'quick'));
  assert.ok(a.open.some((order) => order.offerId === 'save'));
  assert.ok(getOpenOrders(a, offers).every((order) => order.band === 'older'));
});

test('fulfilment is atomic, spends only requested crops, and replenishes without expiry', () => {
  const board = createOrderBoard({ offers, band: 'older', seed: 5 });
  const order = getOpenOrders(board, offers).find((entry) => entry.offerId === 'quick');
  const inventory = { dewmelon: 3, wheat: 10, pumpkin: 4 };
  assert.equal(canFulfillOrder(order, inventory), true);
  const result = fulfillOrder({ board, orderId: order.id, inventory, offers });
  assert.equal(result.coinsEarned, 9);
  assert.equal(result.inventory.dewmelon, 0);
  assert.equal(result.inventory.wheat, 10); // the player may keep these for creatures
  assert.equal(board.open.length, 3); // input was not mutated
  assert.equal(result.board.open.length, 3);
  assert.equal(result.board.open.some((entry) => entry.id === order.id), false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.board)), result.board);
  assert.equal('expiresAt' in result.board.open[0], false);
  assert.throws(() => fulfillOrder({ board, orderId: order.id, inventory: {}, offers }), /Not enough crops/);
});

test('one available offer does not duplicate, and invalid content is rejected', () => {
  const board = createOrderBoard({ offers, band: 'younger', seed: 0 });
  assert.equal(board.open.length, 1);
  assert.throws(() => createOrderBoard({ offers: [{ id: 'bad', band: 'older', wants: { wheat: 0 }, coins: 2 }], band: 'older' }), /Invalid offers/);
});
