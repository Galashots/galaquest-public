/**
 * Bring up the automation Chrome the browser harnesses talk to, on port 9224.
 *
 *   node tools/runtime-test/automation-chrome.mjs        # start it, print the port, stay resident
 *   node tools/runtime-test/automation-chrome.mjs --headed   # on a desktop, watch it play
 *
 *   import { startAutomationChrome } from './automation-chrome.mjs';
 *   const chrome = await startAutomationChrome();
 *   // ... run a harness against chrome.port ... then chrome.kill().
 *
 * WHY THIS EXISTS. README's "Browser harnesses" section said, in full: "Start Chrome with a
 * dedicated profile and remote debugging on port 9224, then: node tools/runtime-test/play-fight.mjs".
 * That is a description of a state, not a command that runs, and AGENTS.md's guidance rule asks for
 * "exact commands that are currently runnable". The gap is not cosmetic: every harness in this
 * directory fails at its first CDP connect if nothing is listening on 9224, and the error a reader
 * gets back is a websocket refusal, which does not name the missing step.
 *
 * It also cost a whole production lane. The handover this was written under treats running-game
 * pixels as something only the desktop appliance can produce, because "start Chrome" was read as
 * "have a desktop with Chrome on it". A cloud agent container generally has neither a desktop nor a
 * `chrome` on PATH -- but it usually does have a Chromium, and a headless one drives CDP exactly the
 * same way. Measured in a Claude Code cloud container on 2026-09-19: with this module's launch,
 * drive-village.mjs reported 17/17, drive-marks.mjs 21/21, and drive-relight.mjs ran end to end and
 * wrote its captures. The pixels are real; the desktop was not required to get them.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not wrap CDP, own a server, or become a harness
 * framework -- owned-server.mjs's own header makes that argument and it applies unchanged here. It
 * launches a browser and tells you it is answering.
 *
 * IT SKIPS AN OCCUPIED PORT RATHER THAN KILLING IT, which is owned-server.mjs's discipline applied
 * to the other half of the pair. 9224 is meant to be the isolated automation browser, but "meant to
 * be" is not proof, and the owner's own signed-in Chrome sits one port away on 9223. A process
 * already answering on 9224 belongs to somebody; this attaches to it and reports `startedHere:
 * false` so a caller (and a reader of the log) can tell a fresh browser from an inherited one.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The port every harness in this directory dials. NOT 9223, which is the owner's signed-in browser. */
export const AUTOMATION_CHROME_PORT = 9224;

/**
 * Where to look for a browser binary, best first.
 *
 * ORDER IS THE ARGUMENT, so it is stated rather than left to whichever branch happens to match:
 *
 *   1. GALAQUEST_CHROME, because an explicit path from the person running this is never something to
 *      second-guess. It is also the one escape hatch for a machine none of the rest of this covers.
 *   2. The Playwright browser pool, when PLAYWRIGHT_BROWSERS_PATH names one. This is the entry that
 *      makes a cloud agent container work at all: the container ships a Chromium under that path and
 *      no `chrome` anywhere on PATH, so a PATH-only search concludes "no browser" on a machine that
 *      demonstrably has one. Directory names carry a build number (`chromium-1194`), which is why
 *      this reads the pool rather than hard-coding a version that will be wrong next month.
 *   3. Ordinary names on PATH, for a desktop. `chrome`/`chromium` land here.
 *
 * The full-shell `chromium-1194/chrome-linux/chrome` is preferred over the `chromium_headless_shell`
 * sibling: the harnesses capture WebGL frames, and the headless shell is a cut-down build kept for
 * speed rather than for rendering fidelity. Both drive CDP; only one is worth photographing.
 *
 * Pure, and returns paths that may or may not exist or resolve. Nothing here decides which one is
 * runnable -- plausibleChromeCandidates drops the knowably-absent ones and the launcher tries the
 * rest in turn -- so the ordering can be asserted without a filesystem.
 */
