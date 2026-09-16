import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONVERTER = fileURLToPath(new URL('../tools/unity-migration/convert-gear-asset.mjs', import.meta.url));

// convert-gear-asset.mjs writes provenance to this path RELATIVE to the process cwd, so every run
// below is rooted in a throwaway directory and can never touch the repo's real provenance file.
const PROVENANCE_RELATIVE =
  'unity/GalaQuest/Assets/GalaQuest/Gear/GearDerivativeProvenance.json';

const STALE_BYTES = 'PREVIOUS DERIVATIVE - built from an older source\n';

// execFileSync cannot launch a .cmd shim on current Node without a shell, and quoting a Windows
// batch fake reliably is more failure surface than the test is worth. CI is ubuntu-latest, which is
// where this gate actually binds.
const posixOnly = { skip: process.platform === 'win32' ? 'POSIX-only fake Blender shim' : false };

/**
 * A stand-in for Blender that reproduces the behaviour this regression exists for.
 *
 * Real Blender exits 0 even when its --python script raises, UNLESS --python-exit-code is passed.
 * So the fake reports success for a conversion it did not perform whenever that flag is missing,
 * and reports the requested failure code when it is present. That asymmetry is the whole point: it
 * makes the assertions below fail against a converter that omits the flag.
 */
function writeFakeBlender(dir, { writesOnSuccess = null } = {}) {
  const path = join(dir, 'fake-blender');
  // A run whose python step raises, versus one that completes and writes the derivative.
  const conversion = writesOnSuccess
    ? `printf 'FRESH DERIVATIVE\\n' > '${writesOnSuccess}'\nexit 0\n`
    : '# The script "raised". Whether that is visible depends entirely on the flag.\n'
      + 'for a in "$@"; do\n'
      + '  if [ "$a" = "--python-exit-code" ]; then exit 42; fi\n'
      + 'done\n'
      + 'exit 0\n';
  writeFileSync(
    path,
    '#!/bin/sh\n'
    + '# --version probe: the converter checks the pinned version before converting.\n'
    + 'for a in "$@"; do\n'
    + '  if [ "$a" = "--version" ]; then echo "Blender 4.5.13"; exit 0; fi\n'
    + 'done\n'
    + conversion,
  );
  chmodSync(path, 0o755);
  return path;
}

function runConverter(cwd, blenderPath, { dest }) {
  return spawnSync(
    process.execPath,
    [CONVERTER, '--source', 'source.glb', '--dest', dest, '--id', 'gear.test.candidate',
      '--blender', blenderPath],
    { cwd, encoding: 'utf8' },
  );
}

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-gear-convert-'));
  writeFileSync(join(dir, 'source.glb'), 'CURRENT SOURCE BYTES\n');
  return dir;
}

test('a Blender python failure over a pre-existing derivative fails loudly and records no provenance',
  posixOnly, () => {
    const dir = makeWorkspace();
    try {
      const dest = 'out/Candidate.fbx';
      mkdirSync(join(dir, dirname(dest)), { recursive: true });
      // The stale derivative an earlier, successful run left behind. This is what makes the bug
      // reachable: the converter's post-conversion check is a bare existence test.
      writeFileSync(join(dir, dest), STALE_BYTES);

      const result = runConverter(dir, writeFakeBlender(dir), { dest });

      assert.notEqual(result.status, 0,
        'a conversion whose python step raised must not exit 0');
      assert.equal(existsSync(join(dir, PROVENANCE_RELATIVE)), false,
        'a failed conversion must not write a provenance record');
      assert.equal(readFileSync(join(dir, dest), 'utf8'), STALE_BYTES,
        'the previous derivative should be left untouched, not silently adopted');
      assert.match(result.stderr, /Provenance was not updated/,
        'the operator must be told the failure left provenance alone');
      assert.match(result.stderr, /PREVIOUS derivative/,
        'the operator must be warned the destination still holds stale bytes');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test('the converter supplies --python-exit-code so Blender cannot report a raised script as success',
  posixOnly, () => {
    const dir = makeWorkspace();
    try {
      // Records the arguments instead of acting on them, so this asserts the flag is really on the
      // command line rather than inferring it from the exit status above.
      const recorder = join(dir, 'recording-blender');
      const argsLog = join(dir, 'args.txt');
      writeFileSync(
        recorder,
        '#!/bin/sh\n'
        + 'for a in "$@"; do\n'
        + '  if [ "$a" = "--version" ]; then echo "Blender 4.5.13"; exit 0; fi\n'
        + 'done\n'
        + `printf '%s\\n' "$@" > '${argsLog}'\n`
        + 'exit 42\n',
      );
      chmodSync(recorder, 0o755);

      runConverter(dir, recorder, { dest: 'out/Candidate.fbx' });

      const args = readFileSync(argsLog, 'utf8').split('\n');
      const flag = args.indexOf('--python-exit-code');
      assert.notEqual(flag, -1, 'tools/foundry/README.md requires --python-exit-code');
      // Pinned to the literal the runbook documents, not to a constant imported from the converter,
      // which would let the two drift together and still pass.
      assert.equal(args[flag + 1], '42', 'the exception code must be nonzero and match the runbook');
      assert.ok(flag < args.indexOf('--python'),
        'the flag must precede --python or Blender ignores it');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test('a successful conversion still records provenance', posixOnly, () => {
  const dir = makeWorkspace();
  try {
    const dest = 'out/Candidate.fbx';
    mkdirSync(join(dir, dirname(dest)), { recursive: true });
    // Positive control. Without it, the failure assertions above would also pass against a
    // converter that refused every conversion for an unrelated reason.
    const result = runConverter(dir, writeFakeBlender(dir, { writesOnSuccess: join(dir, dest) }), { dest });

    assert.equal(result.status, 0, result.stderr);
    const provenance = JSON.parse(readFileSync(join(dir, PROVENANCE_RELATIVE), 'utf8'));
    const record = provenance.records.find((entry) => entry.semanticId === 'gear.test.candidate');
    assert.ok(record, 'a successful conversion records the derivative');
    assert.equal(record.sourceRepoPath, 'source.glb');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
