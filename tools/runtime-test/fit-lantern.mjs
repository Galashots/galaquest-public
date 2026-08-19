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

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openRewardStore } from '../../net/rewardStore.mjs';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
const REWARD_STORE_PATH = fileURLToPath(new URL('../../data/rewards.db', import.meta.url));

// The belt lantern is UNLOCK-GATED: main.js only mounts it once the guest holds 3 Lantern Marks, so
// a fit tool that cannot reach that state has nothing to fit. The fit below already pins the page to
// `fit-lantern-guest-0001` and its comment already asserts that guest "was seeded to 3 marks +
// unlock" -- but NOTHING IN THIS REPO EVER SEEDED IT. The seeding was a manual step somebody did once
// against the shared 5201 server's reward store, and the comment recorded the result as though it
// were a property of the tool.
//
// That is why hermeticity broke this file immediately, with "lantern anchor never appeared": a
// harness-owned server reads THIS checkout's data/rewards.db, where that guest has never existed.
// The dependency was exposed by Phase H1, not created by it, and the fix is to make the tool do what
// its own comment always claimed -- cribbed from drive-relight.mjs (and docs/pipeline/gear.md's
// "Unlock-gated gear" pattern): rewardStore's own idempotent apply() with deterministic
// `fit:`-prefixed eventIds, so re-running this never double-counts.
//
// SEEDED BEFORE THE SERVER IS SPAWNED, deliberately. drive-relight.mjs's header has to warn that
// "the RUNNING SERVER must be restarted" after seeding, because the server reads the ledger at
// startup; owning the server means this tool simply writes first and starts second, so that caveat
// does not apply to it at all.
const FIT_LANTERN_GUEST_ID = 'fit-lantern-guest-0001';
const MARKS_NEEDED = 3;
{
  const store = openRewardStore(REWARD_STORE_PATH);
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
  console.log(`  seeded ${FIT_LANTERN_GUEST_ID}: ${MARKS_NEEDED} marks, lantern unlocked`);
}

// Spawns and owns its own server on an isolated port rather than using the shared 5201 (Phase H1).
// This matters more for a fit tool than for a pass/fail harness: what this prints gets PASTED INTO
// gear.js, so the hero it measures has to be this checkout's hero. 5201 was measured to belong to a
// sibling worktree, and a number fitted against the wrong hero is wrong in a way that looks right.
const server = await startOwnedServer();
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
if (!ready) throw new Error(`runtime never came up on ${URL_UNDER_TEST}`);
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
if (players === -1) throw new Error('could not read the player count from #runtime-status');
if (players !== 1) {
  console.error(`\n${players} clients are connected to ${URL_UNDER_TEST}, so the capture would contain ${players} heroes`);
  console.error('and this many shields. Close the other tabs (browser pane and leftover 9224 pages) first:');
  console.error(`  curl -s http://127.0.0.1:${CHROME_PORT}/json/list`);
  await page.send('Target.closeTarget', { targetId });
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
// TOP of this file, through net/rewardStore.mjs's own apply() (eventIds prefixed `fit:`, so they are
// identifiable in the store forever) -- pin this page to that guest and reload so the welcome state
// carries lanternUnlocked and main.js mounts the real asset.
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
if (!reloadReady) throw new Error(`runtime never came back up after the guest reload on ${URL_UNDER_TEST}`);

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
  process.exit(2);
}

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
process.exit(0);
