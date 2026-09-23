import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  GEAR_CONVERT_TOOL,
  GLB_REPORT_TOOL,
  INTAKE_RECORD_DIR,
  OUTPUT_ROOTS,
  PASCAL_NAME_PATTERN,
  REPO_ROOT,
  assertOutputPathAllowed,
  assertOutputsAbsent,
  assertSourceExists,
  buildIntakeRecord,
  kebabCase,
  parseArgs,
  planGearIntake,
  runIntake,
} from '../tools/assets/gear-intake.mjs';

// tools/assets/gear-intake.mjs turns one generated rigid-gear GLB into a Unity-ready candidate with
// one command. The value of that command is that it is the same sequence every time and that it
// writes down what it actually did, so these tests pin the two things a silent edit would break:
// the planned paths/commands, and the rules that stop a run from overwriting evidence.
//
// Nothing here needs Blender. Blender runs are the runner's job on a machine that has it; what a
// unit test can honestly prove is that the plan, the refusals and the record are correct.

const repoPath = (...parts) => resolve(REPO_ROOT, ...parts);
const SAMPLE_SOURCE = 'public/assets/gear/candidates/dawnwarden-sword-v1.glb';

const sampleOptions = (overrides = {}) => ({
  source: SAMPLE_SOURCE,
  id: 'gear.sword.dawnwarden',
  name: 'DawnwardenSword',
  tris: 1500,
  ...overrides,
});

/**
 * A structural stand-in for the real side effects: no child process, no filesystem.
 *
 * The default pre-state is what a real first run sees -- the candidate exists and nothing has been
 * written yet -- so a test overrides `present` only to stage the condition it is actually about.
 */
function fakeRuntime({
  present = (path) => path === repoPath(SAMPLE_SOURCE),
  reports = {},
  blender = '4.5.13 LTS',
  wrapReports = true,
} = {}) {
  const calls = { run: [], mkdir: [], write: [], log: [] };
  return {
    calls,
    exists: (path) => present(path),
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
      return JSON.stringify(wrapReports ? [report] : report);
    },
  };
}

const sourceReport = { triangles: 68004, vertices: 38601, unknownTrianglePrimitives: 0 };
const reducedReport = { triangles: 1500, vertices: 900, unknownTrianglePrimitives: 0 };

test('a sample plan names the exact output paths and the exact commands', () => {
  const plan = planGearIntake(sampleOptions());

  assert.equal(plan.id, 'gear.sword.dawnwarden');
  assert.equal(plan.kebab, 'dawnwarden-sword');
  assert.equal(plan.sourceDisplay, SAMPLE_SOURCE);
  assert.equal(plan.reducedRepoPath, 'unity/GalaQuest/GearSources/dawnwarden-sword-lod.glb');
  assert.equal(plan.fbxRepoPath, 'unity/GalaQuest/Assets/GalaQuest/Gear/SourceAssets/DawnwardenSword.fbx');
  assert.equal(plan.recordRepoPath, 'docs/asset-production/intake/gear.sword.dawnwarden.json');

  assert.deepEqual(plan.commands.map((entry) => entry.step),
    ['report-source', 'decimate', 'report-reduced', 'convert-fbx']);
  assert.deepEqual(plan.commands.map((entry) => entry.display), [
    `node ${GLB_REPORT_TOOL} --json ${SAMPLE_SOURCE}`,
    'blender --background --factory-startup --python tools/blender/decimate_gear.py -- '
      + `${SAMPLE_SOURCE} unity/GalaQuest/GearSources/dawnwarden-sword-lod.glb 1500`,
    `node ${GLB_REPORT_TOOL} --json unity/GalaQuest/GearSources/dawnwarden-sword-lod.glb`,
    `node ${GEAR_CONVERT_TOOL} --source unity/GalaQuest/GearSources/dawnwarden-sword-lod.glb `
      + '--dest unity/GalaQuest/Assets/GalaQuest/Gear/SourceAssets/DawnwardenSword.fbx '
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
    SAMPLE_SOURCE, 'unity/GalaQuest/GearSources/dawnwarden-sword-lod.glb', '1500',
  ]);
});

