// A child who plays with no server still earns their marks, and still has them tomorrow.
//
// The offline fallback ran a real reward loop -- the same fold net/gameServer.mjs runs -- and then
// threw the result away: `offlineMarks` and `offlineLanternUnlocked` were plain bindings in main.js's
// closure, so a refresh put a child who had earned two marks back to zero. That was documented as
// deliberate ("the honest, visible difference between this fallback and the real, persisted loop"),
// and Director correction 4 retired it: a same-device family save must recover the child's
// progression whether or not a server was ever reachable. Marks are named in that list.
//
// The trap this file exists for is the SECOND half. Journalling the fold's awards is not enough,
// because offline the fold's default `mintLifeId` is the life INDEX -- reproducible only within one
// process. It restarts at 0 on the next page load, so the first kill of session two recomputes
// `mark:offline-hero:0`, an id the journal already holds, and the union collapses it. The child
// kills a wolf, watches the spark fly, and the count does not move.
//
// That is not a hypothetical: rewards/marks.js's own header records this exact defect being found
// and fixed once already on the SERVER path, which is why mintLifeId is injectable at all. The
// offline path kept the index default and, being session-only, never noticed. Making it durable is
// what makes the collision reachable, so the durability and the id have to land together.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { MARKS_TO_UNLOCK } from '../public/src/rewards/marks.js';
import {
  createLifeIdMinter,
  createOfflineProgress,
  lanternUnlockEventId,
} from '../public/src/rewards/offlineProgress.js';
import { createProfileStore } from '../public/src/progression/profiles.js';

const PROFILE = 'p-offline-1111-2222-3333';

/** One device's localStorage, outliving the page loads below -- which is the entire point: each
 *  "session" builds a NEW profile store over the SAME storage, exactly as a refresh does. */
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

/** A page load: a new profile store over the SAME storage, and a NEW offline progress loop, because
 *  a refresh genuinely restarts the fold. Returns the real producer main.js drives -- not a
 *  re-implementation of it, which is the trap this file's header is about. */
function pageLoad(storage, mintLifeId = durableLifeId) {
  const profiles = session(storage);
  const offline = createOfflineProgress({ profiles, profileId: PROFILE, mintLifeId });
  return {
    profiles,
    killWolf: () => offline.recordKills([{ type: 'wolf-defeated' }]),
    marks: () => profiles.stateFor(PROFILE).marks,
    lanternUnlocked: () => profiles.stateFor(PROFILE).lanternUnlocked,
  };
}

test('marks earned with no server are still there after a refresh', () => {
  const storage = deviceStorage();

  // Session one: the child beats two wolves, then closes the tablet.
  const first = pageLoad(storage);
  first.killWolf();
  first.killWolf();
  assert.equal(first.marks(), 2, 'two kills, two marks');

  // Session two: a whole new page load over the same storage. Nothing in memory survives.
  const second = pageLoad(storage);
  assert.equal(
    second.marks(),
    2,
    'the marks a child earned offline must survive the refresh -- this is the product rule',
  );
});

test('the first kill after a refresh is a NEW mark, not one the journal swallows', () => {
  const storage = deviceStorage();

  const first = pageLoad(storage);
  first.killWolf();
  first.killWolf();

  const second = pageLoad(storage);
  second.killWolf();

  assert.equal(
    second.marks(),
    3,
    'the third kill must count; a life INDEX would recompute mark:offline-hero:0 and be swallowed',
  );
});

test('a life index would be exactly the collision, so the module refuses to default one', () => {
  // The trap, pinned two ways. First: a caller that supplies no id source is refused outright,
  // rather than quietly given a counter that looks fine until the second session.
  const storage = deviceStorage();
  assert.throws(
    () => createOfflineProgress({ profiles: session(storage), profileId: PROFILE }),
    TypeError,
    'no mintLifeId must be an error, not a silent default',
  );

  // Second: what that default WOULD have cost, demonstrated with a deliberately process-local id.
  // If a later change reinstates one, the test above stops throwing and this one shows the damage.
  let lifeIndex = 0;
  const processLocal = () => String(lifeIndex += 1);

  const first = pageLoad(storage, processLocal);
  first.killWolf();
  first.killWolf();
  assert.equal(first.marks(), 2);

  lifeIndex = 0; // the refresh: the counter restarts, because that is what a counter does
  const second = pageLoad(storage, processLocal);
  second.killWolf();

  assert.equal(
    second.marks(),
    2,
    'the restarted index recomputes an id the journal holds and the kill vanishes',
  );
});

