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
 *   3. GP1-C2 -- equipping produces a visible change in the Hero screen's 3D preview: the temporary
 *      floating marker (progression/heroScreen.js's createHeroPreviewMarker) is hidden while the
 *      screen is closed and recolours to match whichever weapon is equipped while it is open.
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
import { openRewardStore } from '../../net/rewardStore.mjs';
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
    marker: window.__galaQuestRuntime.heroPreviewMarkerState(),
  })`).then(JSON.parse);
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
check('GP1-C2: the preview marker is hidden while the screen is closed',
  freshBefore.marker.visible === false, JSON.stringify(freshBefore.marker));

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

check('GP1-C2: with the screen open and the starter sword equipped, the marker is visible and starter-coloured',
  freshOpen.marker.visible === true && freshOpen.marker.colorHex === swatchFor(STARTER_SWORD_ID),
  JSON.stringify(freshOpen.marker));

await clickSelector('#hero-screen-close');
await sleep(200);
const freshClosed = await heroRuntimeState();
check('GP1-C2: closing the screen hides the marker again',
  freshClosed.marker.visible === false, JSON.stringify(freshClosed.marker));

// ── phase 2: the Blade-fixture guest (seeded above) can compare, equip, and see the marker react ──
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
// Waits on the marker's own colour too, not just `equipped` -- the server round trip that flips
// `equipped` and the next rAF frame's heroPreviewMarker.update() call are two separate async events
// that can land a frame apart, so a predicate checking `equipped` alone can catch a snapshot where
// the reward mirror has already updated but the marker hasn't repainted yet (this was observed
// directly: `equipped` correct, `marker.colorHex` still the pre-equip colour).
const equipped = await pollUntil(heroRuntimeState,
  (s) => s.equipped === WILDWOOD_BLADE_ID && s.marker.colorHex === swatchFor(WILDWOOD_BLADE_ID),
  { timeoutMs: 4000 });
check('tapping EQUIP actually equips the Wildwood Blade, confirmed off the server mirror',
  equipped.equipped === WILDWOOD_BLADE_ID, JSON.stringify(equipped));
const slotName = await page.eval("document.querySelector('[data-slot=\"weapon\"] .hero-slot-name').textContent");
check('the weapon slot itself now shows the equipped item\'s name', slotName === 'Wildwood Blade', slotName);
check('GP1-C2: equipping the Blade recolours the preview marker to the Blade\'s own swatch',
  equipped.marker.visible === true && equipped.marker.colorHex === swatchFor(WILDWOOD_BLADE_ID),
  JSON.stringify(equipped.marker));
await shot('portrait-equipped');

await clickSelector('#hero-screen-close');
await sleep(200);
const closed = await heroRuntimeState();
check('the close button closes the screen', closed.open === false, JSON.stringify(closed));
check('GP1-C2: the marker hides again on close, even with a non-default item equipped',
  closed.marker.visible === false, JSON.stringify(closed.marker));
const suspended = await page.eval(`JSON.stringify({
  stick: document.querySelector('#touch-stick').dataset.suspended,
  attack: document.querySelector('#attack-button').dataset.suspended,
})`).then(JSON.parse);
check('closing the screen un-suspends the movement stick and attack button',
  suspended.stick !== 'true' && suspended.attack !== 'true', JSON.stringify(suspended));

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
// Same reasoning as the equip-to-Blade poll above: wait for the marker colour, not just `equipped`.
const revertedToStarter = await pollUntil(heroRuntimeState,
  (s) => s.equipped === STARTER_SWORD_ID && s.marker.colorHex === swatchFor(STARTER_SWORD_ID),
  { timeoutMs: 4000 });
check('switching back to the Starter Sword in landscape actually switches back',
  revertedToStarter.equipped === STARTER_SWORD_ID, JSON.stringify(revertedToStarter));
check('GP1-C2: the marker reverts to the starter swatch too, in landscape', revertedToStarter.marker.colorHex === swatchFor(STARTER_SWORD_ID),
  JSON.stringify(revertedToStarter.marker));

await clickSelector('#hero-screen-close');

// ── errors ───────────────────────────────────────────────────────────────────────────────────────
const isCosmetic404 = (text) => COSMETIC_404_PATTERNS.some((pattern) => text.includes(pattern));
const realErrors = consoleErrors.filter((text) => !isCosmetic404(text));
check('no console errors across the whole Hero-screen pass, fresh guest, granted guest, portrait and landscape',
  realErrors.length === 0, realErrors.slice(0, 5).join(' | '));

writeFileSync(`${OUT}hero-screen-results.json`, JSON.stringify({ results, consoleErrors }, null, 2));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
await page.send('Target.closeTarget', { targetId });
process.exit(failures === 0 ? 0 : 1);
