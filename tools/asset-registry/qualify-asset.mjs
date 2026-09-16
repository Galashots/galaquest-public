#!/usr/bin/env node
// Read-only join over existing authority/tools; never an artistic acceptor or registry writer.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectGlb } from './inspect-glb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REGISTRY = 'docs/asset-production/asset-registry-v1.json';
const SELF = 'tools/asset-registry/qualify-asset.mjs';
const SCHEMA = 'galaquest.asset-qualification/1';
const LANES = Object.freeze({ character: 'characters-npcs', 'rigid-gear': 'gear', 'rigid-prop': 'props' });
const COMMON = ['AGENTS.md', 'docs/WORKFLOW.md', 'docs/pipeline/README.md',
  'docs/asset-production/ASSET_REGISTRY_V1.md', 'docs/GALAQUEST_VISUAL_AUTHORITY.md',
  'docs/review-guides/asset-visual-review.md', '.agents/skills/visual-reference-first/SKILL.md', 'unity/AGENTS.md'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gate = (status, reason) => ({ status, reason });

function localPath(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /[:\\\0]/.test(path)
      || path.split('/').some((part) => part === '..' || part === '.')) throw new Error('Expected a checkout-relative file path');
  const full = resolve(root, path);
  let ancestor = full;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error('Owned checkout unavailable');
    ancestor = parent;
  }
  const rel = relative(realpathSync(root), realpathSync(ancestor));
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Path escapes owned checkout');
  return full;
}
function fingerprint(root, path, role) {
  const full = localPath(root, path);
  const bytes = existsSync(full) ? readFileSync(full) : null;
  return { path, role, sha256: bytes === null ? null : hash(bytes), bytes: bytes?.length ?? null };
}
function repositoryState(root) {
  const git = (...args) => {
    const run = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000 });
    return run.status === 0 ? run.stdout.trim() : null;
  };
  const top = git('rev-parse', '--show-toplevel');
  const head = top && realpathSync(top) === realpathSync(root) ? git('rev-parse', 'HEAD') : null;
  const dirty = head ? git('status', '--porcelain', '--untracked-files=normal') : null;
  return { head_sha: head, exact_sha_claim: Boolean(head && dirty === ''), dirty,
    node: process.version, platform: process.platform };
}
function seal(receipt) { return { ...receipt, receipt_sha256: hash(JSON.stringify(receipt)) }; }

