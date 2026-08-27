// test/rune-chests.test.mjs
//
// progression/runeChests.js's own pure rules: the kill counter, chest placement, the question bank,
// judging and reward sizing. No DOM, no clock -- every test drives it with a scripted rng the same
// way test/enemy-drops.test.mjs drives world/enemyDrops.js's own roll.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHEST_COLLECT_RADIUS_METERS,
  CHEST_SPAWN_MAX_METERS,
  CHEST_SPAWN_MIN_METERS,
  KILLS_PER_CHEST,
  MAX_SHIMMER_TIER,
  QUESTION_BANKS,
  QUESTION_TYPES,
  REWARD_XP_CORRECT,
  REWARD_XP_NORMAL,
  closeRuneChest,
  createRuneChestState,
  heroInCombat,
  judgeRuneChestAnswer,
  openRuneChest,
  pickChestSpawnPoint,
  pickRuneChestQuestion,
  registerRuneChestKill,
  rewardXpForRuneChestAnswer,
  runeChestXpEventId,
} from '../public/src/progression/runeChests.js';

function scriptedRng(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

// ── the counter ─────────────────────────────────────────────────────────────────────────────────

test('a fresh state has no chest and no kills counted', () => {
  const state = createRuneChestState();
  assert.equal(state.killsSinceChest, 0);
  assert.equal(state.chest, null);
  assert.equal(state.nextQuestionTypeIndex, 0);
});

test('the 8th kill is due; the first 7 are not', () => {
  let state = createRuneChestState();
  for (let i = 1; i < KILLS_PER_CHEST; i += 1) {
    const result = registerRuneChestKill(state);
    assert.equal(result.chestDue, false, `kill ${i} must not be due`);
    state = result.state;
  }
  const eighth = registerRuneChestKill(state);
  assert.equal(eighth.chestDue, true);
  assert.equal(eighth.state.killsSinceChest, 0, 'the counter resets once a chest is due');
});

test('the counter keeps counting past 8 for the NEXT chest once this one is answered', () => {
  let state = createRuneChestState();
  for (let i = 0; i < KILLS_PER_CHEST; i += 1) state = registerRuneChestKill(state).state;
  // Open and answer the first chest.
  state = openRuneChest(state, { id: 'c1', x: 0, z: 0, rng: scriptedRng([0.1]) });
  state = closeRuneChest(state);
  for (let i = 1; i < KILLS_PER_CHEST; i += 1) {
    assert.equal(registerRuneChestKill(state).chestDue, false);
    state = registerRuneChestKill(state).state;
  }
  assert.equal(registerRuneChestKill(state).chestDue, true, 'a second full 8 earns a second chest');
});

test('8 more kills while a chest already stands upgrades its shimmer instead of spawning a second', () => {
  let state = createRuneChestState();
  for (let i = 0; i < KILLS_PER_CHEST; i += 1) state = registerRuneChestKill(state).state;
  state = openRuneChest(state, { id: 'c1', x: 1, z: 2, rng: scriptedRng([0.1]) });
  assert.equal(state.chest.shimmerTier, 1);
  for (let round = 0; round < 5; round += 1) {
    for (let i = 0; i < KILLS_PER_CHEST; i += 1) {
      const result = registerRuneChestKill(state);
      assert.equal(result.chestDue, false, 'no second chest while one already stands');
      state = result.state;
    }
  }
  assert.equal(state.chest.id, 'c1', 'still the SAME chest, never replaced');
  assert.ok(state.chest.shimmerTier <= MAX_SHIMMER_TIER, 'shimmer never climbs past its cap');
  assert.equal(state.chest.shimmerTier, MAX_SHIMMER_TIER, 'five rounds of upgrades reach the cap');
});

test('shimmer tier is capped, never climbs unbounded', () => {
  let state = createRuneChestState();
  for (let i = 0; i < KILLS_PER_CHEST; i += 1) state = registerRuneChestKill(state).state;
  state = openRuneChest(state, { id: 'c1', x: 0, z: 0, rng: scriptedRng([0.1]) });
  for (let round = 0; round < 20; round += 1) {
    for (let i = 0; i < KILLS_PER_CHEST; i += 1) state = registerRuneChestKill(state).state;
  }
  assert.equal(state.chest.shimmerTier, MAX_SHIMMER_TIER);
});

// ── spawn placement ─────────────────────────────────────────────────────────────────────────────

test('the chest spawns within [CHEST_SPAWN_MIN_METERS, CHEST_SPAWN_MAX_METERS] of the hero', () => {
  for (let trial = 0; trial < 30; trial += 1) {
    const rng = scriptedRng([trial / 30, 1 - trial / 30, 0.5]);
    const point = pickChestSpawnPoint({ playerX: 10, playerZ: -3, rng });
    assert.ok(point, 'a permissive isAllowed always finds a point');
    const distance = Math.hypot(point.x - 10, point.z - (-3));
    assert.ok(distance >= CHEST_SPAWN_MIN_METERS - 1e-9 && distance <= CHEST_SPAWN_MAX_METERS + 1e-9,
      `distance ${distance} out of range`);
  }
});

test('a chest never lands where isAllowed refuses it', () => {
  const rng = scriptedRng([0.1, 0.2, 0.4, 0.6, 0.8, 0.9, 0.15, 0.35, 0.55, 0.75]);
  const refused = { x: 0, z: 0 };
  let calls = 0;
  const isAllowed = (x, z) => {
    calls += 1;
    return Math.hypot(x - refused.x, z - refused.z) > 3;
  };
  const point = pickChestSpawnPoint({ playerX: 0.5, playerZ: 0, rng, isAllowed, attempts: 12 });
  if (point) assert.ok(Math.hypot(point.x, point.z) > 3, 'an accepted point must satisfy isAllowed');
  assert.ok(calls > 0);
});

test('pickChestSpawnPoint gives up and returns null after `attempts` refusals', () => {
  const rng = scriptedRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.05, 0.15, 0.25, 0.35, 0.45]);
  const point = pickChestSpawnPoint({
    playerX: 0, playerZ: 0, rng, isAllowed: () => false, attempts: 5,
  });
  assert.equal(point, null);
});

