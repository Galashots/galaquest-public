/**
 * The farm game's running-pixels capture driver.
 *
 *   node tools/runtime-test/capture-farm.mjs
 *   node tools/runtime-test/capture-farm.mjs --repo /path/to/another/checkout --label muse-p3
 *   node tools/runtime-test/capture-farm.mjs --out .local/armada/farm-capture --headed
 *
 * WHAT IT PROVES. It serves a checkout's farm game at `/farm/`, opens it in the checked-in
 * automation Chrome on both iPad viewports (1024x768 landscape and 768x1024 portrait) with touch
 * emulation, waits for the game to actually boot, writes one PNG per viewport, and records every
 * browser console/runtime error it saw. Each run writes a receipt that names the exact served
 * worktree and commit -- and separately the exact driver worktree and commit, because those are
 * routinely different when `--repo` points at another lane.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not accept, promote, review or judge the farm's
 * appearance. `AGENTS.md` makes running-game pixels the final appearance authority and human visual
 * judgment the acceptance; an emulated headless capture is diagnostic evidence that can REJECT, not
 * evidence that can accept. It also does not drive gameplay, choose a band, or clear the band card:
 * it photographs the game's real first frame. The note is carried in the receipt so a reader cannot
 * mistake the PNGs for a physical-iPad PASS.
 *
 * WHY IT EXISTS. `docs/WORKFLOW.md`'s farm section told a contributor to serve the game, hand-start
 * `automation-chrome.mjs`, set the two viewports over CDP, capture and check the console -- a
 * description of a state rather than a command that runs, and this repository already has the
 * `automation-chrome.mjs` / `owned-server.mjs` pair that does the hard half. This file is the thin
 * farm-shaped caller on top of them; it does not wrap CDP, own a browser stack, or become a harness
 * framework.
 *
 * WHY `--repo` EXISTS. A farm capture has to be able to photograph a DIFFERENT checkout (a Muse
 * gameplay worktree, for example) without copying this tool into it and without the receipt
 * claiming the wrong source. `--repo` is passed to `owned-server.mjs` as `repoRoot`, so the server
 * process runs from that checkout and serves that checkout's `prototypes/farm-slice/`, while this
 * driver keeps running from the checkout it lives in. The receipt labels the two identities
 * separately.
 *
 * ATTRIBUTION OF THE BROWSER. There is no new browser stack here: `startAutomationChrome` supplies
 * the browser and its GALAQUEST_CHROME / Playwright-pool / PATH resolution, and `startOwnedServer`
 * supplies the server and its port pool. This driver adds a free port and a throwaway profile so it
 * owns -- and can prove it tore down -- everything it started, rather than inheriting whichever
 * automation browser happens to be sitting on 9224.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule, probeChrome, startAutomationChrome } from './automation-chrome.mjs';
import { startOwnedServer } from './owned-server.mjs';

/** The driver checkout, and the default served checkout when `--repo` is omitted. */
export const DRIVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The farm mount `server.mjs` exposes (server.mjs's `FARM_DIR`, mounted at `/farm/`). */
export const FARM_PATH = '/farm/';

/**
 * The two iPad viewports the farm harness must cover. `mobile: true` is what makes Chrome apply the
 * emulated device's layout, and the touch flag is set separately per capture. Landscape first so the
 * primary orientation is the first PNG and the first receipt row.
 */
export const CAPTURE_VIEWPORTS = Object.freeze([
  Object.freeze({ name: 'landscape', width: 1024, height: 768, deviceScaleFactor: 1, mobile: true }),
  Object.freeze({ name: 'portrait', width: 768, height: 1024, deviceScaleFactor: 1, mobile: true }),
]);

/** Carried verbatim into both receipt forms so the diagnostic boundary survives copy-paste. */
export const RECEIPT_NOTE =
  'Diagnostic emulated headless capture only. It can reject, never accept: acceptance of the farm '
  + 'appearance and touch flow is running-game human visual judgment on a real iPad (AGENTS.md, '
  + 'docs/WORKFLOW.md). This is not a physical-device PASS.';

/** How long to wait for the farm to publish its HUD after navigation. */
const BOOT_BUDGET_MS = 30_000;
/** How long to wait for CDP to stop answering after browser.kill(). */
const BROWSER_CLOSE_BUDGET_MS = 8_000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * The farm address, ALWAYS built from a server's `origin`.
 *
 * `owned-server.mjs` hands back `url` as the retained client's game address (`/?hero=...`), which is
 * an address and not a prefix -- pasting `/farm/` onto it would request the site root with a
 * nonsense query. `origin` is the field for building a sibling page, and the farm is a sibling.
 */
export function farmUrlFor(origin) {
  return new URL(FARM_PATH, origin).href;
}

/**
 * Parse the CLI. Pure and exported so the `--repo` seam (the whole reason this tool is reusable on
 * another lane) is pinned by a test rather than by a comment.
 */
export function parseArgs(argv, { cwd = process.cwd(), driverRoot = DRIVER_ROOT } = {}) {
  const args = [...argv];
  const valueOf = (name) => {
    const index = args.indexOf(`--${name}`);
    if (index === -1) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`);
    return value;
  };
  const repo = valueOf('repo');
  return {
    repoRoot: repo ? resolve(cwd, repo) : resolve(driverRoot),
    outDir: resolve(cwd, valueOf('out') ?? join(driverRoot, '.local', 'runtime-test', 'farm-capture')),
    label: valueOf('label') ?? 'farm',
    headed: args.includes('--headed'),
    quiet: args.includes('--quiet'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

export const USAGE = `Farm running-pixels capture driver

  node tools/runtime-test/capture-farm.mjs [options]

  --repo <path>   checkout to serve (default: this driver's checkout). The receipt records this
                  checkout's worktree and SHA separately from the driver's.
  --out <dir>     output root (default: <driver>/.local/runtime-test/farm-capture, the review-suite
                  evidence path; pass a .local/<your-area> path to keep a task's captures separate)
  --label <name>  filename prefix for this run's PNGs (default: farm)
  --headed        run a headed browser instead of headless (needs a display)
  --quiet         suppress the server/browser progress lines
  -h, --help      print this text

Writes <out>/<stamp>/{landscape,portrait}.png plus receipt.json and receipt.md. Diagnostic only:
an emulated headless capture can reject a candidate, never accept it as iPad/human PASS.`;

/**
 * The exact source identity a receipt must be bound to. Returns `{ available: false, path, reason }`
 * rather than throwing when the path is not a git checkout, so a capture against a bad `--repo`
 * reports itself honestly instead of crashing after the browser is already up.
 */
export function readSourceIdentity(repoRoot) {
  const git = (...gitArgs) => execFileSync('git', ['-C', repoRoot, ...gitArgs], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  try {
    return {
      available: true,
      path: git('rev-parse', '--show-toplevel'),
      branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
      headSha: git('rev-parse', 'HEAD'),
      dirty: git('status', '--porcelain').length > 0,
    };
  } catch (error) {
    return { available: false, path: resolve(repoRoot), reason: String(error?.message ?? error) };
  }
}

/**
 * Does this raw CDP event carry a browser console or runtime ERROR?
 *
 * Exported and pure because "check the console for errors" is one of the few claims this driver
 * makes, and the classification (error, not warning/log) is worth pinning. Returns the text, or
 * null. `Log.entryAdded` and `Runtime.consoleAPICalled` can both report one page error, so callers
 * de-duplicate; a driver that silently dropped one of the routes would miss real failures.
 */
export function consoleErrorFromCdpMessage(message) {
  if (message?.method === 'Runtime.exceptionThrown') {
    const details = message.params?.exceptionDetails;
    return details?.exception?.description ?? details?.text ?? 'uncaught exception';
  }
  if (message?.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
    const entry = message.params.entry;
    return entry.url ? `${entry.text} [${entry.url}]` : entry.text;
  }
  if (message?.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    return (message.params.args ?? [])
      .map((arg) => arg.value ?? arg.description ?? arg.type)
      .join(' ');
  }
  return null;
}

/** A port nobody is bound to, so `startAutomationChrome` genuinely owns (and can kill) the browser. */
function findFreePort() {
  return new Promise((found, failed) => {
    const tester = createServer();
    tester.once('error', failed);
    tester.listen(0, '0.0.0.0', () => {
      const { port } = tester.address();
      tester.close(() => found(port));
    });
  });
}

/** The websocket CDP wrapper the rest of this directory uses; no Puppeteer, no npm (GQ-007). */
class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: done, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message)); else done(message.result);
      }
    });
  }

  ready() {
    return new Promise((done, failed) => {
      this.ws.addEventListener('open', done, { once: true });
      this.ws.addEventListener('error', () => failed(new Error('websocket error')), { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((done, failed) => {
      this.pending.set(id, { resolve: done, reject: failed });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) failed(new Error(`${method} timed out`));
      }, 30_000);
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Everything a reader needs to bind the pixels to a source, in both machine and prose form. */
function buildReceipt({
  driverSource, servedSource, server, chrome, viewports, consoleErrors, checks, cleanup, startedAt,
}) {
  return {
    note: RECEIPT_NOTE,
    generatedAt: new Date().toISOString(),
    startedAt,
    nodeVersion: process.version,
    driver: { source: driverSource },
    served: {
      source: servedSource,
      farmEntry: join(servedSource.path ?? '', 'prototypes', 'farm-slice', 'index.html'),
      farmUrl: farmUrlFor(server.origin),
    },
    server: { origin: server.origin, port: server.port },
    browser: {
      port: chrome.port,
      version: chrome.browser,
      executable: chrome.executable,
      startedHere: chrome.startedHere,
      headless: chrome.headless,
    },
    viewports,
    consoleErrors: [...new Set(consoleErrors)],
    checks,
    cleanup,
  };
}

function receiptMarkdown(receipt) {
  const lines = [
    `# Farm capture receipt`,
    '',
    `> ${receipt.note}`,
    '',
    `- generated: ${receipt.generatedAt}`,
    `- driver worktree: \`${receipt.driver.source.path}\``,
    `- driver commit: \`${receipt.driver.source.headSha}\` (${receipt.driver.source.branch},`,
    `  dirty: ${receipt.driver.source.dirty})`,
    `- served worktree: \`${receipt.served.source.path}\``,
    `- served commit: \`${receipt.served.source.headSha}\` (${receipt.served.source.branch},`,
    `  dirty: ${receipt.served.source.dirty})`,
    `- farm URL: ${receipt.served.farmUrl}`,
    `- browser: ${receipt.browser.version} on port ${receipt.browser.port}`,
    '',
    '## Captures',
    '',
  ];
  for (const viewport of receipt.viewports) {
    lines.push(`- ${viewport.name} ${viewport.width}x${viewport.height} -> \`${viewport.screenshot}\``
      + ` (booted: ${viewport.booted}, touch points: ${viewport.touchPoints})`);
  }
  lines.push('', '## Checks', '');
  for (const check of receipt.checks) {
    lines.push(`- ${check.passed ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  }
  lines.push('', '## Console / runtime errors', '');
  lines.push(receipt.consoleErrors.length === 0
    ? '- none observed'
    : receipt.consoleErrors.map((error) => `- ${error}`).join('\n'));
  lines.push('', '## Cleanup', '', '```json', JSON.stringify(receipt.cleanup, null, 2), '```', '');
  return lines.join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const servedEntry = join(options.repoRoot, 'prototypes', 'farm-slice', 'index.html');
  if (!existsSync(servedEntry)) {
    throw new Error(`--repo ${options.repoRoot} has no farm game at ${servedEntry}`);
  }
  const driverSource = readSourceIdentity(DRIVER_ROOT);
  const servedSource = readSourceIdentity(options.repoRoot);

  const runDir = join(options.outDir, `${options.label}-${stamp()}`);
  mkdirSync(runDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const results = [];
  let failures = 0;
  const check = (name, passed, detail) => {
    results.push({ name, passed, detail });
    if (!passed) failures += 1;
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  };
  const say = (line) => { if (!options.quiet) console.log(line); };

  // The receipt's whole value is binding the pixels to a SHA. `readSourceIdentity` reports a
  // non-checkout instead of throwing (so `--repo` can be diagnosed), but the driver has to actually
  // gate that report -- otherwise a bad checkout writes a receipt with an undefined SHA that still
  // says 10 PASS.
  check('the driver checkout is a git checkout, so the receipt can bind its SHA', driverSource.available,
    driverSource.available ? driverSource.headSha : driverSource.reason);
  check('the served checkout is a git checkout, so the receipt can bind its SHA', servedSource.available,
    servedSource.available ? servedSource.headSha : servedSource.reason);

  let server = null;
  let chrome = null;
  let page = null;
  let targetId = null;
  let profileDir = null;
  const consoleErrors = [];
  const viewports = [];
  let cleanedUp = false;

  async function cleanup() {
    if (cleanedUp) return { serverKilled: false, browserPortClosed: false, profileRemoved: false };
    cleanedUp = true;
    if (page && targetId) await page.send('Target.closeTarget', { targetId }).catch(() => {});
    page?.ws.close();
    chrome?.ws?.close?.();
    const serverKilled = server ? await server.kill() : false;
    chrome?.kill?.();
    let browserPortClosed = false;
    if (chrome) {
      const deadline = Date.now() + BROWSER_CLOSE_BUDGET_MS;
      while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await probeChrome(chrome.port))) { browserPortClosed = true; break; }
        // eslint-disable-next-line no-await-in-loop
        await sleep(200);
      }
    }
    let profileRemoved = false;
    if (profileDir) {
      try { rmSync(profileDir, { recursive: true, force: true }); profileRemoved = true; } catch { /* reported */ }
    }
    return { serverKilled, browserPortClosed, profileRemoved };
  }

  // The browser this driver started is not covered by owned-server's process-level 'exit' net, so
  // register the same kind of unconditional teardown here. The handlers are synchronous by
  // necessity; the awaited cleanup above still runs on every explicit path.
  process.on('exit', () => {
    if (!cleanedUp) {
      chrome?.kill?.();
      if (profileDir) { try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* best effort */ } }
    }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      cleanup().finally(() => process.exit(1));
    });
  }

  let cleanupState = { serverKilled: false, browserPortClosed: false, profileRemoved: false };
  try {
    server = await startOwnedServer({ repoRoot: options.repoRoot, quiet: options.quiet });
    say(`  farm capture server on ${server.origin} (pid ${server.child.pid})`);

    const farmResponse = await fetch(farmUrlFor(server.origin));
    const farmHtml = farmResponse.ok ? await farmResponse.text() : '';
    check('the served checkout answers /farm/ with the farm page', farmResponse.ok && farmHtml.includes('scene-canvas'),
      `HTTP ${farmResponse.status}`);

    const chromePort = await findFreePort();
    profileDir = mkdtempSync(join(tmpdir(), 'galaquest-farm-capture-'));
    chrome = await startAutomationChrome({
      port: chromePort,
      headless: !options.headed,
      profileDir,
      quiet: options.quiet,
    });
    chrome.headless = !options.headed;
    check('the driver owns the browser it started', chrome.startedHere,
      chrome.startedHere ? `started on ${chrome.port}` : `inherited an existing browser on ${chrome.port}`);

    const version = await fetch(`http://127.0.0.1:${chrome.port}/json/version`).then((r) => r.json());
    const browser = new CDP(version.webSocketDebuggerUrl);
    await browser.ready();
    ({ targetId } = await browser.send('Target.createTarget', { url: 'about:blank' }));
    const targets = await fetch(`http://127.0.0.1:${chrome.port}/json/list`).then((r) => r.json());
    page = new CDP(targets.find((target) => target.id === targetId).webSocketDebuggerUrl);
    await page.ready();
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Log.enable');
    page.ws.addEventListener('message', (event) => {
      const error = consoleErrorFromCdpMessage(JSON.parse(event.data));
      if (error !== null) consoleErrors.push(error);
    });

    for (const viewport of CAPTURE_VIEWPORTS) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor,
        mobile: viewport.mobile,
        screenOrientation: {
          type: viewport.width >= viewport.height ? 'landscapePrimary' : 'portraitPrimary',
          angle: 0,
        },
      });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      // GQ-008: clear before the first navigation, so no previous run's localStorage guest leaks in.
      await page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'local_storage' });
      await page.send('Page.navigate', { url: farmUrlFor(server.origin) });

      let booted = false;
      const deadline = Date.now() + BOOT_BUDGET_MS;
      while (Date.now() < deadline && !booted) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(250);
        // eslint-disable-next-line no-await-in-loop
        booted = await page.eval(`(() => {
          const canvas = document.getElementById('scene-canvas');
          const chip = document.querySelector('.gq-goal-chip');
          return Boolean(canvas && canvas.width > 0 && canvas.height > 0 && chip);
        })()`).catch(() => false);
      }
      check(`the farm boots at ${viewport.name} ${viewport.width}x${viewport.height}`, booted);
      if (!booted) { viewports.push({ ...viewport, booted, touchPoints: null, screenshot: null }); continue; }

      await page.eval('new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))').catch(() => {});
      const touchPoints = await page.eval('navigator.maxTouchPoints');
      check(`touch emulation is live at ${viewport.name}`, Number(touchPoints) >= 1,
        `navigator.maxTouchPoints=${touchPoints}`);

      const { data } = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const screenshotPath = join(runDir, `${options.label}-${viewport.name}.png`);
      writeFileSync(screenshotPath, Buffer.from(data, 'base64'));
      viewports.push({ ...viewport, booted, touchPoints, screenshot: screenshotPath });
    }
  } finally {
    cleanupState = await cleanup();
  }

  check('the owned server was torn down and its port is free', cleanupState.serverKilled === true,
    JSON.stringify(cleanupState));
  check('the owned browser was torn down', cleanupState.browserPortClosed === true,
    JSON.stringify(cleanupState));
  check('the throwaway browser profile was removed', cleanupState.profileRemoved === true,
    JSON.stringify(cleanupState));
  check('no browser console or runtime errors during the captures', consoleErrors.length === 0,
    [...new Set(consoleErrors)].slice(0, 3).join(' | ') || 'clean');

  const receipt = buildReceipt({
    driverSource, servedSource, server, chrome, viewports, consoleErrors, checks: results, cleanup: cleanupState, startedAt,
  });
  writeFileSync(join(runDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(join(runDir, 'receipt.md'), receiptMarkdown(receipt));

  const passed = results.filter((result) => result.passed).length;
  console.log(`\n${passed} PASS / ${failures} FAIL  (${results.length} checks)`);
  console.log(`receipt: ${join(runDir, 'receipt.md')}`);
  console.log(RECEIPT_NOTE);
  return failures ? 1 : 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(`\nfarm capture failed: ${error?.stack ?? error}`);
    process.exit(1);
  });
}
