// End-to-end coverage of the goal-tracker walking through every beat of the
// ten-minute slice, tuned to CONTRACT.md's numbers, using the real
// placeholder content pack.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/rules/game.js';
import * as goals from '../src/rules/goals.js';
import * as content from '../content/index.js';

function readyAllPlots(state, content, now) {
  return game.readyPlotIndexes(state, content, now);
}

test('goal tracker walks through every beat in order with no gaps and no dead ends', () => {
  let now = 0;
  let state = game.createGameState(now);
  assert.equal(game.currentGoal(state).step, 'plant');

  // Beat 2: plant -> first crack. Recipe is 1 sunberry (distinctive) + 2 carrots.
  let res = game.plantAll(state, content, now);
  state = res.state;
  assert.equal(res.planted.length, 3, 'should plant all 3 plots at once');
  assert.equal(state.egg.cracks, 1);
  assert.equal(game.currentGoal(state).step, 'harvest');

  // Let everything grow (sunberry takes the longest: 40s).
  now += 45_000;
  const ready = readyAllPlots(state, content, now);
  assert.equal(ready.length, 3);

  // Beat 3: harvest each ripe plot. Yield: 3 carrots/plant, 2 sunberries/plant.
  for (const plotIndex of ready) {
    const harvestRes = game.harvestPlot(state, content, plotIndex, now);
    state = harvestRes.state;
  }
  assert.equal(state.egg.cracks, 2);
  assert.equal(game.currentGoal(state).step, 'market');
  assert.equal(state.egg.elementHint, 'sun', 'sunberry is the distinctive sun crop');

  const sunberryCount = state.basket.crops.sunberry || 0;
  const carrotCount = state.basket.crops.carrot || 0;
  assert.equal(sunberryCount, 2, 'one sunberry plant yields 2');
  assert.equal(carrotCount, 6, 'two carrot plants yield 3 each');

  // Beat 4: fulfil the bundle offer (2 carrots + 1 sunberry -> 12 coins).
  const offerRes = game.fulfillOffer(state, content, 'pip_bundle', now);
  assert.equal(offerRes.success, true);
  state = offerRes.state;
  assert.equal(state.basket.coins, 12);
  assert.equal(state.basket.crops.carrot, 4);
  assert.equal(state.basket.crops.sunberry, 1);
  assert.equal(state.egg.cracks, 3);
  assert.equal(game.currentGoal(state).step, 'armor');

  // Beat 5: buy the Leaf Crest Helmet (price 10) and it equips immediately.
  const armorRes = game.buyArmor(state, content, 'leaf_crest_helmet', now);
  assert.equal(armorRes.success, true);
  state = armorRes.state;
  assert.equal(state.basket.coins, 2);
  assert.equal(state.armor.equipped.helmet, 'leaf_crest_helmet');
  assert.equal(state.egg.cracks, 4);
  assert.equal(state.egg.readyToHatch, true);
  assert.equal(game.currentGoal(state).step, 'hatch');

  // Beat 6: hatch requires 3 taps -- no question gate, ever.
  let tap1 = game.tapEgg(state, content, now);
  assert.equal(tap1.hatched, false);
  state = tap1.state;
  let tap2 = game.tapEgg(state, content, now);
  assert.equal(tap2.hatched, false);
  state = tap2.state;
  assert.equal(game.currentGoal(state).step, 'hatch', 'still on the hatch beat until the 3rd tap');

  const tap3 = game.tapEgg(state, content, now);
  assert.equal(tap3.hatched, true);
  state = tap3.state;
  assert.equal(tap3.hatchedCreatureId, 'sprout', 'sun hint should hatch the sun creature');
  assert.equal(state.collection.owned.sprout, true);
  assert.equal(game.currentGoal(state).step, 'name');

  // Name the hatchling.
  const nameRes = game.nameCreature(state, content, 'Sparky', now);
  assert.equal(nameRes.success, true);
  state = nameRes.state;
  assert.equal(state.collection.names.sprout, 'Sparky');

  // Beat 7: loop tease -- feed a sunberry (still have 1 in the basket).
  assert.equal(game.currentGoal(state).step, 'loop');
  const feedRes = game.feedSunberry(state, content, now);
  assert.equal(feedRes.success, true);
  state = feedRes.state;
  assert.equal(state.basket.crops.sunberry, 0);
  assert.equal(state.collection.fed.sprout, 1);

  // Terminal, free-play state, never expires: planting again still works.
  const again = game.plantAll(state, content, now);
  assert.equal(again.planted.length > 0, true, 'planting again in the loop still works');
  assert.equal(again.state.egg.cracks, 4, 'no more cracks after hatching');
});

test('an offer the player cannot yet afford does not advance the goal or crack the egg', () => {
  let now = 0;
  let state = game.createGameState(now);
  state = game.plantAll(state, content, now).state; // goal -> harvest, cracks=1
  const res = game.fulfillOffer(state, content, 'pip_crate', now);
  assert.equal(res.success, false);
  assert.equal(res.state.egg.cracks, 1);
  assert.equal(game.currentGoal(res.state).step, 'harvest');
});

test('unknown offer/armor ids fail safely without throwing', () => {
  const state = game.createGameState(0);
  assert.equal(game.fulfillOffer(state, content, 'nope', 0).success, false);
  assert.equal(game.buyArmor(state, content, 'nope', 0).success, false);
});

test('GOAL_STEPS covers exactly the documented beats in order', () => {
  assert.deepEqual(goals.GOAL_STEPS, ['plant', 'harvest', 'market', 'armor', 'hatch', 'name', 'loop']);
});

test('setBand only accepts younger/older and is otherwise a no-op', () => {
  let state = game.createGameState(0);
  assert.equal(state.band, null);
  state = game.setBand(state, 'younger');
  assert.equal(state.band, 'younger');
  const unchanged = game.setBand(state, 'nonsense');
  assert.equal(unchanged.band, 'younger');
});

test('applyVolunteerCarrots fills every empty plot with an already-ripe carrot', () => {
  const now = 1_000_000;
  let state = game.createGameState(0);
  state = game.applyVolunteerCarrots(state, content, now);
  const ready = game.readyPlotIndexes(state, content, now);
  assert.equal(ready.length, 3);
  state.farm.plots.forEach((plot) => assert.equal(plot.cropId, 'carrot'));
});

test('applyVolunteerCarrots does not overwrite plots that are already growing', () => {
  const now = 0;
  let state = game.createGameState(now);
  state = game.plantAll(state, content, now).state;
  const before = JSON.stringify(state.farm);
  state = game.applyVolunteerCarrots(state, content, now + 500);
  assert.equal(JSON.stringify(state.farm), before, 'occupied plots are left untouched');
});

test('feedSunberry requires both a hatched creature and a sunberry in the basket', () => {
  let state = game.createGameState(0);
  const noCreature = game.feedSunberry(state, content, 0);
  assert.equal(noCreature.success, false);
});
