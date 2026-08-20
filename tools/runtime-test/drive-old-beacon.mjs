/**
 * G1: boot the running game and WALK the Old Beacon road, end to end, with the touch stick.
 *
 *   node tools/runtime-test/drive-old-beacon.mjs
 *
 * What this proves, in the order a child does it:
 *
 *   finish the camp (Rowan, then the cart) -> the objective names the Beacon -> the Beacon is
 *   ALREADY ON SCREEN from the camp -> walk the new road, waking its lamps on the way -> a stretch
 *   where it is in plain sight and not yet reached -> arrive -> one banner, one arrival, the world
 *   answers -> the post-arrival objective promises nothing that is not built.
 *
 * THE NEW STRETCH IS WALKED, not teleported. The setup half (spawn to the camp, which is Chapter 1's
 * fight seeded away and Chapter 2's trail proven elsewhere by drive-cart-loot.mjs) is one bulk walk
 * with a generous budget; every metre of the G1 path itself is driven through BEACON_ROAD_LIGHTS in
 * order, so a route that does not physically exist cannot pass this file.
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * Cribbed from drive-cart-loot.mjs: its CDP-over-websocket harness, its walkToward() touch-drag, its
 * owned-server-plus-isolated-store isolation (GP3-C2), and drive-relight.mjs/GQ-008's "clear
 * localStorage before the FIRST navigation" discipline for a clean guest.
 *
 * WHY THE BUDGETS LOOK ENORMOUS. docs/MISTAKES.md's "a wall-clock budget waiting on simulated time
 * must account for the frame clamp": a hosted headless runner renders this scene in the low single
 * figures of frames per second, and main.js clamps deltaSeconds to 0.1 s, so an eighteen-metre walk
 * that takes seven seconds on an iPad can take minutes here. Every walk budget below is a LIVENESS
 * check, not a performance assertion -- none of them is allowed to be tightened to make a run look
 * quick, and none of them is a claim about how fast the game is.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openRewardStore } from '../../net/rewardStore.mjs';
import { sanitizeGuestId } from '../../public/src/net/guestId.js';
import {
  BEACON_ROAD_LIGHTS, BEACON_WAYSTONES, CAMP, CART_SEARCH, OLD_BEACON, ROWAN,
} from '../../public/src/world/zones/village.js';
import { WORLD_LIMIT_NORTH } from '../../public/src/world/bounds.js';
import { BEACON_GLOW_REST } from '../../public/src/world/oldBeacon.js';
import { OBJECTIVE_BEACON_IS_COLD, OBJECTIVE_FIND_THE_BEACON } from '../../public/src/world/quest.js';
import { ROWAN_LINE_BEACON_FOUND, ROWAN_LINE_CART_SEARCHED } from '../../public/src/world/rowanSpeech.js';
import { deadlineAfter, movementPulseMillis, pollUntilDeadline } from './automation-timing.mjs';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
const PORTRAIT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
const LANDSCAPE = { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true };
const STICK_PX = 56;
// favicon.ico: this harness's own blank-page trick for pinning localStorage before the real
// navigation always 404s -- the accepted exception every harness in this directory documents.
// lantern_belt.glb: the pre-existing, disclosed gear-track gap.
const COSMETIC_404_PATTERNS = ['/favicon.ico', '/assets/gear/lantern_belt.glb'];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/** A brand-new store per phase, never the real data/rewards.db -- drive-cart-loot.mjs's own
 *  reasoning: a fresh server inherits whatever durable history its store already holds, and this
 *  file's assertions are about a FRESH child's first walk up a road. */
function freshStorePath(label) {
  return join(mkdtempSync(join(tmpdir(), `gq-old-beacon-${label}-`)), 'rewards.db');
}

/** The Beacon road is gated on the Dark Trail, which is gated on the Lantern Tree, which is gated on
 *  Chapter 1's three marks. Fighting that fight here would triple the run to re-prove what
 *  play-fight.mjs already proves; this seeds a returning guest instead, exactly as drive-cart-loot.mjs
 *  does. A brand-new randomUUID guest every phase, never reused. */
