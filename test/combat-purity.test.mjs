// test/combat-purity.test.mjs
//
// public/src/combat/ is the pure rules layer: no three.js, no DOM, no wall clock, no
// randomness. That purity is what lets net/gameServer.mjs re-host stepEncounter unchanged
// (plan Phase B) and what makes the client/server golden-trace parity test meaningful --
// one Math.random() for damage variance would silently break both. AGENTS.md states the
// rule; this test enforces it. If it fails, route the randomness or time through the
// command/event seam instead of weakening this list.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const combatDir = join(repoRoot, 'public', 'src', 'combat');

const files = readdirSync(combatDir).filter((name) => /\.(js|mjs)$/.test(name));

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const FORBIDDEN = [
  [/\bMath\.random\b/, 'Math.random'],
  [/\bDate\.now\b/, 'Date.now'],
  [/\bperformance\.now\b/, 'performance.now'],
  [/\bdocument\./, 'document.*'],
  [/\bwindow\./, 'window.*'],
  [/\bnavigator\./, 'navigator.*'],
  [/\brequestAnimationFrame\b/, 'requestAnimationFrame'],
  [/\bsetTimeout\b/, 'setTimeout'],
  [/\bsetInterval\b/, 'setInterval'],
];

const IMPORT_PATTERNS = [
  /\bfrom\s*['"]([^'"\n]+)['"]/g,
  /(?:^|[;\n])\s*import\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]/g,
];

test('combat/ stays pure: no DOM, no clock, no randomness, no outside imports', () => {
  assert.ok(files.length >= 2,
    `only ${files.length} files in combat/ -- the scan is broken, not the layer shrunk`);
  const violations = [];
  for (const name of files) {
    const source = stripComments(readFileSync(join(combatDir, name), 'utf8'));
    for (const [pattern, label] of FORBIDDEN) {
      if (pattern.test(source)) violations.push(`${name}: ${label}`);
    }
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const spec = match[1];
        if (!spec.startsWith('./')) {
          violations.push(`${name}: import '${spec}' reaches outside combat/`);
        }
      }
    }
  }
  assert.deepEqual(violations, [],
    'impurities in public/src/combat/ (route through the seam instead):\n  '
    + violations.join('\n  '));
});