export function chromeExecutableCandidates({ env = process.env, listDir = safeReadDir } = {}) {
  const candidates = [];
  if (env.GALAQUEST_CHROME) candidates.push(env.GALAQUEST_CHROME);

  const pool = env.PLAYWRIGHT_BROWSERS_PATH;
  if (pool && pool !== '0') {
    // Newest build first: the pool can hold several, and a stale one is not the one a configured
    // environment expects to be used.
    const chromiumDirs = listDir(pool)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.slice('chromium-'.length)) - Number(a.slice('chromium-'.length)));
    for (const dir of chromiumDirs) candidates.push(join(pool, dir, 'chrome-linux', 'chrome'));
    // Only after every full build, for the fidelity reason in this function's own comment.
    const shellDirs = listDir(pool)
      .filter((name) => /^chromium_headless_shell-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()));
    for (const dir of shellDirs) candidates.push(join(pool, dir, 'chrome-linux', 'headless_shell'));
  }

  candidates.push(
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  );
  return candidates;
}

/** readdir that answers "nothing here" rather than throwing, so a missing pool is not a crash. */
function safeReadDir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

/**
 * The candidates worth actually trying, in order.
 *
 * This is a pre-filter, NOT a resolution. The only thing it can decide by itself is that a path
 * with a separator in it does not exist on disk -- that one is cheap and certain, and skipping it
 * avoids a pointless spawn. A bare name like `chromium` is left in, because **only the OS can say
 * whether a bare name resolves**, and re-implementing PATH lookup here (splitting PATH, honouring
 * PATHEXT on Windows, checking the execute bit, following symlinks) would be a second and worse
 * copy of what `spawn` already does correctly.
 *
 * This replaced a version that returned the first candidate whose path had no separator and called
 * that "resolved". On a machine with no `google-chrome` but a working `chromium` that picked
 * `google-chrome`, spawn failed with ENOENT, and the run died holding a perfectly good browser it
 * had never tried. Falling through is now the launcher's job (see startAutomationChrome), and this
 * function only removes candidates that are knowably absent.
 */
export function plausibleChromeCandidates(options = {}) {
  return chromeExecutableCandidates(options)
    .filter((candidate) => !hasPathSeparator(candidate) || existsSync(candidate));
}

/** A separator in either direction -- `\` is one on Windows and legal in a path we were handed. */
function hasPathSeparator(candidate) {
  return candidate.includes('/') || candidate.includes('\\');
}

/**
 * Is this spawn failure "wrong binary, try the next one" rather than "stop"?
 *
 * ENOENT is the whole reason fall-through exists: the name did not resolve. EACCES is the same
 * class -- something is there but this process may not execute it, which a different candidate may
 * not suffer from. Anything else (EMFILE, ENOMEM, a spawn refused by policy) is about this machine
 * rather than this candidate, so trying eight more binaries would just print the same error eight
 * times and bury the real one.
 */
export function isRetryableSpawnError(error) {
  return error?.code === 'ENOENT' || error?.code === 'EACCES';
}

/**
 * The launch flags, as one pure function so they can be read and asserted rather than buried.
 *
 * Each flag is here for a stated reason; none is cargo:
 *
 *   --remote-debugging-{port,address}  the entire point. Bound to loopback explicitly, because a
 *                                      debugging port is unauthenticated remote code execution and a
 *                                      container that happens to be reachable should not offer it.
 *   --user-data-dir                    a DEDICATED profile, which is the half of README's sentence
 *                                      that was already right. MISTAKES.md's GQ entry on 9224 records
 *                                      that this profile is persistent across runs and that
 *                                      `gq-guest-id` therefore survives -- harnesses that care clear
 *                                      localStorage themselves, and that stays their business.
 *   --headless=new                     the default, because the machine that most needs this module
 *                                      has no display at all. --headed turns it off for a desktop.
 *   --use-gl / --use-angle / --enable-unsafe-swiftshader
 *                                      the game is WebGL. Without a software rasteriser a headless
 *                                      container renders nothing and the captures come back as an
 *                                      empty canvas -- which photographs as a broken game rather
 *                                      than as a missing GPU, the exact kind of evidence AGENTS.md
 *                                      says must not be produced. "unsafe" here is Chrome's own name
 *                                      for allowing SwiftShader on a page that asked for hardware;
 *                                      it weakens nothing about the game under test.
 *   --no-sandbox                       required inside the container images these harnesses run in,
 *                                      which are already an isolation boundary. Omitted when headed,
 *                                      because a desktop browser has no such excuse.
 *   --no-first-run / --no-default-browser-check / --disable-...
 *                                      first-run interstitials and background work steal the first
 *                                      frames of a run that is about to photograph the first frames.
 */
