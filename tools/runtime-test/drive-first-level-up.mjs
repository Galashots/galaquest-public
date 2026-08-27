/**
 * THE FIRST HERO LEVEL, IN A REAL BROWSER, ON THE REAL PATH.
 *
 *   node tools/runtime-test/drive-first-level-up.mjs [--landscape] [--reduced-motion]
 *
 * P2's whole claim is a sentence a child experiences: earn a bounded authored reward -> the XP meter
 * completes -> LEVEL UP -> max HP and real damage rise -> POWER jumps -> both fights use the stronger
 * hero. Every clause of that is provable in unit tests except the two that matter most -- that it
 * HAPPENS in the running game, and that it LOOKS like something. This harness proves the first and
 * takes the captures a human has to open to accept the second.
 *
 * ── WHY IT SEEDS TWO MARKS AND FIGHTS THE THIRD ────────────────────────────────────────────────
 *
 * The brief is explicit: "use the real P2 progression path or a legitimate deterministic fixture
 * immediately before the Lantern unlock, not a fake DOM-only level toggle." So the fixture stops one
 * kill short and the run earns the last one by walking up to a wolf and tapping ATTACK, which means
 * the award, the fold, the wire, the level, both fights and every pixel of the payoff are the real
 * ones. Nothing here writes a level, an XP total or a HUD attribute.
 *
 * Two marks rather than none because drive-marks.mjs already proves a mark is earned by a kill, and
 * re-proving it twice more here would triple the run to say nothing new.
 *
 * ── THE IDENTITY DISCIPLINE, WHICH IS NOT OPTIONAL ────────────────────────────────────────────
 *
 * docs/MISTAKES.md GQ-008 and GQ-016 between them cost this repository four separate misdiagnoses,
 * every one of which reported a downstream subsystem rather than the identity underneath it. So:
 * localStorage is cleared BEFORE the first navigation; the guest id is minted through the client's
 * OWN sanitizeGuestId rather than merely hoped to satisfy it; the store is seeded BEFORE the first
 * boot, because booting mints a profile; and the run CONFIRMS, from the running game's own accessor,
 * both which guest it is playing as and that the seeded state arrived with it, before it trusts a
 * single assertion.
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * Cribbed from drive-marks.mjs (its CDP harness, its walk and its measured tap cadence) and from
 * drive-old-beacon.mjs (its seeded-guest pinning). Its own server on its own port and its own store,
 * for the reason owned-server.mjs gives: a shared server hands a harness a wolf some other run
 * already decided about.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ATTACK_REACH, HERO_MAX_HP, WOLF_MAX_HP } from '../../public/src/combat/encounter.js';
import { MARKS_TO_UNLOCK } from '../../public/src/rewards/marks.js';
import { LANTERN_UNLOCK_XP } from '../../public/src/progression/facts.js';
import { cumulativeXpForLevel } from '../../public/src/progression/levels.js';
import {
  LEVEL_1_STARTER_STATS, resolvedHeroDamage, resolvedMaxHp,
} from '../../public/src/progression/heroStats.js';
import { formatPower, powerFor } from '../../public/src/progression/power.js';
import { STARTER_SWORD_ID } from '../../public/src/progression/items.js';
import { sanitizeGuestId } from '../../public/src/net/guestId.js';
import { openRewardStore } from '../../net/rewardStore.mjs';
import { deadlineAfter, movementPulseMillis, pollUntilDeadline } from './automation-timing.mjs';
import { startOwnedServer, gameUrlFor } from './owned-server.mjs';
import {
  authoredWolfSource, READ_WALK, startWalk, startWatch, STOP_WALK, readWatchSource, stopWatchSource,
} from './in-page-driver.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
const LANDSCAPE = process.argv.includes('--landscape');
const REDUCED_MOTION = process.argv.includes('--reduced-motion');
const ORIENTATION = `${LANDSCAPE ? 'landscape' : 'portrait'}${REDUCED_MOTION ? '-reduced-motion' : ''}`;
const VIEWPORT = LANDSCAPE
  ? { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true }
  : { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
// The pre-existing, disclosed gear-track gap: the belt lantern ships on its own track and main.js's
// graceful fallback is required to keep the game playable without it.
const COSMETIC_404_PATTERNS = ['/assets/gear/lantern_belt.glb', '/favicon.ico'];

// ── THE NUMBERS THIS RUN EXPECTS, DERIVED RATHER THAN TYPED ────────────────────────────────────
//
// Every expectation below comes from the same authorities the game itself reads (GQ-007, and GQ-018
// on why a probe written in units the constant under test can move is not a probe). A hand-typed
// "35" here would go on passing after a re-tune while the game showed something else.
const BEFORE = {
  level: 1,
  maxHp: LEVEL_1_STARTER_STATS.maxHp,
  damage: LEVEL_1_STARTER_STATS.heroDamage,
  power: powerFor(LEVEL_1_STARTER_STATS),
  xpForLevel: cumulativeXpForLevel(2) - cumulativeXpForLevel(1),
};
const AFTER = {
  level: 2,
  maxHp: resolvedMaxHp(2),
  damage: resolvedHeroDamage(2, STARTER_SWORD_ID),
  power: powerFor({ maxHp: resolvedMaxHp(2), heroDamage: resolvedHeroDamage(2, STARTER_SWORD_ID) }),
};

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/** A brand-new store for this run, never the real data/rewards.db -- a fresh server otherwise
 *  inherits whatever durable history its store already holds, and this run's whole claim is about a
 *  child who is one kill short of their first level. */
