// The one XP -> Hero Level law, tested as a law rather than as an arithmetic transcript.
//
// P1's whole reason for existing is that a level threshold restated anywhere else is a second law
// (docs/MISTAKES.md GQ-007), and a progression system with two laws is one that disagrees with
// itself in front of a child. So these tests assert RELATIONSHIPS that any correct curve has to
// satisfy -- monotone, contiguous, no gaps, progress resets at a boundary -- plus the handful of
// exact thresholds the committed brief names as v0 data.
//
// The exact constants are deliberately tunable (docs/briefs/PROGRESSION_P1_XP_LEVEL_AUTHORITY.md
// says P2/V1 may re-tune them). The RELATIONSHIPS are not: a re-tune that breaks monotonicity or
// leaves a gap between levels is a bug whatever the numbers say. That split is why the threshold
// tests below are short and the invariant tests are long.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  LEVEL_ONE,
  cumulativeXpForLevel,
  isValidTotalXp,
  levelForXp,
  levelStateForXp,
  xpToAdvanceFrom,
} from '../public/src/progression/levels.js';

// The brief's own worked example, and the only absolute numbers in this file.
const BRIEF_THRESHOLDS = [
  { level: 1, cumulative: 0 },
  { level: 2, cumulative: 100 },
  { level: 3, cumulative: 250 },
  { level: 4, cumulative: 450 },
  { level: 5, cumulative: 700 },
];

test('the brief thresholds resolve to the levels the brief names', () => {
  for (const { level, cumulative } of BRIEF_THRESHOLDS) {
    assert.equal(cumulativeXpForLevel(level), cumulative,
      `Level ${level} must begin at cumulative XP ${cumulative}`);
    assert.equal(levelForXp(cumulative), level,
      `cumulative XP ${cumulative} must BE Level ${level}, not one either side of it`);
  }
});

test('one XP below a threshold is still the previous level', () => {
  for (const { level, cumulative } of BRIEF_THRESHOLDS) {
    if (cumulative === 0) continue;
    assert.equal(levelForXp(cumulative - 1), level - 1,
      `${cumulative - 1} XP must still be Level ${level - 1}: a threshold is reached AT its number`);
  }
});

test('Level 1 is the floor and starts with no progress', () => {
  const state = levelStateForXp(0);
  assert.equal(state.level, LEVEL_ONE);
  assert.equal(state.xpIntoLevel, 0);
  assert.equal(state.progress, 0);
  assert.equal(state.levelStartXp, 0);
});

test('progress resets to zero exactly at a threshold rather than carrying over', () => {
  // The defect this catches is an off-by-one that leaves a freshly-levelled hero showing a nearly
  // full bar: the level advanced but the progress numerator kept the old level's total.
  for (const { level, cumulative } of BRIEF_THRESHOLDS) {
    const state = levelStateForXp(cumulative);
    assert.equal(state.level, level);
    assert.equal(state.xpIntoLevel, 0, `Level ${level} must begin with 0 XP into the level`);
    assert.equal(state.progress, 0, `Level ${level} must begin at 0 progress`);
  }
});

test('one XP short of levelling reports almost-there rather than wrapping', () => {
  const state = levelStateForXp(cumulativeXpForLevel(3) - 1);
  assert.equal(state.level, 2);
  assert.equal(state.xpToNextLevel, 1, 'exactly one XP is owed');
  assert.ok(state.progress > 0.99 && state.progress < 1,
    `progress must approach but never reach 1 inside a level, got ${state.progress}`);
});

test('the level state is internally consistent at every level it reports', () => {
  // THE INVARIANT SET. Any one of these failing means two callers reading different fields of the
  // same state would draw different conclusions about the same hero, which is the whole failure P1
  // exists to make impossible.
  for (let level = 1; level <= 200; level += 1) {
    const start = cumulativeXpForLevel(level);
    for (const offset of [0, 1, 7]) {
      const xp = start + offset;
      if (xp >= cumulativeXpForLevel(level + 1)) continue;
      const state = levelStateForXp(xp);
      assert.equal(state.level, level, `${xp} XP must be Level ${level}`);
      assert.equal(state.totalXp, xp, 'the state must report the XP it was asked about');
      assert.equal(state.levelStartXp, start);
      assert.equal(state.nextLevelXp, cumulativeXpForLevel(level + 1));
      assert.equal(state.xpIntoLevel, offset);
      assert.equal(state.xpForLevel, state.nextLevelXp - state.levelStartXp,
        'the span of a level must be the distance between its own two thresholds');
      assert.equal(state.xpIntoLevel + state.xpToNextLevel, state.xpForLevel,
        'earned-within plus remaining-within must be the whole level, with nothing unaccounted for');
      assert.equal(state.progress, state.xpIntoLevel / state.xpForLevel);
      assert.ok(state.progress >= 0 && state.progress < 1,
        'progress inside a level is [0, 1) -- reaching 1 means the level should already have advanced');
    }
  }
});

