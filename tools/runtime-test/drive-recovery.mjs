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

import { ATTACK_REACH, SWING_CONTACT_SECONDS, canAttack, isWithinStrike } from '../../public/src/combat/encounter.js';
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

  while (Date.now() < deadline) {
    const live = await state(tab);
    if (live.marks > startMarks) break;
    // Already beaten: the mark is on its way, so stop swinging at a corpse and let the poll below
    // wait for it rather than burning the budget here.
    if (live.wolf.mode === 'dying' || live.wolf.mode === 'dead') { await sleep(250); continue; }
    const authority = live.serverPos ?? live.heroPos;
    const gap = Math.hypot(authority[0] - live.wolf.x, authority[1] - live.wolf.z);
    if (gap > 1.4) {
      await walkToward(tab, (l) => ({ x: l.wolf.x, z: l.wolf.z }), 1.2, 4000);
      continue;
    }
    // Down, mid-swing, or on cooldown. A tap here is discarded by the rules and costs a second of a
    // budget the offline run does not have to spare.
    if (!live.canAttack) { await sleep(120); continue; }
    // NOT re-aimed before the swing. My first attempt pulsed the stick at the wolf to set the
    // hero's facing, the way drive-marks does, and measured WORSE across three runs -- the pulse
    // moves the hero, and moving during the approach to a swing costs more position than the facing
    // buys. Recorded rather than silently dropped: the idea is reasonable and the measurement said
    // no, and the next person to have it should see that.
    await touch(tab, 'touchStart', [attack]);
    await sleep(60);
    await touch(tab, 'touchEnd', []);
    await pollUntil(tab, (x) => x.wolf.mode === 'dying' || x.wolf.mode === 'dead' || x.marks > startMarks,
      (SWING_CONTACT_SECONDS + 0.4) * 1000, 20);
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
  const STORE_A = join(storeDir, 'earned.db');
  const STORE_B = join(storeDir, 'wiped.db');

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

  const tab = await openTab();
  try {
    await setViewport(tab);
    await tab.page.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'local_storage' });
    await tab.page.send('Page.navigate', { url: GAME_URL });
    await waitForRuntime(tab);

    // ── 1. a child earns something, for real ──────────────────────────────────────────────────
    console.log('\n── phase earn (a wolf, a tap, a Lantern Mark) ──');
    const before = await state(tab);
    check('a fresh child starts with nothing on record', before.marks === 0 && before.pipsFilled === 0,
      `marks ${before.marks}, pips ${before.pipsFilled}`);

    const earned = await earnAMark(tab);
    // The detail says what the WOLF was doing, not only that no mark arrived. "marks 0" names
    // nothing; "wolf idle at 3hp, hero 9 m away" names the walk, and "wolf bite at 3hp, hero 1 m
    // away" names the fight. Those are different defects and the first version could not tell them
    // apart -- which cost two runs of guessing.
    const earnedGap = Math.hypot((earned.serverPos ?? earned.heroPos)[0] - earned.wolf.x,
      (earned.serverPos ?? earned.heroPos)[1] - earned.wolf.z);
    // Whether the rules would even COUNT a swing from where the hero is standing. encounter.js's
    // isWithinStrike is reach AND a 151-degree arc around the hero's own facing, so "close enough"
    // is only half the question and a harness that reports distance alone cannot tell a fight it is
    // losing from a fight it is not actually in.
    const authorityAt = earned.serverPos ?? earned.heroPos;
    const wouldLand = isWithinStrike(
      { x: authorityAt[0], z: authorityAt[1] }, earned.heroHeading, { x: earned.wolf.x, z: earned.wolf.z },
    );
    check('the child earns a Lantern Mark by killing the wolf', earned.marks >= 1,
      `marks ${earned.marks}, wolf ${earned.wolf.mode} at ${earned.wolf.hp}hp, `
      + `hero ${earnedGap.toFixed(1)} m away (reach ${ATTACK_REACH}), facing ${earned.heroHeading?.toFixed?.(2)}, `
      + `a swing from here would ${wouldLand ? 'LAND' : 'MISS'}, hero ${earned.hero.hp}hp, net ${earned.netStatus}`);
    // Polled, not sampled: the pip row is painted from a reward event that arrives a frame or two
    // after the count changes, and reading both in the same breath caught marks 1 with pips 0.
    const painted = await pollUntil(tab, (s) => s.pipsFilled >= 1, 6000);
    check('and the HUD draws it', painted.pipsFilled >= 1, `pips ${painted.pipsFilled}, marks ${painted.marks}`);
    await shot(tab, '01-earned');

    const profileId = await activeProfileId(tab);
    check('the child has a durable profile to remember into', typeof profileId === 'string' && profileId.length > 0,
      String(profileId));

    const localCopy = await journalOf(tab, profileId);
    check('THE LOCAL COPY EXISTS: the device journalled the Mark itself, not just the server',
      localCopy.count > 0, JSON.stringify(localCopy));

    const storeA = openRewardStore(STORE_A);
    const serverMarks = storeA.marksFor(profileId);
    storeA.close?.();
    check('and the server recorded it too, under this profile', serverMarks >= 1, `store A marks ${serverMarks}`);

    // ── 2. the server forgets ─────────────────────────────────────────────────────────────────
    console.log('\n── phase wiped (the reward database is replaced with an empty one) ──');
    server = await restartOn(STORE_B);
    check('a replaced server really is empty to start with',
      (() => { const s = openRewardStore(STORE_B); const m = s.marksFor(profileId); s.close?.(); return m === 0; })(),
      'store B starts at 0 marks');

    await tab.page.send('Page.navigate', { url: GAME_URL });
    await waitForRuntime(tab);
    const afterWipe = await pollUntil(tab, (s) => s.netStatus === 'online' && s.marks > 0, 20000);

    check('THE CHILD STILL HAS THEIR MARK after the server forgot everything',
      afterWipe.marks >= 1, `marks ${afterWipe.marks}, net ${afterWipe.netStatus}`);
    check('and the HUD still draws it, which is what the child actually sees',
      afterWipe.pipsFilled >= 1, `pips ${afterWipe.pipsFilled}`);
    await shot(tab, '02-after-the-server-forgot');

    // The restore direction: the device teaches the empty server what it missed.
    const restored = await (async () => {
      const deadline = Date.now() + 15000;
      for (;;) {
        const s = openRewardStore(STORE_B);
        const m = s.marksFor(profileId);
        s.close?.();
        if (m >= 1 || Date.now() > deadline) return m;
        await sleep(500);
      }
    })();
    check('and the empty server has been told about it, so it is durable again on BOTH sides',
      restored >= 1, `store B marks ${restored}`);

    // ── 3. no server at all ───────────────────────────────────────────────────────────────────
    console.log('\n── phase offline (a car, a holiday, a router that died) ──');
    await server.kill();
    const offline = await pollUntil(tab, (s) => s.netStatus !== 'online', 15000);
    check('the game keeps running with the server gone', offline.netStatus !== 'online',
      `net ${offline.netStatus}`);

    const marksBeforeOffline = offline.marks;
    console.log(`  offline wolf before the attempt: mode ${offline.wolf.mode}, hp ${offline.wolf.hp}, `
      + `hero ${JSON.stringify(offline.heroPos)}, wolf ${offline.wolf.x?.toFixed?.(1)},${offline.wolf.z?.toFixed?.(1)}`);
    const offlineEarned = await earnAMark(tab);
    console.log(`  offline wolf after:  mode ${offlineEarned.wolf.mode}, hp ${offlineEarned.wolf.hp}, `
      + `hero ${JSON.stringify(offlineEarned.heroPos)}`);
    check('a child can still earn a Mark with nothing to connect to',
      offlineEarned.marks > marksBeforeOffline,
      `marks ${marksBeforeOffline} -> ${offlineEarned.marks}, net ${offlineEarned.netStatus}, `
      + `wolf ${offlineEarned.wolf.mode} at ${offlineEarned.wolf.hp}hp`);
    await shot(tab, '03-earned-offline');

    // ── 4. and it is still theirs tomorrow ────────────────────────────────────────────────────
    console.log('\n── phase reload (they close the game and come back) ──');
    server = await restartOn(STORE_B);
    await tab.page.send('Page.navigate', { url: GAME_URL });
    await waitForRuntime(tab);
    const back = await pollUntil(tab, (s) => s.marks >= offlineEarned.marks && s.marks > 0, 20000);
    // `>= offlineEarned.marks` ALONE IS VACUOUS when nothing was earned: 0 >= 0 reports PASS for a
    // run that proved nothing, which is the shape GQ-017 was written about this same day. Both the
    // survival and the count being non-zero have to hold.
    check('THE OFFLINE MARK SURVIVED THE RELOAD',
      back.marks > 0 && back.marks >= offlineEarned.marks,
      `earned ${offlineEarned.marks} offline, came back with ${back.marks}`);
    check('and the HUD agrees with the count',
      back.pipsFilled > 0 && back.pipsFilled >= Math.min(3, back.marks),
      `pips ${back.pipsFilled}, marks ${back.marks}`);
    await shot(tab, '04-back-tomorrow');

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

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
