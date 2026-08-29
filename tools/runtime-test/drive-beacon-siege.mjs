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
import { openRewardStore } from '../../net/rewardStore.mjs';
// The game URL a harness must land on. Imported rather than hand-built: this file spawns its
// own server on a fixed port and so never saw startOwnedServer's `?hero=`, which is exactly how
// it went red when the profile gate landed -- straight onto the naming question, world behind a
// modal, input suspended. See owned-server.mjs's gameUrlFor.
import { gameUrlFor, startOwnedServer } from './owned-server.mjs';
import { GUEST_ID_STORAGE_KEY, sanitizeGuestId } from '../../public/src/net/guestId.js';
import { COLD_SEALS, OLD_BEACON, WILDWOOD_GATE } from '../../public/src/world/zones/village.js';
import { SEAL_EXTRA_REACH_METERS, WARDEN_MAX_HP } from '../../public/src/world/beaconSiege.js';
import { BEACON_TOTAL_HEIGHT_METERS } from '../../public/src/world/oldBeacon.js';
import { ATTACK_REACH, isWithinStrike } from '../../public/src/combat/encounter.js';
import { STICK_RADIUS_PX } from '../../public/src/input/touch.js';
import { RUN_DEFLECTION } from '../../public/src/character/speed.js';
import { startWalk, STOP_WALK } from './in-page-driver.mjs';

const CHROME_PORT = 9224;
const OUT = '.local/runtime-test/';
mkdirSync(OUT, { recursive: true });

