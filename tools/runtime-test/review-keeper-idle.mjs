/**
 * Photograph the authored Keeper `idle_ambient` IN THE RUNNING GAME, at gameplay and inspection
 * scale, from every bearing, plus a frame sweep through one idle cycle.
 *
 *   node tools/runtime-test/review-keeper-idle.mjs [--candidate tmp/ap1/keeper-review.glb]
 *   node tools/runtime-test/review-keeper-idle.mjs --shipped        # the v1 clip, for before/after
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223.
 *
 * WHY THIS EXISTS. Every AP1 number about the Keeper is a claim about a SKELETON.
 * `pose_anatomy.mjs` cannot see coat tearing, a hand inside a sleeve, or a silhouette that reads as
 * a bollard at 60 px. AGENTS.md is explicit that a claim about how the game looks comes from the
 * running game, and iron rule 8 makes the artist's review pass mandatory for any NPC a child talks
 * to. This is the capture half of that pass. **It does not judge.** A person (or an agent standing
 * in for one) opens the captures afterwards and says what is wrong with them.
 *
 * THE CANDIDATE IS INJECTED OVER CDP, NOT COPIED INTO public/. `Fetch.requestPaused` intercepts the
 * request for `assets/world/keeper.glb` and fulfils it from a local file. The working tree is never
 * modified, so there is no window in which a crash, a timeout or a Ctrl-C could leave a candidate
 * asset sitting in `public/` pretending to be shipped. Phase C1 did this by copying the file in and
 * restoring it afterwards and had to assert byte-identity to prove it had cleaned up; this cannot
 * fail that way because it never writes.
 *
 * The zone loader selects the keeper's clips by EXACT name (`idle`, `wave`), so the candidate must
 * carry the authored clip as `idle`. `tmp/ap1/keeper-review.glb` is built for exactly that:
 *   node tools/foundry/merge_clips.mjs --into tmp/ap1/keeper-v2-body.glb \
 *     --out tmp/ap1/keeper-review-raw.glb --from "tmp/ap1/keeper-v2-idle-authored.glb=idle"
 *   python tools/budget/recompress_glb.py tmp/ap1/keeper-review-raw.glb tmp/ap1/keeper-review.glb \
 *     --size 1024 --quality 85
 * The candidate carries no `wave`, so the proximity flourish is absent by construction here. That is
 * a known gap in the candidate, not a defect this harness found.
 *
 * Exits 0 unconditionally: this is a measuring and photographing instrument, like the fit-* tools,
 * not a gate. Its evidence is the captures, and a green exit code would be a lie about whether
 * anybody has looked at them.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const args = process.argv.slice(2);
const USE_SHIPPED = args.includes('--shipped');
const CANDIDATE = args.includes('--candidate')
  ? args[args.indexOf('--candidate') + 1]
  : 'tmp/ap1/keeper-review.glb';
// AP2-A compares two idles side by side, so the label and the cycle length are both arguments now.
// They were constants when there was only ever one candidate; leaving them that way would have
// written both runs into the same filenames and sampled a 1.93s clip on a 5.47s clock -- eight
// "evenly spaced" frames that actually walk the loop nearly three times.
const LABEL = args.includes('--label')
  ? args[args.indexOf('--label') + 1]
  : (USE_SHIPPED ? 'shipped-v1' : 'authored-v2');
const CYCLE_SECONDS = args.includes('--cycle') ? Number(args[args.indexOf('--cycle') + 1]) : 5.4667;
if (!Number.isFinite(CYCLE_SECONDS) || CYCLE_SECONDS <= 0) {
  console.error(`--cycle must be a positive number of seconds, got ${args[args.indexOf('--cycle') + 1]}`);
  process.exit(2);
}

if (!USE_SHIPPED && !existsSync(CANDIDATE)) {
  console.error(`candidate not found: ${CANDIDATE}\n(it is gitignored -- see this file's header for the two commands that build it)`);
  process.exit(2);
}

const server = await startOwnedServer();
const ORIGIN_UNDER_TEST = server.origin;
const URL_UNDER_TEST = server.url;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/keeper-review/', import.meta.url));
mkdirSync(OUT, { recursive: true });

// 768x1024 is the iPad viewport every other harness photographs at, so these captures are
// comparable with the ones already in the repo rather than a new framing nobody can line up.
const VIEWPORT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
// follow.js's DEFAULT_DISTANCE is 16 -- the actual gameplay framing. 3.8 is what its own comment
// calls inspection distance: close enough to judge one character, which is the other half of iron
// rule 8's "gameplay AND inspection scale".
const GAMEPLAY_DISTANCE = 16;
const INSPECTION_DISTANCE = 3.0;

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
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 30000);
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
// Its OWN tab. The automation Chrome is shared infrastructure and another session may have one
// open; creating a target is additive, where reusing whatever is fronted would hijack it.
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
const page = new CDP(list.find((t) => t.id === targetId).webSocketDebuggerUrl);
await page.ready();
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Log.enable');

const consoleErrors = [];
page.on((msg) => {
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push(msg.params.entry.text);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.text);
  }
});

// GQ-008: the automation profile is persistent, so localStorage survives between runs and a stale
// gq-guest-id would bring somebody else's Lantern Marks (and therefore a LIT tree) into a capture
// that is supposed to show the village as a fresh child finds it. Cleared BEFORE the first navigate.
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });

let served = 0;
if (!USE_SHIPPED) {
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
}

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
if (!USE_SHIPPED) console.log(`keeper.glb intercepted ${served} time(s)`);

/**
 * Put the camera on the Keeper himself rather than on the hero.
 *
 * `follow` tracks the player, so a capture of the Keeper framed through the hero's camera is a
 * capture of the hero's back with an old man somewhere behind it. This drives the THREE camera
 * directly: the Keeper's own world position from the scene graph, orbited at a bearing and a
 * distance, looking at his chest height. Nothing about the game's own camera rig is changed, and
 * `follow.update()` would fight it -- so the frame loop's follow update is suspended for the
 * duration by parking the player far away is NOT done; instead each capture re-applies the camera
 * immediately before the screenshot, which is enough because nothing moves between the two.
 */
