// E2 running-game acceptance instrument. It owns its server and Chrome tabs, clears storage once
// before the first navigation, and leaves the final judgement to the captured gameplay frames.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ENEMY_NAMEPLATE_MAX_DISTANCE } from '../../public/src/enemies/nameplate.js';
import { deadlineAfter } from './automation-timing.mjs';
import { gameUrlFor, startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const PORTRAIT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const LANDSCAPE = { width: 844, height: 390, deviceScaleFactor: 2, mobile: true };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('CDP websocket error')), { once: true });
    });
  }

  sendOnce(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 20_000);
    });
  }

  async send(method, params = {}) {
    try {
      return await this.sendOnce(method, params);
    } catch (error) {
      if (!/timed out/.test(error.message)) throw error;
      return this.sendOnce(method, params);
    }
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(`eval threw: ${result.exceptionDetails.text}`);
    return result.result.value;
  }

  fire(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
  }
}

async function openPage(browser) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const targets = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
  const target = targets.find((item) => item.id === targetId);
  const page = new CDP(target.webSocketDebuggerUrl);
  await page.ready();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Log.enable');
  return { page, targetId };
}

async function configure(tab, viewport) {
  await tab.page.send('Emulation.setDeviceMetricsOverride', viewport);
  await tab.page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}

async function waitForRuntime(tab) {
  const deadline = deadlineAfter(60_000);
  while (Date.now() < deadline) {
    const ready = await tab.page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)')
      .catch(() => false);
    if (ready) return;
    await sleep(250);
  }
  throw new Error('runtime did not become ready');
}

function collectDiagnostics(tab) {
  const messages = [];
  tab.page.ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Log.entryAdded') {
      const entry = message.params.entry;
      if (entry.level === 'error' || entry.level === 'warning') messages.push(`${entry.level}: ${entry.text}`);
    }
    if (message.method === 'Runtime.exceptionThrown') messages.push(`exception: ${message.params.exceptionDetails.text}`);
  });
  return messages;
}

const state = (tab) => tab.page.eval(`JSON.stringify((() => {
  const r = window.__galaQuestRuntime;
  const e = r.encounterState();
  const visible = [...document.querySelectorAll('.enemy-nameplate')]
    .filter((element) => !element.hidden)
    .map((element) => ({
      enemyId: element.dataset.enemyId,
      text: element.textContent.replace(/\\s+/g, ' ').trim(),
      danger: element.dataset.danger,
      aria: element.getAttribute('aria-label'),
      rect: (() => { const box = element.getBoundingClientRect(); return {
        left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width),
        height: Math.round(box.height),
      }; })(),
    }));
  return {
    status: r.netState().status,
    player: { x: +r.player.position.x.toFixed(2), z: +r.player.position.z.toFixed(2) },
    groundSpeed: r.player.groundSpeed,
    serverSelf: r.netState().serverSelf,
    heading: r.follow.heading,
    hero: { ...e.hero },
    enemies: e.enemies.map((enemy) => ({
      enemyId: enemy.enemyId, level: enemy.level, hp: enemy.hp, maxHp: enemy.maxHp,
      x: enemy.x, z: enemy.z, mode: enemy.mode, targetId: enemy.targetId,
    })),
    visibleNameplates: visible,
    viewport: { width: innerWidth, height: innerHeight },
  };
})())`).then(JSON.parse);

