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
import {
  readWatchSource, READ_WALK, startWalk, startWatch, STOP_WALK, stopWatchSource, waitForSample,
} from './in-page-driver.mjs';
// A node process importing a runtime module directly, with no DOM and no three.js shim. That is the
// whole point of combat/encounter.js being pure, and this harness is the first thing to cash it in:
// two checks below used to hardcode `wolf.hp < 3` and would have started failing the moment the
// owner asked for a tougher wolf, reporting "tapping ATTACK does not damage the wolf" when the real
// change was a number going up.
import {
  ATTACK_REACH,
  MIN_BODY_SEPARATION,
  HERO_MAX_HP,
  RESPAWN_SECONDS,
  SWING_CONTACT_SECONDS,
  SWING_SECONDS,
  WOLF_MAX_HP,
  // The world's own respawn delay, so the landscape pass at the end waits exactly as long as the
  // rules say a new wolf takes -- not a guessed sleep that goes stale the day that number moves.
  WOLF_RESPAWN_SECONDS,
  canAttack,
} from '../../public/src/combat/encounter.js';
// Aiming the world camera at something, so a capture can be made to CONTAIN the thing it is
// evidence about. Imported rather than re-deriving atan2 by hand in a harness.
import { headingToward } from '../../public/src/world/zoneLoader.js';

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
// `let`, not `const`: the landscape sanity pass at the end of this file rotates the viewport, and
// every touch coordinate in this harness is derived from the viewport's own size. A const here is
// how a landscape pass ends up tapping empty grass 200px from the button it meant to press.
let attackX = VIEWPORT.width - 68;
let attackY = VIEWPORT.height - 68;

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
// must show its miss state, and nothing on the wolf should move at all.
//
// GP1-C5 FIX. This used to `sleep(200)` and shoot, with a comment saying 200ms was "timed to
// SWING_CONTACT_SECONDS (0.18s)". SWING_CONTACT_SECONDS is 0.5167s and has been since the 1.5s
// sword_slash clip landed -- the same stale 0.18 that the comment 100 lines below already had to be
// corrected for. So this capture fired 317ms BEFORE the miss it is named after could possibly be
// raised, and every fight-swing-miss.png ever committed shows a hero mid-windup next to an ordinary
// orange button. The miss feedback had never once been photographed, which is exactly how it stayed
// weak enough to need this phase.
//
// Polled on the button's OWN state rather than re-derived from a duration: the capture now cannot be
// taken unless the thing it claims to show is on screen. `pollUntil` works on state(), so this uses
// a small dedicated poll on the DOM attribute main.js sets.
const beforeMiss = await state();
// The wolf has to be IN the frame for this capture to say what it claims. The original beat threw
// the miss with the wolf far behind the camera, which proves "no damage" in the state JSON but shows
// a picture of an empty field -- "the wolf is untouched" and "the wolf is not here" look identical.
// So the camera is aimed at it first: still 8+m away, still a guaranteed miss against a 1.7m reach,
// still not aggroed (the run's first check is that it starts outside its aggro range), but now
// visibly standing there not reacting. Distance is untouched -- this stays the real play camera.
await page.eval(`window.__galaQuestRuntime.follow.setHeading(${headingToward(
  beforeMiss.heroPos[0], beforeMiss.heroPos[1], beforeMiss.wolf.x, beforeMiss.wolf.z,
)})`);
await sleep(400);
await tapAttack();
const missFeedback = await (async () => {
  const deadline = deadlineAfter(3000);
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const shown = await page.eval(
      "document.querySelector('#attack-button')?.dataset.feedback ?? ''",
    );
    if (shown === 'miss') return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(25);
  }
  return false;
})();
await shot('swing-miss');
check('the miss capture actually contains the miss feedback, rather than a hero still winding up',
  missFeedback, 'the attack button never entered its miss state within 3s of the tap');
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
let stickX = VIEWPORT.width * 0.18;
let stickY = VIEWPORT.height * 0.86;

// The other orientation a child holds the iPad in. Combat is a 3D effect and mostly orientation-
// blind, but the HUD around it is not -- the miss ring hangs off a button that moves, and the
// hero-down bar is sized in vw against a frame that changes shape.
const LANDSCAPE_VIEWPORT = { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true };

