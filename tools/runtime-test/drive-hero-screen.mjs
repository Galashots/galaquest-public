/**
 * GP1 + GP1-C1/C2 closeout: boot the running game and prove three things end to end against a real
 * server round trip, not just the offline fallback:
 *
 *   1. GP1-C1 -- a FRESH guest owns only the starter sword. The Wildwood Blade never appears in the
 *      owned-item strip and cannot be equipped, because nothing has granted it yet.
 *   2. Once a guest is durably granted the Blade (the same seeding technique drive-relight.mjs uses
 *      for its own fixture guest -- net/rewardStore.mjs's 'gear-owned' event, written directly, no
 *      client message exists for this on purpose), the compare -> equip -> confirm loop works, and
 *      the equip rides the server mirror.
 *   3. GP1-C2/C3 -- equipping produces a visible change in the Hero screen's 3D preview: the showcase
 *      pass (render/heroPreview.js) is dark while the screen is closed, and its two kicker lights
 *      carry whichever weapon is equipped while it is open.
 *   4. GP1-C4 -- the sword in his hand FOLLOWS the equipped item. Equipping the Wildwood Blade puts
 *      the actual Wildwood mesh in the fist and takes the Ironwood out, in the Hero screen and in
 *      ordinary gameplay, with exactly one sword visible in every rendered frame of the transition.
 *   5. GP1-C3 -- the showcase is LOCATION-INDEPENDENT. Phase 3 walks the hero to six real world
 *      positions, aims the world camera THROUGH the nearest large geometry at each so that geometry
 *      is between the camera and the hero, opens Hero, and captures portrait and landscape at every
 *      one. This is the failure class that motivated the pass: measured against the old dolly the
 *      hero was ENTIRELY INVISIBLE at the Workshop and at the Lantern Tree, and buried behind an
 *      NPC's torso at the market.
 *
 * WHAT THE MACHINE MAY AND MAY NOT CONCLUDE. The framing checks below use the preview camera's own
 * projection of the live hero's bounds (runtime.heroPreviewState().heroFrame) to REJECT a preview
 * that framed him off-screen, tiny, or differently depending on where he stands. They may not accept
 * one. A character showcase is accepted by opening the capture and looking at it -- AGENTS.md's
 * "Playtests are mandatory", and the exact reason the old preview shipped: every check it had was
 * green in frames with no hero in them at all.
 *
 * Repeats the granted-guest compare pass at a landscape viewport too, per AGENTS.md's "any new UI...
 * is checked in both" rule.
 *
 *   node tools/runtime-test/drive-hero-screen.mjs
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * Cribbed from drive-village.mjs's CDP-over-websocket harness (no Puppeteer, no npm) and
 * drive-relight.mjs's "seed the durable store directly, then navigate" fixture-guest technique.
 * Hero-screen buttons are plain `click`-bound (progression/heroScreen.js) and its item strip rebuilds
 * every rendered frame, so this harness taps them with a JS-level `element.click()` rather than a
 * synthetic mousePressed/mouseReleased pair -- see clickSelector's own comment for why the latter is
 * flaky here specifically.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../../public/src/progression/items.js';
import { swatchFor } from '../../public/src/progression/heroScreen.js';
import { DEFAULT_DISTANCE, MIN_DISTANCE } from '../../public/src/camera/follow.js';
import { PREVIEW_ORBIT_YAW_RADIANS } from '../../public/src/render/heroPreview.js';
import { SWING_SECONDS } from '../../public/src/combat/encounter.js';
import { SHIPPING_SWORD_MESH_ID, WILDWOOD_BLADE_CANDIDATE_ID } from '../../public/src/character/weaponLoadout.js';
import { LANDMARKS, PROPS, VILLAGERS, WORKSHOP_PROP } from '../../public/src/world/zones/village.js';
import { headingToward } from '../../public/src/world/zoneLoader.js';
import { openRewardStore } from '../../net/rewardStore.mjs';
import { deadlineAfter, movementPulseMillis } from './automation-timing.mjs';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
// GP3-C2 closeout: an isolated OS-tmpdir store, never the real data/rewards.db -- see
// drive-village-board.mjs's own header for the full reasoning. This file's own grant was already
// per-guest and harmless (a stray guestId nobody's real save reads, per this file's prior comment
// here), but every run still durably minted one more permanent row in the children's actual save
// forever; isolating it costs nothing and matches every other durable-writing harness in this
// directory now.
const REWARD_STORE_PATH = join(mkdtempSync(join(tmpdir(), 'gq-hero-screen-')), 'rewards.db');
const server = await startOwnedServer({ rewardStorePath: REWARD_STORE_PATH });
const ORIGIN_UNDER_TEST = server.origin;
const URL_UNDER_TEST = server.url;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
// Unique per run, NOT a fixed id like drive-relight.mjs's RELIGHT_GUEST_ID -- data/rewards.db is a
// persistent file across runs, but net/gameServer.mjs's equip-sequence counter (the thing that makes
// each 'weapon-equipped' eventId, e.g. "equip:<guest>:0000000001") resets to 1 every time this
// harness's owned server process starts. A fixed guestId would make a second run's first equip mint
// the exact same eventId the FIRST run's first equip already used -- the store's INSERT OR IGNORE
// idempotency (correct and load-bearing everywhere else) would then silently drop the new equip,
// leaving whatever the previous run's last equip happened to be. A fresh id every run sidesteps that
// entirely; a one-off ownership grant doesn't need this (it only ever applies once, so the same fixed
// id every run is what makes it idempotent rather than what breaks it).
const BLADE_FIXTURE_GUEST_ID = `hero-screen-blade-fixture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PORTRAIT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
const LANDSCAPE = { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true };

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// Idempotent (INSERT OR IGNORE on the eventId primary key): safe to run this file over and over
// without minting duplicate grant rows. Written directly to the store rather than through any client
// message -- net/gameServer.mjs's grantOwnership header explains why no such message exists on the
// wire.
(() => {
  const store = openRewardStore(REWARD_STORE_PATH);
  store.apply({
    guestId: BLADE_FIXTURE_GUEST_ID, type: 'gear-owned',
    eventId: `own:${BLADE_FIXTURE_GUEST_ID}:${WILDWOOD_BLADE_ID}`, value: WILDWOOD_BLADE_ID,
  });
  const seeded = store.ownedItemIdsFor(BLADE_FIXTURE_GUEST_ID).includes(WILDWOOD_BLADE_ID);
  check('the Blade-fixture guest is durably granted the Wildwood Blade (idempotent apply)', seeded,
    `ownedItemIdsFor -> ${JSON.stringify(store.ownedItemIdsFor(BLADE_FIXTURE_GUEST_ID))}`);
  store.close();
})();

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
// The second one is this harness's own fault, not the app's: the seeded-guest flow deliberately
// navigates to /favicon.ico as a blank waypoint (see "phase 2" below) so it has a same-origin page to
// set localStorage on before the real navigation -- the server has no favicon route, so that waypoint
// itself always 404s.
const COSMETIC_404_PATTERNS = ['/assets/gear/lantern_belt.glb', '/favicon.ico'];

await page.send('Emulation.setDeviceMetricsOverride', PORTRAIT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

async function waitForRuntime() {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    await sleep(500);
    ready = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
  }
  if (!ready) throw new Error(`runtime never came up on ${URL_UNDER_TEST}`);
}

async function checkSoloClient() {
  const players = await page.eval(`(() => {
    const m = (document.querySelector('#runtime-status')?.textContent ?? '').match(/players\\s+(\\d+)/i);
    return m ? Number(m[1]) : 1;
  })()`);
  if (players !== 1) {
    console.error(`${players} clients connected — close other tabs, this harness needs a solo hero`);
    await page.send('Target.closeTarget', { targetId });
    process.exit(2);
  }
}

async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}hero-screen-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured hero-screen-${name}.png`);
}

async function rectOf(selector) {
  return page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height });
  })()`).then((json) => (json ? JSON.parse(json) : null));
}

/**
 * A JS-level `element.click()`, not a synthetic mousePressed/mouseReleased pair. The Hero screen's
 * buttons are plain `click`-bound (progression/heroScreen.js), unlike the stick/attack-button's
 * touch-surface handling -- but heroScreen.js's own render() clears and rebuilds #hero-item-list's
 * innerHTML on EVERY frame the screen is open (main.js calls render() once per rAF), and
 * Input.dispatchMouseEvent's press and release are two separate CDP round trips with a real (if
 * small) gap between them. If a frame rebuild lands in that gap, the button mousedown fired on is no
 * longer in the document by mouseup, and Chrome silently declines to synthesize a `click` at all --
 * this was observed directly (a correctly-computed rect, a click that produced no state change). A
 * single synchronous `.click()` call is atomic from the page's perspective: nothing can interleave a
 * render() between "found the button" and "dispatched its click event".
 */
