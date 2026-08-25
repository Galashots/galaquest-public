/**
 * G1-C3 running-game evidence: the whole child-visible Helmet vertical through the REAL client, on
 * the real server round trip, in both orientations.
 *
 *   node tools/runtime-test/drive-helmet-vertical.mjs
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, the owner's signed-in browser.
 *
 * The flow is one continuous session so the acquisition is a genuine false->true, not a seeded
 * adoption: the guest boots owning NO helmet, the server is handed the gear-owned fact mid-session
 * (a live INSERT into the same store the server queries per tick -- ownedItemIdsFor runs a fresh
 * query, so the next snapshot carries it), the client diffs ownership and fires the acquisition card.
 * Then EQUIP NOW is tapped, the helmet mounts, the Hero screen is opened, and a reload proves the
 * ceremony does NOT replay while the equipped pixels come back silently.
 *
 * This is an INSTRUMENT, not a gate: its product is the captures a person accepts and a console-error
 * report, not a pass/fail verdict. It exits 2 only when it cannot produce the evidence at all.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openRewardStore } from '../../net/rewardStore.mjs';
import { HELMET_SILVERGUARD_ID } from '../../public/src/progression/items.js';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
const REWARD_STORE_PATH = fileURLToPath(new URL('../../data/rewards.db', import.meta.url));
mkdirSync(OUT, { recursive: true });
const RUN_LOG = `${OUT}helmet-vertical-run.log`;
try { writeFileSync(RUN_LOG, 'run start\n'); } catch { /* ignore */ }
const step = (m) => { console.log(m); try { appendFileSync(RUN_LOG, `${m}\n`); } catch { /* ignore */ } };

// A FRESH guest per run. The grant is a durable append-only fact, so a fixed id would own the Helmet
// from the previous run and adopt it silently on the next boot -- the ceremony would (correctly) never
// re-fire, and this instrument would read that as a failure. A per-run id guarantees the false->true
// transition every time, which is what makes the gate deterministic across re-runs and CI reruns.
const GUEST = `helmet-vertical-guest-${Date.now()}`;

const server = await startOwnedServer();
step(`server up: ${server.url}`);
const ORIGIN = server.origin;
const GAME_URL = server.url;

const PORTRAIT = { width: 900, height: 1000, deviceScaleFactor: 1, mobile: true };
const LANDSCAPE = { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0; this.pending = new Map(); this.listeners = [];
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  ready() { return new Promise((resolve, reject) => {
    this.ws.addEventListener('open', resolve, { once: true });
    this.ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
  }); }
  on(fn) { this.listeners.push(fn); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, 20000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`eval threw: ${d.exception?.description ?? d.text}`);
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
await page.send('Log.enable');

// Collect console errors/warnings for the G1-path no-error claim.
const consoleMessages = [];
page.on((msg) => {
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
    consoleMessages.push({ type: msg.params.type, text: (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ') });
  }
  if (msg.method === 'Log.entryAdded' && (msg.params.entry.level === 'error')) {
    consoleMessages.push({ type: 'log-error', text: msg.params.entry.text });
  }
});

async function setViewport(vp) {
  await page.send('Emulation.setDeviceMetricsOverride', vp);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
await setViewport(PORTRAIT);

async function shot(name, vp = PORTRAIT) {
  await setViewport(vp);
  await sleep(350);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}helmet-${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  step(`  captured ${file}`);
}

async function bootPinned() {
  await page.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'local_storage' });
  await page.send('Page.navigate', { url: GAME_URL });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) { await sleep(500); ready = await page.eval('Boolean(window.__galaQuestRuntime?.hero)'); }
  if (!ready) throw new Error('runtime never came up');
  // Pin the guest, the same clear/set/navigate two-step the other seeded harnesses use.
  await page.send('Page.navigate', { url: `${ORIGIN}/favicon.ico` });
  await sleep(300);
  await page.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'local_storage' });
  await page.eval(`localStorage.setItem('gq-guest-id', '${GUEST}')`);
  await page.send('Page.navigate', { url: GAME_URL });
  let reready = false;
  for (let i = 0; i < 60 && !reready; i += 1) { await sleep(500); reready = await page.eval('Boolean(window.__galaQuestRuntime?.hero)'); }
  if (!reready) throw new Error('runtime never came back after guest pin');
  await sleep(1200);
}

step('booting pinned guest (owns no helmet)...');
await bootPinned();

const ownsAtBoot = await page.eval(`(() => {
  const s = document.querySelector('#unlock-card-layer')?.dataset.shown;
  return { cardShown: s === 'true' };
})()`);
step(`at boot: acquisition card shown = ${ownsAtBoot.cardShown} (must be false -- nothing earned yet)`);

