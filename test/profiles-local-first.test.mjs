// Checkpoint 1b: a same-device family save that survives the server's reward DB being wiped.
//
// The product rule under test is "shared adventure, personal progression, and the server database is
// not the only copy of family progress". That makes two stores of the same facts, which is normally
// how a codebase acquires two competing truths -- so most of this file is about the property that
// makes it safe instead: durable facts carry stable ids, and merging two sets of them is a union.
//
// Union means order-independent and idempotent. These tests therefore lean hard on merging the same
// facts twice, in both orders, from both origins, and asserting the state does not move. A design
// that only worked when the server was read first would pass a naive test and fail a real reload.

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { foldFacts, isProfileFact, unionFacts } from '../public/src/progression/facts.js';
import {
  DEFAULT_DISPLAY_NAME,
  LEGACY_GUEST_ID_KEY,
  MAX_PROFILES,
  PROFILES_STORAGE_KEY,
  createProfileStore,
  sanitizeDisplayName,
} from '../public/src/progression/profiles.js';
import { DEFAULT_EQUIPPED_WEAPON_ID, STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
import { openRewardStore } from '../net/rewardStore.mjs';

/** A localStorage stand-in. Deliberately not a Map alias: the real thing stores strings and throws
 *  on some hosts, and both of those behaviours are things this module has to survive. */
function fakeStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

/** Deterministic ids and clock, so every assertion below is about the code and not about entropy. */
function deterministicStore(storage, startAt = 0) {
  let n = startAt;
  return createProfileStore({
    storage,
    randomUUID: () => {
      n += 1;
      return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    },
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
  });
}

const mark = (id) => ({ eventId: id, type: 'mark-earned' });

// ── the union law ───────────────────────────────────────────────────────────────────────────────

test('folding the same fact twice counts it once', () => {
  const once = foldFacts([mark('m1')]);
  const twice = foldFacts([mark('m1'), mark('m1')]);
  assert.equal(once.marks, 1);
  assert.equal(twice.marks, 1, 'a duplicated fact must not become a second mark');
});

test('union is order-independent: server-first and journal-first agree exactly', () => {
  const journal = [mark('m1'), mark('m2'), { eventId: 'g1', type: 'gear-owned', value: WILDWOOD_BLADE_ID }];
  const server = [mark('m2'), mark('m3'), { eventId: 'c1', type: 'coin-earned' }];

  const a = foldFacts(unionFacts(journal, server));
  const b = foldFacts(unionFacts(server, journal));

  assert.deepEqual(a, b, 'which store was reachable first must not change the answer');
  assert.equal(a.marks, 3, 'm2 is held by both sides and must be counted once');
  assert.equal(a.coins, 1);
  assert.ok(a.ownedItemIds.includes(WILDWOOD_BLADE_ID));
});

test('the equipped weapon is latest-wins by durable revision, not by input order', () => {
  // Named for `rev` because the implementation reads `rev`. An earlier version of this test passed
  // hand-written `seq` values that the fold no longer looks at, so it stayed green purely on the
  // eventId tiebreak -- proving nothing about ordering. The ids here are deliberately chosen so the
  // tiebreak would pick the WRONG weapon if the revision were ignored: 'zz' sorts above 'aa'.
  const older = { eventId: 'equip:zz-older', type: 'weapon-equipped', value: STARTER_SWORD_ID, rev: 1 };
  const newer = { eventId: 'equip:aa-newer', type: 'weapon-equipped', value: WILDWOOD_BLADE_ID, rev: 7 };

  assert.equal(foldFacts([older, newer]).equippedWeaponId, WILDWOOD_BLADE_ID);
  assert.equal(foldFacts([newer, older]).equippedWeaponId, WILDWOOD_BLADE_ID,
    'reversing the input order must not un-equip the newer weapon');
});

test('a fact that is not a profile fact is refused rather than folded', () => {
  // A world fact and a malformed row. Folding either would silently invent personal progress.
  assert.equal(isProfileFact({ eventId: 'b', type: 'beacon-lit' }), false);
  assert.equal(isProfileFact({ type: 'mark-earned' }), false, 'a fact with no id cannot be deduped');
  const folded = foldFacts([{ eventId: 'b', type: 'beacon-lit' }, mark('m1')]);
  assert.equal(folded.marks, 1);
});

test('defaults fill the fields a fresh child has never earned', () => {
  const folded = foldFacts([], { equippedWeaponId: DEFAULT_EQUIPPED_WEAPON_ID, ownedItemIds: [STARTER_SWORD_ID] });
  assert.equal(folded.marks, 0);
  assert.equal(folded.equippedWeaponId, DEFAULT_EQUIPPED_WEAPON_ID);
  assert.deepEqual(folded.ownedItemIds, [STARTER_SWORD_ID]);
});

// ── profiles ────────────────────────────────────────────────────────────────────────────────────

test('a created profile persists across a reload of the store', () => {
  const storage = fakeStorage();
  const first = deterministicStore(storage);
  const created = first.createProfile('Leo');

  // A brand-new store object over the SAME storage is what a page reload actually is.
  const reloaded = deterministicStore(storage);
  const active = reloaded.activeProfile();

  assert.equal(active.id, created.id);
  assert.equal(active.displayName, 'Leo');
});

test('the profile id is immutable and the display name is not', () => {
  const storage = fakeStorage();
  const store = deterministicStore(storage);
  const created = store.createProfile('Leo');

  const renamed = store.renameProfile(created.id, 'Sir Leo');
  assert.equal(renamed.displayName, 'Sir Leo');
  assert.equal(renamed.id, created.id, 'renaming a hero must never move the key its save hangs off');
});

test('two profiles may share a display name and still be separate saves', () => {
  const storage = fakeStorage();
  const store = deterministicStore(storage);
  const a = store.createProfile('Wolf');
  const b = store.createProfile('Wolf');

  assert.notEqual(a.id, b.id, 'a name is not an identity -- two brothers will pick the same one');
  store.recordFacts(a.id, [mark('m-a')]);

  assert.equal(store.stateFor(a.id).marks, 1);
  assert.equal(store.stateFor(b.id).marks, 0, 'one child earning a mark must not credit the other');
});

test('deleting a profile takes its journal with it', () => {
  const storage = fakeStorage();
  const store = deterministicStore(storage);
  const a = store.createProfile('Leo');
  store.recordFacts(a.id, [mark('m1'), mark('m2')]);
  assert.equal(store.stateFor(a.id).marks, 2);

  assert.equal(store.deleteProfile(a.id), true);
  // An orphaned journal would hand a deleted child's earnings to whoever next took that id.
  assert.deepEqual(store.journalFor(a.id), []);
});

test('the profile cap is enforced', () => {
  const storage = fakeStorage();
  const store = deterministicStore(storage);
  for (let i = 0; i < MAX_PROFILES; i += 1) store.createProfile(`hero-${i}`);
  assert.throws(() => store.createProfile('one too many'), /already holds/);
});

test('a blank or oversized name is repaired rather than rejected', () => {
  assert.equal(sanitizeDisplayName('   '), DEFAULT_DISPLAY_NAME);
  assert.equal(sanitizeDisplayName(undefined), DEFAULT_DISPLAY_NAME);
  assert.equal(sanitizeDisplayName('x'.repeat(60)).length, 16);
});

test('discovery flags survive a reload -- they had no durable home before this module', () => {
  const storage = fakeStorage();
  const store = deterministicStore(storage);
  const p = store.createProfile('Leo');
  store.setFlags(p.id, { onboarding: { questGiven: true }, discovered: { gate: true } });

  const reloaded = deterministicStore(storage);
  const active = reloaded.activeProfile();
  assert.equal(active.onboarding.questGiven, true);
  assert.equal(active.discovered.gate, true);
  assert.equal(active.discovered.camp, false, 'an unset flag must stay false, not become true');
});

test('a corrupt keyring degrades to no profiles instead of throwing', () => {
  const storage = fakeStorage({ [PROFILES_STORAGE_KEY]: '{not json at all' });
  const store = deterministicStore(storage);
  assert.deepEqual(store.listProfiles(), []);
  assert.doesNotThrow(() => store.createProfile('Leo'));
});

test('one corrupt profile entry does not cost a sibling their save', () => {
  const storage = fakeStorage({
    [PROFILES_STORAGE_KEY]: JSON.stringify({
      v: 1,
      activeProfileId: 'p-good-aaaaaaaa',
      profiles: [{ id: '!!', displayName: 'broken' }, { id: 'p-good-aaaaaaaa', displayName: 'Leo' }],
    }),
  });
  const store = deterministicStore(storage);
  const profiles = store.listProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].displayName, 'Leo');
});

