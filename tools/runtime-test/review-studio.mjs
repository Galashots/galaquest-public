/**
 * Character Studio review harness -- behavioural invariants plus deterministic screenshots for human
 * visual judgment. Green means the requested review state really rendered; it never means the asset
 * looks good.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from './owned-server.mjs';
import {
  ALL_STUDIO_GEAR, LOADOUT_IDS, loadoutDescriptor,
} from '../../public/src/studio/loadoutDescriptors.js';
import {
  BEARINGS, CLOSEUP_DISTANCE, PORTRAIT_VIEWPORT, LANDSCAPE_VIEWPORT, cameraPositionFor,
} from '../../public/src/review/cameraPresets.js';
import { WILDWOOD_BLADE_CANDIDATE_BONE_NAME } from '../../public/src/character/gear.js';

const CHROME_PORT = 9224;
const TAG = process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : 'studio';
const OUT = fileURLToPath(new URL('../../.local/runtime-test/studio-review/', import.meta.url));
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

async function openStudioPage(viewport) {
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
  await page.send('Emulation.setDeviceMetricsOverride', viewport);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'local_storage' });
  await page.send('Page.navigate', { url: `${server.origin}/studio.html` });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    await sleep(500);
    ready = await page.eval('Boolean(window.__galaQuestStudioReady)').catch(() => false);
  }
  return { page, targetId, ready, exceptions };
}

async function shot(page, name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}${TAG}-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured ${TAG}-${name}.png`);
}

const state = (page) => page.eval('window.__galaQuestStudio.getState()');
const gearById = (s) => new Map(s.gear.map((item) => [item.id, item]));

function checkGearMatchesDescriptor(s, id) {
  const descriptor = loadoutDescriptor(id);
  const live = gearById(s);
  const wanted = new Set(descriptor.gear.map((item) => item.id));
  for (const item of ALL_STUDIO_GEAR) {
    const entry = live.get(item.id);
    const shouldBeVisible = wanted.has(item.id);
    check(
      `[${id}] ${item.id} is ${shouldBeVisible ? 'visible' : 'hidden'}`,
      Boolean(entry) && entry.visible === shouldBeVisible,
      entry ? `mounted=${entry.mounted} visible=${entry.visible}` : 'missing from getState().gear',
    );
  }
  const visibleInWeaponHand = s.gear.filter(
    (item) => item.bone === WILDWOOD_BLADE_CANDIDATE_BONE_NAME && item.visible,
  );
  check(`[${id}] exactly one sword in the weapon hand`, visibleInWeaponHand.length === 1,
    visibleInWeaponHand.map((item) => item.id).join(', ') || 'EMPTY HAND');
  check(`[${id}] reviewTarget is published and mounted`, s.reviewTarget === descriptor.reviewTarget
    && Boolean(live.get(s.reviewTarget)?.visible), `reviewTarget=${s.reviewTarget}`);
  check(`[${id}] gear provenance is published`, s.loadoutGearProvenance === descriptor.gearProvenance,
    `${s.loadoutGearProvenance} vs ${descriptor.gearProvenance}`);
  check(`[${id}] loadoutIsShipping means baseline, not provenance`,
    s.loadoutIsShipping === (id === 'shipping'),
    `loadoutIsShipping=${s.loadoutIsShipping} provenance=${s.loadoutGearProvenance}`);
}

console.log('\n== portrait (768x1024) ==');
const portrait = await openStudioPage(PORTRAIT_VIEWPORT);
check('Studio boots at portrait', portrait.ready);
if (!portrait.ready) {
  console.log('exceptions:', portrait.exceptions);
  await browser.send('Target.closeTarget', { targetId: portrait.targetId });
  await server.kill();
  process.exit(1);
}
const { page } = portrait;

const baseline = await state(page);
check('baseline loadout is shipping', baseline.loadout === 'shipping');
check('baseline lighting is game/authoritative', baseline.lightingMode === 'game' && baseline.lightingAuthoritative === true);
check('baseline view is inspection/three-quarter',
  baseline.view.scale === 'inspection' && baseline.view.bearing === 'three-quarter', JSON.stringify(baseline.view));
check('lazy candidates start unmounted',
  baseline.gear.every((item) => item.mounted || loadoutDescriptor('shipping').gear.every((g) => g.id !== item.id)),
  JSON.stringify(baseline.gear.map((item) => `${item.id}:${item.mounted}`)));

await page.eval('window.__galaQuestStudio.setAnimationPlaying(false)');
await page.eval('window.__galaQuestStudio.setAnimationTime(0.5)');

await page.eval('window.__galaQuestStudio.setView("inspection", "three-quarter")');
for (const id of LOADOUT_IDS) {
  await page.eval(`window.__galaQuestStudio.setLoadout(${JSON.stringify(id)})`);
  await sleep(350);
  const s = await state(page);
  check(`[${id}] selected loadout is reported back`, s.loadout === id, s.loadout);
  check(`[${id}] view preserved across the switch`,
    s.view.scale === 'inspection' && s.view.bearing === 'three-quarter', JSON.stringify(s.view));
  checkGearMatchesDescriptor(s, id);
  await shot(page, `portrait-${id}-inspection-three-quarter`);
}

let threw = false;
try {
  await page.eval('window.__galaQuestStudio.setLoadout("helmet-of-wishes")');
} catch {
  threw = true;
}
const afterBad = await state(page);
check('unknown loadout throws', threw);
check('unknown loadout leaves state untouched', afterBad.loadout === LOADOUT_IDS[LOADOUT_IDS.length - 1], afterBad.loadout);

await page.eval('window.__galaQuestStudio.setLoadout("shipping")');
for (const [bearing] of BEARINGS) {
  await page.eval(`window.__galaQuestStudio.setView("inspection", ${JSON.stringify(bearing)})`);
  const actual = await page.eval('window.__galaQuestStudioScene.camera.position.toArray()');
  const expected = cameraPositionFor('inspection', bearing, 0.9, [0, 0, 0]);
  const drift = Math.hypot(...actual.map((v, i) => v - expected[i]));
  check(`camera lands deterministically at inspection/${bearing}`, drift < 1e-6, `drift ${drift}`);
  const forward = await page.eval(`(() => {
    const c = window.__galaQuestStudioScene.camera;
    const v = new (c.position.constructor)(0, 0, -1).applyQuaternion(c.quaternion);
    return v.toArray();
  })()`);
  const toSubject = [0 - expected[0], 0.9 - expected[1], 0 - expected[2]];
  const length = Math.hypot(...toSubject);
  const alignment = forward.reduce((sum, v, i) => sum + v * (toSubject[i] / length), 0);
  check(`camera actually looks at the subject at inspection/${bearing}`, alignment > 0.9999,
    `cos(angle) = ${alignment.toFixed(6)}`);
  await sleep(120);
  await shot(page, `portrait-shipping-inspection-${bearing}`);
}

// High-value fit views. Dawnwarden sword explicitly includes rear/back closeups so a reviewer can
// see whether the hilt is actually seated in the hand rather than merely near the wrist. Helmet
// closeups circle the head to expose body/hair/clothing overlap from every useful side.
const closeupPlans = Object.freeze({
  shipping: ['opposite-side'],
  'candidate-wildwood-blade': ['opposite-side', 'back'],
  'candidate-dawnwarden-sword': ['side', 'rear-three-quarter', 'back', 'opposite-side'],
  'candidate-dawnwarden-helmet': ['front', 'three-quarter', 'side', 'rear-three-quarter', 'back'],
});
for (const [id, bearings] of Object.entries(closeupPlans)) {
  await page.eval(`window.__galaQuestStudio.setLoadout(${JSON.stringify(id)})`);
  for (const bearing of bearings) {
    await page.eval(`window.__galaQuestStudio.setView("closeup", ${JSON.stringify(bearing)})`);
    const measured = await page.eval(`(() => {
      const scene = window.__galaQuestStudioScene;
      const target = ${JSON.stringify(loadoutDescriptor(id).reviewTarget)};
      const bone = ${JSON.stringify(loadoutDescriptor(id).gear.find((g) => g.id === loadoutDescriptor(id).reviewTarget).bone)};
      const anchor = scene.hero.root.getObjectByName('InterimAdapter_' + target + '_' + bone);
      if (!anchor) return null;
      const p = new (anchor.position.constructor)();
      anchor.getWorldPosition(p);
      const c = scene.camera.position;
      return Math.hypot(c.x - p.x, c.z - p.z);
    })()`);
    check(`[${id}] closeup/${bearing} stands CLOSEUP_DISTANCE from review target`,
      measured !== null && Math.abs(measured - CLOSEUP_DISTANCE) < 1e-3, `horizontal ${measured}`);
    await sleep(150);
    await shot(page, `portrait-${id}-closeup-${bearing}`);
  }
}

// Put a known candidate state back on screen before checking UI synchronization.
await page.eval('window.__galaQuestStudio.setLoadout("candidate-dawnwarden-sword")');
await page.eval('window.__galaQuestStudio.setView("closeup", "back")');
const menuAfterApi = await page.eval(`({
  loadout: document.querySelector('#loadout-select').value,
  scale: document.querySelector('#scale-select').value,
  bearing: document.querySelector('#bearing-select').value,
  review: document.querySelector('#review-target').textContent,
})`);
check('the loadout menu follows API-driven changes', menuAfterApi.loadout === 'candidate-dawnwarden-sword', menuAfterApi.loadout);
check('the view menus follow API-driven changes',
  menuAfterApi.scale === 'closeup' && menuAfterApi.bearing === 'back', `${menuAfterApi.scale}/${menuAfterApi.bearing}`);
check('the review line follows API-driven changes and flags the candidate',
  menuAfterApi.review.includes('sword_dawnwarden_v1') && /candidate/i.test(menuAfterApi.review)
  && /not shipped/i.test(menuAfterApi.review), menuAfterApi.review);

// Pixel probe: state claims are not enough; named candidates must visibly change rendered pixels.
await page.eval(`(() => {
  window.__gqPixels = {
    snaps: {},
    async grab(slot) {
      const canvas = document.querySelector('#studio-canvas');
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const off = document.createElement('canvas');
      off.width = 192; off.height = 256;
      const ctx = off.getContext('2d');
      ctx.drawImage(canvas, 0, 0, off.width, off.height);
      this.snaps[slot] = ctx.getImageData(0, 0, off.width, off.height).data;
      return this.snaps[slot].length;
    },
    diff(a, b) {
      const x = this.snaps[a]; const y = this.snaps[b];
      if (!x || !y || x.length !== y.length) return null;
      let differing = 0;
      for (let i = 0; i < x.length; i += 4) {
        if (Math.abs(x[i] - y[i]) > 8 || Math.abs(x[i + 1] - y[i + 1]) > 8 || Math.abs(x[i + 2] - y[i + 2]) > 8) differing += 1;
      }
      return differing / (x.length / 4);
    },
  };
  return true;
})()`);

async function pixelsOf(loadoutId, scale, bearing, slot) {
  await page.eval(`window.__galaQuestStudio.setLoadout(${JSON.stringify(loadoutId)})`);
  await page.eval(`window.__galaQuestStudio.setView(${JSON.stringify(scale)}, ${JSON.stringify(bearing)})`);
  await sleep(350);
  const length = await page.eval(`window.__gqPixels.grab(${JSON.stringify(slot)})`);
  if (!length) throw new Error(`pixel probe returned nothing for ${slot}`);
}
const pixelDiff = (a, b) => page.eval(`window.__gqPixels.diff(${JSON.stringify(a)}, ${JSON.stringify(b)})`);

await pixelsOf('shipping', 'inspection', 'opposite-side', 'control-1');
await pixelsOf('shipping', 'inspection', 'opposite-side', 'control-2');
const controlDiff = await pixelDiff('control-1', 'control-2');
check('the pixel probe reads the render: unchanged state renders identically',
  controlDiff !== null && controlDiff < 0.001, `${(controlDiff * 100).toFixed(3)}% of pixels differ`);

await pixelsOf('candidate-wildwood-blade', 'inspection', 'opposite-side', 'wildwood-side');
const wildwoodDiff = await pixelDiff('control-1', 'wildwood-side');
check('Wildwood blade visibly changes the sword-side render',
  wildwoodDiff !== null && wildwoodDiff > 0.004, `${(wildwoodDiff * 100).toFixed(3)}% differ`);

await pixelsOf('candidate-dawnwarden-sword', 'inspection', 'opposite-side', 'dawnwarden-sword-side');
const dawnwardenSwordDiff = await pixelDiff('control-1', 'dawnwarden-sword-side');
check('Dawnwarden sword visibly changes the sword-side render',
  dawnwardenSwordDiff !== null && dawnwardenSwordDiff > 0.004,
  `${(dawnwardenSwordDiff * 100).toFixed(3)}% differ`);
await shot(page, 'portrait-candidate-dawnwarden-sword-inspection-opposite-side');

await pixelsOf('shipping', 'inspection', 'front', 'shipping-front');
await pixelsOf('candidate-dawnwarden-helmet', 'inspection', 'front', 'dawnwarden-helmet-front');
const helmetDiff = await pixelDiff('shipping-front', 'dawnwarden-helmet-front');
check('Dawnwarden helmet visibly changes the front render',
  helmetDiff !== null && helmetDiff > 0.004, `${(helmetDiff * 100).toFixed(3)}% differ`);
await shot(page, 'portrait-candidate-dawnwarden-helmet-inspection-front');

await pixelsOf('shipping', 'inspection', 'three-quarter', 'shipping-3q');
await pixelsOf('shipping-sword-only', 'inspection', 'three-quarter', 'sword-only-3q');
const shieldHiddenDiff = await pixelDiff('shipping-3q', 'sword-only-3q');
check('hiding the shield visibly changes the default render',
  shieldHiddenDiff !== null && shieldHiddenDiff > 0.004,
  `${(shieldHiddenDiff * 100).toFixed(3)}% differ`);

await page.eval(`(() => {
  const select = document.querySelector('#loadout-select');
  select.value = 'candidate-dawnwarden-helmet';
  select.dispatchEvent(new Event('change'));
})()`);
await sleep(450);
const viaMenu = await state(page);
check('the loadout menu drives the API state', viaMenu.loadout === 'candidate-dawnwarden-helmet', viaMenu.loadout);
check('the review line shows the semantic target', await page.eval(
  'document.querySelector("#review-target").textContent',
).then((t) => t.includes(viaMenu.reviewTarget)), 'review-target text');

async function panelRect() {
  return page.eval(`(() => { const r = document.querySelector('#studio-panel').getBoundingClientRect();
    return { w: r.width, h: r.height }; })()`);
}
const open = await panelRect();
check('portrait panel leaves the inspection surface usable',
  open.w < PORTRAIT_VIEWPORT.width * 0.5 && open.h < PORTRAIT_VIEWPORT.height * 0.55,
  `panel ${Math.round(open.w)}x${Math.round(open.h)} in ${PORTRAIT_VIEWPORT.width}x${PORTRAIT_VIEWPORT.height}`);
await page.eval('document.querySelector("#panel-toggle").click()');
const collapsed = await panelRect();
check('the panel collapses to its header row', collapsed.h < open.h * 0.5 && collapsed.h < 100,
  `collapsed ${Math.round(collapsed.h)}px vs open ${Math.round(open.h)}px`);
await shot(page, 'portrait-dawnwarden-helmet-collapsed-panel');
await page.eval('document.querySelector("#panel-toggle").click()');

check('no uncaught page exceptions during the portrait pass', portrait.exceptions.length === 0,
  portrait.exceptions.slice(0, 3).join(' | '));
await browser.send('Target.closeTarget', { targetId: portrait.targetId });

console.log('\n== landscape (1024x768) ==');
const landscape = await openStudioPage(LANDSCAPE_VIEWPORT);
check('Studio boots at landscape', landscape.ready);
if (landscape.ready) {
  await landscape.page.eval('window.__galaQuestStudio.setAnimationPlaying(false)');
  await landscape.page.eval('window.__galaQuestStudio.setAnimationTime(0.5)');
  await landscape.page.eval('window.__galaQuestStudio.setView("inspection", "three-quarter")');
  await sleep(150);
  await shot(landscape.page, 'landscape-shipping-inspection-three-quarter');

  for (const id of ['candidate-dawnwarden-sword', 'candidate-dawnwarden-helmet']) {
    await landscape.page.eval(`window.__galaQuestStudio.setLoadout(${JSON.stringify(id)})`);
    await sleep(450);
    const ls = await state(landscape.page);
    checkGearMatchesDescriptor(ls, id);
    await shot(landscape.page, `landscape-${id}-inspection-three-quarter`);
  }

  const lr = await landscape.page.eval(`(() => { const r = document.querySelector('#studio-panel').getBoundingClientRect();
    return { w: r.width, h: r.height }; })()`);
  check('landscape panel leaves the inspection surface usable',
    lr.w < LANDSCAPE_VIEWPORT.width * 0.4 && lr.h < LANDSCAPE_VIEWPORT.height * 0.75,
    `panel ${Math.round(lr.w)}x${Math.round(lr.h)} in ${LANDSCAPE_VIEWPORT.width}x${LANDSCAPE_VIEWPORT.height}`);
  check('no uncaught page exceptions during the landscape pass', landscape.exceptions.length === 0,
    landscape.exceptions.slice(0, 3).join(' | '));
}
await browser.send('Target.closeTarget', { targetId: landscape.targetId });
await server.kill();

writeFileSync(`${OUT}${TAG}-results.json`, JSON.stringify({ results, failures }, null, 2));
console.log(`\n${results.length} checks, ${failures} failures. Captures + results in ${OUT}`);
process.exit(failures ? 1 : 0);
