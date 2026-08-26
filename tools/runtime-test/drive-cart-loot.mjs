/**
 * GP2: boot the running game, walk a real hero to Rowan's camp, search the wrecked cart, and prove
 * the whole required sequence end to end against a real server round trip:
 *
 *   SEARCH -> cart reacts -> loot bursts -> readable ground beat -> attraction/collection ->
 *   arrival/contact -> HUD totals update -> next-adventure hook
 *
 * in portrait and landscape, plus a two-client proof that the same physical pickup cannot be
 * collected twice and that both clients observe the identical outcome.
 *
 * Three independent phases, each on its OWN owned server (Phase Z1's isolation discipline): the cart
 * is a SHARED, once-ever world object, so "before it is searched" only exists once per server
 * lifetime -- a fresh server is the only way to capture that state honestly more than once.
 *
 * GP3-C2 closeout: each phase's own owned server also gets its OWN isolated reward store (a fresh
 * OS-tmpdir file, GALAQUEST_REWARD_STORE_PATH), never the real data/rewards.db -- see
 * drive-village-board.mjs's own header and freshStorePath's own comment below for the full reasoning
 * (GP3-0's restart-coherence fix makes a fresh server inherit whatever real durable history the store
 * already holds, which had started breaking this file's own "before it is searched" assertions
 * against real accumulated family play, not against anything this harness itself got wrong).
 *
 *   node tools/runtime-test/drive-cart-loot.mjs
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * Cribbed from drive-village.mjs's CDP-over-websocket harness and its walkToward() touch-drag
 * technique (real movement, not a teleport -- the same reasoning that harness gives for reaching the
 * Keeper applies here for reaching Rowan's camp, which sits at a comparable distance from spawn), and
 * from drive-relight.mjs/drive-hero-screen.mjs's "seed/observe via window.__galaQuestRuntime debug
 * accessors, do not infer state from a screenshot alone" discipline.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openRewardStore } from '../../net/rewardStore.mjs';
import { CAMP, CART_SEARCH, ROWAN } from '../../public/src/world/zones/village.js';
import { CART_LOOT_TABLE, COIN_KIND, pickupWorldPosition } from '../../public/src/world/cartLoot.js';
import { LANTERN_UNLOCK_XP } from '../../public/src/progression/facts.js';
import {
  deadlineAfter,
  movementPulseMillis,
  pollUntilDeadline,
} from './automation-timing.mjs';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
const PORTRAIT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
const LANDSCAPE = { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true };
const STICK_PX = 56;
// favicon.ico: this harness's OWN blank-page trick for pinning localStorage before the real
// navigation (see navigateFresh) always 404s, the same accepted exception drive-relight.mjs
// documents. lantern_belt.glb: the pre-existing, disclosed gear-track gap every harness in this
// directory already excludes.
const COSMETIC_404_PATTERNS = ['/favicon.ico', '/assets/gear/lantern_belt.glb'];

/**
 * GP3-C2 closeout: a brand-new tmp file per phase, never the real data/rewards.db -- see
 * drive-village-board.mjs's own header for the full reasoning this is cribbed from. This file's own
 * seeded marks/lantern-unlocked events used to land in the real store (harmless on their own, a stray
 * guestId is just one more row nobody's real save reads), but GP3-0's own restart-coherence fix means
 * a fresh server now inherits whatever durable history its store already holds -- running this
 * harness against the real store therefore made drive-cart-loot's own "before the SEARCH, the cart
 * has not been searched yet" assertions stop being true the moment a real family session had already
 * searched it once, going red against accumulated real play rather than against anything this harness
 * broke. Isolating the store restores the original fresh-cart assumption's own meaning.
 */
function freshStorePath(label) {
  const dir = mkdtempSync(join(tmpdir(), `gq-cart-loot-${label}-`));
  return join(dir, 'rewards.db');
}

