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
 * THE CHARM IS MEASURED, NOT ANNOUNCED (docs/MISTAKES.md GQ-013). It is not enough that a row was
 * written or that a banner fired: this asks the running game what the health readout is actually
 * PRINTING and what the body it is printing for actually is.
 *
 * Those two questions used to be "how many pips are drawn" and "how many are filled". P2 replaced
 * the fixed heart row with a scalable bar and a current/max numeral (every Hero level now grants max
 * HP, so a fixed row of icons cannot draw a body that grows), and this harness moved with it --
 * GQ-017: the readers of a changed surface are not all under test/, and finishing one directory is
 * not finishing.
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
import { pollUntilDeadline } from './automation-timing.mjs';
import {
  metresOrUnknown, readWatchSource, READ_WALK, startWalk, startWatch, STOP_WALK, stopWatchSource,
  waitForSample,
} from './in-page-driver.mjs';
import { GUEST_ID_STORAGE_KEY, sanitizeGuestId } from '../../public/src/net/guestId.js';
import { LODGE, RANGER, RANGER_CLAIM } from '../../public/src/world/zones/village.js';
import { KEEPER_WAVE_RADIUS_METERS } from '../../public/src/world/zoneLoader.js';
import { HERO_MAX_HP } from '../../public/src/combat/encounter.js';
// The charm's worth, imported rather than typed as `+ 1`: it is a Hero stat since P2, and a harness
// that hand-typed the bonus would be the copy GQ-007 hit 8 is about -- silent until the day it moves.
import { WREN_CHARM_MAX_HP_BONUS } from '../../public/src/progression/heroStats.js';
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
// HOW MUCH OF A CONVERSATION, counted in RENDERED FRAMES rather than seconds. Wren's opening line is
// about six seconds read aloud; at the 3-10 fps a hosted runner paints, that is 20-60 frames. Forty
// is inside that band and is more than three of the wolf's bite cooldowns, so an unprotected child
// standing this long is bitten several times over -- which is what the unit seam's red-capable case
// measures and what this number has to stay above to keep meaning anything.
const CONVERSATION_FRAMES = 40;
// Twelve times slower is where the mauling was first reproduced locally. See openTab's cpuThrottle.
const SANCTUARY_THROTTLE = 12;
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

/**
 * @param cpuThrottle  slowdown multiplier for Emulation.setCPUThrottlingRate, or 1 for none.
 *   This is how the Wren mauling was first reproduced OFF a hosted runner: local Chrome paints this
 *   scene far too fast to starve, and every frame-rate defect this project has found lives in the
 *   3-10 fps band a hosted headless runner actually renders at (GQ-021). Throttling is the only way
 *   to put a local run in that band on purpose rather than by luck. It stacks with whatever the
 *   runner is already doing, so the phase that uses it MEASURES and prints the frame rate it got
 *   instead of claiming one.
 */
