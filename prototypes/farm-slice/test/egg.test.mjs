import test from 'node:test';
import assert from 'node:assert/strict';
import * as egg from '../src/rules/egg.js';

const creatures = [
  { id: 'sprout', element: 'sun' },
  { id: 'aquapip', element: 'water' },
];

test('the egg is not ready until maxCracks is reached', () => {
  let e = egg.createEggState();
  assert.equal(e.readyToHatch, false);
  e = egg.addCrack(e);
  e = egg.addCrack(e);
  e = egg.addCrack(e);
  assert.equal(e.readyToHatch, false);
  assert.equal(e.cracks, 3);
});

test('the last crack (4th) makes the egg ready, with no question gate involved', () => {
  let e = egg.createEggState();
  for (let i = 0; i < 4; i++) e = egg.addCrack(e);
  assert.equal(e.readyToHatch, true);
  assert.equal(e.cracks, 4);
});

test('extra cracks past max do not overflow or break readiness', () => {
  let e = egg.createEggState();
  for (let i = 0; i < 10; i++) e = egg.addCrack(e);
  assert.equal(e.cracks, 4);
  assert.equal(e.readyToHatch, true);
});

test('tapEgg is a safe no-op before the egg is ready', () => {
  let e = egg.createEggState();
  e = egg.addCrack(e);
  const result = egg.tapEgg(e, creatures);
  assert.equal(result.hatched, false);
  assert.equal(result.eggState.hatched, false);
  assert.equal(result.eggState.hatchTaps, 0);
});

test('it takes exactly REQUIRED_HATCH_TAPS taps once ready -- no question gate, ever', () => {
  let e = egg.createEggState();
  for (let i = 0; i < 4; i++) e = egg.addCrack(e);

  let result = egg.tapEgg(e, creatures);
  assert.equal(result.hatched, false, 'tap 1 of 3 should not hatch yet');
  e = result.eggState;
  assert.equal(e.hatchTaps, 1);

  result = egg.tapEgg(e, creatures);
  assert.equal(result.hatched, false, 'tap 2 of 3 should not hatch yet');
  e = result.eggState;
  assert.equal(e.hatchTaps, 2);

  result = egg.tapEgg(e, creatures);
  assert.equal(result.hatched, true, 'tap 3 of 3 should hatch');
  assert.equal(result.hatchedCreatureId, 'sprout');
  assert.equal(result.eggState.hatched, true);
  assert.equal(result.eggState.readyToHatch, false);
});

test('tapEgg picks the creature matching the element hint from the first harvest', () => {
  let e = egg.createEggState();
  for (let i = 0; i < 4; i++) e = egg.addCrack(e);
  e = egg.setElementHint(e, 'sun');
  for (let i = 0; i < 2; i++) e = egg.tapEgg(e, creatures).eggState;
  const result = egg.tapEgg(e, creatures);
  assert.equal(result.hatched, true);
  assert.equal(result.hatchedCreatureId, 'sprout');
});

test('tapEgg falls back to the first creature when there is no element hint', () => {
  let e = egg.createEggState();
  for (let i = 0; i < 4; i++) e = egg.addCrack(e);
  for (let i = 0; i < 2; i++) e = egg.tapEgg(e, creatures).eggState;
  const result = egg.tapEgg(e, creatures);
  assert.equal(result.hatched, true);
  assert.equal(result.hatchedCreatureId, 'sprout');
});

test('setElementHint only takes effect once (first harvest wins)', () => {
  let e = egg.createEggState();
  e = egg.setElementHint(e, 'sun');
  e = egg.setElementHint(e, 'water');
  assert.equal(e.elementHint, 'sun');
});

test('an already-hatched egg cannot crack or tap-hatch again', () => {
  let e = egg.createEggState();
  for (let i = 0; i < 4; i++) e = egg.addCrack(e);
  for (let i = 0; i < 3; i++) e = egg.tapEgg(e, creatures).eggState;
  assert.equal(e.hatched, true);

  const stillHatched = egg.addCrack(e);
  assert.equal(stillHatched.cracks, e.cracks);

  const secondTap = egg.tapEgg(e, creatures);
  assert.equal(secondTap.hatched, false);
});
