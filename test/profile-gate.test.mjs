// The pure half of "who is playing?" -- what the gate decides to show, with no DOM in sight.
//
// The DOM half is proved by tools/runtime-test/drive-profile-gate.mjs against a real browser, the
// same split progression/heroScreen.js and village/boardScreen.js already draw. What is testable
// here is the part that is genuinely a rule rather than a rendering: when a child is ASKED their
// hero's name instead of shown a list, what each card says about how far that hero has got, and
// when the tablet refuses another hero.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { profileGateViewModel, progressBadgeFor } from '../public/src/progression/profileGate.js';
import { MAX_PROFILES } from '../public/src/progression/profiles.js';

test('a hero who has done nothing yet reads as starting, not as zero', () => {
  // "0 Lantern Marks" is a true sentence and a bad one: it tells a child what they have not got.
  assert.equal(progressBadgeFor({ marks: 0, lanternUnlocked: false }), 'Just starting');
  assert.equal(progressBadgeFor({}), 'Just starting');
});

test('the badge counts marks, and says the lantern once it is lit', () => {
  assert.equal(progressBadgeFor({ marks: 1 }), '1 Lantern Mark', 'singular, because one is not "1 Marks"');
  assert.equal(progressBadgeFor({ marks: 2 }), '2 Lantern Marks');
  // The lantern outranks the count: it is the opening's whole payoff, so once it is lit that is the
  // thing a child recognises their own hero by.
  assert.equal(progressBadgeFor({ marks: 3, lanternUnlocked: true }), 'Lantern lit');
});

test('a brand-new device is ASKED a name rather than shown a list of one', () => {
  const view = profileGateViewModel({
    heroes: [{ id: 'p-a', displayName: 'Hero', marks: 0 }],
    activeProfileId: 'p-a',
    namingFirstHero: true,
  });

  assert.equal(view.mode, 'naming');
  assert.match(view.title, /called/i, 'the title has to be the question, not a category');
  assert.equal(view.canCreate, false, 'no second hero before the first one has a name');
  // A list of one is not a choice, and the screen must not offer a way out of a question that has
  // to be answered -- there is no hero to fall back to.
  assert.equal(view.createLabel, null);
});

test('a returning device is shown who is playing', () => {
  const view = profileGateViewModel({
    heroes: [
      { id: 'p-a', displayName: 'Rowan', marks: 2 },
      { id: 'p-b', displayName: 'Sam', marks: 3, lanternUnlocked: true },
    ],
    activeProfileId: 'p-b',
  });

  assert.equal(view.mode, 'choosing');
  assert.deepEqual(view.heroes.map((h) => h.name), ['Rowan', 'Sam']);
  assert.deepEqual(view.heroes.map((h) => h.active), [false, true], 'the current hero is marked');
  assert.deepEqual(view.heroes.map((h) => h.badge), ['2 Lantern Marks', 'Lantern lit']);
  assert.equal(view.canCreate, true);
  assert.equal(view.fullNotice, null);
});

test('two siblings with the same name are still told apart by what they have done', () => {
  // Brothers absolutely do this, and the id -- the thing that actually distinguishes them -- is a
  // 38-character machine string this screen will never show. The badge is what is left.
  const view = profileGateViewModel({
    heroes: [
      { id: 'p-a', displayName: 'Sam', marks: 0 },
      { id: 'p-b', displayName: 'Sam', marks: 3, lanternUnlocked: true },
    ],
    activeProfileId: 'p-a',
  });

  assert.deepEqual(view.heroes.map((h) => h.name), ['Sam', 'Sam']);
  assert.notEqual(view.heroes[0].badge, view.heroes[1].badge, 'the cards must not be identical');
  assert.notEqual(view.heroes[0].id, view.heroes[1].id, 'and the id behind them is still distinct');
});

test('a full tablet says so in words instead of showing a dead button', () => {
  const heroes = Array.from({ length: MAX_PROFILES }, (_, i) => ({
    id: `p-${i}`, displayName: `Hero ${i}`, marks: 0,
  }));
  const view = profileGateViewModel({ heroes, activeProfileId: 'p-0' });

  assert.equal(view.canCreate, false, 'no button rather than a disabled one');
  assert.match(view.fullNotice, /Remove one/i, 'and a sentence saying what to do about it');
  assert.match(view.fullNotice, new RegExp(String(MAX_PROFILES)));
});

test('one under the cap still offers a new hero', () => {
  const heroes = Array.from({ length: MAX_PROFILES - 1 }, (_, i) => ({
    id: `p-${i}`, displayName: `Hero ${i}`, marks: 0,
  }));
  const view = profileGateViewModel({ heroes, activeProfileId: 'p-0' });
  assert.equal(view.canCreate, true);
  assert.equal(view.fullNotice, null, 'and says nothing about being full, because it is not');
});

test('a blank or hostile display name is resolved before it reaches the screen', () => {
  const view = profileGateViewModel({
    heroes: [
      { id: 'p-a', displayName: '   ', marks: 0 },
      { id: 'p-b', displayName: 'A'.repeat(40), marks: 0 },
    ],
    activeProfileId: 'p-a',
  });

  assert.equal(view.heroes[0].name, 'Hero', 'a blank name is replaced, not rendered as an empty card');
  assert.ok(view.heroes[1].name.length <= 16, `an overlong name is capped, got ${view.heroes[1].name.length}`);
});

test('no profiles at all still produces a usable screen rather than throwing', () => {
  // Reachable: a child removes the last hero. The screen has to keep working, and the honest thing
  // for it to offer is a new one.
  const view = profileGateViewModel({});
  assert.deepEqual(view.heroes, []);
  assert.equal(view.canCreate, true);
});
