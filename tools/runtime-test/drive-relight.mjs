/**
 * Proves the W relight beat end to end against the real running game: a fresh guest sees the dark
 * tree and the keeper's quest line; a guest already holding all three Lantern Marks sees the tree
 * LIT the instant the welcome message lands (no combat needed in this run) and the keeper's
 * congratulation line. Captures both, for a person (or an agent standing in for one) to open and
 * judge against searched references -- this harness proves the STATE is right; it does not judge
 * the light/material taste itself (see the private engineering archive for that).
 *
 *   node tools/runtime-test/drive-relight.mjs
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * Cribs drive-village.mjs's own CDP-over-websocket/no-Puppeteer conventions and drive-marks.mjs's
 * "clear localStorage before the first navigation" discipline for a clean guestId. This probe uses
 * desktop keyboard movement for a deterministic dialogue route; drive-touch.mjs remains the
 * separate iPad-style touch-input proof.
 *
 * BEFORE running this for real: the seeded guest below is written idempotently at the top of this
 * script (net/rewardStore.mjs's own apply(), fit:-prefixed eventIds -- exactly
 * docs/pipeline/gear.md's "Unlock-gated gear" pattern), but the RUNNING SERVER must be restarted
 * after that seed lands, per the same runbook ("restart the server so nothing stale is cached") --
 * this script does not manage the server process itself, the same way fit-lantern.mjs's own runbook
 * treats the restart as a separate operator step, not something the proof script does for you.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openRewardStore } from '../../net/rewardStore.mjs';
import { headingToward, KEEPER_WAVE_RADIUS_METERS } from '../../public/src/world/zoneLoader.js';
import { SPAWNS, LANDMARKS } from '../../public/src/world/zones/village.js';
import { KEEPER_LINE_QUEST, KEEPER_LINE_UNLOCKED } from '../../public/src/world/keeperSpeech.js';
import { pollUntilDeadline } from './automation-timing.mjs';
import { startOwnedServer } from './owned-server.mjs';
import { TAP_TARGET_FLOOR_PX } from '../../public/src/ui/tapTargets.js';

const CHROME_PORT = 9224;
// Spawns and owns its own server on an isolated port rather than using the shared 5201 (Phase H1).
// This harness seeds a reserved fixture guest into the reward store and then asserts what the page
// does with it, so it is the one least able to afford another run's writes landing in the middle.
// See owned-server.mjs.
const server = await startOwnedServer();
const URL_UNDER_TEST = server.url;
const ORIGIN_UNDER_TEST = server.origin;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
const VIEWPORT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
const REWARD_STORE_PATH = fileURLToPath(new URL('../../data/rewards.db', import.meta.url));
// the owner's own id for this proof (brief W3), never reused by any other harness or real guest.
const RELIGHT_GUEST_ID = 'relight-probe-guest-0001';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// Idempotent (INSERT OR IGNORE on the eventId primary key -- net/rewardStore.mjs's own guarantee):
// safe to run this script over and over without minting duplicate marks or double-unlocking.
(() => {
  const store = openRewardStore(REWARD_STORE_PATH);
  for (let i = 1; i <= 3; i += 1) {
    store.apply({ guestId: RELIGHT_GUEST_ID, type: 'mark-earned', eventId: `fit:mark:${RELIGHT_GUEST_ID}:${i}` });
  }
  store.apply({ guestId: RELIGHT_GUEST_ID, type: 'lantern-unlocked', eventId: `fit:unlock:${RELIGHT_GUEST_ID}` });
  const seeded = store.marksFor(RELIGHT_GUEST_ID) === 3 && store.unlockedFor(RELIGHT_GUEST_ID);
  check('the relight-probe guest is seeded with 3 marks and unlocked (idempotent apply)', seeded,
    `marks ${store.marksFor(RELIGHT_GUEST_ID)}, unlocked ${store.unlockedFor(RELIGHT_GUEST_ID)}`);
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

const browserVersion = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
const browser = new CDP(browserVersion.webSocketDebuggerUrl);
await browser.ready();

// Same self-cleaning discipline drive-marks.mjs uses: close any stale tab already on the game's
// URL before this run starts.
const existing = await browser.send('Target.getTargets');
for (const target of existing.targetInfos) {
  if (target.type === 'page' && target.url.startsWith(URL_UNDER_TEST)) {
    await browser.send('Target.closeTarget', { targetId: target.targetId });
  }
}

// The favicon entry STAYS here, and this file is the exception -- Phase R3a pruned it from
// drive-marks.mjs and drive-two-clients.mjs, where it really had become inert once index.html
// declared its zero-network data-URI favicon (Task F1), then measured this harness failing with
// `404 [http://127.0.0.1:5202/favicon.ico]` and put it back.
//
// The reason is not staleness, it is that THIS harness causes the 404 on purpose: the unlocked-guest
// run below navigates to `${ORIGIN_UNDER_TEST}/favicon.ico` as a cheap way to establish the origin
// before writing localStorage (an about:blank tab cannot hold storage for the game's origin). No such
// file exists on disk, so the server correctly answers 404 -- to the harness's own deliberate
// request, not to anything the page did. Removing the entry does not remove the 404; it just makes
// the harness fail itself.
const COSMETIC_404_PATTERNS = ['/favicon.ico', '/assets/gear/lantern_belt.glb'];
const consoleErrors = [];

async function openPage() {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
  const page = new CDP(list.find((t) => t.id === targetId).webSocketDebuggerUrl);
  await page.ready();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Log.enable');
  page.ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const entry = msg.params.entry;
      consoleErrors.push(entry.url ? `${entry.text} [${entry.url}]` : entry.text);
    }
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.text);
  });
  await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  return { targetId, page };
}

async function waitForRuntime(page) {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    await sleep(500);
    ready = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
  }
  if (!ready) throw new Error(`runtime never came up on ${URL_UNDER_TEST}`);
  let zone = await page.eval('window.__galaQuestRuntime.zoneDebug()');
  for (let i = 0; i < 60 && (zone.requested === 0 || zone.loaded + zone.failed < zone.requested); i += 1) {
    await sleep(250);
    zone = await page.eval('window.__galaQuestRuntime.zoneDebug()');
  }
  return zone;
}

const forwardKey = (page, type) => page.send('Input.dispatchKeyEvent', {
  type,
  code: 'KeyW',
  key: 'w',
  windowsVirtualKeyCode: 87,
  nativeVirtualKeyCode: 87,
});

const state = (page) => page.eval(`(() => {
  const r = window.__galaQuestRuntime;
  const net = r.netState();
  return JSON.stringify({
    heroPos: [+r.player.position.x.toFixed(2), +r.player.position.z.toFixed(2)],
    serverPos: net.serverSelf ? [+net.serverSelf.x.toFixed(2), +net.serverSelf.z.toFixed(2)] : null,
    serverSpeed: net.serverSelf?.speed ?? null,
    heading: r.follow.heading,
    tree: r.zoneTreeState(),
    keeperLine: {
      shown: document.querySelector('#keeper-speech').dataset.shown,
      text: document.querySelector('#keeper-speech-text').textContent,
    },
    banner: {
      shown: document.querySelector('#banner').dataset.shown,
      text: document.querySelector('#banner').textContent,
    },
    rewards: r.rewards(),
    guestId: r.guestId(),
    netStatus: net.status,
  });
})()`).then(JSON.parse);

async function pollUntil(page, predicate, { intervalMs = 100, timeoutMs = 5000 } = {}) {
  return pollUntilDeadline(() => state(page), predicate, { intervalMs, timeoutMs });
}

// The zone can finish loading before the socket's first snapshot arrives. Walking before that point
// only changes the local prediction; when the server finally joins at spawn, reconciliation snaps
// the hero away from the Keeper and the dialogue correctly disappears. Await both online status and
// the first authoritative self position before this probe asks a real-touch walk to prove proximity.
async function waitForAuthoritativePlayer(page) {
  return pollUntil(page, (next) => next.netStatus === 'online' && next.serverPos !== null);
}

// The camera's forward direction is screen-up, so setting this heading lets the keyboard's W key
// use the same `worldDirectionForInput` route a player uses, without a synthetic-touch scheduling
// loop racing the CI runner.
async function setHeadingToward(page, x, z) {
  const hero = await state(page);
  const heading = headingToward(hero.heroPos[0], hero.heroPos[1], x, z);
  await page.eval(`window.__galaQuestRuntime.follow.setHeading(${heading})`);
  await sleep(150);
}
async function setCameraDistance(page, distance) {
  await page.eval(`window.__galaQuestRuntime.follow.setDistance(${distance})`);
  await sleep(150);
}

// THE WALK IS HELD, AND THE DECISION TO STOP IS MADE INSIDE THE PAGE.
//
// What this replaces alternated a bounded key-down pulse with a 120ms settle and three CDP round
// trips, re-aiming each time from what it read back. Measured on this machine, crossing the 6.44m
// from spawn to Aldric took 7217ms of its 10000ms budget over 26 iterations -- 3105ms of key-down,
// 3120ms of settle sleeps, and 129ms of actual CDP time. So even where round trips are effectively
// free the loop finished with 28% of its budget to spare: a threshold nobody chose, one slow
// machine away from red.
//
// The hosted runner is that machine. It has no GPU and paints at 3-5fps, and a Runtime.evaluate
// there waits on the main thread -- a frame each, not 5ms each. The same three round trips turn a
// ~277ms iteration into ~770ms, the duty cycle falls by roughly two thirds, and the hero covers
// 3.1m of the 6.44m before the budget expires. It stops 3.3m from Aldric, outside
// KEEPER_WAVE_RADIUS_METERS, so the keeper never waves and both line checks fail behind it. That
// is the four-failure shape the matrix reported at c62dcad: two failures wearing four hats.
//
// Raising the budget would only re-decide the same number by drift on a different machine. So the
// round trips leave the movement path instead. An in-page rAF loop re-aims the camera heading at
// the target every frame from the runtime's own authoritative position and latches arrival there,
// at frame resolution, which is what lets the key stay down for the whole walk. Wall clock becomes
// distance over speed on any machine, and CDP latency now delays only the RELEASE -- late by at
// most one poll, and since the walker is still aiming at the target when that poll lands, the
// travel it buys is toward Aldric rather than past him.
const startWalk = (targetX, targetZ, stopWithin) => `(async () => {
  const { headingToward } = await import('/src/world/zoneLoader.js');
  const runtime = window.__galaQuestRuntime;
  const metresAway = (x, z) => Math.hypot(${targetX} - x, ${targetZ} - z);
  const walk = {
    frames: 0,
    arrived: false,
    arrivedFrame: null,
    startMetres: null,
    closestMetres: null,
    metres: null,
    stopped: false,
  };
  window.__gqWalk = walk;
  const step = () => {
    if (walk.stopped) return;
    walk.frames += 1;
    const self = runtime.netState().serverSelf;
    // Steer by the position the SERVER holds, because that is the one it will snap the hero back
    // to and the one the caller's check reads. But do not call the walk done until the rendered
    // hero has caught up as well -- the caller asserts on both, so the latch waits for both.
    const authority = self ? { x: self.x, z: self.z } : runtime.player.position;
    const behind = Math.max(
      metresAway(runtime.player.position.x, runtime.player.position.z),
      metresAway(authority.x, authority.z),
    );
    if (walk.startMetres === null) walk.startMetres = behind;
    walk.metres = behind;
    if (walk.closestMetres === null || behind < walk.closestMetres) walk.closestMetres = behind;
    if (!walk.arrived && behind <= ${stopWithin}) {
      walk.arrived = true;
      walk.arrivedFrame = walk.frames;
    }
    runtime.follow.setHeading(headingToward(authority.x, authority.z, ${targetX}, ${targetZ}));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return true;
})()`;

const readWalk = (page) => page.eval('JSON.stringify(window.__gqWalk)').then(JSON.parse);
const metresOrUnknown = (value) => (Number.isFinite(value) ? `${value.toFixed(2)}m` : 'unknown');

async function walkToward(page, targetX, targetZ, stopWithin, maxMillis) {
  await page.eval(startWalk(targetX, targetZ, stopWithin));
  await forwardKey(page, 'keyDown');
  let walk;
  try {
    walk = await pollUntilDeadline(() => readWalk(page), (next) => next.arrived,
      { intervalMs: 100, timeoutMs: maxMillis });
  } finally {
    await forwardKey(page, 'keyUp');
    await page.eval('Boolean(window.__gqWalk) && (window.__gqWalk.stopped = true)');
  }
  // Printed whether or not the walk arrived, because the interesting number on a failure is how
  // many frames the page actually painted: a walk that never arrives after 400 frames is a broken
  // route, and one that never arrives after 9 is a runner that never got to move.
  const reached = walk.arrived
    ? `inside ${stopWithin}m at frame ${walk.arrivedFrame}`
    : `NEVER ARRIVED, closest ${metresOrUnknown(walk.closestMetres)}`;
  console.log(`  walk: ${walk.frames} frames, ${metresOrUnknown(walk.startMetres)} to `
    + `${metresOrUnknown(walk.metres)}, ${reached}`);
  // Let the release reach the page, then wait for the server to agree the hero has stopped, so the
  // captures below are not taken mid-stride.
  await sleep(200);
  return pollUntil(page, (next) => next.serverPos !== null && next.serverSpeed === 0);
}

async function shot(page, name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}relight-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured relight-${name}.png`);
}

const [treeX, treeZ] = LANDMARKS[0].at;
const [keeperX, keeperZ] = SPAWNS.keeper;

// The radius is imported, not restated (docs/MISTAKES.md GQ-007), and the comparison is the same
// one keeperSpeechState makes: it hides the line when `distance > radiusMeters`, so standing
// exactly on the radius is INSIDE. This check used to say `< 2.0` in two places -- a second copy
// of the number that would have kept passing if the real radius ever moved, while the keeper
// stayed silent. drive-ranger.mjs already imports the same constant for the same question.
const withinWaveRadius = (at) => [at.heroPos, at.serverPos].every(
  (p) => p !== null && Math.hypot(p[0] - keeperX, p[1] - keeperZ) <= KEEPER_WAVE_RADIUS_METERS,
);

// ── 1. Fresh guest: dark tree, quest line, speaker present ─────────────────────────────────────
{
  const { targetId, page } = await openPage();
  await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
  await page.send('Page.navigate', { url: URL_UNDER_TEST });
  const zone = await waitForRuntime(page);
  check('fresh guest: the zone finished loading', zone.requested > 0 && zone.loaded + zone.failed === zone.requested,
    `requested ${zone.requested}, loaded ${zone.loaded}, failed ${zone.failed}`);

  const authority = await waitForAuthoritativePlayer(page);
  check('fresh guest: movement is server-authoritative before the Keeper approach',
    authority.netStatus === 'online' && authority.serverPos !== null,
    JSON.stringify({ netStatus: authority.netStatus, serverPos: authority.serverPos }));

  const fresh = await state(page);
  check('fresh guest: no marks on record', (fresh.rewards[Object.keys(fresh.rewards)[0]]?.marks ?? 0) === 0,
    JSON.stringify(fresh.rewards));
  check('fresh guest: the tree is DARK (not lit)', fresh.tree?.lit === false, JSON.stringify(fresh.tree));

  await setCameraDistance(page, 9);
  await setHeadingToward(page, treeX, treeZ);
  await shot(page, 'fresh-dark-tree');

  const approached = await walkToward(page, keeperX, keeperZ, 0.75, 10000);
  check('fresh guest: walking reaches the keeper',
    withinWaveRadius(approached),
    `hero ${JSON.stringify(approached.heroPos)}, server ${JSON.stringify(approached.serverPos)}, `
      + `radius ${KEEPER_WAVE_RADIUS_METERS}m`);
  const speaking = await pollUntil(page, (s) => s.keeperLine.shown === 'true');
  check('fresh guest: the keeper line shows and matches the quest line verbatim',
    speaking.keeperLine.shown === 'true' && speaking.keeperLine.text === KEEPER_LINE_QUEST,
    JSON.stringify(speaking));
  const speakerRect = await page.eval(`(() => {
    const b = document.querySelector('#keeper-speech-speak');
    const r = b.getBoundingClientRect();
    return JSON.stringify({ width: r.width, height: r.height });
  })()`).then(JSON.parse);
  check(`fresh guest: the speaker button meets the >=${TAP_TARGET_FLOOR_PX}px touch target`,
    speakerRect.width >= TAP_TARGET_FLOOR_PX && speakerRect.height >= TAP_TARGET_FLOOR_PX,
    JSON.stringify(speakerRect));

  await setCameraDistance(page, 8);
  await setHeadingToward(page, keeperX, keeperZ);
  await shot(page, 'fresh-keeper-quest-line');

  await page.send('Target.closeTarget', { targetId });
}

// ── 2. Seeded unlocked guest: tree LIT from welcome state alone, congratulation line ────────────
{
  const { targetId, page } = await openPage();
  // Pin the guestId BEFORE the first navigation, same convention gear.md's fit page uses -- an
  // about:blank tab cannot hold localStorage for the real origin, so navigate once to establish
  // it, THEN set the key, THEN navigate for real.
  await page.send('Page.navigate', { url: `${ORIGIN_UNDER_TEST}/favicon.ico` });
  await sleep(300);
  await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
  await page.eval(`localStorage.setItem('gq-guest-id', '${RELIGHT_GUEST_ID}')`);
  await page.send('Page.navigate', { url: URL_UNDER_TEST });
  const zone = await waitForRuntime(page);
  check('unlocked guest: the zone finished loading', zone.requested > 0 && zone.loaded + zone.failed === zone.requested,
    `requested ${zone.requested}, loaded ${zone.loaded}, failed ${zone.failed}`);

  const authority = await waitForAuthoritativePlayer(page);
  check('unlocked guest: movement is server-authoritative before the Keeper approach',
    authority.netStatus === 'online' && authority.serverPos !== null,
    JSON.stringify({ netStatus: authority.netStatus, serverPos: authority.serverPos }));

  const welcome = await state(page);
  check('unlocked guest: the SAME seeded guestId came back (localStorage, not a fresh mint)',
    welcome.guestId === RELIGHT_GUEST_ID, `guestId ${welcome.guestId}`);
  const welcomeRewards = welcome.rewards[Object.keys(welcome.rewards)[0]];
  check('unlocked guest: 3 marks and lanternUnlocked true, read from welcome state alone (no fight in this run)',
    welcomeRewards?.marks === 3 && welcomeRewards?.lanternUnlocked === true, JSON.stringify(welcome.rewards));
  check('unlocked guest: the tree is LIT, driven purely by welcome state', welcome.tree?.lit === true,
    JSON.stringify(welcome.tree));

  // THE CALL NORTH (P0 Tree->Gate handoff, second-playtest fix): must appear WITHOUT walking
  // anywhere near Aldric -- that is the entire point of this check. Polled rather than read off
  // `welcome` directly because it is one more frame behind `tree.lit` (main.js fires it the frame
  // after `isTreeLit()` flips), so a guest arriving already-lit still gets it immediately on load.
  const called = await pollUntil(page, (s) => s.banner.shown === 'true');
  check('unlocked guest: Aldric calls "follow the lit path north" automatically, no proximity needed',
    called.banner.shown === 'true' && called.banner.text === 'Aldric: follow the lit path north!',
    JSON.stringify(called.banner));

  await setCameraDistance(page, 9);
  await setHeadingToward(page, treeX, treeZ);
  await shot(page, 'unlocked-lit-tree');

  const approached = await walkToward(page, keeperX, keeperZ, 0.75, 10000);
  check('unlocked guest: walking reaches the keeper',
    withinWaveRadius(approached),
    `hero ${JSON.stringify(approached.heroPos)}, server ${JSON.stringify(approached.serverPos)}, `
      + `radius ${KEEPER_WAVE_RADIUS_METERS}m`);
  const speaking = await pollUntil(page, (s) => s.keeperLine.shown === 'true');
  check('unlocked guest: the keeper line shows and matches the congratulation line verbatim',
    speaking.keeperLine.shown === 'true' && speaking.keeperLine.text === KEEPER_LINE_UNLOCKED,
    JSON.stringify(speaking));

  await setCameraDistance(page, 8);
  await setHeadingToward(page, keeperX, keeperZ);
  await shot(page, 'unlocked-keeper-congrats-line');

  await page.send('Target.closeTarget', { targetId });
}

// ── errors ───────────────────────────────────────────────────────────────────────────────────
const isCosmetic404 = (text) => COSMETIC_404_PATTERNS.some((pattern) => text.includes(pattern));
const realErrors = consoleErrors.filter((text) => !isCosmetic404(text));
const cosmeticErrors = consoleErrors.filter(isCosmetic404);
check('no console errors across both runs', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
if (cosmeticErrors.length) {
  console.log(`  NOTE  ${cosmeticErrors.length} known-missing-asset 404(s) -- not a failure.`);
}

writeFileSync(`${OUT}relight-results.json`, JSON.stringify({ results, consoleErrors }, null, 2));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
