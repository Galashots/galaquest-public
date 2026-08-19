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
// Read the real throttle period rather than restating it. A diagnostic that hard-codes 66.67 would
// keep reporting confidently after somebody changed INPUT_SEND_HZ.
import { INPUT_SEND_HZ } from '../../public/src/net/protocol.js';

const SEND_INTERVAL_MS = 1000 / INPUT_SEND_HZ;
// How long to keep looking for the release after key-up before giving up. STALE_INPUT_MS is 1000 ms
// -- past that authority stops walking the hero on its own, so a release that has not been
// transmitted by then never mattered. 1200 ms observes the whole window and a little past it.
const RELEASE_WATCH_MS = 1200;

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
  // An open WebSocket is a live handle, and Node will not exit while one is held. Without this the
  // process printed its whole report, wrote the JSON, and then sat there forever -- which locally
  // just leaks a node.exe per run, but on a hosted runner means the step never returns, the job is
  // killed at its timeout, and the upload-artifact step that carries the evidence never runs.
  close() { try { this.ws.close(); } catch { /* already gone */ } }
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
  const probe = { intents: [], frames: [], installedAt: performance.now(), lastSendT: null };
  const realSetIntent = r.net.setIntent.bind(r.net);
  r.net.setIntent = (dirX, dirZ, magnitude, run) => {
    // setIntent RETURNS whether a message actually reached the wire, and it returns false in two very
    // different situations: offline (no socket), and throttled -- it rate-limits to INPUT_SEND_HZ, so
    // most per-frame calls with a thumb down are deliberately NOT sent. A release (magnitude 0 after
    // non-zero) bypasses the throttle on purpose. Counting CALLS therefore says nothing about what
    // authority received; only the return value does. "A non-zero intent was attempted" and "a
    // non-zero intent was transmitted" are different facts, and the gap between them is exactly where
    // cause C would hide.
    const t = performance.now();
    const sent = realSetIntent(dirX, dirZ, magnitude, run);
    probe.intents.push({ t, dirX, dirZ, magnitude, run: Boolean(run), sent: sent === true });
    // The throttle is phase-dependent, not a flat quota. setIntent's due test is
    // "now - lastSentAtMs >= INPUT_SEND_INTERVAL_MS", measured from the last ACTUAL send -- so a pulse
    // that begins already past due transmits on its very first sampled frame, and one that begins
    // mid-interval does not. Recording when the last send happened is the only way to tell which
    // case a given pulse was in, instead of assuming one.
    if (sent === true) probe.lastSendT = t;
    if (probe.intents.length > 4000) probe.intents.shift();
    return sent;
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
  const nonZeroSent = nonZero.filter((i) => i.sent);
  const zeroMag = intents.filter((i) => i.magnitude === 0);
  const deltas = frames.map((f) => +f.dt.toFixed(1));
  return JSON.stringify({
    renderedFrames: frames.length,
    frameDeltasMs: deltas,
    maxFrameDeltaMs: deltas.length ? Math.max(...deltas) : null,
    meanFrameDeltaMs: deltas.length ? +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1) : null,
    setIntentCalls: intents.length,
    // ATTEMPTED: setIntent was called with a non-zero magnitude this frame.
    nonZeroIntentsAttempted: nonZero.length,
    // TRANSMITTED: setIntent returned true, so a message actually went on the wire. The gap between
    // this and the line above is the INPUT_SEND_HZ throttle doing its job -- or, if it is zero while
    // attempts are non-zero, authority never heard the movement at all.
    nonZeroIntentsSent: nonZeroSent.length,
    // Zero-magnitude calls raised DURING the pulse. These are not the release -- they are frames on
    // which the key was not registered as down. setIntent refuses them outright (magnitude === 0
    // and not a release returns false), so they can never transmit; counting them separately keeps
    // them from inflating either of the numbers above.
    zeroMagnitudeAttemptsInPulse: zeroMag.length,
    maxMagnitude: nonZero.length ? +Math.max(...nonZero.map((i) => i.magnitude)).toFixed(3) : 0,
  });
})()`;

// The throttle phase at the moment the pulse begins. setIntent's `due` test measures from the last
// ACTUAL send, so an idle gap before key-down decides whether the very first sampled frame can
// transmit. Without this, a pulse that sent 3 and one that sent 4 look like a difference in the
// input path when they are only a difference in phase.
const PHASE_AT = `(() => {
  const p = window.__gqMoveProbe;
  return JSON.stringify({
    msSinceLastSend: p.lastSendT == null ? null : +(performance.now() - p.lastSendT).toFixed(1),
  });
})()`;

// The release is NOT measured on a fixed sleep. A fixed window answers "did a release appear in the
// next 120 ms", which conflates "never sent" with "sent later than I happened to look" -- and on a
// frame-starved runner, later is exactly what would happen. This polls until the release is
// observed or RELEASE_WATCH_MS expires, and reports how long it actually took plus how many frames
// rendered in the meantime, so a slow release is distinguishable from an absent one.
const releaseSince = (fromT) => `(() => {
  const p = window.__gqMoveProbe;
  const rel = p.intents.filter((i) => i.t > ${fromT} && i.magnitude === 0);
  const sent = rel.filter((i) => i.sent);
  return JSON.stringify({
    // A release bypasses the throttle by design, so unlike a movement intent this SHOULD transmit on
    // the first frame after key-up. Attempts without sends means the frame loop saw the key come up
    // and the message still did not go.
    releaseAttemptsAfterKeyUp: rel.length,
    releaseMessagesSent: sent.length,
    releaseLatencyMs: sent.length ? +(sent[0].t - ${fromT}).toFixed(1) : null,
    framesAfterKeyUp: p.frames.filter((f) => f.t > ${fromT}).length,
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
    const phase = JSON.parse(await page.eval(PHASE_AT));
    const downT = await page.eval('performance.now()');
    await key(page, 'keyDown');
    await sleep(requestedMs);
    await key(page, 'keyUp');
    const upT = await page.eval('performance.now()');

    const win = JSON.parse(await page.eval(windowSince(downT, upT)));

    // Bounded wait for the release, not a fixed sleep. Stops as soon as one is transmitted.
    let rel = JSON.parse(await page.eval(releaseSince(upT)));
    const watchStart = Date.now();
    while (rel.releaseMessagesSent === 0 && Date.now() - watchStart < RELEASE_WATCH_MS) {
      await sleep(40);
      rel = JSON.parse(await page.eval(releaseSince(upT)));
    }
    // Settle regardless, so the position read below is comparable across pulses whether the release
    // arrived on the first frame or not at all.
    if (Date.now() - watchStart < 120) await sleep(120 - (Date.now() - watchStart));
    const after = JSON.parse(await page.eval(READ));

    const record = {
      pulse,
      requestedMs,
      actualPulseMs: +(upT - downT).toFixed(1),
      authorityDistanceBefore: +authorityDistance.toFixed(3),
      msSinceLastSendAtPulseStart: phase.msSinceLastSend,
      // Whether the throttle was ALREADY due when the pulse began. This, not the pulse length alone,
      // decides whether the first sampled frame could transmit.
      throttleDueAtPulseStart: phase.msSinceLastSend == null ? null : phase.msSinceLastSend >= SEND_INTERVAL_MS,
      ...win,
      ...rel,
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
      + `  calls=${String(record.setIntentCalls).padStart(3)}`
      + `  nzAttempt=${String(record.nonZeroIntentsAttempted).padStart(3)}`
      + `  nzSENT=${String(record.nonZeroIntentsSent).padStart(3)}`
      + `  due0=${record.throttleDueAtPulseStart === null ? '?' : (record.throttleDueAtPulseStart ? 'Y' : 'n')}`
      + `  relAtt=${String(record.releaseAttemptsAfterKeyUp).padStart(2)}`
      + `  relSent=${String(record.releaseMessagesSent).padStart(2)}`
      + `  relMs=${String(record.releaseLatencyMs ?? '-').padStart(6)}`
      + `  heroMoved=${String(record.heroMoved).padStart(6)}m  serverMoved=${String(record.serverMoved ?? '-').padStart(6)}m`
      + `  drift=${record.drift == null ? '-' : record.drift.toFixed(3)} snapped=${record.snapped}`,
    );
  }

  const pulsesWithNoFrame = records.filter((r) => r.renderedFrames === 0).length;
  const pulsesWithNoNonZeroAttempt = records.filter((r) => r.nonZeroIntentsAttempted === 0).length;
  // The decisive one. A pulse can call setIntent with a non-zero magnitude and still transmit
  // nothing, because INPUT_SEND_HZ throttles it -- so "attempted" never proves authority heard.
  const pulsesWithNoNonZeroSend = records.filter((r) => r.nonZeroIntentsSent === 0).length;
  const pulsesAttemptedButNeverSent = records.filter(
    (r) => r.nonZeroIntentsAttempted > 0 && r.nonZeroIntentsSent === 0,
  ).length;
  // A release bypasses the throttle, so a pulse that rendered frames after keyUp and still sent no
  // release means authority kept walking the hero on the last non-zero intent (cause D territory).
  const pulsesWithNoReleaseSent = records.filter((r) => r.releaseMessagesSent === 0).length;
  const pulsesServerDidNotMove = records.filter((r) => (r.serverMoved ?? 0) < 0.05).length;
  const allDeltas = records.flatMap((r) => r.frameDeltasMs);
  const relLatencies = records.map((r) => r.releaseLatencyMs).filter((v) => v != null);
  const summary = {
    pulses: records.length,
    pulsesWithNoRenderedFrame: pulsesWithNoFrame,
    pulsesWithNoNonZeroAttempt,
    pulsesWithNoNonZeroSend,
    pulsesAttemptedButNeverSent,
    pulsesWithNoReleaseSent,
    pulsesServerDidNotMove,
    maxFrameDeltaMs: allDeltas.length ? Math.max(...allDeltas) : null,
    meanFrameDeltaMs: allDeltas.length ? +(allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length).toFixed(1) : null,
    framesOver250ms: allDeltas.filter((d) => d > 250).length,
    totalFramesSampled: allDeltas.length,
    totalZeroMagnitudeAttemptsInPulse: records.reduce((n, r) => n + r.zeroMagnitudeAttemptsInPulse, 0),
    totalNonZeroAttempted: records.reduce((n, r) => n + r.nonZeroIntentsAttempted, 0),
    totalNonZeroSent: records.reduce((n, r) => n + r.nonZeroIntentsSent, 0),
    totalReleaseAttempts: records.reduce((n, r) => n + r.releaseAttemptsAfterKeyUp, 0),
    totalReleaseSent: records.reduce((n, r) => n + r.releaseMessagesSent, 0),
    pulsesStartingThrottleDue: records.filter((r) => r.throttleDueAtPulseStart === true).length,
    maxReleaseLatencyMs: relLatencies.length ? Math.max(...relLatencies) : null,
    meanReleaseLatencyMs: relLatencies.length
      ? +(relLatencies.reduce((a, b) => a + b, 0) / relLatencies.length).toFixed(1) : null,
  };

  console.log('\n--- summary ---');
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
  console.log(
    '\nREAD THIS AS EVIDENCE, NOT A VERDICT:\n'
    + '  pulsesWithNoRenderedFrame > 0   => the whole pulse fell between two rendered frames; input was\n'
    + '                                     never sampled at all (cause C, upstream form).\n'
    + '  pulsesAttemptedButNeverSent > 0 => the frame loop DID see the input but the throttle swallowed\n'
    + '                                     every attempt, so authority heard nothing (cause C).\n'
    + '  framesOver250ms > 0             => raw deltas exceed prediction\'s 250 ms step cap (cause B).\n'
    + '  sends delivered AND server moved AND client/server still diverge => cause A.\n'
    + '  pulsesWithNoReleaseSent > 0     => keyUp raised no transmitted release, so authority held the\n'
    + '                                     last non-zero intent until STALE_INPUT_MS expired (cause D).\n'
    + '  sends delivered but authority stops moving => look at STALE_INPUT_MS (cause D).\n'
    + '\n  NOTE ON THE THROTTLE. totalNonZeroAttempted > totalNonZeroSent is NORMAL -- INPUT_SEND_HZ\n'
    + '  deliberately rate-limits. But the send count for a pulse is NOT floor(duration / interval).\n'
    + '  setIntent tests `now - lastSentAtMs >= INPUT_SEND_INTERVAL_MS` against the last ACTUAL send,\n'
    + '  and it is only ever evaluated on a rendered frame. So the count depends on (1) the PHASE at\n'
    + '  key-down -- throttleDueAtPulseStart -- since an already-due pulse transmits on its first\n'
    + '  sampled frame, and (2) quantization, because each send lands on a frame boundary and pushes\n'
    + '  the next due instant later. Two pulses of equal length can legitimately differ by one send.\n'
    + '  Compare against due0 in the table before reading anything into a count.\n'
    + '  Only a pulse with ZERO sends is evidence of anything.',
  );

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}movement-diagnosis.json`, JSON.stringify({ summary, records }, null, 2));
  console.log(`\nwrote ${OUT}movement-diagnosis.json`);
} finally {
  await browser.send('Target.closeTarget', { targetId }).catch(() => {});
  await server.kill();
  page.close();
  browser.close();
}