async function clickSelector(selector) {
  const rect = await rectOf(selector);
  if (!rect) throw new Error(`clickSelector: ${selector} not found`);
  const clicked = await page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`clickSelector: ${selector} vanished before it could be clicked`);
  return rect;
}

async function heroRuntimeState() {
  return page.eval(`JSON.stringify({
    open: window.__galaQuestRuntime.heroScreenOpen(),
    equipped: window.__galaQuestRuntime.heroScreenEquippedWeaponId(),
    netStatus: window.__galaQuestRuntime.netState().status,
    preview: window.__galaQuestRuntime.heroPreviewState(),
  })`).then(JSON.parse);
}

// The world half: where the hero actually is, what the world camera is doing, and whether the zone
// has finished loading. Kept separate from heroRuntimeState above because phase 3 polls this one on a
// walking loop and the Hero screen is closed for all of it.
async function worldState() {
  return page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    const net = r.netState();
    return JSON.stringify({
      heroPos: [+r.player.position.x.toFixed(2), +r.player.position.z.toFixed(2)],
      serverPos: net.serverSelf ? [+net.serverSelf.x.toFixed(2), +net.serverSelf.z.toFixed(2)] : null,
      serverSpeed: net.serverSelf?.speed ?? null,
      heading: r.follow.heading,
      distance: r.follow.distance,
      pitch: r.follow.pitch,
      netStatus: net.status,
      zone: r.zoneDebug(),
    });
  })()`).then(JSON.parse);
}

async function pollUntil(fn, predicate, { intervalMs = 100, timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (!predicate(last) && Date.now() < deadline) {
    await sleep(intervalMs);
    last = await fn();
  }
  return last;
}

// ── phase 1: a FRESH guest (no seeding, no pinned guestId -- the client mints its own via
// crypto.randomUUID()) never sees or can equip the Blade ──────────────────────────────────────────

await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
await page.send('Page.navigate', { url: URL_UNDER_TEST });
await waitForRuntime();
await checkSoloClient();

const freshBefore = await heroRuntimeState();
check('GP1-C3: the showcase pass is not drawing while the screen is closed',
  freshBefore.preview.active === false, JSON.stringify(freshBefore.preview));

await clickSelector('#hero-button');
await sleep(200);
await shot('fresh-guest-portrait-open');

const freshOpen = await pollUntil(heroRuntimeState, (s) => s.netStatus === 'online', { timeoutMs: 5000 });
check('GP1-C1: a fresh guest is equipped with the starter sword, nothing else',
  freshOpen.equipped === STARTER_SWORD_ID, JSON.stringify(freshOpen));

const freshWeaponIds = await page.eval(
  "JSON.stringify([...document.querySelectorAll('.hero-item')].map((el) => el.dataset.itemId))",
).then(JSON.parse);
check('GP1-C1: the Wildwood Blade does not appear in a fresh guest\'s owned-item strip at all',
  !freshWeaponIds.includes(WILDWOOD_BLADE_ID) && freshWeaponIds.includes(STARTER_SWORD_ID),
  JSON.stringify(freshWeaponIds));

check('GP1-C3: with the screen open and the starter sword equipped, the showcase is drawing and starter-accented',
  freshOpen.preview.active === true && freshOpen.preview.accentHex === swatchFor(STARTER_SWORD_ID),
  JSON.stringify(freshOpen.preview));
check('GP1-C3: the whole live hero is on the preview layer, so the world pass cannot draw a second copy of him',
  freshOpen.preview.heroOnPreviewLayer !== null
  && freshOpen.preview.heroOnPreviewLayer.total > 0
  && freshOpen.preview.heroOnPreviewLayer.onLayer === freshOpen.preview.heroOnPreviewLayer.total,
  JSON.stringify(freshOpen.preview.heroOnPreviewLayer));

await clickSelector('#hero-screen-close');
await sleep(200);
const freshClosed = await heroRuntimeState();
check('GP1-C3: closing the screen stops the showcase pass again',
  freshClosed.preview.active === false, JSON.stringify(freshClosed.preview));
check('GP1-C3: closing the screen hands every one of the hero\'s layer masks back',
  freshClosed.preview.heroOnPreviewLayer === null, JSON.stringify(freshClosed.preview));

// ── phase 2: the Blade-fixture guest (seeded above) can compare, equip, and see the showcase react ──
// Pin the guestId BEFORE the real navigation -- an about:blank tab cannot hold localStorage for the
// real origin, so this navigates once to establish it, sets the key, then navigates for real, the
// same two-step drive-relight.mjs uses for its own seeded guest.

await page.send('Page.navigate', { url: `${ORIGIN_UNDER_TEST}/favicon.ico` });
await sleep(300);
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
await page.eval(`localStorage.setItem('gq-guest-id', '${BLADE_FIXTURE_GUEST_ID}')`);
await page.send('Page.navigate', { url: URL_UNDER_TEST });
await waitForRuntime();
await checkSoloClient();

const beforeOpen = await heroRuntimeState();
check('the Hero screen starts closed', beforeOpen.open === false, JSON.stringify(beforeOpen));
check('the Blade-fixture guest starts with the starter sword EQUIPPED (owning is not the same as equipping)',
  beforeOpen.equipped === STARTER_SWORD_ID, JSON.stringify(beforeOpen));

const heroButtonRect = await rectOf('#hero-button');
check('the Hero button meets the >=44px touch target', Boolean(heroButtonRect)
  && heroButtonRect.width >= 44 && heroButtonRect.height >= 44, JSON.stringify(heroButtonRect));
await clickSelector('#hero-button');
await sleep(200);
await shot('portrait-open');

const opened = await heroRuntimeState();
check('tapping the Hero button opens the screen', opened.open === true, JSON.stringify(opened));
// Online is not guaranteed the instant the screen opens (the socket may still be handshaking), so
// this waits rather than asserting on the first read -- the equip check right after this is the one
// that actually needs it.
const online = await pollUntil(heroRuntimeState, (s) => s.netStatus === 'online', { timeoutMs: 5000 });
check('this harness reaches the server (online), so the equip below is a real round trip, not just the offline fallback',
  online.netStatus === 'online', JSON.stringify(online));
check('the Blade-fixture guest sees BOTH items in the strip (owns starter sword + granted Blade)',
  online.equipped === STARTER_SWORD_ID, JSON.stringify(online));

await clickSelector(`[data-item-id="${WILDWOOD_BLADE_ID}"]`);
await sleep(100);
const compareText = await page.eval("document.querySelector('#hero-item-compare').textContent");
check('selecting the Wildwood Blade shows the plan\'s own worked comparison, 1 -> 2 DAMAGE',
  compareText.replace(/\s+/g, ' ').trim() === '1 → 2 DAMAGE', JSON.stringify(compareText));
await shot('portrait-compare');

await clickSelector('#hero-equip-button');
// Waits on the showcase's own accent too, not just `equipped` -- the server round trip that flips
// `equipped` and the next rAF frame's heroPreview.update() call are two separate async events that
// can land a frame apart, so a predicate checking `equipped` alone can catch a snapshot where the
// reward mirror has already updated but the preview has not repainted yet (observed directly against
// the marker this accent replaced: `equipped` correct, colour still the pre-equip one).
const equipped = await pollUntil(heroRuntimeState,
  (s) => s.equipped === WILDWOOD_BLADE_ID && s.preview.accentHex === swatchFor(WILDWOOD_BLADE_ID),
  { timeoutMs: 4000 });
check('tapping EQUIP actually equips the Wildwood Blade, confirmed off the server mirror',
  equipped.equipped === WILDWOOD_BLADE_ID, JSON.stringify(equipped));
const slotName = await page.eval("document.querySelector('[data-slot=\"weapon\"] .hero-slot-name').textContent");
check('the weapon slot itself now shows the equipped item\'s name', slotName === 'Wildwood Blade', slotName);
check('GP1-C3: equipping the Blade turns the showcase\'s kicker lights the Blade\'s own colour',
  equipped.preview.active === true && equipped.preview.accentHex === swatchFor(WILDWOOD_BLADE_ID),
  JSON.stringify(equipped.preview));
await shot('portrait-equipped');

await clickSelector('#hero-screen-close');
await sleep(200);
const closed = await heroRuntimeState();
check('the close button closes the screen', closed.open === false, JSON.stringify(closed));
check('GP1-C3: the showcase stops again on close, even with a non-default item equipped',
  closed.preview.active === false, JSON.stringify(closed.preview));
const suspended = await page.eval(`JSON.stringify({
  stick: document.querySelector('#touch-stick').dataset.suspended,
  attack: document.querySelector('#attack-button').dataset.suspended,
})`).then(JSON.parse);
check('closing the screen un-suspends the movement stick and attack button',
  suspended.stick !== 'true' && suspended.attack !== 'true', JSON.stringify(suspended));

// AND THE THUMBS ARE ACTUALLY REACHABLE. The attribute check above is not the same claim, and the
// difference was a live bug: a closed Hero screen kept `pointer-events: auto` on its own chrome
// (a descendant can re-enable hit-testing under a `pointer-events: none` ancestor), and in portrait
// #hero-item-card spans the full width at the bottom -- directly over both thumbs. data-suspended
// read "false" the whole time while every tap on ATTACK landed on an invisible item card instead.
// Found because a swing capture in phase 4 produced 0.002 m of hand movement; document
// .elementFromPoint at the button's own centre answered `hero-item-name`.
//
// So this asks the DOM the question a thumb asks: at the exact pixel this control lives, who
// actually gets the touch?
async function topmostAt(selector) {
  return page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'MISSING';
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!hit) return 'NOTHING';
    return el === hit || el.contains(hit) ? 'ITSELF' : (hit.id || hit.className || hit.tagName);
  })()`);
}
async function checkThumbsReachable(where) {
  for (const [label, selector] of [['ATTACK button', '#attack-button'], ['movement stick', '#touch-stick']]) {
    // eslint-disable-next-line no-await-in-loop
    const topmost = await topmostAt(selector);
    check(`${where}: the ${label} actually receives its own taps, not something invisible on top of it`,
      topmost === 'ITSELF', `elementFromPoint at its centre -> ${topmost}`);
  }
}
await checkThumbsReachable('with the Hero screen closed');

