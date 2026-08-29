// Studio Library's client-side filtering (#92 STUDIO-V2A): pure functions over registry records,
// pinned against the REAL canonical registry (not a hand-typed fixture rack) so this test would
// fail if a future edit reintroduced a duplicated/second catalogue.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assetId,
  filterAssets,
  filterOptions,
  findAssetById,
  summarizeAsset,
} from '../public/src/studio/registryLibrary.js';

const root = resolve(import.meta.dirname, '..');
const registry = JSON.parse(readFileSync(resolve(root, 'docs/asset-production/asset-registry-v1.json'), 'utf8'));
const records = registry.records;

test('the library is the registry itself: filtering never invents an id the file does not have', () => {
  const canonicalIds = new Set(records.map((r) => r.asset_id));
  const filtered = filterAssets(records, {});
  assert.equal(filtered.length, records.length);
  for (const record of filtered) assert.ok(canonicalIds.has(assetId(record)));
});

test('selection is by stable asset_id, never by a provider filename or display label', () => {
  const hero = findAssetById(records, 'hero.base');
  assert.ok(hero);
  assert.equal(hero.asset_id, 'hero.base');
  // The lookup key really is asset_id -- a display name or provider filename must not resolve.
  assert.equal(findAssetById(records, hero.display_name), null);
  assert.equal(findAssetById(records, 'nonexistent.asset.id'), null);
});

test('kind filter matches asset_kind exactly', () => {
  const gearOnly = filterAssets(records, { kind: 'gear' });
  assert.ok(gearOnly.length > 0);
  assert.ok(gearOnly.every((r) => r.asset_kind === 'gear'));
});

test('facet filter matches one entry of facets[]', () => {
  const heroFacet = filterAssets(records, { facet: 'hero' });
  assert.ok(heroFacet.length > 0);
  assert.ok(heroFacet.every((r) => r.facets.includes('hero')));
});

test('lifecycle, nextAction and custody filters compose (AND, not OR)', () => {
  const combo = filterAssets(records, { lifecycle: 'PRODUCTION', custody: 'IN_GIT' });
  assert.ok(combo.every((r) => r.lifecycle === 'PRODUCTION' && r.custody === 'IN_GIT'));
  assert.ok(combo.length < records.length, 'sanity: the combo is actually a narrower slice');
});

test('free-text search matches asset_id, display name, and facets, case-insensitively', () => {
  const byId = filterAssets(records, { query: 'HERO.BASE' });
  assert.ok(byId.some((r) => r.asset_id === 'hero.base'));
  const byFacet = filterAssets(records, { query: 'lantern' });
  assert.ok(byFacet.length > 0);
});

test('filterOptions derives every dropdown value from the data, never a hand-typed enum', () => {
  const options = filterOptions(records);
  assert.ok(options.kinds.includes('character'));
  assert.ok(options.kinds.includes('gear'));
  assert.deepEqual(options.kinds, [...options.kinds].sort());
  for (const record of records) {
    assert.ok(options.lifecycles.includes(record.lifecycle));
    assert.ok(options.custodies.includes(record.custody));
  }
});

test('summarizeAsset reads the live runtime_availability augmentation truthfully', () => {
  const loadableRecord = { ...records.find((r) => r.asset_id === 'hero.base'), runtime_availability: { loadable: true, runtimeUrl: '/assets/hero/hero.glb', reason: null } };
  const summary = summarizeAsset(loadableRecord);
  assert.equal(summary.assetId, 'hero.base');
  assert.equal(summary.loadable, true);
  assert.equal(summary.runtimeUrl, '/assets/hero/hero.glb');
  assert.equal(summary.unavailableReason, null);

  const refusedRecord = { ...records.find((r) => r.asset_id === 'boneguard-raider-v1'), runtime_availability: { loadable: false, runtimeUrl: null, reason: 'recorded on git ref(s) origin/feat/enemy-asset-wave-1, not present in this checkout' } };
  const refusedSummary = summarizeAsset(refusedRecord);
  assert.equal(refusedSummary.loadable, false);
  assert.equal(refusedSummary.runtimeUrl, null);
  assert.match(refusedSummary.unavailableReason, /origin\/feat\/enemy-asset-wave-1/);
});

test('a record with no runtime_availability at all reports loadability as UNKNOWN, never a guessed true/false', () => {
  const unaugmented = records.find((r) => r.asset_id === 'hero.base');
  assert.equal('runtime_availability' in unaugmented, false, 'sanity: canonical file itself is not pre-augmented');
  const summary = summarizeAsset(unaugmented);
  assert.equal(summary.loadable, 'UNKNOWN');
  assert.equal(summary.runtimeUrl, null);
});
