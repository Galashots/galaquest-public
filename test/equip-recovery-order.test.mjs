// The equipped weapon has to stay the LATEST one across the exact boundary local-first exists for:
// a reload, and a server whose database has been wiped and rebuilt.
//
// progression/facts.js resolves equip by maximum revision rather than by iteration order, which is
// right, but that only holds if the revision itself is durable and comparable across both origins.
// A revision minted from a counter that restarts, or reconstructed from a row index in whichever
// database happens to be readable right now, is neither -- it silently makes an OLD equip outrank a
// NEW one the moment the number it was derived from resets.
//
// These tests are about the SOURCE of that ordering, not the fold. The fold was already covered, and
// covering it was not enough: it passed while being fed hand-written revisions, which is exactly the
// input the failure never produces.

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { foldFacts, unionFacts } from '../public/src/progression/facts.js';
import { createProfileStore } from '../public/src/progression/profiles.js';
import { STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
import { openRewardStore } from '../net/rewardStore.mjs';

function fakeStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

function deterministicStore(storage) {
  let n = 0;
  return createProfileStore({
    storage,
    randomUUID: () => {
      n += 1;
      return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    },
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
  });
}

const equip = (eventId, itemId) => ({ eventId, type: 'weapon-equipped', value: itemId });

test('reload, then a new equip while offline: the NEW weapon wins', () => {
  const storage = fakeStorage();
  const first = deterministicStore(storage);
  const profile = first.createProfile('Leo');

  // A long history: enough equips that any process-local counter starting over lands beneath it.
  for (let i = 0; i < 7; i += 1) {
    first.recordFacts(profile.id, [equip(`equip:${profile.id}:old-${i}`, STARTER_SWORD_ID)]);
  }
  assert.equal(first.stateFor(profile.id).equippedWeaponId, STARTER_SWORD_ID);

  // The page reloads. A brand-new store object over the same storage -- any in-memory counter is
  // back at zero, but the child's history is not.
  const afterReload = deterministicStore(storage);
  afterReload.recordFacts(profile.id, [equip(`equip:${profile.id}:new`, WILDWOOD_BLADE_ID)]);

  assert.equal(
    afterReload.stateFor(profile.id).equippedWeaponId,
    WILDWOOD_BLADE_ID,
    'the weapon equipped after the reload is the latest one and must win',
  );
});

test('server wiped and rebuilt, then a new equip: the NEW weapon wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-equip-recovery-'));
  try {
    const storage = fakeStorage();
    const store = deterministicStore(storage);
    const profile = store.createProfile('Leo');

    // History on a server that also holds plenty of non-equip rows, so any ordering derived from a
    // row index counts things the journal deliberately does not keep.
    const server = openRewardStore(join(dir, 'rewards.db'));
    for (let i = 0; i < 5; i += 1) {
      server.apply({ guestId: profile.id, heroId: 'p1', type: 'mark-earned', eventId: `mark-${i}` });
      server.apply({ guestId: profile.id, heroId: 'p1', type: 'coin-earned', eventId: `coin-${i}` });
    }
    server.apply({
      guestId: profile.id, heroId: 'p1', type: 'weapon-equipped',
      eventId: `equip:${profile.id}:historic`, value: STARTER_SWORD_ID,
    });
    store.recordFacts(profile.id, server.profileFactsFor(profile.id));
    server.close();

    // The database is replaced by an empty one. The device is the only party that survived.
    const rebuilt = openRewardStore(join(dir, 'rewards-rebuilt.db'));
    assert.equal(rebuilt.marksFor(profile.id), 0, 'the rebuilt server genuinely knows nothing');

    const afterWipe = deterministicStore(storage);
    afterWipe.recordFacts(profile.id, [equip(`equip:${profile.id}:after-wipe`, WILDWOOD_BLADE_ID)]);
    const state = afterWipe.stateFor(profile.id, rebuilt.profileFactsFor(profile.id));
    rebuilt.close();

    assert.equal(
      state.equippedWeaponId,
      WILDWOOD_BLADE_ID,
      'an equip made after the wipe must outrank one recovered from before it',
    );
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* OS scratch */ }
  }
});

test('two equips that tie resolve identically whichever way the union is argued', () => {
  // Concurrency -- two tabs, or an offline equip meeting a server one -- can produce the same
  // revision twice. A tie must be broken by something stable, not by which side was passed first,
  // or a reload can silently change which weapon the child is holding.
  const a = { eventId: 'equip:leo:aaa', type: 'weapon-equipped', value: STARTER_SWORD_ID, rev: 4 };
  const b = { eventId: 'equip:leo:bbb', type: 'weapon-equipped', value: WILDWOOD_BLADE_ID, rev: 4 };

  const forward = foldFacts(unionFacts([a], [b])).equippedWeaponId;
  const backward = foldFacts(unionFacts([b], [a])).equippedWeaponId;

  assert.equal(forward, backward, 'a tied revision must not resolve by argument order');
});

test('the same equip seen from both origins does not lose its revision', () => {
  // The journal has stamped a revision; the server copy of the identical fact has none. Merging the
  // two must keep the better-informed copy rather than discarding the ordering.
  const withRev = { eventId: 'equip:leo:same', type: 'weapon-equipped', value: WILDWOOD_BLADE_ID, rev: 9 };
  const withoutRev = { eventId: 'equip:leo:same', type: 'weapon-equipped', value: WILDWOOD_BLADE_ID };
  const older = { eventId: 'equip:leo:older', type: 'weapon-equipped', value: STARTER_SWORD_ID, rev: 3 };

  assert.equal(foldFacts(unionFacts([withRev, older], [withoutRev])).equippedWeaponId, WILDWOOD_BLADE_ID);
  assert.equal(foldFacts(unionFacts([withoutRev], [withRev, older])).equippedWeaponId, WILDWOOD_BLADE_ID);
});
