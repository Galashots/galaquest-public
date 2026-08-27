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
import { RUN_DEFLECTION } from '../../public/src/character/speed.js';
import { STICK_RADIUS_PX } from '../../public/src/input/touch.js';
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
  waitForSample,
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

// WHAT THE CHILD HEARS, recorded from the moment the page comes up so nothing can be spoken before
// anyone is looking. banner() now offers every narrative beat to the same read-aloud latch the
// speech bubble uses (see keeperSpeech.js for why that latch exists at all), and the latch has two
// halves that both need proving in a real browser rather than only in a unit test: it must stay
// silent until a child has asked to be read to, and a real tap must really unlock it. Wrapping
// speak() rather than replacing speechSynthesis, so the page's own code path is unchanged and the
// original still runs -- this observes, it does not substitute.
const speechRecorder = await page.eval(`(() => {
  window.__gqSpoken = [];
  const synth = window.speechSynthesis;
  if (!synth || typeof synth.speak !== 'function') return 'absent';
  const original = synth.speak.bind(synth);
  synth.speak = (utterance) => {
    window.__gqSpoken.push(String(utterance && utterance.text));
    return original(utterance);
  };
  return 'wrapped';
})()`);
const spokenSoFar = async () => JSON.parse(await page.eval('JSON.stringify(window.__gqSpoken || [])'));

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
// DERIVED, not retyped (GQ-007): this used to be a local `const STICK_PX = 56`, which was correct
// only while input/touch.js's own STICK_RADIUS_PX was also 56. The 2026-08-27 speed-up grew that
// radius to 64px alongside raising WALK_SPEED/RUN_SPEED, and the stale 56 silently changed what a
// "full deflection" touchMove of STICK_PX pixels actually pushes the real, in-page clampStick() to
// (56/64 = 0.875 of the radius, not 1.0) -- still past RUN_DEFLECTION so the coarse leg still ran,
// but every ratio derived from the stale constant below was wrong by the same 56/64 factor.
const STICK_PX = STICK_RADIUS_PX;
// THE FINE LEG WALKS; THE COARSE LEG RUNS, which is what a person does and which is the difference
// between converging and bouncing. Even with the release moved into the page there is a real coast
// left -- the client samples the stick in its own frame loop, so zero intent reaches the server a
// frame or so after the thumb lifts. That latency is fixed; the DISTANCE it costs is speed times
// latency, and the harness picks the speed. Hosted at b683623 the fine leg latched at 0.07m of a
// 1.5m ring and the reading afterwards said 3.13m: about 1.1s of latency at RUN_SPEED's 2.8 m/s.
// The same 1.1s at WALK_SPEED is half that, which is inside the ring instead of past it.
//
// RUN_DEFLECTION, not a fraction chosen to feel right: it is the speed law's own named boundary,
// the exact push at which groundSpeedForInput returns WALK_SPEED. See character/speed.js.
//
// WHAT THE STALE VALUE ACTUALLY DID. With `STICK_PX = 56`, FINE_STICK_PX was 56 * 0.62 = 34.72px --
// a push of 34.72/64 = 0.54 against the REAL 64px radius clampStick() actually applies, i.e. under
// RUN_DEFLECTION (still the walk branch) but at 0.54/0.62 = 87% of WALK_SPEED rather than the exact
// speed this constant's own name and comment claim to hand the fine leg. Whatever mix of that speed
// error and the camera-heading-relative steering produced the measured 155-frame orbit (closest
// 0.70m of a 0.6m ring, never inside it), the derivation was demonstrably wrong -- a "push at
// RUN_DEFLECTION" that computes to something other than RUN_DEFLECTION once the real radius is
// applied is a bug in this file regardless of which exact failure mode it produces on a given
// runner. Deriving STICK_PX from the real STICK_RADIUS_PX makes FINE_STICK_PX land exactly on
// RUN_DEFLECTION again, restoring the property this file's own header already claims for it.
//
// PER-FRAME TRAVEL, checked against this file's own smallest ring (0.6m, the lane walk below) now
// that the fine leg is genuinely WALK_SPEED: at 1.7 m/s and the ~4-6fps this project's hosted
// runners paint at (167-250ms/frame), a fine-leg step is 0.28-0.43m -- comfortably under the 0.6m
// ring. Even at the harness's own worst locally-measured rate for this scene (~3fps / 333ms, see
// the animation-stretch measurement below), a step is 0.57m: still under 0.6m, with the margin this
// file's own post-mortem (15/15 checks, 0.29-1.06m readings, taken under 40x CPU throttle) was
// measured against.
const FINE_STICK_PX = STICK_PX * RUN_DEFLECTION;

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
async function heldWalkToward(targetX, targetZ, holdWithin, maxMillis, deflectionPx = STICK_PX) {
  await page.eval(startWalk(`({ x: ${targetX}, z: ${targetZ} })`, holdWithin,
    { releaseOnArrival: true }));
  // ASK THE PAGE WHETHER WE ARE ALREADY THERE, BEFORE TOUCHING THE STICK. A walk that starts inside
  // its own ring cannot improve on where the hero is standing -- it can only hold the key long
  // enough to notice, release, and let him coast back out. Measured, hosted at 641ae02: the hero was
  // at 1.46m of a 1.5m ring, this leg ran anyway, latched on its very first frame, held six frames
  // waiting for a 100ms poll to see it, and the release carried him to 2.36m -- past the 2m radius
  // the check wants, having started inside it. The walk was the whole defect.
  const already = JSON.parse(await page.eval(READ_WALK));
  if (already?.arrived) {
    console.log(`  walk: already inside ${holdWithin}m `
      + `(${metresOrUnknown(already.startMetres)}), not walking`);
    await page.eval(STOP_WALK);
    const settled = await pollUntil(
      (next) => next.serverPos !== null && next.serverSpeed === 0, { timeoutMs: 4000 });
    settled.latchedWithin = holdWithin;
    return settled;
  }
  await touch('touchStart', [{ x: stickX, y: stickY }]);
  await touch('touchMove', [{ x: stickX, y: stickY - deflectionPx }]);
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
    + `${metresOrUnknown(walk.metres)}, ${reached}, thumb ${walk.released ?? 'still down'}`);
  // Let the release reach the page, then wait for authority to agree the hero has STOPPED before
  // the pulsed leg starts measuring from him. A fixed sleep here handed the next phase a coasting
  // hero, and handed the caller one who drifted out the far side of the speech radius while the
  // greeting played -- which cost the wave its handoff to talk in one run out of two.
  await sleep(200);
  const settled = await pollUntil(
    (next) => next.serverPos !== null && next.serverSpeed === 0, { timeoutMs: 4000 });
  // The latch itself is evidence, and it is carried on the settled reading rather than lost with
  // the local `walk`: the page decided arrival with BOTH bodies inside the ring on a real frame,
  // and what the hero does after that moment (coast, reconcile, or get mauled by whatever is
  // roaming the density push's wilderness) cannot un-happen it.
  if (walk?.arrived) settled.latchedWithin = holdWithin;
  return settled;
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
// PASSES, NOT MILLISECONDS -- the same unit fix play-fight's settle budget needed, applied to the
// loop that was still counting in the wrong one. A pass costs whatever a pass costs on the machine
// you are on: hosted at 4fps each one took eight or nine seconds, so a 20s budget bought TWO, and
// the run that failed at b683623 stopped at 3.13m having had no third. The number of passes a walk
// needs is a property of the walk (how far the coast is against how wide the ring is), not of the
// runner, so that is what to budget. The clock stays as a backstop against a page that has stopped
// painting -- generous, because it is no longer the thing being budgeted.
const APPROACH_PASSES = 6;
// `acceptLatch` ends the approach the moment a held leg's in-page latch has seen both bodies
// inside the CALLER'S OWN ring on a real frame, and reports that on the returned reading as
// `everLatched`. It exists for callers whose question is "does walking get there" rather than
// "is the hero still standing there afterwards" -- the lane walk below, whose waypoint the
// density push put within a roaming wolf's reach (wolf-1's leash covers it), so the hero can be
// killed AT the answer and respawned 4.8m away from it before any post-settle read looks.
async function walkToward(targetX, targetZ, stopWithin, maxMillis, { acceptLatch = false } = {}) {
  const deadline = deadlineAfter(Math.max(maxMillis, 90_000));
  let last = await state();
  let passes = 0;
  let everLatched = false;
  const noteLatch = (reading) => {
    if (reading.latchedWithin !== undefined && reading.latchedWithin <= stopWithin) everLatched = true;
  };
  while (passes < APPROACH_PASSES && Date.now() < deadline) {
    // A FRESH READING EACH TIME ROUND, not the one the previous leg handed back. That leg returns as
    // soon as the SERVER hero has stopped, and the rendered hero keeps converging onto him for a
    // while afterwards -- so its parting number is the hero mid-reconciliation, and it reads further
    // out than where he actually comes to rest. Hosted at 641ae02 that stale number was over the
    // 1.5m ring while the hero was in fact settling to 1.46m, inside it: the loop took another pass
    // it did not need, and the pass put him outside the radius the check wanted. The decision to
    // walk again is worth one round trip.
    // eslint-disable-next-line no-await-in-loop
    last = await state();
    const away = Math.hypot(targetX - last.heroPos[0], targetZ - last.heroPos[1]);
    if (away <= stopWithin) break;
    passes += 1;
    // COARSE, THEN FINE, AND BOTH OF THEM HELD -- carried over from drive-village-board after this
    // file's lane walk flapped: green at 3f2d45a, red again at 2e0f407 on a commit that touched
    // only play-fight.mjs and the ledger. A check that changes verdict without its subject changing
    // is sitting exactly on the boundary of what the machine can do, and here the boundary is
    // known: pulsing cannot place a hero finer than one frame of travel plus the release latency,
    // and this walk aims at a 0.6m ring against 0.4-0.8m of frame travel at 4fps. It landed 1.23m
    // out locally and 1.53m hosted, against a check that wants under 1.5m -- passing and failing on
    // which side of the resolution it happened to fall.
    //
    // The fine leg holds to the RING ITSELF. The slack belongs to the coarse leg, whose job is to
    // cover distance and hand over near the target; the fine leg's job is to stop, and aiming it
    // wide is asking it not to. Only the in-page latch can stop that finely, because it decides
    // arrival on the frame it happens rather than a CDP round trip later.
    if (away > stopWithin + HELD_APPROACH_SLACK_METRES) {
      // eslint-disable-next-line no-await-in-loop
      last = await heldWalkToward(targetX, targetZ, stopWithin + HELD_APPROACH_SLACK_METRES,
        Math.max(2000, deadline - Date.now()));
    }
    // NO COAST CORRECTION, and I tried it twice. After the latch fires the stick is released a CDP
    // round trip later and the hero carries on for it, which is the entire remaining error -- so
    // aiming short by the coast the loop measured looks obviously right. Per-walk it moved the lane
    // approach from 1.03m to 0.98m, which is inside this file's own run-to-run noise. Carried across
    // walks, so that the first leg is calibrated too, it went to 1.43m and took a keeper check down
    // with it: a coast measured on one walk is not the coast of the next.
    //
    // What is left is principled by construction rather than by tuning -- pulsing cannot place a
    // hero finer than one frame of travel, and the latch can -- and that is the part worth keeping.
    // eslint-disable-next-line no-await-in-loop
    // THE FULL REMAINING BUDGET FOR BOTH LEGS, not half each. A held leg exits when it LATCHES, so
    // it only consumes its budget when it is failing -- halving to reserve room for a second pass
    // instead guarantees there is none: one pass ate three quarters of the lane walk's 12s and the
    // loop stopped at 1.50m against a check that wants under 1.5, passing on the last centimetre.
    last = await heldWalkToward(targetX, targetZ, stopWithin,
      Math.max(2000, deadline - Date.now()), FINE_STICK_PX);
    noteLatch(last);
    if (acceptLatch && everLatched) break;
    // The pulse is the last resort now, not the placer: it runs only if the fine held leg could not
    // latch at all, which on a page that is still painting means the target is unreachable rather
    // than merely far.
    const stillOut = Math.hypot(targetX - last.heroPos[0], targetZ - last.heroPos[1]);
    if (stillOut > stopWithin + HELD_APPROACH_SLACK_METRES) {
      // eslint-disable-next-line no-await-in-loop
      last = await pulseWalkToward(targetX, targetZ, stopWithin,
        Math.max(1500, (deadline - Date.now()) / 2));
    }
  }
  const away = Math.hypot(targetX - last.heroPos[0], targetZ - last.heroPos[1]);
  const spent = passes >= APPROACH_PASSES ? ` -- SPENT ALL ${APPROACH_PASSES} PASSES` : '';
  const latched = everLatched ? ', latched inside the ring' : '';
  console.log(`  approach: ${passes} pass(es), ${metresOrUnknown(away)} from the target${latched}${spent}`);
  last.everLatched = everLatched;
  return last;
}

