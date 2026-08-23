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
  HERO_AVATARS, avatarForProfile, chooseAvatarId, fallbackAvatarIdFor,
} from '../public/src/progression/heroAvatars.js';
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

// THE NAMING SCREEN IS THE FIRST THING A CHILD EVER SEES, AND IT HAD NOTHING ON IT FOR THEM.
//
// Captured on a fresh tablet at 768x1024: a sentence, an empty text box with a grey word in it, and
// a button reading START. Every one of those is a shape a four-year-old cannot decode, and the
// screen this file's own header says is for "a child who cannot reliably read" therefore asked them
// to type. The chooser earned its animals; the screen before it had none, because `heroes: []` is
// right about CARDS and was silently also right about pictures.
//
// So the naming view carries the animal this hero HAS OR IS ABOUT TO GET. Not a choice -- choosing
// is a product decision and not mine -- just the cue, so a child looking at their first screen sees
// who they are going to be.
//
// It comes from the same law that assigns it, never a second copy: `chooseAvatarId` is exactly what
// createProfile calls, given exactly the animals already spoken for. A preview computed any other
// way would be a promise the create path is free to break.
test('the naming screen shows the animal this hero is about to be', () => {
  const view = profileGateViewModel({ heroes: [], namingFirstHero: true });
  assert.ok(view.avatar, 'a screen with no cards and no reader still has to show the child something');
  assert.equal(view.avatar.id, chooseAvatarId([]),
    'the preview has to be what createProfile would actually hand out, not a second guess at it');
  assert.ok(view.avatar.emoji, 'and it has to be the picture, not just the id');
});

