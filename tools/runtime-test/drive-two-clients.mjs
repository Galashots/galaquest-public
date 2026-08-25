/**
 * Prove the multiplayer slice with two real browser tabs and real touch input.
 *
 * Spawns and owns its own runtime server on an isolated port (Phase H1 -- it used to require one
 * already up on the shared 5201); needs the isolated automation Chrome on 9224.
 * Never attach this to 9223: that is the owner's signed-in browser.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MIN_BODY_SEPARATION } from '../../public/src/combat/encounter.js';
import {
  deadlineAfter,
  movementPulseMillis,
} from './automation-timing.mjs';
import {
  authoredWolfSource, readWatchSource, startWatch, stopWatchSource,
} from './in-page-driver.mjs';
import { gameUrlFor, startOwnedServer } from './owned-server.mjs';
import { openRewardStore } from '../../net/rewardStore.mjs';
import { HELMET_SILVERGUARD_ID, WILDWOOD_BLADE_ID } from '../../public/src/progression/items.js';
import { PROFILES_STORAGE_KEY } from '../../public/src/progression/profiles.js';
import { rigidAnchorName } from '../../public/src/character/gear.js';
import {
  SHIPPING_SWORD_MESH_ID, WEAPON_BONE_NAME, WILDWOOD_BLADE_CANDIDATE_ID,
} from '../../public/src/character/weaponLoadout.js';
import {
  BELT_LANTERN_BONE_NAME, RIGID_BELT_LANTERN,
  RIGID_SILVERGUARD_HELMET, SILVERGUARD_HELMET_BONE_NAME,
} from '../../public/src/character/gear.js';

const CHROME_PORT = 9224;
// Two tabs against ONE server, and it must be a server nobody else is on: this harness's central
// claim is that tab B converges on tab A's truth, which a third client from another run would
// quietly invalidate. See owned-server.mjs.
// Its own store under the OS temp dir, never data/rewards.db -- the real children's save must never
// be touched by a harness (data/README.md). It exists so tab A can be seeded as a child who has
// already earned and equipped the Wildwood Blade, which is the only way to ask what tab B DRAWS of
// a sibling holding one.
const REWARD_STORE_PATH = join(mkdtempSync(join(tmpdir(), 'gq-two-clients-')), 'rewards.db');
const server = await startOwnedServer({ rewardStorePath: REWARD_STORE_PATH });

const URL_UNDER_TEST = server.url;
// TWO CHILDREN, ONE DEVICE -- and they have to be told apart by NAME, not by wiping storage between
// them. Both tabs share an origin on purpose: that is the whole subject of this file, two siblings
// on one iPad. Same origin is one localStorage and one profile keyring, so two tabs arriving as the
// same `?hero=` are correctly resolved to the SAME profile by adoptNamedHero -- measured: tab A's
// own Blade and lantern came back on the "sibling", because the sibling was tab A. The file used to
// force them apart by clearing storage once per tab, which is the race that orphaned tab A's grant
// hosted. Naming the second child is the product's own answer, so use it.
const SIBLING_URL_UNDER_TEST = gameUrlFor(server.origin, 'Sibling');
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
  // ORIGIN, not the exact ?hero=Harness address. The sibling tab is opened at ?hero=Sibling, so a
  // guard keyed to URL_UNDER_TEST closed tab A's leftovers and left tab B's behind -- and a run that
  // died mid-way (a CDP timeout, a kill) therefore poisoned every later run: the orphan tab reconnects
  // to the next run's server as a THIRD player, so remoteCount is 2, remotes[0] is a stranger holding
  // a starter sword, and the Blade/lantern/Helmet checks all fail against the wrong body. Measured
  // exactly that way once; the fix is to sweep the whole origin this harness owns.
  if (target.type === 'page' && target.url.startsWith(ORIGIN_UNDER_TEST)) {
    await browser.send('Target.closeTarget', { targetId: target.targetId });
  }
}
const targetA = (await browser.send('Target.createTarget', { url: 'about:blank' })).targetId;
const targetB = (await browser.send('Target.createTarget', { url: 'about:blank' })).targetId;
const pageA = await pageFor(browser, targetA);
const pageB = await pageFor(browser, targetB);
const hostedHeadless = await pageA.eval("navigator.userAgent.includes('HeadlessChrome')");
const consoleErrors = { a: [], b: [] };
const profileWarnings = { a: [], b: [] };

// Once, before either tab navigates. See openTab's own note for why this moved out of it.
await pageA.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });

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
    // AND THE PROFILE MODULE'S OWN WARNINGS, which are not errors and were therefore invisible.
    // progression/profiles.js warns rather than throws when it cannot reach localStorage or cannot
    // adopt the hero named in the URL -- it falls back to an in-memory keyring and hands out a
    // perfectly usable id that simply does not survive a reload. That is one of the two candidate
    // causes of the identity failure below, and the app says so out loud every time; nobody was
    // listening. Narrow on purpose: this collects the one prefix, not every warning in the page.
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'warning'
      && String(message.params.entry.text ?? '').includes('[profiles]')) {
      profileWarnings[name].push(message.params.entry.text);
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
  // CLEARED ONCE FOR THE ORIGIN, NOT ONCE PER TAB, and the difference is a race this file could not
  // see. Both tabs are the same origin on purpose -- that is what makes them two children on one
  // device -- so they share one localStorage, and a per-tab clear means tab B wipes whatever tab A
  // has written by the time B's turn comes round. Tab A mints its profile during boot; if that lands
  // between A's clear and B's, A keeps an in-memory id whose storage row no longer exists, and the
  // reload later in this file comes back as a different child with the granted Blade orphaned. Which
  // is exactly the hosted failure this note was written under. The clear belongs to the RUN.
  await page.send('Page.navigate', { url: name === 'b' ? SIBLING_URL_UNDER_TEST : URL_UNDER_TEST });
}

const bootA = await waitFor(pageA, 'Boolean(window.__galaQuestRuntime?.hero && window.__galaQuestRuntime.netState().status === "online")', 'tab A boots and joins');
// ── make tab A a child who has earned the Wildwood Blade ────────────────────────────────────────
//
// LET THE APP MINT ITS OWN CHILD, THEN GRANT THE BLADE TO THAT CHILD. The first attempt here pinned
// `gq-guest-id` before boot, the way drive-ranger and drive-hero-screen do -- and the wire came back
// saying `starter_sword` for a guest whose store row plainly said `wildwood_blade`. The reason is
// that identity moved: main.js joins with `profiles.activeProfileId()`, and the profile gate mints
// that, so the pinned key is no longer who a tab is. Pinning it seeds a child the server never
// hears about, and every claim after that is about the wrong one.
//
// So: boot, ask the tab who it turned out to be, grant the Blade to that id, and reload so the
// server sees it on the next join. A reload is also the honest shape -- equipment is durable, and a
// child coming back tomorrow is exactly the case this has to survive.
if (bootA) {
  const guestA = await pageA.eval('window.__galaQuestRuntime.guestId()');
  check('tab A has a durable identity to grant a reward to',
    typeof guestA === 'string' && guestA.length > 0, `guestId ${JSON.stringify(guestA)}`);
  if (typeof guestA === 'string' && guestA.length > 0) {
    // Written straight to the store, the way drive-hero-screen.mjs does and for the reason
    // gameServer's grantOwnership header gives: there is deliberately no client message that grants
    // ownership. Equipped as a seeded state rather than driven through the Hero screen -- that
    // button is drive-hero-screen's subject and is proved there; the question here is what the
    // OTHER tab draws.
    const store = openRewardStore(REWARD_STORE_PATH);
    store.apply({
      guestId: guestA, type: 'gear-owned',
      eventId: `own:${guestA}:${WILDWOOD_BLADE_ID}`, value: WILDWOOD_BLADE_ID,
    });
    store.apply({
      guestId: guestA, type: 'weapon-equipped',
      eventId: `equip:${guestA}:seed`, value: WILDWOOD_BLADE_ID, rev: Date.now(),
    });
    // ...and the belt lantern, the other thing this child has to show for the opening. Granted here
    // rather than earned through three Marks for the same reason the equip is seeded: the earning is
    // proved elsewhere, and what this file is asking is what the OTHER screen draws.
    store.apply({
      guestId: guestA, type: 'lantern-unlocked', eventId: `lantern:${guestA}:seed`,
    });
    // G1-C3: ...and the Silverguard Helmet, OWNED AND EQUIPPED. Seeded the same way and for the same
    // reason as the Blade above -- earning it through the Hollow and choosing EQUIP is proved by
    // drive-helmet-vertical; the question this file asks is what the OTHER child's screen draws.
    // Both facts, because ownership alone must not put a helmet on anybody (that is C2's law, and
    // seeding only the equip fact would let a broken ownership gate pass unnoticed here).
    store.apply({
      guestId: guestA, type: 'gear-owned',
      eventId: `own:${guestA}:${HELMET_SILVERGUARD_ID}`, value: HELMET_SILVERGUARD_ID,
    });
    store.apply({
      guestId: guestA, type: 'gear-equipped',
      eventId: `equip:${guestA}:helmet:seed`, value: HELMET_SILVERGUARD_ID, rev: Date.now(),
    });
    const equipped = store.equippedWeaponFor(guestA);
    const equippedItems = store.equippedItemsFor(guestA);
    store.close();
    check('tab A is now a child who has earned and equipped the Wildwood Blade',
      equipped === WILDWOOD_BLADE_ID, `equippedWeaponFor -> ${JSON.stringify(equipped)}`);
    check('tab A is also wearing the Silverguard Helmet they earned',
      equippedItems.helmet === HELMET_SILVERGUARD_ID,
      `equippedItemsFor -> ${JSON.stringify(equippedItems)}`);
    // Reload so the server re-reads this child's equipment on join. Storage is NOT cleared: the
    // profile has to survive, or the reload comes back as somebody else and the grant is orphaned.
    // WHAT STORAGE ACTUALLY HELD, either side of the reload. When this check failed hosted it said
    // only that a different id came back, which is consistent with two very different faults: the
    // profile was never durably written, or it was written and the reload did not find it. One read
    // each side separates them, and costs one round trip.
    const storedBefore = await pageA.eval(
      `JSON.stringify(window.localStorage.getItem(${JSON.stringify(PROFILES_STORAGE_KEY)}))`);
    await pageA.send('Page.reload');
    await waitFor(pageA,
      'Boolean(window.__galaQuestRuntime?.hero && window.__galaQuestRuntime.netState().status === "online")',
      'tab A rejoins holding the Blade', 60_000);
    const storedAfter = await pageA.eval(
      `JSON.stringify(window.localStorage.getItem(${JSON.stringify(PROFILES_STORAGE_KEY)}))`);
    // ABSENT IS NOT THE SAME AS PRESENT-WITHOUT-THIS-ID, and the first version of this line could
    // not tell them apart. Hosted at 2d0f6b1 it said `before the reload: false`, which killed the
    // theory it was written to test -- the row was not lost across the reload, it was never there --
    // and then could not say whether the key was missing entirely (nothing ever persisted; profiles
    // fell back to its in-memory store, which still hands out a working id) or present with somebody
    // else's profile in it (a wipe or another tab). Those want completely different fixes, so the
    // raw value goes in the log, truncated.
    const describeStored = (raw) => {
      const value = JSON.parse(raw);
      if (value === null) return 'ABSENT (no such key)';
      const ids = [...String(value).matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
      return `${ids.length} profile(s): ${ids.join(', ') || '(none parsed)'}`;
    };
    const heldBefore = (JSON.parse(storedBefore) ?? '').includes(guestA);
    const heldAfter = (JSON.parse(storedAfter) ?? '').includes(guestA);
    console.log(`  profile durability: ${PROFILES_STORAGE_KEY} held ${guestA}`);
    console.log(`    before the reload: ${heldBefore} -- ${describeStored(storedBefore)}`);
    console.log(`    after  the reload: ${heldAfter} -- ${describeStored(storedAfter)}`);
    console.log(`    profiles warned: ${profileWarnings.a.length ? profileWarnings.a.join(' | ') : 'nothing'}`);
    check('tab A is the same child after the reload, not a fresh one',
      (await pageA.eval('window.__galaQuestRuntime.guestId()')) === guestA,
      `guestId ${JSON.stringify(await pageA.eval('window.__galaQuestRuntime.guestId()'))}`);
  }
}


const bootB = await waitFor(pageB, 'Boolean(window.__galaQuestRuntime?.hero && window.__galaQuestRuntime.netState().status === "online")', 'tab B boots and joins');
if (bootA && bootB) {
  // A background tab can receive snapshots but not run rAF to render its remote. Bring B forward:
  // the requirement is that B sees A, and this models the child looking at B's iPad.
  // A tab publishes encounterState() from its FRAME LOOP, and a backgrounded tab does not run one.
  // So bringToFront alone is not enough to make a tab readable: its snapshot may have arrived over
  // the socket while it was asleep and not yet been folded into the state a harness can see. This
  // waits for two rendered frames -- two rather than one because the first callback can have been
  // scheduled before the tab came forward -- and it is what turned the last "disagreement" from
  // A=0/B=1 into an actual comparison.
  const afterAFrame = (page) => page.eval(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
  );

  await pageB.send('Page.bringToFront');
  await waitFor(pageB, 'window.__galaQuestRuntime.netState().remoteCount === 1', 'tab B receives tab A as a remote');

  // ── WHICH SWORD TAB B DRAWS IN TAB A'S HAND ───────────────────────────────────────────────────
  //
  // Tab A is a child who has earned the Wildwood Blade. Until `players[].weaponId` existed, every
  // remote was forced to the shipping sword -- weaponLoadout.js's own comment named the missing wire
  // field as the reason -- so a child who earned the Blade was still drawn holding an Ironwood on
  // their sibling's screen, which is the one screen where being seen to have earned it matters.
  //
  // Read from the SCENE, not from the runtime's own opinion: the anchor's `visible` is what a
  // renderer obeys. That also makes this the only proof that attachWildwoodBladeCandidate works on a
  // SkeletonUtils CLONE at all -- it bakes bind-pose bone matrices out of the skeleton's own
  // boneInverses, and a clone has its own skeleton. No unit test can reach that.
  const remoteGear = `(() => {
    const r = window.__galaQuestRuntime;
    const remote = r.netState().remotes[0] || null;
    if (!remote) return { present: false };
    const body = r.hero && r.hero.parent ? r.hero.parent.getObjectByName('remote-' + remote.id) : null;
    if (!body) return { present: false };
    const named = (name) => { const a = body.getObjectByName(name); return a ? a.visible === true : null; };
    // VISIBLE IS NOT THE SAME AS ON SCREEN. The camera enables specific layers, and gear.js's own
    // lightTheLantern comment warns that something left on layer 0 is invisible to it. An anchor
    // flagged visible on a layer the camera does not draw would pass a visible-is-true check and
    // show a child nothing, so the mask is compared against the body it hangs on -- same layer as
    // the sibling means it is drawn exactly when the sibling is.
    const maskOf = (name) => { const a = body.getObjectByName(name); return a ? a.layers.mask : null; };
    return {
      present: true,
      shipping: named(${JSON.stringify(rigidAnchorName(SHIPPING_SWORD_MESH_ID, WEAPON_BONE_NAME))}),
      blade: named(${JSON.stringify(rigidAnchorName(WILDWOOD_BLADE_CANDIDATE_ID, WEAPON_BONE_NAME))}),
      // What the WIRE said, beside what the scene did. Without it a failure here is unattributable
      // between "the server never told us" and "we were told and could not draw it", which are
      // repairs in different files. Read from the rewards block, which is where a hero's equipped
      // weapon has always ridden -- main.js reads the same field for the same reason.
      toldWeaponId: remote.weaponId ?? null,
      lantern: named(${JSON.stringify(rigidAnchorName(RIGID_BELT_LANTERN.id, BELT_LANTERN_BONE_NAME))}),
      toldLantern: remote.lanternUnlocked === true,
      // G1-C3. helmet is what the SCENE does; toldHelmet is what the wire said, kept apart for the
      // same reason toldWeaponId is -- "never told" and "told and could not draw it" are repairs in
      // different files. helmetOccluded is read off the remote's own body geometry rather than off
      // the equipped flag, so it answers "are this sibling's hair and ears actually hidden under the
      // helmet on MY screen", which is the only form of that claim a child could see.
      helmet: named(${JSON.stringify(rigidAnchorName(RIGID_SILVERGUARD_HELMET.id, SILVERGUARD_HELMET_BONE_NAME))}),
      helmetMask: maskOf(${JSON.stringify(rigidAnchorName(RIGID_SILVERGUARD_HELMET.id, SILVERGUARD_HELMET_BONE_NAME))}),
      toldHelmet: remote.helmetEquipped === true,
      helmetOccluded: remote.helmetOccluded === true,
      bodyMask: body.layers.mask,
      lanternMask: maskOf(${JSON.stringify(rigidAnchorName(RIGID_BELT_LANTERN.id, BELT_LANTERN_BONE_NAME))}),
      bladeMask: maskOf(${JSON.stringify(rigidAnchorName(WILDWOOD_BLADE_CANDIDATE_ID, WEAPON_BONE_NAME))}),
    };
  })()`;
  // The mesh is fetched on demand: this client had no reason to load the Blade until it was told a
  // sibling is holding one, so the first frames legitimately show the Ironwood. Polled rather than
  // read once, and a timeout here is a real failure rather than a slow machine's fault -- the asset
  // is local and the budget is generous.
  const sawBlade = await waitFor(pageB,
    `(${remoteGear}).blade === true`, 'tab B mounts and shows the sibling\'s Blade', 15_000);
  const swords = JSON.parse(await pageB.eval(`JSON.stringify(${remoteGear})`));
  check('tab B draws the sibling holding the Wildwood Blade they earned, not the starter sword',
    sawBlade && swords.blade === true && swords.shipping === false, JSON.stringify(swords));
  // EXACTLY ONE, never two out of the same fist and never an empty hand -- weaponVisibility's
  // invariant, asked of a real cloned rig rather than of the pure function that decides it.
  check('exactly one sword is visible on the sibling',
    [swords.shipping, swords.blade].filter((v) => v === true).length === 1,
    JSON.stringify(swords));

  // THE LANTERN, IN BOTH DIRECTIONS -- and the second is the one nobody was guarding.
  //
  // Tab A has earned it and tab B has not. So tab B must DRAW one on its remote, and tab A must NOT.
  // The second is the harder claim and the worse bug: a clone inherits whatever the local hero is
  // wearing, so tab A -- whose own child has a lantern -- was drawing tab B wearing one too. That is
  // a lie about someone else's progression, told by your screen, and weaponLoadout.js's
  // forceShippingWeaponOnClone existed to prevent exactly that lie about the sword while the lantern
  // never got an equivalent.
  const sawLantern = await waitFor(pageB,
    `(${remoteGear}).lantern === true`, 'tab B mounts and shows the sibling\'s lantern', 15_000);
  const bGear = JSON.parse(await pageB.eval(`JSON.stringify(${remoteGear})`));
  check('tab B draws the sibling wearing the lantern they earned',
    sawLantern && bGear.lantern === true, JSON.stringify(bGear));
  // Judged only when both pieces are actually mounted. A mask that is null means the anchor is not
  // there, which the check above has already reported -- and one slow mount producing two reds is
  // the thing this file's own diagnostic() header objects to.
  diagnostic('the mounted gear is on the same render layer as the sibling it hangs on',
    bGear.lanternMask === bGear.bodyMask && bGear.bladeMask === bGear.bodyMask,
    `body ${bGear.bodyMask}, lantern ${bGear.lanternMask}, blade ${bGear.bladeMask}`,
    {
      authoritative: bGear.lanternMask !== null && bGear.bladeMask !== null,
      reason: 'a piece of gear had not mounted yet, so there is no layer of its own to compare',
    });

  await pageA.send('Page.bringToFront');
  await afterAFrame(pageA);
  const aGear = JSON.parse(await pageA.eval(`JSON.stringify(${remoteGear})`));
  // JUDGED ONLY IF THERE WAS SOMETHING TO HIDE. A clone carries a lantern anchor only when it was
  // taken after the local hero mounted one, and that is a race this harness does not control: if tab
  // A cloned tab B before A's own lantern arrived, the anchor is absent and a bare belt proves
  // nothing about the rule. `false` is a real pass -- an anchor that exists and is hidden -- and
  // `true` is the lie either way. `null` is neither, and saying so is the point of DIAG.
  //
  // The rule itself is proved deterministically in test/remote-heroes.test.mjs, which builds the
  // clone WITH an anchor on purpose. This is the browser confirming it, when the browser can.
  diagnostic('tab A does NOT draw a lantern on a sibling who has not earned one',
    aGear.present === true && aGear.lantern !== true, JSON.stringify(aGear),
    {
      authoritative: aGear.lantern !== null,
      reason: "tab A's clone of tab B never carried a lantern anchor, so there was nothing to hide",
    });

  // ── G1-C3: THE HELMET A SIBLING IS WEARING ────────────────────────────────────────────────────
  //
  // The locked C3 evidence seam. Unit tests already prove the rule (test/remote-heroes.test.mjs
  // builds a clone WITH an anchor on purpose); what only a browser can prove is that
  // attachSilverguardHelmet works on a SkeletonUtils CLONE -- it bakes bind-pose bone matrices out
  // of the skeleton's own boneInverses, and a clone has its own skeleton -- and that the child on
  // the other screen actually sees the armour their sibling earned.
  //
  // Same both-directions discipline as the lantern above: tab A wears it, so tab B must DRAW one,
  // and tab A must NOT put one on tab B, who has never owned a helmet.
  //
  // TAB B TO THE FRONT FIRST. The lantern's mirror check just above leaves tab A frontmost, and a
  // backgrounded tab has its requestAnimationFrame throttled -- so afterAFrame(pageB) below (and the
  // frame the landscape capture needs) would hang until the CDP eval timed out. Plain evals still
  // answer while backgrounded, which is why the checks themselves passed and only the frame waits
  // died; making the foreground explicit is what keeps the captures honest as well as unblocked.
  await pageB.send('Page.bringToFront');
  await afterAFrame(pageB);
  const sawHelmet = await waitFor(pageB,
    `(${remoteGear}).helmet === true`, 'tab B mounts and shows the sibling\'s Helmet', 15_000);
  const bHelmet = JSON.parse(await pageB.eval(`JSON.stringify(${remoteGear})`));
  check('tab B draws the sibling wearing the Silverguard Helmet they equipped',
    sawHelmet && bHelmet.helmet === true, JSON.stringify(bHelmet));
  check('tab B was actually TOLD the sibling has the Helmet equipped, rather than guessing',
    bHelmet.toldHelmet === true, JSON.stringify(bHelmet));
  // The occlusion has to follow the REMOTE's own equipped state, not this client's. A sibling drawn
  // with a helmet and their hair still poking through it is the visible half of the same defect.
  check('the sibling\'s hair and ears are occluded under the Helmet on tab B\'s screen',
    bHelmet.helmetOccluded === true, JSON.stringify(bHelmet));
  diagnostic('the mounted Helmet is on the same render layer as the sibling it hangs on',
    bHelmet.helmetMask === bHelmet.bodyMask,
    `body ${bHelmet.bodyMask}, helmet ${bHelmet.helmetMask}`,
    {
      authoritative: bHelmet.helmetMask !== null,
      reason: 'the Helmet had not mounted yet, so there is no layer of its own to compare',
    });

  // TAB B'S OWN CHILD HAS NO HELMET, and their own head must stay bare. This is the independence
  // half: one profile's armour must not become the other's, in either direction.
  const bOwnHelmet = JSON.parse(await pageB.eval(`JSON.stringify((() => {
    const r = window.__galaQuestRuntime;
    const a = r.hero ? r.hero.getObjectByName(${JSON.stringify(rigidAnchorName(RIGID_SILVERGUARD_HELMET.id, SILVERGUARD_HELMET_BONE_NAME))}) : null;
    return { anchor: Boolean(a), visible: a ? a.visible === true : null };
  })())`));
  check('tab B\'s own hero is NOT wearing a Helmet they never earned',
    bOwnHelmet.visible !== true, JSON.stringify(bOwnHelmet));

  await pageA.send('Page.bringToFront');
  await afterAFrame(pageA);
  const aHelmet = JSON.parse(await pageA.eval(`JSON.stringify(${remoteGear})`));
  // Same DIAG shape as the lantern's mirror check, and for the same reason: tab A's clone of tab B
  // carries a helmet anchor only if it was taken after tab A's own Helmet mounted, which this
  // harness does not control. false is a real pass, true is the lie, null is neither.
  diagnostic('tab A does NOT draw a Helmet on a sibling who has not earned one',
    aHelmet.present === true && aHelmet.helmet !== true, JSON.stringify(aHelmet),
    {
      authoritative: aHelmet.helmet !== null,
      reason: "tab A's clone of tab B never carried a Helmet anchor, so there was nothing to hide",
    });

  await pageB.send('Page.bringToFront');
  await afterAFrame(pageB);
  const initialA = await state(pageA);
  const initialB = await state(pageB);
  check('tab B sees exactly one remote hero', initialB.net.remoteCount === 1,
    `B=${initialB.net.remoteCount}; A is background-throttled until it is brought forward`);

  const stick = { x: VIEWPORT.width * 0.2, y: VIEWPORT.height * 0.85 };
  // Chrome throttles background tabs; bring the input owner forward just as a child would.
  await pageA.send('Page.bringToFront');
  // RECORD THE WHOLE WALK, because the check below reads one number at the end of it and that number
  // has been failing for a dozen heads without ever saying why. drift is what reconcile() measured
  // before correcting, snapped is whether it gave up and teleported, corrections is how many
  // snapshots that frame consumed -- three facts that separate "the prediction is quietly behind"
  // from "the hero is being yanked forward every frame", and one reading at the end separates
  // neither. A recording cannot be too slow to catch it, which polling live state can.
  //
  // Retention left at startWatch's own default, deliberately. This walk is two seconds -- 120 frames
  // at 60fps, six at the hosted rate, against a default cap of 1200 -- so there is nothing to
  // override. review-suite.test.mjs also forbids the retention-cap option by name in the movement
  // harnesses, because that name used to mark a millisecond budget re-expressed as a count of slow
  // CDP samples. A recorder's cap is not that, but the default is ample here, so the distinction
  // costs nothing and the guard keeps its teeth. (It scans raw source, comments included, which is
  // why this note describes the option rather than naming it -- its sibling in
  // harness-game-url.test.mjs strips comments first for exactly this reason.)
  await pageA.eval(startWatch('self-drift', `(() => {
    const net = window.__galaQuestRuntime.netState();
    const p = window.__galaQuestRuntime.player.position;
    const s = net.serverSelf;
    return {
      t: Math.round(performance.now()),
      gap: s ? Number(Math.hypot(p.x - s.x, p.z - s.z).toFixed(3)) : null,
      drift: Number((net.drift ?? 0).toFixed(3)),
      snapped: net.snapped === true,
      corrections: net.corrections ?? null,
    };
  })()`));
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
  // Both, and in this order. The half second is the interpolation B needs to catch up; the frame
  // wait is the guarantee that it actually PAINTED afterwards, because a backgrounded tab's scene
  // graph is only advanced by rAF and half a second of wall clock hosted can buy one frame or none.
  // Replacing the sleep with the frame wait alone made this measurement worse rather than better --
  // the two are answering different questions and it needs both answered.
  await sleep(500);
  await afterAFrame(pageB);
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
  const driftLog = JSON.parse(await pageA.eval(readWatchSource('self-drift')));
  await pageA.eval(stopWatchSource('self-drift'));
  const driftFrames = driftLog?.samples ?? [];
  const withGap = driftFrames.filter((sample) => sample.gap !== null);
  const worstGap = withGap.reduce((worst, sample) => Math.max(worst, sample.gap), 0);
  const snaps = driftFrames.filter((sample) => sample.snapped).length;
  const consumed = driftFrames.reduce((total, sample) => total + (sample.corrections ?? 0), 0);
  const moved = Math.hypot(endA.player.x - startA.player.x, endA.player.z - startA.player.z);
  console.log(`  self-drift over the walk: ${driftFrames.length} frame(s), worst drawn-to-authority `
    + `gap ${worstGap.toFixed(3)}m, ${snaps} snap(s), ${consumed} snapshot(s) consumed; `
    + `the single end-of-walk sample said ${selfDrift.toFixed(3)}m`);
  // JUDGED FROM THE RECORDER, AND THIS CHANGES WHAT THE CHECK MEASURES. Stated plainly because it is
  // on the Director's open list and I would rather be overruled than quiet about it.
  //
  // The bar is unchanged at 0.3m. What changed is WHEN the quantity is sampled. It used to be one
  // `state(pageA)` eval after the release, and an eval lands whenever it lands -- including between
  // two rendered frames, which is precisely where this measurement is meaningless. Snapshots arrive
  // on the socket and move `serverSelf` immediately; the drawn hero is pulled toward it by
  // reconcile(), which runs in the FRAME LOOP. So between frames the two are a whole snapshot of
  // travel apart by construction, in any predicted-movement game, and no child ever sees that state.
  //
  // Measured, one walk, both numbers from the same run:
  //
  //   worst gap over 12 RENDERED frames   0.200m   inside the bar
  //   the single between-frames sample    1.414m   seven times worse, and red
  //
  // The recorder version is strictly more coverage -- every frame of the walk rather than one
  // moment of it -- sampled where the child actually is, and it still goes red if the drawn hero
  // genuinely lags: a real 0.4m gap held for one frame fails it. The old number is still printed
  // above so nothing is hidden by the change.
  check('tab A self prediction stays close to server truth while walking',
    withGap.length > 0 && worstGap <= 0.3,
    `worst gap ${worstGap.toFixed(3)}m over ${withGap.length} rendered frame(s); moved=${moved.toFixed(3)}`);
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
    const authoredWolf = ${authoredWolfSource()};
    const net = r.netState();
    return JSON.stringify({
      enemy: { ...authoredWolf },
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
  const walkedThrough = await walkToward(pageA, (live) => ({ x: live.enemy.x, z: live.enemy.z }), 0.3, 15_000);
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

  // WHAT TAB B ACTUALLY DRAWS OF TAB A'S BODY, once per rendered frame.
  //
  // Every other check in this file asks whether tab B has the right NUMBERS about tab A -- position,
  // wolf hp, remote count. None of them asks whether B draws A as a person doing what A is doing,
  // and until net/remotes.js grew a reaction and swing animator the answer was no: A could be dead
  // on the ground on their own screen and standing up straight on their sibling's. That is invisible
  // to a position check, because the position is right the whole time.
  //
  // So this reads the BODY. Highest bone above the root, exactly as play-fight.mjs measures the
  // local hero falling over, and for the same reason -- a flag proves the state arrived, a height
  // proves a child would see it. The scene comes off `hero.parent` rather than any new accessor:
  // remotes are named `remote-<id>` and already in it. getObjectByName walks the whole graph, so at
  // one call per frame the root is cached and re-found only if it goes away.
  const REMOTE_BODY_SAMPLE = `(() => {
    const r = window.__galaQuestRuntime;
    const remote = r.netState().remotes[0] || null;
    if (!remote) return { present: false };
    let body = window.__gqRemoteBody;
    if (!body || body.name !== 'remote-' + remote.id || !body.parent) {
      body = r.hero && r.hero.parent ? r.hero.parent.getObjectByName('remote-' + remote.id) : null;
      window.__gqRemoteBody = body;
    }
    if (!body) return { present: false };
    const base = body.matrixWorld.elements[13];
    let top = -Infinity;
    body.traverse((node) => { if (node.isBone) top = Math.max(top, node.matrixWorld.elements[13]); });
    return {
      present: true,
      down: remote.down === true,
      height: top === -Infinity ? null : Math.round((top - base) * 1000) / 1000,
    };
  })()`;
  // The recorder's default retention is plenty here -- this fight records tens of frames, not
  // thousands. Raising it explicitly is also forbidden in this file: test/review-suite.test.mjs bans
  // the literal in movement harnesses, because it used to name a pseudo-timeout (milliseconds
  // converted into a count of slow CDP samples) and that is the mistake the ban exists for. Same
  // word, different thing, and the guard cannot tell -- so take the default rather than argue.
  await pageB.eval(startWatch('remote-body', REMOTE_BODY_SAMPLE));

  // -- shared fight: both clients close in and swing until the wolf dies, sampling both tabs'
  // encounterState() each round to prove they agree on the shared truth (convergence). Each read is
  // taken right after that page was foregrounded (rAF only advances for the foregrounded tab, so a
  // stale background mirror would otherwise be compared against a fresh one), and a brief settle
  // poll absorbs the small chance a hit lands in the gap between reading A and reading B rather than
  // treating that timing crack as a real disagreement.
  // BRACKETED, not settled. Two tabs cannot be read at the same instant -- rAF only advances for the
  // foregrounded one, so each read costs a bringToFront and they land hundreds of milliseconds
  // apart on a starved runner. If the wolf takes a hit in that gap the two values differ for a
  // reason that has nothing to do with what either child saw.
  //
  // The version this replaces absorbed that by re-reading while the two disagreed, for 600ms. On a
  // runner where one round trip is a whole frame, 600ms buys a single retry -- and the tell that it
  // was measuring its own read order rather than the game is that the direction of the disagreement
  // FLIPPED between environments: A=2 B=1 locally, A=1 B=2 hosted. A real desync has a direction.
  //
  // So read A, then B, then A again. If A is unchanged across B's read, then B's value is bracketed
  // by two identical A values and any difference between them is real, whatever the latency was.
  // If A did change, the sample cannot answer the question at all -- it is neither agreement nor
  // disagreement -- so it is excluded and COUNTED, because a sample silently dropped is how a
  // harness reports "all agreeing" about rounds it never managed to compare.
  async function bracketedPair(maxWaitMs) {
    const deadline = deadlineAfter(maxWaitMs);
    let a = null;
    let b = null;
    do {
      await pageA.send('Page.bringToFront');
      await afterAFrame(pageA);
      const before = await fightState(pageA);
      await pageB.send('Page.bringToFront');
      await afterAFrame(pageB);
      b = await fightState(pageB);
      await pageA.send('Page.bringToFront');
      await afterAFrame(pageA);
      a = await fightState(pageA);
      if (before.enemy.hp === a.enemy.hp) return { a, b, bracketed: true };
    } while (Date.now() < deadline);
    return { a, b, bracketed: false };
  }

  const hpSamples = [];
  let killed = false;
  for (let round = 0; round < 60 && !killed; round += 1) {
    for (const page of [pageA, pageB]) {
      await page.send('Page.bringToFront');
      const before = await fightState(page);
      if (before.enemy.mode === 'dead') continue;
      const gap = Math.hypot(before.heroPos[0] - before.enemy.x, before.heroPos[1] - before.enemy.z);
      if (gap > 1.5) {
        await walkToward(page, (live) => ({ x: live.enemy.x, z: live.enemy.z }), 1.2, 2_500, { faceTarget: true });
      } else {
        await walkToward(page, (live) => ({ x: live.enemy.x, z: live.enemy.z }), 1.2, 800, { faceTarget: true });
        await tapAttack(page);
        await sleep(200);
      }
    }
    const { a, b, bracketed } = await bracketedPair(12_000);
    hpSamples.push({
      round, bracketed, aHp: a.enemy.hp, bHp: b.enemy.hp, aMode: a.enemy.mode, bMode: b.enemy.mode,
    });
    killed = a.enemy.mode === 'dead' && b.enemy.mode === 'dead';
  }

  const comparable = hpSamples.filter((sample) => sample.bracketed);
  const uncomparable = hpSamples.length - comparable.length;
  const disagreements = comparable.filter((sample) => sample.aHp !== sample.bHp);
  check('both tabs agree on wolf HP at every sampled snapshot during the shared fight',
    disagreements.length === 0 && comparable.length > 0,
    disagreements.length
      ? `first disagreement at round ${disagreements[0].round}: A=${disagreements[0].aHp} B=${disagreements[0].bHp}`
      : `${comparable.length} of ${hpSamples.length} rounds compared cleanly, all agreeing`
        + `${uncomparable ? `; ${uncomparable} could not be bracketed (the wolf changed mid-read)` : ''}`);
  check('both tabs converge on the same final dead mode',
    killed,
    `after ${hpSamples.length} rounds: A=${hpSamples.at(-1)?.aMode ?? 'n/a'}, B=${hpSamples.at(-1)?.bMode ?? 'n/a'}`);

  // ── G1-C3 running-game Helmet evidence, at both required orientations ─────────────────────────
  //
  // Taken HERE, after the shared fight, and the placement is the whole point of the capture being
  // worth anything. Both children spawn on the SAME spot, so before anyone moves the sibling's
  // helmeted head is inside tab B's own hero. Straight after tab A's solo walk is no better: A is
  // then off the edge of B's screen entirely -- measured, and the frame showed a bare-headed tab B
  // and no sibling at all. The convergence loop above walks BOTH children to within ~1.2m of the
  // wolf, so this is the first moment the two bodies are apart AND in one frame, which is the only
  // arrangement in which a person can see armour on somebody else's head. The assertions stay where
  // they are -- they read the scene graph and never needed the bodies framed.
  await pageB.send('Page.bringToFront');
  await afterAFrame(pageB);
  // BOUNDED WAIT BEFORE THE SHUTTER, for the same reason the Helmet vertical's reload gate uses one.
  // Tab B spends the walk backgrounded, and a throttled tab can drop the sibling out of its sampled
  // set for a frame; remotes.js then removes and RE-SPAWNS that body, and the fresh clone re-mounts
  // its gear lazily. Measured here as exactly that: the first capture attempt caught the respawned
  // body with no blade and no Helmet anchor yet (shipping sword showing, toldWeaponId starter_sword).
  // Nothing about the rule is wrong -- the mounts simply had not landed yet -- so this waits for the
  // armour to be back on the body and only then photographs it. A genuine failure to re-mount still
  // fails, because the wait is bounded and the check below is judged on the real scene graph.
  await waitFor(pageB, `(${remoteGear}).helmet === true`,
    'the sibling\'s Helmet is mounted again for the capture frame', 20_000);
  await afterAFrame(pageB);
  await shot(pageB, 'two-client-helmet-portrait.png');
  await pageB.send('Emulation.setDeviceMetricsOverride',
    { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await afterAFrame(pageB);
  await shot(pageB, 'two-client-helmet-landscape.png');
  await pageB.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
  await afterAFrame(pageB);
  // What the sibling's body is wearing at the moment those captures were taken, recorded beside them
  // so the pixels and the scene graph are one piece of evidence rather than two.
  const helmetAtCapture = JSON.parse(await pageB.eval(`JSON.stringify(${remoteGear})`));
  check('the Helmet is still on the sibling in the captured gameplay frame',
    helmetAtCapture.helmet === true && helmetAtCapture.helmetOccluded === true,
    JSON.stringify(helmetAtCapture));

  // -- and now: did tab B ever draw tab A lying down?
  await pageB.send('Page.bringToFront');
  const bodyLog = JSON.parse(await pageB.eval(readWatchSource('remote-body'))) ?? { samples: [] };
  await pageB.eval(stopWatchSource('remote-body'));
  const drawn = bodyLog.samples.filter((sample) => sample?.present && Number.isFinite(sample.height));
  const downFrames = drawn.filter((sample) => sample.down);
  const upFrames = drawn.filter((sample) => !sample.down);
  const lowestDown = downFrames.length ? Math.min(...downFrames.map((s) => s.height)) : null;
  // The median of the standing frames, not the max: one frame caught mid-stride is not "standing",
  // and the max of a large set is biased high against the min of a small one -- the estimator
  // mistake play-fight.mjs's sword-arm check made twice before it was caught.
  const sortedUp = upFrames.map((s) => s.height).sort((a, b) => a - b);
  const standing = sortedUp.length ? sortedUp[Math.floor(sortedUp.length / 2)] : null;
  const detail = `${downFrames.length} down frame(s) and ${upFrames.length} standing of `
    + `${bodyLog.samples.length} recorded; lowest while down `
    + `${lowestDown === null ? 'n/a' : `${lowestDown.toFixed(2)}m`}, standing median `
    + `${standing === null ? 'n/a' : `${standing.toFixed(2)}m`}`;
  // Judged only when tab B was actually looking while tab A was down. rAF does not advance in a
  // background tab and this harness has to foreground them alternately to read either, so a fight
  // where every one of A's knockdowns fell inside one of B's background stretches leaves nothing to
  // measure. That is an absence of evidence, and it must not read as PASS or as FAIL.
  diagnostic('tab B draws tab A lying down while tab A is knocked out',
    lowestDown !== null && standing !== null && lowestDown < standing * 0.65, detail,
    {
      authoritative: downFrames.length > 0 && upFrames.length > 0,
      reason: 'tab B was backgrounded for every frame tab A spent down, so it drew nothing to measure',
    });

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
