/**
 * ARC 2: somebody answered the signal. Boot the running game into a world where the Beacon is
 * ALREADY burning and prove that a stranger is standing in the village because of it.
 *
 *   node tools/runtime-test/drive-ranger.mjs
 *
 * What this proves, in the order a child meets it:
 *
 *   the Beacon is lit -> Wren is THERE, drawn, in the village -> she has a line, and it is the one
 *   for a child who is not carrying anything of hers -> walk up holding her brother's satchel and
 *   the line CHANGES -> she takes it and gives the charm -> a FOURTH HEART appears on the bar and
 *   stays there through a reload.
 *
 * SEEDED, NOT PLAYED, and deliberately. Everything upstream of Wren -- the marks, the tree, the
 * road, the seals, the Warden -- is proven metre by metre by drive-old-beacon.mjs and
 * drive-beacon-siege.mjs, and re-walking forty-six metres of it here would buy nothing but minutes.
 * What is NOT seeded is the thing under test: the durable rows go in, the browser boots, and every
 * assertion below is read off the running scene.
 *
 * THE HEART IS MEASURED, NOT ANNOUNCED (docs/MISTAKES.md GQ-013). It is not enough that a row was
 * written or that a banner fired: this asks the running game how many pips the bar is drawing and
 * how many hearts the body it is drawing them for actually has.
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * Cribbed wholesale from drive-beacon-siege.mjs: its CDP-over-websocket harness, walkToward()'s
 * touch-drag, its owned-server-plus-isolated-store isolation, and GQ-008's "clear localStorage
 * before the FIRST navigation" discipline for a clean guest.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openRewardStore } from '../../net/rewardStore.mjs';
// The game URL a harness must land on. Imported rather than hand-built: this file spawns its
// own server on a fixed port and so never saw startOwnedServer's `?hero=`, which is exactly how
// it went red when the profile gate landed -- straight onto the naming question, world behind a
// modal, input suspended. See owned-server.mjs's gameUrlFor.
import { gameUrlFor } from './owned-server.mjs';
import { GUEST_ID_STORAGE_KEY, sanitizeGuestId } from '../../public/src/net/guestId.js';
import { LODGE, RANGER, RANGER_CLAIM } from '../../public/src/world/zones/village.js';
import { KEEPER_WAVE_RADIUS_METERS } from '../../public/src/world/zoneLoader.js';
import { HERO_MAX_HP } from '../../public/src/combat/encounter.js';
import { RANGER_LINE_INTRO, RANGER_LINE_SATCHEL_GIVEN }
  from '../../public/src/world/rangerSpeech.js';

const CHROME_PORT = 9224;
const OUT = '.local/runtime-test/';
mkdirSync(OUT, { recursive: true });

// ── BUDGETS ────────────────────────────────────────────────────────────────────────────────────
//
// This one is small on purpose. Everything it seeds instead of walking is proven elsewhere, so the
// only travel here is five metres to Wren and back, plus one reload. The ceiling is still the
// workflow's own timeout-minutes: 18, and RUN_DEADLINE_MS is still the backstop that makes this
// file report its own verdict rather than being killed mute by the runner.
//
// A budget is a LIVENESS bound and never a performance claim -- a hosted headless runner renders
// this scene at a few frames a second, which says nothing at all about an iPad.
const JOB_CEILING_MS = 18 * 60 * 1000;
const RUN_DEADLINE_MS = JOB_CEILING_MS - 150_000;
const WALK_BUDGET_MS = 90_000;
const startedAt = Date.now();
const msLeft = () => RUN_DEADLINE_MS - (Date.now() - startedAt);
/** Throw with a verdict the log can actually show, rather than letting the runner kill us mute. */
function assertBudget(where) {
  if (msLeft() > 0) return;
  throw new Error(`out of run budget at ${where} -- this harness must finish inside the job's own `
    + `${JOB_CEILING_MS / 60000}-minute ceiling, and did not. That is a real result: either the arc `
    + `got slower or a step is not converging. Do NOT fix it by raising the ceiling.`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadlineAfter = (ms) => Date.now() + ms;
const STICK_PX = 46;

let failures = 0;
function check(ok, label, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/**
 * A world where the Beacon is already burning, and a child who has already earned their way there.
 *
 * `beacon-lit` is a WORLD row and carries no guest of its own in the game's own logic, but the store
 * requires a guestId on every write -- so it is written under this fixture's guest, exactly the way
 * net/gameServer.mjs's recordBeaconLit writes it under whichever player happened to land the blow.
 * What makes it a world fact is that beaconLit() looks for the ROW and never for whose it is.
 *
 * `withSatchel` is the difference between the two phases: it is the one thing under test, so it is
 * seeded in one phase and EARNED in the other.
 */
function seedGuest(storePath, label, { withSatchel = false } = {}) {
  const guestId = `gs-${label}-${randomUUID()}`;
  if (sanitizeGuestId(guestId) !== guestId) {
    throw new Error(`'${guestId}' (${guestId.length} chars) is not an id the client will keep`);
  }
  const store = openRewardStore(storePath);
  for (let i = 1; i <= 3; i += 1) {
    store.apply({ guestId, type: 'mark-earned', eventId: `ranger-fixture:mark:${guestId}:${i}` });
  }
  store.apply({ guestId, type: 'lantern-unlocked', eventId: `ranger-fixture:unlock:${guestId}` });
  store.apply({ guestId, type: 'beacon-lit', eventId: `ranger-fixture:beacon:${guestId}` });
  if (withSatchel) {
    store.apply({ guestId, type: 'satchel-taken', eventId: `satchel:${guestId}` });
  }
  // VERIFIED, not hoped for. A fixture that silently fails to seed does not fail the run -- it makes
  // the run play as a fresh stranger in a dark world and then report a pile of confusing product
  // failures that are really one setup failure.
  const seeded = store.marksFor(guestId) === 3 && store.unlockedFor(guestId) && store.beaconLit()
    && store.satchelTakenFor(guestId) === withSatchel && !store.charmEarnedFor(guestId);
  store.close();
  if (!seeded) throw new Error(`seeding ${guestId} did not take`);
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
  // CONSOLE ERRORS ARE A RESULT, so they are collected from the first frame rather than sampled at
  // the end. A page that threw during boot and recovered is still a page that threw.
  const consoleErrors = [];
  page.ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method !== 'Runtime.consoleAPICalled' || msg.params?.type !== 'error') return;
    consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
  });
  return {
    page,
    viewport: { width, height },
    consoleErrors,
    async close() {
      // Best effort. A leaked tab costs nothing -- the job kills this Chrome on the way out -- and a
      // teardown that can fail the run is a teardown that reports setup noise as a game defect.
      try { await page.send('Page.close'); } catch { /* already gone */ }
    },
  };
}

