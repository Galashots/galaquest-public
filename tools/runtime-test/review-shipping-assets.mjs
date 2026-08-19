/**
 * The FINAL consolidated artist's-review capture, of the assets this branch actually ships, in the
 * running game -- the mandatory gate before integrating the hero/Keeper swaps into `main`.
 *
 *   node tools/runtime-test/review-shipping-assets.mjs [--tag <label>]
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223.
 *
 * WHY THIS EXISTS, and why it is not review-keeper-idle.mjs. That harness photographs a CANDIDATE
 * injected over CDP, and only the Keeper, and only his idle. the owner's ruling of 2026-08-15 (AGENTS.md
 * "Hard boundaries", full procedure in docs/pipeline/README.md iron rule 8) makes the artist's review
 * MANDATORY for the hero and any NPC a child talks to, on ANY edit including a new clip -- and Sol's
 * integration ruling asks for one final sheet taken from the EXACT files that will land on main,
 * after every clip merge, rather than from the candidates reviewed along the way. So this reads
 * `public/` as it stands, injects nothing, and covers both characters and every clip this branch
 * changed.
 *
 * It DOES NOT JUDGE, exactly like review-keeper-idle.mjs: it exits 0 whether the captures are
 * beautiful or broken, because a green exit code would be a lie about whether anybody has looked.
 * A person (or an agent standing in for one) opens the captures afterwards and says what is wrong.
 *
 * HOW THE WAVE IS DRIVEN. `window.__galaQuestRuntime` deliberately publishes STATE, not handles on
 * the rules ("a harness that could call requestAttack() on this object could drive the fight down a
 * path no child can reach" -- main.js). So there is no `celebrate()` to call from here, and adding
 * one would punch a hole in that boundary for a screenshot. Instead the wave is driven the way the
 * game drives it: park the hero inside KEEPER_WAVE_RADIUS_METERS. createKeeperPresenter's update()
 * re-fires the wave whenever it is not already waving and a hero is in range, so a parked hero makes
 * it repeat, which is what lets one run catch raise / peak / settle. `zoneKeeperState().waving` is
 * polled to find the START of a cycle rather than sampling blind at a guessed moment -- the exact
 * defect that once photographed a corpse while every check passed.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { startOwnedServer } from './owned-server.mjs';
import {
  GAMEPLAY_DISTANCE, INSPECTION_DISTANCE, PORTRAIT_VIEWPORT, BEARINGS, TAU,
} from '../../public/src/review/cameraPresets.js';

const CHROME_PORT = 9224;
const TAG = process.argv.includes('--tag')
  ? process.argv[process.argv.indexOf('--tag') + 1]
  : 'shipping';

const server = await startOwnedServer();
const URL_UNDER_TEST = server.url;
const ORIGIN_UNDER_TEST = server.origin;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/shipping-review/', import.meta.url));
mkdirSync(OUT, { recursive: true });

// The same iPad viewport every other harness photographs at, so these line up with the sheets
// already in the repo instead of being a new framing nobody can compare against. GAMEPLAY_DISTANCE/
// INSPECTION_DISTANCE now live in public/src/review/cameraPresets.js, shared with Character Studio
// (CSB) rather than redefined here.
const VIEWPORT = PORTRAIT_VIEWPORT;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
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
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 20000);
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
await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
// Fresh-guest discipline (GQ-008, docs/MISTAKES.md).
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
await page.send('Page.navigate', { url: URL_UNDER_TEST });

let ready = false;
for (let i = 0; i < 80 && !ready; i += 1) {
  await sleep(500);
  ready = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
}
if (!ready) throw new Error(`runtime never came up on ${URL_UNDER_TEST}`);
await sleep(800);

// Every connected client draws its OWN hero at the origin, so a stale tab puts a second hero in
// frame and the sheet silently lies. Same guard, and same reason, as fit-shield.mjs's.
const players = await page.eval(`(() => {
  const text = document.querySelector('#runtime-status')?.textContent ?? '';
  const m = text.match(/players\\s+(\\d+)/i);
  return m ? Number(m[1]) : -1;
})()`);
if (players !== 1) {
  console.error(`\n${players} clients are connected -- the capture would contain ${players} heroes.`);
  console.error(`Close the other tabs first:  curl -s http://127.0.0.1:${CHROME_PORT}/json/list`);
  await page.send('Target.closeTarget', { targetId });
  process.exit(2);
}

async function detachFollowCamera() {
  const ok = await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    if (!r.follow || typeof r.follow.update !== 'function') return false;
    r.follow.update = () => {};
    return true;
  })()`);
  if (!ok) throw new Error('could not detach the follow camera -- every capture would be the same frame');
  console.log('follow camera detached');
}

async function detachReconciliation() {
  const ok = await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    if (!r.net || typeof r.net.reconcile !== 'function') return false;
    r.net.reconcile = () => ({ drift: 0, snapped: false });
    return true;
  })()`);
  if (!ok) throw new Error('could not detach net.reconcile -- the hero would be pulled back out of wave range');
  console.log('server reconciliation detached');
}

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

/** Stop characters going see-through: the occlusion fade would otherwise ghost a rear capture. */
async function pinOpacity() {
  const pinned = await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    let n = 0;
    r.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (!m || !m.transparent) continue;
        m.transparent = false;
        m.needsUpdate = true;
        n += 1;
      }
    });
    return n;
  })()`);
  console.log(`opacity pinned (${pinned} materials out of the transparent pass)`);
}

/** World (x, z) of a named scene object. */
const worldXZ = (namePattern) => page.eval(`(() => {
  const r = window.__galaQuestRuntime;
  let o = null;
  r.scene.traverse((n) => { if (!o && ${namePattern}.test(n.name ?? '')) o = n; });
  if (!o) return null;
  const p = o.getWorldPosition(new r.camera.position.constructor());
  return { x: p.x, y: p.y, z: p.z };
})()`);

/** Point the camera at a subject from a compass bearing, at a distance. */
async function frame(namePattern, bearing, distance, height = 0.9) {
  const ok = await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    let o = null;
    r.scene.traverse((n) => { if (!o && ${namePattern}.test(n.name ?? '')) o = n; });
    if (!o) return false;
    const p = o.getWorldPosition(new r.camera.position.constructor());
    const b = ${bearing}, d = ${distance};
    r.camera.position.set(p.x + Math.sin(b) * d, p.y + ${height} + d * 0.10, p.z + Math.cos(b) * d);
    r.camera.lookAt(p.x, p.y + ${height}, p.z);
    r.camera.updateMatrixWorld(true);
    return true;
  })()`);
  if (!ok) throw new Error(`could not find a scene object matching ${namePattern}`);
}

