// Phase RP1. The review suites are a list of filenames, and a list of filenames goes stale the
// first time somebody renames a harness. These pin it mechanically, so a rename fails here in eight
// seconds rather than in a thirty-minute GitHub run that produces an artifact with a hole in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { HARNESSES, SUITES } from '../tools/runtime-test/review-suites.mjs';

const DIR = 'tools/runtime-test';
// Not harnesses: the shared helper modules, the suite table, and the runner itself.
//
// A harness, for this file's purposes, is a thing that RUNS UNATTENDED AND EXITS WITH A VERDICT.
// That is what makes "put it in the full suite" the right default, and what makes forgetting to do
// so a silent hole. Every exemption below is something that cannot satisfy that definition, and
// each has to say why -- an exemption without a stated reason is how this guard would rot.
const NOT_A_HARNESS = new Set([
  'automation-timing.mjs',
  'in-page-driver.mjs',
  'owned-server.mjs',
  'review-suites.mjs',
  'run-review-suite.mjs',
  // Builds in-page JavaScript source for a caller to evaluate, exactly as in-page-driver.mjs does.
  // It drives no browser and asserts nothing; test/playtest-player-view.test.mjs is what proves it.
  'player-view.mjs',
  // The unscripted playtest protocol, exempt for a stronger reason than the helpers above: it
  // BLOCKS ON STDIN waiting for an agent to choose the next action, and it produces a transcript
  // rather than a verdict. In the CI matrix it would hang the job until the timeout and then report
  // a failure that means nothing. What reviews it instead is a person reading the transcript --
  // see docs/agent-playtest.md. The exemption is about attendance, not about importance.
  'playtest-session.mjs',
]);

const onDisk = readdirSync(DIR)
  .filter((f) => f.endsWith('.mjs') && !NOT_A_HARNESS.has(f))
  .map((f) => f.replace(/\.mjs$/, ''));

test('every harness the suites name actually exists on disk', () => {
  for (const [suite, members] of Object.entries(SUITES)) {
    for (const name of members) {
      assert.ok(
        existsSync(`${DIR}/${name}.mjs`),
        `suite "${suite}" names ${name}, which is not in ${DIR}/`,
      );
    }
  }
});

test('every harness named in a suite has metadata saying whether its exit code is a gate', () => {
  for (const [suite, members] of Object.entries(SUITES)) {
    for (const name of members) {
      assert.ok(HARNESSES[name], `suite "${suite}" names ${name}, which has no HARNESSES entry`);
      assert.equal(typeof HARNESSES[name].gate, 'boolean', `${name}.gate must be a boolean`);
      assert.ok(HARNESSES[name].why?.length > 0, `${name} needs a reason it is in a review suite`);
    }
  }
});

test('"full" covers every runtime harness in the directory', () => {
  // The point of "full" is that a reviewer gets the whole running-game picture. A harness added to
  // the directory and forgotten here would silently never be reviewed.
  const missing = onDisk.filter((name) => !SUITES.full.includes(name));
  assert.deepEqual(missing, [], `harnesses on disk but absent from the "full" suite: ${missing.join(', ')}`);
});

test('"full" contains everything the narrower suites contain', () => {
  for (const name of [...SUITES.keeper, ...SUITES.hero]) {
    assert.ok(SUITES.full.includes(name), `${name} is reviewed by a narrow suite but not by "full"`);
  }
});

test('the GitHub full-playtest matrix is exactly the canonical "full" suite, in the same order', () => {
  const workflow = readFileSync('.github/workflows/full-playtest-matrix.yml', 'utf8');
  const matrixBlock = workflow.match(/matrix:\s*\n\s*name:\s*\n([\s\S]*?)\n\s*runs-on:/)?.[1];
  assert.ok(matrixBlock, 'could not find the matrix.name list in full-playtest-matrix.yml');
  const matrixNames = [...matrixBlock.matchAll(/^\s*-\s+([a-z0-9-]+)\s*$/gm)].map((match) => match[1]);
  assert.deepEqual(matrixNames, SUITES.full,
    'CI must run every canonical full-suite harness and no stale/manual substitute list');
});