const STATE_EXPR = `JSON.stringify((() => {
  const r = window.__galaQuestRuntime;
  if (!r) return { ready: false };
  const ranger = r.zoneRangerState ? r.zoneRangerState() : null;
  return {
    ready: true,
    heroPos: [r.player.position.x, r.player.position.z],
    // The FOLLOW CAMERA's heading, which is the basis walkToward's stick maths is expressed in
    // (camera/rotation.js's screenToWorld). Not the hero's -- nothing in this file swings at
    // anything, so the hero's own facing is not a question this harness has to ask.
    heading: r.follow.heading,
    netStatus: r.netState().status,
    zone: r.zoneDebug(),
    guestId: r.guestId(),
    rewards: (() => {
      const all = r.rewards();
      const id = r.netState().selfId;
      return (id != null ? all[id] : null) ?? Object.values(all)[0] ?? null;
    })(),
    beaconLit: r.zoneSiegeState ? r.zoneSiegeState().beaconLit : null,
    lodgeFound: r.zoneSiegeState ? r.zoneSiegeState().lodgeFound : null,
    objective: document.querySelector('#quest-objective')?.textContent ?? '',
    ranger,
    // WHAT THE BAR IS ACTUALLY DRAWING, counted off the DOM rather than taken from the state that
    // was supposed to have painted it. A ceiling that moved and a bar that did not is exactly the
    // shape of defect GQ-013 is about, and reading the model twice would never catch it.
    heartsDrawn: Array.from(document.querySelectorAll('#hero-health .heart'))
      .filter((heart) => heart.hidden !== true).length,
    heartsFilled: Array.from(document.querySelectorAll('#hero-health .heart'))
      .filter((heart) => heart.hidden !== true && heart.dataset.filled === 'true').length,
    npcName: document.querySelector('#keeper-speech-name')?.textContent?.trim() ?? null,
    npcLine: document.querySelector('#keeper-speech')?.textContent ?? '',
    npcShown: document.querySelector('#keeper-speech')?.dataset.shown === 'true',
    banner: document.querySelector('#banner')?.textContent ?? '',
  };
})())`;

const state = (tab) => tab.page.eval(STATE_EXPR).then(JSON.parse);

