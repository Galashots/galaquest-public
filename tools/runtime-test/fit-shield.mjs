/**
 * Fit the shield against the running game and print the value to bake into gear.js.
 *
 *   node tools/runtime-test/fit-shield.mjs --slide 0.06 --out 0.05 --roll 12
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
 *     below relies on that and is checked against the sword, whose value is READ FROM gear.js so the
 *     check cannot go stale when the sword is re-fitted.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from './owned-server.mjs';
import { RIGID_TIER2_GEAR } from '../../public/src/character/gear.js';

const CHROME_PORT = 9224;
// Spawns and owns its own server on an isolated port rather than using the shared 5201 (Phase H1).
// This matters more for a fit tool than for a pass/fail harness: what this prints gets PASTED INTO
// gear.js, so the hero it measures has to be this checkout's hero. 5201 was measured to belong to a
// sibling worktree, and a number fitted against the wrong hero is wrong in a way that looks right.
const server = await startOwnedServer();
const URL_UNDER_TEST = server.url;
const ORIGIN_UNDER_TEST = server.origin;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
// Tall and roomy: this is an inspection viewport, not the phone the game is played on. The gameplay
// framing is captured separately at the end.
const VIEWPORT = { width: 900, height: 1000, deviceScaleFactor: 1, mobile: true };

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const SLIDE = arg('slide', 0.06); // along the forearm, past the hand
const OUTWARD = arg('out', 0.05); // away from the arm, along the shield's own face normal
const ROLL = arg('roll', 12); // degrees of face rotation about the forearm, toward the front
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
    if (r.exceptionDetails) throw new Error(`eval threw: ${r.exceptionDetails.text}`);
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
// Fresh-guest discipline (GQ-008) -- see docs/MISTAKES.md. Every harness that navigates starts from
// a known identity rather than whatever the persistent automation profile was holding.
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
const applied = await page.eval(`(() => {
  const rt = window.__galaQuestRuntime, hero = rt.hero;
  const V = Object.getPrototypeOf(rt.camera.position).constructor;
  const Q = Object.getPrototypeOf(rt.camera.quaternion).constructor;
  const M4 = Object.getPrototypeOf(rt.camera.matrixWorld).constructor;
  let skinned = null; hero.traverse(o => { if (!skinned && o.isSkinnedMesh) skinned = o; });

  window.__fit = (slide, outward, rollDeg) => {
    hero.updateMatrixWorld(true);
    const heroQ = new Q(); hero.getWorldQuaternion(heroQ);
    const hand = new V(); hero.getObjectByName('LeftHand').getWorldPosition(hand);
    const elbow = new V(); hero.getObjectByName('LeftForeArm').getWorldPosition(elbow);
    const forearm = hand.clone().sub(elbow).normalize();

    // Outward is the character's own left, made perpendicular to the arm. Using "hand minus chest"
    // here is degenerate -- it sits within a few degrees of the forearm and leaves almost nothing.
    const charLeft = new V(1, 0, 0).applyQuaternion(heroQ);
    const face = charLeft.clone().addScaledVector(forearm, -charLeft.dot(forearm)).normalize();
    face.applyAxisAngle(forearm, rollDeg * Math.PI / 180);

    const yA = forearm.clone();          // disc long axis: down the arm and past the hand
    const zA = face.clone();             // disc face: away from the body
    const xA = new V().crossVectors(yA, zA).normalize();
    const want = new Q().setFromRotationMatrix(new M4().makeBasis(xA, yA, zA));

    const anchor = hero.getObjectByName('InterimAdapter_shield_ironwood_LeftHand');
    const parentQ = new Q(); anchor.parent.getWorldQuaternion(parentQ);
    anchor.quaternion.copy(parentQ.clone().invert().multiply(want));
    anchor.position.copy(anchor.parent.worldToLocal(
      hand.clone().addScaledVector(forearm, slide).addScaledVector(face, outward)));
    hero.updateMatrixWorld(true);
    return { slide, outward, rollDeg };
  };

  // Bake in bind pose. skeleton.pose() shrinks this rig 100x uniformly, so positions and scales come
  // back multiplied by 100 and rotations are already correct. Verified against the sword.
  window.__bakeBoth = () => {
    skinned.skeleton.pose();
    hero.updateMatrixWorld(true);
    const rig = hero.getObjectByName('Armature');
    const one = (id, bone) => {
      const anchor = hero.getObjectByName('InterimAdapter_' + id + '_' + bone);
      const rest = new M4().copy(rig.matrixWorld).invert()
        .multiply(anchor.parent.matrixWorld).multiply(anchor.matrix);
      const p = new V(), q = new Q(), s = new V();
      rest.decompose(p, q, s); q.normalize();
      return { position: p.toArray().map(n => +(n * 100).toFixed(5)),
               quaternion: q.toArray().map(n => +n.toFixed(12)),
               scale: s.toArray().map(n => +(n * 100).toFixed(5)) };
    };
    return { shield: one('shield_ironwood', 'LeftHand'), sword: one('sword_ironwood', 'RightHand') };
  };
  return window.__fit(${SLIDE}, ${OUTWARD}, ${ROLL});
})()`);
console.log('fit applied:', applied);

console.log('capturing…');
await orbitTo(Math.PI);
await shot('front');
await orbitTo(Math.PI * 0.5);
await shot('side');
await orbitTo(Math.PI * 0.75);
await shot('three-quarter');
await orbitTo(0);
await shot('gameplay');

// ── bake, and check the method against the sword ───────────────────────────────────────────────
const baked = await page.eval('JSON.stringify(window.__bakeBoth())').then(JSON.parse);
// IMPORTED, not copied. This used to hold a hand-typed duplicate of the sword's transform, which
// is two independently-maintained laws for one quantity (GQ-007) -- and on 2026-08-24 the sword was
// re-fitted and the copy silently went stale, so this harness declared its own correct bake
// UNTRUSTWORTHY and exited 1. The comment above it had always said "the sword already in gear.js";
// now it is. The check itself is unchanged and still does its real job: prove the bake METHOD
// reproduces a value that is known good before anyone pastes the shield number next to it.
const SWORD_IN_FILE = RIGID_TIER2_GEAR
  .find((item) => item.boneName === 'RightHand').restRelativeToHeroRoot;
const dp = Math.hypot(...baked.sword.position.map((v, i) => v - SWORD_IN_FILE.position[i]));
const dq = Math.abs(baked.sword.quaternion.reduce((a, v, i) => a + v * SWORD_IN_FILE.quaternion[i], 0));

console.log('\nbake self-check against the sword already in gear.js:');
console.log(`  position error ${dp.toFixed(5)} rig units, quaternion dot ${dq.toFixed(9)}`);
const trustworthy = dp < 0.02 && dq > 0.999999;
console.log(trustworthy ? '  OK — the bake reproduces known-good data' : '  UNTRUSTWORTHY — do not paste this');

console.log('\nshield value for RIGID_TIER2_GEAR:');
console.log(`      position: Object.freeze([${baked.shield.position.join(', ')}]),`);
console.log(`      quaternion: Object.freeze([${baked.shield.quaternion.join(', ')}]),`);
console.log(`      scale: Object.freeze([45, 45, 45]),   // measured ${baked.shield.scale.join(', ')}`);

writeFileSync(`${OUT}${TAG}-baked.json`, JSON.stringify({ applied, baked, dp, dq, trustworthy }, null, 2));
await page.send('Target.closeTarget', { targetId });
process.exit(trustworthy ? 0 : 1);