test('three marks across two sessions unlock the lantern, and the unlock is durable too', () => {
  const storage = deviceStorage();

  const first = pageLoad(storage);
  first.killWolf();
  first.killWolf();
  assert.equal(first.lanternUnlocked(), false, 'two marks is not three');

  // The third kill lands in a LATER session, which is the case a session-scoped tally cannot see:
  // its own count is 1, and the threshold is 3.
  const second = pageLoad(storage);
  const raised = second.killWolf();
  assert.equal(second.marks(), MARKS_TO_UNLOCK);
  assert.equal(second.lanternUnlocked(), true, 'the third mark unlocks the lantern across sessions');
  assert.deepEqual(
    raised.map((event) => event.type),
    ['mark-earned', 'lantern-unlocked'],
    'and the ceremony is raised on the frame it becomes true',
  );

  const third = pageLoad(storage);
  assert.equal(third.lanternUnlocked(), true, 'the unlock survives the next reload');

  // The ceremony must not be able to fire twice. A fourth kill re-derives the same unlock id, and
  // the guard plus the journal's own idempotency both have to hold for this to stay quiet.
  const afterMore = third.killWolf();
  assert.deepEqual(afterMore.map((event) => event.type), ['mark-earned'],
    'a later kill must not re-raise the unlock a child already had');
  assert.equal(
    third.profiles.journalFor(PROFILE).filter((fact) => fact.type === 'lantern-unlocked').length,
    1,
    'and it must not be written twice',
  );
  assert.equal(lanternUnlockEventId(PROFILE), `lantern-unlocked:${PROFILE}`,
    'the unlock id is derived from the profile alone, so it is the same one every reload');
});

test('two children on one tablet do not share an offline mark', () => {
  const storage = deviceStorage();
  const loaded = pageLoad(storage);
  const sibling = 'p-offline-9999-8888-7777';

  loaded.killWolf();
  loaded.killWolf();

  assert.equal(loaded.marks(), 2);
  assert.equal(loaded.profiles.stateFor(sibling).marks, 0, 'the sibling earned none of those');
});

// ── the id source itself, on the path a real tablet actually takes ─────────────────────────────

test('life ids stay unique across sessions with no crypto.randomUUID at all', () => {
  // The LAN case: plain http, so randomUUID is not a secure-context function and is simply absent.
  // Two separate page loads, a minute apart, each minting from scratch.
  const first = createLifeIdMinter({ randomUUID: null, now: () => 1_700_000_000_000, random: () => 0.25 });
  const second = createLifeIdMinter({ randomUUID: null, now: () => 1_700_000_060_000, random: () => 0.25 });

  const ids = [first(), first(), second(), second()];
  assert.equal(new Set(ids).size, 4, `two sessions must not reuse an id: ${JSON.stringify(ids)}`);
});

test('two devices that load in the same millisecond still mint different ids', () => {
  // The clock cannot separate these, so the salt has to.
  const sameMoment = 1_700_000_000_000;
  const deviceA = createLifeIdMinter({ randomUUID: null, now: () => sameMoment, random: () => 0.1 });
  const deviceB = createLifeIdMinter({ randomUUID: null, now: () => sameMoment, random: () => 0.9 });

  assert.notEqual(deviceA(), deviceB(), 'the salt is what separates a simultaneous load');
});

test('a real crypto.randomUUID is preferred when there is one', () => {
  const mint = createLifeIdMinter({ randomUUID: () => 'from-crypto' });
  assert.equal(mint(), 'from-crypto');
});