/**
 * Why the bubble says what it says -- written because the hosted failure for Wren's post-charm line
 * read, in full, `"🔊"`.
 *
 * That is the speaker button alone with the text span empty, which is what a HIDDEN bubble's
 * textContent looks like, and it names nothing at all. The bubble is hidden when the hero is outside
 * rangerSpeechState's radius, and that radius is KEEPER_WAVE_RADIUS_METERS -- two metres. A child
 * standing still for twelve seconds while prediction reconciliation settles can leave a two-metre
 * circle without ever meaning to, and so can this harness, which stands still and polls.
 *
 * So this reports the distance rather than the silence. It deliberately does NOT widen the poll
 * budget: if the cause is drift out of a two-metre conversation radius, a longer wait hides a
 * product defect a young child would hit with a thumb on a virtual stick, and the Checkpoint 0
 * audit already flagged that radius as the tightest trigger in the game.
 */
function whyTheBubbleSaysThat(sample) {
  const [heroX, heroZ] = sample.heroPos ?? [NaN, NaN];
  const metres = Math.hypot(heroX - RANGER.at[0], heroZ - RANGER.at[1]);
  return [
    JSON.stringify((sample.npcLine ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)),
    `shown ${sample.npcShown}`,
    `hero ${metres.toFixed(2)}m from Wren, radius ${KEEPER_WAVE_RADIUS_METERS}m`,
    `satchel ${sample.ranger?.satchelCarried} charm ${sample.ranger?.charmOwned}`,
  ].join(' · ');
}

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

async function shot(tab, name) {
  const { data } = await tab.page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured ${name}.png`);
}

/**
 * Boot one client into a seeded world and hand back a live tab. Shared by both phases because they
 * differ only in what was seeded, which is the whole point of splitting them.
 */
async function boot(label, { withSatchel }) {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-ranger-'));
  const storePath = join(dir, 'rewards.db');
  const guestId = seedGuest(storePath, label, { withSatchel });
  const port = 5204;
  const serverPath = fileURLToPath(new URL('../../server.mjs', import.meta.url));
  const server = spawn(process.execPath, [serverPath, String(port)], {
    env: { ...process.env, GALAQUEST_REWARD_STORE_PATH: storePath },
    stdio: 'ignore',
    detached: true,
  });
  console.log(`  harness-owned server on http://127.0.0.1:${port}/ (pid ${server.pid})`);
  await sleep(2500);

  const tab = await openTab(768, 1024);
  const origin = `http://127.0.0.1:${port}`;
  // GQ-008: CLEAR STORAGE BEFORE THE FIRST NAVIGATION. The automation profile is persistent, so a
  // harness that simply navigates inherits whatever gq-guest-id the last run left behind and quietly
  // plays as somebody else's save. Clearing needs the origin to exist, so: navigate once to
  // establish it, clear, then pin this run's own guest and navigate again for real.
  await tab.page.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage' });
  await tab.page.send('Page.navigate', { url: `${origin}/favicon.ico` });
  await sleep(600);
  // The key is IMPORTED, not retyped (GQ-007).
  await tab.page.eval(`localStorage.setItem(${JSON.stringify(GUEST_ID_STORAGE_KEY)}, ${JSON.stringify(guestId)})`);
  await tab.page.send('Page.navigate', { url: gameUrlFor(origin) });
  const ready = await pollUntil(tab, (s) => s.ready && s.zone?.loaded >= s.zone?.requested, 60000);
  if (!ready.ready) throw new Error('runtime never came up');

  // THE FIXTURE HAS TO ACTUALLY BE THIS PLAYER, AND THIS WORLD. Checked at the seam rather than
  // inferred from a downstream product failure: if the guest id did not survive the navigation, or
  // the server is reading a different store, every assertion after this point reports a game defect
  // that is really a setup defect.
  const seeded = await pollUntil(tab, (s) => (s.rewards?.marks ?? 0) >= 3 && s.beaconLit === true, 25000);
  if ((seeded.rewards?.marks ?? 0) < 3 || seeded.beaconLit !== true) {
    throw new Error(`the seeded world did not take: guestId ${JSON.stringify(seeded.guestId)}, `
      + `net ${seeded.netStatus}, beaconLit ${seeded.beaconLit}, rewards ${JSON.stringify(seeded.rewards)}`);
  }
  await sleep(1200);
  return { tab, server, origin };
}

/** SHE IS THERE. The Beacon burned, so somebody came -- and a child who has not been anywhere near
 *  the hollow gets the line for a stranger with nothing of hers, not a thank-you for a satchel they
 *  are not carrying. */
