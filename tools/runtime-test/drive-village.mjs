/**
 * Boot the running game, wait for the village zone to finish loading, and capture what it looks
 * like from three vantage points a person judges a first zone by:
 *
 *   (a) the spawn view toward the village (the Lantern Tree landmark, street lanterns leading in)
 *   (b) the walk-up to the Lantern Keeper, with the proximity wave actually firing
 *   (c) the lane from spawn toward the wolf, kept clear per the brief's combat-bowl guarantee
 *
 *   node tools/runtime-test/drive-village.mjs
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * Cribbed from play-fight.mjs's CDP-over-websocket harness (no Puppeteer, no npm) and its polling
 * discipline: state is read fresh every check rather than trusted from a moment earlier, because a
 * fixed sleep tuned to "usually about right" is exactly the assumption AGENTS.md's "Look before
 * you derive" warns against.
 *
 * This proves the zone loads clean and photographs it. It does NOT judge composition -- that step
 * happens after this run, by a person (or an agent standing in for one) opening the three captures
 * and looking, per the brief's "Open every capture and judge composition like the owner would."
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DISTANCE } from '../../public/src/camera/follow.js';
import {
  headingToward, KEEPER_GREET_REARM_RADIUS_METERS, KEEPER_WAVE_RADIUS_METERS,
} from '../../public/src/world/zoneLoader.js';
import { SPAWNS, LANDMARKS } from '../../public/src/world/zones/village.js';
import {
  deadlineAfter,
  movementPulseMillis,
  pollUntilDeadline,
} from './automation-timing.mjs';
import { startOwnedServer } from './owned-server.mjs';
import {
  metresOrUnknown, READ_WALK, readWatchSource, startWalk, startWatch, STOP_WALK, stopWatchSource,
} from './in-page-driver.mjs';

const CHROME_PORT = 9224;
// Spawns and owns its own server on an isolated port rather than using the shared 5201 (Phase H1).
// The composition captures this harness writes are evidence about THIS checkout's village.js, and
// 5201 was measured to belong to a sibling worktree. See owned-server.mjs.
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
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
const page = new CDP(list.find((t) => t.id === targetId).webSocketDebuggerUrl);
await page.ready();
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Log.enable');

// The fresh-guest discipline drive-marks.mjs/drive-relight.mjs already established, adopted here
// after it caused a real, confusing symptom: this harness's own captures were showing the Lantern
// Tree LIT -- not a Task C ground/road bug, but this session's own repeated play-fight.mjs runs
// against the SAME persistent automation Chrome profile accumulating real Lantern Marks for
// whatever guestId localStorage already held, bleeding into a harness that never asked for a clean
// slate. Wiped BEFORE the first navigation so every run of this file is reproducible regardless of
// what an earlier run (of this file or any other) left behind.
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });

const consoleErrors = [];
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

// Y/Task F1: favicon.ico no longer 404s (index.html now declares a zero-network data-URI icon), so
// it is dropped from this allowlist -- an entry that can never match again is a stale claim, not a
// safety net. The belt lantern remains: it ships on its own track and degrades gracefully by design
// (main.js's ensureLanternMounted), unrelated to this harness's own zone-loading concern.
const COSMETIC_404_PATTERNS = ['/assets/gear/lantern_belt.glb'];

await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Page.navigate', { url: URL_UNDER_TEST });

let heroReady = false;
for (let i = 0; i < 60 && !heroReady; i += 1) {
  await sleep(500);
  heroReady = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
}
if (!heroReady) throw new Error(`runtime never came up on ${URL_UNDER_TEST}`);

const players = await page.eval(`(() => {
  const m = (document.querySelector('#runtime-status')?.textContent ?? '').match(/players\\s+(\\d+)/i);
  return m ? Number(m[1]) : 1;
})()`);
if (players !== 1) {
  console.error(`${players} clients connected — close other tabs, the captures would show extra heroes`);
  await page.send('Target.closeTarget', { targetId });
  process.exit(2);
}

// window.__galaQuestRuntime.zoneDebug() -- {requested, loaded, failed}, mutated live as
// world/zoneLoader.js's loadZone() settles each GLB (main.js, Phase V/V2).
async function zoneDebug() {
  return page.eval('window.__galaQuestRuntime.zoneDebug()');
}
let zone = await zoneDebug();
for (let i = 0; i < 120 && zone.requested === 0 || (zone.loaded + zone.failed) < zone.requested; i += 1) {
  await sleep(250);
  zone = await zoneDebug();
}
check('the zone finished loading (every requested GLB settled)',
  zone.requested > 0 && zone.loaded + zone.failed === zone.requested,
  `requested ${zone.requested}, loaded ${zone.loaded}, failed ${zone.failed}`);
check('zero failed zone loads', zone.failed === 0, `failed ${zone.failed} of ${zone.requested}`);

const touch = (type, points) => page.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});

async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}village-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured village-${name}.png`);
}

const state = () => page.eval(`(() => {
  const r = window.__galaQuestRuntime;
  const net = r.netState();
  return JSON.stringify({
    heroPos: [+r.player.position.x.toFixed(2), +r.player.position.z.toFixed(2)],
    serverPos: net.serverSelf ? [+net.serverSelf.x.toFixed(2), +net.serverSelf.z.toFixed(2)] : null,
    // So a walk can return when the hero has actually STOPPED rather than a fixed sleep after the
    // release. A held walk that hands back a coasting hero lets him drift out the far side of
    // KEEPER_WAVE_RADIUS_METERS while the greeting plays, which starves the wave's handoff to talk.
    serverSpeed: net.serverSelf?.speed ?? null,
    heading: r.follow.heading,
    keeper: r.zoneKeeperState(),
  });
})()`).then(JSON.parse);

async function pollUntil(predicate, { intervalMs = 100, timeoutMs = 5000 } = {}) {
  return pollUntilDeadline(state, predicate, { intervalMs, timeoutMs });
}

// Camera heading/distance are set directly through runtime.follow (the same object
// cameraGesture.js's real finger-drag/pinch would otherwise mutate) rather than synthesizing a
// drag or a pinch: these three captures are about composition, not about proving the gesture
// itself, which camera-gesture.test.mjs and play-fight.mjs's own orbitToFront() already exercise
// with real touch.
async function setHeadingToward(x, z) {
  const hero = await state();
  const heading = headingToward(hero.heroPos[0], hero.heroPos[1], x, z);
  await page.eval(`window.__galaQuestRuntime.follow.setHeading(${heading})`);
  // Let a few frames run so follow.update() actually repositions the camera at the new heading.
  await sleep(150);
}

// follow.js's own DEFAULT_DISTANCE (3.8) is documented as "inspection distance", calibrated for
// judging a single character up close -- not for an establishing shot of a whole zone. The first
// version of this harness took every capture at that default and got exactly what the brief warns
// against: a hero standing nose-first into whatever prop happened to be nearest (a fence rail, a
// gate post), filling the frame and hiding everything the capture was meant to show. Zooming out
// (still well inside MAX_DISTANCE=18, the same range a player's own pinch-zoom already reaches) is
// what a person steps back and does themselves to see a whole scene -- exactly this file's job.
async function setCameraDistance(distance) {
  await page.eval(`window.__galaQuestRuntime.follow.setDistance(${distance})`);
  await sleep(150);
}

const stickX = VIEWPORT.width * 0.18;
const stickY = VIEWPORT.height * 0.86;
const STICK_PX = 56;

// Walks toward a fixed world point (unlike play-fight.mjs's walkToward, which re-aims at a live
// wolf every tick -- these targets, the keeper and a point along the wolf lane, do not move).
//
// play-fight.mjs's own walkToward hardcodes "screen-right is world -X", true only at
// follow.heading 0 -- camera/rotation.js's screenToWorld() rotates by heading, and this harness
// deliberately turns the camera (setHeadingToward) BEFORE some of its walks, so the same shortcut
// would steer the hero off in the wrong direction the moment heading is not 0 (measured: a first
// version of this file landed the hero at [13.3, -5.62] aiming for the keeper at [-4, -3.5]).
// Inverting camera/rotation.js's screenToWorld(screen, heading) for a target world direction
// (nx, nz) gives sx = -cos(h)*nx + sin(h)*nz, sy = sin(h)*nx + cos(h)*nz; touch/js's clampStick
// then maps screen.x = deltaX/radius, screen.y = -deltaY/radius, so the pixel offset from the
// stick's origin is (sx*radius, -sy*radius). At heading 0 this reduces to exactly play-fight.mjs's
// formula (sx=-nx, sy=nz), which is what proves the generalisation rather than just asserting it.
// TWO WALKERS, AND WHICH ONE IS RIGHT DEPENDS ON HOW FAR AND HOW TIGHT.
//
// This one pulses: press the stick, release it, read, re-aim. Each iteration costs three CDP round
// trips, so on a runner painting at 367ms a frame it covers about a metre of ground per second of
// wall clock -- useless over six metres, which is why the keeper approaches below use the held
// walker instead. But it STOPS where it says it does, and that is the property the lane hop needs:
// a 3.35m walk judged against a 1.5m bound has no room for the held walker's release cost.
//
// A held walk cannot stop on a mark, and the reason is worth writing down rather than tuning
// around. Arrival is latched in-page at frame resolution, but the RELEASE still costs the harness a
// poll and a round trip -- two frames at 4fps -- and the server keeps integrating real time
// throughout, in the last direction it was sent. On top of that the rendered hero is running ~32%
// behind authority at this frame rate (every frame exceeds prediction's 250ms step cap), so once
// the stick is released he travels FURTHER FORWARD catching up to where the server stopped.
// Measured here: latched at 0.53m, read at 1.56m past the waypoint. Over a long walk into a
// generous radius that is free; over a short hop into a tight one it is the whole budget.
async function pulseWalkToward(targetX, targetZ, stopWithin, maxMillis) {
  let last = await state();
  const deadline = deadlineAfter(maxMillis);
  while (Date.now() < deadline) {
    const authority = last.serverPos ?? last.heroPos;
    const dx = targetX - authority[0];
    const dz = targetZ - authority[1];
    const distance = Math.hypot(dx, dz);
    const renderedDistance = Math.hypot(targetX - last.heroPos[0], targetZ - last.heroPos[1]);
    if (distance <= stopWithin && renderedDistance <= stopWithin) break;
    if (distance === 0) break;
    const nx = dx / distance;
    const nz = dz / distance;
    const cos = Math.cos(last.heading);
    const sin = Math.sin(last.heading);
    const sx = -cos * nx + sin * nz;
    const sy = sin * nx + cos * nz;

    // Release before reading. Holding the stick through a slow CDP read is what the held walker
    // below does deliberately, with an in-page stop condition to make it safe; without one,
    // observation latency becomes unobserved movement.
    // eslint-disable-next-line no-await-in-loop
    await touch('touchStart', [{ x: stickX, y: stickY }]);
    try {
      // eslint-disable-next-line no-await-in-loop
      await touch('touchMove', [{ x: stickX + sx * STICK_PX, y: stickY - sy * STICK_PX }]);
      // eslint-disable-next-line no-await-in-loop
      // DELIBERATELY NOT frame-floored here, unlike drive-village-board's. Guaranteeing each press
      // spans a rendered frame fixes "the pulse is shorter than a frame so it moves nobody" -- and
      // creates its opposite, because one frame of travel on a 4fps runner is 0.4-0.8m and this
      // file's tightest ring is 0.6m. Measured: the lane walk went from 1.53m short to 2.38m PAST,
      // oscillating around a ring smaller than its own minimum step. The sibling harness's rings are
      // 1.2m and wider, so the floor is a straight win there and a trade here.
      //
      // The honest statement is that on a machine this slow, placement resolution is one frame of
      // travel plus the release latency, and a ring below that cannot be hit by pulsing at all --
      // only by an in-page latch that releases on the frame it arrives, which is what the held leg
      // above does and why the loop leans on it.
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

// HOW CLOSE A HELD WALK MAY BE TRUSTED TO GET BEFORE THE PULSED ONE TAKES OVER.
//
// A held walk cannot stop on a mark. Arrival latches in-page at frame resolution, but the RELEASE
// costs the harness a poll and a round trip -- two frames at 4fps -- and authority keeps
// integrating real time throughout, in the last direction it was sent. Then the rendered hero, who
// is running behind at this frame rate (every frame exceeds prediction's 250ms step cap), travels
// further forward still, catching up to where the server stopped.
//
// Measured here, walking to the Keeper: latched at 0.87m, stopped at 2.36m -- 1.5m of overshoot,
// against a 2.0m radius. It is roughly double drive-relight.mjs's overshoot on the same walk, and
// the reason is speed: that harness holds the keyboard, which walks, while a stick at full
// deflection RUNS. Three metres is comfortably outside that, and short enough that the pulsed
// walker -- slow per metre, but exact -- finishes the last leg inside its budget even hosted.
const HELD_APPROACH_SLACK_METRES = 3;

// THE STICK IS HELD FOR THE DISTANCE, AND THE LAST LEG IS PULSED SO IT STOPS WHERE IT SAYS. See in-page-driver.mjs for the
// measurements; this harness's own evidence is that at 45ae179 hosted it reported
// `walking reaches the keeper -- hero [-1.34,-2.27]` against a keeper at [-2.8,-5.8]: 3.9m short,
// well outside KEEPER_WAVE_RADIUS_METERS, which is also why `talk resumes after the second wave`
// failed behind it.
//
// The comment this replaces was right about its own bug and wrong about the remedy. Holding the
// stick through a slow read DID overshoot -- but only because the harness was the one deciding when
// to stop, an answer that arrives one round trip late. Pulsing fixed the overshoot by making the
// walk too slow to arrive at all: on a runner painting at 367ms a frame, most of each iteration is
// three CDP round trips and the hero covers about a metre of the six he needs.
//
// Deciding in-page removes the reason to pulse. An rAF loop re-aims the heading at the target every
// frame and latches arrival at frame resolution, so the stick can stay down: the release is late by
// at most one poll, and the walker is still aiming at the target when that poll lands, so the extra
// travel is toward the keeper rather than past him. Held straight up, the stick is pure
// camera-forward -- the `sy = 1` case the rotation above used to compute.
async function heldWalkToward(targetX, targetZ, stopWithin, maxMillis) {
  const holdWithin = stopWithin + HELD_APPROACH_SLACK_METRES;
  await page.eval(startWalk(`({ x: ${targetX}, z: ${targetZ} })`, holdWithin));
  await touch('touchStart', [{ x: stickX, y: stickY }]);
  await touch('touchMove', [{ x: stickX, y: stickY - STICK_PX }]);
  let walk;
  try {
    walk = await pollUntilDeadline(() => page.eval(READ_WALK).then(JSON.parse),
      (next) => next?.arrived, { intervalMs: 100, timeoutMs: maxMillis });
  } finally {
    await touch('touchEnd', []);
    await page.eval(STOP_WALK);
  }
  const reached = walk.arrived
    ? `inside ${holdWithin}m at frame ${walk.arrivedFrame}`
    : `NEVER GOT WITHIN ${holdWithin}m, closest ${metresOrUnknown(walk.closestMetres)}`;
  console.log(`  walk: ${walk.frames} frames held, ${metresOrUnknown(walk.startMetres)} to `
    + `${metresOrUnknown(walk.metres)}, ${reached}`);
  // Let the release reach the page, then wait for authority to agree the hero has STOPPED before
  // the pulsed leg starts measuring from him. A fixed sleep here handed the next phase a coasting
  // hero, and handed the caller one who drifted out the far side of the speech radius while the
  // greeting played -- which cost the wave its handoff to talk in one run out of two.
  await sleep(200);
  return pollUntil((next) => next.serverPos !== null && next.serverSpeed === 0, { timeoutMs: 4000 });
}

// HOLD, THEN PULSE, THEN LOOK -- AND GO ROUND AGAIN IF IT IS NOT THERE YET.
//
// One hold followed by one pulse is not enough, and hosted at 4656480 it showed: the held leg
// latched at 4.21m of its 4.5m ring, the pulsed leg got a 10s budget to cover the remaining 2.7m at
// the metre-a-second a pulsed walk manages there, and `walking back up to the keeper` came up short
// with the Keeper faded to 0.22 opacity behind it. Two more checks failed behind that one.
//
// The fix is not a better slack. Any single number I pick here is a number picked against one
// machine, which is the mistake this whole family of bugs is made of. Looping converges instead:
// the held leg closes whatever distance is left quickly, the pulsed leg places him exactly, and if
// the release carried him past, the next turn round the loop simply walks him back. Bounded by the
// caller's own budget, and it reports how many passes it took so a slow route says so out loud.
async function walkToward(targetX, targetZ, stopWithin, maxMillis) {
  const deadline = deadlineAfter(maxMillis);
  let last = await state();
  let passes = 0;
  while (Date.now() < deadline) {
    const away = Math.hypot(targetX - last.heroPos[0], targetZ - last.heroPos[1]);
    if (away <= stopWithin) break;
    passes += 1;
    const held = away > stopWithin + HELD_APPROACH_SLACK_METRES;
    if (held) {
      // eslint-disable-next-line no-await-in-loop
      last = await heldWalkToward(targetX, targetZ, stopWithin, deadline - Date.now());
    }
    // eslint-disable-next-line no-await-in-loop
    // Half the remaining budget only when a held leg ran -- only then is there a second mechanism
    // to reserve it FOR, namely walking back an overshoot. Halving on every pass regardless is a
    // geometric squeeze on the ONLY thing that can place a hero on a tight ring: hosted at 83e1d95
    // `walking partway up the lane toward the wolf` took three passes and ended 1.53m out with most
    // of its 12s unspent, because pass three was handed an eighth of it.
    last = await pulseWalkToward(targetX, targetZ, stopWithin,
      held ? Math.max(1500, (deadline - Date.now()) / 2) : Math.max(1500, deadline - Date.now()));
  }
  const away = Math.hypot(targetX - last.heroPos[0], targetZ - last.heroPos[1]);
  console.log(`  approach: ${passes} pass(es), ${metresOrUnknown(away)} from the target`);
  return last;
}

// ── Task B: the 12/14/16 exploration-camera comparison ─────────────────────────────────────────
// Same establishing composition (spawn, facing the Lantern Tree), same viewport, same pitch/FOV,
// heading the only thing already set once and left alone -- the brief's own "same pitch/FOV/
// heading and same viewport for all three" requirement, satisfied by construction rather than by
// discipline (there is only one heading-setting call, before the loop).
//
// The brief's own "expected winner is approximately 15-16" was reasoned from follow.js's own
// comment ("422 CSS px... on an 820-tall iPad at distance 3.8", the same source as the ~87-107 CSS
// px art-contract target) -- an 820 px TALL viewport. This harness's own VIEWPORT is 1024 tall (the
// one every other capture in this repo, including play-fight.mjs, is taken at). The same 87-107 px
// target re-expressed as a FRACTION of screen height (87/820 .. 107/820 = 10.6%-13.1%) lands at
// 109-134 px on a 1024-tall viewport, not 87-107 -- so 18 is captured too, alongside the brief's
// named 12/14/16, since naive unit-matching would undershoot the real equivalent target on the
// viewport this harness actually uses. The DECISION still comes from opening and judging the
// captures against the brief's acceptance list, not from this arithmetic alone (AGENTS.md: look
// before you derive) -- the maths only explains why the search widened past the brief's own guess.
const [treeX, treeZ] = LANDMARKS[0].at;
const CAMERA_COMPARISON_DISTANCES = [12, 14, 16, 18];
await setHeadingToward(treeX, treeZ);
for (const d of CAMERA_COMPARISON_DISTANCES) {
  await setCameraDistance(d);
  await shot(`camera-${d}`);
}

// ── (a) the spawn view toward the village, facing the Lantern Tree ─────────────────────────────
// Taken before the hero moves, at DEFAULT_DISTANCE -- literally what a real player sees on boot,
// not a harness-only number picked separately from what Task B just decided (docs/MISTAKES.md
// GQ-007: don't restate a constant this file could import instead).
await setCameraDistance(DEFAULT_DISTANCE);
await setHeadingToward(treeX, treeZ);
await shot('spawn-toward-village');

// Y/Task F2, brief §8/§13.12: performance evidence read directly off diagnostics.read(), not off
// the (now debug-only, hidden by default) #perf-hud panel's text -- accurate regardless of whether
// this run happened to opt into ?debug=1, and no capture needs to keep the panel visible just to
// prove this.
const perf = await page.eval(
  'JSON.stringify(window.__galaQuestRuntime.diagnostics.read())',
).then(JSON.parse);
console.log(`  PERF  spawn-toward-village: draw calls ${perf.drawCalls}, frame cost ${perf.meanMs.toFixed(2)}ms mean / ${perf.p90Ms.toFixed(2)}ms p90 of ${perf.frameBudgetMs}ms budget, ${perf.cssResolution} @ DPR ${perf.devicePixelRatio.toFixed(2)}`);

// ── (c) the lane to the wolf, from spawn ─────────────────────────────────────────────────────
const [wolfX, wolfZ] = SPAWNS.wolf;
await setHeadingToward(wolfX, wolfZ);
await shot('lane-to-wolf');
// A few metres in, not the whole way -- play-fight.mjs already proves the fight itself; this walk
// is evidence the combat-bowl guarantee (no prop within radius 4 of the wolf spawn) is actually
// walkable, not just a data-module assertion (test/zone-data.test.mjs already checks the data;
// this checks the loaded scene).
const laneWalk = await walkToward(wolfX * 0.4, wolfZ * 0.4, 0.6, 12000);
check('walking partway up the lane toward the wolf actually closes distance',
  Math.hypot(laneWalk.heroPos[0] - wolfX * 0.4, laneWalk.heroPos[1] - wolfZ * 0.4) < 1.5,
  `hero ${JSON.stringify(laneWalk.heroPos)}, target [${(wolfX * 0.4).toFixed(2)}, ${(wolfZ * 0.4).toFixed(2)}]`);

// ── (b) walk up to the keeper and catch the wave ────────────────────────────────────────────────
const [keeperX, keeperZ] = SPAWNS.keeper;
// The walks below stop just INSIDE KEEPER_WAVE_RADIUS_METERS rather than on it, so the trigger has
// fired by the time they resolve and a float rounding cannot land the hero exactly on the
// boundary. The radius itself is imported above, never restated here (GQ-007).
// HOW MUCH SLOWER THAN AUTHORED DO ANIMATIONS RUN ON THIS MACHINE?
//
// The Keeper's greeting ends on the AnimationMixer's own 'finished' event, and the mixer is advanced
// by main.js's deltaSeconds -- which is CLAMPED TO 0.1s so a hitch cannot teleport the hero. That
// clamp is right for animation (skipping frames of a wave would look worse than stretching it), and
// above 10 fps it never bites at all: 10 x 0.1 = 1.0x real time. Below it, animation time slows in
// exact proportion.
//
// Measured on this container: ~3 fps, so 0.30x, so a 2.78s wave clip takes 9.3s of wall clock.
// Against a fixed 6s budget the harness reported "the keeper stops waving ... rather than looping"
// -- which is precisely the real defect that check was written for, and precisely NOT what was
// happening. Recorded frame-by-frame in the page, the wave started at 5045ms and ended at 14319ms,
// handing over to talk exactly as designed.
//
// So the budget is DERIVED from the machine rather than picked. A wave that is genuinely stuck in a
// loop still never ends, however long the budget, so the check keeps all of its power -- what it
// loses is the ability to call a slow runner a looping Keeper.
const animationStretch = await (async () => {
  const sampled = await page.eval(`new Promise((resolve) => {
    let frames = 0;
    const started = performance.now();
    const tick = () => {
      frames += 1;
      if (performance.now() - started >= 1000) resolve(JSON.stringify({ fps: frames }));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`).then(JSON.parse);
  const fps = Math.max(1, sampled.fps);
  // 0.1 is main.js's own movement clamp; above 1/0.1 = 10 fps there is no stretch.
  const stretch = Math.max(1, 10 / fps);
  console.log(`  PERF  ~${fps} fps, so animations run at ${(1 / stretch).toFixed(2)}x authored speed;`
    + ` animation-gated waits are scaled by ${stretch.toFixed(1)}x`);
  return stretch;
})();
/** A timeout for something gated on an animation FINISHING, rather than on wall-clock. */
const animationBudget = (ms) => Math.round(ms * animationStretch);

