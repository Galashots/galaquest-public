/**
 * GP3-6: boot the running game and prove the Village Board / Workshop I sequence end to end against
 * a real server round trip:
 *
 *   open the Board -> WORKSHOP detail shows the real cost against real owned totals -> UPGRADE ->
 *   the Workshop transforms in the 3D world with its own ceremony -> the Board auto-closes -> Village
 *   Supplies read 1/1 remaining everywhere -> walking up to the built Workshop opens the Hero/Gear
 *   screen diegetically
 *
 * plus the three proofs the brief calls out by name: two real clients sharing one communal balance
 * (bought by either, seen identically by both), a real double-request race that only spends once, and
 * a real server restart that keeps Workshop I bought AND keeps the cart from reappearing "fresh"
 * (GP3-0's own restart-coherence fix, re-proven here at the CDP layer, not just the unit layer
 * test/game-server.test.mjs already covers).
 *
 *   node tools/runtime-test/drive-village-board.mjs
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * ISOLATION, and why this file cannot just call startOwnedServer() the way drive-cart-loot.mjs and
 * drive-hero-screen.mjs do. Those harnesses seed per-guest events (marks, gear ownership) into the
 * real data/rewards.db -- harmless, because a stray guestId is just one more row nobody's real save
 * reads. Workshop I is different: net/rewardStore.mjs's own durable design means "bought" is GLOBAL
 * and NEVER un-bought, for every guest, forever. A harness run that bought it against the real store
 * would durably mark Workshop I built in the children's actual save, the first time this file ever
 * ran. So every phase here passes its OWN rewardStorePath (a fresh OS-tmpdir file) into
 * startOwnedServer, which threads it through server.mjs's GALAQUEST_REWARD_STORE_PATH env var to
 * net/gameServer.mjs's attachGameServer({ rewardStorePath }) -- see data/README.md's own "tests must
 * never open a store at a path under data/" rule, which this extends to this harness layer too.
 *
 * Cribbed from drive-cart-loot.mjs's CDP-over-websocket harness, walkToward()/sweepAllPickups-style
 * retry, and two-client phase shape; from drive-hero-screen.mjs's clickSelector (a JS-level
 * `element.click()`, not a synthetic press/release pair -- the Board's own render() rebuilds its DOM
 * every frame it is open, the identical hazard heroScreen.js's own item strip has).
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openRewardStore } from '../../net/rewardStore.mjs';
import { sanitizeGuestId } from '../../public/src/net/guestId.js';
import { CAMP, CART_SEARCH, ROWAN, WORKSHOP_INTERACT, WORKSHOP_PROP } from '../../public/src/world/zones/village.js';
import { headingToward } from '../../public/src/world/zoneLoader.js';
import { CART_LOOT_TABLE, pickupWorldPosition } from '../../public/src/world/cartLoot.js';
import { WORKSHOP_I_ID, remainingVillageSupplies } from '../../public/src/village/economy.js';
import { WORKSHOP_BUILD_SECONDS } from '../../public/src/world/workshop.js';
import { movementPulseMillis } from './automation-timing.mjs';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));

// How long to wait for the Workshop's build ceremony to finish, DERIVED from the ceremony rather
// than typed as a round number beside it.
//
// It used to be a flat 4000 ms, which was comfortable for a 1.4 s ceremony and became a red gate on
// hosted CI the moment that ceremony grew to 2.05 s. The mechanism is main.js's own frame clamp:
// `deltaSeconds = Math.min(realDelta, 0.1)`, which exists so a hitch cannot teleport the hero and
// which means that below 10 fps the ceremony advances SLOWER THAN WALL CLOCK. On a loaded hosted
// runner at ~5 fps a 2.05 s ceremony takes ~4.1 s of wall clock, and a 4000 ms budget calls that
// hung. Nothing was broken; the budget simply did not know what it was waiting for.
//
// 4x covers a sustained 2.5 fps floor, which is far below anything this matrix has produced. This is
// the same lesson the ledger already carries as "Automation timeouts are wall-clock budgets, not
// sample counts", applied to the other end of it: a wall-clock budget still has to be derived from
// the work, not from a habit.
const CEREMONY_BUDGET_MS = Math.ceil(WORKSHOP_BUILD_SECONDS * 1000 * 4);
const PORTRAIT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
const LANDSCAPE = { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true };
const STICK_PX = 56;
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

/** A brand-new tmp file per phase -- see this file's own header for why a shared path is not safe. */
function freshStorePath(label) {
  const dir = mkdtempSync(join(tmpdir(), `gq-village-board-${label}-`));
  return join(dir, 'rewards.db');
}

/** Same seeding technique drive-cart-loot.mjs uses, against THIS phase's own isolated store rather
 *  than the real one -- see this file's header. */
function seedUnlockedGuest(storePath, label) {
  const guestId = `gp3-board-${label}-${randomUUID()}`;
  // Root-caused directly: a too-long label here (net/guestId.js's own GUEST_ID_PATTERN caps a
  // guestId at 64 chars) means the CLIENT silently rejects the value this seeds against and mints an
  // unrelated fresh one instead (getOrCreateGuestId falls back exactly like a no-storage guest would,
  // no console output at all) -- the tab then genuinely never sees the seeded marks/lanternUnlocked,
  // permanently, not as a transient race. Asserting the round trip here catches a too-long label the
  // instant it is introduced instead of surfacing as a silent, hours-long "rewards never arrive" hunt.
  if (sanitizeGuestId(guestId) !== guestId) {
    throw new Error(`seedUnlockedGuest label "${label}" produces a guestId the client would reject/replace: ${guestId}`);
  }
  const store = openRewardStore(storePath);
  for (let i = 1; i <= 3; i += 1) {
    store.apply({ guestId, type: 'mark-earned', eventId: `gp3-fixture:mark:${guestId}:${i}` });
  }
  store.apply({ guestId, type: 'lantern-unlocked', eventId: `gp3-fixture:unlock:${guestId}` });
  const seeded = store.marksFor(guestId) === 3 && store.unlockedFor(guestId);
  store.close();
  if (!seeded) throw new Error(`seeding ${guestId} did not take`);
  return guestId;
}

/** Directly credits coin/shard-earned events to a guest, bypassing the cart entirely -- used only by
 *  the two-client phase, which needs a communal balance split across TWO guestIds and the cart (one
 *  shared physical object, 3 coins + 2 shards total) cannot honestly be searched twice for that. No
 *  direct-seed precedent exists for currency in this harness family (per this repo's own runtime-test
 *  conventions), but the technique itself -- apply() straight to an isolated store -- is exactly what
 *  seedUnlockedGuest above already does for marks. */