// ── migration ───────────────────────────────────────────────────────────────────────────────────

test('an existing guestId becomes a profile whose id IS that guestId', () => {
  const legacy = 'abcdef01-2345-6789-abcd-ef0123456789';
  const storage = fakeStorage({ [LEGACY_GUEST_ID_KEY]: legacy });
  const store = deterministicStore(storage);

  const id = store.activeProfileId();
  // Reusing the id verbatim is the entire migration: every reward_events row on the server already
  // points at this string, so nothing has to be moved, translated or backfilled.
  assert.equal(id, legacy);
  assert.equal(store.activeProfile().migratedFrom, LEGACY_GUEST_ID_KEY);
});

test('migration never deletes the legacy guest id', () => {
  const legacy = 'abcdef01-2345-6789-abcd-ef0123456789';
  const storage = fakeStorage({ [LEGACY_GUEST_ID_KEY]: legacy });
  deterministicStore(storage).activeProfileId();
  // It is the only thread tying this child to rows in a store this code cannot reach. Tidying it
  // away would be indistinguishable from losing the save.
  assert.equal(storage.getItem(LEGACY_GUEST_ID_KEY), legacy);
});

test('migration only fires on a device that has no profiles yet', () => {
  const legacy = 'abcdef01-2345-6789-abcd-ef0123456789';
  const storage = fakeStorage({ [LEGACY_GUEST_ID_KEY]: legacy });
  const store = deterministicStore(storage);
  store.createProfile('Leo');
  assert.equal(store.migrateLegacyGuest(), null, 'a device with real profiles must not gain a ghost');
});