export function chromeLaunchArgs({ port = AUTOMATION_CHROME_PORT, profileDir, headless = true } = {}) {
  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ];
  if (headless) args.push('--headless=new', '--no-sandbox', '--disable-gpu-sandbox');
  args.push('about:blank');
  return args;
}

/** The persistent automation profile, in a stable place so a run inherits the last one's cookies
 *  and localStorage exactly as the desktop 9224 browser always has (MISTAKES.md's GQ-9224 note). */
export function defaultProfileDir() {
  return join(tmpdir(), 'galaquest-automation-chrome');
}

/** Is something already answering CDP here? Returns the browser's own version string, or null. */
export async function probeChrome(port = AUTOMATION_CHROME_PORT, { timeoutMillis = 1000 } = {}) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(timeoutMillis),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body.Browser ?? null;
  } catch {
    return null;
  }
}

/**
 * Ensure a CDP-speaking browser is answering on `port`, and resolve once it really is.
 *
 * Returns `{ port, browser, startedHere, executable, profileDir, child, kill }`. `kill()` is
 * idempotent and terminates ONLY a child this function spawned -- an inherited browser is left
 * running, for the reason in this module's header.
 */
export async function startAutomationChrome({
  port = AUTOMATION_CHROME_PORT,
  headless = true,
  profileDir = defaultProfileDir(),
  readyTimeoutMillis = 20_000,
  quiet = false,
  env = process.env,
  // Injected so the failure paths below can be proven against a stubbed spawn. A test cannot
  // conjure a machine that has chromium but not google-chrome, and the fall-through is exactly the
  // behaviour that was wrong, so it needs a seam rather than a hopeful comment.
  spawnProcess = spawn,
} = {}) {
  const inherited = await probeChrome(port);
  if (inherited) {
    if (!quiet) console.log(`automation Chrome already answering on ${port} (${inherited}) -- attaching, not replacing`);
    return { port, browser: inherited, startedHere: false, executable: null, profileDir: null, child: null, kill: () => {} };
  }

  // mkdtemp only when the caller asked for a throwaway; the default profile is deliberately stable.
  const resolvedProfile = profileDir ?? mkdtempSync(join(tmpdir(), 'galaquest-chrome-'));
  const candidates = plausibleChromeCandidates({ env });
  if (candidates.length === 0) {
    throw new Error(
      `${NO_BROWSER}: no candidate was even present. Looked at `
      + `${chromeExecutableCandidates({ env }).join(', ')}. ${SET_IT}`,
    );
  }

  const attempts = [];
  for (const executable of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const attempt = await launchCandidate(executable, {
      port, profileDir: resolvedProfile, headless, readyTimeoutMillis, spawnProcess,
    });
    if (attempt.browser) {
      if (!quiet) console.log(`automation Chrome up on ${port} (${attempt.browser}) via ${executable}`);
      return startedLaunch({
        port, browser: attempt.browser, executable, profileDir: resolvedProfile, child: attempt.child,
      });
    }
    attempts.push(`${executable}: ${attempt.reason}`);
    // A live process that never spoke CDP is a port/flags/machine problem, not the wrong binary.
    // Every later candidate would fail identically after another full timeout, so stop and say so.
    if (attempt.fatal) {
      throw new Error(`could not start the automation browser on ${port}.\n  ${attempts.join('\n  ')}`);
    }
  }

  throw new Error(`${NO_BROWSER}: every candidate failed to launch.\n  ${attempts.join('\n  ')}\n${SET_IT}`);
}

const NO_BROWSER = 'no usable Chrome/Chromium for the automation browser';
const SET_IT = 'Set GALAQUEST_CHROME to a browser binary, or install one.';
const tail = (stderr) => (stderr ? `. stderr: ${stderr.slice(-800)}` : '');
const describeSpawnFailure = (error) => `${error?.code ?? 'spawn failed'} (${error?.message ?? error})`;

