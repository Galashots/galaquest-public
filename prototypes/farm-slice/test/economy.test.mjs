import test from 'node:test';
import assert from 'node:assert/strict';
import * as economy from '../src/rules/economy.js';

const carrotOffer = { id: 'o1', wants: { carrot: 3 }, coins: 6 };
const bundleOffer = { id: 'o2', wants: { carrot: 2, sunberry: 1 }, coins: 9 };

test('addCrop accumulates counts per crop id', () => {
  let basket = economy.createBasketState();
  basket = economy.addCrop(basket, 'carrot', 1);
  basket = economy.addCrop(basket, 'carrot', 1);
  basket = economy.addCrop(basket, 'sunberry', 1);
  assert.equal(economy.countOf(basket, 'carrot'), 2);
  assert.equal(economy.countOf(basket, 'sunberry'), 1);
});

test('canFulfillOffer is false when short even one crop', () => {
  let basket = economy.createBasketState();
  basket = economy.addCrop(basket, 'carrot', 2);
  assert.equal(economy.canFulfillOffer(basket, carrotOffer), false);
});

test('fulfillOffer removes exactly the wanted crops and pays the exact coins', () => {
  let basket = economy.createBasketState();
  basket = economy.addCrop(basket, 'carrot', 5);
  const { basketState, success } = economy.fulfillOffer(basket, carrotOffer);
  assert.equal(success, true);
  assert.equal(economy.countOf(basketState, 'carrot'), 2);
  assert.equal(basketState.coins, 6);
});

test('fulfillOffer with a bundle removes each crop independently', () => {
  let basket = economy.createBasketState();
  basket = economy.addCrop(basket, 'carrot', 2);
  basket = economy.addCrop(basket, 'sunberry', 1);
  const { basketState, success } = economy.fulfillOffer(basket, bundleOffer);
  assert.equal(success, true);
  assert.equal(economy.countOf(basketState, 'carrot'), 0);
  assert.equal(economy.countOf(basketState, 'sunberry'), 0);
  assert.equal(basketState.coins, 9);
});

test('a failed offer never removes crops or coins -- no punishment for a wrong pick', () => {
  let basket = economy.createBasketState();
  basket = economy.addCrop(basket, 'carrot', 1);
  const { basketState, success } = economy.fulfillOffer(basket, carrotOffer);
  assert.equal(success, false);
  assert.equal(economy.countOf(basketState, 'carrot'), 1);
  assert.equal(basketState.coins, 0);
});

test('spendCoins fails cleanly when short, succeeds and deducts exactly when not', () => {
  let basket = economy.createBasketState();
  basket = economy.addCoins(basket, 5);
  const short = economy.spendCoins(basket, 6);
  assert.equal(short.success, false);
  assert.equal(short.basketState.coins, 5);

  const ok = economy.spendCoins(basket, 5);
  assert.equal(ok.success, true);
  assert.equal(ok.basketState.coins, 0);
});
