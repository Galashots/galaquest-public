// D1: the pure fold that turns combat/encounter.js's own events into Lantern Mark awards, one per
// wolf-life. Deliberately outside public/src/combat/ -- see rewards/marks.js's own header -- but
// copying its discipline: no DOM, no clock, no randomness, importable under plain `node --test`.
//
// Sol's ruling implemented: "a mark per kill, three marks unlocking something visible." Participation
// credit, not killing-blow-only (brief D1): every hero who landed at least one wolf-hit during the
// wolf-life that ends in wolf-defeated earns one mark, because two brothers fighting one wolf should
// both be rewarded.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { MARKS_TO_UNLOCK, createRewardLedger, foldEvents } from '../public/src/rewards/marks.js';

function hit(heroId, remaining) {
  return { type: 'wolf-hit', heroId, remaining };
}
function defeated(heroId) {
  return { type: 'wolf-defeated', heroId };
}
function respawned() {
  return { type: 'wolf-respawned' };
}

test('MARKS_TO_UNLOCK is 3, per Sol\'s ruling', () => {
  assert.equal(MARKS_TO_UNLOCK, 3);
});

test('a hero who lands a hit then the killing blow earns exactly one mark-earned award', () => {
  const events = [hit('hero-a', 2), hit('hero-a', 1), defeated('hero-a')];
  const { awards } = foldEvents(createRewardLedger(), events);
  const marks = awards.filter((a) => a.type === 'mark-earned');
  assert.equal(marks.length, 1, `expected exactly one award, got ${JSON.stringify(marks)}`);
  assert.equal(marks[0].heroId, 'hero-a');
  assert.ok(typeof marks[0].eventId === 'string' && marks[0].eventId.length > 0);
});

test('two contributing heroes both earn a mark from the same kill, kinder than killing-blow-only', () => {
  const events = [hit('hero-a', 2), hit('hero-b', 1), defeated('hero-b')];
  const { awards } = foldEvents(createRewardLedger(), events);
  const heroIds = awards.filter((a) => a.type === 'mark-earned').map((a) => a.heroId).sort();
  assert.deepEqual(heroIds, ['hero-a', 'hero-b']);
});

test('a hero who never landed a hit earns nothing, even if present for the kill', () => {
  // hero-b never appears in a wolf-hit event and is not the one credited with the defeat.
  const events = [hit('hero-a', 1), defeated('hero-a')];
  const { awards } = foldEvents(createRewardLedger(), events);
  const heroIds = awards.filter((a) => a.type === 'mark-earned').map((a) => a.heroId);
  assert.deepEqual(heroIds, ['hero-a']);
});

test('two lives award twice, with distinct eventIds, threading the ledger through', () => {
  let ledger = createRewardLedger();

  const first = foldEvents(ledger, [hit('hero-a', 1), defeated('hero-a')]);
  ledger = first.ledger;
  const firstMarks = first.awards.filter((a) => a.type === 'mark-earned');
  assert.equal(firstMarks.length, 1);

  const second = foldEvents(ledger, [respawned(), hit('hero-a', 1), defeated('hero-a')]);
  ledger = second.ledger;
  const secondMarks = second.awards.filter((a) => a.type === 'mark-earned');
  assert.equal(secondMarks.length, 1);

  assert.notEqual(firstMarks[0].eventId, secondMarks[0].eventId,
    'the two lives must produce distinct idempotency keys');
});

test('a replayed batch of the same events, threaded through the same ledger, awards nothing new', () => {
  const events = [hit('hero-a', 1), defeated('hero-a')];
  const ledger0 = createRewardLedger();

  const first = foldEvents(ledger0, events);
  assert.equal(first.awards.filter((a) => a.type === 'mark-earned').length, 1,
    'the first fold should award the mark');

  // The SAME events array/objects handed to the SAME (now-advanced) ledger again -- the shape a bug
  // that forgot to drain a queue, or a forced double-apply, would actually produce.
  const replay = foldEvents(first.ledger, events);
  assert.equal(replay.awards.filter((a) => a.type === 'mark-earned').length, 0,
    `a replayed batch must award nothing new, got ${JSON.stringify(replay.awards)}`);
});

test('foldEvents never mutates the events array or its objects (purity)', () => {
  const events = Object.freeze([Object.freeze(hit('hero-a', 1)), Object.freeze(defeated('hero-a'))]);
  assert.doesNotThrow(() => foldEvents(createRewardLedger(), events));
});

test('foldEvents accepts an undefined/null ledger as a fresh start', () => {
  const { awards } = foldEvents(undefined, [hit('hero-a', 1), defeated('hero-a')]);
  assert.equal(awards.filter((a) => a.type === 'mark-earned').length, 1);
});

test('an empty events batch folds to no awards and a stable ledger', () => {
  const ledger = createRewardLedger();
  const { awards } = foldEvents(ledger, []);
  assert.deepEqual(awards, []);
});
