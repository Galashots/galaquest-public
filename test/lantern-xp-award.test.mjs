// THE FIRST REAL LEVEL, END TO END: one Lantern, one hundred XP, Level 2, and a stronger hero.
//
// P1 built the XP fact and proved it durable; nothing minted one, so "XP works" was a claim about a
// column. P2 mints exactly one -- the first-time Lantern unlock -- and the whole vertical rests on
// that award being unrepeatable. A durable progression currency that can be earned twice is not a
// currency, and the ways it could be earned twice are not hypothetical: two heroIds can share one
// guestId (two tabs on one iPad), a server restart re-reads a store it did not write, and a device
// that reconnects to a wiped server teaches its own facts back and hears every one of them
// announced straight to it.
//
// So this file is deliberately shaped around the FAILURES rather than around the feature:
//
//   - awarded once, and once only, however many times the check runs;
//   - survives a store close and reopen, which is what "durable" has to mean;
//   - survives a device -> server restore, where the same lantern arrives under a second name;
//   - never lands alone, and never leaves its Lantern to land alone;
//   - and it actually reaches the fight, because a level nobody's combat reads is docs/MISTAKES.md
//     GQ-013 exactly -- a reward the rules never read is a lie with a ceremony attached.
//
// Driven against the REAL store and the REAL reward coordinator throughout (GQ-015: a test that
// hand-feeds a pure function proves the function, not where its inputs come from). The Lantern is
// reached by folding real wolf-defeated events through the real mark ledger, not by calling an award
// helper directly -- because "does the third kill do this" is the question.

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createRewardCoordinator, createSimulation } from '../net/gameServer.mjs';
import { openRewardStore } from '../net/rewardStore.mjs';
import {
  LANTERN_UNLOCK_XP,
  foldFacts,
  lanternXpEventId,
  pendingLanternXpFact,
} from '../public/src/progression/facts.js';
import { MARKS_TO_UNLOCK } from '../public/src/rewards/marks.js';
// R1: repeatable combat XP now rides every ordinary kill this file's own killAWolf/killToTheLantern
// helpers drive, alongside the Lantern's one-time award -- so several assertions below have to ask
// about the LANTERN's own identity specifically rather than "any xp-earned event/row". See each
// comment marked R1 for exactly which assertion that is and why.
import { combatXpFor } from '../public/src/rewards/combatRewards.js';
import { cumulativeXpForLevel, levelForXp } from '../public/src/progression/levels.js';
import {
  LEVEL_1_STARTER_STATS,
  resolveHeroStats,
  resolvedHeroDamage,
  resolvedMaxHp,
} from '../public/src/progression/heroStats.js';
import { STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
import { HERO_MAX_HP, SWING_CONTACT_SECONDS } from '../public/src/combat/encounter.js';

const GUEST = 'p-lantern-xp-1111-2222';
const HERO = 'hero-1';

function tempStorePath() {
  return join(mkdtempSync(join(tmpdir(), 'galaquest-lantern-xp-')), 'rewards.db');
}

/** A coordinator over a real store on disk, bound to one durable guest. Returns the pieces every
 *  test here needs plus a `close` that also removes the directory. */
function coordinatorOn(path, { guestId = GUEST, heroId = HERO } = {}) {
  // `rewardStorePath`, ALWAYS -- never `store`. The coordinator opens its own connection, so an
  // option name it does not recognise silently falls through to DEFAULT_REWARD_STORE_PATH and the
  // test writes into the repository's real data/rewards.db. Found the hard way while writing this
  // file: every assertion here failed with "0 marks" while three mark rows landed in the live store.
  const rewards = createRewardCoordinator({ rewardStorePath: path });
  // A SECOND connection to the SAME file, for reading only -- SQLite is perfectly happy with that
  // and it is how these tests observe what the coordinator actually wrote rather than what it said.
  const store = openRewardStore(path);
  rewards.join(heroId, guestId);
  return {
    store,
    rewards,
    heroId,
    guestId,
    facts: () => store.profileFactsFor(guestId),
    close() {
      rewards.close();
      store.close();
      rmSync(join(path, '..'), { recursive: true, force: true });
    },
  };
}

/** One wolf-defeated, folded through the real ledger exactly as the tick does. Returns the reward
 *  events the coordinator raised for it. */
function killAWolf(rewards, heroId = HERO) {
  return rewards.processTick([
    { type: 'wolf-hit', heroId, remaining: 20, damage: 10 },
    { type: 'wolf-defeated', heroId },
  ]);
}

/** Kill wolves until the Lantern unlocks, returning every reward event raised on the way. */
function killToTheLantern(rewards, heroId = HERO) {
  const events = [];
  for (let kill = 0; kill < MARKS_TO_UNLOCK; kill += 1) events.push(...killAWolf(rewards, heroId));
  return events;
}

// ── the award itself ────────────────────────────────────────────────────────────────────────────

test('the third kill unlocks the Lantern AND earns exactly one 100-XP fact', () => {
  const path = tempStorePath();
  const bound = coordinatorOn(path);
  try {
    assert.equal(bound.store.xpFor(GUEST), 0, 'a fresh child has earned nothing');

    const events = killToTheLantern(bound.rewards);

    // R1: three ordinary kills now ALSO earn their own combat XP alongside the Lantern, so "exactly
    // one XP award" has to be asked about the LANTERN's own identity specifically -- a bare
    // `type === 'xp-earned'` filter would now also catch those. The assertions below keep their full
    // original strength, scoped to the one fact this test is actually about.
    const lanternEventId = lanternXpEventId(`lantern:${GUEST}`);
    const xpEvents = events.filter((event) => event.type === 'xp-earned' && event.eventId === lanternEventId);
    assert.equal(xpEvents.length, 1, `expected exactly one Lantern XP award, saw ${JSON.stringify(events)}`);
    assert.equal(xpEvents[0].value, String(LANTERN_UNLOCK_XP));
    assert.equal(xpEvents[0].heroId, HERO, 'addressed to the child who earned it');
    assert.equal(xpEvents[0].eventId, lanternEventId,
      'named from the Lantern that earned it, which is what makes it unrepeatable');

    // R1: positive coverage that combat XP DID also arrive, priced through the one law rather than a
    // second number restated here -- test/progression-r1-c1.test.mjs pins the law itself.
    //
    // FIX 3 (Sonnet B adversarial pass, re-tightened): the total below used to be checked against
    // `combatXpEvents`' OWN reduced sum -- self-referential, and toothless against a pricing
    // regression that moved every event's own `.value` together. Computed explicitly instead: three
    // legacy-fixture (level-defaulted, i.e. Level 1) wolves, each killed in its OWN processTick, each
    // priced at Level 1 under Fix 1's batch-start snapshot -- the third tick's own snapshot is taken
    // BEFORE that tick's mark loop lands the Lantern, so all three price identically even though the
    // Lantern's own hundred lands inside the very same tick as the third kill's combat XP.
    const expectedCombatXpTotal = MARKS_TO_UNLOCK * combatXpFor({ heroLevel: 1, enemyLevel: 1 });
    const combatXpEvents = events.filter((event) => event.type === 'xp-earned' && event.eventId !== lanternEventId);
    assert.equal(combatXpEvents.length, MARKS_TO_UNLOCK, 'R1: three ordinary kills must each earn their own combat XP');
    assert.equal(combatXpEvents.reduce((sum, e) => sum + Number(e.value), 0), expectedCombatXpTotal,
      'each of the three L1 kills must be worth exactly combatXpFor({heroLevel:1, enemyLevel:1})');
    assert.equal(bound.store.xpFor(GUEST), LANTERN_UNLOCK_XP + expectedCombatXpTotal,
      'the total is the Lantern plus exactly three L1 kills\' worth of combat XP, computed explicitly '
      + '-- never a mutable counter, and never merely self-consistent with the events above');
    assert.equal(bound.facts().filter((fact) => fact.eventId === lanternEventId).length, 1,
      'one Lantern XP row on disk, not two');
  } finally {
    bound.close();
  }
});

test('one hundred XP IS Level 2 -- the award is derived from the curve, not a number beside it', () => {
  // The relationship, not the digits: `LANTERN_UNLOCK_XP` is `xpToAdvanceFrom(LEVEL_ONE)`, so
  // re-tuning the level curve in progression/levels.js keeps the Lantern landing a child exactly on
  // Level 2. A literal 100 would have been a snapshot of that (GQ-007 hit 6).
  assert.equal(LANTERN_UNLOCK_XP, cumulativeXpForLevel(2));
  assert.equal(levelForXp(LANTERN_UNLOCK_XP), 2);
  assert.equal(levelForXp(LANTERN_UNLOCK_XP - 1), 1, 'and one point short is still Level 1');
});

test('marks alone are not LANTERN XP -- P2 adds exactly one LANTERN source and no more', () => {
  // The scope boundary, enforced rather than trusted: two marks is one short of the Lantern, so the
  // LANTERN specifically must not have paid anything yet.
  //
  // R1 UPDATE: this used to read "a wolf is not worth XP" -- that premise is now false by design.
  // Repeatable combat XP is exactly what R1 adds, through this SAME door (killAWolf), and the
  // positive half of that is asserted below rather than the old premise being quietly dropped.
  const path = tempStorePath();
  const bound = coordinatorOn(path);
  try {
    killAWolf(bound.rewards);
    killAWolf(bound.rewards);
    assert.equal(bound.store.marksFor(GUEST), 2, 'setup: two marks, one short of the Lantern');
    assert.equal(bound.store.unlockedFor(GUEST), false, 'one short of the Lantern -- P2 owns that latch, not R1');
    // R1: but two ordinary kills DO earn their own combat XP now, at the law's own price for a
    // Level-1 hero against these two (legacy-fixture, level-defaulted) Level-1 wolves.
    const expectedCombatXp = 2 * combatXpFor({ heroLevel: 1, enemyLevel: 1 });
    assert.equal(bound.store.xpFor(GUEST), expectedCombatXp,
      'R1: two ordinary kills earn their own combat XP even with no Lantern in sight');
  } finally {
    bound.close();
  }
});

// ── it cannot be earned twice ───────────────────────────────────────────────────────────────────

test('killing on past the Lantern never earns a second hundred, though R1 combat XP keeps accruing', () => {
  const path = tempStorePath();
  const bound = coordinatorOn(path);
  try {
    const lanternEventId = lanternXpEventId(`lantern:${GUEST}`);
    const lanternKillEvents = killToTheLantern(bound.rewards);
    // R1: track every kill's own combat XP so the final total can be checked exactly, through the
    // law rather than a hand-typed number -- see combatXpFor's own pins in test/progression-r1-c1.test.mjs.
    let combatXpTotal = lanternKillEvents
      .filter((event) => event.type === 'xp-earned' && event.eventId !== lanternEventId)
      .reduce((sum, event) => sum + Number(event.value), 0);

    for (let kill = 0; kill < 8; kill += 1) {
      const events = killAWolf(bound.rewards);
      assert.equal(events.filter((event) => event.eventId === lanternEventId).length, 0,
        `kill ${kill + 4} re-announced the Lantern XP the child already had`);
      assert.equal(events.filter((event) => event.type === 'lantern-unlocked').length, 0,
        `kill ${kill + 4} re-announced an unlock the child already had`);
      // R1: a genuinely new kill still earns its own combat XP -- only the LANTERN never repeats.
      const combatEvents = events.filter((event) => event.type === 'xp-earned');
      assert.equal(combatEvents.length, 1, `kill ${kill + 4} must earn exactly its own combat XP`);
      combatXpTotal += Number(combatEvents[0].value);
    }
    assert.equal(bound.store.xpFor(GUEST), LANTERN_UNLOCK_XP + combatXpTotal,
      'the Lantern never repeats; the total is the Lantern plus every kill\'s own combat XP');
  } finally {
    bound.close();
  }
});

test('two tabs on one iPad share one guest, one Lantern, and one combat-XP award per kill', () => {
  // The failure this exact shape caused once already (docs/MISTAKES.md GQ-014's first incident): two
  // heroIds map to ONE guestId, the fold credits each contributor separately, and a count read
  // between the two awards computed a different key each time -- one kill, two marks, the Lantern in
  // two kills instead of three. The XP rides that same path -- and so, since R1, does combat XP.
  const path = tempStorePath();
  const rewards = createRewardCoordinator({ rewardStorePath: path });
  const store = openRewardStore(path);
  try {
    rewards.join('tab-a', GUEST);
    rewards.join('tab-b', GUEST);

    const events = [];
    for (let kill = 0; kill < MARKS_TO_UNLOCK; kill += 1) {
      // BOTH tabs contribute to the same wolf-life, which is what makes them both contributors.
      events.push(...rewards.processTick([
        { type: 'wolf-hit', heroId: 'tab-a', remaining: 20, damage: 10 },
        { type: 'wolf-hit', heroId: 'tab-b', remaining: 10, damage: 10 },
        { type: 'wolf-defeated', heroId: 'tab-a' },
      ]));
    }

    const lanternEventId = lanternXpEventId(`lantern:${GUEST}`);
    const lanternXpEvents = events.filter((event) => event.type === 'xp-earned' && event.eventId === lanternEventId);
    assert.equal(lanternXpEvents.length, 1,
      'one child, one lantern, one award -- however many of their own tabs were swinging');

    // R1: the SAME two-tab dedupe (D4) has to hold for combat XP too -- one distinct profile, one
    // award PER KILL, never one per tab.
    const combatXpEvents = events.filter((event) => event.type === 'xp-earned' && event.eventId !== lanternEventId);
    assert.equal(combatXpEvents.length, MARKS_TO_UNLOCK,
      'exactly one combat-XP award per kill, not one per tab per kill');

    assert.equal(store.xpFor(GUEST),
      LANTERN_UNLOCK_XP + combatXpEvents.reduce((sum, event) => sum + Number(event.value), 0));
  } finally {
    rewards.close();
    store.close();
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

test('the award survives a server restart, and the restarted server does not pay the Lantern again', () => {
  // "Durable" has to mean across a process that did not write the row. This is the case a
  // hand-rolled "have I seen this id" guard gets wrong and the PRIMARY KEY does not.
  const path = tempStorePath();
  const first = coordinatorOn(path);
  killToTheLantern(first.rewards);
  const xpAfterLantern = first.store.xpFor(GUEST);
  // FIX 3 (Sonnet B adversarial pass, re-tightened): was `>= LANTERN_UNLOCK_XP`, which passes even if
  // combat XP silently stopped accruing. Computed explicitly instead, the same way and for the same
  // reason as "the third kill unlocks the Lantern..." above: three legacy-fixture (Level 1) kills,
  // each its own processTick, each priced at Level 1 under Fix 1's batch-start snapshot.
  const expectedCombatXpTotal = MARKS_TO_UNLOCK * combatXpFor({ heroLevel: 1, enemyLevel: 1 });
  assert.equal(xpAfterLantern, LANTERN_UNLOCK_XP + expectedCombatXpTotal,
    'exact total: the Lantern plus three L1 kills\' own combat XP -- not merely "at least the Lantern"');
  first.rewards.close();

  const second = coordinatorOn(path);
  try {
    assert.equal(second.store.xpFor(GUEST), xpAfterLantern, 'still on disk, unmoved by the restart itself');
    const events = killAWolf(second.rewards);
    const lanternEventId = lanternXpEventId(`lantern:${GUEST}`);
    assert.equal(events.filter((event) => event.eventId === lanternEventId).length, 0,
      'a restarted server must not re-award the Lantern it is reading off its own disk');
    // R1: this fourth kill is a genuinely NEW kill and must still earn its own combat XP.
    const combatXpEvents = events.filter((event) => event.type === 'xp-earned');
    assert.equal(combatXpEvents.length, 1, 'a real new kill after restart still earns combat XP');
    assert.equal(second.store.xpFor(GUEST), xpAfterLantern + Number(combatXpEvents[0].value));
  } finally {
    second.close();
  }
});

// ── it never half-lands ─────────────────────────────────────────────────────────────────────────

// ── it never half-lands ─────────────────────────────────────────────────────────────────────────
//
// THE STOP CONDITION THE BRIEF NAMES, in as many words: "a transient ordering/write failure must not
// create a normal state where a newly-earned Lantern is permanently present but its deterministic P2
// XP can never be recovered". Two apply() calls in sequence create exactly that state -- the unlock
// commits, the process dies, and the child owns a Lantern worth nothing FOREVER, because the unlock
// is a latch and will never fire again.
//
// Two tests, because the property has two halves that fail differently and neither covers the other:
// the STORE has to be able to write a pair atomically, and the COORDINATOR has to actually use that
// ability rather than calling apply() twice.

test('the store refuses a half-written pair: a bad member costs the whole batch', () => {
  const path = tempStorePath();
  const store = openRewardStore(path);
  try {
    assert.throws(() => store.applyAll([
      { guestId: GUEST, type: 'lantern-unlocked', eventId: `lantern:${GUEST}` },
      // Malformed amount: refused by the same shared reader the fold uses.
      { guestId: GUEST, type: 'xp-earned', eventId: 'xp:bad', value: '-100' },
    ]), /xp amount/i);
    assert.deepEqual(store.profileFactsFor(GUEST), [],
      'the Lantern landed without its XP -- exactly the permanently-worthless state the batch prevents');
  } finally {
    store.close();
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

test('the coordinator hands the pair to the store as ONE batch, not two applies', () => {
  // A SOURCE check, and deliberately so: the coordinator opens its own store connection, so there is
  // no seam a test can wrap to observe the call shape -- and the observable end state is identical
  // whether the pair was written in one transaction or in two lucky writes. What can regress is
  // somebody splitting the batch back apart, and that is visible in the source (the same technique
  // test/feedback.test.mjs uses to pin ENCOUNTER_EVENT_TYPES against encounter.js's own text).
  // E1 C2's gameServer.mjs is a compatibility adapter; the implementation authority is the core.
  const source = readFileSync(new URL('../net/gameServerCore.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const body = /function applyLanternUnlock\([\s\S]*?\n  \}/.exec(source);
  assert.ok(body, 'applyLanternUnlock has moved or been renamed -- this guard cannot see it any more');

  assert.ok(/store\.applyAll\(/.test(body[0]),
    'the Lantern and its XP must go through applyAll, which is the only transactional write');
  assert.equal((body[0].match(/store\.apply\(/g) ?? []).length, 0,
    'a bare store.apply() here writes one fact without the other, which is the state the brief '
    + 'names as a stop condition');
});

test('after the pair lands, both facts are present -- never one alone', () => {
  const path = tempStorePath();
  const bound = coordinatorOn(path);
  try {
    killToTheLantern(bound.rewards);
    const facts = bound.facts();
    assert.equal(facts.filter((fact) => fact.type === 'lantern-unlocked').length, 1);
    // R1: scoped to the Lantern's own xp-earned row -- three ordinary kills now durably record their
    // own combat-xp rows too (see the "third kill" test above), so a bare type filter would over-count.
    assert.equal(facts.filter((fact) => fact.eventId === lanternXpEventId(`lantern:${GUEST}`)).length, 1);
  } finally {
    bound.close();
  }
});

test('a Lantern that predates the XP law is repaired rather than left worthless', () => {
  // A guest whose unlock was written before P2 existed holds a Lantern and no XP. Because the award
  // is a pure function of the facts on record, "award" and "repair" are one operation and this needs
  // no migration anywhere -- the next time the check runs, they are owed it.
  const path = tempStorePath();
  const seeding = openRewardStore(path);
  for (let mark = 0; mark < MARKS_TO_UNLOCK; mark += 1) {
    seeding.apply({ guestId: GUEST, type: 'mark-earned', eventId: `legacy:mark:${mark}` });
  }
  seeding.apply({ guestId: GUEST, type: 'lantern-unlocked', eventId: `lantern:${GUEST}` });
  assert.equal(seeding.xpFor(GUEST), 0, 'setup: a pre-P2 profile -- Lantern, no XP');
  seeding.close();

  const rewards = createRewardCoordinator({ rewardStorePath: path });
  const store = openRewardStore(path);
  try {
    rewards.join(HERO, GUEST);
    const events = killAWolf(rewards);
    const lanternEventId = lanternXpEventId(`lantern:${GUEST}`);
    const lanternXpEvents = events.filter((event) => event.type === 'xp-earned' && event.eventId === lanternEventId);
    assert.equal(lanternXpEvents.length, 1, 'the child is owed the level their Lantern was always worth');
    assert.equal(events.filter((event) => event.type === 'lantern-unlocked').length, 0,
      'but NOT re-told about an unlock they watched happen a week ago');
    // R1: the SAME kill that triggers the repair also earns its own combat XP, priced at whatever
    // level the repair itself just bought -- through the law, never restated as a number here.
    const combatXpEvents = events.filter((event) => event.type === 'xp-earned' && event.eventId !== lanternEventId);
    assert.equal(combatXpEvents.length, 1, 'the kill that triggered the repair still earns combat XP');
    assert.equal(store.xpFor(GUEST), LANTERN_UNLOCK_XP + Number(combatXpEvents[0].value));

    // ...and the LANTERN never again -- though a further kill legitimately earns further combat XP.
    const again = killAWolf(rewards);
    assert.equal(again.filter((event) => event.eventId === lanternEventId).length, 0);
    assert.equal(again.filter((event) => event.type === 'xp-earned').length, 1,
      'a genuinely new kill still earns its own combat XP');
  } finally {
    rewards.close();
    store.close();
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

// ── the device and the server hold ONE lantern between them ─────────────────────────────────────

test('a device restore that brings its own Lantern does not buy a second hundred', () => {
  // THE UNION CASE, and the one a naive derived id gets wrong. A child who unlocked offline holds
  // `lantern-unlocked:<profileId>`; the server mints `lantern:<guestId>`. A profile can legitimately
  // carry BOTH after a restore, and the Lantern is a latch: one child, one unlock, one award. Paying
  // per identity would hand a reconnecting child 200 XP for one lantern.
  const path = tempStorePath();
  const rewards = createRewardCoordinator({ rewardStorePath: path });
  const store = openRewardStore(path);
  try {
    rewards.join(HERO, GUEST);
    // The device teaches back what it earned with no network, XP fact and all.
    const deviceLanternId = `lantern-unlocked:${GUEST}`;
    rewards.restoreProfileFacts(HERO, [
      { eventId: `offline:mark:1`, type: 'mark-earned' },
      { eventId: `offline:mark:2`, type: 'mark-earned' },
      { eventId: `offline:mark:3`, type: 'mark-earned' },
      { eventId: deviceLanternId, type: 'lantern-unlocked' },
      { eventId: lanternXpEventId(deviceLanternId), type: 'xp-earned', value: String(LANTERN_UNLOCK_XP) },
    ]);
    assert.equal(store.xpFor(GUEST), LANTERN_UNLOCK_XP, 'setup: the device brought its own hundred');

    // Now they play online. The mark threshold is already met, so the server writes its OWN lantern.
    const events = killAWolf(rewards);
    const lanternReannounced = events.some((event) => event.eventId === lanternXpEventId(deviceLanternId)
      || event.eventId === lanternXpEventId(`lantern:${GUEST}`) || event.type === 'lantern-unlocked');
    assert.equal(lanternReannounced, false,
      'the server must not pay again for a lantern the device already paid for');
    // R1: this online kill is genuinely new and still earns its own combat XP even though the Lantern
    // is already fully spent.
    const combatXpEvents = events.filter((event) => event.type === 'xp-earned');
    assert.equal(combatXpEvents.length, 1, 'a real online kill still earns combat XP');
    assert.equal(store.xpFor(GUEST), LANTERN_UNLOCK_XP + Number(combatXpEvents[0].value),
      'one lantern, one hundred, two names, plus this kill\'s own combat XP');
    assert.equal(levelForXp(store.xpFor(GUEST)), 2, 'still Level 2');
  } finally {
    rewards.close();
    store.close();
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

test('a device restore arriving AFTER the server already paid does not buy a second hundred', () => {
  // THE OTHER ORDER, and it is not symmetric -- which is exactly why it needs its own test.
  //
  // The two lantern identities do not sort the way you would guess: `lantern-unlocked:<profileId>`
  // sorts BEFORE `lantern:<guestId>`, because '-' precedes ':'. So when the DEVICE paid first, the id
  // it paid under is also the canonical one, and an implementation that only checked the canonical
  // lantern would still be right by luck. When the SERVER pays first the luck runs out: the XP on
  // record is named from the non-canonical lantern, a canonical-only check reads "not paid", and the
  // child is handed a second hundred for one lantern.
  //
  // Found by sabotaging the guard and watching the first restore test stay green (GQ-022 -- an
  // instrument is not evidence until it has been shown to fail). This is the case that failure was
  // hiding.
  const path = tempStorePath();
  const bound = coordinatorOn(path);
  try {
    killToTheLantern(bound.rewards);
    const xpAfterLantern = bound.store.xpFor(GUEST);
    assert.ok(xpAfterLantern >= LANTERN_UNLOCK_XP, 'setup: the server paid the Lantern first');

    // Now the same child's device teaches back the lantern IT earned offline, under its own name.
    bound.rewards.restoreProfileFacts(HERO, [
      { eventId: `lantern-unlocked:${GUEST}`, type: 'lantern-unlocked' },
    ]);
    const events = killAWolf(bound.rewards);

    const lanternReannounced = events.some((event) => event.type === 'lantern-unlocked'
      || event.eventId === lanternXpEventId(`lantern:${GUEST}`)
      || event.eventId === lanternXpEventId(`lantern-unlocked:${GUEST}`));
    assert.equal(lanternReannounced, false,
      'a second lantern NAME is not a second lantern -- the Lantern is a latch, one child, one award');
    // R1: this fourth kill is genuinely new and still earns its own combat XP.
    const combatXpEvents = events.filter((event) => event.type === 'xp-earned');
    assert.equal(combatXpEvents.length, 1, 'a real new kill still earns combat XP');
    assert.equal(bound.store.xpFor(GUEST), xpAfterLantern + Number(combatXpEvents[0].value));
  } finally {
    bound.close();
  }
});

test('the two lantern identities do not sort the way the happy path assumes', () => {
  // Pinned as its own fact because the test above rests on it, and because a reader who assumes
  // `lantern:` sorts first would conclude that test is redundant with the one before it.
  assert.ok(`lantern-unlocked:${GUEST}` < `lantern:${GUEST}`,
    "'-' precedes ':', so the DEVICE's lantern id is the canonical one -- which is why a guard that "
    + 'only checks the canonical lantern passes the device-paid-first case and fails this one');
});

test('the union law itself: the same facts in any order give the same one award', () => {
  // Order-independence is what makes it safe for three callers to ask this question at three
  // different moments against three different orderings of the same grow-only set.
  const lanternA = { eventId: 'lantern:g', type: 'lantern-unlocked' };
  const lanternB = { eventId: 'lantern-unlocked:p', type: 'lantern-unlocked' };
  const owed = pendingLanternXpFact([lanternA, lanternB]);
  assert.ok(owed, 'a profile with a lantern and no XP is owed one');
  assert.deepEqual(pendingLanternXpFact([lanternB, lanternA]), owed,
    'the canonical choice must not depend on which store was read first');
  for (const paid of [[lanternA, lanternB, owed], [owed, lanternB, lanternA], [lanternB, owed]]) {
    assert.equal(pendingLanternXpFact(paid), null,
      `already paid, in any order: ${JSON.stringify(paid.map((f) => f.eventId))}`);
  }
  assert.equal(pendingLanternXpFact([]), null, 'no lantern, no award');
  assert.equal(pendingLanternXpFact([{ eventId: 'm', type: 'mark-earned' }]), null);

  // Paid under the NON-canonical lantern: the case a canonical-only check gets wrong, at the level of
  // the pure function rather than through a store. Both orderings, so neither can pass by luck.
  const paidUnderB = { eventId: lanternXpEventId(lanternB.eventId), type: 'xp-earned', value: '100' };
  const paidUnderA = { eventId: lanternXpEventId(lanternA.eventId), type: 'xp-earned', value: '100' };
  assert.equal(pendingLanternXpFact([lanternA, lanternB, paidUnderA]), null,
    'paid under lanternA counts, whichever of the two sorts first');
  assert.equal(pendingLanternXpFact([lanternA, lanternB, paidUnderB]), null,
    'and paid under lanternB counts too');
});

test('no mutable XP total exists anywhere -- the number is always folded from facts', () => {
  // Reward-basis invariant 5 of the progression contract, and the property the whole append-only
  // design rests on. Checked by DERIVING the answer two independent ways from the same rows and
  // insisting they agree: the store's own xpFor, and the client's foldFacts over the facts it
  // publishes. A stored counter would be a third answer, free to drift from both.
  const path = tempStorePath();
  const bound = coordinatorOn(path);
  try {
    killToTheLantern(bound.rewards);
    const facts = bound.facts();
    const total = bound.store.xpFor(GUEST);
    assert.equal(foldFacts(facts).xp, total,
      'the device fold and the store disagree about a total neither of them stores');
    // Fold the same facts twice over: a count that moves when you look at it twice is a counter.
    // R1: the total is the Lantern plus every kill's own combat XP now, so this compares against the
    // ACTUAL total (asserted precisely elsewhere) rather than the Lantern's amount alone.
    assert.equal(foldFacts([...facts, ...facts]).xp, total,
      'folding a duplicated fact set must not double the total -- the union collapses it');
  } finally {
    bound.close();
  }
});

// ── and it reaches the fight ────────────────────────────────────────────────────────────────────
//
// GQ-013 in one line: "a reward the rules never read is a lie with a ceremony attached." The rest of
// this file proves a hundred XP is durably recorded. These prove it makes the child stronger.

test('the level the Lantern buys reaches the server-hosted fight, on both stats', () => {
  const path = tempStorePath();
  const bound = coordinatorOn(path);
  try {
    const before = bound.rewards.heroStatsFor(HERO);
    assert.deepEqual({ maxHp: before.maxHp, heroDamage: before.heroDamage },
      { maxHp: LEVEL_1_STARTER_STATS.maxHp, heroDamage: LEVEL_1_STARTER_STATS.heroDamage },
      'setup: a fresh child is a Level-1 starter hero');

    killToTheLantern(bound.rewards);

    const after = bound.rewards.heroStatsFor(HERO);
    assert.equal(after.level, 2, 'the Lantern made them Level 2');
    assert.equal(after.maxHp, resolvedMaxHp(2));
    assert.equal(after.heroDamage, resolvedHeroDamage(2, STARTER_SWORD_ID));
    assert.ok(after.maxHp > before.maxHp, 'a bigger body');
    assert.ok(after.heroDamage > before.heroDamage, 'and a harder blow');
  } finally {
    bound.close();
  }
});

test('the stronger hero is what the WOLF fight actually swings and what the wolf actually bites', () => {
  // Through createSimulation, the real server-hosted fight, driven with the coordinator's own
  // lookup -- so what is measured is the wire from a durable row to a hit point coming off a wolf.
  const path = tempStorePath();
  const bound = coordinatorOn(path);
  try {
    killToTheLantern(bound.rewards);

    const sim = createSimulation({ heroStatsFor: (id) => bound.rewards.heroStatsFor(id) });
    const player = sim.addPlayer(HERO, { x: 2.5, z: 7 });
    // Rebind the coordinator to the simulation's own player id, which is what the real server does.
    bound.rewards.join(player.id, GUEST);

    sim.step(0.05);
    const body = sim.encounterSnapshot().heroes[player.id];
    assert.equal(body.maxHp, resolvedMaxHp(2), 'the level reached the body');
    assert.ok(body.maxHp > HERO_MAX_HP, 'strictly bigger than a Level-1 hero');
    assert.equal(body.hp, body.maxHp, 'and the new health is filled, not an empty promise');
  } finally {
    bound.close();
  }
});

test('a levelled hero and a level-1 hero are different heroes, and gear stacks on top', () => {
  // The independence the whole model rests on: a level is worth the same whatever is held, and a
  // weapon is worth the same at whatever level. If either ever cancels the other, one of the two
  // reward tracks has quietly stopped mattering.
  const l1Starter = resolveHeroStats({ equippedWeaponId: STARTER_SWORD_ID });
  const l2Starter = resolveHeroStats({ totalXp: LANTERN_UNLOCK_XP, equippedWeaponId: STARTER_SWORD_ID });
  const l1Blade = resolveHeroStats({ equippedWeaponId: WILDWOOD_BLADE_ID });
  const l2Blade = resolveHeroStats({ totalXp: LANTERN_UNLOCK_XP, equippedWeaponId: WILDWOOD_BLADE_ID });

  assert.equal(l2Starter.heroDamage - l1Starter.heroDamage, l2Blade.heroDamage - l1Blade.heroDamage,
    'the level is worth the same whichever sword is in the hand');
  assert.equal(l1Blade.heroDamage - l1Starter.heroDamage, l2Blade.heroDamage - l2Starter.heroDamage,
    'and the sword is worth the same at either level');
});

test('an equip-only connection has no XP, because it has no durable identity to have earned any', () => {
  const path = tempStorePath();
  const rewards = createRewardCoordinator({ rewardStorePath: path });
  try {
    rewards.join('ephemeral-hero', null);
    const stats = rewards.heroStatsFor('ephemeral-hero');
    assert.equal(stats.level, 1, 'zero is the truth for it, not a fallback');
    assert.equal(rewards.rewardsFor(['ephemeral-hero'])['ephemeral-hero'].xp, 0);
  } finally {
    rewards.close();
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

test('the wire carries the TOTAL, so the level on it can never disagree with the XP beside it', () => {
  const path = tempStorePath();
  const bound = coordinatorOn(path);
  try {
    killToTheLantern(bound.rewards);
    const block = bound.rewards.rewardsFor([HERO])[HERO];
    // R1: the total on the wire is the Lantern plus the same three kills' own combat XP -- compared
    // against the store's own total (asserted precisely elsewhere) rather than the Lantern alone.
    assert.equal(block.xp, bound.store.xpFor(GUEST), 'the wire carries the SAME total the store holds');
    assert.ok(block.xp >= LANTERN_UNLOCK_XP, 'at least the Lantern\'s own hundred is in it');
    assert.equal(block.lanternUnlocked, true);
    // A level is deliberately NOT on the wire: whichever side is asking derives it from this total
    // through the one authority, so there is no second number to contradict (GQ-007).
    assert.equal(block.level, undefined);
    assert.equal(levelForXp(block.xp), 2);
  } finally {
    bound.close();
  }
});

// A guard against the seam quietly reverting: the fight must be handed resolved NUMBERS, never a
// level or an item id, because combat/ is not allowed to know either exists.
test('the fight is handed numbers, not a level and not an item id', () => {
  const path = tempStorePath();
  const bound = coordinatorOn(path);
  try {
    killToTheLantern(bound.rewards);
    const stats = bound.rewards.heroStatsFor(HERO);
    assert.equal(typeof stats.maxHp, 'number');
    assert.equal(typeof stats.heroDamage, 'number');
    assert.ok(Number.isSafeInteger(stats.maxHp) && Number.isSafeInteger(stats.heroDamage),
      'the fight counts in exact integers -- a float body is what the rescale existed to avoid');
  } finally {
    bound.close();
  }
});

// Referenced so an unused import cannot silently accumulate as this file grows.
test('the swing contact time is unchanged by any of this', () => {
  assert.ok(SWING_CONTACT_SECONDS > 0,
    'P2 normalizes stat SCALE only -- AI, timing and reach are explicitly out of scope');
});