// R1-C1: the one combat-XP law, its durable identity, and its attribution rule -- the four pieces
// docs/briefs/PROGRESSION_R1_COMBAT_XP_LOOT_REWARD_SEAM.md's checkpoint plan names for this half of
// the package. Loot (C2) is deliberately absent from this file; nothing here rolls randomness or
// touches progression/items.js.
//
// Driven the same way test/lantern-xp-award.test.mjs and test/reward-wiring.test.mjs already are: the
// real reward coordinator over a real store on disk, fed synthetic wolf-hit/wolf-defeated events
// directly rather than through a played-out fight, because the fold and the pricing are what this
// file is proving, not combat/encounter.js's own timing (docs/MISTAKES.md GQ-015 -- cover the real
// producer somewhere; test/e1-server-wire-reward.test.mjs and test/reward-wiring.test.mjs already do
// for the fold-from-a-real-fight half).

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createRewardCoordinator } from '../net/gameServer.mjs';
import { openRewardStore } from '../net/rewardStore.mjs';
import {
  BASE_COMBAT_XP,
  COMBAT_XP_PER_ENEMY_LEVEL,
  LEVEL_GAP_MULTIPLIERS,
  MAX_COMBAT_XP_PER_KILL,
  ZERO_REWARD_LEVEL_GAP,
  baseCombatXp,
  combatXpEventId,
  combatXpFor,
  levelGapMultiplier,
} from '../public/src/rewards/combatRewards.js';
import { MARKS_TO_UNLOCK, createRewardLedger, foldEvents } from '../public/src/rewards/marks.js';
import { levelForXp } from '../public/src/progression/levels.js';
import { resolvedHeroDamage, resolvedMaxHp } from '../public/src/progression/heroStats.js';
import { STARTER_SWORD_ID } from '../public/src/progression/items.js';
import {
  LANTERN_UNLOCK_XP,
  isClientRestorableProfileFact,
  lanternXpEventId,
} from '../public/src/progression/facts.js';
import { WOLF_LEVEL_STATS } from '../public/src/combat/enemyStats.js';
import {
  createLifeIdMinter,
  createOfflineProgress,
} from '../public/src/rewards/offlineProgress.js';
import { createProfileStore } from '../public/src/progression/profiles.js';

const GUEST = 'p-r1c1-1111-2222';

function tempDbPath(prefix) {
  return join(mkdtempSync(join(tmpdir(), prefix)), 'rewards.db');
}

function coordinatorOn(path) {
  const rewards = createRewardCoordinator({ rewardStorePath: path });
  const store = openRewardStore(path);
  return {
    rewards,
    store,
    close() {
      rewards.close();
      store.close();
      rmSync(join(path, '..'), { recursive: true, force: true });
    },
  };
}

/** One synthetic wolf-life, priceable and mark-earning, through the real fold and coordinator. */
function killWolf(rewards, { heroId = 'hero-1', enemyId = 'wolf-a', level = 1 } = {}) {
  return rewards.processTick([
    { type: 'wolf-hit', enemyId, kind: 'wolf', level, heroId, remaining: 20, damage: 10 },
    { type: 'wolf-defeated', enemyId, kind: 'wolf', level, heroId },
  ]);
}

// ── D2: the pure law itself ─────────────────────────────────────────────────────────────────────

test('baseCombatXp is 10 + 5*enemyLevel, per the brief\'s starting tuning target', () => {
  assert.equal(BASE_COMBAT_XP, 10);
  assert.equal(COMBAT_XP_PER_ENEMY_LEVEL, 5);
  assert.equal(baseCombatXp(1), 15);
  assert.equal(baseCombatXp(2), 20);
  assert.equal(baseCombatXp(4), 30);
});

test('baseCombatXp rejects a malformed enemy level', () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, '1', null, undefined]) {
    assert.throws(() => baseCombatXp(bad), TypeError, `${JSON.stringify(bad)} must be refused`);
  }
});

test('the level-gap multiplier table covers every named band, including both open ends', () => {
  assert.deepEqual(LEVEL_GAP_MULTIPLIERS.map((e) => e.gap), [-2, -1, 0, 1, 2]);
  assert.equal(levelGapMultiplier(-10), 1.25, 'gap <= -2 clamps to the lowest tabled multiplier');
  assert.equal(levelGapMultiplier(-2), 1.25);
  assert.equal(levelGapMultiplier(-1), 1.10);
  assert.equal(levelGapMultiplier(0), 1.00);
  assert.equal(levelGapMultiplier(1), 0.60);
  assert.equal(levelGapMultiplier(2), 0.25);
  assert.equal(levelGapMultiplier(3), 0, 'ZERO_REWARD_LEVEL_GAP itself is already zero');
  assert.equal(levelGapMultiplier(100), 0, 'gap >= +3 stays zero arbitrarily far out');
  assert.equal(ZERO_REWARD_LEVEL_GAP, 3, 'derived from the table\'s own highest tabled gap, plus one');
});

test('levelGapMultiplier rejects a non-integer gap', () => {
  for (const bad of [1.5, NaN, Infinity, '1', null]) {
    assert.throws(() => levelGapMultiplier(bad), TypeError);
  }
});

test('combatXpFor: L1 hero vs L1/L2/L4 wolves, computed and pinned', () => {
  assert.equal(combatXpFor({ heroLevel: 1, enemyLevel: 1 }), 15, 'same level, gap 0: base * 1.00');
  assert.equal(combatXpFor({ heroLevel: 1, enemyLevel: 2 }), 22, 'gap -1: 20 * 1.10 = 22');
  assert.equal(combatXpFor({ heroLevel: 1, enemyLevel: 4 }), 38,
    'gap -3 clamps to 1.25: 30 * 1.25 = 37.5, Math.round -> 38 (COMPUTED, not assumed)');
});

test('combatXpFor: a higher hero level against a fixed L1 wolf, computed and pinned', () => {
  assert.equal(combatXpFor({ heroLevel: 2, enemyLevel: 1 }), 9, 'gap +1: 15 * 0.60 = 9');
  assert.equal(combatXpFor({ heroLevel: 3, enemyLevel: 1 }), 4, 'gap +2: 15 * 0.25 = 3.75 -> 4');
  assert.equal(combatXpFor({ heroLevel: 4, enemyLevel: 1 }), 0, 'gap +3: zero reward, bounded');
  assert.equal(combatXpFor({ heroLevel: 5, enemyLevel: 2 }), 0, 'gap +3 again, a different pair');
});

