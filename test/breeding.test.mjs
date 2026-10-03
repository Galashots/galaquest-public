// Breeding: odds shown are the odds used, deterministic hatch, timer persistence, nest, guide.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../game/src/rules/game.js';
import * as content from '../game/content/index.js';
import { loadGame, saveGame } from '../game/src/save.js';

const storage = new Map();
globalThis.window = { localStorage: {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
} };

const T0 = 1_000_000;
const HATCH_MS = content.BREEDING.hatchSeconds * 1000;

/** A free-play farm owning the given species, with an empty farm and no pending tasks. */
function freeFarm(owned = ['sprout', 'cinderkit'], { band = 'younger' } = {}) {
  const state = game.createGameState(T0);
  return { ...state, band, goals: { ...state.goals, stepIndex: content.TUTORIAL.length - 1 },
    collection: { ...state.collection, owned: Object.fromEntries(owned.map((id) => [id, true])) } };
}
const breed = (state, a, b, now = T0) => {
  const result = game.startBreeding(state, content, a, b, now);
  assert.equal(result.success, true);
  return result;
};

test('the preview lists every outcome, adds to 100, and is symmetric', () => {
  const state = freeFarm(['sprout', 'cinderkit', 'tidekit']);
  const odds = game.previewBreed(state, content, 'sprout', 'cinderkit');
  assert.deepEqual(odds.element.map((o) => [o.value, o.percent]), [['sun', 50], ['fire', 50]]);
  assert.deepEqual(odds.rarity.map((o) => [o.value, o.percent]), [['common', 50], ['rare', 50]]);
  // sun has only a common; fire has only rare and epic: the nearest rarity stands in.
  assert.deepEqual(odds.outcomes, [{ creatureId: 'sprout', percent: 50 }, { creatureId: 'cinderkit', percent: 50 }]);
  assert.equal(odds.outcomes.reduce((n, o) => n + o.percent, 0), 100);
  assert.deepEqual(game.previewBreed(state, content, 'cinderkit', 'sprout').outcomes, odds.outcomes);
  assert.equal(game.previewBreed(state, content, 'sprout', 'sprout'), null, 'two different creatures');
  assert.equal(game.previewBreed(state, content, 'sprout', 'mossbun'), null, 'both must be owned');
});

test('odds shown == odds used: rolling across [0,1) hits each outcome for exactly its percent', () => {
  const state = freeFarm(['mossbun', 'tidekit', 'puddlefin']);
  for (const [a, b] of [['mossbun', 'tidekit'], ['puddlefin', 'tidekit'], ['mossbun', 'puddlefin']]) {
    const { outcomes } = game.previewBreed(state, content, a, b);
    const hits = {};
    for (let i = 0; i < 10_000; i++) {
      const id = game.pickOutcome(outcomes, i / 10_000).creatureId;
      hits[id] = (hits[id] || 0) + 1;
    }
    for (const o of outcomes) assert.ok(Math.abs(hits[o.creatureId] / 100 - o.percent) < 0.02, `${a}+${b} ${o.creatureId}`);
    assert.equal(Object.keys(hits).length, outcomes.length);
  }
});

test('the hatched species is always one the dialog listed, across many seeds', () => {
  const base = freeFarm(['mossbun', 'tidekit']);
  const shown = new Set(game.previewBreed(base, content, 'mossbun', 'tidekit').outcomes.map((o) => o.creatureId));
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const { egg } = breed({ ...base, breeding: { seed, made: 0 } }, 'mossbun', 'tidekit');
    assert.ok(shown.has(egg.creatureId));
    seen.add(egg.creatureId);
  }
  assert.deepEqual(seen, shown, 'every shown outcome is reachable');
});

test('deterministic: same state, same egg; the seed advances; reload keeps the species', () => {
  const base = freeFarm(['mossbun', 'tidekit']);
  const a = breed(base, 'mossbun', 'tidekit');
  const b = breed(base, 'mossbun', 'tidekit');
  assert.deepEqual(a.state, b.state);
  assert.notEqual(a.state.breeding.seed, base.breeding.seed);
  assert.equal(a.state.breeding.made, 1);
  saveGame(a.state);
  const loaded = loadGame(T0 + 1).state;
  assert.equal(game.findEgg(loaded, 'bred_1').creatureId, a.egg.creatureId);
  assert.equal(game.findEgg(loaded, 'bred_1').elementHint, a.egg.elementHint);
});

