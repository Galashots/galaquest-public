// Two tabs of this game on one device can delete each other's child.
//
// FOUND FROM A HARNESS FAILURE THAT SAID SOMETHING ELSE. `drive-two-clients` was failing hosted with
// "tab A is the same child after the reload, not a fresh one", and I published the wrong cause for
// it twice -- first a per-tab storage wipe, then a same-name profile collision. Both were real
// faults in the harness and neither was this. The durability line added to that harness is what
// settled it: `gq-profiles held p-5714ab7e-… before the reload: FALSE`. The row was not lost across
// the reload. It was never written.
//
// THE MECHANISM IS A LOST UPDATE, and it is structural rather than racy in any subtle way.
// progression/profiles.js reads the keyring ONCE, at module init (`let keyring = readKeyring(...)`),
// and every persist() writes that whole in-memory snapshot back. So:
//
//   tab A inits, reads []           tab B inits, reads []
//   tab A creates Ada  -> writes [Ada]
//                                   tab B creates Bo   -> writes [Bo]      <- Ada is gone
//
// Nothing throws, nothing warns, and tab A carries on with a perfectly usable in-memory id that no
// longer exists on the device. It finds that out on the next reload, as somebody else, with every
// reward the server granted the old id orphaned behind it.
//
// WHY THIS IS NOT A HARNESS PROBLEM. "Two children on one device" is the case the profile system
// exists for -- the Director's own seam 2 is about telling two siblings' saves apart on the chooser.
// A second tab is an ordinary thing for a child to end up with: a sibling opening the game while the
// first is still up, a stray tab from yesterday, a tap on a link. The device holds one localStorage
// whichever way it happens, and today the last tab to write wins the whole keyring.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { PROFILES_STORAGE_KEY, createProfileStore } from '../public/src/progression/profiles.js';

/** One device's storage, shared by every tab on it -- which is exactly what localStorage is. */
function deviceStorage() {
  const cells = new Map();
  return {
    getItem: (key) => (cells.has(key) ? cells.get(key) : null),
    setItem: (key, value) => { cells.set(key, String(value)); },
    removeItem: (key) => { cells.delete(key); },
  };
}

/** Ids a human can read in a failure message, so a diff of two keyrings is legible. */
function idsFrom(storage) {
  const raw = storage.getItem(PROFILES_STORAGE_KEY);
  if (raw === null) return null;
  return JSON.parse(raw).profiles.map((profile) => profile.displayName);
}

// UUID-SHAPED, and that shape matters. A profile id is sanitized by the guest-id rule, so a short
// stand-in like `a-1` is rejected and mintProfileId falls through to its no-crypto path -- which
// derives the id from `keyring.profiles.length`, so two fresh tabs both mint `p-local-1-1` and the
// scenario quietly becomes one profile written twice. The first draft of this file did exactly that
// and one assertion passed vacuously against two identical ids. Hex characters only, and the tab's
// own letter throughout, so a failure message names which tab lost.
function tab(storage, hexLetter) {
  let n = 0;
  return createProfileStore({
    storage,
    randomUUID: () => {
      n += 1;
      const c = hexLetter;
      return `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${String(n).padStart(12, '0')}`;
    },
  });
}

test('a second tab does not delete the first tab\'s child', () => {
  const device = deviceStorage();
  // Both tabs open before either has created anybody -- the ordinary case, because a child opens the
  // second tab while the first is already sitting there.
  const tabA = tab(device, 'a');
  const tabB = tab(device, 'b');

  tabA.createProfile('Ada');
  tabB.createProfile('Bo');

  assert.deepEqual(idsFrom(device), ['Ada', 'Bo'],
    'the device holds two children; the second tab must not overwrite the keyring with its own view');
});

test('the surviving profile keeps its rewards identity, not just its name', () => {
  const device = deviceStorage();
  const tabA = tab(device, 'a');
  const tabB = tab(device, 'b');

  const ada = tabA.createProfile('Ada');
  tabB.createProfile('Bo');

  const stored = JSON.parse(device.getItem(PROFILES_STORAGE_KEY));
  assert.ok(stored.profiles.some((profile) => profile.id === ada.id),
    `Ada's id ${ada.id} must still be on the device -- every reward the server granted points at it`);
});

