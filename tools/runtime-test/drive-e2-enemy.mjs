// E2 running-game acceptance instrument. It owns its server and Chrome tabs, clears storage once
// before the first navigation, and leaves the final judgement to the captured gameplay frames.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ENEMY_NAMEPLATE_MAX_DISTANCE } from '../../public/src/enemies/nameplate.js';
import { ENEMY_POPULATION } from '../../public/src/world/zones/village.js';
import { deadlineAfter } from './automation-timing.mjs';
import { gameUrlFor, startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const PORTRAIT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const LANDSCAPE = { width: 844, height: 390, deviceScaleFactor: 2, mobile: true };
const recoveryWolf = ENEMY_POPULATION.find((enemy) => enemy.enemyId === 'wolf-5');
if (!recoveryWolf) throw new Error('E2 recovery evidence requires authored wolf-5');
const leashWolf = ENEMY_POPULATION.find((enemy) => enemy.enemyId === 'wolf-3');
if (!leashWolf) throw new Error('E2 leash evidence requires authored wolf-3');
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

  close() {
    this.ws.close();
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
  tab.viewport = viewport;
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
  if (e.hero.downSeconds >= 0) {
    window.__e2DownObserved = true;
    window.__e2DownSeconds = e.hero.downSeconds;
  }
  if (e.hero.protectionSeconds > 0) {
    (window.__e2ProtectionSamples ??= []).push(e.hero.protectionSeconds);
  }
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
    downObserved: Boolean(window.__e2DownObserved),
    observedDownSeconds: window.__e2DownSeconds ?? -1,
    protectionObserved: Boolean(window.__e2ProtectionSamples?.length),
    maxProtectionObserved: Math.max(0, ...(window.__e2ProtectionSamples ?? [])),
    enemies: e.enemies.map((enemy) => ({
      enemyId: enemy.enemyId, level: enemy.level, hp: enemy.hp, maxHp: enemy.maxHp,
      x: enemy.x, z: enemy.z, mode: enemy.mode, targetId: enemy.targetId,
    })),
    visibleNameplates: visible,
    viewport: { width: innerWidth, height: innerHeight },
  };
})())`).then(JSON.parse);

async function startProtectionSampler(tab) {
  await tab.page.eval(`(() => {
    window.__e2DownObserved = false;
    window.__e2DownSeconds = -1;
    window.__e2ProtectionSamples = [];
    window.__e2ProtectionObserver = (async () => {
      const deadline = performance.now() + 60_000;
      while (performance.now() < deadline) {
        const seconds = window.__galaQuestRuntime.encounterState().hero.protectionSeconds;
        if (seconds > 0) {
          window.__e2ProtectionSamples.push(seconds);
          return true;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 16));
      }
      return false;
    })();
    window.__e2ProtectionTimer = window.setInterval(() => {
      const seconds = window.__galaQuestRuntime.encounterState().hero.protectionSeconds;
      if (seconds > 0) window.__e2ProtectionSamples.push(seconds);
    }, 25);
  })()`);
}

async function stopProtectionSampler(tab) {
  await tab.page.eval('window.clearInterval(window.__e2ProtectionTimer)');
}

async function capture(tab, name) {
  const { data } = await tab.page.send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}e2-${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  captured ${file}`);
  return file;
}

async function dragCamera(tab, dx) {
  const y = tab.viewport.height * 0.35;
  const x0 = tab.viewport.width * 0.5;
  const touch = (type, points) => tab.page.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await touch('touchStart', [{ x: x0, y, id: 1 }]);
  for (let step = 1; step <= 12; step += 1) {
    await touch('touchMove', [{ x: x0 + (dx * step) / 12, y, id: 1 }]);
  }
  await touch('touchEnd', []);
  await sleep(100);
}

async function orbitTo(tab, targetHeading) {
  const before = (await state(tab)).heading;
  await dragCamera(tab, 120);
  const after = (await state(tab)).heading;
  const gain = (after - before) / 120;
  if (Math.abs(gain) < 1e-6) return after;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = (await state(tab)).heading;
    const delta = targetHeading - current;
    if (Math.abs(delta) < 0.03) return current;
    await dragCamera(tab, Math.max(-380, Math.min(380, delta / gain)));
  }
  return (await state(tab)).heading;
}

