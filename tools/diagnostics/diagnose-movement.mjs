// diagnose-movement.mjs â€” an ADDITIVE, NON-GATING diagnostic for the movement/engagement family.
//
// It is not in the full-playtest matrix and it asserts nothing about the product. Its only job is to
// answer one question with evidence instead of correlation:
//
//   When a harness commands a movement pulse, does a non-zero intent actually reach authority?
//
// Six harnesses fail on the hero not arriving, not engaging, or not landing a hit. Four causes were
// on the table (Sol's A/B/C/D). This instruments the one that discriminates them fastest.
//
// THE HYPOTHESIS UNDER TEST (cause C â€” harness input transport):
//   walkToward pulses W down, sleeps movementPulseMillis(distance) which is bounded to 70â€“260 ms,
//   then releases W before the next state read. main.js samples keyboard state and calls
//   net.setIntent() ONLY from the rendered frame loop (main.js:1124). So on a frame-starved browser
//   an entire key-down/key-up pulse can fall BETWEEN two rendered frames, and no non-zero intent is
//   ever transmitted for it. That predicts client AND server both stopping short and AGREEING â€”
//   which is what drive-relight's own failure dump showed (heroPos == serverPos, short of target).
//
// It also records what cause A and B would need: per-frame raw deltas, prediction backlog before and
// after, budget and delta actually spent, reconciliation drift and snap.
//
// NOTHING IN PRODUCTION IS MODIFIED. The probe wraps net.setIntent inside the page for the life of
// this run and counts its own rAF ticks. No tolerance, threshold, cap or gameplay value is touched.
//
// Usage:  node tools/runtime-test/diagnose-movement.mjs [--pulses 12]
// Output: a per-pulse table plus a machine-readable JSON blob, to stdout and .local/runtime-test/.
// WebSocket is the Node global (>=22), exactly as every other harness here uses it. This repo has
// zero npm dependencies and CI has no install step, so a bare 'undici' import would not resolve.
import { mkdirSync, writeFileSync } from 'node:fs';
import { startOwnedServer } from '../runtime-test/owned-server.mjs';
import { movementPulseMillis } from '../runtime-test/automation-timing.mjs';

const CHROME_PORT = 9224;
const OUT = '.local/runtime-test/';
const PULSES = Number(process.argv[process.argv.indexOf('--pulses') + 1]) || 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
  }
  ready() { return new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`eval threw: ${d.exception?.description ?? d.text}`);
    }
    return r.result.value;
  }
}

const key = (page, type) => page.send('Input.dispatchKeyEvent', {
  type, code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87,
});

// The probe. Additive: it wraps setIntent and starts its own rAF counter. Both are undone when the
// page navigates away, and neither changes what production does â€” the wrapper always delegates.
const INSTALL_PROBE = `(() => {
  const r = window.__galaQuestRuntime;
  if (!r || window.__gqMoveProbe) return Boolean(window.__gqMoveProbe);
  const probe = { intents: [], frames: [], installedAt: performance.now() };
  const realSetIntent = r.net.setIntent.bind(r.net);
  r.net.setIntent = (dirX, dirZ, magnitude, run) => {
    probe.intents.push({ t: performance.now(), dirX, dirZ, magnitude, run: Boolean(run) });
    if (probe.intents.length > 4000) probe.intents.shift();
    return realSetIntent(dirX, dirZ, magnitude, run);
  };
  let previous = performance.now();
  const tick = (now) => {
    probe.frames.push({ t: now, dt: now - previous });
    if (probe.frames.length > 4000) probe.frames.shift();
    previous = now;
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
  window.__gqMoveProbe = probe;
  return true;
})()`;

const READ = `(() => {
  const r = window.__galaQuestRuntime;
  const net = r.netState();
  const p = window.__gqMoveProbe;
  return JSON.stringify({
    now: performance.now(),
    heroPos: [+r.player.position.x.toFixed(3), +r.player.position.z.toFixed(3)],
    serverPos: net.serverSelf ? [+net.serverSelf.x.toFixed(3), +net.serverSelf.z.toFixed(3)] : null,
    drift: net.drift, snapped: net.snapped, snapshots: net.snapshots, status: net.status,
    frameCostMeanMs: r.diagnostics.read().meanMs,
    intentCount: p.intents.length, frameCount: p.frames.length,
  });
})()`;

const windowSince = (fromT, toT) => `(() => {
  const p = window.__gqMoveProbe;
  const frames = p.frames.filter((f) => f.t >= ${fromT} && f.t <= ${toT});
  const intents = p.intents.filter((i) => i.t >= ${fromT} && i.t <= ${toT});
  const nonZero = intents.filter((i) => i.magnitude > 0);
  const deltas = frames.map((f) => +f.dt.toFixed(1));
  return JSON.stringify({
    renderedFrames: frames.length,
    frameDeltasMs: deltas,
    maxFrameDeltaMs: deltas.length ? Math.max(...deltas) : null,
    meanFrameDeltaMs: deltas.length ? +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1) : null,
    setIntentCalls: intents.length,
    nonZeroIntents: nonZero.length,
    maxMagnitude: nonZero.length ? +Math.max(...nonZero.map((i) => i.magnitude)).toFixed(3) : 0,
  });
})()`;

const server = await startOwnedServer();
const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
const browser = new CDP(version.webSocketDebuggerUrl);
await browser.ready();
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
const wsUrl = version.webSocketDebuggerUrl.replace(/\/devtools\/browser\/.*/, `/devtools/page/${targetId}`);
const page = new CDP(wsUrl);
await page.ready();
void sessionId;

