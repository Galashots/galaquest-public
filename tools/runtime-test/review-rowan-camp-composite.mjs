/**
 * Whole-camp CURRENT-vs-CANDIDATE composite for the Rowan camp asset audit, closing the gap in
 * Sol's actual spec (2026-08-16) that the first pass (tmp/rowan-camp-audit/rowan-camp-audit.jpg,
 * a per-item 2x2 grid built from Blender fixed-camera renders) did not cover:
 *
 *   "then one whole-camp current vs candidate pair in both landscape and portrait framing"
 *
 * A Blender render of an isolated prop cannot answer that -- it has to be the actual camp, in the
 * actual running game (AGENTS.md: visual claims come from the running game, not a render alone).
 *
 *   node tools/runtime-test/review-rowan-camp-composite.mjs
 *
 * Port 9224, the isolated automation Chrome. Checked free (only the Sol ChatGPT tab open, no other
 * session's probe) before this ran.
 *
 * HOW THE CANDIDATES GET INTO THE SCENE. The three raw Meshy exports are centered at the origin and
 * normalized to a 1-unit longest dimension -- zoneLoader.js's loadProp() does not auto-scale or
 * auto-ground PROPS (only landmarks get that treatment), so tmp/rowan-camp-audit/ground_and_scale.mjs
 * pre-baked a ground offset and a real-world scale into each candidate's own root-node matrix
 * (cart matched to the current cart's own width; campfire/tangle are labelled ESTIMATES -- final
 * sizing is Task #22's job once Sol/the owner actually pick these). The mounted GLBs are read here and fed
 * to GLTFLoader.parse() as raw bytes over CDP -- no network route, no touching public/, working tree
 * untouched, same "intercept, don't edit the tree" discipline as every other candidate review this
 * phase has done.
 *
 * The current cart is hidden (not removed) while the candidate is composited in, and restored before
 * the harness exits, so it never touches persisted state.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../tmp/rowan-camp-audit/whole-camp/', import.meta.url));
const AUDIT_DIR = fileURLToPath(new URL('../../tmp/rowan-camp-audit/', import.meta.url));
const CANDIDATE_FILES = ['cart-candidate-mounted.glb', 'campfire-candidate-mounted.glb', 'tangle-candidate-mounted.glb'];

// CHECKED BEFORE ANYTHING IS STARTED, which the other three candidate reviews already do and this
// one did not. Two things were wrong with reading them where they used to be read:
//
// ONE, the message. These files are gitignored, so their absence is the ORDINARY state of a fresh
// clone and of CI. A bare ENOENT stack for `cart-candidate-mounted.glb` is indistinguishable from a
// harness that broke, and says nothing about where the file comes from -- review-keeper-idle and its
// two siblings all name the file and point at the header. This one now does too.
//
// TWO, and worse: the read happened AFTER startOwnedServer(), so a missing fixture threw with a
// server child already running and nothing left to kill it. play-fight.mjs asserts "the harness
// terminated its own server child, and nothing else" precisely because an orphan server holds a port
// the next harness in the matrix wants. Nothing starts now until the inputs are known to exist.
//
// It still exits 2, and 2 is still a red job: this workflow's own rule is that a measuring instrument
// says "no automated verdict" by exiting 0 with its evidence, so any non-zero exit is an execution
// failure and must stay visible. Making the failure legible is not the same as making it pass.
const missing = CANDIDATE_FILES.filter((name) => !existsSync(`${AUDIT_DIR}${name}`));
if (missing.length > 0) {
  console.error(`candidate not found: ${missing.map((name) => AUDIT_DIR + name).join(', ')}`
    + '\n(the Rowan camp candidates are gitignored -- see this file\'s header for where they come from)');
  process.exit(2);
}

const server = await startOwnedServer();
mkdirSync(OUT, { recursive: true });

const b64 = (name) => readFileSync(`${AUDIT_DIR}${name}`).toString('base64');
const CANDIDATES = {
  cart: b64('cart-candidate-mounted.glb'),
  campfire: b64('campfire-candidate-mounted.glb'),
  tangle: b64('tangle-candidate-mounted.glb'),
};

// Camp layout, from public/src/world/zones/village.js PROPS/WILDWOOD_BLADE/ROWAN -- read directly
// rather than re-derived at runtime, since this harness needs it BEFORE the scene exists to frame
// the establishing camera.
const CART_AT = [-2.9, 32.4];
const ROWAN_AT = [0.8, 31.6];
// Candidate staging spots -- NOT a placement decision (Task #22 owns that once Sol picks winners),
// just plausible clear-of-everything spots so this composite reads as "in the space" rather than
// floating in a void. Chosen >=1m clear of the cart, bench, fence, rock, blade and Rowan.
const CAMPFIRE_AT = [1.2, 33.6];
const TANGLE_AT = [-3.3, 33.6];
const CAMP_CENTER = [0.3, 32.6];

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

const LANDSCAPE = { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true };
const PORTRAIT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
const GAMEPLAY_DISTANCE = 16; // follow.js DEFAULT_DISTANCE, same convention review-shipping-assets.mjs uses

async function bootFresh(viewport) {
  await page.send('Emulation.setDeviceMetricsOverride', viewport);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'local_storage' });
  await page.send('Page.navigate', { url: server.url });
  let ready = false;
  for (let i = 0; i < 80 && !ready; i += 1) {
    await sleep(500);
    ready = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
  }
  if (!ready) throw new Error(`runtime never came up on ${server.url}`);
  await sleep(800);
  await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    if (r.follow && typeof r.follow.update === 'function') r.follow.update = () => {};
    if (r.net && typeof r.net.reconcile === 'function') r.net.reconcile = () => ({ drift: 0, snapped: false });
    return true;
  })()`);
  await page.eval(`(() => {
    const canvas = document.querySelector('canvas');
    for (const el of document.body.querySelectorAll('*')) {
      if (el === canvas || el.contains(canvas) || el.closest('canvas')) continue;
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'absolute') el.style.display = 'none';
    }
    return true;
  })()`);
  await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    r.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (!m || !m.transparent) continue;
        m.transparent = false;
        m.needsUpdate = true;
      }
    });
    // Park the hero far from the camp so he never enters this establishing frame.
    r.player.position.x = -60;
    r.player.position.z = -60;
    return true;
  })()`);
}

/** Loads a base64 GLB via GLTFLoader.parse (no network route) and adds it to the scene. */
async function injectCandidate(base64, atXZ, rotY, name) {
  const ok = await page.eval(`(async () => {
    const r = window.__galaQuestRuntime;
    const { GLTFLoader } = await import('/vendor/loaders/GLTFLoader.js');
    const { setLayer, WORLD } = await import('/src/render/layers.js');
    const bin = atob('${base64}');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(bytes.buffer, '', resolve, reject);
    });
    const root = setLayer(gltf.scene, WORLD);
    root.name = 'audit-candidate-${name}';
    root.position.set(${atXZ[0]}, 0, ${atXZ[1]});
    root.rotation.y = ${rotY};
    r.scene.add(root);
    return true;
  })()`);
  if (!ok) throw new Error(`failed to inject candidate ${name}`);
  console.log(`  injected candidate: ${name} at (${atXZ[0]}, ${atXZ[1]})`);
}

