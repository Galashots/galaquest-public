// THE ONE LEVEL -> HERO STAT LAW, tested as a law rather than as an arithmetic transcript.
//
// Same discipline test/progression-levels.test.mjs applies to the XP curve, and for the same reason:
// the exact per-level grants are tunable v0 data that V1 may revisit once the opening's authored
// beats have been measured, but the RELATIONSHIPS are not. A re-tune that makes a level worth
// nothing, makes it worth more than a weapon, or makes a stat stop being an exact integer at
// Level 1000 is a bug whatever the numbers say. So the exact-value tests here are short and the
// invariant tests are long.
//
// It also pins the two couplings the module cannot express as imports, because GQ-007 hit 6 is
// explicit that a relationship stated only in prose is not stated at all: "derive it, or pin the
// relationship in a test. Prose in a comment is neither."

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { BASE_HERO_DAMAGE, HERO_MAX_HP } from '../public/src/combat/encounter.js';
import {
  DEFAULT_EQUIPPED_WEAPON_ID,
  STARTER_SWORD_ID,
  WILDWOOD_BLADE_ID,
  damageFor,
} from '../public/src/progression/items.js';
import { LEVEL_ONE, cumulativeXpForLevel } from '../public/src/progression/levels.js';
import {
  HERO_DAMAGE_PER_LEVEL,
  LEVEL_1_BASE_MAX_HP,
  LEVEL_1_STARTER_DAMAGE,
  LEVEL_1_STARTER_STATS,
  MAX_HP_PER_LEVEL,
  WREN_CHARM_MAX_HP_BONUS,
  maxHpForLevel,
  resolveHeroStats,
  resolvedHeroDamage,
  resolvedMaxHp,
} from '../public/src/progression/heroStats.js';

// The brief's own worked table, and the only absolute numbers in this file
// (docs/briefs/PROGRESSION_P2_FIRST_HERO_LEVEL_UP.md, "Representative states").
const BRIEF_STATES = [
  { level: 1, weapon: STARTER_SWORD_ID, maxHp: 30, damage: 10 },
  { level: 2, weapon: STARTER_SWORD_ID, maxHp: 35, damage: 12 },
  { level: 5, weapon: STARTER_SWORD_ID, maxHp: 50, damage: 18 },
  { level: 1, weapon: WILDWOOD_BLADE_ID, maxHp: 30, damage: 20 },
  { level: 2, weapon: WILDWOOD_BLADE_ID, maxHp: 35, damage: 22 },
];

test('the brief\'s representative states resolve to the stats the brief names', () => {
  for (const { level, weapon, maxHp, damage } of BRIEF_STATES) {
    assert.equal(maxHpForLevel(level), maxHp, `Level ${level} must have ${maxHp} max HP`);
    assert.equal(resolvedHeroDamage(level, weapon), damage,
      `Level ${level} holding ${weapon} must hit for ${damage}`);
  }
});

// ── the couplings that keep this module honest ──────────────────────────────────────────────────

test('the Level-1 body IS the body the fight falls back to (GQ-007)', () => {
  // Not "equals" by coincidence: heroStats.js imports HERO_MAX_HP and re-exports it under the name
  // progression uses for it. This asserts the import has not been quietly replaced by a literal.
  assert.equal(LEVEL_1_BASE_MAX_HP, HERO_MAX_HP,
    'progression/heroStats.js must keep importing the rules layer\'s own body rather than typing 30');
  assert.equal(maxHpForLevel(LEVEL_ONE), HERO_MAX_HP,
    'a Level-1 hero and a hero the rules were told nothing about are the same size body');
});

test('the Level-1 starter blow IS the blow the fight falls back to (GQ-007)', () => {
  // combat/encounter.js may import nothing outside combat/ (test/combat-purity.test.mjs), so its
  // no-damage-named floor cannot BE progression/items.js's starter sword -- it can only equal it.
  // That is precisely the kind of relationship the ledger says to pin rather than to comment, and
  // this is the pin: a caller that names no damage must swing the sword every child starts with.
  assert.equal(LEVEL_1_STARTER_DAMAGE, damageFor(STARTER_SWORD_ID),
    'the POWER benchmark must be read off the catalogue, not typed');
  assert.equal(BASE_HERO_DAMAGE, LEVEL_1_STARTER_DAMAGE,
    'combat/encounter.js\'s BASE_HERO_DAMAGE and the starter sword have drifted apart: an unnamed '
    + 'weapon would now do something other than what a fresh child actually holds');
  assert.equal(resolvedHeroDamage(LEVEL_ONE, STARTER_SWORD_ID), BASE_HERO_DAMAGE);
});

