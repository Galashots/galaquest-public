// P2 order board: persistent refillable FREE orders + older third card.
// CONTRACT.md section 5 item 3; depth lane src/depth/orders.js reused read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../game/src/rules/game.js';
import * as content from '../game/content/index.js';
import { canFulfillOrder } from '../game/src/depth/orders.js';
import { loadGame } from '../game/src/save.js';

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

/** Drives contract path A (crate first) all the way to FREE for either band. */
function driveToFree(band = 'younger') {
  let state = game.createGameState(0);
  state = game.setBand(state, band);
  state = plant(state, 0, 'carrot', 0);
  state = plant(state, 1, 'sunberry', 0);
  state = plant(state, 2, 'carrot', 0);
  state = harvest(state, 0, 20_000);
  state = harvest(state, 2, 20_000);
  state = harvest(state, 1, 41_000);
  state = game.openMarket(state);
  state = game.fulfillOffer(state, content, 'pip_crate', 41_000).state;
  state = game.buyArmor(state, content, 'leaf_crest_helmet', 41_000).state;
  state = game.tapEgg(state, content, 41_000).state;
  state = game.tapEgg(state, content, 41_000).state;
  state = game.tapEgg(state, content, 41_000).state;
  state = game.nameCreature(state, content, 'Sprout', 42_000).state;
  state = game.closeBook(state);
  state = game.feedSunberry(state, content, 42_000).state;
  state = plant(state, 0, 'carrot', 42_000);
  state = plant(state, 1, 'carrot', 42_000);
  state = plant(state, 2, 'carrot', 42_000);
  state = harvest(state, 0, 62_000);
  state = harvest(state, 1, 62_000);
  state = harvest(state, 2, 62_000);
  assert.equal(game.currentGoal(state, content, 62_000).step, 'free');
  return state;
}

function offerIds(state) {
  return game.openBoardOrders(state, content).map((o) => o.offerId).sort();
}

test('board opens on FREE entry: 2 cards younger, 3 with the big order older', () => {
  const younger = driveToFree('younger');
  assert.ok(younger.orderBoard, 'younger board exists');
  assert.deepEqual(offerIds(younger), ['pip_bundle', 'pip_crate']);
  assert.equal(game.openBoardOrders(younger, content).length, 2);

  const older = driveToFree('older');
  assert.ok(older.orderBoard, 'older board exists');
  assert.deepEqual(offerIds(older), ['pip_big_order', 'pip_bundle', 'pip_crate']);
  const big = game.openBoardOrders(older, content).find((o) => o.offerId === 'pip_big_order');
  assert.deepEqual(big.wants, { carrot: 6, sunberry: 2 });
  assert.equal(big.coins, 26);

  // Deterministic: rebuilding from the same band yields the same board.
  const rebuilt = game.ensureOrderBoard({ ...older, orderBoard: null }, content);
  assert.deepEqual(rebuilt.orderBoard, older.orderBoard);
});

test('unplantable-crop offers never reach the board', () => {
  for (const band of ['younger', 'older']) {
    const ids = new Set(game.boardOffers(content, band).map((o) => o.id));
    for (const unreachable of ['maple_wheat', 'pip_pumpkins_big', 'maple_carrots_five',
      'pip_carrot_wheat', 'pip_sunberries', 'maple_dewmelons', 'pip_glowleaf_half',
      'maple_pumpkin_compare', 'reed_wheat_save']) {
      assert.equal(ids.has(unreachable), false, `${unreachable} stays off the ${band} board`);
    }
    const wants = game.boardOffers(content, band).flatMap((o) => Object.keys(o.wants));
    for (const crop of ['wheat', 'pumpkin', 'dewmelon', 'glowleaf']) {
      assert.equal(wants.includes(crop), false, `${band} board never wants ${crop}`);
    }
  }
});

test('third card needs exactly 6 carrots + 2 sunberries', () => {
  const older = driveToFree('older');
  const big = game.openBoardOrders(older, content).find((o) => o.offerId === 'pip_big_order');
  assert.equal(canFulfillOrder(big, { carrot: 6, sunberry: 1 }), false);
  assert.equal(canFulfillOrder(big, { carrot: 5, sunberry: 2 }), false);
  assert.equal(canFulfillOrder(big, { carrot: 6, sunberry: 2 }), true);
});

test('board fills pay out, spend crops, and redraw the same order', () => {
  let state = driveToFree('younger');
  const before = game.openBoardOrders(state, content).find((o) => o.offerId === 'pip_crate');
  const coinsBefore = state.basket.coins;
  const result = game.fulfillBoardOrder(state, content, before.id, 62_000);
  assert.equal(result.success, true);
  assert.equal(result.coinsEarned, 10);
  assert.equal(result.fulfilledOfferId, 'pip_crate');
  state = result.state;
  assert.equal(state.basket.coins, coinsBefore + 10);
  assert.equal(state.basket.crops.carrot, 10 - 5);
  assert.equal(state.offersFilled.crate, 2, 'contract-path crate fill plus this board fill');
  assert.equal(state.freeOrderFills, 1);
  // Persistent refillable board: the crate is open again under a new instance id.
  const after = game.openBoardOrders(state, content).filter((o) => o.offerId === 'pip_crate');
  assert.equal(after.length, 1);
  assert.notEqual(after[0].id, before.id);
  assert.equal(game.openBoardOrders(state, content).length, 2);

  // The big order pays 26 and files its own counter.
  let older = driveToFree('older');
  older = { ...older, basket: { ...older.basket, crops: { carrot: 6, sunberry: 2 } } };
  const big = game.openBoardOrders(older, content).find((o) => o.offerId === 'pip_big_order');
  const filled = game.fulfillBoardOrder(older, content, big.id, 62_000);
  assert.equal(filled.success, true);
  assert.equal(filled.coinsEarned, 26);
  assert.equal(filled.state.offersFilled.big, 1);
  assert.deepEqual(filled.state.basket.crops, { carrot: 0, sunberry: 0 });
});