async function openTab(width, height, { cpuThrottle = 1 } = {}) {
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
  if (cpuThrottle > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
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
    // WHAT THE READOUT IS ACTUALLY PRINTING, read off the DOM rather than taken from the state that
    // was supposed to have painted it. A ceiling that moved and a bar that did not is exactly the
    // shape of defect GQ-013 is about, and reading the model twice would never catch it.
    healthMaxDrawn: Number(document.querySelector('#health-max')?.textContent ?? NaN),
    healthCurrentDrawn: Number(document.querySelector('#health-current')?.textContent ?? NaN),
    // ...and how long the bar itself is, as a percentage string, because the numerals and the bar are
    // two channels and a child who cannot read numbers only has the second one.
    healthFillWidth: document.querySelector('#hero-health .health-fill')?.style.width ?? '',
    npcName: document.querySelector('#keeper-speech-name')?.textContent?.trim() ?? null,
    npcLine: document.querySelector('#keeper-speech')?.textContent ?? '',
    npcShown: document.querySelector('#keeper-speech')?.dataset.shown === 'true',
    banner: document.querySelector('#banner')?.textContent ?? '',
  };
})())`;

const state = (tab) => tab.page.eval(STATE_EXPR).then(JSON.parse);

/**
 * EVERY FRAME OF THE WALK-UP AND THE WAIT, recorded in-page.
 *
 * Written because the hosted failure for Wren's arrival line read, in full, `""` and `"🔊"` -- an
 * empty name and the speaker button alone -- and named nothing about WHY. Four different faults
 * produce that same pair of strings and they want four different fixes:
 *
 *   the hero never got inside the two-metre radius at all;
 *   he got inside and reconciliation dragged him back out while the harness stood still;
 *   the bubble opened and shut again between two 220ms polls, which on a runner painting three
 *     frames a second is most of them;
 *   the wolf caught him.
 *
 * Distance alone separates the first three and health separates the fourth, so this records both, on
 * requestAnimationFrame rather than over CDP: a poll from Node delays the answer, but a frame the
 * poll was not awake for is gone.
 *
 * THE FOURTH ONE IS NOT HYPOTHETICAL, and what it found is a game defect rather than a harness one.
 * It is recorded here because this recorder is what measures it, and it will keep printing in the
 * detail line above until somebody rules on it:
 *
 *   WOLF_AGGRO_RANGE is 6m. SPAWNS.wolf is 4.76m from Wren and two of the three patrol nodes are
 *   inside 6m of her ([2.5, 8] at 4.76m, [-5.5, 5] at 4.30m). So a child standing close enough to
 *   READ Wren -- inside KEEPER_WAVE_RADIUS_METERS, two metres -- is always inside the wolf's aggro
 *   radius, from the wolf's own spawn point, at every moment of the game.
 *
 *   A hero who goes down does not move: stepEncounter's respawn sets `hp = maxHp` and calls
 *   resetWolf(), and touches no position. He stands up after RESPAWN_SECONDS exactly where he fell,
 *   the wolf is put back at its spawn 4.76m away, and it is on him again immediately.
 *
 *   Measured, standing still at Wren's feet at 12x CPU throttle: the health bar ran to zero and back
 *   to full three times in
 *   about 25 seconds, hero position constant at 0.34m from her the whole time, drawn and
 *   authoritative agreeing to the centimetre. Not drift, and not this harness: an unescapable death
 *   loop at the feet of the character a child has to stand still in front of to hear.
 *
 * Every ordinary local run of this phase now reports "KNOCKED DOWN" in passing, because the child is
 * bitten during the arrival beat every single time. That is why the checks above are judged from the
 * recording rather than from a poll that has to survive twelve seconds of it.
 */
function startApproachRecorder(tab, key) {
  return tab.page.eval(startWatch(key, `(() => {
    const runtime = window.__galaQuestRuntime;
    const position = runtime.player.position;
    return {
      m: Number(Math.hypot(position.x - (${RANGER.at[0]}), position.z - (${RANGER.at[1]})).toFixed(2)),
      shown: document.querySelector('#keeper-speech')?.dataset.shown === 'true',
      name: document.querySelector('#keeper-speech-name')?.textContent?.trim() ?? null,
      // The whole bubble's text, exactly as the live probe read it, so the prose comparisons below
      // are the same comparisons they always were. Truncated because this is per frame.
      line: (document.querySelector('#keeper-speech')?.textContent ?? '')
        .replace(/\\s+/g, ' ').trim().slice(0, 90),
      hp: Number(document.querySelector('#health-current')?.textContent ?? NaN),
      snapped: runtime.netState().snapped === true,
    };
  })()`));
}

/** Read the recording back and stop it: every frame, plus one line saying which fault this was. */
async function approachStory(tab, key) {
  const watch = JSON.parse(await tab.page.eval(readWatchSource(key)));
  await tab.page.eval(stopWatchSource(key));
  const samples = watch?.samples ?? [];
  const summary = summarise(samples);
  return { frames: samples, summary };
}

/** The one-line verdict on a recording: how close, how long open, and what it cost in health. */
function summarise(samples) {
  const metres = samples.map((sample) => sample.m).filter((m) => Number.isFinite(m));
  // A recorder that caught nothing must SAY so rather than report a tidy zero: "closest 0.00m" off
  // an empty log is the most confident wrong answer this function could give (GQ-022).
  if (metres.length === 0) return 'the recorder caught no frames -- this detail is blind, fix it';
  const health = samples.map((sample) => sample.hp).filter((hp) => Number.isFinite(hp));
  const lowest = health.length > 0 ? Math.min(...health) : null;
  return [
    `${samples.length} frame(s) recorded`,
    `closest ${Math.min(...metres).toFixed(2)}m of ${KEEPER_WAVE_RADIUS_METERS}m`,
    `ended ${metres[metres.length - 1].toFixed(2)}m`,
    `bubble open on ${samples.filter((sample) => sample.shown).length}`,
    lowest === null ? 'health unread'
      : lowest < HERO_MAX_HP ? `KNOCKED DOWN, health fell to ${lowest}` : 'health held',
    `${samples.filter((sample) => sample.snapped).length} snap(s)`,
  ].join(' · ');
}

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

// HOW CLOSE THE HELD LEG MAY BE TRUSTED TO GET BEFORE THE PULSED ONE TAKES OVER. A held walk cannot
// stop on a mark: arrival latches in-page at frame resolution, but the release costs a poll and a
// round trip while authority keeps walking, and a stick at full deflection runs. Three metres is
// outside that overshoot and short enough for the pulsed leg to finish exactly.
const HELD_APPROACH_SLACK_METRES = 3;

// THE LONG LEGS ARE HELD, and on this harness that is about SAFETY as much as speed. Its routes are
// the longest in the suite -- the road east to the Lodge is minutes of walking through country with
// a wolf in it -- and a pulsed walk covers about a metre a second on a runner painting at 367ms a
// frame. Every extra second out there is another chance to be knocked down, which respawns the hero
// at spawn and starts the walk again. Hosted, that is what "and the banner names the place" was
// reading when it reported "You went down…". Holding the stick makes the crossing cost
// distance-over-speed instead of one pulse per round trip; the pulsed leg then places him exactly.
async function heldLegToward(tab, targetX, targetZ, stopWithin, maxMillis) {
  const origin = { x: tab.viewport.width * 0.18, y: tab.viewport.height * 0.86 };
  await tab.page.eval(startWalk(`({ x: ${targetX}, z: ${targetZ} })`, stopWithin));
  await touch(tab, 'touchStart', [{ x: origin.x, y: origin.y }]);
  await touch(tab, 'touchMove', [{ x: origin.x, y: origin.y - STICK_PX }]);
  let walk;
  try {
    walk = await pollUntilDeadline(() => tab.page.eval(READ_WALK).then(JSON.parse),
      (next) => next?.arrived, { intervalMs: 150, timeoutMs: maxMillis });
  } finally {
    await touch(tab, 'touchEnd', []);
    await tab.page.eval(STOP_WALK);
  }
  console.log(`    walk: ${walk.frames} frames held, ${metresOrUnknown(walk.startMetres)} to `
    + `${metresOrUnknown(walk.metres)}`);
}

async function walkToward(tab, targetX, targetZ, stopWithin, maxMillis) {
  const origin = { x: tab.viewport.width * 0.18, y: tab.viewport.height * 0.86 };
  let last = await state(tab);
  const startMetres = Math.hypot(targetX - last.heroPos[0], targetZ - last.heroPos[1]);
  if (startMetres > stopWithin + HELD_APPROACH_SLACK_METRES) {
    await heldLegToward(tab, targetX, targetZ, stopWithin + HELD_APPROACH_SLACK_METRES,
      Math.max(4000, maxMillis / 2));
    last = await state(tab);
  }
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
async function boot(label, { withSatchel, cpuThrottle = 1 }) {
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

  const tab = await openTab(768, 1024, { cpuThrottle });
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
    check(here.healthMaxDrawn === HERO_MAX_HP,
      'and the readout still prints the Level-1 body everybody starts with',
      `${here.healthCurrentDrawn} / ${here.healthMaxDrawn}`);
    await shot(tab, 'ranger-01-somebody-came');

    // WALK UP TO HER. Five metres, on the stick, the way a child arrives -- recorded from before
    // the first step, so a failure below can say which of the four faults it was.
    await startApproachRecorder(tab, 'wren-arrival');
    await walkToward(tab, RANGER.at[0], RANGER.at[1], 1.6, WALK_BUDGET_MS);
    // JUDGED FROM EVERY FRAME OF THE WALK-UP, not from a live sample taken after it.
    //
    // What these three checks ask is "walking up to her opens a bubble" -- an EVENT. Reading that
    // off a poll asks something else: "is the bubble open at the arbitrary moment the poll happens
    // to look", which on a runner painting three frames a second samples about one frame in two and
    // can miss the beat outright. waitForSample polls the RECORDING instead, so the wait is still
    // bounded but every frame since the first step is in scope. Strictly more sensitive than the
    // poll it replaces: there is no open it misses that the poll would have caught.
    await waitForSample(tab.page, 'wren-arrival',
      (sample) => sample.shown === true && /Wren/.test(sample.name ?? ''),
      { intervalMs: 200, timeoutMs: 12_000 });
    const { frames, summary } = await approachStory(tab, 'wren-arrival');
    const spoke = frames.filter((frame) => frame.shown === true && /Wren/.test(frame.name ?? ''));
    check(spoke.length > 0, 'walking up to her opens a bubble with her NAME on it', summary);
    // The line is compared against the EXPORTED prose, not against a copy of it typed here: a
    // harness that restates a line can only ever prove the harness and the game were edited on the
    // same day (GQ-007).
    const intro = RANGER_LINE_INTRO.slice(0, 40);
    check(spoke.some((frame) => frame.line.includes(intro)),
      'and she says the line for a stranger who has brought her nothing',
      JSON.stringify(spoke[0]?.line ?? ''));
    // GATED ON HAVING SEEN THE BUBBLE AT ALL, and that is half the point of the rewrite. As
    // `!line.includes(...)` alone this passed on an EMPTY line, so the hosted run that never got
    // Wren to speak still reported this as a PASS -- a green sitting directly under two reds about
    // the same bubble, reading as though at least that part had worked. A bubble nobody ever saw is
    // not evidence that she said the right thing; it is the absence of evidence.
    check(spoke.length > 0
      && !spoke.some((frame) => frame.line.includes(RANGER_LINE_SATCHEL_GIVEN.slice(0, 20))),
      'and NOT the line that thanks a child for a satchel they never found',
      spoke.length > 0 ? `${spoke.length} frame(s) of her line, none of them the thank-you`
        : 'VACUOUS: her bubble never opened, so this check knows nothing');
    await shot(tab, 'ranger-02-the-stranger-speaks');
    check(tab.consoleErrors.length === 0, 'no console errors', tab.consoleErrors.slice(0, 3).join(' | '));
  } finally {
    await tab.close().catch(() => {});
    try { process.kill(-server.pid); } catch { /* already gone */ }
  }
}

/** THE HANDOVER. A child carrying her brother's satchel walks up, and walks away with a fourth
 *  bigger body that is still there after a reload. */
async function phaseCharm() {
  console.log('\n── phase charm (she takes the satchel, and gives a bigger body) ──');
  const { tab, server, origin } = await boot('charm', { withSatchel: true });
  try {
    const start = await pollUntil(tab, (s) => s.ranger?.satchelCarried === true, 20000);
    check(start.ranger?.satchelCarried === true, 'this child is carrying the fallen ranger\'s satchel',
      `satchel ${start.ranger?.satchelCarried}`);
    check(start.healthMaxDrawn === HERO_MAX_HP,
      'and still has only the body they started the game with',
      `max ${start.healthMaxDrawn}`);

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
    //
    // Polled on the MAXIMUM AND THE CURRENT TOGETHER, because they do not land on the same frame:
    // the bar grows when the ceiling changes and fills when the heal arrives a beat later. Waiting on
    // the ceiling alone and then reading the fill off that one sample caught `4 pips drawn, 3 of 4
    // filled` on a hosted runner and reported it as the charm opening a wound. Same trap, new units.
    //
    // This does NOT soften the assertions below, and the difference matters: the budget is bounded,
    // so a charm that genuinely never heals still times out and still fails with the real numbers
    // printed. Waiting for a state to settle is not the same as waiting until a check passes.
    const charmedMaxHp = HERO_MAX_HP + WREN_CHARM_MAX_HP_BONUS;
    const hearted = await pollUntil(
      tab,
      (s) => s.healthMaxDrawn === charmedMaxHp && s.healthCurrentDrawn === charmedMaxHp,
      15000,
    );
    check(hearted.healthMaxDrawn === charmedMaxHp,
      'and the health bar GROWS -- the readout prints the bigger body',
      `max ${hearted.healthMaxDrawn}, was ${HERO_MAX_HP}`);
    check(hearted.healthCurrentDrawn === charmedMaxHp,
      'filled, not empty -- the charm gives health, it does not open a wound',
      `${hearted.healthCurrentDrawn} / ${hearted.healthMaxDrawn}, bar ${hearted.healthFillWidth}`);
    check(hearted.ranger?.maxHp === charmedMaxHp,
      'and the body the bar is drawing for really is bigger',
      `maxHp ${hearted.ranger?.maxHp}, hp ${hearted.ranger?.hp}`);
    const said = await pollUntil(tab, (s) => s.npcLine.includes(RANGER_LINE_SATCHEL_GIVEN.slice(0, 18)), 12000);
    check(said.npcLine.includes(RANGER_LINE_SATCHEL_GIVEN.slice(0, 18)),
      'and she tells the child where her brother got to', whyTheBubbleSaysThat(said));
    await shot(tab, 'ranger-03-the-bigger-body');

    // AND IT IS DURABLE. A bigger body that evaporates on reload is a body nobody has.
    await tab.page.send('Page.navigate', { url: gameUrlFor(origin) });
    // BOTH facts, not just the body. A reboot learns `beaconLit` from the first snapshot's siege
    // block and its body from the same snapshot's rewards block, and there is no rule saying the
    // two land on the same frame -- so a poll that stops at the body can read a village Wren has
    // not been redrawn into yet and report a bug that is really the harness being early.
    const back = await pollUntil(
      tab,
      (s) => s.ready && s.zone?.loaded >= s.zone?.requested
        && s.healthMaxDrawn === charmedMaxHp && s.ranger?.rangerHere === true,
      45000,
    );
    check(back.healthMaxDrawn === charmedMaxHp, 'and it is still there after a reload',
      `max ${back.healthMaxDrawn}`);
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
    // The banner is RECORDED across the whole walk, not read at the moment of arrival. It is a
    // transient -- it fires, then expires -- and this walk is minutes long through country with a
    // wolf in it, so the single frame the harness happens to read can hold whatever the game said
    // most recently. Hosted that was "You went down…": a real knockdown, correctly banner-ed, and
    // nothing whatever to do with whether the road east ends at a named place. "Did the game ever
    // name the Ranger Lodge on arrival" is the actual question, and only a log can answer it.
    await tab.page.eval(startWatch('lodge-banner',
      "({ banner: document.querySelector('#banner')?.textContent ?? '' })"));
    await walkToward(tab, LODGE.at[0], LODGE.at[1], 2.0, 240_000);
    const there = await pollUntil(tab, (s) => s.lodgeFound === true, 20000);
    const bannerLog = await tab.page.eval(readWatchSource('lodge-banner')).then(JSON.parse);
    await tab.page.eval(stopWatchSource('lodge-banner'));
    check(there.lodgeFound === true, 'the road east ends somewhere a child can arrive AT',
      `hero ${JSON.stringify(there.heroPos.map((n) => +n.toFixed(1)))}, lodge ${JSON.stringify(LODGE.at)}`);
    const named = bannerLog.samples.filter((sample) => /Ranger Lodge/i.test(sample.banner ?? ''));
    check(named.length > 0, 'and the banner names the place',
      named.length
        ? `named on ${named.length} of ${bannerLog.samples.length} recorded frames: `
          + JSON.stringify(named[0].banner.trim())
        : `never named across ${bannerLog.samples.length} frames; banners seen `
          + JSON.stringify([...new Set(bannerLog.samples.map((sample) => sample.banner.trim()))]
            .filter(Boolean).slice(0, 6)));
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

