import test from 'node:test';
import assert from 'node:assert/strict';
import { placeEggs } from '../game/src/render/placement.js';

const waiting = (id) => ({ id, hatched: false });
const hatched = (id, creature) => ({ id, hatched: true, hatchedCreatureId: creature });

test('every egg and each species gets its own spot, in order', () => {
  const placed = placeEggs([hatched('starter', 'sprout'), hatched('a', 'mossbun'), waiting('b')], 6);
  assert.deepEqual([...placed], [['starter', 0], ['a', 1], ['b', 2]]);
});

test('a second hatchling of a species stays in the book', () => {
  const placed = placeEggs([hatched('starter', 'sprout'), hatched('a', 'sprout'), hatched('b', 'mossbun')], 6);
  assert.deepEqual([...placed.keys()], ['starter', 'b']);
});

test('spots are stable as eggs come and go', () => {
  let placed = placeEggs([hatched('starter', 'sprout'), waiting('a'), waiting('b')], 6);
  assert.equal(placed.get('b'), 2);
  // `a` hatches into a species already shown: its spot frees up, `b` does not move.
  placed = placeEggs([hatched('starter', 'sprout'), hatched('a', 'sprout'), waiting('b')], 6, placed);
  assert.equal(placed.get('b'), 2);
  assert.equal(placed.has('a'), false);
  // A new egg takes the free spot.
  placed = placeEggs([hatched('starter', 'sprout'), hatched('a', 'sprout'), waiting('b'), waiting('c')], 6, placed);
  assert.equal(placed.get('c'), 1);
});

test('when spots run out, waiting eggs win and the starter stays', () => {
  const eggs = [hatched('starter', 'sprout'), hatched('a', 'mossbun'), hatched('b', 'puddlefin'), waiting('c')];
  const placed = placeEggs(eggs, 3);
  assert.deepEqual([...placed.keys()].sort(), ['b', 'c', 'starter']);
  assert.equal(placed.get('starter'), 0);
});
