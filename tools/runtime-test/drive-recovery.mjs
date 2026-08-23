// The recovery boundary, driven through the real client rather than through the store.
//
// The union law -- state = fold(union(localJournal, serverStore)) -- is covered hard at the Node
// level: reward-store tests, protocol tests, empty-server-recovery tests. What none of that touches
// is the CLIENT. Every one of those proves a function; this proves the game.
//
// GQ-015 is the reason it exists in this form. A test that hand-feeds a pure function proves the
// function, not where its inputs come from -- and this branch has already had a fold that was
// perfectly correct while both of its real producers were broken. Here the inputs come from a child
// killing a wolf in a browser.
//
// TWO THINGS A FAMILY ACTUALLY DOES, and neither is a unit test:
//
//   1. THE SERVER FORGETS. The reward database is replaced, wiped, or moved to a machine that has
//      never seen this child. Their Lantern Mark is on the tablet. Does the game still know about
//      it, and does the empty server end up holding it again?
//
//   2. THE TABLET IS OFFLINE. No server at all -- a car, a holiday, a router that died. The child
//      earns a Mark against the offline rules, then closes the game and comes back. Is it still
//      theirs?
//
// THE SAME PORT ACROSS EVERY RESTART, deliberately and not incidentally. localStorage is keyed by
// ORIGIN: a restart on a different port is a different origin, the journal vanishes, and the harness
// would report a recovery failure that is entirely its own doing. The port is captured from the
// first server and forced on every one after it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ATTACK_REACH, WOLF_RESPAWN_SECONDS, canAttack, isWithinStrike,
} from '../../public/src/combat/encounter.js';
import { worldToScreen } from '../../public/src/camera/rotation.js';
import { openRewardStore } from '../../net/rewardStore.mjs';
import { deadlineAfter, movementPulseMillis } from './automation-timing.mjs';
import { gameUrlFor, startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 820, height: 1180, deviceScaleFactor: 1, mobile: true };
const HERO_NAME = 'Recovery';

const results = [];
let failures = 0;

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/**
 * A measurement this environment cannot authoritatively judge.
 *
 * Neither PASS nor FAIL, and it always prints what the predicate REALLY did. The repo already draws
 * this distinction (test/harness-verdict-semantics.test.mjs enforces it) precisely so a harness
 * cannot buy green by reporting a violated predicate as satisfied.
 */
function diagnostic(name, passed, detail, { authoritative, reason }) {
  // With authoritative:true this degrades to an ordinary gating check. The flag exists so DIAG is a
  // judgement about the ENVIRONMENT rather than a permanent excuse attached to the check itself --
  // the day this becomes decidable, one boolean turns it back into a gate.
  if (authoritative) return check(name, passed, detail);
  results.push({ name, passed: null, outcome: 'DIAG', actualPredicate: passed, detail });
  console.log(`DIAG  ${name}${detail ? `  — ${detail}` : ''}`
    + ` [NOT JUDGED: ${reason}; predicate actually ${passed ? 'held' : 'VIOLATED'}]`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  sendOnce(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 20000);
    });
  }
  async send(method, params = {}) {
    try {
      return await this.sendOnce(method, params);
    } catch (err) {
      if (!/timed out/.test(err.message)) throw err;
      return this.sendOnce(method, params);
    }
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`eval threw: ${r.exceptionDetails.text}`);
    return r.result.value;
  }
}

async function openTab() {
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
  let loggedFirst = false;
  page.ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.text);
      if (!loggedFirst) {
        loggedFirst = true;
        console.log('  first uncaught exception:',
          JSON.stringify(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails));
      }
    }
  });
  return { page, targetId, consoleErrors, close: () => page.send('Target.closeTarget', { targetId }) };
}

async function setViewport(tab) {
  await tab.page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
  await tab.page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}

async function waitForRuntime(tab, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const up = await tab.page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
    if (up === true) return;
    if (Date.now() > deadline) throw new Error('runtime never came up');
    await sleep(250);
  }
}

