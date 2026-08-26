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
import { LANTERN_UNLOCK_XP, lanternXpEventId } from '../public/src/progression/facts.js';
import { levelForXp } from '../public/src/progression/levels.js';
// R1: repeatable combat XP now rides every offline kill this file's killWolf() helper drives,
// alongside the Lantern's one-time award -- see each comment marked R1 below for exactly why.
import { combatXpFor } from '../public/src/rewards/combatRewards.js';

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
  // R1: this same kill ALSO earns its own repeatable combat XP, riding the same award marks already
  // folded -- so the third kill now raises FOUR events in this fixed order (mark, its own combat XP,
  // the unlock, and the Lantern's XP), rather than the pre-R1 three. Order is asserted because it is
  // deterministic (offlineProgress.js's own mark-loop -> combat-loop -> lantern-check sequence), and
  // the two xp-earned events are told apart by eventId rather than by position alone.
  assert.deepEqual(
    raised.map((event) => event.type),
    ['mark-earned', 'xp-earned', 'lantern-unlocked', 'xp-earned'],
    'and the ceremony is raised on the frame it becomes true -- P2 adds the XP the unlock is worth, '
    + 'R1 adds this same kill\'s own combat XP alongside it',
  );
  assert.ok(raised[1].eventId.startsWith('xp:combat:'), 'R1: the SECOND event is this kill\'s own combat XP');
  assert.equal(raised[3].eventId, lanternXpEventId(lanternUnlockEventId(PROFILE)),
    'the FOURTH event is still the Lantern\'s own, named exactly as before R1');

  const third = pageLoad(storage);
  assert.equal(third.lanternUnlocked(), true, 'the unlock survives the next reload');

  // The ceremony must not be able to fire twice. A fourth kill re-derives the same unlock id, and
  // the guard plus the journal's own idempotency both have to hold for this to stay quiet -- though
  // R1: this fourth kill is a genuinely NEW kill and still earns its own combat XP.
  const afterMore = third.killWolf();
  assert.deepEqual(afterMore.map((event) => event.type), ['mark-earned', 'xp-earned'],
    'a later kill must not re-raise the Lantern unlock a child already had, but still earns combat XP');
  assert.ok(afterMore[1].eventId.startsWith('xp:combat:'), 'not a re-announced Lantern XP');
  assert.equal(
    third.profiles.journalFor(PROFILE).filter((fact) => fact.type === 'lantern-unlocked').length,
    1,
    'and it must not be written twice',
  );
  assert.equal(lanternUnlockEventId(PROFILE), `lantern-unlocked:${PROFILE}`,
    'the unlock id is derived from the profile alone, so it is the same one every reload');
});

// ── P2: the Lantern is worth a level, offline too ───────────────────────────────────────────────
//
// The brief requires the offline/local path to "produce the same logical one-time progression
// result" as the server. It is the same LAW rather than a matching implementation --
// progression/facts.js decides both the amount and the eventId, and neither side knows the other
// exists -- so what is actually worth testing here is the DURABILITY and the IDEMPOTENCY, which are
// this file's business, on the same reload machinery the marks above use.

test('the offline Lantern unlock earns exactly one 100-XP fact, and it lands a child on Level 2', () => {
  const storage = deviceStorage();
  const loaded = pageLoad(storage);

  loaded.killWolf();
  loaded.killWolf();
  assert.equal(loaded.lanternUnlocked(), false, 'setup: two marks, no Lantern yet');
  // R1 UPDATE: this used to read "marks alone are not XP" -- R1 makes that premise false by design,
  // through this SAME killWolf() door, so the positive combat-XP amount is asserted here instead of
  // the old zero.
  const expectedCombatXpFirstTwo = 2 * combatXpFor({ heroLevel: 1, enemyLevel: 1 });
  assert.equal(loaded.profiles.stateFor(PROFILE).xp, expectedCombatXpFirstTwo,
    'R1: two ordinary kills earn their own combat XP even with no Lantern in sight');

  const raised = loaded.killWolf();
  const lanternEventId = lanternXpEventId(lanternUnlockEventId(PROFILE));
  const lanternXpEvents = raised.filter((event) => event.type === 'xp-earned' && event.eventId === lanternEventId);
  assert.equal(lanternXpEvents.length, 1, 'exactly one Lantern XP fact, on the frame the Lantern unlocks');
  assert.equal(lanternXpEvents[0].value, String(LANTERN_UNLOCK_XP));
  assert.equal(lanternXpEvents[0].eventId, lanternEventId,
    'named from the Lantern that earned it, so it cannot be minted twice');

  // R1: the SAME third kill also earns its own combat XP alongside the Lantern.
  const combatXpEvents = raised.filter((event) => event.type === 'xp-earned' && event.eventId !== lanternEventId);
  assert.equal(combatXpEvents.length, 1, 'R1: the third kill still earns its own combat XP too');

  const state = loaded.profiles.stateFor(PROFILE);
  assert.equal(state.xp, expectedCombatXpFirstTwo + Number(combatXpEvents[0].value) + LANTERN_UNLOCK_XP);
  assert.equal(levelForXp(state.xp), 2, 'the award IS the first level, which is why it is derived');
});

