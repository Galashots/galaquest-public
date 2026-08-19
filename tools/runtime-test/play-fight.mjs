/**
 * Play the wolf fight with real synthetic touch, on an iPad viewport, and capture what it looks like.
 *
 *   node tools/runtime-test/play-fight.mjs
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * This is the mandatory playtest for the combat slice, in the form a machine can repeat. It is NOT a
 * substitute for the children playing it on the iPad: AGENTS.md is explicit that a feature is
 * validated by the children only when the children have played it. What this proves is narrower and
 * still worth having -- that the loop runs end to end in the real page, with real pointer events, and
 * that the frames along the way can be looked at.
 *
 * 768x1024 is the iPad portrait size the testers actually hold.
 *
 * SERVER OWNERSHIP (Phase Z1). This harness spawns its OWN `node server.mjs <port>` child from THIS
 * checkout, on a deterministic isolated port, and terminates only that child. It does not use, probe,
 * restart or kill port 5201.
 *
 * That is not tidiness, it is correctness, and it was measured. Against the shared 5201 dev server
 * this file failed 4 runs out of 4 on 2026-08-14, in two distinct ways:
 *
 *   1. "the wolf starts outside its aggro range" FAILED with `mode dead, clip death` on three
 *      consecutive runs. The wolf is server-authoritative and respawns 10s after death
 *      (WOLF_RESPAWN_SECONDS), so a run that starts within 10s of the PREVIOUS run's kill inherits a
 *      corpse. A harness whose first assertion is about fresh world state cannot share a world.
 *   2. Port 5201 was independently found to belong to a SIBLING WORKTREE
 *      (.claude/worktrees/phase-d-pre-brief-57bf29), so a run could be testing whichever checkout
 *      happens to own that port rather than the one it was launched from -- and `/src/main.js` was
 *      byte-identical between the two at the time, so nothing in the served content would have told
 *      you. A green run against the wrong tree looks exactly like a green run against the right one.
 *
 * The discipline itself now lives in ./owned-server.mjs, shared with every other harness in this
 * directory (Phase H1). It was written here first, locally, when it was fixing one file; nine more
 * harnesses needed the same thing, and nine copies is ~540 duplicated lines against GQ-007.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// The wire's own precision, imported rather than restated -- see WIRE_GAP_TOLERANCE_M below.
import { WIRE_POSITION_QUANTUM } from '../../public/src/net/protocol.js';
import {
  deadlineAfter,
  movementPulseMillis,
  pollUntilDeadline,
} from './automation-timing.mjs';
import { startOwnedServer } from './owned-server.mjs';
// A node process importing a runtime module directly, with no DOM and no three.js shim. That is the
// whole point of combat/encounter.js being pure, and this harness is the first thing to cash it in:
// two checks below used to hardcode `wolf.hp < 3` and would have started failing the moment the
// owner asked for a tougher wolf, reporting "tapping ATTACK does not damage the wolf" when the real
// change was a number going up.
import {
  MIN_BODY_SEPARATION,
  RESPAWN_SECONDS,
  SWING_CONTACT_SECONDS,
  SWING_SECONDS,
  WOLF_MAX_HP,
  canAttack,
} from '../../public/src/combat/encounter.js';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
const VIEWPORT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };

// How precisely this client is even ABLE to observe the authoritative separation, which is a
// property of the transport rather than of the rule.
//
// The wire rounds every position it carries to WIRE_POSITION_QUANTUM (protocol.js) before sending
// it. The server's own copies are exact, and separateFromWolf() clamps them to exactly
// MIN_BODY_SEPARATION; what arrives here is that truth snapped to a 1mm grid, twice and
// independently -- once for the hero, once for the wolf.
//
// So the worst a correct 1.000m separation can MEASURE as: each position can shift by up to half a
// quantum on each axis, i.e. hypot(q/2, q/2), and a distance between two such points can lose that
// much at each end. That is a bound DERIVED from the wire's own exported constant, not a threshold
// tuned until runs went green, and at 0.00141m it is 0.14% of the rule being checked -- so it cannot
// hide anything a child could see (the defect this check exists for measured 0.145m, a hundred times
// larger). Measured: the worst authoritative sample seen while building this sat at that bound.
//
// This was a restated literal until Phase R2 exported the quantum (GQ-007): the grid used to live as
// a bare `1000`, written out five times inside net/gameServer.mjs and nowhere a consumer could reach.
const WIRE_GAP_TOLERANCE_M = 2 * Math.hypot(WIRE_POSITION_QUANTUM / 2, WIRE_POSITION_QUANTUM / 2)
  + 1e-9; // a hair, so landing exactly on the bound is a pass rather than a knife-edge

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// Spawn and own the runtime server. Everything about how that is done -- probing a port by
// listening, skipping rather than killing an occupied one, spawning from the repo root, polling
// until it really serves, and the process-'exit' teardown backstop -- lives in owned-server.mjs.
const server = await startOwnedServer();
const RUNTIME_PORT = server.port;
const ORIGIN_UNDER_TEST = server.origin;
const URL_UNDER_TEST = server.url;

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

// The teardown backstop is registered inside startOwnedServer() above -- a process-level 'exit'
// handler, because this file exits through process.exit() and `process.exit()` skips a finally
// block while always running 'exit' handlers. The happy path below still awaits server.kill() so
// that termination is CONFIRMED and assertable rather than merely requested.

const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
const browser = new CDP(version.webSocketDebuggerUrl);
await browser.ready();

// Close any stale tab left sitting on THIS harness's URL by a crashed previous run before starting
// (drive-marks.mjs/drive-relight.mjs/drive-lifecycle.mjs's own self-cleaning discipline). Without it
// a leftover tab reconnects to the new server as a SECOND client and trips the players !== 1 bail
// below -- which would be a correct refusal to a problem this harness created for itself.
const existing = await browser.send('Target.getTargets');
for (const target of existing.targetInfos) {
  if (target.type === 'page' && target.url.startsWith(URL_UNDER_TEST)) {
    // eslint-disable-next-line no-await-in-loop
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

// Fresh-guest discipline (GQ-001 class: an assumption that "the next run starts clean" is exactly
// the kind of latency-shaped assumption that only breaks once authority crosses a process boundary
// -- here, the boundary between harness runs sharing one persistent automation profile). The
// automation Chrome on port 9224 is NOT reset between runs (README's launch command), so without
// this a stale `gq-guest-id` left in localStorage by an earlier run of THIS or any other
// tools/runtime-test/ harness survives into this one, and this harness plays a real fight and awards
// a real Lantern Mark against whatever guest that stale id names. That is not a hypothesis: Phase Y
// (the private engineering archive, deviation 3) measured 3 contaminating
// reward rows land on the RESERVED `relight-probe-guest-0001` identity this exact way, because this
// file did not yet clear storage before navigating and drive-relight.mjs's fixture guest happened to
// be the stale id an earlier play-fight.mjs run in the same session left behind. Wiped BEFORE the
// first navigation, cribbed verbatim from drive-village.mjs/drive-marks.mjs's own convention, so a
// fresh crypto.randomUUID() guestId is minted every run and this harness's kill can never again land
// on another harness's reserved probe identity.
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });

const consoleErrors = [];
// The URL is recorded alongside the text. Without it a browser resource error reads only as "Failed
// to load resource: the server responded with a status of 404 (Not Found)", which names neither the
// file nor the request -- and a mystery 404 appearing after an asset change costs real time to rule
// out as the cause of something else.
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

// index.html now declares a zero-network data-URI favicon (Task F1), so /favicon.ico no longer
// 404s and that entry is dropped -- an entry that can never match again is a stale claim, not a
// safety net (the same pruning drive-village.mjs already did).
//
// lantern_belt.glb (Phase D, brief D4) stays: the belt lantern ships on its own orchestrator/Meshy
// track, main.js's own graceful fallback is REQUIRED to keep the game playable without it (a
// labelled console.warn, not this Log-level 404), and this harness's automation Chrome profile is
// persistent (README.md's launch command) -- so a guest's marks earned in an earlier run of THIS or
// any other tools/runtime-test/ harness against the same profile could in principle survive. In
// practice the fresh-guest wipe just above means THIS harness never carries marks between runs of
// itself, but another harness's profile-wide state is not this file's to clear, so the entry stays
// as a defensive allowlist.
const COSMETIC_404_PATTERNS = ['/assets/gear/lantern_belt.glb'];

await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Page.navigate', { url: URL_UNDER_TEST });

let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) {
  await sleep(500);
  ready = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
}
if (!ready) throw new Error(`runtime never came up on ${URL_UNDER_TEST}`);
// The wolf is loaded after the hero, so its arrival needs its own wait.
let wolfUp = false;
for (let i = 0; i < 30 && !wolfUp; i += 1) {
  await sleep(400);
  wolfUp = await page.eval('Boolean(window.__galaQuestRuntime.wolf())');
}
check('the wolf loaded into the scene', wolfUp);

// Wait for authority before asserting anything about the fight. The wolf is SERVER-owned (Phase B),
// so until the socket is up `encounterState()` is still the client's own freshly-created local state
// -- which is trivially idle at full HP and would make the "wolf starts outside its aggro range"
// check below assert nothing at all. Every check in this file is meant to be about the authoritative
// fight, and this is the line that makes that true rather than assumed.
let online = false;
for (let i = 0; i < 40 && !online; i += 1) {
  await sleep(250);
  online = await page.eval("window.__galaQuestRuntime.netState().status === 'online'");
}
check('the client reaches the harness-owned server (the fight under test is the authoritative one)',
  online, `netStatus ${await page.eval('window.__galaQuestRuntime.netState().status')}, port ${RUNTIME_PORT}`);
if (!online) throw new Error(`never reached online against the harness-owned server on ${RUNTIME_PORT}`);

const players = await page.eval(`(() => {
  const m = (document.querySelector('#runtime-status')?.textContent ?? '').match(/players\\s+(\\d+)/i);
  return m ? Number(m[1]) : 1;
})()`);
if (players !== 1) {
  console.error(`${players} clients connected — close other tabs, the captures would show extra heroes`);
  await page.send('Target.closeTarget', { targetId });
  process.exit(2);
}

const touch = (type, points) => page.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});

async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}fight-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured fight-${name}.png`);
}

// The page publishes state; it does not hand out a handle on the rules. canAttack is then applied
// HERE, node-side, using the same pure function the game ships -- so this harness checks the real
// rule against the real state instead of trusting whatever the page says about itself.
//
// `heroPos` is the RENDERED hero -- the locally predicted position the child actually sees. `serverPos`
// is the AUTHORITATIVE one, straight off the latest snapshot (net/client.js's `latestSelf`, already
// published as netState().serverSelf for exactly this kind of measurement). The two are different
// numbers on purpose and the difference is the whole subject of the separation check below, so both
// are carried rather than one standing in for the other. No new runtime debug API was added for this:
// every field here was already published.
//
// Both positions come back at FULL PRECISION, rounded only where they are printed. They used to be
// .toFixed(3)'d in the page-side snippet below and it mattered: `wolf.x`/`wolf.z` arrive raw, so
// rounding only the hero's coordinates perturbed the computed gap by up to ~0.7mm, and a separation
// of exactly MIN_BODY_SEPARATION measured as 0.999m. That failed the rule check in 3 runs of 8 -- a
// harness artifact that looked exactly like a sub-millimetre gameplay violation, which is the most
// expensive kind of false failure to inherit.
const state = () => page.eval(`(() => {
  const r = window.__galaQuestRuntime;
  const published = r.encounterState();
  const net = r.netState();
  return JSON.stringify({
    wolf: { ...published.wolf }, hero: { ...published.hero }, revision: published.revision,
    clip: r.wolf()?.getState()?.clip ?? null,
    heroPos: [r.player.position.x, r.player.position.z],
    heading: r.follow.heading,
    serverPos: net.serverSelf ? [net.serverSelf.x, net.serverSelf.z] : null,
    netStatus: net.status,
    drift: net.drift,
    snapped: net.snapped,
    status: document.querySelector('#runtime-status').textContent,
  });
})()`).then(JSON.parse).then((published) => ({ ...published, canAttack: canAttack(published) }));

/** Centre-to-centre gap between the RENDERED hero and the published wolf. */
const renderedGap = (s) => Math.hypot(s.heroPos[0] - s.wolf.x, s.heroPos[1] - s.wolf.z);
/** Centre-to-centre gap between the AUTHORITATIVE hero and the published wolf, from one snapshot. */
const authoritativeGap = (s) => (s.serverPos === null
  ? null
  : Math.hypot(s.serverPos[0] - s.wolf.x, s.serverPos[1] - s.wolf.z));

