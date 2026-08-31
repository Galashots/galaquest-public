/**
 * ONE UNSCRIPTED PLAYTEST SESSION: the game on one end, an agent on the other, and nothing in
 * between that knows what is supposed to happen.
 *
 *   node tools/runtime-test/playtest-session.mjs
 *   node tools/runtime-test/playtest-session.mjs --minutes 20 --persona "seven-year-old, mashes buttons"
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * WHAT MAKES THIS DIFFERENT FROM EVERY OTHER FILE IN THIS DIRECTORY.
 *
 * The forty `drive-*.mjs` harnesses next door are scripted: they know the route, they know what the
 * Keeper says, and they assert that it happened. That is the right shape for regression evidence and
 * it is the wrong shape for a playtest, for a reason worth stating plainly -- a scripted harness can
 * only fail in ways someone already imagined. It cannot get lost, cannot misread a prompt, cannot
 * try the wrong thing twice and give up, and those are the three findings a playtest exists to
 * produce.
 *
 * So this file scripts nothing. It is a PROTOCOL, not a test:
 *
 *   - it boots the real game and installs the player-fair view (see player-view.mjs for why that
 *     projection, and what it deliberately refuses to hand over);
 *   - it prints one JSON view block to stdout;
 *   - it reads one JSON action line from stdin;
 *   - it performs the action, then repeats. Walk, attack and tap use ordinary input events; camera
 *     turn is explicitly a controlled playtest action, not a gesture-fidelity claim.
 *
 * WHO IS THE AGENT. Whoever is on the other end of the pipe. That is deliberate and it is the whole
 * reason this has no model client in it: this repository installs nothing from npm (README, "Zero
 * npm installs") and has no API credential, and hard-wiring one model would have made the harness
 * obsolete the moment a better one shipped. A session driven by hand through a terminal, by a
 * Claude Code session over Bash, or by a persona fleet script written later, are the same session.
 *
 * WHAT IT REFUSES TO DO. It does not accept anything. It produces a transcript. Per AGENTS.md the
 * running-game pixels are the final appearance authority and an agent may reject a result but never
 * visually accept one -- so the honest output of this file is a record of what an agent tried, what
 * it expected, and where it got stuck, for a person to read. Nothing here emits a verdict.
 *
 * THE TRANSCRIPT IS THE DELIVERABLE. `.local/runtime-test/playtest-<stamp>.jsonl`, gitignored,
 * one JSON object per line: the persona, every view, every action, every oracle event.
 */

import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from './owned-server.mjs';
import { installPlayerViewSource, READ_PLAYER_VIEW } from './player-view.mjs';

const CHROME_PORT = 9224;

/**
 * The floor on how fast a player can act, in milliseconds.
 *
 * WHY THIS NUMBER IS LOAD-BEARING AND NOT A TIDY DEFAULT. Human simple reaction time to a visual
 * cue sits around 250ms, and a child's is slower. An agent driving CDP can act again the instant
 * the previous call returns -- on a local desktop that is single-digit milliseconds, which is a
 * player with a fifty-fold reflex advantage. Such a player never gets bitten, and then reports the
 * wolf as harmless. That report is worse than no report, because it is confident and specific and
 * about a difficulty curve tuned for a seven-year-old.
 *
 * So the gap is enforced here rather than trusted to the agent's own restraint, and the transcript
 * records how long each action WAITED, so a reader can see the constraint was real.
 */
const MIN_ACTION_GAP_MS = 250;

/** How long an action may run before the session stops waiting on it. A walk of 30 seconds is not
 *  a player behaviour, it is an agent that has stopped paying attention. */
const MAX_ACTION_MS = 8000;

/** Consecutive actions with no change in the readable text or the visible entities before the
 *  session flags a stall. TITAN (arXiv:2509.22170) triggers reflection on exactly this signal, and
 *  the number is small here because a session is minutes, not hours. */
const STALL_ACTIONS = 6;

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PERSONA = argValue('persona', 'a curious first-time player who has never seen this game');
const MINUTES = Number(argValue('minutes', '15'));
if (!Number.isFinite(MINUTES) || MINUTES <= 0) {
  throw new Error('--minutes must be a positive finite number');
}

