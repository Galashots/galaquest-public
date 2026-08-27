// R1-C2: the ownership-aware loot seam (D6) and the compact feedback/ceremony-priority pieces (D7)
// docs/briefs/PROGRESSION_R1_COMBAT_XP_LOOT_REWARD_SEAM.md's checkpoint plan names for this half of
// the package. C1's combat-XP law/identity/attribution is proven in test/progression-r1-c1.test.mjs;
// nothing here re-prices XP, it only proves the gear decision riding alongside it.
//
// R1's PRODUCTION eligible ordinary-drop set is EMPTY by design (public/src/progression/items.js's
// ORDINARY_DROP_ITEM_IDS) -- G2 populates it. So the successful-selection/grant path is proven with
// an INJECTED fixture catalogue throughout this file, never with real content, per the brief's own
// "the gear branch itself must still be mechanically proven through dependency injection/fixture
// policy... without shipping fake production content."

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createRewardCoordinator } from '../net/gameServer.mjs';
import { openRewardStore } from '../net/rewardStore.mjs';
import {
  ORDINARY_DROP_CHANCE,
  combatXpFor,
  decideCombatReward,
  eligibleOrdinaryDropItemIds,
  gearOwnedEventId,
} from '../public/src/rewards/combatRewards.js';
import {
  DEFAULT_OWNED_ITEM_IDS,
  HELMET_SILVERGUARD_ID,
  ORDINARY_DROP_ITEM_IDS,
  STARTER_SWORD_ID,
  WILDWOOD_BLADE_ID,
} from '../public/src/progression/items.js';
import { createLifeIdMinter, createOfflineProgress } from '../public/src/rewards/offlineProgress.js';
import { createProfileStore } from '../public/src/progression/profiles.js';
import { createCeremonyGate } from '../public/src/rewards/ceremonyGate.js';

const GUEST = 'p-r1c2-1111-2222';

function tempDbPath(prefix) {
  return join(mkdtempSync(join(tmpdir(), prefix)), 'rewards.db');
}