// ── landscape pass ───────────────────────────────────────────────────────────────────────────────
// AGENTS.md: "Any new UI... is checked in both." A second full open/compare pass, not just a
// screenshot, because the CSS layout actually SWAPS (orientation media queries) rather than merely
// reflowing, and only opening it for real proves the swapped layout's buttons are still hittable.

await page.send('Emulation.setDeviceMetricsOverride', LANDSCAPE);
await sleep(200);
await clickSelector('#hero-button');
await sleep(200);
const openedLandscape = await heroRuntimeState();
check('the Hero screen also opens in landscape', openedLandscape.open === true, JSON.stringify(openedLandscape));
await shot('landscape-open');

await clickSelector(`[data-item-id="${STARTER_SWORD_ID}"]`);
await sleep(100);
await shot('landscape-compare');
const landscapeCompare = await page.eval("document.querySelector('#hero-item-compare').textContent");
check('landscape: selecting the Starter Sword while the Blade is equipped shows a DOWNGRADE comparison',
  landscapeCompare.replace(/\s+/g, ' ').trim() === '2 → 1 DAMAGE', JSON.stringify(landscapeCompare));

await clickSelector('#hero-equip-button');
// Same reasoning as the equip-to-Blade poll above: wait for the accent, not just `equipped`.
const revertedToStarter = await pollUntil(heroRuntimeState,
  (s) => s.equipped === STARTER_SWORD_ID && s.preview.accentHex === swatchFor(STARTER_SWORD_ID),
  { timeoutMs: 4000 });
