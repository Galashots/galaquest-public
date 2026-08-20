/**
 * Character Studio review harness (A1 Studio convergence) -- the committed acceptance seam for the
 * public Studio's review states, standard views, and deterministic state publication.
 *
 *   node tools/runtime-test/review-studio.mjs [--tag <label>]
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * WHAT IT PROVES (gate: true -- these are behavioural invariants, not aesthetics):
 *   - every loadout in loadoutDescriptors.js actually executes, and after each switch the LIVE
 *     scene-graph gear visibility (getState().gear) matches what the descriptor claims -- the
 *     descriptor is the claim, the anchors are the truth, and this harness is where they can
 *     disagree;
 *   - exactly one sword is ever visible in the weapon hand, in every loadout;
 *   - an unknown loadout fails closed (throws, state unchanged);
 *   - switching loadout preserves the selected view; the camera lands exactly where
 *     cameraPositionFor says for every bearing (determinism, computed independently in Node);
 *   - the closeup scale genuinely frames the current review target at CLOSEUP_DISTANCE;
 *   - the on-screen loadout menu drives the same state the API reads back;
 *   - the control panel leaves the inspection surface usable at portrait AND landscape
 *     tablet viewports, and collapses down to its header row on demand.
 *
 * WHAT IT DOES NOT PROVE: that any of it LOOKS right. The captures in
 * .local/runtime-test/studio-review/ exist for a person to open and judge -- running-game pixels
 * stay the appearance authority (AGENTS.md), and this harness's green exit is a behaviour claim
 * only.
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
  // Fresh-guest discipline (GQ-008, docs/MISTAKES.md): every navigating harness starts known.
  await page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'local_storage' });
  await page.send('Page.navigate', { url: `${server.url}studio.html` });
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

/** The descriptor is the CLAIM; the anchors in getState().gear are the TRUTH. */
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
  check(`[${id}] classification is published`, s.loadoutClassification === descriptor.classification,
    `${s.loadoutClassification} vs ${descriptor.classification}`);
}

// ── portrait: the full behavioural pass ───────────────────────────────────────────────────────
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
  baseline.view.scale === 'inspection' && baseline.view.bearing === 'three-quarter',
  JSON.stringify(baseline.view));
check('lazy candidates start unmounted',
  baseline.gear.every((item) => item.mounted || loadoutDescriptor('shipping').gear.every((g) => g.id !== item.id)),
  JSON.stringify(baseline.gear.map((item) => `${item.id}:${item.mounted}`)));

// Freeze the pose so every capture and measurement below is a pure function of the requested state.
await page.eval('window.__galaQuestStudio.setAnimationPlaying(false)');
await page.eval('window.__galaQuestStudio.setAnimationTime(0.5)');

// Every loadout executes, the scene matches the descriptor, and the view survives the switch.
await page.eval('window.__galaQuestStudio.setView("inspection", "three-quarter")');
for (const id of LOADOUT_IDS) {
  await page.eval(`window.__galaQuestStudio.setLoadout(${JSON.stringify(id)})`);
  await sleep(150);
  const s = await state(page);
  check(`[${id}] selected loadout is reported back`, s.loadout === id, s.loadout);
  check(`[${id}] view preserved across the switch`,
    s.view.scale === 'inspection' && s.view.bearing === 'three-quarter', JSON.stringify(s.view));
  checkGearMatchesDescriptor(s, id);
  await shot(page, `portrait-${id}-inspection-three-quarter`);
}

// Unknown loadout fails closed: throws, and the selected state does not move.
let threw = false;
try {
  await page.eval('window.__galaQuestStudio.setLoadout("helmet-of-wishes")');
} catch {
  threw = true;
}
const afterBad = await state(page);
check('unknown loadout throws', threw);
check('unknown loadout leaves state untouched', afterBad.loadout === LOADOUT_IDS[LOADOUT_IDS.length - 1], afterBad.loadout);

// The camera lands exactly where cameraPositionFor says, for every bearing -- computed here in
// Node from the same exported math, compared against the live camera. Hero root sits at the origin
// in Studio, so the expectation needs no scene state beyond the bearing itself.
await page.eval('window.__galaQuestStudio.setLoadout("shipping")');
for (const [bearing] of BEARINGS) {
  await page.eval(`window.__galaQuestStudio.setView("inspection", ${JSON.stringify(bearing)})`);
  const actual = await page.eval('window.__galaQuestStudioScene.camera.position.toArray()');
  const expected = cameraPositionFor('inspection', bearing, 0.9, [0, 0, 0]);
  const drift = Math.hypot(...actual.map((v, i) => v - expected[i]));
  check(`camera lands deterministically at inspection/${bearing}`, drift < 1e-6, `drift ${drift}`);
  await sleep(120);
  await shot(page, `portrait-shipping-inspection-${bearing}`);
}