const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const TRANSCRIPT = `${OUT}playtest-${STAMP}.jsonl`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Everything this session saw or did, appended as it happens so a killed run still leaves evidence
 *  rather than losing the whole transcript to the crash it was trying to record. */
function record(entry) {
  appendFileSync(TRANSCRIPT, `${JSON.stringify({ t: Date.now(), ...entry })}\n`);
}

/** stdout is the protocol channel and must stay parseable, so everything human goes to stderr. */
const say = (line) => process.stderr.write(`${line}\n`);
const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

const server = await startOwnedServer();
const deadline = Date.now() + MINUTES * 60_000;
let browser = null;
let page = null;
let targetId = null;
let rl = null;
let step = 0;
let cleanupPromise = null;
let sessionEnded = false;
const consoleErrors = [];

function endSession(reason, details = {}) {
  if (sessionEnded) return;
  sessionEnded = true;
  record({ kind: 'session-end', reason, steps: step, consoleErrors: consoleErrors.length, ...details });
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    rl?.close();
    // readline.close() removes its listeners but does not close a piped stdin handle. A silent agent
    // therefore used to leave this process alive even after the deadline won the read race.
    process.stdin.destroy();
    const closer = page ?? browser;
    if (closer && targetId) await closer.send('Target.closeTarget', { targetId }).catch(() => {});
    page?.ws.close();
    browser?.ws.close();
    const killed = await server.kill();
    if (!killed) throw new Error(`could not confirm cleanup of owned server on ${server.port}`);
  })();
  return cleanupPromise;
}

const interrupt = (signal) => {
  endSession('interrupted', { signal });
  cleanup()
    .then(() => { process.exit(128 + (signal === 'SIGINT' ? 2 : 15)); })
    .catch((error) => { say(`cleanup failed after ${signal}: ${error.message}`); process.exit(1); });
};
const onSigint = () => interrupt('SIGINT');
const onSigterm = () => interrupt('SIGTERM');
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

try {
const ORIGIN_UNDER_TEST = server.origin;

// Cribbed from drive-village.mjs's CDP-over-websocket wrapper (no Puppeteer, no npm), unchanged
// except for the parts this file does not use.
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

const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`)
  .then((r) => r.json())
  .catch(() => {
    throw new Error(
      `no automation Chrome on ${CHROME_PORT}. Start Chrome with a dedicated profile and `
      + '--remote-debugging-port=9224 (README, "Browser harnesses").',
    );
  });
browser = new CDP(version.webSocketDebuggerUrl);
await browser.ready();
({ targetId } = await browser.send('Target.createTarget', { url: 'about:blank' }));
const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
page = new CDP(list.find((t) => t.id === targetId).webSocketDebuggerUrl);
await page.ready();
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Log.enable');

// The fresh-guest discipline the other harnesses established (docs/MISTAKES.md: the automation
// Chrome's profile is persistent, so gq-guest-id survives between runs and one session inherits the
// last one's Lantern Marks). A playtest of a FIRST-TIME player that starts with someone else's
// progress is not a playtest of a first-time player.
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });

/** ORACLE 1: crashes and page errors. Cheapest and highest-signal of the four TITAN oracles, and
 *  the only one that needs no interpretation at all. */
page.ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    const entry = msg.params.entry;
    const text = entry.url ? `${entry.text} [${entry.url}]` : entry.text;
    consoleErrors.push(text);
    record({ kind: 'oracle', oracle: 'console-error', text });
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const text = msg.params.exceptionDetails.text;
    consoleErrors.push(text);
    record({ kind: 'oracle', oracle: 'exception', text });
  }
});

const VIEWPORT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Page.navigate', { url: server.url });

let heroReady = false;
for (let i = 0; i < 60 && !heroReady; i += 1) {
  await sleep(500);
  heroReady = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
}
if (!heroReady) throw new Error(`runtime never came up on ${server.url}`);

/**
 * REFUSE TO PLAY IN A WORLD THAT HAS SOMEBODY ELSE IN IT.
 *
 * The same guard play-fight.mjs has, for a reason this session hit within its first hour. Killing a
 * previous session's node process does NOT close the Chrome tab it opened. The tab keeps trying to
 * reconnect, owned-server.mjs hands the next run a free port, and a freed port gets REUSED -- so two
 * abandoned tabs silently rejoined a brand-new session's server. Measured: `remoteCount: 2`, two
 * extra heroes standing in the village, one of them clearly visible in an anomaly capture.
 *
 * For a scripted harness that is a corrupted screenshot. For a playtest it is worse, because the
 * agent has no way to know: it sees people who are not part of the game's design, walks toward them,
 * and reports whatever confusion that produces as a finding about the village. Every conclusion
 * downstream of that is contaminated and nothing in the transcript says so.
 *
 * So this fails closed, loudly, before the first view -- and tells the operator the actual fix,
 * because "close your stale tabs" is not guessable from "remoteCount: 2".
 */
const remoteCount = await page.eval('window.__galaQuestRuntime.netState().remoteCount');
if (remoteCount > 0) {
  throw new Error(
    `${remoteCount} other client(s) are connected to this session's own server, so the world has `
    + 'extra heroes in it and nothing the agent reports about it would be trustworthy. These are '
    + 'almost always abandoned tabs from an earlier run reconnecting to a reused port: close every '
    + 'other GalaQuest tab in the automation Chrome on 9224 and run again.',
  );
}