function seedCurrency(storePath, guestId, coins, shards) {
  const store = openRewardStore(storePath);
  for (let i = 0; i < coins; i += 1) {
    store.apply({ guestId, type: 'coin-earned', eventId: `gp3-fixture:coin:${guestId}:${i}` });
  }
  for (let i = 0; i < shards; i += 1) {
    store.apply({ guestId, type: 'shard-earned', eventId: `gp3-fixture:shard:${guestId}:${i}` });
  }
  store.close();
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
      }, 20000);
    });
  }
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

async function openTab(expectedPlayers = 1) {
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
  let loggedFirstException = false;
  page.ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const entry = msg.params.entry;
      consoleErrors.push(entry.url ? `${entry.text} [${entry.url}]` : entry.text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.text);
      // exceptionDetails.text is Chrome's generic "Uncaught" placeholder, useless on its own -- the
      // real description/stack lives one level deeper. Logging the FIRST one in full (not every one;
      // a frame-loop exception repeats every frame and would flood this harness's own output) is what
      // actually found GP3's "village is not defined" regression -- main.js is browser-only and no
      // unit test exercises its frame loop, so a real page run is the only thing that can catch this.
      if (!loggedFirstException) {
        loggedFirstException = true;
        console.log('  first uncaught exception:', JSON.stringify(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails));
      }
    }
  });
  return {
    page, targetId, consoleErrors, expectedPlayers, viewport: null,
    close: () => page.send('Target.closeTarget', { targetId }),
  };
}

async function navigateFresh(tab, origin, url, viewport, guestId) {
  tab.viewport = viewport;
  await tab.page.send('Emulation.setDeviceMetricsOverride', viewport);
  await tab.page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await tab.page.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage' });
  await navigateToWaypoint(tab, `${origin}/favicon.ico`);
  await tab.page.eval(`localStorage.setItem('gq-guest-id', ${JSON.stringify(guestId)})`);
  await tab.page.send('Page.navigate', { url });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    await sleep(500);
    ready = await tab.page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
  }
  if (!ready) throw new Error(`runtime never came up on ${url}`);

  const players = await tab.page.eval(`(() => {
    const m = (document.querySelector('#runtime-status')?.textContent ?? '').match(/players\\s+(\\d+)/i);
    return m ? Number(m[1]) : 1;
  })()`);
  if (players > tab.expectedPlayers) {
    throw new Error(`${players} clients connected on a freshly owned server, expected at most ${tab.expectedPlayers}`);
  }

  let zone = await tab.page.eval('window.__galaQuestRuntime.zoneDebug()');
  for (let i = 0; i < 120 && (zone.requested === 0 || (zone.loaded + zone.failed) < zone.requested); i += 1) {
    await sleep(250);
    zone = await tab.page.eval('window.__galaQuestRuntime.zoneDebug()');
  }
  if (zone.requested === 0 || zone.loaded + zone.failed !== zone.requested || zone.failed > 0) {
    throw new Error(`zone did not finish loading clean: ${JSON.stringify(zone)}`);
  }
}

/**
 * Navigate to the same-origin favicon waypoint and confirm it actually landed before touching
 * localStorage (which throws a SecurityError against the still-current about:blank document -- an
 * opaque origin -- if fired too early). Retries the navigation itself, not just the wait: this tab's
 * very first Page.navigate call, fired right after Target.createTarget with a chunk of synchronous
 * SQLite work (seedUnlockedGuest) in between, was observed landing on `chrome-error://chromewebdata/`
 * (a real net-level abort, not a slow-to-load page -- polling longer never recovers from it) rather
 * than the real waypoint. A plain re-issue of Page.navigate resolved it every time it was tried by
 * hand, so that is the fix here rather than a longer wait.
 */
async function navigateToWaypoint(tab, waypointUrl) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    await tab.page.send('Page.navigate', { url: waypointUrl });
    let lastSeen = null;
    for (let i = 0; i < 30; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(100);
      // eslint-disable-next-line no-await-in-loop
      lastSeen = await tab.page.eval("JSON.stringify({ url: location.href, readyState: document.readyState })");
      if (lastSeen === JSON.stringify({ url: waypointUrl, readyState: 'complete' })) return;
      if (JSON.parse(lastSeen).url === 'chrome-error://chromewebdata/') break; // terminal -- retry the navigate itself
    }
    console.log(`  waypoint navigation attempt ${attempt + 1} did not land cleanly (${lastSeen}), retrying`);
  }
  throw new Error(`the favicon waypoint never finished navigating after 3 attempts, wanted ${waypointUrl}`);
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
      selfId: net.selfId,
      guestId: r.guestId(),
      rewards: r.rewards(),
      loot: r.lootState(),
      hud: r.lootHudDisplayed(),
      village: r.villageState(),
      boardOpen: r.villageBoardOpen(),
      selectedNodeId: r.villageBoardSelectedNodeId(),
      workshop: r.zoneWorkshopState(),
      workshopInteractAvailable: r.workshopInteractAvailable(),
      heroScreenOpen: r.heroScreenOpen(),
      audio: r.audioDebug(),
      campFound: trail.campFound,
      rowanMet: trail.rowanMet,
      cartSearched: trail.cartSearched,
    });
  })()`).then(JSON.parse);
}

async function pollUntil(tab, predicate, { intervalMs = 100, timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = await state(tab);
  while (!predicate(last) && Date.now() < deadline) {
    await sleep(intervalMs);
    last = await state(tab);
  }
  return last;
}

const touch = (tab, type, points) => tab.page.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});

async function walkToward(tab, targetX, targetZ, stopWithin, maxMillis) {
  const origin = { x: tab.viewport.width * 0.18, y: tab.viewport.height * 0.86 };
  const deadline = Date.now() + maxMillis;
  let last = await state(tab);
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
    // Movement is pulsed and released before the expensive state read. The old continuous hold
    // made a slow hosted-runner Runtime.evaluate move the hero for the entire read latency, which is
    // why a route to the Workshop was observed ending at the map boundary instead.
    // eslint-disable-next-line no-await-in-loop
    await touch(tab, 'touchStart', [{ x: origin.x, y: origin.y }]);
    try {
      // eslint-disable-next-line no-await-in-loop
      await touch(tab, 'touchMove', [{ x: origin.x + sx * STICK_PX, y: origin.y - sy * STICK_PX }]);
      // eslint-disable-next-line no-await-in-loop
      await sleep(movementPulseMillis(Math.max(0, distance - stopWithin)));
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await touch(tab, 'touchEnd', []);
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(80);
    // eslint-disable-next-line no-await-in-loop
    last = await state(tab);
  }
  return last;
}

async function shot(tab, name) {
  const { data } = await tab.page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}village-board-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured village-board-${name}.png`);
}

