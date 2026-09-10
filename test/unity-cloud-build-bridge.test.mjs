import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function cleanStatusArguments() {
  const source = read('unity/GalaQuest/Assets/GalaQuest/Editor/U2CombatPreview.cs');
  const block = source.match(/const string statusArguments = ([\s\S]*?);\n            var unexpected/);
  assert.ok(block, 'production clean-check command must remain discoverable');
  return [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    .map(([, literal]) => JSON.parse(`"${literal}"`))
    .join('')
    .match(/(?:[^\s"]+|"[^"]*")+/g)
    .map((argument) => argument.replace(/^"|"$/g, ''));
}

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
  assert.match(script, /BASH_SOURCE/);
  assert.doesNotMatch(script, /git -C/);
  assert.doesNotMatch(script, /drive\.google\.com\/uc\?export=download/);
  assert.match(read('.gitattributes'), /^tools\/unity-build-automation\/provision-u2-review-inputs\.sh text eol=lf$/m);
});

test('cloud provisioner resolves the repository root from its checked-in script location and rejects bad bytes', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'gq-uba-provision-'));
  const curlOutputs = `${fixture}-curl-outputs`;
  const project = join(fixture, 'unity/GalaQuest');
  const bin = join(fixture, 'bin');
  const provisioner = join(fixture, 'tools/unity-build-automation/provision-u2-review-inputs.sh');
  mkdirSync(project, { recursive: true });
  mkdirSync(bin);
  mkdirSync(join(fixture, 'tools/unity-build-automation'), { recursive: true });
  writeFileSync(join(fixture, '.gitignore'), '.local/\n');
  cpSync(join(root, 'tools/unity-build-automation/provision-u2-review-inputs.sh'), provisioner);
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then output="$2"; shift 2; else shift; fi
done
printf 'synthetic-invalid-bytes' > "$output"
printf '%s\\n' "$output" >> "${curlOutputs}"
`);
  chmodSync(join(bin, 'curl'), 0o755);
  git(fixture, 'init', '-q');
  git(fixture, 'config', 'user.email', 'test@example.invalid');
  git(fixture, 'config', 'user.name', 'Bridge Test');
  git(fixture, 'add', '.');
  git(fixture, 'commit', '-qm', 'fixture');

  const result = spawnSync('bash', [provisioner], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, IS_BUILDER: 'true',
      PROJECT_DIRECTORY: join(fixture, 'intentionally-not-a-project'),
      GQ_U2_GREMLIN_FBX_URL: 'https://fixtures.invalid/gremlin.fbx',
      GQ_U2_GREMLIN_TEXTURE_URL: 'https://fixtures.invalid/gremlin.png' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /verification failed.*expected 4404300 bytes\/283cf057/s);
  const outputs = readFileSync(curlOutputs, 'utf8');
  assert.match(outputs, new RegExp(`${fixture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.local/m2/gremlin-local-rig/`));
  assert.doesNotMatch(outputs, /unity\/GalaQuest\/\.local\/m2/);
  assert.equal(git(fixture, 'status', '--porcelain'), '', 'ignored provisioning attempts must not dirty source');
});

test('batch entry points seed a committed scene instead of closing the host untitled scene', () => {
  const source = read('unity/GalaQuest/Assets/GalaQuest/Editor/U2CombatPreview.cs');
  const seed = source.match(/private static void SeedBatchModeScene\(\)\n        \{([\s\S]*?)\n        \}/);
  assert.ok(seed, 'the batch-mode scene bootstrap must remain discoverable');
  assert.match(seed[1], /if \(!Application\.isBatchMode\) return;/,
    'interactive Editor state is never replaced');
  assert.match(seed[1], /EditorSceneManager\.OpenScene\(EmberworksGreyboxBuild\.ScenePath, OpenSceneMode\.Single\)/,
    'Single replaces whatever untitled scene the batch host opened with a committed scene');
  assert.doesNotMatch(seed[1], /CloseScene/,
    'Unity refuses to close its last scene, so the bootstrap must never try');

  // Unity keeps at least one scene open, so the guard can only be satisfied by
  // seeding a named scene. It must stay strict and identical in both modes.
  const guard = source.match(/private static void RequireNamedScenes\(\)\n        \{([\s\S]*?)\n        \}/);
  assert.ok(guard, 'the untitled-scene guard must remain discoverable');
  assert.match(guard[1], /Save or close untitled scenes before preview preparation; no user scene is discarded/);
  assert.doesNotMatch(guard[1], /isBatchMode/, 'the guard carries no batch-mode escape hatch');
  assert.doesNotMatch(guard[1], /CloseScene/, 'the guard never discards scene state to pass itself');

  for (const [entry, body] of [
    ['PreExport', source.match(/public static void PreExport\(\)\n        \{([\s\S]*?)\n        \}/)],
    ['BuildWebGL', source.match(/public static void BuildWebGL\(\)\n        \{([\s\S]*?)\n            try/)],
  ]) {
    assert.ok(body, `${entry} must remain discoverable`);
    const clean = body[1].indexOf('RequireCleanCheckout()');
    const seeded = body[1].indexOf('SeedBatchModeScene()');
    assert.ok(clean >= 0 && seeded >= 0, `${entry} proves cleanliness and seeds the batch scene`);
    assert.ok(clean < seeded, `${entry} proves repository cleanliness before changing Editor state`);
  }
  assert.ok(source.indexOf('SeedBatchModeScene()') < source.indexOf('var content = Prepare();'),
    'the batch scene is seeded before preview preparation runs');

  // Both authoring flows stay additive so a developer's open scenes survive.
  assert.match(source, /EditorSceneManager\.NewScene\(NewSceneSetup\.EmptyScene, NewSceneMode\.Additive\)/);
  assert.match(source, /EditorSceneManager\.OpenScene\(path, OpenSceneMode\.Additive\)/);
});

test('preview scene authoring resolves objects within the scene it configures', () => {
  // Seeding a committed scene leaves two copies of EmberworksDeep loaded: the
  // batch-mode host's, and the additively-opened preview copy. Build #8 proved
  // an all-scenes lookup then matches a hero in each and throws "Sequence
  // contains more than one matching element". Scene-scoped lookups are the
  // codebase convention: EmberworksGreyboxBuild.FindSceneObject filters on
  // candidate.scene, and the pocket lookup here filters on runtime.scene.
  const source = read('unity/GalaQuest/Assets/GalaQuest/Editor/RuneForgeAuthoring.cs');
  const configure = source.match(/public static void ConfigurePreview\(GameObject runtime, GalaQuestCombatContent content\)\n        \{([\s\S]*?)\n        \}/);
  assert.ok(configure, 'the preview authoring entry point must remain discoverable');
  assert.doesNotMatch(configure[1], /FindObjectsByType|FindAnyObjectByType|FindObjectOfType/,
    'preview authoring must not search across every loaded scene');
  assert.match(configure[1], /var hero = runtime\.scene\.GetRootGameObjects\(\)/,
    'the hero is resolved from the scene being configured');
  assert.match(configure[1], /RuntimeHeroName/);
});

test('exact-source guard allows only the known Unity Build Automation manifest state', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'gq-uba-clean-'));
  const manifest = 'unity/GalaQuest/Assets/__UnityCloud__/Resources/UnityCloudBuildManifest.scriptable.asset';
  mkdirSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/Resources'), { recursive: true });
  mkdirSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/Scripts/Editor'), { recursive: true });
  mkdirSync(join(fixture, '.build/last/galaquest-webgl-staging/extra_data'), { recursive: true });
  writeFileSync(join(fixture, 'tracked.txt'), 'committed\n');
  git(fixture, 'init', '-q');
  git(fixture, 'config', 'user.email', 'test@example.invalid');
  git(fixture, 'config', 'user.name', 'Bridge Test');
  git(fixture, 'add', '.');
  git(fixture, 'commit', '-qm', 'fixture');
  const status = () => git(fixture, ...cleanStatusArguments());

  assert.equal(status(), '', 'clean checkout');
  writeFileSync(join(fixture, manifest), 'generated\n');
  writeFileSync(join(fixture, `${manifest}.meta`), 'generated meta\n');
  writeFileSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__.meta'), 'folder meta\n');
  writeFileSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/Resources.meta'), 'folder meta\n');
  writeFileSync(join(fixture, '.build/last/galaquest-webgl-staging/build_stats.json'), '{}\n');
  writeFileSync(join(fixture, '.build/last/galaquest-webgl-staging/extra_data/editoranalytics_session.json'), '{}\n');
  writeFileSync(join(fixture, 'build.json'), '{}\n');
  writeFileSync(join(fixture, 'unity/GalaQuest/build_manifest.json'), '{}\n');
  writeFileSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/Scripts.meta'), 'folder meta\n');
  writeFileSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/Scripts/Editor.meta'), 'folder meta\n');
  writeFileSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/Scripts/Editor/README.md'), 'generated\n');
  writeFileSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/Scripts/Editor/README.md.meta'), 'generated meta\n');
  writeFileSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/Scripts/Editor/UnityEditor.CloudBuild.dll'), 'generated\n');
  writeFileSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/Scripts/Editor/UnityEditor.CloudBuild.dll.meta'), 'generated meta\n');
  writeFileSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/Scripts/UnityEngine.CloudBuild.dll'), 'generated\n');
  writeFileSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/Scripts/UnityEngine.CloudBuild.dll.meta'), 'generated meta\n');
  for (const name of ['csc.rsp', 'gmcs.rsp', 'smcs.rsp', 'us.rsp']) {
    writeFileSync(join(fixture, `unity/GalaQuest/Assets/${name}`), 'generated\n');
    writeFileSync(join(fixture, `unity/GalaQuest/Assets/${name}.meta`), 'generated meta\n');
  }
  assert.equal(status(), '', 'observed UBA generated state is narrowly exempt');

  writeFileSync(join(fixture, 'tracked.txt'), 'modified\n');
  assert.match(status(), /tracked\.txt/, 'modified tracked path remains fatal and identifiable');
  writeFileSync(join(fixture, 'tracked.txt'), 'committed\n');
  writeFileSync(join(fixture, 'untracked.txt'), 'unexpected\n');
  assert.match(status(), /untracked\.txt/, 'unrelated untracked path remains fatal and identifiable');
  writeFileSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/unexpected.txt'), 'unexpected\n');
  assert.match(status(), /__UnityCloud__\/unexpected\.txt/, 'adjacent generated-looking state is not broadly exempt');
  writeFileSync(join(fixture, '.build/last/galaquest-webgl-staging/unexpected.json'), 'unexpected\n');
  assert.match(status(), /\.build\/last\/galaquest-webgl-staging\/unexpected\.json/, 'adjacent build metadata is not broadly exempt');
});

test('cloud documentation routes the exact hooks and keeps the scene override closed', () => {
  const docs = read('docs/unity-cloud-build-bridge.md');
  assert.match(docs, /tools\/unity-build-automation\/provision-u2-review-inputs\.sh/);
  assert.match(docs, /GalaQuest\.Editor\.U2CombatPreview\.PreExport/);
  assert.match(docs, /GalaQuest\.Editor\.U2CombatPreview\.PostExport/);
  assert.match(docs, /Scene List override: empty\/unset/);
  assert.match(docs, /candidate-build-manifest\.json/);
});
