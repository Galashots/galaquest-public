import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { validateJsonSchema } from '../tools/asset-registry/validate-json-schema.mjs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const registryPath = resolve(root, 'docs/asset-production/asset-registry-v1.json');
const schemaPath = resolve(root, 'docs/asset-production/asset-registry-v1.schema.json');
const evidencePath = resolve(root, 'docs/asset-production/asset-registry-v1.evidence.json');
const builderPath = resolve(root, 'tools/asset-registry/build-registry.mjs');

execFileSync(process.execPath, [builderPath], { cwd: root, stdio: 'pipe' });
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
const gateNames = ['provenance', 'structural', 'materials', 'rig', 'animation', 'performance', 'visual', 'runtime', 'owner'];

test('registry mechanically conforms to its JSON Schema', () => {
  assert.deepEqual(validateJsonSchema(registry, schema), []);
});

test('registry has unique stable logical identities and only declared runtime assets', () => {
  assert.equal(registry.schema, 'galaquest.asset-registry/1');
  assert.equal(registry.authority, 'current canonical asset inventory');
  const ids = registry.records.map((record) => record.asset_id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 80, `expected current plus historical asset identities, got ${ids.length}`);
  assert.equal(ids.some((id) => id.startsWith('runtime_public_assets_')), false);
  assert.equal(registry.records.some((record) => record.source.path?.endsWith('README.md')), false);
  for (const declared of evidence.runtime_assets) {
    const record = registry.records.find((candidate) => candidate.asset_id === declared.asset_id);
    assert.ok(record, `missing stable runtime identity ${declared.asset_id}`);
    assert.equal(record.source.path, declared.path);
  }
});

test('qualification gates are independent and evidence-bound when proven', () => {
  for (const record of registry.records) {
    for (const name of gateNames) {
      const gate = record.qualification_gates[name];
      assert.ok(gate);
      assert.ok(['PASS', 'FAIL', 'UNKNOWN', 'N/A'].includes(gate.status), `${record.asset_id} ${name} status`);
      assert.ok(Array.isArray(gate.evidence_refs), `${record.asset_id} ${name} evidence refs`);
      if (gate.status === 'PASS' || gate.status === 'FAIL') assert.ok(gate.evidence_refs.length > 0, `${record.asset_id} ${name} proof must cite evidence`);
    }
  }
  const wolf = registry.records.find((record) => record.asset_id === 'enemy.wolf');
  assert.equal(wolf.qualification_gates.structural.status, 'UNKNOWN');
  assert.equal(wolf.qualification_gates.runtime.status, 'UNKNOWN');
  const frog = registry.records.find((record) => record.asset_id === 'frog-meshy-download-v1');
  assert.equal(frog.qualification_gates.rig.status, 'PASS');
  assert.ok(frog.qualification_gates.rig.evidence_refs.length > 0);
});

test('custody preserves multiple durable recovery coordinates', () => {
  const archived = registry.records.find((record) => record.asset_id === 'wren-ranger-v1-run');
  assert.ok(archived, 'wren archived candidate exists');
  assert.equal(archived.custody, 'MULTIPLE');
  assert.equal(archived.recoverability, 'VERIFIED');
  const git = archived.custody_locations.find((location) => location.kind === 'GIT');
  const drive = archived.custody_locations.find((location) => location.kind === 'DRIVE');
  assert.ok(git?.git_ref && git?.repo_path && git?.git_blob_oid, 'Git recovery route remains actionable');
  assert.ok(drive?.drive_file_id && drive?.drive_file_url && drive?.archive_path, 'Drive recovery route remains actionable');
  const frog = registry.records.find((record) => record.asset_id === 'frog-meshy-download-v1');
  assert.equal(frog.custody, 'LOCAL_ONLY');
  assert.equal(frog.custody_locations[0].durable, false);
});

test('structural metrics and rights are explicit without inferred facts', () => {
  for (const record of registry.records) {
    for (const field of ['file_size_bytes', 'mesh_count', 'primitive_count', 'vertex_count', 'triangle_count', 'material_count', 'skin_count', 'joint_count', 'animation_clip_count']) {
      assert.notEqual(record.structural_metrics[field], undefined, `${record.asset_id} ${field}`);
    }
    assert.ok(record.rights.provenance);
    assert.ok(record.rights.license);
    assert.ok(record.rights.usage_rights);
    if (record.rights.license.status === 'UNKNOWN') assert.equal(record.rights.license.value, null);
    if (record.rights.usage_rights.status === 'UNKNOWN') assert.equal(record.rights.usage_rights.value, null);
  const audited = registry.records.find((record) => record.asset_id === 'cinderfang-raider-v1');
  assert.equal(audited.structural_metrics.mesh_count, 1);
  assert.equal(audited.structural_metrics.joint_count, 24);
  assert.equal(audited.structural_metrics.animation_clip_count, 1);
  assert.equal(audited.qualification_gates.structural.status, 'PASS');
  const unaudited = registry.records.find((record) => record.asset_id === 'enemy.wolf');
  assert.equal(unaudited.structural_metrics.mesh_count, 'UNKNOWN');
  }
});

test('provider reconciliation is dated machine-readable evidence and spend-safe', () => {
  const provider = registry.provider_reconciliation;
  assert.equal(provider.observed_utc, evidence.provider_reconciliation.observed_utc);
  assert.equal(provider.historical_task_records, 61);
  assert.equal(provider.task_not_found, 61);
  assert.equal(provider.stale_signed_url_tasks, 2);
  assert.equal(provider.no_paid_operations, true);
  assert.equal(provider.records.length, 63);
  assert.equal(provider.records.filter((record) => record.provider_status === 'HTTP_404_TASK_NOT_FOUND').length, 61);
  assert.equal(provider.records.filter((record) => record.download_attempt_result === 'HTTP_403_STALE_SIGNED_URL').length, 2);
  assert.match(provider.status, /dated evidence snapshot/);
  for (const record of provider.records) {
    assert.ok(record.asset_id);
    assert.doesNotMatch(JSON.stringify(record), /(Bearer|api[-_]?key|signature=|Expires=|token)/i);
    assert.equal(record.recoverable_without_spend, false);
  }
});

test('current Git custody paths exist and recorded hashes match', () => {
  for (const record of registry.records.filter((candidate) => candidate.source.authority === 'runtime-asset-identity-snapshot')) {
    const path = record.source.path;
    assert.ok(path && !path.startsWith('/') && !path.includes('\\'), `${record.asset_id} has a repo-relative path`);
    const file = resolve(root, path);
    assert.ok(existsSync(file), `${record.asset_id} path exists`);
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), record.source.sha256, `${record.asset_id} hash`);
    const location = record.custody_locations.find((candidate) => candidate.kind === 'GIT');
    assert.equal(location.git_ref, evidence.snapshot.runtime_git_ref);
    assert.ok(location.git_blob_oid);
  }
});

test('authority remains secret-free and Package B interface-only', () => {
  const text = JSON.stringify(registry);
  assert.doesNotMatch(text, /(api[-_]?key|Bearer\s|access_token|C:\\Users\\|asset-staging-raw|https?:\/\/[^" ]*cloudfront\.net)/i);
  assert.doesNotMatch(text, /[?&](Expires|Signature|Key-Pair-Id)=/i);
  assert.equal(registry.historical_sources.some((source) => source.path.endsWith('asset-registry-v1.evidence.json')), true);
  assert.equal(registry.animation_lab_interface.consumer, 'Package B Animation Lab v1');
  assert.deepEqual(registry.animation_lab_interface.exclusions, ['authoring implementation', 'retarget promotion', 'runtime integration']);
});
