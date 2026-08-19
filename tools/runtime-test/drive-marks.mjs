/**
 * Play the wolf fight for real, once, with synthetic touch, and prove the reward loop end to end:
 * a kill earns a Lantern Mark, the pip fills, the mark-earned event is actually heard (not merely
 * inferred from the pip), and all three survive a full page reload -- the "marks survive a
 * refresh" acceptance in the running game, not a unit test.
 *
 *   node tools/runtime-test/drive-marks.mjs
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * Cribs play-fight.mjs's own conventions: a bare node process importing the pure rules modules
 * directly (no DOM, no three.js shim), the one-client refusal, self-verifying captures (each
 * records the state it was taken in), and real touch events rather than a debug hook that could
 * fake the kill. What is new here: this harness clears localStorage for the game's origin BEFORE
 * the first navigation, because the automation Chrome profile is PERSISTENT (README.md's launch
 * command) and shared across every tools/runtime-test/ harness run -- without a clean slate, a
 * guest arriving here with marks already on the books from an earlier run would make "one pip
 * filled after one kill" either trivially true or outright false, neither of which proves anything.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SWING_CONTACT_SECONDS, WOLF_MAX_HP, canAttack } from '../../public/src/combat/encounter.js';
import { MARKS_TO_UNLOCK } from '../../public/src/rewards/marks.js';
import {
  deadlineAfter,
  movementPulseMillis,
  pollUntilDeadline,
} from './automation-timing.mjs';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
// Spawns and owns its own server on an isolated port rather than using the shared 5201 (Phase H1).
// It matters especially here: this harness's whole claim is "one pip filled after one kill", and a
// shared server hands it a wolf whose state some other run already decided. See owned-server.mjs.
const server = await startOwnedServer();
const ORIGIN_UNDER_TEST = server.origin;
const URL_UNDER_TEST = server.url;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
const VIEWPORT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };

mkdirSync(OUT, { recursive: true });
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
    if (r.exceptionDetails) throw new Error(`eval threw: ${r.exceptionDetails.text}`);
    return r.result.value;
  }
}

const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
const browser = new CDP(version.webSocketDebuggerUrl);
await browser.ready();

// Same self-cleaning play-fight.mjs relies on implicitly and drive-two-clients.mjs does
// explicitly: close any stale tab already sitting on the game's URL before this run starts, so an
// abandoned tab from a previous session's crash cannot count as a second client below.
const existing = await browser.send('Target.getTargets');
for (const target of existing.targetInfos) {
  if (target.type === 'page' && target.url.startsWith(URL_UNDER_TEST)) {
    await browser.send('Target.closeTarget', { targetId: target.targetId });
  }
}

const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
const page = new CDP(list.find((t) => t.id === targetId).webSocketDebuggerUrl);
await page.ready();
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Log.enable');

// The clean slate this harness exists to guarantee: wipe localStorage for the game's own origin
// BEFORE the first navigation, so getOrCreateGuestId() (public/src/net/guestId.js) mints a brand
// new guestId with zero marks on record, regardless of what any earlier harness run left behind
// in this persistent automation profile.
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });

const consoleErrors = [];
// The favicon entry is gone (Phase R3a): index.html has declared a zero-network data-URI favicon
// since Task F1, so /favicon.ico cannot 404 any more and an allowlist entry that can never match is
// a stale claim rather than a safety net. lantern_belt.glb stays -- it ships on its own track and
// main.js's own graceful fallback is required to keep the game playable without it.
const COSMETIC_404_PATTERNS = ['/assets/gear/lantern_belt.glb'];
page.ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    const entry = msg.params.entry;
    consoleErrors.push(entry.url ? `${entry.text} [${entry.url}]` : entry.text);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.text);
  }
});

await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Page.navigate', { url: URL_UNDER_TEST });

async function waitForRuntime(label) {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    await sleep(500);
    ready = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
  }
  if (!ready) throw new Error(`runtime never came up on ${URL_UNDER_TEST} (${label})`);
  let wolfUp = false;
  for (let i = 0; i < 30 && !wolfUp; i += 1) {
    await sleep(400);
    wolfUp = await page.eval('Boolean(window.__galaQuestRuntime.wolf())');
  }
  check(`the wolf loaded into the scene (${label})`, wolfUp);
  let online = false;
  for (let i = 0; i < 30 && !online; i += 1) {
    await sleep(300);
    online = await page.eval("window.__galaQuestRuntime.netState().status === 'online'");
  }
  check(`the client is online (${label})`, online, `status ${await page.eval('window.__galaQuestRuntime.netState().status')}`);
}

await waitForRuntime('first load');

const players = await page.eval(`(() => {
  const m = (document.querySelector('#runtime-status')?.textContent ?? '').match(/players\\s+(\\d+)/i);
  return m ? Number(m[1]) : 1;
})()`);
if (players !== 1) {
  console.error(`${players} clients connected — close other tabs, this harness needs exactly one`);
  await page.send('Target.closeTarget', { targetId });
  process.exit(2);
}

const touch = (type, points) => page.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});

async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}marks-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured marks-${name}.png`);
}

// Self-verifying, same as play-fight.mjs: records the state a capture was taken in, so a picture
// that does not show what its filename claims is a failed check, not a silent lie.
const state = () => page.eval(`(() => {
  const r = window.__galaQuestRuntime;
  const published = r.encounterState();
  const net = r.netState();
  const pipEls = [...document.querySelectorAll('#lantern-marks .mark')];
  return JSON.stringify({
    wolf: { ...published.wolf }, hero: { ...published.hero },
    heading: r.follow.heading,
    heroPos: [+r.player.position.x.toFixed(2), +r.player.position.z.toFixed(2)],
    serverPos: net.serverSelf ? [+net.serverSelf.x.toFixed(2), +net.serverSelf.z.toFixed(2)] : null,
    pipsFilled: pipEls.filter((el) => el.dataset.filled === 'true').length,
    rewards: r.rewards(),
    rewardEvents: r.rewardEvents(),
    guestId: r.guestId(),
    lanternMounted: r.lanternMounted(),
    netStatus: net.status,
  });
})()`).then(JSON.parse).then((published) => ({ ...published, canAttack: canAttack(published) }));

async function pollUntil(predicate, { intervalMs = 25, timeoutMs = 3000 } = {}) {
  return pollUntilDeadline(state, predicate, { intervalMs, timeoutMs });
}

const attackX = VIEWPORT.width - 68;
const attackY = VIEWPORT.height - 68;
const stickX = VIEWPORT.width * 0.18;
const stickY = VIEWPORT.height * 0.86;
const STICK_PX = 56;

// Cribbed near-verbatim from play-fight.mjs: `aim` is re-derived from the freshly-polled state on
// every loop tick, not captured once outside the loop, because the wolf is server-authoritative and
// keeps moving on its own clock for however long this loop runs.
async function walkToward(aim, stopWithin, maxMillis, { faceTarget = false } = {}) {
  let last = await state();
  const deadline = deadlineAfter(maxMillis);
  let pulsed = false;
  while (Date.now() < deadline) {
    const target = aim(last);
    const authority = last.serverPos ?? last.heroPos;
    const dx = target.x - authority[0];
    const dz = target.z - authority[1];
    const distance = Math.hypot(dx, dz);
    const renderedDistance = Math.hypot(target.x - last.heroPos[0], target.z - last.heroPos[1]);
    if (distance <= stopWithin && renderedDistance <= stopWithin && (!faceTarget || pulsed)) break;
    if (distance === 0) break;
    const nx = dx / distance;
    const nz = dz / distance;
    // Steered RELATIVE TO THE LIVE CAMERA HEADING, not to a heading-0 assumption. The stick is
    // camera-relative (camera/rotation.js's screenToWorld), and this used to hardcode the identity
    // case -- correct only while the game happened to open at heading 0. The moment main.js aimed the
    // opening shot at the village, this harness steered the hero to the far corner of the map and
    // reported it as a movement failure. The rotation below reduces to exactly the old
    // `stickX - nx`, `stickY - nz` at heading 0.
    const cos = Math.cos(last.heading); const sin = Math.sin(last.heading);
    const sx = -cos * nx + sin * nz;
    const sy = sin * nx + cos * nz;

    await touch('touchStart', [{ x: stickX, y: stickY }]);
    try {
      await touch('touchMove', [{ x: stickX + sx * STICK_PX, y: stickY - sy * STICK_PX }]);
      await sleep(movementPulseMillis(Math.max(0, distance - stopWithin)));
    } finally {
      await touch('touchEnd', []);
    }
    pulsed = true;
    await sleep(80);
    last = await state();
  }
  return last;
}

// ── the loop ───────────────────────────────────────────────────────────────────────────────────
const start = await state();
check('the guestId was created fresh (localStorage cleared before load)',
  typeof start.guestId === 'string' && start.guestId.length >= 8, `guestId ${start.guestId}`);
check('no marks on record before any kill', (start.rewards[Object.keys(start.rewards)[0]]?.marks ?? 0) === 0,
  JSON.stringify(start.rewards));
check('zero pips filled before any kill', start.pipsFilled === 0, `pipsFilled ${start.pipsFilled}`);
await shot('00-before');

await walkToward((live) => ({ x: live.wolf.x, z: live.wolf.z }), 1.2, 14000);

let killed = false;
for (let swing = 0; swing < 40 && !killed; swing += 1) {
  const before = await pollUntil((s) => s.canAttack, { timeoutMs: 3000 });
  const attackPos = before.serverPos ?? before.heroPos;
  const gap = Math.hypot(attackPos[0] - before.wolf.x, attackPos[1] - before.wolf.z);
  if (gap > 1.5 && before.wolf.mode !== 'dying' && before.wolf.mode !== 'dead') {
    await walkToward((live) => ({ x: live.wolf.x, z: live.wolf.z }), 1.2, 2500, { faceTarget: true });
  } else if (before.wolf.mode !== 'dying' && before.wolf.mode !== 'dead') {
    await walkToward((live) => ({ x: live.wolf.x, z: live.wolf.z }), 1.2, 800, { faceTarget: true });
  }
  await touch('touchStart', [{ x: attackX, y: attackY }]);
  await sleep(60);
  await touch('touchEnd', []);
  const now = await pollUntil(
    (s) => s.wolf.mode === 'hit' || s.wolf.mode === 'dying' || s.wolf.mode === 'dead',
    { intervalMs: 20, timeoutMs: (SWING_CONTACT_SECONDS + 0.4) * 1000 },
  );
  killed = now.wolf.mode === 'dying' || now.wolf.mode === 'dead';
}
check('the wolf can actually be killed', killed);

// The mark is awarded server-side off the SAME snapshot cadence combat events ride (net/gameServer.mjs,
// D3) -- 10 Hz -- so the pip filling and the reward event landing both need a poll, not an instant
// read the moment killed flips true.
const afterKill = await pollUntil((s) => s.pipsFilled >= 1, { timeoutMs: 3000 });
check('exactly one Lantern Mark pip fills after the first kill',
  afterKill.pipsFilled === 1, `pipsFilled ${afterKill.pipsFilled}`);
check('the mark-earned event was actually heard, not just inferred from the pip',
  afterKill.rewardEvents.some((e) => e.type === 'mark-earned'),
  JSON.stringify(afterKill.rewardEvents));
// Exactly one hero in this solo run, so its own id is whichever key rewards actually has --
// online that is the server's p<n> playerId, offline it is the fixed OFFLINE_HERO_ID -- and this
// harness deliberately does not hardcode either, the same way state()'s own reads never assume
// which mode produced them.
const ownGuestRewards = afterKill.rewards[Object.keys(afterKill.rewards)[0]];
check('the server-side mark count for this guest is exactly 1',
  ownGuestRewards?.marks === 1, JSON.stringify(afterKill.rewards));
check('one mark is not yet an unlock', ownGuestRewards?.lanternUnlocked === false, `MARKS_TO_UNLOCK is ${MARKS_TO_UNLOCK}`);
await shot('01-one-mark');

// ── reload: same localStorage, same guestId, marks survive from the welcome state ────────────────
await page.send('Page.navigate', { url: URL_UNDER_TEST });
await waitForRuntime('after reload');

const afterReload = await pollUntil((s) => s.pipsFilled >= 1 || s.netStatus === 'online', { timeoutMs: 4000 });
check('the SAME guestId survives the reload (localStorage, not a fresh mint)',
  afterReload.guestId === start.guestId, `before ${start.guestId} / after ${afterReload.guestId}`);
check('the pip is still filled from the welcome state, with no re-fight',
  afterReload.pipsFilled === 1, `pipsFilled ${afterReload.pipsFilled}`);
const reloadGuestRewards = afterReload.rewards[Object.keys(afterReload.rewards)[0]];
check('the welcome-time mark count for this guest is still exactly 1',
  reloadGuestRewards?.marks === 1, JSON.stringify(afterReload.rewards));
await shot('02-after-reload');

const isCosmetic404 = (text) => COSMETIC_404_PATTERNS.some((pattern) => text.includes(pattern));
const realErrors = consoleErrors.filter((text) => !isCosmetic404(text));
const cosmeticErrors = consoleErrors.filter(isCosmetic404);
check('no console errors across the whole run', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
if (cosmeticErrors.length) {
  console.log(`  NOTE  ${cosmeticErrors.length} known-missing-asset 404(s) -- not a failure; see CURRENT_STATE.`);
}

writeFileSync(`${OUT}marks-results.json`,
  JSON.stringify({ results, consoleErrors, start, afterKill, afterReload }, null, 2));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
await page.send('Target.closeTarget', { targetId });
process.exit(failures === 0 ? 0 : 1);