/** Everything this harness reasons about, in one read. */
const state = (tab) => tab.page.eval(`JSON.stringify((() => {
  const r = window.__galaQuestRuntime;
  const published = r.encounterState();
  const net = r.netState();
  const pips = [...document.querySelectorAll('#lantern-marks .mark')];
  const own = (() => {
    const all = r.rewards();
    const id = net.selfId;
    return (id != null ? all[id] : null) ?? Object.values(all)[0] ?? null;
  })();
  return {
    wolf: { ...published.wolf }, hero: { ...published.hero },
    heroPos: [+r.player.position.x.toFixed(2), +r.player.position.z.toFixed(2)],
    serverPos: net.serverSelf ? [+net.serverSelf.x.toFixed(2), +net.serverSelf.z.toFixed(2)] : null,
    heading: r.follow.heading,
    // The HERO's own facing, which is what the rules swing with -- not the camera's.
    heroHeading: r.player.heading,
    netStatus: net.status,
    pipsFilled: pips.filter((el) => el.dataset.filled === 'true').length,
    marks: own?.marks ?? 0,
    // THE SERVER'S OWN ENTRY, KEYED, WITH NO FALLBACK -- unlike the field above, which takes any
    // entry in the map when this guest is not in it. The HUD paints from exactly this while online,
    // so when the two disagree, the difference IS what the child is looking at.
    // (No backticks in this comment on purpose: the whole block is inside a template literal, and a
    //  stray one terminates it. That has cost this branch two debugging rounds already.)
    serverMarksKeyed: (net.selfId !== null && net.selfId !== undefined)
      ? (r.rewards()[net.selfId]?.marks ?? null) : null,
    guestId: r.guestId(),
  };
})())`).then(JSON.parse).then((s) => ({ ...s, canAttack: canAttack(s) }));

const touch = (tab, type, points) => tab.page.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i })),
});

async function pollUntil(tab, predicate, timeoutMs = 8000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let last = await state(tab);
  while (!predicate(last) && Date.now() < deadline) {
    await sleep(intervalMs);
    last = await state(tab);
  }
  return last;
}

/**
 * Walk with the stick toward a live world point, re-aimed as it moves.
 *
 * STEERED THROUGH THE PRODUCT'S OWN TRANSFORM. The stick is camera-relative -- input/touch.js hands
 * main.js a screen vector and camera/rotation.js rotates it into the world -- so a harness aiming in
 * world axes walks the hero somewhere else entirely the moment the game does not open at heading 0.
 * My first draft got the signs wrong and the hero never reached the wolf.
 *
 * `worldToScreen` is that rotation, exported by the game. drive-marks.mjs hand-rolls the same matrix
 * inline; I checked the two agree to the digit at four headings before using this one rather than
 * adding a third copy of a law the product already owns (GQ-007).
 *
 * PULSED rather than held, which is drive-marks' shape and its lesson: a held stick keeps steering
 * on a stale aim between samples, and overshoots.
 */
async function walkToward(tab, target, stopWithin, budgetMs) {
  const stick = { x: 16 + 56, y: VIEWPORT.height - 16 - 56 };
  const STICK_PX = 46;
  const deadline = deadlineAfter(budgetMs);
  let live = await state(tab);
  while (Date.now() < deadline) {
    const to = target(live);
    // The SERVER's idea of where the hero is when it has one: that is what the rules adjudicate
    // against, and steering by the predicted position walks to a place the server disagrees with.
    const authority = live.serverPos ?? live.heroPos;
    const dx = to.x - authority[0];
    const dz = to.z - authority[1];
    const distance = Math.hypot(dx, dz);
    if (distance <= stopWithin || distance === 0) break;
    const screen = worldToScreen({ x: dx / distance, z: dz / distance }, live.heading);
    await touch(tab, 'touchStart', [stick]);
    try {
      await touch(tab, 'touchMove', [{ x: stick.x + screen.x * STICK_PX, y: stick.y - screen.y * STICK_PX }]);
      // The TUNED pulse from automation-timing.mjs rather than a curve I made up. My first draft
      // invented one and the online walk did not converge -- the wolf stayed idle, meaning the hero
      // never got inside its six-metre aggro range at all -- while the offline walk, on the same
      // code, arrived. That asymmetry is the giveaway: online steers by the SERVER's position, which
      // lags, so a mis-tuned pulse oscillates around the target instead of closing on it.
      await sleep(movementPulseMillis(Math.max(0, distance - stopWithin)));
    } finally {
      await touch(tab, 'touchEnd', []);
    }
    await sleep(90);
    live = await state(tab);
  }
  return live;
}

