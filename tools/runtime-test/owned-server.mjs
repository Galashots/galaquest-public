/**
 * Spawn and own a runtime server for the duration of one harness run.
 *
 *   import { startOwnedServer } from './owned-server.mjs';
 *   const server = await startOwnedServer();
 *   // server.url, server.origin, server.port ... then server.kill() when done.
 *
 * WHY THIS EXISTS. Every harness in this directory used to load the page from the shared dev server
 * on port 5201, and that was measured to be actively wrong twice over (Phase Z1):
 *
 *   1. A shared server means shared authoritative state. play-fight.mjs failed 4 runs of 4 against
 *      5201 on 2026-08-14, three of them because the wolf was still DEAD from the previous run --
 *      the wolf is server-owned and takes WOLF_RESPAWN_SECONDS (10) to come back, so any run
 *      starting inside that window inherits a corpse it never killed.
 *   2. Port 5201 turned out to belong to a SIBLING WORKTREE (.claude/worktrees/
 *      phase-d-pre-brief-57bf29), so a run could be exercising a checkout other than the one it was
 *      launched from. `/src/main.js` hashed IDENTICALLY between the two at the time, so nothing in
 *      the served bytes would have told you. A green run against the wrong tree looks exactly like a
 *      green run against the right one.
 *
 * WHY IT IS A SHARED MODULE, given tools/runtime-test's standing preference for local copies. Phase
 * Z1 deliberately kept its implementation local, because it was fixing ONE file. Phase H1 rolls the
 * same discipline out to nine more, and nine copies of this logic is ~540 duplicated lines against
 * GQ-007 (ENFORCED: "a value used by two modules lives in one importable module"). One module, one
 * candidate pool, one teardown guarantee -- and each harness changes by about three lines.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It is not a harness framework. It does not touch CDP, Chrome,
 * viewports, checks, captures or storage. Each harness keeps its own everything else, because what
 * they prove is genuinely different and only the server plumbing was ever the same.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer as createProbeServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The hero every harness plays as. One fixed name so a harness run is reproducible and so two
 *  harnesses never disagree about who they are; it is a display name, not an identity -- the durable
 *  profile id is still minted per device and per clear. */
const HARNESS_HERO_NAME = 'Harness';

const isolatedRewardStorePath = () => join(
  mkdtempSync(join(tmpdir(), 'galaquest-owned-server-')),
  'rewards.db',
);

/**
 * Select the reward-store law for a harness-owned server.
 *
 * Omission is intentionally safe: ordinary tests and harnesses receive a fresh OS-temp store.
 * Reaching the family's ordinary store requires the named `useRealRewardStore` opt-in, and that
 * opt-in is intentionally incompatible with supplying any other store path.
 */
const pathWithin = (directory, path) => {
  const pathFromDirectory = relative(directory, path);
  return pathFromDirectory === '' || (!pathFromDirectory.startsWith('..') && !isAbsolute(pathFromDirectory));
};

export function selectOwnedRewardStore({
  rewardStorePath,
  useRealRewardStore = false,
  repoRoot = REPO_ROOT,
} = {}) {
  if (typeof useRealRewardStore !== 'boolean') {
    throw new TypeError('useRealRewardStore must be a boolean');
  }
  if (useRealRewardStore && rewardStorePath !== undefined) {
    throw new Error('cannot combine rewardStorePath with useRealRewardStore');
  }
  if (useRealRewardStore) return { kind: 'real', rewardStorePath: null };
  if (rewardStorePath !== undefined) {
    if (typeof rewardStorePath !== 'string' || rewardStorePath.length === 0) {
      throw new TypeError('rewardStorePath must be a non-empty string when supplied');
    }
    if (pathWithin(resolve(repoRoot, 'data'), resolve(repoRoot, rewardStorePath))) {
      throw new Error('rewardStorePath cannot point under the repository data directory');
    }
    return { kind: 'explicit', rewardStorePath };
  }
  return { kind: 'temporary', rewardStorePath: isolatedRewardStorePath() };
}

/**
 * The URL a harness must navigate to in order to land IN THE GAME.
 *
 * Exported because `startOwnedServer().url` is not enough on its own: several harnesses build their
 * own address from a port or an origin -- they pin a specific gq-guest-id first and navigate by
 * hand -- and those bypassed the `?hero=` on `url` entirely. The result was silent and total: they
 * landed on the profile gate's naming question, with the world behind a modal and input suspended,
 * and reported the game not answering. drive-ranger and drive-beacon-siege both went from green to
 * red that way while the fix that was supposed to cover them looked complete.
 *
 * So the rule is one function rather than one field, and test/harness-game-url.test.mjs enforces
 * that no harness hand-builds a game root without it.
 *
 * `heroName` exists for the ONE case that genuinely needs two children: drive-two-clients puts two
 * tabs on the same origin, which is what makes them two siblings sharing an iPad rather than two
 * devices. Same origin means one localStorage and one profile keyring, so two tabs asking for the
 * same name get the SAME profile -- `adoptNamedHero` finds it and selects it, correctly. The file
 * used to force them apart by clearing storage per tab, which worked by accident and raced: the
 * second tab's wipe can take the first tab's freshly minted profile row with it, and then a reload
 * comes back as a stranger with the granted gear orphaned. Naming the second child is the product's
 * own answer to "two children, one device", so the harness uses that instead of fighting storage.
 */