test('renaming an existing hero shows THAT hero\'s animal, not the next free one', () => {
  // Naming is also how a hero already on the tablet gets renamed. Showing the next unclaimed animal
  // there would tell a child their fox had become an owl because they changed their name.
  const rowan = { id: 'p-a', displayName: 'Rowan', avatar: 'owl', marks: 1 };
  const view = profileGateViewModel({
    heroes: [rowan], activeProfileId: 'p-a', namingFirstHero: true,
  });
  assert.equal(view.namingProfileId, 'p-a', 'premise: this is a rename, not a create');
  assert.equal(view.avatar.id, 'owl', 'a child keeps their animal through a rename');
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

test('the naming screen still knows where the typed name goes when there is a hero', () => {
  const view = profileGateViewModel({
    heroes: [{ id: 'p-a', displayName: 'Hero', marks: 0 }],
    activeProfileId: 'p-a',
    namingFirstHero: true,
  });
  assert.equal(view.namingProfileId, 'p-a', 'the name belongs to the hero that already exists');
});

test('...and reports having nowhere to put it when there is not', () => {
  // The DOM half turns this null into a CREATE rather than a no-op. Asserted here because the
  // alternative is a screen with one button that does nothing, which is the worst failure a screen
  // with one button can have -- and because `?? null` is easy to read as "cannot happen".
  const view = profileGateViewModel({ heroes: [], namingFirstHero: true });
  assert.equal(view.namingProfileId, null);
  assert.equal(view.mode, 'naming', 'it is still the question, not the chooser');
});

// ── the animal on the card ─────────────────────────────────────────────────────────────────────
//
// For the reader this screen is built for, the animal is the whole card: the name is a shape they
// cannot decode and the badge is a sentence. So "which animal does this card show" is not a detail,
// it is the feature.

/** A profile id whose id-derived fallback is deliberately NOT the animal we store on it. */
function idWhoseFallbackIsNot(avatarId) {
  for (let i = 0; i < 200; i += 1) {
    const id = `p-fixture-${i}`;
    if (fallbackAvatarIdFor(id) !== avatarId) return id;
  }
  throw new Error('could not find a fixture id whose fallback differs; the fallback may be constant');
}

test('a card shows the animal the profile has STORED, not one derived from its id', () => {
  // THE CASE THAT WAS MISSING, and the bug it would have caught was real and shipped: main.js built
  // each card's hero from a handful of named fields and did not carry `avatar` across, so every card
  // fell through to the id-derived fallback and the stored value was written and never read.
  //
  // The fixture id is chosen so the two answers DIFFER. Picking any id would pass one time in six by
  // coincidence, which is exactly how the browser check that was supposed to catch this passed four
  // runs in a row while the defect was live.
  const stored = HERO_AVATARS[3].id;
  const id = idWhoseFallbackIsNot(stored);
  assert.notEqual(fallbackAvatarIdFor(id), stored, 'premise: the fixture actually distinguishes the two');

  const view = profileGateViewModel({
    heroes: [{ id, displayName: 'Sam', avatar: stored }],
    activeProfileId: id,
  });
  assert.equal(view.heroes[0].avatar.id, stored,
    `card showed ${view.heroes[0].avatar.id}, which is what this profile's ID says rather than what it HAS`);
});

test('a profile with nothing stored still gets a stable animal rather than none', () => {
  // Legacy profiles predate the field. They must still have a face, and the same one every time.
  const id = 'guest-00000004';
  const view = profileGateViewModel({ heroes: [{ id, displayName: 'Older', avatar: null }] });
  assert.equal(view.heroes[0].avatar.id, fallbackAvatarIdFor(id));
  const again = profileGateViewModel({ heroes: [{ id, displayName: 'Older', avatar: null }] });
  assert.equal(again.heroes[0].avatar.id, view.heroes[0].avatar.id, 'and it does not move between renders');
});

test('the card agrees with the shared law, so allocation and drawing cannot disagree', () => {
  // The property that makes the allocator's work mean anything: createProfile chooses against
  // avatarForProfile(existing).id, so the card must render through the same function. Two answers to
  // "what animal is this child" is the whole failure mode -- one used to pick and a different one
  // used to draw is a chooser avoiding collisions nobody can see.
  const heroes = [
    { id: 'guest-00000004', displayName: 'Older', avatar: null },
    { id: 'p-abc', displayName: 'Sibling', avatar: HERO_AVATARS[1].id },
    { id: 'p-def', displayName: 'Third', avatar: HERO_AVATARS[4].id },
  ];
  const view = profileGateViewModel({ heroes });
  assert.deepEqual(
    view.heroes.map((card) => card.avatar.id),
    heroes.map((hero) => avatarForProfile(hero).id),
  );
});

test('every card carries an animal with something to draw and something to announce', () => {
  // A card whose avatar has no emoji is a blank square, and one with no name has nothing for a
  // screen reader or for a harness to read back.
  const view = profileGateViewModel({
    heroes: HERO_AVATARS.map((a, i) => ({ id: `p-${i}`, displayName: `Kid${i}`, avatar: a.id })),
  });
  for (const card of view.heroes) {
    assert.ok(card.avatar.emoji && card.avatar.emoji.length > 0, `${card.name} has no face to draw`);
    assert.ok(card.avatar.name && card.avatar.name.length > 0, `${card.name}'s animal has no name`);
    assert.ok(card.avatar.colour, `${card.name}'s animal has no colour`);
  }
});

test('the row that offers a NEW hero shows one, rather than being the only row with no animal', () => {
  // Found by opening a capture of the chooser and reading it as a child who cannot read: four cards
  // each led with a face, and the one row offering something new led with the words "New hero" and
  // nothing else. That is the same gap the naming screen had before it was given a face -- fixed
  // there and missed one row below it, on the same screen, in the same session.
  const heroes = [{ id: 'p-a', displayName: 'Rowan', avatar: HERO_AVATARS[0].id }];
  const view = profileGateViewModel({ heroes, activeProfileId: 'p-a' });

  assert.ok(view.canCreate, 'premise: one hero on a multi-hero tablet can still add another');
  assert.ok(view.createAvatar, 'the add row has no animal to draw, so a child sees words or nothing');
  assert.ok(view.createAvatar.emoji, 'and it has to be the picture, not just the id');
});

test('the animal offered on the add row is the one a new hero would actually be given', () => {
  // The whole value of the cue is that it is a PROMISE. A child taps the owl because it is an owl;
  // handing them a whale would make the only part of that screen they can read the wrong part.
  // Same law as the card test above: one function decides, and both readers call it.
  const heroes = [
    { id: 'p-a', displayName: 'Rowan', avatar: HERO_AVATARS[0].id },
    { id: 'p-b', displayName: 'Sam', avatar: HERO_AVATARS[1].id },
  ];
  const view = profileGateViewModel({ heroes, activeProfileId: 'p-a' });
  const taken = heroes.map((hero) => avatarForProfile(hero).id);

  assert.equal(view.createAvatar.id, chooseAvatarId(taken),
    'the add row is previewing an animal the create path is free to disagree with');
  assert.ok(!taken.includes(view.createAvatar.id),
    `offered ${view.createAvatar.id}, which one of these heroes already has`);
});

test('a full tablet offers no animal, because it offers no new hero', () => {
  // The sentinel case: canCreate false must not leave a face pointing at a row that is not drawn.
  const heroes = HERO_AVATARS.slice(0, 4).map((avatar, index) => ({
    id: `p-${index}`, displayName: `Kid${index}`, avatar: avatar.id,
  }));
  const view = profileGateViewModel({ heroes, activeProfileId: 'p-0', maxProfiles: 4 });

  assert.equal(view.canCreate, false, 'premise: four heroes fill this tablet');
  assert.equal(view.createAvatar, null, 'a tablet with no room still offered a face for a fifth hero');
});
