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
import {
  LEGACY_GUEST_ID_KEY,
  MAX_PROFILES,
  createProfileStore,
} from '../public/src/progression/profiles.js';

/** A device, optionally with something already in storage. Injected clock and uuid so what comes
 *  back is a property of the code rather than of the machine the test ran on. */
function freshStore(seed = {}) {
  const memory = new Map(Object.entries(seed));
  let uuid = 0;
  return createProfileStore({
    storage: {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => { memory.set(k, String(v)); },
      removeItem: (k) => { memory.delete(k); },
    },
    randomUUID: () => `0000-0000-0000-${uuid += 1}`,
    now: () => new Date(1_700_000_000_000 + uuid * 1000),
  });
}

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

// ── adopting a hero named in the URL ───────────────────────────────────────────────────────────
//
// `.../?hero=Sam` is Sam's link -- the README's "players join by URL" model applied to a shared
// tablet. These are about the store rather than the gate, but they belong beside it: the link is the
// other way a child gets to their own save, and the way it can go wrong is the same one the gate's
// create path can.

test('a hero named in a link is created, and created only once', () => {
  const store = freshStore();
  const first = store.adoptNamedHero('Sam');
  assert.equal(first.displayName, 'Sam');

  // Following the same link again must select, not mint a second Sam -- four reloads would
  // otherwise fill every slot on the tablet with duplicates.
  const second = store.adoptNamedHero('Sam');
  assert.equal(second.id, first.id, 'the same link is the same hero');
  assert.equal(store.listProfiles().length, 1, `got ${JSON.stringify(store.listProfiles().map((p) => p.displayName))}`);
});

test('a link never asks the gate to name a hero it already named', () => {
  const store = freshStore();
  const adopted = store.adoptNamedHero('Sam');
  assert.equal(
    store.listProfiles().find((p) => p.id === adopted.id).onboarding.named,
    true,
    'a hero who arrived by name has been named',
  );
});

test('MIGRATION BEFORE CREATE: a link must not orphan an existing gq-guest-id save', () => {
  // The defect this pins, found by a harness rather than by a test: a device that has been played on
  // holds a bare gq-guest-id, and every reward row on the server points at that string. Creating a
  // fresh profile for the link left the child on an empty save while their real one sat on the
  // server under an id nothing on the device referenced any more.
  const legacyId = 'p-legacy-1111-2222-3333';
  const store = freshStore({ [LEGACY_GUEST_ID_KEY]: legacyId });

  const adopted = store.adoptNamedHero('Sam');
  assert.equal(adopted.id, legacyId, 'the link names the EXISTING save rather than a new one');
  assert.equal(adopted.displayName, 'Sam', 'and takes the name from the link');
  assert.equal(store.listProfiles().length, 1, 'exactly one hero, not the old one plus a new one');
});

test('a link cannot exceed the tablet cap, and says so by refusing rather than throwing', () => {
  const store = freshStore();
  for (let i = 0; i < MAX_PROFILES; i += 1) store.adoptNamedHero(`Kid${i}`);
  assert.equal(store.listProfiles().length, MAX_PROFILES);

  const refused = store.adoptNamedHero('OneTooMany');
  assert.equal(refused, null, 'a link that cannot be honoured falls back to the ordinary gate');
  assert.equal(store.listProfiles().length, MAX_PROFILES, 'and nothing was displaced to make room');
});

test('an empty or absent name in a link is ignored rather than creating a hero called Hero', () => {
  const store = freshStore();
  assert.equal(store.adoptNamedHero(''), null);
  assert.equal(store.adoptNamedHero('   '), null);
  assert.equal(store.adoptNamedHero(null), null);
  assert.equal(store.listProfiles().length, 0, 'nothing was created by a meaningless link');
});
