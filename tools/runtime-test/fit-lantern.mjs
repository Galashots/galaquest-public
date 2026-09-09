/**
 * Fit the BELT LANTERN against the running game (sibling of fit-shield/fit-sword) and print the value to bake into gear.js.
 *
 *   node tools/runtime-test/fit-lantern.mjs --left 0.17 --up -0.04 --fwd 0 --height 0.2
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * Why this exists as a harness rather than a browser console session: fitting is an iterate-and-look
 * loop, and every value here has to be judged in the pose the players actually see. Screenshots to
 * disk from a fixed set of camera angles make that loop repeatable and reviewable, and the same
 * harness will be needed again for Tier 3.
 *
 * The mount is the World of Warcraft idiom, from the reference shots the owner supplied: the shield lies
 * against the OUTSIDE OF THE FOREARM with its face pointing away from the body, not gripped in the
 * fist facing forward. Its long axis runs along the arm and extends past the hand, which is also what
 * makes its tip point down-and-out mirroring the sword in the other hand.
 *
 * Two traps on this rig, both measured rather than assumed:
 *   - The bone named LeftHand sits at hero-local +X. On this rig +X is the character's LEFT.
 *   - skeleton.pose() collapses the whole skeleton by exactly 100x, because the glTF
 *     inverseBindMatrices are in metres while the bones live in Armature units. The collapse is a
 *     uniform scale, so rotations survive it untouched and positions come back with a x100. The bake
 *     below relies on that and is checked against the sword, whose value in gear.js is known good.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRewardStore } from '../../net/rewardStore.mjs';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
// A private OS-temp database, never the family's real data/rewards.db. This file used to seed
// data/rewards.db and then call startOwnedServer() with no path, which hands the server its own
// unrelated fresh OS-temp store -- the seeded facts were never visible to the server under test
// (#162). Seeding this path and then passing the SAME path to startOwnedServer below is what makes
// the two sides agree on one database.
const REWARD_STORE_DIR = mkdtempSync(join(tmpdir(), 'gq-fit-lantern-'));
const REWARD_STORE_PATH = join(REWARD_STORE_DIR, 'rewards.db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Register this before seeding or starting the owned server so an early failure cannot strand the
// directory. If a server was started but teardown was not confirmed, preserve the directory: deleting
// a SQLite file while its child may still be alive is unsafe and leaves the real owner with no evidence.
let ownedServer = null;
let serverStopConfirmed = false;
async function cleanupRewardStoreDir() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { rmSync(REWARD_STORE_DIR, { recursive: true, force: true }); return; } catch { /* retry below */ }
    // eslint-disable-next-line no-await-in-loop
    await sleep(200);
  }
  console.error(`could not remove ${REWARD_STORE_DIR} after repeated attempts -- leaving it for manual cleanup`);
}
process.on('exit', () => {
  if (ownedServer && !serverStopConfirmed) return;
  try { rmSync(REWARD_STORE_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
});

async function stopServerAndCleanup() {
  if (!ownedServer) return;
  const stopped = await ownedServer.kill();
  if (!stopped) throw new Error(`owned server teardown was not confirmed; preserving ${REWARD_STORE_DIR}`);
  serverStopConfirmed = true;
  await cleanupRewardStoreDir();
}

// The belt lantern is UNLOCK-GATED: main.js only mounts it once the guest holds 3 Lantern Marks, so
// a fit tool that cannot reach that state has nothing to fit. rewardStore's own idempotent apply()
// with deterministic `fit:`-prefixed eventIds means re-running this never double-counts.
//
// SEEDED BEFORE THE SERVER IS SPAWNED, deliberately, and the seed connection is closed before the
// server starts. drive-relight.mjs's header has to warn that "the RUNNING SERVER must be restarted"
// after seeding, because the server reads the ledger at startup; owning the server means this tool
// simply writes first and starts second, so that caveat does not apply to it at all.
const FIT_LANTERN_GUEST_ID = 'fit-lantern-guest-0001';
const MARKS_NEEDED = 3;
{
  let store;
  try {
    store = openRewardStore(REWARD_STORE_PATH);
    for (let i = 0; i < MARKS_NEEDED; i += 1) {
      store.apply({ guestId: FIT_LANTERN_GUEST_ID, type: 'mark-earned', eventId: `fit:mark:${FIT_LANTERN_GUEST_ID}:${i}` });
    }
    store.apply({ guestId: FIT_LANTERN_GUEST_ID, type: 'lantern-unlocked', eventId: `fit:unlock:${FIT_LANTERN_GUEST_ID}` });
    if (store.marksFor(FIT_LANTERN_GUEST_ID) !== MARKS_NEEDED || !store.unlockedFor(FIT_LANTERN_GUEST_ID)) {
      throw new Error(
        `could not seed an unlocked guest: marks ${store.marksFor(FIT_LANTERN_GUEST_ID)}, `
        + `unlocked ${store.unlockedFor(FIT_LANTERN_GUEST_ID)}`,
      );
    }
  } finally {
    if (store) store.close();
  }
  console.log(`  seeded ${FIT_LANTERN_GUEST_ID}: ${MARKS_NEEDED} marks, lantern unlocked`);
}

// Spawns and owns its own server on an isolated port rather than using the shared 5201 (Phase H1).
// This matters more for a fit tool than for a pass/fail harness: what this prints gets PASTED INTO
// gear.js, so the hero it measures has to be this checkout's hero. 5201 was measured to belong to a
// sibling worktree, and a number fitted against the wrong hero is wrong in a way that looks right.
// The explicit rewardStorePath is the same path just seeded above, so the server reads that guest.
ownedServer = await startOwnedServer({ rewardStorePath: REWARD_STORE_PATH });
const server = ownedServer;

const URL_UNDER_TEST = server.url;
const ORIGIN_UNDER_TEST = server.origin;
// Tall and roomy: this is an inspection viewport, not the phone the game is played on. The gameplay
// framing is captured separately at the end.
const VIEWPORT = { width: 900, height: 1000, deviceScaleFactor: 1, mobile: true };

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const LEFT = arg('left', 0.17); // metres toward the character's left of the Hips bone
const UP = arg('up', -0.04); // metres above the Hips bone (negative = below)
const FWD = arg('fwd', 0); // metres forward of the Hips bone
const HEIGHT = arg('height', 0.2); // world-space lantern height in metres

const TAG = process.argv.includes('--tag')
  ? process.argv[process.argv.indexOf('--tag') + 1]
  : 'fit';

mkdirSync(OUT, { recursive: true });

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
    if (r.exceptionDetails) {
      // `exceptionDetails.text` is frequently the bare string "Uncaught" and says nothing about what
      // actually threw. The real message and stack live on `exception.description`; when the thrown
      // value is not an Error there is no description at all, so fall back to the preview/value.
      // Reported for two runs as an unexplained `eval threw: Uncaught` with zero assertions, which is
      // a harness that cannot say why it died -- not a product signal.
      const d = r.exceptionDetails;
      const described = d.exception?.description
        ?? d.exception?.value
        ?? d.exception?.preview?.description
        ?? null;
      const where = d.lineNumber != null ? ` at page line ${d.lineNumber}:${d.columnNumber ?? 0}` : '';
      const snippet = expression.replace(/\s+/g, ' ').slice(0, 200);
      throw new Error(
        `eval threw: ${d.text ?? 'Uncaught'}${where}\n`
        + `  thrown: ${described ?? '(no description; non-Error value thrown)'}\n`
        + `  expression: ${snippet}${expression.length > 200 ? ' …' : ''}`,
      );
    }
    return r.result.value;
  }
}