test('combatXpFor is non-increasing as hero level rises against a fixed enemy level, '
  + 'and reaches exactly 0 at a bounded finite gap', () => {
  const enemyLevel = 3;
  let previous = Infinity;
  let sawZero = false;
  for (let heroLevel = 1; heroLevel <= enemyLevel + 10; heroLevel += 1) {
    const xp = combatXpFor({ heroLevel, enemyLevel });
    assert.ok(xp <= previous, `xp rose from ${previous} to ${xp} as hero level increased to ${heroLevel}`);
    previous = xp;
    if (heroLevel - enemyLevel === ZERO_REWARD_LEVEL_GAP) {
      assert.equal(xp, 0, 'the bounded gap must be exactly zero, not merely small');
      sawZero = true;
    }
    if (heroLevel - enemyLevel > ZERO_REWARD_LEVEL_GAP) assert.equal(xp, 0, 'stays zero past the bound');
  }
  assert.ok(sawZero, 'the loop must actually have reached the bounded gap to mean anything');
});

test('combatXpFor never returns negative/NaN/fractional, across a wide sweep', () => {
  for (let enemyLevel = 1; enemyLevel <= 20; enemyLevel += 1) {
    for (let heroLevel = 1; heroLevel <= 20; heroLevel += 1) {
      const xp = combatXpFor({ heroLevel, enemyLevel });
      assert.ok(Number.isSafeInteger(xp) && xp >= 0,
        `combatXpFor({heroLevel:${heroLevel}, enemyLevel:${enemyLevel}}) = ${xp} is not a safe non-negative integer`);
    }
  }
});

test('combatXpFor rejects malformed levels rather than coercing them', () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, '1', null, undefined, {}]) {
    assert.throws(() => combatXpFor({ heroLevel: bad, enemyLevel: 1 }), TypeError,
      `heroLevel ${JSON.stringify(bad)} must be refused`);
    assert.throws(() => combatXpFor({ heroLevel: 1, enemyLevel: bad }), TypeError,
      `enemyLevel ${JSON.stringify(bad)} must be refused`);
  }
});

test('combatXpEventId is `xp:combat:<profileId>:<lifeId>`, nothing mutable in it (GQ-014)', () => {
  assert.equal(combatXpEventId('guest-x', 'life-y'), 'xp:combat:guest-x:life-y');
  // Computed twice, from the same two durable inputs, must be the same answer -- GQ-014's own test.
  assert.equal(combatXpEventId('guest-x', 'life-y'), combatXpEventId('guest-x', 'life-y'));
});

test('MAX_COMBAT_XP_PER_KILL is derived from the law itself, not a typed number', () => {
  // Sonnet B's adversarial pass, Ruling 2: the true ceiling is LEVEL_ONE (which always minimizes
  // heroLevel-enemyLevel, since combatXpFor is non-increasing in heroLevel) against the single
  // highest-paying currently authored enemy level -- recomputed here the same way, independently of
  // the module's own derivation, so a change to either the law or the authored level table cannot
  // silently drift the two apart.
  assert.equal(MAX_COMBAT_XP_PER_KILL, combatXpFor({ heroLevel: 1, enemyLevel: 4 }));
  assert.equal(MAX_COMBAT_XP_PER_KILL, 38, 'pinned against the CURRENT authored table -- computed above, not guessed');

  // The ceiling is scoped to CURRENTLY SUPPORTED enemy levels (combat/enemyStats.js's own table),
  // never a global bound over an arbitrary/unauthored enemyLevel -- a real kill can only ever be
  // against an authored enemy, so that is the only range the ceiling has to hold across. Swept over
  // every hero level a real kill could occur at, against only the authored enemy levels.
  const authoredLevels = Object.values(WOLF_LEVEL_STATS).map((stats) => stats.level);
  assert.deepEqual(authoredLevels.slice().sort((a, b) => a - b), [1, 2, 4],
    'sanity: this pins the CURRENT authored table this test reads, so a future level change is visible here');
  for (const enemyLevel of authoredLevels) {
    for (let heroLevel = 1; heroLevel <= 20; heroLevel += 1) {
      assert.ok(combatXpFor({ heroLevel, enemyLevel }) <= MAX_COMBAT_XP_PER_KILL,
        `combatXpFor({heroLevel:${heroLevel}, enemyLevel:${enemyLevel}}) exceeded the ceiling -- `
        + 'the ceiling is only meaningful if nothing ever prices above it for a real, authored kill');
    }
  }
});

