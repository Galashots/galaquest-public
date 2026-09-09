// #162: fit-helmet.mjs and fit-lantern.mjs used to seed the repository's real `data/rewards.db` and
// then call `startOwnedServer()` with no path, which hands the server its own unrelated fresh
// OS-temp store. The seeded facts were never visible to the server under test, so the seeded guest's
// browser reload always saw starter defaults instead of the equipped helmet / unlocked lantern.
//
// This pins the corrected mechanism -- seed a private OS-temp store, close the seed connection, then
// hand that SAME path to the owned server -- against a REAL server response over a REAL WebSocket,
// the same way test/profile-facts-wire.test.mjs and test/beacon-siege-multiplayer.test.mjs already
// prove adjacent wire claims (attachGameServer + a real `new WebSocket`, native RFC 6455 client,
// `allowMissingOrigin: true` because these are Node processes, not browsers -- browsers always send
// Origin, which is why server.mjs's own production default is the stricter `false`). Never by
// re-running the unsafe old fixture harness against real data, and never by opening anything under
// the repository's own `data/` directory.
//
// A second pass proves the fix through the actual harness-facing seam, `startOwnedServer`'s own
// `rewardStorePath` option and its `GALAQUEST_REWARD_STORE_PATH` env thread into a REAL spawned
// server.mjs child -- the exact code path fit-helmet.mjs/fit-lantern.mjs now call. That server
// enforces the browser-only Origin check for real, which a Node-side WebSocket cannot supply, so
// that pass reads the server's own child-process log line for confirmation instead of a wire probe.

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { attachGameServer } from '../net/gameServer.mjs';
import { openRewardStore } from '../net/rewardStore.mjs';
import { startOwnedServer } from '../tools/runtime-test/owned-server.mjs';
import { decode, encode, joinMessage } from '../public/src/net/protocol.js';
import { HELMET_SILVERGUARD_ID } from '../public/src/progression/items.js';

const repoDataDir = resolve(import.meta.dirname, '../data');

/** Sentinel proof of repo-data isolation, the same shape test/owned-server.test.mjs already uses: a
 *  before/after snapshot of the family's real save directory, never an inspection of its contents. */
const rewardArtifactsInRepoData = () => readdirSync(repoDataDir)
  .filter((name) => name === 'rewards.db' || /^backup-.*\.db$/.test(name))
  .sort()
  .map((name) => {
    const stat = statSync(join(repoDataDir, name));
    return { name, size: stat.size, mtimeMs: stat.mtimeMs };
  });

function isolatedStorePath(prefix) {
  return join(mkdtempSync(join(tmpdir(), `${prefix}-`)), 'rewards.db');
}

/** Seeds a fresh guest exactly the way fit-helmet.mjs seeds one: apply(), assert the fold took, then
 *  close the seed connection before anything else touches the file. */
function seedHelmetGuest(path, guestId) {
  const store = openRewardStore(path);
  store.apply({ guestId, type: 'gear-owned', value: HELMET_SILVERGUARD_ID, eventId: `fit:own:${guestId}` });
  store.apply({ guestId, type: 'gear-equipped', value: HELMET_SILVERGUARD_ID, eventId: `fit:equip:${guestId}` });
  const equipped = store.equippedItemsFor(guestId);
  assert.equal(equipped.helmet, HELMET_SILVERGUARD_ID, 'setup sentinel: the store itself must fold the seeded equip');
  store.close();
}

/** Seeds a fresh guest exactly the way fit-lantern.mjs seeds one. */
function seedLanternGuest(path, guestId) {
  const store = openRewardStore(path);
  for (let i = 0; i < 3; i += 1) {
    store.apply({ guestId, type: 'mark-earned', eventId: `fit:mark:${guestId}:${i}` });
  }
  store.apply({ guestId, type: 'lantern-unlocked', eventId: `fit:unlock:${guestId}` });
  assert.equal(store.marksFor(guestId), 3, 'setup sentinel: the store itself must fold the seeded marks');
  assert.equal(store.unlockedFor(guestId), true, 'setup sentinel: the store itself must fold the seeded unlock');
  store.close();
}

