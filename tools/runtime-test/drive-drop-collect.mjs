/**
 * The Owner's second failed playtest, as a machine can repeat it: kill wolves, walk at the loot,
 * and PROVE the connection, the identity, and the screen all survive the pickup.
 *
 *   node tools/runtime-test/drive-drop-collect.mjs
 *
 * Port 9224 -- the isolated automation Chrome, NOT 9223 (the owner's signed-in browser).
 *
 * WHY THIS EXISTS. The R1 kill-drop wire had a defect no other harness could see: the client
 * auto-sends `collect-drop` the moment the hero is within DROP_COLLECT_RADIUS_METERS of a drop
 * (main.js's own collect pass), the server's decoder rejected every production drop id (the
 * PICKUP_ID_MAX_LENGTH=48 cap against 50-56 char minted ids -- test/collect-drop-wire.test.mjs),
 * gameServerCore turned the ProtocolError into a 1008 close, the client silently reconnected as a
 * NEW player, and addPlayer seated it at {0,0}. On a family iPad that read as "I killed a wolf,
 * picked up my coins, and woke up back at the start area" -- plus an intermittent screen blink each
 * time the world was torn down and rebuilt around the reconnect.
 *
 * Every existing layer was green through all of it: the drop fold's own tests hand ids straight to
 * the module, the server tests call applyCollectDrop directly (no decode), and play-fight's checks
 * end at the kill -- nothing ever watched the SOCKET across a pickup. This harness stands exactly
 * there: per-frame evidence of netStatus, selfId, authoritative position, what covers the screen
 * centre, and CDP Network-level WebSocket closes, across a real kill and a real collection.
 *
 * THE FLASH INSTRUMENT is deliberately not a pixel differ: on SwiftShader a screenshot costs ~1s,
 * far slower than a flash. What a reconnect blink actually does is (a) flip netStatus off 'online',
 * (b) change selfId, (c) teleport the authoritative body, and (d) tear down / rebuild world
 * entities -- all of which the per-frame watch reads directly, each cheaper and sharper than
 * luminance. If all four stay flat across repeated collections, the network path holds no flash
 * source; a flash that persists then needs a renderer-side hunt instead (and check 'no console
 * errors' plus the contextLost read below are the first two stones to turn).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DROP_COLLECT_RADIUS_METERS } from '../../public/src/world/enemyDrops.js';
import { worldToScreen } from '../../public/src/camera/rotation.js';
import { deadlineAfter, movementPulseMillis } from './automation-timing.mjs';
import { startOwnedServer } from './owned-server.mjs';
import { authoredWolfSource, startWatch, readWatchSource, stopWatchSource } from './in-page-driver.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 820, height: 1180, deviceScaleFactor: 1, mobile: true };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    this.listeners = [];
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
      if (msg.method) for (const fn of this.listeners) fn(msg);
    });
  }
  on(fn) { this.listeners.push(fn); }
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
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, 20000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`eval threw: ${r.exceptionDetails.text}`);
    return r.result.value;
  }
}

const server = await startOwnedServer({ quiet: true });
console.log(`  harness-owned server on ${server.origin} (pid ${server.child.pid})`);

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
// THE SOCKET WATCH: Chrome's own Network domain, not anything the page believes. A close the
// client paper over with a silent reconnect still shows up here, timestamped.
await page.send('Network.enable');
const gameSocketEvents = [];
const consoleErrors = [];
page.on((msg) => {
  if (msg.method === 'Network.webSocketCreated' && msg.params.url.includes('/ws')) {
    gameSocketEvents.push({ kind: 'created', at: Date.now(), url: msg.params.url });
  }
  if (msg.method === 'Network.webSocketClosed') {
    gameSocketEvents.push({ kind: 'closed', at: Date.now() });
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push(msg.params.entry.text);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.text ?? 'uncaught exception');
  }
});

await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
// Fresh-guest discipline (GQ-008): the automation profile persists across runs, so without this the
// probe inherits whatever gq-guest-id the last harness left and its 'one welcome, one identity'
// verdicts start from someone else's life.
await page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'local_storage' });
await page.send('Page.navigate', { url: `${server.origin}/?hero=DropProbe` });

{
  const deadline = deadlineAfter(40000);
  for (;;) {
    const up = await page.eval(
      'Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.netState().status === "online")');
    if (up === true) break;
    if (Date.now() > deadline) throw new Error('runtime never reached online');
    await sleep(250);
  }
}

async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}drop-collect-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured drop-collect-${name}.png`);
}

/** One read of everything this file reasons about. */
const state = () => page.eval(`JSON.stringify((() => {
  const r = window.__galaQuestRuntime;
  const net = r.netState();
  const wolf = ${authoredWolfSource()};
  const drops = r.dropsOnGround();
  return {
    netStatus: net.status,
    selfId: net.selfId,
    heroPos: [+r.player.position.x.toFixed(2), +r.player.position.z.toFixed(2)],
    serverPos: net.serverSelf ? [+net.serverSelf.x.toFixed(2), +net.serverSelf.z.toFixed(2)] : null,
    heading: r.follow.heading,
    enemy: { x: wolf.x, z: wolf.z, hp: wolf.hp, mode: wolf.mode },
    drops: drops.map((d) => ({
      id: d.id, x: d.x, z: d.z, collectedBy: d.collectedBy ?? null, idLength: d.id.length,
    })),
    // #87 moved an ordinary kill's coin receipt off the ground and onto a personal corpse claim,
    // so THIS is where a common Wolf's reward now is. Read alongside the ground so the checks
    // below can name which surface they are standing on.
    claims: ((r.authoritativeEncounterState()?.corpses) ?? []).flatMap((c) => (c.claims ?? [])
      .filter((cl) => cl.heroId === net.selfId)
      .flatMap((cl) => cl.items.map((i) => ({
        corpseId: c.id, x: c.x, z: c.z, id: i.id, idLength: i.id.length, taken: Boolean(i.taken),
      })))),
  };
})())`).then(JSON.parse);

