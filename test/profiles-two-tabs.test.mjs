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

// ── the two cases the first version of the merge could not close ────────────────────────────────
//
// Both were skipped here for a commit, with the mechanism written down, and both are live now: the
// stored keyring carries a bounded tombstone list so any tab's merge honours a delete, and per-id
// dirty tracking decides conflicts instead of a timestamp most mutations never touch.
//
// A delete has to STICK. Union-by-id resurrects a child this tab deliberately removed the moment
// any other tab writes its own older snapshot back -- and deleting a profile also deletes its
// journal, so what comes back is a name with no earnings behind it.
test('deleting a child here is not undone by another tab writing later', () => {
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

// A rename in the tab a child is actually playing in must not be undone by a background tab's stale
// copy. This is why the conflict rule is "did THIS tab touch it" and not "which lastPlayedAt is
// later": renameProfile does not move that timestamp, so the two copies tie and a timestamp rule
// decides by arrival order, which is exactly the thing being fixed.
test('a profile renamed here is not undone by another tab writing later', () => {
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
  assert.equal(stored.profiles.length, 2, 'and Bo still arrived: a merge, not a last-writer-wins');
});

// The other direction, which is what the tombstone is actually for: a tab that was already open
// when the delete happened must stop showing the child, not just refrain from resurrecting them.
test('a delete reaches a tab that was already open', () => {
  const device = deviceStorage();
  const tabA = tab(device, 'a');
  const ada = tabA.createProfile('Ada');
  tabA.createProfile('Cy');

  const tabB = tab(device, 'b');                 // B's snapshot holds Ada
  assert.ok(tabB.listProfiles().some((p) => p.id === ada.id), 'precondition: B can see Ada');

  tabA.deleteProfile(ada.id);
  tabB.createProfile('Bo');                      // B's next write merges against the device

  assert.deepEqual(idsFrom(device), ['Cy', 'Bo'],
    'B must adopt the deletion rather than write its stale copy of Ada back');
});

// Tombstones are written to a child's device on every save, so they are a small ring and not a
// growing ledger. A tombstone only has to outlive the tabs that were open when the delete happened.
test('the tombstone list is bounded', () => {
  const device = deviceStorage();
  const only = tab(device, 'a');
  for (let n = 0; n < 40; n += 1) {
    const made = only.createProfile(`H${n}`);
    only.deleteProfile(made.id);
  }
  const stored = JSON.parse(device.getItem(PROFILES_STORAGE_KEY));
  assert.ok(stored.deleted.length <= 24, `tombstones grew to ${stored.deleted.length}`);
  assert.deepEqual(stored.profiles, [], 'and every one of them really is gone');
});

// A tombstone list is a way to make profiles disappear, so a corrupt or hostile blob must not be
// able to hide a child's save by naming it. Same posture readKeyring already takes to the profile
// array itself: sanitize, dedupe, cap -- never trust the shape on disk.
test('a corrupt tombstone list cannot hide every child on the device', () => {
  const device = deviceStorage();
  const first = tab(device, 'a');
  const ada = first.createProfile('Ada');

  const poisoned = JSON.parse(device.getItem(PROFILES_STORAGE_KEY));
  poisoned.deleted = [null, 42, {}, 'x'.repeat(500), ...Array.from({ length: 200 }, (_, n) => `p-junk-${n}`)];
  device.setItem(PROFILES_STORAGE_KEY, JSON.stringify(poisoned));

  const reopened = tab(device, 'b');
  assert.ok(reopened.listProfiles().some((p) => p.id === ada.id),
    'Ada is not in that list and must still be here');

  // The cap applies when the blob is READ and when one is WRITTEN -- it does not reach back and
  // rewrite something sitting on disk that nobody has saved over. So make this tab save before
  // asking what is stored. The first version of this assertion checked immediately after a read and
  // failed against correct code, which is the test being wrong rather than the guard being missing.
  reopened.createProfile('Bo');
  const stored = JSON.parse(device.getItem(PROFILES_STORAGE_KEY));
  assert.ok((stored.deleted?.length ?? 0) <= 24,
    `the junk must be capped once written through, got ${stored.deleted?.length}`);
  assert.ok(stored.profiles.some((profile) => profile.id === ada.id),
    'and Ada survives the round trip, not just the read');
});

// ── the no-crypto id path, which the tombstones made dangerous ───────────────────────────────────
//
// mintProfileId falls back to `p-local-<profiles.length + n>-<counter>` when crypto.randomUUID is
// unavailable, and that counter restarts every session -- so the same id comes back after a reload
// BY CONSTRUCTION. Once deletes leave tombstones on the device, a reused id means the merge deletes
// the new child at birth: they tap GO and get nothing, with no error anywhere.
//
// Reachable only without crypto, which is why no harness would ever have found it -- every real
// browser takes the UUID path. Found by re-reading the file after the tombstones landed.
// `randomUUID: null` does NOT get you here -- `options.randomUUID ?? crypto.randomUUID` falls
// through on null, so the first version of this helper took the UUID path and the test below passed
// against the unfixed code. A generator that returns something the id sanitizer rejects is what
// actually drives the fallback: mintProfileId tries it, gets nothing usable, and derives locally.
function noCryptoTab(storage) {
  return createProfileStore({ storage, randomUUID: () => '' });
}

test('a hero minted after a delete is not handed the dead hero\'s id', () => {
  const device = deviceStorage();
  const first = noCryptoTab(device);
  const doomed = first.createProfile('Ada');
  first.deleteProfile(doomed.id);

  // A reload: fresh store over the same device, counter back to zero.
  const afterReload = noCryptoTab(device);
  const fresh = afterReload.createProfile('Bo');

  assert.notEqual(fresh.id, doomed.id, 'the new child must not inherit a tombstoned id');
  const stored = JSON.parse(device.getItem(PROFILES_STORAGE_KEY));
  assert.deepEqual(stored.profiles.map((p) => p.displayName), ['Bo'],
    'and Bo must actually be on the device, not deleted at birth by their own id');
});