async function findNameplateView(tab) {
  let best = await state(tab);
  for (let target = -Math.PI; target <= Math.PI; target += 0.35) {
    await orbitTo(tab, target);
    await sleep(120);
    const live = await state(tab);
    if (live.visibleNameplates.length > best.visibleNameplates.length) best = live;
    if (live.visibleNameplates.length >= 2) return live;
  }
  return best;
}

async function holdToward(tab, target, extraMillis = 1_500, observe = null) {
  await tab.page.send('Page.bringToFront');
  let live = await state(tab);
  const deadline = deadlineAfter(30_000 + extraMillis);
  while (Date.now() < deadline) {
    if (observe?.(live)) return live;
    const dx = target.x - live.player.x;
    const dz = target.z - live.player.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 1.2) break;
    const cos = Math.cos(live.heading);
    const sin = Math.sin(live.heading);
    const screenX = (-cos * dx + sin * dz) / Math.max(distance, 1);
    const screenY = (sin * dx + cos * dz) / Math.max(distance, 1);
    const keys = [];
    if (screenX > 0.2) keys.push('KeyD'); else if (screenX < -0.2) keys.push('KeyA');
    if (screenY > 0.2) keys.push('KeyW'); else if (screenY < -0.2) keys.push('KeyS');
    for (const code of keys) await tab.page.send('Input.dispatchKeyEvent', { type: 'keyDown', code });
    try {
      await sleep(250);
    } finally {
      for (const code of keys.reverse()) await tab.page.send('Input.dispatchKeyEvent', { type: 'keyUp', code });
    }
    live = await state(tab);
    if (observe?.(live)) return live;
  }
  return live;
}