function seedUnlockedGuest(storePath, label) {
  const guestId = `g1-beacon-${label}-${randomUUID()}`;
  // MINTED THROUGH THE CLIENT'S OWN RULE, not merely hoped to satisfy it (GQ-007: import the
  // definition, do not restate it). public/src/net/guestId.js caps a guest id at 64 characters and
  // SILENTLY returns null past that, at which point the page mints itself a fresh UUID and quietly
  // plays as somebody else. The first version of this file prefixed `g1-old-beacon-`, which made the
  // reduced-motion phase's id exactly 65 characters -- so that one phase, and only that one, walked
  // the whole game with zero marks, a dark Lantern Tree and a Chapter 2 that never opened. Nothing
  // anywhere said "your id was rejected"; it was a name being four characters too long.
  if (sanitizeGuestId(guestId) !== guestId) {
    throw new Error(`'${guestId}' (${guestId.length} chars) is not an id the client will keep`);
  }
  const store = openRewardStore(storePath);
  for (let i = 1; i <= 3; i += 1) {
    store.apply({ guestId, type: 'mark-earned', eventId: `g1-fixture:mark:${guestId}:${i}` });
  }
  store.apply({ guestId, type: 'lantern-unlocked', eventId: `g1-fixture:unlock:${guestId}` });
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
  /** One bounded retry on a timeout only, never on a real protocol error -- a genuinely broken call
   *  fails the same way twice, a scene this heavy occasionally just stalls a read. */
  async send(method, params = {}) {
    try {
      return await this.sendOnce(method, params);
    } catch (err) {
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

async function openTab() {
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
  const consoleErrors = [];
  page.ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const entry = msg.params.entry;
      const text = entry.url ? `${entry.text} [${entry.url}]` : entry.text;
      if (!COSMETIC_404_PATTERNS.some((p) => text.includes(p))) consoleErrors.push(text);
    }
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.text);
  });
  return {
    page, targetId, consoleErrors, viewport: null,
    close: () => page.send('Target.closeTarget', { targetId }),
  };
}

async function setViewport(tab, viewport) {
  tab.viewport = viewport;
  await tab.page.send('Emulation.setDeviceMetricsOverride', viewport);
  await tab.page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}

async function navigateFresh(tab, origin, url, viewport, guestId) {
  await setViewport(tab, viewport);
  // GQ-008: the clear precedes the FIRST navigation, full stop. An about:blank tab cannot hold
  // localStorage for the real origin, so: clear, navigate once to establish it, pin the guest,
  // then navigate for real.
  await tab.page.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage' });
  await tab.page.send('Page.navigate', { url: `${origin}/favicon.ico` });

  // THE PIN IS POLLED AND READ BACK, not written after a fixed sleep, and this is a repair rather
  // than a flourish. The 300 ms wait this replaces is a coin flip on whether the 404 has COMMITTED
  // its origin yet: lose it and `localStorage.setItem` runs against about:blank's opaque origin,
  // the write goes nowhere, the real navigation mints a brand-new guest, and the run plays the
  // whole game as somebody with zero marks. Observed exactly that way -- a phase that walked the
  // entire road with a dark Lantern Tree and an objective chip still reading "Talk to Keeper
  // Aldric", failing four checks for a reason that had nothing to do with what any of them test.
  // GQ-008's own lesson, one step further on: it is not enough to clear before the first
  // navigation, the identity you intended has to be CONFIRMED before the run trusts it.
  const pinDeadline = deadlineAfter(15000);
  let pinned = null;
  while (Date.now() < pinDeadline && pinned !== guestId) {
    await sleep(150);
    try {
      pinned = await tab.page.eval(`(() => {
        try {
          localStorage.setItem('gq-guest-id', ${JSON.stringify(guestId)});
          return localStorage.getItem('gq-guest-id');
        } catch (err) { return null; }
      })()`);
    } catch { pinned = null; }
  }
  if (pinned !== guestId) throw new Error(`could not pin gq-guest-id on ${origin} (got ${pinned})`);

  await tab.page.send('Page.navigate', { url });
  await waitForZone(tab);

  // And confirm the RUNNING GAME agrees, against its own accessor rather than against the write we
  // just made -- two independent reads, so a pin that stuck and then got overwritten still fails
  // here instead of quietly producing an unseeded playthrough.
  const live = await tab.page.eval('window.__galaQuestRuntime.guestId()');
  if (live !== guestId) throw new Error(`the page is playing as ${live}, not the seeded ${guestId}`);
  const seeded = await pollUntil(tab, (s) => s.marks === 3 && s.lanternUnlocked === true, 15000);
  if (seeded.marks !== 3 || seeded.lanternUnlocked !== true) {
    throw new Error(`the seeded guest arrived with marks ${seeded.marks}, `
      + `lanternUnlocked ${seeded.lanternUnlocked} -- the whole of Chapter 2 is gated on those`);
  }
}