// ── the question bank ───────────────────────────────────────────────────────────────────────────

test('every question type has at least 12 authored entries', () => {
  for (const type of QUESTION_TYPES) {
    assert.ok(QUESTION_BANKS[type].length >= 12,
      `${type} has only ${QUESTION_BANKS[type].length} entries`);
  }
});

test('every bank entry has three DISTINCT answer texts', () => {
  for (const type of QUESTION_TYPES) {
    for (const entry of QUESTION_BANKS[type]) {
      const all = [entry.correctText, ...entry.distractorTexts];
      assert.equal(new Set(all).size, 3, `${type} entry "${entry.prompt}" has a duplicate answer`);
    }
  }
});

test('counting questions carry a visual emoji row matching the count', () => {
  for (const entry of QUESTION_BANKS.counting) {
    assert.ok(typeof entry.visual === 'string' && entry.visual.length > 0);
    const count = Number(entry.correctText);
    // Each emoji subject is a single Unicode code point repeated `count` times.
    assert.equal([...entry.visual].length, count, `visual for "${entry.prompt}" should show ${count}`);
  }
});

test('arithmetic answers stay within 0..12', () => {
  for (const entry of QUESTION_BANKS.arithmetic) {
    const answer = Number(entry.correctText);
    assert.ok(answer >= 0 && answer <= 12, `"${entry.prompt}" = ${answer} out of range`);
  }
});

test('pickRuneChestQuestion cycles through QUESTION_TYPES round-robin by typeIndex', () => {
  const rng = scriptedRng([0.01]);
  for (let i = 0; i < 8; i += 1) {
    const question = pickRuneChestQuestion({ rng, typeIndex: i });
    assert.equal(question.type, QUESTION_TYPES[i % QUESTION_TYPES.length]);
  }
});