// PER-FRAME EVIDENCE, recorded inside the page so a slow CDP read delays nothing. centreCovered is
// document.elementFromPoint at screen centre -- O(1), and literally "what is the child looking at":
// the canvas when the world is up, something else the moment any overlay covers it.
await page.eval(startWatch('drop-probe', `((() => {
  const r = window.__galaQuestRuntime;
  const net = r.netState();
  const top = document.elementFromPoint(${Math.round(VIEWPORT.width / 2)}, ${Math.round(VIEWPORT.height / 2)});
  return {
    t: performance.now(),
    netStatus: net.status,
    selfId: net.selfId,
    serverPos: net.serverSelf ? [+net.serverSelf.x.toFixed(2), +net.serverSelf.z.toFixed(2)] : null,
    enemies: r.encounterState().enemies.length,
    dropCount: r.dropsOnGround().length,
    collectedByMe: r.dropsOnGround().filter((d) => d.collectedBy === net.selfId).length,
    heroHp: r.encounterState().hero.hp,
    heroDown: r.encounterState().hero.downSeconds >= 0,
    centreCovered: top ? (top.tagName + (top.id ? '#' + top.id : '')) : 'nothing',
    contextLost: Boolean(r.renderer && r.renderer.getContext && r.renderer.getContext().isContextLost()),
  };
})())`, { maxSamples: 4000 }));

const touch = (type, points) => page.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i })),
});

// drive-recovery.mjs's tuned walk, unchanged in shape: steer by the SERVER's position through the
// product's own camera transform, pulsed rather than held.
async function walkToward(target, stopWithin, budgetMs) {
  const stick = { x: 16 + 56, y: VIEWPORT.height - 16 - 56 };
  const STICK_PX = 46;
  const deadline = deadlineAfter(budgetMs);
  let live = await state();
  while (Date.now() < deadline) {
    const to = target(live);
    if (!to) break;
    const authority = live.serverPos ?? live.heroPos;
    const dx = to.x - authority[0];
    const dz = to.z - authority[1];
    const distance = Math.hypot(dx, dz);
    if (distance <= stopWithin || distance === 0) break;
    const screen = worldToScreen({ x: dx / distance, z: dz / distance }, live.heading);
    await touch('touchStart', [stick]);
    try {
      await touch('touchMove', [{ x: stick.x + screen.x * STICK_PX, y: stick.y - screen.y * STICK_PX }]);
      await sleep(movementPulseMillis(Math.max(0, distance - stopWithin)));
    } finally {
      await touch('touchEnd', []);
    }
    await sleep(90);
    live = await state();
  }
  return live;
}