async function useViewport(viewport) {
  await page.send('Emulation.setDeviceMetricsOverride', viewport);
  attackX = viewport.width - 68;
  attackY = viewport.height - 68;
  stickX = viewport.width * 0.18;
  stickY = viewport.height * 0.86;
  // A beat for the resize to reach the renderer and for CSS media queries to re-evaluate before
  // anything is tapped or photographed against the new layout.
  await sleep(500);
}
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
// A BITE IS A DECREASE BETWEEN TWO FRAMES, not a difference between two point reads.
//
// Comparing a reading from before the walk against one taken after it straddles whatever happened
// in between -- including a knockdown and the respawn that follows it, which puts the hero back on
// full hearts. Seen locally: `hero 0hp -> 0hp`, because the walk into range took long enough for
// him to be knocked out before the comparison even started, and `hp < 0` is not reachable. The
// recorder makes the claim directly: at some frame, the hero had fewer hearts than he had on the
// frame before. That is what a bite landing IS, and no respawn can forge it.
await page.eval(startWatch('bite', '({ hp: window.__galaQuestRuntime.encounterState().hero.hp })'));
await walkToward((live) => ({ x: live.wolf.x, z: live.wolf.z }), 1.0, 4000, { faceTarget: true });
const bitten = await waitForSample(page, 'bite', (sample, index, all) =>
  index > 0 && sample.hp < all[index - 1].hp, { timeoutMs: 12000 });
await page.eval(stopWatchSource('bite'));
await shot('hero-hurt-flash');
const bites = bitten.samples.filter((sample, index) => index > 0 && sample.hp < bitten.samples[index - 1].hp);
check('a wolf bite lands and the capture catches it while the hurt flash is still up',
  bites.length > 0,
  `${bitten.frames} frames recorded, ${bites.length} bite(s) seen, hearts `
    + `${bitten.samples[0]?.hp} -> ${bitten.samples[bitten.samples.length - 1]?.hp}`);

// ── GP1-C5: being knocked out, photographed ─────────────────────────────────────────────────────
//
// The fifth combat state, and the only one this harness had no picture of at all -- so "you went
// down" was shipped, reviewed and re-reviewed without anybody once looking at what it does to the
// screen. It did almost nothing: a banner, for 1.6s, over an otherwise normal-looking game with a
// dimmed ATTACK button. A child mashing that button has no way to tell that from the button having
// broken, which is the specific failure this phase was commissioned to fix.
//
// Reached by simply CONTINUING to stand there. The beat above already walked into bite range and
// took one bite without attacking; three bites is a knockout at HERO_MAX_HP 3, so this needs no new
// technique and no forced state -- just patience, which is also exactly how a real child gets
// knocked out. Nothing here touches the rules: the wolf does it.
// THE WHOLE KNOCKDOWN IS RECORDED, then judged -- because the thing being asserted is a state that
// lasts RESPAWN_SECONDS (2s) and the reads that used to judge it cost two frames.
//
// The veil is event-driven: main.js raises it on `hero-down` and drops it on `hero-respawned`, so
// it is up for the whole two seconds. Judging that with a point read meant detecting the knockdown
// late (measured: first seen at downSeconds 1.104, because the poll that found it was itself
// frame-blocked) and then spending another ~308ms round trip on heroDownShown() -- arriving at
// ~1.7s of a 2.0s window, and sometimes after it. That is why this check failed in portrait and
// passed in landscape in the SAME run: landscape happened to catch the knockdown at 0.05s.
//
// Recording is also a stronger claim than the one it replaces. "The veil was up at one instant"
// becomes "the veil was up on EVERY frame the hero was down, and down on the frame he stood up",
// which is what the promise actually is.
await page.eval(startWatch('knockdown', `({
  downSeconds: window.__galaQuestRuntime.encounterState().hero.downSeconds,
  hp: window.__galaQuestRuntime.encounterState().hero.hp,
  veil: window.__galaQuestRuntime.heroDownShown(),
})`));
const knockedOut = await waitForSample(page, 'knockdown', (sample) => sample.downSeconds >= 0,
  { intervalMs: 40, timeoutMs: 25000 });
await shot('hero-down');
const downFrames = knockedOut.samples.filter((sample) => sample.downSeconds >= 0);
check('the hero can actually be knocked out by standing and taking bites',
  downFrames.length > 0, `${knockedOut.frames} frames recorded, `
    + `${downFrames.length} of them down; lowest hp `
    + `${knockedOut.samples.reduce((low, sample) => Math.min(low, sample.hp), HERO_MAX_HP)}`);

