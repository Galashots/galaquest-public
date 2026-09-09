import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../unity/GalaQuest/', import.meta.url));

function materialFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? materialFiles(path) : entry.name.endsWith('.mat') ? [path] : [];
  });
}

test('saved URP upgrade state matches the already migrated material corpus', () => {
  const manifest = JSON.parse(readFileSync(join(project, 'Packages/manifest.json'), 'utf8'));
  assert.equal(manifest.dependencies['com.unity.render-pipelines.universal'], '17.3.0',
    'Requalify the migration guard against the new pinned URP upgrader count');
  // Confirmed against URP 17.3.0 MaterialPostprocessor.k_Upgraders and the loaded Editor assembly.
  const pinnedUpgradeVersion = 10;
  const settings = readFileSync(join(project, 'ProjectSettings/URPProjectSettings.asset'), 'utf8');
  const savedVersion = Number(settings.match(/^  m_LastMaterialVersion: (\d+)$/m)?.[1]);
  assert.ok(Number.isInteger(savedVersion), 'URP must have a persisted material upgrade version');
  assert.equal(savedVersion, pinnedUpgradeVersion,
    'Save the completed pinned-URP migration; lowering the marker is not a fix');
  const files = materialFiles(join(project, 'Assets'));
  const versions = files.flatMap(path => {
    const source = readFileSync(path, 'utf8');
    const blocks = source.split(/^--- /m).filter(block =>
      /m_EditorClassIdentifier:\s*Unity\.RenderPipelines\.Universal\.Editor::UnityEditor\.Rendering\.Universal\.AssetVersion\s*$/m.test(block));
    assert.equal(blocks.length, 1, `${path}: qualify an explicit URP AssetVersion before committing this material`);
    return blocks.map(block => ({ path, version: Number(block.match(/^\s+version:\s*(\d+)\s*$/m)?.[1]) }));
  });
  assert.equal(versions.length, files.length, 'Every shipped material must participate in the guard');
  assert.ok(versions.length > 0, 'Expected checked-in URP-versioned materials');
  for (const { path, version } of versions) {
    assert.equal(savedVersion, version,
      `${path}: save the pinned Editor's completed migration, including its project marker; do not repeatedly upgrade on cold test launches`);
  }
});