async function setCurrentCartVisible(visible) {
  await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    let found = 0;
    r.scene.traverse((o) => { if (o.name === 'prop-props/village/cart.glb') { o.visible = ${visible}; found += 1; } });
    return found;
  })()`);
}

async function removeInjectedCandidates() {
  await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    const doomed = [];
    r.scene.traverse((o) => { if (o.name && o.name.startsWith('audit-candidate-')) doomed.push(o); });
    doomed.forEach((o) => o.parent.remove(o));
    return doomed.length;
  })()`);
}

/** Aim the camera at a fixed world point from a compass bearing, distance and height. */
async function frameAt(point, bearing, distance, height) {
  await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    const px = ${point[0]}, pz = ${point[1]};
    const b = ${bearing}, d = ${distance}, h = ${height};
    r.camera.position.set(px + Math.sin(b) * d, h, pz + Math.cos(b) * d);
    r.camera.lookAt(px, h * 0.35, pz);
    r.camera.updateMatrixWorld(true);
    return true;
  })()`);
}

const captured = [];
async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  captured.push(file);
  console.log(`  captured ${name}.png`);
  return file;
}

const BEARING_INTO_CAMP = Math.PI; // camera south of the clearing (toward the road), looking north into it

for (const [orientKey, viewport] of [['landscape', LANDSCAPE], ['portrait', PORTRAIT]]) {
  console.log(`\n== ${orientKey} ==`);
  await bootFresh(viewport);

  console.log('-- CURRENT camp --');
  await frameAt(CAMP_CENTER, BEARING_INTO_CAMP, GAMEPLAY_DISTANCE, 3.2);
  await sleep(200);
  await shot(`camp-current-${orientKey}`);

  console.log('-- CANDIDATE camp (cart swapped, campfire + tangle staged) --');
  await setCurrentCartVisible(false);
  await injectCandidate(CANDIDATES.cart, CART_AT, 0.9, 'cart');
  await injectCandidate(CANDIDATES.campfire, CAMPFIRE_AT, 0.0, 'campfire');
  await injectCandidate(CANDIDATES.tangle, TANGLE_AT, 0.5, 'tangle');
  await sleep(200);
  await shot(`camp-candidate-${orientKey}`);

  // Close on the campfire specifically, at true gameplay distance, to answer Sol's flame-readability
  // question directly -- the whole-camp shot alone is too far to judge one small prop's texture read.
  await frameAt(CAMPFIRE_AT, 0, GAMEPLAY_DISTANCE, 2.2);
  await sleep(200);
  await shot(`campfire-gameplay-distance-${orientKey}`);
  await frameAt(CAMPFIRE_AT, 0, 6, 1.0);
  await sleep(200);
  await shot(`campfire-near-${orientKey}`);

  await removeInjectedCandidates();
  await setCurrentCartVisible(true);
}

console.log(`\n${captured.length} captures in ${OUT}`);
writeFileSync(`${OUT}manifest.json`, JSON.stringify({
  gameplayDistance: GAMEPLAY_DISTANCE,
  campCenter: CAMP_CENTER,
  candidateStaging: { cart: CART_AT, campfire: CAMPFIRE_AT, tangle: TANGLE_AT },
  note: 'campfire/tangle staging positions are illustrative only, not a placement decision -- Task #22 owns final placement',
  captured: captured.map((f) => f.split(/[\\/]/).pop()),
}, null, 2));

await page.send('Target.closeTarget', { targetId });
process.exit(0);