export function gameUrlFor(origin, heroName = HARNESS_HERO_NAME) {
  return `${origin}/?hero=${encodeURIComponent(heroName)}`;
}

/**
 * The pool every harness draws from, tried in order and never randomised.
 *
 * Deliberately excludes 5201 (the shared playtest service a human may be using on an iPad right
 * now) and 5199 (the decision lab -- server.mjs refuses it outright). Sixteen wide so that several
 * harnesses running at once each get their own: first-free-wins means concurrency needs no
 * per-harness bookkeeping and two harnesses can never collide, which fixed-range-per-file would not
 * guarantee once there are eleven of them.
 *
 * "Deterministic" survives this: the pool is a fixed list in a fixed order, and every run prints the
 * port it actually took, which is the property that matters -- a harness you cannot point at the
 * port it used is a worse proof than one that fails loudly.
 */
export const PORT_CANDIDATES = Object.freeze([
  5202, 5203, 5204, 5205, 5206, 5207, 5208, 5209,
  5210, 5211, 5212, 5213, 5214, 5215, 5216, 5217,
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Is this port genuinely unbound?
 *
 * Probes by LISTENING, not by connecting. "Nothing answered me" and "nothing is bound here" are
 * different facts, and only the second one means the port is safe to take -- a server that is up but
 * mid-start would pass a connect probe's absence check and then lose the race.
 *
 * MUST probe `'0.0.0.0'`, the exact host `server.mjs` itself binds (`server.listen(port, '0.0.0.0',
 * ...)`) -- probing `'127.0.0.1'` instead was a real, pre-existing bug found during SR5's closeout
 * (2026-08-16): on Windows, binding a specific address (`127.0.0.1`) does not conflict at bind time
 * with an EXISTING wildcard (`0.0.0.0`) listener on the same port, so the old probe fired `'listening'`
 * (reporting the port "free") even while a real server.mjs was already up and answering real HTTP
 * requests on it -- confirmed directly: `net.createServer().listen(port, '127.0.0.1')` against a busy
 * port returned `true`, while the SAME probe against `'0.0.0.0'` correctly returned `EADDRINUSE`. This
 * silently let `startOwnedServer()`'s own candidate scan double-allocate a "free" port, and separately
 * broke `kill()`'s port-free verification below.
 */
function portFree(port) {
  return new Promise((resolve) => {
    const tester = createProbeServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(port, '0.0.0.0');
  });
}

/**
 * Start a runtime server this process owns, and resolve once it is really serving the page.
 *
 * Returns `{ port, origin, url, child, kill, exited }`. `kill()` is idempotent, terminates ONLY the
 * child spawned here -- never whatever else may own a port -- and does not resolve `true` until it has
 * independently verified (via `portFree()`, not just a Node `'exit'` event) that the port is actually
 * free again, escalating against this child's own PID if a graceful attempt times out. An occupied
 * candidate is skipped, never killed: it belongs to somebody, and the whole reason this module exists
 * is that a harness does not get to guess who.
 */
export async function startOwnedServer({
  candidates = PORT_CANDIDATES,
  quiet = false,
  rewardStorePath,
  useRealRewardStore = false,
  // #87: item ids every eligible hero's corpse claim carries unconditionally, so a harness can reach
  // a real personal claim without waiting on an unseeded gear roll. Passed straight through to
  // server.mjs's own GALAQUEST_TEST_GUARANTEED_CORPSE_ITEMS (see its comment for the full argument);
  // omitted by every other harness, and omitted means the production dice, unchanged.
  guaranteedCorpseItemIds,
  repoRoot = REPO_ROOT,
} = {}) {
  const selectedRewardStore = selectOwnedRewardStore({ rewardStorePath, useRealRewardStore, repoRoot });
  let port = null;
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await portFree(candidate)) { port = candidate; break; }
  }
  if (port === null) {
    throw new Error(
      `every candidate test port is occupied (${candidates[0]}-${candidates[candidates.length - 1]}) `
      + '-- not killing an unknown owner; free one of them and re-run',
    );
  }

  // cwd is the repo root, so the server serves THIS checkout's public/ and runs THIS checkout's
  // net/gameServer.mjs. That is the half of the 5201 problem content hashes could not catch.
  // An inherited GALAQUEST_REWARD_STORE_PATH must not weaken the safe omission law. The only route
  // to the ordinary data/rewards.db is the explicit useRealRewardStore option above.
  const serverEnvironment = { ...process.env };
  delete serverEnvironment.GALAQUEST_REWARD_STORE_PATH;
  const child = spawn(process.execPath, ['server.mjs', String(port)], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Normal callers always get the selected isolated/explicit path. The null real-store selection
    // intentionally leaves this unset so server.mjs uses its ordinary family-save default.
    env: {
      ...serverEnvironment,
      ...(selectedRewardStore.rewardStorePath
        ? { GALAQUEST_REWARD_STORE_PATH: selectedRewardStore.rewardStorePath }
        : {}),
      ...(guaranteedCorpseItemIds?.length
        ? { GALAQUEST_TEST_GUARANTEED_CORPSE_ITEMS: guaranteedCorpseItemIds.join(',') }
        : {}),
    },
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', () => { /* drained so the pipe cannot fill and stall the child */ });
  let exited = false;
  child.once('exit', () => { exited = true; });

  /**
   * Terminates ONLY the child spawned by this call, and does not return `true` until `portFree(port)`
   * INDEPENDENTLY confirms the port is actually free again -- not merely that a Node `'exit'` event
   * fired. Observed live during SR5 selftest verification (2026-08-16, docs/MISTAKES.md's selftest-
   * teardown entry, second incident): a graceful-only `child.kill()` resolved without error while the
   * owned server stayed alive and reachable for multiple rounds afterward. If the graceful attempt
   * does not free the port within the timeout, escalates with a stronger kill signal against ONLY this
   * child's own PID -- never an unknown or shared process -- then re-verifies before giving up.
   * Returns `false` if the port still cannot be confirmed free; callers should treat that as "teardown
   * could not be confirmed" and surface it, not silently proceed as if cleanup succeeded.
   */
  async function kill() {
    if (exited && await portFree(port)) return true;
    if (!exited) {
      await new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill();
        setTimeout(resolve, 5000);
      });
    }
    if (await portFree(port)) return true;

    try { child.kill('SIGKILL'); } catch { /* already gone, or the platform ignores SIGKILL */ }
    for (let i = 0; i < 15; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (await portFree(port)) return true;
      // eslint-disable-next-line no-await-in-loop
      await sleep(200);
    }
    return false;
  }

  // The teardown guarantee, and it is a process-level 'exit' handler rather than something the
  // caller must remember to wrap in try/finally. Every harness in this directory ends with
  // process.exit(), and `process.exit()` SKIPS a finally block while ALWAYS running 'exit' handlers
  // -- so this is the one placement no exit path can bypass: a thrown error, an unhandled rejection,
  // a multi-client bail, or a normal finish. Synchronous by necessity (an 'exit' handler cannot
  // await), which is exactly what child.kill() is. Callers that want CONFIRMED termination still
  // await kill() themselves; this is the net underneath them, not a replacement for them.
  process.on('exit', () => { if (!exited) child.kill(); });

  const origin = `http://127.0.0.1:${port}`;
  // The game URL every harness drives, and it NAMES A HERO on purpose.
  //
  // Stage 1 added a family profile gate: a device with no named hero opens the game by asking what
  // the child's hero is called, as a modal over the world. That is correct for a child and it broke
  // all 28 harnesses at once -- every one of them clears localStorage before its first navigation
  // (GQ-008), so every one of them landed on an unanswered question with the ATTACK button behind
  // it. drive-hero-screen reported `elementFromPoint at its centre -> profile-gate`.
  //
  // `?hero=` is the product's own answer to that (public/src/progression/profiles.js's
  // adoptNamedHero, and the README's "players join by URL"), not a test-only backdoor: it is how a
  // family gives one child a link. Putting it HERE rather than in 28 harnesses is the same reason
  // this module exists at all -- see the header on GQ-007 and the ~540 duplicated lines it replaced.
  //
  // `origin` stays clean, because Storage.clearDataForOrigin takes an origin and not a URL, and a
  // harness that wants another page under this server builds it from `origin` too.
  const url = gameUrlFor(origin);

  let up = false;
  for (let i = 0; i < 40 && !up && !exited; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
    try {
      // eslint-disable-next-line no-await-in-loop
      up = (await fetch(url)).ok;
    } catch {
      // Not listening yet -- keep polling.
    }
  }
  if (!up) {
    await kill();
    throw new Error(
      `the harness-owned server never served ${url}`
      + `${exited ? ` (child exited early; stderr: ${stderr.slice(0, 300)})` : ''}`,
    );
  }

  if (!quiet) console.log(`  harness-owned server on ${url} (pid ${child.pid})`);

  return {
    port,
    origin,
    url,
    child,
    rewardStore: selectedRewardStore,
    kill,
    get exited() { return exited; },
  };
}
