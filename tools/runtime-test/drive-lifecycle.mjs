/**
 * The full runtime lifecycle, proven end to end against the real page, in one committed run:
 *
 *   node tools/runtime-test/drive-lifecycle.mjs
 *
 * boot -> village settles -> online -> a real user gesture unlocks audio -> movement -> the wolf is
 * engaged, killed, and genuinely respawns after the rules' own threshold -> the harness kills its OWN
 * server child -> the browser observes the online->offline handover -> the frame loop is still alive
 * -> movement and ATTACK still work offline -> no uncaught exception, no unexpected console error.
 *
 * Why this exists (docs/MISTAKES.md, "A proof that was not committed did not happen"): the 10s wolf
 * respawn and the online->offline handover fix both shipped with unit tests but no committed browser
 * proof -- the handover fix in particular was root-caused from a THROWAWAY probe, never committed, so
 * nobody could re-run it to check it still holds. This file is that missing, re-runnable proof for
 * both, plus the rest of the path around them.
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * Server ownership: this harness spawns its OWN `node server.mjs <port>` child on a port distinct
 * from the normal 5201 playtest service (the first free port in owned-server.mjs's candidate pool),
 * and terminates ONLY that child. It never touches whatever else may be listening -- measured during this task's
 * own investigation, a long-running dev server on 5201 turned out to belong to a DIFFERENT worktree
 * entirely (`.claude/worktrees/phase-d-pre-brief-57bf29`), which is exactly the failure mode "kill
 * whatever owns the port" would have walked into. Owning the server is also what makes the
 * online->offline handover provable at all: the harness needs to end the fight's authority on
 * command, not wait for an external process it does not control.
 *
 * Cribs play-fight.mjs/drive-marks.mjs's CDP-over-websocket harness, the fresh-guest
 * Storage.clearDataForOrigin discipline (drive-village.mjs/drive-marks.mjs), and GQ-001's polling
 * discipline throughout: every wait below polls live state or a bounded rAF/timeout race, never a
 * fixed sleep tuned to "usually enough".
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEATH_SECONDS,
  SWING_CONTACT_SECONDS,
  SWING_SECONDS,
  WOLF_MAX_HP,
  WOLF_RESPAWN_SECONDS,
  canAttack,
} from '../../public/src/combat/encounter.js';
import {
  deadlineAfter,
  movementPulseMillis,
  pollUntilDeadline,
} from './automation-timing.mjs';
import { startOwnedServer } from './owned-server.mjs';
import {
  readWatchSource, READ_WALK, startWalk, startWatch, STOP_WALK, stopWatchSource,
} from './in-page-driver.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
const VIEWPORT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
// Generous: WOLF_RESPAWN_SECONDS (10s) plus slack for the 20Hz server tick, the 10Hz snapshot cadence
// that carries wolf.mode to this client, and this harness's own poll interval -- not a guess, a
// bound around the imported constant (GQ-007: import the number, do not restate it).
const RESPAWN_POLL_TIMEOUT_MS = (WOLF_RESPAWN_SECONDS + 5) * 1000;
const RESPAWN_TOLERANCE_MS = 2500;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// ── spawn and own the runtime server child ──────────────────────────────────────────────────────
// Port probing, spawning, readiness polling and the teardown backstop all live in owned-server.mjs
// now (Phase H1) -- this file wrote that logic first, and nine more harnesses then needed it.
// startOwnedServer() THROWS on failure and cleans up after itself, but check 1 is one of this
// phase's numbered required properties, so the throw is caught and recorded as a failed check
// rather than allowed to kill the run silently.
let server = null;
let startError = null;
try {
  server = await startOwnedServer();
} catch (error) {
  startError = error;
}
check('1. the harness-owned server starts and serves the page',
  server !== null,
  server === null ? String(startError?.message ?? startError) : `port ${server.port}, pid ${server.child.pid}`);
if (server === null) {
  writeFileSync(`${OUT}lifecycle-results.json`,
    JSON.stringify({ results, startError: String(startError?.message ?? startError) }, null, 2));
  process.exit(1);
}

const PORT = server.port;
const ORIGIN_UNDER_TEST = server.origin;
const URL_UNDER_TEST = server.url;

// Terminates ONLY the child this harness spawned -- never anything else that might own a port.
// Idempotent: safe to call again in the finally block even if the deliberate mid-run kill (check 12)
// already ran. The latch is what check 12 asserts on.
let serverKillConfirmed = false;
async function killServerChild() {
  const ok = await server.kill();
  serverKillConfirmed = serverKillConfirmed || ok;
  return ok;
}

// ── CDP, cribbed verbatim from play-fight.mjs/drive-marks.mjs ─────────────────────────────────────
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

let page = null;
let targetId = null;
let exitCode = 1;

try {
  const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
  const browser = new CDP(version.webSocketDebuggerUrl);
  await browser.ready();

  // Same self-cleaning discipline drive-marks.mjs/drive-relight.mjs use: close any stale tab already
  // sitting on THIS harness's URL (a crashed previous run) before starting.
  const existing = await browser.send('Target.getTargets');
  for (const target of existing.targetInfos) {
    if (target.type === 'page' && target.url.startsWith(URL_UNDER_TEST)) {
      // eslint-disable-next-line no-await-in-loop
      await browser.send('Target.closeTarget', { targetId: target.targetId });
    }
  }

  const created = await browser.send('Target.createTarget', { url: 'about:blank' });
  targetId = created.targetId;
  const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
  page = new CDP(list.find((t) => t.id === targetId).webSocketDebuggerUrl);
  await page.ready();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Log.enable');

  // Fresh-guest discipline (same as R1-A's play-fight.mjs fix): a brand new server on a brand new
  // port still shares the automation Chrome's PERSISTENT profile, so without this a guestId minted
  // by an earlier harness run survives into this one.
  await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });

  const exceptions = [];
  const consoleErrors = [];
  page.ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const entry = msg.params.entry;
      consoleErrors.push({ text: entry.url ? `${entry.text} [${entry.url}]` : entry.text, atMs: Date.now() });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      exceptions.push({ text: msg.params.exceptionDetails.text, atMs: Date.now() });
    }
  });

  // lantern_belt.glb ships on its own orchestrator/Meshy track and degrades gracefully by design
  // (main.js's ensureLanternMounted) -- the same cosmetic allowance play-fight.mjs/drive-marks.mjs
  // already carry. The favicon is real now (Task F1), so no favicon entry here.
  const COSMETIC_404_PATTERNS = ['/assets/gear/lantern_belt.glb'];

  await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Page.navigate', { url: URL_UNDER_TEST });

  // ── 2. page boots ─────────────────────────────────────────────────────────────────────────────
  let heroReady = false;
  for (let i = 0; i < 60 && !heroReady; i += 1) {
    await sleep(500);
    // eslint-disable-next-line no-await-in-loop
    heroReady = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
  }
  check('2. the page boots and the hero loads', heroReady);
  if (!heroReady) throw new Error(`runtime never came up on port ${PORT}`);

  let wolfUp = false;
  for (let i = 0; i < 30 && !wolfUp; i += 1) {
    await sleep(400);
    // eslint-disable-next-line no-await-in-loop
    wolfUp = await page.eval('Boolean(window.__galaQuestRuntime.wolf())');
  }
  check('the wolf loaded into the scene', wolfUp);

  // ── 3/4. village zone settles, zero asset failures ──────────────────────────────────────────────
  // Durable properties, not a hardcoded count (the task's own explicit rule): every requested GLB
  // has settled, and none of them failed. A future prop added or removed from village.js changes
  // `requested` and this check keeps passing without edit.
  let zone = await page.eval('window.__galaQuestRuntime.zoneDebug()');
  for (let i = 0; i < 120 && (zone.requested === 0 || zone.loaded + zone.failed < zone.requested); i += 1) {
    await sleep(250);
    // eslint-disable-next-line no-await-in-loop
    zone = await page.eval('window.__galaQuestRuntime.zoneDebug()');
  }
  check('3. the village zone settles (every requested GLB reached loaded or failed)',
    zone.requested > 0 && zone.loaded + zone.failed === zone.requested,
    `requested ${zone.requested}, loaded ${zone.loaded}, failed ${zone.failed}`);
  check('4. zero zone asset failures', zone.failed === 0, `failed ${zone.failed} of ${zone.requested}`);

  const perf = await page.eval('JSON.stringify(window.__galaQuestRuntime.diagnostics.read())').then(JSON.parse);
  console.log(`  PERF  draw calls ${perf.drawCalls}, frame cost ${perf.meanMs.toFixed(2)}ms mean of ${perf.frameBudgetMs}ms budget`);

  // ── 5. client reaches online/connected state ────────────────────────────────────────────────────
  let online = false;
  for (let i = 0; i < 30 && !online; i += 1) {
    await sleep(300);
    // eslint-disable-next-line no-await-in-loop
    online = await page.eval("window.__galaQuestRuntime.netState().status === 'online'");
  }
  check('5. the client reaches online/connected state', online,
    `status ${await page.eval('window.__galaQuestRuntime.netState().status')}`);

  const players = await page.eval(`(() => {
    const m = (document.querySelector('#runtime-status')?.textContent ?? '').match(/players\\s+(\\d+)/i);
    return m ? Number(m[1]) : 1;
  })()`);
  if (players !== 1) throw new Error(`${players} clients connected against this harness's own server -- unexpected`);

  const touch = (type, points) => page.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
  });

  // Published state -- online or offline, encounterState() is always a complete, readable view
  // (main.js's frame loop keeps it that way in both branches; that completeness is exactly what
  // this file's later offline checks depend on).
  const state = () => page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    const published = r.encounterState();
    const net = r.netState();
    return JSON.stringify({
      wolf: { ...published.wolf }, hero: { ...published.hero },
      heading: r.follow.heading,
      heroPos: [+r.player.position.x.toFixed(3), +r.player.position.z.toFixed(3)],
      serverPos: net.serverSelf ? [+net.serverSelf.x.toFixed(3), +net.serverSelf.z.toFixed(3)] : null,
      netStatus: net.status,
      audio: r.audioDebug(),
    });
  })()`).then(JSON.parse).then((published) => ({ ...published, canAttack: canAttack(published) }));

  async function pollUntil(predicate, { intervalMs = 100, timeoutMs = 5000 } = {}) {
    return pollUntilDeadline(state, predicate, { intervalMs, timeoutMs });
  }

  const attackX = VIEWPORT.width - 68;
  const attackY = VIEWPORT.height - 68;
  const stickX = VIEWPORT.width * 0.18;
  const stickY = VIEWPORT.height * 0.86;
  const STICK_PX = 56;

  async function tapAttack() {
    await touch('touchStart', [{ x: attackX, y: attackY }]);
    await sleep(60);
    await touch('touchEnd', []);
  }

  // Re-aims at the freshly polled target every loop tick (play-fight.mjs's own fix for the
  // stale-position steering GQ-001 names): the wolf is server-authoritative and keeps moving on its
  // own clock for as long as this loop runs.
  async function walkToward(aim, stopWithin, maxMillis, { faceTarget = false } = {}) {
    let last = await state();
    const deadline = deadlineAfter(maxMillis);
    let pulsed = false;
    while (Date.now() < deadline) {
      const target = aim(last);
      const authority = last.serverPos ?? last.heroPos;
      const dx = target.x - authority[0];
      const dz = target.z - authority[1];
      const distance = Math.hypot(dx, dz);
      const renderedDistance = Math.hypot(target.x - last.heroPos[0], target.z - last.heroPos[1]);
      if (distance <= stopWithin && renderedDistance <= stopWithin && (!faceTarget || pulsed)) break;
      if (distance === 0) break;
      const nx = dx / distance;
      const nz = dz / distance;
      // Steered RELATIVE TO THE LIVE CAMERA HEADING, not to a heading-0 assumption. The stick is
      // camera-relative (camera/rotation.js's screenToWorld), and this used to hardcode the identity
      // case -- correct only while the game happened to open at heading 0. The moment main.js aimed
      // the opening shot at the village, this harness steered the hero to the far corner of the map
      // and reported it as a movement failure. The rotation below reduces to exactly the old
      // `stickX - nx`, `stickY - nz` at heading 0.
      const cos = Math.cos(last.heading); const sin = Math.sin(last.heading);
      const sx = -cos * nx + sin * nz;
      const sy = sin * nx + cos * nz;

      // Do not hold movement while Runtime.evaluate is in flight. Hosted Chrome can take hundreds of
      // milliseconds to return a state sample under 3D load; the old continuous hold converted that
      // observation latency into extra movement and overshot targets by whole zones. A bounded pulse
      // sets heading, advances a known amount, releases, and only then pays the CDP read cost.
      // eslint-disable-next-line no-await-in-loop
      await touch('touchStart', [{ x: stickX, y: stickY }]);
      try {
        // eslint-disable-next-line no-await-in-loop
        await touch('touchMove', [{ x: stickX + sx * STICK_PX, y: stickY - sy * STICK_PX }]);
        // eslint-disable-next-line no-await-in-loop
        await sleep(movementPulseMillis(Math.max(0, distance - stopWithin)));
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await touch('touchEnd', []);
      }
      pulsed = true;
      // Give the key-up/input release one frame plus a server tick before observing the result.
      // eslint-disable-next-line no-await-in-loop
      await sleep(80);
      // eslint-disable-next-line no-await-in-loop
      last = await state();
    }
    return last;
  }

  // ── 6/7. a real synthetic user gesture unlocks audio ────────────────────────────────────────────
  // The wolf starts 8+m away against a 1.7m reach, so these ATTACK taps are guaranteed misses --
  // harmless, and exactly the gesture main.js's own `pointerdown` listener is built to catch (ruling
  // 4: the FIRST pointerdown anywhere, not only a tap that lands). Bracketed with a before/after
  // read, which is what makes this a proof of CAUSATION rather than a coincidence: the context must
  // be unstarted beforehand and running only after real dispatched touches, never by calling
  // audio.unlock() from page JS directly (the task's own explicit rule -- that would prove nothing
  // about the browser's gesture policy).
  //
  // MEASURED, not assumed: a single dispatched tap reliably leaves Chrome's AudioContext in
  // 'suspended' -- a direct probe (2026-08-14, throwaway, not committed) found tap #1 always stuck
  // suspended and tap #2 always flipped to running, both real gestures with confirmed
  // navigator.userActivation.isActive true throughout. That is not a harness bug to paper over with
  // a longer timeout on one tap; main.js's own comment on tryUnlockAudio names this exact behaviour
  // ("A single gesture is not guaranteed to leave the context running ... this keeps listening and
  // retrying on every subsequent gesture") and is why the game re-attaches its unlock listener after
  // every tap until it sees 'running'. So this check dispatches repeated real gestures, the same way
  // a child's first few taps would, and polls after each -- proving the RETRY design works end to
  // end, not just a best-case single call.
  const beforeGesture = await state();
  check('6. audio starts unstarted, so the next check proves the gesture(s) caused the unlock',
    beforeGesture.audio.contextState !== 'running', `contextState ${beforeGesture.audio.contextState}`);
  let afterGesture = beforeGesture;
  for (let attempt = 0; attempt < 5 && afterGesture.audio.contextState !== 'running'; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    await tapAttack();
    // eslint-disable-next-line no-await-in-loop
    afterGesture = await pollUntil((s) => s.audio.contextState === 'running', { timeoutMs: 800 });
  }
  check('7. a real synthetic user gesture unlocks audio: audioDebug().contextState === "running"',
    afterGesture.audio.contextState === 'running', `contextState ${afterGesture.audio.contextState}`);

  // ── 8/9. movement changes world position; the hero engages the real wolf ───────────────────────
  const beforeWalk = await state();
  const closed = await walkToward((live) => ({ x: live.wolf.x, z: live.wolf.z }), 1.2, 14000);
  const moved = Math.hypot(closed.heroPos[0] - beforeWalk.heroPos[0], closed.heroPos[1] - beforeWalk.heroPos[1]);
  check('8. hero movement changes world position (measured, not a status string)',
    moved > 1.0, `moved ${moved.toFixed(3)}m: ${JSON.stringify(beforeWalk.heroPos)} -> ${JSON.stringify(closed.heroPos)}`);
  check('9. the hero engages the real wolf',
    closed.wolf.mode !== 'idle' || closed.wolf.hp < WOLF_MAX_HP,
    `mode ${closed.wolf.mode}, hp ${closed.wolf.hp}/${WOLF_MAX_HP}, gap ${Math.hypot(closed.heroPos[0] - closed.wolf.x, closed.heroPos[1] - closed.wolf.z).toFixed(2)}m`);

  // ── 10. the wolf can be killed ───────────────────────────────────────────────────────────────────
  //
  // Swung on the rules' own clock, with the fight recorded per frame -- the same shape play-fight
  // and drive-marks now use, and for the same reasons, which their headers carry in full. In short:
  // this loop polled live state twice a swing, once for canAttack and once on a 916ms budget for a
  // reaction that lasts WOLF_HIT_FLASH_SECONDS (0.18s), and on a runner painting at ~367ms a frame
  // that is looking less often than the thing it looks for lasts. The swings came out slower than
  // SWING_SECONDS allows, and since Design ruling 5 heals the wolf to full on every knockdown, a
  // hero landing fewer than three hits between knockdowns can never finish it. The re-close stays,
  // because the wolf backs off after a bite and the hero only turns while walking, but it is a held
  // walk on the wolf's live position and its cost comes out of the wait before the next tap rather
  // than being added to it.
  const WOLF_TARGET = '(() => { const w = window.__galaQuestRuntime.encounterState().wolf; return { x: w.x, z: w.z }; })()';
  await page.eval(startWatch('lifecycle-fight', `({
    mode: window.__galaQuestRuntime.encounterState().wolf.mode,
    hp: window.__galaQuestRuntime.encounterState().wolf.hp,
  })`));
  const readFight = () => page.eval(readWatchSource('lifecycle-fight')).then(JSON.parse);
  // A second of recording, so the frame count is the frame rate.
  await sleep(1000);
  const paced = await readFight();
  const framePeriodMs = paced.frames > 0 ? Math.round(1000 / paced.frames) : 17;
  const tapEveryMs = Math.round(SWING_SECONDS * 1000 + framePeriodMs);

  async function closeOnWolf(stopWithin, maxMillis) {
    await page.eval(startWalk(WOLF_TARGET, stopWithin));
    await touch('touchStart', [{ x: stickX, y: stickY }]);
    await touch('touchMove', [{ x: stickX, y: stickY - STICK_PX }]);
    try {
      await pollUntilDeadline(() => page.eval(READ_WALK).then(JSON.parse),
        (next) => next?.arrived, { intervalMs: 100, timeoutMs: maxMillis });
    } finally {
      await touch('touchEnd', []);
      await page.eval(STOP_WALK);
    }
  }

  let killed = false;
  for (let swing = 0; swing < 40 && !killed; swing += 1) {
    const cycleStart = Date.now();
    // eslint-disable-next-line no-await-in-loop
    await closeOnWolf(1.0, 4000);
    // eslint-disable-next-line no-await-in-loop
    await tapAttack();
    // eslint-disable-next-line no-await-in-loop
    await sleep(Math.max(0, tapEveryMs - (Date.now() - cycleStart)));
    // eslint-disable-next-line no-await-in-loop
    const log = await readFight();
    killed = log.samples.some((sample) => sample.mode === 'dying' || sample.mode === 'dead');
  }
  await page.eval(stopWatchSource('lifecycle-fight'));
  check('10. the wolf can actually be killed', killed);

  // ── 11. the wolf really respawns after the rules' own threshold ────────────────────────────────
  // Waits for the TRUE 'dead' mode (not 'dying', which lasts DEATH_SECONDS on its own) before
  // starting the stopwatch -- modeSeconds resets to 0 exactly on entry to 'dead' (encounter.js), so
  // that transition is the real zero point the respawn timer measures from.
  const dead = await pollUntil((s) => s.wolf.mode === 'dead', { timeoutMs: (DEATH_SECONDS + 2) * 1000 });
  check('the wolf reaches true "dead" mode before the respawn stopwatch starts',
    dead.wolf.mode === 'dead', `mode ${dead.wolf.mode}`);
  const deadAt = Date.now();
  const respawned = await pollUntil(
    (s) => s.wolf.mode === 'idle' && s.wolf.hp === WOLF_MAX_HP,
    { intervalMs: 200, timeoutMs: RESPAWN_POLL_TIMEOUT_MS },
  );
  const respawnElapsedMs = Date.now() - deadAt;
  const respawnedInWindow = respawned.wolf.mode === 'idle' && respawned.wolf.hp === WOLF_MAX_HP
    && respawnElapsedMs >= (WOLF_RESPAWN_SECONDS * 1000) - RESPAWN_TOLERANCE_MS
    && respawnElapsedMs <= (WOLF_RESPAWN_SECONDS * 1000) + RESPAWN_POLL_TIMEOUT_MS;
  check('11. the wolf really respawns after WOLF_RESPAWN_SECONDS (imported from encounter.js, not hand-copied)',
    respawnedInWindow,
    `respawned after ${(respawnElapsedMs / 1000).toFixed(2)}s against a ${WOLF_RESPAWN_SECONDS}s rule, `
    + `mode ${respawned.wolf.mode}, hp ${respawned.wolf.hp}/${WOLF_MAX_HP}`);

  // ── 12. the harness terminates ONLY its own server child ────────────────────────────────────────
  // This is also the trigger for the online->offline handover checks 13-16: the socket has nowhere
  // to reconnect to once this process is gone, so the game is forced to run its offline branch for
  // real, not simulated by any flag this harness sets.
  const killedOwnChild = await killServerChild();
  check('12. the harness terminates only its own server child (never an unknown port owner)',
    killedOwnChild && serverKillConfirmed,
    `pid ${server.child.pid}, exitCode ${server.child.exitCode}, signal ${server.child.signalCode}`);
  const killMarkerErrorCount = consoleErrors.length;
  const killMarkerExceptionCount = exceptions.length;

  // ── 13. the browser observes the network transition away from online ──────────────────────────
  const wentOffline = await pollUntil((s) => s.netStatus !== 'online', { timeoutMs: 6000 });
  check('13. the browser observes the network transition away from online',
    wentOffline.netStatus !== 'online', `netStatus ${wentOffline.netStatus}`);

  // ── 14. requestAnimationFrame / frame progression remains alive after handover ─────────────────
  // A page-side Promise completed by TWO further rAF callbacks (not just one -- the first can fire
  // suspiciously fast off a stale timestamp), raced against a bounded timeout. No new runtime debug
  // API: this is exactly what the task allows as the acceptable seam.
  const frameAlive = await page.eval(`new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame((t) => resolve({ alive: true, t }));
    });
    setTimeout(() => resolve({ alive: false, t: null }), 3000);
  })`);
  check('14. requestAnimationFrame / frame progression remains alive after the handover',
    frameAlive.alive === true, JSON.stringify(frameAlive));

  // ── 15. movement still changes hero position offline ───────────────────────────────────────────
  const beforeOfflineWalk = await state();
  await touch('touchStart', [{ x: stickX, y: stickY }]);
  await touch('touchMove', [{ x: stickX, y: stickY - STICK_PX }]); // straight "up" on the stick
  await sleep(600);
  await touch('touchEnd', []);
  const afterOfflineWalk = await state();
  const offlineMoved = Math.hypot(
    afterOfflineWalk.heroPos[0] - beforeOfflineWalk.heroPos[0],
    afterOfflineWalk.heroPos[1] - beforeOfflineWalk.heroPos[1],
  );
  check('15. movement still changes hero position offline (measured, not a status string)',
    offlineMoved > 0.05,
    `moved ${offlineMoved.toFixed(3)}m: ${JSON.stringify(beforeOfflineWalk.heroPos)} -> ${JSON.stringify(afterOfflineWalk.heroPos)}`);

  // ── 16. ATTACK still starts a valid offline swing ──────────────────────────────────────────────
  const readyOffline = await pollUntil((s) => s.canAttack, { timeoutMs: 4000 });
  check('ready to swing offline before tapping (canAttack true)', readyOffline.canAttack,
    `hero ${JSON.stringify(readyOffline.hero)}`);
  await tapAttack();
  const swinging = await pollUntil((s) => s.hero.swingSeconds >= 0, { timeoutMs: 1500 });
  check('16. ATTACK still starts a valid offline swing (published hero.swingSeconds, not button animation)',
    swinging.hero.swingSeconds >= 0, `swingSeconds ${swinging.hero.swingSeconds}`);

  // ── 17/18. no uncaught exception, no unexpected console error ──────────────────────────────────
  // Pre-handover must be perfectly clean. Post-handover allows exactly one known-benign noise class:
  // the client's own reconnect attempts (RECONNECT_DELAY_MS, net/client.js) failing forever against
  // a server this harness deliberately killed -- that is the intended shape of "offline is a
  // first-class state, not an error" (client.js's own header), not a defect to chase.
  const isCosmetic404 = (text) => COSMETIC_404_PATTERNS.some((pattern) => text.includes(pattern));
  const isExpectedReconnectNoise = (text) => /websocket|ws:\/\//i.test(text);

  const preKillErrors = consoleErrors.slice(0, killMarkerErrorCount).filter((e) => !isCosmetic404(e.text));
  const postKillErrors = consoleErrors.slice(killMarkerErrorCount)
    .filter((e) => !isCosmetic404(e.text) && !isExpectedReconnectNoise(e.text));
  const realErrors = [...preKillErrors, ...postKillErrors];
  check('18. no unexpected console error occurred (cosmetic 404s and post-handover reconnect noise excluded)',
    realErrors.length === 0, realErrors.slice(0, 5).map((e) => e.text).join(' | '));

  const preKillExceptions = exceptions.slice(0, killMarkerExceptionCount);
  const postKillExceptions = exceptions.slice(killMarkerExceptionCount);
  check('17. no uncaught browser exception occurred (before or after the handover)',
    preKillExceptions.length === 0 && postKillExceptions.length === 0,
    exceptions.slice(0, 5).map((e) => e.text).join(' | '));

  writeFileSync(`${OUT}lifecycle-results.json`, JSON.stringify({
    results, exceptions, consoleErrors, port: PORT,
    respawnElapsedMs, wolfRespawnSecondsRule: WOLF_RESPAWN_SECONDS,
  }, null, 2));
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  exitCode = failures === 0 ? 0 : 1;

  if (failures > 0) {
    // Captures are optional -- this phase's evidence is lifecycle state, not art direction (the
    // task's own wording) -- but a failing run gets one anyway, for diagnosis.
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}lifecycle-failure.png`, Buffer.from(data, 'base64'));
    console.log('  captured lifecycle-failure.png for diagnosis');
  }
} finally {
  if (page && targetId) {
    try { await page.send('Target.closeTarget', { targetId }); } catch { /* best-effort cleanup */ }
  }
  // Idempotent: a no-op if check 12 already confirmed the child gone. Guarantees this harness never
  // leaves its own server child running, even on an early throw.
  await killServerChild();
}

process.exit(exitCode);
