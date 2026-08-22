/**
 * Drive the family profile gate in a real browser: name a first hero, add a sibling, switch between
 * them, reload, and prove each child's progression comes back as theirs.
 *
 *   node tools/runtime-test/drive-profile-gate.mjs
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * WHY THIS HARNESS EXISTS AND A UNIT TEST WOULD NOT DO. Three of the four things it proves are
 * unreachable from `node --test`:
 *
 *   1. Switching a profile RELOADS THE PAGE (main.js's switchToProfile). The whole point of the
 *      reload is that no closure, socket, prediction buffer or frame loop keeps a stale half of the
 *      previous child, and only a real page load can demonstrate that.
 *   2. The gate is DOM built at runtime, not fixed markup, so "is there a card per hero" is a
 *      question about the document.
 *   3. Isolation is a claim about storage keyed per profile surviving a real reload, which is what
 *      localStorage does and a Map in a test does not.
 *
 * And the fourth is the reason the checkpoint exists at all: a child has to be able to SEE whose
 * game this is. That part is judged by looking at the captures, not by these checks -- see
 * AGENTS.md, "running-game pixels are final appearance authority".
 *
 * ISOLATION. Every phase runs against its own OS-tmpdir reward store, threaded through
 * startOwnedServer, for the reason drive-village-board.mjs's header gives: a harness must never
 * write into data/rewards.db. Storage is cleared before the FIRST navigation of each phase
 * (GQ-008): the automation profile persists localStorage between runs, so a gate that has already
 * been answered would otherwise never show its naming screen again.
 *
 * Cribbed from drive-village-board.mjs: the CDP class, openTab's console-error capture, and
 * clickSelector's JS-level element.click() rather than a synthetic press/release pair -- the gate
 * rebuilds its card DOM on every render, which is the same hazard the Hero screen's item strip has.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAX_PROFILES } from '../../public/src/progression/profiles.js';
import { TAP_TARGET_FLOOR_PX } from '../../public/src/ui/tapTargets.js';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
const PORTRAIT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
const LANDSCAPE = { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true };

/** The floor every interactive target on this screen has to clear. Not a style preference: it is
 *  the size below which a young child's tap lands somewhere else, and the Checkpoint 0 audit found
 *  two existing controls under it. */
// (imported above -- GQ-007: the floor is a product law, not a harness opinion.)

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

async function setViewport(tab, viewport) {
  await tab.page.send('Emulation.setDeviceMetricsOverride', viewport);
}

/**
 * Navigate and wait for the runtime.
 *
 * `clearStorage` wipes the origin BEFORE the first navigation, never after: by the time a page has
 * loaded it has already minted a profile, and clearing then would leave the running tab holding an
 * id nothing on disk agrees with (GQ-008, the same rule for gq-guest-id).
 */
/**
 * Wait for the game to be up in whatever page the tab is currently on.
 *
 * Separate from load() because the gate navigates ITSELF -- switching a profile reloads -- and the
 * test that proves a named link does not out-vote the child must not re-navigate to wait, since
 * that would put `?hero=` back and destroy the thing under test. A fixed sleep here read the chip
 * mid-boot and reported an empty string; the same wait-for-the-system lesson as drive-touch.
 */