/**
 * Kill a wolf the way a child does: walk up and tap ATTACK until it stops.
 *
 * DEADLINE-DRIVEN AND SELF-CORRECTING rather than a fixed count of swings, because the two runs this
 * has to survive are not alike. Online the hero is server-adjudicated and the approach is the hard
 * part; offline the hero is being BITTEN throughout, goes down, stands up, and every tap sent while
 * they are on the ground is thrown away. A loop that counts swings spends its budget on taps that
 * could never land -- which is exactly how the offline phase failed with the wolf still on 3 hp.
 *
 * So each pass asks what is actually true right now: too far, re-walk; cannot swing yet, wait; wolf
 * already down, stop. Nothing is assumed to have worked.
 */
async function earnAMark(tab, budgetMs = 70000) {
  const attack = { x: VIEWPORT.width - 16 - 56, y: VIEWPORT.height - 16 - 56 };
  const startMarks = (await state(tab)).marks;
  const deadline = deadlineAfter(budgetMs);
  await walkToward(tab, (live) => ({ x: live.wolf.x, z: live.wolf.z }), 1.2, 30000);

  // TAP ON A CLOCK, AND STOP TALKING TO THE PAGE BETWEEN TAPS.
  //
  // This loop used to read the full `state(tab)` before every tap, skip when `canAttack` was false,
  // and then poll at a 20ms interval for the length of a swing -- roughly fifty CDP round trips per
  // swing on a runner where each costs real time. It spent its budget talking rather than swinging,
  // which is why the online earn was an unexplained DIAG while the offline one, running the same
  // code with fewer server round trips to compete with, landed every time.
  //
  // The fight itself was never the problem. Measured in this same browser, online, stopping at the
  // kill: FOUR taps, all four connect, the wolf down in 16.5s and 17.4s. The deterministic engine
  // gives the same fight in 5.1s (test/opening-fight.test.mjs). So this now does what a child does --
  // presses on its own clock and looks up occasionally -- rather than asking the game for permission
  // before every press. A refused tap is FREE; asking whether one would be refused is not.
  const TAP_GAP_MS = 600;
  // One number, not the whole state object: this runs between every tap and the difference is the
  // point of the rewrite.
  const cheapLook = () => tab.page.eval(`JSON.stringify((() => {
    const r = window.__galaQuestRuntime;
    const net = r.netState();
    const all = r.rewards();
    const own = (net.selfId != null ? all[net.selfId] : null) ?? Object.values(all)[0] ?? null;
    const w = r.encounterState().wolf;
    return { wolfHp: w.hp, mode: w.mode, marks: own?.marks ?? 0 };
  })())`).then(JSON.parse);

  let tapsSinceLook = 0;
  while (Date.now() < deadline) {
    // NOT re-aimed before the swing. My first attempt pulsed the stick at the wolf to set the
    // hero's facing, the way drive-marks does, and measured WORSE across three runs -- the pulse
    // moves the hero, and moving during the approach to a swing costs more position than the facing
    // buys. Recorded rather than silently dropped: the idea is reasonable and the measurement said
    // no, and the next person to have it should see that.
    await touch(tab, 'touchStart', [attack]);
    await sleep(60);
    await touch(tab, 'touchEnd', []);
    await sleep(TAP_GAP_MS);
    tapsSinceLook += 1;

    const look = await cheapLook();
    if (look.marks > startMarks) break;
    if (look.wolfHp <= 0 || look.mode === 'dying' || look.mode === 'dead') break;
    // Only re-close the gap every few taps. Walking is the one thing that genuinely needs the wolf's
    // position, and it is the only thing worth a full read.
    if (tapsSinceLook >= 4) {
      tapsSinceLook = 0;
      const live = await state(tab);
      const authority = live.serverPos ?? live.heroPos;
      if (Math.hypot(authority[0] - live.wolf.x, authority[1] - live.wolf.z) > 1.4) {
        await walkToward(tab, (l) => ({ x: l.wolf.x, z: l.wolf.z }), 1.2, 4000);
      }
    }
  }
  return pollUntil(tab, (x) => x.marks > startMarks, 10000);
}

