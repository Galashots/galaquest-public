// The extension points: save migration, rewards as data, many eggs, growth stages as data,
// limited seeds, and the free-play goal list. These guard the "add content, not code" promise.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../game/src/rules/game.js';
import * as content from '../game/content/index.js';

/** A FREE-play state with Sprout hatched, built directly rather than played to. */
function freeState() {
  let state = game.createGameState(0);
  state = {
    ...state,
    band: 'younger',
    goals: { stepIndex: content.TUTORIAL.length - 1 },
    eggs: [{ ...game.starterEgg(state), cracks: 4, hatched: true, hatchedCreatureId: 'sprout' }],
    collection: { owned: { sprout: true }, names: { sprout: 'Sprout' }, fed: { sprout: 1 } },
  };
  return game.ensureOrderBoard(state, content);
}

function fillCrate(state) {
  const basket = { ...state.basket, crops: { ...state.basket.crops, carrot: (state.basket.crops.carrot || 0) + 5 } };
  const result = game.fulfillOffer({ ...state, basket }, content, 'pip_crate');
  assert.equal(result.success, true);
  return result.state;
}

function tapUntilHatched(state, eggId, c = content) {
  let result;
  for (let i = 0; i < 3; i++) result = game.tapEgg(state = result?.state ?? state, c, eggId);
  return result;
}

test('a version 1 save with an unopened gift migrates to version 2', () => {
  const v1 = {
    version: 1, band: 'older', createdAt: 0,
    farm: { plots: [{ cropId: null }, { cropId: null }, { cropId: null }] },
    basket: { crops: { carrot: 2 }, coins: 4 },
    armor: { owned: ['leaf_crest_helmet'], equipped: { helmet: 'leaf_crest_helmet', chest: null, boots: null, shield: null } },
    egg: { cracks: 4, maxCracks: 4, readyToHatch: false, hatchTaps: 0, requiredHatchTaps: 3, hatched: true, elementHint: 'sun', hatchedCreatureId: 'sprout' },
    secondEgg: { cracks: 0, maxCracks: 4, readyToHatch: true, hatchTaps: 0, requiredHatchTaps: 3, hatched: false, elementHint: 'leaf', hatchedCreatureId: null },
    collection: { owned: { sprout: true }, names: { sprout: 'Sunny' }, fed: { sprout: 2 } },
    goals: { stepIndex: 11 }, bookSeen: true, replantPlanted: 3,
    offersFilled: { crate: 3, bundle: 1, big: 2 },
    giftEarned: true, giftOpened: false, starSeeds: 1, freeOrderFills: 2, orderBoard: null,
  };
  const state = game.migrateSave(v1, 1);
  assert.equal(state.version, 2);
  assert.equal(state.eggs.length, 2);
  assert.equal(game.starterEgg(state).hatchedCreatureId, 'sprout');
  assert.equal(game.findEgg(state, 'pip_gift').creatureId, 'mossbun');
  assert.deepEqual(state.seeds, { sunberry: 1 });
  assert.deepEqual(state.rewards, { earned: ['pip_gift'], seen: [] });
  assert.deepEqual(state.offersFilled, { pip_crate: 3, pip_bundle: 1, pip_big_order: 2 });
  assert.equal(state.collection.names.sprout, 'Sunny');

  // It plays on: the gift is announced, then the Leaf egg is next and hatches Mossbun.
  assert.equal(game.currentGoal(state, content, 0).text, 'Pip has a gift for you!');
  const seen = game.markRewardSeen(state, 'pip_gift');
  assert.deepEqual(game.currentGoal(seen, content, 0), { step: 'free', text: 'Tap the Leaf egg!', targetKey: 'egg', eggId: 'pip_gift' });
  const hatched = tapUntilHatched(seen, 'pip_gift');
  assert.equal(hatched.hatchedCreatureId, 'mossbun');
  assert.equal(hatched.state.collection.owned.mossbun, true);
  // The reward is not granted twice.
  assert.equal(game.checkRewards(hatched.state, content).eggs.length, 2);
});

test('unknown or future save versions are refused rather than misread', () => {
  assert.equal(game.migrateSave({ farm: { plots: [] } }, 99), null);
  assert.equal(game.migrateSave(null, 2), null);
  assert.equal(game.migrateSave({ version: 2, farm: { plots: [] }, goals: { stepIndex: 0 } }, 2), null, 'no eggs');
});

