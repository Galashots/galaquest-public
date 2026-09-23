import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';

import {
  CONVERTER_TEXTURE_SIBLING,
  GEAR_CONVERT_TOOL,
  GLB_REPORT_TOOL,
  INTAKE_RECORD_DIR,
  OUTPUT_ROOTS,
  PASCAL_NAME_PATTERN,
  REPO_ROOT,
  assertNoForeignTextureSiblings,
  assertNoSharedWriteTargets,
  assertOutputPathAllowed,
  assertOutputsAbsent,
  assertOutputsConfined,
  assertSemanticIdUnused,
  assertSourceExists,
  buildIntakeRecord,
  converterTextureSiblings,
  defaultRuntime,
  existingProvenanceRecord,
  foreignTextureSiblings,
  kebabCase,
  parseArgs,
  planGearIntake,
  runIntake,
  sharedLinkTargets,
  writeTargets,
} from '../tools/assets/gear-intake.mjs';

// tools/assets/gear-intake.mjs turns one generated rigid-gear GLB into a Unity-ready candidate with
// one command. The value of that command is that it is the same sequence every time and that it
// writes down what it actually did, so these tests pin the things a silent edit would break: the
// planned paths/commands, the rules that stop a run from overwriting evidence, and the transactional
// guarantees (confinement, backup/restore, texture siblings) a failing run has to honour.
//
// Nothing here needs Blender. The run tests build a throwaway sandbox under os.tmpdir() and drive the
// real code path through a fake child runner: the fake writes the files a real child would write, or
// fails the way a real child would fail, while `defaultRuntime` does the real hashing and file I/O.
// Blender runs are the runner's job on a machine that has Blender; what a unit test can honestly
// prove is that the plan, the refusals, the rollback and the record are correct.

const repoPath = (...parts) => resolve(REPO_ROOT, ...parts);
const SAMPLE_SOURCE = 'public/assets/gear/candidates/dawnwarden-sword-v1.glb';
const REDUCED_DIR = 'unity/GalaQuest/GearSources';
const FBX_DIR = 'unity/GalaQuest/Assets/GalaQuest/Gear/SourceAssets';
// Mirrors the converter's PROVENANCE_PATH, which the tool re-exports as plan.provenanceRepoPath; test 1
// ties the two together so a rename cannot silently move the file this suite backs up.
const PROVENANCE_FILE = 'unity/GalaQuest/Assets/GalaQuest/Gear/GearDerivativeProvenance.json';

/**
 * A provenance document shaped the way the converter writes it.
 *
 * The intake tool reads this file before running (the converter upserts a record by semantic id, so an
 * id that is already present is a replacement the operator has to state with --force), which means a
 * test fixture has to be real JSON rather than a placeholder string: a file this tool cannot parse is
 * refused, because the converter would fail on it after the reduction had already run.
 */
function provenanceDocument(records = []) {
  return `${JSON.stringify({
    schema: 'galaquest.unity-gear-derivative-provenance',
    schemaVersion: 1,
    pinnedBlenderVersion: '4.5.13',
    records,
  }, null, 2)}\n`;
}

const provenanceRecord = (semanticId, overrides = {}) => ({
  semanticId,
  derivativeRepoPath: `unity/GalaQuest/Assets/GalaQuest/Gear/SourceAssets/${semanticId}.fbx`,
  derivativeSha256: 'f'.repeat(64),
  blenderVersion: '4.5.13 LTS',
  ...overrides,
});

const sampleOptions = (overrides = {}) => ({
  source: SAMPLE_SOURCE,
  id: 'gear.sword.dawnwarden',
  name: 'DawnwardenSword',
  tris: 1500,
  ...overrides,
});

const SOURCE_REPORT = { triangles: 68004, vertices: 38601, unknownTrianglePrimitives: 0 };
const REDUCED_REPORT = { triangles: 1500, vertices: 900, unknownTrianglePrimitives: 0 };

// --- real-filesystem sandbox ---------------------------------------------------------------------

const sandboxes = [];
test.after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

/**
 * A disposable checkout: the source GLB exists and nothing has been written yet.
 *
 * `planGearIntake({ root })` expresses the plan against this directory instead of the real checkout,
 * so the tests drive the same plan/utilise code the CLI does rather than a parallel implementation.
 */