// ── THIS HARNESS HAS TO FIT INSIDE ITS OWN JOB ─────────────────────────────────────────────────
//
// .github/workflows/full-playtest-matrix.yml caps every harness job at `timeout-minutes: 18`, and
// the first version of this file ignored that: a 300 s walk plus fourteen swings a seal plus a
// 900 s fight adds to about twenty-five minutes of worst case. It was killed by the runner at
// exactly eighteen, twice, with NO summary line -- so the one question it exists to answer ("can
// the arc actually be played?") came back not as a fail but as silence, which is worse.
//
// So the budgets below are chosen to sum UNDER the ceiling with room to spare, and RUN_DEADLINE_MS
// is the backstop: this harness reports its own verdict before the runner takes the decision away
// from it. A budget is a liveness bound, never a performance claim -- see drive-old-beacon.mjs's
// own header on why a software-rendered runner says nothing about an iPad.
//
//   boot/navigate ~20s + walk 210s + seals 3x8 swings ~150s + wake/bar polls ~45s
//   + fight 420s + payoff polls ~40s  ~=  885s, against a 1080s ceiling.
const JOB_CEILING_MS = 18 * 60 * 1000;
const RUN_DEADLINE_MS = JOB_CEILING_MS - 150_000;
const WALK_BUDGET_MS = 210_000;
const FIGHT_BUDGET_MS = 420_000;
const MAX_SWINGS_PER_SEAL = 8;
// The two reaches the GAME uses, imported rather than restated (GQ-007). A seal is a fixture you
// chop at and carries SEAL_EXTRA_REACH_METERS of slack; the Warden is a body you close on and does
// not. The harness needs both because it now asks the game's own isWithinStrike() whether the hero
// is lined up BEFORE it swings -- see faceHero.
const SEAL_REACH = ATTACK_REACH + SEAL_EXTRA_REACH_METERS;
// Six pulses is far more than a correct turn needs (one, usually two) and few enough that a hero
// who genuinely cannot be turned is reported as such inside a couple of seconds instead of
// silently eating the whole swing budget.
const FACE_ATTEMPTS = 6;
const FACE_PULSE_MS = 150;
// ── STAND BACK FROM THE STONE ──────────────────────────────────────────────────────────────────
//
// walkToward aims the hero AT a point and stops when it is inside its stop radius, and momentum
// carries him further -- run locally, walking at seal 2 put him 0.00 m from it, standing IN the
// stone. At that separation there is no direction to face: every re-aim pulse shot him through the
// seal and out the far side, so all eight swings were logged at "180deg off, 0.01 m out" and the
// seal that needed one more blow never got it. A distance of zero is the one distance from which
// nothing can be struck.
//
// So the walk now targets a point SEAL_STANDOFF_M short of the stone along the hero's own line of
// approach -- which is where a child stops anyway, because they can see the thing they are about to
// hit -- and faceHero backs out of anything closer than MIN_FACE_METERS before trying to turn. Both
// numbers sit far inside SEAL_REACH (2.6 m), so standing back costs nothing but a workable angle.
const SEAL_STANDOFF_M = 1.3;
// How far back down the road the hero walks before the victory capture. Chosen against the tower's
// own numbers rather than by eye: the follow camera trails 15.3 m and the fire's tip stands at
// BEACON_FIRE_TOP_METERS, so this is the distance at which the whole lit silhouette -- plinth to
// flame -- sits inside a portrait frame.
const BEACON_PORTRAIT_STANDBACK_M = 9;
const MIN_FACE_METERS = 0.6;
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
// DERIVED, not retyped (GQ-007): a hand-typed 46 went stale when the 2026-08-27 speed-up grew
// input/touch.js's STICK_RADIUS_PX to 64px -- see drive-village.mjs's identical constant.
const STICK_PX = STICK_RADIUS_PX;

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
  // VERIFIED, not hoped for. A fixture that silently fails to seed does not fail the run -- it makes
  // the run play the whole game as a fresh stranger and then report a pile of confusing product
  // failures that are really one setup failure. drive-old-beacon.mjs's own seeder checks this for
  // exactly that reason.
  const seeded = store.marksFor(guestId) === 3 && store.unlockedFor(guestId);
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
    // THE HERO'S OWN HEADING, which is a different number from the camera's above and is the one
    // that decides whether a swing lands. Leaving it out of this probe is what let this harness
    // swing at a seal it was standing beside and report the miss as a game defect: the field named
    // 'heading' just above looks
    // like the answer, reads plausibly, and is the camera.
    heroHeading: r.player.heading,
    netStatus: r.netState().status,
    zone: r.zoneDebug(),
    guestId: r.guestId(),
    rewards: (() => {
      const all = r.rewards();
      const id = r.netState().selfId;
      return (id != null ? all[id] : null) ?? Object.values(all)[0] ?? null;
    })(),
    treeLit: r.zoneTreeState()?.lit ?? false,
    beaconFound: trail.beaconFound,
    gateFound: trail.gateFound ?? null,
    // WHY A SWING DID OR DID NOT HAPPEN, reported rather than guessed. The first CI run swung
    // twenty-four times at three seals and moved none of them, and nothing in the log could say
    // whether the client refused to send, the server refused to accept, or the blow simply missed.
    attackReady: document.querySelector('#attack-button')?.dataset.ready !== 'false',
    heroClocks: (() => {
      const e = r.encounterState?.();
      return e?.hero ? { hp: e.hero.hp, swingSeconds: e.hero.swingSeconds, cooldown: e.hero.cooldown, downSeconds: e.hero.downSeconds } : null;
    })(),
    objective: document.querySelector('#quest-objective')?.textContent ?? '',
    // Where the arrow is actually aimed, read off the runtime rather than off the DOM: the pointer
    // is pinned to a screen EDGE, so its pixel position says nothing about which world thing it
    // means. guidanceRescueState resolves the same destination the arrow uses.
    pointerTarget: r.guidanceRescueState
      ? [r.guidanceRescueState().targetX, r.guidanceRescueState().targetZ]
      : null,
    // The watch's own reading, not just where it is aimed. Bursting a seal moves the target without
    // changing the objective the chip shows, so this is the one place in the suite where "the same
    // errand now points somewhere else" happens in a real browser.
    rescue: r.guidanceRescueState ? r.guidanceRescueState() : null,
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