test('the tab that wrote last is still the active one, so nobody is switched mid-play', () => {
  const device = deviceStorage();
  const tabA = tab(device, 'a');
  const tabB = tab(device, 'b');

  tabA.createProfile('Ada');
  const bo = tabB.createProfile('Bo');

  const stored = JSON.parse(device.getItem(PROFILES_STORAGE_KEY));
  assert.equal(stored.activeProfileId, bo.id,
    'merging must not resurrect an older active pointer over the child who is actually playing');
});

// The other order, because a fix that only works when the later tab is the one that creates is a fix
// that works on the example rather than on the problem.
test('it holds when the FIRST tab creates second', () => {
  const device = deviceStorage();
  const tabA = tab(device, 'a');
  const tabB = tab(device, 'b');

  tabB.createProfile('Bo');
  tabA.createProfile('Ada');

  assert.deepEqual(idsFrom(device), ['Bo', 'Ada']);
});

// And a third, because two is the case I happened to measure and not a law.
test('three tabs, three children, none lost', () => {
  const device = deviceStorage();
  const tabs = ['a', 'b', 'c'].map((prefix) => tab(device, prefix));
  tabs[0].createProfile('Ada');
  tabs[1].createProfile('Bo');
  tabs[2].createProfile('Cy');

  assert.deepEqual(idsFrom(device), ['Ada', 'Bo', 'Cy']);
});

test('sabotage: one tab alone is unaffected, so the merge is not inventing profiles', () => {
  const device = deviceStorage();
  const only = tab(device, 'a');
  only.createProfile('Ada');
  only.createProfile('Bo');

  assert.deepEqual(idsFrom(device), ['Ada', 'Bo'],
    'one tab creating two children must still produce exactly those two');
});

// ── TWO CASES THIS FIX DOES NOT CLOSE, written down rather than left to be rediscovered ─────────
//
// Both are SKIPPED because they describe behaviour that does not hold yet. Both were verified to
// fail against the code as it stood BEFORE the merge as well, by restoring that file and running
// them: the merge does not cause either, and does not make either worse. They are the next pass.
//
// What they need is device-level state the current design has nowhere to put. `deletedHere` lives
// in one tab's memory, so a delete is honoured by the tab that made it and invisible to every other
// tab still holding a stale snapshot. Closing them properly wants a tombstone in the stored keyring
// (so any tab's merge honours a delete) plus per-id dirty tracking (so a tab only carries forward
// profiles it has actually touched, and takes the rest from the device). That is a schema change
// and a touch at every mutation site, which is its own commit and its own argument, not a tail-end
// addition to this one.
//
// A delete has to STICK. Union-by-id resurrects a child this tab deliberately removed the moment
// any other tab writes its own older snapshot back -- and deleting a profile also deletes its
// journal, so what comes back is a name with no earnings behind it.
test.skip('deleting a child here is not undone by another tab writing later', () => {
  const device = deviceStorage();
  const tabA = tab(device, 'a');
  const ada = tabA.createProfile('Ada');
  tabA.createProfile('Cy');

  // Tab B opens now, so its snapshot still contains Ada.
  const tabB = tab(device, 'b');
  assert.deepEqual(idsFrom(device), ['Ada', 'Cy'], 'precondition: both are on the device');

  tabA.deleteProfile(ada.id);
  assert.deepEqual(idsFrom(device), ['Cy'], 'the delete lands');

  tabB.createProfile('Bo');
  assert.deepEqual(idsFrom(device), ['Cy', 'Bo'],
    'tab B carried a stale Ada in its snapshot; a merge must not bring a deleted child back');
});

// A profile touched in both tabs should keep the more recent view rather than whichever wrote last,
// so a rename in the tab a child is actually playing in is not undone by a background tab's stale
// copy. The merge compares lastPlayedAt, which renameProfile does not currently touch -- so the two
// copies tie and the stale one can win. Same pre-existing status as the case above.
test.skip('a profile edited in both tabs keeps the copy that was played more recently', () => {
  const device = deviceStorage();
  const tabA = tab(device, 'a');
  const ada = tabA.createProfile('Ada');

  const tabB = tab(device, 'b');            // B's snapshot holds Ada as she is now
  tabA.renameProfile(ada.id, 'Adelaide');   // A renames her and touches lastPlayedAt
  tabB.createProfile('Bo');                 // B writes, carrying its older Ada

  const stored = JSON.parse(device.getItem(PROFILES_STORAGE_KEY));
  const kept = stored.profiles.find((profile) => profile.id === ada.id);
  assert.equal(kept.displayName, 'Adelaide',
    'the stale copy must not overwrite the name the child is actually using');
});