test('board fills count toward Pip gift exactly like direct fills', () => {
  let state = driveToFree('younger');
  for (let i = 0; i < 2; i++) {
    const crate = game.openBoardOrders(state, content).find((o) => o.offerId === 'pip_crate');
    state = game.fulfillBoardOrder(state, content, crate.id, 62_000 + i).state;
    state = plant(state, 0, 'carrot', 62_000 + i);
    state = plant(state, 1, 'carrot', 62_000 + i);
    state = plant(state, 2, 'carrot', 62_000 + i);
    state = harvest(state, 0, 82_000 + i * 1_000);
    state = harvest(state, 1, 82_000 + i * 1_000);
    state = harvest(state, 2, 82_000 + i * 1_000);
  }
  assert.equal(state.freeOrderFills, 2);
  assert.equal(state.giftEarned, true);
  assert.equal(state.starSeeds, 1);
  assert.ok(state.secondEgg, 'gift via board fills still grants the Leaf egg');
});

test('legacy direct fills in FREE still work and gain a board', () => {
  let state = driveToFree('younger');
  state = { ...state, orderBoard: null }; // pre-P2 shape, e.g. mid-test states
  const result = game.fulfillOffer(state, content, 'pip_crate', 62_000);
  assert.equal(result.success, true);
  assert.equal(result.state.freeOrderFills, 1);
  assert.ok(result.state.orderBoard, 'first FREE fill opens the board');
  assert.deepEqual(
    game.openBoardOrders(result.state, content).map((o) => o.offerId).sort(),
    ['pip_bundle', 'pip_crate']);

  // With a board present, direct fills route through the open order.
  const routed = game.fulfillOffer(result.state, content, 'pip_crate', 62_000);
  assert.equal(routed.success, true);
  assert.equal(routed.state.offersFilled.crate, 3, 'drive + legacy + routed fills');
});

test('board fills are safe no-ops when unknown, unfillable, or pre-FREE', () => {
  const state = driveToFree('younger');
  assert.deepEqual(game.fulfillBoardOrder(state, content, 'order-999', 62_000),
    { state, success: false }, 'unknown order id');
  const big = game.fulfillBoardOrder(
    { ...state, orderBoard: driveToFree('older').orderBoard }, content,
    game.openBoardOrders(driveToFree('older'), content).find((o) => o.offerId === 'pip_big_order').id, 62_000);
  assert.equal(big.success, false, '6C+2S not in a 10C+1S basket');

  let pre = game.createGameState(0);
  pre = game.setBand(pre, 'younger');
  assert.deepEqual(game.openBoardOrders(pre, content), []);
  assert.deepEqual(game.fulfillBoardOrder(pre, content, 'order-1', 0),
    { state: pre, success: false }, 'no board before FREE');
  assert.equal(game.ensureOrderBoard(pre, content), pre, 'no board before FREE');
});

test('pre-P2 FREE saves migrate with a board for their band', () => {
  const older = driveToFree('older');
  const legacy = { ...older, orderBoard: undefined };
  delete legacy.orderBoard;
  storage.set('gq.farmSlice.v1', JSON.stringify({ version: 1, savedAt: 62_000, state: legacy }));
  const loaded = loadGame(62_000);
  assert.equal(loaded.isNewGame, false);
  assert.ok(loaded.state.orderBoard, 'FREE save gains a board on load');
  assert.equal(loaded.state.orderBoard.band, 'older');
  assert.deepEqual(
    game.openBoardOrders(loaded.state, content).map((o) => o.offerId).sort(),
    ['pip_big_order', 'pip_bundle', 'pip_crate']);
  // P1 fields survive the same migration.
  assert.equal(loaded.state.collection.owned.sprout, true);
});

test('FREE chip points at the market only when a board order is fillable', () => {
  let state = driveToFree('younger');
  // 10C+1S fills the crate: market.
  assert.equal(game.currentGoal(state, content, 62_000).targetKey, 'market');
  // Spend everything the board wants: two crate fills empty the carrots.
  // (Two fills earn the gift and the Leaf egg, which outrank the farm chip,
  // so announce the gift and hatch the egg first.)
  state = game.fulfillOffer(state, content, 'pip_crate', 62_000).state;
  state = game.fulfillOffer(state, content, 'pip_crate', 62_000).state;
  assert.deepEqual([state.basket.crops.carrot, state.basket.crops.sunberry], [0, 1]);
  state = game.openGift(state);
  state = game.tapSecondEgg(state, content, 62_000).state;
  state = game.tapSecondEgg(state, content, 62_000).state;
  state = game.tapSecondEgg(state, content, 62_000).state;
  const goal = game.currentGoal(state, content, 62_000);
  assert.notEqual(goal.targetKey, 'market', 'empty basket points at the farm, not the stall');
});

test('band switch rebuilds the board; no card nudges either offer', () => {
  let state = driveToFree('younger');
  state = game.setBand(state, 'older');
  state = game.ensureOrderBoard(state, content);
  assert.deepEqual(
    game.openBoardOrders(state, content).map((o) => o.offerId).sort(),
    ['pip_big_order', 'pip_bundle', 'pip_crate']);
  for (const o of game.openBoardOrders(state, content)) {
    assert.match(o.text.toLowerCase(), /^((?!best|deal of|recommended).)*$/, `${o.offerId} carries no nudge`);
  }
});
