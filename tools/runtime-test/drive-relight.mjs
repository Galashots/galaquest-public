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
import {
  headingToward, KEEPER_GREET_REARM_RADIUS_METERS, KEEPER_WAVE_RADIUS_METERS,
} from '../../public/src/world/zoneLoader.js';
import { SPAWNS, LANDMARKS } from '../../public/src/world/zones/village.js';
import { KEEPER_LINE_QUEST, KEEPER_LINE_UNLOCKED } from '../../public/src/world/keeperSpeech.js';
import {
  deadlineAfter,
  movementPulseMillis,
  pollUntilDeadline,
} from './automation-timing.mjs';
import {
  metresOrUnknown, READ_WALK, startWalk, STOP_WALK,
} from './in-page-driver.mjs';
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

// The walk is held, and arrival is decided inside the page -- see in-page-driver.mjs for the
// measurement that made that necessary. This harness's own numbers are the ones in that header:
// 7217ms of a 10000ms budget locally to cross the 6.44m from spawn to Aldric, and 3.1m of it hosted
// before the budget expired, which left the hero 3.3m away, outside KEEPER_WAVE_RADIUS_METERS, with
// the keeper silent and both line checks failing behind the two walk checks.
// HOW CLOSE THE HELD LEG MAY BE TRUSTED TO GET BEFORE THE PULSED ONE TAKES OVER.
//
// A held walk cannot stop on a mark. Arrival latches in-page at frame resolution, but the RELEASE
// costs a poll and a round trip, and authority keeps integrating real time throughout in the last
// direction it was sent. This harness went green hosted at e543b62 and red again at e68cf54 without
// a line of it changing, and the failure says why: hero 1.35m from Aldric, SERVER 2.06m, against a
// 2.0m radius. The rendered hero was inside and the authoritative one had run six centimetres past
// the edge. Holding for the distance and pulsing the last leg puts the stop back under the
// harness's control, at the cost of a few round trips over ground short enough to afford them.
const HELD_APPROACH_SLACK_METRES = 2;

async function pulseWalkToward(page, targetX, targetZ, stopWithin, maxMillis) {
  let last = await state(page);
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
    await forwardKey(page, 'keyDown');
    try {
      // eslint-disable-next-line no-await-in-loop
      await sleep(movementPulseMillis(Math.max(0, authorityDistance - stopWithin), {
        maxMs: 260,
        msPerMeter: 65,
      }));
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await forwardKey(page, 'keyUp');
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(120);
    // eslint-disable-next-line no-await-in-loop
    last = await state(page);
  }
  return last;
}

async function heldWalkToward(page, targetX, targetZ, stopWithin, maxMillis) {
  const holdWithin = stopWithin + HELD_APPROACH_SLACK_METRES;
  await page.eval(startWalk(`({ x: ${targetX}, z: ${targetZ} })`, holdWithin));
  await forwardKey(page, 'keyDown');
  let walk;
  try {
    walk = await pollUntilDeadline(() => page.eval(READ_WALK).then(JSON.parse),
      (next) => next?.arrived, { intervalMs: 100, timeoutMs: maxMillis });
  } finally {
    await forwardKey(page, 'keyUp');
    await page.eval(STOP_WALK);
  }
  // Printed whether or not the walk arrived, because the interesting number on a failure is how
  // many frames the page actually painted: a walk that never arrives after 400 frames is a broken
  // route, and one that never arrives after 9 is a runner that never got to move.
  const reached = walk.arrived
    ? `inside ${holdWithin}m at frame ${walk.arrivedFrame}`
    : `NEVER GOT WITHIN ${holdWithin}m, closest ${metresOrUnknown(walk.closestMetres)}`;
  console.log(`  walk: ${walk.frames} frames held, ${metresOrUnknown(walk.startMetres)} to `
    + `${metresOrUnknown(walk.metres)}, ${reached}`);
  // Let the release reach the page and the server agree the hero has stopped before the pulsed leg
  // starts measuring from him.
  await sleep(200);
  return pollUntil(page, (next) => next.serverPos !== null && next.serverSpeed === 0);
}

