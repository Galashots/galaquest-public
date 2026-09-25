// The farm game's Meshy models are bound to their provenance record: every shipped file hashes to
// what the batch manifest says, and every model the game can load has a manifest entry and a
// licence entry. A file swapped in without its record fails here.

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

const shipped = manifest.assets.filter((asset) => asset.status === 'accepted' && asset.shipped);

test('every shipped farm model hashes to its manifest entry, and held ones stay out of the game', () => {
  const held = manifest.assets.filter((asset) => asset.status === 'held');
  assert.equal(shipped.length + held.length, manifest.assets.length, 'each asset is either shipped or held');
  assert.ok(shipped.length >= 11, `expected the batch, got ${shipped.length}`);
  for (const asset of shipped) {
    assert.equal(sha256(repoPathFor(asset.shipped)), asset.sha256, `${asset.id}: bytes differ from the manifest`);
  }
  for (const asset of held) {
    assert.ok(asset.held?.reason && asset.held?.recover, `${asset.id}: held without a reason and recovery path`);
    assert.ok(!existsSync(join(REPO, repoPathFor(asset.shipped))), `${asset.id} is held but on disk`);
  }
});

test('every farm model on disk has a shipped manifest entry', () => {
  const recorded = new Set(shipped.map((asset) => repoPathFor(asset.shipped)));
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
  const start = licences.indexOf('## Farm game creatures');
  assert.ok(start >= 0, 'ASSET-LICENSES.md has the farm models section');
  const section = licences.slice(start, licences.indexOf('\n## ', start + 1));
  assert.match(section, /prototypes\/farm-slice\/assets\//, 'it names the farm models');
  assert.match(section, /\*\*paid Meshy plan\*\*/, 'it records the paid-plan basis');
  assert.match(section, /\*\*not\*\* CC0/, 'it says the models are not CC0');
});