// Centre of the attack button: 1rem inset plus half of its 112px.
const attackX = VIEWPORT.width - 68;
const attackY = VIEWPORT.height - 68;

async function tapAttack() {
  await touch('touchStart', [{ x: attackX, y: attackY }]);
  await sleep(50);
  await touch('touchEnd', []);
}

// Polls state() until `predicate` is true or `timeoutMs` elapses, then returns immediately -- for
// catching effects far shorter than this file's usual ~400ms per-swing cadence. WOLF_HIT_FLASH_SECONDS
// (0.18s) and the hero-hurt vignette (well under a second) both fade before a fixed sleep this coarse
// would ever check on them; a fixed sleep tuned to "usually about right" is exactly the kind of
// assumption AGENTS.md's "Look before you derive" warns against; polling for the actual state change
// is the equivalent of looking instead of guessing.
async function pollUntil(predicate, { intervalMs = 25, timeoutMs = 3000 } = {}) {
  return pollUntilDeadline(state, predicate, { intervalMs, timeoutMs });
}

// ── the loop ───────────────────────────────────────────────────────────────────────────────────
const start = await state();
check('the wolf starts outside its aggro range, so nobody is ambushed on load',
  start.wolf.mode === 'idle', `mode ${start.wolf.mode}, clip ${start.clip}`);