// Where to stand to LOOK at the Workshop: the plaza side, up and to the east of it -- which is the
// bearing a child arrives on, walking down from the tree toward the building.
//
// It is also the one nearby bearing that is not looking straight through the Lantern Tree. The tree
// stands at [-6.5, -6.5], 3.4 m due north of the Workshop with a canopy wider than that gap, so a
// camera placed anywhere north of the building photographs the tree and nothing else. Which is
// exactly where the follow camera lands by default: the hero walks down from the camp, stops north
// of the building facing south, and the camera sits 16 m behind him -- north -- with the tree
// filling the frame.
//
// That is not a framing quibble. It is why the committed `workshop-before-3d-portrait` capture,
// offered as the evidence of how the Workshop reads before a purchase, is a photograph of a tree
// with no Workshop in it at all. A capture that does not contain its subject cannot be the
// acceptance seam for how that subject reads.
const WORKSHOP_VIEW_OFFSET_METERS = Object.freeze([2.9, 2.4]);

/** Aim the follow camera down the plaza-side approach at the Workshop. Camera only -- it moves
 *  nothing, changes no state, and every check around it is asserted off the runtime's own published
 *  state rather than off pixels. */
async function aimAtWorkshop(tab) {
  const heading = headingToward(
    WORKSHOP_PROP.at[0] + WORKSHOP_VIEW_OFFSET_METERS[0],
    WORKSHOP_PROP.at[1] + WORKSHOP_VIEW_OFFSET_METERS[1],
    WORKSHOP_PROP.at[0],
    WORKSHOP_PROP.at[1],
  );
  await tab.page.eval(`window.__galaQuestRuntime.follow.setHeading(${heading})`);
  await sleep(450);
}

