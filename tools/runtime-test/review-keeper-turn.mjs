/**
 * Photograph the Keeper's native-clip turning IN THE RUNNING GAME, across the six scenarios the
 * AP2-A brief names, and record his measured world heading at each stage.
 *
 *   node tools/runtime-test/review-keeper-turn.mjs [--candidate tmp/ap2/keeper-turns.glb]
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223.
 *
 * WHY THIS EXISTS. tools/foundry/diagnose_keeper_turn.mjs already proves position drift and
 * final-heading error offline, through the REAL createKeeperTurnController against the REAL clips --
 * that is the authoritative numeric proof. What it cannot show is what the turn LOOKS like: whether
 * the crossfade pops, whether the clip's own opening pose (the left clip starts 14 degrees off rest,
 * measured) reads as a snap, whether the coat or the lantern intersect mid-stride. That is what this
 * captures, exactly as review-keeper-idle.mjs's header explains for the idle candidates.
 *
 * THE CANDIDATE IS INJECTED OVER CDP (Fetch.requestPaused), never copied into public/ -- same
 * discipline as review-keeper-idle.mjs and review-keeper-material.mjs.
 *
 * HOW A HEADING IS PRODUCED. main.js feeds the keeper presenter heroPositions built straight from
 * `player.position` every frame (main.js:928-932), and the presenter's own wanted heading is
 * headingToward(keeper, nearestHero) -- plain atan2. So a scenario is driven by teleporting the hero
 * to the (x, z) that atan2 resolves to the desired heading, not by walking a joystick there, which
 * would be slower and less exact for no benefit: the presenter cannot tell a teleport from a walk.
 *
 * Exits 0 unconditionally -- an instrument, not a gate. The measured headings printed here are
 * read from the SAME scene graph the screenshots come from, so a viewer can cross-check a capture
 * against the number instead of trusting either alone.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const args = process.argv.slice(2);
const CANDIDATE = args.includes('--candidate') ? args[args.indexOf('--candidate') + 1] : 'tmp/ap2/keeper-turns.glb';
const LABEL = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'turns';

if (!existsSync(CANDIDATE)) {
  console.error(`candidate not found: ${CANDIDATE}\n(gitignored -- see the private engineering archive for the merge command)`);
  process.exit(2);
}

const server = await startOwnedServer();
const ORIGIN_UNDER_TEST = server.origin;
const URL_UNDER_TEST = server.url;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/keeper-turn/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
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

const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
const browser = new CDP(version.webSocketDebuggerUrl);
await browser.ready();
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
const page = new CDP(list.find((t) => t.id === targetId).webSocketDebuggerUrl);
await page.ready();
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Log.enable');

const consoleErrors = [];
page.on((msg) => {
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(msg.params.entry.text);
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.text);
});

await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });

let served = 0;
const bytes = readFileSync(CANDIDATE);
const body = bytes.toString('base64');
await page.send('Fetch.enable', { patterns: [{ urlPattern: '*keeper.glb*' }] });
page.on(async (msg) => {
  if (msg.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = msg.params;
  try {
    if (request.url.includes('keeper.glb')) {
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
console.log(`serving ${CANDIDATE} (${bytes.length.toLocaleString()} bytes) in place of the shipped keeper.glb`);

await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Page.navigate', { url: URL_UNDER_TEST });

let heroReady = false;
for (let i = 0; i < 80 && !heroReady; i += 1) {
  await sleep(500);
  heroReady = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
}
if (!heroReady) throw new Error(`runtime never came up on ${URL_UNDER_TEST}`);

const zoneDebug = () => page.eval('window.__galaQuestRuntime.zoneDebug()');
let zone = await zoneDebug();
for (let i = 0; i < 120 && (zone.requested === 0 || zone.loaded + zone.failed < zone.requested); i += 1) {
  await sleep(250);
  zone = await zoneDebug();
}
console.log(`zone: requested ${zone.requested}, loaded ${zone.loaded}, failed ${zone.failed}`);
console.log(`keeper.glb intercepted ${served} time(s)`);

async function hideHud() {
  const hidden = await page.eval(`(() => {
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
  console.log(`HUD hidden (${hidden} overlay elements)`);
}

async function pinKeeperOpacity() {
  const pinned = await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    let n = 0;
    r.scene.traverse((o) => {
      if (!o.isMesh) return;
      let p = o, isKeeper = false;
      while (p) { if (/keeper|villager/i.test(p.name ?? '')) { isKeeper = true; break; } p = p.parent; }
      if (!isKeeper) return;
      for (const m of [].concat(o.material)) {
        if (!m || !m.transparent) continue;
        m.transparent = false;
        m.needsUpdate = true;
        n += 1;
      }
    });
    return n;
  })()`);
  console.log(`keeper opacity pinned (${pinned} material(s) taken out of the transparent pass)`);
}

async function detachFollowCamera() {
  const detached = await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    if (!r.follow || typeof r.follow.update !== 'function') return false;
    r.follow.update = () => {};
    return true;
  })()`);
  if (!detached) throw new Error('could not detach the follow camera');
  console.log('follow camera detached');
}

/**
 * Stop the server from correcting a teleport straight back.
 *
 * owned-server.mjs spins up the REAL multiplayer server, so this game runs ONLINE, and main.js calls
 * `net.reconcile(player.position)` every frame -- "pulls the local prediction back towards the
 * server's version of us" (main.js's own comment). It mutates player.position IN PLACE toward
 * wherever the server last heard the hero was, which the server never heard about a scripted
 * teleport at all -- the first run of this harness set player.position for every scenario and every
 * one of them measured back at the keeper's ORIGINAL resting heading, because reconcile() snapped the
 * hero back before the presenter's next update() ever read it. `net` is exposed directly on
 * `window.__galaQuestRuntime` (main.js:532), so this is the same "detach the fighting writer" trick
 * detachFollowCamera already uses, not a new pattern.
 */
