// Pip's Garden Festival: content-only rewards (decorations, then a Water egg) and the track line.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../game/src/rules/game.js';
import * as content from '../game/content/index.js';

function freeState() {
  let state = game.createGameState(0);
  state = {
    ...state,
    band: 'younger',
    goals: { stepIndex: content.TUTORIAL.length - 1 },
    eggs: [{ ...game.starterEgg(state), cracks: 4, hatched: true, hatchedCreatureId: 'sprout' }],
    collection: { owned: { sprout: true }, names: { sprout: 'Sprout' }, fed: {} },
  };
  return game.ensureOrderBoard(state, content);
}

function fillCrate(state) {
  const order = game.openBoardOrders(state, content).find((o) => o.offerId === 'pip_crate');
  const stocked = { ...state, basket: { ...state.basket, crops: { ...state.basket.crops, carrot: 5 } } };
  const result = game.fulfillBoardOrder(stocked, content, order.id);
  assert.equal(result.success, true);
  return result.state;
}

test('each free-play order builds the festival, then the prize egg arrives', () => {
  let state = freeState();
  const seen = [];
  for (let fills = 1; fills <= 8; fills++) {
    const before = state;
    state = fillCrate(state);
    seen.push(game.newlyEarned(before, state, content).map((r) => r.id).join('+'));
  }
  assert.deepEqual(seen, [
    'festival_bunting', 'pip_gift', 'festival_pots', '', 'festival_lanterns', '', 'festival_banner', 'festival_prize',
  ]);
  assert.deepEqual(state.decorations, ['festivalBunting', 'festivalPots', 'festivalLanterns', 'festivalBanner']);
  const prize = game.findEgg(state, 'festival');
  assert.equal(prize.readyToHatch, true);
  assert.equal(game.hatchCreatureId(prize, content), 'puddlefin');
});

test('decorations are toasts, not dialogs; the prize is announced', () => {
  let state = freeState();
  for (let i = 0; i < 8; i++) state = fillCrate(state);
  assert.deepEqual(game.unseenRewards(state, content).map((r) => r.id), ['pip_gift', 'festival_prize']);
});

test('the track line counts toward the next stage and then completes', () => {
  let state = freeState();
  assert.deepEqual(game.trackProgress(state, content, 'festival'),
    { track: content.TRACKS[0], done: 0, total: 8, next: { label: 'bunting', remaining: 1 } });
  for (let i = 0; i < 3; i++) state = fillCrate(state);
  assert.deepEqual(game.trackProgress(state, content, 'festival').next, { label: 'lanterns', remaining: 2 });
  for (let i = 0; i < 5; i++) state = fillCrate(state);
  const done = game.trackProgress(state, content, 'festival');
  assert.equal(done.done, 8);
  assert.equal(done.next, null);
  assert.equal(game.trackProgress(state, content, 'nope'), null);
});

test('a save made before the festival existed earns what it already deserves', () => {
  const state = { ...freeState(), freeOrderFills: 5, decorations: undefined };
  const migrated = game.migrateSave(state, 2);
  const caughtUp = game.checkRewards(migrated, content);
  assert.deepEqual(caughtUp.decorations, ['festivalBunting', 'festivalPots', 'festivalLanterns']);
  assert.equal(game.findEgg(caughtUp, 'festival'), null, 'the prize still needs 8 orders');
});
