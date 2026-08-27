/**
 * Drive the runtime slice with real synthetic touch events, on an emulated phone viewport.
 *
 *   node drive.mjs
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * This dispatches Input.dispatchTouchEvent, so the page receives genuine pointer events with
 * pointerType 'touch'. That is the point: the stick, the camera drag and the pinch all branch on
 * pointerType and on hit-testing against the viewport, and none of that can be exercised by calling
 * the modules directly.
 *
 * Everything is asserted against window.__galaQuestRuntime, read from the MAIN world. Codex could not
 * reach that object from its browser bridge's isolated world and correctly refused to treat the
 * missing value as evidence; raw CDP has no such problem.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NUDGE_FRACTION, SNAP_DRIFT_UNITS } from '../../public/src/net/client.js';
import { INPUT_SEND_HZ, SNAPSHOT_HZ } from '../../public/src/net/protocol.js';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
// Spawns and owns its own server on an isolated port rather than using the shared 5201 (Phase H1).
// See owned-server.mjs: 5201 was measured to belong to a sibling worktree, so a green run there
// could be proving another checkout's input handling rather than this one's.
const server = await startOwnedServer();
const URL_UNDER_TEST = server.url;
const ORIGIN_UNDER_TEST = server.origin;
// Captures land in gitignored scratch: they are evidence for one run, not repo content.
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
// iPhone-ish portrait, which is what the owner tests on.
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

const SETTLE_DRAG_INTERVALS = 3;
const SETTLE_TARGET_ERROR = 0.02 / (1 - (1 - NUDGE_FRACTION) ** SETTLE_DRAG_INTERVALS);
const SETTLE_EPSILON_UNITS = NUDGE_FRACTION * SETTLE_TARGET_ERROR;
const SETTLE_INTERVAL_MS = Math.round(1000 / SNAPSHOT_HZ);
const SETTLE_TIMEOUT_MS = Math.ceil(
  2 * (Math.log(SETTLE_TARGET_ERROR / SNAP_DRIFT_UNITS) / Math.log(1 - NUDGE_FRACTION)) * SETTLE_INTERVAL_MS,
);

// Declared UP HERE, with the other top-level constants, rather than beside the function that
// documents them. They are `const`, so a use above their declaration is a temporal dead zone, and
// the first draft of this file put them next to settleReconciliation and read SETTLE_EPSILON_UNITS
// eighty lines earlier in the stop check. Same defect that stopped the game booting at 5e4c180,
// caught here by reading back rather than by running.

mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/**
 * A measurement the CURRENT environment cannot authoritatively judge.
 *
 * `check(name, hostedHeadless || predicate, detail)` prints PASS for a predicate that actually
 * failed, which is a false statement rather than a looser gate -- and a reader comparing two runs
 * reads that suppression as a repair. DIAG is neither PASS nor FAIL: it always prints what the
 * predicate really did, states that the environment cannot rule on it, and does not count toward
 * `failures`. With `authoritative: true` it degrades to an ordinary gating check.
 */
function diagnostic(name, passed, detail, { authoritative, reason }) {
  if (authoritative) return check(name, passed, detail);
  results.push({ name, passed: null, outcome: 'DIAG', actualPredicate: passed, detail });
  console.log(`DIAG  ${name}${detail ? `  — ${detail}` : ''}`
    + ` [NOT JUDGED: ${reason}; predicate actually ${passed ? 'held' : 'VIOLATED'}]`);
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
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(`eval threw: ${r.exceptionDetails.text}`);
    return r.result.value;
  }
}

// ── open a page ────────────────────────────────────────────────────────────────────────────────
const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
const browser = new CDP(version.webSocketDebuggerUrl);
await browser.ready();
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });

const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
const target = list.find((t) => t.id === targetId);
const page = new CDP(target.webSocketDebuggerUrl);
await page.ready();
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Log.enable');

const consoleErrors = [];
page.ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push(msg.params.entry.text);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.text
      + ' ' + (msg.params.exceptionDetails.exception?.description ?? ''));
  }
});

await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Page.bringToFront');
// Fresh-guest discipline (GQ-008). Every harness that navigates to the game starts from a known
// identity, not whatever the persistent automation profile happens to be holding -- see
// docs/MISTAKES.md. This one cannot award a mark today, but the rule is "every navigating harness"
// precisely because "can this one award a mark?" is a judgement that goes stale.
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
await page.send('Page.navigate', { url: URL_UNDER_TEST });