await shot('01-start');

// Deliberately thrown from 8+m away, against a 1.7m reach -- a guaranteed miss, with the wolf far too
// distant to be any part of the frame. Captures swing-missed's own feedback in isolation: the button
// must pulse a flat grey instead of its usual orange, and nothing on the wolf should move at all.
// Polling would have nothing to wait for here (hp never changes on a miss), so this uses a fixed
// delay timed to SWING_CONTACT_SECONDS (0.18s in combat/encounter.js) the same way the swing-windup/
// contact/follow sequence below does.
const beforeMiss = await state();
await tapAttack();
await sleep(200);
await shot('swing-miss');
const afterMiss = await state();
check('a swing thrown well outside reach is a miss, not silent damage',
  afterMiss.wolf.hp === beforeMiss.wolf.hp, `wolf hp ${beforeMiss.wolf.hp} -> ${afterMiss.wolf.hp}`);

// Walk at the wolf, steering. The first version of this pushed the stick straight up for four
// seconds and sailed past the wolf to z=13.4 while it chased from behind -- every swing then missed
// the arc, which looked exactly like a broken attack button and was not one.
//
// The stick claims the lower-left region and re-centres under the thumb. At follow.heading 0,
// screenToWorld() gives x = -screen.x and z = screen.y -- screen-RIGHT is world -X, because three.js
// builds the camera basis as x = up cross z. camera/rotation.js carries the scar from getting that
// backwards once already, and this harness got it backwards a second time, steering the hero to
// x=-13.4 while aiming for x=+2.5. The hero only turns while walking, so steering correctly also
// leaves the hero FACING the wolf, which the strike arc requires.
const stickX = VIEWPORT.width * 0.18;
const stickY = VIEWPORT.height * 0.86;
const STICK_PX = 56;

