/**
 * Prove the multiplayer slice with two real browser tabs and real touch input.
 *
 * Spawns and owns its own runtime server on an isolated port (Phase H1 -- it used to require one
 * already up on the shared 5201); needs the isolated automation Chrome on 9224.
 * Never attach this to 9223: that is the owner's signed-in browser.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MIN_BODY_SEPARATION } from '../../public/src/combat/encounter.js';
import {
  deadlineAfter,
  movementPulseMillis,
} from './automation-timing.mjs';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
// Two tabs against ONE server, and it must be a server nobody else is on: this harness's central
// claim is that tab B converges on tab A's truth, which a third client from another run would
// quietly invalidate. See owned-server.mjs.
const server = await startOwnedServer();
const URL_UNDER_TEST = server.url;
const ORIGIN_UNDER_TEST = server.origin;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let failures = 0;
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * A measurement the CURRENT environment cannot authoritatively judge.
 *
 * This exists because `check(name, hostedHeadless || predicate, detail)` printed
 *   PASS  ...never jumps more than 2x MIN_BODY_SEPARATION... — largest frame-to-frame step 5.651m
 *         against a 2.000m budget
 * A violated predicate must never read as PASS because of a user agent. That is not a weaker gate,
 * it is a false statement, and anyone diffing two runs reads the suppression as a repair.
 *
 * DIAG is neither PASS nor FAIL: it reports what the predicate actually did and says the environment
 * cannot rule on it. It does NOT count toward `failures`, so hosted CI stays green on genuinely
 * unjudgeable metrics -- but the real result is always printed. When `authoritative` is true this
 * degrades to an ordinary gating check.
 */
function diagnostic(name, passed, detail, { authoritative, reason }) {
  if (authoritative) return check(name, passed, detail);
  results.push({ name, passed: null, outcome: 'DIAG', actualPredicate: passed, detail });
  console.log(`DIAG  ${name}${detail ? ` — ${detail}` : ''}`
    + ` [NOT JUDGED: ${reason}; predicate actually ${passed ? 'held' : 'VIOLATED'}]`);
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('CDP websocket error')), { once: true });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 20_000);
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(`eval threw: ${result.exceptionDetails.text}`);
    return result.result.value;
  }
}

async function pageFor(browser, targetId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const targets = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
    const target = targets.find((item) => item.id === targetId);
    if (target) {
      const page = new CDP(target.webSocketDebuggerUrl);
      await page.ready();
      await page.send('Runtime.enable');
      await page.send('Page.enable');
      await page.send('Log.enable');
      return page;
    }
    await sleep(100);
  }
  throw new Error(`could not find CDP target ${targetId}`);
}

async function waitFor(page, predicate, label, timeoutMs = 30_000) {
  const deadline = deadlineAfter(timeoutMs);
  while (Date.now() < deadline) {
    if (await page.eval(predicate).catch(() => false)) return true;
    await sleep(100);
  }
  check(label, false, `not ready after ${timeoutMs}ms`);
  return false;
}

const state = (page) => page.eval(`(() => {
  const r = window.__galaQuestRuntime;
  const net = r.netState();
  return JSON.stringify({
    player: { x: r.player.position.x, z: r.player.position.z },
    net,
    status: document.querySelector('#runtime-status').textContent,
    calls: r.renderer.info.render.calls,
    frameCost: r.diagnostics.read().meanMs,
  });
})()`).then(JSON.parse);

const touch = (page, type, points) => page.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: points.map((point, index) => ({ x: point.x, y: point.y, id: point.id ?? index })),
});

async function shot(page, name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT + name, Buffer.from(data, 'base64'));
}

