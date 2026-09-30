// Breeding v1 shell integration: pair two owned creatures -> nest egg ->
// child tap -> uniquely-owned hatched creature. CONTRACT.md + PRODUCT_VISION.md
// creature direction (2026-09-23): reuse the pure lane in src/depth/breeding.js,
// full odds shown before the choice, one nest slot, no crop/coin charge, the
// egg persists and never un-observes, and hatching is always child-triggered.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/rules/game.js';
import * as collection from '../src/rules/collection.js';
import * as content from '../content/index.js';

const NOW = 1_000_000;

function newGame() {
  const state = game.createGameState(NOW);
  // FREE play with two owned creatures, no contract steps involved.
  let s = { ...state, goals: { step: 'free' } };
  s = { ...s, collection: collection.discoverCreature(s.collection, 'sprout') };
  s = { ...s, collection: collection.discoverCreature(s.collection, 'mossbun') };
  return s;
}

/** Same, but with a rare parent so the help-along lane can qualify the egg. */
function newGameWithRare() {
  let s = newGame();
  s = { ...s, collection: collection.discoverCreature(s.collection, 'cinderkit') };
  return s;
}

test('breedableParents lists owned creatures with visible traits, sorted', () => {
  const parents = game.breedableParents(newGame(), content);
  assert.deepEqual(parents.map((p) => p.id), ['mossbun', 'sprout']);
  const sprout = parents.find((p) => p.id === 'sprout');
  assert.equal(sprout.element, 'sun');
  assert.equal(sprout.shape, 'round');
  assert.deepEqual(Object.keys(sprout.colors).sort(), ['accent', 'body']);
});

test('canBreed requires a free nest and two owned creatures', () => {
  assert.equal(game.canBreed(newGame(), content), true);
  const one = { ...newGame(), collection: collection.discoverCreature(collection.createCollectionState(), 'sprout') };
  assert.equal(game.canBreed(one, content), false);
  const bred = game.startBreeding(newGame(), content, 'sprout', 'mossbun', NOW);
  assert.ok(!bred.error);
  assert.equal(game.canBreed(bred.state, content), false);
});

test('startBreeding validates parents: not owned, same parent, occupied nest', () => {
  const state = newGame();
  assert.equal(game.startBreeding(state, content, 'sprout', 'cinderkit', NOW).error, 'parent-not-owned');
  assert.equal(game.startBreeding(state, content, 'sprout', 'sprout', NOW).error, 'same-parent');
  const occupied = game.startBreeding(state, content, 'sprout', 'mossbun', NOW).state;
  assert.equal(game.startBreeding(occupied, content, 'sprout', 'mossbun', NOW).error, 'nest-occupied');
});

test('startBreeding creates a persisted nest egg with a 5-minute timer and no charge', () => {
  const state = newGame();
  const coins = state.basket.coins;
  const crops = { ...state.basket.crops };
  const { state: next, egg, error } = game.startBreeding(state, content, 'sprout', 'mossbun', NOW);
  assert.ok(!error);
  assert.equal(next.breeding.egg.id, 'breeding-1');
  assert.equal(next.breeding.egg.createdAt, NOW);
  assert.equal(next.breeding.egg.readyAt, NOW + game.BREEDING_HATCH_MS);
  assert.equal(next.breeding.ordinal, 1);
  // Child traits resolve at egg creation from the two parents.
  const child = next.breeding.egg.child;
  assert.ok(['sun', 'leaf'].includes(child.element));
  assert.ok(['round', 'blob'].includes(child.shape) || typeof child.shape === 'string');
  assert.deepEqual(egg.child, child);
  assert.equal(next.basket.coins, coins);
  assert.deepEqual(next.basket.crops, crops);
  // Deterministic: same parents + same seed -> same child (recipe-like).
  const again = game.startBreeding(newGame(), content, 'sprout', 'mossbun', NOW);
  assert.deepEqual(again.state.breeding.egg.child, child);
});

test('nest egg status tracks readiness and never un-observes on rollback', () => {
  const { state } = game.startBreeding(newGame(), content, 'sprout', 'mossbun', NOW);
  const early = game.breedingEggStatus(state, NOW + 60_000);
  assert.equal(early.ready, false);
  assert.ok(early.remainingMs > 0 && early.remainingMs <= game.BREEDING_HATCH_MS);
  const observed = game.observeBreedingEgg(state, NOW + 240_000);
  assert.notEqual(observed, state); // the clock advanced: new state
  assert.equal(game.observeBreedingEgg(observed, NOW + 240_000), observed); // same instant: identical (no per-frame churn)
  const rolled = game.observeBreedingEgg(observed, NOW); // clock goes back
  assert.equal(rolled, observed); // nothing to un-observe: identical
  const ready = game.breedingEggStatus(rolled, NOW + game.BREEDING_HATCH_MS);
  assert.equal(ready.ready, true);
  assert.equal(ready.remainingMs, 0);
  assert.equal(game.breedingEggStatus(newGame(), NOW), null);
});