async function waitForZone(tab) {
  let ready = false;
  for (let i = 0; i < 120 && !ready; i += 1) {
    await sleep(500);
    ready = await tab.page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
  }
  if (!ready) throw new Error('runtime never came up');
  let zone = await tab.page.eval('window.__galaQuestRuntime.zoneDebug()');
  for (let i = 0; i < 200 && (zone.requested === 0 || (zone.loaded + zone.failed) < zone.requested); i += 1) {
    await sleep(250);
    zone = await tab.page.eval('window.__galaQuestRuntime.zoneDebug()');
  }
  if (zone.requested === 0 || zone.loaded + zone.failed !== zone.requested || zone.failed > 0) {
    throw new Error(`zone did not finish loading clean: ${JSON.stringify(zone)}`);
  }
  return zone;
}

async function state(tab) {
  return tab.page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    const trail = r.zoneTrailState();
    const net = r.netState();
    return JSON.stringify({
      heroPos: [+r.player.position.x.toFixed(3), +r.player.position.z.toFixed(3)],
      serverPos: net.serverSelf ? [+net.serverSelf.x.toFixed(3), +net.serverSelf.z.toFixed(3)] : null,
      heading: r.follow.heading,
      netStatus: net.status,
      guestId: r.guestId(),
      marks: net.selfId !== null ? (r.rewards()[net.selfId]?.marks ?? null) : null,
      lanternUnlocked: net.selfId !== null ? (r.rewards()[net.selfId]?.lanternUnlocked ?? null) : null,
      treeLit: r.zoneTreeState()?.lit ?? false,
      campFound: trail.campFound,
      rowanMet: trail.rowanMet,
      cartSearched: trail.cartSearched,
      beaconFound: trail.beaconFound,
      beaconBuilt: trail.beaconBuilt,
      waystonesBuilt: trail.waystonesBuilt,
      beaconStirring: trail.beaconStirring,
      beaconGlow: trail.beaconGlow,
      beaconSight: trail.beaconSight,
      beaconRoadLoaded: trail.beaconRoadLoaded,
      beaconRoadLit: trail.beaconRoadLit,
      objective: document.querySelector('#quest-objective')?.textContent ?? null,
      objectiveShown: document.querySelector('#quest-objective')?.dataset.shown ?? null,
      banner: document.querySelector('#banner')?.textContent ?? null,
      npcLine: document.querySelector('#keeper-speech')?.textContent ?? null,
    });
  })()`).then(JSON.parse);
}

const pollUntil = (tab, predicate, timeoutMs) => pollUntilDeadline(
  () => state(tab), predicate, { intervalMs: 150, timeoutMs },
);

const touch = (tab, type, points) => tab.page.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});

/** Real touch-stick movement toward a fixed world point -- drive-village.mjs's own walkToward,
 *  copied verbatim including its release-before-every-read discipline. The stick origin is a
 *  FRACTION of THIS tab's viewport, never a shared constant: an origin computed in one orientation
 *  lands off-screen in the other. */
async function walkToward(tab, targetX, targetZ, stopWithin, maxMillis) {
  const origin = { x: tab.viewport.width * 0.18, y: tab.viewport.height * 0.86 };
  let last = await state(tab);
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
    await touch(tab, 'touchStart', [{ x: origin.x, y: origin.y }]);
    try {
      await touch(tab, 'touchMove', [{ x: origin.x + sx * STICK_PX, y: origin.y - sy * STICK_PX }]);
      await sleep(movementPulseMillis(Math.max(0, distance - stopWithin)));
    } finally {
      await touch(tab, 'touchEnd', []);
    }
    await sleep(80);
    last = await state(tab);
  }
  return last;
}

/**
 * Point the follow camera down a bearing before capturing.
 *
 * docs/MISTAKES.md, "a capture is only evidence if the subject is actually in the frame": a follow
 * camera lands wherever the last leg of a walk left the hero facing, and that bearing is chosen by
 * the route, not by what the shot is for. The first run of this file photographed the Beacon from
 * BEHIND it twice and the way out of the camp facing east, and every one of those captures was
 * useless for the judgement it was taken for. Same fix drive-village-board.mjs's aimAtWorkshop()
 * already makes, using the same runtime accessor.
 *
 * It also fixes the MEASUREMENT, not just the picture: `beaconSight` is read off the live camera, so
 * "is the Beacon on screen" is a question about a bearing. Asking it while the camera happens to
 * point at a tree answers nothing about the route.
 */
async function aimAt(tab, targetX, targetZ) {
  const here = await state(tab);
  const heading = Math.atan2(targetX - here.heroPos[0], targetZ - here.heroPos[1]);
  await tab.page.eval(`window.__galaQuestRuntime.follow.setHeading(${heading})`);
  await sleep(600);
  return state(tab);
}

const aimAtBeacon = (tab) => aimAt(tab, OLD_BEACON.at[0], OLD_BEACON.at[1]);

/** Draw calls and frame cost, read off diagnostics.read() rather than off the debug HUD's text --
 *  drive-village.mjs's own convention. Reported, not gated: this runner is software-rendered at a
 *  few frames a second, so its MILLISECONDS say nothing about an iPad. The DRAW CALL COUNT does
 *  transfer, and it is the number a new stretch of world can quietly ruin. */
async function perf(tab, where) {
  const read = await tab.page.eval('JSON.stringify(window.__galaQuestRuntime.diagnostics.read())')
    .then(JSON.parse);
  console.log(`  PERF  ${where}: draw calls ${read.drawCalls}, `
    + `frame cost ${read.meanMs.toFixed(1)}ms mean / ${read.p90Ms.toFixed(1)}ms p90 `
    + `(runner-bound, not a device measurement), ${read.cssResolution}`);
  return read;
}

async function shot(tab, name) {
  const { data } = await tab.page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}old-beacon-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured old-beacon-${name}.png`);
}