async function capture(tab, name) {
  const { data } = await tab.page.send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}e2-${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  captured ${file}`);
  return file;
}

async function holdToward(tab, target, extraMillis = 1_500) {
  const live = await state(tab);
  const dx = target.x - live.player.x;
  const dz = target.z - live.player.z;
  const distance = Math.hypot(dx, dz);
  const cos = Math.cos(live.heading);
  const sin = Math.sin(live.heading);
  const screenX = (-cos * dx + sin * dz) / Math.max(distance, 1);
  const screenY = (sin * dx + cos * dz) / Math.max(distance, 1);
  const originX = 72;
  const originY = Math.max(120, (await tab.page.eval('innerHeight')) - 90);
  const pointerId = 900 + Math.floor(Math.random() * 100);
  await tab.page.eval(`(() => {
    const surface = document.querySelector('#game');
    // Synthetic PointerEvents are not trusted pointer streams, so Chrome does not establish
    // capture for them. The production handler releases capture before clearing its input state;
    // make that browser-only API a no-op for this synthetic, otherwise the test pointer can remain
    // held after the final pointerup and drive into the world bound.
    surface.setPointerCapture = () => {};
    surface.releasePointerCapture = () => {};
    const event = (type, x, y) => surface.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: ${pointerId}, pointerType: 'touch',
      isPrimary: true, clientX: x, clientY: y,
    }));
    event('pointerdown', ${originX}, ${originY});
    event('pointermove', ${originX + screenX * 56}, ${originY - screenY * 56});
  })()`);
  try {
    await sleep(Math.max(400, Math.ceil((distance / 2.8) * 1000) + extraMillis));
  } finally {
  await tab.page.eval(`(() => {
    const surface = document.querySelector('#game');
    surface.setPointerCapture = () => {};
    surface.releasePointerCapture = () => {};
      surface.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: ${pointerId}, pointerType: 'touch', isPrimary: true,
        clientX: ${originX + screenX * 56}, clientY: ${originY - screenY * 56},
      }));
    })()`);
  }
  return state(tab);
}

async function waitUntil(tab, predicate, budgetMs = 25_000) {
  const deadline = deadlineAfter(budgetMs);
  let live = await state(tab);
  while (!predicate(live) && Date.now() < deadline) {
    await sleep(150);
    live = await state(tab);
  }
  return live;
}

const server = await startOwnedServer({ quiet: true });
const browserVersion = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
const browser = new CDP(browserVersion.webSocketDebuggerUrl);
await browser.ready();
const tabA = await openPage(browser);
const tabB = await openPage(browser);
const diagnosticsA = collectDiagnostics(tabA);
const diagnosticsB = collectDiagnostics(tabB);
const evidence = {
  sha: process.env.GALAQUEST_E2_SHA ?? 'unbound-worktree',
  origin: server.origin,
  maxNameplateDistance: ENEMY_NAMEPLATE_MAX_DISTANCE,
  captures: [],
  diagnostics: { primary: diagnosticsA, sibling: diagnosticsB },
  checkpoints: {},
};

try {
  console.log('  E2 browser: tabs configured');
  await configure(tabA, PORTRAIT);
  await configure(tabB, PORTRAIT);
  await tabA.page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'local_storage' });
  await tabA.page.send('Page.navigate', { url: gameUrlFor(server.origin, 'E2-Primary') });
  await waitForRuntime(tabA);
  await tabB.page.send('Page.navigate', { url: gameUrlFor(server.origin, 'E2-Sibling') });
  await waitForRuntime(tabB);
  const primaryOnline = await waitUntil(tabA, (live) => live.status === 'online');
  const siblingOnline = await waitUntil(tabB, (live) => live.status === 'online');
  if (primaryOnline.status !== 'online' || siblingOnline.status !== 'online') {
    throw new Error(`clients did not connect: primary=${primaryOnline.status}, sibling=${siblingOnline.status}`);
  }
  await tabA.page.send('Page.bringToFront');
  console.log('  E2 browser: both clients online');

  await holdToward(tabA, { x: 7, z: 20 }, 1_800);
  console.log('  E2 browser: primary reached nameplate sweep');
  const portrait = await waitUntil(tabA, (live) => live.visibleNameplates.length >= 4, 10_000);
  evidence.checkpoints.portrait = portrait;
  evidence.captures.push(await capture(tabA, 'c3-portrait-nameplates'));

  await configure(tabA, LANDSCAPE);
  await sleep(800);
  const landscape = await state(tabA);
  evidence.checkpoints.landscape = landscape;
  evidence.captures.push(await capture(tabA, 'c3-landscape-nameplates'));
  console.log('  E2 browser: portrait and landscape captured');

  await configure(tabA, PORTRAIT);
  await holdToward(tabA, { x: 7, z: 24.5 }, 0);
  await holdToward(tabA, { x: 0, z: 24.5 }, 0);
  const returning = await waitUntil(tabA, (live) => live.enemies.some((enemy) => enemy.mode === 'returning'), 3_000);
  evidence.checkpoints.leash = returning;
  evidence.captures.push(await capture(tabA, 'c3-leash-returning'));
  console.log('  E2 browser: leash checkpoint sampled');

  await holdToward(tabA, { x: 7, z: 30 }, 1_000);
  const down = await waitUntil(tabA, (live) => live.hero.downSeconds >= 0, 30_000);
  evidence.checkpoints.down = down;
  const recovered = await waitUntil(tabA, (live) => live.hero.protectionSeconds > 0, 20_000);
  evidence.checkpoints.recovered = recovered;
  evidence.captures.push(await capture(tabA, 'c3-safe-recovery'));
  await tabB.page.send('Page.bringToFront');
  await sleep(500);
  evidence.checkpoints.twoClientSibling = await state(tabB);
  evidence.captures.push(await capture(tabB, 'c3-two-client-sibling'));
  console.log('  E2 browser: recovery and sibling captured');

  writeFileSync(`${OUT}e2-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(`  wrote ${OUT}e2-evidence.json`);
} finally {
  await Promise.allSettled([
    browser.send('Target.closeTarget', { targetId: tabA.targetId }),
    browser.send('Target.closeTarget', { targetId: tabB.targetId }),
  ]);
  await server.kill();
}
