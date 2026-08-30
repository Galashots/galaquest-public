// Studio Library's server-side surface (#92 STUDIO-V2A): a live, read-only passthrough of the
// canonical registry, augmented with a truthful "can this checkout serve these bytes right now"
// fact per record. These tests protect exactly the "truthful loadability" contract: real GIT-backed
// assets under public/ come back loadable, and Drive/provider/other-branch records come back
// refused with a reason drawn from the registry's own recorded custody, never faked as loaded.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createRuntimeServer } from '../server.mjs';
import {
  ASSET_REGISTRY_ROUTE,
  REGISTRY_PATH,
  REPO_ROOT,
  computeRuntimeAvailability,
  loadAugmentedRegistry,
} from '../net/registryApi.mjs';

const canonical = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));

async function serving(body) {
  const server = createRuntimeServer();
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    return await body(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

test('the API is the canonical file itself, not a duplicated rack: same schema, same record identities', async () => {
  await serving(async (origin) => {
    const response = await fetch(`${origin}${ASSET_REGISTRY_ROUTE}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    const body = await response.json();
    assert.equal(body.schema, canonical.schema);
    assert.equal(body.authority, canonical.authority);
    assert.equal(body.generated_utc, canonical.generated_utc);
    assert.deepEqual(
      body.records.map((r) => r.asset_id).sort(),
      canonical.records.map((r) => r.asset_id).sort(),
    );
  });
});

test('a real Git-backed asset under public/ is reported truthfully loadable with a fetchable URL', async () => {
  await serving(async (origin) => {
    const registry = await fetch(`${origin}${ASSET_REGISTRY_ROUTE}`).then((r) => r.json());
    const hero = registry.records.find((r) => r.asset_id === 'hero.base');
    assert.ok(hero, 'hero.base exists in the registry');
    assert.equal(hero.runtime_availability.loadable, true);
    assert.equal(hero.runtime_availability.reason, null);
    const bytes = await fetch(`${origin}${hero.runtime_availability.runtimeUrl}`);
    assert.equal(bytes.status, 200, 'the URL the API published must actually resolve');
  });
});

test('a record recorded only on another Git branch is truthfully refused, not faked as loaded', async () => {
  await serving(async (origin) => {
    const registry = await fetch(`${origin}${ASSET_REGISTRY_ROUTE}`).then((r) => r.json());
    const record = registry.records.find((r) => r.asset_id === 'boneguard-raider-v1');
    assert.ok(record, 'boneguard-raider-v1 exists in the registry');
    assert.equal(record.custody, 'MULTIPLE', 'sanity: this fixture really is a multi-custody record');
    assert.equal(record.runtime_availability.loadable, false);
    assert.equal(record.runtime_availability.runtimeUrl, null);
    assert.match(record.runtime_availability.reason, /origin\/feat\/enemy-asset-wave-1/,
      'the refusal must name the ACTUAL recorded custody, not a generic "unavailable"');
    // And it must not merely be missing from the served payload -- it is present, with truthful status.
    assert.equal(record.custody_locations.some((loc) => loc.kind === 'DRIVE'), true);
  });
});

test('a Drive/provider-only record with no repo path is refused with its own true reason', async () => {
  await serving(async (origin) => {
    const registry = await fetch(`${origin}${ASSET_REGISTRY_ROUTE}`).then((r) => r.json());
    const record = registry.records.find((r) => r.asset_id === 'animation-source.hero.meshy.hdus9c');
    assert.ok(record);
    assert.equal(record.runtime_availability.loadable, false);
    assert.equal(record.runtime_availability.runtimeUrl, null);
    assert.match(record.runtime_availability.reason, /no repo-relative path recorded/);
  });
});

test('only GET/HEAD are accepted and no other route is shadowed', async () => {
  await serving(async (origin) => {
    const post = await fetch(`${origin}${ASSET_REGISTRY_ROUTE}`, { method: 'POST' });
    assert.equal(post.status, 405);
    const head = await fetch(`${origin}${ASSET_REGISTRY_ROUTE}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    const root = await fetch(`${origin}/`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-type') ?? '', /text\/html/);
  });
});

test('the route is a pure filesystem read: no network/provider modules and no env-gated spend path', () => {
  const source = readFileSync(resolve(REPO_ROOT, 'net/registryApi.mjs'), 'utf8');
  // The base URL below is only used to parse the REQUEST path (a local placeholder, never dialled);
  // the real assertion is that nothing here performs an outbound call or touches a provider credential.
  assert.doesNotMatch(source, /fetch\(/, 'no outbound network call');
  assert.doesNotMatch(source, /meshy/i, 'no coupling to the paid Meshy lane');
  assert.doesNotMatch(source, /process\.env/, 'no credential/env coupling of any kind');
  assert.doesNotMatch(source, /from ['"]node:https?['"]/, 'no HTTP client module import');
});

test('computeRuntimeAvailability is a pure function: injected existence check, no real disk I/O required', () => {
  const record = {
    asset_id: 'fixture.present',
    custody: 'IN_GIT',
    source: { path: 'public/assets/fixture.glb' },
    custody_locations: [{ kind: 'GIT', repo_path: 'public/assets/fixture.glb', git_ref: 'main' }],
  };
  const present = computeRuntimeAvailability(record, () => true, '/repo');
  assert.equal(present.loadable, true);
  assert.equal(present.runtimeUrl, '/assets/fixture.glb');

  const absent = computeRuntimeAvailability(record, () => false, '/repo');
  assert.equal(absent.loadable, false);
  assert.match(absent.reason, /not present in this checkout|declared path not found/);
});

test('a path traversal or non-public path is never treated as servable, no matter what exists on disk', () => {
  const traversal = computeRuntimeAvailability({
    asset_id: 'fixture.hostile',
    custody: 'IN_GIT',
    source: { path: 'public/../server.mjs' },
    custody_locations: [],
  }, () => true, '/repo');
  assert.equal(traversal.loadable, false);

  const outsidePublic = computeRuntimeAvailability({
    asset_id: 'fixture.outside',
    custody: 'IN_DRIVE',
    source: { path: 'docs/asset-production/asset-registry-v1.json' },
    custody_locations: [],
  }, () => true, '/repo');
  assert.equal(outsidePublic.loadable, false);
  assert.match(outsidePublic.reason, /outside public\//);
});

test('every record in the augmented registry actually exists at REPO_ROOT for its declared loadable URL', async () => {
  const augmented = await loadAugmentedRegistry();
  for (const record of augmented.records) {
    if (!record.runtime_availability.loadable) continue;
    const absolute = resolve(REPO_ROOT, 'public', record.runtime_availability.runtimeUrl.replace(/^\//, ''));
    assert.ok(existsSync(absolute), `${record.asset_id} claims loadable but ${absolute} is missing`);
  }
});