// And the other half of the promise: it has to end, visibly, on its own. A veil that outlived the
// rules would be worse than no veil -- the child would be looking at a knocked-out screen while
// holding a hero who can already swing.
// `since` matters here and its absence cost a run: the log is a history, so "the hero is back up"
// was satisfied by a frame from before he ever went down.
const firstDownIndex = knockedOut.samples.findIndex((sample) => sample.downSeconds >= 0);
const stoodUp = await waitForSample(page, 'knockdown',
  (sample) => sample.downSeconds < 0 && sample.hp > 0,
  { intervalMs: 40, timeoutMs: 8000, since: firstDownIndex + 1 });
await page.eval(stopWatchSource('knockdown'));
const episode = stoodUp.samples;
const firstDown = episode.findIndex((sample) => sample.downSeconds >= 0);
const veilOffWhileDown = episode.filter((sample) => sample.downSeconds >= 0 && sample.veil !== true);
check('going down puts the WHOLE SCREEN into the knocked-out state, not just a banner that fades',
  firstDown >= 0 && veilOffWhileDown.length === 0,
  `${episode.filter((sample) => sample.downSeconds >= 0).length} down frame(s), `
    + `${veilOffWhileDown.length} of them with the veil already gone`);
const backUpAt = episode.findIndex((sample, index) => index > firstDown && sample.downSeconds < 0);
check('the hero gets back up on his own', firstDown >= 0 && backUpAt > firstDown,
  `down at frame ${firstDown}, up at frame ${backUpAt} of ${episode.length}`);
const veilAfterStanding = episode.slice(backUpAt).filter((sample) => sample.veil === true);
check('and the knocked-out state clears when he does, rather than outliving the rules',
  backUpAt > 0 && veilAfterStanding.length === 0,
  `${episode.length - backUpAt} frame(s) after standing up, `
    + `${veilAfterStanding.length} of them still veiled`);

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
// RECORDED PER FRAME, not polled. The 500ms budget this replaces was itself a fix for a fixed
// sleep(50), and it was right about the cause -- the tap has to cross the wire and come back -- but
// it sized the answer on a machine where a frame is 17ms. The full latency is one frame to sample
// the button, ~66ms on the wire, and one more frame to publish the result. At 60fps that is 100ms
// and 500 is generous; at 3fps it is about 730ms and 500 cannot be met, which is why this check
// failed hosted and locally while the very next one -- "tapping ATTACK damages the wolf" -- passed
// against the same tap. The assertion is unchanged and still exactly `swingSeconds >= 0`; what
// changed is that a recorder inside the page holds every frame, so a slow read delays the answer
// instead of missing the event. The window is two whole swings, taken from the rules rather than
// from a stopwatch: a swing that has not begun within that has not begun.
await page.eval(startWatch('swing-start', '({ swingSeconds: window.__galaQuestRuntime.encounterState().hero.swingSeconds })'));
await touch('touchStart', [{ x: attackX, y: attackY }]);
const swingStart = await waitForSample(page, 'swing-start', (sample) => sample.swingSeconds >= 0,
  { timeoutMs: SWING_SECONDS * 2 * 1000 });
await touch('touchEnd', []);
await page.eval(stopWatchSource('swing-start'));
const startedSwinging = swingStart.samples.filter((sample) => sample.swingSeconds >= 0);
check('tapping ATTACK starts a swing', startedSwinging.length > 0,
  `${swingStart.frames} frames recorded, best swingSeconds `
    + `${swingStart.samples.reduce((best, sample) => Math.max(best, sample.swingSeconds), -1)}`);

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

