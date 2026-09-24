import test from 'node:test';
import assert from 'node:assert/strict';
import { createGiftCode, redeemGiftCode } from '../../src/depth/gifts.js';
import { observeEgg } from '../../src/depth/breeding.js';

const egg = { id: 'egg1', createdAt: 100, readyAt: 200, hatchedAt: null,
  child: { element: 'fire', shape: 'round', rarity: 'rare', colors: { body: '#ff7043', accent: '#ffd54f' } } };

test('crop gift transfers one item with an unsigned code and blocks repeat redemption', () => {
  const sender = { crops: { carrot: 2 }, eggs: [] };
  const { code, state } = createGiftCode(sender, { kind: 'crop', itemId: 'carrot', giftId: 'gift1' });
  assert.equal(state.crops.carrot, 1);
  assert.equal(sender.crops.carrot, 2);
  assert.match(code, /^GQ1\.[A-Za-z0-9_-]+$/);
  assert.throws(() => redeemGiftCode(state, code, { cropIds: ['carrot'] }), /already redeemed/);
  const received = redeemGiftCode({ crops: {}, eggs: [] }, code, { cropIds: ['carrot'] });
  assert.equal(received.crops.carrot, 1);
  assert.throws(() => redeemGiftCode(received, code, { cropIds: ['carrot'] }), /already redeemed/);
  assert.deepEqual(JSON.parse(JSON.stringify(received)), received);
});

test('egg gift preserves hatch time, safely transfers ownership, and has no sender data', () => {
  const { code, state } = createGiftCode({ crops: {}, eggs: [egg] },
    { kind: 'egg', itemId: 'egg1', giftId: 'gift2' });
  assert.equal(state.eggs.length, 0);
  const received = redeemGiftCode({ crops: {}, eggs: [] }, code, { cropIds: [] });
  assert.equal(received.eggs[0].readyAt, 200);
  assert.equal(received.eggs[0].id, 'gift-gift2');
  assert.equal(received.eggs[0].ordinal, null);
  assert.equal(received.eggs[0].hatchedAt, null);
  assert.equal(observeEgg(received.eggs[0], 100 + 7 * 86_400_000).ready, true);
  assert.equal(code.includes('sender'), false);
});

test('invalid, unknown and already-owned gifts are rejected without state mutation', () => {
  const sender = { crops: { carrot: 0 }, eggs: [] };
  assert.throws(() => createGiftCode(sender, { kind: 'crop', itemId: 'carrot', giftId: 'gift3' }), /not owned/);
  assert.throws(() => redeemGiftCode(sender, 'GQ1.bad!', { cropIds: ['carrot'] }), /Invalid gift code/);
  const { code } = createGiftCode({ crops: { carrot: 1 }, eggs: [] },
    { kind: 'crop', itemId: 'carrot', giftId: 'gift4' });
  assert.throws(() => redeemGiftCode(sender, code, { cropIds: ['wheat'] }), /Unknown crop/);
  assert.deepEqual(sender, { crops: { carrot: 0 }, eggs: [] });
});