async function phaseArrival() {
  console.log('\n── phase arrival (the Beacon burned, so somebody came) ──');
  const { tab, server } = await boot('arrival', { withSatchel: false });
  try {
    const here = await pollUntil(tab, (s) => s.ranger?.rangerHere === true, 15000);
    check(here.ranger?.rangerBuilt === true, 'the ranger is built into the zone at all',
      `built ${here.ranger?.rangerBuilt}`);
    check(here.ranger?.rangerHere === true,
      'and she is DRAWN, because the Beacon is burning', `here ${here.ranger?.rangerHere}`);
    check(here.ranger?.charmOwned === false && here.ranger?.satchelCarried === false,
      'a child who has been nowhere near the hollow carries nothing of hers',
      `satchel ${here.ranger?.satchelCarried}, charm ${here.ranger?.charmOwned}`);
    check(here.heartsDrawn === HERO_MAX_HP,
      'and the bar still draws the three hearts everybody starts with',
      `${here.heartsDrawn} pips, ${here.heartsFilled} filled`);
    await shot(tab, 'ranger-01-somebody-came');

    // WALK UP TO HER. Five metres, on the stick, the way a child arrives.
    await walkToward(tab, RANGER.at[0], RANGER.at[1], 1.6, WALK_BUDGET_MS);
    const spoke = await pollUntil(tab, (s) => s.npcShown === true && /Wren/.test(s.npcName ?? ''), 12000);
    check(/Wren/.test(spoke.npcName ?? ''), 'walking up to her opens a bubble with her NAME on it',
      JSON.stringify(spoke.npcName));
    // The line is compared against the EXPORTED prose, not against a copy of it typed here: a
    // harness that restates a line can only ever prove the harness and the game were edited on the
    // same day (GQ-007).
    const intro = RANGER_LINE_INTRO.slice(0, 40);
    check(spoke.npcLine.includes(intro), 'and she says the line for a stranger who has brought her nothing',
      JSON.stringify(spoke.npcLine.replace(/\s+/g, ' ').trim().slice(0, 80)));
    check(!spoke.npcLine.includes(RANGER_LINE_SATCHEL_GIVEN.slice(0, 20)),
      'and NOT the line that thanks a child for a satchel they never found');
    await shot(tab, 'ranger-02-the-stranger-speaks');
    check(tab.consoleErrors.length === 0, 'no console errors', tab.consoleErrors.slice(0, 3).join(' | '));
  } finally {
    await tab.close().catch(() => {});
    try { process.kill(-server.pid); } catch { /* already gone */ }
  }
}

/** THE HANDOVER. A child carrying her brother's satchel walks up, and walks away with a fourth
 *  heart that is still there after a reload. */
async function phaseCharm() {
  console.log('\n── phase charm (she takes the satchel, and gives a heart) ──');
  const { tab, server, origin } = await boot('charm', { withSatchel: true });
  try {
    const start = await pollUntil(tab, (s) => s.ranger?.satchelCarried === true, 20000);
    check(start.ranger?.satchelCarried === true, 'this child is carrying the fallen ranger\'s satchel',
      `satchel ${start.ranger?.satchelCarried}`);
    check(start.heartsDrawn === HERO_MAX_HP,
      'and still has only the three hearts they started the game with',
      `${start.heartsDrawn} pips`);

    await walkToward(tab, RANGER.at[0], RANGER.at[1], Math.max(1.2, RANGER_CLAIM.radiusMeters * 0.55),
      WALK_BUDGET_MS);
    // RECOGNITION BEFORE THANKS is the beat, so the line she says while the claim is still in
    // flight must be the one that interrupts itself -- see RANGER_LINE_SATCHEL_FOUND's own comment.
    // Not asserted here: it is a sub-second window on a fast runner and this file will not pin a
    // race. What IS asserted is what she says once it has landed, below.
    const given = await pollUntil(tab, (s) => s.ranger?.charmOwned === true, 20000);
    check(given.ranger?.charmOwned === true, 'standing in front of her with it, she gives the charm',
      `charm ${given.ranger?.charmOwned}`);

    // THE WHOLE POINT. Measured off the DOM and off the body, not off the row that was written.
    const hearted = await pollUntil(tab, (s) => s.heartsDrawn > HERO_MAX_HP, 15000);
    check(hearted.heartsDrawn === HERO_MAX_HP + 1,
      'and a FOURTH HEART appears on the bar', `${hearted.heartsDrawn} pips drawn`);
    check(hearted.heartsFilled === HERO_MAX_HP + 1,
      'filled, not empty -- the charm gives a heart, it does not open a wound',
      `${hearted.heartsFilled} of ${hearted.heartsDrawn} filled`);
    check(hearted.ranger?.heartCeiling === HERO_MAX_HP + 1,
      'and the body the bar is drawing for really does have four',
      `ceiling ${hearted.ranger?.heartCeiling}, hearts ${hearted.ranger?.hearts}`);
    const said = await pollUntil(tab, (s) => s.npcLine.includes(RANGER_LINE_SATCHEL_GIVEN.slice(0, 18)), 12000);
    check(said.npcLine.includes(RANGER_LINE_SATCHEL_GIVEN.slice(0, 18)),
      'and she tells the child where her brother got to', whyTheBubbleSaysThat(said));
    await shot(tab, 'ranger-03-the-fourth-heart');

    // AND IT IS DURABLE. A fourth heart that evaporates on reload is a fourth heart nobody has.
    await tab.page.send('Page.navigate', { url: gameUrlFor(origin) });
    // BOTH facts, not just the hearts. A reboot learns `beaconLit` from the first snapshot's siege
    // block and its hearts from the same snapshot's rewards block, and there is no rule saying the
    // two land on the same frame -- so a poll that stops at the hearts can read a village Wren has
    // not been redrawn into yet and report a bug that is really the harness being early.
    const back = await pollUntil(
      tab,
      (s) => s.ready && s.zone?.loaded >= s.zone?.requested
        && s.heartsDrawn > HERO_MAX_HP && s.ranger?.rangerHere === true,
      45000,
    );
    check(back.heartsDrawn === HERO_MAX_HP + 1, 'and it is still there after a reload',
      `${back.heartsDrawn} pips drawn`);
    check(back.ranger?.rangerHere === true, 'and so is she', `here ${back.ranger?.rangerHere}`);
    check(tab.consoleErrors.length === 0, 'no console errors', tab.consoleErrors.slice(0, 3).join(' | '));
  } finally {
    await tab.close().catch(() => {});
    try { process.kill(-server.pid); } catch { /* already gone */ }
  }
}

