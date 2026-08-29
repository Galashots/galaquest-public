/**
 * Studio Library/Inspect harness (#92 STUDIO-V2A). Behavioural invariants for the new registry-
 * driven Library mode: green means the typed API and the on-screen panels really produced the
 * claimed state -- it never means an asset looks good (that is a running-game/Owner call).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const TAG = process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : 'studio-library';
const OUT = fileURLToPath(new URL('../../.local/runtime-test/studio-library/', import.meta.url));
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
    if (r.exceptionDetails) {
      throw new Error(`eval threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
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
const exceptions = [];
page.ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
});
await page.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
// GQ-008: the automation Chrome profile is persistent, so a prior harness's guest identity would
// otherwise leak into this run -- irrelevant to Library's own checks, but required of every harness
// that navigates at all (test/harness-fresh-guest.test.mjs).
await page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'local_storage' });
await page.send('Page.navigate', { url: `${server.origin}/studio.html` });

let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) {
  await sleep(500);
  ready = await page.eval('Boolean(window.__galaQuestStudioReady)').catch(() => false);
}
check('Studio boots', ready);
if (!ready) {
  console.log('exceptions:', exceptions);
  await browser.send('Target.closeTarget', { targetId });
  await server.kill();
  process.exit(1);
}

async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}${TAG}-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured ${TAG}-${name}.png`);
}

// Same pixel-probe discipline the loaded-asset check below already uses: a state claim ("something
// is on stage") is only trusted once actual rendered pixels back it up. Returns the raw RGBA buffer
// (not just a "did anything render" count) -- the Studio floor/lighting alone already lights up
// every sampled pixel above a trivial brightness floor, so detecting "the hero silhouette is gone"
// requires comparing two full samples against each other, not thresholding one in isolation.
async function sampleCanvasPixels() {
  return page.eval(`(async () => {
    const canvas = document.querySelector('#studio-canvas');
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const off = document.createElement('canvas');
    off.width = 64; off.height = 64;
    const ctx = off.getContext('2d');
    ctx.drawImage(canvas, 0, 0, off.width, off.height);
    return Array.from(ctx.getImageData(0, 0, off.width, off.height).data);
  })()`);
}

// ── registry-driven, not a duplicated rack ─────────────────────────────────────────────────────
const meta = await page.eval('window.__galaQuestStudio.getRegistryMeta()');
check('registry meta comes from the live canonical file', meta.schema === 'galaquest.asset-registry/1', JSON.stringify(meta));
check('the registry has the full record count, not a curated subset', meta.recordCount >= 80, meta.recordCount);

const allAssets = await page.eval('window.__galaQuestStudio.listAssets({})');
check('listAssets returns every registry record with no filter', allAssets.length === meta.recordCount, `${allAssets.length} vs ${meta.recordCount}`);

const gearOnly = await page.eval("window.__galaQuestStudio.listAssets({ kind: 'gear' })");
check('kind filter narrows the set and matches exactly', gearOnly.length > 0 && gearOnly.every((a) => a.kind === 'gear'), gearOnly.length);

// ── stable identity ─────────────────────────────────────────────────────────────────────────────
let threw = false;
try {
  await page.eval('window.__galaQuestStudio.loadAsset("this-asset-id-does-not-exist")');
} catch { threw = true; }
check('loadAsset on an unknown asset_id throws rather than guessing', threw);

// ── truthful loadability: a real Git-backed asset actually renders ────────────────────────────
const heroLoad = await page.eval('window.__galaQuestStudio.loadAsset("hero.base")');
check('a real Git-backed registry asset reports loaded:true', heroLoad.loaded === true, JSON.stringify(heroLoad));
await sleep(300);
const afterHeroLoad = await page.eval('window.__galaQuestStudio.getState()');
check('getState reflects the Library asset now on stage', afterHeroLoad.libraryAsset === 'hero.base', afterHeroLoad.libraryAsset);
const heroInspect = await page.eval('window.__galaQuestStudio.getAssetInspection("hero.base")');
check('Inspect reports measured mesh facts once actually loaded', heroInspect.measuredStructuralMetrics && heroInspect.measuredStructuralMetrics.meshCount > 0, JSON.stringify(heroInspect.measuredStructuralMetrics));
check('Inspect still carries the declared registry facts untouched', heroInspect.custody === 'IN_GIT', heroInspect.custody);
await shot('hero-base-loaded');

// pixel probe: the generic stage really put geometry on screen, not just a state claim. Grabbed
// right after a fresh requestAnimationFrame -- scene.js's renderer is preserveDrawingBuffer:false,
// same discipline review-studio.mjs's own pixel probe already uses.
const pixelSample = await page.eval(`(async () => {
  const canvas = document.querySelector('#studio-canvas');
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const off = document.createElement('canvas');
  off.width = 64; off.height = 64;
  const ctx = off.getContext('2d');
  ctx.drawImage(canvas, 0, 0, off.width, off.height);
  const data = ctx.getImageData(0, 0, off.width, off.height).data;
  let nonBackground = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 5 || data[i+1] > 5 || data[i+2] > 5) nonBackground += 1;
  }
  return nonBackground;
})()`);
check('the canvas actually rendered non-empty pixels for the loaded asset', pixelSample > 100, pixelSample);

// ── truthful refusal: a record recorded on another branch is NOT faked as loaded ──────────────
const refused = await page.eval('window.__galaQuestStudio.loadAsset("boneguard-raider-v1")');
check('a not-staged registry asset reports loaded:false, not a silent placeholder', refused.loaded === false, JSON.stringify(refused));
check('the refusal names the real recorded custody, not a generic message',
  /origin\/feat\/enemy-asset-wave-1/.test(refused.reason ?? ''), refused.reason);
const refusedInspect = await page.eval('window.__galaQuestStudio.getAssetInspection("boneguard-raider-v1")');
check('Inspect on a refused asset still shows truthful custody facts', refusedInspect.custody === 'MULTIPLE', refusedInspect.custody);
check('Inspect on a refused asset carries no fabricated measured facts', refusedInspect.measuredStructuralMetrics === null, JSON.stringify(refusedInspect.measuredStructuralMetrics));

// ── review-B finding 3: a servable non-GLB record (a texture) is refused with the TRUE cause,
// never the generic "bytes unavailable" wording that falsely implies the bytes are missing ──────
const textureRefusal = await page.eval('window.__galaQuestStudio.loadAsset("hero.texture.tier3-atlas")');
check('a present-and-fetchable non-glTF record is refused, not thrown as a page exception',
  textureRefusal.loaded === false, JSON.stringify(textureRefusal));
check('the refusal states the TRUE cause (present, wrong format) rather than a false missing-bytes claim',
  /present and fetchable but is not a glTF\/GLB/.test(textureRefusal.reason ?? ''), textureRefusal.reason);
const textureBytes = await fetch(`${server.origin}/assets/hero/hero_tier3_atlas.jpg`);
check('sanity: the refused texture\'s bytes really do exist and serve 200 (the refusal is not about missing bytes)',
  textureBytes.status === 200, textureBytes.status);

// ── review-B finding 2: a load that fails AFTER the format gate (a real GLB request that comes
// back corrupt) must not leave the PREVIOUS Library asset's stale measured facts advertised as
// still on stage -- getState() must reflect the attempted asset with loaded:false ─────────────
await page.eval('window.__galaQuestStudio.loadAsset("hero.base")');
await sleep(200);
const beforeCorruptLoad = await page.eval('window.__galaQuestStudio.getState()');
check('sanity: hero.base is genuinely on stage before the corrupt-load probe',
  beforeCorruptLoad.libraryAsset === 'hero.base' && beforeCorruptLoad.libraryLoadResult?.loaded === true,
  JSON.stringify(beforeCorruptLoad.libraryLoadResult));
await page.eval(`(() => {
  window.__gqOriginalFetch = window.fetch;
  window.fetch = (...args) => {
    // GLTFLoader's FileLoader calls fetch(request) with a real Request object, not a string --
    // String(request) is the useless "[object Request]", so read .url explicitly.
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    if (url.includes('/assets/gear/lantern_belt.glb')) {
      return Promise.resolve(new Response('not real glb bytes', { status: 200 }));
    }
    return window.__gqOriginalFetch(...args);
  };
  return true;
})()`);
let corruptLoadThrew = false;
let corruptLoadMessage = '';
try {
  await page.eval('window.__galaQuestStudio.loadAsset("gear.lantern.belt")');
} catch (error) {
  corruptLoadThrew = true;
  corruptLoadMessage = error.message;
}
await page.eval('window.fetch = window.__gqOriginalFetch');
check('a load that fails to parse still throws to the caller (never silently substitutes a placeholder)',
  corruptLoadThrew, corruptLoadMessage);
const afterCorruptLoad = await page.eval('window.__galaQuestStudio.getState()');
check('getState after the failed load names the ATTEMPTED asset, not the stale previous one',
  afterCorruptLoad.libraryAsset === 'gear.lantern.belt', afterCorruptLoad.libraryAsset);
check('getState after the failed load truthfully reports loaded:false, not the previous measured facts',
  afterCorruptLoad.libraryLoadResult?.loaded === false, JSON.stringify(afterCorruptLoad.libraryLoadResult));

// ── review-B finding 4: a refused (never-staged) selection must not silently fall back to the
// fully-dressed shipping hero -- the stage must stay visibly empty ──────────────────────────────
await page.eval('window.__galaQuestStudio.clearLibraryAsset()');
await sleep(200);
const heroBaselinePixels = await sampleCanvasPixels();
const refusalForStageCheck = await page.eval('window.__galaQuestStudio.loadAsset("animation-source.hero.meshy.hdus9c")');
check('sanity: the Meshy animation-source record is truthfully refused', refusalForStageCheck.loaded === false, JSON.stringify(refusalForStageCheck));
await sleep(200);
const stateDuringRefusal = await page.eval('window.__galaQuestStudio.getState()');
check('getState still names the refused asset as "selected"', stateDuringRefusal.libraryAsset === 'animation-source.hero.meshy.hdus9c', stateDuringRefusal.libraryAsset);
const refusalPixels = await sampleCanvasPixels();
let changedPixels = 0;
for (let i = 0; i < heroBaselinePixels.length; i += 4) {
  const delta = Math.abs(heroBaselinePixels[i] - refusalPixels[i])
    + Math.abs(heroBaselinePixels[i + 1] - refusalPixels[i + 1])
    + Math.abs(heroBaselinePixels[i + 2] - refusalPixels[i + 2]);
  if (delta > 30) changedPixels += 1;
}
check('a refused selection visibly removes the hero silhouette rather than leaving the canvas looking identical',
  changedPixels > 200, `changedPixels=${changedPixels} of ${heroBaselinePixels.length / 4}`);
await shot('refused-asset-stage-empty');
// Restore Studio to the hero stage for the checks that follow.
await page.eval('window.__galaQuestStudio.clearLibraryAsset()');
await sleep(150);

// ── no provider-call / spend path from the Library surface ────────────────────────────────────
await page.eval(`(() => {
  window.__gqOutboundCalls = [];
  const originalFetch = window.fetch;
  window.fetch = (...args) => {
    const url = String(args[0]);
    if (!url.startsWith(window.location.origin) && !url.startsWith('/')) window.__gqOutboundCalls.push(url);
    if (/meshy|api\\.meshy/i.test(url)) window.__gqOutboundCalls.push(url);
    return originalFetch(...args);
  };
  return true;
})()`);
await page.eval('window.__galaQuestStudio.loadAsset("hero.base")');
await page.eval('window.__galaQuestStudio.loadAsset("animation-source.hero.meshy.hdus9c")');
await page.eval('window.__galaQuestStudio.listAssets({})');
const outboundCalls = await page.eval('window.__gqOutboundCalls');
check('no Meshy/provider or cross-origin network call is triggered by any Library action',
  Array.isArray(outboundCalls) && outboundCalls.length === 0, JSON.stringify(outboundCalls));

// ── genericity: a non-hero, non-gear registry asset also loads and frames on its own bounding box
const treeLoad = await page.eval('window.__galaQuestStudio.loadAsset("prop.village.tree")');
check('a village prop (a third, unrelated asset_kind) also loads generically', treeLoad.loaded === true, JSON.stringify(treeLoad));
await sleep(300);
await shot('prop-village-tree-loaded');

// ── clear back to hero character stage ─────────────────────────────────────────────────────────
await page.eval('window.__galaQuestStudio.clearLibraryAsset()');
await sleep(150);
const afterClear = await page.eval('window.__galaQuestStudio.getState()');
check('clearLibraryAsset returns Studio to the hero character stage', afterClear.libraryAsset === null, afterClear.libraryAsset);

// ── the manual UI panel drives the same typed API, not DOM-only state ─────────────────────────
await page.eval("document.querySelector('#library-open').click()");
await sleep(400);
const panelVisible = await page.eval("document.querySelector('#library-panel').hidden === false");
check('the Library panel opens from the UI button', panelVisible);
const listedCount = await page.eval("document.querySelectorAll('#library-results li').length");
check('the UI list is populated from the same registry-backed listAssets call', listedCount > 0, listedCount);
await shot('library-panel-open');

check('no uncaught page exceptions during the run', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

await browser.send('Target.closeTarget', { targetId });
await server.kill();

writeFileSync(`${OUT}${TAG}-results.json`, JSON.stringify({ results, failures }, null, 2));
console.log(`\n${results.length} checks, ${failures} failures. Captures + results in ${OUT}`);
process.exit(failures ? 1 : 0);