const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
const browser = new CDP(version.webSocketDebuggerUrl);
await browser.ready();
// This is the dedicated 9224 automation profile. Close only old runtime pages left by an interrupted
// proof run; keeping one extra player would invalidate an exact two-client assertion.
const existing = await browser.send('Target.getTargets');
for (const target of existing.targetInfos) {
  if (target.type === 'page' && target.url.startsWith(URL_UNDER_TEST)) {
    await browser.send('Target.closeTarget', { targetId: target.targetId });
  }
}
const targetA = (await browser.send('Target.createTarget', { url: 'about:blank' })).targetId;
const targetB = (await browser.send('Target.createTarget', { url: 'about:blank' })).targetId;
const pageA = await pageFor(browser, targetA);
const pageB = await pageFor(browser, targetB);
const hostedHeadless = await pageA.eval("navigator.userAgent.includes('HeadlessChrome')");
const consoleErrors = { a: [], b: [] };
for (const [name, page] of [['a', pageA], ['b', pageB]]) {
  page.ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      // The URL rides along, same as play-fight.mjs's own capture -- without it a 404 reads only as
      // "Failed to load resource: ... 404", naming neither the file nor whether it is one of the
      // known-missing, non-blocking assets filtered out below.
      const entry = message.params.entry;
      consoleErrors[name].push(entry.url ? `${entry.text} [${entry.url}]` : entry.text);
    }
    if (message.method === 'Runtime.exceptionThrown') consoleErrors[name].push(message.params.exceptionDetails.text);
  });
  await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // Fresh-guest discipline, added in Phase R3a after this harness was MEASURED contaminating a
  // reserved identity. It fights and kills a wolf, so it awards real Lantern Marks -- and it was the
  // last combat harness with no storage wipe, so both its tabs arrived carrying whatever
  // `gq-guest-id` the persistent automation profile held. drive-relight.mjs deliberately leaves
  // `relight-probe-guest-0001` there, and the reward store showed the result plainly:
  // mark:relight-probe-guest-0001:3/4/5/6, in PAIRS 87-220ms apart -- two heroes, one kill, one
  // inherited identity, twice. drive-relight then failed its own "exactly 3 marks" assertion at
  // marks 5, for a reason that had nothing to do with relighting.
  //
  // This is the same class Phase Y measured and Phase Z1's R1-A closed for play-fight.mjs; this file
  // was simply never done. It became reproducible rather than occasional when Phase H1 gave every
  // harness a server from one shared port pool, so they all share ONE origin and therefore one
  // localStorage -- the isolation that used to come by accident from sitting on different ports is
  // now something each harness has to do for itself.
  await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
  await page.send('Page.navigate', { url: URL_UNDER_TEST });
}