// WHAT WAS WRONG WITH THIS WALK, and what closed it. Kept because the measurement is the useful
// part: three attempts to correct this on 2026-08-23 all measured worse and were reverted, and the
// thing that finally worked was not a fourth number.
//
// From a failing lane walk (1 run in 4 locally, and red hosted):
//
//   walk: 25 frames held, 1.24m to 0.35m, inside 0.6m at frame 25
//   approach: 2 pass(es), 2.04m from the target
//
// The in-page latch saw 0.35m -- comfortably inside its ring -- and the reading afterwards said
// 2.04m. THE PAGE DECIDED ARRIVAL BUT THE HARNESS PERFORMED THE RELEASE: startWalk latched on the
// frame the hero crossed the ring, and the touchEnd that stopped him was a CDP round trip away,
// which on a starved page is two frames. Everything the in-page latch bought was spent again on the
// way back out, and the convergent loop above could not fix it because every pass overshot by more
// than the ring it was aiming at. Under 40x CPU throttle (~3 fps) that was four passes latching at
// 0.63m, 0.49m and 0.35m and ending 2.58m from a 2.0m ring -- a walk that got further away the
// harder it tried.
//
// So the release moved into the page too: `startWalk(..., { releaseOnArrival: true })` dispatches
// the same pointerup the harness's own touchEnd produces, on the same element, on the latch frame.
// See in-page-driver.mjs for why that is a child lifting their thumb rather than a new power.
//
// Same throttled run afterwards: 15/15 checks, every approach inside its ring (1.06m, 0.41m, 0.98m,
// 0.29m). What remains is the input-send latency -- the client samples the stick in its own frame
// loop, so zero intent reaches the server a frame or so after the thumb lifts, and the hero walks
// about a metre more. That is not a harness artefact: a child on a slow tablet coasts too, and the
// convergent loop absorbs it in one extra pass.

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
//
// JUDGED ON THE LATCH AS WELL AS THE PARKING SPOT, because the density push made this waypoint
// contested ground: it sits 7.2m from wolf-1's home against a leash of 8, so a wandering wolf-1
// can aggro a hero standing on it. Hosted at fda0cf4 the walk latched at 0.46m -- both bodies
// inside the 0.6m ring, question answered -- and the hero was then mauled, respawned at spawn
// (the failing read's restarts measure exactly the 4.82m spawn-to-waypoint distance), and the
// post-settle read judged the corpse's respawn point instead of the walk. Whether the hero
// SURVIVES standing there is the fight harnesses' subject, not this walkability check's.
const laneWalk = await walkToward(wolfX * 0.4, wolfZ * 0.4, 0.6, 12000, { acceptLatch: true });
check('walking partway up the lane toward the wolf actually closes distance',
  laneWalk.everLatched
    || Math.hypot(laneWalk.heroPos[0] - wolfX * 0.4, laneWalk.heroPos[1] - wolfZ * 0.4) < 1.5,
  `latched ${laneWalk.everLatched}, hero ${JSON.stringify(laneWalk.heroPos)}, `
    + `target [${(wolfX * 0.4).toFixed(2)}, ${(wolfZ * 0.4).toFixed(2)}]`);

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