async function waitForRuntime(tab, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ready = await tab.page.eval(
      `Boolean(window.__galaQuestRuntime) && Boolean(document.querySelector('#profile-chip')?.textContent)`,
    ).catch(() => false);
    if (ready) return;
    if (Date.now() > deadline) throw new Error('runtime never came up after a self-initiated reload');
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function load(tab, url, { clearStorage = false } = {}) {
  if (clearStorage) {
    // Storage.clearDataForOrigin, and BEFORE the first navigate -- not a localStorage.clear() from
    // inside a loaded page, which is what this first did. The difference is the whole of GQ-008:
    // by the time a page has loaded it has already minted a profile, so clearing then leaves the
    // running tab holding an id nothing on disk agrees with. test/harness-fresh-guest.test.mjs
    // rejected the weaker version by name, which is the guidance system doing its job.
    await tab.page.send('Storage.clearDataForOrigin', {
      origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage',
    });
  }
  await tab.page.send('Page.navigate', { url });
  const deadline = Date.now() + 30000;
  for (;;) {
    const ready = await tab.page.eval('Boolean(window.__galaQuestRuntime)').catch(() => false);
    if (ready) return;
    if (Date.now() > deadline) throw new Error(`runtime never came up on ${url}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function clickSelector(tab, selector) {
  const clicked = await tab.page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`clickSelector: ${selector} not found`);
  await new Promise((r) => setTimeout(r, 150));
  return true;
}

/** Everything the gate is currently showing, read as data so a check can be about the screen rather
 *  than about a screenshot. The captures are for the human judgement AGENTS.md reserves to a person. */
async function gateState(tab) {
  return JSON.parse(await tab.page.eval(`JSON.stringify((() => {
    const gate = document.querySelector('#profile-gate');
    const cards = [...document.querySelectorAll('#profile-gate-list .profile-card')].map((card) => ({
      id: card.dataset.profileId ?? null,
      active: card.dataset.active === 'true',
      name: card.querySelector('.profile-card-name')?.textContent ?? null,
      badge: card.querySelector('.profile-card-badge')?.textContent ?? null,
    }));
    const addButton = document.querySelector('#profile-gate-list .profile-card-add');
    return {
      shown: gate?.dataset.shown === 'true',
      title: document.querySelector('#profile-gate-title')?.textContent ?? null,
      cards,
      hasAdd: Boolean(addButton),
      nameRowShown: document.querySelector('#profile-gate-name-row')?.dataset.shown === 'true',
      notice: document.querySelector('#profile-gate-notice')?.textContent ?? '',
      chip: document.querySelector('#profile-chip')?.textContent ?? null,
    };
  })())`));
}

async function typeName(tab, name) {
  await tab.page.eval(`(() => {
    const input = document.querySelector('#profile-gate-name');
    input.value = ${JSON.stringify(name)};
    return true;
  })()`);
}

/** The measured size of every interactive target on the gate, for the 44 px floor. */
async function tapTargets(tab) {
  return JSON.parse(await tab.page.eval(`JSON.stringify(
    [...document.querySelectorAll('#profile-gate button, #profile-gate input, #profile-chip')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.id || el.className, w: Math.round(r.width), h: Math.round(r.height) };
      })
  )`));
}

async function capture(tab, name) {
  mkdirSync(OUT, { recursive: true });
  const shot = await tab.page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `profile-gate-${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`  captured profile-gate-${name}.png`);
}

function freshStorePath(label) {
  return join(mkdtempSync(join(tmpdir(), `gq-profile-gate-${label}-`)), 'rewards.db');
}

/** Give the active profile some progress, through the SAME journal the game writes to, so the
 *  isolation check below is about real per-profile storage rather than about a value this harness
 *  poked into a global. */
async function grantMarksToActiveProfile(tab, count) {
  return tab.page.eval(`(async () => {
    const { createProfileStore } = await import('/src/progression/profiles.js');
    const store = createProfileStore();
    const id = store.activeProfileId();
    store.recordFacts(id, Array.from({ length: ${count} }, (_, i) => ({
      eventId: 'harness-mark:' + id + ':' + i, type: 'mark-earned',
    })));
    return id;
  })()`);
}

/** The game's own origin, needed by Storage.clearDataForOrigin above. Set once the harness-owned
 *  server has picked its port -- every file in this directory owns its own server on an isolated
 *  port, so the origin is not knowable until then (see owned-server.mjs's header). */
let ORIGIN_UNDER_TEST = null;

async function run() {
  const server = await startOwnedServer({ rewardStorePath: freshStorePath('main') });
  ORIGIN_UNDER_TEST = server.origin;
  // The BARE url, deliberately not server.url. owned-server.mjs appends `?hero=Harness` so the other
  // 27 harnesses land in the game instead of on an unanswered naming question -- and this is the one
  // harness whose whole first phase is that question. Driving the named link here would skip the
  // thing under test and still print green, which is the worst available outcome.
  const gameUrl = `${server.origin}/`;
  const tab = await openTab();
  try {
    await setViewport(tab, PORTRAIT);

    // ── a brand-new tablet is ASKED, not assumed ───────────────────────────────────────────────
    await load(tab, gameUrl, { clearStorage: true });
    let state = await gateState(tab);
    check('a first-ever load opens the gate by itself', state.shown, `shown ${state.shown}`);
    check('and it asks for a name rather than listing one hero',
      /called/i.test(state.title ?? '') && state.nameRowShown,
      `title ${JSON.stringify(state.title)}, name row ${state.nameRowShown}`);
    await capture(tab, '01-naming-portrait');

    const targets = await tapTargets(tab);
    const tooSmall = targets.filter((t) => t.w < TAP_TARGET_FLOOR_PX || t.h < TAP_TARGET_FLOOR_PX);
    check(`every target on the naming screen clears ${TAP_TARGET_FLOOR_PX}px`,
      tooSmall.length === 0, tooSmall.length ? JSON.stringify(tooSmall) : `${targets.length} targets measured`);

    // ── naming the first hero ──────────────────────────────────────────────────────────────────
    await typeName(tab, 'Rowan');
    await clickSelector(tab, '#profile-gate-confirm');
    state = await gateState(tab);
    check('naming the hero closes the gate', !state.shown, `shown ${state.shown}`);
    check('and the HUD says whose game this is', state.chip === 'Rowan', `chip ${JSON.stringify(state.chip)}`);
    await capture(tab, '02-named-portrait');

    // The question must not come back. This is the whole reason `named` is a stored flag rather
    // than "is the display name still the default" -- a child may legitimately be called Hero.
    await load(tab, gameUrl);
    state = await gateState(tab);
    check('a reload does NOT ask the name again', !state.shown, `shown ${state.shown}`);
    check('and the hero is still Rowan after the reload', state.chip === 'Rowan', `chip ${JSON.stringify(state.chip)}`);

    // ── give Rowan some progress, so the sibling check has something to be about ───────────────
    const rowanId = await grantMarksToActiveProfile(tab, 2);
    await load(tab, gameUrl);
    await clickSelector(tab, '#profile-chip');
    state = await gateState(tab);
    check('the chip opens the gate', state.shown, `shown ${state.shown}`);
    check('a returning device asks who is playing', /who is playing/i.test(state.title ?? ''), state.title);
    check("Rowan's card shows what Rowan has done",
      state.cards.length === 1 && state.cards[0].badge === '2 Lantern Marks',
      JSON.stringify(state.cards));
    check('and offers a new hero', state.hasAdd, `hasAdd ${state.hasAdd}`);
    await capture(tab, '03-choosing-portrait');

    // ── a sibling ──────────────────────────────────────────────────────────────────────────────
    await clickSelector(tab, '.profile-card-add');
    await typeName(tab, 'Sam');
    await clickSelector(tab, '#profile-gate-confirm');
    // Creating a hero reloads, by design -- the profile id IS the wire's guestId.
    await new Promise((r) => setTimeout(r, 500));
    await load(tab, gameUrl);
    state = await gateState(tab);
    check('the new sibling is the one now playing', state.chip === 'Sam', `chip ${JSON.stringify(state.chip)}`);

    await clickSelector(tab, '#profile-chip');
    state = await gateState(tab);
    check('both heroes are on the tablet', state.cards.length === 2,
      JSON.stringify(state.cards.map((c) => c.name)));
    const sam = state.cards.find((c) => c.name === 'Sam');
    const rowan = state.cards.find((c) => c.name === 'Rowan');
    check("Sam starts from nothing -- Rowan's marks are not Sam's",
      sam?.badge === 'Just starting', `Sam badge ${JSON.stringify(sam?.badge)}`);
    check("and Rowan's own progress is untouched by the new hero",
      rowan?.badge === '2 Lantern Marks', `Rowan badge ${JSON.stringify(rowan?.badge)}`);
    check('exactly one card reads as the current hero',
      state.cards.filter((c) => c.active).length === 1,
      JSON.stringify(state.cards.map((c) => ({ name: c.name, active: c.active }))));
    check('the two heroes have different durable ids behind the same screen',
      sam && rowan && sam.id !== rowan.id, `${rowan?.id} vs ${sam?.id}`);
    await capture(tab, '04-two-heroes-portrait');

    await setViewport(tab, LANDSCAPE);
    await new Promise((r) => setTimeout(r, 300));
    await capture(tab, '05-two-heroes-landscape');
    const landscapeTargets = await tapTargets(tab);
    const smallInLandscape = landscapeTargets.filter((t) => t.w < TAP_TARGET_FLOOR_PX || t.h < TAP_TARGET_FLOOR_PX);
    check(`landscape keeps every target above ${TAP_TARGET_FLOOR_PX}px`,
      smallInLandscape.length === 0,
      smallInLandscape.length ? JSON.stringify(smallInLandscape) : `${landscapeTargets.length} targets measured`);
    await setViewport(tab, PORTRAIT);

    // ── switching back, which is the claim the whole design rests on ───────────────────────────
    await clickSelector(tab, `.profile-card-choose[data-profile-id="${rowanId}"]`);
    await new Promise((r) => setTimeout(r, 500));
    await load(tab, gameUrl);
    state = await gateState(tab);
    check('switching back returns to Rowan', state.chip === 'Rowan', `chip ${JSON.stringify(state.chip)}`);

    const recovered = JSON.parse(await tab.page.eval(`(async () => {
      const { createProfileStore } = await import('/src/progression/profiles.js');
      const store = createProfileStore();
      const id = store.activeProfileId();
      return JSON.stringify({ id, state: store.stateFor(id) });
    })()`));
    check("and Rowan's marks came back, not Sam's",
      recovered.id === rowanId && recovered.state.marks === 2,
      `active ${recovered.id} with ${recovered.state.marks} marks (Rowan is ${rowanId})`);
    await capture(tab, '06-switched-back-portrait');

    // Typing a new hero's name and then touching anything else must not throw the name away. The
    // gate re-renders for reasons unrelated to the name -- arming a Remove is one -- and render()
    // rewrites the name row from the view, so without state the field vanishes mid-answer.
    await clickSelector(tab, '#profile-chip');
    await clickSelector(tab, '.profile-card-add');
    await typeName(tab, 'Halfway');
    const anyCard = (await gateState(tab)).cards[0];
    await clickSelector(tab, `.profile-card[data-profile-id="${anyCard.id}"] .profile-card-remove`);
    const midAnswer = JSON.parse(await tab.page.eval(`JSON.stringify({
      rowShown: document.querySelector('#profile-gate-name-row')?.dataset.shown === 'true',
      typed: document.querySelector('#profile-gate-name')?.value ?? null,
    })`));
    check('a half-typed hero name survives an unrelated re-render',
      midAnswer.rowShown && midAnswer.typed === 'Halfway', JSON.stringify(midAnswer));
    await clickSelector(tab, '#profile-gate-close');

    // ── a named link must not out-vote the child ───────────────────────────────────────────────
    //
    // `?hero=Sam` is adopted on every boot, so switching away from Sam while standing on Sam's link
    // has to actually stick. It did not: the switch reloads, the reload re-adopted the name in the
    // URL, and the gate silently did nothing. Found by reasoning about the feature rather than by a
    // failing check, which is why it is pinned here now.
    await load(tab, `${server.origin}/?hero=Rowan`);
    let named = await gateState(tab);
    check('following a named link plays as that hero', named.chip === 'Rowan',
      `chip ${JSON.stringify(named.chip)}`);

    await clickSelector(tab, '#profile-chip');
    const samCard = (await gateState(tab)).cards.find((c) => c.name === 'Sam');
    await clickSelector(tab, `.profile-card-choose[data-profile-id="${samCard.id}"]`);
    await waitForRuntime(tab);
    named = await gateState(tab);
    check('and switching away from it STAYS switched, rather than being undone by the URL',
      named.chip === 'Sam', `chip ${JSON.stringify(named.chip)} (the link still said Rowan)`);

    // Back to Rowan for the cap phase below, which counts on a known active hero.
    await clickSelector(tab, '#profile-chip');
    await clickSelector(tab, `.profile-card-choose[data-profile-id="${rowanId}"]`);
    await waitForRuntime(tab);
    await load(tab, gameUrl);

    // ── the cap, said in words ─────────────────────────────────────────────────────────────────
    await clickSelector(tab, '#profile-chip');
    for (let i = 2; i < MAX_PROFILES; i += 1) {
      await clickSelector(tab, '.profile-card-add');
      await typeName(tab, `Kid${i}`);
      await clickSelector(tab, '#profile-gate-confirm');
      await new Promise((r) => setTimeout(r, 500));
      await load(tab, gameUrl);
      await clickSelector(tab, '#profile-chip');
    }
    state = await gateState(tab);
    check(`a full tablet holds ${MAX_PROFILES} heroes`, state.cards.length === MAX_PROFILES,
      `${state.cards.length} cards`);
    check('and stops offering a new one', !state.hasAdd, `hasAdd ${state.hasAdd}`);
    check('saying so in a sentence rather than with a dead button',
      /remove one/i.test(state.notice), JSON.stringify(state.notice));
    await capture(tab, '07-full-portrait');

    // ── removing is two taps, and the second one says what it does ─────────────────────────────
    const victim = state.cards.find((c) => !c.active);
    await clickSelector(tab, `.profile-card[data-profile-id="${victim.id}"] .profile-card-remove`);
    const armed = JSON.parse(await tab.page.eval(`JSON.stringify((() => {
      const btn = document.querySelector('.profile-card[data-profile-id=${JSON.stringify(victim.id)}] .profile-card-remove');
      return { armed: btn?.dataset.armed === 'true', label: btn?.textContent ?? null };
    })())`));
    check('the first Remove tap only arms, and changes the word',
      armed.armed && /really/i.test(armed.label ?? ''), JSON.stringify(armed));
    const stillThere = await gateState(tab);
    check('nothing is removed on the first tap',
      stillThere.cards.length === MAX_PROFILES, `${stillThere.cards.length} cards`);
    await capture(tab, '08-remove-armed-portrait');

    await clickSelector(tab, `.profile-card[data-profile-id="${victim.id}"] .profile-card-remove`);
    state = await gateState(tab);
    check('the second tap removes that hero and only that hero',
      state.cards.length === MAX_PROFILES - 1 && !state.cards.some((c) => c.id === victim.id),
      `${state.cards.length} cards left`);
    check('and the tablet offers a new hero again', state.hasAdd, `hasAdd ${state.hasAdd}`);

    // ── what this child has already been taught ────────────────────────────────────────────────
    // The store has carried onboarding.{questGiven, movementTaught, attackTaught} since it was
    // written and nothing ever set them but `named`, so every latch reset on every reload: a child
    // who came back tomorrow was a stranger who had never met the Keeper. Durable teaching state is
    // the difference between a save file and a session.
    //
    // Read out of localStorage rather than off the runtime, deliberately. A mirror in memory would
    // pass this check while nothing had been written to disk, which is the whole failure.
    const teaching = async () => JSON.parse(await tab.page.eval(`JSON.stringify((() => {
      const raw = localStorage.getItem('gq-profiles');
      if (!raw) return { noKeyring: true };
      const keyring = JSON.parse(raw);
      const active = keyring.profiles.find((p) => p.id === keyring.activeProfileId) ?? keyring.profiles[0];
      return { name: active?.displayName ?? null, onboarding: active?.onboarding ?? null };
    })())`));

    const before = await teaching();
    check('a child who has not moved yet has not been taught movement',
      before.onboarding?.movementTaught === false, JSON.stringify(before));

    // A real push on the stick, not a synthetic flag flip.
    const stick = { x: 16 + 56, y: LANDSCAPE.height - 16 - 56 };
    const push = (type, points) => tab.page.send('Input.dispatchTouchEvent', {
      type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i })),
    });
    await push('touchStart', [stick]);
    for (let i = 0; i < 20; i += 1) {
      await push('touchMove', [{ x: stick.x, y: stick.y - 46 }]);
      await new Promise((r) => setTimeout(r, 100));
    }
    await push('touchEnd', []);
    await new Promise((r) => setTimeout(r, 700));

    const moved = await teaching();
    check('and once they drive themselves, the tablet writes it down',
      moved.onboarding?.movementTaught === true, JSON.stringify(moved));

    // THE POINT. A latch that only lives until the tab closes is not a latch.
    await load(tab, gameUrl);
    await waitForRuntime(tab);
    const remembered = await teaching();
    check('and it is still true after a real reload, which is what a save file means',
      remembered.onboarding?.movementTaught === true, JSON.stringify(remembered));
    check('and the reload did not forget who they are either',
      remembered.name === moved.name && remembered.onboarding?.named === true,
      JSON.stringify(remembered));

    check('no console errors across the whole run',
      tab.consoleErrors.length === 0,
      tab.consoleErrors.length ? JSON.stringify(tab.consoleErrors.slice(0, 3)) : 'none');
  } finally {
    await tab.close().catch(() => {});
    server.kill();
  }

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
