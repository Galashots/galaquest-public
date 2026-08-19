/**
 * Why does Keeper v2 render as a golden waxy statue instead of a painted elderly man?
 *
 *   node tools/runtime-test/review-keeper-material.mjs [--candidate tmp/ap2/keeper-idle11.glb]
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223.
 *
 * WHY THIS EXISTS. Sol found the defect in AP1's own contact sheets, which had already gone out for
 * review: the Keeper reads as gold-toned and shiny, not as the warm skin / grey beard / brown robe
 * that is genuinely painted into his 2048 atlas. AP1 measured his skeleton to four decimal places and
 * never once asked what his SURFACE was doing.
 *
 * The suspected cause was the emissive defect this repo already knows about -- an albedo atlas bound
 * a second time as `emissiveTexture` with `emissiveFactor [1,1,1]`. `material_audit.mjs` confirms the
 * Keeper ships exactly that. But `normaliseCharacterMaterial` ALREADY neutralises it on this asset
 * (zoneLoader.js:750 calls it for the keeper, villagers.js:62 for the clones), so a fix aimed at the
 * emissive would have changed nothing and we would have shipped a "corrected" statue.
 *
 * The static audit points somewhere else entirely. Comparing the Keeper against the hero, which
 * renders acceptably today:
 *
 *   hero_lod1_ironwood_atlas.glb   metallicFactor ABSENT (-> 1.0)   roughnessFactor ABSENT (-> 1.0)
 *   keeper.glb (v1, ships today)   metallicFactor ABSENT (-> 1.0)   roughnessFactor ABSENT (-> 1.0)
 *   Keeper v2 (every new pack)     metallicFactor ABSENT (-> 1.0)   roughnessFactor 0.41 PRESENT
 *
 * `normaliseCharacterMaterial` corrects metalness only when `metalness === 1 && roughness === 1`,
 * which it uses as the signature of BOTH factors having been omitted rather than authored. That was a
 * sound reading of the evidence it had. Meshy's newer export writes a real roughness while still
 * omitting metallic, so the guard no longer matches, and the Keeper keeps **metalness 1.0** -- a
 * fully metallic surface, which has no diffuse response at all. Its painted atlas stops being albedo
 * and becomes a specular tint. A warm-brown metal at roughness 0.41 is, precisely, a golden waxy
 * statue.
 *
 * On top of that both Keeper generations carry `KHR_materials_specular` with
 * `specularColorFactor [2,2,2]` -- a 2x specular multiplier the glTF format does not clamp, which the
 * vendored GLTFLoader does parse (loaders/GLTFLoader.js:1245).
 *
 * THIS SCRIPT DOES NOT ASSUME ANY OF THAT. It reads the material values three.js actually ended up
 * with, then photographs the same character under four surface treatments from an identical camera
 * so the difference is visible rather than argued. Variant A is what ships today.
 *
 * Exits 0 unconditionally: a measuring and photographing instrument, not a gate.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const args = process.argv.slice(2);
const CANDIDATE = args.includes('--candidate') ? args[args.indexOf('--candidate') + 1] : null;
if (CANDIDATE && !existsSync(CANDIDATE)) {
  console.error(`candidate not found: ${CANDIDATE}`);
  process.exit(2);
}

const server = await startOwnedServer();
const ORIGIN_UNDER_TEST = server.origin;
const URL_UNDER_TEST = server.url;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/keeper-material/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
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
if (CANDIDATE) {
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
    } catch (error) { console.error(`  interception failed: ${error.message}`); }
  });
  console.log(`serving ${CANDIDATE} in place of the shipped keeper.glb`);
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

/**
 * What three.js ACTUALLY holds, after GLTFLoader and after the game's own load-path normalisation.
 *
 * Reported per named character so the Keeper can be compared against the hero and the wolf -- both of
 * which render acceptably today and are therefore the control group for any rule we invent.
 */
const PROBE = `(() => {
  const r = window.__galaQuestRuntime;
  const out = [];
  const seen = new Set();
  const roots = [];
  r.scene.traverse((o) => {
    const n = (o.name ?? '').toLowerCase();
    if (/keeper|villager|hero|wolf/.test(n) && o.parent === r.scene) roots.push([o.name, o]);
  });
  // Fall back to any named match if nothing sits directly under the scene root.
  if (!roots.length) r.scene.traverse((o) => {
    const n = (o.name ?? '').toLowerCase();
    if (/keeper|villager|hero|wolf/.test(n)) roots.push([o.name, o]);
  });
  for (const [label, root] of roots) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (!m || seen.has(m.uuid)) continue;
        seen.add(m.uuid);
        out.push({
          owner: label,
          type: m.type,
          name: m.name ?? '',
          color: m.color ? m.color.getHexString() : null,
          metalness: m.metalness ?? null,
          roughness: m.roughness ?? null,
          emissive: m.emissive ? m.emissive.getHexString() : null,
          emissiveIntensity: m.emissiveIntensity ?? null,
          hasMap: Boolean(m.map),
          hasEmissiveMap: Boolean(m.emissiveMap),
          emissiveMapIsAlbedo: Boolean(m.emissiveMap) && (m.emissiveMap === m.map
            || (Boolean(m.emissiveMap?.image) && m.emissiveMap.image === m.map?.image)),
          // The extension values a plain PBR read never shows. specularColor is stored unclamped, so
          // a specularColorFactor of [2,2,2] arrives here as literally 2, not as white.
          specularIntensity: m.specularIntensity ?? null,
          specularColor: m.specularColor ? [m.specularColor.r, m.specularColor.g, m.specularColor.b] : null,
          ior: m.ior ?? null,
        });
      }
    });
  }
  return out;
})()`;