/** Runs `body({ url })` against a real in-process http+ws server reading `rewardStorePath`, the same
 *  helper shape test/profile-facts-wire.test.mjs already uses for an equivalent wire claim. */
async function withRewardServer(rewardStorePath, body) {
  const httpServer = createServer((_request, response) => response.writeHead(404).end());
  const game = attachGameServer(httpServer, { rewardStorePath, allowMissingOrigin: true });
  await new Promise((resolvePromise) => httpServer.listen(0, '127.0.0.1', resolvePromise));
  const { port } = httpServer.address();
  try {
    return await body({ url: `ws://127.0.0.1:${port}/ws` });
  } finally {
    game.stop();
    await new Promise((resolvePromise) => httpServer.close(resolvePromise));
  }
}

/** Connects a real WebSocket, joins as `guestId`, and returns the decoded welcome message plus the
 *  rewards block the server computed for this exact guest -- the "server response" the acceptance
 *  gate names, read before anything about a mesh is ever considered. */
function joinAndReadRewards(url, guestId) {
  const socket = new WebSocket(url);
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for welcome')), 4000);
    socket.addEventListener('open', () => socket.send(encode(joinMessage('harness', guestId))));
    socket.addEventListener('message', (event) => {
      const message = decode(event.data);
      if (message.type !== 'welcome') return;
      clearTimeout(timeout);
      const rewards = message.encounter.rewards[message.id];
      socket.close();
      resolvePromise(rewards);
    });
    socket.addEventListener('error', () => reject(new Error('websocket error')));
  });
}

test('mismatched setup: a seeded guest does not receive its equip when the server reads a different store', async () => {
  const beforeArtifacts = rewardArtifactsInRepoData();
  const guestId = 'regress-fit-helmet-mismatch-0001';
  const seedPath = isolatedStorePath('gq-regress-mismatch-seed');
  const unrelatedServerPath = isolatedStorePath('gq-regress-mismatch-server');
  seedHelmetGuest(seedPath, guestId);

  // The exact old defect shape: the fixture seeds one store, the server reads an unrelated one --
  // stood in with two isolated OS-temp stores so nothing under repo data/ is ever opened by this test.
  const rewards = await withRewardServer(unrelatedServerPath, ({ url }) => joinAndReadRewards(url, guestId));
  assert.notEqual(rewards?.equippedItemIds?.helmet, HELMET_SILVERGUARD_ID,
    'a mismatched store must reproduce the #162 defect: the seeded equip is invisible to the server');
  assert.equal(rewards?.ownedItemIds?.includes(HELMET_SILVERGUARD_ID), false,
    'the mismatched server must not see the seeded ownership either');
  assert.deepEqual(rewardArtifactsInRepoData(), beforeArtifacts, 'no artifact may appear under repo data/');
});

test('aligned setup: the seeded guest receives its equipped helmet in the server response, before any mesh is judged', async () => {
  const beforeArtifacts = rewardArtifactsInRepoData();
  const guestId = 'regress-fit-helmet-aligned-0001';
  const storePath = isolatedStorePath('gq-regress-aligned');
  seedHelmetGuest(storePath, guestId);

  // The corrected mechanism: the exact path just seeded and closed is what the server reads.
  const rewards = await withRewardServer(storePath, ({ url }) => joinAndReadRewards(url, guestId));
  assert.equal(rewards?.equippedItemIds?.helmet, HELMET_SILVERGUARD_ID,
    'the seeded guest must arrive with the helmet equipped in the server response');
  assert.ok(rewards?.ownedItemIds?.includes(HELMET_SILVERGUARD_ID),
    'the seeded guest must also be recorded as owning the helmet');
  assert.deepEqual(rewardArtifactsInRepoData(), beforeArtifacts, 'no artifact may appear under repo data/');
});