// `aim` is called fresh on EVERY iteration, with the just-polled state, and steers at whatever it
// returns THAT tick -- never a value captured once outside the loop. That distinction is the whole
// fix for the stale-position steering B4 measured (11-12/16, see the private engineering archive
// B-server-wolf/progress.md): the wolf is now server-authoritative and keeps moving on its own
// clock for the ~66ms round trip plus the up-to-2.5s this loop can run, so a target sampled once
// and held is aimed at where the wolf WAS, not where it IS. Re-deriving `aim(last)` every loop tick
// (the loop already re-polls `state()` every ~90ms regardless) means the touchMove direction --
// and therefore the heading the hero ends up facing, since the hero only turns while walking --
// tracks the wolf's live position continuously, which is what both closing the distance and lining
// up the attack's facing check actually need.
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
    // x is negated because screen-right is world -X; y because dragging the thumb UP is a negative
    // clientY delta and clampStick flips it back.
    // Steered RELATIVE TO THE LIVE CAMERA HEADING, not to a heading-0 assumption. The stick is
    // camera-relative (camera/rotation.js's screenToWorld), and this used to hardcode the identity
    // case -- correct only while the game happened to open at heading 0. The moment main.js aimed the
    // opening shot at the village, this harness steered the hero to the far corner of the map and
    // reported it as a movement failure. The rotation below reduces to exactly the old
    // `stickX - nx`, `stickY - nz` at heading 0.
    const cos = Math.cos(last.heading); const sin = Math.sin(last.heading);
    const sx = -cos * nx + sin * nz;
    const sy = sin * nx + cos * nz;

    // Release before observing. A slow Runtime.evaluate used to leave the stick held for the full
    // read latency, turning CI load into unbounded movement and stale facing. The pulse also gives a
    // close-range call one real movement frame to face the live wolf before the next attack.
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

const closed = await walkToward((live) => ({ x: live.wolf.x, z: live.wolf.z }), 1.2, 14000);
check('walking closes the distance to the wolf',
  Math.hypot(closed.heroPos[0] - closed.wolf.x, closed.heroPos[1] - closed.wolf.z) < 2.2,
  `hero ${closed.heroPos[0].toFixed(2)},${closed.heroPos[1].toFixed(2)} vs wolf ${closed.wolf.x.toFixed(2)},${closed.wolf.z.toFixed(2)}`);
const engaged = await pollUntil((s) => s.wolf.mode !== 'idle' || s.wolf.hp < WOLF_MAX_HP, { timeoutMs: 3000 });
check('the wolf noticed and came for the hero',
  engaged.wolf.mode !== 'idle' || engaged.wolf.hp < WOLF_MAX_HP,
  `mode ${engaged.wolf.mode}, clip ${engaged.clip}`);

