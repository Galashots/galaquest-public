import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../game/src/rules/game.js';
import * as goals from '../game/src/rules/goals.js';
import * as economy from '../game/src/rules/economy.js';
import { loadGame, saveGame } from '../game/src/save.js';
import * as content from '../game/content/index.js';

const storage = new Map();
globalThis.window = { localStorage: {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
} };

const SPROUT_ORDER = ['leaf_crest_helmet', 'sprout_chest', 'sprout_boots', 'sprout_shield'];

function richState() {
  let state = game.createGameState(0);
  state = { ...state, basket: economy.addCoins(state.basket, 100) };
  return state;
}

function buy(state, id) {
  const result = game.buyArmor(state, content, id, 1_000);
  assert.equal(result.success, true, `buying ${id} should succeed with 100 coins`);
  return result.state;
}

test('mannequin rotates through the full Sprout set, then reports sold out', () => {
  let state = richState();
  for (const expected of SPROUT_ORDER) {
    assert.equal(game.nextArmorForSale(state, content)?.id, expected);
    state = buy(state, expected);
  }
  assert.equal(game.nextArmorForSale(state, content), null);
});

test('the full set ends up equipped in all four slots at once', () => {
  let state = richState();
  for (const id of SPROUT_ORDER) state = buy(state, id);
  assert.deepEqual(state.armor.owned, SPROUT_ORDER);
  assert.deepEqual(state.armor.equipped, {
    helmet: 'leaf_crest_helmet',
    chest: 'sprout_chest',
    boots: 'sprout_boots',
    shield: 'sprout_shield',
  });
  assert.deepEqual(game.equippedArmorDefs(state, content).helmet.id, 'leaf_crest_helmet');
});

test('Ember pieces are never offered and never buyable', () => {
  let state = richState();
  for (const id of SPROUT_ORDER) state = buy(state, id);
  // Even with the Sprout set complete and coins to spare, no later set leaks in.
  assert.equal(game.nextArmorForSale(state, content), null);
  const before = state;
  for (const ember of content.ARMOR.filter((a) => a.set !== 'Sprout')) {
    const result = game.buyArmor(state, content, ember.id, 1_000);
    assert.equal(result.success, false, `${ember.id} must not be buyable`);
    assert.equal(result.state, before);
  }
  assert.deepEqual(state.armor.owned, SPROUT_ORDER);
});

test('every Sprout price is payable in the 2-coin economy', () => {
  const shop = content.ARMOR.filter((a) => a.set === game.SHOP_ARMOR_SET);
  assert.equal(shop.length, 4);
  for (const piece of shop) {
    assert.equal(piece.price % 2, 0, `${piece.id} must cost an even number of 2-coins`);
    assert.ok(piece.price <= 26, `${piece.id} must fit inside the biggest single payout (26)`);
  }
});

test('pre-package saves with only the helmet owned resume at the vest', () => {
  // A v1 save from before this package owns just the helmet; migration must
  // keep it valid and the shop must continue at the second piece.
  let state = game.createGameState(0);
  state = {
    ...game.migrateRetention(state),
    armor: { owned: ['leaf_crest_helmet'], equipped: { helmet: 'leaf_crest_helmet', chest: null, boots: null, shield: null } },
  };
  assert.equal(game.nextArmorForSale(state, content)?.id, 'sprout_chest');
});

test('the shop is identical for both bands', () => {
  const younger = game.setBand(game.createGameState(0), 'younger');
  const older = game.setBand(game.createGameState(0), 'older');
  assert.equal(game.nextArmorForSale(younger, content)?.id, 'leaf_crest_helmet');
  assert.equal(game.nextArmorForSale(older, content)?.id, 'leaf_crest_helmet');
});

test('later pieces never disturb the goal machine', () => {
  let state = richState();
  for (let i = 0; i < goals.GOAL_STEPS.length - 1; i++) {
    state = { ...state, goals: goals.advanceGoal(state.goals) };
  }
  assert.equal(goals.currentStep(state.goals), 'free');
  state = buy(state, 'sprout_chest');
  assert.equal(goals.currentStep(state.goals), 'free');
  assert.equal(state.basket.coins, 100 - content.ARMOR.find((a) => a.id === 'sprout_chest').price);
});

test('owned armor survives a save/reload and the shop resumes after it', () => {
  storage.clear();
  let state = richState();
  state = buy(state, 'leaf_crest_helmet');
  state = buy(state, 'sprout_chest');
  assert.equal(saveGame(state), true);
  const loaded = loadGame(2_000);
  assert.equal(loaded.isNewGame, false);
  assert.deepEqual(loaded.state.armor.owned, ['leaf_crest_helmet', 'sprout_chest']);
  assert.equal(loaded.state.armor.equipped.chest, 'sprout_chest');
  assert.equal(game.nextArmorForSale(loaded.state, content)?.id, 'sprout_boots');
});