// THE RECORDER STARTS BEFORE THE WALK, for the reason the re-wave check further down already
// carries and this one did not. The wave fires the moment the hero crosses the radius and is over in
// about a second; a poll that begins once walkToward has RETURNED is looking for something that may
// already have happened, and finds `waving:false, talking:true` -- the wave finished and handed off
// while nobody was watching.
//
// Measured: one run in four, locally, four consecutive runs. And the exposure grew when walkToward
// started waiting for the server hero to come to rest before returning -- a better walk, which spends
// its extra certainty in exactly the window this poll needed. Fixing the sibling check and leaving
// this one was the mistake; they are the same check about two different waves.
await page.eval(startWatch('keeper-wave',
  '({ t: performance.now(), v: window.__galaQuestRuntime.zoneKeeperState()?.waving === true })'));
const approached = await walkToward(keeperX, keeperZ, 1.5, 20000);
check('walking reaches the keeper',
  Math.hypot(approached.heroPos[0] - keeperX, approached.heroPos[1] - keeperZ) <= KEEPER_WAVE_RADIUS_METERS,
  `hero ${JSON.stringify(approached.heroPos)}, keeper [${keeperX}, ${keeperZ}], `
    + `radius ${KEEPER_WAVE_RADIUS_METERS}m`);
const waveLog = await waitForSample(page, 'keeper-wave', (sample) => sample.v === true,
  { intervalMs: 60, timeoutMs: 6000 });