// ── the point of the whole design ───────────────────────────────────────────────────────────────

test('a child keeps their progression when the server store is wiped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-local-first-'));
  try {
    const storage = fakeStorage();
    const store = deterministicStore(storage);
    const profile = store.createProfile('Leo');

    // Play: the server records durable facts and the client journals the same facts by the same ids.
    const server = openRewardStore(join(dir, 'rewards.db'));
    for (const eventId of ['mark:leo:1', 'mark:leo:2', 'mark:leo:3']) {
      server.apply({ guestId: profile.id, heroId: 'p1', type: 'mark-earned', eventId });
    }
    server.apply({ guestId: profile.id, heroId: 'p1', type: 'gear-owned', eventId: `own:${profile.id}:${WILDWOOD_BLADE_ID}`, value: WILDWOOD_BLADE_ID });
    server.apply({ guestId: profile.id, heroId: 'p1', type: 'coin-earned', eventId: 'coin-a' });

    const facts = server.profileFactsFor(profile.id);

    const online = store.ingestServerFacts(profile.id, facts);
    assert.equal(online.marks, 3);
    assert.equal(online.coins, 1);
    assert.ok(online.ownedItemIds.includes(WILDWOOD_BLADE_ID));

    server.close();

    // The server's database is gone. A brand-new empty one knows nothing about this child.
    const wiped = openRewardStore(join(dir, 'rewards-fresh.db'));
    assert.equal(wiped.marksFor(profile.id), 0, 'the replacement server genuinely has no record');

    // The device still does, and it derives the SAME state through the same fold.
    const afterReload = deterministicStore(storage);
    const recovered = afterReload.ingestServerFacts(profile.id, wiped.profileFactsFor(profile.id));
    wiped.close();

    assert.deepEqual(recovered, online, 'a wiped server must not cost the family its progress');
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* OS scratch */ }
  }
});

test('re-merging the server facts after recovery does not double anything', () => {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-local-first-remerge-'));
  try {
    const storage = fakeStorage();
    const store = deterministicStore(storage);
    const profile = store.createProfile('Leo');

    const server = openRewardStore(join(dir, 'rewards.db'));
    server.apply({ guestId: profile.id, heroId: 'p1', type: 'mark-earned', eventId: 'mark:leo:1' });
    const facts = server.profileFactsFor(profile.id);

    // Reconnect, resend, reload: the same facts arrive repeatedly and must stay one mark.
    store.recordFacts(profile.id, facts);
    store.recordFacts(profile.id, facts);
    store.recordFacts(profile.id, facts);

    assert.equal(store.journalFor(profile.id).length, 1, 'the journal is a set, not a log of arrivals');
    assert.equal(store.stateFor(profile.id).marks, 1);
    server.close();
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* OS scratch */ }
  }
});

test('a guaranteed item is owned once however many times its fact is merged', () => {
  const storage = fakeStorage();
  const store = deterministicStore(storage);
  const p = store.createProfile('Leo');
  const grant = { eventId: `own:${p.id}:${WILDWOOD_BLADE_ID}`, type: 'gear-owned', value: WILDWOOD_BLADE_ID };

  store.recordFacts(p.id, [grant, grant]);
  store.recordFacts(p.id, [grant]);

  const owned = store.ingestServerFacts(p.id, [grant]).ownedItemIds
    .filter((id) => id === WILDWOOD_BLADE_ID);
  assert.equal(owned.length, 1, 'a guaranteed piece must never be held twice');
});

test('one profile cannot read another profile journal', () => {
  const storage = fakeStorage();
  const store = deterministicStore(storage);
  const a = store.createProfile('Leo');
  const b = store.createProfile('Sam');

  store.recordFacts(a.id, [mark('m1'), mark('m2'), mark('m3')]);

  assert.equal(store.stateFor(a.id).marks, 3);
  assert.equal(store.stateFor(b.id).marks, 0);
  assert.equal(store.stateFor(b.id).lanternUnlocked, false);
});