async function waitUntil(tab, predicate, { budgetMs = 25_000, intervalMs = 150, label = 'checkpoint' } = {}) {
  const deadline = deadlineAfter(budgetMs);
  let live = await state(tab);
  while (!predicate(live) && Date.now() < deadline) {
    await sleep(intervalMs);
    live = await state(tab);
  }
  if (!predicate(live)) {
    throw new Error(`${label} was not reached within ${budgetMs}ms; last state: ${JSON.stringify(live)}`);
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
const checkedOutSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
let candidateSha = checkedOutSha;
try {
  // Pull-request workflows check out a synthetic merge; its second parent is the exact PR head.
  candidateSha = execFileSync('git', ['rev-parse', 'HEAD^2'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  // A local branch checkout has no second parent, so its HEAD is already the candidate.
}
const evidence = {
  sha: process.env.GALAQUEST_E2_SHA
    ?? candidateSha,
  checkoutSha: checkedOutSha,
  origin: server.origin,
  maxNameplateDistance: ENEMY_NAMEPLATE_MAX_DISTANCE,
  captures: [],
  diagnostics: { primary: diagnosticsA, sibling: diagnosticsB },
  checkpoints: {},
};
if (!/^[0-9a-f]{40}$/.test(evidence.sha)) {
  throw new Error(`E2 evidence requires a full candidate SHA, got ${JSON.stringify(evidence.sha)}`);
}

let failure = null;
try {
  console.log('  E2 browser: tabs configured');
  await configure(tabA, PORTRAIT);
  await configure(tabB, PORTRAIT);
  await tabA.page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'local_storage' });
  await tabA.page.send('Page.navigate', { url: gameUrlFor(server.origin, 'E2-Primary') });
  await waitForRuntime(tabA);
  await tabB.page.send('Page.navigate', { url: gameUrlFor(server.origin, 'E2-Sibling') });
  await waitForRuntime(tabB);
  const primaryOnline = await waitUntil(tabA, (live) => live.status === 'online', {
    label: 'primary online',
  });
  const siblingOnline = await waitUntil(tabB, (live) => live.status === 'online', {
    label: 'sibling online',
  });
  await tabA.page.send('Page.bringToFront');
  console.log('  E2 browser: both clients online');

  await tabA.page.send('Page.bringToFront');
  console.log('  E2 browser: primary reached nameplate sweep');
  const portrait = await findNameplateView(tabA);
  if (portrait.visibleNameplates.length < 2) {
    throw new Error(`portrait multi-nameplate checkpoint was not reached; last state: ${JSON.stringify(portrait)}`);
  }
  evidence.checkpoints.portrait = portrait;
  evidence.captures.push(await capture(tabA, 'c3-portrait-nameplates'));

  await configure(tabA, LANDSCAPE);
  await sleep(800);
  const landscape = await waitUntil(tabA, (live) => live.visibleNameplates.length >= 2, {
    budgetMs: 10_000, label: 'landscape multi-nameplate checkpoint',
  });
  evidence.checkpoints.landscape = landscape;
  evidence.captures.push(await capture(tabA, 'c3-landscape-nameplates'));
  console.log('  E2 browser: portrait and landscape captured');

  await configure(tabA, PORTRAIT);
  await holdToward(tabA, { x: leashWolf.home.x, z: leashWolf.home.z + 2 }, 0);
  const movedAway = await holdToward(
    tabA,
    { x: 0, z: 24.5 },
    0,
    (live) => live.enemies.some((enemy) => enemy.mode === 'returning'),
  );
  const returning = movedAway.enemies.some((enemy) => enemy.mode === 'returning')
    ? movedAway
    : await waitUntil(tabA, (live) => live.enemies.some((enemy) => enemy.mode === 'returning'), {
      budgetMs: 3_000, label: 'leash returning checkpoint',
    });
  if (!returning.enemies.some((enemy) => enemy.mode === 'returning')) {
    throw new Error(`leash returning checkpoint was not reached; last state: ${JSON.stringify(returning)}`);
  }
  evidence.checkpoints.leash = returning;
  evidence.captures.push(await capture(tabA, 'c3-leash-returning'));
  console.log('  E2 browser: leash checkpoint sampled');
  await waitUntil(tabA, (live) => {
    const wolf = live.enemies.find((enemy) => enemy.enemyId === leashWolf.enemyId);
    return wolf?.mode === 'idle';
  }, { budgetMs: 10_000, label: 'leash settled before recovery' });
  await holdToward(tabA, { x: 0, z: 0 }, 1_000);
  await waitUntil(tabA, (live) => {
    const wolf = live.enemies.find((enemy) => enemy.enemyId === 'wolf-1');
    return wolf?.mode === 'idle';
  }, { budgetMs: 10_000, label: 'opening Wolf settled before recovery' });

  await startProtectionSampler(tabA);
  await holdToward(tabA, { x: 0, z: 25 }, 0);
  await holdToward(tabA, { x: recoveryWolf.home.x, z: recoveryWolf.home.z }, 15_000);
  const down = await waitUntil(tabA, (live) => live.hero.downSeconds >= 0 || live.downObserved, {
    budgetMs: 30_000, label: 'hero down checkpoint',
  });
  evidence.checkpoints.down = down;
  const recovered = await waitUntil(tabA, (live) => live.hero.protectionSeconds > 0 || live.protectionObserved, {
    budgetMs: 20_000, intervalMs: 50, label: 'safe recovery protection checkpoint',
  });
  await stopProtectionSampler(tabA);
  if (recovered.maxProtectionObserved <= 0 && recovered.hero.protectionSeconds <= 0) {
    throw new Error(`safe recovery protection checkpoint was not observed; last state: ${JSON.stringify(recovered)}`);
  }
  evidence.checkpoints.recovered = recovered;
  evidence.captures.push(await capture(tabA, 'c3-safe-recovery'));
  await tabB.page.send('Page.bringToFront');
  await sleep(500);
  evidence.checkpoints.twoClientSibling = await state(tabB);
  evidence.captures.push(await capture(tabB, 'c3-two-client-sibling'));
  console.log('  E2 browser: recovery and sibling captured');

} catch (error) {
  failure = { message: error instanceof Error ? error.message : String(error) };
  throw error;
} finally {
  evidence.failure = failure;
  evidence.outcome = failure ? 'FAIL' : 'PASS';
  await Promise.allSettled([
    browser.send('Target.closeTarget', { targetId: tabA.targetId }),
    browser.send('Target.closeTarget', { targetId: tabB.targetId }),
  ]);
  tabA.page.close();
  tabB.page.close();
  browser.close();
  evidence.teardown = { serverKilled: await server.kill() };
  if (!evidence.teardown.serverKilled && !failure) {
    evidence.failure = { message: 'owned server teardown could not be confirmed' };
    evidence.outcome = 'FAIL';
    process.exitCode = 1;
  }
  writeFileSync(`${OUT}e2-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(`  wrote ${OUT}e2-evidence.json (${evidence.outcome}, ${evidence.sha})`);
}