// ── wait for the hero ──────────────────────────────────────────────────────────────────────────
let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(500);
  ready = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)')
    .catch(() => false);
  if (ready) break;
}
check('page boots and the hero loads', ready, ready ? null : 'no window.__galaQuestRuntime.hero after 30s');
if (!ready) {
  console.log('console errors:', consoleErrors);
  process.exit(1);
}

const size = await page.eval('JSON.stringify({w: innerWidth, h: innerHeight})').then(JSON.parse);
console.log(`viewport ${size.w}x${size.h}`);

// No resize event fires on a plain page load, so this only passes if boot itself sets the aspect.
// Before the fix the camera stayed at its constructor aspect of 1 on this 0.462 viewport, and every
// capture in this file's history was rendered 0.46x too narrow.
const aspect = await page.eval('window.__galaQuestRuntime.camera.aspect');
check('the camera aspect matches the viewport without waiting for a resize event',
  Math.abs(aspect - size.w / size.h) < 1e-9,
  `camera.aspect ${aspect.toFixed(4)} vs viewport ${(size.w / size.h).toFixed(4)}`);

const hostedHeadless = await page.eval("navigator.userAgent.includes('HeadlessChrome')");

const state = () => page.eval(`(() => {
  const r = window.__galaQuestRuntime;
  const loco = r.locomotion();
  return JSON.stringify({
    heading: r.follow.heading,
    pitch: r.follow.pitch,
    distance: r.follow.distance,
    speed: r.player.groundSpeed,
    px: r.player.position.x,
    pz: r.player.position.z,
    heroRotY: r.hero.rotation.y,
    touchActive: r.touch.read().active,
    touchRun: r.touch.read().run,
    stick: r.touch.read().screen,
    gesture: r.cameraGesture.state,
    mode: loco ? loco.getState().activeMode : null,
    rate: loco ? loco.getState().playbackRate : null,
    frames: r.diagnostics.read().count,
    quality: r.quality.state,
    qualityLevel: r.quality.level.name,
    status: document.querySelector('#runtime-status').textContent,
  });
})()`).then(JSON.parse);

async function pollState(predicate, { samples = 20, intervalMs = 100 } = {}) {
  let last = await state();
  for (let sample = 0; sample < samples && !predicate(last); sample += 1) {
    await sleep(intervalMs);
    last = await state();
  }
  return last;
}

const touch = (type, points) => page.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});

async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT + name, Buffer.from(data, 'base64'));
  console.log(`  captured ${name}`);
}

// ── rAF must actually be running, or every movement assertion below is meaningless ─────────────
const framesBefore = (await state()).frames;
await sleep(1000);
const framesAfter = (await state()).frames;
// ── developer chrome is not player chrome ──────────────────────────────────────────────────────
// #runtime-status used to paint `you (14.2,-3.1) · wolf 3hp · you 4hp · players 1` over the game for
// the whole session. It is hidden in play now, behind the same ?debug=1 switch #perf-hud uses.
//
// Checked HERE, from a harness that reads that element's textContent a few lines up, because those
// two facts have to hold together: the line must be invisible to a child AND still readable by the
// eighteen harnesses that parse it. A check that only proved the first would be satisfied by
// deleting the element, which would take the whole suite down with it.
const devChrome = await page.eval(`JSON.stringify((() => {
  const el = document.querySelector('#runtime-status');
  if (!el) return { missing: true };
  return {
    hiddenToPlayer: el.offsetParent === null,
    textReadable: (el.textContent ?? '').length > 0,
    debug: el.dataset.debug,
    fault: el.dataset.fault,
  };
})())`).then(JSON.parse);
check('the developer status line is not painted over the game a child is playing',
  devChrome.hiddenToPlayer === true && devChrome.fault === 'false', JSON.stringify(devChrome));
check('...and is still readable by the harnesses that parse it',
  devChrome.textReadable === true, JSON.stringify(devChrome));

check('the frame loop is running', framesAfter > 0 && framesBefore >= 0,
  `sampler holds ${framesAfter} frames (capacity 40)`);

const before = await state();
await shot('01-idle.png');

