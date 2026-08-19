#!/usr/bin/env node
/**
 * G27: two clean rebuilds of unchanged input produce the same artifact hash.
 *
 *   node tools/foundry/verify-determinism.mjs foundry/candidates/claude/build_candidate.py
 *
 * Runs the candidate's build script twice into two separate directories and compares the hashes it
 * reports. Two runs into the SAME directory would be a weaker test: a build that silently reused an
 * artifact it had already written would pass.
 *
 * Exits non-zero on any mismatch, and prints which artifact differed. A determinism check that says
 * only "failed" sends you looking through every output by hand.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BLENDER = process.env.BLENDER
  ?? 'blender';

const script = process.argv[2];
if (!script) {
  console.error('usage: node tools/foundry/verify-determinism.mjs <path to build_candidate.py>');
  process.exit(2);
}

// Blender exits 0 even when a --python script raises an unhandled exception. Verified: without this
// flag a script whose only statement is `raise RuntimeError` still returns 0. Any check on Blender's
// exit status is therefore meaningless unless this flag is passed.
const PYTHON_EXIT_CODE = 42;

function build(label) {
  const dir = mkdtempSync(join(tmpdir(), `gq-determinism-${label}-`));
  const run = spawnSync(
    BLENDER,
    [
      '--background', '--factory-startup',
      '--python-exit-code', String(PYTHON_EXIT_CODE),
      '--python', resolve(script), '--', '--out-dir', dir,
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) {
    console.error(`build ${label} failed with exit ${run.status}`);
    console.error(run.stdout ?? '');
    console.error(run.stderr ?? '');
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(join(dir, 'build_report.json'), 'utf8'));
  rmSync(dir, { recursive: true, force: true });
  return report;
}

const first = build('first');
const second = build('second');

const keys = Object.keys(first.determinismHashes);
const mismatched = keys.filter((k) => first.determinismHashes[k] !== second.determinismHashes[k]);

for (const key of keys) {
  const same = first.determinismHashes[key] === second.determinismHashes[key];
  console.log(`  ${same ? 'SAME' : 'DIFF'}  ${key}  ${first.determinismHashes[key].slice(0, 16)}…`);
}

// Recorded, not gated. The .blend is expected to differ; saying so out loud stops the next person
// reading a difference here as a determinism failure.
const blendSame = first.notDeterminismCriteria.rawBlendSha256 === second.notDeterminismCriteria.rawBlendSha256;
console.log(`  ${blendSame ? 'SAME' : 'DIFF'}  rawBlendSha256 (not a criterion — .blend embeds volatile state)`);

if (mismatched.length > 0) {
  console.log(`\nG27 FAILED: ${mismatched.join(', ')} differ between two clean rebuilds.`);
  process.exit(1);
}
console.log(`\nG27 PASSED: ${keys.length} shipping artifacts are byte-identical across two clean rebuilds.`);
