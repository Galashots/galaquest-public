// test/shared-constants.test.mjs
//
// docs/MISTAKES.md GQ-007 -- "never restate a constant". WOLF_SPAWN was its fifth instance: the
// 2026-08-14 audit (P0.2) found net/gameServer.mjs and public/src/main.js each carrying a
// hand-written `{ x: 2.5, z: 8 }`, kept equal only by a human noticing.
//
// THAT IS NOW FIXED (Phase R2). The value lives once, in public/src/world/zones/village.js, derived
// from `SPAWNS.wolf` in the same module and imported by both sides. Phase R2 also found a THIRD and
// FOURTH copy the audit had missed -- `SPAWNS.wolf` itself was already the placement, and
// test/encounter-trace.test.mjs restated the literal to pin its golden trace.
//
// Why the zone module and not combat/encounter.js, which this test's previous header recommended:
// the two candidate modules are mutually import-isolated ON PURPOSE and by enforced test.
// test/zone-data.test.mjs forbids world/zones/ files from containing ANY import, and
// test/combat-purity.test.mjs forbids public/src/combat/ from importing anything outside './'. So
// one of them must own the value outright, and a spawn point is a placement: encounter.js already
// takes `wolfSpawn` as an argument everywhere and its own `{x:0, z:-4}` default is a neutral test
// fallback, not this village's spot. Baking village coordinates into the zone-agnostic rules layer
// would have to be undone the moment a second zone exists.
//
// So this test changed job, exactly as its own previous header instructed it to ("this test should
// be rewritten to assert no second hand-written literal has reappeared ... not deleted"). It is now
// a REGRESSION GUARD: it scans the modules that used to carry a copy and fails if a hand-written
// spawn literal comes back. Reading source text rather than importing is deliberate and is the same
// pattern test/no-npm-imports.test.mjs uses -- main.js cannot be imported here at all, because it
// touches `document` at module scope.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WOLF_SPAWN as SERVER_WOLF_SPAWN } from '../net/gameServer.mjs';
import { HERO_SPAWN, SPAWNS, WOLF_SPAWN } from '../public/src/world/zones/village.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Every module that has ever held a copy of this number, plus the two that legitimately consume it.
// A new file is welcome to import the constant; it is not welcome to write the digits again.
const SCANNED = [
  'public/src/main.js',
  'net/gameServer.mjs',
  'test/encounter-trace.test.mjs',
];

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('the wolf spawn is defined exactly once, in the zone that places it (GQ-007)', () => {
  // The single definition, and it is derived from SPAWNS rather than being a second literal beside
  // it -- so even inside its own module the number appears once.
  assert.deepEqual({ x: WOLF_SPAWN.x, z: WOLF_SPAWN.z }, { x: SPAWNS.wolf[0], z: SPAWNS.wolf[1] },
    'village.js\'s WOLF_SPAWN must stay derived from SPAWNS.wolf, not become a parallel literal');
  assert.deepEqual({ x: HERO_SPAWN.x, z: HERO_SPAWN.z }, { x: SPAWNS.heroes[0], z: SPAWNS.heroes[1] },
    'village.js\'s HERO_SPAWN must stay derived from SPAWNS.heroes, not become a parallel literal');
  assert.ok(Object.isFrozen(WOLF_SPAWN) && Object.isFrozen(HERO_SPAWN),
    'both spawns must be frozen: they are handed straight to the rules layer and to the wire');
});

test('the server serves the zone\'s spawn rather than inventing its own (GQ-007)', () => {
  assert.deepEqual({ x: SERVER_WOLF_SPAWN.x, z: SERVER_WOLF_SPAWN.z }, { x: WOLF_SPAWN.x, z: WOLF_SPAWN.z },
    'net/gameServer.mjs must re-export village.js\'s WOLF_SPAWN, not declare a second one');
  assert.equal(SERVER_WOLF_SPAWN, WOLF_SPAWN,
    'the server\'s WOLF_SPAWN must be the SAME frozen object as the zone\'s -- an equal-but-separate '
    + 'object means somebody rebuilt it, which is how the two copies drifted apart the first time');
});

test('no hand-written spawn literal has reappeared in any consumer (GQ-007 regression guard)', () => {
  // A `{ x: <number>, z: <number> }` object literal assigned to anything spawn-shaped. Deliberately
  // broad: it does not look for 2.5/8 specifically, because a REVISED duplicate is exactly as bad as
  // a stale one -- the failure this guards is "two places to change", not "these digits".
  const LITERAL = /(?:WOLF_SPAWN|HERO_SPAWN|wolfSpawn|heroSpawn)\s*[=:]\s*(?:Object\.freeze\(\s*)?\{\s*x\s*:\s*-?\d/;
  const violations = [];
  for (const relative of SCANNED) {
    const source = stripComments(readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8'));
    if (LITERAL.test(source)) violations.push(relative);
  }
  assert.deepEqual(violations, [],
    'a hand-written spawn literal is back. Import it from public/src/world/zones/village.js instead '
    + `-- that is the whole point of Phase R2 and of GQ-007 (repo root: ${repoRoot}):\n  `
    + violations.join('\n  '));
});

test('sabotage: the regression guard actually fires on a reintroduced literal', () => {
  // The control. A guard that cannot fail is not a guard, and this repo has shipped three tests that
  // passed on broken code because they restated the thing they were policing (README, "Evidence, not
  // assertion"). Same regex, run against a string that reintroduces the defect.
  const LITERAL = /(?:WOLF_SPAWN|HERO_SPAWN|wolfSpawn|heroSpawn)\s*[=:]\s*(?:Object\.freeze\(\s*)?\{\s*x\s*:\s*-?\d/;
  assert.ok(LITERAL.test('const WOLF_SPAWN = { x: 2.5, z: 8 };'), 'must catch a plain re-declaration');
  assert.ok(LITERAL.test('export const WOLF_SPAWN = Object.freeze({ x: 2.5, z: 8 });'),
    'must catch a frozen re-declaration');
  assert.ok(LITERAL.test('wolfSpawn: { x: 2.5, z: 8 },'), 'must catch an inline property literal');
  assert.ok(!LITERAL.test('const { WOLF_SPAWN, HERO_SPAWN } = VILLAGE;'),
    'must NOT fire on the correct import-and-destructure form');
  assert.ok(!LITERAL.test('createEncounterState({ wolfSpawn: WOLF_SPAWN, heroSpawn: HERO_SPAWN })'),
    'must NOT fire on passing the imported constant through');
});