// ── 1. the stick, inside the lower-left region ─────────────────────────────────────────────────
const stickPoint = { x: size.w * 0.2, y: size.h * 0.85 };
await touch('touchStart', [stickPoint]);
await sleep(60);
const grabbed = await state();
check('a touch in the lower-left area grabs the stick', grabbed.touchActive,
  `touchActive=${grabbed.touchActive}`);

// Push the stick "up" the screen by 40px: a partial deflection, so this should be a walk.
await touch('touchMove', [{ x: stickPoint.x, y: stickPoint.y - 40 }]);
await sleep(150);
// Measure the speed the hero actually travels, bracketed by in-page clocks. The first wiring
// multiplied the stick magnitude in twice (worldInput carries it, groundSpeed prices it again), so
// this partial push moved at magnitude^2 * speed: 0.71 m/s while the status line claimed 1.00.
const posClock = '(() => { const r = window.__galaQuestRuntime; '
  + 'return JSON.stringify({ t: performance.now(), x: r.player.position.x, z: r.player.position.z }); })()';
const v0 = await page.eval(posClock).then(JSON.parse);
await sleep(600);
const v1 = await page.eval(posClock).then(JSON.parse);
const walking = await state();
const measuredSpeed = Math.hypot(v1.x - v0.x, v1.z - v0.z) / ((v1.t - v0.t) / 1000);
diagnostic('the hero travels at the speed the status line claims',
  Math.abs(measuredSpeed - walking.speed) <= walking.speed * 0.1,
  `measured ${measuredSpeed.toFixed(3)} m/s vs claimed ${walking.speed.toFixed(2)} m/s`,
  { authoritative: !hostedHeadless, reason: 'wall-clock speed measurement is not authoritative in HeadlessChrome' });
check('a partial push walks', walking.speed > 0 && walking.mode === 'walk',
  `speed=${walking.speed.toFixed(2)} mode=${walking.mode} status="${walking.status}"`);
check('a partial push is slower than full speed', walking.speed < 2.8,
  `speed=${walking.speed.toFixed(2)}`);
check('the hero actually moves', Math.hypot(walking.px - before.px, walking.pz - before.pz) > 0.05,
  `moved ${Math.hypot(walking.px - before.px, walking.pz - before.pz).toFixed(3)} units`);
await shot('02-walking.png');

// Full deflection -> run.
await touch('touchMove', [{ x: stickPoint.x, y: stickPoint.y - 90 }]);
const running = await pollState((s) => s.mode === 'run' && s.touchRun, { samples: 20, intervalMs: 100 });
check('a full push reaches a run on touch', running.mode === 'run' && running.touchRun,
  `speed=${running.speed.toFixed(2)} mode=${running.mode} status="${running.status}"`);
await shot('03-running.png');

// Direction: pushing up the screen should move the hero AWAY from the camera.
const awayFromCamera = await page.eval(`(() => {
  const r = window.__galaQuestRuntime;
  const toHero = new (Object.getPrototypeOf(r.player.position).constructor)();
  toHero.copy(r.player.position).sub(r.camera.position);
  const fwd = r.follow.screenToWorld({x: 0, y: 1});
  const d = (toHero.x * fwd.x + toHero.z * fwd.z) / Math.hypot(toHero.x, toHero.z);
  return d;
})()`);
check('stick-up moves the hero away from the camera', awayFromCamera > 0.9,
  `dot(cameraToHero, stickForward) = ${awayFromCamera.toFixed(3)}`);

await touch('touchEnd', [{ x: stickPoint.x, y: stickPoint.y - 90 }]);
// Same defect class as the settle above, and the same repair: `await sleep(300)` then assert
// `speed === 0` was measuring the runner. A release travels one input interval to the server and
// comes back on the next snapshot -- ~167 ms nominal, so 300 ms was under 2x the happy path and a
// starved frame put the sample mid-stride, reading 2.8 m/s. test/game-server.test.mjs's own
// stop-check carries this exact lesson ("this is what made this test fail roughly half of all
// runs") and fixed it by waiting for the state rather than for the clock.
//
// Deliberately NOT "poll until speed is 0 and then assert speed is 0", which proves nothing. The
// two halves are separated:
//   LIVENESS -- did the hero ever stop? A timeout here IS a failure, and it is the real regression
//               this check is named for.
//   PROPERTY -- having stopped, does it stay stopped? That is the slide a child would actually see.
const stopBudgetMs = Math.ceil(10 * (1000 / INPUT_SEND_HZ + 1000 / SNAPSHOT_HZ));
const released = await waitForStop(stopBudgetMs);
check('releasing the stick stops the hero', released.speed === 0 && !released.touchActive,
  `speed=${released.speed} status="${released.status}"`);