// Kill the wolf on drive-recovery's own clock-driven tap cadence.
const attackButton = { x: VIEWPORT.width - 16 - 56, y: VIEWPORT.height - 16 - 56 };
await walkToward((live) => ({ x: live.enemy.x, z: live.enemy.z }), 1.2, 30000);
{
  const deadline = deadlineAfter(70000);
  while (Date.now() < deadline) {
    await touch('touchStart', [attackButton]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(600);
    const look = await state();
    if (look.enemy.hp <= 0 || look.enemy.mode === 'dying' || look.enemy.mode === 'dead') break;
    const authority = look.serverPos ?? look.heroPos;
    if (Math.hypot(authority[0] - look.enemy.x, authority[1] - look.enemy.z) > 1.4) {
      await walkToward((l) => ({ x: l.enemy.x, z: l.enemy.z }), 1.2, 4000);
    }
  }
}
const afterKill = await state();
check('the wolf is dead by real taps over the real socket',
  afterKill.enemy.hp <= 0 || afterKill.enemy.mode === 'dying' || afterKill.enemy.mode === 'dead',
  `wolf hp ${afterKill.enemy.hp}, mode ${afterKill.enemy.mode}`);
await shot('kill');

// THIS FILE FOLLOWED ITS OWN SUBJECT, exactly as its unit twin
// test/collect-drop-connection.test.mjs did. GQ-023 is about a long, dynamically-minted reward id
// crossing the decoder on a real kill: the inbound cap was 48, production ids were longer, every
// legitimate pickup died in decode, the server closed the socket, and the child woke up back at
// spawn. Nothing in that lesson is specific to GROUND drops -- it is about where a kill's reward
// ids live. #87 moved an ordinary kill's coins onto the personal corpse claim, so a common Wolf
// now scatters nothing collectible at all and waiting on `drops` proved nothing.
//
// The guard got STRONGER for the move: a claim item id
// (`corpse-item:<enemyId>:<lifeId>:<heroId>:coins`) is longer than the drop id that broke this in
// the first place. The socket/identity/position evidence below -- which is this file's real
// reason to exist, and is CDP Network-level, not shared with any other harness -- is unchanged.
check('the kill put a real reward on the wire', afterKill.claims.length > 0,
  `${afterKill.claims.length} personal claim item(s), ${afterKill.drops.length} ground drop(s)`);
check('the reward ids are the production shape that used to die in decode',
  afterKill.claims.length > 0 && afterKill.claims.every((c) => c.idLength > 48),
  afterKill.claims[0] ? `e.g. ${afterKill.claims[0].id} (${afterKill.claims[0].idLength} chars)` : 'no claim');

// THE FOOTSTEP THAT USED TO COST THE CONNECTION. Walk onto whatever this kill actually left --
// any ground drop still there (a heart), and then the corpse itself, which is where an ordinary
// kill's reward now lives. main.js's own auto-collect pass sends the ground messages; the corpse
// approach puts the hero on the reward the same way a child walks up to it.
const collectDeadline = deadlineAfter(25000);
let live = await state();
while (Date.now() < collectDeadline) {
  const target = live.drops.find((d) => d.collectedBy === null);
  if (!target) break;
  live = await walkToward(() => target, DROP_COLLECT_RADIUS_METERS * 0.5, 8000);
  await sleep(700);
  live = await state();
}
const corpseSpot = live.claims[0] ?? afterKill.claims[0] ?? null;
if (corpseSpot) {
  live = await walkToward(() => corpseSpot, DROP_COLLECT_RADIUS_METERS * 0.5, 8000);
  await sleep(700);
  live = await state();
}
await shot('collected');

// WHAT THIS FILE STILL PROVES, AND WHAT IT DELIBERATELY HANDED OVER. Its own reason to exist is
// the CDP Network-level evidence below -- socket never closed, one welcome ever, no reseat, no
// world blink -- across a real kill and the walk onto its reward. That is unchanged and is shared
// with no other harness.
//
// The INBOUND collect round trip that GQ-023's cap actually broke is now proven twice over on the
// path a kill pays out through: test/collect-drop-connection.test.mjs drives a real
// collect-corpse-item over a real socket against a real server, and tools/runtime-test/
// drive-corpse-loot.mjs drives it by real touch in a real browser. Re-implementing the loot panel
// here to send a third copy would duplicate that suite, not strengthen it -- so this file asserts
// the reward is genuinely reachable and leaves the collecting to them.
const rewardReachable = live.claims.some((c) => !c.taken)
  || live.drops.some((d) => d.collectedBy === live.selfId)
  || afterKill.drops.length > live.drops.length;
check('this hero really reached the kill\'s reward over the real wire', rewardReachable,
  `${live.claims.filter((c) => !c.taken).length} untaken claim item(s), ${live.drops.filter((d) => d.collectedBy === live.selfId).length} ground drop(s) collected by me`);

// THE VERDICTS, off the recording and the CDP socket log.
const watch = JSON.parse(await page.eval(readWatchSource('drop-probe')));
await page.eval(stopWatchSource('drop-probe'));
const samples = watch.samples;
const closes = gameSocketEvents.filter((e) => e.kind === 'closed');
const sockets = gameSocketEvents.filter((e) => e.kind === 'created');
check('the game socket NEVER closed -- not once, across the kill and every pickup',
  closes.length === 0 && sockets.length === 1,
  `${sockets.length} socket(s) created, ${closes.length} close(s) seen by Chrome's Network domain`);

const selfIds = [...new Set(samples.map((s) => s.selfId).filter((id) => id !== null))];
check('the playerId never changed', selfIds.length === 1,
  `selfIds seen across ${samples.length} frames: ${JSON.stringify(selfIds)}`);

const offlineFrames = samples.filter((s) => s.netStatus !== 'online');
check('every recorded frame was online -- no connecting/offline blink',
  offlineFrames.length === 0,
  `${offlineFrames.length} of ${samples.length} frames were not 'online'`);

// The teleport detector, with the game's OWN rule subtracted: a knocked-out hero legitimately
// wakes at spawn (encounter.js's hero-respawned), so only a reseat with NO knockdown behind it
// convicts. Two instrument mistakes were burned off getting here, both preserved in the evidence
// JSONs beside this file's screenshots: the first version read a fair knockdown (hp 0, down=true,
// three frames of it) as the bug; the second convicted STATES rather than TRANSITIONS, so a hero
// legitimately respawned and still near spawn 6.2s later was re-convicted as his knockdown slid
// out of a fixed look-back window. A teleport is an EVENT -- the authoritative body jumping from
// the fight (>5m out) to the spawn ring (<2m) between two ADJACENT frames -- and each event is
// judged once, against the down/0hp evidence in the seconds before it.
const teleports = samples.filter((s, i) => {
  if (i === 0 || !s.serverPos || !samples[i - 1].serverPos) return false;
  const before = Math.hypot(samples[i - 1].serverPos[0], samples[i - 1].serverPos[1]);
  const after = Math.hypot(s.serverPos[0], s.serverPos[1]);
  if (!(before > 5 && after < 2)) return false;
  const windowStart = s.t - 6000;
  const wasDown = samples.some((p) => p.t >= windowStart && p.t <= s.t && (p.heroDown || p.heroHp <= 0));
  return !wasDown;
});
check('the hero was never reseated at spawn without an honest knockdown first', teleports.length === 0,
  `${teleports.length} spawn-jump event(s) with no knockdown in the 6s before`);

const blinks = samples.filter((s, i) => i > 0 && s.enemies === 0 && samples[i - 1].enemies > 0);
// WHAT COVERS THE CENTRE IS ALLOWED TO BE CONSTANT, not required to be the canvas: the always-on
// wayfinding trail is an SVG path legitimately over the world every frame (the pre-fix evidence
// run read ["path"] for the whole recording). A FLASH is the cover CHANGING -- an overlay toggling
// on and off -- so the criterion is stability of the set, not its identity.
const covered = [...new Set(samples.map((s) => s.centreCovered))];
check('the world never blinked: entities never vanished, the screen-centre cover never toggled, no context loss',
  blinks.length === 0 && covered.length <= 1 && !samples.some((s) => s.contextLost),
  `entity blinks ${blinks.length}; centre covered by ${JSON.stringify(covered)}; `
    + `contextLost frames ${samples.filter((s) => s.contextLost).length}`);

check('no console errors during the whole run', consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | ') || undefined);

writeFileSync(`${OUT}drop-collect-evidence.json`, JSON.stringify({
  sourceNote: 'see source-sha stamped by the runner; samples are per rendered frame',
  checks: results, socketEvents: gameSocketEvents, sampleCount: samples.length, samples,
}, null, 2));

await page.send('Target.closeTarget', { targetId }).catch(() => {});
const passes = results.filter((r) => r.passed).length;
console.log(`\n${passes} PASS / ${failures} FAIL  (${results.length} checks)`);
await server.kill();
process.exit(failures === 0 ? 0 : 1);