const CAMERA_SETUP = `(() => {
  const r = window.__galaQuestRuntime;
  let keeper = null;
  r.scene.traverse((o) => { if (!keeper && /keeper/i.test(o.name ?? '')) keeper = o; });
  if (!keeper) return null;
  const p = keeper.getWorldPosition(new r.camera.position.constructor());
  return { name: keeper.name, x: p.x, y: p.y, z: p.z };
})()`;

const keeperNode = await page.eval(CAMERA_SETUP);
console.log(`keeper node: ${keeperNode ? `${keeperNode.name} at [${keeperNode.x.toFixed(2)}, ${keeperNode.z.toFixed(2)}]` : 'NOT FOUND'}`);

/**
 * Take the camera away from the follow rig, ONCE, before any framing.
 *
 * This is not a nicety. The first run of this harness wrote its camera position and then screenshot,
 * and `main.js`'s frame loop calls `follow.update(player.position)` every frame, which rewrote the
 * camera before the capture landed. The result was eighteen PIXEL-IDENTICAL captures of the hero's
 * back at the default framing, from five different "bearings" -- and every one of them was produced
 * by a run that reported success. Only opening them showed it. `follow.update` is a plain property
 * on the object literal `createFollowCamera` returns, so replacing it with a no-op stops the rig
 * without touching camera state or the game's own gesture handling.
 */
/**
 * Hide the HUD for the duration.
 *
 * Not cosmetic. The first framed run put "Keeper Aldric is waving you over!" straight across his
 * shins in every front capture, and the ruling asks specifically for planted feet and foot sliding
 * -- so the banner was covering one of the exact things the review exists to judge. The health bar, the
 * objective chip, the stick, the ATTACK button and the debug pill all crop the frame the same way.
 * The GAME is unchanged; only this tab's overlay is hidden, and only after the zone has loaded.
 */
async function hideHud() {
  const hidden = await page.eval(`(() => {
    // Everything that is not the canvas. The canvas is the game; the rest is chrome over it.
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

/**
 * Stop the Keeper going see-through in inspection captures.
 *
 * Not a cosmetic tweak, and not the game misbehaving. zoneLoader's `occlusionOpacity` fades him when
 * he sits between the camera and the hero, so a child walking north never loses their own hero behind
 * a 1.65 m robed man. That feature is working exactly as designed -- but this harness orbits the
 * camera around the KEEPER while the hero stays at spawn, so every rear bearing puts him squarely on
 * that line and fades him. The AP2-A rear captures came back ~40% opaque with pine trees and a fence
 * showing through his coat: unusable for judging drape, shoulders or silhouette, which is the entire
 * point of a rear inspection shot.
 *
 * `transparent = false` rather than `opacity = 1`, because the frame loop keeps writing opacity and
 * would win. With transparent off the renderer ignores the value it writes, so nothing fights and
 * nothing has to be restored -- and only this tab's materials are touched, after the zone has loaded.
 */
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
  if (!detached) throw new Error('could not detach the follow camera -- every capture would be the same frame');
  console.log('follow camera detached (its update() is a no-op for the rest of this run)');
}

/** Frame the Keeper at a compass bearing (radians) and a distance, then hold the pose clock. */
async function frameKeeper(bearing, distance, height = 0.85) {
  await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    let k = null;
    r.scene.traverse((o) => { if (!k && /keeper/i.test(o.name ?? '')) k = o; });
    if (!k) return false;
    const p = k.getWorldPosition(new r.camera.position.constructor());
    const b = ${bearing}, d = ${distance};
    r.camera.position.set(p.x + Math.sin(b) * d, p.y + ${height} + d * 0.10, p.z + Math.cos(b) * d);
    r.camera.lookAt(p.x, p.y + ${height}, p.z);
    r.camera.updateMatrixWorld(true);
    return true;
  })()`);
}