/**
 * The Dark Trail (and so the camp, Rowan, and the cart) is gated on the Lantern Tree being lit
 * (main.js: `if (treeLitNow && zoneTrailLights.length > 0) { ... }`), which is gated on 3 Lantern
 * Marks -- Chapter 1's own wolf fight. Fighting that fight for real in every phase of this harness
 * would triple its length to prove something play-fight.mjs already proves on its own. Instead this
 * seeds a fresh guest directly into THIS PHASE'S OWN isolated store (net/rewardStore.mjs's own
 * idempotent apply(), the exact convention drive-relight.mjs already established for this file), the
 * same way a returning guest who fought that fight in an earlier session would arrive here. The
 * fixture includes the P2 XP fact awarded alongside the Lantern latch; omitting it would describe
 * an impossible post-Lantern player. A brand-new randomUUID() guestId every run/phase, never reused:
 * the store's own idempotency is by
 * eventId, not guestId, and this file's whole subject is a pickup that can only ever be durably
 * credited to the FIRST guestId that claims it (see net/gameServer.mjs's applyLootAward) -- reusing a
 * guestId across runs would silently poison every later run's ability to prove the credit actually
 * landed, even though the in-memory collect (a fresh server every phase) would still look fine.
 */
function seedUnlockedGuest(storePath, label) {
  const guestId = `gp2-cart-loot-${label}-${randomUUID()}`;
  const store = openRewardStore(storePath);
  for (let i = 1; i <= 3; i += 1) {
    store.apply({ guestId, type: 'mark-earned', eventId: `gp2-fixture:mark:${guestId}:${i}` });
  }
  const lanternEventId = `gp2-fixture:unlock:${guestId}`;
  store.apply({ guestId, type: 'lantern-unlocked', eventId: lanternEventId });
  store.apply({
    guestId,
    type: 'xp-earned',
    eventId: `xp:${lanternEventId}`,
    value: String(LANTERN_UNLOCK_XP),
  });
  const seeded = store.marksFor(guestId) === 3
    && store.unlockedFor(guestId)
    && store.xpFor(guestId) === LANTERN_UNLOCK_XP;
  store.close();
  if (!seeded) throw new Error(`seeding ${guestId} did not take`);
  return guestId;
}

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
 * `check(name, predicate || hostedHeadless, detail)` prints PASS for a predicate that actually
 * failed -- a false statement rather than a looser gate, and one a reader diffing two runs mistakes
 * for a repair. DIAG is neither PASS nor FAIL: it always prints what the predicate really did, says
 * the environment cannot rule on it, and does not count toward `failures`. With
 * `authoritative: true` it degrades to an ordinary gating check.
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

  // One bounded retry on a timeout only (not on a real protocol error) -- the two-client phase runs
  // two full 3D pages concurrently in the same Chrome, and a single call occasionally stalls past
  // 20s under that combined load without anything actually being wrong; a lone retry absorbs that
  // without masking a genuinely broken call (which fails the same way twice).
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
  page.ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const entry = msg.params.entry;
      consoleErrors.push(entry.url ? `${entry.text} [${entry.url}]` : entry.text);
    }
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.text);
  });
  return {
    page, targetId, consoleErrors, expectedPlayers, viewport: null,
    close: () => page.send('Target.closeTarget', { targetId }),
  };
}

async function navigateFresh(tab, origin, url, viewport, guestId) {
  // The on-screen stick sits at a FIXED FRACTION of the viewport (index.html's own CSS), not a fixed
  // pixel -- a stick origin computed from one orientation's dimensions lands off-screen in the other.
  // Measured: landscape's first run touched down at (138, 881) on a 1024x768 page and the hero never
  // moved at all, because y=881 is below the visible viewport entirely.
  tab.viewport = viewport;
  await tab.page.send('Emulation.setDeviceMetricsOverride', viewport);
  await tab.page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // Storage.clearDataForOrigin targets an ORIGIN, not whatever page is currently loaded, so it can
  // run before any navigation at all (GQ-008: the clear must precede the first navigation, full
  // stop). An about:blank tab cannot hold localStorage for the real origin though, so a navigation
  // is still needed before pinning the guestId -- navigate once to establish it, THEN set, THEN
  // navigate for real. Same sequence drive-relight.mjs uses to pin a pre-seeded guestId before
  // main.js's first read of it.
  await tab.page.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage' });
  await tab.page.send('Page.navigate', { url: `${origin}/favicon.ico` });
  await sleep(300);
  await tab.page.eval(`localStorage.setItem('gq-guest-id', ${JSON.stringify(guestId)})`);
  await tab.page.send('Page.navigate', { url });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    await sleep(500);
    ready = await tab.page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
  }
  if (!ready) throw new Error(`runtime never came up on ${url}`);

  // The same "no stale extra hero" guard drive-village.mjs uses -- this is a freshly owned server
  // (Phase H1's isolation), so more than the tab(s) this run itself opened means contamination, not
  // a real second player.
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