/**
 * TURN THE HERO to face a world point -- not the camera, the HERO.
 *
 * The server judges a swing against `player.heading`, and heading is only ever written on a frame
 * the hero is actually MOVING (net/gameServer.mjs's applyInput). walkToward stops as soon as it is
 * inside its stop radius, which routinely leaves the hero a step PAST the thing it walked to: the
 * first CI run of this file swung eight times at a seal 0.96 m away, with the attack button ready
 * and every hero clock idle, and missed all eight -- because the hero stood at [6.85, 50.34] facing
 * the way he had been travelling while the seal sat at [6, 49.9], behind his shoulder.
 *
 * That is the GAME being right: you must face what you hit. So this issues short stick pulses in
 * the target's direction -- each costs a few centimetres of movement and buys a heading -- and it
 * keeps pulsing until the GAME'S OWN isWithinStrike() agrees the target is in front of the hero,
 * judged against `heroHeading` rather than the follow camera's.
 *
 * That last distinction is the whole point. The probe's `heading` is the CAMERA's, and the second
 * CI run of this file spent its entire swing budget re-facing off that number, landing roughly one
 * blow in six and reporting the other five as the seals refusing to break. A harness that cannot
 * tell "I did not aim" from "the game did not hit" cannot be trusted about either, so a miss now
 * only ever gets logged from a stance the game itself called strikeable.
 */
function lookingAt(here, targetX, targetZ, reach) {
  if (!Number.isFinite(here?.heroHeading)) return false;
  return isWithinStrike(
    { x: here.heroPos[0], z: here.heroPos[1] },
    here.heroHeading,
    { x: targetX, z: targetZ },
    reach,
  );
}

/** How far off the hero is pointing, in degrees, for a log line a human can read. */
function offBy(here, targetX, targetZ) {
  const dx = targetX - here.heroPos[0];
  const dz = targetZ - here.heroPos[1];
  // Below a few centimetres there is no direction to be off BY, and reporting one (it flaps between
  // +180 and -180 as the hero jitters) reads as a facing bug rather than as a standing-inside-it bug.
  if (Math.hypot(dx, dz) < 0.05) return 'no angle (standing in it)';
  const to = Math.atan2(dx, dz);
  let delta = to - here.heroHeading;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return `${Math.round((delta * 180) / Math.PI)}deg`;
}

async function faceHero(tab, targetX, targetZ, reach) {
  const origin = { x: tab.viewport.width * 0.18, y: tab.viewport.height * 0.86 };
  let here = await state(tab);
  for (let attempt = 0; attempt < FACE_ATTEMPTS; attempt += 1) {
    // ASK THE GAME, don't assume the pulse worked. One pulse is usually enough and occasionally is
    // not: the stick has a dead zone, the hero has turn inertia, and a pulse that also closes the
    // last few centimetres can carry him PAST the stone so that the correct turn he just made is
    // now the wrong one. Re-reading and re-pulsing costs a few hundred milliseconds and removes an
    // entire class of phantom "the sword does not work" result from this file.
    if (lookingAt(here, targetX, targetZ, reach)) return here;
    const dx = targetX - here.heroPos[0];
    const dz = targetZ - here.heroPos[1];
    const distance = Math.hypot(dx, dz) || 1;
    // TOO CLOSE TO HAVE A DIRECTION. Pulse AWAY instead, and let the next pass turn him: a hero
    // standing inside the thing he is swinging at cannot be aimed, only backed out of.
    const sign = distance < MIN_FACE_METERS ? -1 : 1;
    const nx = (dx / distance) * sign;
    const nz = (dz / distance) * sign;
    const cos = Math.cos(here.heading);
    const sin = Math.sin(here.heading);
    const sx = -cos * nx + sin * nz;
    const sy = sin * nx + cos * nz;
    await touch(tab, 'touchStart', [{ x: origin.x, y: origin.y }]);
    try {
      await touch(tab, 'touchMove', [{ x: origin.x + sx * STICK_PX, y: origin.y - sy * STICK_PX }]);
      await sleep(FACE_PULSE_MS);
    } finally {
      await touch(tab, 'touchEnd', []);
    }
    await sleep(200);
    here = await state(tab);
  }
  return here;
}