// SWING ON THE RULES' OWN CLOCK, AND LET A PER-FRAME RECORDER SAY WHAT HAPPENED.
//
// What this replaces polled live state twice per iteration -- once for canAttack, once for the
// wolf's reaction -- and measured 7.5 SECONDS between swings against a rule that allows one every
// SWING_SECONDS (1.5s, with ATTACK_COOLDOWN_SECONDS at 0). That gap is the whole failure, and the
// timeline makes the mechanism plain. Design ruling 5 resets the wolf to full health whenever the
// party wipes, and a solo hero wipes every time he goes down. Recorded here: the hero survives
// about nine seconds of biting, lands roughly ONE hit per life at a 7.5s cadence, and every
// knockdown healed the wolf back to 3hp -- four times in one run. The harness reported "the wolf
// can actually be killed: FAIL" against a fight that is winnable in three swings and 4.5 seconds.
// Nothing was wrong with the game; the loop was simply slower than the rules it was testing.
//
// The dead time was observation. On a browser painting at 3-10fps a Runtime.evaluate waits on the
// main thread, so `intervalMs: 20` really samples every ~300ms -- and the state it was waiting for,
// WOLF_HIT_FLASH_SECONDS, lives 0.18s. It was polling for something narrower than the gap between
// its own samples, then spending the rest of a 916ms budget failing to see it.
//
// So observation moves into the page (in-page-driver.mjs) where it costs nothing and cannot be too
// slow, and the taps go out on a clock derived from the rules instead of from a round trip. The
// cadence is SWING_SECONDS plus ONE MEASURED FRAME of this machine's own pace: a tap landing one
// frame after the swing ends is accepted, and a tap that lands early is refused harmlessly. Taps go
// out in bursts, with the recorder read between bursts rather than between taps, so the read cost
// stays out of the cadence entirely.
const FIGHT_SAMPLE = `(() => {
  const runtime = window.__galaQuestRuntime;
  const published = runtime.encounterState();
  return {
    t: Math.round(performance.now()),
    heroHp: published.hero.hp,
    downSeconds: published.hero.downSeconds,
    swingSeconds: published.hero.swingSeconds,
    wolfMode: published.wolf.mode,
    wolfHp: published.wolf.hp,
    // So the loop can tell "in the strike arc" from "the wolf backed off", without a second read.
    gap: Math.hypot(runtime.player.position.x - published.wolf.x,
      runtime.player.position.z - published.wolf.z),
  };
})()`;
await page.eval(startWatch('fight', FIGHT_SAMPLE));

// The page's own pace, measured rather than assumed -- the same posture drive-village.mjs uses for
// its animation budget. A second of recording is plenty: at 3fps that is three samples, and at
// 60fps it is sixty.
await sleep(1000);
const readFight = () => page.eval(readWatchSource('fight')).then(JSON.parse);
const paced = await readFight();
const gaps = paced.samples.slice(1).map((sample, index) => sample.t - paced.samples[index].t);
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
// instinct. The recorder is read every few taps rather than every one, so noticing the kill stays
// prompt without paying a round trip per press.
const framePeriodMs = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 17;
const tapEveryMs = framePeriodMs;
console.log(`  fight cadence: frame ${framePeriodMs}ms, tapping every ${tapEveryMs}ms`);