const before = await page.eval(PROBE);
console.log('\n== three.js material values AFTER GLTFLoader and after the game\'s own normalisation ==');
for (const m of before) {
  console.log(`  ${m.owner.padEnd(22)} ${m.type}`);
  console.log(`    metalness ${m.metalness}   roughness ${m.roughness}   color #${m.color}`);
  console.log(`    emissive #${m.emissive} x${m.emissiveIntensity}   emissiveMap ${m.hasEmissiveMap}`
    + `${m.emissiveMapIsAlbedo ? ' (IS THE ALBEDO)' : ''}`);
  console.log(`    specularIntensity ${m.specularIntensity}   specularColor ${JSON.stringify(m.specularColor)}   ior ${m.ior}`);
}

async function hideHud() {
  await page.eval(`(() => {
    const canvas = document.querySelector('canvas');
    for (const el of document.body.querySelectorAll('*')) {
      if (el === canvas || el.contains(canvas) || el.closest('canvas')) continue;
      const s = getComputedStyle(el);
      if (s.position === 'fixed' || s.position === 'absolute') el.style.display = 'none';
    }
  })()`);
}

async function detachFollowCamera() {
  const ok = await page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    if (!r.follow || typeof r.follow.update !== 'function') return false;
    r.follow.update = () => {};
    return true;
  })()`);
  if (!ok) throw new Error('could not detach the follow camera -- every capture would be the same frame');
}

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

const digests = new Map();
async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex');
  const twin = digests.get(digest);
  if (twin) console.log(`  !! ${name} is byte-identical to ${twin}`);
  digests.set(digest, name);
  console.log(`  captured ${name}.png`);
  return file;
}

/**
 * Apply one surface treatment to every Keeper/villager material, and report what it changed.
 *
 * Each variant is CUMULATIVE over the shipped state, applied from a snapshot taken once, so the four
 * are genuinely independent rather than each building on the previous one's edits.
 */
const APPLY = (patch) => `(() => {
  const r = window.__galaQuestRuntime;
  window.__matSnapshot ??= (() => {
    const snap = [];
    r.scene.traverse((o) => {
      if (!o.isMesh) return;
      let p = o, isKeeper = false;
      while (p) { if (/keeper|villager/i.test(p.name ?? '')) { isKeeper = true; break; } p = p.parent; }
      if (!isKeeper) return;
      for (const m of [].concat(o.material)) {
        if (!m || snap.some((s) => s.m === m)) continue;
        snap.push({ m, metalness: m.metalness, roughness: m.roughness,
          specularColor: m.specularColor ? m.specularColor.clone() : null,
          specularIntensity: m.specularIntensity });
      }
    });
    return snap;
  })();
  let n = 0;
  for (const s of window.__matSnapshot) {
    const m = s.m;
    m.metalness = s.metalness; m.roughness = s.roughness;
    if (s.specularColor && m.specularColor) m.specularColor.copy(s.specularColor);
    if (s.specularIntensity != null) m.specularIntensity = s.specularIntensity;
    ${patch}
    m.needsUpdate = true;
    n += 1;
  }
  return n;
})()`;

const TAU = Math.PI * 2;
/**
 * Variant A is the VENDOR'S DECLARATION, restated explicitly, not "whatever the runtime happens to
 * be doing today".
 *
 * It was originally the latter -- an empty patch over a snapshot taken after the game's own
 * normalisation -- and that made the sheet quietly wrong the moment the normaliser was fixed: the
 * "before" tile started rendering the cure. The before/after pair has to stay meaningful across the
 * very change it exists to justify, so A pins the three values every file in both 2026-08-15 Meshy
 * packs actually declares: metallicFactor ABSENT (glTF defaults it to 1.0), roughnessFactor 0.41,
 * KHR_materials_specular specularColorFactor [2,2,2].
 */
const VARIANTS = [
  ['A-as-exported', 'm.metalness = 1; m.roughness = 0.4100847542285919; if (m.specularColor) m.specularColor.setRGB(2,2,2);'],
  ['B-metalness0', 'm.metalness = 0;'],
  ['C-metalness0-rough0.8', 'm.metalness = 0; m.roughness = 0.8;'],
  ['D-metalness0-rough0.8-specular1', 'm.metalness = 0; m.roughness = 0.8; if (m.specularColor) m.specularColor.setRGB(1,1,1);'],
];

await detachFollowCamera();
await hideHud();

const captured = [];
const variantProbes = {};
for (const [label, patch] of VARIANTS) {
  const n = await page.eval(APPLY(patch));
  console.log(`\n-- variant ${label} (${n} material(s) patched) --`);
  variantProbes[label] = await page.eval(PROBE);
  for (const [view, bearing, distance] of [
    ['gameplay-3q', TAU * 0.125, GAMEPLAY_DISTANCE],
    ['inspection-front', 0, INSPECTION_DISTANCE],
    ['inspection-3q', TAU * 0.125, INSPECTION_DISTANCE],
  ]) {
    await frameKeeper(bearing, distance);
    await sleep(200);
    captured.push(await shot(`${label}-${view}`));
  }
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 8)) console.log(`  ${e}`);

writeFileSync(`${OUT}manifest.json`, JSON.stringify({
  candidate: CANDIDATE ?? 'public/assets/world/keeper.glb (shipped)',
  interceptedRequests: served,
  viewport: VIEWPORT,
  zone,
  runtimeMaterialsAsShipped: before,
  variants: variantProbes,
  consoleErrors,
  captures: captured.map((f) => f.replace(OUT, '')),
}, null, 2));

console.log(`\n${captured.length} captures in ${OUT}`);
console.log('NOTHING IS JUDGED BY THIS SCRIPT. Open every capture and say which surface is right.');

await server.kill();
await browser.send('Target.closeTarget', { targetId }).catch(() => {});
process.exit(0);
