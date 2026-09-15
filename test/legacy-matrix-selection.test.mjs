import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const matrix = readFileSync(new URL('../.github/workflows/full-playtest-matrix.yml', import.meta.url), 'utf8');
const unit = readFileSync(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');

const EXPECTED_PATHS = [
  'package.json',
  'server.mjs',
  'net/**',
  'public/**',
  'tools/runtime-test/**',
  'docs/asset-production/asset-registry-v1.json',
  '.github/workflows/full-playtest-matrix.yml',
];

function eventBlock(source, event) {
  const lines = source.split(/\r?\n/);
  const start = lines.indexOf(`  ${event}:`);
  assert.notEqual(start, -1, `missing ${event} trigger`);
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S|^  \S/.test(line)) break;
    block.push(line);
  }
  return block.join('\n');
}

function selectedPatterns(source, event) {
  const block = eventBlock(source, event);
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((line) => line === '    paths:');
  assert.notEqual(start, -1, `${event}: expected an explicit, reviewable paths list`);
  const patterns = [];
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^      - '([^']+)'$/);
    if (!match) break;
    patterns.push(match[1]);
  }
  assert.deepEqual(patterns, EXPECTED_PATHS, `${event}: legacy ownership paths changed; review deliberately`);
  return patterns;
}

function matchesReviewedPattern(path, pattern) {
  if (pattern.endsWith('/**')) return path.startsWith(pattern.slice(0, -3) + '/');
  return path === pattern;
}

function runsLegacy(paths, patterns) {
  return paths.some((path) => patterns.some((pattern) => matchesReviewedPattern(path, pattern)));
}

for (const event of ['push', 'pull_request']) {
  test(`${event}: only retained Three.js runtime and harness ownership auto-runs the legacy matrix`, () => {
    const patterns = selectedPatterns(matrix, event);
    for (const path of [
      'package.json',
      'server.mjs',
      'net/protocol.js',
      'public/src/main.js',
      'public/assets/example.glb',
      'tools/runtime-test/drive-village.mjs',
      'docs/asset-production/asset-registry-v1.json',
      '.github/workflows/full-playtest-matrix.yml',
    ]) {
      assert.equal(runsLegacy([path], patterns), true, path);
      assert.equal(runsLegacy(['docs/note.md', 'unity/changed.asset', path], patterns), true, `mixed: ${path}`);
    }
    for (const paths of [
      ['README.md', 'docs/WORKFLOW.md'],
      ['unity/GalaQuest/Assets/GalaQuest/Runtime/Example.cs'],
      ['test/example.test.mjs'],
      ['tools/unity-playtest/forge.mjs'],
      ['render.yaml'],
      ['unknown-source.bin'],
      ['test/example.test.mjs', 'docs/WORKFLOW.md', 'unity/changed.asset'],
    ]) assert.equal(runsLegacy(paths, patterns), false, JSON.stringify(paths));
  });
}

test('required unit remains unfiltered and broad diagnostics remain manually callable', () => {
  for (const event of ['push', 'pull_request']) {
    assert.doesNotMatch(eventBlock(unit, event), /\bpaths(?:-ignore)?:/);
  }
  assert.match(matrix, /^  workflow_dispatch:/m);
  assert.match(matrix, /ref: \$\{\{ inputs\.ref \|\| github\.sha \}\}/);
});

test('the selection contract is red-capable for missing or broadened ownership', () => {
  const missing = matrix.replace("      - 'net/**'\n", '');
  assert.throws(() => selectedPatterns(missing, 'push'), /ownership paths changed/);
  const broadened = matrix.replace("      - 'net/**'\n", "      - 'net/**'\n      - 'test/**'\n");
  assert.throws(() => selectedPatterns(broadened, 'push'), /ownership paths changed/);
});