// Four taps per burst is one hero life's worth at this cadence, so a burst that starts while he is
// down loses only itself and the next one re-syncs. Ten bursts is the same 40 attempts this loop
// has always allowed.
// RE-CLOSE BEFORE EVERY SWING, INSIDE THE CADENCE RATHER THAN INSTEAD OF IT.
//
// The loop this grew from dropped the re-close, and the comment it dropped said exactly why it was
// there: the wolf backs off after a bite, and the hero only turns while walking, so without it the
// pair drift out of the strike arc and the fight stalls. Locally that cost nothing -- the wolf
// stayed in front and the fight was won in three swings. Hosted at e68cf54 it cost everything:
// `hero knocked down 14x`, `wolf reached 1hp`, 582 frames. Two hits a life, needing three, over and
// over, because Design ruling 5 healed the wolf on every knockdown.
//
// So it comes back, but as a HELD walk on the wolf's live position rather than the pulsed one, and
// the time it takes is subtracted from the gap before the next tap instead of added to it. When the
// hero is already in reach the walker latches on its first frame and the whole thing is a short
// nudge -- which is all that is needed, since turning is what it is for. The cadence stays at
// SWING_SECONDS plus a frame either way, which is what decides whether three hits fit in one life.
// THE RE-CLOSE PULSES UNLESS THERE IS REAL GROUND TO COVER, and getting that the wrong way round
// cost a hosted round. A held walk cannot stop on a mark -- the release costs a poll and a round
// trip while authority keeps walking, which at a full-deflection stick is a metre and a half. Ask
// it to stop at 1.0m from the wolf and it hands back a hero 2.5m away: outside ATTACK_REACH, so the
// swing that follows hits nothing. Hosted at 3c43815 that read as `hero knocked down 16x, wolf
// reached 1hp` over 965 frames, with the re-close present and doing harm.
//
// So the pulsed walker does the re-close. It is slow per metre and exact, and exact is what matters
// here: the wolf brings itself to about a metre, and what the walk is really for is turning the
// hero, since he only turns while moving. The held walk is kept for the one case with actual
// distance in it -- coming back from a knockdown, which respawns him at spawn.
const WOLF_TARGET = '(() => { const w = window.__galaQuestRuntime.encounterState().wolf; return { x: w.x, z: w.z }; })()';
const HELD_APPROACH_SLACK_METRES = 3;
async function heldLegToWolf(stopWithin, maxMillis) {
  await page.eval(startWalk(WOLF_TARGET, stopWithin));
  await touch('touchStart', [{ x: stickX, y: stickY }]);
  await touch('touchMove', [{ x: stickX, y: stickY - STICK_PX }]);
  try {
    await pollUntilDeadline(() => page.eval(READ_WALK).then(JSON.parse),
      (next) => next?.arrived, { intervalMs: 100, timeoutMs: maxMillis });
  } finally {
    await touch('touchEnd', []);
    await page.eval(STOP_WALK);
  }
}
async function closeOnWolf(gapMetres, stopWithin) {
  if (gapMetres > stopWithin + HELD_APPROACH_SLACK_METRES) {
    await heldLegToWolf(stopWithin + HELD_APPROACH_SLACK_METRES, 8000);
  }
  await walkToward((live) => ({ x: live.wolf.x, z: live.wolf.z }), stopWithin, 900,
    { faceTarget: true });
}

// ONE READ PER TAP, not per burst. Reading in bursts of four was cheaper and it broke the check
// after this one: the kill went unnoticed for up to four cadences, and WOLF_RESPAWN_SECONDS is 10s,
// so `a dead wolf stays dead` arrived at the corpse after it had already got back up. At this
// cadence a read is about a sixth of the cycle even where a round trip costs a whole frame, which
// is a price worth paying to notice the kill within one swing of it happening.
let killed = false;
let sawHit = false;
let shotSwing = false;
let lastGap = 0;
// WHAT THE LOOP SPENDS ITS FIGHT ON IS ROUND TRIPS, so the tap path has as few as it can. Walking
// before every swing was measured at 4.4 SECONDS a tap in drive-marks -- against a hero who is
// knocked down every nine or ten seconds, and a wolf that Design ruling 5 heals to full each time.
// The gap log said the repositioning was not even needed: every swing went out from between 1.0m
// and 1.6m, inside ATTACK_REACH, because the wolf brings itself to MIN_BODY_SEPARATION and stays
// there. So the tap path is two touches and nothing else, and the walk happens only when the
// recorder says the hero is actually out of reach -- which is what a knockdown does, since
// respawning puts him back at spawn.
const REACH_CHECK_EVERY = 4;
for (let tap = 0; tap < 200 && !killed; tap += 1) {
  const cycleStart = Date.now();
  // eslint-disable-next-line no-await-in-loop
  await touch('touchStart', [{ x: attackX, y: attackY }]);
  // eslint-disable-next-line no-await-in-loop
  await sleep(60);
  // eslint-disable-next-line no-await-in-loop
  await touch('touchEnd', []);
  if (!shotSwing) {
    shotSwing = true;
    // Mid-swing by construction: the clip runs SWING_SECONDS and this is the frame after the tap.
    // eslint-disable-next-line no-await-in-loop
    await shot('03-swing');
  }
  // eslint-disable-next-line no-await-in-loop
  await sleep(Math.max(0, tapEveryMs - (Date.now() - cycleStart)));
  if (tap % REACH_CHECK_EVERY !== 0) continue;
  // eslint-disable-next-line no-await-in-loop
  const log = await readFight();
  sawHit = log.samples.some((sample) => sample.wolfMode === 'hit');
  killed = log.samples.some((sample) => sample.wolfMode === 'dying' || sample.wolfMode === 'dead');
  lastGap = log.samples[log.samples.length - 1]?.gap ?? 0;
  // eslint-disable-next-line no-await-in-loop
  if (!killed && lastGap > ATTACK_REACH) await closeOnWolf(lastGap, 1.0);
}
const fight = await readFight();
await page.eval(stopWatchSource('fight'));
// The recorder is the evidence for both of these, so report what it actually saw. `dropped` is
// printed because a truncated log that reads as complete is how a harness says "never happened"
// about something it merely stopped watching.
const lowestWolfHp = fight.samples.reduce((low, sample) => Math.min(low, sample.wolfHp), WOLF_MAX_HP);
const knockdowns = fight.samples.filter((sample, index) =>
  sample.downSeconds >= 0 && !(fight.samples[index - 1]?.downSeconds >= 0)).length;
