#!/usr/bin/env node
// One command: a generated rigid-gear GLB -> a Unity-ready candidate plus a machine-readable record.
//
// Rigid gear arrives from a generator at 10-100x the triangles the game budget allows, and
// docs/pipeline/character-armoring.md prescribes the order:
//
//   reference -> generate -> silhouette review -> remesh/decimate -> material normalization ->
//   fit/mount -> Studio -> running game
//
// The first two mechanical steps of that order -- reduce to a stated budget, then record the Unity
// FBX derivative -- were first performed by hand for the Dawnwarden helmet, one shell command at a
// time, and the transcript had to be reconstructed into prose afterwards. Reconstructing evidence by
// hand is where numbers drift and where a step silently gets skipped, so this orchestrates the
// EXISTING tools and writes down what actually ran.
//
// The reducer it drives is tools/blender/decimate_gear.py, which welds the vertices glTF split at
// every UV seam, collapse-decimates to the stated budget, unwraps a fresh UV set and bakes the
// source's base colour onto the reduced mesh -- the fix a runner self-review found for the cracks a
// UV-delimited collapse opened, and the reason a reduced candidate is not a torn atlas. `--bake-px`
// passes the baked texture size through to it; the weld threshold, the bake cage and the pinned
// Blender stay that tool's own contract rather than knobs here.
//
// It adds no reducer, no converter, no fit and no acceptance of its own. It is deliberately not:
//
//   * a fit or a mount (no socket, no GearItemDefinition, no cavity);
//   * material normalization;
//   * a Unity import (no .meta/.asset/C#, no Editor run);
//   * visual acceptance. Reduced bytes still need the review in
//     docs/review-guides/asset-visual-review.md, and running-game pixels remain final authority.
//
// The record it writes says exactly that in machine-readable form: status CANDIDATE with fit,
// cavity and visual all UNKNOWN. Promotion into shipped production stays Owner-controlled, and a
// CANDIDATE record is not a promotion.
//
// Repeating the command on a real checkout is safe by construction, in two ways the dry run and the
// record both describe:
//
//   * Confinement is real, not lexical, and it covers every path a run may back up or write: the three
//     planned outputs, the FBX's texture siblings, and the converter's provenance record. Each target's
//     parent directory is created when needed and then resolved with fs.realpathSync; a target whose
//     resolved parent leaves its owned root, that runs through a symlink component, that already exists
//     as a symlink, or that resolves to the source file is refused. Identity is compared as well as
//     spelling: a hard link is a second name for the same bytes, so an existing target whose device and
//     inode match the source's is refused before anything is backed up. No symlink or hard-link alias
//     can overwrite the source, even with --force.
//   * The run is transactional. Before any child command, whatever already exists (outputs, the
//     converter's provenance file, and the FBX's texture siblings) is copied into a backup directory
//     under os.tmpdir(), and pre-existing texture siblings are then deleted so the record can only name
//     textures this run produced. Any failure -- a child exit, an over-budget reduction, a record write
//     -- removes every output this run created and restores every backed-up file byte-for-byte. No
//     partial outputs survive a failed run.
//
// Usage:
//   node tools/assets/gear-intake.mjs --source <candidate.glb> --id <gear.slot.name> \
//     --name <PascalName> --tris <budget> [--bake-px <px>] [--dry-run] [--force] [--blender <path>]
//
//   --dry-run  print the exact planned commands and output paths, run nothing, write nothing
//   --force    allow replacing outputs that already exist (a real run refuses this by default; the
//              replaced bytes are backed up and restored if the run then fails)
//   --blender  the Blender binary; the converter still enforces its own pinned-version gate
//   --bake-px  baked Base Color texture size, a power of two 256..4096 (default 1024), passed to the
//              reducer as its fourth argument

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Reuse the converter's own version probe rather than inventing a second one: "which Blender produced
// these bytes" is part of a derivative's identity, and two probes could disagree.
import { PINNED_BLENDER_VERSION, PROVENANCE_PATH, blenderVersion } from '../unity-migration/convert-gear-asset.mjs';

export const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export const GLB_REPORT_TOOL = 'tools/assets/glb-intake-report.mjs';
export const DECIMATE_TOOL = 'tools/blender/decimate_gear.py';
export const GEAR_CONVERT_TOOL = 'tools/unity-migration/convert-gear-asset.mjs';

// The reduced GLB is the SOURCE of a Unity derivative, not a runtime asset, so it lives outside
// Assets/ (Unity would otherwise import it) and outside public/assets (everything there must be
// declared in the asset registry, and a candidate has no registry entry yet).
export const REDUCED_GLB_DIR = 'unity/GalaQuest/GearSources';
export const FBX_DIR = 'unity/GalaQuest/Assets/GalaQuest/Gear/SourceAssets';
export const INTAKE_RECORD_DIR = 'docs/asset-production/intake';