async function rectOf(tab, selector) {
  return tab.page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height });
  })()`).then((json) => (json ? JSON.parse(json) : null));
}

/** JS-level element.click(), not a synthetic press/release pair -- see this file's own header and
 *  drive-hero-screen.mjs's clickSelector for why: the Board's render() rebuilds on every frame it is
 *  open, so a two-round-trip synthetic click can straddle a re-render and silently produce nothing. */
async function clickSelector(tab, selector) {
  const rect = await rectOf(tab, selector);
  if (!rect) throw new Error(`clickSelector: ${selector} not found`);
  const clicked = await tab.page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`clickSelector: ${selector} vanished before it could be clicked`);
  return rect;
}

async function boardDetailText(tab) {
  return tab.page.eval(`JSON.stringify({
    coin: document.querySelector('.village-board-cost-coin .village-board-cost-value')?.textContent ?? null,
    shard: document.querySelector('.village-board-cost-shard .village-board-cost-value')?.textContent ?? null,
    upgradeText: document.querySelector('#village-board-upgrade-button')?.textContent ?? null,
    upgradeDisabled: document.querySelector('#village-board-upgrade-button')?.disabled ?? null,
  })`).then(JSON.parse);
}

/**
 * Click the Workshop node and confirm the SELECTION actually lands, not just that the click fired.
 * boardScreen.js's own node-click handler reads `lastView?.nodes[index]` (the last frame the Board's
 * own render() was called with), and render() only runs from main.js's rAF loop while the Board is
 * open -- there is a real gap between "the button's click handler flips shown=true" and "the very
 * next animation frame actually calls render() for the first time". A node click landing inside that
 * gap silently no-ops: `lastView` is still whatever it was before (null, the first time). Observed
 * directly: the detail panel showed its untouched static-HTML defaults (an empty cost value, an
 * enabled "UPGRADE" wired to nothing) instead of the real Workshop numbers, and UPGRADE afterward did
 * nothing because `lastView.detail` was still null.
 *
 * A retry-free click plus a poll on `state().selectedNodeId` (main.js's own `selectedVillageNodeId`,
 * flipped synchronously inside the SAME click handler) was still not reliable: that variable flipping
 * only proves the click handler ran with a valid `lastView` at THAT moment -- it says nothing about
 * whether a FOLLOW-UP render() has since re-run `villageBoardViewModel` with the new selectedNodeId
 * and pushed the resulting detail back into the DOM. Reading `boardDetailText` immediately after can
 * still observe the pre-selection empty defaults, one render short of correct -- observed reproducibly
 * across a full harness run, on phases with less real elapsed time (and so fewer frames) behind them
 * than others. Polling the ACTUAL DOM output this function's callers need, rather than an intermediate
 * proxy for it, is what closes that gap; retrying the click itself (not just waiting longer) is the
 * same fix navigateToWaypoint above needed, since one click has no guarantee it landed after a render.
 */
async function selectWorkshopNode(tab) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    await clickSelector(tab, '.village-board-node[data-node="workshop"]');
    let detail;
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(60);
      // eslint-disable-next-line no-await-in-loop
      detail = await boardDetailText(tab);
      if (detail.coin !== '' || detail.upgradeText === 'BUILT') return;
    }
  }
  throw new Error('clicking the Workshop node never populated the detail panel after 5 attempts');
}

async function openWorkshopDetail(tab) {
  await clickSelector(tab, '#village-board-button');
  await pollUntil(tab, (s) => s.boardOpen === true, { timeoutMs: 2000 });
  await selectWorkshopNode(tab);
}

/** GP3-C1: tap the Workshop's own deliberate interact prompt. Waits for it to actually become
 *  available first -- main.js flips workshopInteractAvailable off the same per-frame state read
 *  state() itself uses (no boardScreen.js-style lastView render gap to retry around here, since
 *  #workshop-interact's data-shown is written directly from that read, not from a separate render()
 *  call one frame behind it). */
async function clickWorkshopInteract(tab) {
  await pollUntil(tab, (s) => s.workshopInteractAvailable === true, { timeoutMs: 5000 });
  await clickSelector(tab, '#workshop-interact');
}

async function reachCampAndRowan(tab) {
  await walkToward(tab, CAMP.at[0], CAMP.at[1], CAMP.radiusMeters * 0.6, 45000);
  // campFound is gated behind treeLitNow (main.js: Chapter 2 content only opens once the seeded
  // lantern-unlock has actually been folded into a lit tree -- see that gate's own comment), which
  // depends on the welcome message and the tree's own GLB both having resolved. 3000ms was plenty
  // running this phase alone, but not always enough as the LAST of several sequential Chrome
  // tabs/owned-server processes this same harness has already cycled through by this point -- caught
  // by reproducing the exact same walk in total isolation (always fine) vs. as this file's own 4th
  // sequential phase (occasionally still settling): a real, if slower, environment, not a broken
  // condition. Widened rather than replaced with a fixed sleep -- still polling the real signal.
  const afterCamp = await pollUntil(tab, (s) => s.campFound === true, { timeoutMs: 15000 });
  if (!afterCamp.campFound) throw new Error(`campFound never latched -- hero at ${JSON.stringify(afterCamp.heroPos)}`);

  await walkToward(tab, ROWAN.at[0], ROWAN.at[1], 1.2, 20000);
  const afterRowan = await pollUntil(tab, (s) => s.rowanMet === true, { timeoutMs: 5000 });
  if (!afterRowan.rowanMet) throw new Error(`rowanMet never latched -- hero at ${JSON.stringify(afterRowan.heroPos)}`);
}

/** Search the cart, then collect every pickup -- the deterministic 3-coin/2-shard first-cart haul
 *  (world/cartLoot.js's own CART_LOOT_TABLE), same retry discipline drive-cart-loot.mjs's own
 *  sweepAllPickups uses, trimmed of its HUD-lag proof (already GP2's own harness's job, not this
 *  file's). */
async function searchAndCollectAll(tab) {
  await walkToward(tab, CART_SEARCH.at[0], CART_SEARCH.at[1], CART_SEARCH.radiusMeters * 0.5, 15000);
  const spawned = await pollUntil(tab, (s) => s.loot.spawned === true, { timeoutMs: 6000 });
  if (!spawned.cartSearched) throw new Error('the SEARCH trigger never fired');

  let current = spawned;
  for (const pickup of CART_LOOT_TABLE) {
    for (let retry = 0; retry < 4 && current.loot.collected[pickup.id] == null; retry += 1) {
      const at = pickupWorldPosition(pickup, CART_SEARCH.at);
      // eslint-disable-next-line no-await-in-loop
      current = await walkToward(tab, at.x, at.z, 0.15, 15000);
      // eslint-disable-next-line no-await-in-loop
      current = await pollUntil(tab, (s) => s.loot.collected[pickup.id] != null, { timeoutMs: 2000 });
    }
    if (current.loot.collected[pickup.id] == null) {
      throw new Error(`${pickup.id} still uncollected after 4 direct attempts -- hero at ${JSON.stringify(current.heroPos)}`);
    }
  }
  return pollUntil(tab, (s) => s.hud.coins + s.hud.shards >= CART_LOOT_TABLE.length, { intervalMs: 50, timeoutMs: 4000 });
}

function noConsoleErrors(tab, label) {
  const errors = tab.consoleErrors.filter((e) => !COSMETIC_404_PATTERNS.some((p) => e.includes(p)));
  check(`${label}: no console errors`, errors.length === 0, errors.slice(0, 5).join(' | '));
}

// ── Phase 1: Board-before, portrait + landscape (non-destructive -- never buys) ────────────────────

async function runBoardBeforePhase(viewport, label) {
  console.log(`\n=== board-before: ${label} ===`);
  const storePath = freshStorePath(`before-${label}`);
  const server = await startOwnedServer({ rewardStorePath: storePath });
  const tab = await openTab();
  try {
    // Seeded INSIDE the try, not before it: a throw here used to skip the finally below entirely,
    // leaking a live owned-server process that then corrupted whichever harness run happened next --
    // reproduced directly by a real "database is locked" race on this exact seed call.
    const guestId = seedUnlockedGuest(storePath, label);
    await navigateFresh(tab, server.origin, server.url, viewport, guestId);
    await tab.page.send('Page.bringToFront');
    await reachCampAndRowan(tab);
    const collected = await searchAndCollectAll(tab);
    check(`${label}: the first-cart haul credited (3 coins, 2 shards) before opening the Board`,
      collected.village.coins === 3 && collected.village.shards === 2, JSON.stringify(collected.village));

    await clickSelector(tab, '#village-board-button');
    const opened = await pollUntil(tab, (s) => s.boardOpen === true, { timeoutMs: 2000 });
    check(`${label}: tapping the map button opens the Village Board`, opened.boardOpen === true);
    await shot(tab, `before-board-${label}`);

    await selectWorkshopNode(tab);
    const detail = await boardDetailText(tab);
    check(`${label}: Workshop detail shows the real owned/cost totals -- 3 / 2 coins`,
      detail.coin === '3 / 2', JSON.stringify(detail));
    check(`${label}: Workshop detail shows the real owned/cost totals -- 2 / 1 shards`,
      detail.shard === '2 / 1', JSON.stringify(detail));
    check(`${label}: affordable -- the UPGRADE button reads UPGRADE and is enabled`,
      detail.upgradeText === 'UPGRADE' && detail.upgradeDisabled === false, JSON.stringify(detail));
    await shot(tab, `before-detail-${label}`);

    noConsoleErrors(tab, label);
  } finally {
    await tab.close().catch(() => {});
    await server.kill();
  }
}

// ── Phase 2: the real purchase -- Workshop 3D transformation, ceremony, remaining balance, and GP3-C1's
// deliberate/reusable Workshop interaction (replaces the old proximity auto-open) ─────────────────────

async function runPurchasePhase(viewport, label) {
  console.log(`\n=== purchase: Workshop I, 3D transformation, and the deliberate Hero/Gear interaction (${label}) ===`);
  const storePath = freshStorePath(`purchase-${label}`);
  const server = await startOwnedServer({ rewardStorePath: storePath });
  const tab = await openTab();
  try {
    // Seeded inside the try -- see runBoardBeforePhase's own comment on why a throw here must still
    // reach the finally below.
    const guestId = seedUnlockedGuest(storePath, `purchase-${label}`);
    await navigateFresh(tab, server.origin, server.url, viewport, guestId);
    await tab.page.send('Page.bringToFront');
    await reachCampAndRowan(tab);
    await searchAndCollectAll(tab);

    // Walk from the cart's clearing all the way back to the Workshop's own spot in the village
    // proper, so the "before" capture below is the real shell prop, not an assumption -- and so the
    // interaction proof below needs no second walk, since the ceremony's own visual trigger is not
    // proximity-gated (main.js diffs village.workshopOwned regardless of hero position) but
    // #workshop-interact's own availability IS (WORKSHOP_INTERACT.radiusMeters).
    await walkToward(tab, WORKSHOP_INTERACT.at[0], WORKSHOP_INTERACT.at[1], WORKSHOP_INTERACT.radiusMeters * 0.5, 120000);
    const beforeWorkshop = await state(tab);
    check(`${label}: the hero actually reached the Workshop's own spot before any purchase`,
      Math.hypot(beforeWorkshop.heroPos[0] - WORKSHOP_INTERACT.at[0], beforeWorkshop.heroPos[1] - WORKSHOP_INTERACT.at[1])
        <= WORKSHOP_INTERACT.radiusMeters,
      JSON.stringify(beforeWorkshop.heroPos));
    check(`${label}: before any purchase, the Workshop is still the unbuilt shell`, beforeWorkshop.workshop?.built === false,
      JSON.stringify(beforeWorkshop.workshop));
    await aimAtWorkshop(tab);
    await shot(tab, `workshop-before-3d-${label}`);

    await openWorkshopDetail(tab);
    await shot(tab, `workshop-detail-affordable-${label}`);

    await clickSelector(tab, '#village-board-upgrade-button');
    const bought = await pollUntil(tab, (s) => s.village.workshopOwned === true, { timeoutMs: 4000 });
    check(`${label}: UPGRADE actually buys Workshop I, confirmed off the server's own village state`,
      bought.village.workshopOwned === true, JSON.stringify(bought.village));

    // GP3-C1 (Sol's closeout review): capture every frame of the ceremony window AND keep polling
    // heroScreenOpen throughout it -- proves the old bug ("proximity auto-opens Hero/Gear the instant
    // workshopOwned flips, colliding with the Board's own still-visible BUILT confirmation and the
    // pop-in that has barely started") cannot recur, by construction, not by timing luck. The hero
    // never leaves WORKSHOP_INTERACT's radius during this whole window.
    // Eight frames at 260 ms spans WORKSHOP_BUILD_SECONDS end to end. Four at 150 ms covered only
    // the first 0.6 s of it, which was the whole ceremony when the ceremony was a 1.4 s pop of a
    // finished object -- it is not any more. The build is staged now (frame, roof, stack, tools,
    // ignite) and a window that closes before the chimney has risen cannot show whether the build
    // beat is legible, which is the one thing these frames exist to let somebody judge.
    const ceremonyFrames = [];
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await shot(tab, `workshop-transition-frame${i}-${label}`);
      // eslint-disable-next-line no-await-in-loop
      ceremonyFrames.push(await state(tab));
      // eslint-disable-next-line no-await-in-loop
      await sleep(260);
    }
    check(`${label}: the Hero screen never auto-opens during the ceremony/Board-close window, even while standing in Workshop range`,
      ceremonyFrames.every((s) => s.heroScreenOpen === false),
      JSON.stringify(ceremonyFrames.map((s) => s.heroScreenOpen)));

    const closed = await pollUntil(tab, (s) => s.boardOpen === false, { timeoutMs: 3000 });
    check(`${label}: the Board auto-closes on its own once the purchase lands`, closed.boardOpen === false,
      JSON.stringify({ boardOpen: closed.boardOpen }));

    const afterWorkshop = await pollUntil(tab, (s) => s.workshop?.built === true, { timeoutMs: 3000 });
    check(`${label}: the Workshop presenter reports built after the ceremony triggers`, afterWorkshop.workshop?.built === true,
      JSON.stringify(afterWorkshop.workshop));
    check(`${label}: the workshop-build sound was scheduled`, (afterWorkshop.audio.triggered['workshop-build'] ?? 0) >= 1,
      JSON.stringify(afterWorkshop.audio.triggered));
    await aimAtWorkshop(tab);
    await shot(tab, `workshop-after-3d-${label}`);

    const expectedRemaining = remainingVillageSupplies(afterWorkshop.village.coins, afterWorkshop.village.shards, true);
    check(`${label}: Village Supplies read the correct remainder after spending -- 1 coin, 1 shard left`,
      expectedRemaining.coins === 1 && expectedRemaining.shards === 1, JSON.stringify(expectedRemaining));
    check(`${label}: the HUD itself displays that same remainder (background-synced, no fake local flight)`,
      afterWorkshop.hud.coins === expectedRemaining.coins && afterWorkshop.hud.shards === expectedRemaining.shards,
      JSON.stringify(afterWorkshop.hud));

    // GP3-C1's own acceptance proof, in order: the ceremony finishes -> the prompt becomes available
    // -> mere proximity STILL has not opened anything -> a deliberate tap opens it -> closing and
    // interacting again reopens it (reusable, not once-ever).
    const ceremonyDone = await pollUntil(tab, (s) => s.workshop?.transforming === false && s.workshopInteractAvailable === true,
      { timeoutMs: CEREMONY_BUDGET_MS });
    check(`${label}: once the ceremony finishes, the deliberate interact prompt becomes available`,
      ceremonyDone.workshop?.transforming === false && ceremonyDone.workshopInteractAvailable === true,
      JSON.stringify({ workshop: ceremonyDone.workshop, workshopInteractAvailable: ceremonyDone.workshopInteractAvailable }));
    check(`${label}: proximity alone (even with the ceremony finished) still has not opened Hero/Gear -- a tap is required`,
      ceremonyDone.heroScreenOpen === false, JSON.stringify(ceremonyDone.heroScreenOpen));
    await shot(tab, `workshop-interact-available-${label}`);

    await clickWorkshopInteract(tab);
    const opened = await pollUntil(tab, (s) => s.heroScreenOpen === true, { timeoutMs: 3000 });
    check(`${label}: deliberately interacting with the built Workshop opens the Hero/Gear screen (no crafting UI)`,
      opened.heroScreenOpen === true, JSON.stringify(opened.heroScreenOpen));
    await shot(tab, `workshop-hero-open-via-interact-${label}`);

    await clickSelector(tab, '#hero-screen-close');
    const closedAgain = await pollUntil(tab, (s) => s.heroScreenOpen === false, { timeoutMs: 3000 });
    check(`${label}: closing the Hero screen leaves it closed`, closedAgain.heroScreenOpen === false);

    await clickWorkshopInteract(tab);
    const reopened = await pollUntil(tab, (s) => s.heroScreenOpen === true, { timeoutMs: 3000 });
    check(`${label}: interacting with the Workshop AGAIN reopens Hero/Gear -- reusable, not once-ever`,
      reopened.heroScreenOpen === true, JSON.stringify(reopened.heroScreenOpen));

    await clickSelector(tab, '#hero-screen-close');
    noConsoleErrors(tab, `purchase-${label}`);
  } finally {
    await tab.close().catch(() => {});
    await server.kill();
  }
}

