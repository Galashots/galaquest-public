// test/no-npm-imports.test.mjs
//
// The zero-npm rule (README "Rules that are not preferences") enforced mechanically:
// no runtime file may import a bare specifier. Relative, absolute, and node: builtins
// only. If this fails, either an npm dependency crept in (remove it) or a new legitimate
// specifier form appeared (widen specifierAllowed and say why in the commit).
//
// Scanning is regex over comment-stripped source, which errs toward flagging: a comment
// containing something shaped like `from 'x'` can trip it. That is the right direction
// for a guard — the failure names the file and specifier, and a false alarm costs a
// minute while a false pass costs a session on npm's registry latency.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(js|mjs)$/.test(entry.name)) yield full;
  }
}

const scanned = [
  ...walk(join(repoRoot, 'public', 'src')),
  ...walk(join(repoRoot, 'net')),
  join(repoRoot, 'server.mjs'),
];

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const SPECIFIER_PATTERNS = [
  /\bfrom\s*['"]([^'"\n]+)['"]/g,               // import/export ... from '...'
  /(?:^|[;\n])\s*import\s*['"]([^'"\n]+)['"]/g, // side-effect import '...'
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]/g,        // dynamic import('...')
];

function specifierAllowed(spec) {
  return spec.startsWith('./') || spec.startsWith('../')
    || spec.startsWith('/') || spec.startsWith('node:');
}

test('runtime code imports nothing npm-shaped', () => {
  assert.ok(scanned.length > 20,
    `only ${scanned.length} files scanned -- the walk is broken, not the codebase clean`);
  const violations = [];
  for (const file of scanned) {
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const pattern of SPECIFIER_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const spec = match[1];
        if (!specifierAllowed(spec)) {
          violations.push(`${relative(repoRoot, file).split(sep).join('/')} -> '${spec}'`);
        }
      }
    }
  }
  assert.deepEqual(violations, [],
    'bare import specifiers in runtime code (zero-npm rule, README):\n  '
    + violations.join('\n  '));
});
