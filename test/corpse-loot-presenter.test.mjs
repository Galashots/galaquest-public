// public/src/world/corpseLootPresenter.js -- the client-side read of the server's own corpse-loot
// law. Pure, hand-built fixtures shaped exactly like net/protocolCore.js's own decodeCorpses output
// (test/corpse-loot-wire.test.mjs is the authority for that shape), so this file is provable in plain
// node with no server, no wire, no DOM -- the same split test/unlock-card.test.mjs documents for its
// own viewmodel half.
//
// LOAD-BEARING BEHAVIOUR under test: per-player corpse visibility (glow), individual-item isolation,
// and cross-player isolation at the PRESENTER layer -- the server already enforces isolation for
// collection (test/corpse-loot.test.mjs); this proves the client never even RENDERS a sibling's claim.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  CORPSE_LOOT_INTERACT_RADIUS_METERS,
  claimFor,
  corpseLootPanelViewModel,
  corpsesToGlowFor,
  hasUnclaimedLoot,
  nearestLootableCorpse,
  dismissLootPanelForCombat,
  newlyTakenItems,
  panelItemsFor,
} from '../public/src/world/corpseLootPresenter.js';
import { SHOULDER_SILVERGUARD_ID, itemDef } from '../public/src/progression/items.js';

/** A wire-shaped corpse, built directly -- the same shape decodeCorpses hands the client
 *  (id, x, z, claims: [{ heroId, items: [{ id, kind, itemId, guaranteed, taken }] }]). */
function corpse({ id = 'corpse:wolf-1:life-1', x = 10, z = 20, claims = [] } = {}) {
  return { id, x, z, claims };
}
function item({
  id, itemId = 'shoulder_silverguard', kind = 'gear', guaranteed = false, taken = false,
} = {}) {
  return { id, itemId, kind, guaranteed, taken };
}
function claim(heroId, items) {
  return { heroId, items };
}

test('claimFor returns only the named hero\'s own claim, never a sibling\'s', () => {
  const c = corpse({
    claims: [
      claim('a', [item({ id: 'i-a' })]),
      claim('b', [item({ id: 'i-b' })]),
    ],
  });
  assert.equal(claimFor(c, 'a').heroId, 'a');
  assert.equal(claimFor(c, 'a').items[0].id, 'i-a');
  assert.equal(claimFor(c, 'b').items[0].id, 'i-b');
  assert.equal(claimFor(c, 'nobody'), null, 'a hero with no claim on this corpse gets null, not an empty guess');
});

test('a hero glows only for their own unresolved claim, not a sibling\'s', () => {
  const c = corpse({
    claims: [
      claim('a', [item({ id: 'i-a', taken: false })]),
      claim('b', [item({ id: 'i-b', taken: true })]),
    ],
  });
  assert.equal(hasUnclaimedLoot(c, 'a'), true);
  assert.equal(hasUnclaimedLoot(c, 'b'), false, 'b already took everything on their own claim');
  assert.equal(hasUnclaimedLoot(c, 'stranger'), false, 'a hero with no claim at all must never glow');
});

test('#87: collecting stops the glow for the collector even while a sibling\'s claim on the SAME corpse still stands', () => {
  const c = corpse({
    claims: [
      claim('a', [item({ id: 'i-a', taken: true })]),
      claim('b', [item({ id: 'i-b', taken: false })]),
    ],
  });
  assert.deepEqual(corpsesToGlowFor('a', [c]), [], 'a looted their own claim -- must stop glowing for a');
  assert.deepEqual(corpsesToGlowFor('b', [c]), [c], 'b has not looted yet -- must still glow for b');
});

test('nearestLootableCorpse picks the nearest corpse this hero can actually loot, within radius', () => {
  const near = corpse({ id: 'near', x: 0, z: 0, claims: [claim('a', [item({ id: 'i-near' })])] });
  const far = corpse({ id: 'far', x: 0, z: 100, claims: [claim('a', [item({ id: 'i-far' })])] });
  const best = nearestLootableCorpse('a', [far, near], { x: 0, z: 0 });
  assert.equal(best.id, 'near');
});

test('nearestLootableCorpse ignores a corpse out of interact range', () => {
  const outOfRange = corpse({
    id: 'far', x: 0, z: CORPSE_LOOT_INTERACT_RADIUS_METERS + 5,
    claims: [claim('a', [item({ id: 'i-far' })])],
  });
  assert.equal(nearestLootableCorpse('a', [outOfRange], { x: 0, z: 0 }), null);
});