check('switching back to the Starter Sword in landscape actually switches back',
  revertedToStarter.equipped === STARTER_SWORD_ID, JSON.stringify(revertedToStarter));
check('GP1-C3: the accent reverts to the starter swatch too, in landscape',
  revertedToStarter.preview.accentHex === swatchFor(STARTER_SWORD_ID), JSON.stringify(revertedToStarter.preview));

await clickSelector('#hero-screen-close');

// ── phase 4: THE SWORD IN HIS HAND ───────────────────────────────────────────────────────────────
//
// GP1-C4. The Hero screen has said WILDWOOD BLADE / EQUIPPED / DAMAGE 2 since GP1 while the boy went
// on holding the Ironwood sword. GP1-C3 made the character legible from anywhere, which turned a
// survivable inconsistency into the first thing you notice. This phase proves the mesh now follows
// the equipped item, in the Hero screen AND in ordinary gameplay, without ever showing two swords or
// none.
//
// The transform itself is NOT re-solved here and must not be: it was solved by
// tools/runtime-test/fit-wildwood-blade.mjs against Character Studio and baked into gear.js. What is
// checked here is only WHICH already-solved anchor is visible. Whether the blade sits in the fist is
// accepted by opening the captures below, the same rule everything gear-shaped in this repo follows.

await page.send('Emulation.setDeviceMetricsOverride', PORTRAIT);
await sleep(200);

async function weaponMeshState() {
  return page.eval('JSON.stringify(window.__galaQuestRuntime.equippedWeaponMeshState())').then(JSON.parse);
}

// A sampler that runs INSIDE the page, on rAF, so it observes every FRAME rather than every CDP
// round trip. "No double sword for even one stable rendered frame" is a per-frame claim, and a
// node-side poll at 30 ms cannot make it -- it would miss exactly the one-frame overlap it is
// supposed to catch. Reads the same published accessor a harness reads; touches nothing.
async function startWeaponFrameSampler() {
  await page.eval(`(() => {
    window.__gqWeaponSamples = [];
    const tick = () => {
      if (!window.__gqWeaponSampling) return;
      window.__gqWeaponSamples.push(window.__galaQuestRuntime.equippedWeaponMeshState().visibleSwords);
      requestAnimationFrame(tick);
    };
    window.__gqWeaponSampling = true;
    requestAnimationFrame(tick);
  })()`);
}
async function stopWeaponFrameSampler() {
  return page.eval(`(() => {
    window.__gqWeaponSampling = false;
    const s = window.__gqWeaponSamples ?? [];
    const counts = {};
    for (const n of s) counts[n] = (counts[n] ?? 0) + 1;
    return JSON.stringify({ frames: s.length, counts });
  })()`).then(JSON.parse);
}

await startWeaponFrameSampler();

// ── the starter state ──
const starterMesh = await pollUntil(weaponMeshState, (s) => s.shipping.mounted, { timeoutMs: 5000 });
check('GP1-C4: with the Starter Sword equipped the hero holds the shipping Ironwood sword, and only it',
  starterMesh.equippedItemId === STARTER_SWORD_ID
  && starterMesh.wantedMeshId === SHIPPING_SWORD_MESH_ID
  && starterMesh.shipping.visible === true
  && starterMesh.candidate.visible === false
  && starterMesh.visibleSwords === 1,
  JSON.stringify(starterMesh));