// Read-aloud capture, wrapping rather than replacing speechSynthesis.speak so the page's own code
// path is unchanged (the pattern drive-village.mjs uses). A child who has tapped to be read to
// HEARS these lines, so they belong in a player-fair view.
await page.eval(`(() => {
  window.__gqSpoken = [];
  window.__gqSpokenSeen = 0;
  const synth = window.speechSynthesis;
  if (!synth || typeof synth.speak !== 'function') return 'absent';
  const original = synth.speak.bind(synth);
  synth.speak = (u) => { window.__gqSpoken.push(String(u && u.text)); return original(u); };
  return 'wrapped';
})()`);

await page.eval(installPlayerViewSource());

const look = () => page.eval(READ_PLAYER_VIEW).then(JSON.parse);

// ---------------------------------------------------------------------------------------------
// THE ACTIONS. Walk, attack and tap use real ordinary input events. `turn` is deliberately narrower:
// it is a controlled camera action through follow.orbit(), not a verified player drag. Its results
// cannot support a finding about camera-control discoverability or gesture fidelity.
// ---------------------------------------------------------------------------------------------

const key = (type, code, windowsVirtualKeyCode, keyName) => page.send('Input.dispatchKeyEvent', {
  type, code, key: keyName, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode,
});

const touch = (type, points) => page.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});

/**
 * Hold forward for a while, and report HOW MANY RENDERED FRAMES the hold actually spanned.
 *
 * The frame count is not decoration. in-page-driver.mjs's header records the measurement that makes
 * it necessary: main.js samples input only from the frame loop, so on a starved page a short press
 * between two frames transmits NOTHING, and the harness that sent it sees a hero who did not move
 * and concludes the game ignored him. An agent would conclude the same thing and file it as a bug.
 * Counting frames lets the session say "your input spanned no frame" instead, which is true.
 */
async function walk(ms) {
  const held = Math.min(Math.max(Number(ms) || 800, 100), MAX_ACTION_MS);
  await page.eval('window.__gqFrames = 0; (function c(){ window.__gqFrames++; window.__gqFrameRAF = requestAnimationFrame(c); })()');
  await key('keyDown', 'KeyW', 87, 'w');
  await sleep(held);
  await key('keyUp', 'KeyW', 87, 'w');
  const frames = await page.eval('cancelAnimationFrame(window.__gqFrameRAF), window.__gqFrames');
  return { heldMs: held, frames };
}

