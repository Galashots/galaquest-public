// POWER: the number a child brags about, and the one number the game must never read back.
//
// Issue #41 states both halves and they are easy to get backwards. The first half is a presentation
// requirement and is tested here as arithmetic; the second is an ARCHITECTURE requirement and is
// tested here the only way an architecture requirement can be -- by reading the source of every
// module that decides a fight, an award or a durable write, and failing if any of them imports this
// one. A monotonicity test proves POWER is a good display number; only the import scan proves it is
// still a display number at all.
//
// The invariants below are numbered as the contract numbers them
// (docs/product/PROGRESSION_CONTRACT_V0.md section 5) so a reader can check the coverage against the
// authority rather than against this file's own opinion of what matters.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
import { LEVEL_ONE } from '../public/src/progression/levels.js';
import { resolveHeroStats, resolvedHeroDamage, resolvedMaxHp } from '../public/src/progression/heroStats.js';
import {
  POWER_COMPACT_FROM,
  POWER_DISPLAY_SCALE,
  formatPower,
  levelUpSummary,
  powerChange,
  powerFor,
  realStrengthFor,
} from '../public/src/progression/power.js';
import { cumulativeXpForLevel } from '../public/src/progression/levels.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** The POWER of a hero at `level` holding `weapon`, built through the real stat authority rather
 *  than from a hand-made stats object -- docs/MISTAKES.md GQ-015: a test that hand-feeds a pure
 *  function proves the function, not where its inputs come from. */
function powerAt(level, weapon = STARTER_SWORD_ID, { charmOwned = false } = {}) {
  return powerFor({
    maxHp: resolvedMaxHp(level, { charmOwned }),
    heroDamage: resolvedHeroDamage(level, weapon),
  });
}

// ── the benchmarks the brief names ──────────────────────────────────────────────────────────────

test('the three benchmark loadouts read the values the brief promises', () => {
  assert.equal(powerAt(1, STARTER_SWORD_ID), 1000, 'L1 + Starter is the benchmark, so it is 1,000');
  assert.equal(powerAt(2, STARTER_SWORD_ID), 1400, 'the first real level-up is worth +400');
  assert.equal(powerAt(1, WILDWOOD_BLADE_ID), 2000, 'twice the blow is twice the readiness');
});

test('the Level-1 starter hero is exactly 1.0 in real-strength space', () => {
  // Not a coincidence of the display scale: realStrength IS the ratio to this hero, so a benchmark
  // that is not 1 means the denominators have drifted from the hero they claim to describe.
  const fresh = resolveHeroStats();
  assert.equal(realStrengthFor(fresh), 1);
  assert.equal(powerFor(fresh), POWER_DISPLAY_SCALE);
});

// ── contract invariant 3: deterministic ─────────────────────────────────────────────────────────

test('POWER is deterministic for the same hero', () => {
  const state = { totalXp: 640, equippedWeaponId: WILDWOOD_BLADE_ID, charmOwned: true };
  const first = powerFor(resolveHeroStats(state));
  for (let i = 0; i < 5; i += 1) {
    assert.equal(powerFor(resolveHeroStats(state)), first, 'the same hero read twice must read the same');
  }
});

// ── contract invariant 2: a genuinely stronger hero never displays lower ────────────────────────

test('POWER never falls as a hero levels', () => {
  let previous = 0;
  for (let level = LEVEL_ONE; level <= 60; level += 1) {
    const power = powerAt(level);
    assert.ok(power > previous, `POWER did not rise from Level ${level - 1} to ${level}`);
    previous = power;
  }
});

