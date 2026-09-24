import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/rules/game.js';
import * as goals from '../src/rules/goals.js';
import { loadGame, saveGame, clearSave } from '../src/save.js';
import * as content from '../content/index.js';

const storage = new Map();
globalThis.window = { localStorage: {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
} };

function reload(state, now) {
  assert.equal(saveGame(state), true);
  assert.ok(storage.has('gq.farmSlice.v1'));
  const loaded = loadGame(now);
  assert.equal(loaded.isNewGame, false);
  const goal = game.currentGoal(loaded.state, content, now);
  assert.equal(goal.step, game.currentGoal(state, content, now).step);
  assert.ok(goal.targetKey, `${goal.step} needs an arrow target after reload`);
  return loaded.state;
}
function plant(state, index, crop, now) {
  const result = game.plantPlot(state, content, index, crop, now);
  assert.equal(result.planted, true);
  return result.state;
}
function harvest(state, index, now) {
  const result = game.harvestPlot(state, content, index, now);
  assert.ok(result.harvestedCropId);
  return result.state;
}
function toFirstHarvest() {
  let state = game.createGameState(0);
  state = game.setBand(state, 'younger');
  state = reload(state, 0);
  assert.deepEqual(goals.GOAL_STEPS, ['plant','grow','harvest','market','offer','armor','hatch','name','book','feed','replant','free']);
  state = plant(state, 0, 'carrot', 0);
  assert.equal(game.currentGoal(state, content, 0).step, 'plant');
  state = reload(state, 0);
  state = plant(state, 1, 'sunberry', 0);
  assert.equal(game.currentGoal(state, content, 0).step, 'plant');
  state = plant(state, 2, 'carrot', 0);
  assert.equal(state.egg.cracks, 1);
  assert.equal(game.currentGoal(state, content, 0).step, 'grow');
  state = reload(state, 0);
  assert.equal(game.readyPlotIndexes(state, content, 19_999).length, 0);
  state = game.waterPlot(state, content, 1, 10_000).state;
  assert.equal(game.getGrowthProgress(state, content, 1, 24_999) < 1, true);
  assert.equal(game.getGrowthProgress(state, content, 1, 25_000), 1);
  state = reload(state, 10_000);
  state = game.checkTimeGates(state, content, 20_000);
  assert.equal(game.currentGoal(state, content, 20_000).step, 'harvest');
  state = reload(state, 20_000);
  state = harvest(state, 0, 20_000);
  assert.equal(game.currentGoal(state, content, 20_000).step, 'harvest');
  state = harvest(state, 2, 20_000);
  assert.equal(game.currentGoal(state, content, 20_000).step, 'harvest', 'market waits for the sunberry');
  assert.equal(state.egg.cracks, 1);
  state = reload(state, 20_000);
  state = harvest(state, 1, 25_000);
  assert.deepEqual({ carrot: state.basket.crops.carrot, sunberry: state.basket.crops.sunberry }, { carrot: 6, sunberry: 2 });
  assert.equal(state.egg.cracks, 2);
  assert.equal(game.currentGoal(state, content, 25_000).step, 'market');
  return reload(state, 25_000);
}
function fullPath(offerId, expectedCoins, expectedCarrots, expectedSunberries) {
  let state = toFirstHarvest();
  state = game.openMarket(state);
  assert.equal(game.currentGoal(state, content, 25_000).step, 'offer');
  state = reload(state, 25_000);
  const sale = game.fulfillOffer(state, content, offerId, 25_000);
  assert.equal(sale.success, true);
  state = sale.state;
  assert.equal(state.basket.coins, expectedCoins);
  assert.equal(state.basket.crops.carrot, expectedCarrots);
  assert.equal(state.basket.crops.sunberry, expectedSunberries);
  assert.equal(state.offersFilled[offerId === 'pip_crate' ? 'crate' : 'bundle'], 1);
  assert.equal(game.fulfillOffer(state, content, offerId, 25_000).success, false, 'only the chosen first sale commits');
  assert.equal(state.egg.cracks, 3);
  assert.equal(game.currentGoal(state, content, 25_000).step, 'armor');
  state = reload(state, 25_000);
  state = game.buyArmor(state, content, 'leaf_crest_helmet', 25_000).state;
  assert.equal(state.armor.equipped.helmet, 'leaf_crest_helmet');
  assert.equal(state.basket.coins, expectedCoins - 10);
  assert.equal(state.egg.cracks, 4);
  assert.equal(state.egg.readyToHatch, true);
  assert.equal(game.currentGoal(state, content, 25_000).step, 'hatch');
  state = reload(state, 25_000);
  state = game.tapEgg(state, content, 360_000).state;
  assert.equal(state.egg.hatchTaps, 1);
  state = reload(state, 360_000);
  assert.equal(state.egg.hatchTaps, 0, 'hatch taps are transient');
  state = game.tapEgg(state, content, 360_000).state;
  state = game.tapEgg(state, content, 360_000).state;
  state = game.tapEgg(state, content, 360_000).state;
  assert.equal(state.egg.hatchedCreatureId, 'sprout');
  assert.equal(game.currentGoal(state, content, 360_000).step, 'name');
  state = reload(state, 360_000);
  assert.equal(game.currentGoal(state, content, 360_000).targetKey, 'nameDialog');
  state = game.nameCreature(state, content, 'VeryLongNameIndeed', 365_000).state;
  assert.equal(state.collection.names.sprout.length, 12);
  assert.equal(game.currentGoal(state, content, 365_000).step, 'book');
  state = reload(state, 365_000);
  assert.equal(game.feedSunberry(state, content, 365_000).success, false, 'feeding early cannot consume the last berry');
  state = game.closeBook(state);
  assert.equal(state.bookSeen, true);
  assert.equal(game.currentGoal(state, content, 365_000).step, 'feed');
  state = reload(state, 365_000);
  state = game.feedSunberry(state, content, 365_000).state;
  assert.equal(state.collection.fed.sprout, 1);
  assert.equal(state.basket.crops.sunberry, expectedSunberries - 1);
  assert.equal(game.currentGoal(state, content, 365_000).step, 'replant');
  state = reload(state, 365_000);
  for (let i = 0; i < 3; i++) state = plant(state, i, 'carrot', 365_000);
  assert.equal(game.currentGoal(state, content, 365_000).step, 'replant');
  state = reload(state, 365_000);
  for (let i = 0; i < 3; i++) state = harvest(state, i, 385_000);
  assert.equal(state.basket.crops.carrot, expectedCarrots + 9);
  assert.equal(game.currentGoal(state, content, 385_000).step, 'free');
  state = reload(state, 385_000);
  assert.equal(state.egg.cracks, 4);
  assert.equal(state.basket.coins, expectedCoins - 10);
  return state;
}