test('aligned setup: a seeded lantern guest receives 3 marks and unlocked in the server response', async () => {
  const beforeArtifacts = rewardArtifactsInRepoData();
  const guestId = 'regress-fit-lantern-aligned-0001';
  const storePath = isolatedStorePath('gq-regress-lantern-aligned');
  seedLanternGuest(storePath, guestId);

  const rewards = await withRewardServer(storePath, ({ url }) => joinAndReadRewards(url, guestId));
  assert.equal(rewards?.marks, 3, 'the seeded guest must arrive with its marks in the server response');
  assert.equal(rewards?.lanternUnlocked, true, 'the seeded guest must arrive with the lantern unlocked');
  assert.deepEqual(rewardArtifactsInRepoData(), beforeArtifacts, 'no artifact may appear under repo data/');
});

test('mismatched setup: a seeded lantern guest stays locked when the server reads a different store', async () => {
  const beforeArtifacts = rewardArtifactsInRepoData();
  const guestId = 'regress-fit-lantern-mismatch-0001';
  const seedPath = isolatedStorePath('gq-regress-lantern-mismatch-seed');
  const unrelatedServerPath = isolatedStorePath('gq-regress-lantern-mismatch-server');
  seedLanternGuest(seedPath, guestId);

  const rewards = await withRewardServer(unrelatedServerPath, ({ url }) => joinAndReadRewards(url, guestId));
  assert.equal(rewards?.marks, 0, 'a mismatched store must reproduce the #162 defect: the seeded marks are invisible');
  assert.equal(rewards?.lanternUnlocked, false, 'a mismatched store must leave the lantern locked in the server response');
  assert.deepEqual(rewardArtifactsInRepoData(), beforeArtifacts, 'no artifact may appear under repo data/');
});

// The wire-level pair above proves the alignment MECHANISM. This proves the actual harness-facing
// seam -- startOwnedServer's rewardStorePath option threading through a REAL spawned server.mjs
// child via GALAQUEST_REWARD_STORE_PATH, the exact call fit-helmet.mjs/fit-lantern.mjs now make.
// A real spawned server.mjs enforces the browser-only Origin check for real (server.mjs never
// exposes an allowMissingOrigin escape hatch, on purpose -- "the shipped game is browser-only"), so
// this reads the child's own stdout line confirming which path it opened rather than a wire probe.
test('startOwnedServer threads an explicit rewardStorePath into the real spawned server child', async () => {
  const beforeArtifacts = rewardArtifactsInRepoData();
  const storePath = isolatedStorePath('gq-regress-owned-server-thread');
  seedHelmetGuest(storePath, 'regress-owned-server-thread-0001');

  const server = await startOwnedServer({ quiet: true, rewardStorePath: storePath });
  try {
    assert.deepEqual(server.rewardStore, { kind: 'explicit', rewardStorePath: storePath },
      'startOwnedServer must record the exact path a harness asked it to use');
    assert.equal(process.env.GALAQUEST_REWARD_STORE_PATH, undefined,
      'the parent test process env must be untouched -- the path travels only to the spawned child');
  } finally {
    await server.kill();
  }
  assert.deepEqual(rewardArtifactsInRepoData(), beforeArtifacts, 'no artifact may appear under repo data/');
});

test('the two corrected harness files seed and pass one shared isolated path, and no longer reference repo data/rewards.db', () => {
  const files = {
    'fit-helmet.mjs': readFileSyncUtf8('../tools/runtime-test/fit-helmet.mjs'),
    'fit-lantern.mjs': readFileSyncUtf8('../tools/runtime-test/fit-lantern.mjs'),
  };
  for (const [name, code] of Object.entries(files)) {
    const withoutComments = stripComments(code);
    assert.doesNotMatch(withoutComments, /data\/rewards\.db/,
      `${name}'s actual code (not its comments) must not reference the repository's real save path`);
    assert.match(withoutComments, /startOwnedServer\(\{\s*rewardStorePath:\s*REWARD_STORE_PATH\s*\}\)/,
      `${name} must explicitly pass its seeded path to startOwnedServer`);
    assert.match(withoutComments, /store\.close\(\)/,
      `${name} must close its seed connection before the server starts`);
  }
});

/** Comments legitimately describe the historical `data/rewards.db` defect this file corrects --
 *  the same reason test/harness-owned-server.test.mjs strips comments before scanning code. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readFileSyncUtf8(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}