// ...and STAYS stopped. This is the half a poll cannot fake: having waited for speed 0, the
// question left is whether the hero slides on afterwards, which is what a child would actually see.
// Measured over a real snapshot interval rather than instantaneously, because a slide is a
// displacement over time and a single sample cannot show one.
//
// GQ-021, and the same defect the release check three blocks up already had repaired: this measured
// from the instant SPEED reached zero, which is not the instant POSITION stops moving. Speed is the
// input/animation state; position is still being reconciled toward the server's authority at
// NUDGE_FRACTION (10%) per snapshot, and that backlog drains on RENDERED FRAMES while `sleep` counts
// wall clock. So the check was sampling the reconciliation tail and reporting it as a slide.
//
// It showed up exactly as that predicts -- bimodal, never in between. Four local runs at one commit:
// 0.0000, 0.0000, 0.0000, 0.0491. Hosted, where the runner is frame-starved and the backlog is far
// bigger, 1.9827 with the hero pinned against the world clamp. A real slide is not bimodal.
//
// The repair is the one the neighbouring comment already argues for and is NOT a relaxed threshold:
// the epsilon is untouched. Instead the two halves are separated the same way the release check
// separates them.
//   LIVENESS -- does the position converge at all? A timeout here IS a failure, and it is a
//               regression this check could not previously even express.
//   PROPERTY -- having converged, does it stay put? Any movement then is a slide a child would see.
// A hero that slid forever would never converge and fail LIVENESS; one that converged and then crept
// would fail PROPERTY. Both real failures survive; only the reconciliation tail stops being counted.
const settleBudgetMs = Math.ceil(20 * (1000 / SNAPSHOT_HZ));
const settled = await waitForPositionSettled(settleBudgetMs);
check('the hero\'s position converges after the thumb comes off', settled.converged,
  settled.converged
    ? `settled after ${settled.samples} samples`
    : `still moving ${settled.lastStep.toFixed(4)} units per sample after ${settleBudgetMs} ms`
      + ' -- the hero never stopped being corrected');

const restingAt = await state();
await sleep(Math.round(1000 / SNAPSHOT_HZ) * 3);
const stillResting = await state();
const slid = Math.hypot(stillResting.px - restingAt.px, stillResting.pz - restingAt.pz);
check('and stays stopped -- no slide after the thumb comes off',
  released.speed === 0 && settled.converged && slid < SETTLE_EPSILON_UNITS,
  `drifted ${slid.toFixed(4)} units over 3 snapshot intervals`
  + ` (epsilon ${SETTLE_EPSILON_UNITS.toFixed(4)})`);
await shot('04-released-idle.png');

// A child re-grabbing the stick straight after releasing it must get a live stick. The 320ms
// double-tap guard used to drop that second touch entirely, leaving the stick dead -- and because it
// recorded every tap, repeated jabs chained the deadness. The guard compared two *pointerdowns*, so
// this sequence has to be tight and the gap has to be measured: a re-grab 400ms later would pass on
// the broken code and prove nothing.
const clock = 'performance.now()';
const tapOne = await page.eval(clock);
await touch('touchStart', [stickPoint]);
await touch('touchEnd', [stickPoint]);
await touch('touchStart', [stickPoint]);
const tapTwo = await page.eval(clock);
const regrabGapMs = tapTwo - tapOne;
await touch('touchMove', [{ x: stickPoint.x, y: stickPoint.y - 50 }]);
await sleep(350);
const regrabbed = await state();
await touch('touchEnd', [{ x: stickPoint.x, y: stickPoint.y - 50 }]);
await sleep(200);
diagnostic('the re-grab test really lands inside the old 320ms guard window', regrabGapMs < 320,
  `two pointerdowns ${regrabGapMs.toFixed(0)}ms apart`,
  { authoritative: !hostedHeadless, reason: 'CDP transport time is not authoritative in HeadlessChrome' });
