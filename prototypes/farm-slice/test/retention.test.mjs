// P1 retention: feed payoff (sun crest at 3 feeds) + Pip's gift second egg.
// CONTRACT.md section 5 items 1-2, plus the minimal star-seed supporting scope.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/rules/game.js';
import * as content from '../content/index.js';
import { loadGame } from '../src/save.js';

const storage = new Map();
globalThis.window = { localStorage: {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
} };

function plant(state, index, crop, now) {
  const result = game.plantPlot(state, content, index, crop, now);
  assert.equal(result.planted, true, `plant ${crop} in ${index}`);
  return result.state;
}

function harvest(state, index, now) {
  const result = game.harvestPlot(state, content, index, now);
  assert.ok(result.harvestedCropId, `harvest ${index}`);
  return result.state;
}

/** Drives contract path A (crate first) all the way to FREE. Returns FREE state + helpers. */
function driveToFree() {
  let state = game.createGameState(0);
  state = game.setBand(state, 'younger');
  state = plant(state, 0, 'carrot', 0);
  state = plant(state, 1, 'sunberry', 0);
  state = plant(state, 2, 'carrot', 0);
  state = harvest(state, 0, 20_000);
  state = harvest(state, 2, 20_000);
  state = harvest(state, 1, 41_000);
  assert.deepEqual([state.basket.crops.carrot, state.basket.crops.sunberry], [6, 2]);
  state = game.openMarket(state);
  state = game.fulfillOffer(state, content, 'pip_crate', 41_000).state;
  state = game.buyArmor(state, content, 'leaf_crest_helmet', 41_000).state;
  state = game.tapEgg(state, content, 41_000).state;
  state = game.tapEgg(state, content, 41_000).state;
  state = game.tapEgg(state, content, 41_000).state;
  assert.equal(state.egg.hatchedCreatureId, 'sprout');
  state = game.nameCreature(state, content, 'Sprout', 42_000).state;
  state = game.closeBook(state);
  const fedOnce = game.feedSunberry(state, content, 42_000);
  assert.equal(fedOnce.success, true);
  state = fedOnce.state;
  assert.equal(state.collection.fed.sprout, 1);
  assert.equal(game.hasSunCrest(state), false, 'no crest after a single feed');
  const replantState = state;
  state = plant(state, 0, 'carrot', 42_000);
  state = plant(state, 1, 'carrot', 42_000);
  state = plant(state, 2, 'carrot', 42_000);
  state = harvest(state, 0, 62_000);
  state = harvest(state, 1, 62_000);
  state = harvest(state, 2, 62_000);
  assert.equal(game.currentGoal(state, content, 62_000).step, 'free');
  return { state, replantState };
}

test('Pip gift arrives after exactly 2 FREE fills, with a star seed and a ready Leaf egg', () => {
  let { state } = driveToFree();
  assert.deepEqual([state.basket.crops.carrot, state.basket.crops.sunberry], [10, 1]);
  assert.equal(state.giftEarned, false);

  const first = game.fulfillOffer(state, content, 'pip_crate', 62_000);
  assert.equal(first.success, true);
  state = first.state;
  assert.equal(state.freeOrderFills, 1);
  assert.equal(state.giftEarned, false, 'one more order is not yet the gift');
  assert.equal(state.secondEgg, null);

  const second = game.fulfillOffer(state, content, 'pip_crate', 62_000);
  assert.equal(second.success, true);
  state = second.state;
  assert.equal(state.freeOrderFills, 2);
  assert.equal(state.giftEarned, true);
  assert.equal(state.starSeeds, 1, 'one plantable star seed');
  assert.ok(state.secondEgg, 'second egg exists');
  assert.equal(state.secondEgg.readyToHatch, true, 'hatch is ungated');
  assert.equal(state.secondEgg.hatched, false);
  assert.equal(state.secondEgg.elementHint, 'leaf');
  assert.equal(game.nextSecondHatchCreatureId(state, content), 'mossbun', 'visible Leaf type');

  // A third fill must not grant a second gift.
  state = plant(state, 0, 'carrot', 62_000);
  state = plant(state, 1, 'carrot', 62_000);
  state = plant(state, 2, 'carrot', 62_000);
  state = harvest(state, 0, 82_000);
  state = harvest(state, 1, 82_000);
  state = harvest(state, 2, 82_000);
  state = game.fulfillOffer(state, content, 'pip_crate', 82_000).state;
  assert.equal(state.freeOrderFills, 3);
  assert.equal(state.starSeeds, 1, 'gift grants exactly one star seed');
});

test('star seed plants in FREE only, and only while the gift lasts', () => {
  const { state: free, replantState } = driveToFree();
  assert.equal(game.plantPlot(replantState, content, 0, 'sunberry', 42_000).planted, false,
    'REPLANT stays 3 carrots per CONTRACT section 1');
  assert.equal(game.plantPlot(free, content, 0, 'sunberry', 62_000).planted, false,
    'no star seed before the gift');
  assert.equal(game.plantPlot(free, content, 0, 'wheat', 62_000).planted, false,
    'no other crop sneaks into the FREE sack');

  let state = game.fulfillOffer(free, content, 'pip_crate', 62_000).state;
  state = game.fulfillOffer(state, content, 'pip_crate', 62_000).state;
  const planted = game.plantPlot(state, content, 0, 'sunberry', 62_000);
  assert.equal(planted.planted, true);
  state = planted.state;
  assert.equal(state.starSeeds, 0, 'planting consumes the star seed');
  assert.equal(game.plantPlot(state, content, 1, 'sunberry', 62_000).planted, false);
  assert.deepEqual(game.freeRemainingSeeds(state), ['carrot', 'carrot'],
    'sack falls back to carrots once the star seed is planted');
});