/**
 * Swing the camera as a controlled playtest action.
 *
 * `follow.orbit(yawDelta, pitchDelta)` is the control, and getting here took a wrong turn worth
 * recording. The first version assigned `follow.heading = follow.heading + delta`, which reads as
 * obviously correct and is a SILENT NO-OP: camera/follow.js publishes `heading` as a getter with no
 * setter, so in the non-strict context of a Runtime.evaluate the assignment is discarded without an
 * error. Measured over three actions in the first clean session -- every projected entity held its
 * screen position to the pixel across a 20-degree turn while `walk` plainly worked.
 *
 * That failure mode is the dangerous one for this whole tool. The agent is not told the harness
 * failed; it is shown a game whose camera does not respond, and the honest thing for it to do with
 * that is file a bug. So the turn now READS THE HEADING BACK and fails loudly when it did not move:
 * a broken control must never be presentable as a broken game.
 */
async function turn(degrees) {
  const delta = (Number(degrees) || 0) * (Math.PI / 180);
  const moved = await page.eval(`(() => {
    const f = window.__galaQuestRuntime.follow;
    const before = f.heading;
    f.orbit(${delta}, 0);
    return JSON.stringify({ before, after: f.heading });
  })()`).then(JSON.parse);
  if (delta !== 0 && moved.before === moved.after) {
    throw new Error(`turn did not move the camera (heading stayed ${moved.after}) — the harness is broken, not the game`);
  }
  return { degrees: Number(degrees) || 0, headingBefore: moved.before, headingAfter: moved.after };
}

async function attack() {
  await key('keyDown', 'Space', 32, ' ');
  await sleep(60);
  await key('keyUp', 'Space', 32, ' ');
  return {};
}

async function tap(xPct, yPct) {
  const x = Math.round((Math.min(Math.max(Number(xPct), 0), 100) / 100) * VIEWPORT.width);
  const y = Math.round((Math.min(Math.max(Number(yPct), 0), 100) / 100) * VIEWPORT.height);
  await touch('touchStart', [{ x, y }]);
  await sleep(80);
  await touch('touchEnd', []);
  return { x, y };
}

async function screenshot(label) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  const name = `playtest-${STAMP}-${String(label || 'shot').replace(/[^a-z0-9-]/gi, '-')}.png`;
  writeFileSync(`${OUT}${name}`, Buffer.from(data, 'base64'));
  return { file: `${OUT}${name}` };
}

async function perform(command) {
  switch (command.action) {
    case 'walk': return walk(command.ms);
    case 'turn': return turn(command.degrees);
    case 'attack': return attack();
    case 'tap': return tap(command.xPct, command.yPct);
    case 'wait': return sleep(Math.min(Number(command.ms) || 500, MAX_ACTION_MS)).then(() => ({}));
    case 'screenshot': return screenshot(command.label);
    case 'note': return {};
    default: throw new Error(`unknown action: ${String(command.action)}`);
  }
}

const ACTIONS = 'walk{ms} | turn{degrees} | attack | tap{xPct,yPct} | wait{ms} | screenshot{label} | note | done';

// ---------------------------------------------------------------------------------------------
// THE SESSION LOOP.
// ---------------------------------------------------------------------------------------------

record({ kind: 'session-start', persona: PERSONA, minutes: MINUTES, url: server.url, viewport: VIEWPORT });
say(`transcript: ${TRANSCRIPT}`);
say(`persona:    ${PERSONA}`);
say(`actions:    ${ACTIONS}`);
say('Reply to each view with ONE JSON line. Include "expect" to say what you think will happen —');
say('that is what makes a confusion event detectable later. {"action":"done","why":"..."} ends it.');

rl = createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();

let previous = null;
let unchanged = 0;
let lastActionAt = 0;
async function nextLineBeforeDeadline() {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return { deadline: true };
  // A deadline timer is a resource too. Leaving the loser of this race alive made a successful
  // `done` (or closed stdin) keep Node running until the full requested session time elapsed.
  let cancelDeadline = () => {};
  const deadlineWait = new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ deadline: true }), remaining);
    cancelDeadline = () => {
      clearTimeout(timer);
      resolve({ cancelled: true });
    };
  });
  try {
    return await Promise.race([
      lines.next().then((next) => ({ next })),
      deadlineWait,
    ]);
  } finally {
    cancelDeadline();
  }
}

