import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildManifest, deterministicJson } from '../tools/unity-migration/export-bridge.mjs';

const BASE_SHA = '470f989e131497bbfb6c4f27a950f4ade4300896';
const root = new URL('..', import.meta.url);

function read(path) {
  return readFileSync(new URL(path, root));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('Migration Bridge manifest has the versioned shape and two selected assets', async () => {
  const manifest = await buildManifest({ sourceSha: BASE_SHA });

  assert.equal(manifest.schema, 'galaquest.unity-migration-bridge');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.bridgeVersion, '0.1.0');
  assert.equal(manifest.originatingGitSha, BASE_SHA);
  assert.equal(manifest.sourceRepository, 'Galashots/galaquest-public');
  assert.equal(manifest.assets.length, 2);
  assert.deepEqual(manifest.assets.map((asset) => asset.sourcePath), [
    'public/assets/gear/sword_ironwood.glb',
    'public/assets/world/keeper.glb',
  ]);
  assert.equal(manifest.assets[0].role, 'static-asset');
  assert.equal(manifest.assets[1].role, 'rigged-animated-character');
  assert.equal(Object.hasOwn(manifest, 'generatedAt'), false);
});

test('exported speed-law values come from the actual current module', async () => {
  const manifest = await buildManifest({ sourceSha: BASE_SHA });
  const source = read('public/src/character/speed.js');
  const actual = await import(`data:text/javascript;base64,${source.toString('base64')}`);

  for (const name of ['WALK_SPEED', 'RUN_SPEED', 'RUN_THRESHOLD', 'RUN_DEFLECTION']) {
    assert.equal(manifest.contracts.movement.values[name], actual[name]);
  }
  assert.equal(manifest.contracts.movement.sourceSha256, sha256(source));
});

test('re-exporting the same source snapshot is byte-identical', async () => {
  const first = deterministicJson(await buildManifest({ sourceSha: BASE_SHA }));
  const second = deterministicJson(await buildManifest({ sourceSha: BASE_SHA }));
  assert.equal(first, second);
});

test('asset paths and hashes are recomputed from the selected source files', async () => {
  const manifest = await buildManifest({ sourceSha: BASE_SHA });

  for (const asset of manifest.assets) {
    assert.equal(asset.sourceSha256, sha256(read(asset.sourcePath)));
    assert.match(asset.semanticId, /^(?!guid:)[a-z0-9][a-z0-9._-]*$/);
    assert.ok(asset.sourceSizeBytes > 0);
  }
  assert.deepEqual(manifest.assets[1].structure, {
    meshCount: 1,
    primitiveCount: 1,
    materialCount: 1,
    nodeCount: 26,
    skinCount: 1,
    jointCount: 24,
    animationClipCount: 3,
    hasSkin: true,
    hasAnimation: true,
  });
});

test('coordinate fixture carries the one explicit Three.js to Unity seam', async () => {
  const fixture = (await buildManifest({ sourceSha: BASE_SHA })).coordinateFixture;
  assert.deepEqual(fixture.source.position, [1.25, -2, 3.5]);
  assert.deepEqual(fixture.destination.position, [1.25, -2, -3.5]);
  assert.deepEqual(fixture.source.scale, fixture.destination.scale);
  assert.equal(Math.abs(fixture.destination.rotationQuaternion[2]), Math.abs(fixture.source.rotationQuaternion[2]));
  assert.equal(fixture.destination.rotationQuaternion[3], -fixture.source.rotationQuaternion[3]);
});