test('a custom --blender is used for the reduction and passed through to the converter', () => {
  const plan = planGearIntake(sampleOptions({ blender: '/opt/blender-4.5.13/blender' }));
  const [decimate] = plan.commands.filter((entry) => entry.step === 'decimate');
  const [convert] = plan.commands.filter((entry) => entry.step === 'convert-fbx');
  assert.equal(decimate.file, '/opt/blender-4.5.13/blender');
  assert.deepEqual(convert.args.slice(-2), ['--blender', '/opt/blender-4.5.13/blender']);
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

test('a missing source is refused before anything runs', () => {
  const plan = planGearIntake(sampleOptions({ source: 'public/assets/gear/candidates/nope.glb' }));
  assert.throws(() => assertSourceExists(plan), /--source not found/);

  const runtime = fakeRuntime({ present: () => false });
  assert.throws(() => runIntake(sampleOptions({ source: 'public/assets/gear/candidates/nope.glb' }), runtime),
    /--source not found/);
  assert.deepEqual(runtime.calls.run, []);
});

test('--dry-run prints the plan and runs, writes and creates nothing', () => {
  const runtime = fakeRuntime();
  const outcome = runIntake(sampleOptions({ dryRun: true }), runtime);

  assert.equal(outcome.dryRun, true);
  assert.equal(outcome.record, null);
  assert.deepEqual(runtime.calls.run, [], 'dry run must not execute a command');
  assert.deepEqual(runtime.calls.write, [], 'dry run must not write');
  assert.deepEqual(runtime.calls.mkdir, [], 'dry run must not create a directory');

  const printed = runtime.calls.log.join('\n');
  for (const entry of outcome.plan.commands) {
    assert.ok(printed.includes(entry.display), `dry run must print the exact command: ${entry.display}`);
  }
  for (const output of outcome.plan.outputs) {
    assert.ok(printed.includes(output.repoPath), `dry run must print the output path ${output.repoPath}`);
  }
});

test('--dry-run reports existing outputs as information instead of failing', () => {
  const plan = planGearIntake(sampleOptions());
  const runtime = fakeRuntime({ present: (path) => path === plan.reducedPath || path === plan.sourcePath });
  const outcome = runIntake(sampleOptions({ dryRun: true }), runtime);

  assert.equal(outcome.dryRun, true);
  assert.deepEqual(runtime.calls.write, []);
  assert.match(runtime.calls.log.join('\n'), /already present — a real run refuses this without --force/);
});

test('a real run writes one CANDIDATE record that claims no fit, cavity or visual result', () => {
  const runtime = fakeRuntime({ reports: { 'report-source': sourceReport, 'report-reduced': reducedReport } });
  const outcome = runIntake(sampleOptions(), runtime);

  // Order matters: the reduced GLB is hashed and converted only after its budget passed.
  assert.deepEqual(runtime.calls.run, ['report-source', 'decimate', 'report-reduced', 'convert-fbx']);
  assert.equal(runtime.calls.write.length, 1, 'exactly one file is written by this tool');

  const record = outcome.record;
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
  assert.equal(record.reduced.repoPath, 'unity/GalaQuest/GearSources/dawnwarden-sword-lod.glb');
  assert.equal(record.reduced.triangles, 1500);
  assert.equal(record.fbx.repoPath, 'unity/GalaQuest/Assets/GalaQuest/Gear/SourceAssets/DawnwardenSword.fbx');
  assert.match(record.fbx.sha256, /^[0-9a-f]{64}$/);
  assert.equal(record.blender.version, '4.5.13 LTS');
  assert.equal(record.blender.pinnedVersion, '4.5.13');
  assert.deepEqual(record.commands, outcome.plan.commands.map((entry) => entry.display),
    'the record must name the commands that actually ran, in order');

  const written = runtime.calls.write[0];
  assert.equal(written.path, repoPath(INTAKE_RECORD_DIR, 'gear.sword.dawnwarden.json'));
  assert.equal(written.data, `${JSON.stringify(record, null, 2)}\n`);
  assert.equal(runtime.calls.mkdir[0], dirname(written.path));
});

test('the record is byte-stable and carries no timestamp', () => {
  // Two identical inputs must produce an identical record; a diff then means the inputs differed.
  const runtime = () => fakeRuntime({ reports: { 'report-source': sourceReport, 'report-reduced': reducedReport } });
  const first = runIntake(sampleOptions(), runtime()).record;
  const second = runIntake(sampleOptions(), runtime()).record;
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));

  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'no ISO timestamp');
  for (const key of ['timestamp', 'generatedAt', 'date', 'createdAt']) {
    assert.ok(!serialized.includes(`"${key}"`), `record must not carry ${key}`);
  }
});

test('the record includes the FBX texture sibling the converter writes, when it exists', () => {
  const texturePath = repoPath('unity/GalaQuest/Assets/GalaQuest/Gear/SourceAssets/DawnwardenSword.texture-0.jpg');
  const runtime = fakeRuntime({
    reports: { 'report-source': sourceReport, 'report-reduced': reducedReport },
    present: (path) => path === texturePath || path === repoPath(SAMPLE_SOURCE),
  });
  const { record } = runIntake(sampleOptions(), runtime);
  assert.equal(record.fbx.texture.repoPath,
    'unity/GalaQuest/Assets/GalaQuest/Gear/SourceAssets/DawnwardenSword.texture-0.jpg');
  assert.match(record.fbx.texture.sha256, /^[0-9a-f]{64}$/);
});

test('a reduction over budget fails without converting or writing a record', () => {
  const runtime = fakeRuntime({
    reports: { 'report-source': sourceReport, 'report-reduced': { ...reducedReport, triangles: 1800 } },
  });
  assert.throws(() => runIntake(sampleOptions(), runtime), /1800 triangles, over the 1500 budget/);
  assert.deepEqual(runtime.calls.run, ['report-source', 'decimate', 'report-reduced']);
  assert.deepEqual(runtime.calls.write, []);
});

test('an unreadable triangle count fails closed instead of passing the budget', () => {
  const runtime = fakeRuntime({
    reports: { 'report-source': sourceReport, 'report-reduced': { triangles: 0, unknownTrianglePrimitives: 1 } },
  });
  assert.throws(() => runIntake(sampleOptions(), runtime), /cannot claim the 1500 triangle budget/);
  assert.deepEqual(runtime.calls.write, []);
});

test('a report whose JSON shape is not the documented one fails closed', () => {
  // --json prints an array, one entry per requested file. Reading `triangles` off a bare object would
  // have made the budget gate compare `undefined > budget` and pass every reduction, so the shape is
  // rejected rather than trusted.
  const runtime = fakeRuntime({
    reports: { 'report-source': sourceReport, 'report-reduced': { ...reducedReport, triangles: 9999 } },
    wrapReports: false,
  });
  assert.throws(() => runIntake(sampleOptions(), runtime), /did not report exactly one triangle count/);
  assert.deepEqual(runtime.calls.write, []);
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
  assert.ok(!('texture' in record.fbx), 'no texture sibling means no texture key');
});