/** THE OLD ROAD. A child who has been in the hollow is told to follow it east, and it ends at a
 *  house rather than in a field -- which is the defect this project has shipped three times and the
 *  reason the world grew twelve metres to carry it. */
async function phaseLodge() {
  console.log('\n── phase lodge (the old road ends at a door) ──');
  const { tab, server } = await boot('lodge', { withSatchel: true });
  try {
    // Straight out east along the ranger road. The seeded guest has never been in the hollow, so
    // this leg is about the GROUND being there at all -- the chip and the arrival are checked once
    // the hero is standing in it.
    await walkToward(tab, LODGE.at[0], LODGE.at[1], 2.0, 240_000);
    const there = await pollUntil(tab, (s) => s.lodgeFound === true, 20000);
    check(there.lodgeFound === true, 'the road east ends somewhere a child can arrive AT',
      `hero ${JSON.stringify(there.heroPos.map((n) => +n.toFixed(1)))}, lodge ${JSON.stringify(LODGE.at)}`);
    check(/Ranger Lodge/i.test(there.banner ?? ''), 'and the banner names the place',
      JSON.stringify((there.banner ?? '').trim()));
    // THE WORLD REALLY DID GROW. Standing here at all is the assertion: x = 20.8 was two metres
    // outside the walkable world until this change, and the clamp would have pinned the hero at 13.
    check(there.heroPos[0] > 13, 'and the hero is standing east of where the world used to end',
      `x ${there.heroPos[0].toFixed(2)} against an old limit of 13`);
    // Let the arrival banner expire before photographing the place it names. It is a wide dark box
    // at almost exactly hero height, so a capture taken on the arrival frame is a picture of a
    // building with the child hidden behind a caption -- GQ-010's own "photograph the subject",
    // caused this time by the game's own UI rather than by the camera.
    await sleep(3400);
    await shot(tab, 'lodge-01-the-old-road-ends');
    check(tab.consoleErrors.length === 0, 'no console errors', tab.consoleErrors.slice(0, 3).join(' | '));
  } finally {
    await tab.close().catch(() => {});
    try { process.kill(-server.pid); } catch { /* already gone */ }
  }
}

const PHASES = { arrival: phaseArrival, charm: phaseCharm, lodge: phaseLodge };

async function run() {
  const asked = process.argv.slice(2).filter((name) => name in PHASES);
  const names = asked.length > 0 ? asked : Object.keys(PHASES);
  for (const name of names) {
    assertBudget(`starting phase ${name}`);
    await PHASES[name]();
  }
}

run().then(() => {
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}).catch((err) => {
  console.error('\nHARNESS ERROR:', err.stack ?? err.message);
  process.exit(1);
});