// This harness walks the hero straight at the wolf while the wolf walks straight at the hero, which
// is the worst case for overlap and exactly what a child does on meeting a monster. Before
// separateFromWolf() existed the two measured 0.145m apart and the wolf was drawn through the hero's
// legs -- plain in the capture, invisible to every unit test, because no test knew where the two
// bodies actually were.
//
// WHY THIS SAMPLES INSTEAD OF READING ONE NUMBER (Phase Z1). This check used to be a single
// measurement taken at the instant walkToward() broke out of its loop, against a hand-fudged 0.95
// threshold, and it failed intermittently at 0.846-0.935m. The threshold was NOT the problem and was
// not lowered; the moment of measurement was.
//
// walkToward() breaks out of its loop with the thumb STILL ON THE STICK, and online the hero is
// locally predicted while the wolf is server-authoritative (main.js: the local separateFromWolf()
// push is deliberately skipped when netStatus === 'online', because the server already applies the
// rule and doing it twice would double-correct). So while a child holds the stick INTO the wolf, the
// client keeps integrating forward, the server keeps clamping its own copy back to
// MIN_BODY_SEPARATION, and net/client.js's reconcile() walks the difference off at NUDGE_FRACTION
// (10%) per snapshot at 10 Hz -- deliberately gradual, so the correction is invisible rather than a
// snatch. A rendered gap under the rule while the stick is held is therefore the DESIGNED steady
// state of a prediction being pulled back, not a body interpenetrating: it is what "hold the thumb
// down and lean on the monster" is supposed to look like for a few hundred milliseconds.
//
// The durable physical property -- the one a child could actually see and the one this check is
// named for -- is what happens once the thumb comes off. So: release (walkToward already did), poll
// until the rendered hero has converged onto the authority it is being pulled towards, and then
// assert the real rule, MIN_BODY_SEPARATION, imported rather than restated (GQ-007 -- the old 0.95
// was exactly the restated-and-then-fudged constant that rule exists to stop).
//
// Two checks come out of this, because there are two different questions and one number cannot
// answer both:
//   the RULE     -- did separateFromWolf() ever let go? Measured on the AUTHORITATIVE hero, at every
//                   sampled tick, against MIN_BODY_SEPARATION itself. Not allowed to fail once.
//   the PICTURE  -- was the prediction actually pulled back OUT, rather than left sitting inside the
//                   wolf? Measured as the RENDERED hero converging onto the authoritative one within
//                   a bounded time. Deliberately not a second distance threshold: given the rule
//                   check, convergence already implies the drawn gap, and restating that as its own
//                   number is how the deleted 0.95 got there in the first place.
// 6s. reconcile() closes the error by a documented 10% per snapshot at 10 Hz, so the slowest legal
// case -- a starting error at SNAP_DRIFT_UNITS (0.6m), the largest that is corrected gradually rather
// than snapped -- reaches CONVERGED_EPSILON in ln(0.03/0.6)/ln(0.9) ≈ 28 snapshots ≈ 2.8s. This is
// that bound with room, derived from client.js's own constants rather than picked by watching runs.
const SETTLE_TIMEOUT_MS = 6000;
// Converged means "the drawn hero is standing where the server says it is". 3cm: the two positions
// approach each other ASYMPTOTICALLY (each snapshot removes a tenth of what is left), so there is no
// epsilon-free way to say "arrived" and the only honest question is how close counts. 3cm is under a
// thirtieth of the 1m rule and roughly a tenth of the hero's own body width, so nothing that reads as
// interpenetration on screen can hide inside it -- and it is deliberately well clear of the old 0.95
// threshold, so that what this check implies about the rendered gap (>= 0.97m) cannot be mistaken for
// the fudged number this fix removed.
const CONVERGED_EPSILON = 0.03;
// The number the OLD one-shot check would have read, kept and reported on every run rather than
// discarded. It is the before half of this fix's before/after evidence, and it is the only way a
// future reader can tell "the flake stopped happening" from "the flake is still happening and is now
// being sampled correctly" -- which are very different facts about the game.
const gapAtRelease = renderedGap(closed);
const settleStartedAt = Date.now();
const settleSamples = [];
let settled = closed;
const settleSampleLimit = Math.ceil(SETTLE_TIMEOUT_MS / 100);
for (let settleSample = 0; settleSample < settleSampleLimit; settleSample += 1) {
  // eslint-disable-next-line no-await-in-loop
  const sample = await state();
  const rendered = renderedGap(sample);
  const authoritative = authoritativeGap(sample);
  // Stored raw for the same reason the positions are: the assertions below read these, and a value
  // rounded for a console column is not a value to assert on.
  settleSamples.push({
    atMs: Date.now() - settleStartedAt,
    rendered,
    authoritative,
    drift: sample.drift ?? 0,
    snapped: Boolean(sample.snapped),
    revision: sample.revision,
    wolfMode: sample.wolf.mode,
  });
  settled = sample;
  if (authoritative !== null && Math.abs(rendered - authoritative) <= CONVERGED_EPSILON) break;
  // eslint-disable-next-line no-await-in-loop
  await sleep(100);
}
console.log(`  SEPARATION  at movement release (the old one-shot measurement point): ${gapAtRelease.toFixed(3)}m rendered`);
console.log(`  SEPARATION  ${settleSamples.length} samples over ${Date.now() - settleStartedAt}ms after movement release`);
for (const s of settleSamples) {
  console.log(`    +${String(s.atMs).padStart(4)}ms  rendered ${s.rendered.toFixed(3)}m  authoritative ${s.authoritative === null ? '  n/a' : s.authoritative.toFixed(3)}m  drift ${s.drift.toFixed(3)}${s.snapped ? ' SNAPPED' : ''}  wolf ${s.wolfMode}  rev ${s.revision}`);
}

// Two sample classes are excluded, both because the measurement itself stops being coherent in
// them -- NOT to make anything pass. Neither occurred in any of the eight acceptance runs.
//
//   dead/dying -- separateFromWolf() returns the hero untouched once wolf.mode is 'dead' or 'dying',
//     deliberately (nothing should hold a child away from a corpse). Asserting a rule over the states
//     it explicitly excludes is how a check starts failing for a reason it was never about.
//   walk -- the two halves of the authoritative measurement can be ONE snapshot apart. `serverPos`
//     comes from net/client.js's `latestSelf`, set the instant a snapshot lands; `wolf` comes from
//     main.js's mirror of `serverEncounter`, refreshed at FRAME time. So a read landing between a
//     snapshot and the next frame pairs this snapshot's hero with the previous snapshot's wolf. That
//     skew is exactly zero unless the wolf moved between the two, and encounter.js assigns wolf.x/z
//     in precisely one place -- the `mode === 'walk'` branch of advancePartyFight. In every other
//     mode the wolf is stationary and the pairing is coherent however stale it is. In practice the
//     wolf stops approaching at WOLF_BITE_RANGE * 0.9 and walkToward() leaves the hero inside that,
//     so it is biting or idling here, never walking.
const coherentSamples = settleSamples.filter(
  (s) => s.authoritative !== null && s.wolfMode !== 'dead' && s.wolfMode !== 'dying' && s.wolfMode !== 'walk',
);
const worstAuthoritative = coherentSamples.length
  ? Math.min(...coherentSamples.map((s) => s.authoritative)) : null;
check('the RULE holds: the authoritative hero is never inside the wolf, at any sampled tick',
  coherentSamples.length > 0 && worstAuthoritative >= MIN_BODY_SEPARATION - WIRE_GAP_TOLERANCE_M,
  `worst of ${coherentSamples.length} coherent samples: ${worstAuthoritative === null ? 'n/a' : `${worstAuthoritative.toFixed(4)}m`} `
  + `against a ${MIN_BODY_SEPARATION}m rule less ${(WIRE_GAP_TOLERANCE_M * 1000).toFixed(2)}mm of wire quantisation`);