/**
 * Every directory this tool is allowed to write into.
 *
 * A whitelist rather than a public/assets blacklist, so a future edit cannot quietly add a fourth
 * output location. The converter's own provenance record is NOT in this list: it is a side effect of
 * reusing that tool, not an output of this one, and `plan.provenanceRepoPath` declares it so the dry
 * run never hides it.
 */
export const OUTPUT_ROOTS = Object.freeze([REDUCED_GLB_DIR, FBX_DIR, INTAKE_RECORD_DIR]);

/**
 * The infix of the texture siblings the converter writes beside the FBX: `<Name>.texture-<N>.<ext>`.
 *
 * tools/blender/convert_glb_to_fbx.py writes one per packed image (the index is the Blender image
 * index and the extension follows the image format), so a source with two materials produces more
 * than the single `.texture-0.jpg` the converter's own provenance record names. Those files are
 * outputs of a run exactly like the FBX: they are conflicts, they are backed up, and they are
 * recorded.
 */
export const TEXTURE_SIBLING_INFIX = '.texture-';

/**
 * The directory the converter's provenance record belongs to.
 *
 * The record is not one of this tool's declared outputs -- OUTPUT_ROOTS holds those -- but a run backs
 * it up and the converter rewrites it, so it is a write target and needs an owned root of its own.
 */
export const PROVENANCE_DIR = PROVENANCE_PATH.split('/').slice(0, -1).join('/');

export const GEAR_ID_PATTERN = /^gear\.[a-z]+\.[a-z0-9-]+$/;

// The baked texture size, in the same shape tools/blender/decimate_gear.py validates: a power of two
// in this range. Checked here too so a typo fails before a Blender run starts, named by the flag that
// carried it rather than as a Blender-side `int()` failure. The DEFAULT size is deliberately not
// mirrored here: the reducer owns it, prints it, and a copy on this side could only drift from it.
export const MIN_BAKE_PX = 256;
export const MAX_BAKE_PX = 4096;

// PascalCase: one or more Capitalized runs. Rejects snake_case, kebab-case, a leading digit and
// anything carrying a path separator, so a name can never steer an output path out of its directory.
export const PASCAL_NAME_PATTERN = /^(?:[A-Z][a-z0-9]*)+$/;

export class IntakeError extends Error {
  constructor(message, code = 'usage') {
    super(message);
    this.name = 'IntakeError';
    this.code = code;
  }
}

/** Display a path the way it was asked for: root-relative inside the checkout, absolute outside. */
function displayPath(absolute, root = REPO_ROOT) {
  const rootPrefix = `${root}${sep}`;
  return absolute.startsWith(rootPrefix) ? absolute.slice(rootPrefix.length).split(sep).join('/') : absolute;
}

// A shell word needing no quoting: every character is one the shell passes through untouched.
const SHELL_SAFE_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * Quote one command argument so the displayed command can be pasted back unmodified.
 *
 * A `--source` holding a space (or an apostrophe, or a `$`) would otherwise display a command that
 * runs with a different argument than the one this tool actually used -- exactly the drift the
 * recorded command exists to prevent.
 */
