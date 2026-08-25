/**
 * Fit the SILVERGUARD HELMET against the running game (sibling of fit-lantern/fit-shield/fit-sword)
 * and print the value to bake into gear.js's RIGID_SILVERGUARD_HELMET.
 *
 *   node tools/runtime-test/fit-helmet.mjs --up 0.02 --fwd 0 --height 0.34 --yaw 0
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * The helmet is EQUIP-gated: main.js mounts it only when THIS child has helmet_silverguard equipped,
 * so the fit guest is seeded with BOTH a gear-owned and a gear-equipped fact at the top of this file
 * (net/rewardStore.mjs's own idempotent apply(), eventIds prefixed `fit:`, seeded before the server
 * is spawned -- the same discipline fit-lantern uses for its marks+unlock). The slot is derived from
 * the item catalogue, so the equip fact carries only the id, no slot field.
 *
 * Like fit-lantern: skeleton.pose() collapses the whole skeleton by exactly 100x (the glTF
 * inverseBindMatrices are metres while bones live in Armature units), a uniform scale, so the bake
 * multiplies position and scale by 100 and leaves the quaternion untouched.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openRewardStore } from '../../net/rewardStore.mjs';
import { HELMET_SILVERGUARD_ID } from '../../public/src/progression/items.js';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
mkdirSync(OUT, { recursive: true });
// Synchronous milestone log so a SIGTERM (block-buffered stdout is lost on kill) still leaves a trail.
const RUN_LOG = `${OUT}fit-helmet-run.log`;
try { writeFileSync(RUN_LOG, `run start ${process.argv.slice(2).join(' ')}\n`); } catch { /* ignore */ }
const step = (m) => { console.log(m); try { appendFileSync(RUN_LOG, `${m}\n`); } catch { /* ignore */ } };
const REWARD_STORE_PATH = fileURLToPath(new URL('../../data/rewards.db', import.meta.url));
const ANCHOR_NAME = `InterimAdapter_${HELMET_SILVERGUARD_ID}_Head`;

const FIT_HELMET_GUEST_ID = 'fit-helmet-guest-0001';
{
  const store = openRewardStore(REWARD_STORE_PATH);
  store.apply({ guestId: FIT_HELMET_GUEST_ID, type: 'gear-owned', value: HELMET_SILVERGUARD_ID, eventId: `fit:own:${FIT_HELMET_GUEST_ID}` });
  store.apply({ guestId: FIT_HELMET_GUEST_ID, type: 'gear-equipped', value: HELMET_SILVERGUARD_ID, eventId: `fit:equip:${FIT_HELMET_GUEST_ID}` });
  const equipped = store.equippedItemsFor(FIT_HELMET_GUEST_ID);
  const owned = store.ownedItemIdsFor(FIT_HELMET_GUEST_ID);
  if (equipped.helmet !== HELMET_SILVERGUARD_ID || !owned.includes(HELMET_SILVERGUARD_ID)) {
    throw new Error(`could not seed an equipped helmet: equipped ${JSON.stringify(equipped)}, owned ${JSON.stringify(owned)}`);
  }
  step(`  seeded ${FIT_HELMET_GUEST_ID}: ${HELMET_SILVERGUARD_ID} owned + equipped`);
}

const server = await startOwnedServer();
step(`server up: ${server.url}`);
const URL_UNDER_TEST = server.url;
const ORIGIN_UNDER_TEST = server.origin;
const VIEWPORT = { width: 900, height: 1000, deviceScaleFactor: 1, mobile: true };

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const UP = arg('up', 0.02); // metres above the Head bone (crown direction)
const FWD = arg('fwd', 0); // metres forward of the Head bone
const HEIGHT = arg('height', 0.34); // world-space helmet height in metres
const YAW = arg('yaw', 0); // degrees of extra rotation about world-up from the hero's facing
const PITCH = arg('pitch', 0); // degrees of forward/back tilt about the hero's right axis

const TAG = process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : 'fit-helmet';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0; this.pending = new Map();
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      }
    });
  }
  ready() { return new Promise((resolve, reject) => {
    this.ws.addEventListener('open', resolve, { once: true });
    this.ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
  }); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, 20000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const described = d.exception?.description ?? d.exception?.value ?? d.exception?.preview?.description ?? null;
      throw new Error(`eval threw: ${d.text ?? 'Uncaught'}\n  thrown: ${described ?? '(no description)'}`);
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

await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
await page.send('Page.navigate', { url: URL_UNDER_TEST });

let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) {
  await sleep(500);
  ready = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
}
if (!ready) throw new Error(`runtime never came up on ${URL_UNDER_TEST}`);
step('boot ready');
await sleep(600);

const players = await page.eval(`(() => {
  const text = document.querySelector('#runtime-status')?.textContent ?? '';
  const m = text.match(/players\\s+(\\d+)/i);
  return m ? Number(m[1]) : -1;
})()`);
if (players !== 1) {
  console.error(`\n${players} clients connected -- capture would contain ${players} heroes. Close other 9224 tabs.`);
  await page.send('Target.closeTarget', { targetId });
  await server.kill();
  process.exit(2);
}