test('the built question has exactly three answers and a valid correctIndex', () => {
  const rng = scriptedRng([0.42, 0.9, 0.1]);
  const question = pickRuneChestQuestion({ rng, typeIndex: 1 });
  assert.equal(question.answers.length, 3);
  assert.ok(question.correctIndex >= 0 && question.correctIndex < 3);
  assert.equal(new Set(question.answers).size, 3);
});

test('the shuffle actually varies the correct answer\'s position across draws', () => {
  const positions = new Set();
  for (let seed = 0; seed < 20; seed += 1) {
    const a = (seed * 0.37) % 1;
    const b = (seed * 0.61 + 0.13) % 1;
    const rng = scriptedRng([a, b, (a + b) % 1]);
    const question = pickRuneChestQuestion({ rng, typeIndex: 0 });
    positions.add(question.correctIndex);
  }
  assert.ok(positions.size > 1, 'the correct answer should not always land in the same slot');
});

// ── opening a chest ─────────────────────────────────────────────────────────────────────────────

test('openRuneChest places the chest and hands it a question atomically', () => {
  const state = createRuneChestState();
  const opened = openRuneChest(state, { id: 'chest-1', x: 5, z: -2, rng: scriptedRng([0.2, 0.4]) });
  assert.ok(opened.chest);
  assert.equal(opened.chest.id, 'chest-1');
  assert.equal(opened.chest.x, 5);
  assert.equal(opened.chest.z, -2);
  assert.equal(opened.chest.shimmerTier, 1);
  assert.ok(opened.chest.question);
  assert.equal(opened.nextQuestionTypeIndex, 1, 'opening advances the round-robin cycle');
});

test('closeRuneChest clears the chest without touching killsSinceChest', () => {
  let state = createRuneChestState();
  state = { ...state, killsSinceChest: 3 };
  state = openRuneChest(state, { id: 'x', x: 0, z: 0, rng: scriptedRng([0.5]) });
  state = closeRuneChest(state);
  assert.equal(state.chest, null);
  assert.equal(state.killsSinceChest, 3);
});

// ── judging and reward ──────────────────────────────────────────────────────────────────────────

test('judgeRuneChestAnswer reports correct only for the actual correctIndex', () => {
  const question = { answers: ['a', 'b', 'c'], correctIndex: 1 };
  assert.deepEqual(judgeRuneChestAnswer(question, 1), { correct: true, correctText: 'b' });
  assert.deepEqual(judgeRuneChestAnswer(question, 0), { correct: false, correctText: 'b' });
  assert.deepEqual(judgeRuneChestAnswer(question, 2), { correct: false, correctText: 'b' });
});

test('judgeRuneChestAnswer never throws on an out-of-range tap', () => {
  const question = { answers: ['a', 'b', 'c'], correctIndex: 0 };
  assert.equal(judgeRuneChestAnswer(question, 99).correct, false);
  assert.equal(judgeRuneChestAnswer(question, -1).correct, false);
});

test('reward sizing: correct pays REWARD_XP_CORRECT, wrong pays REWARD_XP_NORMAL', () => {
  assert.equal(rewardXpForRuneChestAnswer(true), REWARD_XP_CORRECT);
  assert.equal(rewardXpForRuneChestAnswer(false), REWARD_XP_NORMAL);
  assert.ok(REWARD_XP_CORRECT > REWARD_XP_NORMAL);
});

// ── durable identity ────────────────────────────────────────────────────────────────────────────