function quoteArgument(value) {
  return SHELL_SAFE_ARGUMENT.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

/** `DawnwardenSword` -> `dawnwarden-sword`, matching the existing GearSources file naming. */
export function kebabCase(name) {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

function command(step, file, args, { capture = false, note = null } = {}) {
  return {
    step,
    file,
    args,
    capture,
    note,
    display: [file, ...args].map(quoteArgument).join(' '),
  };
}

/**
 * Plan the intake: the output paths and the exact commands, and nothing else.
 *
 * Pure on purpose -- no filesystem, no child processes, no clock. That is what makes `--dry-run`
 * trustworthy: the dry run prints the plan a real run executes, so the two cannot drift apart.
 * Filesystem state (does the source exist, do the outputs already exist) is checked separately by
 * `assertSourceExists` / `assertOutputsAbsent`.
 */
export function planGearIntake(options) {
  const { source, id, name } = options;
  const blender = options.blender ?? 'blender';
  const tris = options.tris;
  // Absent unless asked for: the reducer's own default bake size is part of its contract, so the
  // planned command names it only when this run chose one. A recorded command should say what ran.
  const bakePx = options.bakePx ?? null;
  // The checkout the plan is expressed against. Defaults to this tool's own repository; tests drive a
  // disposable sandbox through the same code path rather than a parallel one.
  const root = resolve(options.root ?? REPO_ROOT);
  const problems = [];

  if (typeof source !== 'string' || !source.trim()) problems.push('--source <candidate.glb> is required');
  if (typeof id !== 'string' || !id.trim()) problems.push('--id <gear.slot.name> is required');
  else if (!GEAR_ID_PATTERN.test(id)) {
    problems.push(`--id must match gear.<slot>.<name> in lower-case (got ${JSON.stringify(id)})`);
  }
  if (typeof name !== 'string' || !name.trim()) problems.push('--name <PascalName> is required');
  else if (!PASCAL_NAME_PATTERN.test(name)) {
    problems.push(`--name must be PascalCase (got ${JSON.stringify(name)})`);
  }
  if (!Number.isInteger(tris) || tris <= 0) {
    problems.push(`--tris must be a positive whole triangle budget (got ${JSON.stringify(tris)})`);
  }
  if (bakePx !== null && !isBakePixels(bakePx)) {
    problems.push(`--bake-px must be a power of two between ${MIN_BAKE_PX} and ${MAX_BAKE_PX} `
      + `(got ${JSON.stringify(bakePx)})`);
  }
  if (typeof blender !== 'string' || !blender.trim()) problems.push('--blender requires a path');
  if (problems.length) throw new IntakeError(problems.join('\n'));

  if (!source.toLowerCase().endsWith('.glb')) {
    throw new IntakeError(`--source must be a .glb (got ${JSON.stringify(source)})`);
  }

  const sourcePath = resolve(root, source);
  const kebab = kebabCase(name);
  const reducedRepoPath = `${REDUCED_GLB_DIR}/${kebab}-lod.glb`;
  const fbxRepoPath = `${FBX_DIR}/${name}.fbx`;
  const recordRepoPath = `${INTAKE_RECORD_DIR}/${id}.json`;
  const reducedPath = resolve(root, reducedRepoPath);
  const fbxPath = resolve(root, fbxRepoPath);
  const recordPath = resolve(root, recordRepoPath);

  const outputs = [
    { kind: 'reduced-glb', repoPath: reducedRepoPath, path: reducedPath },
    { kind: 'unity-fbx', repoPath: fbxRepoPath, path: fbxPath },
    { kind: 'intake-record', repoPath: recordRepoPath, path: recordPath },
  ];
  for (const output of outputs) assertOutputPathAllowed(output.repoPath);

  // "Never modify the source" is not only about opening the file read-only: a source that already
  // sits at one of our output paths would be replaced a step later.
  for (const output of outputs) {
    if (sourcePath === output.path) {
      throw new IntakeError(
        `--source is the same file as the planned output ${output.repoPath}; refusing to overwrite the source`,
        'unsafe-output',
      );
    }
  }

  const sourceDisplay = displayPath(sourcePath, root);
  const commands = [
    command('report-source', 'node', [GLB_REPORT_TOOL, '--json', sourceDisplay], { capture: true }),
    command('decimate', blender, [
      '--background', '--factory-startup', '--python', DECIMATE_TOOL, '--',
      sourceDisplay, reducedRepoPath, String(tris),
      ...(bakePx === null ? [] : [String(bakePx)]),
    ], {
      note: 'welds the glTF seam splits, reduces to the stated budget, re-unwraps fresh UVs and bakes '
        + 'the base colour onto the reduced mesh; never writes the source',
    }),
    command('report-reduced', 'node', [GLB_REPORT_TOOL, '--json', reducedRepoPath], { capture: true }),
    command('convert-fbx', 'node', [
      GEAR_CONVERT_TOOL,
      '--source', reducedRepoPath,
      '--dest', fbxRepoPath,
      '--id', id,
      '--blender', blender,
    ], { note: 'drives the pinned Blender FBX converter; its own version gate still applies' }),
  ];

  return {
    id,
    name,
    kebab,
    tris,
    bakePx,
    blender,
    root,
    sourcePath,
    sourceDisplay,
    reducedPath,
    reducedRepoPath,
    fbxPath,
    fbxRepoPath,
    recordPath,
    recordRepoPath,
    provenancePath: resolve(root, PROVENANCE_PATH),
    provenanceRepoPath: PROVENANCE_PATH,
    outputs,
    commands,
  };
}

/**
 * Refuse an output path outside the three owned directories.
 *
 * public/assets is called out by name because it is the mistake someone will actually make: it is
 * where gear already lives, but it is the runtime payload plus the asset registry's declared
 * territory, and the migration bridge pins registry records. A candidate derivative is neither.
 */
export function assertOutputPathAllowed(repoPath) {
  const normalized = String(repoPath).split('\\').join('/').replace(/^\.\//, '');
  // A `..` segment is the one spelling that can lexically satisfy the root prefix below while still
  // pointing outside it, so it is rejected by name before the prefix is even considered.
  if (normalized.split('/').includes('..')) {
    throw new IntakeError(
      `refusing to write ${normalized}: '..' escapes the owned output roots`,
      'unsafe-output',
    );
  }
  if (normalized === 'public/assets' || normalized.startsWith('public/assets/')) {
    throw new IntakeError(
      `refusing to write ${normalized}: public/assets is runtime payload and registry-declared territory, `
      + `not an intake destination. Reduced gear belongs in ${REDUCED_GLB_DIR}.`,
      'unsafe-output',
    );
  }
  if (!OUTPUT_ROOTS.some((root) => normalized.startsWith(`${root}/`))) {
    throw new IntakeError(
      `refusing to write ${normalized}: outputs are confined to ${OUTPUT_ROOTS.join(', ')}`,
      'unsafe-output',
    );
  }
  return normalized;
}

export function assertSourceExists(plan, { exists = existsSync } = {}) {
  if (!exists(plan.sourcePath)) throw new IntakeError(`--source not found: ${plan.sourceDisplay}`, 'missing-source');
}

/**
 * The FBX's texture siblings that exist right now, sorted by path.
 *
 * The directory listing, not the converter's recorded output, is the authority: the conversion writes
 * `<Name>.texture-<N>.<ext>` for every packed image, so a source can legitimately produce several of
 * them and the record must name all of them.
 */
export function textureSiblings(plan, { readdir = readdirSync } = {}) {
  const directory = dirname(plan.fbxPath);
  const prefix = `${plan.name}${TEXTURE_SIBLING_INFIX}`;
  let entries;
  try {
    entries = readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.startsWith(prefix))
    .sort()
    .map((entry) => ({
      kind: 'fbx-texture',
      ownedRoot: FBX_DIR,
      path: join(directory, entry),
      repoPath: displayPath(join(directory, entry), plan.root),
    }));
}

/**
 * Every path a run may back up or write, each carrying the owned directory it must resolve inside.
 *
 * The three planned outputs are not the whole story: the converter writes an FBX beside texture
 * siblings and rewrites its own provenance record. Those are write targets too, so confinement that
 * covered only the planned paths would still let a symlinked sibling or provenance file carry a write
 * out of the checkout.
 */
export function writeTargets(plan, { readdir = readdirSync } = {}) {
  return [
    ...plan.outputs.map((output) => ({
      ...output,
      ownedRoot: OUTPUT_ROOTS.find((root) => output.repoPath.startsWith(`${root}/`)),
    })),
    ...textureSiblings(plan, { readdir }),
    {
      kind: 'converter-provenance',
      ownedRoot: PROVENANCE_DIR,
      path: plan.provenancePath,
      repoPath: plan.provenanceRepoPath,
    },
  ];
}

export function existingOutputs(plan, { exists = existsSync, readdir = readdirSync } = {}) {
  return [
    ...plan.outputs.filter((output) => exists(output.path)),
    ...textureSiblings(plan, { readdir }),
  ];
}

/**
 * Refuse a real run that would replace existing outputs.
 *
 * Refusing is deliberate: replacing a reduced GLB invalidates the hash recorded in both the intake
 * record and the converter's provenance, so it is a decision the operator states with --force
 * rather than a side effect of re-running a command.
 */
export function assertOutputsAbsent(plan, { force = false, exists = existsSync, readdir = readdirSync } = {}) {
  if (force) return;
  const present = existingOutputs(plan, { exists, readdir });
  if (present.length) {
    throw new IntakeError(
      'outputs already exist; refusing to overwrite without --force:\n'
      + present.map((output) => `  ${output.repoPath}`).join('\n'),
      'exists',
    );
  }
}

/**
 * Create `directory` and its missing ancestors, remembering on the journal which ones this run
 * created so a failed run can take them back out instead of leaving an empty skeleton behind.
 */
function ensureDirectory(plan, runtime, journal, directory) {
  const missing = [];
  let current = directory;
  while (!runtime.exists(current)) {
    const parent = dirname(current);
    // The filesystem root is never a directory this run created; stop without recording it.
    if (parent === current) break;
    missing.push(current);
    current = parent;
  }
  if (!missing.length) return;
  runtime.mkdir(directory);
  for (const path of missing.reverse()) journal.createdDirs.push(path);
}

/**
 * Refuse to write through a symlink anywhere on the checkout's path to a target.
 *
 * fs.realpathSync alone is not enough: a symlink that points *inside* the owned root resolves to a
 * legal path, yet the write still travels through an alias a later edit could silently repoint. Walking
 * the components from the plan root down rejects that case, and rejects a parent that leaves the root
 * before realpathSync even sees it. Components that do not exist yet cannot be symlinks.
 */
function assertNoSymlinkComponents(plan, target, runtime) {
  const suffix = relative(plan.root, target);
  if (suffix === '..' || suffix.startsWith(`..${sep}`)) {
    throw new IntakeError(
      `refusing to write ${displayPath(target, plan.root)}: it leaves the checkout root`,
      'unsafe-output',
    );
  }
  let current = plan.root;
  for (const segment of suffix.split(sep).filter(Boolean)) {
    current = join(current, segment);
    if (runtime.isSymlink(current)) {
      throw new IntakeError(
        `refusing to write ${displayPath(target, plan.root)}: ${displayPath(current, plan.root)} is a symlink`,
        'unsafe-output',
      );
    }
  }
}

/**
 * Create each write target's parent directory, resolve it for real, and refuse an unsafe destination.
 *
 * The checks, in order: the target is inside an owned root and holds no `..`; no component of its path
 * is a symlink; its realpath'd parent is the owned root or below it; the target does not already exist
 * as a symlink (dangling included); the resolved target is not the source file; and an existing target
 * is not the source under another name. Created directories are recorded on `journal` so a rollback can
 * remove them.
 */
export function assertOutputsConfined(plan, runtime, journal) {
  const sourceRealPath = runtime.realpath(plan.sourcePath);
  const sourceIdentity = runtime.identity(plan.sourcePath);
  const targets = [];
  for (const output of writeTargets(plan, { readdir: runtime.readdir })) {
    if (output.repoPath.split('/').includes('..')) {
      throw new IntakeError(
        `refusing to write ${output.repoPath}: '..' escapes the owned output roots`,
        'unsafe-output',
      );
    }
    const ownedRoot = output.ownedRoot
      ?? OUTPUT_ROOTS.find((root) => output.repoPath.startsWith(`${root}/`));
    if (!ownedRoot) {
      throw new IntakeError(
        `refusing to write ${output.repoPath}: outputs are confined to ${OUTPUT_ROOTS.join(', ')}`,
        'unsafe-output',
      );
    }
    const parent = dirname(output.path);
    assertNoSymlinkComponents(plan, parent, runtime);
    ensureDirectory(plan, runtime, journal, parent);
    const resolvedParent = runtime.realpath(parent);
    const resolvedRoot = runtime.realpath(resolve(plan.root, ownedRoot));
    if (resolvedParent !== resolvedRoot && !resolvedParent.startsWith(`${resolvedRoot}${sep}`)) {
      throw new IntakeError(
        `refusing to write ${output.repoPath}: its parent resolves to `
        + `${displayPath(resolvedParent, plan.root)}, outside ${ownedRoot}`,
        'unsafe-output',
      );
    }
    // lstat, not `exists`: a dangling symlink is still a symlink, and writing through it would create a
    // file this tool does not own wherever it points.
    if (runtime.isSymlink(output.path)) {
      throw new IntakeError(
        `refusing to write ${output.repoPath}: it already exists as a symlink, and writing through it `
        + 'would change a file this tool does not own',
        'unsafe-output',
      );
    }
    const resolvedPath = join(resolvedParent, basename(output.path));
    if (resolvedPath === sourceRealPath) {
      throw new IntakeError(
        `refusing to write ${output.repoPath}: it resolves to the source, `
        + `${displayPath(plan.sourcePath, plan.root)}; a symlink alias must not overwrite the source, `
        + 'even with --force',
        'unsafe-output',
      );
    }
    // A hard link is a second name for the same bytes, so two different resolved paths do not prove two
    // different files. Device + inode do: a target that shares the source's identity would be rewritten
    // in place by the child commands this run executes.
    const identity = runtime.identity(output.path);
    if (identity && sourceIdentity
      && identity.dev === sourceIdentity.dev && identity.ino === sourceIdentity.ino) {
      throw new IntakeError(
        `refusing to write ${output.repoPath}: it is the same file as the source, `
        + `${displayPath(plan.sourcePath, plan.root)} (same device and inode, i.e. a hard link); `
        + 'a second name must not overwrite the source, even with --force',
        'unsafe-output',
      );
    }
    targets.push({ ...output, resolvedPath });
  }
  return targets;
}

/**
 * Start the transaction: a temp directory under os.tmpdir() for whatever a failing run has to put back.
 *
 * `journal.dirty` stays false until the backup phase has finished, so a refusal before it (a symlinked
 * target, a `..` escape) does not claim to "restore" a file nothing touched.
 */
function beginIntakeJournal(runtime) {
  return {
    directory: runtime.makeTempDir('galaquest-gear-intake-'),
    backups: [],
    createdDirs: [],
    dirty: false,
  };
}

/**
 * Copy every file a failure might have to put back, then take stale texture siblings out of the way.
 *
 * The copy is what makes the run reversible; the deletion is what makes the record honest. A sibling
 * left over from an earlier conversion shares the `<Name>.texture-<N>.<ext>` shape this run's textures
 * have, so leaving it in place would put a file this run did not produce into the record -- and a
 * successful run would appear to have produced more textures than it did. It is deleted only after it
 * has been backed up, and a rollback restores it byte-for-byte.
 */
function backUpIntakeInputs(plan, runtime, journal) {
  const textures = textureSiblings(plan, { readdir: runtime.readdir }).map((texture) => texture.path);
  const backupTargets = [
    ...plan.outputs.map((output) => output.path),
    ...textures,
    plan.provenancePath,
  ];
  for (const path of [...new Set(backupTargets)]) {
    if (!runtime.exists(path)) continue;
    const backupPath = join(journal.directory, `backup-${journal.backups.length}`);
    runtime.copyFile(path, backupPath);
    journal.backups.push({ path, backupPath });
  }
  for (const path of textures) {
    if (runtime.exists(path)) runtime.remove(path);
  }
  // From here the tree can already differ from the pre-state, so a failure has to restore it.
  journal.dirty = true;
}

function commitIntake(runtime, journal) {
  runtime.remove(journal.directory);
}

/**
 * Undo a failed run: restore every backed-up file byte-for-byte and delete every output this run
 * created, then take back out any directory this run created that is now empty.
 */
function rollbackIntake(plan, runtime, journal) {
  const backups = new Map(journal.backups.map((entry) => [entry.path, entry.backupPath]));
  if (journal.dirty) {
    const written = [
      ...plan.outputs.map((output) => output.path),
      ...textureSiblings(plan, { readdir: runtime.readdir }).map((texture) => texture.path),
      plan.provenancePath,
      // A backed-up file this run deleted rather than rewrote -- a stale texture sibling taken out
      // before the conversion -- is missing from the listing above and still has to come back.
      ...journal.backups.map((entry) => entry.path),
    ];
    for (const path of [...new Set(written)]) {
      const backupPath = backups.get(path);
      if (backupPath !== undefined) {
        ensureDirectory(plan, runtime, journal, dirname(path));
        runtime.copyFile(backupPath, path);
      } else if (runtime.exists(path)) {
        runtime.remove(path);
      }
    }
  }
  runtime.remove(journal.directory);
  for (const directory of [...journal.createdDirs].reverse()) {
    try {
      runtime.rmdir(directory);
    } catch {
      // Left in place when it still holds something; only empty, run-created directories go away.
    }
  }
}

/** The dry-run/human view of a plan. Pure: `--dry-run` prints exactly what a real run would do. */
export function formatPlan(plan, { conflicts = [] } = {}) {
  const lines = [
    `Gear intake plan for ${plan.id}`,
    '',
    `  name             ${plan.name}`,
    `  triangle budget  ${plan.tris}`,
    `  source           ${plan.sourceDisplay}`,
    '',
    '  writes',
    ...plan.outputs.map((output) => `    ${output.repoPath}`),
    `    ${plan.provenanceRepoPath}  (side effect of ${GEAR_CONVERT_TOOL}, not of this tool)`,
    `    ${plan.fbxRepoPath.replace(/\.fbx$/i, '')}${TEXTURE_SIBLING_INFIX}*.*  `
      + '(also written next to the FBX by the converter)',
    '',
    '  commands',
    ...plan.commands.map((entry, index) => `    ${index + 1}. ${entry.display}`),
  ];
  if (conflicts.length) {
    lines.push(
      '',
      '  already present — a real run refuses this without --force',
      ...conflicts.map((output) => `    ${output.repoPath}`),
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The durable record for one intake.
 *
 * Pure, and deliberately without a timestamp: identical inputs must produce identical bytes, so two
 * records that differ mean their inputs differed. `fit`/`cavity`/`visual` stay UNKNOWN until the
 * stages that own those questions have actually run -- an intake run answers none of them.
 */
export function buildIntakeRecord({ plan, source, reduced, fbx, textures = [], blender, commands }) {
  return {
    schema: 'galaquest.gear-intake-record',
    schemaVersion: 1,
    id: plan.id,
    name: plan.name,
    status: 'CANDIDATE',
    triangleBudget: plan.tris,
    source: {
      repoPath: source.repoPath,
      sha256: source.sha256,
      sizeBytes: source.sizeBytes,
      triangles: source.triangles,
      vertices: source.vertices,
    },
    reduced: {
      repoPath: reduced.repoPath,
      sha256: reduced.sha256,
      sizeBytes: reduced.sizeBytes,
      triangles: reduced.triangles,
      vertices: reduced.vertices,
    },
    fbx: {
      repoPath: fbx.repoPath,
      sha256: fbx.sha256,
      sizeBytes: fbx.sizeBytes,
      // Every texture sibling the conversion produced, sorted by path. Omitted when there are none,
      // so a record without textures does not pretend the key means something.
      ...(textures.length ? { textures } : {}),
    },
    blender: {
      path: plan.blender,
      version: blender.version,
      pinnedVersion: blender.pinnedVersion,
    },
    commands,
    fit: 'UNKNOWN',
    cavity: 'UNKNOWN',
    visual: 'UNKNOWN',
  };
}

/** Real side effects, isolated so tests can drive `runIntake` without Blender or a filesystem. */
export function defaultRuntime() {
  return {
    exists: existsSync,
    isSymlink: (path) => {
      try {
        return lstatSync(path).isSymbolicLink();
      } catch {
        return false;
      }
    },
    realpath: (path) => realpathSync(path),
    // Device + inode, i.e. file identity rather than a path string. Missing files have no identity.
    identity: (path) => {
      try {
        const stats = statSync(path);
        return { dev: stats.dev, ino: stats.ino };
      } catch {
        return null;
      }
    },
    mkdir: (path) => mkdirSync(path, { recursive: true }),
    rmdir: (path) => rmdirSync(path),
    readdir: (path) => readdirSync(path),
    readFile: (path) => readFileSync(path),
    writeFile: (path, data) => writeFileSync(path, data),
    copyFile: (source, destination) => copyFileSync(source, destination),
    remove: (path) => rmSync(path, { recursive: true, force: true }),
    makeTempDir: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
    size: (path) => statSync(path).size,
    sha256: (path) => createHash('sha256').update(readFileSync(path)).digest('hex'),
    blenderVersion,
    log: (line) => process.stdout.write(`${line}\n`),
    run: (entry) => execFileSync(entry.file, entry.args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: entry.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    }),
  };
}

function execute(plan, runtime, step) {
  const entry = plan.commands.find((candidate) => candidate.step === step);
  if (!entry) throw new IntakeError(`no planned command for step ${step}`, 'internal');
  const output = runtime.run(entry);
  return { entry, output: typeof output === 'string' ? output : '' };
}

/**
 * Validate, then execute the plan in order.
 *
 * Returns the outcome instead of exiting, so the CLI and the tests drive the same function; only
 * `main` turns a throw into an exit code.
 */
export function runIntake(options, runtime = defaultRuntime()) {
  const plan = planGearIntake(options);

  if (options.dryRun) {
    assertSourceExists(plan, { exists: runtime.exists });
    // Nothing is written, so an existing output is information here, not yet a refusal.
    const conflicts = existingOutputs(plan, { exists: runtime.exists, readdir: runtime.readdir });
    runtime.log(formatPlan(plan, { conflicts }));
    return { plan, dryRun: true, record: null, commands: [] };
  }

  assertSourceExists(plan, { exists: runtime.exists });
  assertOutputsAbsent(plan, { force: options.force, exists: runtime.exists, readdir: runtime.readdir });

  // From here on the run can leave bytes behind, so it is wrapped in a transaction: the pre-state is
  // copied to a backup directory first, and any failure restores it and removes what this run created.
  // Setup lives inside the rollback scope, so a backup that fails halfway takes its temp directory out
  // with it instead of leaking it.
  let journal = null;
  try {
    journal = beginIntakeJournal(runtime);
    // Confinement runs before the first backup or write: a refused destination must not have its bytes
    // copied anywhere, and a symlinked texture sibling or provenance file must never be accepted as an
    // output this run may overwrite.
    assertOutputsConfined(plan, runtime, journal);
    backUpIntakeInputs(plan, runtime, journal);

    const commands = [];
    const report = (step) => {
      const { entry, output } = execute(plan, runtime, step);
      commands.push(entry.display);
      if (output) runtime.log(output.trimEnd());
      let parsed;
      try {
        parsed = JSON.parse(output);
      } catch {
        throw new IntakeError(`${entry.display} did not print JSON to read the triangle count from`, 'report');
      }
      // tools/assets/glb-intake-report.mjs --json prints an ARRAY, one entry per requested file, and this
      // plan asks about exactly one file. The array shape is checked rather than assumed: reading
      // `triangles` off the array itself would yield `undefined`, the budget gate would compare
      // `undefined > budget` (false) and every over-budget reduction would pass unnoticed.
      if (!Array.isArray(parsed) || parsed.length !== 1 || !Number.isInteger(parsed[0]?.triangles)) {
        throw new IntakeError(`${entry.display} did not report exactly one triangle count`, 'report');
      }
      return parsed[0];
    };

    const sourceReport = report('report-source');

    const decimate = execute(plan, runtime, 'decimate');
    commands.push(decimate.entry.display);

    const reducedReport = report('report-reduced');

    // Fail closed: an unreadable triangle count is not a passing budget. The report tool reports such
    // primitives as unknownTrianglePrimitives rather than counting them as zero.
    if (reducedReport.unknownTrianglePrimitives > 0) {
      throw new IntakeError(
        `reduced GLB has ${reducedReport.unknownTrianglePrimitives} primitive(s) whose triangle count could not be `
        + `read; cannot claim the ${plan.tris} triangle budget`,
        'budget',
      );
    }
    if (reducedReport.triangles > plan.tris) {
      throw new IntakeError(
        `reduced GLB reports ${reducedReport.triangles} triangles, over the ${plan.tris} budget`,
        'budget',
      );
    }

    const convert = execute(plan, runtime, 'convert-fbx');
    commands.push(convert.entry.display);

    // List the directory rather than assume `.texture-0.jpg`: the converter writes one sibling per
    // packed image, so a multi-material source produces several and the record must name all of them.
    const textures = textureSiblings(plan, { readdir: runtime.readdir })
      .map((sibling) => ({
        repoPath: sibling.repoPath,
        sha256: runtime.sha256(sibling.path),
        sizeBytes: runtime.size(sibling.path),
      }))
      .sort((a, b) => (a.repoPath < b.repoPath ? -1 : a.repoPath > b.repoPath ? 1 : 0));

    const record = buildIntakeRecord({
      plan,
      source: {
        repoPath: displayPath(plan.sourcePath, plan.root),
        sha256: runtime.sha256(plan.sourcePath),
        sizeBytes: runtime.size(plan.sourcePath),
        triangles: sourceReport.triangles,
        vertices: sourceReport.vertices,
      },
      reduced: {
        repoPath: plan.reducedRepoPath,
        sha256: runtime.sha256(plan.reducedPath),
        sizeBytes: runtime.size(plan.reducedPath),
        triangles: reducedReport.triangles,
        vertices: reducedReport.vertices,
      },
      fbx: {
        repoPath: plan.fbxRepoPath,
        sha256: runtime.sha256(plan.fbxPath),
        sizeBytes: runtime.size(plan.fbxPath),
      },
      textures,
      blender: { version: runtime.blenderVersion(plan.blender), pinnedVersion: PINNED_BLENDER_VERSION },
      commands,
    });

    ensureDirectory(plan, runtime, journal, dirname(plan.recordPath));
    runtime.writeFile(plan.recordPath, `${JSON.stringify(record, null, 2)}\n`);
    runtime.log(`Wrote ${plan.recordRepoPath} (status CANDIDATE; fit/cavity/visual UNKNOWN).`);
    runtime.log('Next: GearItemDefinition + Workbench fit, then visual review — this record is not acceptance.');

    commitIntake(runtime, journal);
    return { plan, dryRun: false, record, commands };
  } catch (error) {
    // A refusal that happens before the backup phase (a symlinked target, a `..` escape) has nothing to
    // put back, so it must not claim a rollback it did not perform. Only a `dirty` journal -- one where
    // bytes may already have moved -- gets the transaction guarantee.
    let rollbackNote = '';
    let rollbackFailed = false;
    if (journal) {
      try {
        rollbackIntake(plan, runtime, journal);
      } catch (rollbackError) {
        rollbackFailed = true;
        rollbackNote = `\nWARNING: rollback itself failed: ${rollbackError.message}`;
      }
    }
    const code = error instanceof IntakeError ? error.code : 'runtime';
    const message = error instanceof IntakeError ? error.message : `intake failed: ${error.message}`;
    // An incomplete rollback is the more important fact, and it is the one the operator has to act on:
    // claiming "no outputs remain" beside it would be exactly the claim the tool just failed to honour.
    const guarantee = journal?.dirty && !rollbackFailed
      ? '\nThe run failed and was rolled back: no outputs or backups remain.'
      : '';
    throw new IntakeError(`${message}${guarantee}${rollbackNote}`, code);
  }
}

export function usage() {
  return 'usage: node tools/assets/gear-intake.mjs --source <candidate.glb> --id <gear.slot.name> '
    + '--name <PascalName> --tris <budget> [--bake-px <px>] [--dry-run] [--force] [--blender <path>]';
}

function parseTriangleBudget(value) {
  if (!/^\d+$/.test(value)) {
    throw new IntakeError(`--tris must be a positive whole number of triangles (got ${JSON.stringify(value)})`);
  }
  const tris = Number(value);
  if (!Number.isSafeInteger(tris) || tris <= 0) {
    throw new IntakeError(`--tris must be a positive whole number of triangles (got ${JSON.stringify(value)})`);
  }
  return tris;
}

/** A baked texture size the reducer will also accept: a power of two between 256 and 4096. */
export function isBakePixels(value) {
  return Number.isInteger(value) && value >= MIN_BAKE_PX && value <= MAX_BAKE_PX && (value & (value - 1)) === 0;
}

function parseBakePixels(value) {
  const pixels = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!isBakePixels(pixels)) {
    throw new IntakeError(
      `--bake-px must be a power of two between ${MIN_BAKE_PX} and ${MAX_BAKE_PX} (got ${JSON.stringify(value)})`,
    );
  }
  return pixels;
}

// Flags that carry a value, mapped to the option key they set. A Map rather than `slice(2)`, because
// `--bake-px` would otherwise be stored under a hyphenated key nothing else reads.
const VALUED_ARGUMENTS = new Map([
  ['--source', 'source'],
  ['--id', 'id'],
  ['--name', 'name'],
  ['--tris', 'tris'],
  ['--blender', 'blender'],
  ['--bake-px', 'bakePx'],
]);

export function parseArgs(argv) {
  const options = {
    source: null, id: null, name: null, tris: null, blender: null, bakePx: null, dryRun: false, force: false,
  };
  const valued = new Set(VALUED_ARGUMENTS.keys());
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') { options.dryRun = true; continue; }
    if (argument === '--force') { options.force = true; continue; }
    if (!valued.has(argument)) {
      throw new IntakeError(`unknown argument ${JSON.stringify(argument)}\n${usage()}`);
    }
    const value = argv[index + 1];
    // A missing value must not swallow the next flag: `--name --force` is a typo, not a name.
    if (value === undefined || valued.has(value) || value.startsWith('--')) {
      throw new IntakeError(`${argument} requires a value\n${usage()}`);
    }
    index += 1;
    const key = VALUED_ARGUMENTS.get(argument);
    if (key === 'tris') options.tris = parseTriangleBudget(value);
    else if (key === 'bakePx') options.bakePx = parseBakePixels(value);
    else options[key] = value;
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  try {
    runIntake(parseArgs(argv));
    return 0;
  } catch (error) {
    if (error instanceof IntakeError) {
      process.stderr.write(`${error.message}\n`);
      return error.code === 'usage' ? 2 : 1;
    }
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