const touch = (type, points) => page.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});
async function dragBy(dx) {
  const y = VIEWPORT.height * 0.35;
  const x0 = VIEWPORT.width * 0.5;
  await touch('touchStart', [{ x: x0, y }]);
  for (let i = 1; i <= 12; i += 1) await touch('touchMove', [{ x: x0 + (dx * i) / 12, y }]);
  await touch('touchEnd', []);
  await sleep(80);
}
const heading = () => page.eval('window.__galaQuestRuntime.follow.heading');
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

// A close inspection crop centred on the head, since a helmet is a few centimetres of a 1.5m hero and
// the gameplay-distance frame cannot show whether it seats. Projects the Head bone to screen pixels
// through the live camera, then clips a box around it at 3x so the fit is actually judgeable.
async function headShot(name) {
  const p = await page.eval(`(() => {
    const rt = window.__galaQuestRuntime, hero = rt.hero;
    const V = Object.getPrototypeOf(rt.camera.position).constructor;
    hero.updateMatrixWorld(true);
    const head = new V(); hero.getObjectByName('Head').getWorldPosition(head);
    head.project(rt.camera);
    return { x: (head.x * 0.5 + 0.5) * ${VIEWPORT.width}, y: (-head.y * 0.5 + 0.5) * ${VIEWPORT.height} };
  })()`);
  const half = 150;
  const clip = {
    x: Math.max(0, p.x - half), y: Math.max(0, p.y - half - 20),
    width: half * 2, height: half * 2, scale: 3,
  };
  const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip });
  const file = `${OUT}${TAG}-${name}-head.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  captured ${file}`);
}

// Pin the fit guest and reload so the server's rewards block carries helmet equipped and main.js
// mounts it -- the same navigate/clear/set/navigate two-step fit-lantern documents (a guest id
// written beside an already-minted profile is a dead string; clearing puts the device back to
// "no profiles", the only state the legacy-guest migration is defined for).
await page.send('Page.navigate', { url: `${ORIGIN_UNDER_TEST}/favicon.ico` });
await sleep(300);
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
await page.eval(`localStorage.setItem('gq-guest-id', '${FIT_HELMET_GUEST_ID}')`);
await page.send('Page.navigate', { url: URL_UNDER_TEST });

let reloadReady = false;
for (let i = 0; i < 60 && !reloadReady; i += 1) {
  await sleep(500);
  reloadReady = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
}
if (!reloadReady) throw new Error(`runtime never came back up after the guest reload`);
step('reload ready (guest pinned)');

let anchored = false;
for (let i = 0; i < 24 && !anchored; i += 1) {
  await sleep(500);
  anchored = await page.eval(`(() => {
    const anchor = window.__galaQuestRuntime.hero.getObjectByName(${JSON.stringify(ANCHOR_NAME)});
    if (!anchor || anchor.children.length === 0) return false;
    let mesh = null; anchor.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
    return Boolean(mesh);
  })()`);
}
if (!anchored) {
  console.error('helmet mesh never appeared under its anchor -- is this profile equipped and the GLB shipped?');
  await page.send('Target.closeTarget', { targetId });
  await server.kill();
  process.exit(2);
}
step('helmet anchor mounted');