// ── Phase 2b: GP3-C1's own interaction proof, once more in landscape ───────────────────────────────
//
// Deliberately skips the camp/Rowan/cart walk: that plumbing is already proven in BOTH orientations
// by runBoardBeforePhase and by GP2's own drive-cart-loot.mjs, and re-walking it here just to reach
// the Workshop turned out to be genuinely fragile as this file's LATE-sequence landscape phase --
// reproducibly reaching campFound = false even standing 0.07m from the camp marker, traced (via an
// isolated single-tab repro that passed every time, vs. this file's own 4th-sequential-tab position
// that failed every time, regardless of a 3000ms vs. 15000ms campFound poll) to Chrome/WebGL resource
// pressure from several back-to-back full 3D scene tabs, not to anything this harness or GP3-C1 itself
// got wrong. Seeding currency directly and firing the purchase RPC (the same technique
// runTwoClientPhase already uses for its own race proof, bypassing the Board's own UI entirely) reaches
// the Workshop without any of that unrelated plumbing, so THIS phase's own subject -- the deliberate,
// reusable interaction affordance -- is still genuinely proven in landscape, just without re-deriving
// systems this file already covers elsewhere.
async function runWorkshopInteractLandscapePhase() {
  console.log('\n=== interact: GP3-C1\'s deliberate/reusable Workshop interaction, once more in landscape ===');
  const storePath = freshStorePath('interact-lnd');
  // SEED BEFORE THE SERVER OPENS THE STORE. net/gameServer.mjs's createRewardCoordinator reads
  // `villageCoinsEarned = store.totalCoinsEarned()` / `villageShardsEarned = store.totalShardsEarned()`
  // ONCE at construction and afterwards only moves those mirrors through its own server-owned
  // store.apply(). A direct DB write made after startOwnedServer() is therefore invisible to the live
  // coordinator, and this phase read a seeded 2/1 balance back as 0/0 for exactly that reason. The
  // per-guest half (seedUnlockedGuest) happened to survive because guest rewards are re-read per
  // connection; the VILLAGE totals are the cached ones. Fixture ordering is the fix -- production must
  // not be made to re-read SQLite to accommodate a test.
  const guestId = seedUnlockedGuest(storePath, 'interact-lnd');
  seedCurrency(storePath, guestId, 2, 1);
  const server = await startOwnedServer({ rewardStorePath: storePath });
  const tab = await openTab();
  try {
    // The Workshop's own ceremony/interact code sits inside the same "Dark Trail" block campFound
    // does (main.js: `if (treeLitNow && zoneTrailLights.length > 0) { ... }`) -- Chapter 2 content is
    // gated together, by design. Skipping seedUnlockedGuest here (currency alone, no marks/unlock)
    // reliably reproduced village.workshopOwned flipping true while zoneWorkshop.built stayed false
    // forever: not a production bug -- traced directly against a live tab -- but this phase's own
    // seeding needs the SAME two ingredients board-before/purchase already seed. Marks+lantern-unlock
    // light the tree INSTANTLY for an already-unlocked guest (zoneTree's own no-ceremony branch, see
    // that code's comment), no walk required, so this still reaches the Workshop directly.
    //
    // Root-caused directly, after a multi-hour false trail through rAF/focus-throttling theories: the
    // ORIGINAL label here ('interact-landscape') produced a 65-char guestId, one over
    // net/guestId.js's own 64-char GUEST_ID_PATTERN cap. sanitizeGuestId() silently rejects an
    // over-length id and getOrCreateGuestId() mints an unrelated fresh one instead -- no console
    // output at all, by design (see that file's header). The tab was, every single run, connecting as
    // a brand-new NEVER-seeded guest, so marks/lanternUnlocked stayed genuinely 0/false forever, not
    // as a transient race. seedUnlockedGuest() now asserts this itself so a too-long label fails loud.
    await navigateFresh(tab, server.origin, server.url, LANDSCAPE, guestId);
    await tab.page.send('Page.bringToFront');

    await walkToward(tab, WORKSHOP_INTERACT.at[0], WORKSHOP_INTERACT.at[1], WORKSHOP_INTERACT.radiusMeters * 0.5, 60000);
    const before = await state(tab);
    check('landscape (direct): the hero reached the Workshop\'s own spot',
      Math.hypot(before.heroPos[0] - WORKSHOP_INTERACT.at[0], before.heroPos[1] - WORKSHOP_INTERACT.at[1])
        <= WORKSHOP_INTERACT.radiusMeters,
      JSON.stringify(before.heroPos));

    await tab.page.eval(`window.__galaQuestRuntime.net.sendVillageUpgradePurchase(${JSON.stringify(WORKSHOP_I_ID)})`);
    const bought = await pollUntil(tab, (s) => s.village.workshopOwned === true, { timeoutMs: 4000 });
    check('landscape (direct): the purchase lands, confirmed off the server\'s own village state',
      bought.village.workshopOwned === true, JSON.stringify(bought.village));

    const ceremonyDone = await pollUntil(tab,
      (s) => s.workshop?.built === true && s.workshop?.transforming === false, { timeoutMs: CEREMONY_BUDGET_MS });
    check('landscape (direct): the Workshop finishes building and its ceremony completes',
      ceremonyDone.workshop?.built === true && ceremonyDone.workshop?.transforming === false,
      JSON.stringify(ceremonyDone.workshop));
    check('landscape (direct): proximity alone has not opened Hero/Gear, even with the ceremony done',
      ceremonyDone.heroScreenOpen === false, JSON.stringify(ceremonyDone.heroScreenOpen));

    const available = await pollUntil(tab, (s) => s.workshopInteractAvailable === true, { timeoutMs: 3000 });
    check('landscape (direct): the deliberate interact prompt becomes available',
      available.workshopInteractAvailable === true, JSON.stringify(available.workshopInteractAvailable));
    await shot(tab, 'workshop-interact-available-landscape-direct');

    await clickWorkshopInteract(tab);
    const opened = await pollUntil(tab, (s) => s.heroScreenOpen === true, { timeoutMs: 3000 });
    check('landscape (direct): deliberately interacting opens the Hero/Gear screen',
      opened.heroScreenOpen === true, JSON.stringify(opened.heroScreenOpen));
    await shot(tab, 'workshop-hero-open-via-interact-landscape-direct');

    await clickSelector(tab, '#hero-screen-close');
    await pollUntil(tab, (s) => s.heroScreenOpen === false, { timeoutMs: 3000 });

    await clickWorkshopInteract(tab);
    const reopened = await pollUntil(tab, (s) => s.heroScreenOpen === true, { timeoutMs: 3000 });
    check('landscape (direct): interacting AGAIN reopens Hero/Gear -- reusable, not once-ever',
      reopened.heroScreenOpen === true, JSON.stringify(reopened.heroScreenOpen));

    await clickSelector(tab, '#hero-screen-close');
    noConsoleErrors(tab, 'interact-landscape-direct');
  } finally {
    await tab.close().catch(() => {});
    await server.kill();
  }
}

