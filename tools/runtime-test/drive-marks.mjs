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
import {
  ATTACK_REACH, SWING_CONTACT_SECONDS, WOLF_MAX_HP, canAttack,
} from '../../public/src/combat/encounter.js';
import { MARKS_TO_UNLOCK } from '../../public/src/rewards/marks.js';
import { STICK_RADIUS_PX } from '../../public/src/input/touch.js';
import { RUN_DEFLECTION } from '../../public/src/character/speed.js';
import {
  deadlineAfter,
  movementPulseMillis,
  pollUntilDeadline,
} from './automation-timing.mjs';
import { startOwnedServer } from './owned-server.mjs';
import {
  authoredWolfSource, readWatchSource, startWalk, startWatch, STOP_WALK,
  stopWatchSource, waitForSample,
} from './in-page-driver.mjs';

const CHROME_PORT = 9224;
// Spawns and owns its own server on an isolated port rather than using the shared 5201 (Phase H1).
// It matters especially here: this harness's whole claim is "one pip filled after one kill", and a
// shared server hands it a wolf whose state some other run already decided. See owned-server.mjs.
const server = await startOwnedServer();
const ORIGIN_UNDER_TEST = server.origin;
const URL_UNDER_TEST = server.url;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
// GP1-C6: the same run, in whichever orientation is asked for.
//
//     node tools/runtime-test/drive-marks.mjs [--landscape]
//
// Two runs rather than one run that rotates, deliberately. The FIRST Lantern Mark happens once per
// guest, and this harness clears localStorage before it loads -- so each run earns a genuine first
// mark rather than photographing mark 2 and calling it mark 1. Captures are prefixed with the
// orientation so the two runs cannot overwrite each other's evidence.
const LANDSCAPE = process.argv.includes('--landscape');
const ORIENTATION = LANDSCAPE ? 'landscape' : 'portrait';
const VIEWPORT = LANDSCAPE
  ? { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true }
  : { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };

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
  writeFileSync(`${OUT}marks-${ORIENTATION}-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured marks-${ORIENTATION}-${name}.png`);
}

