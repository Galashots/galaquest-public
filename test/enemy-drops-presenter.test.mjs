import { strict as assert } from 'node:assert';
import test from 'node:test';

import { nextDropPresenterPhase } from '../public/src/world/enemyDropsPresenter.js';

test('appearing holds until its own pop-in tween completes, then rests', () => {
  assert.equal(nextDropPresenterPhase('appearing', { phaseComplete: false }), 'appearing');
  assert.equal(nextDropPresenterPhase('appearing', { phaseComplete: true }), 'resting');
});

test('resting holds while uncollected, flies to whoever collected it, and despawns for everyone else', () => {
  assert.equal(nextDropPresenterPhase('resting', { collectedBy: null }), 'resting');
  assert.equal(nextDropPresenterPhase('resting', { collectedBy: 'p1', selfHeroId: 'p1' }), 'attracting');
  assert.equal(nextDropPresenterPhase('resting', { collectedBy: 'p2', selfHeroId: 'p1' }), 'gone');
});

test('attracting holds for the whole flight, then is gone', () => {
  assert.equal(nextDropPresenterPhase('attracting', { phaseComplete: false }), 'attracting');
  assert.equal(nextDropPresenterPhase('attracting', { phaseComplete: true }), 'gone');
});

test('gone is a terminal state regardless of what is passed', () => {
  assert.equal(nextDropPresenterPhase('gone', { collectedBy: 'p1', selfHeroId: 'p1', phaseComplete: true }), 'gone');
});