test('three total feeds bloom Sprout sun crest', () => {
  let { state } = driveToFree();
  state = game.fulfillOffer(state, content, 'pip_crate', 62_000).state;
  state = game.fulfillOffer(state, content, 'pip_crate', 62_000).state;
  state = plant(state, 0, 'sunberry', 62_000);
  state = plant(state, 1, 'carrot', 62_000);
  state = plant(state, 2, 'carrot', 62_000);
  state = harvest(state, 0, 103_000);
  state = harvest(state, 1, 103_000);
  state = harvest(state, 2, 103_000);
  // Leftover 1 sunberry + 2 from the star plant.
  assert.equal(state.basket.crops.sunberry, 3);

  state = game.feedSunberry(state, content, 103_000).state;
  assert.equal(state.collection.fed.sprout, 2);
  assert.equal(game.hasSunCrest(state), false, 'still no crest at 2/3');
  state = game.feedSunberry(state, content, 103_000).state;
  assert.equal(state.collection.fed.sprout, 3);
  assert.equal(game.hasSunCrest(state), true, 'crest blooms at 3/3');
  assert.equal(state.basket.crops.sunberry, 1);
});

test('second egg hatches Mossbun in 3 ungated taps and joins the book', () => {
  let { state } = driveToFree();
  assert.deepEqual(game.tapSecondEgg(state, content, 62_000),
    { state, hatchedCreatureId: null, hatched: false }, 'no egg before the gift');
  state = game.fulfillOffer(state, content, 'pip_crate', 62_000).state;
  state = game.fulfillOffer(state, content, 'pip_crate', 62_000).state;

  state = game.tapSecondEgg(state, content, 62_000).state;
  state = game.tapSecondEgg(state, content, 62_000).state;
  assert.equal(state.secondEgg.hatched, false);
  const hatched = game.tapSecondEgg(state, content, 62_000);
  assert.equal(hatched.hatched, true);
  assert.equal(hatched.hatchedCreatureId, 'mossbun');
  state = hatched.state;
  assert.equal(state.collection.owned.mossbun, true);
  assert.equal(game.nextSecondHatchCreatureId(state, content), null);
  assert.equal(game.currentGoal(state, content, 62_000).step, 'free', 'FREE keeps looping');

  const named = game.nameCreatureById(state, content, 'mossbun', 'Mossy', 63_000);
  assert.equal(named.success, true);
  state = named.state;
  assert.equal(state.collection.names.mossbun, 'Mossy');
  assert.equal(game.currentGoal(state, content, 63_000).step, 'free');
  assert.equal(game.nameCreatureById(state, content, 'zapkit', 'Zappy', 63_000).success, false);
  assert.equal(game.nameCreatureById(state, content, 'mossbun', '   ', 63_000).success, false);
});

test('FREE chip guides gift, then Leaf egg, then the farm', () => {
  let { state } = driveToFree();
  state = game.fulfillOffer(state, content, 'pip_crate', 62_000).state;
  state = game.fulfillOffer(state, content, 'pip_crate', 62_000).state;
  let goal = game.currentGoal(state, content, 62_000);
  assert.equal(goal.text, 'Pip has a gift for you!');
  assert.equal(goal.targetKey, 'market');

  state = game.openGift(state);
  goal = game.currentGoal(state, content, 62_000);
  assert.equal(goal.text, 'Tap the Leaf egg!');
  assert.equal(goal.targetKey, 'egg2');

  state = game.tapSecondEgg(state, content, 62_000).state;
  state = game.tapSecondEgg(state, content, 62_000).state;
  state = game.tapSecondEgg(state, content, 62_000).state;
  goal = game.currentGoal(state, content, 62_000);
  assert.notEqual(goal.targetKey, 'egg2', 'hatched egg stops pointing');
});

test('pre-P1 v1 saves migrate with defaults and can still earn the gift', () => {
  const { state: free } = driveToFree();
  const legacy = { ...free };
  delete legacy.giftEarned;
  delete legacy.giftOpened;
  delete legacy.starSeeds;
  delete legacy.freeOrderFills;
  delete legacy.secondEgg;
  storage.set('gq.farmSlice.v1', JSON.stringify({ version: 1, savedAt: 62_000, state: legacy }));
  const loaded = loadGame(62_000);
  assert.equal(loaded.isNewGame, false);
  assert.equal(loaded.state.giftEarned, false);
  assert.equal(loaded.state.giftOpened, false);
  assert.equal(loaded.state.starSeeds, 0);
  assert.equal(loaded.state.freeOrderFills, 0);
  assert.equal(loaded.state.secondEgg, null);
  assert.equal(game.hasSunCrest(loaded.state), false);
  assert.equal(game.currentGoal(loaded.state, content, 62_000).step, 'free');
});
