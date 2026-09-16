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

test('semantic facets and next actions are deterministic facts, not duplicate status labels', () => {
  for (const record of registry.records) {
    assert.deepEqual(record.facets, [...record.facets].sort(), `${record.asset_id} facets sorted`);
    assert.equal(new Set(record.facets).size, record.facets.length, `${record.asset_id} facets unique`);
    assert.equal(record.facets.includes(record.asset_kind), false, `${record.asset_id} does not duplicate asset_kind`);
    if (record.asset_kind !== 'character') {
      assert.equal(record.facets.includes('enemy'), false, `${record.asset_id} non-character is not inferred as enemy`);
    }
  }
  const mystery = registry.records.find((record) => record.asset_id === 'intake.20260829.0829150207');
  assert.equal(mystery.next_action, 'OWNER_REVIEW');
  assert.equal(mystery.qualification_gates.visual.status, 'UNKNOWN');
  assert.deepEqual(mystery.facets, ['meshy']);
  assert.ok(registry.records.find((record) => record.asset_id === 'frostbound-warden-v1').facets.includes('enemy'));
  assert.equal(registry.records.find((record) => record.asset_id === 'prop.thornwood-tangle-intake-v1').facets.includes('beacon'), false);
  assert.equal(registry.records.find((record) => record.asset_id === 'prop.maplewood-lantern-intake-v1').facets.includes('village'), false);
  assert.equal(registry.records.find((record) => record.asset_id === 'prop.campfire-essentials-intake-v1').facets.includes('forest'), false);
  assert.equal(registry.records.find((record) => record.asset_id === 'landmark.crystal-sanctum-intake-v1').facets.includes('forest'), false);
});

