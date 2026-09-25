// Every browser module parses. The rules modules are imported by other tests, but the renderer and
// UI need a DOM and WebGL, so without this a syntax error there reaches the running game unseen.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const SRC = new URL('../src/', import.meta.url).pathname;

function modules(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return modules(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

test('every farm source module parses', () => {
  const files = modules(SRC);
  assert.ok(files.length > 10, `found ${files.length} modules`);
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}\n${result.stderr}`);
  }
});