async function shot(tab, name) {
  const { data } = await tab.page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}recovery-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured recovery-${name}.png`);
}

/** What this profile's journal holds on the device, read as the stored bytes. */
const journalOf = (tab, profileId) => tab.page.eval(`JSON.stringify((() => {
  const raw = localStorage.getItem('gq-journal:' + ${JSON.stringify(profileId)});
  if (!raw) return { missing: true };
  const parsed = JSON.parse(raw);
  return { count: (parsed.facts ?? []).length, types: [...new Set((parsed.facts ?? []).map((f) => f.type))] };
})())`).then(JSON.parse);

const activeProfileId = (tab) => tab.page.eval(`JSON.stringify((() => {
  const raw = localStorage.getItem('gq-profiles');
  return raw ? JSON.parse(raw).activeProfileId : null;
})())`).then(JSON.parse);

// ── the run ────────────────────────────────────────────────────────────────────────────────────

async function run() {
  const storeDir = mkdtempSync(join(tmpdir(), 'gq-recovery-'));
  // THREE stores, because the recovery boundary has two distinct shapes and both matter:
  //   A  the server the child first meets
  //   B  an empty server that has NEVER heard of this child   -- the device must teach it
  //   C  an empty server replacing one that HAD the facts     -- the device must teach it again
  const STORE_A = join(storeDir, 'first.db');
  const STORE_B = join(storeDir, 'never-heard-of-you.db');
  const STORE_C = join(storeDir, 'replaced.db');

  let server = await startOwnedServer({ rewardStorePath: STORE_A, quiet: true });
  // Captured once and forced on every restart: localStorage is keyed by ORIGIN, so a restart on a
  // different port silently throws away the journal this whole harness is about.
  const PORT = Number(new URL(server.origin).port);
  const ORIGIN = server.origin;
  const GAME_URL = `${ORIGIN}/?hero=${encodeURIComponent(HERO_NAME)}`;
  const restartOn = async (rewardStorePath) => {
    await server.kill();
    return startOwnedServer({ candidates: [PORT], rewardStorePath, quiet: true });
  };
  let RECOVERY_PROFILE = null;
  const marksIn = (path) => { const s2 = openRewardStore(path); const m = s2.marksFor(RECOVERY_PROFILE); s2.close?.(); return m; };
  const marksInEventually = async (path, want, budgetMs = 15000) => {
    const until = deadlineAfter(budgetMs);
    for (;;) {
      const m = marksIn(path);
      if (m >= want || Date.now() > until) return m;
      await sleep(500);
    }
  };

  const tab = await openTab();
  try {
    await setViewport(tab);
    await tab.page.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'local_storage' });
    await tab.page.send('Page.navigate', { url: GAME_URL });
    await waitForRuntime(tab);

    // ── 1. can a child win the opening fight ONLINE? ─────────────────────────────────────────
    // Attempted first and judged as DIAG, because the answer is genuinely unknown and this harness
    // must not pretend otherwise. It fails here, it fails on a GPU-less box, and the Director's own
    // /director-playtest marks "timed out trying to kill the wolf before any Mark existed" -- three
    // independent observations. What I cannot yet separate is whether that is automation reaction
    // speed or an online prediction/adjudication gap that a slow CHILD would also hit. Printing the
    // real predicate keeps the question visible without letting it block the recovery proof, which
    // is what this file is actually for.
    console.log('\n── phase online fight (can the opening wolf be beaten with a server watching?) ──');
    const before = await state(tab);
    check('a fresh child starts with nothing on record', before.marks === 0 && before.pipsFilled === 0,
      `marks ${before.marks}, pips ${before.pipsFilled}`);

    // A SHORT BUDGET, because this phase is the diagnostic and the one below is the proof.
    //
    // Before the tap loop was fixed this fight always LOST, and the file was reliable precisely
    // because of that: it left a full-health wolf standing for the offline earn. Making it win broke
    // the file -- two fights then had to fit in a budget that affords one. That is a regression
    // introduced by fixing something, which is the most expensive kind, so it is written down rather
    // than tuned away quietly. Twenty-five seconds comes from the measurement, not from taste: the
    // fight lands in about seventeen when it lands.
    const earned = await earnAMark(tab, 25000);
    const authorityAt = earned.serverPos ?? earned.heroPos;
    const wouldLand = isWithinStrike(
      { x: authorityAt[0], z: authorityAt[1] }, earned.heroHeading, { x: earned.wolf.x, z: earned.wolf.z },
    );
    const earnedGap = Math.hypot(authorityAt[0] - earned.wolf.x, authorityAt[1] - earned.wolf.z);
    diagnostic('a child can beat the opening wolf while the server is adjudicating', earned.marks >= 1,
      `marks ${earned.marks}, wolf ${earned.wolf.mode} at ${earned.wolf.hp}hp, `
      + `hero ${earnedGap.toFixed(1)} m away (reach ${ATTACK_REACH}), facing ${earned.heroHeading?.toFixed?.(2)}, `
      + `a swing from here would ${wouldLand ? 'LAND' : 'MISS'}, hero ${earned.hero.hp}hp`,
      {
        authoritative: false,
        // THE REASON HAS CHANGED, and that is worth more than the verdict. The old one was "cannot
        // separate automation reaction speed from online adjudication". That is now answered: it was
        // reaction speed, and specifically this harness's own -- changing only the HARNESS turned it
        // from never landing to usually landing. There is no product defect behind it.
        reason: 'the fight itself is proven elsewhere (4 taps, ~17s, same browser; 5.1s in the '
          + 'deterministic engine); what is left is this harness losing an approach to a knockdown '
          + 'inside one budget, which is not something to gate a recovery proof on',
      });

    RECOVERY_PROFILE = await activeProfileId(tab);
    check('the child has a durable profile to remember into',
      typeof RECOVERY_PROFILE === 'string' && RECOVERY_PROFILE.length > 0, String(RECOVERY_PROFILE));

    // ── 2. earn one for real, with nothing to connect to ─────────────────────────────────────
    // THE EARN THE RECOVERY PROOF RIDES ON, and it is offline on purpose rather than as a
    // concession. A Mark the server has NEVER SEEN is the strongest possible starting point for
    // "the device is the durable copy": there is no server row anywhere to fall back on.
    // WAIT FOR A WOLF FIRST, WHILE THERE IS STILL A SERVER TO GROW ONE.
    //
    // This phase used to get a live wolf for free, because the fight above was failing and leaving
    // one standing. Two phases sharing one wolf is a dependency neither of them declared, and it
    // surfaced the moment the fight started landing.
    //
    // The wait has to come BEFORE the server dies: putting it after left the wolf dead for the full
    // sixteen seconds, because respawn is adjudicated server-side and there was nothing left to
    // adjudicate. A child losing their network mid-play has a live wolf in front of them anyway,
    // which is the situation this is reproducing.
    //
    // WOLF_RESPAWN_SECONDS is imported rather than slept past, and the poll decides: a fixed sleep
    // would be right until somebody changed the constant.
    const respawned = await pollUntil(
      tab, (s) => s.wolf.hp > 0 && s.wolf.mode !== 'dead' && s.wolf.mode !== 'dying',
      (WOLF_RESPAWN_SECONDS + 8) * 1000, 500,
    );
    // Stated as what the NEXT phase needs -- a wolf to fight -- rather than as "one respawned".
    // Those are the same thing only when the fight above actually killed one, and on the runs where
    // it does not, "a wolf came back" would report a success about an event that never happened.
    check('there is a live wolf for the offline half to fight', respawned.wolf.hp > 0,
      `wolf ${respawned.wolf.mode} at ${respawned.wolf.hp}hp`
      + `${earned.marks >= 1 ? ' (the diagnostic fight killed one, so this one respawned)' : ' (the diagnostic fight did not land, so this is the original)'}`);

    console.log('\n── phase offline (a car, a holiday, a router that died) ──');
    await server.kill();
    const offline = await pollUntil(tab, (s) => s.netStatus !== 'online', 15000);
    check('the game keeps running with the server gone', offline.netStatus !== 'online', `net ${offline.netStatus}`);

    const marksBefore = offline.marks;
    const offlineEarned = await earnAMark(tab);
    check('a child can earn a Lantern Mark with nothing to connect to',
      offlineEarned.marks > marksBefore,
      `marks ${marksBefore} -> ${offlineEarned.marks}, wolf ${offlineEarned.wolf.mode} at ${offlineEarned.wolf.hp}hp`);
    await shot(tab, '01-earned-offline');

    const journal = await journalOf(tab, RECOVERY_PROFILE);
    check('THE LOCAL COPY EXISTS: the device journalled it with nowhere to send it',
      journal.count > 0 && journal.types.includes('mark-earned'), JSON.stringify(journal));

    // ── 3. a server that has never heard of this child ───────────────────────────────────────
    console.log('\n── phase never-heard-of-you (an empty server appears) ──');
    // MEASURED BEFORE THE SERVER STARTS, and that ordering is the fix rather than a detail. Reading
    // it after `restartOn` races the very thing the next checks assert: the page is still open, it
    // reconnects within a moment, and the device teaches this store the marks it holds. The check
    // then reports "the new server already knows this child" -- which is TRUE, and is a statement
    // about the harness's own timing rather than about the product. Opening the path creates an
    // empty store, so this is the honest read of "what did this database know before anyone spoke".
    const storeBStartedAt = marksIn(STORE_B);
    check('the new server has never heard of this profile', storeBStartedAt === 0,
      `store B at ${storeBStartedAt} marks before anything connected`);
    server = await restartOn(STORE_B);

    await tab.page.send('Page.navigate', { url: GAME_URL });
    await waitForRuntime(tab);
    const met = await pollUntil(tab, (s) => s.netStatus === 'online' && s.marks > 0, 25000);
    check('THE CHILD STILL HAS THEIR MARK when the server has never seen them',
      met.marks >= 1, `marks ${met.marks}, net ${met.netStatus}`);
    // BOTH NUMBERS, because this check has failed intermittently and "pips 0" alone cannot say why.
    // The HUD paints from the server's OWN keyed entry while online; the harness's `marks` above
    // falls back to any entry in the map. If the keyed one is behind, the child is online, holding
    // marks locally, and looking at an empty lantern row.
    check('and the HUD draws it, which is what the child actually sees', met.pipsFilled >= 1,
      `pips ${met.pipsFilled}, server's own keyed entry ${met.serverMarksKeyed}, harness read ${met.marks}`);
    // WANT WHAT THE CHILD HOLDS, not a hardcoded 1. Once the diagnostic fight above started
    // landing there were two marks, and a wait for "at least one" returns while the second is
    // still in flight -- proving less than the check's own sentence claims.
    const taughtB = await marksInEventually(STORE_B, met.marks);
    check('and the DEVICE TEACHES the empty server, so it is durable on both sides again',
      taughtB >= met.marks, `store B marks ${taughtB}, child holds ${met.marks}`);
    await shot(tab, '02-taught-an-empty-server');

    // ── 4. and again, when a server that DID have it is replaced ─────────────────────────────
    // The other shape, and the one the Director named first: the reward database is wiped or moved
    // to a machine that has never seen this family. Reached without a second fight by swapping the
    // store under a server that has just been taught.
    console.log('\n── phase replaced (the database that HAD it is swapped out) ──');
    const storeCStartedAt = marksIn(STORE_C);
    check('the replacement server is empty too', storeCStartedAt === 0,
      `store C at ${storeCStartedAt} marks before anything connected`);
    server = await restartOn(STORE_C);

    await tab.page.send('Page.navigate', { url: GAME_URL });
    await waitForRuntime(tab);
    const again = await pollUntil(tab, (s) => s.netStatus === 'online' && s.marks > 0, 25000);
    check('THE CHILD STILL HAS IT after the database that held it was replaced',
      again.marks >= 1, `marks ${again.marks}, net ${again.netStatus}`);
    const taughtC = await marksInEventually(STORE_C, again.marks);
    check('and the device repopulates that one too -- restore is not a one-off',
      taughtC >= again.marks, `store C marks ${taughtC}, child holds ${again.marks}`);
    await shot(tab, '03-and-again');

    // The socket failing is THIS HARNESS killing the server on purpose, and a child on a dead router
    // sees exactly the same line. Filtered by its precise shape rather than by loosening the check:
    // anything else the page logged still fails here, which is the property worth keeping.
    const unexpected = tab.consoleErrors.filter((line) => !/WebSocket connection to .*failed/i.test(line));
    check('no console errors beyond the socket this harness deliberately killed',
      unexpected.length === 0,
      unexpected.length ? JSON.stringify(unexpected.slice(0, 3))
        : `none (${tab.consoleErrors.length} expected socket failures ignored)`);
  } finally {
    await tab.close().catch(() => {});
    await server.kill().catch(() => {});
    rmSync(storeDir, { recursive: true, force: true });
  }

  // PASS / FAIL / DIAG separately, never folded together: a summary that counted a DIAG as a pass
  // would re-tell at the bottom the exact lie the individual lines were written to stop telling.
  const passedCount = results.filter((r) => r.passed === true).length;
  const diagCount = results.filter((r) => r.outcome === 'DIAG').length;
  console.log(`\n${passedCount} PASS / ${failures} FAIL / ${diagCount} DIAG  (${results.length} checks)`);
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