async function state(tab) {
  return tab.page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    const trail = r.zoneTrailState();
    const net = r.netState();
    const ownRewards = net.selfId !== null ? (r.rewards()[net.selfId] ?? null) : null;
    return JSON.stringify({
      heroPos: [+r.player.position.x.toFixed(3), +r.player.position.z.toFixed(3)],
      serverPos: net.serverSelf ? [+net.serverSelf.x.toFixed(3), +net.serverSelf.z.toFixed(3)] : null,
      heading: r.follow.heading,
      netStatus: net.status,
      hostedHeadless: navigator.userAgent.includes('HeadlessChrome'),
      selfId: net.selfId,
      guestId: r.guestId(),
      rewards: ownRewards,
      treeLit: r.zoneTreeState()?.lit ?? false,
      loot: r.lootState(),
      hud: r.lootHudDisplayed(),
      audio: r.audioDebug(),
      campFound: trail.campFound,
      rowanMet: trail.rowanMet,
      cartSearched: trail.cartSearched,
    });
  })()`).then(JSON.parse);
}

async function pollUntil(tab, predicate, { intervalMs = 100, timeoutMs = 8000 } = {}) {
  return pollUntilDeadline(() => state(tab), predicate, { intervalMs, timeoutMs });
}

const touch = (tab, type, points) => tab.page.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});

/** Real touch-stick movement toward a fixed world point -- see drive-village.mjs's own walkToward
 *  for the screen<->world derivation this is copied from verbatim. Stick origin is a FRACTION of
 *  THIS tab's own viewport, not a shared constant (see navigateFresh's comment). */
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

    // Release the stick before the next CDP state read. Otherwise runner-side evaluation latency
    // becomes unmeasured travel and a pickup-sized target can be crossed between observations.
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
  writeFileSync(`${OUT}cart-loot-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured cart-loot-${name}.png`);
}

/** Walk to the camp, then to Rowan (latches campFound + rowanMet -- both read straight off
 *  zoneTrailState() rather than assumed from distance, since the cart's own trigger is gated on
 *  BOTH and a harness that merely walked close without confirming the flags latched would silently
 *  never search the cart at all), stopping short of the cart's own trigger radius so the caller can
 *  capture a genuine "before" state on purpose. */
async function reachCampAndRowan(tab) {
  await walkToward(tab, CAMP.at[0], CAMP.at[1], CAMP.radiusMeters * 0.6, 45000);
  const afterCamp = await pollUntil(tab, (s) => s.campFound === true, { timeoutMs: 3000 });
  if (!afterCamp.campFound) throw new Error(`campFound never latched -- hero at ${JSON.stringify(afterCamp.heroPos)}`);

  await walkToward(tab, ROWAN.at[0], ROWAN.at[1], 1.2, 20000);
  const afterRowan = await pollUntil(tab, (s) => s.rowanMet === true, { timeoutMs: 3000 });
  if (!afterRowan.rowanMet) throw new Error(`rowanMet never latched -- hero at ${JSON.stringify(afterRowan.heroPos)}`);
}

async function walkToPickup(tab, pickup, stopWithin = 0.5) {
  const at = pickupWorldPosition(pickup, CART_SEARCH.at);
  return walkToward(tab, at.x, at.z, stopWithin, 15000);
}

/**
 * Walk the whole cluster, dynamically retargeting to whichever pickup is nearest and still
 * uncollected, until all five are picked up.
 *
 * NOT "walk to exactly one pickup" -- checked against the real authored offsets
 * (world/cartLoot.js's CART_LOOT_TABLE), no pickup's nearest neighbour clears
 * PICKUP_COLLECT_RADIUS_METERS (1.3m; the closest pair is 0.71m apart, the FARTHEST any pickup's
 * nearest neighbour gets is 1.25m). A child standing anywhere near the cart is realistically going to
 * scoop more than one at a time -- this is what the loot table actually authors, not a harness
 * shortcut -- so "isolate one pickup" is not a real scenario this game has, and a first version of
 * this harness that assumed it caught its own target pickup already gone (HUD already at 2 coins)
 * before its very first poll ran.
 *
 * What IS real and required (GP2's own "HUD totals must not update before the pickup reaches its
 * collection endpoint") is proven here the general way: polled tightly enough (50ms, well inside
 * ATTRACT_FLIGHT_SECONDS's 0.4s window) to catch the server having recorded MORE collections than the
 * HUD has displayed, at least once, regardless of which specific pickup that was.
 */
async function sweepAllPickups(tab, phaseLabel) {
  let lagSeen = false;
  let lagShotTaken = false;
  let current = await state(tab);

  // Fixed order (the loot table's own), not dynamic "walk toward whichever is nearest": a dynamic
  // retarget made debugging which pickup was actually struggling ambiguous -- two prior versions of
  // this function left a DIFFERENT pickup behind on different runs despite generous shared attempt
  // budgets. Explicit per-pickup retry makes the actual failure mode legible instead of diffuse.
  //
  // Each pickup gets its own bounded retry loop: walk directly at IT specifically (reusing
  // walkToward's own proven 90ms cadence, not a hand-rolled tight loop -- a tight-cadence version of
  // this sweep measured LESS reliable under real CDP round-trip jitter than plain walkToward), then
  // confirm the SERVER actually recorded the collect before moving on. A too-tight stopWithin (first
  // tried at 0.9 of the collect radius, 0.13m of margin) occasionally converged short of the actual
  // trigger boundary -- the CLIENT'S OWN predicted position (what walkToward measures "arrived"
  // against) is not always identical to the SERVER's authoritative one (what actually gates the
  // collect) -- so this walks all the way to the pickup's own exact coordinates (stopWithin near
  // zero) for real margin, and retries up to 4 times if the server still hasn't recorded it.
  for (const pickup of CART_LOOT_TABLE) {
    for (let retry = 0; retry < 4; retry += 1) {
      if (current.loot.collected[pickup.id] != null) break; // already ours, collateral from an earlier walk
      const at = pickupWorldPosition(pickup, CART_SEARCH.at);
      // eslint-disable-next-line no-await-in-loop
      current = await walkToward(tab, at.x, at.z, 0.15, 15000);

      // A short, STATIONARY tight-poll burst right after the walk stops: no more touchMove overhead
      // competing for wall time, just watching for the server having recorded a collection the HUD
      // has not yet displayed -- well inside ATTRACT_FLIGHT_SECONDS's 0.4s window.
      const burstDeadline = Date.now() + 700;
      while (Date.now() < burstDeadline) {
        const collectedCount = Object.keys(current.loot.collected).length;
        const displayedCount = current.hud.coins + current.hud.shards;
        if (collectedCount > displayedCount) {
          lagSeen = true;
          if (!lagShotTaken) {
            lagShotTaken = true;
            // eslint-disable-next-line no-await-in-loop
            await shot(tab, `${phaseLabel}-02b-collected-ahead-of-hud`);
          }
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(30);
        // eslint-disable-next-line no-await-in-loop
        current = await state(tab);
      }
    }
    if (current.loot.collected[pickup.id] == null) {
      console.log(`  ! ${phaseLabel}: ${pickup.id} still uncollected after 4 direct attempts -- hero at ${JSON.stringify(current.heroPos)}, pickup at ${JSON.stringify(pickupWorldPosition(pickup, CART_SEARCH.at))}`);
    }
  }
  // Let every already-collected pickup finish arriving before reading the final tally.
  const settled = await pollUntil(
    tab, (s) => s.hud.coins + s.hud.shards >= Object.keys(s.loot.collected).length,
    { intervalMs: 50, timeoutMs: 4000 },
  );
  return { lagSeen, final: settled };
}

// ── Phase 1: portrait, coin ──────────────────────────────────────────────────────────────────────

async function runSingleClientPhase(viewport, phaseLabel) {
  console.log(`\n=== ${phaseLabel} ===`);
  const storePath = freshStorePath(phaseLabel);
  const server = await startOwnedServer({ rewardStorePath: storePath });
  const tab = await openTab();
  try {
    // Seeded INSIDE the try, not before it: a throw here (e.g. the isolated store racing the owned
    // server's own startup open of it) used to skip the finally below entirely, leaking a live
    // server process that then corrupted whichever harness run happened next -- reproduced directly
    // while wiring up this phase's own isolated store for the first time.
    const guestId = seedUnlockedGuest(storePath, phaseLabel);
    await navigateFresh(tab, server.origin, server.url, viewport, guestId);
    // Chrome throttles a backgrounded tab's rAF loop; a freshly created target does not necessarily
    // steal focus from whatever tab (the owner's own, unrelated) already had it. Bring this one forward
    // explicitly rather than assuming -- the same fix the two-client phase needs, for the same reason.
    await tab.page.send('Page.bringToFront');

    const arrival = await state(tab);
    check(`${phaseLabel}: the seeded guestId came back (localStorage, not a fresh mint)`,
      arrival.guestId === guestId, `guestId ${arrival.guestId}`);
    check(`${phaseLabel}: 3 marks and lanternUnlocked true, seeded rather than fought`,
      arrival.rewards?.marks === 3 && arrival.rewards?.lanternUnlocked === true, JSON.stringify(arrival.rewards));
    check(`${phaseLabel}: the tree is already lit -- Chapter 2 is reachable`, arrival.treeLit === true);

    await reachCampAndRowan(tab);

    const before = await state(tab);
    check(`${phaseLabel}: SEARCH before interaction -- the cart has not been searched yet`,
      before.loot.spawned === false, JSON.stringify(before.loot));
    check(`${phaseLabel}: HUD totals start at zero for a fresh guest`,
      before.hud.coins === 0 && before.hud.shards === 0, JSON.stringify(before.hud));
    await shot(tab, `${phaseLabel}-01-search-before`);

    // Into the cart's own trigger radius -- this is the SEARCH action itself.
    await walkToward(tab, CART_SEARCH.at[0], CART_SEARCH.at[1], CART_SEARCH.radiusMeters * 0.5, 15000);
    const spawned = await pollUntil(tab, (s) => s.loot.spawned === true, { timeoutMs: 6000 });
    check(`${phaseLabel}: the SEARCH trigger fired (cartSearched latched)`, spawned.cartSearched === true,
      JSON.stringify({ campFound: spawned.campFound, rowanMet: spawned.rowanMet, heroPos: spawned.heroPos }));
    check(`${phaseLabel}: searching bursts the loot into the world`, spawned.loot.spawned === true);
    check(`${phaseLabel}: the cart's own jolt sound was scheduled`,
      (spawned.audio.triggered['cart-jolt'] ?? 0) >= 1, JSON.stringify(spawned.audio.triggered));

    // A short burst of frames right after the transition, while the toss/burst animation is still
    // playing -- the closest practical "video" evidence a screenshot-only harness can produce.
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await shot(tab, `${phaseLabel}-02-burst-frame${i}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(150);
    }

    // Walk the whole cluster, collecting everything -- proves the exact deterministic haul (3
    // coins, 2 shards) AND the HUD-lag rule, from the SAME real run.
    const { lagSeen, final } = await sweepAllPickups(tab, phaseLabel);
    check(`${phaseLabel}: the server accepted all 5 collects`,
      Object.keys(final.loot.collected).length === CART_LOOT_TABLE.length,
      JSON.stringify(final.loot));
    // GP2's own required rule, proven directly rather than assumed: caught the server having
    // recorded more collections than the HUD had displayed at least once during the sweep -- the
    // HUD only ever advances once a pickup's own attraction flight physically arrives
    // (world/lootPickups.js), never at the instant the server accepts the collect.
    diagnostic(`${phaseLabel}: HUD total visibly lagged the server's own collected count at least once`,
      lagSeen,
      lagSeen ? 'lag observed' : 'no lag sample captured',
      { authoritative: !final.hostedHeadless, reason: 'HeadlessChrome CDP sampling can skip the 0.4s attraction flight' });
    check(`${phaseLabel}: the exact deterministic first-cart haul -- 3 coins, 2 shards`,
      final.hud.coins === 3 && final.hud.shards === 2, JSON.stringify(final.hud));
    check(`${phaseLabel}: both pickup sounds were scheduled (coin and shard are audibly distinct)`,
      (final.audio.triggered['coin-chime'] ?? 0) >= 1 && (final.audio.triggered['shard-resonance'] ?? 0) >= 1,
      JSON.stringify(final.audio.triggered));
    await shot(tab, `${phaseLabel}-03-collected-hud`);

    const errors = tab.consoleErrors.filter((e) => !COSMETIC_404_PATTERNS.some((p) => e.includes(p)));
    check(`${phaseLabel}: no console errors`, errors.length === 0, errors.slice(0, 5).join(' | '));
  } finally {
    await tab.close().catch(() => {});
    await server.kill();
  }
}

