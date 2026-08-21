/**
 * Asset Forge browser proof. This is deliberately narrow: it proves the first owner workflow that
 * justified the Forge exists in the real Three.js page, not just in unit tests.
 *
 * This lives outside tools/runtime-test on purpose. The canonical full-playtest suite is gameplay +
 * Character Studio review; the Forge has its own workflow, its own spend-lock assertion, and should
 * not make every future gameplay matrix duplicate an internal production-tool review.
 *
 * Authority proved here:
 *   - real Forge page boots with the real Hero + Dawnwarden helmet candidate;
 *   - semantic hair/ear coverage is live;
 *   - the visible Y+ control moves the ACTUAL helmet anchor +5 mm in world Y and nowhere else;
 *   - Reset restores the exact original anchor world position;
 *   - CI has no Meshy credential/unlock token, so generation remains visibly locked and cannot spend;
 *   - screenshots are evidence for human visual judgment, never an automatic "looks good" verdict.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from '../runtime-test/owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/forge-review/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = await startOwnedServer({ quiet: true });
let failures = 0;

function check(name, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }

  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('CDP websocket error')), { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 20_000);
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }
}

async function screenshot(page, name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured ${name}.png`);
}

function near(a, b, epsilon = 1e-5) {
  return Math.abs(a - b) <= epsilon;
}

function sameVector(a, b, epsilon = 1e-5) {
  return a.length === b.length && a.every((value, index) => near(value, b[index], epsilon));
}

let browser;
let page;
let targetId;
try {
  const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((response) => response.json());
  browser = new CDP(version.webSocketDebuggerUrl);
  await browser.ready();

  const target = await browser.send('Target.createTarget', { url: 'about:blank' });
  targetId = target.targetId;
  const targets = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((response) => response.json());
  page = new CDP(targets.find((entry) => entry.id === targetId).webSocketDebuggerUrl);
  await page.ready();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'all' });
  await page.send('Page.navigate', { url: `${server.url}forge.html` });

  let ready = false;
  for (let i = 0; i < 80 && !ready; i += 1) {
    await sleep(250);
    ready = await page.eval(`document.querySelector('#runtime-badge')?.textContent === 'FORGE READY'`).catch(() => false);
  }
  check('Forge boots in the real browser', ready);
  if (!ready) throw new Error('Forge never reached FORGE READY');

  for (let i = 0; i < 40; i += 1) {
    const label = await page.eval(`document.querySelector('#meshy-badge')?.textContent ?? ''`);
    if (label !== 'MESHY …') break;
    await sleep(100);
  }

  const initial = await page.eval(`(() => {
    const scene = window.__galaQuestForgeScene;
    const anchor = scene?.hero.root.getObjectByName('InterimAdapter_helmet_dawnwarden_v1_Head');
    if (!scene || !anchor) return null;
    const p = new anchor.position.constructor();
    anchor.getWorldPosition(p);
    return {
      position: p.toArray(),
      hidden: scene.hiddenAnatomy,
      visible: anchor.visible,
      yInput: document.querySelector('#pos-y').value,
      fitName: document.querySelector('#fit-asset-name').textContent,
      meshyBadge: document.querySelector('#meshy-badge').textContent,
      generateDisabled: document.querySelector('#meshy-generate').disabled,
    };
  })()`);

  check('Dawnwarden helmet is the live initial candidate', initial?.visible === true && initial.fitName === 'Dawnwarden Helmet', JSON.stringify(initial));
  check('helmet semantic coverage is live hair + ears', JSON.stringify(initial?.hidden) === JSON.stringify(['hair', 'ears']), JSON.stringify(initial?.hidden));
  check('fit starts at zero delta', Number(initial?.yInput) === 0, `Y=${initial?.yInput}`);
  check('CI Forge cannot spend Meshy credits', initial?.meshyBadge === 'MESHY LOCKED' && initial.generateDisabled === true,
    `${initial?.meshyBadge}; generateDisabled=${initial?.generateDisabled}`);

  await screenshot(page, 'forge-baseline-dawnwarden');

  await page.eval(`document.querySelector('[data-nudge="y"][data-sign="1"]').click()`);
  await sleep(150);
  const nudged = await page.eval(`(() => {
    const anchor = window.__galaQuestForgeScene.hero.root.getObjectByName('InterimAdapter_helmet_dawnwarden_v1_Head');
    const p = new anchor.position.constructor();
    anchor.getWorldPosition(p);
    return { position: p.toArray(), yInput: document.querySelector('#pos-y').value };
  })()`);

  const delta = nudged.position.map((value, index) => value - initial.position[index]);
  check('visible Y+ button writes +0.005', near(Number(nudged.yInput), 0.005, 1e-9), `Y input=${nudged.yInput}`);
  check('visible Y+ button moves actual anchor +5 mm in WORLD Y',
    near(delta[0], 0, 1e-5) && near(delta[1], 0.005, 1e-5) && near(delta[2], 0, 1e-5),
    `world delta=${JSON.stringify(delta)}`);

  await screenshot(page, 'forge-dawnwarden-y-plus-5mm');

  await page.eval(`document.querySelector('#reset-fit').click()`);
  await sleep(100);
  const reset = await page.eval(`(() => {
    const anchor = window.__galaQuestForgeScene.hero.root.getObjectByName('InterimAdapter_helmet_dawnwarden_v1_Head');
    const p = new anchor.position.constructor();
    anchor.getWorldPosition(p);
    return { position: p.toArray(), yInput: document.querySelector('#pos-y').value };
  })()`);
  check('Reset restores exact candidate world position', sameVector(reset.position, initial.position),
    `before=${JSON.stringify(initial.position)} after=${JSON.stringify(reset.position)}`);
  check('Reset returns visible Y field to zero', Number(reset.yInput) === 0, `Y=${reset.yInput}`);

  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 768,
    height: 1024,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await page.eval(`window.dispatchEvent(new Event('resize'))`);
  await sleep(150);
  const mobile = await page.eval(`({
    assetToggle: getComputedStyle(document.querySelector('#mobile-assets')).display,
    fitToggle: getComputedStyle(document.querySelector('#mobile-fit')).display,
    canvasWidth: document.querySelector('#forge-canvas').getBoundingClientRect().width,
    canvasHeight: document.querySelector('#forge-canvas').getBoundingClientRect().height,
  })`);
  check('tablet Forge exposes drawer controls and keeps a real 3D viewport',
    mobile.assetToggle !== 'none' && mobile.fitToggle !== 'none' && mobile.canvasWidth > 600 && mobile.canvasHeight > 850,
    JSON.stringify(mobile));
  await screenshot(page, 'forge-tablet');
} finally {
  if (browser && targetId) await browser.send('Target.closeTarget', { targetId }).catch(() => {});
  const stopped = await server.kill();
  check('owned Forge server tears down cleanly', stopped);
}

console.log(`\n${failures === 0 ? 'FORGE REVIEW HARNESS GREEN' : `FORGE REVIEW HARNESS: ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
