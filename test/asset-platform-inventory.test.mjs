import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repoRoot, 'docs/asset-production/asset-platform-inventory.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const items = manifest.items;

// docs/asset-production/asset-platform-inventory.json is the consolidation's "nothing got lost"
// proof: for PRs #26-#29 it is the only durable record of what an expensive candidate is, what it
// cost, where its bytes are and how to get them back. A silent edit that breaks it would not look
// like a failure until someone needed an asset and could not find it. So it is tested like code.

const DISPOSITIONS = new Set([
  'PRESERVE_NOW', 'PRESERVE_EXTERNAL_ARCHIVE', 'PRESERVE_LATER',
  'SUPERSEDED_BY', 'HISTORICAL_ONLY', 'DO_NOT_PORT', 'UNKNOWN_NEEDS_REVIEW',
]);

const inRepoPath = (item) => (item.proposed_destination ?? '').split(' ')[0];

test('the manifest is a well-formed inventory with no duplicate identities', () => {
  assert.equal(manifest.schema, 'galaquest.asset-platform-inventory/1');
  assert.ok(items.length > 0);

  const ids = items.map((item) => item.item_id);
  const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  assert.deepEqual(duplicates, [], 'each item_id must identify exactly one thing');

  const oids = items.map((item) => item.git_blob_oid).filter(Boolean);
  const dupOids = [...new Set(oids.filter((oid, i) => oids.indexOf(oid) !== i))];
  assert.deepEqual(dupOids, [], 'a blob recorded twice means the byte totals are double-counted');
});

test('every item carries a disposition from the legend and a written reason', () => {
  for (const item of items) {
    assert.ok(DISPOSITIONS.has(item.disposition),
      `${item.item_id} has unknown disposition ${item.disposition}`);
    assert.ok(typeof item.reason === 'string' && item.reason.trim().length > 20,
      `${item.item_id} needs a real written reason, not a placeholder`);
    assert.ok(Object.keys(manifest.disposition_legend).includes(item.disposition));
  }
});

test('no candidate is recorded as shipping', () => {
  // The whole bank is candidate-only. Promotion is a deliberate, separate, owner-gated act, and a
  // manifest edit is not it.
  for (const item of items) {
    assert.notEqual(item.status, 'shipping',
      `${item.item_id} claims shipping status; promotion is not done by editing this file`);
    assert.ok(['candidate', 'reference'].includes(item.status), `${item.item_id} has status ${item.status}`);
  }
});

test('the seven gear families are complete and their task IDs are unique', () => {
  const gear = items.filter((item) => item.category === 'provider-task/gear-candidate');
  assert.equal(gear.length, 35, 'seven families x five slots');

  const families = [...new Set(gear.map((item) => item.asset_family))].sort();
  assert.deepEqual(families,
    ['Behemoth', 'Embermaw', 'Frostfang', 'Stormwing', 'Sunlion', 'Voidstar', 'Wildthorn']);

  for (const family of families) {
    const slots = gear.filter((item) => item.asset_family === family).map((item) => item.asset_slot).sort();
    assert.deepEqual(slots, ['helmet', 'lower_kit', 'shield', 'upper_armor', 'weapon'],
      `${family} is missing a slot`);
  }

  // These IDs are the only handle on 35 generated assets that were never downloaded.
  const taskIds = gear.flatMap((item) => item.provider_task_ids.map((task) => task.id));
  assert.equal(taskIds.length, 70, 'each piece keeps both its concept and its image-to-3d task');
  assert.equal(new Set(taskIds).size, 70, 'a duplicated task ID means one piece has lost its handle');
});

test('Enemy Wave 1 keeps thirteen distinct identities with both task IDs each', () => {
  const enemies = items.filter((item) => item.category === 'provider-task/enemy-candidate');
  assert.equal(enemies.length, 13);

  const imageIds = enemies.flatMap((item) => item.provider_task_ids.map((task) => task.id));
  const rigIds = enemies.map((item) => item.rig_task_id);
  assert.equal(new Set(imageIds).size, 13);
  assert.equal(new Set(rigIds).size, 13);
  assert.ok(rigIds.every(Boolean), 'a rig task ID is how the free walk/run outputs are recovered');

  for (const enemy of enemies) {
    assert.match(enemy.visual_acceptance, /UNKNOWN/, 'structural PASS is not visual acceptance');
    assert.match(enemy.runtime_acceptance, /NOT_PROMOTED/);
  }
});

test('every binary kept in the tree still hashes to its recorded identity', () => {
  let verified = 0;

  for (const item of items) {
    if (item.disposition !== 'PRESERVE_NOW') continue;
    const relPath = inRepoPath(item);
    if (!relPath || !item.sha256) continue;

    const absolutePath = resolve(repoRoot, ...relPath.split('/'));
    assert.ok(existsSync(absolutePath),
      `${item.item_id} is PRESERVE_NOW but ${relPath} is not in the tree`);

    const bytes = readFileSync(absolutePath);
    assert.equal(bytes.length, item.size_bytes, `${relPath} size drifted from the manifest`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256,
      `${relPath} no longer hashes to its recorded SHA-256. If the asset was legitimately `
      + 're-exported, the owner-locked Forge fit was authored against the OLD bytes and must be '
      + 're-confirmed visually before the manifest is updated.');
    verified += 1;
  }

  assert.ok(verified >= 2, 'the Dawnwarden reference pair must actually be checked');
});