test('the law imports no POWER module and rolls no randomness of its own (structural)', () => {
  // The same technique test/combat-purity.test.mjs uses against public/src/combat/: read the real
  // source rather than trust a comment, because a comment does not fail a build when it goes stale.
  const source = readFileSync(new URL('../public/src/rewards/combatRewards.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.ok(!/progression\/power(\.js)?['"]/.test(source),
    'combatRewards.js must never import progression/power.js -- POWER is downstream presentation only');
  assert.ok(!/\bMath\.random\b/.test(source), 'the law itself must not roll dice; RNG is injected elsewhere');
  assert.ok(!/\btotalXp\b/.test(source),
    'the law must not read an XP total -- only heroLevel/enemyLevel, resolved by the caller');
  assert.ok(!/\bkillCount\b|\bkills\b/.test(source), 'the law must not read a kill count');
});

// ── D1: marks.js's generalized fold ─────────────────────────────────────────────────────────────

function hit(enemyId, level, heroId) {
  return { type: 'wolf-hit', enemyId, kind: 'wolf', level, heroId };
}
function defeated(enemyId, level, heroId) {
  return { type: 'wolf-defeated', enemyId, kind: 'wolf', level, heroId };
}

test('mark awards carry enemyId and the level of the enemy that actually died', () => {
  const { awards } = foldEvents(createRewardLedger(), [
    hit('wolf-a', 3, 'hero-1'),
    defeated('wolf-a', 3, 'hero-1'),
  ], { mintLifeId: () => 'life-a' });
  assert.equal(awards.length, 1);
  assert.equal(awards[0].enemyId, 'wolf-a');
  assert.equal(awards[0].enemyLevel, 3);
  // Existing fields, byte-identical to before D1.
  assert.equal(awards[0].heroId, 'hero-1');
  assert.equal(awards[0].type, 'mark-earned');
  assert.equal(awards[0].lifeId, 'life-a');
  assert.equal(awards[0].eventId, 'mark:hero-1:life-a');
});

test('two interleaved enemies of different levels price independently', () => {
  let ledger = createRewardLedger();
  const first = foldEvents(ledger, [
    hit('wolf-a', 1, 'hero-1'),
    hit('wolf-b', 4, 'hero-2'),
    defeated('wolf-a', 1, 'hero-1'),
  ], { mintLifeId: () => 'life-a' });
  ledger = first.ledger;
  assert.deepEqual(first.awards.map((a) => [a.heroId, a.enemyId, a.enemyLevel]), [['hero-1', 'wolf-a', 1]]);

  const second = foldEvents(ledger, [
    defeated('wolf-b', 4, 'hero-2'),
  ], { mintLifeId: () => 'life-b' });
  assert.deepEqual(second.awards.map((a) => [a.heroId, a.enemyId, a.enemyLevel]), [['hero-2', 'wolf-b', 4]]);
});

test('a pre-E1 legacy fixture with no level field defaults to Level 1, historically what "Wolf" meant', () => {
  const { awards } = foldEvents(createRewardLedger(), [
    { type: 'wolf-hit', heroId: 'hero-1' },
    { type: 'wolf-defeated', heroId: 'hero-1' },
  ]);
  assert.equal(awards.length, 1);
  assert.equal(awards[0].enemyLevel, 1);
});

test('existing mark award behaviour is unchanged: participation credit and per-life eventIds', () => {
  const events = [hit('wolf-a', 2, 'hero-a'), hit('wolf-a', 2, 'hero-b'), defeated('wolf-a', 2, 'hero-b')];
  const { awards } = foldEvents(createRewardLedger(), events);
  const heroIds = awards.filter((a) => a.type === 'mark-earned').map((a) => a.heroId).sort();
  assert.deepEqual(heroIds, ['hero-a', 'hero-b'], 'kinder-than-killing-blow participation credit, unchanged');
});

// ── D3: durable identity reservation ────────────────────────────────────────────────────────────

test('D3: a combat-xp identity is reserved to its owning profile under client restore (H1)', () => {
  const ownFact = { eventId: combatXpEventId('profile-a', 'life-1'), type: 'xp-earned', value: '15' };
  assert.equal(isClientRestorableProfileFact(ownFact, 'profile-a'), true,
    'the rightful profile may restore its own combat-xp fact');
  assert.equal(isClientRestorableProfileFact(ownFact, 'profile-b'), false,
    'a sibling profile must not be able to reserve/restore another profile\'s combat-xp identity');
});

// ── D4: server adjudication ─────────────────────────────────────────────────────────────────────

test('two different guests contributing to one wolf each get their own full XP, not split', () => {
  const path = tempDbPath('galaquest-r1c1-split-');
  const bound = coordinatorOn(path);
  try {
    bound.rewards.join('hero-a', 'guest-aaaaaaaa');
    bound.rewards.join('hero-b', 'guest-bbbbbbbb');
    const events = bound.rewards.processTick([
      hit('wolf-a', 1, 'hero-a'),
      hit('wolf-a', 1, 'hero-b'),
      defeated('wolf-a', 1, 'hero-a'),
    ]);
    const xpEvents = events.filter((e) => e.type === 'xp-earned');
    assert.equal(xpEvents.length, 2, 'both contributing guests get their own award');
    const expected = String(combatXpFor({ heroLevel: 1, enemyLevel: 1 }));
    assert.ok(xpEvents.every((e) => e.value === expected), 'neither award is a split fraction of the other');
    assert.equal(bound.store.xpFor('guest-aaaaaaaa'), 15);
    assert.equal(bound.store.xpFor('guest-bbbbbbbb'), 15);
  } finally {
    bound.close();
  }
});

test('two heroIds mapped to one guest earn exactly one xp-earned row for one enemy life', () => {
  const path = tempDbPath('galaquest-r1c1-onetab-');
  const bound = coordinatorOn(path);
  try {
    bound.rewards.join('tab-a', GUEST);
    bound.rewards.join('tab-b', GUEST);
    const events = bound.rewards.processTick([
      hit('wolf-a', 1, 'tab-a'),
      hit('wolf-a', 1, 'tab-b'),
      defeated('wolf-a', 1, 'tab-a'),
    ]);
    const xpEvents = events.filter((e) => e.type === 'xp-earned');
    assert.equal(xpEvents.length, 1, 'one distinct profile, one award -- not two rolls of one fight');
    assert.equal(xpEvents[0].heroId, 'tab-a', 'the lower heroId by string compare is the addressed one');
    assert.equal(bound.store.xpFor(GUEST), 15, 'not double-counted for the two tabs');
  } finally {
    bound.close();
  }
});

test('replaying the exact same drained events awards no second combat-XP fact', () => {
  const path = tempDbPath('galaquest-r1c1-replay-');
  const bound = coordinatorOn(path);
  try {
    bound.rewards.join('hero-1', GUEST);
    const events = [hit('wolf-a', 1, 'hero-1'), defeated('wolf-a', 1, 'hero-1')];
    const first = bound.rewards.processTick(events);
    assert.equal(first.filter((e) => e.type === 'xp-earned').length, 1);

    // The SAME array/objects handed back a second time -- what a bug that forgot to drain a queue,
    // or a forced double-apply, would actually produce (rewards-marks.test.mjs uses the identical
    // shape for the mark half of this exact property).
    const replay = bound.rewards.processTick(events);
    assert.equal(replay.filter((e) => e.type === 'xp-earned').length, 0,
      'a replayed batch must collapse to no new award');
    assert.equal(bound.store.xpFor(GUEST), 15, 'the total must not move on replay');
  } finally {
    bound.close();
  }
});

test('the store collapses a duplicate combat-xp eventId to one durable fact', () => {
  const path = tempDbPath('galaquest-r1c1-storedupe-');
  const store = openRewardStore(path);
  try {
    const eventId = combatXpEventId(GUEST, 'life-store-dupe');
    const award = { guestId: GUEST, heroId: 'hero-1', type: 'xp-earned', eventId, value: '15' };
    assert.equal(store.apply(award).applied, true);
    assert.equal(store.apply(award).applied, false, 'a replay of the same combat-xp id is a no-op');
    assert.equal(store.xpFor(GUEST), 15, 'not double-counted');
  } finally {
    store.close();
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

test('applyAll additively reports WHICH rows landed, not merely how many (Ruling 1)', () => {
  // net/gameServerCore.mjs's applyCombatRewards batches potentially many guests' XP facts into one
  // transaction per tick and has to announce a reward event only for a row that actually landed --
  // the aggregate `applied` count alone cannot say WHICH, so applyAll additively names them.
  const path = tempDbPath('galaquest-r1c1-appliedids-');
  const store = openRewardStore(path);
  try {
    const alreadyOnDisk = combatXpEventId(GUEST, 'life-already');
    store.apply({ guestId: GUEST, heroId: 'hero-1', type: 'xp-earned', eventId: alreadyOnDisk, value: '10' });

    const fresh = combatXpEventId(GUEST, 'life-fresh');
    const result = store.applyAll([
      { guestId: GUEST, heroId: 'hero-1', type: 'xp-earned', eventId: alreadyOnDisk, value: '10' },
      { guestId: GUEST, heroId: 'hero-1', type: 'xp-earned', eventId: fresh, value: '20' },
    ]);
    // `applied` stays the exact count every existing caller already reads.
    assert.equal(result.applied, 1, 'one of the two rows was a replay');
    assert.deepEqual(result.appliedEventIds, [fresh], 'only the row that actually landed is named');
    assert.equal(store.xpFor(GUEST), 30);
  } finally {
    store.close();
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

test('applyAll on an empty batch reports applied:0 and an empty appliedEventIds', () => {
  const path = tempDbPath('galaquest-r1c1-appliedids-empty-');
  const store = openRewardStore(path);
  try {
    assert.deepEqual(store.applyAll([]), { applied: 0, appliedEventIds: [] });
  } finally {
    store.close();
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

test('a leash/respawn with no defeat pays no combat XP', () => {
  const path = tempDbPath('galaquest-r1c1-leash-');
  const bound = coordinatorOn(path);
  try {
    bound.rewards.join('hero-1', GUEST);
    const events = bound.rewards.processTick([
      hit('wolf-a', 1, 'hero-1'),
      { type: 'wolf-respawned', enemyId: 'wolf-a', kind: 'wolf', level: 1 },
    ]);
    assert.equal(events.filter((e) => e.type === 'xp-earned').length, 0);
    assert.equal(bound.store.xpFor(GUEST), 0);
  } finally {
    bound.close();
  }
});

test('an ephemeral (guestId-less) contributor earns no durable combat XP', () => {
  const path = tempDbPath('galaquest-r1c1-ephemeral-');
  const bound = coordinatorOn(path);
  try {
    // No rewards.join() -- ephemeral, the same convention test/reward-wiring.test.mjs uses.
    const events = killWolf(bound.rewards, { heroId: 'ephemeral-hero', level: 1 });
    assert.equal(events.filter((e) => e.type === 'xp-earned').length, 0);
  } finally {
    bound.close();
  }
});

test('hero level feeds the price: a higher-level hero earns less from the identical wolf', () => {
  const path = tempDbPath('galaquest-r1c1-levelfeeds-');
  const bound = coordinatorOn(path);
  try {
    bound.rewards.join('hero-1', GUEST);
    // Three marks unlock the Lantern and its P2 XP, landing this guest on Level 2 -- reusing the
    // EXISTING production XP source only to get a real level change, never a second one invented here.
    for (let i = 0; i < MARKS_TO_UNLOCK; i += 1) killWolf(bound.rewards, { heroId: 'hero-1', level: 1 });
    assert.equal(bound.rewards.heroStatsFor('hero-1').level, 2, 'setup: now Level 2');

    const events = killWolf(bound.rewards, { heroId: 'hero-1', level: 1 });
    const xpEvent = events.find((e) => e.type === 'xp-earned');
    assert.ok(xpEvent, 'a Level-2 hero still earns SOME xp from a Level-1 wolf (gap +1, not the bound)');
    assert.equal(Number(xpEvent.value), combatXpFor({ heroLevel: 2, enemyLevel: 1 }));
    assert.ok(Number(xpEvent.value) < combatXpFor({ heroLevel: 1, enemyLevel: 1 }),
      'the identical wolf must pay the higher-level hero strictly less');
  } finally {
    bound.close();
  }
});

test('GQ-013: combat XP that crosses a level threshold moves real maxHp/heroDamage, not a HUD number', () => {
  const path = tempDbPath('galaquest-r1c1-gq013-');
  const bound = coordinatorOn(path);
  try {
    bound.rewards.join('hero-1', GUEST);
    const before = bound.rewards.heroStatsFor('hero-1');
    assert.equal(before.level, 1, 'setup: a fresh hero is Level 1');

    // Three Level-4 wolves (gap clamps to the 1.25 band throughout) pay 38 apiece -- 114 total, past
    // the 100 the curve requires for Level 2, computed and summed below rather than hand-typed.
    //
    // THREE kills also happens to be MARKS_TO_UNLOCK, so this same loop incidentally earns the
    // Lantern's own 100 XP too on the third kill -- a real interaction, not a bug in the test, and
    // exactly why the sum below is filtered to combat-xp events (`xp:combat:` identities) specifically
    // rather than every 'xp-earned' event this loop raises.
    let combatXpTotal = 0;
    for (let kill = 0; kill < 3; kill += 1) {
      const events = killWolf(bound.rewards, { heroId: 'hero-1', enemyId: 'wolf-a', level: 4 });
      const combatEvents = events.filter((e) => e.type === 'xp-earned' && e.eventId.startsWith('xp:combat:'));
      assert.equal(combatEvents.length, 1, `kill ${kill + 1} must earn exactly its own combat XP`);
      combatXpTotal += Number(combatEvents[0].value);
    }
    assert.equal(combatXpTotal, 114, 'sanity: three Level-4 kills sum to exactly this much combat XP');
    assert.ok(bound.store.xpFor(GUEST) >= combatXpTotal,
      'the store total is at least the combat XP alone (the incidental Lantern only adds to it)');

    const after = bound.rewards.heroStatsFor('hero-1');
    assert.equal(after.level, 2, 'combat XP alone already crosses the Level-2 threshold');
    assert.ok(after.maxHp > before.maxHp, 'a bigger body');
    assert.ok(after.heroDamage > before.heroDamage, 'a harder blow');
    assert.equal(after.maxHp, resolvedMaxHp(2), 'through the SAME authority progression/heroStats.js is');
    assert.equal(after.heroDamage, resolvedHeroDamage(2, STARTER_SWORD_ID));
  } finally {
    bound.close();
  }
});

test('a malformed combat-xp amount is refused by the existing store boundary', () => {
  const path = tempDbPath('galaquest-r1c1-malformed-');
  const store = openRewardStore(path);
  try {
    const eventId = combatXpEventId(GUEST, 'life-bad');
    for (const bad of ['-5', '0', '1.5', '1e3']) {
      assert.throws(
        () => store.apply({ guestId: GUEST, heroId: 'hero-1', type: 'xp-earned', eventId, value: bad }),
        /xp/i,
        `${bad} must be refused`,
      );
    }
    assert.equal(store.xpFor(GUEST), 0, 'nothing malformed reached the disk');
  } finally {
    store.close();
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

// ── Ruling 2 (Sonnet B adversarial pass): a client-restored combat-xp fact is value-bounded ────────
//
// progression/facts.js's PROFILE_SCOPED_EVENT_ID_PREFIXES lets a profile restore `xp:combat:` facts
// under its OWN identity -- necessary so a device's own honestly-earned combat XP survives a server
// wipe, exactly like marks/lantern XP already do. But unlike the Lantern's one enumerable latch
// identity, a lifeId is not enumerable ahead of time, so the identity check alone cannot refuse a
// forged `xp:combat:<myProfileId>:<invented-lifeId>`. What CAN be refused is an amount no real kill
// could ever have produced -- MAX_COMBAT_XP_PER_KILL.

test('restoreProfileFacts refuses a forged combat-xp fact above the ceiling', () => {
  const path = tempDbPath('galaquest-r1c1-forged-');
  const bound = coordinatorOn(path);
  try {
    bound.rewards.join('hero-1', GUEST);
    const forged = {
      eventId: combatXpEventId(GUEST, 'fake-life-invented-by-a-hacked-client'),
      type: 'xp-earned',
      value: String(MAX_COMBAT_XP_PER_KILL + 1),
    };
    const result = bound.rewards.restoreProfileFacts('hero-1', [forged]);
    assert.equal(result.restored, 0);
    assert.equal(result.refused, 1);
    assert.equal(bound.store.xpFor(GUEST), 0, 'no impossible amount reached the disk');
  } finally {
    bound.close();
  }
});

test('restoreProfileFacts still accepts a legitimate combat-xp fact AT the ceiling', () => {
  const path = tempDbPath('galaquest-r1c1-atceiling-');
  const bound = coordinatorOn(path);
  try {
    bound.rewards.join('hero-1', GUEST);
    const legitimate = {
      eventId: combatXpEventId(GUEST, 'a-real-level-4-kill'),
      type: 'xp-earned',
      value: String(MAX_COMBAT_XP_PER_KILL),
    };
    const result = bound.rewards.restoreProfileFacts('hero-1', [legitimate]);
    assert.equal(result.restored, 1, 'the ceiling must refuse ABOVE it, never AT it');
    assert.equal(result.refused, 0);
    assert.equal(bound.store.xpFor(GUEST), MAX_COMBAT_XP_PER_KILL);
  } finally {
    bound.close();
  }
});

test('the combat-xp ceiling refuses only the forged fact, leaving every other restorable fact untouched', () => {
  const path = tempDbPath('galaquest-r1c1-mixedrestore-');
  const bound = coordinatorOn(path);
  try {
    bound.rewards.join('hero-1', GUEST);
    const mixed = [
      { eventId: 'mark:offline:1', type: 'mark-earned' },
      { eventId: `lantern-unlocked:${GUEST}`, type: 'lantern-unlocked' },
      {
        eventId: combatXpEventId(GUEST, 'a-real-kill'),
        type: 'xp-earned',
        value: String(MAX_COMBAT_XP_PER_KILL),
      },
      {
        eventId: combatXpEventId(GUEST, 'a-forged-kill'),
        type: 'xp-earned',
        value: String(MAX_COMBAT_XP_PER_KILL * 1000),
      },
    ];
    const result = bound.rewards.restoreProfileFacts('hero-1', mixed);
    assert.equal(result.restored, 3, 'the mark, the lantern-unlocked and the legitimate combat-xp fact all land');
    assert.equal(result.refused, 1, 'only the forged amount is refused');
    assert.equal(bound.store.marksFor(GUEST), 1);
    assert.equal(bound.store.unlockedFor(GUEST), true);
    assert.equal(bound.store.xpFor(GUEST), MAX_COMBAT_XP_PER_KILL);
  } finally {
    bound.close();
  }
});

test('the ceiling is scoped to `xp:combat:` and never bounds the Lantern\'s own legitimate 100 XP', () => {
  // THE REGRESSION THIS GUARDS: LANTERN_UNLOCK_XP is 100, comfortably ABOVE MAX_COMBAT_XP_PER_KILL
  // (38). If the new check were written against every xp-earned fact rather than scoped by the
  // `xp:combat:` prefix specifically, it would wrongly refuse an honestly-earned, offline-minted
  // Lantern XP restoration -- turning a security fix into a real regression on an already-shipped
  // P2 path. This restores exactly that shape and insists it still lands.
  const path = tempDbPath('galaquest-r1c1-lanternunbound-');
  const bound = coordinatorOn(path);
  try {
    bound.rewards.join('hero-1', GUEST);
    const deviceLanternId = `lantern-unlocked:${GUEST}`;
    const result = bound.rewards.restoreProfileFacts('hero-1', [
      { eventId: deviceLanternId, type: 'lantern-unlocked' },
      { eventId: lanternXpEventId(deviceLanternId), type: 'xp-earned', value: String(LANTERN_UNLOCK_XP) },
    ]);
    assert.equal(result.refused, 0, 'the Lantern\'s legitimate 100 XP must not be caught by the combat-only ceiling');
    assert.equal(result.restored, 2);
    assert.equal(bound.store.xpFor(GUEST), LANTERN_UNLOCK_XP);
  } finally {
    bound.close();
  }
});

// ── D5: offline parity ──────────────────────────────────────────────────────────────────────────

function deviceStorage() {
  const memory = new Map();
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => { memory.set(k, String(v)); },
    removeItem: (k) => { memory.delete(k); },
  };
}

const OFFLINE_PROFILE = 'p-r1c1-offline-1111';

let uuidCounter = 0;
function offlineSession(storage) {
  return createProfileStore({
    storage,
    randomUUID: () => `uuid-${uuidCounter += 1}`,
    now: () => new Date(1_700_000_000_000 + (uuidCounter += 1) * 1000),
  });
}

/** A page load over the SAME storage -- a fresh profile store, a fresh fold/ledger AND a fresh
 *  mintLifeId, exactly like a real refresh. createLifeIdMinter() with no options is the real producer
 *  main.js drives (crypto.randomUUID, which this test runtime has) -- not re-implemented here, per
 *  GQ-015: cross-session id UNIQUENESS is what these tests need, and a real minter already gives it
 *  without a second, hand-rolled id source that could quietly stop matching the real one. */
function offlinePageLoad(storage) {
  const profiles = offlineSession(storage);
  const offline = createOfflineProgress({ profiles, profileId: OFFLINE_PROFILE, mintLifeId: createLifeIdMinter() });
  return {
    profiles,
    killWolf: (level = 1, enemyId = 'wolf-a') => offline.recordKills([
      { type: 'wolf-defeated', enemyId, kind: 'wolf', level },
    ]),
  };
}

test('offline combat XP uses the same law and the xp:combat:<profileId>:<lifeId> identity', () => {
  const storage = deviceStorage();
  const session = offlinePageLoad(storage);
  const raised = session.killWolf(2);
  const xpEvents = raised.filter((e) => e.type === 'xp-earned');
  assert.equal(xpEvents.length, 1);
  assert.equal(Number(xpEvents[0].value), combatXpFor({ heroLevel: 1, enemyLevel: 2 }));
  assert.ok(xpEvents[0].eventId.startsWith(`xp:combat:${OFFLINE_PROFILE}:`),
    `eventId ${xpEvents[0].eventId} must carry the profile-scoped combat identity`);
  assert.equal(session.profiles.stateFor(OFFLINE_PROFILE).xp, combatXpFor({ heroLevel: 1, enemyLevel: 2 }));
});

test('offline combat XP survives a simulated reload without double-crediting the recorded fact', () => {
  const storage = deviceStorage();
  const first = offlinePageLoad(storage);
  first.killWolf(2);
  const xpAfterFirst = first.profiles.stateFor(OFFLINE_PROFILE).xp;
  assert.ok(xpAfterFirst > 0, 'setup: the first session actually earned combat XP');

  // A second page load: NEW profile store instance, NEW ledger, NEW life-id minter -- over the SAME
  // underlying storage. Reading the state back must not have moved the total by itself.
  const second = offlinePageLoad(storage);
  assert.equal(second.profiles.stateFor(OFFLINE_PROFILE).xp, xpAfterFirst,
    'a reload that earns nothing new must not move the total');
});

test('a fresh kill after reload does not collide with a previously recorded combat-xp id', () => {
  const storage = deviceStorage();
  const first = offlinePageLoad(storage);
  first.killWolf(2, 'wolf-a');
  const afterFirst = first.profiles.stateFor(OFFLINE_PROFILE).xp;

  const second = offlinePageLoad(storage);
  const raised = second.killWolf(2, 'wolf-a');
  const xpEvents = raised.filter((e) => e.type === 'xp-earned');
  assert.equal(xpEvents.length, 1, 'the second session\'s own kill must be recorded, not swallowed');

  const afterSecond = second.profiles.stateFor(OFFLINE_PROFILE).xp;
  assert.equal(afterSecond, afterFirst + combatXpFor({ heroLevel: 1, enemyLevel: 2 }),
    'the new kill must ADD to the total, not collide with the previous session\'s id');

  const journal = second.profiles.journalFor(OFFLINE_PROFILE).filter((f) => f.type === 'xp-earned');
  assert.equal(new Set(journal.map((f) => f.eventId)).size, journal.length,
    'every recorded combat-xp eventId across both sessions must be distinct');
});

test('offline: a mid-session level-up prices the NEXT kill at the new level', () => {
  const storage = deviceStorage();
  const session = offlinePageLoad(storage);
  // Three Level-4 wolves cross Level 2 purely off combat XP, exactly as the online GQ-013 test above.
  session.killWolf(4, 'wolf-1');
  session.killWolf(4, 'wolf-2');
  const beforeThird = session.profiles.stateFor(OFFLINE_PROFILE).xp;
  const heroLevelBeforeThird = levelForXp(beforeThird);

  // The third kill is also MARKS_TO_UNLOCK, so this raises the Lantern's own xp-earned too -- scoped
  // to the combat-xp identity specifically, the same discipline the online GQ-013 test uses, rather
  // than relying on which of the two happens to be raised first.
  const raised = session.killWolf(4, 'wolf-3');
  const combatEvents = raised.filter((e) => e.type === 'xp-earned' && e.eventId.startsWith('xp:combat:'));
  assert.equal(combatEvents.length, 1, 'the third kill must earn exactly its own combat XP');
  assert.equal(Number(combatEvents[0].value), combatXpFor({ heroLevel: heroLevelBeforeThird, enemyLevel: 4 }),
    'the third kill must be priced off the level the first two already bought, not Level 1');
});

test('offline: two children on one tablet do not share a combat-xp fact', () => {
  const storage = deviceStorage();
  const loaded = offlinePageLoad(storage);
  loaded.killWolf(2);

  const sibling = 'p-r1c1-offline-9999';
  const siblingProfiles = offlineSession(storage);
  assert.equal(siblingProfiles.stateFor(sibling).xp, 0, 'the sibling earned none of this profile\'s XP');
});

// ── FIX 1 (Opus ruling on Sonnet B's adversarial pass): batch-start pricing parity ─────────────────
//
// The original C1 shipment priced each award as applyCombatRewards/recordKills reached it, reading
// the hero's level FRESH per award -- which meant three L1-Wolf kills paid 27 XP folded into one
// server tick, 39 XP spread across three separate ticks, and 45 XP offline: three different answers
// for the identical three kills, because "which award the loop reached first" is an artifact of
// event order and Map iteration, not of the kills. The ruling: a kill is priced at the hero level as
// of the START of the batch that contains it, captured before any of that batch's own rewards are
// applied, identically on both the server (net/gameServerCore.mjs's snapshotHeroLevelsForBatch) and
// offline (rewards/offlineProgress.js's recordKills). These tests are the direct proof of that: the
// three numbers above must now be the SAME number, on all three paths, computed here rather than
// merely trusted from the module headers.

/** Every one of these helpers keeps the SAME heroId/profile across three kills of three DIFFERENT
 *  enemyIds, so each kill folds its own mark/life (foldEvents keys marks by contributor+lifeId,
 *  never by enemyId alone) while still being the exact "three L1-Wolf kills" case that crosses the
 *  Lantern on the third -- the shape Sonnet B actually reproduced the divergence with. */
const THREE_ENEMY_IDS = ['wolf-parity-a', 'wolf-parity-b', 'wolf-parity-c'];

function combatXpTotal(events) {
  return events
    .filter((event) => event.type === 'xp-earned' && event.eventId.startsWith('xp:combat:'))
    .reduce((sum, event) => sum + Number(event.value), 0);
}

test('FIX 1: three L1-Wolf kills pay the SAME total combat XP batched into one tick, spread across '
  + 'three ticks, and offline -- the exact case that used to pay 27 / 39 / 45', () => {
  const expectedTotal = THREE_ENEMY_IDS.length * combatXpFor({ heroLevel: 1, enemyLevel: 1 });

  // Path A: all three kills folded into ONE processTick -- the case this suite had NO coverage for
  // before this fix, and the case that most exposed the old per-award repricing (it used to pay 27).
  const pathA = tempDbPath('galaquest-r1c1-parity-onetick-');
  const boundA = coordinatorOn(pathA);
  let totalA;
  try {
    boundA.rewards.join('hero-1', GUEST);
    const oneTickEvents = THREE_ENEMY_IDS.flatMap((enemyId) => [hit(enemyId, 1, 'hero-1'), defeated(enemyId, 1, 'hero-1')]);
    totalA = combatXpTotal(boundA.rewards.processTick(oneTickEvents));
  } finally {
    boundA.close();
  }

  // Path B: the identical three kills, one processTick per kill (it used to pay 39).
  const pathB = tempDbPath('galaquest-r1c1-parity-threeticks-');
  const boundB = coordinatorOn(pathB);
  let totalB = 0;
  try {
    boundB.rewards.join('hero-1', GUEST);
    for (const enemyId of THREE_ENEMY_IDS) {
      totalB += combatXpTotal(killWolf(boundB.rewards, { heroId: 'hero-1', enemyId, level: 1 }));
    }
  } finally {
    boundB.close();
  }

  // Path C: the identical three kills, offline, one recordKills call per kill (it already paid 45,
  // and must keep doing so -- offline's own per-call pricing was already batch-of-one).
  const storage = deviceStorage();
  const session = offlinePageLoad(storage);
  let totalC = 0;
  for (const enemyId of THREE_ENEMY_IDS) {
    totalC += combatXpTotal(session.killWolf(1, enemyId));
  }

  assert.equal(totalA, expectedTotal, 'one tick: three L1 kills must total exactly 3x the L1/L1 price (was 27)');
  assert.equal(totalB, expectedTotal, 'three ticks: same total as one tick (was 39)');
  assert.equal(totalC, expectedTotal, 'offline: same total as both server paths (was already 45)');
  assert.equal(totalA, totalB, 'PARITY: one-tick and three-tick server totals must agree');
  assert.equal(totalB, totalC, 'PARITY: server and offline totals must agree');
});

test('FIX 1: multiple kills batched into one processTick price identically to the same kills spread '
  + 'across separate ticks, at a HETEROGENEOUS mix of enemy levels', () => {
  const kills = [
    { enemyId: 'wolf-mix-a', level: 1 },
    { enemyId: 'wolf-mix-b', level: 2 },
    { enemyId: 'wolf-mix-c', level: 4 },
  ];

  const pathA = tempDbPath('galaquest-r1c1-parity-mix-onetick-');
  const boundA = coordinatorOn(pathA);
  let totalA;
  try {
    boundA.rewards.join('hero-1', GUEST);
    const events = kills.flatMap(({ enemyId, level }) => [hit(enemyId, level, 'hero-1'), defeated(enemyId, level, 'hero-1')]);
    totalA = combatXpTotal(boundA.rewards.processTick(events));
  } finally {
    boundA.close();
  }

  const pathB = tempDbPath('galaquest-r1c1-parity-mix-manyticks-');
  const boundB = coordinatorOn(pathB);
  let totalB = 0;
  try {
    boundB.rewards.join('hero-1', GUEST);
    for (const { enemyId, level } of kills) {
      totalB += combatXpTotal(killWolf(boundB.rewards, { heroId: 'hero-1', enemyId, level }));
    }
  } finally {
    boundB.close();
  }

  // All three prices at heroLevel 1 (none of these three kills alone crosses Level 2), so the
  // expected total is independently computable from the law rather than merely "A equals B".
  const expectedTotal = kills.reduce((sum, { level }) => sum + combatXpFor({ heroLevel: 1, enemyLevel: level }), 0);
  assert.equal(totalA, expectedTotal, 'one tick: a heterogeneous batch prices each kill off the batch-start level');
  assert.equal(totalB, expectedTotal, 'separate ticks: same total as the one-tick batch');
});

test('FIX 1: offline -- multiple kills folded from ONE recordKills call price identically to the '
  + 'same kills across separate calls, when neither crosses a level boundary', () => {
  const expectedTotal = THREE_ENEMY_IDS.length * combatXpFor({ heroLevel: 1, enemyLevel: 1 });

  // Path A: all three defeats folded from ONE encounter-events array, i.e. ONE recordKills call --
  // the offline equivalent of "batched into one processTick", and a shape the per-call `killWolf()`
  // test helper elsewhere in this file can never exercise (it always calls recordKills once per
  // kill). Driven directly against createOfflineProgress so this scenario is reachable.
  const storageA = deviceStorage();
  const profilesA = offlineSession(storageA);
  const offlineA = createOfflineProgress({
    profiles: profilesA,
    profileId: OFFLINE_PROFILE,
    mintLifeId: createLifeIdMinter(),
  });
  const raisedA = offlineA.recordKills(
    THREE_ENEMY_IDS.map((enemyId) => ({ type: 'wolf-defeated', enemyId, kind: 'wolf', level: 1 })),
  );
  const totalA = combatXpTotal(raisedA);

  // Path B: the identical three kills, one recordKills call per kill.
  const storageB = deviceStorage();
  const sessionB = offlinePageLoad(storageB);
  let totalB = 0;
  for (const enemyId of THREE_ENEMY_IDS) {
    totalB += combatXpTotal(sessionB.killWolf(1, enemyId));
  }

  assert.equal(totalA, expectedTotal, 'one offline batch: three L1 kills total exactly 3x the L1/L1 price');
  assert.equal(totalB, expectedTotal, 'three offline batches: same total as one batch');
  assert.equal(totalA, totalB, 'PARITY: one-call and three-call offline totals must agree');
});

test('FIX 1: offline -- eight kills folded from ONE recordKills call ALL price at the level the '
  + 'hero started that batch at, even though the batch\'s own combat XP crosses the Level-2 '
  + 'threshold partway through it (this is the scenario the pre-fix per-award-fresh-read bug gets '
  + 'wrong: the batch-of-one killWolf() helper used above can never reach it, since no single kill '
  + 'is worth enough to cross a level on its own)', () => {
  const storage = deviceStorage();
  const profiles = offlineSession(storage);
  const offline = createOfflineProgress({
    profiles, profileId: OFFLINE_PROFILE, mintLifeId: createLifeIdMinter(),
  });

  // Eight Level-1 wolves at 15 XP apiece cross the 100-XP Level-2 threshold on the seventh kill
  // (7*15 = 105) -- ALL EIGHT are folded from ONE recordKills call, so under the pre-fix per-award
  // read, kill 8 would have read the (by-then Level-2) hero back and priced at the +1-gap rate.
  const enemyIds = Array.from({ length: 8 }, (_, i) => `wolf-crossing-${i}`);
  const raised = offline.recordKills(
    enemyIds.map((enemyId) => ({ type: 'wolf-defeated', enemyId, kind: 'wolf', level: 1 })),
  );
  const combatEvents = raised.filter((event) => event.type === 'xp-earned' && event.eventId.startsWith('xp:combat:'));
  assert.equal(combatEvents.length, 8, 'every one of the eight kills earns its own combat-XP row');

  const perKillPrice = combatXpFor({ heroLevel: 1, enemyLevel: 1 });
  assert.ok(combatEvents.every((event) => Number(event.value) === perKillPrice),
    `every kill in this ONE batch must price at ${perKillPrice} (the level the batch STARTED at), `
    + `saw ${JSON.stringify(combatEvents.map((event) => Number(event.value)))}`);
  assert.equal(combatEvents.reduce((sum, event) => sum + Number(event.value), 0), 8 * perKillPrice,
    'sum: eight identically-priced kills, never seven at one price and an eighth at a lower one');

  // Sanity: the hero really DID cross Level 2 by the end of this very batch -- Fix 1 decides what
  // price THIS batch's OWN kills paid, it does not suppress the level-up the batch as a whole earns.
  assert.equal(levelForXp(profiles.stateFor(OFFLINE_PROFILE).xp), 2,
    'setup/sanity: 8*15 = 120 combat XP alone already crosses Level 2');
});

test('FIX 1: same-tick kills by two different profiles price independently -- neither guest\'s '
  + 'in-batch writes move the other guest\'s price', () => {
  const path = tempDbPath('galaquest-r1c1-parity-crossguest-');
  const bound = coordinatorOn(path);
  try {
    bound.rewards.join('hero-a', 'guest-aaaaaaaa');
    bound.rewards.join('hero-b', 'guest-bbbbbbbb');

    // Level guest-a to Level 2 first (three marks/lantern), leaving guest-b untouched at Level 1 --
    // reusing the same warm-up shape as "hero level feeds the price" above.
    for (let i = 0; i < MARKS_TO_UNLOCK; i += 1) {
      killWolf(bound.rewards, { heroId: 'hero-a', enemyId: `warmup-${i}`, level: 1 });
    }
    assert.equal(bound.rewards.heroStatsFor('hero-a').level, 2, 'setup: guest-a is now Level 2');
    assert.equal(bound.rewards.heroStatsFor('hero-b').level, 1, 'setup: guest-b untouched, still Level 1');

    // ONE shared tick: guest-a and guest-b each kill their OWN separate Level-1 wolf.
    const events = bound.rewards.processTick([
      hit('wolf-a', 1, 'hero-a'), defeated('wolf-a', 1, 'hero-a'),
      hit('wolf-b', 1, 'hero-b'), defeated('wolf-b', 1, 'hero-b'),
    ]);
    const xpByHero = Object.fromEntries(
      events.filter((event) => event.type === 'xp-earned').map((event) => [event.heroId, Number(event.value)]),
    );
    assert.equal(xpByHero['hero-a'], combatXpFor({ heroLevel: 2, enemyLevel: 1 }),
      'guest-a prices off its OWN Level 2 snapshot, unaffected by sharing the tick with guest-b');
    assert.equal(xpByHero['hero-b'], combatXpFor({ heroLevel: 1, enemyLevel: 1 }),
      'guest-b prices off its OWN Level 1 snapshot, unaffected by sharing the tick with guest-a');
    assert.notEqual(xpByHero['hero-a'], xpByHero['hero-b'], 'sanity: the two guests really did price differently');
  } finally {
    bound.close();
  }
});