/**
 * Wait for an animation-gated state, budgeted in the clock the ANIMATION actually advances on.
 *
 * WHY animationBudget IS NOT ENOUGH, measured hosted at 66cf253. That scaler is sampled ONCE, over
 * one second, before the walk -- and then every animation-gated wait in the run is scaled by that
 * one number. `after the greeting, the keeper talks` went red at `talking:false` after 7.8s of
 * polling, while the SECOND wave, later in the same run, handed off to talk correctly twice. The
 * frame rate had moved between the sample and the wait. A measurement taken once is a constant with
 * a better story, and this file already has an entry's worth of those.
 *
 * THE CLOCK AN ANIMATION ADVANCES ON is not wall-clock and is not rendered frames either. main.js
 * feeds its mixers `Math.min(frameDelta, 0.1)`, so a clip advances 0.1s per frame below 10fps and
 * one wall-second per wall-second above it. Summing that over the recorded frames gives the only
 * unit in which "this clip has had long enough" means the same thing on every machine. Computed
 * node-side from the recorder's own timestamps, so it needs no new in-page state and restates
 * nothing -- FRAME_DELTA_CLAMP_SECONDS below is main.js's clamp and the reason this works at all.
 *
 * @param budgetSeconds how much ANIMATION time the transition is allowed, as a claim about the clip.
 */
