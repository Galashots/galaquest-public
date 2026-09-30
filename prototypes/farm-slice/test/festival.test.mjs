import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/rules/game.js';
import * as goals from '../src/rules/goals.js';
import * as economy from '../src/rules/economy.js';
import { loadGame, saveGame } from '../src/save.js';
import * as content from '../content/index.js';

const storage = new Map();
globalThis.window = { localStorage: {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
} };

function freeState() {
  let state = game.createGameState(0);
  state = game.setBand(state, 'younger');
  while (goals.currentStep(state.goals) !== 'free') state = { ...state, goals: goals.advanceGoal(state.goals) };
  return state;
}

/** Fill the 5-carrot crate `times` times (carrots are unlimited, never a soft-lock). */
function fillCrates(state, times) {
  for (let i = 0; i < times; i++) {
    state = { ...state, basket: economy.addCrop(state.basket, 'carrot', 5) };
    const result = game.fulfillOffer(state, content, 'pip_crate', 1_000 + i);
    assert.equal(result.success, true, `crate fill ${i + 1} should succeed`);
    state = result.state;
  }
  return state;
}

test('decor stages derive deterministically from the fill count', () => {
  assert.equal(game.festivalStageCount(0), 0);
  assert.equal(game.festivalStageCount(1), 1);
  assert.equal(game.festivalStageCount(2), 1);
  assert.equal(game.festivalStageCount(3), 2);
  assert.equal(game.festivalStageCount(5), 3);
  assert.equal(game.festivalStageCount(7), 4);
  assert.equal(game.festivalStageCount(8), 4);
  assert.equal(game.festivalStageCount(99), 4);
});

test('the next-target readout names the stage and exact fills needed', () => {
  assert.deepEqual(game.festivalNext(0), { fillsNeeded: 1, name: 'bunting' });
  assert.deepEqual(game.festivalNext(1), { fillsNeeded: 2, name: 'flower pots' });
  assert.deepEqual(game.festivalNext(7), { fillsNeeded: 1, name: 'Water egg' });
  assert.equal(game.festivalNext(8), null);
  assert.equal(game.festivalNext(20), null);
});

test('carrot-only fills build every stage and earn the Water egg', () => {
  let state = freeState();
  state = fillCrates(state, 1);
  assert.equal(game.festivalStageCount(state.freeOrderFills), 1);
  assert.equal(state.thirdEgg, null);
  state = fillCrates(state, 7);
  assert.equal(state.freeOrderFills, 8);
  assert.equal(game.festivalStageCount(state.freeOrderFills), 4);
  assert.ok(state.thirdEgg, '8 fills earn the Water egg');
  assert.equal(state.thirdEgg.elementHint, 'water');
  assert.equal(state.thirdEgg.readyToHatch, true);
  assert.equal(state.thirdEgg.hatched, false);
  assert.equal(game.nextThirdHatchCreatureId(state, content), 'puddlefin');
  assert.equal(game.festivalPrizeEarned(state), true);
});

test('the Leaf gift still lands at 2 fills alongside the festival', () => {
  let state = freeState();
  state = fillCrates(state, 2);
  assert.equal(state.giftEarned, true);
  assert.equal(game.nextSecondHatchCreatureId(state, content), 'mossbun');
  assert.equal(game.festivalStageCount(state.freeOrderFills), 1);
  assert.equal(state.thirdEgg, null);
});

test('the Water egg hatches puddlefin in 3 ungated taps and joins the book', () => {
  let state = fillCrates(freeState(), 8);
  for (let tap = 1; tap <= 2; tap++) {
    const result = game.tapThirdEgg(state, content, 2_000 + tap);
    assert.equal(result.hatched, false);
    assert.equal(result.hatchedCreatureId, null);
    state = result.state;
  }
  const hatch = game.tapThirdEgg(state, content, 2_003);
  assert.equal(hatch.hatched, true);
  assert.equal(hatch.hatchedCreatureId, 'puddlefin');
  state = hatch.state;
  assert.equal(game.nextThirdHatchCreatureId(state, content), null);
  const named = game.nameCreatureById(state, content, 'puddlefin', 'Splashy', 2_004);
  assert.equal(named.success, true);
  state = named.state;
  assert.equal(state.collection.names.puddlefin, 'Splashy');
});

test('growth scale rises in small capped stages from saved feeds', () => {
  const atFed = (fed) => {
    const state = {
      ...freeState(),
      egg: { ...freeState().egg, hatchedCreatureId: 'sprout' },
      collection: { owned: { sprout: true }, names: {}, fed: { sprout: fed } },
    };
    return game.creatureGrowthScale(state);
  };
  assert.equal(atFed(0), 1);
  assert.equal(atFed(2), 1.16);
  assert.equal(atFed(4), 1.32);
  assert.equal(atFed(40), 1.32);
});

test('pre-festival saves migrate and can still earn, hatch, and reload the prize', () => {
  storage.clear();
  const oldSave = { ...freeState() };
  delete oldSave.thirdEgg; // genuine old saves lack the key entirely
  let state = game.migrateRetention(oldSave);
  assert.equal(state.thirdEgg, null);
  state = fillCrates(state, 8);
  assert.ok(state.thirdEgg);
  const hatch = game.tapThirdEgg(game.tapThirdEgg(game.tapThirdEgg(state, content, 3_000).state, content, 3_001).state, content, 3_002);
  assert.equal(hatch.hatchedCreatureId, 'puddlefin');
  state = hatch.state;
  assert.equal(saveGame(state), true);
  const loaded = loadGame(4_000);
  assert.equal(loaded.isNewGame, false);
  assert.equal(loaded.state.freeOrderFills, 8);
  assert.equal(loaded.state.thirdEgg.hatchedCreatureId, 'puddlefin');
  assert.ok(loaded.state.collection.owned.puddlefin);
  assert.equal(game.festivalStageCount(loaded.state.freeOrderFills), 4);
  // A reloaded third-egg tap count is transient, like the other eggs.
  assert.equal(loaded.state.thirdEgg.hatchTaps, 0);
});

test('third-egg taps are safe no-ops before the prize and after hatching', () => {
  const fresh = freeState();
  assert.deepEqual(game.tapThirdEgg(fresh, content, 5_000), { state: fresh, hatchedCreatureId: null, hatched: false });
  let state = fillCrates(freeState(), 8);
  state = game.tapThirdEgg(game.tapThirdEgg(game.tapThirdEgg(state, content, 5_001).state, content, 5_002).state, content, 5_003).state;
  const again = game.tapThirdEgg(state, content, 5_004);
  assert.equal(again.hatched, false);
  assert.equal(again.state, state);
});

test('board fills count toward the festival exactly like direct fills', () => {
  let state = freeState();
  state = game.ensureOrderBoard(state, content);
  assert.ok(state.orderBoard, 'FREE board builds');
  const open = game.openBoardOrders(state, content).find((o) => o.offerId === 'pip_crate');
  assert.ok(open, 'crate order is open');
  state = { ...state, basket: economy.addCrop(state.basket, 'carrot', 5) };
  const result = game.fulfillBoardOrder(state, content, open.id, 6_000);
  assert.equal(result.success, true);
  assert.equal(result.state.freeOrderFills, 1);
  assert.equal(game.festivalStageCount(result.state.freeOrderFills), 1);
});