/** Walk the pre-G1 stretch: to the camp, to Rowan, to the cart. Every latch is READ rather than
 *  assumed from distance -- the Beacon objective is gated on all three, and a harness that merely
 *  walked near them would sail on and prove nothing about the gate. */
async function reachTheCartBeat(tab) {
  await walkToward(tab, CAMP.at[0], CAMP.at[1], CAMP.radiusMeters * 0.6, 180000);
  const camp = await pollUntil(tab, (s) => s.campFound === true, 20000);
  // The whole of Chapter 2 is gated on the Lantern Tree actually being lit (main.js), so a camp that
  // does not latch is almost never about the camp -- report the gate, not just the position, or the
  // next reader spends an hour on the wrong end of the chain.
  if (!camp.campFound) {
    throw new Error(`campFound never latched at ${JSON.stringify(camp.heroPos)} `
      + `(treeLit ${camp.treeLit}, net ${camp.netStatus}, lamps loaded ${camp.beaconRoadLoaded})`);
  }

  await walkToward(tab, ROWAN.at[0], ROWAN.at[1], 1.2, 60000);
  const rowan = await pollUntil(tab, (s) => s.rowanMet === true, 6000);
  if (!rowan.rowanMet) throw new Error(`rowanMet never latched at ${JSON.stringify(rowan.heroPos)}`);

  await walkToward(tab, CART_SEARCH.at[0], CART_SEARCH.at[1], 1.0, 60000);
  const cart = await pollUntil(tab, (s) => s.cartSearched === true, 8000);
  if (!cart.cartSearched) throw new Error(`cartSearched never latched at ${JSON.stringify(cart.heroPos)}`);

  // BACK TO ROWAN FOR THE DIRECTIONS. Their line only exists while a child is standing in front of
  // them, so the state read at the cart cannot see it -- the first version of this file asserted the
  // new directions against an empty speech bubble and reported a failure that was entirely its own.
  await walkToward(tab, ROWAN.at[0], ROWAN.at[1], 1.2, 60000);
  return pollUntil(tab, (s) => (s.npcLine ?? '').includes(ROWAN_LINE_CART_SEARCHED), 6000);
}