check('re-grabbing the stick immediately still drives the hero',
  regrabbed.touchActive && regrabbed.speed > 0,
  `touchActive=${regrabbed.touchActive} speed=${regrabbed.speed.toFixed(2)}`);

/**
 * Poll until the hero has come to rest, and hand back that state.
 *
 * Bounded on purpose: returning the last sample on timeout rather than throwing lets the check that
 * called it report the real speed it saw, which is the honest failure ("the hero never stopped at
 * 2.80 m/s") instead of a harness stack trace that says nothing about the product.
 */
/**
 * Wait until the hero's POSITION stops changing between consecutive samples.
 *
 * Deliberately a different quantity from waitForStop's: that one waits for the client to report
 * speed 0, this one waits for the prediction/reconciliation backlog to finish draining. Returns
 * whether it converged rather than asserting, so the caller can make the timeout its own named
 * failure instead of hiding it inside a settle.
 */
async function waitForPositionSettled(budgetMs) {
  // Two consecutive samples this close together mean the corrections have drained -- when they have,
  // the reconciler writes the same value and the step is exactly 0. Well under the slide epsilon the
  // property check uses, so convergence can never be mistaken for the property it precedes.
  const STEP_EPSILON_UNITS = 1e-4;
  const deadline = Date.now() + budgetMs;
  let previous = await state();
  let samples = 1;
  let lastStep = Infinity;
  while (Date.now() < deadline) {
    await sleep(Math.round(1000 / SNAPSHOT_HZ));
    const next = await state();
    samples += 1;
    lastStep = Math.hypot(next.px - previous.px, next.pz - previous.pz);
    previous = next;
    if (lastStep < STEP_EPSILON_UNITS) return { converged: true, samples, lastStep };
  }
  return { converged: false, samples, lastStep };
}

async function waitForStop(budgetMs) {
  const deadline = Date.now() + budgetMs;
  let last = await state();
  while (Date.now() < deadline) {
    if (last.speed === 0 && !last.touchActive) return last;
    await sleep(Math.round(1000 / SNAPSHOT_HZ));
    last = await state();
  }
  return last;
}

/**
 * Wait until the hero has actually stopped drifting, rather than for a fixed number of milliseconds.
 *
 * Every number here is DERIVED from the reconciliation it is waiting on, imported rather than
 * restated (GQ-007). net/client.js closes prediction error by NUDGE_FRACTION per snapshot at
 * SNAPSHOT_HZ, so with a remaining error E the hero moves NUDGE_FRACTION*E in one snapshot interval.
 *
 * The epsilon is chosen backwards from the assertion it protects. The drag below spans ~3 snapshot
 * intervals, over which a remaining error E produces E*(1 - (1-NUDGE_FRACTION)^3) of movement. For
 * that to stay under the 0.02 the check asserts, E must be below ~0.074 -- so waiting until one
 * interval's movement is under NUDGE_FRACTION * 0.074 leaves the drag window comfortably clear. That
 * is what makes this a settle rather than a fudge: the check still fails if camera input ever
 * genuinely commands movement, because 0.02 is untouched.
 *
 * The timeout is the slowest legal case: SNAP_DRIFT_UNITS is the largest error corrected gradually
 * rather than snapped, and ln(target/start)/ln(1-NUDGE_FRACTION) snapshots to reach the target --
 * about 2.4 s here. Doubled, because a starved runner advances the reconciliation in wall-clock
 * terms more slowly than the maths assumes ("automation timeouts are wall-clock budgets").
 */

async function settleReconciliation() {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let previous = await state();
  let stillFor = 0;
  while (Date.now() < deadline) {
    await sleep(SETTLE_INTERVAL_MS);
    const now = await state();
    const moved = Math.hypot(now.px - previous.px, now.pz - previous.pz);
    previous = now;
    // TWO consecutive quiet intervals, not one: a single sample can land between two nudges and read
    // as still while the hero is very much still being pulled.
    stillFor = moved < SETTLE_EPSILON_UNITS ? stillFor + 1 : 0;
    if (stillFor >= 2) return { settled: true, movedLast: moved };
  }
  // Not a failure of its own -- the check below is what judges the product. Reporting it keeps a
  // timed-out settle from being invisible in a run where the real check then fails for that reason.
  console.log(`  [settle] reconciliation did not converge within ${SETTLE_TIMEOUT_MS}ms`
    + ` (epsilon ${SETTLE_EPSILON_UNITS.toFixed(4)} units per ${SETTLE_INTERVAL_MS}ms)`);
  return { settled: false, movedLast: null };
}