test('hatchBreedingEgg is a safe no-op before readiness; then hatches a unique creature', () => {
  const { state } = game.startBreeding(newGame(), content, 'sprout', 'mossbun', NOW);
  const tooEarly = game.hatchBreedingEgg(state, content, NOW + 60_000);
  assert.equal(tooEarly.success, false);
  assert.equal(tooEarly.state, state);

  const { state: hatched, creature, success } = game.hatchBreedingEgg(
    state, content, NOW + game.BREEDING_HATCH_MS);
  assert.equal(success, true);
  assert.equal(creature.id, 'hatched-breeding-1');
  assert.ok(creature.element && creature.shape && creature.rarity);
  assert.deepEqual(Object.keys(creature.colors).sort(), ['accent', 'body']);
  // The child is a uniquely-owned instance with recorded traits.
  assert.ok(collection.isDiscovered(hatched.collection, creature.id));
  assert.deepEqual(hatched.collection.bred[creature.id], {
    element: creature.element, shape: creature.shape,
    rarity: creature.rarity, colors: creature.colors,
  });
  // The nest frees up for the next breeding.
  assert.equal(hatched.breeding.egg, null);
  assert.equal(game.canBreed(hatched, content), true);
});

test('a hatched creature can itself be a breeding parent (second generation)', () => {
  const { state } = game.startBreeding(newGame(), content, 'sprout', 'mossbun', NOW);
  const { state: hatched } = game.hatchBreedingEgg(state, content, NOW + game.BREEDING_HATCH_MS);
  const parents = game.breedableParents(hatched, content);
  assert.ok(parents.some((p) => p.id === 'hatched-breeding-1'));
  const second = game.startBreeding(hatched, content, 'hatched-breeding-1', 'sprout', NOW + game.BREEDING_HATCH_MS);
  assert.ok(!second.error);
  assert.equal(second.state.breeding.egg.id, 'breeding-2');
});

test('learning shortens the nest timer within the lane bound (help-along reuse)', () => {
  // A rare parent x a common parent gives the child a 50% rare shot; find a
  // seed that yields a qualifying (rare/epic) child, past the first three
  // breedings as the help lane requires.
  let bred = null;
  for (let seed = 0; seed < 200 && !bred; seed++) {
    const base = newGameWithRare();
    const attempt = game.startBreeding(
      { ...base, breeding: { ...base.breeding, seed, ordinal: 3 } }, content, 'sprout', 'cinderkit', NOW);
    const rarity = attempt.state.breeding.egg.child.rarity;
    if (rarity === 'rare' || rarity === 'epic') bred = attempt.state;
  }
  assert.ok(bred, 'expected a rare/epic child within 200 seeds');
  const grade = 2;
  const { offer, state: offered } = game.breedingHelpOffer(bred, grade, content.QUESTIONS, NOW);
  assert.ok(offer, 'expected a help offer for a qualifying egg');
  const before = offered.breeding.egg.readyAt;

  // Wrong answers give the hint and a free retry -- never a fail state.
  const wrongChoice = (offer.answerIndex + 1) % offer.choices.length;
  const wrong = game.answerBreedingHelpQuestion(offered, grade, content.QUESTIONS, offer.id, wrongChoice, NOW);
  assert.equal(wrong.correct, false);
  assert.ok(wrong.hint);
  assert.equal(wrong.state.breeding.egg.readyAt, before); // the timer never moves on a wrong answer
  const retried = game.breedingHelpOffer(wrong.state, grade, content.QUESTIONS, NOW);
  assert.ok(retried.offer, 'the same question is still available after a wrong answer');

  // A correct answer shortens the timer within the lane's bound.
  const answered = game.answerBreedingHelpQuestion(retried.state, grade, content.QUESTIONS, offer.id, offer.answerIndex, NOW);
  assert.equal(answered.correct, true);
  assert.ok(answered.shortenedMs > 0);
  assert.equal(answered.state.breeding.egg.readyAt, before - answered.shortenedMs);
});

test('migration keeps old saves valid and gains the breeding state additively', () => {
  const legacy = { goals: { step: 'free' }, collection: { owned: { sprout: true }, names: {}, fed: {} } };
  const migrated = game.migrateRetention(legacy);
  assert.ok(migrated.breeding);
  assert.equal(migrated.breeding.egg, null);
  assert.deepEqual(migrated.collection.bred, {});
  assert.equal(game.canBreed(migrated, content), false);
});
