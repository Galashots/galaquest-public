import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  assertConsumedRegistryRecordsMatch,
  buildManifest,
  deterministicJson,
} from '../tools/unity-migration/export-bridge.mjs';

const BASE_SHA = '28eb6191ff9a67669b0aaeaebcb812c591aa2170';
// An intentional change to a pinned source such as speed.js requires regenerating and re-pinning
// this migration fixture; the failure is an authority-drift signal, not mysterious CI breakage.
const root = new URL('..', import.meta.url);
const committedManifestPath = 'unity/GalaQuest/Assets/GalaQuest/Migration/BridgeManifest.json';

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

test('committed BridgeManifest.json equals a fresh export for its originating snapshot', async () => {
  const committedBytes = read(committedManifestPath);
  const committedManifest = JSON.parse(committedBytes.toString('utf8'));
  assert.match(committedManifest.originatingGitSha, /^[0-9a-f]{40}$/);

  const freshBytes = Buffer.from(
    deterministicJson(await buildManifest({ sourceSha: committedManifest.originatingGitSha })),
  );
  assert.deepEqual(committedBytes, freshBytes);
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

// --- record-level registry pin ---------------------------------------------------------------
// The exporter used to pin the whole registry file to the originating commit, so any unrelated new
// record forced a manifest re-pin. These tests hold the narrower contract: only the fields the
// Bridge actually copies, from only the records it actually reads.

const CONSUMED_PATHS = [
  'public/assets/gear/sword_ironwood.glb',
  'public/assets/world/keeper.glb',
];

function registryRecords() {
  return [
    {
      asset_id: 'gear.sword.ironwood',
      display_name: 'Ironwood Sword',
      asset_kind: 'gear',
      structural_metrics: { mesh_count: 'UNKNOWN' },
      notes: 'first observation',
      source: { path: 'public/assets/gear/sword_ironwood.glb', sha256: 'aaa' },
    },
    {
      asset_id: 'world.keeper',
      display_name: 'Keeper',
      asset_kind: 'character',
      structural_metrics: { mesh_count: 'UNKNOWN' },
      notes: 'first observation',
      source: { path: 'public/assets/world/keeper.glb', sha256: 'bbb' },
    },
  ];
}

const clone = (records) => JSON.parse(JSON.stringify(records));

test('unrelated registry records do not disturb the consumed record pin', () => {
  const current = registryRecords();
  current.push({
    asset_id: 'gear.candidate.brand-new',
    display_name: 'Brand New Candidate',
    asset_kind: 'gear',
    source: { path: 'public/assets/gear/candidates/brand-new.glb', sha256: 'ccc' },
  });

  assert.doesNotThrow(() => assertConsumedRegistryRecordsMatch(current, registryRecords(), CONSUMED_PATHS));
});

test('non-consumed field churn on a consumed record does not disturb the pin', () => {
  const current = registryRecords();
  current[0].structural_metrics = { mesh_count: 4 };
  current[0].notes = 're-observed';
  current[0].source.sha256 = 'ddd';
  current[1].evidence_refs = ['registry-evidence:runtime-assets'];
  current[1].qualification_gates = { visual: { status: 'PASS', evidence_refs: ['review:1'] } };

  assert.doesNotThrow(() => assertConsumedRegistryRecordsMatch(current, registryRecords(), CONSUMED_PATHS));
});

test('a changed consumed asset_id throws and names the path and field', () => {
  const current = registryRecords();
  current[0].asset_id = 'gear.sword.ironwood-renamed';

  assert.throws(
    () => assertConsumedRegistryRecordsMatch(current, registryRecords(), CONSUMED_PATHS),
    (error) => {
      assert.match(error.message, /public\/assets\/gear\/sword_ironwood\.glb/);
      assert.match(error.message, /asset_id/);
      return true;
    },
  );
});

test('a changed consumed display_name throws and names the path and field', () => {
  const current = registryRecords();
  current[1].display_name = 'The Keeper';

  assert.throws(
    () => assertConsumedRegistryRecordsMatch(current, registryRecords(), CONSUMED_PATHS),
    (error) => {
      assert.match(error.message, /public\/assets\/world\/keeper\.glb/);
      assert.match(error.message, /display_name/);
      return true;
    },
  );
});

test('a missing or duplicated consumed record throws', () => {
  const missing = registryRecords().filter((record) => record.source.path !== CONSUMED_PATHS[0]);
  assert.throws(
    () => assertConsumedRegistryRecordsMatch(missing, registryRecords(), CONSUMED_PATHS),
    /expected exactly one record whose source\.path is public\/assets\/gear\/sword_ironwood\.glb/,
  );

  const duplicated = registryRecords();
  duplicated.push({ ...clone(duplicated[1]), asset_id: 'world.keeper-duplicate' });
  assert.throws(
    () => assertConsumedRegistryRecordsMatch(duplicated, registryRecords(), CONSUMED_PATHS),
    /expected exactly one record whose source\.path is public\/assets\/world\/keeper\.glb/,
  );

  const pinnedDuplicated = registryRecords();
  pinnedDuplicated.push(clone(pinnedDuplicated[0]));
  assert.throws(
    () => assertConsumedRegistryRecordsMatch(registryRecords(), pinnedDuplicated, CONSUMED_PATHS),
    /expected exactly one record whose source\.path is public\/assets\/gear\/sword_ironwood\.glb/,
  );
});

test('the working-tree registry matches the originating commit for every consumed record', () => {
  const committed = JSON.parse(
    execFileSync('git', ['show', `${BASE_SHA}:docs/asset-production/asset-registry-v1.json`], {
      cwd: new URL('.', root),
      encoding: 'utf8',
    }),
  );
  const workingTree = JSON.parse(read('docs/asset-production/asset-registry-v1.json').toString('utf8'));

  assert.doesNotThrow(() => assertConsumedRegistryRecordsMatch(
    workingTree.records,
    committed.records,
    CONSUMED_PATHS,
  ));
});