// Self-verifying, same as play-fight.mjs: records the state a capture was taken in, so a picture
// that does not show what its filename claims is a failed check, not a silent lie.
const state = () => page.eval(`(() => {
  const r = window.__galaQuestRuntime;
  const published = r.encounterState();
  const authoredWolf = ${authoredWolfSource()};
  const net = r.netState();
  const pipEls = [...document.querySelectorAll('#lantern-marks .mark')];
  return JSON.stringify({
    enemy: { ...authoredWolf }, hero: { ...published.hero },
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
// DERIVED, not retyped (GQ-007): stale against input/touch.js's own STICK_RADIUS_PX since the
// 2026-08-27 speed-up grew it to 64px. Both uses below (the approach walk and the post-knockdown
// held re-engage) want full deflection -- covering real ground fast -- so unlike the tighter-ring
// harnesses this file needs no separate fine deflection: the re-close before every swing is a
// pulsed, exact placement already (see walkToward below), never a held leg against a small ring.
const STICK_PX = STICK_RADIUS_PX;

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

await walkToward((live) => ({ x: live.enemy.x, z: live.enemy.z }), 1.2, 14000);

// RECORD THE ARRIVAL CEREMONY FROM INSIDE THE PAGE, BEFORE THE FIGHT STARTS.
//
// The beat this file is here to prove is brief: MARK_IGNITE_MS is 700ms and the toast holds for
// 1800ms. Catching it by polling from outside cannot work here -- every page.eval is a CDP round
// trip costing a couple of hundred milliseconds, so a loop written as "poll every 20ms" gets three
// or four looks at a 700ms window and misses it, and a single read taken afterwards finds the banner
// already gone (`banner read ""`).
//
// A rAF recorder sees every frame and costs nothing, so the three checks below read what actually
// happened rather than what happened to be on screen when they asked. It also records the pip count
// AT THE MOMENT THE TOAST WAS SHOWN, which is what "the two numbers must agree" is actually about --
// the old version read the toast and the pips at two different times and compared them.
await page.eval(`(() => {
  const pill = document.querySelector('#lantern-marks');
  const banner = document.querySelector('#banner');
  const pipsNow = () => [...document.querySelectorAll('#lantern-marks .mark')]
    .filter((el) => el.dataset.filled === 'true').length;
  const log = { justLit: false, banners: [] };
  window.__markCeremony = log;
  let previous = '';
  const tick = () => {
    if (pill && pill.dataset.justLit === 'true') log.justLit = true;
    const shown = (banner && banner.dataset.shown === 'true') ? banner.textContent : '';
    if (shown && shown !== previous) log.banners.push({ text: shown, pips: pipsNow(), maxPips: pipsNow() });
    // AND THE HIGHEST PIP COUNT REACHED WHILE THAT TOAST WAS STILL UP.
    //
    // Sampling only the first frame is too strict, and measurably so: main.js renders the pips
    // earlier in the frame than it fires the arrival beat, so on the landing frame the toast reads 1
    // and the row reads 0 -- for exactly one frame. This check is not about frame ordering, it is
    // about whether a CHILD READING THE TOAST SEES THE SAME NUMBER ON THE ROW. The toast holds for
    // 1800ms, so the honest question is whether the pips agree within its lifetime.
    //
    // Both numbers are kept: the "pips" field is what the row showed the instant the toast appeared,
    // and "maxPips" is the best it reached before the toast went away. Reporting the first alongside
    // the second means a genuine one-frame lag stays visible in the log rather than smoothed out.
    // (No backticks in this comment: the whole block is inside a template literal and a stray one
    //  terminates it. That has now cost this branch three debugging rounds.)
    if (shown && log.banners.length > 0) {
      const current = log.banners[log.banners.length - 1];
      if (current.text === shown) current.maxPips = Math.max(current.maxPips, pipsNow());
    }
    previous = shown;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`);

// TAP ON THE RULES' OWN CLOCK, WALK WITH THE STICK HELD, AND RECORD THE FIGHT PER FRAME.
//
// This is the second correction to this loop and the first one was only half right. The version
// before it did a full canAttack read, a pulsed walk and a 20ms-interval poll per swing -- about
// fifty CDP round trips per swing -- and hosted that spent FOUR MINUTES FIFTY-TWO SECONDS before
// `FAIL the wolf can actually be killed`, with the ten mark-dependent checks failing behind it.
// Pressing on a 600ms cadence and looking up occasionally fixed the round-trip count and this file
// went 21/21 locally. Hosted at 45ae179 it still reported 10/21, and the DIAG line said why: FOUR
// KNOCKDOWNS.
//
// A knockdown is not a delay here, it is a reset. Design ruling 5 heals the wolf to full whenever
// the party wipes, and a solo hero wipes every time he goes down -- so each knockdown put the wolf
// back to WOLF_MAX_HP and the hero back at spawn, metres away. The re-approach was the PULSED
// walkToward, which on a runner painting at 367ms a frame (measured: movement-diagnostic-probe run
// 32624189431, 30 of 30 frames over prediction's 250ms cap) covers about a metre of the six it
// needs. So the hero never got back, and the fight could not be won no matter how many taps went
// out.
//
// Three changes, all of them moving frame-rate-sensitive work into the page (in-page-driver.mjs):
//
//   The re-approach HOLDS the stick and lets an in-page rAF loop re-aim at the wolf's live position
//   every frame, so crossing the distance costs distance-over-speed instead of one pulse per round
//   trip. It aims at an expression, not a captured pair, so a wolf that moves during the walk is
//   followed at frame resolution.
//
//   The taps go out on a measured cadence rather than a flat 600ms -- see the note above the
//   cadence itself for what that turned out to mean, and for why the first attempt at it was
//   exactly wrong.
//
//   The fight is RECORDED per frame instead of point-read between taps. The wolf's `hit` reaction
//   lives WOLF_HIT_FLASH_SECONDS (0.18s) and `dying` is brief; a read every ~370ms was sampling
//   less often than the states it was looking for last.
const WOLF_TARGET = authoredWolfSource();
const FIGHT_SAMPLE = `(() => {
  const runtime = window.__galaQuestRuntime;
  const encounter = runtime.encounterState();
  const authoredWolf = ${authoredWolfSource()};
  const self = runtime.netState().serverSelf;
  const at = self ? [self.x, self.z] : [runtime.player.position.x, runtime.player.position.z];
  return {
    hp: authoredWolf.hp,
    mode: authoredWolf.mode,
    heroDown: encounter.hero.downSeconds >= 0,
    // The three fields heroCanAttack (encounter.js) actually reads. Carried raw, not pre-reduced to
    // a boolean, so the loop below can hand them straight to the imported canAttack() and ask the
    // real rule rather than a re-derived guess about it.
    downSeconds: encounter.hero.downSeconds,
    swingSeconds: encounter.hero.swingSeconds,
    cooldown: encounter.hero.cooldown,
    gap: Math.hypot(at[0] - authoredWolf.x, at[1] - authoredWolf.z),
    // Rides along because the flight is ~0.4s and the kill is noticed a burst late. See the spark
    // check below for why a poll cannot be the evidence for this one.
    sparks: runtime.markSparksInFlight(),
  };
})()`;

await page.eval(startWatch('fight', FIGHT_SAMPLE));
const readFight = () => page.eval(readWatchSource('fight')).then(JSON.parse);
// This machine's own pace, measured rather than assumed.
await sleep(1000);
const paced = await readFight();
// One second of recording just happened, so the frame count IS the frame rate.
// TAP ONCE PER RENDERED FRAME, NOT ONCE PER SWING.
//
// Pacing taps at SWING_SECONDS plus a frame looked like deriving the cadence from the rules and was
// actually half the swing rate. The swing does not start when the tap is dispatched: it starts when
// authority receives it, a frame plus the wire later, and runs SWING_SECONDS from there -- so it
// ends about 1.9s after the tap, and a tap sent at 1.8s is refused for being early. The next one
// then comes at 3.6s. One swing every 3.6 seconds against a hero who survives about nine.
//
// A refused tap costs nothing -- the rules simply ignore it -- so the right rate is the fastest the
// game can even notice: main.js samples input once per rendered frame, so tapping faster than the
// frame period cannot help and tapping slower wastes eligibility. In practice the two CDP round
// trips a tap costs put the real rate near 0.7s, which is what the original 600ms here had by
// instinct. This is also the poll period the loop below reads the recorder at, once per iteration
// (see its own header for why every-iteration replaced every-fourth): a tap this cheap to refuse is
// worth checking readiness for at the same rate it would have been thrown at blind.
const framePeriodMs = paced.frames > 0 ? Math.round(1000 / paced.frames) : 17;
const tapEveryMs = framePeriodMs;
console.log(`  fight cadence: ~${framePeriodMs}ms a frame, tapping every ${tapEveryMs}ms`);

// READINESS-KEYED, NOT BLIND-INTERVAL. Every iteration reads the recorder FIRST and only ever
// spends a touch on a tap the rules can actually accept -- canAttack (imported from encounter.js,
// GQ-007) is exactly heroCanAttack applied to the hero's own three fields, so this asks the real
// rule instead of a re-derived guess about it. A tap is dispatched only when canAttack is true AND
// the last known gap is within ATTACK_REACH; otherwise the iteration spends nothing on a touch that
// the rules would have refused anyway, or -- when the gap says the hero cannot reach the wolf at
// all -- re-closes instead of tapping into empty air.
//
// This replaces two earlier, narrower fixes and keeps what both got right. Blind-interval tapping
// (every rendered frame, unconditionally) wasted most of its touches mid-swing or out of reach, and
// checking the gap only once every four taps left the walk-back too coarse to correct for it inside
// one hero life -- hosted this measured `swing gaps: [10.77, 9.49, 8.21, 7.16, 7.4, 6.81]` seconds
// between LANDED swings against a hero knocked down 6 times, because between the every-fourth-tap
// reads the hero could drift or be respawned out of ATTACK_REACH for several tap cycles running
// before anything noticed. Reading every iteration (not every fourth) makes that window one frame
// wide instead of four.
//
// CADENCE MATH. SWING_SECONDS is 1.5s and ATTACK_COOLDOWN_SECONDS is 0 (both encounter.js's own,
// imported rather than restated), so canAttack reopens the instant a swing's animation ends -- there
// is no separate cooldown tail to wait out. Polling once every loop iteration, at this machine's own
// measured frame period (tapEveryMs), means the first ready-and-in-reach read after that reopening
// moment lands at most one frame late. So a landed swing should repeat roughly every
// SWING_SECONDS + one frame, e.g. at a 4fps (250ms) frame that is a landed swing about every 1.75s,
// not whatever multiple of it a blind interval and a stale four-tap-old gap happened to land on.
// FIGHT LIKE A CHILD ACTUALLY FIGHTS: STICK HELD INTO THE WOLF, ATTACK MASHED ON TOP.
//
// Two stationary-tapping generations of this loop each fixed half the problem and lost hosted
// anyway. Readiness-keyed taps aimed right but traded too slow (cf5905c: 8 swings in 91s); blind
// frame-cadence taps traded fast but whiffed on FACING -- the hero swings where his body points and
// only turns while moving, so a wolf circling a stationary hero eats whole lives of swings
// (27b429f: one landed swing per life, seven knockdowns, wolf never below 20hp; the CDP-paced
// faceTarget nudge could not keep up). Both halves resolve at once by never standing still: an
// in-page walk (startWalk with a LIVE wolf-position expression and stopWithin 0, so it re-aims
// every frame and never latches) steers a PERMANENTLY HELD stick at the wolf while the attack taps
// ride on top as a SECOND touch point. Facing is continuously wolf-ward because the hero never
// stops moving toward it; the gap self-corrects the same way. The held deflection is the WALK push
// (RUN_DEFLECTION exactly -- drive-village.mjs's derivation), so the per-frame input quantum at a
// 3fps runner is ~0.6m: the hero orbits contact instead of blowing metres past it, and every point
// of the orbit is inside ATTACK_REACH's 1.7m and the swing's forgiving 151-degree arc. canAttack
// has no is-moving condition, so nothing about walking costs a swing.
//
// CDP multi-touch choreography, MEASURED rather than assumed (probed live against this game):
// touchStart's touchPoints are the full active set -- Chrome diffs it and presses only the NEW
// point, leaving the held stick untouched -- but touchEnd's touchPoints are the points BEING
// RELEASED. The first version listed the still-held stick in the tap's touchEnd, believing it
// described what remained, and Chrome dutifully lifted the stick on every tap: the probe read
// groundSpeed 1.725 while held and 0 the instant the first tap's end went out, which is exactly
// the dead-stick-at-spawn signature both hosted failures showed. The tap's touchEnd must list the
// ATTACK point alone. touchEnd with an empty list remains the full release.
const FIGHT_STICK_POINT = () => ({ x: stickX, y: stickY - Math.round(STICK_PX * RUN_DEFLECTION), id: 1 });
async function holdFightStick() {
  await page.eval(startWalk(WOLF_TARGET, 0));
  await touch('touchStart', [{ x: stickX, y: stickY, id: 1 }]);
  await touch('touchMove', [FIGHT_STICK_POINT()]);
}
async function releaseFightStick() {
  await page.eval(STOP_WALK);
  // Named explicitly rather than the empty-list "release everything": touchEnd's points are the
  // points being released, and naming the stick is the unambiguous way to lift it.
  await touch('touchEnd', [FIGHT_STICK_POINT()]);
}
let killed = false;
let lastGap = 0;
const gapsAtRead = [];
const killDeadline = Date.now() + 120000;
await holdFightStick();
try {
  // The wall clock stays the real budget (review-suite.test.mjs requires it); this iteration cap is
  // only a runaway guard, sized generously above the fastest this loop could plausibly cycle so it
  // never trips before killDeadline does on any machine, fast or starved.
  for (let tap = 0; tap < 20000 && !killed && Date.now() < killDeadline; tap += 1) {
    const cycleStart = Date.now();
    // eslint-disable-next-line no-await-in-loop
    await touch('touchStart', [FIGHT_STICK_POINT(), { x: attackX, y: attackY, id: 2 }]);
    // eslint-disable-next-line no-await-in-loop
    await sleep(60);
    // eslint-disable-next-line no-await-in-loop
    await touch('touchEnd', [{ x: attackX, y: attackY, id: 2 }]);
    // eslint-disable-next-line no-await-in-loop
    await sleep(Math.max(0, tapEveryMs - (Date.now() - cycleStart)));
    if (tap % 2 !== 0) continue;
    // eslint-disable-next-line no-await-in-loop
    const log = await readFight();
    killed = log.samples.some((sample) => sample.hp <= 0 || sample.mode === 'dying' || sample.mode === 'dead');
    if (killed) break;
    const latest = log.samples[log.samples.length - 1];
    lastGap = latest?.gap ?? 0;
    if (latest !== undefined && canAttack({
      hero: { downSeconds: latest.downSeconds, swingSeconds: latest.swingSeconds, cooldown: latest.cooldown },
    })) {
      gapsAtRead.push(Number(lastGap.toFixed(2)));
    }
    // NO knockdown branch, on purpose. The first version of this hold released the stick on a
    // down read, reengaged with a separate held leg, and re-established the hold -- and the
    // three-way touch choreography died on its first real knockdown (98d83e9: two downs, then
    // fourteen straight reads at gap 8.25 with the hero standing READY at spawn and every input
    // dead). None of it is needed: the in-page walk never latches and re-aims at the LIVE wolf
    // from wherever the hero is, the rules simply ignore held input on a down body, and the
    // respawned hero walks himself back into the fight on the same hold. The one cost is
    // crossing the respawn gap at the walk push instead of the run push, ~4 extra seconds the
    // wolf spends idling at full hp anyway.
  }
} finally {
  await releaseFightStick();
}
// The gap at each every-other-frame read that found the hero standing, swing-free and in reach --
// i.e. the moments a blind tap was actually eligible to land. ATTACK_REACH is 1.7m, so this is the
// line that says whether a fight that stalls stalled on RANGE or on something else.
console.log(`  ready-and-in-reach gaps at read: ${JSON.stringify(gapsAtRead)}`);
const fightLog = await readFight();
const knockdowns = fightLog.samples.filter((sample, index) =>
  sample.heroDown && !fightLog.samples[index - 1]?.heroDown).length;
console.log(`  fight: ${fightLog.frames} frames, ${fightLog.dropped} dropped, wolf reached `
  + `${fightLog.samples.reduce((low, sample) => Math.min(low, sample.hp), WOLF_MAX_HP)}hp`);
if (knockdowns > 0) console.log(`  DIAG  the hero was knocked down ${knockdowns} time(s) during the fight`);
check('the wolf can actually be killed', killed);

// GP1-C6: the reward MOMENT, caught while it is happening rather than after it has finished.
//
// `01-one-mark` below is taken after a poll for the pip, which is the STATE the reward leaves behind
// -- by then the spark that carries the mark from the wolf to the belt may already have landed. Both
// are worth having and they are different pictures: one is "what did I just earn", the other is "what
// do I have now". Triggered off the spark's own live count rather than a sleep, so the frame cannot
// claim to show a flight that had already ended.
//
// READ FROM THE RECORDER, not polled, and this check is the reason the fight recorder above is
// still running. The flight lasts about 0.4s. The poll this replaces asked the page for
// markSparksInFlight() every 20ms, which on a 3fps runner is really every ~333ms, and it could not
// start asking until the harness had NOTICED the kill -- which is checked once every loop iteration
// above (readiness-keyed, not bursted), but a CDP round trip on a starved runner is still slower
// than the flight itself. The recorder was already watching every frame from before the killing
// blow, so the flight is in the log whether or not anyone was looking.
const sparkFrames = await waitForSample(page, 'fight', (sample) => sample.sparks >= 1,
  { intervalMs: 60, timeoutMs: 4000 });
await page.eval(stopWatchSource('fight'));
const inFlight = sparkFrames.samples.reduce((most, sample) => Math.max(most, sample.sparks), 0);
// Best-effort on a starved runner, and only best-effort: a screenshot round trip is longer than the
// flight below ~10fps. The CHECK above reads the recorder, which cannot miss it; this is the
// picture, which can.
await shot('03-mark-in-flight');
check(`${ORIENTATION}: the mark's own light was caught in flight, not after it landed`,
  inFlight >= 1, `markSparksInFlight() ${inFlight}`);

// THE REWARD BEAT ITSELF -- the frame this whole lane is judged on. Triggered off the ignite
// attribute main.js sets the moment the light reaches the boy, so the capture cannot be taken before
// the thing it is evidence for has started, and cannot claim an arrival that never happened.
// Give the light time to fly and land, then ask the recorder whether the pill ever ignited. Waiting
// rather than polling: the recorder is already watching every frame, so the only question is whether
// enough time has passed for the beat to have happened at all.
await sleep(4000);
const ceremony = await page.eval('JSON.stringify(window.__markCeremony ?? { justLit: false, banners: [] })')
  .then(JSON.parse);
const ignited = ceremony.justLit === true;
await shot('05-mark-arrival');
check(`${ORIENTATION}: the mark ARRIVING is its own moment -- the pip ignites when the light lands`,
  ignited, 'the lantern-marks pill never entered its just-lit state');

// THE TWO NUMBERS MUST AGREE. The first version of this beat said "LANTERN MARK 2 / 3" next to a
// single lit pip, because the pip count and the banner count were derived separately and one of them
// double-counted a mark that the render had already revealed. Caught by looking at the capture, which
// is the only reason it was caught -- both numbers were individually plausible. This is the check
// that makes the capture unnecessary next time.
const markToast = ceremony.banners.find((b) => /LANTERN MARK/.test(b.text)) ?? { text: '', pips: null };
const bannerCount = Number((/LANTERN MARK\s+(\d+)\s*\/\s*(\d+)/.exec(markToast.text) ?? [])[1]);
check(`${ORIENTATION}: the reward toast names the mark AND the progress`,
  Number.isFinite(bannerCount) && /LANTERN MARK/.test(markToast.text),
  `banner read ${JSON.stringify(markToast.text)}; every banner seen: `
  + JSON.stringify(ceremony.banners.map((b) => b.text)));
check(`${ORIENTATION}: the toast's count and the lit pips are the SAME number`,
  bannerCount === markToast.maxPips,
  `toast says ${bannerCount}; the row reached ${markToast.maxPips} pip(s) while the toast was up`
  + ` (${markToast.pips} on its very first frame -- main.js paints the pips earlier in the frame`
  + ` than it fires the arrival beat, so one frame of lag there is ordering, not disagreement)`);

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

// The steady state: every part of the reward has resolved and this is what the child is left looking
// at. If the progress is only legible DURING the effect, it is not legible.
const settled = await (async () => {
  const deadline = deadlineAfter(6000);
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const live = await page.eval('window.__galaQuestRuntime.markSparksInFlight()');
    if (live === 0) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(50);
  }
  return false;
})();
await sleep(1800);
await shot('04-mark-steady');
const steady = await state();
check(`${ORIENTATION}: after the effect resolves the progress is still on screen -- one pip filled, no leftovers`,
  settled && steady.pipsFilled === 1, `sparks drained ${settled}, pipsFilled ${steady.pipsFilled}`);

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
