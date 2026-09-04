import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const historyPath = join(root, 'docs/asset-production/asset-platform-inventory.json');
const evidencePath = join(root, 'docs/asset-production/asset-registry-v1.evidence.json');
const structuralAuditPath = join(root, 'docs/asset-production/ENEMY_WAVE_1_STRUCTURAL_AUDIT.json');
const intakePath = join(root, 'docs/asset-production/ASSET_INTAKE_2026-08-29.json');
const animationRecoveryPath = join(root, 'docs/asset-production/HDUS9C_ANIMATION_SOURCE_RECOVERY.json');
const outPath = join(root, 'docs/asset-production/asset-registry-v1.json');
const supportedExtensions = new Set(['.glb', '.jpg', '.jpeg', '.png', '.webp']);
const gateNames = ['provenance', 'structural', 'materials', 'rig', 'animation', 'performance', 'visual', 'runtime', 'owner'];

const history = JSON.parse(readFileSync(historyPath, 'utf8'));
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
const structuralAudit = JSON.parse(readFileSync(structuralAuditPath, 'utf8'));
const intake = JSON.parse(readFileSync(intakePath, 'utf8'));
const animationRecovery = JSON.parse(readFileSync(animationRecoveryPath, 'utf8'));
const records = [];
const seen = new Set();

const readBytes = (path) => readFileSync(path);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gitBlobOid = (bytes) => createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
const supportedFiles = () => files(join(root, 'public/assets')).filter((path) => supportedExtensions.has(extname(path).toLowerCase()));
const isAssetSourcePath = (path) => Boolean(path) && supportedExtensions.has(extname(path).toLowerCase());
const isGenerationTaskKind = (kind) => kind === 'image-to-3d' || kind === 'rigging';
const gate = (status = 'UNKNOWN', evidenceRefs = []) => ({ status, evidence_refs: evidenceRefs });
const gates = () => Object.fromEntries(gateNames.map((name) => [name, gate()]));
const metric = (value = 'UNKNOWN') => value;
const metrics = (sizeBytes, kind = 'model') => ({
  file_size_bytes: Number.isInteger(sizeBytes) ? metric(sizeBytes) : metric(),
  mesh_count: metric(kind === 'texture' ? 'N/A' : 'UNKNOWN'),
  primitive_count: metric(kind === 'texture' ? 'N/A' : 'UNKNOWN'),
  vertex_count: metric(kind === 'texture' ? 'N/A' : 'UNKNOWN'),
  triangle_count: metric(kind === 'texture' ? 'N/A' : 'UNKNOWN'),
  material_count: metric(kind === 'texture' ? 'N/A' : 'UNKNOWN'),
  skin_count: metric(kind === 'texture' ? 'N/A' : 'UNKNOWN'),
  joint_count: metric(kind === 'texture' ? 'N/A' : 'UNKNOWN'),
  animation_clip_count: metric(kind === 'texture' ? 'N/A' : 'UNKNOWN'),
});
const rights = (provenanceStatus = 'UNKNOWN', provenanceEvidence = []) => ({
  provenance: { status: provenanceStatus, value: null, evidence_refs: provenanceEvidence },
  license: { status: 'UNKNOWN', value: null, evidence_refs: [] },
  usage_rights: { status: 'UNKNOWN', value: null, evidence_refs: [] },
});
const inferredFacets = (record) => {
  const id = record.asset_id;
  const values = [];
  if (record.provider?.task_ids?.length || record.source?.authority?.includes('meshy')) values.push('meshy');
  if (id.startsWith('prop.village.')) values.push('village', 'world-prop');
  if (id === 'world.keeper' || id.startsWith('wren-ranger') || id.startsWith('npc.')) values.push('npc');
  if (id.startsWith('frog-') || id.startsWith('fox-')) values.push('pet', 'starter-pet');
  if (id.startsWith('hero.')) values.push('hero');
  if (id === 'enemy.beacon_warden') values.push('beacon', 'boss', 'boss-setpiece', 'enemy');
  else if (record.asset_kind === 'character' && (id === 'enemy.wolf' || /raider|kobold|ogre|reaper|juggernaut|marauder|scrapper|warden|colossus|orc|knight|stalker|overlord/.test(id))) values.push('enemy');
  return values;
};
const defaultNextAction = (record) => ({
  PRODUCTION: 'NONE', QUALIFIED: 'INTEGRATE_NEXT', QUALIFYING: 'QUALIFY_NEXT', GENERATED: 'QUALIFY_NEXT',
  SOURCE_ONLY: 'HOLD', PLANNED: 'HOLD', REJECTED: 'ARCHIVE_ONLY', SUPERSEDED: 'ARCHIVE_ONLY', HISTORICAL: 'ARCHIVE_ONLY',
}[record.lifecycle] ?? 'NONE');
const add = (record) => {
  if (seen.has(record.asset_id)) throw new Error(`duplicate asset_id: ${record.asset_id}`);
  seen.add(record.asset_id);
  records.push({
    ...record,
    facets: [...new Set([...(record.facets ?? []), ...inferredFacets(record)])].sort(),
    next_action: record.next_action ?? defaultNextAction(record),
    aliases: [...new Set(record.aliases ?? [])].sort(),
    related_asset_ids: [...new Set(record.related_asset_ids ?? [])].sort(),
  });
};
const taskInput = (task) => typeof task === 'string' ? { id: task, kind: 'unknown' } : task;
const taskObservation = evidence.provider_reconciliation.historical_inventory_task_observation;
const observedTask = (task) => ({
  task_id: task.id,
  task_kind: task.kind ?? 'unknown',
  provider_status: taskObservation.provider_status,
  consumed_credits: taskObservation.consumed_credits,
  output_handles: taskObservation.output_handles,
  download_available: taskObservation.download_available,
  download_attempt_result: taskObservation.download_attempt_result,
  recoverable_without_spend: taskObservation.recoverable_without_spend,
  notes: taskObservation.notes,
  evidence_ref: `registry-evidence:${evidence.provider_reconciliation.observed_utc}`,
});
const currentRuntimePaths = new Set(evidence.runtime_assets.map((asset) => asset.path));
const structuralByFilename = new Map(structuralAudit.entries.map((entry) => [entry.filename, entry]));
const supersededAliasOf = new Map([
  ['dawnwarden-helmet-v1', 'gear.candidate.dawnwarden-helmet-v1'],
  ['dawnwarden-sword-v1', 'gear.candidate.dawnwarden-sword-v1'],
  ['sword_wildwood_w1a', 'gear.candidate.wildwood-sword-w1a'],
]);
const clipParentOf = new Map([
  ['bramble-stalker-v1-run', 'bramble-stalker-v1'], ['bramble-stalker-v1-walk', 'bramble-stalker-v1'],
  ['wren-ranger-v1-run', 'wren-ranger-v1'], ['wren-ranger-v1-walk', 'wren-ranger-v1'],
]);

