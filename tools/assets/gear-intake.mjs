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
// Repeating the command on a real checkout is safe by construction, in three ways the dry run and the
// record both describe:
//
//   * Confinement is real, not lexical, and it covers every path a run may back up or write: the three
//     planned outputs, the FBX's texture siblings, and the converter's provenance record. Each target's
//     parent directory is created when needed and then resolved with fs.realpathSync; a target whose
//     resolved parent leaves its owned root, that runs through a symlink component, that already exists
//     as a symlink, or that resolves to the source file is refused, before anything is backed up.
//   * A second name is never treated as a first one. An existing write target that is a symlink, that
//     resolves to the source, or that has more than one hard link (statSync().nlink > 1) is refused even
//     with --force: the other name of a hard link can be anywhere on the machine, so rewriting this path
//     would change a file outside every owned root.
//   * The run is transactional, and it only ever adds or replaces files it is allowed to write. Before
//     any child command, whatever already exists (the three planned outputs, the FBX's
//     `<Name>.texture-<digits>.<jpg|jpeg|png>` siblings, and the converter's provenance file) is copied
//     into a backup directory under os.tmpdir(). Any failure -- a child
//     exit, an over-budget reduction, a record write -- removes every output this run created and
//     restores every backed-up file byte-for-byte. No partial outputs survive a failed run.
//
// Nothing is ever deleted to make room. A sibling beside the FBX that is not exactly
// `<Name>.texture-<digits>.<jpg|jpeg|png>` -- a Unity `.meta`, another extension, a non-numeric index --
// is a file this run did not write and may not overwrite, so the run refuses and names it; `--force` does
// not change that, and no `*.meta` file is ever touched.
//
// Usage:
//   node tools/assets/gear-intake.mjs --source <candidate.glb> --id <gear.slot.name> \
//     --name <PascalName> --tris <budget> [--bake-px <px>] [--dry-run] [--force] [--blender <path>]
//
//   --dry-run  print the exact planned commands, output paths and refusals; run nothing, write nothing
//   --force    allow overwriting exactly the files this run writes: the three planned outputs, the
//              `<Name>.texture-<digits>.<jpg|jpeg|png>` siblings beside the FBX, and a converter
//              provenance record that already uses this semantic id. It never deletes a file and never
//              overrides a refusal (a symlink, a shared hard link, a foreign sibling); replaced bytes are
//              backed up and restored if the run then fails.
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
 * The only sibling names this run may ever overwrite: `<Name>.texture-<digits>.<jpg|jpeg|png>`.
 *
 * Everything else that starts with `<Name>.texture-` -- a Unity `.meta`, another extension, a
 * non-numeric index -- is a file this run did not write. It is refused and named for the operator to
 * move, never deleted and never overwritten, with or without --force.
 */
export const CONVERTER_TEXTURE_SIBLING = /\.texture-\d+\.(?:jpg|jpeg|png)$/i;

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
 * The sibling names a conversion writes: exactly `<Name>.texture-<digits>.<jpg|jpeg|png>`.
 *
 * Split out from `textureSiblings` because the two answer different questions. This one is the name
 * shape the converter produces, which is what the record lists and what the backup set enumerates.
 * It is NOT a permission to overwrite: an existing sibling refuses the run whether or not it has this
 * shape (`assertNoForeignTextureSiblings`), because a forced rerun cannot tell which siblings its
 * conversion rewrote. Everything else the prefix matches is somebody else's file (see
 * `foreignTextureSiblings`).
 */
export function converterTextureSiblings(plan, { readdir = readdirSync } = {}) {
  return textureSiblings(plan, { readdir })
    .filter((sibling) => CONVERTER_TEXTURE_SIBLING.test(basename(sibling.path)));
}

/**
 * Siblings that share the `<Name>.texture-` prefix but are not a name the converter writes.
 *
 * A Unity `.meta` is the case that matters: Unity puts `<Name>.texture-0.jpg.meta` beside the texture,
 * so a prefix glob "for stale textures" will happily match and destroy the import metadata of every
 * already-imported derivative. A foreign sibling is not this run's file, so the run refuses and names
 * it rather than deleting it or writing over it -- with --force included. The run now refuses an
 * existing sibling of the converter's shape too, so `assertNoForeignTextureSiblings` asks
 * `textureSiblings` for the refusal and this filter only answers "not a name the converter writes".
 */
