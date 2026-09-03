import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { inspectSourceGlb } from '../tools/unity-migration/source-glb.mjs';

const root = new URL('../', import.meta.url);
const bridge = JSON.parse(readFileSync(new URL('unity/GalaQuest/Assets/GalaQuest/Migration/BridgeManifest.json', root), 'utf8'));
const provenance = JSON.parse(readFileSync(new URL('unity/GalaQuest/Assets/GalaQuest/Migration/Provenance/asset-provenance.json', root), 'utf8'));

function read(path) {
  return readFileSync(new URL(path, root));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function bySemanticId(records, semanticId) {
  const record = records.find(candidate => candidate.semanticId === semanticId);
  assert.ok(record, `missing record ${semanticId}`);
  return record;
}

function clipIdentity(name) {
  const separator = name.lastIndexOf('|');
  return separator >= 0 ? name.slice(separator + 1) : name;
}

test('asset provenance has the versioned two-asset shape and no provider dependency', () => {
  assert.equal(provenance.schema, 'galaquest.unity-migration-asset-provenance');
  assert.equal(provenance.schemaVersion, 1);
  assert.equal(provenance.sourceRepository, bridge.sourceRepository);
  assert.equal(provenance.sourceGitSha, bridge.originatingGitSha);
  assert.equal(provenance.conversionTool, 'Blender');
  assert.equal(provenance.conversionToolVersion, '4.5.13 LTS');
  assert.equal(provenance.records.length, bridge.assets.length);
  assert.equal(provenance.records.some(record => record.conversionTool === 'Meshy'), false);
  assert.equal(provenance.records.some(record => record.conversionOptions.retarget || record.conversionOptions.materialRepair), false);
});

test('provenance source paths, hashes, inspections, and derivative hashes match the files', () => {
  for (const sourceAsset of bridge.assets) {
    const record = bySemanticId(provenance.records, sourceAsset.semanticId);
    const sourceBytes = read(record.sourceRepoPath);
    const derivativeBytes = read(record.derivativeRepoPath);
    assert.equal(record.sourceRepoPath, sourceAsset.sourcePath);
    assert.equal(record.sourceSha256, sha256(sourceBytes));
    assert.equal(record.derivativeSha256, sha256(derivativeBytes));
    assert.equal(record.sourceSizeBytes, sourceBytes.length);
    assert.equal(record.derivativeSizeBytes, derivativeBytes.length);
    assert.deepEqual(record.sourceInspection, inspectSourceGlb(new URL(record.sourceRepoPath, root)));
    assert.equal(record.sourceGitSha, provenance.sourceGitSha);
    assert.match(record.derivativeRepoPath, /^unity\/GalaQuest\/Assets\/GalaQuest\/Migration\/SourceAssets\/Deterministic\/.+\.fbx$/);
    assert.equal(existsSync(new URL(record.derivativeRepoPath, root)), true);
  }
});

test('Keeper source inventory is the current talk idle wave set and the Unity derivative records all three', () => {
  const source = bySemanticId(bridge.assets, 'world.keeper');
  const record = bySemanticId(provenance.records, 'world.keeper');
  const sourceNames = source.structure.animationClipCount;
  const sourceClips = record.sourceInspection.animations;
  assert.equal(sourceNames, sourceClips.length);
  assert.deepEqual(new Set(sourceClips.map(animation => animation.name)), new Set(['talk', 'idle', 'wave']));
  assert.deepEqual(new Set(record.sourceInspection.animations.map(animation => clipIdentity(animation.name))), new Set(['talk', 'idle', 'wave']));
  assert.equal(record.conversionOptions.bakeAnimations, true);
});

test('conversion command is a reproducible native Blender FBX handoff', () => {
  for (const record of provenance.records) {
    assert.deepEqual(record.conversionCommand.slice(0, 5), [
      'blender',
      '--background',
      '--factory-startup',
      '--python',
      'tools/blender/convert_glb_to_fbx.py',
    ]);
    assert.equal(record.conversionCommand.at(-1), record.semanticId);
    assert.equal(record.conversionOptions.axisForward, '-Z');
    assert.equal(record.conversionOptions.axisUp, 'Y');
    assert.equal(record.conversionOptions.applyUnitScale, true);
    assert.equal(record.conversionOptions.embedTextures, true);
  }
});