// ── 2. camera drag, outside the region ─────────────────────────────────────────────────────────
// Let reconciliation settle before asserting the hero is still. With a server in the loop the local
// prediction and the server's authority sit slightly apart during motion -- measured 0.02 to 0.15
// units, because the client moves on the thumb while the server moves when the input arrives up to
// one 66ms interval later -- and the hero legitimately drifts toward authority afterwards. Settling
// first keeps the check below strict instead of loosening it to swallow real movement.
//
// This WAS `await sleep(900)`, and the Checkpoint 0 audit caught it failing reproducibly on a
// property that actually holds. A control run settled the same 900 ms with NO camera drag at all
// and the hero still drifted 0.051 units -- 2.5x the threshold, with zero camera input -- while the
// same drag after a 4.1 s settle moved only 0.013 and passed. The comment three lines up even
// documents drift "0.02 to 0.15 units" while the assertion below reads `< 0.02`: the check was
// measuring the settle, not the product. **The threshold is deliberately unchanged.** A fixed sleep
// is the wrong instrument, which is the lesson play-fight.mjs already learned for its own
// body-separation check, and this is that lesson applied here.
await settleReconciliation();
const camPoint = { x: size.w * 0.7, y: size.h * 0.3 };
const beforeDrag = await state();
await touch('touchStart', [camPoint]);
await sleep(60);
for (let i = 1; i <= 6; i++) {
  await touch('touchMove', [{ x: camPoint.x + i * 20, y: camPoint.y }]);
  await sleep(40);
}
const dragged = await state();
await touch('touchEnd', [{ x: camPoint.x + 120, y: camPoint.y }]);
await sleep(100);
check('dragging outside the region turns the camera', Math.abs(dragged.heading - beforeDrag.heading) > 0.2,
  `heading ${beforeDrag.heading.toFixed(3)} -> ${dragged.heading.toFixed(3)}`);
check('drag right turns left (negative yaw)', dragged.heading < beforeDrag.heading,
  `delta ${(dragged.heading - beforeDrag.heading).toFixed(3)} rad`);
// The property is that camera input does not COMMAND movement. Stick input over this drag would
// travel ~0.5 units at a walk; anything at this scale is settled reconciliation, not steering.
const dragMoved = Math.hypot(dragged.px - beforeDrag.px, dragged.pz - beforeDrag.pz);
check('turning the camera does not move the hero', dragMoved < 0.02,
  `moved ${dragMoved.toExponential(2)} units (stick input would be ~0.5)`);
await shot('05-camera-turned.png');

// ── which way to turn, once turning has hidden the thing ───────────────────────────────────────
// The camera has just been dragged, which is the exact gesture Checkpoint 0 named: one thumb-drag
// destroys all spatial guidance with no recovery path. Measured from a fresh spawn, 69 degrees is
// enough to put the Keeper off screen while the chip still says to go and talk to him.
//
// Checked HERE rather than in a harness of its own because this file already performs the gesture,
// and a guidance check that has to re-create a camera drag to test itself would be testing its own
// setup. Both halves are asserted together -- shown when the errand is off screen, hidden when it is
// not -- because either alone is satisfied by an arrow that is always in one state.
// The arrow's angle is pulled out of its CSS transform by STRIPPING rather than by matching, and
// the reason is a trap specific to writing regexes inside a template literal: the literal consumes
// the backslash before the regex ever sees it, so /rotate\(...\)/ arrives as /rotate(...)/ with the
// parens as grouping, matches nothing, and the check fails reading "angle undefined" for a reason
// that has nothing to do with the arrow. Cost one run to find. "rotate" and "rad" contain no digits,
// so removing every non-numeric character leaves exactly the angle.
const guidance = await page.eval(`JSON.stringify((() => {
  const r = window.__galaQuestRuntime;
  const el = document.querySelector('#objective-pointer');
  const arrow = document.querySelector('#objective-pointer-arrow');
  const rescue = r.guidanceRescueState ? r.guidanceRescueState() : null;
  if (!rescue || rescue.targetX === null) return { noObjectivePlace: true };

  // Where the errand actually is on screen, computed the way main.js does rather than read back off
  // the element -- an arrow pinned to an EDGE says nothing about which world thing it means.
  const Vec3 = r.scene.position.constructor;
  const v = new Vec3(rescue.targetX, 1.0, rescue.targetZ);
  v.project(r.camera);
  const onScreen = Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z <= 1;
  const transform = arrow?.style.transform ?? '';
  const stripped = transform.replace(/[^-0-9.]/g, '');
  return {
    onScreen,
    ndcX: Math.round(v.x * 100) / 100,
    shown: el?.dataset.shown === 'true',
    angleRad: stripped === '' ? null : Number(stripped),
    targetX: rescue.targetX,
    targetZ: rescue.targetZ,
  };
})())`).then(JSON.parse);