export function foreignTextureSiblings(plan, { readdir = readdirSync } = {}) {
  return textureSiblings(plan, { readdir })
    .filter((sibling) => !CONVERTER_TEXTURE_SIBLING.test(basename(sibling.path)));
}

/**
 * Refuse a real run when any `<Name>.texture-*` sibling sits beside the FBX.
 *
 * There is no delete path in this tool at all: the operator moves the file, because only the operator
 * knows whether it is an earlier derivative's texture, a Unity import artifact, a hand-placed file, or
 * debris worth removing -- and a forced rerun cannot tell which of them its own conversion rewrote.
 */
export function assertNoForeignTextureSiblings(plan, { readdir = readdirSync } = {}) {
  // Every existing <Name>.texture-* file is refused, converter-shaped ones included: a forced rerun
  // cannot tell which siblings its conversion actually rewrote, so an old sibling left in place would be
  // recorded as this run's output (false provenance). Refusing keeps the record provably fresh.
  const foreign = textureSiblings(plan, { readdir });
  if (!foreign.length) return;
  throw new IntakeError(
    `refusing to write beside the FBX: ${foreign.length} existing file(s) match ${plan.name}${TEXTURE_SIBLING_INFIX}* `
    + `(an earlier derivative's textures or Unity import metadata):\n`
    + foreign.map((sibling) => `  ${sibling.repoPath}`).join('\n')
    + `\nMove them out of the way yourself${foreign.some((sibling) => sibling.path.endsWith('.meta'))
      ? ' (a *.meta file is Unity import metadata; never let a tool delete it)' : ''}. `
    + 'This tool never deletes or overwrites them, and --force does not change that.',
    'foreign-sibling',
  );
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

/**
 * The files this run writes that already exist, so --force has to be stated for them.
 *
 * Only converter-shaped texture siblings count: a foreign sibling is refused outright (even with
 * --force) rather than treated as a replaceable conflict, so listing it here would offer the operator a
 * permission this tool never grants.
 */
export function existingOutputs(plan, { exists = existsSync } = {}) {
  // Texture siblings are not listed: any existing one is refused outright (assertNoForeignTextureSiblings).
  return plan.outputs.filter((output) => exists(output.path));
}

/**
 * Refuse a real run that would replace existing outputs.
 *
 * Refusing is deliberate: replacing a reduced GLB invalidates the hash recorded in both the intake
 * record and the converter's provenance, so it is a decision the operator states with --force
 * rather than a side effect of re-running a command. --force only ever grants permission to overwrite
 * these files; it grants nothing else and deletes nothing.
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
 * Existing write targets that have more than one hard link.
 *
 * Only this path can see the hazard: the extra name of a hard link is indistinguishable from the file
 * itself, so the write would land on whatever else shares those bytes -- inside the checkout or
 * anywhere else on the machine. The count comes from statSync().nlink rather than from comparing inodes
 * with the source, so a link that shares bytes with a file this tool has never heard of is refused too.
 */
export function sharedLinkTargets(plan, runtime) {
  return writeTargets(plan, { readdir: runtime.readdir })
    .filter((target) => runtime.nlink(target.path) > 1);
}

/**
 * Refuse any existing write target with more than one hard link, even with --force.
 *
 * There is no way to unlink the other name from here, and no way to tell whether it is a scratch copy
 * or the only copy of something that matters: the operator removes the extra link, or points --name at a
 * different file, before this tool touches anything.
 */
export function assertNoSharedWriteTargets(plan, runtime) {
  const shared = sharedLinkTargets(plan, runtime);
  if (!shared.length) return;
  throw new IntakeError(
    `refusing to write ${shared.length} file(s) that already have more than one hard link:\n`
    + shared.map((target) => `  ${target.repoPath} (${runtime.nlink(target.path)} links)`).join('\n')
    + '\nA hard link is another name for the same bytes, and that other name can be anywhere on this '
    + 'machine, so rewriting this path would change a file outside every owned root. Remove the extra '
    + 'link first; --force does not override this.',
    'unsafe-output',
  );
}

/**
 * The converter's provenance record for this semantic id, as it exists right now, or null.
 *
 * tools/unity-migration/convert-gear-asset.mjs upserts by semanticId: a record for the same id is
 * replaced rather than added, which silently drops the previous derivative's hash and Blender version.
 * The tool reads that file before running so the replacement is a decision the operator states with
 * --force instead of a side effect of re-running a command.
 */
export function existingProvenanceRecord(plan, runtime) {
  if (!runtime.exists(plan.provenancePath)) return null;
  let provenance;
  try {
    provenance = JSON.parse(runtime.readFile(plan.provenancePath));
  } catch (error) {
    throw new IntakeError(
      `cannot read ${plan.provenanceRepoPath} as JSON (${error.message}); the converter merges its record `
      + 'into that file, so fix or remove it before running',
      'provenance',
    );
  }
  if (!Array.isArray(provenance?.records)) {
    throw new IntakeError(
      `cannot read ${plan.provenanceRepoPath}: it has no records array, so the converter could not merge `
      + 'into it either; fix or remove the file before running',
      'provenance',
    );
  }
  return provenance.records.find((record) => record?.semanticId === plan.id) ?? null;
}

/** Refuse replacing an existing provenance record for this id unless the operator says --force. */
export function assertSemanticIdUnused(plan, runtime, { force = false } = {}) {
  const record = existingProvenanceRecord(plan, runtime);
  if (!record || force) return;
  throw new IntakeError(
    `${plan.provenanceRepoPath} already records ${plan.id}`
    + `${typeof record.derivativeRepoPath === 'string' ? ` (${record.derivativeRepoPath})` : ''}; `
    + 'refusing to replace provenance for an existing semantic id without --force:\n'
    + `  ${plan.id}\n`
    + 'The converter upserts by id, so re-running would drop the recorded hash and Blender version of '
    + 'the derivative that is there now.',
    'provenance-id',
  );
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
 * as a symlink (dangling included); and the resolved target is not the source file. Created directories
 * are recorded on `journal` so a rollback can remove them. A hard link -- any second name for the same
 * bytes, whether or not it is the source's -- is refused separately by `assertNoSharedWriteTargets`,
 * which reads the link count instead of guessing at identity.
 */
export function assertOutputsConfined(plan, runtime, journal) {
  const sourceRealPath = runtime.realpath(plan.sourcePath);
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
 * Copy every file a failure might have to put back.
 *
 * This is the whole pre-write phase, and it only ever reads: nothing is moved out of the way, and
 * nothing is deleted. The targets are exactly the files this run is allowed to write -- the three
 * planned outputs, the `<Name>.texture-<digits>.<jpg|jpeg|png>` siblings the converter writes, and its
 * provenance record. A sibling with any other `<Name>.texture-` name, a Unity `.meta` included, is
 * refused earlier by name rather than adopted as a write target, so no `.meta` is ever copied over.
 */
function backUpIntakeInputs(plan, runtime, journal) {
  const backupTargets = [
    ...plan.outputs.map((output) => output.path),
    ...converterTextureSiblings(plan, { readdir: runtime.readdir }).map((texture) => texture.path),
    plan.provenancePath,
  ];
  for (const path of [...new Set(backupTargets)]) {
    if (!runtime.exists(path)) continue;
    const backupPath = join(journal.directory, `backup-${journal.backups.length}`);
    runtime.copyFile(path, backupPath);
    journal.backups.push({ path, backupPath });
  }
  // The pre-state is now held in the backup directory, so from here a failure has to put every one of
  // these files back -- the child commands that follow are the ones allowed to overwrite them.
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
  if (journal.dirty) {
    // Restore first, then remove what is left over: a path that was backed up is never removed, because
    // putting its original bytes back is the point of the backup.
    const restored = new Set();
    for (const { path, backupPath } of journal.backups) {
      ensureDirectory(plan, runtime, journal, dirname(path));
      runtime.copyFile(backupPath, path);
      restored.add(path);
    }
    const written = [
      ...plan.outputs.map((output) => output.path),
      ...converterTextureSiblings(plan, { readdir: runtime.readdir }).map((texture) => texture.path),
      plan.provenancePath,
    ];
    for (const path of [...new Set(written)]) {
      if (restored.has(path)) continue;
      if (runtime.exists(path)) runtime.remove(path);
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

/**
 * The dry-run/human view of a plan. Pure: `--dry-run` prints exactly what a real run would do, including
 * the refusals, so the two cannot drift apart.
 *
 * `conflicts` are the existing files a real run refuses without --force. `foreign` and `shared` are the
 * ones it refuses with --force as well, and `duplicateId` is the provenance record --force would replace.
 */
export function formatPlan(plan, {
  conflicts = [], foreign = [], shared = [], duplicateId = null,
} = {}) {
  const lines = [
    `Gear intake plan for ${plan.id}`,
    '',
    `  name             ${plan.name}`,
    `  triangle budget  ${plan.tris}`,
    `  source           ${plan.sourceDisplay}`,
    '',
    '  writes — the three output roots',
    ...plan.outputs.map((output) => `    ${output.repoPath}`),
    `  writes — the converter this run reuses, ${GEAR_CONVERT_TOOL}`,
    `    ${plan.fbxRepoPath.replace(/\.fbx$/i, '')}.texture-<digits>.<jpg|jpeg|png>`,
    `    ${plan.provenanceRepoPath}`,
    '',
    '  commands',
    ...plan.commands.map((entry, index) => `    ${index + 1}. ${entry.display}`),
  ];
  if (foreign.length) {
    lines.push(
      '',
      '  refused even with --force — not a file this run writes; move them yourself',
      ...foreign.map((sibling) => `    ${sibling.repoPath}`),
    );
  }
  if (shared.length) {
    lines.push(
      '',
      '  refused even with --force — these have more than one hard link',
      ...shared.map((target) => `    ${target.repoPath}`),
    );
  }
  if (conflicts.length) {
    lines.push(
      '',
      '  already present — a real run refuses this without --force',
      ...conflicts.map((output) => `    ${output.repoPath}`),
    );
  }
  if (duplicateId) {
    lines.push(
      '',
      `  ${plan.provenanceRepoPath} already records ${duplicateId} — `
      + 'a real run refuses this without --force',
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
    // How many names these bytes have. Missing files have none, and a file that cannot be stat'd is not
    // a file this run may overwrite, so the failure answers 0 rather than throwing mid-check.
    nlink: (path) => {
      try {
        return statSync(path).nlink;
      } catch {
        return 0;
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
    // Nothing is written, so an existing file is information here, not yet a refusal. The plan reports
    // the same conditions a real run refuses on -- computed by the same functions -- so the operator can
    // see which flags the next run needs, and which refusals --force will not lift.
    runtime.log(formatPlan(plan, {
      conflicts: existingOutputs(plan, { exists: runtime.exists, readdir: runtime.readdir }),
      foreign: textureSiblings(plan, { readdir: runtime.readdir }),
      shared: sharedLinkTargets(plan, runtime),
      duplicateId: existingProvenanceRecord(plan, runtime)?.semanticId ?? null,
    }));
    return { plan, dryRun: true, record: null, commands: [] };
  }

  assertSourceExists(plan, { exists: runtime.exists });
  assertNoForeignTextureSiblings(plan, { readdir: runtime.readdir });
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
    // A hard link is a write outside the roots that no path check can see, so the link count is read
    // before anything is copied or overwritten.
    assertNoSharedWriteTargets(plan, runtime);
    // The provenance read comes after both safety checks so a symlinked or hard-linked record is
    // refused as an unsafe destination rather than merely reported as an unreadable file. It still
    // happens before the backup and before any child command.
    assertSemanticIdUnused(plan, runtime, { force: options.force });
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
      if (!Array.isArray(parsed) || parsed.length !== 1 || !Number.isInteger(parsed[0]?.triangles)
        || !Number.isInteger(parsed[0]?.unknownTrianglePrimitives) || parsed[0].unknownTrianglePrimitives < 0) {
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
    // Only converter-shaped names are listed -- a Unity `.meta` is not a texture this run produced, and
    // one may well appear here when the Editor is open and imports the new derivative (irrelevant ones
    // would have refused the run before it started).
    const textures = converterTextureSiblings(plan, { readdir: runtime.readdir })
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