test('a new reward is a content change: it grants a ready egg on its condition', () => {
  const festival = {
    id: 'festival', when: { freeOrderFills: 3 }, title: 'The festival is done!', toast: 'A Water egg!',
    grant: { egg: { id: 'festival', element: 'water', creatureId: 'puddlefin', label: 'Water egg' } },
  };
  const c = { ...content, REWARDS: [...content.REWARDS, festival] };
  let state = freeState();
  state = fillCrate(state);
  state = game.fulfillOffer({ ...state, basket: { ...state.basket, crops: { carrot: 5 } } }, c, 'pip_crate').state;
  assert.equal(game.rewardEarned(state, 'festival'), false);
  state = game.fulfillOffer({ ...state, basket: { ...state.basket, crops: { carrot: 5 } } }, c, 'pip_crate').state;
  assert.equal(game.rewardEarned(state, 'festival'), true);
  assert.deepEqual(state.eggs.map((e) => e.id), ['starter', 'pip_gift', 'festival']);
  assert.equal(game.findEgg(state, 'festival').readyToHatch, true);
  state = game.markRewardSeen(game.markRewardSeen(state, 'pip_gift'), 'festival');
  // Eggs are offered in the order they arrived; each hatches its own creature.
  assert.equal(game.currentGoal(state, c, 0).eggId, 'pip_gift');
  state = tapUntilHatched(state, 'pip_gift', c).state;
  assert.equal(game.currentGoal(state, c, 0).eggId, 'festival');
  const water = tapUntilHatched(state, 'festival', c);
  assert.equal(water.hatchedCreatureId, 'puddlefin');
  assert.deepEqual(game.hatchedCreatures(water.state).map((h) => h.creatureId), ['sprout', 'mossbun', 'puddlefin']);
});

test('tapping one egg never touches another', () => {
  let state = freeState();
  state = { ...state, eggs: [...state.eggs, game.createEgg({ id: 'a', creatureId: 'mossbun', ready: true }),
    game.createEgg({ id: 'b', creatureId: 'tidekit', ready: true })] };
  state = game.tapEgg(state, content, 'a').state;
  assert.equal(game.findEgg(state, 'a').hatchTaps, 1);
  assert.equal(game.findEgg(state, 'b').hatchTaps, 0);
  assert.equal(game.tapEgg(state, content, 'missing').state, state, 'unknown eggs are a no-op');
});

test('growth stages come from content', () => {
  const c = { ...content, FEEDING: { ...content.FEEDING, stages: [...content.FEEDING.stages, { feeds: 5, adornment: 'bigCrest' }] } };
  let state = freeState();
  state = { ...state, basket: { ...state.basket, crops: { sunberry: 10 } } };
  const feeds = [];
  for (let i = 0; i < 4; i++) {
    state = game.feedCreature(state, c).state;
    feeds.push(game.adornments(state, c, 'sprout').join('+'));
  }
  assert.deepEqual(feeds, ['', 'sunCrest', 'sunCrest', 'sunCrest+bigCrest']);
  assert.equal(game.nextGrowthStage(state, c, 'sprout'), null);
});

test('free-play seeds offer limited seeds first, then the free seed', () => {
  let state = { ...freeState(), seeds: { sunberry: 1, glowleaf: 1 } };
  assert.deepEqual(game.remainingSeeds(state, content), ['sunberry', 'glowleaf', 'carrot']);
  assert.equal(game.plantPlot(state, content, 0, 'dewmelon', 0).planted, false, 'no dewmelon seeds');
  state = game.plantPlot(state, content, 0, 'glowleaf', 0).state;
  assert.deepEqual(state.seeds, { sunberry: 1, glowleaf: 0 });
  assert.equal(game.currentGoal(state, content, 0).text, 'Plant your star seed!');
});

test('the free-play guide always has an answer', () => {
  const state = freeState();
  for (const now of [0, 10_000, 1e9]) {
    const goal = game.currentGoal(state, content, now);
    assert.ok(goal.text && goal.targetKey, `goal at ${now}`);
  }
});

test('the feed step uses the name the child chose', () => {
  let state = game.createGameState(0);
  state = {
    ...state,
    goals: { stepIndex: content.TUTORIAL.findIndex((s) => s.id === 'feed') },
    eggs: [{ ...game.starterEgg(state), hatched: true, hatchedCreatureId: 'sprout' }],
    collection: { owned: { sprout: true }, names: { sprout: 'Buddy' }, fed: {} },
  };
  assert.equal(game.currentGoal(state, content, 0).text, 'Feed Buddy a sunberry');
});
