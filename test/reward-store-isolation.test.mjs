import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// data/README.md is explicit: "Tests must never open a store at a path under `data/`."
//
// That rule was documented, violated, and invisible at the same time. startOwnedServer inherits the
// real data/rewards.db whenever a caller omits rewardStorePath (#94), so test/owned-server.test.mjs
// -- which boots real server.mjs children -- wrote a rewards.db and three backup-*.db into the repo's
// data/ on every run. Nobody saw it, because .gitignore's `data/*.db*` keeps git status clean: a
// suite run left no trace in the working tree while still writing to the family save path.
//
// This guard is deliberately static rather than "run the suite and diff data/". It names the exact
// offending call site instead of reporting that something, somewhere, wrote a file.

const testDir = resolve(import.meta.dirname);
const SELF = 'reward-store-isolation.test.mjs';

// Every real call site in this suite is `await startOwnedServer(...)`. Anchoring on `await` is what
// keeps prose out of the results -- harness-game-url.test.mjs discusses `startOwnedServer().url` in
// both a comment and a string literal, and neither is a call. A future non-awaited call would slip
// past this; that is an accepted limit of a lint-shaped guard, and the second test below plus the
// `data/` rule in data/README.md remain the backstop.
const CALL = /await\s+startOwnedServer\s*\(/g;

const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

const callArguments = (source, openParenIndex) => {
  let depth = 0;
  for (let cursor = openParenIndex; cursor < source.length; cursor += 1) {
    if (source[cursor] === '(') depth += 1;
    else if (source[cursor] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex + 1, cursor);
    }
  }
  return null;
};

test('no test may boot an owned server against the real reward store', () => {
  const offenders = [];
  let callsSeen = 0;
  const scanned = readdirSync(testDir).filter((name) => name.endsWith('.test.mjs') && name !== SELF);
  assert.ok(scanned.length > 50, `expected the whole unit suite to be scanned, got ${scanned.length} file(s)`);

  for (const entry of scanned) {
    const source = stripComments(readFileSync(resolve(testDir, entry), 'utf8'));
    for (const match of source.matchAll(CALL)) {
      callsSeen += 1;
      const args = callArguments(source, match.index + match[0].length - 1);
      assert.notEqual(args, null, `${entry}: unbalanced startOwnedServer( call`);
      if (!/rewardStorePath/.test(args)) offenders.push(`${entry}: startOwnedServer(${args.trim().slice(0, 60)})`);
    }
  }

  // A scanner that silently matches nothing would pass this test forever.
  assert.ok(callsSeen >= 4, `expected to find the real owned-server call sites, found ${callsSeen}`);
  assert.deepEqual(offenders, [], 'every startOwnedServer call in the test suite must pass an isolated rewardStorePath');
});

test('the store the owned-server tests use is under the OS temp dir, never the repo', () => {
  const source = readFileSync(resolve(testDir, 'owned-server.test.mjs'), 'utf8');
  assert.match(source, /mkdtempSync\(\s*join\(\s*tmpdir\(\)/, 'the store directory must come from os.tmpdir()');
  assert.equal(/rewardStorePath:\s*['"`]?data\//.test(source), false, 'no reward store path may point into the repo data/ directory');
});
