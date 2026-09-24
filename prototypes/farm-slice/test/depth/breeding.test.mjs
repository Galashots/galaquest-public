import test from 'node:test';
import assert from 'node:assert/strict';
import { previewBreeding, createBreedingEgg, observeEgg, hatchEgg } from '../../src/depth/breeding.js';

const a = { id: 'a', element: 'fire', shape: 'round', rarity: 'common', colors: { body: '#ff7043', accent: '#ffd54f' } };
const b = { id: 'b', element: 'water', shape: 'winged', rarity: 'rare', colors: { body: '#29b6f6', accent: '#e1f5fe' } };

test('preview discloses all inheritable trait odds before breeding', () => {
  const odds = previewBreeding(a, b);
  for (const trait of ['element', 'shape', 'rarity', 'bodyColor', 'accentColor'])
    assert.deepEqual(odds[trait].map((option) => option.percent), [50, 50]);
  assert.deepEqual(odds.element.map((option) => option.value), ['fire', 'water']);
  assert.equal(odds.outcomes.length, 32);
  assert.equal(odds.outcomes.reduce((sum, outcome) => sum + outcome.percent, 0), 100);
  assert.deepEqual(previewBreeding(a, { ...b, element: 'fire' }).element, [{ value: 'fire', percent: 100 }]);
  assert.throws(() => previewBreeding(a, a), /different/);
});

test('egg requires two owned creatures, is deterministic, and survives a week away', () => {
  const options = { parentA: a, parentB: b, ownedCreatureIds: ['a', 'b'], eggId: 'egg1', ordinal: 4,
    now: 1_000_000, hatchMs: 86_400_000, seed: 31 };
  assert.throws(() => createBreedingEgg({ ...options, ownedCreatureIds: ['a'] }), /owned/);
  const first = createBreedingEgg(options);
  assert.deepEqual(first, createBreedingEgg(options));
  const early = observeEgg(first.egg, options.now + 1000);
  assert.equal(early.ready, false);
  const backward = observeEgg(early.egg, options.now - 1000);
  assert.equal(backward.remainingMs, early.remainingMs);
  const week = observeEgg(backward.egg, options.now + 7 * 86_400_000);
  assert.equal(week.ready, true);
  assert.equal(week.remainingMs, 0);
  assert.equal(week.egg.hatchedAt, null); // child still gets the hatch moment
  const result = hatchEgg(week.egg, options.now - 1000);
  assert.deepEqual(result.creature.colors, first.egg.child.colors);
  assert.throws(() => hatchEgg(result.egg, options.now + 8 * 86_400_000), /already hatched/);
  assert.deepEqual(JSON.parse(JSON.stringify(result.egg)), result.egg);
});