const scannedRuntimePaths = supportedFiles().map((abs) => relative(root, abs).replaceAll('\\', '/')).sort();
const declaredRuntimePaths = [...currentRuntimePaths].sort();
if (JSON.stringify(scannedRuntimePaths) !== JSON.stringify(declaredRuntimePaths)) {
  const undeclared = scannedRuntimePaths.filter((path) => !currentRuntimePaths.has(path));
  const missing = declaredRuntimePaths.filter((path) => !scannedRuntimePaths.includes(path));
  throw new Error(`runtime asset identity map mismatch; undeclared=${undeclared.join(',') || 'none'} missing=${missing.join(',') || 'none'}`);
}

for (const asset of evidence.runtime_assets) {
  const abs = join(root, asset.path);
  if (!existsSync(abs)) throw new Error(`declared runtime asset missing: ${asset.path}`);
  const bytes = readBytes(abs);
  const isCandidate = asset.lifecycle === 'QUALIFYING';
  const recordGates = gates();
  if (asset.asset_kind === 'texture') recordGates.structural = gate('N/A');
  // An asset introduced after the evidence snapshot cannot be recovered from the shared snapshot
  // commit, so it declares its own immutable per-asset ref. Defaulting to the snapshot ref for an
  // asset that did not exist there would record a recovery coordinate that resolves to nothing.
  const assetGitRef = asset.git_ref ?? evidence.snapshot.runtime_git_ref;
  add({
    asset_id: asset.asset_id,
    display_name: asset.display_name,
    asset_kind: asset.asset_kind,
    lifecycle: asset.lifecycle,
    custody: 'IN_GIT',
    recoverability: 'VERIFIED_FROM_GIT',
    custody_locations: [{
      kind: 'GIT',
      durable: true,
      git_ref: assetGitRef,
      git_commit_sha: assetGitRef,
      repo_path: asset.path,
      git_blob_oid: gitBlobOid(bytes),
    }],
    source: {
      path: asset.path,
      sha256: sha256(bytes),
      size_bytes: statSync(abs).size,
      authority: 'runtime-asset-identity-snapshot',
    },
    provider: { task_ids: [], context_alias: null },
    structural_metrics: metrics(bytes.length, asset.asset_kind),
    rights: rights(),
    related_asset_ids: asset.derivative_of ? [asset.derivative_of] : [],
    parent_asset_id: asset.derivative_of ?? null,
    derivative_of: asset.derivative_of ?? null,
    qualification_gates: recordGates,
    evidence_refs: [`registry-evidence:runtime-assets`, `git:${assetGitRef}:${asset.path}`],
    notes: isCandidate ? 'Candidate identity is registered without runtime promotion.' : 'Current runtime custody is recorded; qualification gates remain independent and unproven gates stay UNKNOWN.',
  });
}