console.log(`  fight: ${fight.frames} frames, ${fight.dropped} dropped, wolf reached ${lowestWolfHp}hp, `
  + `hero knocked down ${knockdowns}x`);
// Best-effort, and only best-effort on a starved runner: WOLF_HIT_FLASH_SECONDS is 0.18s and a
// screenshot round trip is longer than that below ~10fps. The CHECK above reads the recorder, which
// cannot miss it; this is the picture, which can.
if (sawHit) await shot('wolf-hit-flash');
if (killed) await shot('04-defeated');

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

// ── landscape sanity pass ────────────────────────────────────────────────────────────────────────
//
// Everything above is portrait, which is how the iPad is held most of the time and therefore where
// the evidence that matters lives. This is the other way it gets held, and it is a SANITY pass, not
// a second full matrix: the impact effects are 3D and cannot care which way the frame is, but the
// chrome wrapped around them can -- the miss ring hangs off a button that moves to a different
// corner, and the hero-down bar is sized against the frame's width.
//
// The wolf respawns WOLF_RESPAWN_SECONDS after it dies (world rules, not this harness's doing), so
// this waits for a live one rather than forcing anything.
await useViewport(LANDSCAPE_VIEWPORT);
const respawned = await pollUntil((s) => s.wolf.mode !== 'dead' && s.wolf.hp > 0,
  { intervalMs: 200, timeoutMs: (WOLF_RESPAWN_SECONDS + 6) * 1000 });
check('landscape: a fresh wolf is back to fight, rather than this pass photographing a corpse',
  respawned.wolf.mode !== 'dead' && respawned.wolf.hp > 0,
  `mode ${respawned.wolf.mode}, hp ${respawned.wolf.hp}`);

// MISS, in landscape. Thrown from wherever the hero is standing after the swing photographs, which
// is well outside reach of a wolf that has only just reappeared at its own spawn.
// RECORDED, not polled. The miss ring is a pulse cleared on a timer matching its own keyframe, and
// a loop written `sleep(25)` really samples every ~300ms on a starved runner -- so it was looking
// less often than the thing it was looking for lasts. It failed hosted at 45ae179 and again locally
// in one run out of three. The recorder holds every frame from before the tap, so the pulse is in
// the log whether or not anyone was looking; the assertion is unchanged.
await page.eval(startWatch('miss-ring',
  "({ feedback: document.querySelector('#attack-button')?.dataset.feedback ?? '' })"));
await tapAttack();
const missRing = await waitForSample(page, 'miss-ring', (sample) => sample.feedback === 'miss',
  { intervalMs: 60, timeoutMs: 3000 });
await page.eval(stopWatchSource('miss-ring'));
const landscapeMissShown = missRing.samples.some((sample) => sample.feedback === 'miss');
await shot('landscape-swing-miss');
check('landscape: the miss ring is thrown from the button in its new corner too',
  landscapeMissShown, `attack button miss state seen: ${landscapeMissShown}`);

// HIT, in landscape.
await walkToward((live) => ({ x: live.wolf.x, z: live.wolf.z }), 1.2, 15000, { faceTarget: true });
let landscapeHit = false;
for (let attempt = 0; attempt < 30 && !landscapeHit; attempt += 1) {
  // eslint-disable-next-line no-await-in-loop
  await tapAttack();
  // eslint-disable-next-line no-await-in-loop
  const after = await pollUntil((s) => s.wolf.mode === 'hit' || s.wolf.mode === 'dying' || s.wolf.mode === 'dead',
    { intervalMs: 20, timeoutMs: (SWING_CONTACT_SECONDS + 0.4) * 1000 });
  landscapeHit = after.wolf.mode === 'hit';
  if (landscapeHit) await shot('landscape-wolf-hit-flash');
  if (after.wolf.mode === 'dying' || after.wolf.mode === 'dead') break;
}
check('landscape: a landed hit was photographed', landscapeHit,
  `wolf caught in its hit reaction: ${landscapeHit}`);