const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
const browser = new CDP(version.webSocketDebuggerUrl);
await browser.ready();
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
const page = new CDP(list.find((t) => t.id === targetId).webSocketDebuggerUrl);
await page.ready();
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

// Fresh-guest discipline (GQ-008) -- see docs/MISTAKES.md. This harness goes on to PIN a specific
// seeded identity below, which is a stronger form of the same thing, but it clears first so the
// pinning is a deliberate choice rather than a lucky overwrite of whatever was already there.
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
await page.send('Page.navigate', { url: URL_UNDER_TEST });

let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) {
  await sleep(500);
  ready = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
}
if (!ready) {
  await stopServerAndCleanup();
  throw new Error(`runtime never came up on ${URL_UNDER_TEST}`);
}
await sleep(600);

// Every connected client draws its own hero, at the origin until someone walks. Those extra heroes
// carry the gear transform from gear.js, while the one being fitted here is modified live -- so a
// single stale tab renders a SECOND shield in a different place and the capture silently lies. the owner
// caught exactly that in a screenshot. Refuse to shoot rather than produce misleading evidence.
// Read the number off the status line the HUD already renders. An earlier version of this guard
// asked the runtime's remotes() for a count, got something without a .size, quietly computed 1, and
// let a two-shield capture through anyway. The displayed text is the value a human would check.
const players = await page.eval(`(() => {
  const text = document.querySelector('#runtime-status')?.textContent ?? '';
  const m = text.match(/players\\s+(\\d+)/i);
  return m ? Number(m[1]) : -1;
})()`);
if (players === -1) {
  await stopServerAndCleanup();
  throw new Error('could not read the player count from #runtime-status');
}
if (players !== 1) {
  console.error(`\n${players} clients are connected to ${URL_UNDER_TEST}, so the capture would contain ${players} heroes`);
  console.error('and this many shields. Close the other tabs (browser pane and leftover 9224 pages) first:');
  console.error(`  curl -s http://127.0.0.1:${CHROME_PORT}/json/list`);
  await page.send('Target.closeTarget', { targetId });
  // Review correction: confirmed termination before exit is what makes the temp-store cleanup above
  // reliable -- an un-awaited kill leaves the child (and its lock on REWARD_STORE_DIR's SQLite file)
  // alive past this process's own exit, which is exactly what silently orphaned the directory.
  await stopServerAndCleanup();
  process.exit(2);
}

