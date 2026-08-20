import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env },
  });
}

function assertOfflineDryRun(result, label) {
  assert.equal(result.status, 0, `${label} dry run exits cleanly: ${result.stderr || result.stdout}`);
  assert.match(result.stdout, /DRY RUN — no credentials read, no network calls, no credits spent/);
  assert.doesNotMatch(result.stdout, /balance before:/, `${label} did not cross the API boundary`);
  assert.doesNotMatch(result.stdout, /Bearer\s/i, `${label} never printed an authorization value`);
}

test('Meshy image-to-3D preflight is fully offline unless --go is explicit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gq-meshy-'));
  try {
    const reference = join(dir, 'warden-flat.png');
    // The preflight only packages bytes into the request. A real PNG is unnecessary for proving the
    // credential/network boundary, and avoiding an image fixture keeps this gate tiny.
    writeFileSync(reference, Buffer.from('offline-reference-fixture'));
    const result = run('tools/meshy/image_to_3d.mjs', [reference, join(dir, 'out'), '--polycount', '7000']);
    assertOfflineDryRun(result, 'image-to-3D');
    assert.match(result.stdout, /"target_polycount": 7000/);
    assert.match(result.stdout, /<data uri, \d+ chars>/);
    assert.doesNotMatch(result.stdout, /data:image\/png;base64,[A-Za-z0-9+/=]{8}/,
      'the full image data URI is redacted from logs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Meshy rig preflight is fully offline unless --go is explicit', () => {
  const result = run('tools/meshy/rig_character.mjs', ['body-task-123', 'tmp/unused', '--height', '2.2']);
  assertOfflineDryRun(result, 'rigging');
  assert.match(result.stdout, /"input_task_id": "body-task-123"/);
  assert.match(result.stdout, /"height_meters": 2.2/);
});

test('Meshy animation preflight is fully offline unless --go is explicit', () => {
  const result = run('tools/meshy/animate_character.mjs', ['rig-task-456', '17', 'tmp/unused', '--name', 'attack']);
  assertOfflineDryRun(result, 'animation');
  assert.match(result.stdout, /"rig_task_id": "rig-task-456"/);
  assert.match(result.stdout, /"action_id": 17/);
});