/** Face a world point with the CAMERA, so a capture has its subject in frame. Does not turn the
 *  hero -- see faceHero above for the difference, which cost this file a whole CI round trip. */
async function aimAt(tab, targetX, targetZ) {
  const here = await state(tab);
  const heading = Math.atan2(targetX - here.heroPos[0], targetZ - here.heroPos[1]);
  await tab.page.eval(`window.__galaQuestRuntime.follow.setHeading(${heading})`);
  await sleep(500);
  return state(tab);
}

/**
 * Wait until the hero can actually SWING again, then report.
 *
 * Without this the harness taps far faster than the game can accept. A swing is SWING_SECONDS long
 * and `canAttack` refuses a new one while the last is still running, so a loop that taps every half
 * second throws most of its taps away -- the client is right to drop them, and the log reads like a
 * sword that does not work. Measured in CI: eight taps at a cracked seal produced nowhere near eight
 * swings, and a seal one blow from bursting never got that blow.
 */
async function waitUntilSwingReady(tab, maxMillis = 6000) {
  return pollUntil(tab, (s) => {
    const c = s.heroClocks;
    return s.attackReady === true && c != null
      && c.swingSeconds < 0 && c.cooldown <= 0 && c.downSeconds < 0;
  }, maxMillis);
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
  // OWNED BY THE SHARED MODULE, not hand-rolled here. This file used to spawn its own server on a
  // FIXED 5203 and tear it down with `process.kill(-server.pid)` -- a POSIX process-GROUP kill that
  // does not exist on Windows, where it throws and the empty catch swallowed it. The server then
  // outlived the run, and because the port was fixed, the NEXT run attached to the stale server and
  // its stale reward store and died reporting "the seeded guest did not take": a setup defect
  // wearing a product defect's clothes. owned-server.mjs already solves every part of that -- a port
  // pool instead of a squatted fixed port, a kill() that verifies the port is actually free again,
  // and a process-level 'exit' net underneath it that process.exit() cannot skip.
  const server = await startOwnedServer({ rewardStorePath: storePath });

  const tab = await openTab(768, 1024);
  const { origin } = server;
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
    await tab.page.send('Page.navigate', { url: gameUrlFor(origin) });
    const ready = await pollUntil(tab, (s) => s.ready && s.zone?.loaded >= s.zone?.requested, 60000);
    if (!ready.ready) throw new Error('runtime never came up');
    // THE FIXTURE HAS TO ACTUALLY BE THIS PLAYER. Checked at the seam rather than inferred from a
    // downstream product failure: if the guest id did not survive the navigation, or the server is
    // reading a different store, every check after this point reports a game defect that is really
    // a setup defect (this file has already made that mistake once -- see the storage key above).
    const seededGuest = await pollUntil(
      tab, (s) => (s.rewards?.marks ?? 0) >= 3, 20000,
    );
    if ((seededGuest.rewards?.marks ?? 0) < 3) {
      throw new Error(`the seeded guest did not take: guestId ${JSON.stringify(seededGuest.guestId)}, `
        + `net ${seededGuest.netStatus}, rewards ${JSON.stringify(seededGuest.rewards)}`);
    }
    await sleep(1500);

    // ── to the Beacon ────────────────────────────────────────────────────────────────────────────
    console.log('── walking to the Old Beacon ──');
    // THROUGH THE GATE, not past it. The first CI run walked the shortest line to the Beacon and
    // then reported that the chip said "Follow the lit path north" -- which was the CHIP being
    // right and this harness being wrong: `gateFound` only latches inside WILDWOOD_GATE's own
    // radius (main.js), and a hero who never passes under the arch has genuinely not found it.
    // A harness must walk the route a child walks, or its objective assertions are fiction.
    await walkToward(tab, WILDWOOD_GATE.at[0], WILDWOOD_GATE.at[1],
      Math.max(1.2, (WILDWOOD_GATE.radiusMeters ?? 3) * 0.6), Math.floor(WALK_BUDGET_MS * 0.45));
    const gated = await pollUntil(tab, (s) => s.gateFound === true, 8000);
    check(gated.gateFound === true, 'the child passes under the Wildwood Gate on the way',
      `at ${JSON.stringify(gated.heroPos.map((n) => +n.toFixed(1)))}`);
    await walkToward(tab, OLD_BEACON.at[0], OLD_BEACON.at[1] - 3, 2.2,
      Math.max(30000, Math.min(WALK_BUDGET_MS, msLeft() - 400000)));
    const arrived = await pollUntil(tab, (s) => s.beaconFound === true, 30000);
    check(arrived.beaconFound === true, 'the child reaches the Old Beacon', `at ${JSON.stringify(arrived.heroPos.map((n) => +n.toFixed(1)))}`);
    check(arrived.siege?.sealsBuilt === 3, 'three cold seals stand around its base', `built ${arrived.siege?.sealsBuilt}`);
    check(arrived.siege?.wardenBuilt === true, 'and something is kneeling beside it');
    check(/cold seal/i.test(arrived.objective), 'the chip names the seals rather than asking a question', JSON.stringify(arrived.objective));

    // AND THE ARROW AGREES WITH THE CHIP. "N cold seals left" is one of only two objectives whose
    // place is not a fixed coordinate -- it is whichever seal is nearest and still standing, which
    // depends on where the child is and on what they have already broken. world/destinations.js
    // cannot know either, so main.js supplies it. This is the only place in the suite that proves
    // that supply line in a browser rather than in a unit test with a hand-written list.
    {
      const [tx, tz] = arrived.pointerTarget ?? [null, null];
      const standing = COLD_SEALS.filter((_, i) => arrived.siege?.seals?.[i]?.burst !== true);
      check(standing.some(([x, z]) => x === tx && z === tz),
        'and the arrow is aimed at a seal that is really still standing',
        `target [${tx}, ${tz}] against standing ${JSON.stringify(standing)}`);

      const [hx, hz] = arrived.heroPos;
      const closest = standing
        .map(([x, z]) => ({ x, z, m: Math.hypot(x - hx, z - hz) }))
        .sort((a, b) => a.m - b.m)[0];
      check(closest !== undefined && tx === closest.x && tz === closest.z,
        'and it is the NEAREST one, not the first one written down',
        `target [${tx}, ${tz}], nearest [${closest?.x}, ${closest?.z}] at ${closest?.m?.toFixed(2)}m from [${hx.toFixed(1)}, ${hz.toFixed(1)}]`);
    }
    await aimAt(tab, OLD_BEACON.at[0], OLD_BEACON.at[1]);
    await shot(tab, 'portrait-01-the-cold-beacon');

    // ── break the three seals, for real ──────────────────────────────────────────────────────────
    console.log('── breaking the seals ──');
    for (let index = 0; index < COLD_SEALS.length; index += 1) {
      const [sx, sz] = COLD_SEALS[index];
      // WALK ALONG THE LINE OF APPROACH AND STOP SHORT, which is both what a child does and the only
      // way the turn below has an angle to work with (see SEAL_STANDOFF_M). The stand-off point is
      // computed from where the hero actually IS, not from a fixed compass offset: a point "east of
      // the seal" would send him round it, and the arriving heading is what the swing is judged on.
      assertBudget(`approaching seal ${index + 1}`);
      const from = await state(tab);
      const ax = sx - from.heroPos[0];
      const az = sz - from.heroPos[1];
      const alen = Math.hypot(ax, az) || 1;
      await walkToward(
        tab,
        sx - (ax / alen) * SEAL_STANDOFF_M,
        sz - (az / alen) * SEAL_STANDOFF_M,
        0.7,
        Math.min(70000, Math.max(15000, msLeft())),
      );
      const before = await state(tab);
      if (index === 0) {
        console.log(`  DIAG  at seal 1: heroPos ${JSON.stringify(before.heroPos.map((n) => +n.toFixed(2)))}, `
          + `seal ${JSON.stringify(COLD_SEALS[0])}, attackReady ${before.attackReady}, `
          + `clocks ${JSON.stringify(before.heroClocks)}, net ${before.netStatus}, `
          + `warden ${before.siege.warden.mode}`);
      }
      const wasBurst = before.siege.seals.filter((s) => s.burst).length;
      let cracked = null;
      // Compared against the state before THIS swing, not before the whole seal: diffing against the
      // initial reading makes the predicate permanently true the moment the first blow lands, so
      // every later poll returns instantly and the loop stops pacing itself to the swing at all.
      let priorBlows = before.siege.seals.map((seal) => seal.blows);
      for (let swing = 0; swing < MAX_SWINGS_PER_SEAL; swing += 1) {
        // Re-faced before EVERY swing, not once: a walk that stopped past the stone leaves it behind
        // the hero, and a miss can drift him further.
        const aimed = await faceHero(tab, sx, sz, SEAL_REACH);
        // A stance the game itself will not call strikeable is not a swing worth spending, and a
        // miss from it says nothing about the game. Report it as the harness's own failure to aim.
        if (!lookingAt(aimed, sx, sz, SEAL_REACH)) {
          console.log(`  AIM   could not line the hero up on seal ${index + 1} after ${FACE_ATTEMPTS} `
            + `pulses: hero ${JSON.stringify(aimed.heroPos.map((n) => +n.toFixed(2)))} facing `
            + `${offBy(aimed, sx, sz)} off, ${Math.hypot(sx - aimed.heroPos[0], sz - aimed.heroPos[1]).toFixed(2)} m out `
            + `of a ${SEAL_REACH.toFixed(2)} m reach`);
        }
        // ...and paced to the swing clock, so a tap becomes a SWING rather than being refused.
        await waitUntilSwingReady(tab);
        await tapAttack(tab);
        // 3 s, not 9. This poll's ONLY job is "did that swing land", and a swing takes 1.5 s
        // (SWING_SECONDS) plus a snapshot's own 10 Hz -- so anything past about three seconds is a
        // miss, not a slow hit. At 9 s a seal that legitimately needed a few re-aims spent two
        // minutes of wall clock discovering it, which is how a run that was merely slow got
        // mistaken for a run that was broken.
        const after = await pollUntil(
          tab,
          (s) => s.siege.seals.filter((x) => x.burst).length > wasBurst
            || s.siege.seals.some((x, i) => x.blows > priorBlows[i]),
          3000,
        );
        const priorBefore = priorBlows;
        priorBlows = after.siege.seals.map((seal) => seal.blows);
        if (cracked === null && after.siege.seals.some((x) => x.blows > 0)) {
          cracked = after;
          if (index === 0) {
            check(true, 'the first blow visibly CRACKS a seal rather than doing nothing',
              `blows ${JSON.stringify(after.siege.seals.map((s) => s.blows))}`);
            await shot(tab, 'portrait-02-a-seal-cracked');
          }
        }
        if (after.siege.seals.filter((x) => x.burst).length > wasBurst) break;
        // A swing that changed nothing, from a stance the game called strikeable, is the one shape
        // of miss that is worth a log line -- it is the game saying no to a fair blow.
        if (after.siege.seals.every((x, i) => x.blows === priorBefore[i])) {
          console.log(`  MISS  swing ${swing + 1} at seal ${index + 1} changed nothing: hero `
            + `${JSON.stringify(after.heroPos.map((n) => +n.toFixed(2)))} facing ${offBy(after, sx, sz)} off, `
            + `${Math.hypot(sx - after.heroPos[0], sz - after.heroPos[1]).toFixed(2)} m out, `
            + `blows ${JSON.stringify(after.siege.seals.map((x) => x.blows))}`);
        }
        await sleep(300);
      }
      const done = await state(tab);
      const gone = done.siege.seals.filter((s) => s.burst).length;
      check(gone === index + 1, `seal ${index + 1} of 3 bursts`, `${gone} gone, chip "${done.objective}"`);
      if (gone !== index + 1) break;

      // THE ERRAND DID NOT CHANGE, BUT THE PLACE DID -- and this is where that actually happens to a
      // child rather than to a unit test. The chip still says "N cold seals left"; the arrow now
      // points at a seal seven metres away; and the child is standing about a metre from the one
      // they just burst.
      //
      // A watch keyed on the objective id alone carries that one-metre best across, and then every
      // step toward the next seal is further away than its remembered best. Twelve seconds later a
      // child walking exactly where they were sent is offered help finding it. So what is pinned
      // here is not that the arrow moved -- the check above the seal loop already covers aiming --
      // but that the watch's HISTORY restarted with it.
      if (index + 1 < COLD_SEALS.length && done.rescue) {
        const [tx, tz] = [done.rescue.targetX, done.rescue.targetZ];
        const [burstX, burstZ] = COLD_SEALS[index];
        check(tx !== burstX || tz !== burstZ,
          `the arrow leaves the seal that just burst`,
          `target [${tx}, ${tz}], burst seal [${burstX}, ${burstZ}]`);

        const [hx, hz] = done.heroPos;
        const nowMeters = tx === null ? NaN : Math.hypot(tx - hx, tz - hz);
        // Reset means "measured from here". Carried means "still holding how close they got to the
        // last one", which at a burst seal is roughly arm's length. Half a metre of slack, because
        // reconciliation can nudge them nearer between the reset and this sample; the two values it
        // is telling apart are about seven metres apart.
        // JSON has no Infinity, so an unmeasured best arrives here as null rather than as a number.
        // Reported rather than coerced: a null silently comparing as zero would fail this check for
        // the wrong reason and send whoever reads the log looking for a defect that is not there.
        const best = done.rescue.bestMeters;
        check(typeof best === 'number' && best >= nowMeters - 0.5,
          'and its stuck-clock history restarts at the NEW seal, not at how close the old one got',
          `best ${typeof best === 'number' ? `${best.toFixed(2)}m` : JSON.stringify(best)}`
          + `, now ${nowMeters.toFixed(2)}m from [${tx}, ${tz}]`
          + ` -- the seals are ~7m apart, so a best carried from the burst one reads about 1m`);
      }
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

    // The fight gets whatever is left, capped -- so a slow walk shortens the fight rather than
    // pushing the whole run past the ceiling and losing the verdict entirely.
    assertBudget('starting the fight');
    const fightDeadline = deadlineAfter(Math.min(FIGHT_BUDGET_MS, Math.max(30000, msLeft())));
    let shotPhase2 = false;
    let last = bossBar;
    // THE FIGHT HOLD, ported from drive-marks.mjs where it was probed live. The walk-face-wait-tap
    // cycle above this fight used per-swing cost several CDP round trips, and hosted at d4e6041 it
    // spent SEVEN MINUTES against the Warden without landing a single blow (overhead hp still 120).
    // Instead: the stick stays HELD into the Warden for the whole fight while the in-page walk
    // (stopWithin 0, so it never latches) re-aims it at the LIVE warden position every frame, and
    // the attack taps ride on top as a second touch point. Facing is continuously warden-ward
    // because the hero never stops moving toward it; a knockdown needs no handling, because the
    // respawned hero walks himself back on the same hold. The held deflection is the WALK push
    // (RUN_DEFLECTION exactly), so the per-frame input quantum orbits contact inside ATTACK_REACH.
    // CDP semantics, MEASURED: touchEnd's touchPoints are the points BEING RELEASED, so the tap's
    // touchEnd lists the attack point alone and the final release names the stick.
    const stickOrigin = { x: tab.viewport.width * 0.18, y: tab.viewport.height * 0.86 };
    const FIGHT_STICK_POINT = () => ({
      x: stickOrigin.x, y: stickOrigin.y - Math.round(STICK_PX * RUN_DEFLECTION), id: 1,
    });
    const attackBox = await tab.page.eval(`JSON.stringify((() => {
      const r = document.querySelector('#attack-button').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })())`).then(JSON.parse);
    await tab.page.eval(startWalk(`(() => {
      const w = window.__galaQuestRuntime.zoneSiegeState().warden;
      return { x: w.x, z: w.z };
    })()`, 0));
    await touch(tab, 'touchStart', [{ x: stickOrigin.x, y: stickOrigin.y, id: 1 }]);
    await touch(tab, 'touchMove', [FIGHT_STICK_POINT()]);
    try {
      while (Date.now() < fightDeadline && !last.siege.beaconLit) {
        await touch(tab, 'touchStart', [FIGHT_STICK_POINT(), { x: attackBox.x, y: attackBox.y, id: 2 }]);
        await sleep(60);
        await touch(tab, 'touchEnd', [{ x: attackBox.x, y: attackBox.y, id: 2 }]);
        await sleep(250);
        last = await state(tab);
        if (!shotPhase2 && last.siege.warden.phase >= 2) {
          shotPhase2 = true;
          check(true, 'the Warden reaches a second phase', `hp ${last.siege.warden.hp}/${WARDEN_MAX_HP}`);
          await shot(tab, 'portrait-05-phase-two');
        }
      }
    } finally {
      await tab.page.eval(STOP_WALK);
      await touch(tab, 'touchEnd', [FIGHT_STICK_POINT()]);
    }
    check(last.siege.beaconLit === true, 'the Warden falls and the Old Beacon CATCHES',
      `warden ${last.siege.warden.mode} hp ${last.siege.warden.hp}, beaconLit ${last.siege.beaconLit}`);

    const lit = await pollUntil(tab, (s) => s.siege.beaconLitInScene === true, 20000);
    check(lit.siege.beaconLitInScene === true, 'and the scene agrees the fire is burning');
    // AND THERE IS SOMETHING TO SEE. The previous version of this check stopped at the line above,
    // and the capture it took next was a black basket against a blue sky: the Beacon was lit, the
    // banner said so, and the fire was inside a bowl the child was standing underneath. A flame
    // that clears the tower's own height is the difference between a payoff and a flag.
    const burning = await pollUntil(
      tab, (s) => s.siege.beaconFireHeight > BEACON_TOTAL_HEIGHT_METERS, 12000,
    );
    check(burning.siege.beaconFireHeight > BEACON_TOTAL_HEIGHT_METERS,
      'and the flame stands clear of the cresset, where a child can see it',
      `fire ${burning.siege.beaconFireHeight?.toFixed?.(2)} m against a tower of `
      + `${BEACON_TOTAL_HEIGHT_METERS.toFixed(2)} m`);
    // STEP BACK BEFORE PHOTOGRAPHING IT (docs/MISTAKES.md GQ-010: photograph the subject). Standing
    // at the foot of the tower, aimAt turns the camera at the BASE, and the flame -- which is now a
    // metre and a half above a six-metre tower -- goes off the top of the frame. The first capture
    // with the fire in it cropped exactly the thing the fire was added for. So the hero walks back
    // down the road the way a person does when they want to see the whole of something.
    const backX = OLD_BEACON.at[0];
    const backZ = OLD_BEACON.at[1] - BEACON_PORTRAIT_STANDBACK_M;
    await walkToward(tab, backX, backZ, 1.5, Math.min(30000, Math.max(8000, msLeft())));
    await aimAt(tab, OLD_BEACON.at[0], OLD_BEACON.at[1]);
    await sleep(2500);
    await shot(tab, 'portrait-06-the-beacon-burns');

    const home = await pollUntil(tab, (s) => /Rowan/i.test(s.objective), 20000);
    check(/Rowan/i.test(home.objective), 'and only then does the chip send the child home',
      JSON.stringify(home.objective));

    const errors = await tab.page.eval(`JSON.stringify(window.__galaQuestConsoleErrors ?? [])`).then(JSON.parse);
    check(errors.length === 0, 'no console errors across the whole siege', errors.slice(0, 2).join(' | '));
  } finally {
    await server.kill();
  }
}

run().then(() => {
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}).catch((err) => {
  console.error('\nHARNESS ERROR:', err.message);
  process.exit(1);
});