async function detachReconciliation() {
  const detached = await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    if (!r.net || typeof r.net.reconcile !== 'function') return false;
    r.net.reconcile = () => ({ drift: 0, snapped: false });
    return true;
  })()`);
  if (!detached) throw new Error('could not detach net.reconcile -- every teleport would be pulled back');
  console.log('server reconciliation detached (net.reconcile is a no-op for the rest of this run)');
}

/** The Keeper's world (x, z) and current heading (radians), read straight from the scene graph. */
async function keeperState() {
  return page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    let k = null;
    r.scene.traverse((o) => { if (!k && /^keeper$/i.test(o.name ?? '')) k = o; });
    if (!k) return null;
    const p = k.getWorldPosition(new r.camera.position.constructor());
    return { x: p.x, z: p.z, headingDegrees: (k.rotation.y * 180) / Math.PI };
  })()`);
}

/** Move the hero (and therefore heroPositions[0]) to the (x, z) the presenter will resolve to
 *  `headingDegrees` FROM the keeper's given (x, z). y is left at whatever the hero currently has. */
async function placeHeroAtHeading(keeperX, keeperZ, headingDegrees, distance = 4) {
  const rad = (headingDegrees * Math.PI) / 180;
  const x = keeperX + Math.sin(rad) * distance;
  const z = keeperZ + Math.cos(rad) * distance;
  await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    r.player.position.x = ${x};
    r.player.position.z = ${z};
    return true;
  })()`);
}

async function frameKeeper(bearing, distance, height = 0.9) {
  await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    let k = null;
    r.scene.traverse((o) => { if (!k && /^keeper$/i.test(o.name ?? '')) k = o; });
    if (!k) return false;
    const p = k.getWorldPosition(new r.camera.position.constructor());
    const b = ${bearing}, d = ${distance};
    r.camera.position.set(p.x + Math.sin(b) * d, p.y + ${height} + d * 0.10, p.z + Math.cos(b) * d);
    r.camera.lookAt(p.x, p.y + ${height}, p.z);
    r.camera.updateMatrixWorld(true);
    return true;
  })()`);
}

