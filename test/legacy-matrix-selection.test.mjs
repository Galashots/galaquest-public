import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const matrix = readFileSync(new URL('../.github/workflows/full-playtest-matrix.yml', import.meta.url), 'utf8');
const unit = readFileSync(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');

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

function ignoredPatterns(source, event) {
  const block = eventBlock(source, event);
  const match = block.match(/^    paths-ignore: \[([^\]\n]+)\]$/m);
  assert.ok(match, `${event}: expected an explicit, reviewable paths-ignore list`);
  assert.match(match[1], /^'[^']+'(?:, '[^']+')*$/, 'unsupported filter syntax must not pass silently');
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

// These are the two reviewed GitHub glob forms, not a general-purpose glob engine.
// A workflow is skipped only when EVERY changed path matches an ignored pattern.
function runsLegacy(paths, patterns) {
  assert.deepEqual(patterns, ['**.md', 'unity/**'], 'do not silently suppress another source family');
  return paths.some((path) => !path.endsWith('.md') && !path.startsWith('unity/'));
}

for (const event of ['push', 'pull_request']) {
  test(`${event}: only documentation and Unity-local source skip the legacy matrix`, () => {
    const patterns = ignoredPatterns(matrix, event);
    for (const paths of [
      ['README.md', 'docs/WORKFLOW.md'],
      ['unity/GalaQuest/ProjectSettings/ProjectSettings.asset'],
      ['unity/GalaQuest/Assets/GalaQuest/Runtime/Example.cs', 'docs/WORKFLOW.md'],
    ]) assert.equal(runsLegacy(paths, patterns), false, JSON.stringify(paths));
    for (const path of ['server.mjs', 'net/protocol.js', 'public/src/main.js',
      'public/assets/example.glb', 'test/example.test.mjs', 'tools/unity-playtest/forge.mjs',
      '.github/workflows/full-playtest-matrix.yml', 'render.yaml', 'unknown-source.bin']) {
      assert.equal(runsLegacy([path], patterns), true, path);
      assert.equal(runsLegacy(['unity/changed.asset', 'docs/note.md', path], patterns), true, `mixed: ${path}`);
    }
  });
}

test('required unit remains unfiltered and broad diagnostics remain manually callable', () => {
  for (const event of ['push', 'pull_request']) {
    assert.doesNotMatch(eventBlock(unit, event), /\bpaths(?:-ignore)?:/);
  }
  assert.match(matrix, /^  workflow_dispatch:/m);
  assert.match(matrix, /ref: \$\{\{ inputs\.ref \|\| github\.sha \}\}/);
});

test('the selection contract rejects both the original omission and overbroad exclusions', () => {
  assert.throws(() => runsLegacy(['unity/change.cs'], ['**.md']), /source family/);
  assert.throws(() => runsLegacy(['net/protocol.js'], ['**.md', 'unity/**', 'net/**']), /source family/);
});