// The second half, and deliberately NOT a second distance threshold. Given the check above
// (authoritative >= MIN_BODY_SEPARATION) this one implies the rendered gap is >= 0.97m, so restating
// that as its own number would just reintroduce the fudged constant this fix deleted. What it adds
// that the rule check cannot is the thing the flake was actually about: that the prediction is pulled
// back OUT within a bounded time rather than left sitting inside the wolf. It fails if reconcile()
// ever stops closing the gap -- which is a real regression, and is what a child would see.
const settledRenderedGap = renderedGap(settled);
const settledAuthoritativeGap = authoritativeGap(settled);
const converged = settledAuthoritativeGap !== null
  && Math.abs(settledRenderedGap - settledAuthoritativeGap) <= CONVERGED_EPSILON;
check('the PICTURE settles: after movement release the drawn hero converges onto the authoritative one',
  converged,
  `${gapAtRelease.toFixed(3)}m at release -> settled ${settledRenderedGap.toFixed(3)}m rendered vs `
  + `${settledAuthoritativeGap === null ? 'n/a' : `${settledAuthoritativeGap.toFixed(3)}m`} authoritative `
  + `in ${settleSamples.length} samples / ${settleSamples.at(-1)?.atMs ?? 0}ms`
  + `${converged ? '' : ` -- NEVER CONVERGED within ${SETTLE_TIMEOUT_MS}ms`}`);
await shot('02-engaged');

// The gap that mattered most in the whole feature: previously a bitten hero got no feedback of any
// kind. This beat does not attack at all -- it only needs to stand within bite range and wait for the
// WOLF to act, then poll tightly enough to catch #hero-hurt-flash before its fade finishes.
const beforeBite = await state();
await walkToward((live) => ({ x: live.wolf.x, z: live.wolf.z }), 1.0, 4000, { faceTarget: true });
const biteState = await pollUntil((s) => s.hero.hp < beforeBite.hero.hp, { timeoutMs: 6000 });
await shot('hero-hurt-flash');
check('a wolf bite lands and the capture catches it while the hurt flash is still up',
  biteState.hero.hp < beforeBite.hero.hp, `hero ${beforeBite.hero.hp}hp -> ${biteState.hero.hp}hp`);

// Prove the control works before blaming the rules: one tap must start a swing.
//
// Polled, not a fixed sleep(50): that fixed wait is the exact same gotcha class the B5 scope
// amendment named -- it was sized when the attack was applied client-side, same frame, zero
// latency. Now the tap has to cross the wire, get applied server-side, and come back on the next
// snapshot: B4's diagnostics (the private engineering archive) measured that
// round trip at ~66ms, ABOVE the fixed 50ms window this check used to sample at. A one-off direct
// probe here (15 samples every 20ms after the tap, removed once this was confirmed) showed
// swingSeconds still -1 at 60ms and a real value by 80ms every time -- the swing was always
// starting, the wait was just shorter than the trip. Polling closes that gap without loosening the
// assertion itself: it is still exactly `swingSeconds >= 0`, just checked against a state that has
// had a fair chance to reflect the tap.
await touch('touchStart', [{ x: attackX, y: attackY }]);
const mid = await pollUntil((s) => s.hero.swingSeconds >= 0, { timeoutMs: 500 });
await touch('touchEnd', []);
check('tapping ATTACK starts a swing', mid.hero.swingSeconds >= 0,
  `swingSeconds ${mid.hero.swingSeconds}`);

// The hero swings with a procedural arc, because the rig ships no attack clip. From the chase camera
// that happens behind his back and cannot be judged, so orbit round to the front and shoot the swing
// there -- otherwise "the swing reads" is a claim with no evidence behind it. The orbit is a real
// drag, well above the stick region and clear of the attack button, so it exercises the same gesture
// a child uses.
async function orbitToFront() {
  const y = VIEWPORT.height * 0.3;
  const from = VIEWPORT.width * 0.16;
  await touch('touchStart', [{ x: from, y }]);
  for (let i = 1; i <= 20; i += 1) {
    await touch('touchMove', [{ x: from + (Math.PI / 0.006) * (i / 20), y }]);
    await sleep(25);
  }
  await touch('touchEnd', []);
}
// The swing photographs are taken AFTER the kill, not here. See photographTheSwing() at the end.
//
// They used to be taken at this point, and they were quietly worthless. The run reaches here with
// the hero already bitten down to 1hp and the wolf adjacent, orbitToFront() is a real drag lasting
// over half a second, and the wolf finished him mid-orbit every time -- so the attack tap that
// followed was refused, because a downed hero cannot swing, and three PNGs named windup/contact/
// follow were written showing a corpse under a "You went down..." banner. Every check still passed,
// because the swing assertion above ran against an EARLIER swing: the claim and the photograph were
// of different moments. Raising the wolf to 4hp lengthened the fight and made it near-certain, but
// the race was always there.
//
// Waiting for a gap does not fix it. At 1hp beside a live wolf there is no safe half-second. The
// only genuinely safe window is after the wolf is dead: nothing can bite, and no walking happens
// afterwards, so the orbit cannot break walkToward()'s assumption that the camera is at heading 0.