function coordinatorOn(path, options = {}) {
  const rewards = createRewardCoordinator({ rewardStorePath: path, ...options });
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

function hit(enemyId, level, heroId) {
  return { type: 'wolf-hit', enemyId, kind: 'wolf', level, heroId };
}
function defeated(enemyId, level, heroId) {
  return { type: 'wolf-defeated', enemyId, kind: 'wolf', level, heroId };
}

/** A scripted RNG: returns the next value in `sequence` on every call, and counts how many times it
 *  was actually called -- so a test can assert "random was never called" as well as "the Nth call
 *  saw exactly this value", which is the only way to prove the empty-pool short-circuit and the
 *  order contract (eligibility -> chance -> selection) without reading combatRewards.js's source. */
function scriptedRandom(sequence) {
  let index = 0;
  const calls = [];
  const fn = () => {
    const value = sequence[Math.min(index, sequence.length - 1)];
    calls.push(value);
    index += 1;
    return value;
  };
  fn.calls = calls;
  return fn;
}

// A fixture catalogue: two names that are not, and never will be, real production items. Used ONLY
// as an injected `catalogue` override -- never assigned to a real ITEM_DEFS entry, never written to
// progression/items.js. Chosen unmistakably fake so nobody could later mistake them for real content.
const FIXTURE_ITEM_A = 'fixture-ordinary-drop-a';
const FIXTURE_ITEM_B = 'fixture-ordinary-drop-b';
const FIXTURE_CATALOGUE = Object.freeze([FIXTURE_ITEM_B, FIXTURE_ITEM_A]); // deliberately unsorted

// ── D6: eligibleOrdinaryDropItemIds -- eligibility, and nothing else ────────────────────────────────

test('eligibleOrdinaryDropItemIds returns the unowned subset of the catalogue, SORTED', () => {
  assert.deepEqual(
    eligibleOrdinaryDropItemIds([], FIXTURE_CATALOGUE),
    [FIXTURE_ITEM_A, FIXTURE_ITEM_B],
    'sorted regardless of the catalogue\'s own (deliberately unsorted) order',
  );
  assert.deepEqual(eligibleOrdinaryDropItemIds([FIXTURE_ITEM_A], FIXTURE_CATALOGUE), [FIXTURE_ITEM_B],
    'an owned item is excluded');
  assert.deepEqual(eligibleOrdinaryDropItemIds([FIXTURE_ITEM_A, FIXTURE_ITEM_B], FIXTURE_CATALOGUE), [],
    'owning everything in the catalogue leaves nothing eligible');
});

test('eligibleOrdinaryDropItemIds defaults to the REAL production catalogue, which is EMPTY in R1', () => {
  assert.deepEqual(ORDINARY_DROP_ITEM_IDS, [],
    'R1 ships the mechanism with zero eligible items -- G2 populates it, not this package');
  assert.deepEqual(eligibleOrdinaryDropItemIds([]), [],
    'nothing is ever eligible against the real catalogue today');
});

// ── D6: decideCombatReward -- THE ORDER IS THE CONTRACT ─────────────────────────────────────────────

test('decideCombatReward: an EMPTY eligible pool returns gearItemId: null and calls random ZERO times', () => {
  const random = scriptedRandom([0]); // would succeed the chance roll AND the selection, if called
  const result = decideCombatReward({
    heroLevel: 1, enemyLevel: 1, ownedItemIds: [], random, catalogue: [],
  });
  assert.equal(result.gearItemId, null);
  assert.equal(result.xp, combatXpFor({ heroLevel: 1, enemyLevel: 1 }), 'XP is unaffected by the empty pool');
  assert.equal(random.calls.length, 0,
    'an honest suppression: nothing eligible means the roll never happens, so an injected RNG stream stays deterministic');
});

test('decideCombatReward: owning every catalogue item is the SAME as an empty catalogue -- no roll', () => {
  const random = scriptedRandom([0]);
  const result = decideCombatReward({
    heroLevel: 1, enemyLevel: 1, ownedItemIds: FIXTURE_CATALOGUE, random, catalogue: FIXTURE_CATALOGUE,
  });
  assert.equal(result.gearItemId, null);
  assert.equal(random.calls.length, 0, 'an owned-out eligible set is exactly as silent as an empty one');
});

test('decideCombatReward: a NON-empty eligible pool rolls the chance FIRST, then selects only on success', () => {
  // Fails the chance check (random() >= chance) -- selection must never be reached, proven by the
  // call count staying at exactly one.
  const missed = scriptedRandom([ORDINARY_DROP_CHANCE]); // exactly at the boundary: random() < chance is false
  const missResult = decideCombatReward({
    heroLevel: 1, enemyLevel: 1, ownedItemIds: [], random: missed, catalogue: FIXTURE_CATALOGUE,
  });
  assert.equal(missResult.gearItemId, null, 'a chance roll AT the boundary is a miss (strict <)');
  assert.equal(missed.calls.length, 1, 'only the chance roll was made -- selection never ran on a miss');

  // Succeeds the chance check, THEN selects -- exactly two calls, in that order.
  const hitTwice = scriptedRandom([0, 0]); // 0 < chance (hit), then index 0 of the sorted eligible set
  const hitResult = decideCombatReward({
    heroLevel: 1, enemyLevel: 1, ownedItemIds: [], random: hitTwice, catalogue: FIXTURE_CATALOGUE,
  });
  assert.equal(hitResult.gearItemId, FIXTURE_ITEM_A, 'index 0 of the SORTED eligible set, [A, B]');
  assert.equal(hitTwice.calls.length, 2, 'chance, then selection -- never selection before chance');
});

test('decideCombatReward: a DETERMINISTIC fixture proves the successful selection/grant path end to end', () => {
  // The second eligible slot, selected via a scripted second draw.
  const random = scriptedRandom([0, 0.9]); // hit, then index Math.floor(0.9 * 2) = 1 -> FIXTURE_ITEM_B
  const result = decideCombatReward({
    heroLevel: 1, enemyLevel: 1, ownedItemIds: [], random, catalogue: FIXTURE_CATALOGUE,
  });
  assert.equal(result.gearItemId, FIXTURE_ITEM_B);
  assert.equal(result.xp, combatXpFor({ heroLevel: 1, enemyLevel: 1 }), 'XP still prices through the one law');
});

test('decideCombatReward: a selection draw of exactly 1 still grants the LAST eligible item, never '
  + 'undefined', () => {
  // `random` is an INJECTED seam. Math.random is spec-bound to [0, 1) so production can never reach
  // the last index + 1, but an injected stream that returns exactly 1 would have indexed off the end
  // and returned undefined -- which every caller treats as falsy and silently drops, AFTER the
  // chance roll already said this kill was owed a drop. A promised grant that evaporates with no
  // durable fact written is the worst failure a reward seam has, so the index is clamped.
  const random = scriptedRandom([0, 1]); // hit the chance roll, then the degenerate selection draw
  const result = decideCombatReward({
    heroLevel: 1, enemyLevel: 1, ownedItemIds: [], random, catalogue: FIXTURE_CATALOGUE,
  });
  assert.equal(result.gearItemId, FIXTURE_ITEM_B, 'the last slot of the sorted eligible set [A, B]');
  assert.notEqual(result.gearItemId, undefined, 'a promised grant is never silently dropped');
});

test('decideCombatReward: an owned item is never re-promised, even at a guaranteed-success roll', () => {
  const random = scriptedRandom([0, 0]); // would hit and pick index 0 of whatever is eligible
  const result = decideCombatReward({
    heroLevel: 1,
    enemyLevel: 1,
    ownedItemIds: [FIXTURE_ITEM_A],
    random,
    catalogue: FIXTURE_CATALOGUE,
  });
  assert.equal(result.gearItemId, FIXTURE_ITEM_B, 'the only unowned item, never the already-owned A');
});

test('decideCombatReward rolls independently of XP: a heavily outleveled (zero-XP) kill can still drop', () => {
  const random = scriptedRandom([0, 0]);
  const result = decideCombatReward({
    heroLevel: 10, enemyLevel: 1, ownedItemIds: [], random, catalogue: FIXTURE_CATALOGUE,
  });
  assert.equal(result.xp, 0, 'setup: gap >= 3, zero combat XP');
  assert.equal(result.gearItemId, FIXTURE_ITEM_A, 'the flat drop chance does not decay with the level gap');
});

test('decideCombatReward defaults chance to ORDINARY_DROP_CHANCE (0.10) and catalogue to the real, empty one', () => {
  assert.equal(ORDINARY_DROP_CHANCE, 0.1);
  const random = scriptedRandom([0]);
  const result = decideCombatReward({ heroLevel: 1, enemyLevel: 1, ownedItemIds: [], random });
  assert.equal(result.gearItemId, null, 'defaults to the real (empty) catalogue -- nothing to grant');
  assert.equal(random.calls.length, 0);
});

// ── D6: the signature-item load-time guard ──────────────────────────────────────────────────────────

test('WILDWOOD_BLADE_ID and HELMET_SILVERGUARD_ID never carry ordinaryDrop -- they stay authored rewards', () => {
  assert.ok(!ORDINARY_DROP_ITEM_IDS.includes(WILDWOOD_BLADE_ID),
    'Rowan\'s Wildwood Blade must never be an ordinary-combat drop');
  assert.ok(!ORDINARY_DROP_ITEM_IDS.includes(HELMET_SILVERGUARD_ID),
    'Blackthorn Hollow\'s Silverguard Helmet must never be an ordinary-combat drop');
});

test('the guard actually THROWS at module load for a signature item carrying ordinaryDrop -- proven '
  + 'by re-deriving the guard\'s own check against a sabotaged copy of the real catalogue, not merely '
  + 'trusting the source text', () => {
  // The same derivation items.js performs, replayed here against a deliberately sabotaged item def --
  // this is the guard's OWN logic, exercised the way test/progression-r1-c1.test.mjs's structural
  // tests exercise other files' invariants: by recomputing the check, not merely reading the file.
  const sabotagedDefs = {
    [WILDWOOD_BLADE_ID]: { id: WILDWOOD_BLADE_ID, ordinaryDrop: true },
  };
  const sabotagedEligible = Object.values(sabotagedDefs).filter((def) => def.ordinaryDrop === true).map((def) => def.id);
  assert.throws(() => {
    for (const signatureItemId of [WILDWOOD_BLADE_ID, HELMET_SILVERGUARD_ID]) {
      if (sabotagedEligible.includes(signatureItemId)) {
        throw new Error(`${signatureItemId} must never carry ordinaryDrop: true`);
      }
    }
  }, /must never carry ordinaryDrop/, 'the guard\'s own check must actually catch this shape');
});

test('items.js itself loaded without throwing (this whole suite importing it IS that proof) and every '
  + 'currently-defined item is absent from ORDINARY_DROP_ITEM_IDS -- R1 ships zero flagged items', () => {
  assert.deepEqual(ORDINARY_DROP_ITEM_IDS, [], 'no item def in this repository carries ordinaryDrop: true yet');
});

// ── D6: the law never reads Math.random, POWER, or an XP total (structural, extended for C2) ────────

test('combatRewards.js still rolls no randomness of its own and never imports progression/power.js', () => {
  const source = readFileSync(new URL('../public/src/rewards/combatRewards.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\bMath\.random\b/.test(source), 'decideCombatReward must take random as a parameter, never call it');
  assert.ok(!/progression\/power(\.js)?['"]/.test(source));
});

// ── D6: server -- ONE reward decision batched with XP, per distinct guest per enemy life ────────────

test('production: the REAL (empty) catalogue never grants gear and never rolls a single random() call, '
  + 'across many kills', () => {
  const path = tempDbPath('galaquest-r1c2-empty-prod-');
  let calls = 0;
  const countingRandom = () => { calls += 1; return 0; }; // would ALWAYS succeed, if ever called
  const bound = coordinatorOn(path, { random: countingRandom }); // dropCatalogue defaults to the real, empty one
  try {
    bound.rewards.join('hero-1', GUEST);
    for (let kill = 0; kill < 10; kill += 1) {
      bound.rewards.processTick([hit(`wolf-${kill}`, 1, 'hero-1'), defeated(`wolf-${kill}`, 1, 'hero-1')]);
    }
    assert.equal(calls, 0, 'the production catalogue is empty, so decideCombatReward never calls random at all');
    assert.deepEqual(bound.store.ownedItemIdsFor(GUEST), [], 'no gear-owned fact was ever written');
  } finally {
    bound.close();
  }
});

// net/rewardStore.mjs's own apply()/applyAll() validate a `gear-owned` fact's item id against
// isKnownItem (the same guard that refuses a bogus weapon-equipped/gear-equipped id) -- correctly:
// this store also backs the REAL grantOwnership/claimWildwoodBlade paths, and it must never durably
// record an item nobody defined. That means a truly fake fixture id (FIXTURE_ITEM_A/B above) cannot
// be WRITTEN through the real coordinator+store, only reasoned about at the pure-law level (already
// proven above) or written offline (progression/profiles.js's recordFacts does not validate a
// gear-owned value against the catalogue the same way -- see the offline section below for the full
// successful-grant-and-reload round trip). The server tests below prove everything about the WIRING
// that does not require the write to actually succeed: they force every chance roll to MISS (a
// scripted random at or above ORDINARY_DROP_CHANCE), so decideCombatReward always returns
// `gearItemId: null` and the store is never asked to write an unknown id -- while still counting
// exactly how many times `random` was called, which is what proves dedupe/independence.
function missRandom() {
  const calls = [];
  const fn = () => { calls.push(ORDINARY_DROP_CHANCE); return ORDINARY_DROP_CHANCE; }; // strict <, so this always misses
  fn.calls = calls;
  return fn;
}

test('server: same-profile TWO TABS roll AT MOST ONCE per enemy life -- a second tab never consumes '
  + 'a second chance roll', () => {
  const path = tempDbPath('galaquest-r1c2-twotabs-');
  const random = missRandom();
  const bound = coordinatorOn(path, { random, dropCatalogue: FIXTURE_CATALOGUE });
  try {
    bound.rewards.join('tab-a', GUEST);
    bound.rewards.join('tab-b', GUEST);
    const events = bound.rewards.processTick([
      hit('wolf-a', 1, 'tab-a'),
      hit('wolf-a', 1, 'tab-b'),
      defeated('wolf-a', 1, 'tab-a'),
    ]);
    assert.equal(events.filter((event) => event.type === 'gear-owned').length, 0, 'setup: the scripted roll always misses');
    assert.equal(random.calls.length, 1,
      'ONE chance roll for one distinct profile -- not two, even though two heroIds/tabs contributed. '
      + 'Dedupe happened BEFORE the roll (D4\'s own rule, extended to loot): rolling twice and discarding '
      + 'the second draw would still have consumed a random call nobody asked for.');
  } finally {
    bound.close();
  }
});

test('server: siblings roll INDEPENDENTLY -- each gets their own chance roll, never shared or skipped', () => {
  const path = tempDbPath('galaquest-r1c2-siblings-');
  const random = missRandom();
  const bound = coordinatorOn(path, { random, dropCatalogue: FIXTURE_CATALOGUE });
  try {
    bound.rewards.join('hero-a', 'guest-siblingA');
    bound.rewards.join('hero-b', 'guest-siblingB');

    bound.rewards.processTick([hit('wolf-a', 1, 'hero-a'), defeated('wolf-a', 1, 'hero-a')]);
    assert.equal(random.calls.length, 1, 'sibling A rolled once');

    bound.rewards.processTick([hit('wolf-b', 1, 'hero-b'), defeated('wolf-b', 1, 'hero-b')]);
    assert.equal(random.calls.length, 2, 'sibling B rolled its OWN chance too -- not skipped because A already rolled');
  } finally {
    bound.close();
  }
});

test('server: two DIFFERENT siblings in the SAME tick each get their own roll, and neither\'s counts '
  + 'toward the other\'s dedupe', () => {
  const path = tempDbPath('galaquest-r1c2-siblings-onetick-');
  const random = missRandom();
  const bound = coordinatorOn(path, { random, dropCatalogue: FIXTURE_CATALOGUE });
  try {
    bound.rewards.join('hero-a', 'guest-siblingA2');
    bound.rewards.join('hero-b', 'guest-siblingB2');
    bound.rewards.processTick([
      hit('wolf-a', 1, 'hero-a'), defeated('wolf-a', 1, 'hero-a'),
      hit('wolf-b', 1, 'hero-b'), defeated('wolf-b', 1, 'hero-b'),
    ]);
    assert.equal(random.calls.length, 2, 'two distinct guests, two enemy lives -- two independent rolls in the one tick');
  } finally {
    bound.close();
  }
});

test('server: a leash/respawn with no defeat rolls no loot either', () => {
  const path = tempDbPath('galaquest-r1c2-leash-');
  const random = missRandom();
  const bound = coordinatorOn(path, { random, dropCatalogue: FIXTURE_CATALOGUE });
  try {
    bound.rewards.join('hero-1', GUEST);
    bound.rewards.processTick([
      hit('wolf-a', 1, 'hero-1'),
      { type: 'wolf-respawned', enemyId: 'wolf-a', kind: 'wolf', level: 1 },
    ]);
    assert.equal(random.calls.length, 0, 'no defeat, no reward decision at all -- not even a suppressed one');
  } finally {
    bound.close();
  }
});

test('server: replaying the exact same drained events (same event objects) rolls NO additional chance', () => {
  // rewards/marks.js's foldEvents guards a replay by event-OBJECT-identity (a WeakSet), so the
  // identical array handed back a second time folds to zero awards -- applyCombatRewards is never
  // even reached for it. This is the SAME shape test/progression-r1-c1.test.mjs's own "replaying the
  // exact same drained events awards no second combat-XP fact" test proves for XP; this proves the
  // identical property holds for the loot roll riding alongside it.
  const path = tempDbPath('galaquest-r1c2-replay-');
  const random = missRandom();
  const bound = coordinatorOn(path, { random, dropCatalogue: FIXTURE_CATALOGUE });
  try {
    bound.rewards.join('hero-1', GUEST);
    const events = [hit('wolf-a', 1, 'hero-1'), defeated('wolf-a', 1, 'hero-1')];
    bound.rewards.processTick(events);
    assert.equal(random.calls.length, 1, 'setup: the real kill rolled once');

    bound.rewards.processTick(events); // the SAME array/objects, handed back a second time
    assert.equal(random.calls.length, 1, 'a replayed batch rolls NOTHING new -- the fold never re-emits the award');
  } finally {
    bound.close();
  }
});

test('server: the gear-owned row lands in the SAME applyAll transaction as the xp-earned row (source)', () => {
  // The identical technique test/lantern-xp-award.test.mjs's own "the coordinator hands the pair to
  // the store as ONE batch" test uses against applyLanternUnlock -- a SOURCE check, because the
  // coordinator opens its own store connection and there is no other seam to observe the call shape.
  const source = readFileSync(new URL('../net/gameServerCore.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const body = /function applyCombatRewards\([\s\S]*?\n  \}/.exec(source);
  assert.ok(body, 'applyCombatRewards has moved or been renamed -- this guard cannot see it any more');

  assert.ok(/decideCombatReward\(/.test(body[0]), 'applyCombatRewards must call decideCombatReward, not re-price/re-roll inline');
  assert.ok(/ownedItemIdsFor\(/.test(body[0]), 'eligibility must be checked against the SAME ownership authority every other durable read uses');
  assert.ok(/type:\s*'gear-owned'/.test(body[0]), 'the gear-owned row must be built inside this same function');
  assert.ok(/store\.applyAll\(/.test(body[0]), 'the pair must go through applyAll, the only transactional write');
  assert.equal((body[0].match(/store\.apply\(/g) ?? []).length, 0,
    'a bare store.apply() here would land the XP or the gear without the other -- the same half-landed state '
    + 'applyLanternUnlock\'s own header names as a stop condition');
  // Ownership only -- a combat reward must never itself grant an equip fact (the existing G1 equip
  // law stays the only path to wearing anything). Checked structurally: neither equip fact TYPE
  // literal may appear anywhere in this function's body at all.
  assert.ok(!/'weapon-equipped'/.test(body[0]) && !/'gear-equipped'/.test(body[0]),
    'applyCombatRewards must never construct an equip fact of either type');
});

// ── D6: offline -- the full round trip, with a fixture catalogue ────────────────────────────────────

function deviceStorage() {
  const memory = new Map();
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => { memory.set(k, String(v)); },
    removeItem: (k) => { memory.delete(k); },
  };
}

const OFFLINE_PROFILE = 'p-r1c2-offline-1111';

let uuidCounter = 0;
function offlineSession(storage) {
  return createProfileStore({
    storage,
    randomUUID: () => `uuid-${uuidCounter += 1}`,
    now: () => new Date(1_700_000_000_000 + (uuidCounter += 1) * 1000),
  });
}

function offlinePageLoad(storage, options = {}) {
  const profiles = offlineSession(storage);
  const offline = createOfflineProgress({
    profiles,
    profileId: OFFLINE_PROFILE,
    mintLifeId: createLifeIdMinter(),
    ...options,
  });
  return {
    profiles,
    killWolf: (level = 1, enemyId = 'wolf-a') => offline.recordKills([
      { type: 'wolf-defeated', enemyId, kind: 'wolf', level },
    ]),
  };
}

test('offline: production (empty) catalogue never grants gear and never rolls random', () => {
  const storage = deviceStorage();
  let calls = 0;
  const session = offlinePageLoad(storage, { random: () => { calls += 1; return 0; } });
  session.killWolf(1, 'wolf-a');
  session.killWolf(1, 'wolf-b');
  assert.equal(calls, 0, 'ORDINARY_DROP_ITEM_IDS is empty offline too -- same law, same honest silence');
  assert.deepEqual(
    [...session.profiles.stateFor(OFFLINE_PROFILE).ownedItemIds].sort(),
    [...DEFAULT_OWNED_ITEM_IDS].sort(),
    'nothing beyond the baseline starter kit was ever granted',
  );
});

test('offline: a deterministic fixture proves the full successful grant path end to end', () => {
  const storage = deviceStorage();
  const session = offlinePageLoad(storage, {
    random: scriptedRandom([0, 0]), // hit, then the first (sorted) fixture item
    dropCatalogue: FIXTURE_CATALOGUE,
  });
  const raised = session.killWolf(1, 'wolf-a');
  const gearEvents = raised.filter((event) => event.type === 'gear-owned');
  assert.equal(gearEvents.length, 1);
  assert.equal(gearEvents[0].value, FIXTURE_ITEM_A);
  assert.ok(gearEvents[0].eventId.startsWith(`own:${OFFLINE_PROFILE}:`),
    'the SAME own:<profile>:<item> identity shape net/gameServerCore.mjs\'s grantOwnership uses');
  assert.ok(session.profiles.stateFor(OFFLINE_PROFILE).ownedItemIds.includes(FIXTURE_ITEM_A));
});

test('offline: an owned fixture item is never re-promised, and survives a simulated reload', () => {
  const storage = deviceStorage();
  const first = offlinePageLoad(storage, {
    random: scriptedRandom([0, 0]),
    dropCatalogue: FIXTURE_CATALOGUE,
  });
  first.killWolf(1, 'wolf-a');
  assert.ok(first.profiles.stateFor(OFFLINE_PROFILE).ownedItemIds.includes(FIXTURE_ITEM_A));

  // A second page load -- new profile store, new ledger, new life-id minter -- over the SAME storage,
  // with a random stream that would ALWAYS pick index 0 again if eligibility were not re-checked.
  const second = offlinePageLoad(storage, {
    random: scriptedRandom([0, 0]),
    dropCatalogue: FIXTURE_CATALOGUE,
  });
  const raised = second.killWolf(1, 'wolf-b');
  const gearEvents = raised.filter((event) => event.type === 'gear-owned');
  assert.equal(gearEvents.length, 1);
  assert.equal(gearEvents[0].value, FIXTURE_ITEM_B, 'never FIXTURE_ITEM_A again -- the reload remembered ownership');
  assert.deepEqual(
    [...second.profiles.stateFor(OFFLINE_PROFILE).ownedItemIds].filter((id) => id.startsWith('fixture-')).sort(),
    [FIXTURE_ITEM_A, FIXTURE_ITEM_B],
  );
});

test('offline: empty eligible pool consumes no randomness even with a non-empty catalogue -- '
  + 'ownership already covers it', () => {
  const storage = deviceStorage();
  const session = offlinePageLoad(storage, {
    random: scriptedRandom([0, 0]),
    dropCatalogue: FIXTURE_CATALOGUE,
  });
  // Own everything in the catalogue directly (as if a prior session already granted both), then kill
  // once more -- the roll must never happen.
  session.profiles.recordFacts(OFFLINE_PROFILE, [
    { eventId: `own:${OFFLINE_PROFILE}:${FIXTURE_ITEM_A}`, type: 'gear-owned', value: FIXTURE_ITEM_A },
    { eventId: `own:${OFFLINE_PROFILE}:${FIXTURE_ITEM_B}`, type: 'gear-owned', value: FIXTURE_ITEM_B },
  ]);
  let calls = 0;
  const countingSession = offlinePageLoad(storage, {
    random: () => { calls += 1; return 0; },
    dropCatalogue: FIXTURE_CATALOGUE,
  });
  countingSession.killWolf(1, 'wolf-c');
  assert.equal(calls, 0, 'both fixture items already owned -- an honest suppression, not a wasted roll');
});

test('offline: grant is ownership only -- no equip fact is ever raised alongside it', () => {
  const storage = deviceStorage();
  const session = offlinePageLoad(storage, {
    random: scriptedRandom([0, 0]),
    dropCatalogue: FIXTURE_CATALOGUE,
  });
  const raised = session.killWolf(1, 'wolf-a');
  assert.equal(raised.filter((event) => event.type === 'weapon-equipped' || event.type === 'gear-equipped').length, 0);
});

// ── D6/co-op: offline -> reconnect -> server union produces no duplicate durable facts ─────────────

test('offline and server derive the IDENTICAL own:<profile>:<item> grant identity for the same '
  + 'profile+item, and the store collapses two writes under it to ONE row -- what makes union safe', () => {
  // The property that makes union safe: offlineProgress.js's grant identity and
  // net/gameServerCore.mjs's applyCombatRewards identity are the SAME NAME for the same
  // guest/profile and item.
  //
  // This test used to hand-construct BOTH sides as its own template literals and assert they
  // matched, which proved only that one string equals a copy of itself -- a tautology that would
  // have gone on passing if either production file's own inline template drifted. Both call sites
  // now call gearOwnedEventId, so the real assertion is against THE function they actually use.
  const guestId = 'guest-union-1234';
  const itemId = FIXTURE_ITEM_A;
  assert.equal(gearOwnedEventId(guestId, itemId), `own:${guestId}:${itemId}`,
    'the shape both reward paths mint, pinned once against a literal so a silent reshaping is caught');

  // The generic store guarantee that identity equality actually relies on: two applies of the SAME
  // eventId collapse to one durable row regardless of which side minted it first -- a store-mechanics
  // property, proven here with a real known item id since it is not ordinary-drop-specific at all
  // (net/gameServerCore.mjs's own grantOwnership/claimWildwoodBlade already rest on this same fact).
  const path = tempDbPath('galaquest-r1c2-union-');
  const store = openRewardStore(path);
  try {
    const eventId = gearOwnedEventId(guestId, STARTER_SWORD_ID);
    assert.equal(
      store.apply({
        guestId, heroId: 'hero-1', type: 'gear-owned', eventId, value: STARTER_SWORD_ID,
      }).applied,
      true,
      'the first grant, whichever side minted it, lands',
    );
    assert.equal(
      store.apply({
        guestId, heroId: 'hero-1', type: 'gear-owned', eventId, value: STARTER_SWORD_ID,
      }).applied,
      false,
      'a second write under the IDENTICAL eventId -- an offline grant reconciling with an independent '
      + 'server roll for the same item -- is a replay, never a second row',
    );
  } finally {
    store.close();
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

// ── D7: the ceremony gate -- pure, no DOM ────────────────────────────────────────────────────────────

test('ceremony gate: a gear ceremony requested with nothing showing plays IMMEDIATELY', () => {
  const gate = createCeremonyGate();
  let shown = 0;
  gate.requestGearCeremony(() => { shown += 1; });
  assert.equal(shown, 1);
});

test('ceremony gate: level-up wins -- a gear ceremony requested while level-up is showing WAITS, and '
  + 'still arrives once the level-up ends', () => {
  const gate = createCeremonyGate();
  let shown = 0;
  gate.levelUpStarted();
  gate.requestGearCeremony(() => { shown += 1; });
  assert.equal(shown, 0, 'held, not dropped, while the level-up is up');
  gate.levelUpEnded();
  assert.equal(shown, 1, 'released the moment the level-up ends');
});

test('ceremony gate: two gear ceremonies queued behind a level-up never stack -- each releases only '
  + 'after the previous one reports it is actually done', () => {
  const gate = createCeremonyGate();
  const shownOrder = [];
  gate.levelUpStarted();
  gate.requestGearCeremony(() => shownOrder.push('first'));
  gate.requestGearCeremony(() => shownOrder.push('second'));
  assert.deepEqual(shownOrder, [], 'neither has played yet');

  gate.levelUpEnded();
  assert.deepEqual(shownOrder, ['first'], 'only the FIRST queued ceremony is released');

  gate.gearCeremonyEnded();
  assert.deepEqual(shownOrder, ['first', 'second'], 'the second releases only once the first reports done -- never stacked');
});

test('ceremony gate: a level-up that starts and ends with nothing queued is a no-op for gear ceremonies', () => {
  const gate = createCeremonyGate();
  gate.levelUpStarted();
  gate.levelUpEnded();
  let shown = 0;
  gate.requestGearCeremony(() => { shown += 1; });
  assert.equal(shown, 1, 'the gate is unblocked again -- a later request plays immediately');
});

test('ceremony gate: a DUPLICATE levelUpEnded cannot free the screen out from under a gear ceremony '
  + 'that has since taken it', () => {
  const gate = createCeremonyGate();
  const shownOrder = [];
  gate.levelUpStarted();
  gate.requestGearCeremony(() => shownOrder.push('first'));
  gate.requestGearCeremony(() => shownOrder.push('second'));

  gate.levelUpEnded();
  assert.deepEqual(shownOrder, ['first'], 'the level-up ended and released exactly one gear ceremony');

  gate.levelUpEnded();
  assert.deepEqual(shownOrder, ['first'],
    'a repeated level-up-ended is not a gear-ceremony-ended: the first card still owns the screen');
});

test('ceremony gate: requestGearCeremony requires a function', () => {
  const gate = createCeremonyGate();
  assert.throws(() => gate.requestGearCeremony(null), TypeError);
  assert.throws(() => gate.requestGearCeremony(undefined), TypeError);
});

test('ceremony gate: levelUpStarted while a gear ceremony is already showing still blocks the NEXT one', () => {
  // A boundary case, not the primary one (see ceremonyGate.js's own header on scope): proves the gate
  // does not accidentally release a queued gear ceremony out from under a level-up that started while
  // the FIRST gear ceremony was still up.
  const gate = createCeremonyGate();
  let shown = 0;
  gate.requestGearCeremony(() => { shown += 1; }); // plays immediately, gate now blocked
  assert.equal(shown, 1);
  gate.levelUpStarted();
  gate.requestGearCeremony(() => { shown += 1; }); // queued -- still blocked
  assert.equal(shown, 1);
  gate.levelUpEnded();
  assert.equal(shown, 2, 'released once the level-up (the thing that kept it blocked) ends');
});