function sandbox({ source = 'SOURCE-GLB-BYTES' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gq-gear-intake-test-'));
  sandboxes.push(root);
  mkdirSync(join(root, 'public/assets/gear/candidates'), { recursive: true });
  if (source !== null) writeFileSync(join(root, SAMPLE_SOURCE), source);
  return root;
}

/** Write `data` at a repo-relative path inside the sandbox, creating parents. */
function put(root, repoRelativePath, data) {
  const full = join(root, repoRelativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  return full;
}

/** Write a valid provenance document at the converter's path inside the sandbox. */
function putProvenance(root, records = []) {
  return put(root, PROVENANCE_FILE, provenanceDocument(records));
}

function tree(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      out.push(relative(root, full));
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return out.sort();
}

const backupDirs = () => readdirSync(tmpdir()).filter((name) => name.startsWith('galaquest-gear-intake-'));

/**
 * The real runtime with a fake child runner and captured logging.
 *
 * The runner writes the files a real child would write -- the reduced GLB, the FBX, the converter's
 * texture siblings and its provenance file -- and can fail after doing so, which is what lets a
 * rollback be tested without Blender. Reports are returned as the documented one-entry JSON array.
 */
function sandboxRun(root, {
  reduced = 'REDUCED-GLB-BYTES',
  fbx = 'NEW-FBX-BYTES',
  textures = {},
  sourceReport = SOURCE_REPORT,
  reducedReport = REDUCED_REPORT,
  failAt = null,
  wrapReports = true,
} = {}) {
  const plan = planGearIntake(sampleOptions({ root }));
  const calls = [];
  const logs = [];
  const encode = (report) => JSON.stringify(wrapReports ? [report] : report);
  const runner = (entry) => {
    calls.push(entry.step);
    if (entry.step === 'report-source') return encode(sourceReport);
    if (entry.step === 'decimate') {
      put(root, plan.reducedRepoPath, reduced);
      return '';
    }
    if (entry.step === 'report-reduced') return encode(reducedReport);
    if (entry.step === 'convert-fbx') {
      put(root, plan.fbxRepoPath, fbx);
      for (const [name, data] of Object.entries(textures)) put(root, `${FBX_DIR}/${name}`, data);
      put(root, PROVENANCE_FILE, 'CONVERTER-WROTE-PROVENANCE');
      if (failAt === 'convert-fbx') throw new Error('fake converter exited 1');
      return '';
    }
    throw new Error(`unexpected fake step ${entry.step}`);
  };
  const runtime = {
    ...defaultRuntime(),
    run: runner,
    // The record names the Blender that produced the derivative; the real probe would spawn a binary
    // this suite deliberately does not need.
    blenderVersion: () => '4.5.13 LTS',
    log: (line) => logs.push(line),
  };
  return { plan, calls, logs, runtime };
}

/**
 * A structural stand-in for the real side effects, for the checks that must happen before any file
 * is touched: no child process, no filesystem.
 *
 * The default pre-state is what a real first run sees -- the candidate exists and nothing has been
 * written yet -- so a test overrides `present` only to stage the condition it is actually about.
 */
function fakeRuntime({
  present = (path) => path === repoPath(SAMPLE_SOURCE),
  reports = {},
  blender = '4.5.13 LTS',
} = {}) {
  const calls = { run: [], mkdir: [], write: [], log: [] };
  return {
    calls,
    exists: (path) => present(path),
    // The checks that run before the first child command read three things: the directory listing (is a
    // foreign sibling there?), the link count (is this path a second name for somebody else's bytes?)
    // and the provenance file. This stand-in answers the empty/no-file case, so a test overrides
    // `present` only for the condition it is actually about.
    readdir: () => [],
    nlink: () => 0,
    readFile: () => { throw new Error('fakeRuntime has no provenance file to read'); },
    mkdir: (path) => calls.mkdir.push(path),
    writeFile: (path, data) => calls.write.push({ path, data }),
    size: () => 4096,
    // Deterministic per path, so a record's hashes are checkable without touching a file.
    sha256: (path) => createHash('sha256').update(path).digest('hex'),
    blenderVersion: () => blender,
    log: (line) => calls.log.push(line),
    // The report steps are the captured ones; everything else is a Blender run with no stdout.
    run: (entry) => {
      calls.run.push(entry.step);
      if (!entry.capture) return '';
      const report = reports[entry.step];
      if (report === undefined) throw new Error(`no fake report for ${entry.step}`);
      // tools/assets/glb-intake-report.mjs --json prints an ARRAY, one entry per requested file. The
      // fake mirrors that shape, so it cannot drift into agreeing with a shape the real tool never emits.
      return JSON.stringify([report]);
    },
  };
}

// --- planning and refusal rules ------------------------------------------------------------------

test('a sample plan names the exact output paths and the exact commands', () => {
  const plan = planGearIntake(sampleOptions());

  assert.equal(plan.id, 'gear.sword.dawnwarden');
  assert.equal(plan.kebab, 'dawnwarden-sword');
  assert.equal(plan.sourceDisplay, SAMPLE_SOURCE);
  assert.equal(plan.reducedRepoPath, `${REDUCED_DIR}/dawnwarden-sword-lod.glb`);
  assert.equal(plan.fbxRepoPath, `${FBX_DIR}/DawnwardenSword.fbx`);
  assert.equal(plan.recordRepoPath, `${INTAKE_RECORD_DIR}/gear.sword.dawnwarden.json`);
  assert.equal(plan.provenanceRepoPath, PROVENANCE_FILE);
  assert.equal(plan.root, REPO_ROOT);

  assert.deepEqual(plan.commands.map((entry) => entry.step),
    ['report-source', 'decimate', 'report-reduced', 'convert-fbx']);
  assert.deepEqual(plan.commands.map((entry) => entry.display), [
    `node ${GLB_REPORT_TOOL} --json ${SAMPLE_SOURCE}`,
    'blender --background --factory-startup --python tools/blender/decimate_gear.py -- '
      + `${SAMPLE_SOURCE} ${REDUCED_DIR}/dawnwarden-sword-lod.glb 1500`,
    `node ${GLB_REPORT_TOOL} --json ${REDUCED_DIR}/dawnwarden-sword-lod.glb`,
    `node ${GEAR_CONVERT_TOOL} --source ${REDUCED_DIR}/dawnwarden-sword-lod.glb `
      + `--dest ${FBX_DIR}/DawnwardenSword.fbx `
      + '--id gear.sword.dawnwarden --blender blender',
  ]);
});

test('the decimate command is the one the reducer documents, in its own argument order', () => {
  // tools/blender/decimate_gear.py reads `<in.glb> <out.glb> <target_tris>` after `--`; swapping the
  // order would silently feed the budget to the wrong operand.
  const [decimate] = planGearIntake(sampleOptions()).commands.filter((entry) => entry.step === 'decimate');
  assert.equal(decimate.file, 'blender');
  assert.deepEqual(decimate.args, [
    '--background', '--factory-startup', '--python', 'tools/blender/decimate_gear.py', '--',
    SAMPLE_SOURCE, `${REDUCED_DIR}/dawnwarden-sword-lod.glb`, '1500',
  ]);
});

test('a custom --blender is used for the reduction and passed through to the converter', () => {
  const plan = planGearIntake(sampleOptions({ blender: '/opt/blender-4.5.13/blender' }));
  const [decimate] = plan.commands.filter((entry) => entry.step === 'decimate');
  const [convert] = plan.commands.filter((entry) => entry.step === 'convert-fbx');
  assert.equal(decimate.file, '/opt/blender-4.5.13/blender');
  assert.deepEqual(convert.args.slice(-2), ['--blender', '/opt/blender-4.5.13/blender']);
});

test('a displayed command single-quotes any argument a shell would otherwise split', () => {
  // The recorded command is meant to be pasted back and run. An argument with a space, a quote or a
  // `$` would otherwise display a command that runs with different arguments than the one used here.
  const plan = planGearIntake(sampleOptions({
    source: 'public/assets/gear/candidates/my candidate.glb',
    blender: '/opt/Blender 4.5/blender',
  }));
  const [decimate] = plan.commands.filter((entry) => entry.step === 'decimate');
  assert.ok(decimate.display.startsWith(`'/opt/Blender 4.5/blender' --background`), decimate.display);
  assert.ok(decimate.display.includes(`'public/assets/gear/candidates/my candidate.glb'`), decimate.display);
  // An ordinary argument stays unquoted so the common case is still readable.
  assert.ok(decimate.display.includes(' --python tools/blender/decimate_gear.py -- '), decimate.display);
  assert.ok(!decimate.display.includes(`'tools/blender/decimate_gear.py'`), decimate.display);

  const apostrophe = planGearIntake(sampleOptions({ blender: "/opt/o'brien/blender" }));
  const [quoted] = apostrophe.commands.filter((entry) => entry.step === 'decimate');
  assert.ok(quoted.display.startsWith(`'/opt/o'\\''brien/blender' `), quoted.display);
});

test('kebab-case names follow the existing GearSources convention', () => {
  assert.equal(kebabCase('DawnwardenHelmet'), 'dawnwarden-helmet');
  assert.equal(kebabCase('IronwoodShield'), 'ironwood-shield');
  assert.equal(kebabCase('Sword'), 'sword');
  assert.equal(kebabCase('DawnwardenSwordA1'), 'dawnwarden-sword-a1');
});

test('the plan refuses a malformed id, a non-Pascal name and a non-positive budget', () => {
  assert.throws(() => planGearIntake(sampleOptions({ id: 'gear.sword.Dawnwarden' })), /--id must match/);
  assert.throws(() => planGearIntake(sampleOptions({ id: 'sword.dawnwarden' })), /--id must match/);
  assert.throws(() => planGearIntake(sampleOptions({ id: 'gear.sword.dawnwarden.v1' })), /--id must match/);
  assert.throws(() => planGearIntake(sampleOptions({ name: 'dawnwarden-sword' })), /--name must be PascalCase/);
  assert.throws(() => planGearIntake(sampleOptions({ name: 'dawnwarden_sword' })), /--name must be PascalCase/);
  assert.throws(() => planGearIntake(sampleOptions({ name: 'Dawnwarden Sword' })), /--name must be PascalCase/);
  assert.throws(() => planGearIntake(sampleOptions({ name: '2Sword' })), /--name must be PascalCase/);
  for (const tris of [0, -5, 1.5, '1500', null]) {
    assert.throws(() => planGearIntake(sampleOptions({ tris })), /--tris must be a positive whole triangle budget/);
  }
  assert.throws(() => planGearIntake(sampleOptions({ source: 'candidate.obj' })), /--source must be a \.glb/);
  assert.throws(() => planGearIntake({ id: 'gear.sword.dawnwarden', name: 'X', tris: 10 }), /--source .* is required/);
});

test('PascalCase allows the names gear actually uses and nothing path-like', () => {
  for (const name of ['Sword', 'DawnwardenSword', 'GQ', 'LakeBlade2']) {
    assert.ok(PASCAL_NAME_PATTERN.test(name), `${name} should be a valid PascalCase name`);
  }
  for (const name of ['sword', 'dawnSword', 'Sword/../evil', '../Sword', 'Sword-lod']) {
    assert.ok(!PASCAL_NAME_PATTERN.test(name), `${name} must not be accepted as a name`);
  }
});

test('argument parsing rejects unknown flags and flags missing their value', () => {
  assert.deepEqual(parseArgs(['--source', 'a.glb', '--id', 'gear.a.b', '--name', 'Ab', '--tris', '10']),
    { source: 'a.glb', id: 'gear.a.b', name: 'Ab', tris: 10, blender: null, dryRun: false, force: false });
  assert.equal(parseArgs(['--source', 'a.glb', '--dry-run', '--force']).force, true);

  // A near-miss flag must fail loudly: `--dryrun` silently doing a real Blender run is the failure
  // this rejection exists to prevent.
  assert.throws(() => parseArgs(['--source', 'a.glb', '--dryrun']), /unknown argument "--dryrun"/);
  assert.throws(() => parseArgs(['--source']), /--source requires a value/);
  assert.throws(() => parseArgs(['--name', '--force']), /--name requires a value/);
  assert.throws(() => parseArgs(['--tris', 'lots']), /--tris must be a positive whole number/);
});

test('a run refuses outputs that already exist unless --force is given', () => {
  const plan = planGearIntake(sampleOptions());
  const present = (path) => path === plan.fbxPath || path === plan.sourcePath;

  assert.throws(() => assertOutputsAbsent(plan, { exists: present }),
    /refusing to overwrite without --force[\s\S]*SourceAssets\/DawnwardenSword\.fbx/);
  assert.doesNotThrow(() => assertOutputsAbsent(plan, { force: true, exists: present }));
  assert.doesNotThrow(() => assertOutputsAbsent(plan, { exists: () => false }));

  // The refusal has to happen before any command runs, or a half-finished run leaves a replaced
  // reducer output next to a stale record.
  const runtime = fakeRuntime({ present });
  assert.throws(() => runIntake(sampleOptions(), runtime), /refusing to overwrite without --force/);
  assert.deepEqual(runtime.calls.run, []);
  assert.deepEqual(runtime.calls.write, []);
});

test('a real checkout would refuse the shipped IronwoodShield derivative without --force', () => {
  // End-to-end proof of the refusal on real files rather than a fake: this FBX is in the tree, so
  // the same command that would rebuild it must refuse instead.
  const plan = planGearIntake(sampleOptions({ id: 'gear.shield.ironwood', name: 'IronwoodShield' }));
  assert.ok(existsSync(plan.fbxPath), 'fixture assumes the shipped IronwoodShield derivative exists');
  assert.throws(() => assertOutputsAbsent(plan), /refusing to overwrite without --force/);
});

test('the plan refuses a source that is one of its own outputs', () => {
  const clash = planGearIntake(sampleOptions());
  assert.throws(
    () => planGearIntake(sampleOptions({ source: clash.reducedRepoPath })),
    /refusing to overwrite the source/,
  );
});

test('a destination under public/assets is refused, and every planned output is inside an owned root', () => {
  assert.throws(() => assertOutputPathAllowed('public/assets/gear/candidates/dawnwarden-sword-lod.glb'),
    /public\/assets is runtime payload and registry-declared territory/);
  assert.throws(() => assertOutputPathAllowed('public/assets/gear/x.glb'), /public\/assets/);
  assert.throws(() => assertOutputPathAllowed('unity/GalaQuest/Assets/SomewhereElse/x.fbx'),
    /outputs are confined to/);
  assert.throws(() => assertOutputPathAllowed('docs/pipeline/gear.md'), /outputs are confined to/);

  for (const root of OUTPUT_ROOTS) assert.equal(assertOutputPathAllowed(`${root}/x.glb`), `${root}/x.glb`);

  // The plan's outputs are derived from constants and a validated name, so this is the invariant a
  // future edit would have to break deliberately rather than by accident.
  for (const output of planGearIntake(sampleOptions()).outputs) {
    assert.ok(OUTPUT_ROOTS.some((root) => output.repoPath.startsWith(`${root}/`)),
      `${output.repoPath} must be inside an owned output root`);
  }
});

test('a .. segment in an output path is refused lexically and before any write', () => {
  // A lexical prefix check alone can be satisfied by `..`; both layers refuse it by name, and the
  // resolved-path check refuses a path that walks out of the checkout even when its spelling looks
  // clean.
  assert.throws(() => assertOutputPathAllowed(`${REDUCED_DIR}/../escape.glb`),
    /'\.\.' escapes the owned output roots/);
  assert.throws(() => assertOutputPathAllowed(`${REDUCED_DIR}/../../outside.glb`),
    /'\.\.' escapes the owned output roots/);

  const root = sandbox();
  const plan = planGearIntake(sampleOptions({ root }));
  const runtime = defaultRuntime();
  const journal = { createdDirs: [] };

  const dotted = {
    ...plan,
    outputs: [{
      kind: 'reduced-glb',
      repoPath: `${REDUCED_DIR}/../escape.glb`,
      path: resolve(root, `${REDUCED_DIR}/../escape.glb`),
    }],
  };
  assert.throws(() => assertOutputsConfined(dotted, runtime, journal),
    /'\.\.' escapes the owned output roots/);

  const escaping = {
    ...plan,
    outputs: [{
      kind: 'reduced-glb',
      repoPath: `${REDUCED_DIR}/escape.glb`,
      path: resolve(root, '../../outside-the-checkout.glb'),
    }],
  };
  assert.throws(() => assertOutputsConfined(escaping, runtime, journal), /leaves the checkout root/);
  assert.deepEqual(journal.createdDirs, [], 'a refused destination must not have created directories');
});

test('a missing source is refused before anything runs', () => {
  const plan = planGearIntake(sampleOptions({ source: 'public/assets/gear/candidates/nope.glb' }));
  assert.throws(() => assertSourceExists(plan), /--source not found/);

  const runtime = fakeRuntime({ present: () => false });
  assert.throws(() => runIntake(sampleOptions({ source: 'public/assets/gear/candidates/nope.glb' }), runtime),
    /--source not found/);
  assert.deepEqual(runtime.calls.run, []);
});

// --- confinement: symlinks and resolved paths ----------------------------------------------------

test('an output whose parent directory is a symlink is refused before anything is written', () => {
  const root = sandbox();
  const outside = mkdtempSync(join(tmpdir(), 'gq-gear-outside-'));
  sandboxes.push(outside);
  mkdirSync(join(root, dirname(REDUCED_DIR)), { recursive: true });
  symlinkSync(outside, join(root, REDUCED_DIR));

  const { calls, runtime } = sandboxRun(root);
  const before = tree(root);
  const beforeBackups = new Set(backupDirs());

  assert.throws(() => runIntake(sampleOptions({ root }), runtime), (error) => {
    assert.equal(error.code, 'unsafe-output');
    assert.match(error.message, /GearSources is a symlink/);
    // Nothing had been written yet, so the refusal must not claim a rollback it did not perform.
    assert.doesNotMatch(error.message, /rolled back/);
    return true;
  });
  assert.deepEqual(calls, [], 'no child command may run once a destination is refused');
  assert.deepEqual(tree(root), before, 'the refusal must leave the tree exactly as it found it');
  assert.deepEqual(readdirSync(outside), [], 'nothing may be written through the symlink');
  assert.deepEqual(backupDirs().filter((name) => !beforeBackups.has(name)), []);
});

test('an output that already exists as a symlink is refused even with --force', () => {
  // Both a live and a dangling symlink: a dangling one is invisible to a plain existence check, yet
  // writing through it would create a file wherever it points.
  for (const dangling of [false, true]) {
    const root = sandbox();
    const plan = planGearIntake(sampleOptions({ root }));
    const decoy = put(root, 'public/decoy.bin', 'DECOY-BYTES');
    mkdirSync(join(root, FBX_DIR), { recursive: true });
    symlinkSync(dangling ? join(root, 'public/missing.bin') : decoy, join(root, plan.fbxRepoPath));

    const { calls, runtime } = sandboxRun(root);
    const before = tree(root);
    assert.throws(() => runIntake(sampleOptions({ root, force: true }), runtime), (error) => {
      assert.equal(error.code, 'unsafe-output');
      assert.match(error.message, /already exists as a symlink/);
      return true;
    });
    assert.deepEqual(calls, []);
    assert.equal(lstatSync(join(root, plan.fbxRepoPath)).isSymbolicLink(), true,
      'the refused symlink itself must be left alone');
    if (!dangling) assert.equal(readFileSync(decoy, 'utf8'), 'DECOY-BYTES');
    assert.ok(!existsSync(join(root, REDUCED_DIR, 'dawnwarden-sword-lod.glb')));

    // The refusal happens after the reduced GLB's parent directory was created, so that directory has
    // to come back out again rather than being left as an empty skeleton.
    assert.deepEqual(tree(root), before, 'a refused run must leave the tree exactly as it found it');
    assert.equal(existsSync(join(root, REDUCED_DIR)), false);
  }
});

test('a symlink alias that resolves to the source is refused even with --force', () => {
  // The plan's lexical "output is the source" check compares path strings, so it cannot see this: the
  // source *name* points at the candidate location while its bytes are the planned reduced output.
  // Resolving both for real is what refuses it -- and the source must survive untouched.
  const root = sandbox({ source: null });
  const reduced = put(root, `${REDUCED_DIR}/dawnwarden-sword-lod.glb`, 'REAL-SOURCE-BYTES');
  symlinkSync(reduced, join(root, SAMPLE_SOURCE));

  const plan = planGearIntake(sampleOptions({ root }));
  const runtime = defaultRuntime();
  assert.throws(() => assertOutputsConfined(plan, runtime, { createdDirs: [] }), (error) => {
    assert.equal(error.code, 'unsafe-output');
    assert.match(error.message, /resolves to the source/);
    return true;
  });

  const { runtime: runRuntime } = sandboxRun(root);
  assert.throws(() => runIntake(sampleOptions({ root, force: true }), runRuntime),
    /resolves to the source/);
  assert.equal(readFileSync(reduced, 'utf8'), 'REAL-SOURCE-BYTES', 'the source bytes must not be overwritten');
  assert.equal(lstatSync(join(root, SAMPLE_SOURCE)).isSymbolicLink(), true);
});

test('the confinement check covers every path a run may write, not only the planned outputs', () => {
  // The children write more than the three planned paths: the FBX's texture siblings and the
  // converter's provenance record. Confinement that stopped at plan.outputs would leave those two
  // kinds of path unchecked, so they are enumerated as write targets with their own owned roots.
  const root = sandbox();
  const plan = planGearIntake(sampleOptions({ root }));
  put(root, `${FBX_DIR}/DawnwardenSword.texture-1.png`, 'EXISTING');

  const kinds = writeTargets(plan, { readdir: readdirSync }).map((target) => target.kind);
  assert.deepEqual(kinds, [
    'reduced-glb', 'unity-fbx', 'intake-record', 'fbx-texture', 'converter-provenance',
  ]);
  for (const target of writeTargets(plan, { readdir: readdirSync })) {
    assert.equal(typeof target.ownedRoot, 'string', `${target.kind} needs an owned root`);
    assert.ok(target.repoPath.startsWith(`${target.ownedRoot}/`), `${target.repoPath} vs ${target.ownedRoot}`);
  }
});

test('an output with more than one hard link is refused even with --force, and the other name survives', () => {
  // A hard link is a second name for the same bytes: the two paths differ and realpathSync agrees they
  // differ, so a resolved-path comparison cannot see it -- yet the reduction would write through the
  // alias and rewrite whatever else shares those bytes. The link count is what refuses it, without the
  // tool having to guess which other file it is.
  const root = sandbox();
  const plan = planGearIntake(sampleOptions({ root }));
  const source = join(root, SAMPLE_SOURCE);
  mkdirSync(join(root, REDUCED_DIR), { recursive: true });
  linkSync(source, join(root, plan.reducedRepoPath));
  assert.equal(statSync(source).nlink, 2, 'fixture must be a hard link');

  const { calls, runtime } = sandboxRun(root);
  const before = tree(root);

  // Without --force the existing-file rule refuses the conflict before the link count is even read.
  assert.throws(() => runIntake(sampleOptions({ root }), runtime), (error) => {
    assert.equal(error.code, 'exists');
    assert.match(error.message, /refusing to overwrite without --force/);
    return true;
  });
  // With --force the conflict is permitted, so the shared link is what refuses the run.
  assert.throws(() => runIntake(sampleOptions({ root, force: true }), runtime), (error) => {
    assert.equal(error.code, 'unsafe-output');
    assert.match(error.message, /more than one hard link/);
    assert.ok(error.message.includes(plan.reducedRepoPath), 'the refusal must name the linked path');
    assert.match(error.message, /--force does not override this/);
    return true;
  });

  assert.deepEqual(calls, [], 'no child command may run once a shared file is refused');
  assert.equal(readFileSync(source, 'utf8'), 'SOURCE-GLB-BYTES', 'the source bytes must be untouched');
  assert.equal(statSync(join(root, plan.reducedRepoPath)).nlink, 2,
    'a refused run must leave the link alone rather than breaking it');
  assert.deepEqual(tree(root), before, 'the refusal must leave the tree exactly as it found it');
});

test('a texture sibling or provenance file with more than one hard link is refused even with --force', () => {
  // The hazard is not "the source": a link's other name can be a file this tool has never heard of,
  // anywhere on the machine, so rewriting the path would change bytes outside every owned root. The
  // check therefore reads the count rather than comparing identity with the source, and covers every
  // write target -- the FBX's texture siblings and the converter's provenance record included.
  const cases = [
    { label: 'texture sibling', target: `${FBX_DIR}/DawnwardenSword.texture-0.jpg` },
    { label: 'provenance file', target: PROVENANCE_FILE },
  ];
  for (const { label, target } of cases) {
    const root = sandbox();
    const outside = mkdtempSync(join(tmpdir(), 'gq-gear-outside-'));
    sandboxes.push(outside);
    const outsider = join(outside, 'unrelated-copy.bin');
    writeFileSync(outsider, 'UNRELATED-BYTES');
    mkdirSync(join(root, dirname(target)), { recursive: true });
    linkSync(outsider, join(root, target));
    assert.equal(statSync(outsider).nlink, 2, `${label} fixture must be a hard link`);

    const { calls, runtime } = sandboxRun(root, { textures: { 'DawnwardenSword.texture-0.jpg': 'NEW' } });
    const before = tree(root);
    assert.throws(() => runIntake(sampleOptions({ root, force: true }), runtime), (error) => {
      assert.equal(error.code, 'unsafe-output');
      assert.match(error.message, /more than one hard link/);
      assert.ok(error.message.includes(target), `the refusal must name the ${label}`);
      return true;
    });

    assert.deepEqual(calls, [], 'no child command may run once a shared file is refused');
    assert.equal(readFileSync(outsider, 'utf8'), 'UNRELATED-BYTES',
      `the ${label}'s other name must be untouched`);
    assert.deepEqual(tree(root), before, 'the refusal must leave the tree exactly as it found it');

    // The same result at the unit seam the run drives, so the check is pinned independently of the
    // order the run happens to call it in.
    const direct = planGearIntake(sampleOptions({ root }));
    assert.deepEqual(sharedLinkTargets(direct, defaultRuntime()).map((entry) => entry.repoPath), [target]);
    assert.throws(() => assertNoSharedWriteTargets(direct, defaultRuntime()), /more than one hard link/);
  }
});

test('a texture sibling that is a symlink is refused, with and without --force, and writes nothing through it', () => {
  // Live and dangling: a dangling symlink is invisible to existsSync, so only lstat-based confinement
  // refuses it before the converter would create a file wherever it points.
  for (const force of [false, true]) {
    for (const dangling of [false, true]) {
      const root = sandbox();
      const outside = mkdtempSync(join(tmpdir(), 'gq-gear-outside-'));
      sandboxes.push(outside);
      const decoy = join(outside, 'texture-decoy.png');
      if (!dangling) writeFileSync(decoy, 'DECOY-TEXTURE');
      mkdirSync(join(root, FBX_DIR), { recursive: true });
      const texture = join(root, FBX_DIR, 'DawnwardenSword.texture-1.png');
      symlinkSync(dangling ? join(outside, 'missing.png') : decoy, texture);

      const { calls, runtime } = sandboxRun(root);
      const before = tree(root);
      assert.throws(() => runIntake(sampleOptions({ root, force }), runtime), (error) => {
        // Without --force the existing-file rule refuses it first; with --force confinement has to.
        if (force) {
          assert.equal(error.code, 'unsafe-output');
          assert.match(error.message, /already exists as a symlink/);
        } else {
          assert.equal(error.code, 'exists');
          assert.match(error.message, /refusing to overwrite without --force/);
        }
        return true;
      });

      assert.deepEqual(calls, []);
      assert.equal(lstatSync(texture).isSymbolicLink(), true, 'the refused symlink must be left alone');
      if (!dangling) assert.equal(readFileSync(decoy, 'utf8'), 'DECOY-TEXTURE');
      assert.deepEqual(tree(root), before, 'the refusal must leave the tree exactly as it found it');
      assert.deepEqual(readdirSync(outside), dangling ? [] : ['texture-decoy.png'],
        'no bytes may be created outside the checkout');
    }
  }
});

test('a provenance record that is a symlink is refused, with and without --force, and writes nothing through it', () => {
  // The converter rewrites this file, so a symlink here would carry a write out of the checkout even
  // though the file is not one of this tool's three declared outputs.
  for (const force of [false, true]) {
    for (const dangling of [false, true]) {
      const root = sandbox();
      const outside = mkdtempSync(join(tmpdir(), 'gq-gear-outside-'));
      sandboxes.push(outside);
      const decoy = join(outside, 'provenance-decoy.json');
      if (!dangling) writeFileSync(decoy, 'DECOY-PROVENANCE');
      mkdirSync(join(root, dirname(PROVENANCE_FILE)), { recursive: true });
      symlinkSync(dangling ? join(outside, 'missing.json') : decoy, join(root, PROVENANCE_FILE));

      const { calls, runtime } = sandboxRun(root);
      const before = tree(root);
      assert.throws(() => runIntake(sampleOptions({ root, force }), runtime), (error) => {
        assert.equal(error.code, 'unsafe-output');
        assert.match(error.message, /already exists as a symlink/);
        return true;
      });

      assert.deepEqual(calls, [], 'no child command may run once a write target is refused');
      assert.equal(lstatSync(join(root, PROVENANCE_FILE)).isSymbolicLink(), true);
      if (!dangling) assert.equal(readFileSync(decoy, 'utf8'), 'DECOY-PROVENANCE');
      assert.deepEqual(tree(root), before, 'the refusal must leave the tree exactly as it found it');
      assert.deepEqual(readdirSync(outside), dangling ? [] : ['provenance-decoy.json'],
        'no bytes may be created outside the checkout');
    }
  }
});

// --- transactional rollback ----------------------------------------------------------------------

test('a failing child rolls back: the overwritten FBX and provenance file come back byte-for-byte', () => {
  const root = sandbox();
  const plan = planGearIntake(sampleOptions({ root }));
  // A valid document with a different id, so the run is held to the existing-output rule rather than
  // to the duplicate-semantic-id one.
  const provenance = putProvenance(root, [provenanceRecord('gear.shield.ironwood')]);
  const fbx = put(root, plan.fbxRepoPath, 'ORIGINAL-FBX-BYTES');
  const provenanceBefore = readFileSync(provenance);
  const fbxBefore = readFileSync(fbx);
  const before = tree(root);
  const beforeBackups = new Set(backupDirs());

  // --force, so the run is allowed to replace the existing FBX; the fake converter then writes its
  // own bytes and fails, which is exactly the half-finished state a rollback exists for.
  const { calls, runtime } = sandboxRun(root, { failAt: 'convert-fbx', fbx: 'PARTIAL-FBX-BYTES' });
  assert.throws(() => runIntake(sampleOptions({ root, force: true }), runtime), (error) => {
    assert.match(error.message, /fake converter exited 1/);
    assert.match(error.message, /rolled back: no outputs or backups remain/);
    return true;
  });

  assert.deepEqual(calls, ['report-source', 'decimate', 'report-reduced', 'convert-fbx']);
  assert.deepEqual(tree(root), before, 'a failed run may not leave any new file or directory behind');
  assert.deepEqual(readFileSync(fbx), fbxBefore, 'the replaced FBX must come back byte-for-byte');
  assert.deepEqual(readFileSync(provenance), provenanceBefore, 'the provenance file must come back byte-for-byte');
  assert.ok(!existsSync(join(root, plan.reducedRepoPath)), 'the reduced GLB this run created must be deleted');
  assert.ok(!existsSync(join(root, plan.recordRepoPath)));
  assert.deepEqual(backupDirs().filter((name) => !beforeBackups.has(name)), [], 'the backup directory must be removed');
});

test('a rollback that itself fails reports the incomplete rollback instead of claiming nothing remains', () => {
  // The honest failure mode: when the restore is what breaks, the tool must not also assert the
  // guarantee the restore exists to deliver. Only the rollback failure is added to the reason.
  const root = sandbox();
  const plan = planGearIntake(sampleOptions({ root }));
  put(root, plan.fbxRepoPath, 'ORIGINAL-FBX-BYTES');
  putProvenance(root, [provenanceRecord('gear.shield.ironwood')]);
  const beforeBackups = new Set(backupDirs());

  const { runtime } = sandboxRun(root, { failAt: 'convert-fbx', fbx: 'PARTIAL-FBX-BYTES' });
  let copies = 0;
  const failing = {
    ...runtime,
    copyFile: (from, to) => {
      copies += 1;
      // The first two copies are the pre-run backups; every later copy is a rollback restore.
      if (copies > 2) throw new Error('restore failed: EACCES');
      runtime.copyFile(from, to);
    },
  };

  assert.throws(() => runIntake(sampleOptions({ root, force: true }), failing), (error) => {
    assert.match(error.message, /fake converter exited 1/);
    assert.match(error.message, /WARNING: rollback itself failed: restore failed: EACCES/);
    assert.doesNotMatch(error.message, /no outputs or backups remain/,
      'an incomplete rollback must not also claim the transaction guarantee');
    return true;
  });

  // A rollback that threw cannot clean up after itself, so the test does it rather than leaking the
  // backup directory into os.tmpdir() for the rest of the suite.
  for (const name of backupDirs().filter((entry) => !beforeBackups.has(entry))) {
    rmSync(join(tmpdir(), name), { recursive: true, force: true });
  }
});

test('a failed record write rolls back the converted FBX, its textures and the provenance file', () => {
  const root = sandbox();
  const plan = planGearIntake(sampleOptions({ root }));
  const provenance = putProvenance(root, [provenanceRecord('gear.shield.ironwood')]);
  const provenanceBefore = readFileSync(provenance);
  const before = tree(root);
  const beforeBackups = new Set(backupDirs());

  const { runtime } = sandboxRun(root, { textures: { 'DawnwardenSword.texture-0.jpg': 'TEX-0' } });
  const failing = {
    ...runtime,
    writeFile: (path, data) => {
      if (path === plan.recordPath) throw new Error('disk full writing the intake record');
      runtime.writeFile(path, data);
    },
  };

  assert.throws(() => runIntake(sampleOptions({ root }), failing), (error) => {
    assert.match(error.message, /disk full writing the intake record/);
    assert.match(error.message, /rolled back: no outputs or backups remain/);
    return true;
  });

  assert.deepEqual(tree(root), before, 'every file the run created must be gone and the rest restored');
  assert.deepEqual(readFileSync(provenance), provenanceBefore, 'provenance must be restored byte-for-byte');
  assert.ok(!existsSync(join(root, FBX_DIR)), 'the created FBX directory must be taken back out');
  assert.deepEqual(backupDirs().filter((name) => !beforeBackups.has(name)), []);
});

test('an over-budget reduction removes the reduced GLB and writes nothing else', () => {
  const root = sandbox();
  const plan = planGearIntake(sampleOptions({ root }));
  const before = tree(root);

  const { calls, runtime } = sandboxRun(root, {
    reducedReport: { ...REDUCED_REPORT, triangles: 1800 },
  });
  assert.throws(() => runIntake(sampleOptions({ root }), runtime), (error) => {
    assert.equal(error.code, 'budget');
    assert.match(error.message, /1800 triangles, over the 1500 budget/);
    assert.match(error.message, /rolled back: no outputs or backups remain/);
    return true;
  });

  assert.deepEqual(calls, ['report-source', 'decimate', 'report-reduced'], 'the converter must not run');
  assert.ok(!existsSync(join(root, plan.reducedRepoPath)), 'the over-budget GLB must not survive the run');
  assert.ok(!existsSync(join(root, plan.recordRepoPath)));
  assert.deepEqual(tree(root), before);
});

test('an unreadable triangle count fails closed and rolls the reduced GLB back', () => {
  const root = sandbox();
  const plan = planGearIntake(sampleOptions({ root }));

  const { runtime } = sandboxRun(root, {
    reducedReport: { triangles: 0, vertices: 0, unknownTrianglePrimitives: 1 },
  });
  assert.throws(() => runIntake(sampleOptions({ root }), runtime), (error) => {
    assert.equal(error.code, 'budget');
    assert.match(error.message, /cannot claim the 1500 triangle budget/);
    return true;
  });
  assert.ok(!existsSync(join(root, plan.reducedRepoPath)));
  assert.ok(!existsSync(join(root, plan.recordRepoPath)));
});

test('a report whose JSON shape is not the documented one fails closed', () => {
  // --json prints an array, one entry per requested file. Reading `triangles` off a bare object would
  // have made the budget gate compare `undefined > budget` and pass every reduction, so the shape is
  // rejected rather than trusted.
  const root = sandbox();
  const plan = planGearIntake(sampleOptions({ root }));
  const { runtime } = sandboxRun(root, {
    reducedReport: { ...REDUCED_REPORT, triangles: 9999 },
    wrapReports: false,
  });
  assert.throws(() => runIntake(sampleOptions({ root }), runtime), (error) => {
    assert.equal(error.code, 'report');
    assert.match(error.message, /did not report exactly one triangle count/);
    return true;
  });
  assert.ok(!existsSync(join(root, plan.recordRepoPath)));
});

// --- texture siblings ----------------------------------------------------------------------------

test('an existing texture sibling is refused without --force', () => {
  const root = sandbox();
  const plan = planGearIntake(sampleOptions({ root }));
  // Index 2, not 0: the converter numbers textures by Blender image index, so a conflict check that
  // only looked for `.texture-0.jpg` would miss this one.
  const texture = `${FBX_DIR}/DawnwardenSword.texture-2.png`;
  put(root, texture, 'EXISTING-TEXTURE');

  const { calls, runtime } = sandboxRun(root);
  assert.throws(() => runIntake(sampleOptions({ root }), runtime), (error) => {
    assert.equal(error.code, 'exists');
    assert.match(error.message, /refusing to overwrite without --force/);
    assert.ok(error.message.includes(texture), 'the refusal must name the texture sibling');
    return true;
  });
  assert.deepEqual(calls, [], 'the refusal must happen before any command runs');
  assert.equal(readFileSync(join(root, texture), 'utf8'), 'EXISTING-TEXTURE');

  const dry = sandboxRun(root);
  const outcome = runIntake(sampleOptions({ root, dryRun: true }), dry.runtime);
  assert.match(dry.logs.join('\n'), /already present — a real run refuses this without --force/);
  assert.ok(dry.logs.join('\n').includes(texture));

  // --force accepts the conflict, backs the texture up, and replaces it on a successful run.
  const forced = sandboxRun(root, { textures: { 'DawnwardenSword.texture-2.png': 'NEW-TEXTURE' } });
  const result = runIntake(sampleOptions({ root, force: true }), forced.runtime);
  assert.equal(result.record.status, 'CANDIDATE');
  assert.equal(readFileSync(join(root, texture), 'utf8'), 'NEW-TEXTURE');
});

test('--force overwrites the files this run writes and deletes nothing else', () => {
  // --force is a write permission, not a delete permission. A sibling the converter does not rewrite is
  // still there afterwards: the record names the converter-shaped siblings present after the run, and
  // nothing sweeps a pre-existing file out of the way to make that list convenient.
  const root = sandbox();
  const plan = planGearIntake(sampleOptions({ root }));
  const stale = `${FBX_DIR}/DawnwardenSword.texture-1.png`;
  put(root, plan.fbxRepoPath, 'ORIGINAL-FBX-BYTES');
  put(root, stale, 'STALE-TEXTURE');

  const { calls, runtime } = sandboxRun(root, { textures: { 'DawnwardenSword.texture-0.jpg': 'FRESH-TEXTURE' } });
  const outcome = runIntake(sampleOptions({ root, force: true }), runtime);

  assert.deepEqual(calls, ['report-source', 'decimate', 'report-reduced', 'convert-fbx']);
  assert.equal(readFileSync(join(root, plan.fbxRepoPath), 'utf8'), 'NEW-FBX-BYTES', 'the FBX is replaced');
  assert.equal(readFileSync(join(root, `${FBX_DIR}/DawnwardenSword.texture-0.jpg`), 'utf8'), 'FRESH-TEXTURE');
  assert.equal(readFileSync(join(root, stale), 'utf8'), 'STALE-TEXTURE',
    'a sibling this run did not rewrite must still be there, byte-for-byte');
  assert.equal(outcome.record.id, 'gear.sword.dawnwarden');
});

test('a failed forced run leaves a pre-existing sibling in place rather than losing it', () => {
  // The transaction covers the siblings --force may overwrite exactly as it covers an output: a run that
  // fails after the converter started must not cost the operator a file, and it must not delete one to
  // make the record convenient either.
  const root = sandbox();
  const stale = `${FBX_DIR}/DawnwardenSword.texture-1.png`;
  put(root, stale, 'STALE-TEXTURE');
  const before = tree(root);

  const { runtime } = sandboxRun(root, {
    failAt: 'convert-fbx',
    textures: { 'DawnwardenSword.texture-0.jpg': 'FRESH-TEXTURE' },
  });
  assert.throws(() => runIntake(sampleOptions({ root, force: true }), runtime), (error) => {
    assert.match(error.message, /fake converter exited 1/);
    assert.match(error.message, /rolled back: no outputs or backups remain/);
    return true;
  });

  assert.equal(readFileSync(join(root, stale), 'utf8'), 'STALE-TEXTURE',
    'a pre-existing sibling must survive the failed run byte-for-byte');
  assert.ok(!existsSync(join(root, `${FBX_DIR}/DawnwardenSword.texture-0.jpg`)),
    'the texture this run wrote must be deleted');
  assert.deepEqual(tree(root), before);
});

test('a *.meta or foreign texture sibling is refused even with --force, and nothing is deleted', () => {
  // A prefix glob over `<Name>.texture-*` matches a Unity `<Name>.texture-0.jpg.meta`, so the old
  // stale-texture sweep could delete the import metadata of a derivative it was only refreshing. The
  // permission set is now exactly the name the converter writes; everything else is somebody else's
  // file, refused by name for the operator to move, with or without --force.
  const foreign = [
    'DawnwardenSword.texture-0.jpg.meta',
    'DawnwardenSword.texture-1.png.meta',
    'DawnwardenSword.texture-1.tga',
    'DawnwardenSword.texture-x.png',
    'DawnwardenSword.texture-0.jpg.orig',
  ];
  for (const force of [false, true]) {
    const root = sandbox();
    for (const name of foreign) put(root, `${FBX_DIR}/${name}`, `UNTOUCHED:${name}`);
    // One sibling in the shape the converter does write, so this is a refusal of the foreign names
    // rather than a blanket refusal of the directory.
    put(root, `${FBX_DIR}/DawnwardenSword.texture-7.png`, 'CONVERTER-SHAPED');

    const { calls, runtime } = sandboxRun(root, { textures: { 'DawnwardenSword.texture-7.png': 'NEW' } });
    const before = tree(root);
    assert.throws(() => runIntake(sampleOptions({ root, force }), runtime), (error) => {
      assert.equal(error.code, 'foreign-sibling');
      for (const name of foreign) assert.ok(error.message.includes(`${FBX_DIR}/${name}`), error.message);
      assert.match(error.message, /Move them out of the way yourself/);
      assert.match(error.message, /never let a tool delete it/, '.meta guidance must be explicit');
      assert.match(error.message, /--force does not change that/);
      return true;
    });

    assert.deepEqual(calls, [], 'nothing may run while a foreign sibling is present');
    assert.deepEqual(tree(root), before, 'a refused run must not create, move or delete anything');
    for (const name of foreign) {
      assert.equal(readFileSync(join(root, FBX_DIR, name), 'utf8'), `UNTOUCHED:${name}`,
        `${name} must survive byte-for-byte`);
    }
    assert.equal(readFileSync(join(root, `${FBX_DIR}/DawnwardenSword.texture-7.png`), 'utf8'), 'CONVERTER-SHAPED',
      'a refused run writes nothing, not even over a replaceable sibling');
  }
});

test('the sibling permission set is the converter name shape and nothing else', () => {
  // The two sets have to be exhaustive and disjoint: everything the prefix matches is either a file
  // this run may overwrite or a file it must refuse, so nothing can fall between them.
  const root = sandbox();
  const plan = planGearIntake(sampleOptions({ root }));
  put(root, `${FBX_DIR}/DawnwardenSword.texture-0.jpg`, 'A');
  put(root, `${FBX_DIR}/DawnwardenSword.texture-12.jpeg`, 'B');
  put(root, `${FBX_DIR}/DawnwardenSword.texture-0.png`, 'C');
  put(root, `${FBX_DIR}/DawnwardenSword.texture-0.jpg.meta`, 'D');
  put(root, `${FBX_DIR}/DawnwardenSword.texture-0.PNG.meta`, 'E');
  put(root, `${FBX_DIR}/DawnwardenSword.other.png`, 'F');

  const convertible = converterTextureSiblings(plan).map((sibling) => basename(sibling.path));
  const foreign = foreignTextureSiblings(plan).map((sibling) => basename(sibling.path));
  assert.deepEqual(convertible,
    ['DawnwardenSword.texture-0.jpg', 'DawnwardenSword.texture-0.png', 'DawnwardenSword.texture-12.jpeg']);
  assert.deepEqual(foreign, ['DawnwardenSword.texture-0.PNG.meta', 'DawnwardenSword.texture-0.jpg.meta']);
  for (const name of convertible) assert.ok(CONVERTER_TEXTURE_SIBLING.test(name), `${name} is writable`);
  for (const name of foreign) assert.ok(!CONVERTER_TEXTURE_SIBLING.test(name), `${name} must stay foreign`);
  assert.throws(() => assertNoForeignTextureSiblings(plan), (error) => {
    assert.equal(error.code, 'foreign-sibling');
    return true;
  });
  assert.throws(() => assertNoForeignTextureSiblings(plan), (error) => {
    for (const name of foreign) assert.ok(error.message.includes(name), error.message);
    return true;
  });
});

test('--dry-run names the foreign siblings and the duplicate provenance a real run would refuse on', () => {
  const root = sandbox();
  const meta = `${FBX_DIR}/DawnwardenSword.texture-0.jpg.meta`;
  put(root, meta, 'META');
  putProvenance(root, [provenanceRecord('gear.sword.dawnwarden')]);

  const { runtime, logs } = sandboxRun(root, { textures: { 'DawnwardenSword.texture-0.jpg': 'NEW' } });
  const outcome = runIntake(sampleOptions({ root, dryRun: true }), runtime);
  const printed = logs.join('\n');

  assert.equal(outcome.dryRun, true);
  assert.match(printed, /refused even with --force — not a file this run writes; move them yourself/);
  assert.ok(printed.includes(meta), printed);
  assert.match(printed, /already records gear\.sword\.dawnwarden — a real run refuses this without --force/);
});

test('an existing provenance record for this semantic id is refused without --force and allowed with it', () => {
  // The converter upserts by semantic id, so a second run for the same id replaces the recorded hash and
  // Blender version of the derivative already there. That is a decision the operator states, not a side
  // effect of re-running a command.
  const root = sandbox();
  const record = provenanceRecord('gear.sword.dawnwarden');
  const provenance = putProvenance(root, [provenanceRecord('gear.shield.ironwood'), record]);
  const provenanceBefore = readFileSync(provenance);

  const { calls, runtime } = sandboxRun(root, { textures: { 'DawnwardenSword.texture-0.jpg': 'NEW' } });
  assert.throws(() => runIntake(sampleOptions({ root }), runtime), (error) => {
    assert.equal(error.code, 'provenance-id');
    assert.ok(error.message.includes('gear.sword.dawnwarden'));
    assert.ok(error.message.includes(record.derivativeRepoPath), 'the refusal must name the record it would replace');
    assert.match(error.message, /without --force/);
    assert.doesNotMatch(error.message, /rolled back/);
    return true;
  });
  assert.deepEqual(calls, [], 'the refusal must happen before any child command runs');
  assert.deepEqual(readFileSync(provenance), provenanceBefore, 'a refused run must not rewrite the provenance file');
  assert.equal(existsSync(join(root, FBX_DIR)), false, 'the directory confinement created must be taken back out');

  // The read/refusal pair the run uses, at the unit seam: the record for this id is found, refused
  // without --force, and permitted with it.
  const direct = planGearIntake(sampleOptions({ root }));
  assert.equal(existingProvenanceRecord(direct, defaultRuntime())?.semanticId, 'gear.sword.dawnwarden');
  assert.throws(() => assertSemanticIdUnused(direct, defaultRuntime()), (error) => error.code === 'provenance-id');
  assert.doesNotThrow(() => assertSemanticIdUnused(direct, defaultRuntime(), { force: true }));

  // --force accepts the replacement, and the converter's own upsert then rewrites the file.
  const forced = sandboxRun(root, { textures: { 'DawnwardenSword.texture-0.jpg': 'NEW' } });
  const outcome = runIntake(sampleOptions({ root, force: true }), forced.runtime);
  assert.equal(outcome.record.id, 'gear.sword.dawnwarden');
  assert.deepEqual(forced.calls, ['report-source', 'decimate', 'report-reduced', 'convert-fbx']);
});

test('a provenance file with another id does not refuse the run, and an unreadable one does', () => {
  // Only the id this run would replace is a refusal; an unrelated record sitting in the same file is
  // ordinary provenance the converter merges around.
  const root = sandbox();
  putProvenance(root, [provenanceRecord('gear.shield.ironwood')]);
  const clean = sandboxRun(root, { textures: { 'DawnwardenSword.texture-0.jpg': 'NEW' } });
  const outcome = runIntake(sampleOptions({ root }), clean.runtime);
  assert.equal(outcome.record.id, 'gear.sword.dawnwarden');

  for (const content of ['NOT JSON AT ALL', '{"records": "not an array"}', '{"schema":"x"}']) {
    const broken = sandbox();
    const file = put(broken, PROVENANCE_FILE, content);
    const { calls, runtime } = sandboxRun(broken);
    // --dry-run reads the file too, and --force is no help: the converter merges into this file, so a
    // file it cannot merge into has to be fixed or removed first.
    for (const options of [{ root: broken, dryRun: true }, { root: broken }, { root: broken, force: true }]) {
      assert.throws(() => runIntake(sampleOptions(options), runtime), (error) => {
        assert.equal(error.code, 'provenance');
        assert.match(error.message, /fix or remove it before running|fix or remove the file before running/);
        return true;
      });
    }
    assert.deepEqual(calls, [], 'an unreadable provenance file must stop the run before any child command');
    assert.equal(readFileSync(file, 'utf8'), content, 'the unreadable file must be left exactly as it was');
  }
});

test('the record lists every texture sibling the converter wrote, sorted, with hash and size', () => {
  const root = sandbox();
  const textureData = {
    // Deliberately out of order and skipping index 0, so sorting and the directory scan are both real.
    'DawnwardenSword.texture-3.jpg': 'TEXTURE-THREE',
    'DawnwardenSword.texture-0.jpg': 'TEXTURE-ZERO',
    'DawnwardenSword.texture-11.png': 'TEXTURE-ELEVEN',
  };
  const { runtime } = sandboxRun(root, { textures: textureData });
  const { record, plan } = runIntake(sampleOptions({ root }), runtime);

  assert.deepEqual(record.fbx.textures.map((entry) => entry.repoPath), [
    `${FBX_DIR}/DawnwardenSword.texture-0.jpg`,
    `${FBX_DIR}/DawnwardenSword.texture-11.png`,
    `${FBX_DIR}/DawnwardenSword.texture-3.jpg`,
  ]);
  for (const entry of record.fbx.textures) {
    const name = entry.repoPath.slice(`${FBX_DIR}/`.length);
    assert.equal(entry.sha256, createHash('sha256').update(textureData[name]).digest('hex'));
    assert.equal(entry.sizeBytes, Buffer.byteLength(textureData[name]));
  }
  assert.equal(record.fbx.repoPath, plan.fbxRepoPath);
  // The provenance file the converter writes is not one of this tool's outputs and is not listed as one.
  assert.ok(!record.fbx.textures.some((entry) => entry.repoPath.endsWith('.json')));
});

test('--dry-run in a sandbox lists the texture pattern and creates nothing', () => {
  const root = sandbox();
  const { runtime, logs } = sandboxRun(root);
  const before = tree(root);

  const outcome = runIntake(sampleOptions({ root, dryRun: true }), runtime);

  assert.equal(outcome.dryRun, true);
  assert.equal(outcome.record, null);
  const printed = logs.join('\n');
  assert.match(printed, /writes — the three output roots/);
  assert.ok(printed.includes('DawnwardenSword.texture-<digits>.<jpg|jpeg|png>'), printed);
  assert.ok(printed.includes(PROVENANCE_FILE), 'the fourth write location must be printed too');
  for (const output of outcome.plan.outputs) assert.ok(printed.includes(output.repoPath), output.repoPath);
  assert.deepEqual(tree(root), before, '--dry-run must not create or change anything');
});

// --- the real run and its record -----------------------------------------------------------------

test('a real run in a sandbox writes the reduced GLB, the FBX and one CANDIDATE record', () => {
  const root = sandbox();
  const beforeBackups = new Set(backupDirs());
  const { calls, runtime } = sandboxRun(root, {
    textures: { 'DawnwardenSword.texture-0.jpg': 'TEX-0' },
  });
  const outcome = runIntake(sampleOptions({ root }), runtime);
  const plan = outcome.plan;

  // Order matters: the reduced GLB is hashed and converted only after its budget passed.
  assert.deepEqual(calls, ['report-source', 'decimate', 'report-reduced', 'convert-fbx']);
  assert.equal(readFileSync(join(root, plan.reducedRepoPath), 'utf8'), 'REDUCED-GLB-BYTES');
  assert.equal(readFileSync(join(root, plan.fbxRepoPath), 'utf8'), 'NEW-FBX-BYTES');
  assert.equal(readFileSync(join(root, PROVENANCE_FILE), 'utf8'), 'CONVERTER-WROTE-PROVENANCE');

  const written = readFileSync(join(root, plan.recordRepoPath), 'utf8');
  const record = JSON.parse(written);
  assert.equal(written, `${JSON.stringify(record, null, 2)}\n`, 'the record file is the serialized record');
  assert.equal(record.schema, 'galaquest.gear-intake-record');
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.id, 'gear.sword.dawnwarden');
  assert.equal(record.status, 'CANDIDATE');
  assert.equal(record.triangleBudget, 1500);
  assert.equal(record.fit, 'UNKNOWN');
  assert.equal(record.cavity, 'UNKNOWN');
  assert.equal(record.visual, 'UNKNOWN');
  assert.equal(record.source.repoPath, SAMPLE_SOURCE);
  assert.equal(record.source.triangles, 68004);
  assert.equal(record.source.sha256, createHash('sha256').update('SOURCE-GLB-BYTES').digest('hex'));
  assert.equal(record.reduced.repoPath, plan.reducedRepoPath);
  assert.equal(record.reduced.triangles, 1500);
  assert.equal(record.reduced.sha256, createHash('sha256').update('REDUCED-GLB-BYTES').digest('hex'));
  assert.equal(record.fbx.repoPath, plan.fbxRepoPath);
  assert.equal(record.fbx.sha256, createHash('sha256').update('NEW-FBX-BYTES').digest('hex'));
  assert.equal(record.blender.version, '4.5.13 LTS');
  assert.equal(record.blender.pinnedVersion, '4.5.13');
  assert.deepEqual(record.commands, plan.commands.map((entry) => entry.display),
    'the record must name the commands that actually ran, in order');

  assert.deepEqual(backupDirs().filter((name) => !beforeBackups.has(name)), [],
    'a successful run removes its backup directory');
});

test('the record is byte-stable and carries no timestamp', () => {
  // Two identical inputs must produce an identical record; a diff then means the inputs differed.
  const run = () => {
    const root = sandbox();
    const { runtime } = sandboxRun(root);
    return runIntake(sampleOptions({ root }), runtime);
  };
  const first = run();
  const second = run();
  const firstBytes = readFileSync(join(first.plan.root, first.plan.recordRepoPath));
  const secondBytes = readFileSync(join(second.plan.root, second.plan.recordRepoPath));
  assert.deepEqual(firstBytes, secondBytes);
  assert.deepEqual(first.record, second.record);

  const serialized = firstBytes.toString('utf8');
  assert.doesNotMatch(serialized, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'no ISO timestamp');
  for (const key of ['timestamp', 'generatedAt', 'date', 'createdAt']) {
    assert.ok(!serialized.includes(`"${key}"`), `record must not carry ${key}`);
  }
});

test('the record builder is pure and states UNKNOWN rather than inventing a fit result', () => {
  const plan = planGearIntake(sampleOptions());
  const record = buildIntakeRecord({
    plan,
    source: { repoPath: SAMPLE_SOURCE, sha256: 'a'.repeat(64), sizeBytes: 1, triangles: 10, vertices: 8 },
    reduced: { repoPath: plan.reducedRepoPath, sha256: 'b'.repeat(64), sizeBytes: 2, triangles: 5, vertices: 4 },
    fbx: { repoPath: plan.fbxRepoPath, sha256: 'c'.repeat(64), sizeBytes: 3 },
    blender: { version: '4.5.13 LTS', pinnedVersion: '4.5.13' },
    commands: ['node x'],
  });
  assert.equal(record.status, 'CANDIDATE');
  assert.deepEqual([record.fit, record.cavity, record.visual], ['UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  assert.ok(!('textures' in record.fbx), 'no texture siblings means no textures key');
});