async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}keeper-${LABEL}-${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  captured keeper-${LABEL}-${name}.png`);
  return file;
}

const TAU = Math.PI * 2;
// Bearings are compass-style around the Keeper: 0 looks at his front, half a turn at his back.
const BEARINGS = [
  ['front', 0],
  ['front-three-quarter', TAU * 0.125],
  ['side', TAU * 0.25],
  ['rear-three-quarter', TAU * 0.375],
  ['rear', TAU * 0.5],
];

await detachFollowCamera();
await hideHud();
await pinKeeperOpacity();

const captured = [];

/**
 * Guard against the exact failure the first run shipped: if two captures at different bearings come
 * back byte-identical, the camera is not moving and the whole contact sheet is worthless.
 */
const digests = new Map();
async function assertFramesDiffer(name, file) {
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  const twin = digests.get(digest);
  if (twin) console.log(`  !! ${name} is byte-identical to ${twin} -- the camera did not move`);
  digests.set(digest, name);
}

console.log('\n-- gameplay scale --');
for (const [name, bearing] of BEARINGS) {
  await frameKeeper(bearing, GAMEPLAY_DISTANCE);
  await sleep(180);
  captured.push(await shot(`gameplay-${name}`));
  await assertFramesDiffer(`gameplay-${name}`, captured[captured.length - 1]);
}

console.log('\n-- inspection scale --');
for (const [name, bearing] of BEARINGS) {
  await frameKeeper(bearing, INSPECTION_DISTANCE);
  await sleep(180);
  captured.push(await shot(`inspection-${name}`));
  await assertFramesDiffer(`inspection-${name}`, captured[captured.length - 1]);
}

// Eight evenly spaced frames through one idle cycle, from a fixed three-quarter view so the only
// thing changing between them is the pose. A character is judged animated, never at rest only.
console.log('\n-- 8 frames through one idle cycle (fixed front-3/4, inspection scale) --');
await frameKeeper(TAU * 0.125, INSPECTION_DISTANCE);
const cycleSeconds = CYCLE_SECONDS;
for (let i = 0; i < 8; i += 1) {
  const t = (cycleSeconds * i) / 8;
  // The keeper presenter owns its own mixer and publishes no handle on it, so the cycle is sampled
  // in WALL-CLOCK time rather than by setting mixer.time. Stated rather than hidden: these eight
  // frames are evenly spaced to within a frame or two of scheduling jitter, not exactly, and the
  // `t` in each filename is the intended offset rather than a measured one.
  await sleep((cycleSeconds / 8) * 1000);
  await frameKeeper(TAU * 0.125, INSPECTION_DISTANCE);
  captured.push(await shot(`cycle-${i}-t${t.toFixed(2)}`));
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 8)) console.log(`  ${e}`);

writeFileSync(`${OUT}manifest-${LABEL}.json`, JSON.stringify({
  label: LABEL,
  candidate: USE_SHIPPED ? 'public/assets/world/keeper.glb (shipped v1)' : CANDIDATE,
  interceptedRequests: served,
  viewport: VIEWPORT,
  gameplayDistance: GAMEPLAY_DISTANCE,
  inspectionDistance: INSPECTION_DISTANCE,
  cycleSeconds: CYCLE_SECONDS,
  zone,
  consoleErrors,
  captures: captured.map((f) => f.replace(OUT, '')),
}, null, 2));

console.log(`\n${captured.length} captures in ${OUT}`);
console.log('NOTHING IS JUDGED BY THIS SCRIPT. Open every capture and say what is wrong with it.');

await server.kill();
await browser.send('Target.closeTarget', { targetId }).catch(() => {});
process.exit(0);