test('levels are contiguous: every level begins exactly where the previous one ends', () => {
  // A gap would be XP that belongs to no level; an overlap would be XP that belongs to two.
  for (let level = 1; level <= 1000; level += 1) {
    assert.equal(
      cumulativeXpForLevel(level + 1) - cumulativeXpForLevel(level),
      xpToAdvanceFrom(level),
      `the distance from Level ${level} to ${level + 1} must be exactly what advancing from ${level} costs`,
    );
  }
});

test('the curve is strictly monotone and finite well past the balanced band', () => {
  // The contract balances roughly Levels 1-20 but forbids a baked-in technical cap, so the law has
  // to keep answering sensibly far above anything anyone has tuned.
  let previousCumulative = -1;
  let previousStep = 0;
  for (const level of [1, 2, 5, 19, 20, 21, 99, 100, 101, 999, 1000, 1001]) {
    const cumulative = cumulativeXpForLevel(level);
    const step = xpToAdvanceFrom(level);
    assert.ok(Number.isSafeInteger(cumulative), `Level ${level} cumulative must stay a safe integer`);
    assert.ok(Number.isSafeInteger(step), `Level ${level} step must stay a safe integer`);
    assert.ok(cumulative > previousCumulative, `cumulative XP must strictly increase at Level ${level}`);
    assert.ok(step > previousStep, `each level must cost more than the last, at Level ${level}`);
    assert.equal(levelForXp(cumulative), level, `Level ${level} must round-trip through levelForXp`);
    previousCumulative = cumulative;
    previousStep = step;
  }
});

test('levelForXp never skips or repeats a level as XP climbs', () => {
  // Walks the boundary of every level up to 1000 and asserts the level advances by exactly one at
  // each threshold and not before. A closed-form inverse that is off by one anywhere fails here.
  for (let level = 1; level <= 1000; level += 1) {
    const start = cumulativeXpForLevel(level);
    assert.equal(levelForXp(start), level);
    // Level 1 begins at 0, and one below that is not a total any hero can hold -- it is refused by
    // the validator rather than answered for, which test 11 covers.
    if (level === 1) continue;
    assert.equal(levelForXp(start - 1), level - 1,
      `one XP below Level ${level}'s threshold must be Level ${level - 1}`);
  }
});

test('levelForXp stays exact at XP totals large enough to strain a float inverse', () => {
  // A closed-form sqrt inverse drifts before Number.MAX_SAFE_INTEGER does. These are the totals
  // where an uncorrected one starts answering off by one.
  for (const level of [100_000, 1_000_000, 4_000_000]) {
    const start = cumulativeXpForLevel(level);
    if (!Number.isSafeInteger(start)) continue;
    assert.equal(levelForXp(start), level, `Level ${level} must still resolve exactly`);
    assert.equal(levelForXp(start - 1), level - 1, `just below Level ${level} must be Level ${level - 1}`);
  }
});

test('invalid XP is rejected rather than normalised into legitimate progression', () => {
  // Silently clamping a negative or a NaN to Level 1 would turn a corrupt journal into a plausible
  // hero, which is worse than a loud failure because nobody would ever look for it.
  for (const bad of [-1, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2,
    '100', null, undefined, {}, []]) {
    assert.equal(isValidTotalXp(bad), false, `${JSON.stringify(bad)} must not be a valid total XP`);
    assert.throws(() => levelStateForXp(bad), /xp/i,
      `levelStateForXp must refuse ${JSON.stringify(bad)} rather than answer for it`);
    assert.throws(() => levelForXp(bad), /xp/i,
      `levelForXp must refuse ${JSON.stringify(bad)} rather than answer for it`);
  }
  assert.equal(isValidTotalXp(0), true, '0 is a real total: a hero who has earned nothing yet');
});

test('an invalid level is refused by the curve rather than answered for', () => {
  for (const bad of [0, -1, 1.5, Number.NaN, '3', null]) {
    assert.throws(() => cumulativeXpForLevel(bad), /level/i);
    assert.throws(() => xpToAdvanceFrom(bad), /level/i);
  }
});