test('the complete Drive intake is represented once and the unresolved animation source stays unknown', () => {
  const intake = registry.records.filter((record) => record.source.authority === 'drive-intake-2026-08-29');
  assert.equal(intake.length, 12);
  assert.equal(new Set(intake.map((record) => record.source.sha256)).size, 12);
  assert.ok(intake.every((record) => record.custody === 'IN_DRIVE' && record.recoverability === 'VERIFIED_FROM_DRIVE'));
  const source = registry.records.find((record) => record.asset_id === 'animation-source.hero.meshy.hdus9c');
  assert.equal(source.source.sha256, null);
  assert.equal(source.recoverability, 'UNAVAILABLE_CURRENT_PROVIDER_CONTEXT');
  assert.equal(source.qualification_gates.animation.status, 'UNKNOWN');
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

test('Drive custody requires file-specific evidence, not folder context alone', () => {
  const providerOnly = registry.records.find((record) => record.asset_id === 'gear_behemoth_lower_kit');
  assert.ok(providerOnly, 'historical provider-only gear exists');
  assert.equal(providerOnly.custody, 'PROVIDER_ONLY');
  assert.equal(providerOnly.recoverability, 'UNAVAILABLE_CURRENT_PROVIDER_CONTEXT');
  const folderContext = providerOnly.custody_locations.find((location) => location.kind === 'DRIVE');
  assert.ok(folderContext?.archive_path, 'Drive folder context remains recorded');
  assert.equal(folderContext.durable, false);
  assert.equal(folderContext.drive_file_id, null);
  assert.equal(folderContext.drive_file_url, null);

  for (const record of registry.records.filter((candidate) => candidate.custody === 'IN_DRIVE' || candidate.recoverability === 'VERIFIED_FROM_DRIVE')) {
    const drive = record.custody_locations.find((location) => location.kind === 'DRIVE' && location.durable);
    assert.ok(drive?.drive_file_id && drive?.drive_file_url, `${record.asset_id} Drive custody has file-specific evidence`);
  }
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
  }
  const audited = registry.records.find((record) => record.asset_id === 'cinderfang-raider-v1');
  assert.equal(audited.structural_metrics.mesh_count, 1);
  assert.equal(audited.structural_metrics.joint_count, 24);
  assert.equal(audited.structural_metrics.animation_clip_count, 1);
  assert.equal(audited.qualification_gates.structural.status, 'PASS');
  const unaudited = registry.records.find((record) => record.asset_id === 'enemy.wolf');
  assert.equal(unaudited.structural_metrics.mesh_count, 'UNKNOWN');
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

// Exercise the production entrypoint with real repository classes and deliberately wrong bytes.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';
import { qualifyAsset, verifyReceipt } from '../tools/asset-registry/qualify-asset.mjs';

const qualificationOptions = (id, extra = {}) => ({ id, purpose: 'Production-route regression, not visual acceptance',
  reference: ['docs/GALAQUEST_VISUAL_AUTHORITY.md'], ...extra });
function qualificationScratch(callback) {
  mkdirSync(resolve(root, '.local'), { recursive: true });
  const dir = mkdtempSync(resolve(root, '.local/qualification-'));
  try { return callback(relative(root, dir).replaceAll('\\', '/')); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
function mutatedGlb(bytes, mutate) {
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  mutate(json);
  const text = Buffer.from(JSON.stringify(json));
  const chunk = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
  text.copy(chunk);
  const output = Buffer.concat([bytes.subarray(0, 20), chunk, bytes.subarray(20 + length)]);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(chunk.length, 12);
  return output;
}

test('qualification joins real Wolf, Ironwood shield and cart without claiming appearance or mutating inventory', () => {
  const before = readFileSync(registryPath);
  for (const [id, type] of [['enemy.wolf', 'character'], ['gear.shield.ironwood', 'rigid-gear'], ['prop.village.cart', 'rigid-prop']]) {
    const options = qualificationOptions(id, { class: type });
    const result = qualifyAsset(options);
    assert.equal(result.checks.source_identity.status, 'PASS', id);
    assert.equal(result.checks.class_contract.status, 'PASS', id);
    assert.ok(result.measurements.triangle_count > 0);
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.promotion_authorized, false);
    assert.equal(result.next_action, 'COMPLETE_SPECIALIST_AND_UNITY_REVIEW');
    for (const name of ['topology', 'materials', 'fit', 'performance', 'unity', 'producer_visual', 'independent_visual', 'device', 'rights', 'owner']) {
      assert.equal(result.checks[name].status, 'UNKNOWN', name);
    }
    assert.ok(result.diagnostics.every((run) => run.exit_code === 0), id);
    assert.deepEqual(qualifyAsset(options), result, 'unchanged input produces an identical receipt');
    assert.notEqual(verifyReceipt(result).status, 'FAIL');
    assert.equal(verifyReceipt(result).qualification_status, 'UNKNOWN');
  }
  assert.deepEqual(readFileSync(registryPath), before);
});

test('qualification rejects wrong source identity and skinned character misdeclared as rigid gear', () => {
  const wolf = 'public/assets/enemies/wolf.glb';
  const source = qualifyAsset(qualificationOptions('gear.shield.ironwood', { class: 'rigid-gear', source: wolf }));
  assert.equal(source.checks.source_identity.status, 'FAIL');
  const candidate = qualifyAsset(qualificationOptions('gear.shield.ironwood', { class: 'rigid-gear', candidate: wolf }));
  assert.equal(candidate.checks.source_identity.status, 'PASS');
  assert.equal(candidate.checks.class_contract.status, 'FAIL');
  assert.equal(candidate.checks.derivative_lineage.status, 'UNKNOWN');
  assert.equal(candidate.status, 'FAIL');
});

test('qualification fails closed for unknown identity, ambiguous classes, absent inputs and recorded rejection', () => {
  assert.throws(() => qualifyAsset({ id: 'nonexistent-qualification-id' }), /exact asset_id/);
  for (const id of ['gear.shield.ironwood', 'prop.village.cart']) {
    assert.equal(qualifyAsset(qualificationOptions(id)).next_action, 'DECLARE_SUPPORTED_CLASS');
  }
  const missing = qualifyAsset({ id: 'enemy.wolf', candidate: '.local/missing-qualification.glb' });
  assert.equal(missing.checks.metadata.status, 'UNKNOWN');
  assert.equal(missing.checks.intent_inputs.status, 'UNKNOWN');
  assert.equal(missing.status, 'UNKNOWN');
  const unsupported = qualifyAsset(qualificationOptions('gear.shield.ironwood', { class: 'deformable-gear' }));
  assert.equal(unsupported.next_action, 'DECLARE_SUPPORTED_CLASS');
  assert.equal(qualifyAsset({ id: 'fox-meshy-download-v1' }).checks.recorded_rejections.status, 'FAIL');
  assert.equal(qualifyAsset({ id: 'dawnwarden-helmet-v1' }).checks.lifecycle.status, 'FAIL');
  assert.throws(() => qualifyAsset({ id: 'enemy.wolf', source: '../outside.glb' }), /checkout-relative/);
});

test('native clip adapter accepts the actual native Wolf and rejects equal-name different-rest Wolf', () => qualificationScratch((prefix) => {
  const path = `${prefix}/wrong-rest.glb`;
  const wolf = readFileSync(resolve(root, 'public/assets/enemies/wolf.glb'));
  writeFileSync(resolve(root, path), mutatedGlb(wolf, (gltf) => {
    const joint = gltf.skins[0].joints.map((index) => gltf.nodes[index]).find((node) => node.translation?.some((v) => Math.abs(v) > 0.001));
    assert.ok(joint);
    joint.translation = joint.translation.map((value) => value * 1.5);
  }));
  const good = qualifyAsset(qualificationOptions('enemy.wolf', { clip: ['public/assets/enemies/wolf.glb'] }));
  assert.equal(good.checks.native_clip.status, 'PASS');
  assert.equal(good.checks.rig_animation.status, 'UNKNOWN');
  const bad = qualifyAsset(qualificationOptions('enemy.wolf', { clip: [path] }));
  assert.equal(bad.checks.native_clip.status, 'FAIL');
  assert.equal(bad.status, 'FAIL');
  assert.match(bad.diagnostics.at(-1).stdout, /rest bone/);
}));

test('receipt binds derivative, external texture, importer metadata and review bytes; PASS text is not acceptance', () => qualificationScratch((prefix) => {
  const candidate = `${prefix}/shield.glb`, texture = `${prefix}/albedo.png`, review = `${prefix}/review.json`;
  const original = readFileSync(resolve(root, 'public/assets/gear/shield_ironwood.glb'));
  writeFileSync(resolve(root, candidate), mutatedGlb(original, (gltf) => { gltf.images = [{ uri: 'albedo.png' }]; }));
  writeFileSync(resolve(root, texture), 'deliberate identity-only fixture');
  writeFileSync(resolve(root, `${candidate}.meta`), 'importer fixture');
  writeFileSync(resolve(root, review), '{"owner":"PASS","visual":"PASS"}');
  const result = qualifyAsset(qualificationOptions('gear.shield.ironwood', { class: 'rigid-gear', candidate, evidence: [review] }));
  assert.equal(result.checks.owner.status, 'UNKNOWN');
  assert.equal(result.checks.producer_visual.status, 'UNKNOWN');
  assert.notEqual(verifyReceipt(result).status, 'FAIL');
  for (const path of [candidate, texture, `${candidate}.meta`, review]) {
    const before = readFileSync(resolve(root, path));
    writeFileSync(resolve(root, path), 'changed');
    assert.ok(verifyReceipt(result).changed.includes(path), path);
    writeFileSync(resolve(root, path), before);
  }
  const edited = structuredClone(result); edited.status = 'PASS';
  assert.equal(verifyReceipt(edited).status, 'FAIL');
}));

test('qualification CLI returns incomplete exit 2 and refuses to overwrite its receipt', () => qualificationScratch((prefix) => {
  const tool = resolve(root, 'tools/asset-registry/qualify-asset.mjs'), out = `${prefix}/receipt.json`;
  const args = [tool, '--id', 'enemy.wolf', '--out', out];
  assert.equal(spawnSync(process.execPath, args, { cwd: root }).status, 2);
  const before = readFileSync(resolve(root, out));
  assert.equal(JSON.parse(before).status, 'UNKNOWN');
  assert.equal(spawnSync(process.execPath, args, { cwd: root }).status, 1);
  assert.deepEqual(readFileSync(resolve(root, out)), before);
}));

test('authority remains secret-free and Package B interface-only', () => {
  const text = JSON.stringify(registry);
  assert.doesNotMatch(text, /(api[-_]?key|Bearer\s|access_token|C:\\Users\\|asset-staging-raw|https?:\/\/[^" ]*cloudfront\.net)/i);
  assert.doesNotMatch(text, /[?&](Expires|Signature|Key-Pair-Id)=/i);
  assert.equal(registry.historical_sources.some((source) => source.path.endsWith('asset-registry-v1.evidence.json')), true);
  assert.equal(registry.animation_lab_interface.consumer, 'Package B Animation Lab v1');
  assert.deepEqual(registry.animation_lab_interface.exclusions, ['authoring implementation', 'retarget promotion', 'runtime integration']);
});
