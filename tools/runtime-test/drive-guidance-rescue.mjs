/**
 * "A child can never be lost" -- the recovery path, proven.
 *
 * Checkpoint 2 built four guidance layers: an objective line with a real coordinate
 * (world/destinations.js), a minimap, an off-screen pointer, and a last-resort rescue button. The
 * first three were covered. The BUTTON was not: before this harness, nothing anywhere asserted that
 * "👀 Show me where" actually brings a lost child back. The one file that mentioned #guidance-rescue
 * was drive-hero-screen.mjs, and only to check it gets out of the way when a panel opens.
 *
 * That is the wrong thing to leave untested in the checkpoint named after it. A rescue button that
 * silently stopped working would take the whole "never lost" claim with it and no gate would notice.
 *
 * The shape of the proof matters as much as the proof:
 *   PRECONDITION -- getting lost is not the thing under test, so turn the camera until the objective
 *                   really has left the frame, and fail loudly if it never does.
 *   CONTROL      -- tap empty ground first and require that it does NOT recover. Without it this
 *                   harness would pass just as happily if ANY touch recentred the camera, which
 *                   would make the button itself unproven all over again.
 *   PROPERTY     -- then tap the button and require the objective back in frame.
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer, gameUrlFor } from './owned-server.mjs';

const CHROME_PORT = 9224;
const VIEWPORT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const server = await startOwnedServer();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let failures = 0;
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map();
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      }
    });
  }
  ready() { return new Promise((res, rej) => {
    this.ws.addEventListener('open', res, { once: true });
    this.ws.addEventListener('error', () => rej(new Error('websocket error')), { once: true }); }); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}

const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
const browser = new CDP(version.webSocketDebuggerUrl);
await browser.ready();
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const targets = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
const page = new CDP(targets.find((t) => t.id === targetId).webSocketDebuggerUrl);
await page.ready();
await page.send('Runtime.enable');
await page.send('Log.enable');
const consoleErrors = [];
page.ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push(msg.params.entry.text);
  }
});
await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'local_storage' });
await page.send('Page.navigate', { url: gameUrlFor(server.origin) });

const state = () => page.eval(`(() => {
  const shown = (id) => document.getElementById(id)?.dataset.shown === 'true';
  const r = window.__galaQuestRuntime;
  return {
    pointer: shown('objective-pointer'),
    rescue: shown('guidance-rescue'),
    objective: document.getElementById('quest-objective')?.textContent.trim() ?? null,
    heading: Number(r.follow.heading.toFixed(4)),
  };
})()`);

/**
 * Wait for a STATE, never for the clock. data-shown flips on a rendered frame and the hosted runner
 * renders at a few frames a second (GQ-021); a fixed sleep here would be the same defect
 * drive-touch's settle had. Returns the last sample either way so the caller can report it.
 */
async function waitFor(predicate, budgetMs, label) {
  const deadline = Date.now() + budgetMs;
  let last = await state();
  while (Date.now() < deadline) {
    if (predicate(last)) return { ok: true, last };
    await sleep(120);
    last = await state();
  }
  console.log(`  (timed out waiting for ${label}: ${JSON.stringify(last)})`);
  return { ok: false, last };
}

let booted = false;
for (let i = 0; i < 70 && !booted; i += 1) {
  await sleep(500);
  booted = await page.eval('Boolean(window.__galaQuestRuntime?.hero)').catch(() => false);
}
check('the game boots and the hero exists', booted);
if (!booted) {
  await browser.send('Target.closeTarget', { targetId });
  await server.kill();
  process.exit(1);
}
await waitFor((s) => Boolean(s.objective), 15000, 'an objective to be published');

async function shot(name) {
  await page.eval('new Promise((r) => { let n = 0; const t = () => (++n >= 4 ? r(n) : requestAnimationFrame(t)); requestAnimationFrame(t); })').catch(() => null);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(`${OUT}guidance-rescue-${name}.png`, Buffer.from(data, 'base64'));
}

/** The camera drag drive-touch proves turns the camera: +20px steps, touchEnd CARRIES the point. */
async function turnCamera() {
  const x0 = VIEWPORT.width * 0.7;
  const y0 = VIEWPORT.height * 0.3;
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  await sleep(60);
  for (let i = 1; i <= 10; i += 1) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 20, y: y0 }] });
    await sleep(40);
  }
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: x0 + 200, y: y0 }] });
}

async function tapAt(x, y) {
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x, y }] });
}

// ── precondition: actually get lost ───────────────────────────────────────────────────────────
const atSpawn = await state();
let lost = atSpawn;
for (let i = 0; i < 8 && !lost.pointer; i += 1) {
  await turnCamera();
  lost = (await waitFor((s) => s.pointer, 2500, 'the objective to leave the frame')).last;
}
check('the camera turns under a real drag', Math.abs(lost.heading - atSpawn.heading) > 0.2,
  `heading ${atSpawn.heading} -> ${lost.heading}`);
check('turning away loses the objective off-camera', lost.pointer && lost.rescue,
  `${JSON.stringify(lost)} -- if this is false nothing below proves anything`);
await shot('01-lost');

// ── control: something that must NOT recover ──────────────────────────────────────────────────
await tapAt(Math.round(VIEWPORT.width * 0.5), Math.round(VIEWPORT.height * 0.68));
const stray = (await waitFor((s) => s.pointer === false, 2000, 'a stray tap to (wrongly) recover')).last;
check('control: a tap on empty ground does NOT recover the objective', stray.pointer === true,
  `pointer=${stray.pointer} rescue=${stray.rescue}`);

// ── the property ──────────────────────────────────────────────────────────────────────────────
const box = await page.eval(`(() => {
  const el = document.getElementById('guidance-rescue');
  if (!el || el.dataset.shown !== 'true') return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
           w: Math.round(r.width), h: Math.round(r.height) };
})()`);
check('the rescue button is laid out on screen', Boolean(box), JSON.stringify(box));

if (box) {
  const reached = await page.eval(`(() => {
    const el = document.elementFromPoint(${box.x}, ${box.y});
    return el ? (el.id || el.tagName.toLowerCase()) : 'NOTHING';
  })()`);
  check('a finger on the rescue button reaches the rescue button', reached === 'guidance-rescue',
    `reached ${reached}`);
  check('the rescue button clears the 44px touch floor', box.w >= 44 && box.h >= 44, `${box.w}x${box.h}`);

  await tapAt(box.x, box.y);
  const recovered = await waitFor((s) => s.pointer === false, 6000, 'the objective to come back on screen');
  check('tapping "Show me where" brings the objective back on screen', recovered.ok,
    `pointer=${recovered.last.pointer} rescue=${recovered.last.rescue}`
    + ` heading ${lost.heading} -> ${recovered.last.heading}`);
  check('...and it did so by turning the camera, not by moving the child',
    Math.abs(recovered.last.heading - lost.heading) > 0.2,
    `heading ${lost.heading} -> ${recovered.last.heading}`);
  await shot('02-recovered');
}

check('no console errors during the whole run', consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | ') || 'clean');

console.log(`\n${results.filter((r) => r.passed).length} PASS / ${failures} FAIL  (${results.length} checks)`);
await browser.send('Target.closeTarget', { targetId });
await server.kill();
process.exit(failures ? 1 : 0);
