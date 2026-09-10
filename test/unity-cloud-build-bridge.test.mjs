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

test('exact-source guard allows only the known Unity Build Automation manifest state', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'gq-uba-clean-'));
  const manifest = 'unity/GalaQuest/Assets/__UnityCloud__/Resources/UnityCloudBuildManifest.scriptable.asset';
  mkdirSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/Resources'), { recursive: true });
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
  assert.equal(status(), '', 'known UBA manifest and its Unity metadata');

  writeFileSync(join(fixture, 'tracked.txt'), 'modified\n');
  assert.match(status(), /tracked\.txt/, 'modified tracked path remains fatal and identifiable');
  writeFileSync(join(fixture, 'tracked.txt'), 'committed\n');
  writeFileSync(join(fixture, 'untracked.txt'), 'unexpected\n');
  assert.match(status(), /untracked\.txt/, 'unrelated untracked path remains fatal and identifiable');
  writeFileSync(join(fixture, 'unity/GalaQuest/Assets/__UnityCloud__/unexpected.txt'), 'unexpected\n');
  assert.match(status(), /__UnityCloud__\/unexpected\.txt/, 'adjacent generated-looking state is not broadly exempt');
});

test('cloud documentation routes the exact hooks and keeps the scene override closed', () => {
  const docs = read('docs/unity-cloud-build-bridge.md');
  assert.match(docs, /tools\/unity-build-automation\/provision-u2-review-inputs\.sh/);
  assert.match(docs, /GalaQuest\.Editor\.U2CombatPreview\.PreExport/);
  assert.match(docs, /GalaQuest\.Editor\.U2CombatPreview\.PostExport/);
  assert.match(docs, /Scene List override: empty\/unset/);
  assert.match(docs, /candidate-build-manifest\.json/);
});
