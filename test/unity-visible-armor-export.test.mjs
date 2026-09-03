import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildVisibleArmorManifest } from '../tools/unity-migration/export-visible-armor.mjs';

const root = new URL('..', import.meta.url);
const manifestPath = 'unity/GalaQuest/Assets/GalaQuest/Migration/VisibleArmorManifest.json';
const read = path => readFileSync(new URL(path, root));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('visible armor exporter imports the live Silverguard fit authority', async () => {
  const manifest = await buildVisibleArmorManifest();
  const gear = await import('../public/src/character/gear.js');
  assert.equal(manifest.schema, 'galaquest.unity-visible-armor-proof');
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.originatingGitSha, /^[0-9a-f]{40}$/);
  assert.equal(manifest.gear.semanticId, gear.SILVERGUARD_HELMET_ID);
  assert.equal(manifest.fitAuthority.runtimeSourcePath, 'public/src/character/gear.js');
  assert.deepEqual(manifest.fitAuthority.restRelativeToHeroRoot, gear.RIGID_SILVERGUARD_HELMET.restRelativeToHeroRoot);
  assert.equal(manifest.fitAuthority.boneName, gear.SILVERGUARD_HELMET_BONE_NAME);
});

test('visible armor export is deterministic and records current source hashes', async () => {
  const first = JSON.stringify(await buildVisibleArmorManifest(), null, 2) + '\n';
  const second = JSON.stringify(await buildVisibleArmorManifest(), null, 2) + '\n';
  assert.equal(first, second);
  const manifest = JSON.parse(first);
  assert.equal(manifest.hero.sourceSha256, sha256(read(manifest.hero.sourcePath)));
  assert.equal(manifest.gear.sourceSha256, sha256(read(manifest.gear.sourcePath)));
  assert.equal(manifest.fitAuthority.runtimeSourceSha256, sha256(read(manifest.fitAuthority.runtimeSourcePath)));
});

test('committed visible armor manifest equals a fresh export for its originating Git snapshot', async () => {
  const committedBytes = read(manifestPath);
  const committed = JSON.parse(committedBytes.toString('utf8'));
  const fresh = Buffer.from(JSON.stringify(
    await buildVisibleArmorManifest({ sourceSha: committed.originatingGitSha }), null, 2) + '\n');
  assert.deepEqual(committedBytes, fresh);
});