// HOLD, THEN PULSE, THEN LOOK -- AND GO ROUND AGAIN IF IT IS NOT THERE YET.
//
// One hold followed by one pulse is not enough. Any single slack I pick between them is a number
// picked against one machine, which is the mistake this whole family of bugs is made of; drive-
// village measured it hosted, where the held leg stopped 4.21m out and the single pulsed leg could
// not close the rest at the metre-a-second it manages there. Looping converges without a tuned
// number: the held leg covers whatever distance is left quickly, the pulsed leg places him exactly,
// and if the release carried him past the mark the next pass simply walks him back.
async function walkToward(page, targetX, targetZ, stopWithin, maxMillis) {
  const deadline = deadlineAfter(maxMillis);
  let last = await state(page);
  let passes = 0;
  const awayFrom = (at) => Math.hypot(targetX - at[0], targetZ - at[1]);
  while (Date.now() < deadline) {
    const away = Math.max(awayFrom(last.heroPos), awayFrom(last.serverPos ?? last.heroPos));
    if (away <= stopWithin) break;
    passes += 1;
    if (away > stopWithin + HELD_APPROACH_SLACK_METRES) {
      // eslint-disable-next-line no-await-in-loop
      last = await heldWalkToward(page, targetX, targetZ, stopWithin, deadline - Date.now());
    }
    // eslint-disable-next-line no-await-in-loop
    last = await pulseWalkToward(page, targetX, targetZ, stopWithin,
      Math.max(1500, (deadline - Date.now()) / 2));
  }
  // Captures downstream must not be taken mid-stride.
  await sleep(200);
  last = await pollUntil(page, (next) => next.serverPos !== null && next.serverSpeed === 0);
  console.log(`  approach: ${passes} pass(es), rendered `
    + `${metresOrUnknown(awayFrom(last.heroPos))} and server `
    + `${metresOrUnknown(awayFrom(last.serverPos ?? last.heroPos))} from the target`);
  return last;
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

  const approached = await walkToward(page, keeperX, keeperZ, 0.75, 20000);
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
    return JSON.stringify({ width: r.width, height: r.height, x: r.x, y: r.y });
  })()`).then(JSON.parse);
  check(`fresh guest: the speaker button meets the >=${TAP_TARGET_FLOOR_PX}px touch target`,
    speakerRect.width >= TAP_TARGET_FLOOR_PX && speakerRect.height >= TAP_TARGET_FLOOR_PX,
    JSON.stringify(speakerRect));

  // READ-ALOUD, PROVEN IN A BROWSER.
  //
  // keeperSpeech.js's unit tests prove the latch: nothing speaks before the button is tapped, and
  // every line after it does. They cannot prove main.js is WIRED to it, and that wiring is the
  // whole feature -- the quest, the count of marks left and where to go next reach a child who
  // cannot read through this route and no other. A module that works and a caller that never calls
  // it look identical from node, which is the same gap the body-height checks in play-fight exist
  // for.
  //
  // The sink is replaced, not the speaker: window.speechSynthesis.speak keeps being the thing
  // main.js calls, and the real utterance still goes through. Recording what passes through it is
  // the only way to hear a headless browser.
  await page.eval(`(() => {
    window.__gqSpoken = [];
    const real = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (utterance) => {
      window.__gqSpoken.push(utterance.text);
      return real(utterance);
    };
    return true;
  })()`);
  const spokenSoFar = () => page.eval('JSON.stringify(window.__gqSpoken)').then(JSON.parse);
  check('fresh guest: nothing has been read aloud before the child asks for it',
    (await spokenSoFar()).length === 0,
    JSON.stringify(await spokenSoFar()));

  // A real tap on the real button, at its real position.
  const speakAt = { x: speakerRect.x + speakerRect.width / 2, y: speakerRect.y + speakerRect.height / 2 };
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: speakAt.x, y: speakAt.y, id: 0 }] });
  await sleep(60);
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const afterTap = await pollUntilDeadline(spokenSoFar, (lines) => lines.length > 0,
    { intervalMs: 100, timeoutMs: 4000 });
  check('fresh guest: tapping the speaker reads the line the child is looking at',
    afterTap.length === 1 && afterTap[0] === KEEPER_LINE_QUEST,
    JSON.stringify(afterTap));

  // And the half that only exists because of the latch: walk out of the speech radius and back, so
  // the line goes away and returns, and it should read ITSELF this time with no second tap. Out and
  // back rather than a forced state change, because "the line changed" is exactly what main.js
  // watches for and a child gets there by walking.
  await walkToward(page, keeperX + KEEPER_GREET_REARM_RADIUS_METERS + 4, keeperZ, 1.5, 20000);
  await pollUntil(page, (s) => s.keeperLine.shown !== 'true');
  await walkToward(page, keeperX, keeperZ, 0.75, 20000);
  const returned = await pollUntil(page, (s) => s.keeperLine.shown === 'true');
  const afterReturn = await pollUntilDeadline(spokenSoFar, (lines) => lines.length > 1,
    { intervalMs: 100, timeoutMs: 6000 });
  check('fresh guest: after that one tap, a line that comes back reads itself with no second tap',
    afterReturn.length >= 2 && afterReturn[afterReturn.length - 1] === KEEPER_LINE_QUEST,
    `${afterReturn.length} utterance(s) ${JSON.stringify(afterReturn)}, `
      + `line on screen ${JSON.stringify(returned.keeperLine.text)}`);

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

  const approached = await walkToward(page, keeperX, keeperZ, 0.75, 20000);
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