const applied = await page.eval(`(() => {
  const rt = window.__galaQuestRuntime, hero = rt.hero;
  const V = Object.getPrototypeOf(rt.camera.position).constructor;
  const Q = Object.getPrototypeOf(rt.camera.quaternion).constructor;
  const M4 = Object.getPrototypeOf(rt.camera.matrixWorld).constructor;
  let skinned = null; hero.traverse(o => { if (!skinned && o.isSkinnedMesh) skinned = o; });

  // Natural helmet size in the anchor-parent (Head bone) frame, measured with the anchor neutralised
  // to identity so it is independent of whatever the idle clip has the head doing this instant.
  const measureNatural = () => {
    const anchor = hero.getObjectByName(${JSON.stringify(ANCHOR_NAME)});
    const gear = anchor.children[0];
    const savedP = anchor.position.clone(), savedQ = anchor.quaternion.clone(), savedS = anchor.scale.clone();
    anchor.position.set(0, 0, 0); anchor.quaternion.set(0, 0, 0, 1); anchor.scale.set(1, 1, 1);
    hero.updateMatrixWorld(true);
    const parent = anchor.parent;
    const invParent = new M4().copy(parent.matrixWorld).invert();
    let min = new V(Infinity, Infinity, Infinity), max = new V(-Infinity, -Infinity, -Infinity);
    gear.updateMatrixWorld(true);
    gear.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      for (let xi = 0; xi < 2; xi += 1) for (let yi = 0; yi < 2; yi += 1) for (let zi = 0; zi < 2; zi += 1) {
        const c = new V(xi ? bb.max.x : bb.min.x, yi ? bb.max.y : bb.min.y, zi ? bb.max.z : bb.min.z);
        c.applyMatrix4(o.matrixWorld).applyMatrix4(invParent);
        min.min(c); max.max(c);
      }
    });
    anchor.position.copy(savedP); anchor.quaternion.copy(savedQ); anchor.scale.copy(savedS);
    hero.updateMatrixWorld(true);
    return { sizeX: max.x - min.x, sizeY: max.y - min.y, sizeZ: max.z - min.z,
             cx: (min.x + max.x) / 2, cy: (min.y + max.y) / 2, cz: (min.z + max.z) / 2 };
  };

  window.__probeHelmet = () => {
    hero.updateMatrixWorld(true);
    const head = hero.getObjectByName('Head'); const hp = new V(); head.getWorldPosition(hp);
    const box = { min: new V(Infinity, Infinity, Infinity), max: new V(-Infinity, -Infinity, -Infinity) };
    hero.traverse((o) => { if (o.isMesh && o.name !== undefined) { /* whole-hero extent */ } });
    const nat = measureNatural();
    return { headWorld: hp.toArray().map((n) => +n.toFixed(4)), natural: nat };
  };

  window.__fitHelmet = (up, fwd, height, yawDeg, pitchDeg) => {
    hero.updateMatrixWorld(true);
    const anchor = hero.getObjectByName(${JSON.stringify(ANCHOR_NAME)});
    const parent = anchor.parent;
    const nat = measureNatural();
    const naturalHeight = Math.max(nat.sizeY, 1e-6);

    const heroQ = new Q(); hero.getWorldQuaternion(heroQ);
    const charUp = new V(0, 1, 0);
    const charFwd = new V(0, 0, 1).applyQuaternion(heroQ);
    const charRight = new V(1, 0, 0).applyQuaternion(heroQ);
    const head = new V(); parent.getWorldPosition(head);
    const target = head.clone().addScaledVector(charUp, up).addScaledVector(charFwd, fwd);

    // Upright, facing where the hero faces, plus optional yaw about world-up and pitch about the
    // hero's right axis for a helmet whose front or crown sits a few degrees off.
    const wantQ = heroQ.clone();
    if (yawDeg) wantQ.premultiply(new Q().setFromAxisAngle(charUp, yawDeg * Math.PI / 180));
    if (pitchDeg) wantQ.premultiply(new Q().setFromAxisAngle(charRight, pitchDeg * Math.PI / 180));

    const parentQ = new Q(); parent.getWorldQuaternion(parentQ);
    anchor.quaternion.copy(parentQ.clone().invert().multiply(wantQ));
    anchor.position.copy(parent.worldToLocal(target.clone()));
    const parentS = new V(); parent.getWorldScale(parentS);
    const s = (height / naturalHeight) / parentS.x;
    anchor.scale.set(s, s, s);
    hero.updateMatrixWorld(true);
    return { up, fwd, height, yawDeg, pitchDeg, naturalHeight: +naturalHeight.toFixed(4) };
  };

  window.__bakeHelmet = () => {
    skinned.skeleton.pose();
    hero.updateMatrixWorld(true);
    const rig = hero.getObjectByName('Armature');
    const anchor = hero.getObjectByName(${JSON.stringify(ANCHOR_NAME)});
    const rest = new M4().copy(rig.matrixWorld).invert().multiply(anchor.parent.matrixWorld).multiply(anchor.matrix);
    const p2 = new V(), q2 = new Q(), s2 = new V();
    rest.decompose(p2, q2, s2); q2.normalize();
    return { position: p2.toArray().map((n) => +(n * 100).toFixed(5)),
             quaternion: q2.toArray().map((n) => +n.toFixed(12)),
             scale: s2.toArray().map((n) => +(n * 100).toFixed(5)) };
  };

  const probe = window.__probeHelmet();
  // --verify captures what gear.js's baked RIGID_SILVERGUARD_HELMET actually produces through
  // attachSilverguardHelmet (the real game path), instead of overriding the anchor with a live fit --
  // the round-trip proof that the pasted number reproduces the seat it was solved from.
  const fit = ${process.argv.includes('--verify') ? 'null' : `window.__fitHelmet(${UP}, ${FWD}, ${HEIGHT}, ${YAW}, ${PITCH})`};
  return { probe, fit };
})()`);
step(`helmet probe: ${JSON.stringify(applied.probe)}`);
step(`helmet fit applied: ${JSON.stringify(applied.fit)}`);

step('capturing…');
await orbitTo(Math.PI);
await shot('front');
await headShot('front');
await orbitTo(Math.PI * 0.5);
await shot('side');
await headShot('side');
await orbitTo(Math.PI * 1.5);
await headShot('otherside');
await orbitTo(Math.PI * 0.75);
await shot('three-quarter');
await headShot('three-quarter');

const baked = await page.eval('JSON.stringify(window.__bakeHelmet())').then(JSON.parse);
step('\nhelmet value for RIGID_SILVERGUARD_HELMET:');
step(`      position: Object.freeze([${baked.position.join(', ')}]),`);
step(`      quaternion: Object.freeze([${baked.quaternion.join(', ')}]),`);
step(`      scale: Object.freeze([${baked.scale.map((n) => +n.toFixed(2)).join(', ')}]),`);
writeFileSync(`${OUT}${TAG}-baked.json`, JSON.stringify({ applied, baked }, null, 2));
await page.send('Target.closeTarget', { targetId });
await server.kill();
process.exit(0);