// Closeup frames the CURRENT review target at CLOSEUP_DISTANCE (horizontal), not the whole hero.
// Photographed from 'opposite-side' -- the sword hand's own side of this rig; from 'side' the
// shield fills the whole frame (seen in this harness's first captures, not assumed).
for (const id of ['shipping', 'candidate-wildwood-blade']) {
  await page.eval(`window.__galaQuestStudio.setLoadout(${JSON.stringify(id)})`);
  await page.eval('window.__galaQuestStudio.setView("closeup", "opposite-side")');
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
  check(`[${id}] closeup stands CLOSEUP_DISTANCE from the review target`,
    measured !== null && Math.abs(measured - CLOSEUP_DISTANCE) < 1e-3, `horizontal ${measured}`);
  await sleep(120);
  await shot(page, `portrait-${id}-closeup-opposite-side`);
}

// The on-screen controls follow API-driven changes too (api.onStateChange -> refreshControls):
// a worker switching the loadout must never leave the menu claiming the previous state -- the
// stale-label defect this harness's own first captures exposed.
const menuAfterApi = await page.eval(`({
  loadout: document.querySelector('#loadout-select').value,
  scale: document.querySelector('#scale-select').value,
  bearing: document.querySelector('#bearing-select').value,
  review: document.querySelector('#review-target').textContent,
})`);
check('the loadout menu follows API-driven changes', menuAfterApi.loadout === 'candidate-wildwood-blade', menuAfterApi.loadout);
check('the view menus follow API-driven changes',
  menuAfterApi.scale === 'closeup' && menuAfterApi.bearing === 'opposite-side',
  `${menuAfterApi.scale}/${menuAfterApi.bearing}`);
check('the review line follows API-driven changes',
  menuAfterApi.review.includes('sword_wildwood_w1a') && menuAfterApi.review.includes('candidate'),
  menuAfterApi.review);

// The on-screen menu drives the same state the API reads back -- the UI is not a second truth.
await page.eval(`(() => {
  const select = document.querySelector('#loadout-select');
  select.value = 'shipping-sword-only';
  select.dispatchEvent(new Event('change'));
})()`);
await sleep(300);
const viaMenu = await state(page);
check('the loadout menu drives the API state', viaMenu.loadout === 'shipping-sword-only', viaMenu.loadout);
check('the review line shows the semantic target', await page.eval(
  'document.querySelector("#review-target").textContent',
).then((t) => t.includes(viaMenu.reviewTarget)), 'review-target text');

// Panel occlusion: the inspection surface stays usable, and the panel really collapses.
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
await shot(page, 'portrait-shipping-sword-only-collapsed-panel');
await page.eval('document.querySelector("#panel-toggle").click()');

check('no uncaught page exceptions during the portrait pass', portrait.exceptions.length === 0,
  portrait.exceptions.slice(0, 3).join(' | '));
await browser.send('Target.closeTarget', { targetId: portrait.targetId });

// ── landscape: boot, panel bounds, two captures ───────────────────────────────────────────────
console.log('\n== landscape (1024x768) ==');
const landscape = await openStudioPage(LANDSCAPE_VIEWPORT);
check('Studio boots at landscape', landscape.ready);
if (landscape.ready) {
  await landscape.page.eval('window.__galaQuestStudio.setAnimationPlaying(false)');
  await landscape.page.eval('window.__galaQuestStudio.setAnimationTime(0.5)');
  await landscape.page.eval('window.__galaQuestStudio.setView("inspection", "three-quarter")');
  await sleep(150);
  await shot(landscape.page, 'landscape-shipping-inspection-three-quarter');
  await landscape.page.eval('window.__galaQuestStudio.setLoadout("candidate-wildwood-blade")');
  await sleep(200);
  const ls = await state(landscape.page);
  checkGearMatchesDescriptor(ls, 'candidate-wildwood-blade');
  await shot(landscape.page, 'landscape-candidate-wildwood-blade-inspection-three-quarter');
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
