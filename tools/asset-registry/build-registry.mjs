import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const historyPath = join(root, 'docs/asset-production/asset-platform-inventory.json');
const outPath = join(root, 'docs/asset-production/asset-registry-v1.json');
const gates = () => ({ provenance: 'UNKNOWN', structural: 'UNKNOWN', materials: 'UNKNOWN', rig: 'UNKNOWN', animation: 'UNKNOWN', performance: 'UNKNOWN', visual: 'UNKNOWN', runtime: 'UNKNOWN', owner: 'UNKNOWN' });
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
const slug = (p) => `runtime_${p.replaceAll('\\', '_').replaceAll('/', '_').replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
const history = JSON.parse(readFileSync(historyPath, 'utf8'));
const records = [];
const seen = new Set();
const add = (record) => { if (!seen.has(record.asset_id)) { seen.add(record.asset_id); records.push(record); } };

for (const abs of files(join(root, 'public/assets'))) {
  const path = relative(root, abs).replaceAll('\\', '/');
  const ext = path.split('.').pop().toLowerCase();
  const isCandidate = path.includes('/candidates/');
  const record = { asset_id: slug(path), display_name: path.split('/').pop(), asset_kind: ext === 'glb' ? 'model' : 'texture', lifecycle: isCandidate ? 'QUALIFYING' : 'PRODUCTION', custody: 'IN_GIT', recoverability: 'VERIFIED_FROM_GIT', source: { path, sha256: sha256(abs), size_bytes: statSync(abs).size, authority: 'public-main' }, provider: { task_ids: [], context_alias: null }, parent_asset_id: null, derivative_of: null, qualification_gates: gates(), evidence_refs: [`git:${path}`], notes: isCandidate ? 'Candidate only; not runtime promotion.' : 'Current public runtime asset; gates remain independent.' };
  record.qualification_gates.provenance = 'PASS'; record.qualification_gates.structural = ext === 'glb' ? 'PASS' : 'N/A'; record.qualification_gates.runtime = isCandidate ? 'UNKNOWN' : 'PASS'; add(record);
}

for (const item of history.items) {
  const isProvider = item.category.startsWith('provider-task/'); const isBinary = item.category.startsWith('binary/'); if (!isProvider && !isBinary) continue;
  const path = item.source_path?.startsWith('public/') ? item.source_path : null; const inCurrentTree = path && existsSync(join(root, path));
  const taskInputs = [...(item.provider_task_ids ?? []), ...(item.rig_task_id ? [{ id: item.rig_task_id, kind: 'rigging' }] : [])];
  const providerTasks = taskInputs.map((t) => ({ task_id: t.id, task_kind: t.kind, provider_status: 'HTTP_404_TASK_NOT_FOUND', consumed_credits: null, output_handles: [], download_available: false, download_attempt_result: 'not-attempted-no-current-task', recoverable_without_spend: false, notes: 'GET-only reconciliation: unavailable in current provider context; not classified as deleted.' }));
  const rec = { asset_id: item.item_id, display_name: item.item_id, asset_kind: isProvider && item.category.includes('enemy') ? 'character' : isProvider ? 'gear' : 'model', lifecycle: isProvider ? 'GENERATED' : 'QUALIFYING', custody: isProvider ? 'PROVIDER_ONLY' : (item.archive_status === 'ARCHIVED_VERIFIED' ? 'IN_DRIVE' : (inCurrentTree ? 'IN_GIT' : 'UNKNOWN')), recoverability: isProvider ? 'UNAVAILABLE_CURRENT_PROVIDER_CONTEXT' : (item.archive_status === 'ARCHIVED_VERIFIED' ? 'VERIFIED_FROM_DRIVE' : (inCurrentTree ? 'VERIFIED_FROM_GIT' : 'UNKNOWN')), source: { path: path ?? item.source_path ?? null, sha256: item.sha256 ?? null, size_bytes: item.size_bytes ?? null, authority: 'historical-asset-platform-inventory' }, provider: { task_ids: providerTasks, context_alias: isProvider ? 'historical-meshy-context' : null }, parent_asset_id: null, derivative_of: null, qualification_gates: gates(), evidence_refs: [`historical-inventory:${item.item_id}`], notes: item.reason ?? 'Historical candidate identity preserved without promoting it.' };
  rec.qualification_gates.provenance = item.provider_task_ids?.length || item.sha256 ? 'PASS' : 'UNKNOWN'; rec.qualification_gates.structural = inCurrentTree && path?.endsWith('.glb') ? 'PASS' : 'UNKNOWN'; if (item.item_id.includes('wren') || item.item_id.includes('bramble')) rec.notes += ' Archived bytes are external to the current public tree.'; add(rec);
}

add({ asset_id: 'frog-meshy-download-v1', display_name: 'Frog local Meshy download', asset_kind: 'character', lifecycle: 'QUALIFYING', custody: 'LOCAL_ONLY', recoverability: 'UNKNOWN', source: { path: null, sha256: '8fbb30b04883f8e79cdd51a8b2bb6968cbdf5144aec5246de34db42be3381355', size_bytes: 5956692, authority: 'local-evidence-2026-08-25' }, provider: { task_ids: [], context_alias: null }, parent_asset_id: null, derivative_of: null, qualification_gates: { ...gates(), provenance: 'UNKNOWN', structural: 'PASS', rig: 'PASS', animation: 'PASS' }, evidence_refs: ['local-evidence:frog-24-joint-rig', 'local-evidence:frog-local-idle-hop-export'], notes: 'Downloads/staging custody is deliberately not durable repository custody; no production promotion.' });
add({ asset_id: 'fox-meshy-download-v1', display_name: 'Fox local Meshy download', asset_kind: 'character', lifecycle: 'QUALIFYING', custody: 'LOCAL_ONLY', recoverability: 'UNKNOWN', source: { path: null, sha256: 'e346e5f26b761045e14bfeab07b52cb0f6c18cd36f3e93995e02bd1b9d2b44e2', size_bytes: 5752116, authority: 'local-evidence-2026-08-25' }, provider: { task_ids: [], context_alias: null }, parent_asset_id: null, derivative_of: null, qualification_gates: { ...gates(), provenance: 'UNKNOWN', structural: 'PASS', rig: 'PASS', visual: 'FAIL' }, evidence_refs: ['local-evidence:fox-scale-bind-diagnosis'], notes: 'Blank render classified as scale/bind-transform defect; repair deferred.' });

const reconciliation_records = records.flatMap((record) => record.provider.task_ids.filter((task) => ['image-to-3d', 'rigging'].includes(task.task_kind)).map((task) => ({ asset_id: record.asset_id, ...task }))).concat([
  { asset_id: 'provider-task-unresolved-1', task_id: 'fc65f158-cd42-4188-9ab1-c54a9befef1e', task_kind: 'image-to-3d', provider_status: 'SUCCEEDED', consumed_credits: 0, output_handles: ['glb'], download_available: false, download_attempt_result: 'HTTP_403_STALE_SIGNED_URL', recoverable_without_spend: false, notes: 'Task metadata remains readable; repeated GET returns same expired CloudFront URL.' },
  { asset_id: 'provider-task-unresolved-2', task_id: '3d0a6ad8-27dd-47a3-a847-baa35d669505', task_kind: 'image-to-3d', provider_status: 'SUCCEEDED', consumed_credits: 0, output_handles: ['glb'], download_available: false, download_attempt_result: 'HTTP_403_STALE_SIGNED_URL', recoverable_without_spend: false, notes: 'Task metadata remains readable; repeated GET returns same expired CloudFront URL.' },
]);
const registry = { schema: 'galaquest.asset-registry/1', generated_utc: '2026-08-25', authority: 'current canonical asset inventory', base_sha: 'b7abb7113386f1ce37d65d460f2475007d7fcb02', historical_sources: [{ path: 'docs/asset-production/asset-platform-inventory.json', role: 'historical consolidation evidence; immutable authority' }, { path: 'docs/asset-production/ENEMY_WAVE_1_PROVENANCE.json', role: 'historical enemy provider provenance' }], provider_reconciliation: { method: 'GET-only direct REST reconciliation; no POST operations', historical_task_records: 61, task_not_found: 61, stale_signed_url_tasks: 2, status: 'current-context evidence only', no_paid_operations: true, records: reconciliation_records }, animation_lab_interface: { consumer: 'Package B Animation Lab v1', required_evidence: ['source asset and target rig IDs', 'rest-pose/skeleton compatibility report', 'clip inventory and root-motion report', 'visual playback evidence', 'export hash and qualification gates'], exclusions: ['authoring implementation', 'retarget promotion', 'runtime integration'] }, records: records.sort((a, b) => a.asset_id.localeCompare(b.asset_id)) };
writeFileSync(outPath, `${JSON.stringify(registry, null, 2)}\n`); console.log(`wrote ${registry.records.length} records to ${outPath}`);