/**
 * SEAM 5 OF THE WREN SANCTUARY RULING: stand at her feet long enough to have the conversation, in a
 * real browser, and prove the child keeps every hit point.
 *
 * The four unit seams in test/wren-sanctuary.test.mjs argue about the rules. This one argues about
 * the GAME: the whole chain -- authoritative server deriving `targetable` from position and Beacon
 * state, the rules honouring it, the bar on screen -- under the frame rate a child's tablet and a
 * hosted runner actually produce.
 *
 * DELIBERATELY THROTTLED, because the unthrottled local run does not reproduce the defect: the
 * arrival phase above passes locally with health held most of the time purely because it finishes
 * before the wolf arrives. Twelve times slower puts a local run in the 1-3 fps band where the
 * mauling was first measured, and it stacks with whatever the hosted runner is already doing. The
 * achieved rate is printed rather than assumed.
 *
 * BOUNDED IN FRAMES, NOT MILLISECONDS (GQ-021). "Twelve seconds" on a runner painting once a second
 * is twelve frames, which is not a conversation; the wait below runs until the recorder has seen
 * enough rendered frames, with a wall-clock ceiling only as a liveness backstop.
 */
async function phaseSanctuary() {
  console.log('\n── phase sanctuary (a child may stand and listen without being eaten) ──');
  const { tab, server } = await boot('sanctuary', { withSatchel: false, cpuThrottle: SANCTUARY_THROTTLE });
  try {
    await pollUntil(tab, (state) => state.ranger?.rangerHere === true, 25000);
    await startApproachRecorder(tab, 'wren-sanctuary');
    await walkToward(tab, RANGER.at[0], RANGER.at[1], 1.6, WALK_BUDGET_MS);

    // Stand there. No input at all -- this is a child listening, which is exactly the posture the
    // defect punished.
    const startedAt = Date.now();
    const ceiling = deadlineAfter(Math.min(Math.max(msLeft() - 60_000, 30_000), 180_000));
    let watch = null;
    while (Date.now() < ceiling) {
      watch = JSON.parse(await tab.page.eval(readWatchSource('wren-sanctuary')));
      if ((watch?.samples?.length ?? 0) >= CONVERSATION_FRAMES) break;
      await sleep(500);
    }
    const { frames, summary } = await approachStory(tab, 'wren-sanctuary');
    const seconds = (Date.now() - startedAt) / 1000;
    const inside = frames.filter((frame) => frame.m <= KEEPER_WAVE_RADIUS_METERS);
    console.log(`    stood ${seconds.toFixed(1)}s for ${frames.length} frame(s) `
      + `(~${(frames.length / Math.max(seconds, 0.001)).toFixed(1)} fps at ${SANCTUARY_THROTTLE}x throttle), `
      + `${inside.length} of them inside her speech radius`);
    console.log(`    ${summary}`);

    // THE FIXTURE HAS TO HAVE BEEN AT RISK. Every assertion below is "the child was not hurt", and
    // a child who never got near Wren is trivially unhurt -- the same vacuous shape the third
    // arrival check used to have. So require that they actually stood in the conversation.
    check(inside.length >= CONVERSATION_FRAMES / 2,
      'the child really did stand in front of Wren for the conversation',
      `${inside.length} frame(s) inside ${KEEPER_WAVE_RADIUS_METERS}m of ${frames.length} recorded`);

    const health = frames.map((frame) => frame.hp).filter((hp) => Number.isFinite(hp));
    const lowest = health.length > 0 ? Math.min(...health) : null;
    check(lowest === HERO_MAX_HP,
      'and kept every hit point while she talked -- the sanctuary holds in a real browser',
      lowest === null ? 'health unread, which is a broken instrument not a pass'
        : `lowest ${lowest} of ${HERO_MAX_HP} over ${health.length} frame(s)`);

    check(frames.some((frame) => frame.shown === true),
      'and her bubble was actually open, so there was a conversation to protect',
      `open on ${frames.filter((frame) => frame.shown).length} of ${frames.length} frame(s)`);

    await shot(tab, 'ranger-04-listening-in-safety');
    check(tab.consoleErrors.length === 0, 'no console errors', tab.consoleErrors.slice(0, 3).join(' | '));
  } finally {
    await tab.close().catch(() => {});
    try { process.kill(-server.pid); } catch { /* already gone */ }
  }
}

const PHASES = { arrival: phaseArrival, charm: phaseCharm, lodge: phaseLodge, sanctuary: phaseSanctuary };

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