function freshStorePath() {
  return join(mkdtempSync(join(tmpdir(), `gq-first-level-up-${ORIENTATION}-`)), 'rewards.db');
}

/**
 * A guest standing exactly one kill short of the Lantern: MARKS_TO_UNLOCK - 1 marks, no unlock, no
 * XP. The legitimate state immediately before the award, and nothing beyond it.
 */
function seedAlmostThere(storePath) {
  const guestId = `p2-level-${randomUUID()}`;
  // MINTED THROUGH THE CLIENT'S OWN RULE (GQ-008 hit 3): guestId.js caps an id at 64 characters and
  // SILENTLY returns null past that, at which point the page mints a fresh UUID and plays as somebody
  // else -- with the failure reported by whichever subsystem the seed was gating.
  if (sanitizeGuestId(guestId) !== guestId) {
    throw new Error(`'${guestId}' (${guestId.length} chars) is not an id the client will keep`);
  }
  const store = openRewardStore(storePath);
  for (let mark = 1; mark < MARKS_TO_UNLOCK; mark += 1) {
    store.apply({ guestId, type: 'mark-earned', eventId: `p2-fixture:mark:${guestId}:${mark}` });
  }
  const marks = store.marksFor(guestId);
  const unlocked = store.unlockedFor(guestId);
  const xp = store.xpFor(guestId);
  store.close();
  if (marks !== MARKS_TO_UNLOCK - 1 || unlocked || xp !== 0) {
    throw new Error(`seeding ${guestId} did not take: marks ${marks}, unlocked ${unlocked}, xp ${xp}`);
  }
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
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      }
    });
  }

  ready() {
    return this.ws.readyState === 1
      ? Promise.resolve()
      : new Promise((r) => this.ws.addEventListener('open', r));
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`eval threw: ${r.exceptionDetails.text}`);
    return r.result.value;
  }
}

const storePath = freshStorePath();
const guestId = seedAlmostThere(storePath);
const server = await startOwnedServer({ rewardStorePath: storePath });
const ORIGIN = server.origin;
const GAME_URL = gameUrlFor(ORIGIN);
console.log(`  server ${ORIGIN}, store ${storePath}`);
console.log(`  seeded ${guestId} with ${MARKS_TO_UNLOCK - 1} of ${MARKS_TO_UNLOCK} marks, no XP`);

const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
const browser = new CDP(version.webSocketDebuggerUrl);
await browser.ready();

// Close any stale tab already sitting on this origin: an abandoned tab from a previous crash would
// count as a second client and change the fight.
const existing = await browser.send('Target.getTargets');
for (const target of existing.targetInfos) {
  if (target.type === 'page' && target.url.startsWith(ORIGIN)) {
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

const consoleErrors = [];
page.ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    const entry = msg.params.entry;
    const text = entry.url ? `${entry.text} [${entry.url}]` : entry.text;
    if (!COSMETIC_404_PATTERNS.some((pattern) => text.includes(pattern))) consoleErrors.push(text);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.text);
  }
});

await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
if (REDUCED_MOTION) {
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
}

const touch = (type, points) => page.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});