// Live grant: hand the server the gear-owned fact through the same store it queries per tick.
step('granting Helmet ownership mid-session (live INSERT into the served store)...');
{
  const store = openRewardStore(REWARD_STORE_PATH);
  store.apply({ guestId: GUEST, type: 'gear-owned', value: HELMET_SILVERGUARD_ID, eventId: `vertical:own:${GUEST}` });
  store.close();
}

// Wait for the client to diff ownership and raise the acquisition card.
let cardUp = false;
for (let i = 0; i < 30 && !cardUp; i += 1) {
  await sleep(500);
  cardUp = await page.eval(`document.querySelector('#unlock-card-layer')?.dataset.shown === 'true'`);
}
if (!cardUp) {
  step('ERROR: acquisition card never appeared after the live grant');
  await page.send('Target.closeTarget', { targetId });
  await server.kill();
  process.exit(2);
}
step('acquisition card is up -- capturing the ceremony');
const cardText = await page.eval(`(() => {
  const card = document.querySelector('#unlock-card');
  return {
    name: document.querySelector('#unlock-card-name')?.textContent,
    compare: document.querySelector('#unlock-card-compare')?.textContent,
    prompt: document.querySelector('#unlock-card-prompt')?.textContent,
    actions: card?.dataset.actions,
    equip: document.querySelector('#unlock-card-equip')?.textContent,
    later: document.querySelector('#unlock-card-later')?.textContent,
  };
})()`);
step(`card: ${JSON.stringify(cardText)}`);
await shot('ceremony-portrait', PORTRAIT);
await shot('ceremony-landscape', LANDSCAPE);

// Tap EQUIP NOW -- the child's beat. Mints the durable equip fact and mounts the helmet.
step('tapping EQUIP NOW...');
await setViewport(PORTRAIT);
await page.eval(`document.querySelector('#unlock-card-equip').click()`);
await sleep(500);
const cardGone = await page.eval(`document.querySelector('#unlock-card-layer')?.dataset.shown !== 'true'`);
step(`card dismissed after equip = ${cardGone}`);

// Wait for the helmet to mount on the local hero.
let mounted = false;
for (let i = 0; i < 20 && !mounted; i += 1) {
  await sleep(500);
  mounted = await page.eval(`(() => {
    const a = window.__galaQuestRuntime.hero.getObjectByName('InterimAdapter_helmet_silverguard_Head');
    if (!a || !a.visible) return false;
    let m = null; a.traverse(o => { if (!m && o.isMesh) m = o; });
    return Boolean(m);
  })()`);
}
step(`helmet mounted and visible after equip = ${mounted}`);
if (!mounted) {
  step('ERROR: the Helmet did not mount after EQUIP -- the equip->mount path is broken');
  await page.send('Target.closeTarget', { targetId });
  await server.kill();
  process.exit(2);
}
await sleep(500);
await shot('equipped-gameplay-portrait', PORTRAIT);
await shot('equipped-gameplay-landscape', LANDSCAPE);

// Open the Hero screen and capture the truthful Shield + Helmet slots.
step('opening the Hero screen...');
await setViewport(PORTRAIT);
await page.eval(`document.querySelector('#hero-button').click()`);
await sleep(700);
const screenTruth = await page.eval(`(() => {
  const slot = (id) => {
    const el = document.querySelector('.hero-slot[data-slot="' + id + '"]');
    return { locked: el?.dataset.locked, filled: el?.dataset.filled, name: el?.querySelector('.hero-slot-name')?.textContent };
  };
  return { helmet: slot('helmet'), shield: slot('shield'), power: document.querySelector('#hero-identity-power-value')?.textContent };
})()`);
step(`hero screen: ${JSON.stringify(screenTruth)}`);
await shot('heroscreen-portrait', PORTRAIT);
await shot('heroscreen-landscape', LANDSCAPE);
// Select the equipped Helmet to show its defensive stat card.
await setViewport(PORTRAIT);
await page.eval(`(() => { const b = [...document.querySelectorAll('.hero-item')].find(x => x.dataset.itemId === 'helmet_silverguard'); if (b) b.click(); })()`);
await sleep(400);
const helmetCard = await page.eval(`(() => ({
  name: document.querySelector('#hero-item-name')?.textContent,
  stat: document.querySelector('#hero-item-damage')?.textContent,
}))()`);
step(`helmet card: ${JSON.stringify(helmetCard)}`);
await shot('heroscreen-helmet-card-portrait', PORTRAIT);
await page.eval(`document.querySelector('#hero-screen-close')?.click()`);
await sleep(300);