test('POWER never falls when either real stat rises and the other holds', () => {
  // Stated as the contract states it -- "a genuinely stronger loadout under the same comparison
  // conditions must not display lower POWER" -- rather than as the specific pairs the game happens
  // to produce today, so a future armour or pet term inherits the guard.
  const base = { maxHp: 30, heroDamage: 10 };
  for (const extraHp of [0, 1, 5, 10, 95, 4995]) {
    for (const extraDamage of [0, 1, 2, 10, 1998]) {
      const stronger = { maxHp: base.maxHp + extraHp, heroDamage: base.heroDamage + extraDamage };
      assert.ok(powerFor(stronger) >= powerFor(base),
        `+${extraHp} HP / +${extraDamage} damage displayed LOWER POWER`);
      if (extraHp + extraDamage > 0) {
        assert.ok(powerFor(stronger) > powerFor(base),
          `+${extraHp} HP / +${extraDamage} damage displayed the SAME POWER -- a real gain must be visible`);
      }
    }
  }
});

test('a stronger weapon at the same level cannot lower POWER', () => {
  for (const level of [1, 2, 5, 20, 100]) {
    assert.ok(powerAt(level, WILDWOOD_BLADE_ID) > powerAt(level, STARTER_SWORD_ID),
      `at Level ${level} the Blade did not read as stronger than the starter sword`);
  }
});

test('the charm cannot lower POWER', () => {
  // Survivability is half the readiness product, so a body bonus has to raise it. If a future model
  // ever weights damage alone, this is the test that says the charm stopped counting.
  for (const level of [1, 2, 20]) {
    assert.ok(powerAt(level, STARTER_SWORD_ID, { charmOwned: true }) > powerAt(level, STARTER_SWORD_ID),
      `at Level ${level} Wren's charm did not read as making the hero stronger`);
  }
});

// ── finite and representable outside the balanced band ──────────────────────────────────────────

test('POWER stays a finite exact integer through representative high levels', () => {
  for (const level of [20, 100, 1000]) {
    const power = powerAt(level);
    assert.ok(Number.isFinite(power), `POWER at Level ${level} is not finite`);
    assert.ok(Number.isSafeInteger(power), `POWER at Level ${level} is not an exact integer: ${power}`);
    assert.ok(power > 0);
  }
  // The worked values, so a reader can sanity-check the curve without running it.
  assert.equal(powerAt(20), 20000);
  assert.equal(powerAt(1000), 33634000);
});

test('a stat that is not a stat is refused rather than producing a plausible POWER', () => {
  for (const bad of [0, -1, NaN, Infinity, '30', null, undefined]) {
    assert.throws(() => powerFor({ maxHp: bad, heroDamage: 10 }), TypeError,
      `powerFor accepted a maxHp of ${JSON.stringify(bad)}`);
    assert.throws(() => powerFor({ maxHp: 30, heroDamage: bad }), TypeError,
      `powerFor accepted a heroDamage of ${JSON.stringify(bad)}`);
  }
});

// ── the formatter ───────────────────────────────────────────────────────────────────────────────

test('ordinary values are grouped and unabbreviated', () => {
  assert.equal(formatPower(1000), '1,000');
  assert.equal(formatPower(1400), '1,400');
  assert.equal(formatPower(2000), '2,000');
  assert.equal(formatPower(999), '999');
  assert.equal(formatPower(0), '0');
  assert.equal(formatPower(POWER_COMPACT_FROM - 1), '9,999');
});

test('large values compact to three significant figures rather than a digit wall', () => {
  assert.equal(formatPower(POWER_COMPACT_FROM), '10K');
  assert.equal(formatPower(12400), '12.4K');
  assert.equal(formatPower(20000), '20K', 'a trailing .0 is a digit that says nothing');
  assert.equal(formatPower(124000), '124K');
  assert.equal(formatPower(3200000), '3.2M');
  assert.equal(formatPower(33634000), '33.6M', 'a Level-1000 hero, which is why the compact form exists');
});

