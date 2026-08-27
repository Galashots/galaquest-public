// R1's pure fold: rewards/killXp.js. Driven directly against hand-built event arrays, the same
// "no combat, no server, just the fold" style test/rewards-marks.test.mjs already uses for
// rewards/marks.js's own foldEvents -- see that file for the sibling this one mirrors.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createKillXpLedger, foldKillXpEvents } from '../public/src/rewards/killXp.js';
import { killXpForKind } from '../public/src/combat/enemyStats.js';

function defeat({ enemyId, kind, level = 1, heroId }) {
  return { type: 'wolf-defeated', enemyId, kind, level, heroId };
}

function hit({ enemyId, kind, level = 1, heroId }) {
  return { type: 'wolf-hit', enemyId, kind, level, heroId, remaining: 1, damage: 10 };
}

test('a solo kill earns the killing hero the kind\'s own XP amount', () => {
  const { awards } = foldKillXpEvents(createKillXpLedger(), [
    defeat({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'A' }),
  ]);
  assert.equal(awards.length, 1);
  assert.deepEqual(
    { heroId: awards[0].heroId, type: awards[0].type, value: awards[0].value },
    { heroId: 'A', type: 'xp-earned', value: killXpForKind('wolf') },
  );
  assert.equal(awards[0].value, 20);
});

test('every kind prices XP through the same table combat/enemyStats.js owns', () => {
  for (const kind of ['wolf', 'ember-wolf', 'frost-wolf', 'alpha-wolf']) {
    const { awards } = foldKillXpEvents(createKillXpLedger(), [
      defeat({ enemyId: `${kind}-x`, kind, heroId: 'A' }),
    ]);
    assert.equal(awards[0].value, killXpForKind(kind));
    assert.equal(awards[0].kind, kind);
  }
});

test('two contributing heroes killing one enemy both earn the award, same lifeId', () => {
  const { awards } = foldKillXpEvents(createKillXpLedger(), [
    hit({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'A' }),
    hit({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'B' }),
    defeat({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'B' }),
  ]);
  assert.equal(awards.length, 2);
  assert.deepEqual(new Set(awards.map((a) => a.heroId)), new Set(['A', 'B']));
  assert.equal(awards[0].lifeId, awards[1].lifeId, 'both contributors are paid for the SAME life');
  assert.ok(awards.every((a) => a.value === 20));
  // eventIds still differ per hero even though the life is shared -- each hero's own durable row.
  assert.notEqual(awards[0].eventId, awards[1].eventId);
});

test('a hero who never landed a hit earns nothing from someone else\'s solo kill', () => {
  const { awards } = foldKillXpEvents(createKillXpLedger(), [
    hit({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'A' }),
    defeat({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'A' }),
  ]);
  assert.equal(awards.length, 1);
  assert.equal(awards[0].heroId, 'A');
});

test('idempotency under replay: the SAME event objects folded twice earn nothing extra', () => {
  const events = [
    hit({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'A' }),
    defeat({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'A' }),
  ];
  const first = foldKillXpEvents(createKillXpLedger(), events);
  assert.equal(first.awards.length, 1);
  // The SAME array, the SAME ledger threaded forward -- the processedEvents WeakSet must catch this
  // by object identity, the identical guarantee rewards/marks.js's own foldEvents gives against a
  // resend.
  const second = foldKillXpEvents(first.ledger, events);
  assert.equal(second.awards.length, 0, 'replaying the same event objects must mint no new award');
});

test('idempotency under replay: a FRESH array of equal-shaped events is a real new life, not a replay', () => {
  // The WeakSet keys on object IDENTITY, not on deep equality -- a genuinely new kill that happens
  // to look like the last one (same enemyId, same kind) must still be paid. This is the control that
  // proves the identity check is doing real work rather than accidentally deduplicating by content.
  const ledgerAfterFirst = foldKillXpEvents(createKillXpLedger(), [
    defeat({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'A' }),
  ]).ledger;
  const second = foldKillXpEvents(ledgerAfterFirst, [
    defeat({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'A' }),
  ]);
  assert.equal(second.awards.length, 1, 'a genuinely new kill of the respawned wolf-1 must be paid');
});

test('interleaved enemy lives keep independent contributor sets', () => {
  const { awards } = foldKillXpEvents(createKillXpLedger(), [
    hit({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'A' }),
    hit({ enemyId: 'wolf-2', kind: 'wolf', heroId: 'B' }),
    defeat({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'A' }),
    defeat({ enemyId: 'wolf-2', kind: 'wolf', heroId: 'B' }),
  ]);
  assert.equal(awards.length, 2);
  const byEnemy = Object.fromEntries(awards.map((a) => [a.enemyId, a.heroId]));
  assert.deepEqual(byEnemy, { 'wolf-1': 'A', 'wolf-2': 'B' });
});

test('mintLifeId is called once per completed life and threads into every contributor\'s eventId', () => {
  let calls = 0;
  const { awards } = foldKillXpEvents(createKillXpLedger(), [
    hit({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'A' }),
    hit({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'B' }),
    defeat({ enemyId: 'wolf-1', kind: 'wolf', heroId: 'B' }),
  ], { mintLifeId: () => { calls += 1; return `life-${calls}`; } });
  assert.equal(calls, 1);
  assert.ok(awards.every((a) => a.lifeId === 'life-1'));
  assert.ok(awards.every((a) => a.eventId.includes('life-1')));
});

test('an event carrying no heroId (a party-shaped event) contributes no participant', () => {
  const { awards } = foldKillXpEvents(createKillXpLedger(), [
    defeat({ enemyId: 'wolf-1', kind: 'wolf', heroId: null }),
  ]);
  assert.equal(awards.length, 0, 'no heroId means no contributor and therefore no award');
});