if (guidance.noObjectivePlace) {
  // Reachable and not a defect: some objectives genuinely have nowhere to point ("cut the black
  // bramble" is the thing in front of you). DIAG rather than PASS, because a check that silently
  // succeeds when it did not run is the false-confidence shape this file's own helper exists for.
  diagnostic('the arrow is shown exactly when the errand is off screen', false, JSON.stringify(guidance),
    { authoritative: false, reason: 'the current objective has no place, so there is nothing to point at' });
} else {
  check('the arrow is shown exactly when the errand is off screen',
    guidance.shown === !guidance.onScreen, JSON.stringify(guidance));
  if (!guidance.onScreen) {
    // Off to the RIGHT means the arrow points right: atan2 in a +y-down space, so |angle| < 90deg.
    // Sign-checked rather than compared to a magic number, because the exact bearing depends on the
    // viewport and the whole point of the module is that it does.
    const pointsRight = Math.abs(guidance.angleRad) < Math.PI / 2;
    check('and it points towards the side the errand is actually on',
      (guidance.ndcX > 0) === pointsRight,
      `ndcX ${guidance.ndcX}, angle ${guidance.angleRad?.toFixed(2)}rad`);
  }
}

// Pitch: drag up should lower the camera.
const beforePitch = await state();
await touch('touchStart', [camPoint]);
await sleep(60);
for (let i = 1; i <= 6; i++) {
  await touch('touchMove', [{ x: camPoint.x, y: camPoint.y - i * 20 }]);
  await sleep(40);
}
const pitched = await state();
await touch('touchEnd', [{ x: camPoint.x, y: camPoint.y - 120 }]);
await sleep(100);
check('drag up lowers the camera (pitch decreases)', pitched.pitch < beforePitch.pitch,
  `pitch ${beforePitch.pitch.toFixed(3)} -> ${pitched.pitch.toFixed(3)}`);
await shot('06-pitched.png');

// ── 3. two-finger pinch ────────────────────────────────────────────────────────────────────────
const beforePinch = await state();
const a = { x: size.w * 0.4, y: size.h * 0.35, id: 1 };
const b = { x: size.w * 0.6, y: size.h * 0.35, id: 2 };
await touch('touchStart', [a]);
await sleep(40);
await touch('touchStart', [a, b]);
await sleep(60);
const pinchState = await state();
check('a second finger starts a pinch', pinchState.gesture.pinching,
  JSON.stringify(pinchState.gesture));
for (let i = 1; i <= 5; i++) {
  await touch('touchMove', [
    { x: a.x - i * 12, y: a.y, id: 1 },
    { x: b.x + i * 12, y: b.y, id: 2 },
  ]);
  await sleep(40);
}
const spread = await state();
check('spreading the fingers zooms in', spread.distance < beforePinch.distance,
  `distance ${beforePinch.distance.toFixed(2)} -> ${spread.distance.toFixed(2)}`);
await shot('07-zoomed-in.png');

for (let i = 5; i >= 1; i--) {
  await touch('touchMove', [
    { x: a.x - i * 4, y: a.y, id: 1 },
    { x: b.x + i * 4, y: b.y, id: 2 },
  ]);
  await sleep(40);
}
const squeezed = await state();
check('pinching together zooms back out', squeezed.distance > spread.distance,
  `distance ${spread.distance.toFixed(2)} -> ${squeezed.distance.toFixed(2)}`);