test('the XP is written in the SAME journal call as the unlock, so neither can land alone', () => {
  // The failure the batching exists for: a Lantern that is permanently present with XP that can
  // never arrive, because the unlock is a latch and will never fire again. Proved by observing that
  // the journal never passes through a state where one is present and the other is not.
  //
  // R1 UPDATE: scoped to the LANTERN's own eventIds rather than the bare `xp-earned` TYPE -- R1's
  // combat-XP fact is a legitimate, independently-recorded xp-earned row (it pays per kill, not per
  // Lantern), so a bare type check would now see it land alone on the first two kills and misread
  // that as the exact half-landed state this test exists to catch.
  const storage = deviceStorage();
  const loaded = pageLoad(storage);
  loaded.killWolf();
  loaded.killWolf();

  const lanternEventId = lanternUnlockEventId(PROFILE);
  const lanternXpId = lanternXpEventId(lanternEventId);
  const seen = [];
  const realRecord = loaded.profiles.recordFacts;
  loaded.profiles.recordFacts = (profileId, facts) => {
    const result = realRecord(profileId, facts);
    seen.push(loaded.profiles.journalFor(profileId).map((fact) => fact.eventId));
    return result;
  };
  loaded.killWolf();

  for (const eventIds of seen) {
    const hasLantern = eventIds.includes(lanternEventId);
    const hasLanternXp = eventIds.includes(lanternXpId);
    assert.equal(hasLantern, hasLanternXp,
      `the journal was observed holding the Lantern without its XP (or the reverse): ${JSON.stringify(eventIds)}`);
  }
  assert.ok(seen.some((eventIds) => eventIds.includes(lanternXpId)), 'setup: the Lantern XP was written at all');
});

test('replaying the unlock across reloads never adds a second hundred XP', () => {
  const storage = deviceStorage();
  const first = pageLoad(storage);
  first.killWolf();
  first.killWolf();
  first.killWolf();
  // R1: the total is the Lantern PLUS the same three kills' own combat XP, computed through the law
  // (all three price at Level 1: the third kill's own combat component is priced BEFORE the Lantern
  // lands within that same call -- offlineProgress.js runs its combat-xp loop before its lantern
  // check) rather than restated as a number.
  let expectedTotal = LANTERN_UNLOCK_XP + 3 * combatXpFor({ heroLevel: 1, enemyLevel: 1 });
  assert.equal(first.profiles.stateFor(PROFILE).xp, expectedTotal);

  // Four more reloads, each with another kill: the LANTERN's unlock latch, its derived id and the
  // journal's own idempotency all have to hold, and R1 combat XP legitimately keeps accruing on every
  // genuinely new kill.
  const lanternXpId = lanternXpEventId(lanternUnlockEventId(PROFILE));
  for (let reload = 0; reload < 4; reload += 1) {
    const later = pageLoad(storage);
    const heroLevelBeforeThisKill = levelForXp(later.profiles.stateFor(PROFILE).xp);
    const raised = later.killWolf();
    assert.deepEqual(raised.map((event) => event.type), ['mark-earned', 'xp-earned'],
      `reload ${reload + 1} re-raised a beat the child already had, or failed to earn its own combat XP`);
    assert.ok(raised[1].eventId.startsWith('xp:combat:'),
      `reload ${reload + 1} re-announced the Lantern XP instead of its own combat XP`);
    expectedTotal += combatXpFor({ heroLevel: heroLevelBeforeThisKill, enemyLevel: 1 });
    assert.equal(later.profiles.stateFor(PROFILE).xp, expectedTotal,
      `reload ${reload + 1} moved the total by something other than its own combat XP`);
  }

  const journal = pageLoad(storage).profiles.journalFor(PROFILE);
  assert.equal(journal.filter((fact) => fact.eventId === lanternXpId).length, 1,
    'one Lantern XP row, however many sessions asked');
  assert.equal(levelForXp(pageLoad(storage).profiles.stateFor(PROFILE).xp), 2,
    'and the child is still Level 2, not Level 3');
});

test('a child who already met a server is not paid twice for one lantern', () => {
  // The two-identity case, and the one a naive "derive an id from the unlock" would get wrong: a
  // profile can legitimately carry the DEVICE's `lantern-unlocked:<profileId>` and the SERVER's
  // `lantern:<guestId>` at once, because the two stores mint their own names for the same latch. One
  // child, one unlock, one award.
  const storage = deviceStorage();
  const seeded = pageLoad(storage);
  const serverLanternId = 'lantern:some-guest-id';
  seeded.profiles.recordFacts(PROFILE, [
    { eventId: serverLanternId, type: 'lantern-unlocked' },
    { eventId: lanternXpEventId(serverLanternId), type: 'xp-earned', value: String(LANTERN_UNLOCK_XP) },
  ]);
  assert.equal(seeded.profiles.stateFor(PROFILE).xp, LANTERN_UNLOCK_XP, 'setup: paid once already');

  const lanternXpId = lanternXpEventId(serverLanternId);
  let expectedTotal = LANTERN_UNLOCK_XP;
  for (let kill = 0; kill < 2; kill += 1) {
    const heroLevel = levelForXp(expectedTotal);
    seeded.killWolf();
    expectedTotal += combatXpFor({ heroLevel, enemyLevel: 1 });
  }
  const heroLevelBeforeThird = levelForXp(expectedTotal);
  const raised = seeded.killWolf();

  // R1: the LANTERN must not pay twice; the SAME kill still earns its own combat XP regardless,
  // since a profile's combat-XP law has nothing to do with whether its Lantern was already spent.
  assert.equal(raised.filter((event) => event.eventId === lanternXpId).length, 0,
    'the offline path must not pay a second time for a lantern the server already paid for');
  const combatXpEvents = raised.filter((event) => event.type === 'xp-earned');
  assert.equal(combatXpEvents.length, 1, 'this third kill still earns its own combat XP');
  expectedTotal += combatXpFor({ heroLevel: heroLevelBeforeThird, enemyLevel: 1 });
  assert.equal(seeded.profiles.stateFor(PROFILE).xp, expectedTotal);
  assert.equal(levelForXp(seeded.profiles.stateFor(PROFILE).xp), 2, 'Level 2, not Level 3');
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