const FRAME_DELTA_CLAMP_SECONDS = 0.1;

function mixerSecondsOf(samples) {
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const gap = (samples[i].t - samples[i - 1].t) / 1000;
    if (Number.isFinite(gap) && gap > 0) total += Math.min(gap, FRAME_DELTA_CLAMP_SECONDS);
  }
  return total;
}

async function waitForAnimationGated(key, sampleExpression, predicate, budgetSeconds) {
  await page.eval(startWatch(key, `({ t: performance.now(), v: ${sampleExpression} })`));
  const read = () => page.eval(readWatchSource(key)).then(JSON.parse);
  // The wall ceiling is a backstop against a page that has stopped painting entirely -- it is not
  // what decides, and it is deliberately far larger than any budget a caller would pass.
  const watch = await pollUntilDeadline(read,
    (w) => Boolean(w) && (w.samples.some((sample) => predicate(sample.v))
      || mixerSecondsOf(w.samples) >= budgetSeconds),
    { intervalMs: 100, timeoutMs: 120_000 });
  await page.eval(stopWatchSource(key));
  const met = watch.samples.some((sample) => predicate(sample.v));
  console.log(`  ${key}: ${met ? 'seen' : 'NOT SEEN'} over ${watch.samples.length} frame(s) / `
    + `${mixerSecondsOf(watch.samples).toFixed(2)}s of animation time (budget ${budgetSeconds}s)`);
  return met;
}