for (const item of history.items) {
  const isProvider = item.category?.startsWith('provider-task/');
  const isBinary = item.category?.startsWith('binary/');
  if (!isProvider && !isBinary) continue;

  const sourcePath = item.source_path ?? null;
  const sourcePathIsAsset = isAssetSourcePath(sourcePath);
  const inCurrentRuntime = sourcePath ? currentRuntimePaths.has(sourcePath) : false;
  const taskInputs = [...(item.provider_task_ids ?? []).map(taskInput), ...(item.rig_task_id ? [{ id: item.rig_task_id, kind: 'rigging' }] : [])];
  const providerTasks = taskInputs.map(observedTask);
  const hasGenerationTask = taskInputs.some((task) => isGenerationTaskKind(task.kind));
  const custodyLocations = [];

  if (item.source_ref && sourcePath && item.git_blob_oid && sourcePathIsAsset) {
    custodyLocations.push({
      kind: 'GIT',
      durable: true,
      git_ref: item.source_ref,
      git_commit_sha: item.source_sha ?? null,
      repo_path: sourcePath,
      git_blob_oid: item.git_blob_oid,
    });
  }
  if (inCurrentRuntime) {
    custodyLocations.push({
      kind: 'GIT',
      durable: true,
      git_ref: evidence.snapshot.runtime_git_ref,
      repo_path: sourcePath,
      git_blob_oid: null,
    });
  }
  const hasDriveFileEvidence = Boolean(item.archive_file_id && item.archive_file_url);
  if (hasDriveFileEvidence || item.archive_folder || item.archive_url) {
    custodyLocations.push({
      kind: 'DRIVE',
      durable: hasDriveFileEvidence,
      drive_file_id: item.archive_file_id ?? null,
      drive_file_url: item.archive_file_url ?? null,
      archive_path: item.archive_folder ?? null,
      drive_folder_url: item.archive_url ?? null,
    });
  }
  if (providerTasks.length) {
    custodyLocations.push({
      kind: 'PROVIDER',
      durable: false,
      provider_context: `historical-provider-context observed ${evidence.provider_reconciliation.observed_utc}`,
      provider_task_ids: providerTasks.map((task) => task.task_id),
    });
  }

  const durableLocations = custodyLocations.filter((location) => location.durable);
  const custodyKinds = new Set(custodyLocations.map((location) => location.kind));
  const durableKinds = new Set(durableLocations.map((location) => location.kind));
  const custody = durableLocations.length > 1 ? 'MULTIPLE'
    : durableKinds.has('GIT') ? 'IN_GIT'
      : durableKinds.has('DRIVE') ? 'IN_DRIVE'
        : custodyKinds.has('PROVIDER') ? 'PROVIDER_ONLY'
          : 'UNKNOWN';
  const recoverability = durableLocations.length > 1 ? 'VERIFIED'
    : durableKinds.has('GIT') ? 'VERIFIED_FROM_GIT'
      : durableKinds.has('DRIVE') ? 'VERIFIED_FROM_DRIVE'
        : custodyKinds.has('PROVIDER') ? 'UNAVAILABLE_CURRENT_PROVIDER_CONTEXT'
          : 'UNKNOWN';

  const assetKind = isProvider && item.category.includes('enemy') ? 'character' : isProvider ? 'gear' : 'model';
  const recordGates = gates();
  const provenanceRef = `historical-inventory:${item.item_id}`;
  recordGates.provenance = gate('PASS', [provenanceRef]);
  const recordMetrics = metrics(item.size_bytes ?? null, assetKind);
  const audit = sourcePath ? structuralByFilename.get(basename(sourcePath)) : null;
  if (audit?.result === 'PASS_STRUCTURAL') {
    recordGates.structural = gate('PASS', [`structural-audit:${audit.filename}`]);
    recordMetrics.file_size_bytes = audit.bytes;
    recordMetrics.mesh_count = audit.meshes;
    recordMetrics.material_count = audit.materials;
    recordMetrics.skin_count = audit.skins;
    recordMetrics.joint_count = audit.joints;
    recordMetrics.animation_clip_count = audit.embeddedAnimations;
  }

  add({
    asset_id: item.item_id,
    display_name: item.item_id,
    asset_kind: assetKind,
    lifecycle: supersededAliasOf.has(item.item_id) ? 'SUPERSEDED' : isProvider ? (hasGenerationTask ? 'GENERATED' : 'SOURCE_ONLY') : 'QUALIFYING',
    next_action: supersededAliasOf.has(item.item_id) ? 'ARCHIVE_ONLY' : undefined,
    related_asset_ids: [supersededAliasOf.get(item.item_id), clipParentOf.get(item.item_id)].filter(Boolean),
    custody,
    recoverability,
    custody_locations: custodyLocations,
    source: {
      path: sourcePathIsAsset ? sourcePath : null,
      sha256: sourcePathIsAsset ? (item.sha256 ?? null) : null,
      size_bytes: sourcePathIsAsset ? (item.size_bytes ?? null) : null,
      authority: 'historical-asset-platform-inventory',
    },
    provider: {
      task_ids: providerTasks,
      context_alias: providerTasks.length ? `historical-context-observed-${evidence.provider_reconciliation.observed_utc}` : null,
    },
    structural_metrics: recordMetrics,
    rights: rights('KNOWN', [provenanceRef]),
    parent_asset_id: clipParentOf.get(item.item_id) ?? null,
    derivative_of: supersededAliasOf.get(item.item_id) ?? clipParentOf.get(item.item_id) ?? null,
    qualification_gates: recordGates,
    evidence_refs: [provenanceRef, ...recordGates.structural.evidence_refs],
    notes: 'Historical logical asset identity preserved from the dated inventory. Current recovery coordinates are represented explicitly in custody_locations; no promotion is implied.',
  });
}