test('breeding costs nothing and takes nothing away', () => {
  const base = freeFarm();
  const { state } = breed(base, 'sprout', 'cinderkit');
  assert.deepEqual(state.basket, base.basket);
  assert.deepEqual(state.seeds, base.seeds);
  assert.deepEqual(state.collection, base.collection);
  assert.equal(state.eggs.length, base.eggs.length + 1);
});

test('nest occupancy: one growing egg at a time; free again after it hatches', () => {
  const base = freeFarm();
  assert.equal(game.canBreed(base, content), true);
  const { state } = breed(base, 'sprout', 'cinderkit');
  assert.equal(game.canBreed(state, content), false);
  assert.equal(game.startBreeding(state, content, 'sprout', 'cinderkit', T0).success, false);
  let ready = game.observeNest(state, T0 + HATCH_MS);
  for (let i = 0; i < 3; i++) ready = game.tapEgg(ready, content, 'bred_1').state;
  assert.equal(game.findEgg(ready, 'bred_1').hatched, true);
  assert.equal(game.canBreed(ready, content), true);
  assert.equal(game.startBreeding(ready, content, 'sprout', 'cinderkit', T0 + HATCH_MS).egg.id, 'bred_2');
});

test('needs two owned creatures and free play', () => {
  assert.equal(game.canBreed(freeFarm(['sprout']), content), false);
  assert.equal(game.canBreed(freeFarm(), content), true);
  const tutorial = { ...freeFarm(), goals: { stepIndex: 3 } };
  assert.equal(game.canBreed(tutorial, content), false);
  assert.equal(game.startBreeding(tutorial, content, 'sprout', 'cinderkit', T0).success, false);
});

test('timer: not ready early, ready on time, child taps to hatch the shown species', () => {
  const { state, egg } = breed(freeFarm(), 'sprout', 'cinderkit');
  assert.equal(game.eggProgress(egg, T0), 0);
  assert.equal(game.eggProgress(egg, T0 + HATCH_MS / 2), 0.5);
  const early = game.observeNest(state, T0 + HATCH_MS - 1);
  assert.equal(game.findEgg(early, 'bred_1').readyToHatch, false);
  assert.equal(game.tapEgg(early, content, 'bred_1').state, early, 'tapping a growing egg is a safe no-op');
  const ready = game.observeNest(early, T0 + HATCH_MS);
  assert.equal(game.findEgg(ready, 'bred_1').readyToHatch, true);
  assert.equal(game.eggProgress(game.findEgg(ready, 'bred_1'), T0), 1);
  let after = ready;
  let hatched;
  for (let i = 0; i < 3; i++) ({ state: after, hatchedCreatureId: hatched } = game.tapEgg(after, content, 'bred_1'));
  assert.equal(hatched, egg.creatureId);
  assert.equal(after.collection.owned[egg.creatureId], true);
});

test('timer persists across reloads, even a week away, and never runs backward on clock rollback', () => {
  let { state } = breed(freeFarm(), 'sprout', 'cinderkit');
  state = game.observeNest(state, T0 + 100_000);
  const before = game.eggProgress(game.findEgg(state, 'bred_1'), T0 + 100_000);
  assert.ok(before > 0.3);
  saveGame(state);
  let loaded = loadGame(T0 + 100_000).state;
  assert.equal(game.eggProgress(game.findEgg(loaded, 'bred_1'), T0 + 100_000), before);
  // the device clock jumps back an hour
  const rolled = T0 - 3_600_000;
  assert.equal(game.eggProgress(game.findEgg(loaded, 'bred_1'), rolled), before, 'progress holds');
  assert.equal(game.observeNest(loaded, rolled), loaded, 'observing a past time changes nothing');
  assert.equal(game.findEgg(game.observeNest(loaded, rolled + HATCH_MS), 'bred_1').readyToHatch, false,
    'a rewound clock cannot make it ready early');
  // and a week later it is simply ready
  loaded = game.observeNest(loaded, T0 + 7 * 86_400_000);
  assert.equal(game.findEgg(loaded, 'bred_1').readyToHatch, true);
  // a ready egg stays ready if the clock then goes back
  assert.equal(game.findEgg(game.observeNest(loaded, T0), 'bred_1').readyToHatch, true);
});

