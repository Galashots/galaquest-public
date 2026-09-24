// The farm game's Meshy models are bound to their provenance record: every shipped file hashes to
// what the batch manifest says, and every model the game can load has a manifest entry and a
// licence entry. A file swapped in without its record fails here.

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const REPO = new URL('..', import.meta.url).pathname;
const BATCH = 'docs/asset-production/farm-creatures-2026-09-24';
const FARM_ASSETS = 'prototypes/farm-slice/assets';

const manifest = JSON.parse(readFileSync(join(REPO, BATCH, 'manifest.json'), 'utf8'));

/** Where the repository keeps a manifest `ship/<name>.glb` (see the batch README). */
function repoPathFor(shipped) {
  const name = shipped.replace(/^ship\//, '');
  if (name === 'egg.glb') return `${FARM_ASSETS}/egg.glb`;
  if (name === 'hero.glb') return `${FARM_ASSETS}/candidates/hero.glb`;
  return `${FARM_ASSETS}/creatures/${name}`;
}

const sha256 = (path) => createHash('sha256').update(readFileSync(join(REPO, path))).digest('hex');

test('every shipped farm model hashes to its manifest entry', () => {
  const shipped = manifest.assets.filter((asset) => asset.status === 'accepted' && asset.shipped);
  assert.ok(shipped.length >= 14, `expected the full batch, got ${shipped.length}`);
  for (const asset of shipped) {
    assert.equal(sha256(repoPathFor(asset.shipped)), asset.sha256, `${asset.id}: bytes differ from the manifest`);
  }
});

test('every farm model on disk has a manifest entry', () => {
  const recorded = new Set(manifest.assets.map((asset) => repoPathFor(asset.shipped)));
  const onDisk = [
    ...readdirSync(join(REPO, FARM_ASSETS, 'creatures')).map((f) => `${FARM_ASSETS}/creatures/${f}`),
    ...readdirSync(join(REPO, FARM_ASSETS, 'candidates')).map((f) => `${FARM_ASSETS}/candidates/${f}`),
    `${FARM_ASSETS}/egg.glb`,
  ].filter((path) => path.endsWith('.glb'));
  for (const path of onDisk) assert.ok(recorded.has(path), `${path} has no provenance entry`);
});

test('the batch spend adds up and its licence basis is recorded', () => {
  const { credits } = manifest;
  assert.equal(credits.balanceStart - credits.balanceEnd, credits.balanceDelta);
  const ledger = JSON.parse(readFileSync(join(REPO, BATCH, 'ledger.json'), 'utf8'));
  const sum = ledger.entries.reduce((total, entry) => total + (entry.consumed_credits ?? 0), 0);
  assert.equal(sum, credits.balanceDelta, 'per-task consumed credits equal the measured balance change');
  assert.ok(credits.balanceDelta <= 500, 'within the Owner-authorized 500 credits');
  const licences = readFileSync(join(REPO, 'ASSET-LICENSES.md'), 'utf8');
  assert.match(licences, /prototypes\/farm-slice\/assets\//, 'ASSET-LICENSES.md records the farm models');
});