test('nearestLootableCorpse ignores a corpse this hero already fully looted', () => {
  const done = corpse({ id: 'done', x: 0, z: 0, claims: [claim('a', [item({ id: 'i', taken: true })])] });
  assert.equal(nearestLootableCorpse('a', [done], { x: 0, z: 0 }), null);
});

test('nearestLootableCorpse never returns a corpse this hero holds no claim on at all, even standing on it', () => {
  const siblingsOnly = corpse({ id: 'siblings-only', x: 0, z: 0, claims: [claim('b', [item({ id: 'i-b' })])] });
  assert.equal(nearestLootableCorpse('a', [siblingsOnly], { x: 0, z: 0 }), null,
    'a has no claim here -- the prompt must not offer to open a sibling\'s corpse');
});

test('panelItemsFor returns only this hero\'s own items, and an empty list (never a sibling\'s) when they hold no claim', () => {
  const c = corpse({
    claims: [
      claim('a', [item({ id: 'i-a-1' }), item({ id: 'i-a-2' })]),
      claim('b', [item({ id: 'i-b' })]),
    ],
  });
  const itemsForA = panelItemsFor(c, 'a');
  assert.deepEqual(itemsForA.map((i) => i.id), ['i-a-1', 'i-a-2']);
  assert.deepEqual(panelItemsFor(c, 'stranger'), []);
});

test('newlyTakenItems reports exactly the item(s) that flipped taken this frame, once', () => {
  const before = [corpse({ claims: [claim('a', [item({ id: 'i-1', taken: false }), item({ id: 'i-2', taken: false })])] })];
  const after = [corpse({ claims: [claim('a', [item({ id: 'i-1', taken: true }), item({ id: 'i-2', taken: false })])] })];
  const arrivals = newlyTakenItems(before, after, 'a');
  assert.equal(arrivals.length, 1);
  assert.equal(arrivals[0].id, 'i-1');
});

test('newlyTakenItems never reports an item already taken last frame (no repeat toast on a steady snapshot)', () => {
  const state = [corpse({ claims: [claim('a', [item({ id: 'i-1', taken: true })])] })];
  assert.deepEqual(newlyTakenItems(state, state, 'a'), []);
});

test('sabotage: newlyTakenItems for hero B must never report hero A\'s own item flipping taken', () => {
  const before = [corpse({
    claims: [claim('a', [item({ id: 'i-a', taken: false })]), claim('b', [item({ id: 'i-b', taken: false })])],
  })];
  const after = [corpse({
    claims: [claim('a', [item({ id: 'i-a', taken: true })]), claim('b', [item({ id: 'i-b', taken: false })])],
  })];
  assert.deepEqual(newlyTakenItems(before, after, 'b'), [], 'A\'s own collect must never toast for B');
  assert.equal(newlyTakenItems(before, after, 'a').length, 1);
});

test('newlyTakenItems suppresses arrivals with no previous snapshot at all (before this hero\'s first welcome)', () => {
  const after = [corpse({ claims: [claim('a', [item({ id: 'i-1', taken: true })])] })];
  assert.deepEqual(newlyTakenItems(undefined, after, 'a'), [],
    'no baseline to diff against yet -- must not retroactively toast an already-taken item on first contact');
  assert.deepEqual(newlyTakenItems(null, after, 'a'), []);
});

test('newlyTakenItems treats a known-EMPTY previous snapshot ([]) as a real baseline, not a missing one', () => {
  const after = [corpse({ claims: [claim('a', [item({ id: 'i-1', taken: true })])] })];
  assert.equal(newlyTakenItems([], after, 'a').length, 1,
    'no corpse existed for this hero last frame and one exists now, already resolved -- that IS a fresh pickup');
});

test('corpseLootPanelViewModel reads the item\'s real name off progression/items.js, never restates it', () => {
  const c = corpse({
    claims: [claim('a', [item({ id: 'i-a', itemId: SHOULDER_SILVERGUARD_ID, guaranteed: false, taken: false })])],
  });
  const rows = corpseLootPanelViewModel(c, 'a');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, itemDef(SHOULDER_SILVERGUARD_ID).name);
  assert.equal(rows[0].id, 'i-a');
  assert.equal(rows[0].itemId, SHOULDER_SILVERGUARD_ID);
  assert.equal(rows[0].taken, false);
  assert.equal(typeof rows[0].icon, 'string');
  assert.ok(rows[0].icon.length > 0, 'every row needs SOME icon glyph, even a generic one');
});