await runSingleClientPhase(PORTRAIT, 'portrait');
await runSingleClientPhase(LANDSCAPE, 'landscape');

// ── Phase 3: two clients, one physical pickup, only one winner ─────────────────────────────────────

console.log('\n=== two-client double-collect proof ===');
{
  const storePath = freshStorePath('two-client');
  const server = await startOwnedServer({ rewardStorePath: storePath });
  const a = await openTab(1);
  const b = await openTab(2);
  // Chrome throttles a backgrounded tab's rAF loop close to zero (drive-two-clients.mjs's own,
  // already-proven fix for this exact repo/harness family) -- dispatching touch input at a tab that
  // is not frontmost stalls, sometimes past this CDP class's own 20s call timeout. Bring whichever
  // tab is about to receive input to the front FIRST, every time, rather than once at the start.
  const front = (tab) => tab.page.send('Page.bringToFront');
  try {
    // Seeded inside the try -- see runSingleClientPhase's own comment on why a throw here must still
    // reach the finally below.
    const guestIdA = seedUnlockedGuest(storePath, 'two-client-a');
    const guestIdB = seedUnlockedGuest(storePath, 'two-client-b');
    await navigateFresh(a, server.origin, server.url, PORTRAIT, guestIdA);
    await navigateFresh(b, server.origin, server.url, PORTRAIT, guestIdB);
    check('two-client: A and B are two DIFFERENT heroes, not one tab double-counted',
      (await state(a)).guestId !== (await state(b)).guestId);
    await front(a);
    await reachCampAndRowan(a);
    await front(b);
    await reachCampAndRowan(b);

    // Either hero searching is enough -- A does it, and B must see the SAME shared burst.
    await front(a);
    await walkToward(a, CART_SEARCH.at[0], CART_SEARCH.at[1], CART_SEARCH.radiusMeters * 0.5, 15000);
    await pollUntil(a, (s) => s.loot.spawned === true, { timeoutMs: 6000 });
    const bSeesSpawn = await pollUntil(b, (s) => s.loot.spawned === true, { timeoutMs: 6000 });
    check('two-client: B observes the burst A caused, from B\'s own snapshot', bSeesSpawn.loot.spawned === true);

    // Both walk to the exact same physical pickup -- A first (foreground A), then B immediately
    // after (foreground B), rather than truly concurrent touch streams to two tabs that can only
    // ever have ONE of them actually frontmost at a time. The race this proves is server-side (which
    // collect-loot request the server processes first), already exercised at true wall-clock
    // simultaneity by test/game-server.test.mjs's own two-socket test; this run's job is to show the
    // SAME rule holding in the real, running game, not to re-litigate the timing itself.
    const pickup = CART_LOOT_TABLE[0];
    await front(a);
    await walkToPickup(a, pickup);
    await front(b);
    await walkToPickup(b, pickup);

    const settledA = await pollUntil(a, (s) => s.loot.collected[pickup.id] != null, { timeoutMs: 6000 });
    const settledB = await pollUntil(b, (s) => s.loot.collected[pickup.id] != null, { timeoutMs: 6000 });
    const collectorFromA = settledA.loot.collected[pickup.id];
    const collectorFromB = settledB.loot.collected[pickup.id];
    check('two-client: the pickup was collected by exactly one hero',
      typeof collectorFromA === 'string', JSON.stringify(settledA.loot));
    check('two-client: A and B agree on WHO collected it -- one authoritative outcome, not two',
      collectorFromA === collectorFromB, `A saw ${collectorFromA}, B saw ${collectorFromB}`);

    // The winner's own HUD must eventually show AT LEAST that pickup (walking to it may have also
    // scooped a genuine neighbour -- see sweepAllPickups's own header on why the loot table's real
    // scatter cannot guarantee isolation; that does not weaken this proof, since what matters is WHO
    // owns pickup.id specifically, already established above from the shared authoritative state).
    // The HUD only advances via the winner's OWN rAF loop (world/lootPickups.js's attraction-flight
    // update), which stays near-frozen while backgrounded -- bring the winner forward before polling
    // it, the same throttling fix as everywhere else in this phase.
    const aSelfId = await a.page.eval('window.__galaQuestRuntime.netState().selfId');
    const winnerTab = collectorFromA === aSelfId ? a : b;
    await front(winnerTab);
    const winnerHudKey = pickup.kind === COIN_KIND ? 'coins' : 'shards';
    const winnerFinal = await pollUntil(winnerTab, (s) => s.hud[winnerHudKey] >= 1, { timeoutMs: 3000 });
    check('two-client: the winner\'s own HUD reflects the pickup arriving', winnerFinal.hud[winnerHudKey] >= 1,
      JSON.stringify(winnerFinal.hud));

    await shot(a, 'two-client-A-final');
    await shot(b, 'two-client-B-final');

    // Attempting to collect it again (a stale local trigger, or a resend) is a clean no-op for BOTH:
    // the SAME collector stays recorded, from BOTH clients' own independent snapshots.
    await a.page.eval(`window.__galaQuestRuntime.net.sendCollectLoot(${JSON.stringify(pickup.id)})`);
    await b.page.eval(`window.__galaQuestRuntime.net.sendCollectLoot(${JSON.stringify(pickup.id)})`);
    await sleep(500);
    const afterRetryA = await state(a);
    const afterRetryB = await state(b);
    check('two-client: a resent collect for an already-taken pickup changes nothing, for either client',
      afterRetryA.loot.collected[pickup.id] === collectorFromA
        && afterRetryB.loot.collected[pickup.id] === collectorFromA,
      `A=${afterRetryA.loot.collected[pickup.id]} B=${afterRetryB.loot.collected[pickup.id]}`);
  } finally {
    await a.close().catch(() => {});
    await b.close().catch(() => {});
    await server.kill();
  }
}

writeFileSync(`${OUT}cart-loot-results.json`, JSON.stringify({ results }, null, 2));
// `results.length - failures` counted every DIAG as a pass. A summary must not re-tell the lie the
// individual lines were fixed to stop telling.
const passedCount = results.filter((r) => r.passed === true).length;
const diagCount = results.filter((r) => r.outcome === 'DIAG').length;
console.log(`\n${passedCount} PASS / ${failures} FAIL / ${diagCount} DIAG  (${results.length} checks)`);
process.exit(failures === 0 ? 0 : 1);