/**
 * WALK THE G1 PATH. Through the road's own lamps and its own end point, in order, with the stick --
 * this is the part of the run that is not allowed to be a shortcut.
 */
async function walkTheBeaconRoad(tab, label) {
  const seen = [];
  for (const [index, [x, z]] of BEACON_ROAD_LIGHTS.entries()) {
    await walkToward(tab, x, z, 1.6, 90000);
    const at = await pollUntil(tab, (s) => s.beaconRoadLit[index] === true, 5000);
    seen.push(at.beaconRoadLit.filter(Boolean).length);
    await aimAtBeacon(tab);
    await shot(tab, `${label}-0${4 + index}-${index === 0 ? 'early' : 'mid'}-approach`);
  }
  return seen;
}

/**
 * One playthrough of the G1 path.
 *
 * `full` is the canonical proof and runs once, in portrait: it plays the camp beats first, so the
 * objective ladder and Rowan's own lines are asserted where a child meets them, and it walks out to
 * the world's edge and back afterwards.
 *
 * The other two phases are LEAN, and this is a real constraint rather than a shortcut: the hosted
 * playtest matrix gives each harness 18 minutes, and a 3D scene on a software renderer walks at a
 * few frames a second. Landscape exists to prove the route reads in the OTHER orientation and
 * reduced motion exists to prove one branch; neither needs to re-walk the camp to do it. Everything
 * they skip is proven in the full phase, on the same code, in the same run.
 */