test('an unknown or absent weapon resolves to the starter sword rather than to nothing', () => {
  // The floor progression/items.js's swingDamageFor owns, checked THROUGH this module because that
  // is how every caller reaches it. A bookkeeping gap must never become a sword that stopped working.
  for (const nothing of [null, undefined, '', 'no_such_item', 42]) {
    assert.equal(resolvedHeroDamage(LEVEL_ONE, nothing), LEVEL_1_STARTER_DAMAGE,
      `an unnamed weapon is the starter sword (got a different answer for ${JSON.stringify(nothing)})`);
  }
  assert.equal(resolvedHeroDamage(LEVEL_ONE), damageFor(DEFAULT_EQUIPPED_WEAPON_ID),
    'and the default argument is the default weapon, not a second opinion about it');
});

// ── the law, as relationships ───────────────────────────────────────────────────────────────────

test('every level adds exactly MAX_HP_PER_LEVEL, with no gaps and no jumps', () => {
  for (let level = LEVEL_ONE; level < LEVEL_ONE + 40; level += 1) {
    assert.equal(maxHpForLevel(level + 1) - maxHpForLevel(level), MAX_HP_PER_LEVEL,
      `the step from ${level} to ${level + 1} is not one level's worth`);
  }
});

test('every level adds exactly HERO_DAMAGE_PER_LEVEL for the same equipped weapon', () => {
  for (const weapon of [STARTER_SWORD_ID, WILDWOOD_BLADE_ID]) {
    for (let level = LEVEL_ONE; level < LEVEL_ONE + 40; level += 1) {
      assert.equal(
        resolvedHeroDamage(level + 1, weapon) - resolvedHeroDamage(level, weapon),
        HERO_DAMAGE_PER_LEVEL,
        `holding ${weapon}, the step from ${level} to ${level + 1} is not one level's worth`,
      );
    }
  }
});

test('the weapon and the level are independent terms -- neither cancels the other', () => {
  // The property that keeps gear meaningful as levels rise, and levels meaningful whatever gear is
  // held. A model that multiplied them instead would make an early weapon upgrade worth less every
  // level, which is the opposite of what the contract's Hero-dominant budget wants.
  const gap = damageFor(WILDWOOD_BLADE_ID) - damageFor(STARTER_SWORD_ID);
  for (const level of [1, 2, 5, 20, 100]) {
    assert.equal(
      resolvedHeroDamage(level, WILDWOOD_BLADE_ID) - resolvedHeroDamage(level, STARTER_SWORD_ID),
      gap,
      `at Level ${level} the Blade stopped being worth what the catalogue says it is worth`,
    );
  }
});

test('both stats are strictly increasing in level', () => {
  let previousHp = 0;
  let previousDamage = 0;
  for (const level of [1, 2, 3, 5, 10, 20, 100, 1000]) {
    const hp = maxHpForLevel(level);
    const damage = resolvedHeroDamage(level, STARTER_SWORD_ID);
    assert.ok(hp > previousHp, `max HP did not rise at Level ${level}`);
    assert.ok(damage > previousDamage, `damage did not rise at Level ${level}`);
    previousHp = hp;
    previousDamage = damage;
  }
});

// ── the charm ───────────────────────────────────────────────────────────────────────────────────

test('Wren\'s charm adds exactly WREN_CHARM_MAX_HP_BONUS at every level, and never touches damage', () => {
  assert.equal(WREN_CHARM_MAX_HP_BONUS, 10, 'the brief\'s value, preserved from "one heart of three"');
  for (const level of [1, 2, 5, 20, 100, 1000]) {
    assert.equal(
      resolvedMaxHp(level, { charmOwned: true }) - resolvedMaxHp(level, { charmOwned: false }),
      WREN_CHARM_MAX_HP_BONUS,
      `the charm is worth something different at Level ${level}`,
    );
  }
  // A charm is a body, not an arm. If this ever stops being true it will be because somebody added
  // a gear term to the wrong function.
  assert.equal(resolvedHeroDamage(LEVEL_ONE, STARTER_SWORD_ID), LEVEL_1_STARTER_DAMAGE);
});

test('the brief\'s charmed states: 40 HP at Level 1, 45 at Level 2', () => {
  assert.equal(resolvedMaxHp(1, { charmOwned: true }), 40);
  assert.equal(resolvedMaxHp(2, { charmOwned: true }), 45);
});

test('no bonus named is no bonus applied', () => {
  assert.equal(resolvedMaxHp(LEVEL_ONE), maxHpForLevel(LEVEL_ONE),
    'every caller written before the charm existed must get the body it always got');
});

// ── outside the balanced band ───────────────────────────────────────────────────────────────────
//
// The contract deliberately balances roughly Levels 1-20 and requires only that behaviour beyond it
// stays "finite, monotone, and representable". These are the representable half, sampled at the
// levels the contract itself names.

