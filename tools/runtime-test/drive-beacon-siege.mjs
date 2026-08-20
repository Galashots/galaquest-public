/**
 * G2/G3/G4/G5: boot the running game, WALK to the Old Beacon, break the three cold seals, fight the
 * Beacon Warden, and watch the Beacon catch.
 *
 *   node tools/runtime-test/drive-beacon-siege.mjs
 *
 * What this proves, in the order a child does it:
 *
 *   arrive at a cold Beacon -> the chip counts three seals -> hit a seal and it CRACKS -> hit it
 *   again and it BURSTS -> the third burst wakes something -> a boss bar appears with a name on it
 *   -> the fight is winnable -> the Warden falls -> the Beacon burns, and the chip finally points
 *   home.
 *
 * THE SEALS AND THE FIGHT ARE PLAYED, not simulated. Every blow is a real tap on the ATTACK button
 * against the real server-authoritative rules, and every approach is the touch stick. The setup half
 * -- spawn to the Beacon, which drive-old-beacon.mjs already proves metre by metre -- is walked in
 * bulk with a generous budget rather than re-proven here.
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * Cribbed wholesale from drive-old-beacon.mjs: its CDP-over-websocket harness, walkToward()'s
 * touch-drag, its owned-server-plus-isolated-store isolation, and GQ-008's "clear localStorage
 * before the FIRST navigation" discipline for a clean guest.
 *
 * WHY THE BUDGETS LOOK ENORMOUS: the same reason drive-old-beacon.mjs's own header gives. A hosted
 * headless runner renders this scene at a few frames a second and main.js clamps deltaSeconds to
 * 0.1 s, so a fight that takes twenty seconds on an iPad can take many minutes here. Every budget
 * below is a LIVENESS check and never a performance assertion.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openRewardStore } from '../../net/rewardStore.mjs';
import { GUEST_ID_STORAGE_KEY, sanitizeGuestId } from '../../public/src/net/guestId.js';
import { COLD_SEALS, OLD_BEACON } from '../../public/src/world/zones/village.js';
import { WARDEN_MAX_HP } from '../../public/src/world/beaconSiege.js';

const CHROME_PORT = 9224;
const OUT = '.local/runtime-test/';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadlineAfter = (ms) => Date.now() + ms;
const STICK_PX = 46;

let failures = 0;
function check(ok, label, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function seedUnlockedGuest(storePath, label) {
  const guestId = `gs-${label}-${randomUUID()}`;
  if (sanitizeGuestId(guestId) !== guestId) {
    throw new Error(`'${guestId}' (${guestId.length} chars) is not an id the client will keep`);
  }
  const store = openRewardStore(storePath);
  for (let i = 1; i <= 3; i += 1) {
    store.apply({ guestId, type: 'mark-earned', eventId: `siege-fixture:mark:${guestId}:${i}` });
  }
  store.apply({ guestId, type: 'lantern-unlocked', eventId: `siege-fixture:unlock:${guestId}` });
  store.close();
  return guestId;
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
  sendOnce(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 30000);
    });
  }
  async send(method, params = {}) {
    try { return await this.sendOnce(method, params); } catch (err) {
      if (!/timed out/.test(err.message)) throw err;
      return this.sendOnce(method, params);
    }
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`eval threw: ${r.exceptionDetails.text}`);
    return r.result.value;
  }
}

async function openTab(width, height) {
  const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
  const browser = new CDP(version.webSocketDebuggerUrl);
  await browser.ready();
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
  const page = new CDP(list.find((t) => t.id === targetId).webSocketDebuggerUrl);
  await page.ready();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: true,
    screenOrientation: { angle: width > height ? 90 : 0, type: width > height ? 'landscapePrimary' : 'portraitPrimary' },
  });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  return { page, viewport: { width, height } };
}

const STATE_EXPR = `JSON.stringify((() => {
  const r = window.__galaQuestRuntime;
  if (!r) return { ready: false };
  const siege = r.zoneSiegeState ? r.zoneSiegeState() : null;
  const trail = r.zoneTrailState();
  return {
    ready: true,
    heroPos: [r.player.position.x, r.player.position.z],
    heading: r.follow.heading,
    netStatus: r.netState().status,
    zone: r.zoneDebug(),
    treeLit: r.zoneTreeState()?.lit ?? false,
    beaconFound: trail.beaconFound,
    objective: document.querySelector('#quest-objective')?.textContent ?? '',
    objectiveShown: document.querySelector('#quest-objective')?.dataset.shown === 'true',
    bossBarShown: document.querySelector('#boss-bar')?.dataset.shown === 'true',
    bossBarText: document.querySelector('#boss-bar')?.textContent ?? '',
    banner: document.querySelector('#banner')?.dataset.shown === 'true'
      ? document.querySelector('#banner').textContent : '',
    siege,
  };
})())`;

const state = (tab) => tab.page.eval(STATE_EXPR).then(JSON.parse);

async function pollUntil(tab, predicate, maxMillis) {
  const deadline = deadlineAfter(maxMillis);
  let last = await state(tab);
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await sleep(220);
    last = await state(tab);
  }
  return last;
}

const touch = (tab, type, points) => tab.page.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});

async function walkToward(tab, targetX, targetZ, stopWithin, maxMillis) {
  const origin = { x: tab.viewport.width * 0.18, y: tab.viewport.height * 0.86 };
  let last = await state(tab);
  const deadline = deadlineAfter(maxMillis);
  while (Date.now() < deadline) {
    const dx = targetX - last.heroPos[0];
    const dz = targetZ - last.heroPos[1];
    const distance = Math.hypot(dx, dz);
    if (distance <= stopWithin) break;
    const nx = dx / distance;
    const nz = dz / distance;
    const cos = Math.cos(last.heading);
    const sin = Math.sin(last.heading);
    const sx = -cos * nx + sin * nz;
    const sy = sin * nx + cos * nz;
    await touch(tab, 'touchStart', [{ x: origin.x, y: origin.y }]);
    try {
      await touch(tab, 'touchMove', [{ x: origin.x + sx * STICK_PX, y: origin.y - sy * STICK_PX }]);
      await sleep(Math.min(1400, Math.max(320, distance * 220)));
    } finally {
      await touch(tab, 'touchEnd', []);
    }
    await sleep(90);
    last = await state(tab);
  }
  return last;
}

/** Face a world point, so a swing's own arc test has a chance and a capture has its subject. */
async function aimAt(tab, targetX, targetZ) {
  const here = await state(tab);
  const heading = Math.atan2(targetX - here.heroPos[0], targetZ - here.heroPos[1]);
  await tab.page.eval(`window.__galaQuestRuntime.follow.setHeading(${heading})`);
  await sleep(500);
  return state(tab);
}