async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}first-level-up-${ORIENTATION}-${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  captured ${file}`);
  return file;
}

/**
 * WHAT THE GAME IS, AND WHAT THE SCREEN SAYS -- read together, every time.
 *
 * The two halves are deliberately separate fields rather than one blended answer, because the only
 * defect this run really exists to catch is them DISAGREEING: a level that reached the fight but not
 * the HUD, or a HUD that prints a level the fight never got (docs/MISTAKES.md GQ-013). Reading the
 * model twice would never see it.
 */
const STATE_EXPR = `(() => {
  const runtime = window.__galaQuestRuntime;
  const encounter = runtime.encounterState();
  const authoredWolf = ${authoredWolfSource('runtime')};
  const net = runtime.netState();
  const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
  return JSON.stringify({
    ready: Boolean(runtime.hero),
    guestId: runtime.guestId(),
    netStatus: net.status,
    rewards: runtime.rewards(),
    progress: runtime.heroProgressState(),
    hero: { ...encounter.hero },
    enemy: { ...authoredWolf },
    heading: runtime.follow.heading,
    heroPos: [+runtime.player.position.x.toFixed(2), +runtime.player.position.z.toFixed(2)],
    serverPos: net.serverSelf ? [+net.serverSelf.x.toFixed(2), +net.serverSelf.z.toFixed(2)] : null,
    pipsFilled: [...document.querySelectorAll('#lantern-marks .mark')]
      .filter((el) => el.dataset.filled === 'true').length,
    // THE READOUT, as a child sees it -- text nodes, not the numbers behind them.
    drawn: {
      healthCurrent: text('#health-current'),
      healthMax: text('#health-max'),
      healthFill: document.querySelector('#hero-health .health-fill')?.style.width ?? null,
      level: text('#hero-level'),
      xp: text('#hero-xp-text'),
      xpFill: document.querySelector('#hero-xp .xp-fill')?.style.width ?? null,
      power: text('#hero-power-value'),
    },
    banner: document.querySelector('#banner')?.dataset.shown === 'true'
      ? text('#banner') : '',
  });
})()`;

const state = () => page.eval(STATE_EXPR).then(JSON.parse);
const pollUntil = (predicate, timeoutMs = 15000) =>
  pollUntilDeadline(state, predicate, { intervalMs: 120, timeoutMs });

async function waitForRuntime() {
  const deadline = deadlineAfter(60000);
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const ready = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)')
      .catch(() => false);
    if (ready) return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
  }
  throw new Error(`runtime never came up on ${GAME_URL}`);
}

/**
 * Clear, establish the origin, pin the seeded guest, navigate, and CONFIRM -- in that order.
 *
 * GQ-016: booting mints a profile, and progression/profiles.js only folds a legacy guest id into one
 * while the device holds no profiles yet. A guest id written after the first boot is a dead string
 * beside a profile the boot already created, and the seeded rows stay on the server under a name
 * nothing on the device points at.
 */
async function navigateFresh() {
  await page.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'local_storage' });
  await page.send('Page.navigate', { url: `${ORIGIN}/favicon.ico` });

  // POLLED AND READ BACK, not written after a fixed sleep: an about:blank tab cannot hold
  // localStorage for the real origin, and losing that race means the run plays the whole game as
  // somebody with no marks while every failure names a different subsystem.
  const pinDeadline = deadlineAfter(15000);
  let pinned = null;
  while (Date.now() < pinDeadline && pinned !== guestId) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(150);
    // eslint-disable-next-line no-await-in-loop
    pinned = await page.eval(`(() => {
      try {
        localStorage.setItem('gq-guest-id', ${JSON.stringify(guestId)});
        return localStorage.getItem('gq-guest-id');
      } catch (err) { return null; }
    })()`).catch(() => null);
  }
  if (pinned !== guestId) throw new Error(`could not pin gq-guest-id on ${ORIGIN} (got ${pinned})`);

  await page.send('Page.navigate', { url: GAME_URL });
  await waitForRuntime();
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────

let exitCode = 0;
try {
  await navigateFresh();

  // TWO INDEPENDENT CONFIRMATIONS before a single assertion is trusted, per GQ-008 hit 3: which
  // guest the page is playing as, and that the state seeded for that guest actually arrived with it.
  const live = await page.eval('window.__galaQuestRuntime.guestId()');
  if (live !== guestId) throw new Error(`the page is playing as ${live}, not the seeded ${guestId}`);
  const arrived = await pollUntil((s) => s.netStatus === 'online'
    && (s.rewards?.[Object.keys(s.rewards)[0]]?.marks ?? 0) === MARKS_TO_UNLOCK - 1, 25000);
  const arrivedRewards = arrived.rewards?.[Object.keys(arrived.rewards)[0]] ?? {};
  if (arrivedRewards.marks !== MARKS_TO_UNLOCK - 1) {
    throw new Error(`the seeded guest arrived with marks ${arrivedRewards.marks} -- the whole run is `
      + 'about the kill that takes them from there to the Lantern');
  }

  // ── BEFORE ────────────────────────────────────────────────────────────────────────────────────
  const before = await pollUntil((s) => s.ready && s.progress.level === BEFORE.level, 20000);
  check('BEFORE: the child is Level 1',
    before.progress.level === BEFORE.level, `level ${before.progress.level}`);
  check('BEFORE: no XP earned yet, and a full level to earn',
    before.progress.totalXp === 0 && before.progress.xpIntoLevel === 0
      && before.progress.xpForLevel === BEFORE.xpForLevel,
    `${before.progress.xpIntoLevel} / ${before.progress.xpForLevel} XP`);
  check(`BEFORE: ${BEFORE.maxHp} max HP, and the bar is drawing it`,
    before.progress.maxHp === BEFORE.maxHp && before.hero.maxHp === BEFORE.maxHp
      && before.drawn.healthMax === String(BEFORE.maxHp),
    `stat ${before.progress.maxHp}, fight ${before.hero.maxHp}, drawn ${before.drawn.healthCurrent}/${before.drawn.healthMax}`);
  check(`BEFORE: Starter Sword resolves to ${BEFORE.damage} damage`,
    before.progress.heroDamage === BEFORE.damage, `damage ${before.progress.heroDamage}`);
  check(`BEFORE: POWER ${formatPower(BEFORE.power)}, ON THE ORDINARY HUD`,
    powerFor(before.progress) === BEFORE.power && before.drawn.power === formatPower(BEFORE.power),
    `derived ${formatPower(powerFor(before.progress))}, drawn ${before.drawn.power}`);
  check(`BEFORE: the HUD says LV ${BEFORE.level} and draws an empty meter`,
    before.drawn.level === String(BEFORE.level)
      && before.drawn.xp === `0 / ${BEFORE.xpForLevel}`
      && before.drawn.xpFill === '0%',
    `LV ${before.drawn.level}, ${before.drawn.xp}, fill ${before.drawn.xpFill}`);
  check('BEFORE: the Lantern is not unlocked and the pips are one short',
    arrivedRewards.lanternUnlocked !== true && before.pipsFilled === MARKS_TO_UNLOCK - 1,
    `unlocked ${arrivedRewards.lanternUnlocked}, pips ${before.pipsFilled}`);
  check('BEFORE: no level-up has fired this session -- hydration is not a ceremony',
    before.progress.levelUpsThisSession === 0, `${before.progress.levelUpsThisSession} fired`);
  await shot('01-before-level-1');

  // ── RECORD THE TRANSITION FROM INSIDE THE PAGE ────────────────────────────────────────────────
  //
  // The beat is short and every CDP round trip costs a rendered frame, so polling from outside gets
  // three or four looks at it and a read taken afterwards finds it already gone -- the exact failure
  // drive-marks.mjs's own ceremony recorder was written for. A rAF recorder sees every frame and
  // costs nothing.
  await page.eval(startWatch('levelup', `(() => {
    const runtime = window.__galaQuestRuntime;
    const progress = runtime.heroProgressState();
    const banner = document.querySelector('#banner');
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
    return {
      level: progress.level,
      xpIntoLevel: progress.xpIntoLevel,
      xpForLevel: progress.xpForLevel,
      maxHp: progress.maxHp,
      heroDamage: progress.heroDamage,
      levelUps: progress.levelUpsThisSession,
      heroHp: runtime.encounterState().hero.hp,
      heroMaxHp: runtime.encounterState().hero.maxHp,
      wolfHp: ${authoredWolfSource()}.hp,
      wolfMode: ${authoredWolfSource()}.mode,
      swinging: runtime.encounterState().hero.swingSeconds >= 0,
      gap: (() => {
        const net = runtime.netState();
        const at = net.serverSelf ? [net.serverSelf.x, net.serverSelf.z]
          : [runtime.player.position.x, runtime.player.position.z];
        const w = ${authoredWolfSource()};
        return +Math.hypot(at[0] - w.x, at[1] - w.z).toFixed(2);
      })(),
      marks: (() => {
        const own = runtime.rewards();
        const first = own && Object.values(own)[0];
        return first ? first.marks : null;
      })(),
      banner: banner && banner.dataset.shown === 'true' ? banner.textContent : '',
      celebrating: document.querySelector('#level-up')?.dataset.shown === 'true',
      drawnLevel: text('#hero-level'),
      drawnPower: text('#hero-power-value'),
      drawnXp: text('#hero-xp-text'),
      drawnHealth: text('#health-current') + '/' + text('#health-max'),
    };
  })()`, { maxSamples: 6000 }));

  // ── THE FIGHT ─────────────────────────────────────────────────────────────────────────────────
  const attackX = VIEWPORT.width - 68;
  const attackY = VIEWPORT.height - 68;
  const stickX = VIEWPORT.width * 0.18;
  const stickY = VIEWPORT.height * 0.86;
  const STICK_PX = 56;
  const WOLF_TARGET = authoredWolfSource();

  /** Pulsed, camera-relative steering -- exact rather than fast, which is what matters for getting
   *  into ATTACK_REACH and, more importantly, for turning: the hero only turns while moving. */
  async function walkToward(aim, stopWithin, maxMillis) {
    let last = await state();
    const deadline = deadlineAfter(maxMillis);
    while (Date.now() < deadline) {
      const target = aim(last);
      const authority = last.serverPos ?? last.heroPos;
      const dx = target.x - authority[0];
      const dz = target.z - authority[1];
      const distance = Math.hypot(dx, dz);
      if (distance <= stopWithin || distance === 0) break;
      const nx = dx / distance;
      const nz = dz / distance;
      const cos = Math.cos(last.heading);
      const sin = Math.sin(last.heading);
      const sx = -cos * nx + sin * nz;
      const sy = sin * nx + cos * nz;
      // eslint-disable-next-line no-await-in-loop
      await touch('touchStart', [{ x: stickX, y: stickY }]);
      try {
        // eslint-disable-next-line no-await-in-loop
        await touch('touchMove', [{ x: stickX + sx * STICK_PX, y: stickY - sy * STICK_PX }]);
        // eslint-disable-next-line no-await-in-loop
        await sleep(movementPulseMillis(Math.max(0, distance - stopWithin)));
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await touch('touchEnd', []);
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(80);
      // eslint-disable-next-line no-await-in-loop
      last = await state();
    }
    return last;
  }

  /** A held walk with in-page re-aiming, for the one case with real ground in it: coming back from a
   *  knockdown, which respawns the hero at spawn metres away. */
  async function heldWalkToward(stopWithin, maxMillis) {
    await page.eval(startWalk(WOLF_TARGET, stopWithin));
    await touch('touchStart', [{ x: stickX, y: stickY }]);
    await touch('touchMove', [{ x: stickX, y: stickY - STICK_PX }]);
    try {
      return await pollUntilDeadline(() => page.eval(READ_WALK).then(JSON.parse),
        (next) => next?.arrived, { intervalMs: 100, timeoutMs: maxMillis });
    } finally {
      await touch('touchEnd', []);
      await page.eval(STOP_WALK);
    }
  }

  await walkToward((live2) => ({ x: live2.enemy.x, z: live2.enemy.z }), 1.2, 20000);

  // Measure this machine's own frame period rather than assuming one, then tap once per rendered
  // frame: main.js samples input once a frame, so tapping faster cannot help and slower wastes
  // eligibility. A refused tap costs nothing -- the rules simply ignore it.
  await page.eval(startWatch('pace', '({ t: 1 })'));
  await sleep(1000);
  const paced = JSON.parse(await page.eval(readWatchSource('pace')));
  await page.eval(stopWatchSource('pace'));
  const tapEveryMs = paced.frames > 0 ? Math.round(1000 / paced.frames) : 17;
  console.log(`  fight cadence: ~${tapEveryMs}ms a frame`);

  const readLevelUp = () => page.eval(readWatchSource('levelup')).then(JSON.parse);
  // RE-CLOSE ON A MARGIN, NOT ON THE EDGE OF REACH, AND CHECK OFTEN.
  //
  // First measured run of this file: 19 knockdowns, wolf never below full, level never reached. The
  // diagnostic line is what named it -- swings were going out from gaps of up to 2.34m against an
  // ATTACK_REACH of 1.7. Re-closing only when the gap EXCEEDS reach means every swing thrown while
  // drifting outward misses, and a solo hero who wipes heals the wolf to full (Design ruling 5), so
  // three missed swings is not a slow fight, it is a fight that cannot be won.
  //
  // Closing to a margin inside reach instead, and asking every other tap rather than every fourth,
  // costs a few round trips and buys the three landed hits that have to fit inside one hero life.
  const RECLOSE_WITHIN_METRES = ATTACK_REACH - 0.3;
  const REACH_CHECK_EVERY = 2;
  let levelled = false;
  const killDeadline = Date.now() + 240000;
  for (let tap = 0; tap < 900 && !levelled && Date.now() < killDeadline; tap += 1) {
    const cycleStart = Date.now();
    // eslint-disable-next-line no-await-in-loop
    await touch('touchStart', [{ x: attackX, y: attackY }]);
    // eslint-disable-next-line no-await-in-loop
    await sleep(60);
    // eslint-disable-next-line no-await-in-loop
    await touch('touchEnd', []);
    // eslint-disable-next-line no-await-in-loop
    await sleep(Math.max(0, tapEveryMs - (Date.now() - cycleStart)));
    if (tap % REACH_CHECK_EVERY !== 0) continue;
    // eslint-disable-next-line no-await-in-loop
    const log = await readLevelUp();
    levelled = log.samples.some((sample) => sample.level >= AFTER.level);
    if (levelled) break;
    // eslint-disable-next-line no-await-in-loop
    const now = await state();
    const at = now.serverPos ?? now.heroPos;
    const gap = Math.hypot(at[0] - now.enemy.x, at[1] - now.enemy.z);
    // A knockdown respawns the hero at spawn, metres away: that is the one case with real ground in
    // it, and the held walk crosses it at distance-over-speed instead of one pulse per round trip.
    // Everything else is a nudge, which is mostly about TURNING -- the hero only turns while moving,
    // so a swing thrown without re-closing is thrown at where the wolf was.
    if (now.hero.downSeconds >= 0 || gap > ATTACK_REACH + 2) {
      // eslint-disable-next-line no-await-in-loop
      await heldWalkToward(1.0, 20000);
    } else if (gap > RECLOSE_WITHIN_METRES) {
      // eslint-disable-next-line no-await-in-loop
      await walkToward((live2) => ({ x: live2.enemy.x, z: live2.enemy.z }), 1.0, 4000);
    }
  }

  // ── TRANSITION ────────────────────────────────────────────────────────────────────────────────
  //
  // Captured off the recorder's own live count rather than after a sleep, so the frame cannot claim
  // to show a beat that had already ended.
  // pollUntilDeadline resolves with its LAST reading when the budget runs out rather than rejecting,
  // so the result is not evidence on its own -- the first draft of this file reported "celebrating
  // sample seen: yes" on a run where no ceremony fired at all, which is a check that cannot go red
  // (docs/MISTAKES.md, GQ-017's vacuous-assertion corollary). The predicate is therefore re-asked of
  // the returned log rather than inferred from the fact that it returned.
  const waited = await pollUntilDeadline(readLevelUp,
    (log) => log.samples.some((sample) => sample.levelUps > 0), { intervalMs: 60, timeoutMs: 8000 })
    .catch(() => null);
  const celebrating = (waited?.samples ?? []).some((sample) => sample.levelUps > 0);
  const transitionShot = await shot('02-transition-level-up');

  const record = await readLevelUp();
  await page.eval(stopWatchSource('levelup'));
  const samples = record.samples ?? [];
  const knockdowns = samples.filter((sample, index) =>
    sample.heroHp === 0 && samples[index - 1]?.heroHp !== 0).length;
  console.log(`  fight: ${record.frames} frames recorded, ${knockdowns} knockdown(s)`);
  const wolfLow = Math.min(...samples.map((s) => s.wolfHp ?? Infinity));
  const gaps = samples.filter((s) => s.swinging).map((s) => s.gap);
  console.log(`  DIAG wolf reached ${wolfLow}hp of ${WOLF_MAX_HP}; marks `
    + `${[...new Set(samples.map((s) => s.marks))].join(' -> ')}; `
    + `swings recorded at gaps ${JSON.stringify([...new Set(gaps)].slice(0, 12))}; `
    + `swinging frames ${samples.filter((s) => s.swinging).length}`);

  check('the level-up actually happened in the running game',
    levelled && samples.some((sample) => sample.level === AFTER.level),
    `levels seen: ${[...new Set(samples.map((s) => s.level))].join(' -> ')}`);
  check('the level-up beat fired EXACTLY ONCE',
    Math.max(0, ...samples.map((sample) => sample.levelUps)) === 1,
    `levelUps reached ${Math.max(0, ...samples.map((sample) => sample.levelUps))}`);
  // THE METER HAS TO BE SEEN FULL. The Lantern awards exactly one level's worth, so the honest
  // reading goes 0/100 -> 0/150 and the meter is never full at any moment -- which is the
  // "teleporting to an unrelated number" the brief forbids by name. The rollover holds the row at the
  // level just finished, meter at 100%, for a beat. This asks the DRAWN readout, not the model,
  // because the model never passes through that state at all: it only exists on screen.
  const drawnFull = samples.filter((sample) => sample.drawnXp === `${LANTERN_UNLOCK_XP} / ${LANTERN_UNLOCK_XP}`);
  check('the XP meter visibly COMPLETED rather than teleporting',
    drawnFull.length > 0,
    `the drawn meter read ${JSON.stringify([...new Set(samples.map((s) => s.drawnXp))].slice(-5))}`);
  check('...and then rolled over into the new level rather than staying full',
    drawnFull.length > 0 && samples.some((sample, index) =>
      index > samples.indexOf(drawnFull[0]) && /^0 \//.test(sample.drawnXp ?? '')),
    `held full for ${drawnFull.length} frame(s), then ${samples[samples.length - 1]?.drawnXp}`);

  // THE CEREMONY, and deliberately NOT read off a banner. It was a banner for one run of this file
  // and the capture from that run is why it is not one now: three other beats fire on the same frame
  // and each replaced the last, so the child's first level arrived as "LANTERN MARK 3 / 3". The
  // treatment has its own element, its own space and its own clock, and this asks about that.
  const celebratingFrames = samples.filter((sample) => sample.celebrating).length;
  check('a LEVEL UP treatment appeared on screen, in its own right',
    celebratingFrames > 0,
    `#level-up was shown on ${celebratingFrames} of ${samples.length} recorded frames`);
  check('...and it was not silently replaced by another beat competing for the same slot',
    celebratingFrames >= 3,
    `only ${celebratingFrames} frame(s) -- a beat that flashes for one frame is a beat nobody saw`);

  // ── AFTER ─────────────────────────────────────────────────────────────────────────────────────
  const after = await pollUntil((s) => s.progress.level === AFTER.level
    && s.hero.maxHp === AFTER.maxHp, 20000);
  check(`AFTER: Level ${AFTER.level}`, after.progress.level === AFTER.level,
    `level ${after.progress.level}, ${after.progress.totalXp} total XP`);
  check(`AFTER: ${AFTER.maxHp} max HP -- +${AFTER.maxHp - BEFORE.maxHp}`,
    after.progress.maxHp === AFTER.maxHp, `stat ${after.progress.maxHp}`);
  check('AFTER: and the FIGHT is using that body, not just the stat',
    after.hero.maxHp === AFTER.maxHp,
    `the encounter's own hero reads maxHp ${after.hero.maxHp}`);
  check('AFTER: and the health bar is DRAWING it',
    after.drawn.healthMax === String(AFTER.maxHp),
    `drawn ${after.drawn.healthCurrent}/${after.drawn.healthMax}`);
  check(`AFTER: resolved Starter damage ${AFTER.damage} -- +${AFTER.damage - BEFORE.damage}`,
    after.progress.heroDamage === AFTER.damage, `damage ${after.progress.heroDamage}`);
  check(`AFTER: POWER ${formatPower(AFTER.power)} -- +${AFTER.power - BEFORE.power} from ${formatPower(BEFORE.power)}, ON THE HUD`,
    powerFor(after.progress) === AFTER.power && after.drawn.power === formatPower(AFTER.power),
    `derived ${formatPower(powerFor(after.progress))}, drawn ${after.drawn.power}`);
  check(`AFTER: the HUD says LV ${AFTER.level} with a fresh meter`,
    after.drawn.level === String(AFTER.level) && /^0 \/ \d+$/.test(after.drawn.xp ?? ''),
    `LV ${after.drawn.level}, ${after.drawn.xp}`);
  check(`AFTER: exactly ${LANTERN_UNLOCK_XP} XP, from one Lantern and nothing else`,
    after.progress.totalXp === LANTERN_UNLOCK_XP, `${after.progress.totalXp} XP`);
  await shot('03-after-level-2');

  // ── AND IT IS REAL IN THE FIGHT ───────────────────────────────────────────────────────────────
  //
  // GQ-013: a reward the rules never read is a lie with a ceremony attached. The numbers above are
  // what the game says the hero IS; this is the wolf actually taking the bigger blow.
  const wolfBefore = await pollUntil((s) => s.enemy.hp === WOLF_MAX_HP, 25000).catch(() => null);
  if (wolfBefore) {
    await walkToward((live2) => ({ x: live2.enemy.x, z: live2.enemy.z }), 1.2, 20000);
    await page.eval(startWatch('blow', `({ hp: ${authoredWolfSource()}.hp })`));
    for (let tap = 0; tap < 40; tap += 1) {
      // eslint-disable-next-line no-await-in-loop
      await touch('touchStart', [{ x: attackX, y: attackY }]);
      // eslint-disable-next-line no-await-in-loop
      await sleep(60);
      // eslint-disable-next-line no-await-in-loop
      await touch('touchEnd', []);
      // eslint-disable-next-line no-await-in-loop
      const log = JSON.parse(await page.eval(readWatchSource('blow')));
      if (log.samples.some((sample) => sample.hp < WOLF_MAX_HP)) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(tapEveryMs);
    }
    const blows = JSON.parse(await page.eval(readWatchSource('blow')));
    await page.eval(stopWatchSource('blow'));
    const drops = blows.samples
      .map((sample, index) => (index > 0 ? blows.samples[index - 1].hp - sample.hp : 0))
      .filter((drop) => drop > 0);
    check(`a Level-${AFTER.level} blow takes ${AFTER.damage} off the wolf, not ${BEFORE.damage}`,
      drops.length > 0 && drops[0] === AFTER.damage,
      `landed blows took ${JSON.stringify(drops)} (a Level-1 blow would be ${BEFORE.damage})`);
  } else {
    check(`a Level-${AFTER.level} blow takes ${AFTER.damage} off the wolf, not ${BEFORE.damage}`,
      false, 'no fresh wolf came back inside the budget, so the blow could not be measured');
  }

  // ── HYDRATION MUST NOT REPLAY THE CEREMONY ────────────────────────────────────────────────────
  //
  // The rule docs/MISTAKES.md states in as many words, checked where it can actually go wrong: a
  // reload folds a Level-2 hero from durable facts on its very first frame, and a presenter that
  // treats "I did not know, now I do" as a rise fires LEVEL UP at a child every time they open the
  // game -- for something they did minutes ago.
  await page.send('Page.navigate', { url: GAME_URL });
  await waitForRuntime();
  const reloaded = await pollUntil((s) => s.ready && s.netStatus === 'online'
    && s.progress.level === AFTER.level, 45000);
  check('RELOAD: the level survived',
    reloaded.progress.level === AFTER.level && reloaded.progress.totalXp === LANTERN_UNLOCK_XP,
    `level ${reloaded.progress.level}, ${reloaded.progress.totalXp} XP`);
  check('RELOAD: and so did the body the fight uses',
    reloaded.hero.maxHp === AFTER.maxHp && reloaded.drawn.healthMax === String(AFTER.maxHp),
    `fight ${reloaded.hero.maxHp}, drawn ${reloaded.drawn.healthMax}`);
  check('RELOAD: the HUD comes back at the level and POWER the child earned',
    reloaded.drawn.level === String(AFTER.level) && reloaded.drawn.power === formatPower(AFTER.power),
    `LV ${reloaded.drawn.level}, POWER ${reloaded.drawn.power}`);
  check('RELOAD: the SAME guest came back -- localStorage, not a fresh mint',
    reloaded.guestId === guestId, `${reloaded.guestId}`);

  // Watched for a few seconds rather than read once: the ceremony would fire on the frame the first
  // rewards block lands, which is not the frame the runtime becomes ready.
  await page.eval(startWatch('replay', `({
    levelUps: window.__galaQuestRuntime.heroProgressState().levelUpsThisSession,
    banner: (() => { const b = document.querySelector('#banner');
      return b && b.dataset.shown === 'true' ? b.textContent : ''; })(),
  })`));
  await sleep(5000);
  const replay = JSON.parse(await page.eval(readWatchSource('replay')));
  await page.eval(stopWatchSource('replay'));
  const replayed = Math.max(0, ...replay.samples.map((sample) => sample.levelUps));
  const replayBanners = replay.samples.map((s) => s.banner).filter((t) => /level\s*up/i.test(t ?? ''));
  check('RELOAD: NO level-up ceremony replayed -- hydration is not a transition',
    replayed === 0 && replayBanners.length === 0,
    `levelUps ${replayed} over ${replay.frames} frames, banners ${JSON.stringify([...new Set(replayBanners)])}`);
  await shot('04-after-reload-level-2');

  // ── THE HERO SCREEN ───────────────────────────────────────────────────────────────────────────
  //
  // The other surface the contract puts POWER on, "prominently". Opened through the real button a
  // child taps, not by setting an attribute.
  const heroButton = await page.eval(`(() => {
    const rect = document.querySelector('#hero-button')?.getBoundingClientRect();
    return rect ? JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }) : null;
  })()`);
  if (heroButton) {
    const at = JSON.parse(heroButton);
    await touch('touchStart', [at]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(900);
    const screen = await page.eval(`(() => {
      const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
      return JSON.stringify({
        shown: document.querySelector('#hero-screen')?.dataset.shown === 'true',
        hidden: document.querySelector('#hero-identity')?.hidden ?? null,
        level: text('#hero-identity-level-value'),
        power: text('#hero-identity-power-value'),
        hp: text('#hero-identity-hp'),
        damage: text('#hero-identity-damage'),
        itemDamage: text('#hero-item-damage'),
      });
    })()`).then(JSON.parse);
    check('HERO SCREEN: Level and POWER are shown prominently',
      screen.shown && screen.hidden === false
        && screen.level === String(AFTER.level) && screen.power === formatPower(AFTER.power),
      `shown ${screen.shown}, LEVEL ${screen.level}, POWER ${screen.power}`);
    check('HERO SCREEN: and the stats are the RESOLVED ones the fight is using, not the catalogue\'s',
      screen.hp === String(AFTER.maxHp) && screen.damage === String(AFTER.damage),
      `${screen.hp} MAX HP, ${screen.damage} DAMAGE (the Starter Sword's own catalogue value is `
      + `${BEFORE.damage}, which is what a screen reading the item instead of the hero would print)`);
    await shot('05-hero-screen');
    await touch('touchStart', [at]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(500);
  } else {
    check('HERO SCREEN: Level and POWER are shown prominently', false, 'no #hero-button to tap');
  }

  check('no console errors attributable to P2', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));

  console.log(`\n  transition capture: ${transitionShot}`);
  console.log(`  the ceremony was caught mid-beat by the recorder: ${celebrating ? 'yes' : 'NO'}`);
} catch (error) {
  check('the run completed without throwing', false, String(error?.message ?? error));
  exitCode = 1;
} finally {
  await page.send('Target.closeTarget', { targetId }).catch(() => {});
  await server.kill().catch(() => {});
}

console.log(`\n${results.filter((r) => r.passed).length}/${results.length} checks passed`);
if (failures > 0) exitCode = 1;
process.exit(exitCode);
