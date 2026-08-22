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
import { createServer as createProbeServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The hero every harness plays as. One fixed name so a harness run is reproducible and so two
 *  harnesses never disagree about who they are; it is a display name, not an identity -- the durable
 *  profile id is still minted per device and per clear. */
const HARNESS_HERO_NAME = 'Harness';

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
  repoRoot = REPO_ROOT,
} = {}) {
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
  const child = spawn(process.execPath, ['server.mjs', String(port)], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Unset (inherited real data/rewards.db) unless a caller passes rewardStorePath -- e.g. a harness
    // proving something durable and never-reversed, like Workshop I ownership, that must not land in
    // the children's real save. See server.mjs's own comment on GALAQUEST_REWARD_STORE_PATH.
    env: rewardStorePath
      ? { ...process.env, GALAQUEST_REWARD_STORE_PATH: rewardStorePath }
      : process.env,
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
  const url = `${origin}/?hero=${encodeURIComponent(HARNESS_HERO_NAME)}`;

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
    kill,
    get exited() { return exited; },
  };
}