let shotIndex = 0;
async function shot(name) {
  shotIndex += 1;
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}${LABEL}-${String(shotIndex).padStart(2, '0')}-${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  captured ${file.split(/[\\/]/).pop()}`);
  return file;
}

await detachFollowCamera();
await detachReconciliation();
await hideHud();
await pinKeeperOpacity();

const keeper0 = await keeperState();
if (!keeper0) throw new Error('keeper node not found in the scene');
console.log(`keeper at (${keeper0.x.toFixed(2)}, ${keeper0.z.toFixed(2)}), resting heading ${keeper0.headingDegrees.toFixed(2)} deg`);

const report = [];

/**
 * One scenario leg: teleport the hero so the presenter resolves `deltaDegrees` FROM the keeper's
 * CURRENT heading, watch it settle, capture at teleport/mid-turn/settled, and record the measured
 * heading error against the number diagnose_keeper_turn.mjs computed for the same request.
 */
async function runLeg(scenarioName, legName, deltaDegrees, settleSeconds) {
  const before = await keeperState();
  const wantedHeadingDegrees = before.headingDegrees + deltaDegrees;
  await placeHeroAtHeading(keeper0.x, keeper0.z, wantedHeadingDegrees);

  await frameKeeper(Math.PI * 0.125, 3.0);
  await sleep(120);
  await shot(`${legName}-start`);

  await sleep(Math.min(500, settleSeconds * 250));
  await frameKeeper(Math.PI * 0.125, 3.0);
  await shot(`${legName}-mid`);

  await sleep(Math.max(0, settleSeconds * 1000 - 620));
  await frameKeeper(Math.PI * 0.125, 3.0);
  await shot(`${legName}-settled`);

  const after = await keeperState();
  const wanted = ((wantedHeadingDegrees % 360) + 540) % 360 - 180;
  const actual = ((after.headingDegrees % 360) + 540) % 360 - 180;
  let errorDegrees = actual - wanted;
  while (errorDegrees > 180) errorDegrees -= 360;
  while (errorDegrees < -180) errorDegrees += 360;

  const leg = {
    scenario: scenarioName, leg: legName, deltaDegrees, settleSeconds,
    beforeDegrees: before.headingDegrees, wantedDegrees: wantedHeadingDegrees,
    afterDegrees: after.headingDegrees, errorDegrees,
  };
  report.push(leg);
  console.log(`  ${scenarioName} / ${legName}: delta ${deltaDegrees.toFixed(1)} deg -> `
    + `measured error ${errorDegrees.toFixed(2)} deg`);
  return after;
}

console.log('\n-- ~30 degree change (below clip threshold) --');
await runLeg('30-degree', 'leg1', 30, 3);

console.log('\n-- ~90 degrees left --');
await runLeg('90-left', 'leg1', 90, 3);

console.log('\n-- ~90 degrees right --');
await runLeg('90-right', 'leg1', -90, 3);

console.log('\n-- ~175 degrees --');
await runLeg('175-degree', 'leg1', 175, 4);

console.log('\n-- repeated left -> right -> left --');
await runLeg('repeated', 'leg1-left', 90, 3);
await runLeg('repeated', 'leg2-right', -90, 3);
await runLeg('repeated', 'leg3-left', 90, 3);

console.log('\n-- rapid reversal mid-turn --');
{
  const before = await keeperState();
  const firstWanted = before.headingDegrees + 90;
  await placeHeroAtHeading(keeper0.x, keeper0.z, firstWanted);
  await frameKeeper(Math.PI * 0.125, 3.0);
  await sleep(120);
  await shot('reversal-triggered');
  await sleep(300); // well inside the clip's own ~1-1.2s duration
  const secondWanted = before.headingDegrees - 90;
  await placeHeroAtHeading(keeper0.x, keeper0.z, secondWanted);
  await frameKeeper(Math.PI * 0.125, 3.0);
  await sleep(120);
  await shot('reversal-interrupted');
  await sleep(3000);
  await frameKeeper(Math.PI * 0.125, 3.0);
  await shot('reversal-settled');
  const after = await keeperState();
  const wanted = ((secondWanted % 360) + 540) % 360 - 180;
  const actual = ((after.headingDegrees % 360) + 540) % 360 - 180;
  let errorDegrees = actual - wanted;
  while (errorDegrees > 180) errorDegrees -= 360;
  while (errorDegrees < -180) errorDegrees += 360;
  report.push({
    scenario: 'rapid-reversal', leg: 'final', deltaDegrees: -90, settleSeconds: 3,
    beforeDegrees: before.headingDegrees, wantedDegrees: secondWanted,
    afterDegrees: after.headingDegrees, errorDegrees,
  });
  console.log(`  rapid-reversal / final: measured error ${errorDegrees.toFixed(2)} deg`);
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 8)) console.log(`  ${e}`);

writeFileSync(`${OUT}manifest-${LABEL}.json`, JSON.stringify({
  label: LABEL, candidate: CANDIDATE, interceptedRequests: served, viewport: VIEWPORT,
  keeperStart: keeper0, zone, consoleErrors, report,
}, null, 2));

console.log(`\n${shotIndex} captures + report in ${OUT}`);
console.log('NOTHING IS JUDGED BY THIS SCRIPT. Open every capture and say what is wrong with it.');

await server.kill();
await browser.send('Target.closeTarget', { targetId }).catch(() => {});
process.exit(0);