await clickSelector('#hero-button');
await sleep(400);
await shot('weapon-starter-portrait');
await page.send('Emulation.setDeviceMetricsOverride', LANDSCAPE);
await sleep(500);
await shot('weapon-starter-landscape');
await page.send('Emulation.setDeviceMetricsOverride', PORTRAIT);
await sleep(300);

// ── equip the Blade and watch the hand ──
await clickSelector(`[data-item-id="${WILDWOOD_BLADE_ID}"]`);
await sleep(100);
await clickSelector('#hero-equip-button');
// Waits on the MESH, not on the equip mirror: the server round trip that flips `equipped`, the GLB
// download and the frame that first draws the new anchor are three separate async events, and only
// the last one is what a child sees.
const bladeMesh = await pollUntil(weaponMeshState,
  (s) => s.candidate.mounted && s.candidate.visible, { timeoutMs: 15000 });
check('GP1-C4: equipping the Wildwood Blade puts the ACTUAL Wildwood mesh in his hand',
  bladeMesh.equippedItemId === WILDWOOD_BLADE_ID
  && bladeMesh.wantedMeshId === WILDWOOD_BLADE_CANDIDATE_ID
  && bladeMesh.candidate.visible === true,
  JSON.stringify(bladeMesh));
check('GP1-C4: and the Ironwood sword is gone -- exactly one sword, not two in one fist',
  bladeMesh.shipping.visible === false && bladeMesh.visibleSwords === 1, JSON.stringify(bladeMesh));

await sleep(400);
await shot('weapon-wildwood-portrait');
await page.send('Emulation.setDeviceMetricsOverride', LANDSCAPE);
await sleep(500);
await shot('weapon-wildwood-landscape');
await page.send('Emulation.setDeviceMetricsOverride', PORTRAIT);
await sleep(300);

// ── the same swap, in ordinary gameplay rather than in the menu ──
// Closed screen, world camera pulled in to a real inspection distance and aimed at the hero's own
// front-three-quarter using the SAME authored angle the Hero preview uses (imported, not restated),
// so this capture and the showcase are looking at the blade from the same side.
await clickSelector('#hero-screen-close');
await sleep(300);
const gameplayBefore = await worldState();
const heroHeading = await page.eval('window.__galaQuestRuntime.hero.rotation.y');
// The follow camera stands OPPOSITE its heading, so a heading of (hero facing + preview yaw + PI)
// parks it in front of the hero on the sword side. Derived rather than tuned -- see camera/follow.js.
await page.eval(`window.__galaQuestRuntime.follow.setHeading(${heroHeading + PREVIEW_ORBIT_YAW_RADIANS + Math.PI})`);
await page.eval('window.__galaQuestRuntime.follow.setDistance(5)');
await sleep(500);
await shot('weapon-wildwood-gameplay-idle');
const gameplayMesh = await weaponMeshState();
check('GP1-C4: ordinary gameplay shows the same sword the Hero screen just showed -- one equipped weapon, not two answers',
  gameplayMesh.candidate.visible === true && gameplayMesh.shipping.visible === false
  && gameplayMesh.visibleSwords === 1, JSON.stringify(gameplayMesh));

// A swing, so the blade is judged in MOTION as well as at rest. The mount was solved against the
// idle pose (character/gear.js's own header is explicit that the idle silhouette is what it is
// optimised for), and a mount can look correct standing still and pass straight through the leg
// mid-arc -- which is exactly the thing a capture has to be able to show.
//
// Timed off THE HERO'S OWN HAND, not off wall time and not off the encounter clock. Three earlier
// versions of this captured a hero standing still and were nearly published as "the swing":
//
//   1. 0.18 s after the tap -- a number lifted from a neighbouring harness's comment about the wolf's
//      hit flash. combat/encounter.js says contact is at 0.5167 s of a 1.5 s swing.
//   2. SWING_CONTACT_SECONDS after the tap -- still idle-looking. A per-frame recorder over the
//      RightHand bone showed why: the swing clock does not start until ~50 ms after the tap, and at
//      contact the hand is at the BOTTOM of its arc (y 0.76 against an idle 0.73). Contact is the
//      strike, and the strike is a low pose; the loud frame is the recovery, where the hand reaches
//      y 1.20.
//   3. polling runtime.encounterState().hero.swingSeconds -- which is -1 forever in THIS harness.
//      That accessor publishes the OFFLINE simulation, and online main.js deliberately never steps it
//      ("No local stepEncounter/requestAttack/separateFromWolf here at all"); the real swing clock
//      lives in the server mirror, which is not published. Worth knowing before writing any other
//      online harness against it -- see this file's own report at the end.
//
// So the trigger is the thing being photographed: the sword hand's own world height. It needs no
// accessor that does not already exist, it is true online and offline alike, and "the hand moved
// 0.5 m" is a stronger statement about a swing than any clock reading.
const attackRect = await rectOf('#attack-button');
const swordHandY = () => page.eval(`(() => {
  const hand = window.__galaQuestRuntime.hero.getObjectByName('RightHand');
  if (!hand) return null;
  const p = new (window.__galaQuestRuntime.hero.position.constructor)();
  hand.getWorldPosition(p);
  return +p.y.toFixed(4);
})()`);