test('the formatter is total: nothing produces an unbounded or nonsense string', () => {
  for (const value of [1e12, 1e15, 1e18, 1e21, 1e30, Number.MAX_SAFE_INTEGER]) {
    const text = formatPower(value);
    assert.ok(typeof text === 'string' && text.length > 0 && text.length <= 12,
      `formatPower(${value}) produced ${JSON.stringify(text)}`);
  }
  assert.equal(formatPower(NaN), '—', 'a hero whose POWER cannot be computed shows a dash, not "NaN"');
  assert.equal(formatPower(-5), '0', 'there is no negative POWER to print');
});

test('formatting is locale-independent', () => {
  // toLocaleString would group differently depending on the runtime's locale, so the same hero would
  // read differently on two devices and this suite could pass on one machine and fail on another.
  // Comments stripped first: power.js's own comment explains why it does NOT use toLocaleString, and
  // a scan that counts that explanation finds a defect in the reasoning that prevents the defect.
  const source = readFileSync(join(repoRoot, 'public/src/progression/power.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.ok(!/toLocaleString|Intl\./.test(source),
    'POWER formatting must not depend on the runtime locale');
});

test('the compact form is monotone across its own boundary', () => {
  // The failure this guards is a child watching POWER "drop" as it crosses into the compact form.
  // Comparing the underlying values is not enough -- what they SEE is the string.
  const parse = (text) => {
    const match = /^([\d.,]+)([A-Za-z]*)$/.exec(text);
    const units = { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
    return Number(match[1].replace(/,/g, '')) * units[match[2]];
  };
  let previous = 0;
  for (let value = POWER_COMPACT_FROM - 20; value <= POWER_COMPACT_FROM + 20; value += 1) {
    const shown = parse(formatPower(value));
    assert.ok(shown >= previous, `the displayed value fell at ${value}: ${formatPower(value)}`);
    previous = shown;
  }
});

// ── the before -> delta -> after shape ──────────────────────────────────────────────────────────

test('powerChange states the first level-up exactly as the brief writes it', () => {
  const change = powerChange(powerAt(1), powerAt(2));
  assert.deepEqual(
    [change.beforeText, change.deltaText, change.afterText],
    ['1,000', '+400', '1,400'],
  );
  assert.equal(change.delta, 400, 'the raw delta stays available for anything that has to compare');
});

test('powerChange can say a change was a LOSS, because a sidegrade is a legitimate outcome', () => {
  // The contract protects this explicitly: "an item that improves one stat but reduces overall POWER
  // is a legitimate sidegrade, not a hidden upgrade". A helper that assumed every change was a gain
  // would make the UI lie at exactly the moment honesty matters.
  const change = powerChange(2000, 1840);
  assert.equal(change.delta, -160);
  assert.equal(change.deltaText, '-160');
});

// ── what the ceremony says ──────────────────────────────────────────────────────────────────────
//
// The numbers a child is shown at the loudest moment in the game. Worth being able to check without a
// browser for exactly that reason -- what the ceremony LOOKS like is taste and is judged in captures,
// but what it CLAIMS is arithmetic and must be right.

test('the first level-up says precisely what the brief says it must', () => {
  const before = resolveHeroStats({ totalXp: 0, equippedWeaponId: STARTER_SWORD_ID });
  const after = resolveHeroStats({ totalXp: cumulativeXpForLevel(2), equippedWeaponId: STARTER_SWORD_ID });
  const summary = levelUpSummary({ level: after.level, before, after });

  assert.equal(summary.level, 2);
  assert.equal(summary.maxHpGainText, '+5');
  assert.equal(summary.damageGainText, '+2');
  // #41's own worked shape, and the brief's: `1,000 -> +400 -> 1,400`.
  assert.deepEqual(
    [summary.power.beforeText, summary.power.deltaText, summary.power.afterText],
    ['1,000', '+400', '1,400'],
  );
});

test('the ceremony is built from the two stat states, so it cannot disagree with the fight', () => {
  // The gains are the real difference between two resolved heroes, not a remembered snapshot. If a
  // future level ever grants something different, the ceremony says the new thing without being told.
  const before = resolveHeroStats({ totalXp: cumulativeXpForLevel(4) });
  const after = resolveHeroStats({ totalXp: cumulativeXpForLevel(5) });
  const summary = levelUpSummary({ level: after.level, before, after });
  assert.equal(summary.maxHpGain, after.maxHp - before.maxHp);
  assert.equal(summary.damageGain, after.heroDamage - before.heroDamage);
  assert.equal(summary.power.before, powerFor(before));
  assert.equal(summary.power.after, powerFor(after));
  assert.equal(summary.power.delta, powerFor(after) - powerFor(before));
});

test('a level-up whose gains are held in a charmed body still reports the LEVEL\'s gains', () => {
  // Both states carry the charm, so the +10 it is worth appears in neither delta -- which is right:
  // the ceremony is about what the LEVEL just gave, and the charm was given by Wren weeks ago.
  const before = resolveHeroStats({ totalXp: 0, charmOwned: true });
  const after = resolveHeroStats({ totalXp: cumulativeXpForLevel(2), charmOwned: true });
  const summary = levelUpSummary({ level: 2, before, after });
  assert.equal(summary.maxHpGainText, '+5');
  assert.equal(summary.damageGainText, '+2');
  // But POWER is about the whole hero, so a charmed hero's numbers are their own.
  assert.equal(summary.power.before, powerFor(before));
  assert.ok(summary.power.delta > 0);
});

// ── contract invariants 1 and 6: POWER is never an input ────────────────────────────────────────

function jsFilesUnder(directory) {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(js|mjs)$/.test(name)) found.push(path);
    }
  };
  walk(directory);
  return found;
}

