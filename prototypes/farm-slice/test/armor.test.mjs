import test from 'node:test';
import assert from 'node:assert/strict';
import * as armor from '../src/rules/armor.js';
import * as economy from '../src/rules/economy.js';

const helmet = { id: 'sprout_helmet', slot: 'helmet', price: 6, set: 'Sprout' };
const boots = { id: 'sprout_boots', slot: 'boots', price: 10, set: 'Sprout' };

test('buying armor with enough coins equips it immediately', () => {
  let a = armor.createArmorState();
  let basket = economy.addCoins(economy.createBasketState(), 6);
  const result = armor.buyArmor(a, basket, helmet);
  assert.equal(result.success, true);
  assert.equal(result.basketState.coins, 0);
  assert.deepEqual(result.armorState.owned, ['sprout_helmet']);
  assert.equal(result.armorState.equipped.helmet, 'sprout_helmet');
});

test('buying armor with insufficient coins fails and changes nothing', () => {
  let a = armor.createArmorState();
  let basket = economy.addCoins(economy.createBasketState(), 3);
  const result = armor.buyArmor(a, basket, helmet);
  assert.equal(result.success, false);
  assert.equal(result.basketState.coins, 3);
  assert.deepEqual(result.armorState.owned, []);
  assert.equal(result.armorState.equipped.helmet, null);
});

test('owning armor in different slots equips both simultaneously', () => {
  let a = armor.createArmorState();
  let basket = economy.addCoins(economy.createBasketState(), 16);
  let result = armor.buyArmor(a, basket, helmet);
  result = armor.buyArmor(result.armorState, result.basketState, boots);
  assert.equal(result.success, true);
  assert.equal(result.armorState.equipped.helmet, 'sprout_helmet');
  assert.equal(result.armorState.equipped.boots, 'sprout_boots');
  assert.equal(result.basketState.coins, 0);
});

test('equipArmor is a no-op for armor that is not owned', () => {
  const a = armor.createArmorState();
  const result = armor.equipArmor(a, helmet);
  assert.equal(result.equipped.helmet, null);
});

test('re-equipping an already-owned piece works without spending coins again', () => {
  let a = armor.createArmorState();
  let basket = economy.addCoins(economy.createBasketState(), 6);
  const bought = armor.buyArmor(a, basket, helmet);
  const unequipped = { ...bought.armorState, equipped: { ...bought.armorState.equipped, helmet: null } };
  const reequipped = armor.equipArmor(unequipped, helmet);
  assert.equal(reequipped.equipped.helmet, 'sprout_helmet');
});