for (const item of evidence.local_evidence) {
  const recordGates = gates();
  for (const [name, value] of Object.entries(item.qualification_gates ?? {})) recordGates[name] = value;
  add({
    asset_id: item.asset_id,
    display_name: item.display_name,
    asset_kind: item.asset_kind,
    lifecycle: item.lifecycle,
    custody: 'LOCAL_ONLY',
    recoverability: 'UNKNOWN',
    custody_locations: [{ kind: 'LOCAL', durable: false, local_evidence_label: item.local_evidence_label }],
    source: { path: null, sha256: item.source.sha256, size_bytes: item.source.size_bytes, authority: item.source.authority },
    provider: { task_ids: [], context_alias: null },
    structural_metrics: metrics(item.source.size_bytes, item.asset_kind),
    rights: rights(),
    parent_asset_id: null,
    derivative_of: null,
    qualification_gates: recordGates,
    evidence_refs: [...new Set(Object.values(recordGates).flatMap((value) => value.evidence_refs))],
    notes: item.notes,
  });
}

for (const item of intake.items) {
  const recordGates = gates();
  recordGates.provenance = gate('PASS', [`drive:${item.drive_file_id}`]);
  recordGates.structural = gate('PASS', [`asset-intake:${intake.observed_utc}:${item.asset_id}`]);
  if (item.asset_kind === 'character') {
    recordGates.rig = gate('PASS', [`asset-intake:${intake.observed_utc}:${item.asset_id}`]);
    recordGates.animation = gate('PASS', [`asset-intake:${intake.observed_utc}:${item.asset_id}`]);
  } else {
    recordGates.rig = gate('N/A');
    recordGates.animation = gate('N/A');
  }
  add({
    asset_id: item.asset_id, display_name: item.display_name, asset_kind: item.asset_kind,
    lifecycle: item.lifecycle, facets: item.tags, next_action: item.next_action,
    aliases: [item.filename], related_asset_ids: [], custody: 'IN_DRIVE', recoverability: 'VERIFIED_FROM_DRIVE',
    custody_locations: [{ kind: 'DRIVE', durable: true, drive_file_id: item.drive_file_id, drive_file_url: `https://drive.google.com/file/d/${item.drive_file_id}/view`, archive_path: item.filename, drive_folder_url: intake.drive_folder_url }],
    source: { path: null, sha256: item.sha256, size_bytes: item.size_bytes, authority: 'drive-intake-2026-08-29' },
    provider: { task_ids: [], context_alias: null }, structural_metrics: { file_size_bytes: item.size_bytes, ...item.metrics },
    rights: rights('KNOWN', [`drive:${item.drive_file_id}`]), parent_asset_id: null, derivative_of: null,
    qualification_gates: recordGates,
    evidence_refs: [`drive:${item.drive_file_id}`, `asset-intake:${intake.observed_utc}:${item.asset_id}`],
    notes: `${item.identity_state}. ${item.notes}`,
  });
}