test('representative high levels stay exact integers', () => {
  for (const level of [20, 100, 1000]) {
    const hp = maxHpForLevel(level);
    const damage = resolvedHeroDamage(level, STARTER_SWORD_ID);
    assert.ok(Number.isSafeInteger(hp), `max HP at Level ${level} is not an exact integer: ${hp}`);
    assert.ok(Number.isSafeInteger(damage), `damage at Level ${level} is not an exact integer: ${damage}`);
    assert.ok(Number.isSafeInteger(cumulativeXpForLevel(level)),
      `the XP to reach Level ${level} is not an exact integer either -- the two laws must agree`);
  }
  // The brief's own arithmetic, spelled out so a reader can check the curve without running it.
  assert.equal(maxHpForLevel(20), 125);
  assert.equal(maxHpForLevel(1000), 5025);
  assert.equal(resolvedHeroDamage(1000, STARTER_SWORD_ID), 2008);
});

test('a level so large the stats would stop being countable is refused, not rounded', () => {
  // levels.js refuses a total XP that is not a safe integer rather than normalising it, because
  // "corruption wearing a number's clothes" must not resolve into a plausible hero. Same posture at
  // the far end: a body that has silently stopped being the number it prints is worse than an error.
  assert.throws(() => maxHpForLevel(Number.MAX_SAFE_INTEGER), RangeError);
  assert.throws(() => resolvedHeroDamage(Number.MAX_SAFE_INTEGER, STARTER_SWORD_ID), RangeError);
});

test('a level that is not a level is refused', () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, '2', null, undefined]) {
    assert.throws(() => maxHpForLevel(bad), TypeError, `maxHpForLevel accepted ${JSON.stringify(bad)}`);
  }
});

// ── the one-call resolution ─────────────────────────────────────────────────────────────────────

test('resolveHeroStats reads the level through the P1 authority, never independently', () => {
  // The threshold is levels.js's, so a re-tune there has to move this. Written as "the XP that
  // reaches Level 2" rather than as 100 for exactly that reason (GQ-018).
  const level2Xp = cumulativeXpForLevel(2);
  const before = resolveHeroStats({ totalXp: level2Xp - 1, equippedWeaponId: STARTER_SWORD_ID });
  const after = resolveHeroStats({ totalXp: level2Xp, equippedWeaponId: STARTER_SWORD_ID });

  assert.equal(before.level, 1);
  assert.equal(after.level, 2);
  assert.equal(after.maxHp - before.maxHp, MAX_HP_PER_LEVEL, 'crossing the threshold is worth a level of HP');
  assert.equal(after.heroDamage - before.heroDamage, HERO_DAMAGE_PER_LEVEL);
});

test('resolveHeroStats agrees with its own parts, so no caller can combine them differently', () => {
  const state = { totalXp: 640, equippedWeaponId: WILDWOOD_BLADE_ID, charmOwned: true };
  const stats = resolveHeroStats(state);
  assert.equal(stats.maxHp, resolvedMaxHp(stats.level, { charmOwned: true }));
  assert.equal(stats.heroDamage, resolvedHeroDamage(stats.level, WILDWOOD_BLADE_ID));
  assert.equal(stats.levelState.level, stats.level,
    'the level beside the meter and the level the stats were built from must be one number');
});

test('a hero who has earned nothing is a Level-1 starter hero', () => {
  const fresh = resolveHeroStats();
  assert.deepEqual(
    { level: fresh.level, maxHp: fresh.maxHp, heroDamage: fresh.heroDamage },
    { level: LEVEL_ONE, maxHp: LEVEL_1_BASE_MAX_HP, heroDamage: LEVEL_1_STARTER_DAMAGE },
  );
});

test('resolveHeroStats refuses a corrupt XP total rather than folding it into Level 1', () => {
  // Inherited from levels.js on purpose: a journal that has been hand-edited or has decoded badly
  // must not present as a plausible hero nobody would think to look at.
  for (const bad of [-1, 1.5, NaN, Infinity, '100']) {
    assert.throws(() => resolveHeroStats({ totalXp: bad }), TypeError,
      `resolveHeroStats accepted a total XP of ${JSON.stringify(bad)}`);
  }
});

test('the exported Level-1 benchmark is the same hero resolveHeroStats builds', () => {
  // power.js measures every hero against LEVEL_1_STARTER_STATS. If that frozen object ever drifts
  // from what the resolver actually produces for a fresh child, every POWER in the game is wrong by
  // a constant nobody can see.
  const fresh = resolveHeroStats();
  assert.equal(LEVEL_1_STARTER_STATS.maxHp, fresh.maxHp);
  assert.equal(LEVEL_1_STARTER_STATS.heroDamage, fresh.heroDamage);
  assert.ok(Object.isFrozen(LEVEL_1_STARTER_STATS), 'a benchmark a caller can edit is not a benchmark');
});