test('corpseLootPanelViewModel never leaks a sibling\'s row, and is empty for a hero with no claim', () => {
  const c = corpse({
    claims: [
      claim('a', [item({ id: 'i-a', itemId: SHOULDER_SILVERGUARD_ID })]),
      claim('b', [item({ id: 'i-b', itemId: SHOULDER_SILVERGUARD_ID })]),
    ],
  });
  assert.deepEqual(corpseLootPanelViewModel(c, 'a').map((r) => r.id), ['i-a']);
  assert.deepEqual(corpseLootPanelViewModel(c, 'stranger'), []);
});

test('corpseLootPanelViewModel falls back to a generic name/icon for an unknown itemId rather than crashing', () => {
  const c = corpse({ claims: [claim('a', [item({ id: 'i-a', itemId: 'not-a-real-item' })])] });
  const rows = corpseLootPanelViewModel(c, 'a');
  assert.equal(rows.length, 1);
  assert.equal(typeof rows[0].name, 'string');
  assert.ok(rows[0].name.length > 0);
});

// ── #87 combat pre-emption: a modal that freezes the hero must surrender when the fight reaches him.
//
// Measured at 946857f, hosted: the loot panel is a modal whose full-screen backdrop owns every touch
// point including the movement stick, so while it is open the hero can neither walk nor swing.
// wolf-1 respawns 10s after death at its authored home -- which is where its corpse is -- and bites
// 10 into 30 HP every 2.6s. A hero who opened the panel on hp 20 had about 2.6 seconds: he collected
// the first item correctly and was dead before the second round trip finished, then reseated at
// HERO_SPAWN where every further TAKE was refused on reach, silently.
//
// This is the same law progression/runeChests.js's own heroInCombat already states for the question
// card ("a child who backs over a chest while a wolf is on them gets a maths question over a frozen
// hero and keeps taking bites they can no longer answer"). The PRINCIPLE is reused; the helper is
// deliberately NOT, because that one is a proximity/mode gate on OPENING and this is a damage gate on
// STAYING OPEN. Closing on mere proximity would make this corpse permanently unlootable, since the
// wolf respawns on top of it forever.
test('an open loot panel surrenders the moment this hero takes damage', () => {
  assert.equal(dismissLootPanelForCombat({ hp: 30, downSeconds: -1 }, { hp: 20, downSeconds: -1 }), true);
});

test('an open loot panel surrenders when this hero goes down, even without a fresh damage tick', () => {
  assert.equal(dismissLootPanelForCombat({ hp: 10, downSeconds: -1 }, { hp: 10, downSeconds: 0 }), true);
  assert.equal(dismissLootPanelForCombat(null, { hp: 0, downSeconds: 1.4 }), true);
});

test('reading loot in peace is never interrupted', () => {
  assert.equal(dismissLootPanelForCombat({ hp: 30, downSeconds: -1 }, { hp: 30, downSeconds: -1 }), false);
  assert.equal(dismissLootPanelForCombat({ hp: 20, downSeconds: -1 }, { hp: 30, downSeconds: -1 }), false,
    'a heart pickup RAISES hp and must not read as damage');
});

// The respawn that ends a knockdown restores full HP. Read as a diff alone that is a RISE, so it can
// never be mistaken for damage -- but the frame it lands on must also not re-trigger on downSeconds,
// which encounter.js sets back to -1 in the same step.
test('respawning is not damage and does not re-fire the dismissal', () => {
  assert.equal(dismissLootPanelForCombat({ hp: 0, downSeconds: 1.9 }, { hp: 30, downSeconds: -1 }), false);
});

test('a missing or partial hero view is never a dismissal', () => {
  assert.equal(dismissLootPanelForCombat({ hp: 30, downSeconds: -1 }, null), false);
  assert.equal(dismissLootPanelForCombat(null, { hp: 30, downSeconds: -1 }), false,
    'no baseline yet (first frame, or a fresh heroId after reconnect) cannot prove damage');
  assert.equal(dismissLootPanelForCombat({ hp: undefined }, { hp: 20, downSeconds: -1 }), false);
  assert.equal(dismissLootPanelForCombat({ hp: 30, downSeconds: -1 }, { hp: undefined, downSeconds: -1 }), false);
});
