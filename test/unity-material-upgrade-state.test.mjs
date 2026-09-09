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
  const settings = readFileSync(join(project, 'ProjectSettings/URPProjectSettings.asset'), 'utf8');
  const savedVersion = Number(settings.match(/^  m_LastMaterialVersion: (\d+)$/m)?.[1]);
  assert.ok(Number.isInteger(savedVersion), 'URP must have a persisted material upgrade version');
  const versions = materialFiles(join(project, 'Assets')).flatMap(path => {
    const source = readFileSync(path, 'utf8');
    return [...source.matchAll(/m_EditorClassIdentifier: Unity\.RenderPipelines\.Universal\.Editor::UnityEditor\.Rendering\.Universal\.AssetVersion\r?\n  version: (\d+)/g)]
      .map(match => ({ path, version: Number(match[1]) }));
  });
  assert.ok(versions.length > 0, 'Expected checked-in URP-versioned materials');
  for (const { path, version } of versions) {
    assert.equal(savedVersion, version,
      `${path}: save the pinned Editor's completed migration, including its project marker; do not repeatedly upgrade on cold test launches`);
  }
});