test('runeChestXpEventId is scoped to the profile and the chest, stable across calls', () => {
  assert.equal(runeChestXpEventId('p-abc', 'chest-1'), 'rune-chest:p-abc:chest-1');
  assert.equal(runeChestXpEventId('p-abc', 'chest-1'), runeChestXpEventId('p-abc', 'chest-1'));
  assert.notEqual(runeChestXpEventId('p-abc', 'chest-1'), runeChestXpEventId('p-xyz', 'chest-1'));
  assert.notEqual(runeChestXpEventId('p-abc', 'chest-1'), runeChestXpEventId('p-abc', 'chest-2'));
});

// ── frozen state, the same discipline every pure state module in this repo keeps ──────────────────

test('every returned state is frozen', () => {
  let state = createRuneChestState();
  assert.ok(Object.isFrozen(state));
  state = registerRuneChestKill(state).state;
  assert.ok(Object.isFrozen(state));
  for (let i = 0; i < KILLS_PER_CHEST - 1; i += 1) state = registerRuneChestKill(state).state;
  state = openRuneChest(state, { id: 'x', x: 0, z: 0, rng: scriptedRng([0.3]) });
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.chest));
  state = closeRuneChest(state);
  assert.ok(Object.isFrozen(state));
});

test('collect radius matches the documented constant and is a sane walk-up distance', () => {
  assert.equal(CHEST_COLLECT_RADIUS_METERS, 1.3);
  assert.ok(CHEST_SPAWN_MIN_METERS < CHEST_SPAWN_MAX_METERS);
  assert.ok(CHEST_SPAWN_MIN_METERS > CHEST_COLLECT_RADIUS_METERS,
    'the chest must spawn further away than the radius that opens it, or it would open on arrival');
});

// ── the mid-fight gate ──────────────────────────────────────────────────────────────────────────
//
// The card is a modal that freezes movement and attack input while it is up (main.js's
// anyOverlayOpen gate), so heroInCombat is the rule that keeps it from opening OVER a live fight.
// The notice radius is passed in by the caller (main.js hands it WOLF_AGGRO_RANGE); these tests
// exercise the rule with an explicit 6 so a radius change shows up where it is made, not here.

test('a biting enemy within the notice radius holds the card', () => {
  assert.equal(heroInCombat({
    heroX: 0, heroZ: 0, noticeRadiusMeters: 6,
    enemies: [{ mode: 'bite', x: 1, z: 1 }],
  }), true);
});

test('an enemy closing in on walk within the notice radius holds the card', () => {
  assert.equal(heroInCombat({
    heroX: 0, heroZ: 0, noticeRadiusMeters: 6,
    enemies: [{ mode: 'walk', x: 4, z: 0 }],
  }), true);
});

test('an idle enemy nearby does NOT hold the card -- proximity alone is not a fight', () => {
  assert.equal(heroInCombat({
    heroX: 0, heroZ: 0, noticeRadiusMeters: 6,
    enemies: [{ mode: 'idle', x: 1, z: 1 }],
  }), false);
});

test('a hostile enemy beyond the notice radius does NOT hold the card', () => {
  assert.equal(heroInCombat({
    heroX: 0, heroZ: 0, noticeRadiusMeters: 6,
    enemies: [{ mode: 'bite', x: 10, z: 10 }],
  }), false);
});

test('dead, dying and returning enemies never hold the card', () => {
  for (const mode of ['dead', 'dying', 'returning']) {
    assert.equal(heroInCombat({
      heroX: 0, heroZ: 0, noticeRadiusMeters: 6,
      enemies: [{ mode, x: 1, z: 1 }],
    }), false, mode);
  }
});

test('no enemies, or a malformed list, reads as not-in-combat rather than throwing', () => {
  assert.equal(heroInCombat({ heroX: 0, heroZ: 0, noticeRadiusMeters: 6, enemies: [] }), false);
  assert.equal(heroInCombat({ heroX: 0, heroZ: 0, noticeRadiusMeters: 6, enemies: null }), false);
  assert.equal(heroInCombat({ heroX: 0, heroZ: 0, noticeRadiusMeters: 6, enemies: [null] }), false);
});