const idleHandY = await swordHandY();
// Reported alongside the arc measurement below, because when this check failed the first time the
// interesting question was immediately "did the button even receive the tap" -- and a bare
// travelled-0.003m is not enough to answer it.
const attackDiagnostics = await page.eval(`JSON.stringify({
  netStatus: window.__galaQuestRuntime.netState().status,
  selfId: window.__galaQuestRuntime.netState().selfId,
  ready: document.querySelector('#attack-button').dataset.ready,
  suspended: document.querySelector('#attack-button').dataset.suspended,
  heroScreenOpen: window.__galaQuestRuntime.heroScreenOpen(),
  villageBoardOpen: window.__galaQuestRuntime.villageBoardOpen(),
  gameSurface: document.querySelector('#game').dataset.heroScreenOpen,
  topmostAtButton: (() => {
    const r = document.querySelector('#attack-button').getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return el ? (el.id || el.className || el.tagName) : null;
  })(),
})`).then(JSON.parse);
await page.send('Input.dispatchTouchEvent', {
  type: 'touchStart', touchPoints: [{ x: attackRect.x, y: attackRect.y, id: 0 }],
});
await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

// THE STRIKE. The hand's lowest point, and the pose where a badly-seated blade would sweep through
// the leg -- which is the whole reason a swing capture is worth taking at all.
const struckY = await pollUntil(swordHandY, (y) => y !== null && y <= idleHandY - 0.02,
  { intervalMs: 16, timeoutMs: Math.round(SWING_SECONDS * 1000) });
await shot('weapon-wildwood-swing-strike');
let swingMesh = await weaponMeshState();
check('GP1-C4: the swap survives the strike -- still exactly one sword at the bottom of the arc',
  swingMesh.visibleSwords === 1 && swingMesh.candidate.visible === true, JSON.stringify(swingMesh));

// THE RECOVERY PEAK. Blade high and clear of the body: the frame where its silhouette is actually
// legible in motion.
const peakY = await pollUntil(swordHandY, (y) => y !== null && y >= idleHandY + 0.30,
  { intervalMs: 16, timeoutMs: Math.round(SWING_SECONDS * 1000) });
await shot('weapon-wildwood-swing-peak');
swingMesh = await weaponMeshState();
check('GP1-C4: the swap survives the recovery -- still exactly one sword at the top of the arc',
  swingMesh.visibleSwords === 1 && swingMesh.candidate.visible === true, JSON.stringify(swingMesh));

// Proves the two captures above are of a MOVING hero rather than two photographs of the same idle,
// which is exactly the mistake the three earlier versions of this block made.
check('GP1-C4: the attack really swung -- the sword hand travelled a real arc, so the frames above are not two photographs of an idle',
  struckY <= idleHandY - 0.02 && peakY >= idleHandY + 0.30,
  `idle y ${idleHandY}, strike y ${struckY}, peak y ${peakY} (travel ${(peakY - struckY).toFixed(3)} m)`
  + ` -- at the tap: ${JSON.stringify(attackDiagnostics)}`);

await pollUntil(swordHandY, (y) => y !== null && Math.abs(y - idleHandY) < 0.03,
  { intervalMs: 50, timeoutMs: Math.round(SWING_SECONDS * 1000) + 800 });
await sleep(200);
await page.eval(`window.__galaQuestRuntime.follow.setHeading(${gameplayBefore.heading})`);
await page.eval(`window.__galaQuestRuntime.follow.setDistance(${gameplayBefore.distance})`);
await sleep(200);

// ── switching back ──
await clickSelector('#hero-button');
await sleep(200);
await clickSelector(`[data-item-id="${STARTER_SWORD_ID}"]`);
await sleep(100);
await clickSelector('#hero-equip-button');
const revertedMesh = await pollUntil(weaponMeshState,
  (s) => s.equippedItemId === STARTER_SWORD_ID && s.shipping.visible, { timeoutMs: 8000 });
check('GP1-C4: switching back to the Starter Sword restores the Ironwood and puts the Blade away',
  revertedMesh.shipping.visible === true && revertedMesh.candidate.visible === false
  && revertedMesh.visibleSwords === 1, JSON.stringify(revertedMesh));
check('GP1-C4: the Blade mesh stays MOUNTED after being unequipped -- hidden, not re-downloaded next time',
  revertedMesh.candidate.mounted === true, JSON.stringify(revertedMesh.candidate));
await shot('weapon-reverted-to-starter-portrait');
await clickSelector('#hero-screen-close');
await sleep(200);

// ── the per-frame invariant, over the whole phase ──
const samples = await stopWeaponFrameSampler();
check(`GP1-C4: across all ${samples.frames} RENDERED frames of this phase -- two equips, a swing and an unequip -- the hero held exactly one sword in every single one`,
  samples.frames > 100 && Object.keys(samples.counts).length === 1 && samples.counts['1'] === samples.frames,
  JSON.stringify(samples));

// ── phase 3: the same screen, opened from six HOSTILE world positions ────────────────────────────
//
// This is the phase the showcase pass exists for, and the coverage that was missing when the old
// preview shipped: every check it had passed at the spawn clearing, which is the one place a close
// dolly happens to work. Walked to for real (no teleport -- reconciliation would snap a teleport
// back, and a child gets there on their own two feet anyway), then the WORLD camera is deliberately
// aimed from the far side of the nearest large geometry, so that geometry is between the camera and
// the hero. Against the old dolly this produced frames with NO HERO IN THEM AT ALL.
//
// `through` is the thing the camera must look through; `stand` is where the hero must be standing.
const COTTAGE_PROP = PROPS.find((prop) => prop.model === 'props/village/house-cottage.glb' && prop.at[1] === -1.5);
const HOSTILE_CONTEXTS = [
  // The canonical failure case: GP3's Workshop is the longhouse, and its own interact prompt puts a
  // child right against it -- world/workshop.js's Hero-screen tap is literally taken from there.
  { name: '1-workshop-edge', stand: [-6.2, -8.6], through: WORKSHOP_PROP.at },
  // THE SHARPEST REPRODUCTION, and a state a child reaches with two fingers: the same spot with the
  // camera pinched all the way in to MIN_DISTANCE, so the longhouse wall is a metre and a half from
  // the lens. Measured against a deliberately sabotaged build (renderer.clearDepth() commented out,
  // everything else identical) this frame contains NO HERO AT ALL -- just the ground pool, which
  // survives only because it does not depth-test. With the clear in place he is fully readable. That
  // pair is why the depth clear is load-bearing rather than belt-and-braces, and it is also why the
  // machine checks below cannot be the acceptance: all 58 of them passed on the sabotaged build.
  { name: '1b-workshop-edge-zoomed', stand: [-6.2, -8.6], through: WORKSHOP_PROP.at, zoomTo: MIN_DISTANCE },
  // The largest thing in the village, 5.5 m tall with a canopy that hangs over anyone beneath it.
  { name: '2-lantern-tree', stand: [-4.7, -4.7], through: LANDMARKS[0].at },
  // A crowd, not a building: the market villager, her stall, the bench and the cart are all here.
  { name: '3-npc-cluster', stand: [-7.0, -4.9], through: VILLAGERS[0].at },
  // A second, differently-shaped building, so the fix cannot be "the longhouse was special".
  { name: '4-cottage-edge', stand: [-9.9, -1.5], through: COTTAGE_PROP.at },
  // The control. Nothing to hide behind -- if the framing only looks right when something is in the
  // way, this is the capture that says so.
  { name: '5-open-field', stand: [2.5, -7.0], through: null },
];