test('externally archived bytes have not crept back into the served tree', () => {
  // The consolidation exists partly to keep ~256 MB of raw candidates out of public/assets/, which
  // is otherwise ~6 MB. Without this check, one well-meaning `git add` puts it all back.
  const strays = [];

  for (const item of items) {
    if (item.disposition !== 'PRESERVE_EXTERNAL_ARCHIVE') continue;
    const absolutePath = resolve(repoRoot, ...item.source_path.split('/'));
    if (existsSync(absolutePath)) strays.push(`${item.source_path} (${item.size_bytes} bytes)`);
  }

  assert.deepEqual(strays, [], [
    'These are recorded as living in the external source archive but are present in the tree.',
    'Either they were re-committed by mistake, or the manifest disposition is now wrong.',
  ].join(' '));
});

test('archive-pending items name a real destination instead of hand-waving', () => {
  for (const item of items) {
    if (!String(item.archive_status ?? '').startsWith('PENDING')) continue;
    assert.ok(item.archive_folder, `${item.item_id} is pending upload with no destination folder`);
    assert.match(item.archive_url ?? '', /^https:\/\/drive\.google\.com\/drive\/folders\//,
      `${item.item_id} must point at a real created folder, never an invented or absent URL`);
  }
});

test('a preserved binary can still be recovered from its unclosed source branch', () => {
  assert.match(manifest.recovery_contract.command, /git cat-file -p <git_blob_oid>/);

  for (const item of items) {
    if (!item.git_blob_oid) continue;
    assert.match(item.git_blob_oid, /^[0-9a-f]{40}$/, `${item.item_id} has a malformed blob OID`);
    assert.ok(item.source_ref, `${item.item_id} has bytes but no branch to fetch them from`);
    assert.match(item.sha256 ?? '', /^[0-9a-f]{64}$/, `${item.item_id} has a blob but no usable checksum`);
  }
});

test('the recorded totals match the items they claim to summarise', () => {
  const sum = (predicate) => items.filter(predicate)
    .reduce((total, item) => total + (item.size_bytes || 0), 0);

  assert.equal(manifest.totals.items, items.length);
  assert.equal(manifest.totals.gear_candidate_tasks,
    items.filter((item) => item.category === 'provider-task/gear-candidate').length);
  assert.equal(manifest.totals.bytes_to_external_archive,
    sum((item) => item.disposition === 'PRESERVE_EXTERNAL_ARCHIVE'));
  assert.equal(manifest.totals.bytes_kept_in_git,
    sum((item) => item.disposition === 'PRESERVE_NOW' && item.source_pr !== null));

  // The comparison that justified the split in the first place.
  const assetsRoot = resolve(repoRoot, 'public/assets');
  assert.ok(statSync(assetsRoot).isDirectory());
  assert.ok(manifest.totals.bytes_to_external_archive > manifest.totals.main_public_assets_bytes_before * 10,
    'if the archived bulk is no longer an order of magnitude larger than the whole served tree, '
    + 'the rationale recorded in the consolidation brief needs revisiting');
});

test('every code surface the manifest claims was ported is actually in the tree', () => {
  // This is the zero-omissions proof, made mechanical. The manifest asserts that 50 non-binary
  // surfaces from #26/#27/#28/#29 came across; if one silently did not, the claim is false and the
  // consolidation has lost work without saying so.
  const surfaces = items.filter((item) => String(item.item_id).startsWith('surface:'));
  assert.equal(surfaces.length, 50);

  const perPr = surfaces.reduce((counts, item) => {
    counts[item.source_pr] = (counts[item.source_pr] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(perPr, { 26: 20, 27: 16, 28: 7, 29: 7 },
    'these are the exact non-binary changed-file counts of each source PR against its own base');

  const missing = surfaces
    .filter((item) => !existsSync(resolve(repoRoot, ...item.proposed_destination.split('/'))))
    .map((item) => item.proposed_destination);
  assert.deepEqual(missing, [], 'a surface recorded as ported must exist at its destination');
});

test('PR #11 is dispositioned with reasons rather than silently dropped', () => {
  const salvage = manifest.pr_11_salvage;
  assert.ok(salvage, 'the oldest branch still needs an explicit written verdict');
  assert.equal(salvage.head, '40b95c8101135b1503147203924b5f8212b5b2bd');

  for (const surface of salvage.surfaces) {
    assert.ok(['DO_NOT_PORT', 'HISTORICAL_ONLY', 'SUPERSEDED_BY', 'PRESERVE_LATER']
      .includes(surface.disposition), `${surface.path} has an unusable disposition`);
    assert.ok(surface.reason.length > 40, `${surface.path} needs a real reason`);
  }

  // The specific trap: PR #11's Meshy clients look like salvage and are actually less safe than
  // what main already has. Nothing should ever quietly cherry-pick them back.
  const client = salvage.surfaces.find((s) => s.path === 'tools/meshy/image_to_3d.mjs');
  assert.equal(client.disposition, 'DO_NOT_PORT');
  assert.match(client.reason, /REGRESSION/);
});

test('the provider-side gear bank is not quietly upgraded to verified', () => {
  const gear = items.filter((item) => item.category === 'provider-task/gear-candidate');
  for (const item of gear) {
    assert.equal(item.provider_state_reconciled_verified_here, false,
      `${item.item_id} must not claim provider verification the consolidation never performed`);
    assert.equal(item.sha256, null, 'no GLB from this batch was ever downloaded');
    assert.equal(item.git_blob_oid, null);
  }
  assert.match(manifest.no_spend_declaration, /NO provider calls/i);
});