/**
 * One candidate's turn: spawn it and wait for it to answer CDP.
 *
 * Resolves `{ browser, child }` on success or `{ reason, fatal }` on failure, and NEVER throws for
 * an ordinary bad candidate -- the caller's whole job is to keep going.
 *
 * `fatal` separates the two failure shapes. A spawn-level error or an immediate exit means this
 * binary is wrong and the next deserves its turn. A process that stayed alive and simply never
 * served CDP means the port, the flags or the machine is wrong, and retrying cannot help.
 */
async function launchCandidate(executable, {
  port, profileDir, headless, readyTimeoutMillis, spawnProcess,
}) {
  const args = chromeLaunchArgs({ port, profileDir, headless });
  let child;
  try {
    child = spawnProcess(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // spawn() normally reports ENOENT asynchronously, but a synchronous throw is possible, so both
    // routes have to arrive at the same fall-through rather than only the one we happened to test.
    return { reason: describeSpawnFailure(error), fatal: !isRetryableSpawnError(error) };
  }

  // ATTACHED BEFORE THE FIRST AWAIT, and this is the whole of the second defect. spawn reports
  // ENOENT by emitting 'error' on the child, and an 'error' event with no listener is rethrown as
  // an unhandled exception that takes the process down. The previous version listened only for
  // 'exit', so a missing binary crashed the launcher instead of being a result it could act on.
  let spawnError = null;
  let exited = false;
  child.once('error', (error) => { spawnError = error; });
  child.once('exit', () => { exited = true; });

  let stderr = '';
  child.stderr?.on('data', (chunk) => { stderr += chunk; });
  child.stderr?.on('error', () => {});
  child.stdout?.resume();
  child.stdout?.on('error', () => {});

  const deadline = Date.now() + readyTimeoutMillis;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const browser = await probeChrome(port);
    if (browser) return { browser, child };
    if (spawnError) {
      return { reason: describeSpawnFailure(spawnError), fatal: !isRetryableSpawnError(spawnError) };
    }
    if (exited) return { reason: `exited before serving CDP${tail(stderr)}`, fatal: false };
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 150); });
  }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  return { reason: `did not answer CDP on ${port} within ${readyTimeoutMillis}ms${tail(stderr)}`, fatal: true };
}

/** The success shape, carrying the kill() contract this module promises. */
function startedLaunch({ port, browser, executable, profileDir, child }) {
  let exited = false;
  child.once('exit', () => { exited = true; });

  let killed = false;
  const kill = () => {
    if (killed || exited) return;
    killed = true;
    child.kill('SIGTERM');
    // A browser that ignores SIGTERM still has to go, or the next run inherits it and silently
    // tests against a profile it did not set up.
    setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 3000).unref?.();
  };

  return { port, browser, startedHere: true, executable, profileDir, child, kill };
}

/**
 * Was this module run directly, rather than imported?
 *
 * The obvious spelling, `import.meta.url === \`file://${process.argv[1]}\``, is wrong in more ways
 * than it looks. On Windows argv[1] is `C:\path\to\x.mjs` while import.meta.url is
 * `file:///C:/path/to/x.mjs` -- different separators, a drive letter, and three slashes rather than
 * two, so the comparison is simply always false there. Even on POSIX it fails for a relative
 * invocation (`node tools/runtime-test/automation-chrome.mjs` gives a relative argv[1] on some
 * launchers) and for any path containing a character URL encoding escapes, such as a space.
 *
 * pathToFileURL does the encoding and the drive-letter/separator handling that the template string
 * was pretending to do, and resolve() makes a relative argv[1] absolute first. Exported and pure so
 * the Windows and relative-path shapes can be asserted from a POSIX test runner.
 */
export function isMainModule(metaUrl, argv1) {
  if (!metaUrl || !argv1) return false;
  try {
    return pathToFileURL(resolve(argv1)).href === metaUrl;
  } catch {
    return false;
  }
}

// CLI: start it and stay resident, so the harnesses can be run from another shell against it.
if (isMainModule(import.meta.url, process.argv[1])) {
  const headless = !process.argv.includes('--headed');
  const chrome = await startAutomationChrome({ headless });
  if (chrome.startedHere) {
    console.log('leave this running; Ctrl-C stops it. Harnesses connect on their own.');
    process.on('SIGINT', () => { chrome.kill(); process.exit(0); });
    process.on('SIGTERM', () => { chrome.kill(); process.exit(0); });
  }
}