const approached = await walkToward(keeperX, keeperZ, 1.5, 20000);
check('walking reaches the keeper',
  Math.hypot(approached.heroPos[0] - keeperX, approached.heroPos[1] - keeperZ) <= KEEPER_WAVE_RADIUS_METERS,
  `hero ${JSON.stringify(approached.heroPos)}, keeper [${keeperX}, ${keeperZ}], `
    + `radius ${KEEPER_WAVE_RADIUS_METERS}m`);
const waved = await pollUntil((s) => s.keeper?.waving === true, { timeoutMs: animationBudget(3000) });
check('the keeper actually waves when a hero comes within range',
  waved.keeper?.waving === true, `keeperState ${JSON.stringify(waved.keeper)}`);

// The greeting must END, and it must hand the body back. This half of the gate exists because the
// half above passed all the way through a real defect: update() used to re-fire the wave on the
// frame its 'finished' handler cleared `waving`, so the Keeper waved in a continuous loop (measured
// 200/200 samples over 10 s) and `waving === true` was trivially, permanently satisfiable. Since
// startWave() also clears `talking`, that starved Talk_Passionately forever -- the clip shipped
// inside keeper.glb and could never play. Asserting the greeting STOPS while the hero is still
// standing there is what distinguishes "he greeted me" from "he is stuck waving at me".
const settled = await pollUntil((s) => s.keeper?.waving === false, { timeoutMs: animationBudget(6000) });
check('the keeper stops waving while the hero is still standing there, rather than looping',
  settled.keeper?.waving === false,
  `after the greeting, still in range: keeperState ${JSON.stringify(settled.keeper)}`);