async function runPhase({ label, viewport, reducedMotion = false, full = false }) {
  console.log(`\n── phase ${label} (${viewport.width}x${viewport.height}`
    + `${reducedMotion ? ', reduced motion' : ''}${full ? ', full chain' : ', lean'}) ──`);
  const storePath = freshStorePath(label);
  const guestId = seedUnlockedGuest(storePath, label);
  const server = await startOwnedServer({ rewardStorePath: storePath });
  const tab = await openTab();
  try {
    if (reducedMotion) {
      await tab.page.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
    }
    await navigateFresh(tab, server.origin, server.url, viewport, guestId);

    let atCamp;
    if (full) {
      atCamp = await reachTheCartBeat(tab);
      check(`${label}: finishing the cart points the objective at the Beacon`,
        atCamp.objective === OBJECTIVE_FIND_THE_BEACON,
        `chip reads ${JSON.stringify(atCamp.objective)}`);
      check(`${label}: Rowan's directions name the road rather than saying the Beacon must wait`,
        (atCamp.npcLine ?? '').includes(ROWAN_LINE_CART_SEARCHED),
        `line ${JSON.stringify(atCamp.npcLine)}`);
    } else {
      await walkToward(tab, CAMP.at[0], CAMP.at[1], CAMP.radiusMeters * 0.6, 180000);
      atCamp = await pollUntil(tab, (s) => s.campFound === true, 20000);
      check(`${label}: the camp is reached on foot`, atCamp.campFound === true,
        `hero ${JSON.stringify(atCamp.heroPos)}, treeLit ${atCamp.treeLit}, net ${atCamp.netStatus}`);
    }
    check(`${label}: the Old Beacon is built into the zone`, atCamp.beaconBuilt === true,
      `beaconBuilt ${atCamp.beaconBuilt}`);
    check(`${label}: every Beacon road lamp loaded`,
      atCamp.beaconRoadLoaded === BEACON_ROAD_LIGHTS.length,
      `${atCamp.beaconRoadLoaded} of ${BEACON_ROAD_LIGHTS.length}`);
    check(`${label}: both waystones stand on the road up`,
      atCamp.waystonesBuilt === BEACON_WAYSTONES.length,
      `${atCamp.waystonesBuilt} of ${BEACON_WAYSTONES.length}`);
    await shot(tab, `${label}-01-camp-after-cart`);

    // THE WAY OUT. Stand where a child actually stands when they finish with the cart, then look the
    // way the road points -- which is the only bearing the question "can they see where to go" means
    // anything from.
    await walkToward(tab, CAMP.at[0], CAMP.at[1], 1.2, 45000);
    const atMouth = await aimAtBeacon(tab);
    await shot(tab, `${label}-02-the-way-out`);
    check(`${label}: the Beacon is already on screen from the camp, before the walk`,
      atMouth.beaconSight?.onScreen === true,
      `ndc [${atMouth.beaconSight?.ndcX?.toFixed(2)}, ${atMouth.beaconSight?.ndcY?.toFixed(2)}] `
      + `at ${atMouth.beaconSight?.metersFromHero?.toFixed(1)} m`);
    check(`${label}: and it is genuinely far off, not a prop beside the camp`,
      (atMouth.beaconSight?.metersFromHero ?? 0) > 12,
      `${atMouth.beaconSight?.metersFromHero?.toFixed(1)} m from the hero`);
    check(`${label}: arriving has NOT already fired from the camp`, atMouth.beaconFound === false,
      `beaconFound ${atMouth.beaconFound}`);
    // And it sits high in the frame rather than on the floor of it: a landmark a child is meant to
    // walk TOWARD has to be above the horizon, not lying on the ground between their feet.
    check(`${label}: it reads as something up ahead, not as something underfoot`,
      (atMouth.beaconSight?.ndcY ?? -1) > -0.35,
      `ndcY ${atMouth.beaconSight?.ndcY?.toFixed(2)}`);

    const lampsSeen = await walkTheBeaconRoad(tab, label);
    const beforeArrival = await aimAtBeacon(tab);
    check(`${label}: walking the road wakes every one of its lamps in order`,
      beforeArrival.beaconRoadLit.every(Boolean),
      `lit ${JSON.stringify(beforeArrival.beaconRoadLit)} (running count ${JSON.stringify(lampsSeen)})`);
    // THE SEAM THAT MATTERS. The last lamp deliberately stops short of the Beacon (see the zone
    // data), so there is a real stretch where a child can SEE it and has not TOUCHED it. If those
    // two ever collapse onto one frame, the arrival stops being an arrival.
    check(`${label}: there is a stretch where the Beacon is in plain sight and not yet reached`,
      beforeArrival.beaconFound === false
      && beforeArrival.beaconSight?.onScreen === true
      && (beforeArrival.beaconSight?.metersFromHero ?? 0) > OLD_BEACON.radiusMeters,
      `beaconFound ${beforeArrival.beaconFound}, `
      + `${beforeArrival.beaconSight?.metersFromHero?.toFixed(1)} m out, `
      + `onScreen ${beforeArrival.beaconSight?.onScreen}`);
    await shot(tab, `${label}-06-the-reveal`);

    // ARRIVAL. Polled for the arrival and the stir TOGETHER: the stir starts on the frame the
    // arrival latches, and a poll that waits for one and then goes looking for the other can miss a
    // 1.6 s response entirely on a runner this slow.
    await walkToward(tab, OLD_BEACON.at[0], OLD_BEACON.at[1], OLD_BEACON.radiusMeters * 0.8, 60000);
    const arrival = await pollUntil(
      tab, (s) => s.beaconFound === true && (reducedMotion || s.beaconStirring === true), 20000,
    );
    check(`${label}: reaching the Beacon latches the arrival`, arrival.beaconFound === true,
      `hero ${JSON.stringify(arrival.heroPos)}, beacon ${JSON.stringify(OLD_BEACON.at)}`);
    check(`${label}: the arrival banner names the place and claims nothing else`,
      /found the Old Beacon/i.test(arrival.banner ?? '')
      && !/(lit|woke|awake|defend|repair)/i.test(arrival.banner ?? ''),
      `banner ${JSON.stringify(arrival.banner)}`);
    // Reduced motion: the payoff still lands, the movement does not. Never the other way round.
    check(
      reducedMotion
        ? `${label}: reduced motion suppresses the stir but keeps the banner and the objective`
        : `${label}: the world answers -- the cold cresset stirs`,
      reducedMotion ? arrival.beaconStirring === false : arrival.beaconStirring === true,
      `beaconStirring ${arrival.beaconStirring}, glow ${arrival.beaconGlow}`,
    );
    await shot(tab, `${label}-07-arrival`);

    // The stir is one breath and then it is over: a Beacon that keeps pulsing reads as lit.
    const settled = await pollUntil(tab, (s) => s.beaconStirring === false, 8000);
    check(`${label}: the stir finishes and the Beacon returns to cold`,
      settled.beaconStirring === false && Math.abs((settled.beaconGlow ?? 0) - BEACON_GLOW_REST) < 1e-6,
      `glow ${settled.beaconGlow} against a rest of ${BEACON_GLOW_REST}`);

    // THE HONEST END.
    const after = await pollUntil(tab, (s) => s.objective === OBJECTIVE_BEACON_IS_COLD, 5000);
    check(`${label}: the post-arrival objective is the honest one`,
      after.objective === OBJECTIVE_BEACON_IS_COLD,
      `chip reads ${JSON.stringify(after.objective)}`);
    check(`${label}: and it does not promise a G2 action that is not built`,
      !/(light|wake|fix|repair|defend|fight|guard)/i.test(after.objective ?? ''),
      `chip reads ${JSON.stringify(after.objective)}`);
    await aimAtBeacon(tab);
    await shot(tab, `${label}-08-post-arrival`);
    const atBeacon = await perf(tab, `${label} standing at the Beacon`);
    // A budget, not a measurement: the village's own spawn view costs about 53, and a new stretch of
    // world that doubled that would be the kind of quiet regression a screenshot never shows.
    check(`${label}: the Beacon's own frame does not blow the draw-call budget`,
      atBeacon.drawCalls <= 90, `${atBeacon.drawCalls} draw calls`);

    if (full) {
      // THE EDGE OF THE WORLD. Push north past the Beacon until the clamp stops the hero, and
      // confirm it is the clamp that stops them rather than the ground running out under their feet.
      // This leg doubles as the "leave the radius" half of the fires-once check below, rather than
      // spending a separate out-and-back on it: one walk, both properties, and a shorter run.
      //
      // OFFSET SIX METRES WEST of the Beacon's own line, and that is about the CAPTURE rather than
      // the walk: the follow camera trails 15.3 m behind, so a hero due north of the Beacon looking
      // north has the tower standing squarely between the camera and themselves. The first version
      // of this leg photographed a wall of masonry with no hero and no world edge in it -- GQ-010,
      // twice in one file. Six metres west clears it and puts the closing wood in frame, which is
      // the thing this leg exists to show.
      await walkToward(tab, OLD_BEACON.at[0] - 6, WORLD_LIMIT_NORTH + 8, 0.4, 90000);
      const edge = await state(tab);
      check(`${label}: the world still clamps north of the Beacon, on the ground`,
        edge.heroPos[1] <= WORLD_LIMIT_NORTH + 0.05 && edge.heroPos[1] > OLD_BEACON.at[1],
        `hero z ${edge.heroPos[1]} against a north limit of ${WORLD_LIMIT_NORTH}`);
      check(`${label}: and there is real world left between the Beacon and that edge`,
        WORLD_LIMIT_NORTH - OLD_BEACON.at[1] >= 3,
        `${(WORLD_LIMIT_NORTH - OLD_BEACON.at[1]).toFixed(1)} m past the Beacon`);
      check(`${label}: the hero really did leave the arrival radius`,
        (edge.beaconSight?.metersFromHero ?? 0) > OLD_BEACON.radiusMeters,
        `${edge.beaconSight?.metersFromHero?.toFixed(1)} m from the Beacon`);
      await aimAt(tab, edge.heroPos[0], edge.heroPos[1] + 20);
      await shot(tab, `${label}-09-north-edge-the-wood-closes`);

      // BACK PAST THE BEACON AND ON TO ROWAN. Re-entering the radius must not re-serve the arrival,
      // and Rowan is the one thing in this slice that answers the arrival with a person.
      await walkToward(tab, ROWAN.at[0], ROWAN.at[1], 1.2, 240000);
      const again = await state(tab);
      check(`${label}: walking back through does not fire the arrival a second time`,
        again.beaconStirring === false && again.beaconFound === true,
        `beaconStirring ${again.beaconStirring}, beaconFound ${again.beaconFound}`);
      const told = await pollUntil(tab, (s) => (s.npcLine ?? '').includes(ROWAN_LINE_BEACON_FOUND), 6000);
      check(`${label}: Rowan has a new line for a child who has been, and does not hand over the blade`,
        (told.npcLine ?? '').includes(ROWAN_LINE_BEACON_FOUND)
        && !/blade is yours/i.test(told.npcLine ?? ''),
        `line ${JSON.stringify(told.npcLine)}`);
      await aimAtBeacon(tab);
      await shot(tab, `${label}-10-back-at-camp`);
    }

    check(`${label}: no console errors across the whole walk`, tab.consoleErrors.length === 0,
      tab.consoleErrors.slice(0, 3).join(' | '));
  } finally {
    await tab.close().catch(() => {});
    await server.kill?.();
  }
}