// Reload: the equipped pixels must return silently, with no ceremony replay.
//
// TWO INDEPENDENT CLAIMS, and they need different shapes of proof.
//
// "The worn Helmet comes back" is an ASYNCHRONOUS arrival: the GLB is fetched lazily on the first
// frame the restored equipped state is known, so the honest question is "does it mount", not "has it
// mounted by an arbitrary instant". A fixed sleep answers the second question and calls it the first.
// It measured ~1.8s here against a 2.5s sleep -- ~0.7s of margin -- and a slower hosted runner spends
// that margin and reports a mount failure for a Helmet that does mount. So this is a BOUNDED
// condition wait: it polls for the real mounted, visible mesh and fails only if it never arrives
// inside a generous budget, which keeps the gate red for a genuine mount/reload defect.
//
// "The ceremony does not replay" is the opposite shape -- a claim that something NEVER happens -- so
// it is sampled on EVERY poll across the whole window rather than read once at the end. That is
// strictly stronger than the fixed-sleep version, which could have missed a card that appeared and
// went before the single read.
step('reloading -- equipped Helmet must return with NO ceremony replay...');
await page.send('Page.navigate', { url: GAME_URL });
let backUp = false;
for (let i = 0; i < 60 && !backUp; i += 1) { await sleep(500); backUp = await page.eval('Boolean(window.__galaQuestRuntime?.hero)'); }
if (!backUp) {
  step('ERROR: the runtime never came back up after the reload');
  await page.send('Target.closeTarget', { targetId });
  await server.kill();
  process.exit(2);
}

const RELOAD_MOUNT_BUDGET_MS = 30_000;
const heroBackAt = Date.now();
let reloadMounted = false;
let ceremonyReplayed = false;
let reloadPowerSeen = null;
let mountedAfterMs = null;
while (Date.now() - heroBackAt < RELOAD_MOUNT_BUDGET_MS) {
  const probe = await page.eval(`(() => {
    const a = window.__galaQuestRuntime?.hero?.getObjectByName('InterimAdapter_helmet_silverguard_Head');
    let mounted = false;
    if (a && a.visible) { let m = null; a.traverse(o => { if (!m && o.isMesh) m = o; }); mounted = Boolean(m); }
    return {
      mounted,
      cardShown: document.querySelector('#unlock-card-layer')?.dataset.shown === 'true',
      power: document.querySelector('#hero-power-value')?.textContent ?? null,
    };
  })()`);
  // Sampled every poll: a ceremony that flashed and dismissed still counts as a replay.
  if (probe.cardShown) ceremonyReplayed = true;
  if (reloadPowerSeen === null && probe.power) reloadPowerSeen = probe.power;
  if (probe.mounted) { reloadMounted = true; mountedAfterMs = Date.now() - heroBackAt; break; }
  await sleep(250);
}
const afterReload = {
  helmetMounted: reloadMounted,
  cardShown: ceremonyReplayed,
  mountedAfterMs,
  powerAfterReload: reloadPowerSeen,
};
step(`after reload: helmet mounted = ${reloadMounted}`
  + `${mountedAfterMs === null ? '' : ` (+${mountedAfterMs}ms after runtime.hero)`}`
  + `, ceremony replayed = ${ceremonyReplayed} (must be false), POWER = ${reloadPowerSeen}`);
await shot('reload-portrait', PORTRAIT);
await shot('reload-landscape', LANDSCAPE);
if (!reloadMounted || ceremonyReplayed) {
  step('ERROR: reload did not restore the equipped Helmet silently -- '
    + `mounted=${reloadMounted} (budget ${RELOAD_MOUNT_BUDGET_MS}ms), replayed=${ceremonyReplayed}`);
  await page.send('Target.closeTarget', { targetId });
  await server.kill();
  process.exit(2);
}

// Console report for the G1-path no-error claim.
const g1Errors = consoleMessages.filter((m) => m.type !== 'warning');
step(`console: ${consoleMessages.length} warning(s)/error(s); ${g1Errors.length} error-level`);
for (const m of consoleMessages) step(`  [${m.type}] ${m.text.slice(0, 200)}`);
writeFileSync(`${OUT}helmet-vertical-report.json`, JSON.stringify({
  ownsAtBoot, cardText, cardGone, mounted, screenTruth, helmetCard, afterReload, consoleMessages,
}, null, 2));

await page.send('Target.closeTarget', { targetId });
await server.kill();
step('DONE');
process.exit(0);