test('the GitHub matrix fails closed on every non-zero harness exit', () => {
  const workflow = readFileSync('.github/workflows/full-playtest-matrix.yml', 'utf8');
  assert.match(workflow, /run:\s+node tools\/runtime-test\/\$\{\{ matrix\.name \}\}\.mjs/);
  assert.doesNotMatch(workflow, /GATE=|if \[ "\$GATE" = "false" \]/,
    'CI must not turn an instrument crash or infrastructure failure into success');
});

test('the full-playtest workflow runs on pull requests and protected branch pushes', () => {
  const workflow = readFileSync('.github/workflows/full-playtest-matrix.yml', 'utf8');
  assert.match(workflow, /pull_request:/, 'PRs must run the integration matrix before merge');
  // The ratchet is that main is gated on both entry paths -- a push to main and a PR targeting it.
  // It used to name a specific private integration branch as well; that branch does not exist in
  // this repository, so the assertion now checks the invariant rather than one branch's name, which
  // is what it was always protecting.
  assert.match(workflow, /push:\s*\n\s*branches: \[main[^\]]*\]/,
    'pushes to main must run the matrix');
  assert.match(workflow, /pull_request:\s*\n\s*branches: \[main[^\]]*\]/,
    'pull requests targeting main must run the matrix');
});

test('movement-heavy harnesses use wall-clock deadlines instead of sample-count pseudo-timeouts', () => {
  const movementHarnesses = [
    'drive-cart-loot',
    'drive-lifecycle',
    'drive-marks',
    'drive-relight',
    'drive-two-clients',
    'drive-village',
    'play-fight',
  ];
  for (const name of movementHarnesses) {
    const src = readFileSync(`${DIR}/${name}.mjs`, 'utf8');
    assert.match(src, /automation-timing\.mjs/, `${name} must use the shared wall-clock timing helpers`);
    assert.doesNotMatch(src, /maxSamples|maxSteps/,
      `${name} must not convert milliseconds to a number of slow CDP samples`);
  }
});

test('no suite lists the same harness twice, and none is empty', () => {
  for (const [suite, members] of Object.entries(SUITES)) {
    assert.ok(members.length > 0, `suite "${suite}" is empty`);
    assert.equal(new Set(members).size, members.length, `suite "${suite}" repeats a harness`);
  }
});

test('a harness marked as not-a-gate really does exit 0 unconditionally', () => {
  // This is the claim that keeps the runner honest: it reports fit-sword, fit-carry and fit-lantern
  // as INFO rather than PASS. If one of them ever grows a real verdict, this fails and the table
  // must be updated -- rather than the suite quietly under-reporting a genuine failure.
  for (const [name, meta] of Object.entries(HARNESSES)) {
    if (meta.gate) continue;
    const src = readFileSync(`${DIR}/${name}.mjs`, 'utf8');
    const exits = [...src.matchAll(/process\.exit\(([^)]*)\)/g)].map((m) => m[1].trim());
    const meaningful = exits.filter((e) => e !== '0' && e !== '2');
    assert.deepEqual(
      meaningful, [],
      `${name} is marked "not a gate" but exits with ${meaningful.join(', ')} -- give it gate: true`,
    );
  }
});

test('sabotage: a gating harness would be caught exiting conditionally', () => {
  // Without this, the test above passes just as well against a suite where everything is a gate.
  const gating = Object.entries(HARNESSES).filter(([, m]) => m.gate).map(([n]) => n);
  assert.ok(gating.length > 0, 'expected at least one gating harness');
  const conditional = gating.filter((name) => {
    const src = readFileSync(`${DIR}/${name}.mjs`, 'utf8');
    return /process\.exit\((?!0\)|2\))/.test(src);
  });
  assert.ok(
    conditional.length > 0,
    'no gating harness exits conditionally -- the gate/no-gate distinction would be meaningless',
  );
});
