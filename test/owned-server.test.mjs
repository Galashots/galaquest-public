// tools/runtime-test/owned-server.mjs's kill() reliability fix (SR5 closeout, 2026-08-16). Real
// process spawn/kill, not mocked -- the defect this pins (a graceful-only kill() resolving without
// error while the child stayed alive and reachable) was only ever caught by watching the REAL process
// and REAL port, so a mock of child_process would prove nothing about the actual fix. Slower than the
// rest of the unit suite (each test boots a real server.mjs child) but still bounded to a few seconds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createProbeServer } from 'node:net';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { startOwnedServer } from '../tools/runtime-test/owned-server.mjs';

// data/README.md: "Tests must never open a store at a path under `data/`." Before #94's structural
// fix, omitting rewardStorePath inherited the real data/rewards.db. These real server-child tests
// now prove that an omitted path selects an isolated OS-temp store instead, while explicit paths
// remain available for bounded fixtures.
//
// Nothing here is about rewards; this file only pins kill() and port behaviour, so pointing the
// store at an OS-temp path costs the tests nothing and removes them from the family save path.
const storeDir = mkdtempSync(join(tmpdir(), 'galaquest-owned-server-'));
const isolatedStore = () => join(storeDir, 'rewards.db');
const repoDataDir = resolve(import.meta.dirname, '../data');

// Best-effort. On Windows the just-killed child can still hold the file briefly, and a failed
// cleanup of an OS-temp directory must never fail a test about process lifecycle -- that is exactly
// how lantern-xp-award.test.mjs ends up red on Windows.
process.on('exit', () => { try { rmSync(storeDir, { recursive: true, force: true }); } catch {} });

// MUST probe '0.0.0.0', the exact host server.mjs itself binds -- see owned-server.mjs's own portFree()
// for why probing '127.0.0.1' instead silently lies on Windows (the exact bug this test file pins).
function portFree(port) {
  return new Promise((resolve) => {
    const tester = createProbeServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(port, '0.0.0.0');
  });
}

const rewardArtifactsInRepoData = () => readdirSync(repoDataDir)
  .filter((name) => name === 'rewards.db' || /^backup-.*\.db$/.test(name))
  .sort()
  .map((name) => {
    const stat = statSync(join(repoDataDir, name));
    return { name, size: stat.size, mtimeMs: stat.mtimeMs };
  });

const outsideRepoData = (path) => {
  const pathFromData = relative(repoDataDir, path);
  return pathFromData.startsWith('..') || isAbsolute(pathFromData);
};

test('kill() terminates the real owned child and the port is independently confirmed free afterward', async () => {
  const server = await startOwnedServer({ quiet: true, rewardStorePath: isolatedStore() });
  assert.equal(await portFree(server.port), false, 'the server should genuinely be listening before kill()');

  const result = await server.kill();

  assert.equal(result, true, 'kill() should report a trustworthy true, not just "an exit event fired"');
  assert.equal(await portFree(server.port), true, 'the port must be independently verified free, not merely assumed');
});

test('default owned servers receive unique OS-temp reward stores and leave repository data untouched', async () => {
  const beforeArtifacts = rewardArtifactsInRepoData();
  const first = await startOwnedServer({ quiet: true });
  const second = await startOwnedServer({ quiet: true });
  try {
    assert.equal(first.rewardStore.kind, 'temporary');
    assert.equal(second.rewardStore.kind, 'temporary');
    assert.notEqual(first.rewardStore.rewardStorePath, second.rewardStore.rewardStorePath);
    assert.equal(outsideRepoData(first.rewardStore.rewardStorePath), true);
    assert.equal(outsideRepoData(second.rewardStore.rewardStorePath), true);
  } finally {
    await first.kill();
    await second.kill();
  }
  assert.deepEqual(rewardArtifactsInRepoData(), beforeArtifacts);
});

test('an explicit reward-store path remains available without opting into the family store', async () => {
  const beforeArtifacts = rewardArtifactsInRepoData();
  const rewardStorePath = isolatedStore();
  const server = await startOwnedServer({ quiet: true, rewardStorePath });
  try {
    assert.deepEqual(server.rewardStore, { kind: 'explicit', rewardStorePath });
  } finally {
    await server.kill();
  }
  assert.deepEqual(rewardArtifactsInRepoData(), beforeArtifacts);
});

test('kill() is idempotent -- calling it a second time after the child already exited still confirms free and does not throw', async () => {
  const server = await startOwnedServer({ quiet: true, rewardStorePath: isolatedStore() });
  await server.kill();
  const second = await server.kill();
  assert.equal(second, true);
  assert.equal(await portFree(server.port), true);
});

test('two owned servers started back to back each get their own port, and killing one does not affect the other', async () => {
  const first = await startOwnedServer({ quiet: true, rewardStorePath: isolatedStore() });
  const second = await startOwnedServer({ quiet: true, rewardStorePath: isolatedStore() });
  assert.notEqual(first.port, second.port, 'first-free-wins must not hand out the same port twice while the first is still up');

  await first.kill();
  assert.equal(await portFree(first.port), true);
  assert.equal(await portFree(second.port), false, 'killing the first owned server must not touch the second');

  await second.kill();
  assert.equal(await portFree(second.port), true);
});