export function qualifyAsset(options, root = ROOT) {
  const inputs = [];
  const bind = (path, role) => {
    if (!path) return null;
    const item = fingerprint(root, path, role);
    if (!inputs.some((old) => old.path === path && old.role === role)) inputs.push(item);
    return item;
  };
  bind(REGISTRY, 'registry');
  const registry = JSON.parse(readFileSync(localPath(root, REGISTRY), 'utf8'));
  if (registry.schema !== 'galaquest.asset-registry/1' || !Array.isArray(registry.records)) throw new Error('Expected canonical registry v1');
  const matches = registry.records.filter((record) => record.asset_id === options.id);
  if (matches.length !== 1) throw new Error(`Expected one exact asset_id: ${options.id}`);
  const record = matches[0];
  // A gear label does not imply rigid armour; a generic model does not imply a prop.
  const assetClass = options.class ?? (record.asset_kind === 'character' ? 'character' : null);
  const supported = Object.hasOwn(LANES, assetClass ?? '');
  const repository = repositoryState(root);
  const source = bind(options.source ?? record.source?.path, 'source');
  const candidate = bind(options.candidate ?? source?.path, 'candidate');
  const references = (options.reference ?? []).map((path) => bind(path, 'reference'));
  for (const path of options.evidence ?? []) {
    bind(path, 'evidence');
    bind(`${path}.meta`, 'optional-meta');
  }
  const clips = (options.clip ?? []).map((path) => bind(path, 'clip'));
  const authority = [...COMMON, ...(supported ? [`docs/pipeline/${LANES[assetClass]}.md`] : []),
    ...(assetClass === 'character' ? ['tools/foundry/README.md', '.agents/skills/galaquest-character-foundry/SKILL.md'] : [])];
  for (const path of authority) bind(path, 'authority');
  bind(SELF, 'tool');
  bind('tools/asset-registry/inspect-glb.mjs', 'tool');
  const checks = {
    source_identity: gate(!source?.sha256 || !record.source?.sha256 ? 'UNKNOWN'
      : source.sha256 === record.source.sha256 ? 'PASS' : 'FAIL', 'Recovered source must match registry bytes; provider/custody labels are not identity.'),
    class_contract: gate('UNKNOWN', 'Declare character, rigid-gear or rigid-prop; no inference from a generic model/gear label.'),
    intent_inputs: gate(options.purpose?.trim() && references.length && references.every((item) => item?.sha256) ? 'PASS' : 'UNKNOWN',
      'Player-use and reference files are present only; selection/approval still requires judgment.'),
    derivative_lineage: gate(source?.sha256 && source.sha256 === candidate?.sha256 ? 'N/A' : 'UNKNOWN',
      'Different bytes are declared, not proven ancestry. Preserve the transformation recipe/receipt.'),
    lifecycle: gate(['REJECTED', 'SUPERSEDED', 'HISTORICAL'].includes(record.lifecycle) ? 'FAIL' : 'PASS',
      'Archive-only identities need reconciliation; PRODUCTION does not inherit appearance approval.'),
    recorded_rejections: gate(Object.values(record.qualification_gates ?? {}).some((item) => item.status === 'FAIL') ? 'FAIL' : 'PASS',
      'Existing rejections remain open; historical PASS is never rerun or inherited here.'),
  };
  const diagnostics = [];
  const runTool = (tool, args, kind = 'diagnostic') => {
    const identity = bind(tool, 'tool');
    const run = identity.sha256 ? spawnSync(process.execPath, [tool, ...args], {
      cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    }) : {};
    const output = { kind, command: ['node', tool, ...args], execution: run.status === 0 ? 'PASS' : 'UNKNOWN',
      exit_code: run.status ?? null, error: run.error?.code ?? null, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
    diagnostics.push(output);
    return output;
  };
  let measurements = null;
  if (candidate?.sha256) {
    try {
      const info = inspectGlb(localPath(root, candidate.path));
      measurements = Object.fromEntries(['byte_size', 'mesh_count', 'primitive_count', 'triangle_count', 'material_count',
        'skin_count', 'animation_count', 'bounds_accessor_local', 'skins', 'animations'].map((key) => [key, info[key]]));
      checks.metadata = gate('PASS', 'Declared GLB metadata only, not raw topology, world bounds or destination validity.');
      const rigid = assetClass === 'rigid-prop' || assetClass === 'rigid-gear';
      const conflict = (record.asset_kind === 'character' && assetClass !== 'character')
        || (record.asset_kind === 'gear' && assetClass !== 'rigid-gear') || !['model', 'gear', 'character'].includes(record.asset_kind);
      if (supported) checks.class_contract = gate(conflict || !Number.isFinite(info.triangle_count) || info.triangle_count <= 0
        || (rigid && (info.skin_count > 0 || info.animation_count > 0)) ? 'FAIL' : 'PASS',
      'Nonempty declared mesh and compatible class only; rigid means no skin/animation. Not fit, rig or visual acceptance.');
      let unresolved = !Array.isArray(info.external_resource_uris);
      for (const uri of info.external_resource_uris ?? []) {
        if (uri.startsWith('data:')) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('//')) { unresolved = true; continue; }
        const path = relative(root, resolve(root, dirname(candidate.path), decodeURIComponent(uri))).replaceAll('\\', '/');
        if (!bind(path, 'candidate-resource')?.sha256) unresolved = true;
      }
      bind(`${candidate.path}.meta`, 'optional-meta');
      checks.resources = gate(unresolved ? 'UNKNOWN' : 'PASS', 'Local URI resources hashed; no remote fetch. Unity dependency closure remains separate.');
      runTool('tools/foundry/material_audit.mjs', [candidate.path]);
      if (assetClass === 'character') {
        runTool('tools/foundry/clip_inventory.mjs', [candidate.path]);
        if (options.root) runTool('tools/foundry/measure_root_motion.mjs', [candidate.path, '--root', options.root]);
      }
      if (clips.length && assetClass !== 'character') checks.native_clip = gate('FAIL', 'Clip transfer requires the character lane.');
      else if (clips.length && clips.every((item) => item?.sha256)) {
        const run = runTool('tools/foundry/verify_native_clip.mjs', ['--body', candidate.path,
          ...clips.flatMap((item) => ['--clip', item.path])], 'reject-gate');
        checks.native_clip = gate(run.exit_code === 1 && /^\s*FAIL\s/m.test(run.stdout) ? 'FAIL'
          : run.exit_code === 0 && /all \d+ candidate\(s\) are native/.test(run.stdout) ? 'PASS' : 'UNKNOWN',
        'Existing strict native-clip check only; not full bind/weight, anatomy, root-policy or deformation proof.');
      } else checks.native_clip = gate(clips.length ? 'UNKNOWN' : 'N/A', clips.length ? 'Requested clip missing.' : 'No external clip transfer requested.');
    } catch (error) { checks.metadata = gate('FAIL', error.message); }
  } else checks.metadata = gate('UNKNOWN', 'Candidate bytes missing; recover without regeneration/spend.');
  const specialist = {
    topology: 'Use tools/foundry/README.md and the applicable opt-in source/GLB diagnostic. Counts do not prove closedness; closedness is not universal.',
    materials: 'Use Unity neutral and gameplay lighting beside accepted content; diagnostics cannot approve style.',
    fit: assetClass === 'rigid-gear' ? 'Use Unity Gear Workbench fixture/profile/registration and coverage gates.' : 'Prove scale, orientation, pivot, floor contact and shadow in Unity.',
    performance: 'Use destination limits/worst legal visible state. glb_budget.mjs is Hero-scoped and may print FAIL with exit 0.',
    unity: 'Use unity/AGENTS.md and existing Unity review manifests; bind source/importer/meta/material/prefab/scene with --evidence.',
    producer_visual: 'Inspect neutral + gameplay + motion where relevant, beside accepted content; record strongest mismatch.',
    independent_visual: 'Fresh unprimed critique, separate from producer self-review.',
    device: 'Gameplay-size desktop proof is not physical iPad proof.',
    rights: 'Registry provenance does not establish license/redistribution rights.',
    owner: 'Only the reserved Owner decision can authorize promotion; this command never does.',
  };
  if (assetClass === 'character') specialist.rig_animation = 'Use character/foundry authority for anatomy, rest/binds, weights, weight shift, contact and root policy; provider labels are not anatomy.';
  for (const [key, reason] of Object.entries(specialist)) checks[key] = gate('UNKNOWN', reason);
  checks.inputs_available = gate(inputs.every((item) => item.sha256 || item.role === 'optional-meta') ? 'PASS' : 'UNKNOWN', 'Missing referenced inputs remain unknown.');
  checks.input_stability = gate(inputs.every((item) => fingerprint(root, item.path, item.role).sha256 === item.sha256)
    && JSON.stringify(repositoryState(root)) === JSON.stringify(repository) ? 'PASS' : 'FAIL', 'Inputs and checkout state must not change during inspection.');
  const failed = Object.entries(checks).filter(([, value]) => value.status === 'FAIL').map(([key]) => key);
  const next = failed.length ? 'REPAIR_OR_RECONCILE_REJECTION' : ['HOLD', 'OWNER_REVIEW', 'ARCHIVE_ONLY'].includes(record.next_action) ? 'RESOLVE_RECORDED_HOLD'
    : checks.source_identity.status !== 'PASS' ? 'RECOVER_AND_VERIFY_SOURCE' : !supported ? 'DECLARE_SUPPORTED_CLASS'
      : !candidate?.sha256 ? 'RECOVER_CANDIDATE' : checks.inputs_available.status !== 'PASS' ? 'RECOVER_REQUIRED_INPUTS'
        : checks.intent_inputs.status !== 'PASS' ? 'DECLARE_USE_AND_COMPARISON' : checks.resources?.status !== 'PASS' ? 'RECOVER_CANDIDATE_RESOURCES'
          : 'COMPLETE_SPECIALIST_AND_UNITY_REVIEW';
  return seal({ schema: SCHEMA, asset_id: record.asset_id, asset_class: assetClass, purpose: options.purpose ?? null,
    repository, registry_state: { lifecycle: record.lifecycle, custody: record.custody, next_action: record.next_action },
    authority, source, candidate, inputs, measurements, diagnostics, checks, status: failed.length ? 'FAIL' : 'UNKNOWN',
    failed_checks: failed, next_action: next, promotion_authorized: false });
}