const forwardKey = (type) => page.send('Input.dispatchKeyEvent', {
  type,
  key: 'w',
  code: 'KeyW',
  windowsVirtualKeyCode: 87,
  nativeVirtualKeyCode: 87,
  text: type === 'keyDown' ? 'w' : undefined,
});

// Lifted from drive-relight.mjs's own walk, for the reasons its comment gives: W is camera-forward,
// so the heading is re-aimed from the newest RELEASED position before each pulse, and the key is
// released before every CDP read -- holding it down across a slow read turns runner latency into
// metres of unobserved movement.
// 45 s per context, against roughly 12 m of walking. Generous on purpose: the hosted runner's own
// frame starvation (this repo's standing QA debt) makes a client send intents more slowly than a
// desktop does, and a budget tuned to a fast machine would report that as a movement failure.
async function walkTo(targetX, targetZ, { stopWithin = 0.8, maxMillis = 45000 } = {}) {
  let last = await worldState();
  const deadline = deadlineAfter(maxMillis);
  while (Date.now() < deadline) {
    const authority = last.serverPos ?? last.heroPos;
    const authorityDistance = Math.hypot(targetX - authority[0], targetZ - authority[1]);
    const renderedDistance = Math.hypot(targetX - last.heroPos[0], targetZ - last.heroPos[1]);
    if (authorityDistance <= stopWithin && renderedDistance <= stopWithin) break;
    const heading = headingToward(authority[0], authority[1], targetX, targetZ);
    // eslint-disable-next-line no-await-in-loop
    await page.eval(`window.__galaQuestRuntime.follow.setHeading(${heading})`);
    // eslint-disable-next-line no-await-in-loop
    await forwardKey('keyDown');
    try {
      // eslint-disable-next-line no-await-in-loop
      await sleep(movementPulseMillis(Math.max(0, authorityDistance - stopWithin), { maxMs: 260, msPerMeter: 65 }));
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await forwardKey('keyUp');
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(120);
    // eslint-disable-next-line no-await-in-loop
    last = await worldState();
  }
  await sleep(300);
  return worldState();
}

/**
 * REJECTION only. Everything this returns is a way for the preview to be obviously broken; none of
 * them is a way for it to be good. `heroFrame` is the live hero's own bounds projected through the
 * preview camera, in normalized screen space with y down.
 *
 * The bands are set from measurement, not taste -- the five contexts above, both orientations,
 * measured on the running game: portrait framed the hero at height 0.563..0.577 with left 0.185 and
 * right 0.825 at the extremes; landscape at height 0.654..0.673, left 0.293, right 0.701. The bands
 * are wide enough that ordinary variation (which arm is forward, where the blade swings) can never
 * trip them, and tight enough that a hero framed off-screen, at postage-stamp size, or filling the
 * frame from the chin up cannot pass.
 */
function framingProblems(preview) {
  const problems = [];
  if (preview.active !== true) problems.push('the showcase pass is not drawing');
  const layer = preview.heroOnPreviewLayer;
  if (!layer || layer.total === 0) problems.push('no hero claimed by the preview');
  else if (layer.onLayer !== layer.total) problems.push(`only ${layer.onLayer}/${layer.total} hero nodes on the preview layer`);
  const frame = preview.heroFrame;
  if (!frame) { problems.push('no projected hero bounds'); return problems; }
  if (frame.left < 0.03 || frame.right > 0.97) problems.push(`hero runs off the sides (${frame.left.toFixed(3)}..${frame.right.toFixed(3)})`);
  if (frame.top < 0.03 || frame.bottom > 0.97) problems.push(`hero runs off the top/bottom (${frame.top.toFixed(3)}..${frame.bottom.toFixed(3)})`);
  if (frame.height < 0.35) problems.push(`hero is only ${(frame.height * 100).toFixed(1)}% of frame height`);
  if (frame.height > 0.90) problems.push(`hero fills ${(frame.height * 100).toFixed(1)}% of frame height`);
  if (frame.centerX < 0.30 || frame.centerX > 0.70) problems.push(`hero is off-centre horizontally (${frame.centerX.toFixed(3)})`);
  return problems;
}

await page.send('Emulation.setDeviceMetricsOverride', PORTRAIT);
await sleep(200);

// Equip the Blade for the whole hostile sweep, so every capture below is also a capture of the
// progression state a child actually plays for -- and so the kicker accent under test is the one
// that CHANGED, not the default.
await clickSelector('#hero-button');
await sleep(150);
await clickSelector(`[data-item-id="${WILDWOOD_BLADE_ID}"]`);
await sleep(100);
await clickSelector('#hero-equip-button');
await pollUntil(heroRuntimeState, (s) => s.equipped === WILDWOOD_BLADE_ID, { timeoutMs: 4000 });
await clickSelector('#hero-screen-close');
await sleep(200);

const hostileFrames = [];
for (const context of HOSTILE_CONTEXTS) {
  // eslint-disable-next-line no-await-in-loop
  const arrived = await walkTo(context.stand[0], context.stand[1]);
  const missBy = Math.hypot(arrived.heroPos[0] - context.stand[0], arrived.heroPos[1] - context.stand[1]);
  check(`${context.name}: the hero actually walked to the context (no teleport)`, missBy <= 2.5,
    `stood at ${JSON.stringify(arrived.heroPos)}, wanted ${JSON.stringify(context.stand)} (${missBy.toFixed(2)} m off)`);

  if (context.through) {
    // Put the geometry BETWEEN the camera and the hero: aim the camera at the point directly OPPOSITE
    // the landmark, which parks the camera on the landmark's own side of him.
    const [hx, hz] = arrived.heroPos;
    const [tx, tz] = context.through;
    // eslint-disable-next-line no-await-in-loop
    await page.eval(`window.__galaQuestRuntime.follow.setHeading(${headingToward(hx, hz, hx + (hx - tx), hz + (hz - tz))})`);
    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }
  // Set BEFORE the world-camera snapshot below, so the close-restores-nothing check compares against
  // the zoom the child actually left the camera at. Reset explicitly rather than left where the last
  // context put it -- a distance that leaked between contexts would make each capture depend on the
  // one before it.
  // eslint-disable-next-line no-await-in-loop
  await page.eval(`window.__galaQuestRuntime.follow.setDistance(${context.zoomTo ?? DEFAULT_DISTANCE})`);
  // eslint-disable-next-line no-await-in-loop
  await sleep(200);

  // eslint-disable-next-line no-await-in-loop
  const worldBefore = await worldState();
  // eslint-disable-next-line no-await-in-loop
  await clickSelector('#hero-button');
  // eslint-disable-next-line no-await-in-loop
  await sleep(650);

  for (const [orientation, metrics] of [['portrait', PORTRAIT], ['landscape', LANDSCAPE]]) {
    // eslint-disable-next-line no-await-in-loop
    await page.send('Emulation.setDeviceMetricsOverride', metrics);
    // eslint-disable-next-line no-await-in-loop
    await sleep(orientation === 'portrait' ? 250 : 600);
    // eslint-disable-next-line no-await-in-loop
    await shot(`hostile-${context.name}-${orientation}`);
    // eslint-disable-next-line no-await-in-loop
    const state = await heroRuntimeState();
    const problems = framingProblems(state.preview);
    check(`${context.name} (${orientation}): the showcase framing is not obviously broken`,
      problems.length === 0, problems.join('; ') || JSON.stringify(state.preview.heroFrame));
    check(`${context.name} (${orientation}): the equipped Blade's accent survives being opened here`,
      state.preview.accentHex === swatchFor(WILDWOOD_BLADE_ID), JSON.stringify(state.preview.accentHex));
    hostileFrames.push({ context: context.name, orientation, frame: state.preview.heroFrame });
  }

  // eslint-disable-next-line no-await-in-loop
  await page.send('Emulation.setDeviceMetricsOverride', PORTRAIT);
  // eslint-disable-next-line no-await-in-loop
  await sleep(250);
  // eslint-disable-next-line no-await-in-loop
  await clickSelector('#hero-screen-close');
  // eslint-disable-next-line no-await-in-loop
  await sleep(200);
  // eslint-disable-next-line no-await-in-loop
  const worldAfter = await worldState();
  // The other half of the contract, and the one a camera dolly used to have to get right by restoring
  // three saved numbers: closing Hero must leave the world camera EXACTLY where the child left it.
  // Nothing moves it now, so this is checking that nothing started to.
  check(`${context.name}: closing Hero left the world camera untouched`,
    worldAfter.heading === worldBefore.heading
    && worldAfter.pitch === worldBefore.pitch
    && worldAfter.distance === worldBefore.distance,
    `before ${JSON.stringify([worldBefore.heading, worldBefore.pitch, worldBefore.distance])}`
    + ` after ${JSON.stringify([worldAfter.heading, worldAfter.pitch, worldAfter.distance])}`);
}

// LOCATION-INDEPENDENCE, stated as a number. The whole defect was that the preview's composition
// depended on where the hero happened to be standing and which way the camera happened to face. If
// that is fixed, the projected framing has to be the SAME at the Workshop, under the tree, in a crowd
// and in an empty field -- so the spread across all five is the measurement that matters, not any one
// of them. (Small differences remain and should: the idle animation is live, so an arm is somewhere
// slightly different in each capture.)
for (const orientation of ['portrait', 'landscape']) {
  const frames = hostileFrames.filter((entry) => entry.orientation === orientation && entry.frame);
  const heights = frames.map((entry) => entry.frame.height);
  const centres = frames.map((entry) => entry.frame.centerY);
  const spread = (values) => Math.max(...values) - Math.min(...values);
  check(`${orientation}: the framing is LOCATION-INDEPENDENT -- same hero size and height at all ${frames.length} contexts, including one pinched to MIN_DISTANCE`,
    frames.length === HOSTILE_CONTEXTS.length && spread(heights) < 0.06 && spread(centres) < 0.06,
    `height spread ${spread(heights).toFixed(4)}, centreY spread ${spread(centres).toFixed(4)} over ${frames.length} contexts`);
}

// ── errors ───────────────────────────────────────────────────────────────────────────────────────
const isCosmetic404 = (text) => COSMETIC_404_PATTERNS.some((pattern) => text.includes(pattern));
const realErrors = consoleErrors.filter((text) => !isCosmetic404(text));
check('no console errors across the whole Hero-screen pass, fresh guest, granted guest, six hostile world contexts, portrait and landscape',
  realErrors.length === 0, realErrors.slice(0, 5).join(' | '));

writeFileSync(`${OUT}hero-screen-results.json`, JSON.stringify({ results, consoleErrors }, null, 2));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
await page.send('Target.closeTarget', { targetId });
process.exit(failures === 0 ? 0 : 1);