// Swing until the wolf is down or we run out of patience.
let killed = false;
let sawHit = false;
for (let swing = 0; swing < 40 && !killed; swing += 1) {
  // Wait for the hero to actually be free to swing again before re-tapping. The real ATTACK button
  // is gated on exactly this condition -- main.js drives attack.setReady(canAttack(encounterState))
  // -- so a child sees it grey out mid-swing and taps again within a couple hundred milliseconds of
  // it re-lighting, not on a fixed schedule of its own. This loop used to re-tap on a timer shorter
  // than SWING_SECONDS, landing mid the PREVIOUS swing, getting rejected by the server (a downed or
  // still-swinging hero cannot attack), and burning that whole iteration's poll doing nothing --
  // slower than any real player, and under real round-trip latency that was enough for the wolf's
  // own bite cycle to win races this fight was never meant to lose. RESPAWN_SECONDS bounds the wait
  // because the hero going down is the longest legitimate reason canAttack stays false.
  const before = await pollUntil((s) => s.canAttack, { timeoutMs: (RESPAWN_SECONDS + 0.5) * 1000 });
  // Re-close before each swing. The wolf backs off after a bite and the hero only turns while
  // walking, so without this the pair drift out of the strike arc and the fight stalls.
  const gap = Math.hypot(before.heroPos[0] - before.wolf.x, before.heroPos[1] - before.wolf.z);
  if (gap > 1.5 && before.wolf.mode !== 'dying' && before.wolf.mode !== 'dead') {
    await walkToward((live) => ({ x: live.wolf.x, z: live.wolf.z }), 1.2, 2500, { faceTarget: true });
  } else if (before.wolf.mode !== 'dying' && before.wolf.mode !== 'dead') {
    // The hero turns only while walking. Even inside reach, one short real-stick pulse keeps the
    // strike arc aimed at a wolf that moved around the hero during its bite cycle.
    await walkToward((live) => ({ x: live.wolf.x, z: live.wolf.z }), 1.2, 800, { faceTarget: true });
  }
  await touch('touchStart', [{ x: attackX, y: attackY }]);
  await sleep(60);
  await touch('touchEnd', []);
  // Polled, not a fixed sleep(420): that used to be how long this loop waited before even checking,
  // which is also why the old fight-04-defeated.png caught the wolf-defeated flash already faded --
  // see WOLF_DEFEAT_FLASH_SECONDS (0.5s) in combat/feedback.js. This loop's own re-closing above is
  // what makes it a reliable place to catch WOLF_HIT_FLASH_SECONDS (0.18s) too: a standalone one-shot
  // swing attempt does not get a second try if the wolf has drifted out of the strike arc, and one
  // did, silently eating an attack-cooldown window for nothing -- this loop already retries up to 40
  // times for exactly that reason, so it captures the hit flash as a side effect of the first landed
  // swing instead of duplicating the retry logic less robustly.
  const now = await pollUntil(
    (s) => s.wolf.mode === 'hit' || s.wolf.mode === 'dying' || s.wolf.mode === 'dead',
    // Derived from the rules, not a fixed 500ms. It WAS a fixed 500ms, chosen when contact happened
    // at 0.18s of a 0.45s swing. When the swing became the 1.5s sword_slash clip and contact moved to
    // 0.5167s, this window expired 17ms BEFORE the blow it exists to wait for could possibly land --
    // so the loop never saw a hit, tapped again while the hero was still mid-swing, had the tap
    // refused, and burned all 40 iterations. The harness reported "the wolf can actually be killed:
    // FAIL" against a game in which the wolf dies in 4.4 seconds.
    { intervalMs: 20, timeoutMs: (SWING_CONTACT_SECONDS + 0.4) * 1000 },
  );
  if (now.wolf.mode === 'hit' && !sawHit) await shot('wolf-hit-flash'); // first landed hit only
  if (now.wolf.mode === 'hit') sawHit = true;
  if (swing === 0) await shot('03-swing');
  killed = now.wolf.mode === 'dying' || now.wolf.mode === 'dead';
  // Captured at first detection, while the killing blow's flash is still up, rather than after this
  // loop exits -- the defeat flash is deliberately longer than the hit flash but still only 0.5s.
  if (killed) await shot('04-defeated');
}
const afterFight = await state();
check('tapping ATTACK damages the wolf', afterFight.wolf.hp < WOLF_MAX_HP,
  `wolf on ${afterFight.wolf.hp}hp of ${WOLF_MAX_HP}`);
check('a struck wolf plays its hit reaction', sawHit);
check('the wolf can actually be killed', killed, `mode ${afterFight.wolf.mode}`);

await sleep(2200);
const corpse = await state();
check('a dead wolf stays dead rather than looping its death',
  corpse.wolf.mode === 'dead' && corpse.clip === 'death', `mode ${corpse.wolf.mode}, clip ${corpse.clip}`);
await shot('05-corpse');

