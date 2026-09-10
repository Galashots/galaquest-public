import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

test('Unity cloud bridge keeps the existing U2 entry point and generated-scene seam', () => {
  const source = read('unity/GalaQuest/Assets/GalaQuest/Editor/U2CombatPreview.cs');
  assert.match(source, /public static void PreExport\(\)/);
  assert.match(source, /public static void PostExport\(string exportPath\)/);
  assert.match(source, /PrepareScene\(content\)/);
  assert.match(source, /EditorBuildSettings\.scenes = new\[\] \{ new EditorBuildSettingsScene\(scene, true\) \}/);
  assert.match(source, /BuildPipeline\.BuildPlayer\(new BuildPlayerOptions/);
  assert.match(source, /sourceSha/);
  assert.match(source, /BUILD_REVISION/);
  assert.match(source, /SCM_REVISION/);
});

test('cloud provisioning names both custody inputs, verifies expected bytes and hashes, and fails closed', () => {
  const script = read('tools/unity-build-automation/provision-u2-review-inputs.sh');
  assert.match(script, /GQ_U2_GREMLIN_FBX_URL/);
  assert.match(script, /GQ_U2_GREMLIN_TEXTURE_URL/);
  assert.match(script, /GQ_U2_REVIEW_ASSET_BEARER_TOKEN/);
  assert.match(script, /https:\/\//);
  assert.match(script, /sha256sum/);
  assert.match(script, /283cf0579fc864a1e599f7c2ccda3e0b4fdd930d566c04225c8dc88b10be77db/);
  assert.match(script, /9fb9eb5758673cbc3670ad95d1b2e2b9bf075a0699d68aa119ab334f3847d812/);
  assert.match(script, /4404300/);
  assert.match(script, /6804038/);
  assert.match(script, /Missing required controlled U2 input URL/);
  assert.match(script, /verification failed/);
  assert.doesNotMatch(script, /drive\.google\.com\/uc\?export=download/);
});

test('cloud documentation routes the exact hooks and keeps the scene override closed', () => {
  const docs = read('docs/unity-cloud-build-bridge.md');
  assert.match(docs, /tools\/unity-build-automation\/provision-u2-review-inputs\.sh/);
  assert.match(docs, /GalaQuest\.Editor\.U2CombatPreview\.PreExport/);
  assert.match(docs, /GalaQuest\.Editor\.U2CombatPreview\.PostExport/);
  assert.match(docs, /Scene List override: empty\/unset/);
  assert.match(docs, /candidate-build-manifest\.json/);
});