await page.eval(stopWatchSource('keeper-wave'));
const waved = waveLog.samples.some((sample) => sample.v === true);
check('the keeper actually waves when a hero comes within range',
  waved, `waving seen on a recorded frame: ${waved}, over ${waveLog.samples.length} frame(s) from `
    + `before the approach; keeperState now ${JSON.stringify((await state()).keeper)}`);

// ── read-aloud: silent until asked, then not silent ──────────────────────────────────────────────
// By now the opening hail has fired (`Keeper Aldric is waving you over!`, once per session, a beat
// after the zone is ready) and the quest line has appeared and changed. Every one of those went
// through the latch, and the latch must have refused all of them: nothing in this game speaks to a
// child who has not asked to be read to.
if (speechRecorder === 'wrapped') {
  const beforeTap = await spokenSoFar();
  check('nothing has been read aloud before the child asked to be read to',
    beforeTap.length === 0, `spoken so far: ${JSON.stringify(beforeTap)}`);

  // And now the asking. A real CDP tap on the speaker button, because the tap is not a formality --
  // it is iOS's price for making any sound at all, and it has to be a genuine user gesture.
  const button = JSON.parse(await page.eval(`(() => {
    const el = document.querySelector('#keeper-speech-speak');
    if (!el) return 'null';
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height });
  })()`));
  if (button === null || button.w === 0) {
    check('the read-aloud button is on screen for a child standing at the keeper', false,
      `getBoundingClientRect gave ${JSON.stringify(button)}`);
  } else {
    await touch('touchStart', [{ x: button.x, y: button.y }]);
    await touch('touchEnd', []);
    const heard = await pollUntilDeadline(spokenSoFar, (list) => list.length > 0,
      { intervalMs: 100, timeoutMs: 4000 });
    check('one real tap on the speaker, and the keeper\'s line is read out',
      heard.length > 0, `spoken: ${JSON.stringify(heard)}`);
  }
} else {
  console.log('  NOTE  this Chrome exposes no speechSynthesis, so the two read-aloud checks did '
    + 'not run. They are NOT passing -- they are absent, and the count below says 13 not 15.');
}

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
//
// THE RECORDER STARTS BEFORE THE WALK, not after it. The wave fires the moment the hero crosses the
// radius and it is over in about a second; a poll that begins once the walk has returned is looking
// for something that already happened, and on a slow frame it finds `waving:false, talking:true` --
// the wave finished and handed off while nobody was watching. That flaked one run in three here.
// Recording from before the approach means the wave is in the log whether or not the poll was
// looking, which is the same fix the two talk checks in this file already carry.
await page.eval(startWatch('keeper-rewave',
  '({ t: performance.now(), v: window.__galaQuestRuntime.zoneKeeperState()?.waving === true })'));
const reapproached = await walkToward(keeperX, keeperZ, 1.5, 20000);
check('walking back up to the keeper closes the distance again',
  Math.hypot(reapproached.heroPos[0] - keeperX, reapproached.heroPos[1] - keeperZ) <= KEEPER_WAVE_RADIUS_METERS,
  `hero ${JSON.stringify(reapproached.heroPos)}, keeper [${keeperX}, ${keeperZ}], `
    + `radius ${KEEPER_WAVE_RADIUS_METERS}m`);
const rewaveLog = await waitForSample(page, 'keeper-rewave', (sample) => sample.v === true,
  { intervalMs: 60, timeoutMs: 6000 });
await page.eval(stopWatchSource('keeper-rewave'));
const rewaved = rewaveLog.samples.some((sample) => sample.v === true);
check('re-entering after leaving produces exactly one new greeting wave',
  rewaved, `waving seen on a recorded frame: ${rewaved}, over ${rewaveLog.samples.length} frame(s) `
    + `from before the approach; keeperState now ${JSON.stringify((await state()).keeper)}`);

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