/** One real tap on the ATTACK button. */
async function tapAttack(tab) {
  const box = await tab.page.eval(`JSON.stringify((() => {
    const r = document.querySelector('#attack-button').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })())`).then(JSON.parse);
  await touch(tab, 'touchStart', [{ x: box.x, y: box.y }]);
  await sleep(60);
  await touch(tab, 'touchEnd', []);
}

async function shot(tab, name) {
  const { data } = await tab.page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}siege-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured siege-${name}.png`);
}

async function run() {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-siege-'));
  const storePath = join(dir, 'rewards.db');
  const guestId = seedUnlockedGuest(storePath, 'portrait');
  const port = 5203;
  const serverPath = fileURLToPath(new URL('../../server.mjs', import.meta.url));
  const server = spawn(process.execPath, [serverPath, String(port)], {
    env: { ...process.env, GALAQUEST_REWARD_STORE_PATH: storePath },
    stdio: 'ignore', detached: true,
  });
  console.log(`  harness-owned server on http://127.0.0.1:${port}/ (pid ${server.pid})`);
  await sleep(2500);

  const tab = await openTab(768, 1024);
  const origin = `http://127.0.0.1:${port}`;
  try {
    // GQ-008: CLEAR STORAGE BEFORE THE FIRST NAVIGATION. The automation profile is persistent, so a
    // harness that simply navigates inherits whatever gq-guest-id the last run left behind and
    // quietly plays as somebody else's save. Clearing needs the origin to exist, so: navigate once
    // to establish it, clear, then pin this run's own guest and navigate again for real.
    await tab.page.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage' });
    await tab.page.send('Page.navigate', { url: `${origin}/favicon.ico` });
    await sleep(600);
    // The key is IMPORTED, not retyped (GQ-007). Guessing it is exactly how the first run of this
    // file played the whole game as an unseeded stranger: no marks, a dark Lantern Tree, and a chip
    // still saying "Talk to Keeper Aldric" while the hero stood at the Old Beacon.
    await tab.page.eval(`localStorage.setItem(${JSON.stringify(GUEST_ID_STORAGE_KEY)}, ${JSON.stringify(guestId)})`);
    await tab.page.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    const ready = await pollUntil(tab, (s) => s.ready && s.zone?.loaded >= s.zone?.requested, 60000);
    if (!ready.ready) throw new Error('runtime never came up');
    await sleep(1500);

    // ── to the Beacon ────────────────────────────────────────────────────────────────────────────
    console.log('── walking to the Old Beacon ──');
    await walkToward(tab, OLD_BEACON.at[0], OLD_BEACON.at[1] - 3, 2.2, 300000);
    const arrived = await pollUntil(tab, (s) => s.beaconFound === true, 30000);
    check(arrived.beaconFound === true, 'the child reaches the Old Beacon', `at ${JSON.stringify(arrived.heroPos.map((n) => +n.toFixed(1)))}`);
    check(arrived.siege?.sealsBuilt === 3, 'three cold seals stand around its base', `built ${arrived.siege?.sealsBuilt}`);
    check(arrived.siege?.wardenBuilt === true, 'and something is kneeling beside it');
    check(/cold seal/i.test(arrived.objective), 'the chip names the seals rather than asking a question', JSON.stringify(arrived.objective));
    await aimAt(tab, OLD_BEACON.at[0], OLD_BEACON.at[1]);
    await shot(tab, 'portrait-01-the-cold-beacon');

    // ── break the three seals, for real ──────────────────────────────────────────────────────────
    console.log('── breaking the seals ──');
    for (let index = 0; index < COLD_SEALS.length; index += 1) {
      const [sx, sz] = COLD_SEALS[index];
      await walkToward(tab, sx, sz - 1.1, 1.5, 90000);
      await aimAt(tab, sx, sz);
      const before = await state(tab);
      const wasBurst = before.siege.seals.filter((s) => s.burst).length;
      let cracked = null;
      for (let swing = 0; swing < 14; swing += 1) {
        await tapAttack(tab);
        const after = await pollUntil(
          tab,
          (s) => s.siege.seals.filter((x) => x.burst).length > wasBurst
            || s.siege.seals.some((x, i) => x.blows > before.siege.seals[i].blows),
          9000,
        );
        if (cracked === null && after.siege.seals.some((x, i) => x.blows > before.siege.seals[i].blows)) {
          cracked = after;
          if (index === 0) {
            check(true, 'the first blow visibly CRACKS a seal rather than doing nothing',
              `blows ${JSON.stringify(after.siege.seals.map((s) => s.blows))}`);
            await shot(tab, 'portrait-02-a-seal-cracked');
          }
        }
        if (after.siege.seals.filter((x) => x.burst).length > wasBurst) break;
        await sleep(300);
      }
      const done = await state(tab);
      const gone = done.siege.seals.filter((s) => s.burst).length;
      check(gone === index + 1, `seal ${index + 1} of 3 bursts`, `${gone} gone, chip "${done.objective}"`);
      if (gone !== index + 1) break;
    }

    const woken = await pollUntil(tab, (s) => s.siege.warden.mode !== 'dormant', 20000);
    check(woken.siege.warden.mode !== 'dormant', 'the third burst WAKES the Warden', `mode ${woken.siege.warden.mode}`);
    await aimAt(tab, woken.siege.warden.x, woken.siege.warden.z);
    await shot(tab, 'portrait-03-something-answered');

    // ── the fight ────────────────────────────────────────────────────────────────────────────────
    console.log('── fighting the Beacon Warden ──');
    const bossBar = await pollUntil(tab, (s) => s.bossBarShown === true, 25000);
    check(bossBar.bossBarShown === true, 'a boss bar appears', `text ${JSON.stringify(bossBar.bossBarText.trim().slice(0, 40))}`);
    check(/BEACON WARDEN/i.test(bossBar.bossBarText), 'and it NAMES the thing you are fighting',
      JSON.stringify(bossBar.bossBarText.trim().slice(0, 40)));
    await shot(tab, 'portrait-04-the-warden-is-up');

    const fightDeadline = deadlineAfter(900000);
    let shotPhase2 = false;
    let last = bossBar;
    while (Date.now() < fightDeadline && !last.siege.beaconLit) {
      const w = last.siege.warden;
      if (Math.hypot(last.heroPos[0] - w.x, last.heroPos[1] - w.z) > 1.6) {
        await walkToward(tab, w.x, w.z, 1.5, 12000);
      }
      await aimAt(tab, w.x, w.z);
      await tapAttack(tab);
      await sleep(650);
      last = await state(tab);
      if (!shotPhase2 && last.siege.warden.phase >= 2) {
        shotPhase2 = true;
        check(true, 'the Warden reaches a second phase', `hp ${last.siege.warden.hp}/${WARDEN_MAX_HP}`);
        await shot(tab, 'portrait-05-phase-two');
      }
    }
    check(last.siege.beaconLit === true, 'the Warden falls and the Old Beacon CATCHES',
      `warden ${last.siege.warden.mode} hp ${last.siege.warden.hp}, beaconLit ${last.siege.beaconLit}`);

    const lit = await pollUntil(tab, (s) => s.siege.beaconLitInScene === true, 20000);
    check(lit.siege.beaconLitInScene === true, 'and the scene agrees the fire is burning');
    await aimAt(tab, OLD_BEACON.at[0], OLD_BEACON.at[1]);
    await sleep(2500);
    await shot(tab, 'portrait-06-the-beacon-burns');

    const home = await pollUntil(tab, (s) => /Rowan/i.test(s.objective), 20000);
    check(/Rowan/i.test(home.objective), 'and only then does the chip send the child home',
      JSON.stringify(home.objective));

    const errors = await tab.page.eval(`JSON.stringify(window.__galaQuestConsoleErrors ?? [])`).then(JSON.parse);
    check(errors.length === 0, 'no console errors across the whole siege', errors.slice(0, 2).join(' | '));
  } finally {
    try { process.kill(-server.pid); } catch { /* already gone */ }
  }
}

run().then(() => {
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}).catch((err) => {
  console.error('\nHARNESS ERROR:', err.message);
  process.exit(1);
});
