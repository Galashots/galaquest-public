import test from 'node:test';
import assert from 'node:assert/strict';
import { getHelpOffer, answerHelpQuestion } from '../../src/depth/help-along.js';

const questions = [
  { id: 'g2', grade: 2, choices: ['2', '3'], answerIndex: 1, hint: 'Count again.' },
  { id: 'g5a', grade: 5, choices: ['4', '5'], answerIndex: 1, hint: 'Try five.' },
  { id: 'g5b', grade: 5, choices: ['6', '7'], answerIndex: 1, hint: 'Try seven.' },
  { id: 'g5c', grade: 5, choices: ['8', '9'], answerIndex: 1, hint: 'Try nine.' },
  { id: 'g5d', grade: 5, choices: ['10', '11'], answerIndex: 1, hint: 'Try eleven.' },
];
const now = 10 * 86_400_000;
const rareEgg = { id: 'egg4', kind: 'egg', rarity: 'rare', ordinal: 4,
  startedAt: now, readyAt: now + 60 * 60000 };

test('first three eggs and common crops never offer help; grade filter is exact', () => {
  for (const ordinal of [1, 2, 3, undefined]) {
    assert.equal(getHelpOffer({ target: { ...rareEgg, ordinal }, grade: 5, questions, now }).offer, null);
  }
  assert.equal(getHelpOffer({ target: { ...rareEgg, kind: 'crop', rarity: 'common' }, grade: 5, questions, now }).offer, null);
  assert.ok(getHelpOffer({ target: { ...rareEgg, kind: 'crop', rarity: 'epic' }, grade: 5, questions, now }).offer);
  assert.equal(getHelpOffer({ target: rareEgg, grade: 2, questions, now }).offer.grade, 2);
  assert.equal(getHelpOffer({ target: rareEgg, grade: 5, questions, now }).offer.grade, 5);
});

test('wrong answer gives a hint and free retry; correct answer shortens by a bound', () => {
  const { offer, state } = getHelpOffer({ target: rareEgg, grade: 5, questions, now });
  const wrong = answerHelpQuestion({ target: rareEgg, state, question: offer, choiceIndex: 0, grade: 5, questions, now });
  assert.equal(wrong.correct, false);
  assert.equal(wrong.hint, offer.hint);
  assert.deepEqual(wrong.target, rareEgg);
  assert.equal(wrong.state.usedToday, 0);
  const right = answerHelpQuestion({ target: rareEgg, state: wrong.state, question: offer,
    choiceIndex: 1, grade: 5, questions, now });
  assert.equal(right.correct, true);
  assert.equal(right.shortenedMs, 5 * 60000);
  assert.equal(right.target.readyAt, rareEgg.readyAt - 5 * 60000);
  assert.throws(() => answerHelpQuestion({ target: right.target, state: right.state, question: offer,
    choiceIndex: 1, grade: 5, questions, now }), /not available/);
});

test('soft daily cap is silent, clock rollback cannot reset it, week later can', () => {
  let target = rareEgg;
  let state = {};
  for (let i = 0; i < 3; i++) {
    const offered = getHelpOffer({ target, state, grade: 5, questions, now });
    const answer = answerHelpQuestion({ target, state: offered.state, question: offered.offer,
      choiceIndex: 1, grade: 5, questions, now });
    target = answer.target;
    state = answer.state;
  }
  assert.equal(getHelpOffer({ target, state, grade: 5, questions, now }).offer, null);
  assert.equal(getHelpOffer({ target, state, grade: 5, questions, now: now - 86_400_000 }).offer, null);
  const later = getHelpOffer({ target: { ...target, readyAt: now + 8 * 86_400_000 }, state,
    grade: 5, questions, now: now + 7 * 86_400_000 });
  assert.ok(later.offer);
  assert.equal(later.state.usedToday, 0);
  assert.equal('usesRemaining' in later, false);
});