add({
  asset_id: animationRecovery.asset_id, display_name: 'Meshy hdUs9c Hero animation source', asset_kind: 'animation-source', lifecycle: 'SOURCE_ONLY',
  facets: ['hero', 'meshy'], next_action: 'OWNER_REVIEW', aliases: [animationRecovery.share_url], related_asset_ids: ['hero.base'],
  custody: 'UNKNOWN', recoverability: 'UNAVAILABLE_CURRENT_PROVIDER_CONTEXT',
  custody_locations: [{ kind: 'PROVIDER', durable: false, provider_context: 'Meshy share hdUs9c; exact source task unresolved', provider_task_ids: [] }],
  source: { path: null, sha256: null, size_bytes: null, authority: 'hdus9c-recovery-2026-08-29' },
  provider: { task_ids: [], context_alias: 'share-hdUs9c' }, structural_metrics: metrics(null, 'model'), rights: rights(),
  parent_asset_id: null, derivative_of: null, qualification_gates: gates(),
  evidence_refs: ['animation-recovery:HDUS9C_ANIMATION_SOURCE_RECOVERY.json'],
  notes: `${animationRecovery.recovery_status}. ${animationRecovery.required_owner_action}`,
});

const reconciliationRecords = records
  .flatMap((record) => record.provider.task_ids.filter((task) => ['image-to-3d', 'rigging'].includes(task.task_kind)).map((task) => ({ asset_id: record.asset_id, ...task })))
  .concat(evidence.provider_reconciliation.additional_records);
const taskNotFound = reconciliationRecords.filter((record) => record.provider_status === 'HTTP_404_TASK_NOT_FOUND').length;
const staleSignedUrlTasks = reconciliationRecords.filter((record) => record.download_attempt_result === 'HTTP_403_STALE_SIGNED_URL').length;

const registry = {
  schema: 'galaquest.asset-registry/1',
  generated_utc: evidence.snapshot.observed_utc,
  authority: 'current canonical asset inventory',
  base_sha: evidence.snapshot.package_base_sha,
  historical_sources: [
    { path: 'docs/asset-production/asset-platform-inventory.json', role: 'historical consolidation evidence; immutable authority' },
    { path: 'docs/asset-production/ENEMY_WAVE_1_PROVENANCE.json', role: 'historical enemy provider provenance' },
    { path: 'docs/asset-production/ENEMY_WAVE_1_STRUCTURAL_AUDIT.json', role: 'dated structural qualification evidence' },
    { path: 'docs/asset-production/asset-registry-v1.evidence.json', role: 'Package A dated observations and stable runtime identity map' },
    { path: 'docs/asset-production/ASSET_INTAKE_2026-08-29.json', role: 'Drive-backed 2026-08-29 intake hashes, identities and structural evidence' },
    { path: 'docs/asset-production/HDUS9C_ANIMATION_SOURCE_RECOVERY.json', role: 'read-only animation-source recovery conclusion' },
  ],
  provider_reconciliation: {
    observed_utc: evidence.provider_reconciliation.observed_utc,
    method: evidence.provider_reconciliation.method,
    historical_task_records: reconciliationRecords.length - evidence.provider_reconciliation.additional_records.length,
    task_not_found: taskNotFound,
    stale_signed_url_tasks: staleSignedUrlTasks,
    status: 'dated evidence snapshot; refresh the evidence input before treating provider state as current',
    no_paid_operations: evidence.provider_reconciliation.no_paid_operations,
    records: reconciliationRecords,
  },
  animation_lab_interface: {
    consumer: 'Package B Animation Lab v1',
    required_evidence: ['source asset and target rig IDs', 'rest-pose/skeleton compatibility report', 'clip inventory and root-motion report', 'visual playback evidence', 'export hash and qualification gates'],
    exclusions: ['authoring implementation', 'retarget promotion', 'runtime integration'],
  },
  records: records.sort((a, b) => a.asset_id.localeCompare(b.asset_id)),
};

writeFileSync(outPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(`wrote ${registry.records.length} records to ${outPath}`);