/** A FRESH client sees a cold Beacon at rest and no replayed ceremony. Beacon discovery is
 *  session-local by design (see main.js's own `beaconFound` comment), so what "reload produces a
 *  coherent state" has to mean here is: the world is the same world, the Beacon is still standing
 *  and still cold, nothing re-plays, and the chip is truthful for the state the client is actually
 *  in -- docs/MISTAKES.md's "hydration restores state; it must not replay the ceremony". */
async function runReloadPhase() {
  console.log('\n── phase reload ──');
  const storePath = freshStorePath('reload');
  const guestId = seedUnlockedGuest(storePath, 'reload');
  const server = await startOwnedServer({ rewardStorePath: storePath });
  const tab = await openTab();
  try {
    await navigateFresh(tab, server.origin, server.url, PORTRAIT, guestId);
    const first = await state(tab);
    check('reload: a fresh client finds the Beacon already standing and cold',
      first.beaconBuilt === true && first.beaconStirring === false
      && Math.abs((first.beaconGlow ?? 0) - BEACON_GLOW_REST) < 1e-6,
      `built ${first.beaconBuilt}, stirring ${first.beaconStirring}, glow ${first.beaconGlow}`);
    check('reload: and has not been told it arrived somewhere it has not been',
      first.beaconFound === false && first.objective !== OBJECTIVE_BEACON_IS_COLD,
      `beaconFound ${first.beaconFound}, chip ${JSON.stringify(first.objective)}`);

    await tab.page.send('Page.reload', { ignoreCache: false });
    await waitForZone(tab);
    const after = await state(tab);
    check('reload: the zone comes back clean and the Beacon is still there, still cold',
      after.beaconBuilt === true && after.beaconStirring === false
      && Math.abs((after.beaconGlow ?? 0) - BEACON_GLOW_REST) < 1e-6,
      `built ${after.beaconBuilt}, stirring ${after.beaconStirring}, glow ${after.beaconGlow}`);
    check('reload: the objective after a reload is truthful for a client that has not walked yet',
      after.objective !== OBJECTIVE_BEACON_IS_COLD && after.objective !== OBJECTIVE_FIND_THE_BEACON,
      `chip ${JSON.stringify(after.objective)}`);
    check('reload: no console errors', tab.consoleErrors.length === 0,
      tab.consoleErrors.slice(0, 3).join(' | '));
  } finally {
    await tab.close().catch(() => {});
    await server.kill?.();
  }
}

// Phases can be named on the command line while iterating on one of them
// (`node tools/runtime-test/drive-old-beacon.mjs portrait`). With no arguments every phase runs,
// which is the only form that may be quoted as this harness passing.
const only = process.argv.slice(2);
const wanted = (label) => only.length === 0 || only.includes(label);

if (wanted('portrait')) await runPhase({ label: 'portrait', viewport: PORTRAIT, full: true });
if (wanted('landscape')) await runPhase({ label: 'landscape', viewport: LANDSCAPE });
if (wanted('reduced-motion')) await runPhase({ label: 'reduced-motion', viewport: PORTRAIT, reducedMotion: true });
if (wanted('reload')) await runReloadPhase();
if (only.length > 0) console.log(`\n(partial run: ${only.join(', ')} only -- not a full pass)`);

const passed = results.filter((r) => r.passed).length;
console.log(`\n${passed}/${results.length} checks passed`);
writeFileSync(`${OUT}old-beacon-results.json`, JSON.stringify(results, null, 2));
process.exit(failures > 0 ? 1 : 0);