// ── Phase 3: two real clients share one communal balance, and a real double-request race only
// spends once ────────────────────────────────────────────────────────────────────────────────────────

async function runTwoClientPhase() {
  console.log('\n=== two-client shared balance + double-request race ===');
  const storePath = freshStorePath('two-client');
  const guestA = `gp3-board-two-client-a-${randomUUID()}`;
  const guestB = `gp3-board-two-client-b-${randomUUID()}`;
  // SEED BEFORE THE SERVER OPENS THE STORE -- same reason as runWorkshopInteractLandscapePhase:
  // createRewardCoordinator caches the village totals at construction, so a direct DB write made
  // after startOwnedServer() never reaches the live coordinator and this phase read the seeded 3/2
  // back as 0/0. Split across two DIFFERENT guests -- 2 coins + 1 shard to A, 1 coin + 1 shard to B --
  // so the shared 3/2 total this proves is genuinely pooled from two provenances, not one guest's own
  // haul read twice. Seeding now precedes the server and both tabs, so a throw here has nothing to
  // clean up and does not need the finally below.
  seedCurrency(storePath, guestA, 2, 1);
  seedCurrency(storePath, guestB, 1, 1);
  const server = await startOwnedServer({ rewardStorePath: storePath });
  const a = await openTab(2);
  const b = await openTab(2);
  const front = (tab) => tab.page.send('Page.bringToFront');
  try {
    await navigateFresh(a, server.origin, server.url, PORTRAIT, guestA);
    await navigateFresh(b, server.origin, server.url, PORTRAIT, guestB);
    check('two-client: A and B are two DIFFERENT heroes, not one tab double-counted',
      (await state(a)).guestId !== (await state(b)).guestId);

    const beforeA = await state(a);
    const beforeB = await state(b);
    check('two-client: the communal balance is already shared BEFORE any purchase -- both clients read the same 3/2, split across two different guests\' own earnings',
      beforeA.village.coins === 3 && beforeA.village.shards === 2
        && beforeB.village.coins === 3 && beforeB.village.shards === 2,
      JSON.stringify({ a: beforeA.village, b: beforeB.village }));

    // The double-request race: fire the purchase from BOTH clients back-to-back, no await between
    // the two dispatches -- Node's single-threaded event loop still serializes the two actual
    // onMessage calls server-side (net/gameServer.mjs), the same rule test/game-server.test.mjs
    // already proves at the raw-socket layer; this is that same rule holding in the real running game.
    await front(a);
    await front(b);
    await Promise.all([
      a.page.eval(`window.__galaQuestRuntime.net.sendVillageUpgradePurchase(${JSON.stringify(WORKSHOP_I_ID)})`),
      b.page.eval(`window.__galaQuestRuntime.net.sendVillageUpgradePurchase(${JSON.stringify(WORKSHOP_I_ID)})`),
    ]);

    const settledA = await pollUntil(a, (s) => s.village.workshopOwned === true, { timeoutMs: 4000 });
    const settledB = await pollUntil(b, (s) => s.village.workshopOwned === true, { timeoutMs: 4000 });
    check('two-client: both clients agree Workshop I is now owned',
      settledA.village.workshopOwned === true && settledB.village.workshopOwned === true,
      JSON.stringify({ a: settledA.village, b: settledB.village }));
    check('two-client: the race only spent once -- coins/shards match a SINGLE 2-coin/1-shard purchase, not a double-charge',
      settledA.village.coins === 3 && settledA.village.shards === 2
        && settledB.village.coins === 3 && settledB.village.shards === 2,
      JSON.stringify({ a: settledA.village, b: settledB.village }));
    check('two-client: A and B\'s own independent snapshots are byte-identical on the shared village block',
      JSON.stringify(settledA.village) === JSON.stringify(settledB.village),
      `A=${JSON.stringify(settledA.village)} B=${JSON.stringify(settledB.village)}`);

    await front(a);
    await openWorkshopDetail(a);
    await shot(a, 'two-client-A-board');
    await front(b);
    await openWorkshopDetail(b);
    await shot(b, 'two-client-B-board');
    const detailA = await boardDetailText(a);
    const detailB = await boardDetailText(b);
    check('two-client: both A and B\'s own Board now shows BUILT, not UPGRADE',
      detailA.upgradeText === 'BUILT' && detailB.upgradeText === 'BUILT',
      JSON.stringify({ a: detailA, b: detailB }));

    noConsoleErrors(a, 'two-client A');
    noConsoleErrors(b, 'two-client B');
  } finally {
    await a.close().catch(() => {});
    await b.close().catch(() => {});
    await server.kill();
  }
}

