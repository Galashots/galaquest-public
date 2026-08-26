import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const registry = JSON.parse(readFileSync(resolve(root, 'docs/asset-production/asset-registry-v1.json'), 'utf8'));
const schema = JSON.parse(readFileSync(resolve(root, 'docs/asset-production/asset-registry-v1.schema.json'), 'utf8'));
const enums = {
  lifecycle: new Set(['PLANNED', 'SOURCE_ONLY', 'GENERATED', 'QUALIFYING', 'QUALIFIED', 'PRODUCTION', 'REJECTED', 'SUPERSEDED', 'HISTORICAL']),
  custody: new Set(['IN_GIT', 'IN_DRIVE', 'PROVIDER_ONLY', 'LOCAL_ONLY', 'MULTIPLE', 'MISSING', 'UNKNOWN']),
  recoverability: new Set(['VERIFIED', 'VERIFIED_FROM_GIT', 'VERIFIED_FROM_DRIVE', 'VERIFIED_FROM_PROVIDER', 'UNAVAILABLE_CURRENT_PROVIDER_CONTEXT', 'STALE_SIGNED_URL', 'MISSING_BYTES', 'UNKNOWN']),
  gate: new Set(['PASS', 'FAIL', 'UNKNOWN', 'N/A']),
};
const gateNames = ['provenance', 'structural', 'materials', 'rig', 'animation', 'performance', 'visual', 'runtime', 'owner'];

test('registry has the declared schema and unique asset identities', () => {
  assert.equal(registry.schema, schema.properties.schema.const);
  assert.equal(registry.authority, schema.properties.authority.const);
  const ids = registry.records.map((r) => r.asset_id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 90, `expected current plus historical asset identities, got ${ids.length}`);
});

test('records use independent lifecycle, custody, recoverability, and gates', () => {
  const ids = new Set(registry.records.map((r) => r.asset_id));
  for (const record of registry.records) {
    assert.ok(enums.lifecycle.has(record.lifecycle), `${record.asset_id} lifecycle`);
    assert.ok(enums.custody.has(record.custody), `${record.asset_id} custody`);
    assert.ok(enums.recoverability.has(record.recoverability), `${record.asset_id} recoverability`);
    for (const gate of gateNames) assert.ok(enums.gate.has(record.qualification_gates[gate]), `${record.asset_id} ${gate}`);
    for (const relation of ['parent_asset_id', 'derivative_of']) if (record[relation]) assert.ok(ids.has(record[relation]), `${record.asset_id} references missing ${record[relation]}`);
    if (record.lifecycle === 'PRODUCTION') assert.equal(record.custody, 'IN_GIT');
    if (record.custody === 'PROVIDER_ONLY') assert.ok(['UNAVAILABLE_CURRENT_PROVIDER_CONTEXT', 'STALE_SIGNED_URL', 'UNKNOWN'].includes(record.recoverability));
    if (record.custody === 'LOCAL_ONLY') assert.notEqual(record.recoverability, 'VERIFIED_FROM_GIT');
  }
});

test('provider reconciliation is machine-readable and spend-safe', () => {
  const p = registry.provider_reconciliation;
  assert.equal(p.historical_task_records, 61);
  assert.equal(p.task_not_found, 61);
  assert.equal(p.stale_signed_url_tasks, 2);
  assert.equal(p.no_paid_operations, true);
  assert.equal(p.records.length, 63);
  assert.equal(p.records.filter((r) => r.provider_status === 'HTTP_404_TASK_NOT_FOUND').length, 61);
  assert.equal(p.records.filter((r) => r.download_attempt_result === 'HTTP_403_STALE_SIGNED_URL').length, 2);
  for (const r of p.records) {
    assert.ok(r.asset_id);
    assert.doesNotMatch(JSON.stringify(r), /(Bearer|api[-_]?key|signature=|Expires=|token)/i);
    assert.equal(r.recoverable_without_spend, false);
  }
});

test('production Git paths exist and recorded hashes match', () => {
  for (const record of registry.records.filter((r) => r.custody === 'IN_GIT')) {
    const path = record.source.path;
    assert.ok(path && !path.startsWith('/') && !path.includes('\\'), `${record.asset_id} has a repo-relative path`);
    const file = resolve(root, path);
    assert.ok(existsSync(file), `${record.asset_id} path exists`);
    if (record.source.sha256) assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), record.source.sha256, `${record.asset_id} hash`);
  }
});

test('no secrets, signed URLs, or temporary staging paths enter the authority', () => {
  const text = JSON.stringify(registry);
  assert.doesNotMatch(text, /(api[-_]?key|Bearer\s|access_token|C:\\Users\\|asset-staging-raw|https?:\/\/[^" ]*cloudfront\.net)/i);
  assert.doesNotMatch(text, /[?&](Expires|Signature|Key-Pair-Id)=/i);
  assert.equal(registry.historical_sources.find((s) => s.path.endsWith('asset-platform-inventory.json')).role.includes('historical'), true);
});