export function verifyReceipt(receipt, root = ROOT) {
  const { receipt_sha256: checksum, ...body } = receipt ?? {};
  if (body.schema !== SCHEMA || checksum !== hash(JSON.stringify(body)) || !Array.isArray(body.inputs) || !body.inputs.length
      || !['registry', 'tool'].every((role) => body.inputs.some((item) => item.role === role))
      || !['FAIL', 'UNKNOWN'].includes(body.status) || body.promotion_authorized !== false) {
    return { status: 'FAIL', reason: 'Malformed/edited receipt; checksum is integrity, not an authenticated signature.', promotion_authorized: false };
  }
  const changed = [];
  for (const item of body.inputs) {
    try { if (JSON.stringify(fingerprint(root, item.path, item.role)) !== JSON.stringify(item)) changed.push(item.path); }
    catch { changed.push(item.path); }
  }
  const repository = repositoryState(root);
  if (JSON.stringify(repository) !== JSON.stringify(body.repository)) changed.push('repository/runtime state');
  return { status: changed.length ? 'FAIL' : repository.exact_sha_claim && body.source?.sha256 && body.candidate?.sha256
      && body.inputs.every((item) => item.sha256 || item.role === 'optional-meta') ? 'PASS' : 'UNKNOWN',
    changed, qualification_status: body.status, promotion_authorized: false,
    reason: 'Bindings only. Specialist/human judgments are neither interpreted nor upgraded; undeclared dependencies are outside this receipt.' };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const options = { reference: [], evidence: [], clip: [] };
    const allowed = new Set(['id', 'class', 'source', 'candidate', 'purpose', 'reference', 'evidence', 'clip', 'root', 'out', 'verify']);
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i].replace(/^--/, '');
      if (!args[i].startsWith('--') || !allowed.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Expected --option value pairs; see ASSET_REGISTRY_V1.md');
      if (Array.isArray(options[key])) options[key].push(args[i + 1]);
      else if (options[key] !== undefined) throw new Error(`Duplicate --${key}`);
      else options[key] = args[i + 1];
    }
    if (options.verify && args.length !== 2) throw new Error('--verify is a separate read-only command');
    const result = options.verify ? verifyReceipt(JSON.parse(readFileSync(localPath(ROOT, options.verify), 'utf8'))) : qualifyAsset(options);
    const text = JSON.stringify(result, null, 2) + '\n';
    if (options.out) {
      if (!/^(\.local|tmp)\//.test(options.out)) throw new Error('Receipt output must be inside .local/ or tmp/');
      writeFileSync(localPath(ROOT, options.out), text, { flag: 'wx' });
    }
    console.log(text.trimEnd());
    process.exitCode = result.status === 'FAIL' ? 1 : result.status === 'UNKNOWN' ? 2 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