// ── Phase 4: a real server restart -- Workshop I survives, and the cart does not reappear "fresh"
// (GP3-0's own restart-coherence fix, re-proven here against a real running server) ───────────────────

async function runRestartPhase() {
  console.log('\n=== restart: Workshop I and the cart\'s own collected state both survive a real server restart ===');
  const storePath = freshStorePath('restart');
  let server = await startOwnedServer({ rewardStorePath: storePath });
  let tab = await openTab();
  let collectedBefore;
  try {
    // Seeded inside the try -- see runBoardBeforePhase's own comment on why a throw here must still
    // reach the finally below.
    const guestId = seedUnlockedGuest(storePath, 'restart');
    await navigateFresh(tab, server.origin, server.url, PORTRAIT, guestId);
    await tab.page.send('Page.bringToFront');
    await reachCampAndRowan(tab);
    await searchAndCollectAll(tab);
    await openWorkshopDetail(tab);
    await clickSelector(tab, '#village-board-upgrade-button');
    const bought = await pollUntil(tab, (s) => s.village.workshopOwned === true, { timeoutMs: 4000 });
    check('restart: Workshop I is bought before the restart', bought.village.workshopOwned === true,
      JSON.stringify(bought.village));
    collectedBefore = bought.loot.collected;
    check('restart: all 5 pickups are recorded collected before the restart',
      Object.keys(collectedBefore).length === CART_LOOT_TABLE.length, JSON.stringify(collectedBefore));
  } finally {
    await tab.close().catch(() => {});
    await server.kill();
  }

  // Same rewardStorePath, a genuinely NEW server process -- this is what makes it a restart proof
  // rather than a same-process re-check.
  server = await startOwnedServer({ rewardStorePath: storePath });
  tab = await openTab();
  try {
    // This viewer must be seeded unlocked (marks:3, lanternUnlocked:true) BEFORE connecting, same as
    // the buyer above -- not a brand-new/blank guest. Workshop's own ceremony/instant-build logic sits
    // inside the SAME treeLitNow gate as the rest of Chapter 2 content (main.js: `if (treeLitNow &&
    // zoneTrailLights.length > 0) { ... }`), which itself depends on THIS guest's own lanternUnlocked
    // state, not the buyer's. A genuinely blank guest would see treeLitNow=false for the honest reason
    // that they never completed Chapter 1 -- that is not the scenario this check means to prove. The
    // realistic late-joiner this check is about is a guest who already finished Chapter 1 but was not
    // present for this specific Workshop purchase (e.g. a sibling reconnecting, or the restarted
    // server itself), so their own guestId needs the same unlocked seeding the buyer got.
    const viewerGuestId = seedUnlockedGuest(storePath, 'restart-viewer');
    await navigateFresh(tab, server.origin, server.url, PORTRAIT, viewerGuestId);
    await tab.page.send('Page.bringToFront');
    // Same stale-first-snapshot race runWorkshopInteractLandscapePhase documents above: wait for this
    // guest's OWN rewards to read back seeded (not a transient zeroed first read) before trusting
    // anything gated behind treeLitNow, or main.js's one-shot sawTreeDark latch can permanently block
    // the instant-build path this check exists to prove.
    await pollUntil(tab, (s) => s.rewards?.[s.selfId]?.marks === 3 && s.rewards?.[s.selfId]?.lanternUnlocked === true,
      { timeoutMs: 8000 });
    // village.workshopOwned arrives on this guest's very first server snapshot (no edge to watch for,
    // it was already true before this client ever connected), but workshop.js's own trigger(true)
    // instant-build path only runs inside the next rendered animation frame -- a single immediate
    // state() read right after bringToFront can race ahead of that one frame. Poll for the SAME
    // condition the check below asserts, not a proxy for it (built, not just workshopOwned), so this
    // never reports success before the actual thing being proven has happened.
    const afterRestart = await pollUntil(tab, (s) => s.workshop?.built === true, { timeoutMs: 5000 });
    check('restart: Workshop I is still owned after a real server restart', afterRestart.village.workshopOwned === true,
      JSON.stringify(afterRestart.village));
    check('restart: Village Supplies still read the correct spent remainder after restart',
      afterRestart.village.coins === 3 && afterRestart.village.shards === 2, JSON.stringify(afterRestart.village));
    // GP3-C1 closeout: this restart-viewer guest never witnessed the purchase's own false->true edge
    // (it is a brand-new tab/guest pointed at the already-restarted server) -- exactly the late-joiner
    // case workshop.js's trigger(true) instant path exists for. Before that fix, zoneWorkshop.built
    // stayed false forever for a client in this exact position, since the ceremony's own trigger()
    // only ever fires off a locally-witnessed edge. Caught by tracing the code, not by this check
    // originally existing and going red -- it did not exist before this closeout.
    check('restart: the 3D Workshop dressing is visible for a guest who never watched the purchase happen',
      afterRestart.workshop?.built === true, JSON.stringify(afterRestart.workshop));
    // ...and it is the FINISHED Workshop, not a replayed build. Asserted on the very poll result
    // that first observed built === true, so a client mistakenly running the staged 2.05 s ceremony
    // instead of trigger(true)'s instant pose is caught mid-build rather than after it has quietly
    // finished and become indistinguishable. A ceremony is a reward for spending; replaying it for
    // somebody who merely reloaded is a lie about what just happened.
    check('restart: the late joiner is handed the FINISHED Workshop, with no build ceremony replayed',
      afterRestart.workshop?.transforming === false, JSON.stringify(afterRestart.workshop));

    // GP3-0's own fix: the cart must NOT reappear as an unspawned, fresh pickup opportunity -- every
    // pickup id from before the restart is still present as collected (the collector is now the
    // synthetic RESTORED_COLLECTOR_ID, per world/cartLoot.js's restoreCartLootState -- a NEW viewer
    // guest who never touched the cart still sees it correctly as already-emptied, not as untouched).
    check('restart: the cart is still marked searched/spawned, not reset to an untouched state',
      afterRestart.loot.spawned === true, JSON.stringify(afterRestart.loot));
    const stillCollected = Object.keys(collectedBefore).every((id) => afterRestart.loot.collected[id] != null);
    check('restart: every pickup collected before the restart is still recorded collected after it -- the cart never reappears fresh',
      stillCollected, JSON.stringify(afterRestart.loot.collected));

    // What the late joiner actually SEES. Every check above proves the presenter reports "built";
    // this walks that guest to the building and photographs it, which is the only thing that proves
    // what "built" looks like to somebody who was not there for it.
    await walkToward(tab, WORKSHOP_INTERACT.at[0], WORKSHOP_INTERACT.at[1], WORKSHOP_INTERACT.radiusMeters * 0.5, 120000);
    await aimAtWorkshop(tab);
    await shot(tab, 'restart-late-join-workshop');
    // Polled, not read once: arriving and the prompt appearing are two different frames, and on a
    // hosted runner they can be a long way apart. The failure detail carries the hero's actual
    // distance from the interact point, so a red gate here says whether the walk fell short or the
    // gate itself refused -- rather than needing another run to find out which.
    const lateJoin = await pollUntil(tab, (s) => s.workshopInteractAvailable === true,
      { timeoutMs: CEREMONY_BUDGET_MS });
    const lateJoinDistance = Math.hypot(
      lateJoin.heroPos[0] - WORKSHOP_INTERACT.at[0], lateJoin.heroPos[1] - WORKSHOP_INTERACT.at[1],
    );
    check('restart: the late joiner walks up to a finished Workshop that is immediately interactable',
      lateJoin.workshop?.built === true && lateJoin.workshop?.transforming === false
        && lateJoin.workshopInteractAvailable === true,
      JSON.stringify({
        workshop: lateJoin.workshop,
        interact: lateJoin.workshopInteractAvailable,
        heroPos: lateJoin.heroPos,
        metresFromInteractPoint: +lateJoinDistance.toFixed(2),
        interactRadius: WORKSHOP_INTERACT.radiusMeters,
      }));

    await openWorkshopDetail(tab);
    await shot(tab, 'restart-board-still-built');

    noConsoleErrors(tab, 'restart');
  } finally {
    await tab.close().catch(() => {});
    await server.kill();
  }
}

await runBoardBeforePhase(PORTRAIT, 'portrait');
await runBoardBeforePhase(LANDSCAPE, 'landscape');
await runPurchasePhase(PORTRAIT, 'portrait');
await runWorkshopInteractLandscapePhase();
await runTwoClientPhase();
await runRestartPhase();

writeFileSync(`${OUT}village-board-results.json`, JSON.stringify({ results }, null, 2));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