const records = [];
try {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
  // GQ-008: start from a known guest. A diagnostic is not exempt -- a run that inherits somebody
  // else's localStorage (marks, lantern unlock, workshop ownership) is not reproducible, and these
  // numbers are only worth anything if the next run starts from the same place.
  await page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'local_storage' });
  await page.send('Page.navigate', { url: server.url });

  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    await sleep(500);
    ready = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
  }
  if (!ready) throw new Error(`runtime never came up on ${server.url}`);
  await sleep(800);

  if (!await page.eval(INSTALL_PROBE)) throw new Error('probe failed to install');
  await sleep(400);

  // The Keeper's own spot, the same target drive-relight walks to.
  const TARGET = [-2.8, -5.8];
  const STOP_WITHIN = 1.6;

  for (let pulse = 1; pulse <= PULSES; pulse += 1) {
    const before = JSON.parse(await page.eval(READ));
    const authority = before.serverPos ?? before.heroPos;
    const authorityDistance = Math.hypot(TARGET[0] - authority[0], TARGET[1] - authority[1]);
    if (authorityDistance <= STOP_WITHIN) { console.log(`\nreached the target after ${pulse - 1} pulses`); break; }

    const heading = Math.atan2(TARGET[0] - authority[0], TARGET[1] - authority[1]);
    await page.eval(`window.__galaQuestRuntime.follow.setHeading(${heading})`);

    // Exactly drive-relight's own pulse shape and bounds.
    const requestedMs = movementPulseMillis(Math.max(0, authorityDistance - STOP_WITHIN), { maxMs: 260, msPerMeter: 65 });
    const downT = await page.eval('performance.now()');
    await key(page, 'keyDown');
    await sleep(requestedMs);
    await key(page, 'keyUp');
    const upT = await page.eval('performance.now()');

    const win = JSON.parse(await page.eval(windowSince(downT, upT)));
    await sleep(120);
    const after = JSON.parse(await page.eval(READ));

    const record = {
      pulse,
      requestedMs,
      actualPulseMs: +(upT - downT).toFixed(1),
      authorityDistanceBefore: +authorityDistance.toFixed(3),
      ...win,
      heroBefore: before.heroPos, heroAfter: after.heroPos,
      serverBefore: before.serverPos, serverAfter: after.serverPos,
      heroMoved: +Math.hypot(after.heroPos[0] - before.heroPos[0], after.heroPos[1] - before.heroPos[1]).toFixed(3),
      serverMoved: before.serverPos && after.serverPos
        ? +Math.hypot(after.serverPos[0] - before.serverPos[0], after.serverPos[1] - before.serverPos[1]).toFixed(3) : null,
      drift: after.drift, snapped: after.snapped,
      frameCostMeanMs: +after.frameCostMeanMs.toFixed(1),
    };
    records.push(record);

    console.log(
      `pulse ${String(pulse).padStart(2)}  req=${String(requestedMs).padStart(3)}ms actual=${String(record.actualPulseMs).padStart(6)}ms`
      + `  frames=${String(record.renderedFrames).padStart(3)}  maxDelta=${String(record.maxFrameDeltaMs ?? '-').padStart(6)}ms`
      + `  setIntent=${String(record.setIntentCalls).padStart(3)}  nonZero=${String(record.nonZeroIntents).padStart(3)}`
      + `  heroMoved=${String(record.heroMoved).padStart(6)}m  serverMoved=${String(record.serverMoved ?? '-').padStart(6)}m`
      + `  drift=${record.drift == null ? '-' : record.drift.toFixed(3)} snapped=${record.snapped}`,
    );
  }

  const pulsesWithNoFrame = records.filter((r) => r.renderedFrames === 0).length;
  const pulsesWithNoNonZeroIntent = records.filter((r) => r.nonZeroIntents === 0).length;
  const pulsesServerDidNotMove = records.filter((r) => (r.serverMoved ?? 0) < 0.05).length;
  const allDeltas = records.flatMap((r) => r.frameDeltasMs);
  const summary = {
    pulses: records.length,
    pulsesWithNoRenderedFrame: pulsesWithNoFrame,
    pulsesWithNoNonZeroIntent: pulsesWithNoNonZeroIntent,
    pulsesServerDidNotMove,
    maxFrameDeltaMs: allDeltas.length ? Math.max(...allDeltas) : null,
    meanFrameDeltaMs: allDeltas.length ? +(allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length).toFixed(1) : null,
    framesOver250ms: allDeltas.filter((d) => d > 250).length,
    totalFramesSampled: allDeltas.length,
  };

  console.log('\n--- summary ---');
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
  console.log(
    '\nREAD THIS AS EVIDENCE, NOT A VERDICT:\n'
    + '  pulsesWithNoNonZeroIntent > 0  => cause C is live: authority never received the commanded movement.\n'
    + '  framesOver250ms > 0            => raw deltas exceed prediction\'s 250 ms step cap (cause B territory).\n'
    + '  intents delivered AND server moved AND client/server still diverge => cause A.\n'
    + '  none of the above but movement stops => look at STALE_INPUT_MS (cause D).',
  );

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}movement-diagnosis.json`, JSON.stringify({ summary, records }, null, 2));
  console.log(`\nwrote ${OUT}movement-diagnosis.json`);
} finally {
  await browser.send('Target.closeTarget', { targetId }).catch(() => {});
  await server.kill();
}