// HERO DOWN, in landscape -- the state whose layout is most likely to break when the frame changes
// shape, because the bar under the message is sized against the viewport width.
const beforeDown = await state();
await page.eval(startWatch('landscape-knockdown', `({
  downSeconds: window.__galaQuestRuntime.encounterState().hero.downSeconds,
  veil: window.__galaQuestRuntime.heroDownShown(),
})`));
const landscapeDown = await pollUntil((s) => s.hero.downSeconds >= 0,
  { intervalMs: 40, timeoutMs: 30000 });
check('landscape: the hero can still be knocked out', landscapeDown.hero.downSeconds >= 0,
  `hp ${beforeDown.hero.hp} -> ${landscapeDown.hero.hp}, downSeconds ${landscapeDown.hero.downSeconds}`);
await shot('landscape-hero-down');
// Recorded across the knockdown rather than read once at the end of it, for the same reason the
// portrait veil check is: the veil is up for RESPAWN_SECONDS and a point read arrives late enough
// on a starved runner to miss the tail of it.
const landscapeVeil = await waitForSample(page, 'landscape-knockdown', (sample) => sample.veil === true,
  { intervalMs: 40, timeoutMs: 4000 });
await page.eval(stopWatchSource('landscape-knockdown'));
const veiledFrames = landscapeVeil.samples.filter((sample) => sample.veil === true);
check('landscape: the knocked-out state is on screen in this orientation too',
  veiledFrames.length > 0,
  `${landscapeVeil.samples.filter((sample) => sample.downSeconds >= 0).length} down frame(s), `
    + `${veiledFrames.length} of them veiled`);

// KILL, in landscape -- the fourth state, and the last one needed to say the cues survive outside
// portrait. He stands back up on full hearts RESPAWN_SECONDS after going down, so this waits for
// that rather than swinging at a wolf while downed and having every tap refused.
await pollUntil((s) => s.hero.downSeconds < 0, { intervalMs: 40, timeoutMs: 8000 });
// The same clock and the same recorder the portrait kill uses -- see its header. This loop was the
// last one left on the old shape and it showed: hosted at e543b62 it spent TWO MINUTES TWENTY-THREE
// SECONDS between the knockdown capture and its verdict, because each of forty attempts paid a
// 6000ms pulsed walk plus a 916ms poll for a 0.18s reaction. The wolf comes to the hero here (it
// re-aggros after the shared reset), so no walking is needed at all; what was needed was to stop
// asking.
//
// Read after every tap rather than in bursts, because unlike the portrait loop this one wants the
// PICTURE at first detection. That costs one round trip per 1.75s tap, about 14% of the cadence.
// Hosted the picture is best-effort regardless: a Page.captureScreenshot measured 2.7s there, and
// the defeat flash is 0.5s. The CHECK reads the recorder, which cannot miss it.
await page.eval(startWatch('landscape-fight', FIGHT_SAMPLE));
const readLandscape = () => page.eval(readWatchSource('landscape-fight')).then(JSON.parse);
let landscapeKilled = false;
let landscapeGap = 0;
for (let attempt = 0; attempt < 120 && !landscapeKilled; attempt += 1) {
  const cycleStart = Date.now();
  // eslint-disable-next-line no-await-in-loop
  await tapAttack();
  // eslint-disable-next-line no-await-in-loop
  await sleep(Math.max(0, tapEveryMs - (Date.now() - cycleStart)));
  // eslint-disable-next-line no-await-in-loop
  const log = await readLandscape();
  landscapeGap = log.samples[log.samples.length - 1]?.gap ?? 0;
  landscapeKilled = log.samples.some((sample) => sample.wolfMode === 'dying' || sample.wolfMode === 'dead');
  if (landscapeKilled) await shot('landscape-defeated');
  // eslint-disable-next-line no-await-in-loop
  if (!landscapeKilled && landscapeGap > ATTACK_REACH) await closeOnWolf(landscapeGap, 1.0);
}
await page.eval(stopWatchSource('landscape-fight'));
check('landscape: the finishing blow was photographed too', landscapeKilled,
  `wolf reached its death state: ${landscapeKilled}`);

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