test('observeNest writes only every few seconds, so ticking does not rewrite state each frame', () => {
  const { state } = breed(freeFarm(), 'sprout', 'cinderkit');
  assert.equal(game.observeNest(state, T0 + 500), state);
  assert.notEqual(game.observeNest(state, T0 + 15_000), state);
});

test('guide: Make an egg! only when the farm has nothing else to do, then none while the nest is busy', () => {
  const idle = freeFarm();
  // empty plots: planting wins
  assert.match(game.currentGoal(idle, content, T0).text, /Plant/);
  // all planted and watered, nothing ripe: breeding is the thing to do while waiting
  const planted = { ...idle, farm: { plots: idle.farm.plots.map(() => ({ cropId: 'carrot', plantedAt: T0, watered: true })) } };
  let goal = game.currentGoal(planted, content, T0 + 1);
  assert.equal(goal.text, 'Make an egg!');
  assert.equal(goal.targetKey, 'breed');
  // a ripe crop outranks it
  assert.equal(game.currentGoal(planted, content, T0 + 60_000).targetKey, 'ripeCrop');
  // one creature only: no suggestion
  const lonely = { ...planted, collection: { ...planted.collection, owned: { sprout: true } } };
  assert.match(game.currentGoal(lonely, content, T0 + 1).text, /growing/);
  // a growing egg: the nest is busy, so back to the crops
  const { state } = breed(planted, 'sprout', 'cinderkit', T0 + 1);
  assert.match(game.currentGoal(state, content, T0 + 2).text, /growing/);
  // a ready bred egg: tap it, ahead of everything
  const ready = game.observeNest(state, T0 + 1 + HATCH_MS);
  goal = game.currentGoal(ready, content, T0 + 1 + HATCH_MS);
  assert.deepEqual([goal.targetKey, goal.eggId], ['egg', 'bred_1']);
});

test('help-along: wrong answers give a hint and cost nothing; a right one shortens a rare egg', () => {
  // Help starts with the 4th bred egg and only for rare/epic ones.
  let state = { ...freeFarm(['cinderkit', 'flamewhisk']), breeding: { seed: 5, made: 3 } };
  state = breed(state, 'cinderkit', 'flamewhisk').state;
  const egg = game.findEgg(state, 'bred_4');
  const offer = game.helpAlongOffer(state, content, T0);
  assert.ok(offer && offer.choices.length >= 2);
  assert.equal('answerIndex' in offer, false, 'the answer is not handed to the UI');
  const question = content.QUESTIONS.find((q) => q.id === offer.id);
  const wrong = question.answerIndex === 0 ? 1 : 0;
  const miss = game.answerHelpAlong(state, content, wrong, T0);
  assert.equal(miss.correct, false);
  assert.equal(miss.hint, question.hint);
  assert.equal(miss.state, state, 'nothing is lost or changed');
  const hit = game.answerHelpAlong(state, content, question.answerIndex, T0);
  assert.equal(hit.correct, true);
  assert.ok(hit.shortenedMs > 0 && hit.shortenedMs <= 5 * 60_000);
  assert.equal(game.findEgg(hit.state, 'bred_4').hatchAt, egg.hatchAt - hit.shortenedMs);
  assert.notEqual(game.helpAlongOffer(hit.state, content, T0)?.id, offer.id, 'the same question is not offered twice');
  // early eggs are never helped
  const first = breed(freeFarm(['cinderkit', 'flamewhisk']), 'cinderkit', 'flamewhisk').state;
  assert.equal(game.helpAlongOffer(first, content, T0), null);
});

test('v2 saves from before breeding load with breeding defaults', () => {
  const { breeding, helpAlong, ...v2 } = freeFarm();
  const loaded = game.migrateSave({ ...v2, version: 2 }, 2);
  assert.deepEqual(loaded.breeding, { seed: T0 >>> 0, made: 0 });
  assert.deepEqual(loaded.helpAlong, {});
  assert.equal(game.canBreed(loaded, content), true);
});