// ── the rest of Sol's 7-step interaction sequence (2026-08-16) ──────────────────────────────────
// Steps 1-2 above (wave starts, wave ends while still nearby) were the whole gate before this. That
// gate passed through the exact defect it exists to catch, because it never asked what happens
// AFTER the wave -- the greeting latch's real job is handing the body to `talk` and then holding it
// there, and only a live re-approach proves the handoff, the hold, the release and the re-arm all
// actually work together, not just in isolation.

// Step 3: the wave hands off to talk, not to silence. The hero is still standing inside both the
// wave radius (2.0 m) and the shared speech radius (the same constant), so keeperSpeech stays
// visible and wantsTalking stays true across the handoff -- if this doesn't become true, the
// 'finished' handler's fallback to idleAction is firing instead of the talk branch.
const talking = await waitForAnimationGated('keeper-talk',
  'window.__galaQuestRuntime.zoneKeeperState()?.talking === true', (v) => v === true, 6);
check('after the greeting, the keeper talks while the hero is still there and the line is visible',
  talking, `talking seen on a recorded frame: ${talking}; `
    + `keeperState now ${JSON.stringify((await state()).keeper)}`);

// Step 4: holding position must NOT restart the wave. This is the direct regression Sol asked for --
// "holding a hero continuously at 1.4 m for 10 seconds must produce one greeting wave, not five" --
// sampled repeatedly over several seconds rather than checked once, since the old bug was a
// per-frame re-fire that a single sample could miss entirely.
let restarted = false;
const holdSamples = Math.ceil(4000 / 150);
for (let sample = 0; sample < holdSamples; sample += 1) {
  const s = await state();
  if (s.keeper?.waving === true) { restarted = true; break; }
  await sleep(150);
}
check('the wave does not restart while the hero holds position, several seconds later',
  !restarted, restarted ? 'waving flipped true again with the hero never having left' : 'stayed clear');