async function placeHero(x, z) {
  await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    r.player.position.x = ${x};
    r.player.position.z = ${z};
    return true;
  })()`);
}

const captured = [];
const digests = new Map();
async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}${TAG}-${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  const twin = digests.get(digest);
  if (twin) console.log(`  !! ${name} is byte-identical to ${twin} -- nothing moved`);
  digests.set(digest, name);
  captured.push(file);
  console.log(`  captured ${TAG}-${name}.png`);
  return file;
}

// Sol's asked-for set: front, three-quarter, back. Now shared with Character Studio (CSB) via
// public/src/review/cameraPresets.js rather than redefined here.

await detachFollowCamera();
await detachReconciliation();
await hideHud();
await pinOpacity();

const keeper = await worldXZ('/^keeper$/i');
if (!keeper) throw new Error('no keeper in the scene');
console.log(`keeper at (${keeper.x.toFixed(2)}, ${keeper.z.toFixed(2)})`);

// ── HERO ────────────────────────────────────────────────────────────────────────────────────────
// Walk him well clear of the Keeper first: inside the notice radius the Keeper turns to watch and
// waves, which is the Keeper's review, not the hero's, and puts a second character in frame.
await placeHero(keeper.x + 14, keeper.z + 14);
await sleep(700);

console.log('\n== HERO: shipped Idle_11, equipped ==');
for (const [name, bearing] of BEARINGS) {
  await frame('/^hero$/i', bearing, GAMEPLAY_DISTANCE);
  await sleep(200);
  await shot(`hero-gameplay-${name}`);
}
for (const [name, bearing] of BEARINGS) {
  await frame('/^hero$/i', bearing, INSPECTION_DISTANCE);
  await sleep(200);
  await shot(`hero-inspection-${name}`);
}
// Eight frames through one Idle_11 cycle (1.9333 s, measured in AP2-A) from a fixed three-quarter,
// so the only thing changing between them is the pose.
console.log('\n-- hero: 8 frames through one Idle_11 cycle --');
const HERO_IDLE_SECONDS = 1.9333;
for (let i = 0; i < 8; i += 1) {
  await sleep((HERO_IDLE_SECONDS / 8) * 1000);
  await frame('/^hero$/i', TAU * 0.125, INSPECTION_DISTANCE);
  await shot(`hero-cycle-${i}`);
}

// ── KEEPER: idle, at both scales ────────────────────────────────────────────────────────────────
// Still out of range, so this is genuinely his idle rather than a wave caught mid-flight.
console.log('\n== KEEPER: shipped Idle_11 + corrected v2 material ==');
for (const [name, bearing] of BEARINGS) {
  await frame('/^keeper$/i', bearing, GAMEPLAY_DISTANCE);
  await sleep(200);
  await shot(`keeper-idle-gameplay-${name}`);
}
for (const [name, bearing] of BEARINGS) {
  await frame('/^keeper$/i', bearing, INSPECTION_DISTANCE);
  await sleep(200);
  await shot(`keeper-idle-inspection-${name}`);
}

// ── KEEPER: the new native wave ─────────────────────────────────────────────────────────────────
// Park the hero in range and let the presenter fire the wave on its own terms. Poll for the rising
// edge of `waving` so the frames land at known offsets into the clip instead of at a guessed moment.
console.log('\n== KEEPER: the new native wave (raise / peak / settle) ==');
await frame('/^keeper$/i', TAU * 0.125, INSPECTION_DISTANCE);
await placeHero(keeper.x + 1.4, keeper.z + 1.4);

const waving = () => page.eval('window.__galaQuestRuntime.zoneKeeperState()?.waving === true');

/**
 * Drive one fresh APPROACH and return as the greeting starts. Since the greeting latch landed the
 * wave fires once per approach and then hands back to talk, so the only way to see another one is
 * to walk the hero out past the re-arm radius and back in -- which is also exactly what a child
 * does. Before the latch this function's older form hung waiting for a falling edge that never came.
 */
async function approachAndWaitForWave(timeoutMs = 6000) {
  await placeHero(keeper.x + 5.0, keeper.z + 5.0); // well outside the 2.5 m re-arm radius
  const armed = Date.now() + 700;
  while (Date.now() < armed) await sleep(50);
  await placeHero(keeper.x + 1.0, keeper.z + 1.0); // inside the 2.0 m trigger radius
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await waving()) return true; await sleep(30); }
  return false;
}

// The clip is 1.967 s (measured). Sample it at three points that mean something: the arm on its way
// up, the held peak where the envelope is 1 and the hand is actually waving, and the settle back.
const WAVE_SAMPLES = [['raise', 250], ['peak', 900], ['settle', 1650]];
let waveCaught = 0;
for (const [name, offsetMs] of WAVE_SAMPLES) {
  if (!(await approachAndWaitForWave())) {
    console.log(`  !! wave never started for "${name}"`);
    continue;
  }
  await sleep(offsetMs);
  await frame('/^keeper$/i', TAU * 0.125, INSPECTION_DISTANCE);
  await shot(`keeper-wave-${name}`);
  waveCaught += 1;
}
// One gameplay-scale wave frame too: iron rule 8 wants both scales, and the wave is the one clip a
// child sees from across the village rather than up close.
if (await approachAndWaitForWave()) {
  await sleep(900);
  await frame('/^keeper$/i', TAU * 0.125, GAMEPLAY_DISTANCE);
  await shot('keeper-wave-gameplay-peak');
}

// ── KEEPER: Talk_Passionately ───────────────────────────────────────────────────────────────────
// main.js drives setTalking from the dialogue banner's own visibility, so standing in range with the
// quest line up is what puts him in `talk` -- again the game's own path, not a handle poked from here.
console.log('\n== KEEPER: Talk_Passionately ==');
// The hero is already parked in range from the last approach. Let the greeting finish; the latch
// keeps it from re-firing, so `wantsTalking` finally gets to hand the body to the talk clip -- the
// whole point of the fix. Before it, this capture came back as yet another wave frame.
await sleep(2600);
const talkState = await page.eval('JSON.stringify(window.__galaQuestRuntime.zoneKeeperState())');
console.log(`  keeper state after the greeting settles: ${talkState}`);
if (/"waving":true/.test(talkState ?? '')) {
  console.log('  !! still waving -- the greeting latch is not holding, this is NOT a talk frame');
}
for (let i = 0; i < 3; i += 1) {
  await frame('/^keeper$/i', TAU * 0.125, INSPECTION_DISTANCE);
  await shot(`keeper-talk-${i}`);
  await sleep(700);
}

console.log(`\n${captured.length} captures in ${OUT}`);
console.log(`wave cycles caught: ${waveCaught} of ${WAVE_SAMPLES.length}`);
writeFileSync(`${OUT}manifest-${TAG}.json`, JSON.stringify({
  tag: TAG,
  shippedFiles: ['public/assets/hero/hero_lod1_ironwood_atlas.glb', 'public/assets/world/keeper.glb'],
  gameplayDistance: GAMEPLAY_DISTANCE,
  inspectionDistance: INSPECTION_DISTANCE,
  bearings: BEARINGS.map(([n]) => n),
  waveSamples: WAVE_SAMPLES.map(([n]) => n),
  captured: captured.map((f) => f.split(/[\\/]/).pop()),
}, null, 2));

await page.send('Target.closeTarget', { targetId });
// Exits 0 regardless: this instrument photographs, it does not judge. See the header.
process.exit(0);