const touch = (type, points) =>
  page.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
  });

// Drag well above the virtual stick so the gesture is read as a camera orbit, not a walk.
async function dragBy(dx) {
  const y = VIEWPORT.height * 0.35;
  const x0 = VIEWPORT.width * 0.5;
  await touch('touchStart', [{ x: x0, y }]);
  for (let i = 1; i <= 12; i += 1) await touch('touchMove', [{ x: x0 + (dx * i) / 12, y }]);
  await touch('touchEnd', []);
  await sleep(80);
}

const heading = () => page.eval('window.__galaQuestRuntime.follow.heading');

// The drag-to-radians gain is not documented anywhere, so measure it once and then close the loop.
async function orbitTo(target) {
  const before = await heading();
  await dragBy(120);
  const gain = ((await heading()) - before) / 120;
  if (Math.abs(gain) < 1e-6) return heading();
  for (let i = 0; i < 6; i += 1) {
    const now = await heading();
    const delta = target - now;
    if (Math.abs(delta) < 0.03) break;
    await dragBy(Math.max(-380, Math.min(380, delta / gain)));
  }
  return heading();
}

async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}${TAG}-${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  captured ${file}`);
}

// ── the fit ────────────────────────────────────────────────────────────────────────────────────
// The lantern only mounts for an unlocked guest. The fit guest is seeded to 3 marks + unlock at the
// top of this file through rewardStore's apply() (eventIds prefixed `fit:`, so they remain identifiable
// in the store) -- pin this page to that guest and reload so the welcome state carries lanternUnlocked
// and main.js mounts the real asset.
//
// THE CLEAR IS LOAD-BEARING, and leaving it out is what turned this harness red. Setting the guest
// id is no longer enough on its own. The first navigate above BOOTS THE APP, and booting mints a
// profile; progression/profiles.js folds a legacy gq-guest-id into a profile only while the device
// holds none yet -- migrateLegacyGuest() returns null the moment one exists. So a guest id written
// beside an already-minted profile is not an identity, it is a dead string: the seeded marks stay
// on the server under a name nothing on the device points at, the lantern never unlocks, and the
// whole thing surfaces as a MISSING MESH rather than as a missing identity, which is why it read
// as an asset problem. Clearing first puts the device back to "no profiles", which is the only
// state the migration is defined for.
//
// An about:blank tab cannot hold localStorage for the real origin, so navigate once to establish
// it, THEN clear, THEN set the key, THEN navigate for real -- the same two-step drive-relight.mjs
// and drive-hero-screen.mjs already use for their own seeded guests.
await page.send('Page.navigate', { url: `${ORIGIN_UNDER_TEST}/favicon.ico` });
await sleep(300);
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
await page.eval(`localStorage.setItem('gq-guest-id', '${FIT_LANTERN_GUEST_ID}')`);
await page.send('Page.navigate', { url: URL_UNDER_TEST });

// This second navigate tears the runtime down and rebuilds it, so `hero` is null again until the
// GLB has loaded. A blind sleep(2500) then went straight into `hero.getObjectByName(...)`, and on a
// loaded hosted runner that threw `TypeError: Cannot read properties of null` -- reported for two
// full CI runs as an unexplained `eval threw: Uncaught` with zero assertions. The first navigate
// above already polls for readiness; this one did not. Same bounded gate, same failure message
// shape, so a runtime that genuinely never comes up still fails loudly rather than silently.
let reloadReady = false;
for (let i = 0; i < 60 && !reloadReady; i += 1) {
  await sleep(500);
  reloadReady = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
}
if (!reloadReady) {
  await stopServerAndCleanup();
  throw new Error(`runtime never came back up after the guest reload on ${URL_UNDER_TEST}`);
}

// Assert that the actual gameplay connection is online and carries the seeded server response before
// polling for the mesh. This reads the same welcome/snapshot state the game renders.
const gameplayState = await page.eval(`(() => {
  const rt = window.__galaQuestRuntime, state = rt.netState();
  const rewards = rt.rewards()[state.selfId] ?? null;
  return { guestId: rt.net.guestId, status: state.status, selfId: state.selfId, rewards };
})()`);
if (gameplayState.guestId !== FIT_LANTERN_GUEST_ID
    || gameplayState.status !== 'online'
    || gameplayState.selfId === null
    || gameplayState.rewards?.marks !== MARKS_NEEDED
    || gameplayState.rewards?.lanternUnlocked !== true) {
  console.error(`gameplay connection was not live with the seeded unlock at capture time: ${JSON.stringify(gameplayState)}`);
  await page.send('Target.closeTarget', { targetId });
  await stopServerAndCleanup();
  process.exit(2);
}
console.log(`  gameplay connection remains online with marks/unlock at capture time: ${JSON.stringify({ marks: gameplayState.rewards.marks, lanternUnlocked: gameplayState.rewards.lanternUnlocked })}`);

let anchored = false;
for (let i = 0; i < 20 && !anchored; i += 1) {
  await sleep(500);
  anchored = await page.eval(`(() => {
    const anchor = window.__galaQuestRuntime.hero.getObjectByName('InterimAdapter_lantern_belt_Hips');
    if (!anchor || anchor.children.length === 0) return false;
    let mesh = null; anchor.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
    return Boolean(mesh);
  })()`);
}
if (!anchored) {
  console.error('lantern mesh never appeared under its anchor -- is this profile unlocked (3 marks) and the GLB shipped?');
  await page.send('Target.closeTarget', { targetId });
  await stopServerAndCleanup();
  process.exit(2);
}
const connectedAtCapture = await page.eval(`(() => {
  const rt = window.__galaQuestRuntime, state = rt.netState();
  return { guestId: rt.net.guestId, status: state.status, selfId: state.selfId };
})()`);
if (connectedAtCapture.guestId !== FIT_LANTERN_GUEST_ID
    || connectedAtCapture.status !== 'online'
    || connectedAtCapture.selfId === null) {
  console.error(`gameplay connection dropped before capture: ${JSON.stringify(connectedAtCapture)}`);
  await page.send('Target.closeTarget', { targetId });
  await stopServerAndCleanup();
  process.exit(2);
}
console.log(`  gameplay connection confirmed online immediately before capture: ${JSON.stringify(connectedAtCapture)}`);

const applied = await page.eval(`(() => {
  const rt = window.__galaQuestRuntime, hero = rt.hero;
  const V = Object.getPrototypeOf(rt.camera.position).constructor;
  const Q = Object.getPrototypeOf(rt.camera.quaternion).constructor;
  const M4 = Object.getPrototypeOf(rt.camera.matrixWorld).constructor;
  let skinned = null; hero.traverse(o => { if (!skinned && o.isSkinnedMesh) skinned = o; });

  window.__fitLantern = (left, up, fwd, height) => {
    hero.updateMatrixWorld(true);
    const anchor = hero.getObjectByName('InterimAdapter_lantern_belt_Hips');
    const gear = anchor.children[0];

    // Natural size measured live so the height argument is world-metres regardless of export scale.
    const box = new (Object.getPrototypeOf(new rt.camera.constructor()).constructor && Object)();
    let mesh = null; gear.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
    mesh.geometry.computeBoundingBox();
    const size = new V(); mesh.geometry.boundingBox.getSize(size);
    const natural = Math.max(size.x, size.y, size.z);

    const heroQ = new Q(); hero.getWorldQuaternion(heroQ);
    const charLeft = new V(1, 0, 0).applyQuaternion(heroQ);
    const charFwd = new V(0, 0, 1).applyQuaternion(heroQ);
    const hips = new V(); hero.getObjectByName('Hips').getWorldPosition(hips);
    const target = hips.clone().addScaledVector(charLeft, left)
      .addScaledVector(new V(0, 1, 0), up).addScaledVector(charFwd, fwd);

    // Upright, front face turned the way the hero faces.
    const wantQ = heroQ.clone();
    const parent = anchor.parent;
    const parentQ = new Q(); parent.getWorldQuaternion(parentQ);
    anchor.quaternion.copy(parentQ.clone().invert().multiply(wantQ));
    anchor.position.copy(parent.worldToLocal(target.clone()));
    // World scale: undo the parent's world scale so height metres come out true.
    const parentS = new V(); parent.getWorldScale(parentS);
    const s = (height / natural) / parentS.x;
    anchor.scale.set(s, s, s);
    hero.updateMatrixWorld(true);
    return { left, up, fwd, height, natural: +natural.toFixed(4) };
  };

  window.__bakeLantern = () => {
    skinned.skeleton.pose();
    hero.updateMatrixWorld(true);
    const rig = hero.getObjectByName('Armature');
    const anchor = hero.getObjectByName('InterimAdapter_lantern_belt_Hips');
    const rest = new M4().copy(rig.matrixWorld).invert()
      .multiply(anchor.parent.matrixWorld).multiply(anchor.matrix);
    const p2 = new V(), q2 = new Q(), s2 = new V();
    rest.decompose(p2, q2, s2); q2.normalize();
    return { position: p2.toArray().map(n => +(n * 100).toFixed(5)),
             quaternion: q2.toArray().map(n => +n.toFixed(12)),
             scale: s2.toArray().map(n => +(n * 100).toFixed(5)) };
  };
  return window.__fitLantern(${LEFT}, ${UP}, ${FWD}, ${HEIGHT});
})()`);
console.log('lantern fit applied:', JSON.stringify(applied));

console.log('capturing…');
await orbitTo(Math.PI);
await shot('front');
await orbitTo(Math.PI * 0.5);
await shot('side');
await orbitTo(Math.PI * 1.5);
await shot('otherside');
await orbitTo(Math.PI * 0.75);
await shot('three-quarter');

const baked = await page.eval('JSON.stringify(window.__bakeLantern())').then(JSON.parse);
console.log('\nlantern value for RIGID_BELT_LANTERN:');
console.log(`      position: Object.freeze([${baked.position.join(', ')}]),`);
console.log(`      quaternion: Object.freeze([${baked.quaternion.join(', ')}]),`);
console.log(`      scale: Object.freeze([${baked.scale.map(n => +n.toFixed(2)).join(', ')}]),`);
writeFileSync(`${OUT}${TAG}-baked.json`, JSON.stringify({ applied, baked }, null, 2));
await page.send('Target.closeTarget', { targetId });
await stopServerAndCleanup();
process.exit(0);