test('contract path A: 5 carrots for 10, helmet, hatch, feed, replant', () => fullPath('pip_crate', 10, 1, 2));
test('contract path B: bundle for 12 and 2 coins left after helmet', () => fullPath('pip_bundle', 12, 4, 1));
test('each first seed needs its own plot and watering halves remaining time', () => {
  let state = game.createGameState(0);
  assert.equal(game.plantPlot(state, content, 0, 'sunberry', 0).planted, true);
  state = plant(state, 0, 'sunberry', 0);
  assert.equal(game.plantPlot(state, content, 1, 'sunberry', 0).planted, false);
  state = plant(state, 1, 'carrot', 0);
  state = plant(state, 2, 'carrot', 0);
  assert.equal(game.getGrowthProgress(state, content, 0, 39_999) < 1, true);
  assert.equal(game.getGrowthProgress(state, content, 0, 40_000), 1);
  state = game.waterPlot(state, content, 0, 10_000).state;
  assert.equal(game.getGrowthProgress(state, content, 0, 24_999) < 1, true);
  assert.equal(game.getGrowthProgress(state, content, 0, 25_000), 1);
});
test('one volunteer carrot only on return to an empty plot, none before first planting', () => {
  let state = game.createGameState(0);
  state = reload(state, 100_000);
  assert.equal(game.applyVolunteerCarrots(state, content, 100_000), state);
  state = toFirstHarvest();
  state = game.applyVolunteerCarrots(state, content, 100_000);
  assert.equal(state.farm.plots.filter((p) => p.cropId === 'carrot').length, 1);
  const again = game.applyVolunteerCarrots(state, content, 200_000);
  assert.equal(again, state);
  assert.equal(game.readyPlotIndexes(state, content, 100_000).length, 1);
});
test('unavailable storage never interrupts play', () => {
  const original = globalThis.window;
  globalThis.window = { localStorage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } } };
  const state = game.createGameState(0);
  assert.equal(saveGame(state), false);
  assert.equal(loadGame(0).isNewGame, true);
  globalThis.window = original;
});
