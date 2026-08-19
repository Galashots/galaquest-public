/**
 * Photograph native hero `Idle_11` IN THE RUNNING GAME, fully geared (sword, shield, armour atlas),
 * RAW against IDLE_ARM_SETTLE-applied, at inspection bearings plus 8 frames through one cycle.
 *
 *   node tools/runtime-test/review-hero-idle11.mjs [--candidate tmp/ap2/hero-idle11-raw.glb]
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223.
 *
 * WHY THIS EXISTS. AP2-A CONTINUE ITEM 5: do not author idle_1h_shield yet -- first find out whether
 * the native Idle_11 clip, with the hero's ACTUAL equipment mounted, beats the current held-walk-frame
 * fallback on its own, and whether IDLE_ARM_SETTLE (tuned against Idle_02's specific 46-degree
 * scarecrow arms) helps or actively hurts a differently-posed candidate. Same "captures, a person
 * judges" contract as review-keeper-idle.mjs; this does not choose a winner.
 *
 * OUTCOME: Sol reviewed both columns and ruled RAW the winner -- "the old IDLE_ARM_SETTLE clearly
 * damages Idle_11 by collapsing both arms inward." The shipped hero_lod1_ironwood_atlas.glb now
 * carries Idle_11 under 'idle' (built exactly the way the candidate below was), and
 * createLocomotionController's applyIdleSettle option defaults to false. This harness is kept, not
 * retired -- the same raw-vs-settled A/B is exactly what the NEXT idle candidate will need.
 *
 * THE CANDIDATE IS INJECTED OVER CDP (Fetch.requestPaused) in place of the shipped hero GLB, never
 * copied into public/. Built by removing the shipped 'idle' (Idle_02) entry and merging Idle_11 in
 * under the same name, so createLocomotionController's `findClip(animations, 'idle')` picks it up
 * with no ambiguity:
 *   node -e "<strip the existing 'idle' animation entry, see this file's own commit for the script>"
 *   node tools/foundry/merge_clips.mjs --into tmp/ap2/hero-no-idle02.glb \
 *     --out tmp/ap2/hero-idle11-raw.glb \
 *     --from "tmp/ap2/hero/Meshy_AI_human_base_body_rig_biped_Animation_Idle_11_withSkin.glb=idle"
 *
 * RAW vs SETTLED is a CODE toggle, not two GLBs: `window.__DEBUG_FORCE_IDLE_SETTLE__` is read once,
 * at hero load, by main.js's own createLocomotionController() call (see that file and
 * locomotion.js's doc comment on the `applyIdleSettle` option) -- set via
 * Page.addScriptToEvaluateOnNewDocument so it exists before any page script runs, since main.js wires
 * the locomotion controller within the first second after the hero loads. Deliberately opt-IN (RAW
 * needs no global at all now that it is the shipped default): SETTLED is the one that sets it.
 *
 * Exits 0 unconditionally -- an instrument, not a gate.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const args = process.argv.slice(2);
const CANDIDATE = args.includes('--candidate') ? args[args.indexOf('--candidate')] : 'tmp/ap2/hero-idle11-raw.glb';
if (!existsSync(CANDIDATE)) {
  console.error(`candidate not found: ${CANDIDATE}\n(gitignored -- see this file's header for the two build commands)`);
  process.exit(2);
}

const OUT = fileURLToPath(new URL('../../.local/runtime-test/hero-idle11/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 900, height: 1000, deviceScaleFactor: 1, mobile: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  on(fn) { this.listeners.push(fn); }
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
    });
  }
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
    if (r.exceptionDetails) throw new Error(`eval threw: ${r.exceptionDetails.text}`);
    return r.result.value;
  }
}

const bytes = readFileSync(CANDIDATE);
const body = bytes.toString('base64');

/** One full pass -- RAW or SETTLED -- in its own server + tab, so the two never share any state. */
async function runVariant(label, disableSettle) {
  const server = await startOwnedServer();
  const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
  const browser = new CDP(version.webSocketDebuggerUrl);
  await browser.ready();
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
  const page = new CDP(list.find((t) => t.id === targetId).webSocketDebuggerUrl);
  await page.ready();
  await page.send('Runtime.enable');
  await page.send('Page.enable');

  const consoleErrors = [];
  await page.send('Log.enable');
  page.on((msg) => {
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(msg.params.entry.text);
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.text);
  });

  await page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'local_storage' });

  // AP2-A shipped with the settle off by default (main.js's own doc comment), so RAW needs no global
  // at all now -- only SETTLED opts back in, via window.__DEBUG_FORCE_IDLE_SETTLE__. Set BEFORE any
  // page script runs -- main.js reads this within the first second of the hero loading, well before
  // a post-navigation eval could land.
  if (!disableSettle) {
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.__DEBUG_FORCE_IDLE_SETTLE__ = true;',
    });
  }

  let served = 0;
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*hero_lod1_ironwood_atlas.glb*' }] });
  page.on(async (msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    try {
      if (request.url.includes('hero_lod1_ironwood_atlas.glb')) {
        served += 1;
        await page.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'model/gltf-binary' },
            { name: 'Content-Length', value: String(bytes.length) },
          ],
          body,
        });
      } else {
        await page.send('Fetch.continueRequest', { requestId });
      }
    } catch (error) {
      console.error(`  interception failed: ${error.message}`);
    }
  });

  await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Page.navigate', { url: server.url });

  let heroReady = false;
  for (let i = 0; i < 80 && !heroReady; i += 1) {
    await sleep(500);
    heroReady = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
  }
  if (!heroReady) throw new Error(`runtime never came up on ${server.url}`);
  console.log(`[${label}] hero.glb intercepted ${served} time(s)`);

  // Let the idle settle blend fully in (IDLE_SETTLE_SECONDS = CROSSFADE_SECONDS = 0.18s) and let the
  // idle clip actually start playing before any capture.
  await sleep(700);

  const hud = await page.eval(`(() => {
    const canvas = document.querySelector('canvas');
    let n = 0;
    for (const el of document.body.querySelectorAll('*')) {
      if (el === canvas || el.contains(canvas)) continue;
      if (el.closest('canvas')) continue;
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'absolute') { el.style.display = 'none'; n += 1; }
    }
    return n;
  })()`);
  console.log(`[${label}] HUD hidden (${hud} overlay elements)`);

  const settleWeight = await page.eval(`window.__galaQuestRuntime.locomotion().getState().settleWeight`);
  console.log(`[${label}] settleWeight after settle time = ${settleWeight} (expected ${disableSettle ? '0' : '1'})`);

  async function look(headingRadians, distance, pitch) {
    await page.eval(`(() => {
      const f = window.__galaQuestRuntime.follow;
      f.setHeading(${headingRadians});
      f.setDistance(${distance});
      f.orbit(0, ${pitch} - f.pitch);
    })()`);
    await sleep(250);
  }
  let shotIndex = 0;
  async function shot(name) {
    shotIndex += 1;
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    const file = `${OUT}${label}-${String(shotIndex).padStart(2, '0')}-${name}.png`;
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`  [${label}] captured ${file.split(/[\\/]/).pop()}`);
    return file;
  }

  console.log(`[${label}] -- inspection bearings --`);
  const BEARINGS = [
    ['front', Math.PI],
    ['front-three-quarter', Math.PI * 0.75],
    ['side-right', Math.PI * 0.5],
    ['side-left', Math.PI * 1.5],
    ['back', 0],
  ];
  for (const [name, heading] of BEARINGS) {
    await look(heading, 2.6, 0.18);
    await shot(`inspect-${name}`);
  }

  console.log(`[${label}] -- 8 frames through one Idle_11 cycle (fixed front-3/4) --`);
  await look(Math.PI * 0.75, 2.6, 0.18);
  // Idle_11 measures 1.9333s (the private engineering archive).
  const CYCLE_SECONDS = 1.9333;
  for (let i = 0; i < 8; i += 1) {
    await sleep((CYCLE_SECONDS / 8) * 1000);
    await look(Math.PI * 0.75, 2.6, 0.18);
    await shot(`cycle-${i}`);
  }

  console.log(`[${label}] console errors: ${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 6)) console.log(`    ${e}`);

  await server.kill();
  await browser.send('Target.closeTarget', { targetId }).catch(() => {});
  return { label, served, settleWeight, consoleErrors, shotCount: shotIndex };
}

const results = [];
results.push(await runVariant('raw', true));
results.push(await runVariant('settled', false));

writeFileSync(`${OUT}manifest.json`, JSON.stringify({ candidate: CANDIDATE, results }, null, 2));
console.log(`\n${results.reduce((n, r) => n + r.shotCount, 0)} total captures in ${OUT}`);
console.log('NOTHING IS JUDGED BY THIS SCRIPT. Open every capture and say what is wrong with it.');
process.exit(0);
