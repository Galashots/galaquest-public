// R1: the offline fallback's own repeatable-XP fold, over the SAME producer main.js drives
// (rewards/offlineProgress.js's createOfflineProgress) -- not a re-implementation, the trap
// test/offline-progress-durability.test.mjs's own header names.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createOfflineProgress } from '../public/src/rewards/offlineProgress.js';
import { createProfileStore } from '../public/src/progression/profiles.js';
import { isClientRestorableProfileFact } from '../public/src/progression/facts.js';
import { killXpForKind } from '../public/src/combat/enemyStats.js';

const PROFILE = 'p-offline-xp-1111';

function deviceStorage() {
  const memory = new Map();
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => { memory.set(k, String(v)); },
    removeItem: (k) => { memory.delete(k); },
  };
}

let uuidCounter = 0;
function session(storage) {
  return createProfileStore({
    storage,
    randomUUID: () => `uuid-${uuidCounter += 1}`,
    now: () => new Date(1_700_000_000_000 + uuidCounter * 1000),
  });
}

const durableLifeId = () => `life-${uuidCounter += 1}`;

function pageLoad(storage, mintLifeId = durableLifeId) {
  const profiles = session(storage);
  const offline = createOfflineProgress({ profiles, profileId: PROFILE, mintLifeId });
  return {
    profiles,
    offline,
    xp: () => profiles.stateFor(PROFILE).xp,
  };
}

test('a kind-priced kill earns the same XP offline that killXpForKind prices it at', () => {
  const storage = deviceStorage();
  const first = pageLoad(storage);
  first.offline.recordKills([
    { type: 'wolf-defeated', enemyId: 'wolf-1', kind: 'wolf', level: 1 },
  ]);
  assert.equal(first.xp(), killXpForKind('wolf'));
});

test('every density-package kind pays its own priced amount, and the tally adds up', () => {
  const storage = deviceStorage();
  const first = pageLoad(storage);
  first.offline.recordKills([
    { type: 'wolf-defeated', enemyId: 'ember-wolf-1', kind: 'ember-wolf', level: 1 },
    { type: 'wolf-defeated', enemyId: 'frost-wolf-1', kind: 'frost-wolf', level: 1 },
    { type: 'wolf-defeated', enemyId: 'alpha-wolf-1', kind: 'alpha-wolf', level: 1 },
  ]);
  assert.equal(
    first.xp(),
    killXpForKind('ember-wolf') + killXpForKind('frost-wolf') + killXpForKind('alpha-wolf'),
  );
});

test('XP earned offline survives a refresh, the same durability rule marks already keep', () => {
  const storage = deviceStorage();
  const first = pageLoad(storage);
  first.offline.recordKills([{ type: 'wolf-defeated', enemyId: 'wolf-1', kind: 'wolf', level: 1 }]);
  assert.equal(first.xp(), killXpForKind('wolf'));

  const second = pageLoad(storage);
  assert.equal(second.xp(), killXpForKind('wolf'), 'a refresh must not lose offline-earned XP');

  // The NEXT kill after the refresh must be a genuinely new award, not swallowed by a life-index
  // collision -- the identical trap test/offline-progress-durability.test.mjs pins for marks.
  second.offline.recordKills([{ type: 'wolf-defeated', enemyId: 'wolf-1', kind: 'wolf', level: 1 }]);
  assert.equal(second.xp(), killXpForKind('wolf') * 2);
});

test('a landed hit alone (no defeat) earns nothing, and marks and XP fold from the same event batch', () => {
  const storage = deviceStorage();
  const first = pageLoad(storage);
  first.offline.recordKills([{ type: 'wolf-hit', enemyId: 'wolf-1', kind: 'wolf', level: 1 }]);
  assert.equal(first.xp(), 0);
  assert.equal(first.profiles.stateFor(PROFILE).marks, 0);

  first.offline.recordKills([{ type: 'wolf-defeated', enemyId: 'wolf-1', kind: 'wolf', level: 1 }]);
  assert.equal(first.xp(), killXpForKind('wolf'));
  assert.equal(first.profiles.stateFor(PROFILE).marks, 1, 'the same kill still earns its Lantern Mark');
});

/**
 * THE RECONNECT MUST NOT TAKE BACK WHAT WAS EARNED OFFLINE.
 *
 * The offline fallback stamps its own encounter events with OFFLINE_HERO_ID, so the kill-XP fold
 * mints `kill-xp:offline-hero:<enemyId>:<lifeId>` -- a first segment that is a sentinel, never a
 * real profile id. `kill-xp:` is a profile-scoped prefix, so without a carve-out the restore door
 * (net/gameServerCore.mjs asks isClientRestorableProfileFact before ingesting a client's journal)
 * reads the owner as the literal string 'offline-hero', finds it is not this profile, and refuses
 * every row. Measured consequence: the Wi-Fi drops, a child fights on and kills fifteen wolves,
 * levels up and watches POWER and max HP rise -- and the moment the socket comes back the server
 * republishes the pre-outage XP and the level, the damage and the hearts all snap backwards. Marks
 * already have exactly this carve-out; kill XP shipped without one.
 *
 * Asserted over the facts the real producer mints rather than over a typed eventId, so the sentinel
 * can never drift out from under the rule.
 */
test('XP a child earns offline is restorable on reconnect, and is still refused for another profile', () => {
  const storage = deviceStorage();
  const { profiles, offline } = pageLoad(storage);
  offline.recordKills([{ type: 'wolf-defeated', enemyId: 'wolf-1', kind: 'wolf', level: 1 }]);

  const xpFacts = profiles.journalFor(PROFILE).filter((fact) => fact.eventId.startsWith('kill-xp:'));
  assert.ok(xpFacts.length > 0, 'the offline fold minted no kill-xp fact at all');
  for (const fact of xpFacts) {
    assert.ok(isClientRestorableProfileFact(fact, PROFILE),
      `${fact.eventId} was refused at the restore door, so this child's offline level is taken back `
      + 'the moment they reconnect');
    // ...and the carve-out must stay a carve-out: a fact naming a REAL sibling profile is still
    // refused, so one child cannot reserve the other's durable row.
    assert.equal(
      isClientRestorableProfileFact({ ...fact, eventId: 'kill-xp:p-someone-else-2222:wolf-1:life-9' }, PROFILE),
      false,
      'another profile\'s kill-xp row must still be refused',
    );
  }
});