// Step 5: walking back OUT past the re-arm radius must stop talk and re-arm the latch. Targeting the
// hero's own spawn -- already proven walkable earlier in this run (the very first leg of this
// script) -- rather than an arbitrary point.
const left = await walkToward(0, 0, 1.0, 16000);
const leftDistance = Math.hypot(left.heroPos[0] - keeperX, left.heroPos[1] - keeperZ);
check('walking away clears both the wave and the (wider) re-arm radius',
  leftDistance > KEEPER_GREET_REARM_RADIUS_METERS,
  `hero-to-keeper distance ${leftDistance.toFixed(2)}m, re-arm radius ${KEEPER_GREET_REARM_RADIUS_METERS}m`);
const untalked = await pollUntil((s) => s.keeper?.talking === false, { timeoutMs: animationBudget(3000) });
check('talk stops once the hero is out of range',
  untalked.keeper?.talking === false, `keeperState ${JSON.stringify(untalked.keeper)}`);

// Step 6: re-entering must produce exactly ONE new greeting -- proof the latch actually re-armed
// rather than staying permanently spent after its first use.
const reapproached = await walkToward(keeperX, keeperZ, 1.5, 20000);
check('walking back up to the keeper closes the distance again',
  Math.hypot(reapproached.heroPos[0] - keeperX, reapproached.heroPos[1] - keeperZ) <= KEEPER_WAVE_RADIUS_METERS,
  `hero ${JSON.stringify(reapproached.heroPos)}, keeper [${keeperX}, ${keeperZ}], `
    + `radius ${KEEPER_WAVE_RADIUS_METERS}m`);
