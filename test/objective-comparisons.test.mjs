// An objective is a value object. Comparing one to a string is always wrong, and one direction of
// wrong is silent.
//
// The CP2 keystone turned objectives from sentences into `{ id, text }` so a destination could be
// derived from the same branch that names the errand. Every consumer inside `test/` was updated.
// `tools/runtime-test/` was not, because I swept one directory and thought it was the sweep.
//
// WHAT THAT COST, and why it is a rule rather than a fixed bug:
//
//   s.objective === OBJECTIVE_FIND_THE_BEACON      string === object   ALWAYS FALSE -> check fails
//   s.objective !== OBJECTIVE_BEACON_IS_COLD       string !== object   ALWAYS TRUE  -> check passes
//
// The first is loud. The second is a guard that can never fire again, reporting PASS forever while
// checking nothing -- and two of drive-old-beacon's did exactly that. A test that keeps passing
// after the thing it names stops existing is not a passing test, it is an unread one (GQ-015).
//
// It also hid for two CI runs, because the job was CANCELLED rather than failed on the first one and
// the diff tool only counted failures. That half of the lesson lives in the tooling, not here.
//
// The rule: a comparison between something read out of the DOM and an objective value must go
// through `.text`. Comparing two objectives to each other with `===` is correct and stays legal --
// that is what the interning is for.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// HARNESSES ONLY, and the scope is the rule rather than a convenience.
//
// A harness reads `objective` out of the DOM -- it is always a string there, so a comparison against
// an objective value is always wrong. Under `test/` the opposite is true: a unit test holds real
// objective objects and `questObjectiveFor(...) === OBJECTIVE_MEET_THE_KEEPER` is exactly what the
// interning exists to make work. The two directories are different regimes and one regex cannot tell
// a DOM string from an objective by looking at the left-hand side, so it does not try.
const ROOTS = [join(import.meta.dirname, '..', 'tools', 'runtime-test')];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** An objective VALUE: the exported constants, and the three counting factories. */
const OBJECTIVE_VALUE = String.raw`(?:OBJECTIVE_[A-Z0-9_]+|objective(?:FindMarks|WakeLights|BreakSeals)\([^()]*\))`;

// `.text` is an OPTIONAL CAPTURE rather than a negative lookahead, and that is not a style choice.
// The lookahead version backtracked straight through itself: `OBJECTIVE_[A-Z0-9_]+` matched the
// whole name, `(?!\s*\.text)` failed, so the engine gave back one character and matched
// `OBJECTIVE_FIND_THE_BEACO` -- after which the lookahead was perfectly happy, because the next
// character was `N`. The rule then reported every CORRECT comparison as an offender, one letter
// short. Capturing what is actually there and testing it in JS cannot do that.
const AFTER_OPERATOR = new RegExp(String.raw`([!=]==)\s*(${OBJECTIVE_VALUE})(\s*\.text\b)?`, 'g');
const BEFORE_OPERATOR = new RegExp(String.raw`(${OBJECTIVE_VALUE})(\s*\.text\b)?\s*([!=]==)`, 'g');

function offendersIn(code) {
  const clean = stripComments(code);
  const found = [];
  for (const [, op, value, dotText] of clean.matchAll(AFTER_OPERATOR)) {
    if (!dotText) found.push(`${op} ${value}`);
  }
  for (const [, value, dotText, op] of clean.matchAll(BEFORE_OPERATOR)) {
    if (!dotText) found.push(`${value} ${op}`);
  }
  return found;
}

function everySource() {
  const files = [];
  for (const root of ROOTS) {
    for (const name of readdirSync(root)) {
      if (name.endsWith('.mjs') || name.endsWith('.js')) {
        files.push({ label: `${root.split('/').pop()}/${name}`, code: readFileSync(join(root, name), 'utf8') });
      }
    }
  }
  return files;
}

test('nothing compares a DOM string against an objective value', () => {
  const offenders = [];
  for (const { label, code } of everySource()) {
    for (const hit of offendersIn(code)) offenders.push(`${label}: ${hit}`);
  }
  assert.deepEqual(offenders, [],
    `these compare a string to a value object -- \`===\` can never be true and \`!==\` can never be false:\n  ${offenders.join('\n  ')}`);
});

test('the scan sees the files it is supposed to be scanning', () => {
  // The guard on the guard, for the usual reason: a scan that stops matching goes green over
  // nothing while reading as coverage.
  const labels = everySource().map((f) => f.label);
  assert.ok(labels.length > 20, `only ${labels.length} harnesses found`);
  assert.ok(labels.some((l) => l.endsWith('drive-old-beacon.mjs')), 'the harness this rule came from is not being read');
  assert.ok(labels.some((l) => l.endsWith('drive-marks.mjs')), 'the harness scan is not seeing the suite');
});

test('the rule goes red on the shape that actually shipped, and stays quiet on the correct one', () => {
  assert.deepEqual(offendersIn('if (s.objective === OBJECTIVE_FIND_THE_BEACON) {}'),
    ['=== OBJECTIVE_FIND_THE_BEACON']);
  // The silent direction -- the one that cost two vacuous guards.
  assert.deepEqual(offendersIn('if (s.objective !== OBJECTIVE_BEACON_IS_COLD) {}'),
    ['!== OBJECTIVE_BEACON_IS_COLD']);
  assert.deepEqual(offendersIn('if (s.objective === objectiveBreakSeals(n)) {}'),
    ['=== objectiveBreakSeals(n)']);

  // Correct, and must stay legal.
  assert.deepEqual(offendersIn('if (s.objective === OBJECTIVE_FIND_THE_BEACON.text) {}'), []);
  assert.deepEqual(offendersIn('if (s.objective === objectiveBreakSeals(n).text) {}'), []);
  // Objective-to-objective identity is the whole point of interning them, and it is legal -- which
  // is precisely why this rule is scoped to harnesses, where that shape does not occur. The matcher
  // itself cannot tell the two apart, and pretending otherwise is how a guard starts crying wolf.
  assert.deepEqual(offendersIn('assert.equal(questObjectiveFor(a) === OBJECTIVE_MEET_THE_KEEPER, true);'),
    ['=== OBJECTIVE_MEET_THE_KEEPER'],
    'the matcher flags this shape; the SCOPE is what keeps it out of the unit suite');
});