// Lifting one finger out of a pinch must not spin the camera.
const beforeLift = await state();
await touch('touchEnd', [{ x: b.x, y: b.y, id: 2 }]);
await sleep(200);
const afterLift = await state();
check('lifting one finger out of a pinch does not spin the camera',
  Math.abs(afterLift.heading - beforeLift.heading) < 1e-9,
  `heading ${beforeLift.heading.toFixed(4)} -> ${afterLift.heading.toFixed(4)}`);
await touch('touchEnd', [{ x: a.x, y: a.y, id: 1 }]);
await shot('08-final.png');

// ── 4. the stick must not respond outside its region ───────────────────────────────────────────
const outside = { x: size.w * 0.8, y: size.h * 0.9 };
await touch('touchStart', [outside]);
await sleep(80);
const outsideState = await state();
await touch('touchEnd', [outside]);
check('a touch in the lower-RIGHT does not grab the stick', !outsideState.touchActive,
  `touchActive=${outsideState.touchActive}`);

check('no console errors during the whole run', consoleErrors.length === 0,
  consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : 'clean');

// The missed-frame signal has to be quiet on hardware that is coping, or it would ratchet every
// device down to low quality. This desktop is not the iPad, so this is a floor, not the gate.
const q = (await state()).quality;
const missedFraction = q.measuredGaps === 0 ? 0 : q.longGaps / q.measuredGaps;
diagnostic('the missed-frame signal stays quiet on hardware that is coping',
  missedFraction <= 0.05 && (await state()).qualityLevel === 'high',
  `${q.longGaps}/${q.measuredGaps} gaps over ${q.missedDeltaMs.toFixed(1)}ms `
  + `(${(missedFraction * 100).toFixed(1)}%), quality ${(await state()).qualityLevel}`,
  { authoritative: !hostedHeadless, reason: 'the hosted runner is frame-starved, so frame quality is not authoritative there' });

// ── 5. what the design's playing distance actually looks like ──────────────────────────────────
await page.eval('window.__galaQuestRuntime.follow.setDistance(16)');
await sleep(400);
const pulledBack = await state();
check('the zoom range can reach the design playing distance', pulledBack.distance > 15,
  `distance clamped to ${pulledBack.distance.toFixed(2)} (need ~16 for 87-107 CSS px)`);
await shot('09-playing-distance.png');
await page.eval('window.__galaQuestRuntime.follow.setDistance(3.8)');

// ── 6. rotating the device must re-aim the camera, not stretch the scene ───────────────────────
// Boot-time aspect is checked above; this is the other half, and the half a phone actually does. The
// scene should show MORE world horizontally in landscape, never a wider hero.
await page.send('Emulation.setDeviceMetricsOverride',
  { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await sleep(500);
const landscape = await page.eval(`JSON.stringify({
  w: innerWidth, h: innerHeight,
  aspect: window.__galaQuestRuntime.camera.aspect,
  fov: window.__galaQuestRuntime.camera.fov,
})`).then(JSON.parse);
check('rotating to landscape re-aims the camera instead of stretching it',
  Math.abs(landscape.aspect - landscape.w / landscape.h) < 1e-9 && landscape.fov === 42,
  `${landscape.w}x${landscape.h}: aspect ${landscape.aspect.toFixed(4)} `
  + `vs viewport ${(landscape.w / landscape.h).toFixed(4)}, vertical FOV ${landscape.fov}`);
await shot('10-landscape.png');
await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);

const final = await state();
console.log('\nfinal state:', JSON.stringify(final, null, 2));
// `results.length - failures` counted every DIAG as a pass, so this line read "26/26 checks passed"
// while three predicates had actually been VIOLATED and reported as not-judged. A summary must not
// re-tell the lie the individual lines were fixed to stop telling.
const passedCount = results.filter((r) => r.passed === true).length;
const diagCount = results.filter((r) => r.outcome === 'DIAG').length;
console.log(`\n${passedCount} PASS / ${failures} FAIL / ${diagCount} DIAG  (${results.length} checks)`);
writeFileSync(OUT + 'results.json', JSON.stringify({ results, consoleErrors, final }, null, 2));
await browser.send('Target.closeTarget', { targetId });
process.exit(failures ? 1 : 0);