const rewaved = await pollUntil((s) => s.keeper?.waving === true, { timeoutMs: animationBudget(3000) });
check('re-entering after leaving produces exactly one new greeting wave',
  rewaved.keeper?.waving === true, `keeperState ${JSON.stringify(rewaved.keeper)}`);

// Step 7: the second wave must end and hand back to talk too -- the whole cycle repeats cleanly
// rather than the re-arm producing a wave that gets stuck, or that never reconnects to talk.
const resettled = await pollUntil((s) => s.keeper?.waving === false, { timeoutMs: animationBudget(6000) });
check('the second wave also ends while the hero is still there',
  resettled.keeper?.waving === false, `keeperState ${JSON.stringify(resettled.keeper)}`);
const retalking = await waitForAnimationGated('keeper-retalk',
  'window.__galaQuestRuntime.zoneKeeperState()?.talking === true', (v) => v === true, 6);
check('talk resumes after the second wave, closing the full cycle',
  retalking, `talking seen on a recorded frame: ${retalking}; `
    + `keeperState now ${JSON.stringify((await state()).keeper)}`);
// 8, not 6: at 6 the hero's own back and the keeper's robe (a simple low-poly trapezoid at this
// character's triangle budget -- see public/src/world/zones/village.js's KEEPER comment) fill
// most of the frame at a close, low angle and the wave is hard to read. Confirmed empirically
// (not guessed) that the robe is the keeper's own geometry and not a separate stray object: a
// throwaway probe hid the keeper node and BOTH the figure and the "box" disappeared together
// (draw calls 20 -> 19, exactly one object). 8 backs off enough to read hero-and-keeper as two
// figures meeting.
await setCameraDistance(8);
await setHeadingToward(keeperX, keeperZ);
await shot('keeper-wave');

// ── errors ───────────────────────────────────────────────────────────────────────────────────────
const isCosmetic404 = (text) => COSMETIC_404_PATTERNS.some((pattern) => text.includes(pattern));
const cosmeticErrors = consoleErrors.filter(isCosmetic404);
const realErrors = consoleErrors.filter((text) => !isCosmetic404(text));
check('no console errors while the zone loaded and was walked through', realErrors.length === 0,
  realErrors.slice(0, 3).join(' | '));
if (cosmeticErrors.length) {
  console.log(`  NOTE  ${cosmeticErrors.length} known-missing-asset 404(s) (lantern_belt.glb) -- not a failure.`);
}

writeFileSync(`${OUT}village-results.json`,
  JSON.stringify({ results, consoleErrors, zone, laneWalk, approached, waved }, null, 2));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
await page.send('Target.closeTarget', { targetId });
process.exit(failures === 0 ? 0 : 1);