/** Two views are "the same" to a player if the same things are on screen and the same words are
 *  readable. Position is deliberately excluded: walking three metres down an empty road changes the
 *  coordinates and changes nothing a player would call progress, and counting that as progress is
 *  exactly how a stall detector misses a hero stuck against a wall. */
const digest = (view) => JSON.stringify([view.read, (view.see || []).map((s) => s.what).sort(), view.health]);

emit({ hello: 'galaquest-playtest', persona: PERSONA, actions: ACTIONS, viewport: VIEWPORT, transcript: TRANSCRIPT });

while (Date.now() < deadline) {
  const view = await look();
  step += 1;

  if (previous !== null && digest(view) === previous) {
    unchanged += 1;
    if (unchanged === STALL_ACTIONS) {
      // ORACLE 2: stuck. Not a bug on its own -- a player standing still is allowed -- but it is
      // the moment worth telling the agent about, because "I have tried six things and the screen
      // has not changed" is the sentence that precedes every real navigation finding.
      record({ kind: 'oracle', oracle: 'stall', afterActions: STALL_ACTIONS, step });
      view.stalled = `nothing on screen has changed for ${STALL_ACTIONS} actions`;
    }
  } else {
    unchanged = 0;
  }
  previous = digest(view);

  record({ kind: 'view', step, view });
  emit({ step, timeLeftMs: deadline - Date.now(), ...view });

  const pending = await nextLineBeforeDeadline();
  if (pending.deadline) {
    endSession('time');
    break;
  }
  const { next } = pending;
  if (next.done) break;
  const raw = String(next.value || '').trim();
  if (!raw) continue;

  let command;
  try {
    command = JSON.parse(raw);
  } catch {
    emit({ step, error: `not JSON: ${raw.slice(0, 120)}`, actions: ACTIONS });
    continue;
  }

  if (command.action === 'done') {
    endSession('agent-done', { why: command.why ?? null });
    break;
  }

  // The human input budget, enforced rather than requested. See MIN_ACTION_GAP_MS.
  const since = Date.now() - lastActionAt;
  const waited = since < MIN_ACTION_GAP_MS ? MIN_ACTION_GAP_MS - since : 0;
  if (waited > 0) await sleep(waited);

  const began = Date.now();
  let result;
  let failure = null;
  try {
    result = await perform(command);
  } catch (error) {
    failure = String(error && error.message ? error.message : error);
    result = {};
  }
  lastActionAt = Date.now();

  // ORACLE 3: an action that took far longer than its own kind usually does. TITAN's execution-time
  // monitor, at the only resolution this session can honestly claim -- it compares an action against
  // the time it was asked to take, not against a baseline nobody has measured yet.
  const elapsed = lastActionAt - began;
  const budget = (command.ms ? Number(command.ms) : 0) + 1500;
  if (elapsed > budget) {
    record({ kind: 'oracle', oracle: 'slow-action', action: command.action, elapsed, budget, step });
  }

  record({
    kind: 'action', step, command, result, failure, elapsedMs: elapsed, heldBackMs: waited,
    expect: command.expect ?? null, note: command.note ?? null,
  });

  if (failure) emit({ step, error: failure, actions: ACTIONS });
  if (result && result.frames !== undefined && result.frames < 2) {
    // The measured failure in-page-driver.mjs exists to prevent, surfaced to the agent as a fact
    // about the harness rather than left to be misread as a fact about the game.
    emit({ step, warning: `that input spanned ${result.frames} rendered frame(s) — the page may be too slow for a press that short` });
  }
}

endSession(Date.now() >= deadline ? 'time' : 'stream-closed');
say(`\nsession over after ${step} steps. console errors: ${consoleErrors.length}`);
say(`transcript: ${TRANSCRIPT}`);
} catch (error) {
  endSession('error', { error: String(error?.message ?? error) });
  throw error;
} finally {
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
  await cleanup();
}