test('nothing that decides a fight, an award or a durable write imports POWER', () => {
  // The architecture requirement, and the only test in this file that could catch the failure that
  // actually matters: real stats first, POWER afterwards. A monotone display number wired into
  // combat would pass every other test here.
  //
  // Scanned by DIRECTORY rather than by a list of files, for the reason GQ-007's hit 8 gives -- a
  // fixed file list only knows about the copies somebody already thought of, so a new module in one
  // of these directories is covered the day it is written.
  const forbiddenRoots = [
    'public/src/combat',
    'public/src/rewards',
    'net',
  ];
  const offenders = [];
  for (const root of forbiddenRoots) {
    for (const path of jsFilesUnder(join(repoRoot, root))) {
      const source = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      if (/from\s*['"][^'"\n]*progression\/power\.js['"]/.test(source)) {
        offenders.push(path.slice(repoRoot.length));
      }
    }
  }
  assert.deepEqual(offenders, [],
    'POWER is a presentation value derived from real stats -- it must never become an input to '
    + 'combat, reward or persistence logic:\n  ' + offenders.join('\n  '));
});

test('the persistence layer does not import POWER either', () => {
  // net/ is covered by the scan above; progression/facts.js and profiles.js are the device-side half
  // of the same durability story and are named individually because their directory legitimately
  // contains power.js itself.
  for (const relative of ['public/src/progression/facts.js', 'public/src/progression/profiles.js']) {
    const source = readFileSync(join(repoRoot, relative), 'utf8');
    assert.ok(!/progression\/power\.js|from\s*['"]\.\/power\.js['"]/.test(source),
      `${relative} must not derive anything durable from a display number`);
  }
});

test('POWER does not read the fight back, either -- the dependency points one way', () => {
  // The mirror of the scan above. power.js importing combat/ would not break any assertion in this
  // file, and would mean a future change to the rules could silently move every displayed number.
  const source = readFileSync(join(repoRoot, 'public/src/progression/power.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const imports = [...source.matchAll(/from\s*['"]([^'"\n]+)['"]/g)].map((match) => match[1]);
  assert.deepEqual(imports, ['./heroStats.js'],
    'POWER derives from the resolved Hero stats and from nothing else');
});