// ── the swing, photographed where it is safe to photograph it ───────────────────────────────────
// The wolf is dead, so nothing can interrupt the hero, and nothing walks after this so the orbit
// cannot break walkToward()'s heading-0 assumption. The swing lands on nothing, which is fine: what
// these three frames are evidence FOR is the shape of the arc, not that it does damage. Damage is
// already proven above, and the wolf-hit flash is captured mid-fight.
async function photographTheSwing() {
  const ready = await pollUntil((s) => s.hero.downSeconds < 0 && s.canAttack, { timeoutMs: 4000 });
  check('the hero is up and able to swing before the arc is photographed',
    ready.hero.downSeconds < 0 && ready.canAttack,
    `downSeconds ${ready.hero.downSeconds}, canAttack ${ready.canAttack}`);

  await orbitToFront();

  // ONE SWING PER FRAME, not three frames across one swing. Three-across-one is what this used to
  // do and it cannot work: a state() round trip plus a PNG encode costs well over 100ms, so the
  // first frame aimed at 110ms actually landed at 200ms and the remaining two arrived after the
  // 0.45s swing had already ended, photographing a hero standing still. Re-swinging per frame costs
  // a second of wall clock each and buys frames that are actually where they claim to be.
  //
  // Each frame records the state it was TAKEN in, and the run fails if the picture does not contain
  // what its filename claims. A capture that silently shows the wrong thing is worse than no
  // capture: it is evidence pointing the wrong way, read by people who trust the name on it.
  // FRACTIONS OF THE SWING, not fixed milliseconds. These were 30/130/250ms, tuned by hand against a
  // 0.45s swing. When SWING_SECONDS became 1.5s all three landed inside the first 12% of the arc --
  // three near-identical frames, which the spread check below caught immediately. Deriving them from
  // the constant means they follow it, and 'contact' is aimed at the moment the rules actually apply
  // damage rather than at a number that once happened to be near it.
  //
  // Each target is pulled earlier by the round trip a state() read plus a PNG encode costs, because
  // the frame lands at the sleep PLUS that latency, not at the sleep.
  const LATENCY_MS = 90;
  const at = (seconds) => Math.max(0, Math.round(seconds * 1000) - LATENCY_MS);
  const frames = [];
  for (const [label, atMillis] of [
    ['windup', at(SWING_CONTACT_SECONDS * 0.35)],
    ['contact', at(SWING_CONTACT_SECONDS)],
    ['follow', at(SWING_SECONDS * 0.62)],
  ]) {
    const armed = await pollUntil((s) => s.canAttack, { timeoutMs: 3000 });
    if (!armed.canAttack) break;
    await touch('touchStart', [{ x: attackX, y: attackY }]);
    await sleep(40);
    await touch('touchEnd', []);
    await sleep(atMillis);
    const at = await state();
    await shot(`swing-${label}`);
    frames.push({ label, swingSeconds: at.hero.swingSeconds, down: at.hero.downSeconds >= 0 });
  }
  check('the swing frames actually caught a swing, rather than whatever came next',
    frames.length === 3 && frames.every((frame) => frame.swingSeconds >= 0 && !frame.down),
    frames.map((f) => `${f.label} ${f.swingSeconds.toFixed(3)}s${f.down ? ' DOWN' : ''}`).join(', '));
  // Three frames that all caught the same instant would pass the check above and still be useless as
  // evidence of an arc.
  const spread = Math.max(...frames.map((f) => f.swingSeconds)) - Math.min(...frames.map((f) => f.swingSeconds));
  check('the three frames are spread across the swing rather than three copies of one instant',
    frames.length === 3 && spread > SWING_SECONDS * 0.3, `spread ${spread.toFixed(3)}s of ${SWING_SECONDS}s`);
}
await photographTheSwing();

// Split rather than filtered, so a known-missing asset is reported as itself instead of either
// failing the run or vanishing from it.
const isCosmetic404 = (text) => COSMETIC_404_PATTERNS.some((pattern) => text.includes(pattern));
const cosmeticErrors = consoleErrors.filter(isCosmetic404);
const realErrors = consoleErrors.filter((text) => !isCosmetic404(text));
check('no console errors during the whole fight', realErrors.length === 0,
  realErrors.slice(0, 3).join(' | '));
if (cosmeticErrors.length) {
  console.log(`  NOTE  ${cosmeticErrors.length} known-missing-asset 404(s) (favicon and/or lantern_belt.glb) -- not a failure; see CURRENT_STATE.`);
}

// ── the harness terminates only what it created ───────────────────────────────────────────────────
// Tab first, then the server: closing the page before killing its authority means the client never
// gets a chance to log its own reconnect failures, so the console-error check above stays a check
// about the GAME rather than one that has to special-case this harness's own teardown.
await page.send('Target.closeTarget', { targetId });
const serverKillConfirmed = await server.kill();
check('the harness terminated its own server child, and nothing else',
  serverKillConfirmed && server.exited,
  // Both, because a signalled child reports exitCode null -- printing only exitCode makes a perfectly
  // clean SIGTERM teardown read like a process that vanished without telling anyone why.
  `pid ${server.child.pid} on port ${RUNTIME_PORT}, exitCode ${server.child.exitCode}, signal ${server.child.signalCode}`);

writeFileSync(`${OUT}fight-results.json`,
  JSON.stringify({
    results, consoleErrors, port: RUNTIME_PORT, serverPid: server.child.pid,
    separation: {
      minBodySeparationRule: MIN_BODY_SEPARATION,
      gapAtRelease, settleSamples,
      settledRenderedGap, settledAuthoritativeGap, converged,
    },
    start, closed, settled, afterFight, corpse,
  }, null, 2));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