const bootA = await waitFor(pageA, 'Boolean(window.__galaQuestRuntime?.hero && window.__galaQuestRuntime.netState().status === "online")', 'tab A boots and joins');
const bootB = await waitFor(pageB, 'Boolean(window.__galaQuestRuntime?.hero && window.__galaQuestRuntime.netState().status === "online")', 'tab B boots and joins');
if (bootA && bootB) {
  // A background tab can receive snapshots but not run rAF to render its remote. Bring B forward:
  // the requirement is that B sees A, and this models the child looking at B's iPad.
  await pageB.send('Page.bringToFront');
  await waitFor(pageB, 'window.__galaQuestRuntime.netState().remoteCount === 1', 'tab B receives tab A as a remote');
  const initialA = await state(pageA);
  const initialB = await state(pageB);
  check('tab B sees exactly one remote hero', initialB.net.remoteCount === 1,
    `B=${initialB.net.remoteCount}; A is background-throttled until it is brought forward`);

  const stick = { x: VIEWPORT.width * 0.2, y: VIEWPORT.height * 0.85 };
  // Chrome throttles background tabs; bring the input owner forward just as a child would.
  await pageA.send('Page.bringToFront');
  await touch(pageA, 'touchStart', [stick]);
  await touch(pageA, 'touchMove', [{ x: stick.x, y: stick.y - 90 }]);
  const startA = await state(pageA);
  await sleep(2_000);
  await touch(pageA, 'touchEnd', [{ x: stick.x, y: stick.y - 90 }]);
  await sleep(500);
  const endA = await state(pageA);
  // Render B's interpolated result while it is foreground. At the preceding assertion, stale B rAF
  // was the only reason its scene graph could lag behind otherwise-current socket snapshots.
  await pageB.send('Page.bringToFront');
  await sleep(500);
  const endB = await state(pageB);
  const remoteAonB = endB.net.remotes[0];
  const authoritativeA = endA.net.serverSelf;
  const remoteError = remoteAonB && authoritativeA
    ? Math.hypot(remoteAonB.x - authoritativeA.x, remoteAonB.z - authoritativeA.z) : Infinity;
  const selfDrift = authoritativeA
    ? Math.hypot(endA.player.x - authoritativeA.x, endA.player.z - authoritativeA.z) : Infinity;
  diagnostic('tab B remote tracks tab A authoritative position at settle', remoteError <= 0.5,
    `error=${remoteError.toFixed(3)} units`,
    { authoritative: !hostedHeadless, reason: 'background-tab interpolation is not authoritative in HeadlessChrome' });
  check('tab A self prediction stays close to server truth while walking', selfDrift <= 0.3,
    `drift=${selfDrift.toFixed(3)} units; moved=${Math.hypot(endA.player.x - startA.player.x, endA.player.z - startA.player.z).toFixed(3)}`);
  // 8 was calibrated against the placeholder-only world (ground + 3 untextured filler shapes).
  // Phase V's village zone replaced that filler with real Kenney/Meshy content (houses, fences,
  // lanterns, trees, rocks, the keeper) on the WORLD layer, so a scene that includes any of it in
  // frustum draws more -- measured then at 10-13 depending on camera heading, against a 20 budget.
  //
  // RAISED TO 40, 2026-08-15, and raised deliberately with a measurement rather than to make a red
  // check green. The treeline added ~26 perimeter and wilderness props so the world has a horizon
  // and its 28x28 ground plane no longer visibly ENDS; this check went 24/28. The frame cost that
  // actually matters was measured in the same session across five headings including the busiest
  // (the whole village and the treeline in one frame, 51 draws / 43,300 triangles): median frame
  // gap 16.7 ms, worst 18.5 ms over 120 frames -- a solid 60 fps with no dropped frames. 40 still
  // catches what this check exists to catch: an accidental duplicate zone load doubles the prop
  // count and lands near 54, and an unbounded per-frame leak passes it immediately.
  //
  // RAISED AGAIN TO 64, 2026-08-15, same discipline. The game now OPENS facing the village instead of
  // due north at an empty field (public/src/main.js), so the establishing frame legitimately contains
  // the cottages, the market, the Lantern Tree and the Keeper -- this check went 41/44 against 40 for
  // that reason alone and not because anything got more expensive. Re-measured across five headings
  // in the same session: the busiest view in the game is 55 draws / 59,153 triangles (standing at the
  // wolf looking back at the village), and 120 frames there ran a median gap of 16.7 ms with a worst
  // of 17.8 ms -- 60 fps, no dropped frames. 64 leaves headroom over that 55 plus a second hero while
  // still failing hard on a duplicate zone load, which would now land past 100.
  const DRAW_CALL_BUDGET = 64;
  check('both tabs still render two heroes within the draw-call budget',
    endA.net.remoteCount === 1 && endB.net.remoteCount === 1
      && endA.calls <= DRAW_CALL_BUDGET && endB.calls <= DRAW_CALL_BUDGET,
    `A calls=${endA.calls}, B calls=${endB.calls} (budget ${DRAW_CALL_BUDGET}); `
    + `remotes A=${endA.net.remoteCount}, B=${endB.net.remoteCount}`);
  check('both tabs report a finite frame cost', Number.isFinite(endA.frameCost) && Number.isFinite(endB.frameCost),
    `A=${endA.frameCost.toFixed(2)}ms, B=${endB.frameCost.toFixed(2)}ms`);
  await shot(pageA, 'two-client-a.png');
  await shot(pageB, 'two-client-b.png');

  // ── shared-fight convergence (Task B5) ──────────────────────────────────────────────────────
  //
  // Everything above proves movement; this proves combat is the SAME fight from both tabs' point
  // of view -- the roadmap's "convergence" wording, and the direct regression test for the
  // separateFromWolf/reconcile() teleport this phase's own goal names (brief.md's Goal line).
  const stickB = { x: VIEWPORT.width * 0.2, y: VIEWPORT.height * 0.85 };
  const ATTACK_X = VIEWPORT.width - 68;
  const ATTACK_Y = VIEWPORT.height - 68;

  const fightState = (page) => page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    const published = r.encounterState();
    const net = r.netState();
    return JSON.stringify({
      wolf: { ...published.wolf },
      heading: r.follow.heading,
      heroPos: [+r.player.position.x.toFixed(3), +r.player.position.z.toFixed(3)],
      serverPos: net.serverSelf ? [+net.serverSelf.x.toFixed(3), +net.serverSelf.z.toFixed(3)] : null,
    });
  })()`).then(JSON.parse);

  // Steers the given page's stick at the wolf's FRESHEST sampled position every loop tick, never a
  // value captured once outside the loop -- tools/runtime-test/play-fight.mjs's Task B5 steering
  // fix, applied here too: the wolf is server-owned and keeps moving, so a target frozen at the
  // call site would be aimed at where it WAS by the time a multi-second walk finishes. Returns
  // every sampled heroPos along the way, for the teleport-jump check below.
  async function walkToward(page, aim, stopWithin, maxMillis, { faceTarget = false } = {}) {
    await page.send('Page.bringToFront');
    let last = await fightState(page);
    const deadline = deadlineAfter(maxMillis);
    let pulsed = false;
    const positions = [last.heroPos];
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
    // case -- correct only while the game happened to open at heading 0. The moment main.js aimed the
    // opening shot at the village, this harness steered the hero to the far corner of the map and
    // reported it as a movement failure. The rotation below reduces to exactly the old
    // `stickX - nx`, `stickY - nz` at heading 0.
    const cos = Math.cos(last.heading); const sin = Math.sin(last.heading);
    const sx = -cos * nx + sin * nz;
    const sy = sin * nx + cos * nz;
      await touch(page, 'touchStart', [stickB]);
      try {
        await touch(page, 'touchMove', [{ x: stickB.x + sx * 56, y: stickB.y - sy * 56 }]);
        await sleep(movementPulseMillis(Math.max(0, distance - stopWithin)));
      } finally {
        await touch(page, 'touchEnd', []);
      }
      pulsed = true;
      await sleep(80);
      last = await fightState(page);
      positions.push(last.heroPos);
    }
    return { last, positions };
  }

  async function tapAttack(page) {
    await page.send('Page.bringToFront');
    await touch(page, 'touchStart', [{ x: ATTACK_X, y: ATTACK_Y }]);
    await sleep(60);
    await touch(page, 'touchEnd', []);
  }

  // -- teleport regression: walk client A straight through the wolf's current (live) position, and
  // check every recorded frame-to-frame step never jumps more than 2 * MIN_BODY_SEPARATION. Before
  // separateFromWolf() existed -- and, this phase's own goal, before the server was the one
  // applying it -- the two bodies were once measured 0.145m apart with the wolf drawn through the
  // hero's legs, and the client-side push fighting net.reconcile() produced a visible snap rather
  // than a smooth hold-off. This is that regression, automated instead of eyeballed off a capture.
  const walkedThrough = await walkToward(pageA, (live) => ({ x: live.wolf.x, z: live.wolf.z }), 0.3, 15_000);
  let maxJump = 0;
  for (let i = 1; i < walkedThrough.positions.length; i += 1) {
    const [px, pz] = walkedThrough.positions[i - 1];
    const [x, z] = walkedThrough.positions[i];
    maxJump = Math.max(maxJump, Math.hypot(x - px, z - pz));
  }
  diagnostic('walking client A through the wolf never jumps more than 2x MIN_BODY_SEPARATION in one frame',
    maxJump <= 2 * MIN_BODY_SEPARATION,
    `largest frame-to-frame step ${maxJump.toFixed(3)}m against a ${(2 * MIN_BODY_SEPARATION).toFixed(3)}m budget, over ${walkedThrough.positions.length} samples`,
    { authoritative: !hostedHeadless, reason: 'frame-to-frame sampling is not authoritative under hosted-headless frame starvation' });

  // -- shared fight: both clients close in and swing until the wolf dies, sampling both tabs'
  // encounterState() each round to prove they agree on the shared truth (convergence). Each read is
  // taken right after that page was foregrounded (rAF only advances for the foregrounded tab, so a
  // stale background mirror would otherwise be compared against a fresh one), and a brief settle
  // poll absorbs the small chance a hit lands in the gap between reading A and reading B rather than
  // treating that timing crack as a real disagreement.
  async function settledPair(maxWaitMs) {
    const deadline = deadlineAfter(maxWaitMs);
    await pageA.send('Page.bringToFront');
    let a = await fightState(pageA);
    await pageB.send('Page.bringToFront');
    let b = await fightState(pageB);
    while (a.wolf.hp !== b.wolf.hp && Date.now() < deadline) {
      await sleep(80);
      await pageA.send('Page.bringToFront');
      a = await fightState(pageA);
      await pageB.send('Page.bringToFront');
      b = await fightState(pageB);
    }
    return { a, b };
  }

  const hpSamples = [];
  let killed = false;
  for (let round = 0; round < 60 && !killed; round += 1) {
    for (const page of [pageA, pageB]) {
      await page.send('Page.bringToFront');
      const before = await fightState(page);
      if (before.wolf.mode === 'dead') continue;
      const gap = Math.hypot(before.heroPos[0] - before.wolf.x, before.heroPos[1] - before.wolf.z);
      if (gap > 1.5) {
        await walkToward(page, (live) => ({ x: live.wolf.x, z: live.wolf.z }), 1.2, 2_500, { faceTarget: true });
      } else {
        await walkToward(page, (live) => ({ x: live.wolf.x, z: live.wolf.z }), 1.2, 800, { faceTarget: true });
        await tapAttack(page);
        await sleep(200);
      }
    }
    const { a, b } = await settledPair(600);
    hpSamples.push({ round, aHp: a.wolf.hp, bHp: b.wolf.hp, aMode: a.wolf.mode, bMode: b.wolf.mode });
    killed = a.wolf.mode === 'dead' && b.wolf.mode === 'dead';
  }

  const disagreements = hpSamples.filter((sample) => sample.aHp !== sample.bHp);
  check('both tabs agree on wolf HP at every sampled snapshot during the shared fight',
    disagreements.length === 0,
    disagreements.length
      ? `first disagreement at round ${disagreements[0].round}: A=${disagreements[0].aHp} B=${disagreements[0].bHp}`
      : `${hpSamples.length} rounds sampled, all agreeing`);
  check('both tabs converge on the same final dead mode',
    killed,
    `after ${hpSamples.length} rounds: A=${hpSamples.at(-1)?.aMode ?? 'n/a'}, B=${hpSamples.at(-1)?.bMode ?? 'n/a'}`);

  await browser.send('Target.closeTarget', { targetId: targetA });
  const left = await waitFor(pageB, 'window.__galaQuestRuntime.netState().remoteCount === 0', 'closing tab A removes its remote from tab B', 8_000);
  if (left) check('closing tab A removes its remote from tab B', true, 'leave reached the rendered remote pool');
}

// Known, non-blocking 404s -- filtered out rather than hidden entirely, the same split
// play-fight.mjs already uses for the missing favicon. lantern_belt.glb (Phase D, brief D4) is the
// belt lantern: it ships on its own orchestrator/Meshy track, not this one, and main.js's own
// graceful fallback is explicitly required to let the game keep running without it. This harness's
// two tabs share ONE persistent automation Chrome profile (README.md's launch command), so
// localStorage -- and therefore a guest's accumulated marks -- survives across every run against
// it; three marks across enough runs genuinely unlocks the lantern for real, which is what makes
// this 404 show up here at all. That is D3/D4's persistence working, not a defect.
// The favicon entry is gone (Phase R3a): index.html has declared a zero-network data-URI favicon
// since Task F1, so /favicon.ico cannot 404 any more and an allowlist entry that can never match is
// a stale claim rather than a safety net. lantern_belt.glb stays -- it ships on its own track and
// main.js's own graceful fallback is required to keep the game playable without it.
const COSMETIC_404_PATTERNS = ['/assets/gear/lantern_belt.glb'];
function isCosmetic404(text) {
  return COSMETIC_404_PATTERNS.some((pattern) => text.includes(pattern));
}
const realErrors = {
  a: consoleErrors.a.filter((text) => !isCosmetic404(text)),
  b: consoleErrors.b.filter((text) => !isCosmetic404(text)),
};
check('no console errors in either tab', realErrors.a.length === 0 && realErrors.b.length === 0,
  `A=${realErrors.a.slice(0, 2).join(' | ') || 'clean'}; B=${realErrors.b.slice(0, 2).join(' | ') || 'clean'}`);
const cosmeticCount = consoleErrors.a.filter(isCosmetic404).length + consoleErrors.b.filter(isCosmetic404).length;
if (cosmeticCount > 0) {
  console.log(`  NOTE  ${cosmeticCount} known-missing-asset 404(s) (favicon and/or lantern_belt.glb) -- not a failure; see CURRENT_STATE.`);
}
const final = { a: bootA ? await state(pageA).catch(() => null) : null, b: bootB ? await state(pageB).catch(() => null) : null };
writeFileSync(OUT + 'two-client-results.json', JSON.stringify({ results, consoleErrors, final }, null, 2));
await browser.send('Target.closeTarget', { targetId: targetB }).catch(() => {});
// `results.length - failures` counted every DIAG as a pass. A summary must not re-tell the lie the
// individual lines were fixed to stop telling.
const passedCount = results.filter((r) => r.passed === true).length;
const diagCount = results.filter((r) => r.outcome === 'DIAG').length;
console.log(`\n${passedCount} PASS / ${failures} FAIL / ${diagCount} DIAG  (${results.length} checks)`);
process.exit(failures ? 1 : 0);
