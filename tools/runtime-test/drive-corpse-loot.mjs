/**
 * #87: prove the corpse-loot CLIENT PRESENTER in a real browser, against a real fight, against a
 * real (unseeded, unscripted) server roll -- CDP over a real Chrome tab, the same automation
 * discipline every harness in this directory keeps, using the PR #101 owned-server module so this
 * always drives THIS worktree's own server.mjs/public/, never a stale shared one.
 *
 * SCOPE, STATED PLAINLY: this drives ONE client. It proves the presenter itself -- glow, the Loot
 * prompt, opening the panel, an individual TAKE, Take All, the short acquired-item toast, and that
 * every one of those is reachable through a real TOUCH dispatch with no hover involved anywhere.
 * Cross-player isolation (a sibling's claim on the SAME corpse staying untouched) is NOT re-proven
 * live here -- it already has three independent, load-bearing proofs that do not need a second real
 * multiplayer fight to hold: the server's own claim lookup (test/corpse-loot.test.mjs, "A loots; B's
 * claim remains untouched"), the real two-contributor wiring seam
 * (test/enemy-drops-server.test.mjs, "#87 seam: two real, independently-attacking players both
 * receive their own corpse claim"), and the CLIENT presenter's own isolation
 * (test/corpse-loot-presenter.test.mjs's sabotage tests). Driving two real tabs to a SHARED corpse
 * where BOTH independently roll gear was judged not worth the wall-clock cost of the retries that
 * would need, for a property already proven three ways.
 *
 * NO DICE, AND NO RETRY LOOP. Two earlier versions of this file tried to reach a real corpse by
 * killing an enemy over and over until an unseeded 20% gear roll finally landed. That produced a gate
 * nobody could read: it was red about half the time for luck alone, and after the luck was de-gated it
 * was still red on the hosted matrix for a completely different reason -- see the target comment
 * further down for the measured cause (it never got in range to land a hit at all, 45 swings, 0 kills,
 * against 7 kills on the same code locally).
 *
 * What replaced it is a narrow, opt-in server fixture rather than a better gambler:
 * net/gameServerCore.mjs's own `guaranteedCorpseItemIds` option, routed from server.mjs's
 * GALAQUEST_TEST_GUARANTEED_CORPSE_ITEMS and set by nothing in this tree except owned-server.mjs on
 * this file's behalf. It hands the corpse a FIXED item list, so one ordinary kill of the ordinary
 * near-spawn wolf always yields a real personal claim.
 *
 * WHAT THAT DOES AND DOES NOT MAKE FAKE, stated plainly because it is the whole basis of this file's
 * evidence. The fixture decides ONE thing: which item ids sit on the claim. Everything this file
 * actually asserts stays real and server-authoritative -- a real fought kill, the real contributor
 * eligibility derivation, the real corpse spawn, the real claim keyed to this hero's own real heroId,
 * the real encounter.corpses[] wire, the real client presenter, the real collect-corpse-item /
 * collect-corpse-all round trip, and the real snapshot diff that produces the acquired-item toast. The
 * shipped drop tables in world/enemyDrops.js are untouched, and the option defaults off, which
 * test/enemy-drops-server.test.mjs's own "#87 harness seam is opt-in" test pins against a real kill.
 *
 * Because nothing here is luck any more, EVERY check in this file gates. There is no best-effort tier.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deadlineAfter, subjectLifetime } from './automation-timing.mjs';
import { authoredWolfSource, READ_WALK, startWalk, STOP_WALK } from './in-page-driver.mjs';
import { startOwnedServer } from './owned-server.mjs';
import { SHIELD_IRONWOOD_ID, SHOULDER_SILVERGUARD_ID } from '../../public/src/progression/items.js';
import {
  CORPSE_LOOT_EXPIRE_SECONDS, CORPSE_LOOT_INTERACT_RADIUS_METERS,
} from '../../public/src/world/corpseLoot.js';
import {
  HERO_MAX_HP, RESPAWN_SECONDS, WOLF_RESPAWN_SECONDS,
} from '../../public/src/combat/encounter.js';
// GQ-007: the timeline below reports the wolf's own bite against the hero's own health, so it reads
// both off the authored stats table rather than restating two numbers that would go stale silently.
import { wolfStatsForLevel } from '../../public/src/combat/enemyStats.js';
import { STICK_RADIUS_PX } from '../../public/src/input/touch.js';
import { RUN_DEFLECTION } from '../../public/src/character/speed.js';

const CHROME_PORT = 9224;
const REWARD_STORE_PATH = join(mkdtempSync(join(tmpdir(), 'gq-corpse-loot-')), 'rewards.db');
// TWO items, deliberately, and in this order: the first proves an INDIVIDUAL take, the second is then
// the LAST item on the corpse -- which is the exact shape of the receipt blocker corrected at dd7ce2e
// (a fully-resolved corpse used to retire before the snapshot carrying its own taken-transition was
// built, so the last thing a child collected was the one thing that never confirmed). Driving both
// through one real corpse is what makes this file able to catch that defect coming back.
const FIXTURE_ITEM_IDS = [SHIELD_IRONWOOD_ID, SHOULDER_SILVERGUARD_ID];

// WHAT EACH LOOT STEP IS ALLOWED TO SPEND OF THE CORPSE'S OWN LIFETIME, and why they are declared
// together rather than typed at their call sites. Every budget in this file was already a wall-clock
// deadline, and the file still went red hosted at a20fcd7 -- because the deadlines were sized against
// each other instead of against the subject. One re-approach was allowed 60s of a claim that lives
// CORPSE_LOOT_EXPIRE_SECONDS (180), so a run that used two of them had spent the corpse before it
// ever tapped TAKE. Measured on that run: 188.6s from corpse to the tap, of which ~50s was a
// knockdown poll waiting on a 2-second respawn, ~30s was three `for (i<25) { eval; sleep(200) }`
// loops waiting on a ~1s round trip, and ~60s was a single recovery approach.
//
// Each number below is sized on what its step actually waits for, at the hosted cost of a CDP read
// (measured ~400ms at a20fcd7 -- an observation costs a rendered FRAME, not a millisecond, which is
// why an iteration-count loop is never a budget). They are then all clamped by subjectLifetime, so
// the sum can never outlive the corpse no matter how the retries compose.
const BODY_UP_BUDGET_MS = RESPAWN_SECONDS * 1000 + 4_000; // a 2s respawn, plus room for slow reads
const APPROACH_BUDGET_MS = 20_000;      // a 6.7m walk was 16 rendered frames hosted
const PANEL_STATE_BUDGET_MS = 6_000;    // a DOM flip on the frame after the click
const WIRE_CONFIRM_BUDGET_MS = 6_000;   // client -> server -> next snapshot -> presenter's frame
const RECEIPT_BUDGET_MS = 8_000;        // the same round trip, plus the toast/pulse it drives
// What still has to happen after any approach: open the panel, take one item and see its receipt,
// Take All and see its receipt, then the closing prompt/glow assertions. An approach may never spend
// this, which is the exact mistake that produced the a20fcd7 red.
const TAIL_RESERVE_MS = 20_000;         // the closing prompt/glow/panel-state assertions
const AFTER_APPROACH_RESERVE_MS = PANEL_STATE_BUDGET_MS
  + 2 * (WIRE_CONFIRM_BUDGET_MS + RECEIPT_BUDGET_MS) + TAIL_RESERVE_MS;
// By the time Take All is recovering, only ONE collect and its receipt are still ahead, so holding
// back the reserve for two would refuse an approach the corpse can actually still afford.
const LAST_COLLECT_RESERVE_MS = PANEL_STATE_BUDGET_MS
  + WIRE_CONFIRM_BUDGET_MS + RECEIPT_BUDGET_MS + TAIL_RESERVE_MS;
const server = await startOwnedServer({
  rewardStorePath: REWARD_STORE_PATH,
  guaranteedCorpseItemIds: FIXTURE_ITEM_IDS,
});
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
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
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

const touch = (page, type, points) => page.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map((point, index) => ({ x: point.x, y: point.y, id: point.id ?? index })),
});

// WHY THIS FILE TAKES SO FEW SCREENSHOTS NOW. Two of them used to sit inside the window this suite
// exists to measure -- one between the LOOT prompt and the panel opening, one between the two
// collects -- and hosted they cost 1.9s and ~2s of a hero standing in a modal that has taken away
// his movement and his attack, next to a wolf biting for 10 into 30 HP. They were deleted rather
// than moved: what they showed is carried better, and at zero cost to the hero, by the structured
// detail every check already prints (row taken-state, the server's own wire view, the element
// actually under the tap, serverGap, hp, downSeconds). AGENTS.md is explicit that running-game
// pixels are the appearance authority and a machine screenshot cannot visually accept anything, so
// these artifacts were only ever diagnostics -- and they were worse diagnostics than the numbers.
//
// A shutter is not free and it is not fast: on a software rasterizer Page.captureScreenshot costs
// eight rendered frames -- 1628-2627ms measured, docs/MISTAKES.md GQ-021. This suite now reports how
// long a child's loot takes, so the harness has to be able to say how much of that span was its own
// camera rather than the game. Otherwise the next reader re-derives a timing conclusion from a
// number that is partly a photograph.
let shutterMs = 0;
async function shot(page, name) {
  const startedAt = Date.now();
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT + name, Buffer.from(data, 'base64'));
  shutterMs += Date.now() - startedAt;
}

// ── boot ──────────────────────────────────────────────────────────────────────────────────────
const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
const browser = new CDP(version.webSocketDebuggerUrl);
await browser.ready();
const existing = await browser.send('Target.getTargets');
for (const target of existing.targetInfos) {
  if (target.type === 'page' && target.url.startsWith(ORIGIN_UNDER_TEST)) {
    await browser.send('Target.closeTarget', { targetId: target.targetId });
  }
}
const targetId = (await browser.send('Target.createTarget', { url: 'about:blank' })).targetId;
const page = await pageFor(browser, targetId);
await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
await page.send('Page.navigate', { url: URL_UNDER_TEST });

const consoleErrors = [];
page.ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(message.params.exceptionDetails.text);
  }
});
await page.send('Runtime.enable');

// play-fight.mjs's own convention, adopted here for the reason this file learned the hard way: it
// passed locally five runs in a row and still went red hosted, because everything that broke it was
// latency-shaped and a fast desktop hides that entirely. Unset (1x) in normal use and in CI -- the
// hosted runner supplies its own contention.
//
// WHAT THIS KNOB IS NOT, corrected here because believing otherwise is what let the a20fcd7 defect
// ship. This comment used to claim 6x "reproduces something near the hosted judging regime", and the
// PR body reported "1x 24/24, 6x 24/24, 12x 24/24 (harsher than hosted)" as evidence. Measured on
// 2026-08-30 against the hosted run that then failed: at 12x the whole post-corpse loot sequence
// finished in 13.2s, and hosted the same sequence took 188.6s -- fourteen times longer. At 20x and
// 40x the client cannot even boot inside 30s, a failure mode hosted has never shown (its boot took
// 7s on the run whose fight then took 109s). There is no setting of this knob that produces the
// hosted shape, because throttling scales the RENDERER while the server's own timers -- the corpse's
// CORPSE_LOOT_EXPIRE_SECONDS, the wolf's respawn -- keep running at real wall-clock speed, and it
// slows boot and fight uniformly where a contended runner does not. Use it to reproduce STARVATION
// (a stationary hero whiffing on facing, an input pulse spanning no frame). Do not read a green run
// at any multiplier as evidence about elapsed time. For that, read the claimAge this file now
// prints at every phase.
const CPU_THROTTLE = Number(process.env.GALAQUEST_CPU_THROTTLE ?? 1);
if (CPU_THROTTLE > 1) {
  await page.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  console.log(`  CPU throttled ${CPU_THROTTLE}x (GALAQUEST_CPU_THROTTLE)`);
}

const booted = await waitFor(
  page, 'Boolean(window.__galaQuestRuntime?.hero && window.__galaQuestRuntime.netState().status === "online")',
  'client boots and joins the owned server', 30_000,
);
check('serving THIS worktree (owned server, isolated port)', true, `${URL_UNDER_TEST} (pid ${server.child.pid})`);
check('boot raised no uncaught exception (the new corpse-loot imports/DOM wiring load cleanly)',
  consoleErrors.length === 0, consoleErrors.join(' | '));

// ── fast, RNG-independent wiring sanity: every new DOM node main.js is supposed to have appended
// exists in the real page and starts in its correct hidden/closed state, before any fight happens
// at all. Cheap and deterministic, unlike the corpse-roll evidence below.
if (booted) {
  const wiring = await page.eval(`(() => JSON.stringify({
    interactExists: Boolean(document.querySelector('#corpse-loot-interact')),
    interactHiddenAtBoot: document.querySelector('#corpse-loot-interact')?.dataset.shown === 'false',
    panelExists: Boolean(document.querySelector('#corpse-loot-panel-layer')),
    panelClosedAtBoot: document.querySelector('#corpse-loot-panel-layer')?.dataset.shown === 'false',
    toastLayerExists: Boolean(document.querySelector('#corpse-loot-toast-layer')),
    heroButtonExists: Boolean(document.querySelector('#hero-button')),
  }))()`).then(JSON.parse);
  check('the Loot prompt element exists in the real DOM, hidden at boot',
    wiring.interactExists && wiring.interactHiddenAtBoot, JSON.stringify(wiring));
  check('the loot panel element exists in the real DOM, closed at boot',
    wiring.panelExists && wiring.panelClosedAtBoot, JSON.stringify(wiring));
  check('the acquired-item toast layer exists in the real DOM',
    wiring.toastLayerExists, JSON.stringify(wiring));

  // REGRESSION GUARD, from a defect this package actually shipped and drive-drop-collect caught by
  // accident: the CLOSED loot panel is hidden with `opacity: 0`, and an opacity-0 element is still
  // hit-testable, so an unconditional `pointer-events: auto` on the panel left an invisible Take All
  // button sitting over the middle of the screen eating every tap that landed there. Nothing in the
  // loot flow notices -- the panel opens and collects perfectly well either way -- which is exactly
  // why it needs its own assertion rather than trusting the flow above to surface it.
  const centreOwner = await page.eval(`(() => {
    const el = document.elementFromPoint(${Math.round(VIEWPORT.width / 2)}, ${Math.round(VIEWPORT.height / 2)});
    return JSON.stringify({
      tag: el ? el.tagName + (el.id ? '#' + el.id : '') : 'nothing',
      insideLootPanel: Boolean(el && el.closest('#corpse-loot-panel-layer')),
    });
  })()`).then(JSON.parse);
  check('the CLOSED loot panel does not swallow taps at the centre of the screen',
    centreOwner.insideLootPanel === false, `centre owned by ${centreOwner.tag}`);
}

// TARGET: the authored starter Wolf, read through in-page-driver.js's own shared authoredWolfSource()
// helper -- the SAME enemy, resolved the same way, that drive-drop-collect / drive-lifecycle /
// drive-first-level-up all kill green on the hosted matrix today.
//
// WHY THIS CHANGED, causally. This file used to hunt frost-wolf-1 purely for its 20% gear chance (a
// common wolf's own gearChance is 0), which cost it two things at once. It had to walk to (-8, 42.5)
// and then hold station inside ATTACK_REACH * 0.6 = 1.02m against a MOVING wolf before every single
// swing. On a hosted runner -- 26 headless browser jobs sharing one ubuntu-latest box -- it could not:
// the hosted log for dd7ce2e shows attempt 1 spending the file's ENTIRE five-minute budget to land 45
// swings, i.e. ~6.7s per swing, nearly all of it inside the 2.5s re-approach that kept failing to
// close the gap. Zero kills hosted; 7 kills locally. The swings were not whiffing on the dice, they
// were whiffing on DISTANCE, and no amount of extra swing budget or luck fixes that.
//
// So both halves of that are gone. The gear roll no longer decides whether this file can test
// anything (see FIXTURE_ITEM_IDS above -- the server hands over a fixed claim), which frees the target
// to be the near-spawn wolf every other harness already kills reliably, using drop-collect's own
// proven approach tolerances (close to 1.2m, only re-walk past 1.4m) rather than a 1.02m one that only
// ever held on a fast local machine.

if (booted) {
  // ── fight the target enemy to death, real combat, real timing ─────────────────────────────────
  const fightState = () => page.eval(`(() => {
    const r = window.__galaQuestRuntime;
    const enc = r.authoritativeEncounterState();
    const authored = ${authoredWolfSource()};
    const wolf = (enc?.enemies ?? []).find((e) => e.enemyId === authored.enemyId) ?? null;
    const selfId = r.netState().selfId;
    const ownHero = selfId != null ? (enc?.heroes ?? {})[selfId] : null;
    return JSON.stringify({
      heading: r.follow.heading,
      heroPos: [+r.player.position.x.toFixed(3), +r.player.position.z.toFixed(3)],
      serverPos: r.netState().serverSelf ? [+r.netState().serverSelf.x.toFixed(3), +r.netState().serverSelf.z.toFixed(3)] : null,
      selfId,
      wolf,
      corpses: enc?.corpses ?? [],
      heroHp: ownHero?.hp ?? null,
      heroDownSeconds: ownHero?.downSeconds ?? 0,
    });
  })()`).then(JSON.parse);

  const ATTACK_X = VIEWPORT.width - 68;
  const ATTACK_Y = VIEWPORT.height - 68;

  // FIGHT ON THE HELD STICK, ATTACK TAPS RIDING ON TOP. This is the choreography drive-lifecycle,
  // drive-marks, drive-first-level-up and play-fight all carry, and it is here for the reason
  // drive-lifecycle's own comment records: a "walk, stop, tap" loop STARVES on a hosted runner,
  // because a stationary hero whiffs on FACING -- he swings where his body points and only turns
  // while he is moving. That is not a hypothesis about this file, it is what its own hosted run at
  // ab305e8 measured: the wolf finished on hp=30 of 30, untouched, after 9 taps. Locally the same
  // code killed in 8-13 swings, which is exactly how a latency-shaped defect hides.
  //
  // So the stick is HELD at the walk deflection for the whole fight (steered every frame from INSIDE
  // the page by startWalk, immune to CDP round-trip latency), and each ATTACK is a second touch point
  // pressed and released on top of it. touchStart's touchPoints are the full active set (Chrome
  // presses only the new one) and touchEnd's are the points being RELEASED, so the tap's end names
  // the attack point alone and the hero never stops walking into contact. There is deliberately no
  // knockdown branch: the rules ignore held input on a down body, and the respawned hero walks
  // himself back into the fight on the same hold.
  const WOLF_TARGET = authoredWolfSource();
  const stickX = VIEWPORT.width * 0.18;
  const stickY = VIEWPORT.height * 0.86;
  const FIGHT_STICK_POINT = () => ({
    x: stickX, y: stickY - Math.round(STICK_RADIUS_PX * RUN_DEFLECTION), id: 1,
  });
  console.log('  walking to the authored wolf on a held stick...');
  await page.eval(startWalk(WOLF_TARGET, 0));
  await touch(page, 'touchStart', [{ x: stickX, y: stickY, id: 1 }]);
  await touch(page, 'touchMove', [FIGHT_STICK_POINT()]);

  let state = await fightState();
  let swings = 0;
  // WHEN WAS THE CORPSE BORN? The harness cannot ask: ageSeconds is deliberately server-only
  // bookkeeping and never rides the wire (net/protocolCore.js's own comment), and widening the wire
  // to make a test's arithmetic easier would be changing the product for the instrument. So it has
  // to be anchored on a structural event this file can actually observe -- and the obvious one,
  // "when I first SAW the corpse", is the exact stopwatch error docs/MISTAKES.md GQ-021 records
  // drive-lifecycle making (it timed a 10s respawn at 0.26s because the clock started when a poll
  // NOTICED the corpse). This loop only reads every third swing, so the wolf can be dead for ~12
  // hosted seconds before the harness knows.
  //
  // Anchor on the LAST READ THAT STILL SHOWED THE WOLF ALIVE instead. The corpse cannot possibly
  // predate that instant, so every budget derived from it under-estimates the life remaining rather
  // than over-estimating it -- the direction an instrument must err in when it is spending the
  // subject it is measuring.
  let wolfLastSeenAliveAt = Date.now();
  try {
    const killDeadline = deadlineAfter(180_000);
    while (Date.now() < killDeadline && state.wolf && state.wolf.hp > 0) {
      await touch(page, 'touchStart', [FIGHT_STICK_POINT(), { x: ATTACK_X, y: ATTACK_Y, id: 2 }]);
      await sleep(60);
      await touch(page, 'touchEnd', [{ x: ATTACK_X, y: ATTACK_Y, id: 2 }]);
      swings += 1;
      await sleep(120);
      if (swings % 3 === 0) {
        const readAt = Date.now();
        state = await fightState();
        if (state.wolf && state.wolf.hp > 0) wolfLastSeenAliveAt = readAt;
      }
    }
  } finally {
    await page.eval(STOP_WALK);
    await touch(page, 'touchEnd', [FIGHT_STICK_POINT()]);
  }
  state = await fightState();
  // THE CAUSAL TIMELINE, printed at the end. The Production Director's question about this suite is
  // not "did it pass" but "how long does a child's loot actually take, measured against the wolf's
  // own 10-second respawn" -- and no previous run could answer it, which is why an artificial
  // approach target survived three hosted cycles unnoticed. `kill` is the instant the harness
  // CONFIRMED the wolf dead (it polls every third swing, so the real death is a little earlier --
  // stated rather than smoothed over, and it makes every span below a conservative over-estimate).
  const timeline = { kill: Date.now(), prompt: null, panelOpen: null, firstTakeTouch: null };
  // Each stamp also records the shutter total as of that moment, so every span below can be reported
  // BOTH raw and net of this harness's own camera. Without that, a reader cannot tell a slow game
  // from a slow instrument -- which is the entire mistake this suite has now made three times.
  const shutterAt = { kill: 0, prompt: null, panelOpen: null, firstTakeTouch: null };
  const stamp = (key) => {
    if (timeline[key] != null) return;
    timeline[key] = Date.now();
    shutterAt[key] = shutterMs;
  };
  check('the authored wolf is dead by real taps over the real socket',
    !state.wolf || state.wolf.hp <= 0,
    `hp=${state.wolf?.hp ?? 'gone'}, swings=${swings}`);

  // GATING, not best-effort, and that is the whole point of this pass. The corpse's own CONTENTS are
  // a fixture (FIXTURE_ITEM_IDS), so "did a corpse with my personal claim appear" is now a
  // deterministic consequence of the kill rather than a 20% coin flip -- which means a red here is a
  // real regression in eligibility/claim/wire, exactly the signal a gate:true suite is supposed to
  // carry. Polled rather than read once: the corpse rides the next server snapshot, not the kill tick.
  let corpse = null;
  for (let i = 0; i < 40 && !corpse; i += 1) {
    const look = await fightState();
    corpse = look.corpses.find((c) => c.claims.some((claim) => claim.heroId === look.selfId)) ?? null;
    if (!corpse) await sleep(250);
  }
  // The corpse is now dying on the server's own clock. Every wait from here to the last assertion
  // is spending it, so every wait is budgeted against it rather than against a constant.
  const claimLife = subjectLifetime({
    bornAtMillis: wolfLastSeenAliveAt, lifetimeSeconds: CORPSE_LOOT_EXPIRE_SECONDS,
  });
  const claimLeft = () => `claimAge=${claimLife.elapsedSeconds()}s of ${CORPSE_LOOT_EXPIRE_SECONDS}s`;
  check('a real corpse carrying THIS hero\'s own personal claim appeared after the kill',
    corpse != null, corpse ? `corpse ${corpse.id}, ${claimLeft()}` : 'no corpse on the wire within 10s of the kill');

  if (corpse) {
    const selfId = (await fightState()).selfId;
    const claimItem = corpse.claims.find((c) => c.heroId === selfId)?.items?.[0];
    console.log(`  corpse=${corpse.id} claimed item=${claimItem?.itemId}`);

    // ── walk to the corpse, watch the player-specific glow/prompt appear ──────────────────────────
    // Same in-page steering as the fight above, and for the same latency reason: a CDP-pulsed walk
    // that has to land inside CORPSE_LOOT_INTERACT_RADIUS_METERS is exactly the kind of precision
    // that holds locally and starves hosted. startWalk recomputes the heading every rendered frame
    // inside the page; the harness only holds the stick and waits for its own arrival report.
    // WAIT FOR THE BODY TO BE BACK UP FIRST. A 27-swing hosted fight is long enough to be knocked
    // down at the end of it, and a downed hero is reseated at HERO_SPAWN -- so walking "to the
    // corpse" while down either steers a body that ignores input or starts the walk from across the
    // map. This is setup, not leniency: the prompt assertion below is unchanged and still gates.
    // Budgeted on RESPAWN_SECONDS, the thing it is actually waiting for, and polled with a small
    // eval rather than the whole fightState() blob. The old shape was `60 iterations of a large eval
    // plus a 500ms sleep` -- an iteration count, not a budget, and hosted at ~400ms per CDP read
    // that is up to 54 seconds spent on a 2-second respawn. It was the single largest consumer of
    // the corpse's life in the a20fcd7 run.
    const bodyUpDeadline = deadlineAfter(claimLife.budgetFor(BODY_UP_BUDGET_MS));
    for (;;) {
      const live = await page.eval(`(() => {
        const r = window.__galaQuestRuntime;
        const net = r.netState();
        const me = net.selfId != null ? (r.authoritativeEncounterState()?.heroes ?? {})[net.selfId] : null;
        return JSON.stringify({ down: me?.downSeconds ?? 0, hp: me?.hp ?? null });
      })()`).then(JSON.parse);
      if (live.down <= 0 && (live.hp ?? 1) > 0) break;
      if (Date.now() >= bodyUpDeadline) break;
      await sleep(200);
    }

    // RELEASE THE THUMB IN THE PAGE, and converge in passes.
    //
    // The first hosted attempt at this stopped the hero with a CDP touchEnd once the harness noticed
    // arrival, and it failed in the exact shape in-page-driver.js's own header documents from
    // drive-village at 40x: the walk latched at closestMetres 1.29m and the very next reading put the
    // hero at 2.63m, outside the 2.5m ring, because on a starved page the round trip back out is two
    // frames and the hero keeps running at RUN_DEFLECTION the whole time. A loop cannot converge when
    // every pass overshoots by more than the ring it is aiming at.
    //
    // releaseOnArrival lifts the thumb on the latch frame itself, from inside the page -- the same
    // pointerup the harness's own touchEnd produces, one frame earlier. Passes are then re-issued
    // until the RENDERED hero (the position nearestLootableCorpse actually reads) is genuinely inside
    // the ring, rather than trusting a single pass to land it.
    const stickDown = { x: VIEWPORT.width * 0.18, y: VIEWPORT.height * 0.86, id: 1 };
    const stickPush = {
      x: VIEWPORT.width * 0.18,
      y: VIEWPORT.height * 0.86 - Math.round(STICK_RADIUS_PX * RUN_DEFLECTION),
      id: 1,
    };
    let walkReport = null;
    // Reusable, because the hero does not necessarily STAY put. wolf-1 respawns on its own
    // ENEMY_KIND_RESPAWN_SECONDS clock at the home it died at -- i.e. next to its own corpse -- so on
    // a slow runner, where the whole loot sequence takes tens of seconds instead of two, the fight
    // starts again underneath the open panel and can shove or knock the hero out of the ring
    // mid-loot. The server then refuses the collect on reach and says nothing about it
    // (gameServerCore's own `if (!accepted) return;`), which presents as a tap that did nothing.
    // BUDGETED AGAINST THE CORPSE, NOT AGAINST ITSELF. This used to carry a flat 60-second deadline,
    // and it is called from the prompt loop, the panel-open loop and every collect retry -- so two
    // unlucky invocations could spend two thirds of a claim that only lives 180 seconds. That is
    // exactly what happened at a20fcd7. It now takes what a real approach costs (a 6.7m walk was 16
    // rendered frames hosted), clamped by what the corpse has left, and reserving the time the
    // panel/collect/receipt steps after it still need.
    // THE READINESS CONDITION IS THE PRODUCT'S, NOT A NUMBER THIS FILE PICKED. Every approach here
    // used to walk until the hero was inside 1.2m -- a harness-only target less than half the real
    // CORPSE_LOOT_INTERACT_RADIUS_METERS (2.5). Hosted at 1712131 the walk report reads
    // `startMetres: 1.376`: the hero was ALREADY legally lootable, the prompt could already have been
    // offered, and the harness spent eight more rendered frames closing a gap the product does not
    // ask a child to close. With the wolf's authored respawn at 10s, that self-inflicted delay is
    // enough to manufacture the very respawn collision the run was blaming.
    //
    // So readiness is now "is the real LOOT affordance actually offered", which is main.js's own
    // nearestLootableCorpse(heroId, corpses, RENDERED position) decision, read straight off the DOM
    // the child would be looking at. If it is already true, this returns without walking at all.
    const promptOfferedNow = () => page.eval(
      "document.querySelector('#corpse-loot-interact')?.dataset.shown === 'true'",
    );
    const approachCorpse = async ({
      readyNow = promptOfferedNow, reserveMillis = AFTER_APPROACH_RESERVE_MS,
    } = {}) => {
      const approachDeadline = deadlineAfter(claimLife.budgetFor(
        APPROACH_BUDGET_MS, { reserveMillis },
      ));
      for (let pass = 0; pass < 8; pass += 1) {
        if (await readyNow()) return true;
        if (Date.now() >= approachDeadline) return false;
        await page.eval(startWalk(`({ x: ${corpse.x}, z: ${corpse.z} })`, 1.0, { releaseOnArrival: true }));
        await touch(page, 'touchStart', [stickDown]);
        await touch(page, 'touchMove', [stickPush]);
        try {
          // Never past the loop's own budget: a pass that outlives its deadline puts the whole
          // clamp back where it started.
          const passDeadline = Math.min(deadlineAfter(20_000), approachDeadline);
          for (;;) {
            // Stop the instant the product says it is ready, not when the walk reaches some closer
            // place the product never asked for. A child stops walking when LOOT appears.
            if (await readyNow()) break;
            walkReport = await page.eval(READ_WALK).then((raw) => JSON.parse(raw ?? 'null'));
            if (walkReport?.arrived || Date.now() >= passDeadline) break;
            await sleep(120);
          }
        } finally {
          await page.eval(STOP_WALK);
          await touch(page, 'touchEnd', []);
        }
        await sleep(300); // let the release land and the body settle before re-measuring
      }
      return readyNow();
    };
    await approachCorpse();

    // MEASURE THE APPROACH, and assert it against the rule's OWN constant rather than a number typed
    // here. This is its own gating check for a reason beyond tidiness: when the prompt failed hosted
    // at 469dc46 the log could not say whether the hero was out of range, downed, or standing right
    // on the corpse with a broken presenter -- three very different defects that all look identical
    // as "prompt did not appear". Now the run reports which one it was.
    // Measured against the position the RULE ITSELF READS, not the one that is convenient to read
    // here. main.js calls nearestLootableCorpse(heroId, corpses, player.position) -- the RENDERED
    // hero, not the server's. Those two diverge exactly when a runner is loaded, which is exactly
    // when this suite has historically failed, so asserting the server distance would be asserting
    // the wrong axis and could pass while the prompt legitimately stays hidden.
    const approach = await page.eval(`(() => {
      const r = window.__galaQuestRuntime;
      const net = r.netState();
      const enc = r.authoritativeEncounterState();
      const mine = (enc?.corpses ?? []).find((c) => c.id === ${JSON.stringify(corpse.id)}) ?? null;
      const claim = mine?.claims?.find((c) => c.heroId === net.selfId) ?? null;
      return JSON.stringify({
        netStatus: net.status,
        selfIdPresent: net.selfId != null,
        corpseOnWire: Boolean(mine),
        untakenItems: claim ? claim.items.filter((i) => !i.taken).length : null,
        rendered: [+r.player.position.x.toFixed(2), +r.player.position.z.toFixed(2)],
        server: net.serverSelf ? [+net.serverSelf.x.toFixed(2), +net.serverSelf.z.toFixed(2)] : null,
      });
    })()`).then(JSON.parse);
    const renderedGap = Math.hypot(approach.rendered[0] - corpse.x, approach.rendered[1] - corpse.z);
    const serverGap = approach.server
      ? Math.hypot(approach.server[0] - corpse.x, approach.server[1] - corpse.z) : Infinity;
    const approachDetail = `renderedGap=${renderedGap.toFixed(2)}m serverGap=${serverGap.toFixed(2)}m `
      + `of ${CORPSE_LOOT_INTERACT_RADIUS_METERS}m, ${claimLeft()}, `
      + `corpse=(${corpse.x.toFixed(2)}, ${corpse.z.toFixed(2)}), `
      + `${JSON.stringify(approach)} walk=${JSON.stringify(walkReport)}`;
    check('the hero really walked inside the corpse\'s own interact radius, measured on the '
      + 'RENDERED position the prompt rule itself reads',
      renderedGap <= CORPSE_LOOT_INTERACT_RADIUS_METERS, approachDetail);

    // A: the PHYSICAL "this loot is yours" signal, asserted against the real rendered scene object
    // rather than a DOM proxy for it -- world/corpseLootGlowPresenter.js names its sprite
    // `corpse-loot-glow-<corpseId>` and parents it into the live three.js scene. Existence alone is
    // deliberately not enough (docs/MISTAKES.md: a state check can pass against a subject that is
    // scaled to nothing or parked off camera), so this also measures where the glow actually SITS and
    // requires it to be standing over this corpse.
    const glow = await page.eval(`(() => {
      const sprite = window.__galaQuestRuntime.scene.getObjectByName(${JSON.stringify(`corpse-loot-glow-${corpse.id}`)});
      if (!sprite) return JSON.stringify({ present: false });
      const world = new (sprite.position.constructor)();
      sprite.getWorldPosition(world);
      return JSON.stringify({ present: true, visible: sprite.visible, x: +world.x.toFixed(2), z: +world.z.toFixed(2) });
    })()`).then(JSON.parse);
    const glowOffset = glow.present ? Math.hypot(glow.x - corpse.x, glow.z - corpse.z) : Infinity;
    check('a personal loot glow is really in the scene, standing over THIS corpse',
      glow.present && glow.visible !== false && glowOffset < 1.0,
      `${JSON.stringify(glow)} corpse=(${corpse.x.toFixed(2)}, ${corpse.z.toFixed(2)}) offset=${glowOffset.toFixed(2)}m`);

    // Keep the PRECONDITION alive while waiting for the prompt. The hosted reconciliation run at
    // 1109b4f took 67 seconds between the kill and the first settled corpse approach; wolf-1 had
    // therefore respawned beside its own corpse many times over before this assertion ran. The same
    // file already documents that the respawned wolf can shove or knock the hero out of the server's
    // reach between loot taps, and collectWithRetry below re-approaches for exactly that reason.
    //
    // The old prompt check did not. It measured renderedGap=2.04m once, then waited ten seconds while
    // the live wolf kept moving the hero and reported that STALE 2.04m value when the prompt failed.
    // That cannot distinguish "presenter is broken while genuinely in range" from "the moving world
    // invalidated the harness's setup before the next rendered frame". Re-establishing the real
    // in-range condition is not leniency: every attempt still requires the production presenter to
    // set data-shown=true while the hero is actually inside the imported production radius.
    const readPromptState = () => page.eval(`(() => {
      const r = window.__galaQuestRuntime;
      const net = r.netState();
      const enc = r.authoritativeEncounterState();
      const mine = (enc?.corpses ?? []).find((c) => c.id === ${JSON.stringify(corpse.id)}) ?? null;
      const claim = mine?.claims?.find((c) => c.heroId === net.selfId) ?? null;
      const p = r.player.position;
      const renderedGap = Math.hypot(p.x - ${corpse.x}, p.z - ${corpse.z});
      const me = net.selfId != null ? (enc?.heroes ?? {})[net.selfId] : null;
      return JSON.stringify({
        shown: document.querySelector('#corpse-loot-interact')?.dataset.shown === 'true',
        panelOpen: document.querySelector('#corpse-loot-panel-layer')?.dataset.shown === 'true',
        renderedGap: +renderedGap.toFixed(3),
        netStatus: net.status,
        corpseOnWire: Boolean(mine),
        untakenItems: claim ? claim.items.filter((i) => !i.taken).length : null,
        hp: me?.hp ?? null,
        downSeconds: me?.downSeconds ?? null,
      });
    })()`).then(JSON.parse);

    let promptShown = false;
    let promptEvidence = null;
    let promptAttempts = 0;
    for (; promptAttempts < 4 && !promptShown; promptAttempts += 1) {
      // approachCorpse's own readiness IS the prompt now, so a hero already in range returns from
      // this without walking, and the poll below usually finds it already true on its first read.
      await approachCorpse();
      const promptDeadline = deadlineAfter(4_000);
      while (Date.now() < promptDeadline) {
        promptEvidence = await readPromptState();
        if (promptEvidence.shown) { promptShown = true; break; }
        // If the live enemy moved the hero back outside the rule's own radius, re-approach now
        // rather than spending the rest of this attempt polling a precondition that is no longer true.
        if (promptEvidence.renderedGap > CORPSE_LOOT_INTERACT_RADIUS_METERS) break;
        await sleep(100);
      }
    }
    if (promptShown) stamp('prompt');
    promptEvidence ??= await readPromptState();
    check('B: the "Loot" affordance became available standing near this hero\'s own claim',
      promptShown, `${approachDetail} promptAttempts=${promptAttempts} current=${JSON.stringify(promptEvidence)}`);

    if (promptShown) {
      // ── open the panel via a REAL TOUCH DISPATCH, no hover involved at all ─────────────────────
      // Retried for the same reason the collects below are, and after the same hosted evidence: at
      // f45e392 this single-shot tap failed to open the panel on a run where the hero was a measured
      // 1.10m from the corpse with the prompt already up, having opened perfectly on the two hosted
      // runs before it. Every unretried single tap in this file has now been observed to drop at
      // least once on a loaded runner. The assertion is unchanged -- the panel still has to actually
      // open, by real touch, and a child whose first tap does nothing taps again.
      const panelIsOpen = () => page.eval(
        "document.querySelector('#corpse-loot-panel-layer')?.dataset.shown === 'true'",
      );
      // Wait on the panel's own state with a real deadline, not an iteration count. `25 iterations
      // of an eval plus a 200ms sleep` reads as 5 seconds and cost 15 hosted, for a DOM flip that
      // lands on the frame after the click.
      const awaitPanelState = async (wantOpen) => {
        const deadline = deadlineAfter(claimLife.budgetFor(PANEL_STATE_BUDGET_MS));
        for (;;) {
          if ((await panelIsOpen()) === wantOpen) return true;
          if (Date.now() >= deadline) return false;
          await sleep(120);
        }
      };
      // One real tap on the real Loot prompt. Extracted because the collect recovery below has to
      // re-open the panel too, and it must do it the same way a child does rather than by some
      // second, easier route.
      const openPanelByTouch = async () => {
        const promptRect = await page.eval(
          "(() => { const el = document.querySelector('#corpse-loot-interact');"
          + " if (!el || el.dataset.shown !== 'true') return 'null';"
          + " const r = el.getBoundingClientRect();"
          + " return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()",
        );
        if (promptRect === 'null') { await sleep(300); return false; }
        const point = JSON.parse(promptRect);
        await touch(page, 'touchStart', [point]);
        await sleep(80);
        await touch(page, 'touchEnd', []);
        return awaitPanelState(true);
      };
      // SET THE OBSERVERS UP BEFORE THE PANEL OPENS, not after. They watch #corpse-loot-toast-layer
      // and #hero-button, both of which exist from boot, so nothing about them needs an open panel --
      // and doing it here takes one more CDP eval out of the panel-open -> first-TAKE window, which
      // is the window a child spends unable to move or fight. It is also strictly safer: an observer
      // armed earlier cannot miss a toast that arrives sooner than expected.
      // Watch the toast layer from INSIDE the page across the whole collect sequence. The toast is
      // deliberately short-lived, and a CDP poll that happens to land between two reads would miss
      // it and report a defect that is not there -- so record arrivals as they happen instead.
      // The Hero-button pulse is watched the SAME way and for the same reason. It was originally
      // polled ("reset the attribute, then look for 'true' every 100ms"), which held at 1x and 6x
      // and then missed at 12x: the flip is short-lived, and a poll that lands either side of it
      // reports a defect that is not there. Observing the attribute records the transition whenever
      // it happens, so this check measures the game rather than the harness's own sampling luck.
      await page.eval(`(() => {
        window.__corpseToasts = [];
        window.__corpsePulses = 0;
        const layer = document.querySelector('#corpse-loot-toast-layer');
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node.classList?.contains('corpse-loot-toast')) {
                window.__corpseToasts.push((node.textContent ?? '').trim());
              }
            }
          }
        }).observe(layer, { childList: true });
        const heroButton = document.querySelector('#hero-button');
        new MutationObserver(() => {
          if (heroButton.dataset.lootPulse === 'true') window.__corpsePulses += 1;
        }).observe(heroButton, { attributes: true, attributeFilter: ['data-loot-pulse'] });
        // Did a real click ever reach a loot control? Capture phase on the layer, so it counts the
        // click whatever the button then does with it.
        window.__corpseClicks = 0;
        document.querySelector('#corpse-loot-panel-layer').addEventListener('click', (event) => {
          if (event.target.closest('.corpse-loot-item-take, #corpse-loot-panel-take-all')) {
            window.__corpseClicks += 1;
          }
        }, true);
      })()`);

      let panelOpen = false;
      let openAttempts = 0;
      for (; openAttempts < 4 && !panelOpen; openAttempts += 1) {
        if (openAttempts > 0) await approachCorpse();
        panelOpen = await openPanelByTouch();
      }
      if (panelOpen) stamp('panelOpen');
      check('C: tapping Loot by real touch (no hover anywhere) opened the corpse loot panel',
        panelOpen, `attempts=${openAttempts}, ${claimLeft()}`);

      if (panelOpen) {
        // ONE eval, not three, and NO SCREENSHOT, because everything between the panel opening and
        // the first TAKE touch is time a child spends standing in a modal that has taken away their
        // movement and their attack -- with a respawned wolf biting. This window is now the suite's
        // central measurement, so the harness must not be the thing filling it.
        //
        // The screenshot in particular used to sit right here. `Page.captureScreenshot` on a software
        // rasterizer costs eight rendered frames -- measured 1628-2627ms in docs/MISTAKES.md GQ-021 --
        // which at a wolf bite of 10 against 30 HP is a meaningful slice of the hero's whole life.
        // It is gone from this window entirely: `corpse-loot-individual-take.png`, taken the moment
        // the first collect confirms, already shows a real open populated panel, so nothing is lost
        // but the delay. Every remaining shutter in this file is timed and reported below.
        //
        // The stick-owner probe rides along in the same eval rather than costing its own frame. It is
        // RECORDED, not asserted: it is intended modal behaviour, and it is the single fact that
        // explains every recovery path below.
        const panelState = await page.eval(`(() => {
          const stickAt = document.elementFromPoint(${Math.round(VIEWPORT.width * 0.18)}, ${Math.round(VIEWPORT.height * 0.86)});
          return JSON.stringify({
            rowCount: document.querySelectorAll('.corpse-loot-item').length,
            firstRowName: (document.querySelector('.corpse-loot-item-name')?.textContent ?? '').trim(),
            stickOwner: stickAt ? stickAt.tagName + (stickAt.id ? '#' + stickAt.id : '') : 'nothing',
          });
        })()`).then(JSON.parse);
        console.log(`  with the panel open, the movement stick point is owned by ${panelState.stickOwner}`);

        const rowCount = panelState.rowCount;
        check('the panel lists one row per item on this hero\'s own claim',
          rowCount === FIXTURE_ITEM_IDS.length, `rows=${rowCount}, expected ${FIXTURE_ITEM_IDS.length}`);

        // C: a child reads a NAME, not an id. Assert the row renders a real, non-empty, human item
        // name off progression/items.js rather than an id, a blank, or "undefined" -- a panel that
        // opens but says nothing recognizable is not a loot panel a 5-year-old can use.
        const firstRowName = panelState.firstRowName;
        check('the first row presents a recognizable item NAME, not a raw id',
          firstRowName.length > 2 && !firstRowName.includes('_') && firstRowName !== 'undefined',
          `name=${JSON.stringify(firstRowName)}`);

        // Tapping reports WHAT IT HIT, not merely that it dispatched. Hosted at 141f648 both taps
        // "succeeded" by the old definition (the element existed, the events went out) and yet
        // nothing was ever collected -- taken flags [false,false], zero toasts -- which left no way
        // to tell a missed/intercepted tap from a disabled button from a click that fired and was
        // refused. So this returns the element actually under the tap point, whether the button was
        // disabled, and whether a real click landed on it.
        const tapById = async (selector) => {
          const probe = await page.eval(
            `(() => {
              const el = document.querySelector('${selector}');
              if (!el) return JSON.stringify({ found: false });
              const r = el.getBoundingClientRect();
              const x = r.left + r.width / 2;
              const y = r.top + r.height / 2;
              const hit = document.elementFromPoint(x, y);
              return JSON.stringify({
                found: true, x, y,
                w: +r.width.toFixed(1), h: +r.height.toFixed(1),
                disabled: Boolean(el.disabled),
                hitIsTarget: hit === el || Boolean(el.contains(hit)),
                hit: hit ? (hit.tagName + (hit.id ? '#' + hit.id : '') + (hit.className ? '.' + String(hit.className).split(' ')[0] : '')) : 'nothing',
                clicksBefore: window.__corpseClicks ?? 0,
                heroState: (() => {
                  const rt = window.__galaQuestRuntime;
                  const net = rt.netState();
                  const enc = rt.authoritativeEncounterState();
                  const me = net.selfId != null ? (enc?.heroes ?? {})[net.selfId] : null;
                  return {
                    server: net.serverSelf ? [+net.serverSelf.x.toFixed(2), +net.serverSelf.z.toFixed(2)] : null,
                    hp: me?.hp ?? null,
                    down: me?.downSeconds ?? null,
                  };
                })(),
              });
            })()`,
          ).then(JSON.parse);
          if (!probe.found) return { ...probe, tapped: false };
          // The instant the child's thumb lands on a loot control for the first time. This is the
          // causal observation the Production Director asked for: everything before it is how long
          // the game made the child wait, everything after it is whether the collect survived.
          stamp('firstTakeTouch');
          await touch(page, 'touchStart', [{ x: probe.x, y: probe.y }]);
          await sleep(80);
          await touch(page, 'touchEnd', []);
          await sleep(250);
          const clicksAfter = await page.eval('window.__corpseClicks ?? 0');
          return { ...probe, tapped: true, clicksAfter, clickLanded: clicksAfter > probe.clicksBefore };
        };
        // Poll for a real acquisition receipt: a toast ARRIVAL plus the Hero-button pulse. This is a
        // genuine network round trip (collect -> server grants -> next snapshot -> presenter diffs
        // it), never an optimistic local flip, so it legitimately takes a couple of 100ms ticks.
        // Deadline, not `60 iterations of two evals and a 100ms sleep`. That reads as six seconds
        // and cost 61.5s hosted at a20fcd7, then 61.2s again for Take All -- two minutes of a
        // five-minute job spent confirming receipts for collects that had already failed, which is
        // why the run's real cause was buried under six cascading reds. The observers are
        // MutationObservers recording into the page, so nothing is missed by reading them less
        // often; only the waiting is shortened.
        const awaitReceipt = async (toastsBefore, pulsesBefore) => {
          let sawToast = false;
          let sawPulse = false;
          const receiptDeadline = deadlineAfter(claimLife.budgetFor(RECEIPT_BUDGET_MS));
          for (;;) {
            const seen = await page.eval(
              `JSON.stringify([window.__corpseToasts.length > ${toastsBefore},`
              + ` window.__corpsePulses > ${pulsesBefore}])`,
            ).then(JSON.parse);
            sawToast ||= seen[0];
            sawPulse ||= seen[1];
            if ((sawToast && sawPulse) || Date.now() >= receiptDeadline) break;
            await sleep(120);
          }
          return { sawToast, sawPulse };
        };

        // Read this hero's own claim off the SERVER snapshot -- the only authority on whether a
        // collect actually happened. serverGap rides along because it is the exact quantity
        // world/corpseLoot.js's requestClaimCorpseItem tests before it refuses, and
        // net/gameServerCore.mjs answers a refusal with a bare `if (!accepted) return;` -- silently.
        // A click that landed while the hero was out of reach is therefore a request that was
        // already rejected before the confirmation poll below even began, so waiting out that
        // poll's whole budget only spends the corpse. Reading the gap here is what lets the retry
        // re-approach immediately instead. Keep corpse/claim presence separate from the item count: the
        // old numeric sentinel (-1) accidentally made an expired corpse satisfy "less than 2" and
        // falsely reported a collection after the panel had already disappeared.
        const claimOnWire = () => page.eval(`(() => {
          const r = window.__galaQuestRuntime;
          const net = r.netState();
          const enc = r.authoritativeEncounterState();
          const mine = (enc?.corpses ?? []).find((c) => c.id === ${JSON.stringify(corpse.id)}) ?? null;
          const claim = mine?.claims?.find((c) => c.heroId === net.selfId) ?? null;
          const p = net.serverSelf;
          return JSON.stringify({
            corpsePresent: Boolean(mine),
            claimPresent: Boolean(claim),
            untaken: claim ? claim.items.filter((i) => !i.taken).length : null,
            serverGap: p ? +Math.hypot(p.x - ${corpse.x}, p.z - ${corpse.z}).toFixed(2) : null,
          });
        })()`).then(JSON.parse);

        // Tap the already-visible button FIRST, then confirm against the wire. Re-walking before
        // every tap made the hosted run spend so long under the respawned wolf that the real
        // 180-second corpse lifetime elapsed; the stale, now-invisible button still had geometry and
        // its centre correctly hit the canvas. A child looking at an open panel taps it immediately.
        // Only a real landed tap that the server refused gets one recovery re-approach and retry.
        // A vanished corpse/claim is an explicit failure, never collection success.
        // RECOVERY HAS TO CLOSE THE PANEL FIRST, and this is the whole reason the previous head was
        // still red after the budgets were fixed. The loot panel is a MODAL: its layer is
        // `position: absolute; inset: 0` and flips to `pointer-events: auto` when shown, over a
        // full-screen backdrop. So while it is open it owns every touch point on the screen --
        // including the movement stick at the bottom-left, whose pointerdown the panel explicitly
        // stops from propagating to `#game`. An `approachCorpse` issued with the panel open is
        // therefore a GUARANTEED NO-OP: the stick touches land on the backdrop, the hero never
        // moves, and the loop burns its whole budget proving nothing.
        //
        // Measured hosted at 1712131: the hero opened the panel at claimAge 25.5s standing 1.11m
        // from the corpse on hp 20 of 30; wolf-1 had respawned at its authored home -- which is
        // where it died, i.e. on top of its own corpse -- 10s after the kill, and killed him while
        // the modal held every input. `hero-respawned` reseated him at HERO_SPAWN, and every probe
        // after that reads `server:[0,0], hp:30`, 7.2m away. Three taps then landed on the real
        // button (`hitIsTarget:true`, `clickLanded:true`) and the server refused all three on reach,
        // silently, while two re-approaches moved nobody.
        //
        // So recovery does what a child does: close the window, walk back, open it again. Every step
        // is a real touch on a real control; nothing here is a shortcut around the interaction.
        const recoverIntoRange = async (reserveMillis) => {
          if (await panelIsOpen()) {
            await tapById('#corpse-loot-panel-close');
            if (!(await awaitPanelState(false))) return false;
          }
          if (!(await approachCorpse({ reserveMillis }))) return false;
          return openPanelByTouch();
        };
        const collectWithRetry = async (selector, expectUntakenBelow, reserveMillis) => {
          let last = null;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            if (attempt > 0 && !(await recoverIntoRange(reserveMillis))) {
              return {
                ...last, collected: false, recovered: false, attempts: attempt + 1,
                claimAgeSeconds: claimLife.elapsedSeconds(),
              };
            }
            last = await tapById(selector);
            if (!last.found || !last.hitIsTarget || !last.clickLanded) {
              return { ...last, collected: false, attempts: attempt + 1 };
            }
            // Deadline-bounded, and abandoned the moment the server's own reach rule says the
            // request it is waiting on was already refused. The old shape polled a fixed 25 times
            // whatever happened, which hosted was ~15 seconds of waiting for a confirmation that was
            // never coming -- and then handed what was left of the corpse to a 60-second re-approach.
            const confirmDeadline = deadlineAfter(claimLife.budgetFor(WIRE_CONFIRM_BUDGET_MS));
            let outOfReach = false;
            for (;;) {
              const wire = await claimOnWire();
              if (!wire.corpsePresent || !wire.claimPresent) {
                return {
                  ...last, collected: false, expired: true, wire, attempts: attempt + 1,
                  claimAgeSeconds: claimLife.elapsedSeconds(),
                };
              }
              if (wire.untaken < expectUntakenBelow) {
                return {
                  ...last, collected: true, wire, attempts: attempt + 1,
                  claimAgeSeconds: claimLife.elapsedSeconds(),
                };
              }
              if (wire.serverGap != null && wire.serverGap > CORPSE_LOOT_INTERACT_RADIUS_METERS) {
                outOfReach = true;
                break;
              }
              if (Date.now() >= confirmDeadline) break;
              await sleep(120);
            }
            if (!outOfReach && claimLife.expired()) break;
          }
          return {
            ...last, collected: false, attempts: 3, claimAgeSeconds: claimLife.elapsedSeconds(),
          };
        };

        // ── D/E/F/G: ONE item, individually, through the real client -> server -> snapshot path ────
        const tookOne = await collectWithRetry(
          '.corpse-loot-item:not([data-taken="true"]) .corpse-loot-item-take', 2, AFTER_APPROACH_RESERVE_MS,
        );
        check('an individual TAKE really collected one item through the real wire',
          tookOne.collected === true && tookOne.clickLanded && !tookOne.disabled && tookOne.hitIsTarget,
          JSON.stringify(tookOne));
        const single = await awaitReceipt(0, 0);
        check('individual TAKE produced a short acquired-item toast', single.sawToast);
        check('individual TAKE pulsed the Hero button -- "it went to your inventory"', single.sawPulse);

        // Read the DOM rows AND the server's own wire view together. On their own, "the rows still
        // say untaken" cannot distinguish a click that never reached the server from a collect the
        // server refused (reach, ownership, a stale claim id) from a server that accepted it while
        // the panel failed to re-render -- three different defects with one symptom.
        const afterOne = await page.eval(`(() => {
          const r = window.__galaQuestRuntime;
          const net = r.netState();
          const enc = r.authoritativeEncounterState();
          const mine = (enc?.corpses ?? []).find((c) => c.id === ${JSON.stringify(corpse.id)}) ?? null;
          const claim = mine?.claims?.find((c) => c.heroId === net.selfId) ?? null;
          return JSON.stringify({
            rows: [...document.querySelectorAll('.corpse-loot-item')].map((el) => el.dataset.taken === 'true'),
            wireTaken: claim ? claim.items.map((i) => Boolean(i.taken)) : null,
            corpseOnWire: Boolean(mine),
            netStatus: net.status,
            // Read in the SAME frame as the row state, so Take All can be tapped on the very next
            // instruction. These were two separate evals; hosted that is two more rendered frames
            // the hero spends unable to move or swing, between two collects, next to a live wolf.
            toastsBefore: window.__corpseToasts.length,
            pulsesBefore: window.__corpsePulses,
          });
        })()`).then(JSON.parse);
        check('exactly the collected item stops being offered; the other is still live',
          afterOne.rows.filter(Boolean).length === 1 && afterOne.rows.length === FIXTURE_ITEM_IDS.length
          && afterOne.wireTaken?.filter(Boolean).length === 1,
          JSON.stringify(afterOne));

        // ── H + the dd7ce2e blocker: Take All now collects the LAST item on the corpse ─────────────
        // This is the case that used to produce NO receipt at all, because a fully-resolved corpse
        // retired before the snapshot carrying its own taken-transition was ever built. If that
        // regression returns, the toast assertion below goes red -- which is exactly why this file
        // takes one item individually FIRST rather than opening with Take All.
        const { toastsBefore, pulsesBefore } = afterOne;
        const tookAll = await collectWithRetry('#corpse-loot-panel-take-all', 1, LAST_COLLECT_RESERVE_MS);
        check('Take All really collected the remaining item through the real wire',
          tookAll.collected === true && tookAll.clickLanded && !tookAll.disabled && tookAll.hitIsTarget,
          JSON.stringify(tookAll));
        const takeAll = await awaitReceipt(toastsBefore, pulsesBefore);
        check('Take All on the corpse\'s LAST item still produced an acquired-item toast '
          + '(the dd7ce2e corpse-retirement receipt blocker, live)', takeAll.sawToast);
        check('Take All on the LAST item still pulsed the Hero button', takeAll.sawPulse);
        const toastText = await page.eval('JSON.stringify(window.__corpseToasts)');
        console.log(`  toast arrivals: ${toastText}`);
        await shot(page, 'corpse-loot-take-all-toast.png');

        await waitFor(
          page, "document.querySelector('#corpse-loot-panel-empty')?.hidden === false",
          'after Take All the panel itself confirms "Already looted!"', 5_000,
        );
        const stillTaken = await page.eval(
          "[...document.querySelectorAll('.corpse-loot-item')].every((el) => el.dataset.taken === 'true')",
        );
        check('every row in the panel now reads taken', stillTaken);

        const promptGoneForThisHero = await waitFor(
          page, "document.querySelector('#corpse-loot-interact')?.dataset.shown !== 'true' || document.querySelector('#corpse-loot-panel-layer')?.dataset.shown === 'true'",
          'the corpse stops advertising loot to THIS hero once they have collected their own claim', 5_000,
        );
        check('#87 required outcome: looted claim stops prompting for the collector', promptGoneForThisHero);

        // ...and the PHYSICAL glow really leaves the scene for this hero too, not merely the prompt.
        // Same object, same name, measured the same way as when it appeared above -- so this pair is
        // a real before/after on the rendered signal rather than two unrelated assertions.
        const glowGone = await waitFor(
          page,
          `!window.__galaQuestRuntime.scene.getObjectByName(${JSON.stringify(`corpse-loot-glow-${corpse.id}`)})`,
          'the personal loot glow leaves the scene once this hero has collected their own claim', 8_000,
        );
        check('#87 required outcome: the corpse stops GLOWING for the hero who collected it', glowGone);
      }
    }

    // THE CAUSAL TIMELINE. Printed unconditionally, pass or fail, because the question this suite
    // now has to answer is not "green?" but "how long does a child's loot take, against the wolf's
    // own 10-second respawn and its 10-damage bite into 30 HP". Three hosted cycles argued about
    // that without a single number for it.
    const span = (from, to) => {
      if (timeline[from] == null || timeline[to] == null) return 'n/a';
      const raw = (timeline[to] - timeline[from]) / 1000;
      const camera = (shutterAt[to] - shutterAt[from]) / 1000;
      return `${raw.toFixed(1)}s${camera > 0.05 ? ` (${(raw - camera).toFixed(1)}s net of camera)` : ''}`;
    };
    const wolfBite = wolfStatsForLevel(1).biteDamage;
    console.log(`  ── loot timeline (wolf respawn ${WOLF_RESPAWN_SECONDS}s; bite ${wolfBite} into `
      + `${HERO_MAX_HP} HP = ${Math.ceil(HERO_MAX_HP / wolfBite)} bites) ──`);
    console.log(`  kill -> LOOT prompt          ${span('kill', 'prompt')}`);
    console.log(`  prompt -> panel open         ${span('prompt', 'panelOpen')}`);
    console.log(`  panel open -> first TAKE     ${span('panelOpen', 'firstTakeTouch')}`);
    console.log(`  kill -> first TAKE touch     ${span('kill', 'firstTakeTouch')}`);
    console.log(`  of which this harness's own screenshots: ${(shutterMs / 1000).toFixed(1)}s`);

    // THE CHECK THAT WOULD HAVE NAMED THE a20fcd7 FAILURE IN ONE LINE. That run cascaded six reds --
    // TAKE hit the canvas, no toast, no pulse, rows unchanged, Take All the same, panel never
    // confirmed -- and every one of them was a true statement about a corpse that had already
    // expired 8.6 seconds earlier. Three separate hosted cycles were spent reading that cascade as
    // an interaction bug (an intercepting overlay, a stale prompt precondition, an unseeded roll)
    // because no number in the output said how much of the subject was left. An instrument that
    // consumes the thing it is measuring has to report that it did.
    check('the harness drove the whole loot sequence inside the corpse lifetime it was measuring '
      + '(a red here means the instrument outlived its subject, not that the game is broken)',
      !claimLife.expired(),
      `${claimLeft()}; every loot assertion above is only meaningful while this is under `
      + `${CORPSE_LOOT_EXPIRE_SECONDS}s`);
  }

  await shot(page, 'corpse-loot-final.png');
}

// EVERY check in this file is gating now. There is no best-effort tier left, because there is no
// unseeded roll left to be unlucky about: the corpse's contents are a fixture, so every remaining
// assertion is about the game's own behaviour and a red one is a real regression.
console.log(`\n${results.length - failures}/${results.length} checks passed`);
await browser.send('Target.closeTarget', { targetId }).catch(() => {});
const killed = await server.kill();
if (!killed) console.log('  WARNING: owned server teardown could not be confirmed');
process.exit(failures > 0 || !booted ? 1 : 0);
