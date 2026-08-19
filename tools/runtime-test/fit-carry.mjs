/**
 * Solve the hero's whole IDLE CARRY together — arm pose, shield roll and sword grip — against the
 * running game, and print the values to bake. The third fit harness, after fit-shield.mjs and
 * fit-sword.mjs, and it exists because those two cannot express the coupling: the pose determines
 * what the gear can possibly do, so fitting the gear against an unfixed pose is how the 2026-08-13
 * re-tune came to aim at knee height and land at the hip.
 *
 *   node tools/runtime-test/fit-carry.mjs --rightHandX -0.21 --leftHandX 0.25 --elbow 0.18 \
 *        --swordPitch 70 --swordOutboard 15 --gripAlong 0.055 --tag carry
 *
 * Port 9224 — the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser. Needs the
 * server up, and refuses to shoot if more than one client is connected (every extra client draws its
 * own hero carrying gear.js's transform, so a stale tab renders a second shield and the capture
 * lies — fit-shield.mjs's own guard, for the same reason).
 *
 * Outputs, all to ignored .local/runtime-test/: seven captures, a <tag>-baked.json, and the sword
 * block for RIGID_TIER2_GEAR on stdout. The pose numbers go to locomotion.js's IDLE_ARM_SETTLE by
 * hand; the sword block goes to gear.js. THE SHIELD IS PRINTED BUT MUST NOT MOVE — it is the bake's
 * self-check, exactly as fit-shield.mjs checks itself against the sword.
 *
 * Three things are solved, in this order, because each depends on the one before it:
 *
 *   1. ARM SETTLE. Idle_02 splays the arms ~46 degrees off vertical, which is what reads as a
 *      scarecrow. rotation.x on each upper arm is the measured inward axis (.local/solve-idle.mjs's
 *      Jacobian; NOT assumed), Newton-stepped until each hand reaches a target hero-local X.
 *
 *   2. SHIELD ROLL COMPENSATION. Rolling the upper arm in also rolls the forearm the shield is
 *      strapped to, and v1 of this tuner turned the shield edge-on to the gameplay camera. The
 *      compensation goes in the POSE, not in the shield's baked rest transform: the mount is shared
 *      by walk, run and the slash, so paying for an idle-only pose change out of it would break
 *      three animations to fix one. LeftForeArm's twist axis restores the shield's face direction to
 *      exactly what it was before the settle -- the value Sol reviewed and the owner accepted.
 *
 *   3. SWORD. Re-aim, then RE-GRIP. fit-sword.mjs rotates the anchor about its own origin and says
 *      "position untouched"; because the sword mesh's handle is seated 0.43 of its length away from
 *      that origin, rotating it swings the hilt off the hand -- measured 0.172 m off, which is what
 *      the screenshots show as a sword floating past an open hand. Re-gripping translates the anchor
 *      so the handle lands back on the hand bone. This one IS baked, because it is a defect in the
 *      mount rather than a consequence of the pose.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
// Spawns and owns its own server on an isolated port rather than using the shared 5201 (Phase H1).
// This matters more for a fit tool than for a pass/fail harness: what this prints gets PASTED INTO
// gear.js and locomotion.js, so the hero it measures has to be this checkout's hero. 5201 was
// measured to belong to a sibling worktree, and a number fitted against the wrong hero is wrong in
// a way that looks right.
const server = await startOwnedServer();
const URL_UNDER_TEST = server.url;
const ORIGIN_UNDER_TEST = server.origin;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
const VIEWPORT = { width: 900, height: 1000, deviceScaleFactor: 1, mobile: true };

const arg = (n, f) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? f : Number(process.argv[i + 1]); };
const ti = process.argv.indexOf('--tag');
const TAG = ti === -1 ? 'settleB' : process.argv[ti + 1];
const RIGHT_HAND_X = arg('rightHandX', -0.21);
const LEFT_HAND_X = arg('leftHandX', 0.25);
const ELBOW = arg('elbow', 0.18);
const SWORD_PITCH = arg('swordPitch', 70);
const SWORD_OUTBOARD = arg('swordOutboard', 15);
// Metres past the WRIST, along the forearm's own direction, that the hilt is seated. The rig's
// `RightHand` bone IS the wrist (gear.js's header: the skeleton ends at the wrists and the hand past
// them is unarticulated geometry), so gripping exactly at the bone runs the blade down through the
// hand mesh. This pushes the hilt out into the fist instead.
const GRIP_ALONG = arg('gripAlong', 0.055);
// Set either of these to drive the upper-arm angle DIRECTLY, in radians, instead of Newton-solving
// it from a target hand X. Use them for follow-up passes. Hand X is a fine control the first time,
// when the arm is 46 degrees out and moving it moves the hand sideways; near the settled pose the
// relationship goes flat -- measured, 0.21 units of hand X per radian of arm -- so asking for "10
// degrees more open" through a hand-X target is asking a nearly-singular solve for precision it
// does not have.
const RIGHT_ARM_X = arg('rightArmX', NaN);
const LEFT_ARM_X = arg('leftArmX', NaN);

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0; this.pending = new Map();
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
      }
    });
  }
  ready() { return new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', () => rej(new Error('ws error')), { once: true }); }); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error(`${method} timed out`)); }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`eval threw: ${r.exceptionDetails.text}`);
    return r.result.value;
  }
}

const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
const browser = new CDP(version.webSocketDebuggerUrl); await browser.ready();
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
const page = new CDP(list.find((t) => t.id === targetId).webSocketDebuggerUrl); await page.ready();
await page.send('Runtime.enable'); await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
// Fresh-guest discipline (GQ-008) -- see docs/MISTAKES.md. Every harness that navigates starts from
// a known identity rather than whatever the persistent automation profile was holding.
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
await page.send('Page.navigate', { url: URL_UNDER_TEST });

let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) { await sleep(500); ready = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)'); }
if (!ready) throw new Error(`runtime never came up on ${URL_UNDER_TEST}`);
await sleep(900);
const players = await page.eval(`(() => { const t = document.querySelector('#runtime-status')?.textContent ?? ''; const m = t.match(/players\\s+(\\d+)/i); return m ? Number(m[1]) : -1; })()`);
if (players !== 1) { console.error(`${players} clients connected — capture would lie.`); process.exit(2); }

const solved = await page.eval(`(() => {
  const rt = window.__galaQuestRuntime, hero = rt.hero;
  const V = Object.getPrototypeOf(rt.camera.position).constructor;
  const Q = Object.getPrototypeOf(rt.camera.quaternion).constructor;
  const M4 = Object.getPrototypeOf(rt.camera.matrixWorld).constructor;
  const loco = rt.locomotion();
  loco.mixer.timeScale = 0;
  hero.updateMatrixWorld(true);

  const r3 = (v) => [ +v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4) ];
  const heroLocal = (name) => { const p = new V(); hero.getObjectByName(name).getWorldPosition(p); return hero.worldToLocal(p); };
  const heroQ = () => { const q = new Q(); hero.getWorldQuaternion(q); return q; };
  const charLeft = () => new V(1,0,0).applyQuaternion(heroQ());

  // The shield disc's face normal = its mesh's shortest local axis, in world space.
  const shieldNormal = () => {
    const anchor = hero.getObjectByName('InterimAdapter_shield_ironwood_LeftHand');
    let mesh = null; anchor.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
    const geo = mesh.geometry; geo.computeBoundingBox();
    const s = new V(); geo.boundingBox.getSize(s);
    const dims = [s.x, s.y, s.z];
    const shortest = dims.indexOf(Math.min(...dims));
    const axes = [new V(1,0,0), new V(0,1,0), new V(0,0,1)];
    const q = new Q(); mesh.getWorldQuaternion(q);
    return axes[shortest].clone().applyQuaternion(q).normalize();
  };
  // How far the shield faces the character's own left, i.e. outward. 1 = straight out, 0 = edge-on.
  const outwardness = () => Math.abs(shieldNormal().dot(charLeft()));

  const baseline = {
    RightHand: r3(heroLocal('RightHand')),
    LeftHand: r3(heroLocal('LeftHand')),
    shieldOutwardness: +outwardness().toFixed(4),
    shieldNormal: r3(shieldNormal()),
  };

  // ── 1. arm settle ──────────────────────────────────────────────────────────────────────────────
  const solveScalar = (get, set, read, target, lo, hi) => {
    let a = 0;
    for (let i = 0; i < 30; i += 1) {
      set(a); hero.updateMatrixWorld(true);
      const v0 = read(); const err = target - v0;
      if (Math.abs(err) < 0.002) break;
      const h = 0.05;
      set(a + h); hero.updateMatrixWorld(true);
      const slope = (read() - v0) / h;
      if (Math.abs(slope) < 1e-4) { set(a); break; }
      a = Math.max(lo, Math.min(hi, a + Math.max(-0.35, Math.min(0.35, err / slope))));
    }
    set(a); hero.updateMatrixWorld(true);
    return +a.toFixed(4);
  };

  const directRight = ${Number.isNaN(RIGHT_ARM_X) ? 'null' : RIGHT_ARM_X};
  const directLeft = ${Number.isNaN(LEFT_ARM_X) ? 'null' : LEFT_ARM_X};

  const rArm = hero.getObjectByName('RightArm'); const rArm0 = rArm.rotation.x;
  const rightArmX = directRight !== null
    ? (rArm.rotation.x = rArm0 + directRight, hero.updateMatrixWorld(true), directRight)
    : solveScalar(null, (a) => { rArm.rotation.x = rArm0 + a; },
        () => heroLocal('RightHand').x, ${RIGHT_HAND_X}, -1.2, 1.2);

  const lArm = hero.getObjectByName('LeftArm'); const lArm0 = lArm.rotation.x;
  const leftArmX = directLeft !== null
    ? (lArm.rotation.x = lArm0 + directLeft, hero.updateMatrixWorld(true), directLeft)
    : solveScalar(null, (a) => { lArm.rotation.x = lArm0 + a; },
        () => heroLocal('LeftHand').x, ${LEFT_HAND_X}, -1.2, 1.2);

  const afterSettle = { shieldOutwardness: +outwardness().toFixed(4) };

  // ── 2. shield roll compensation, in the pose ───────────────────────────────────────────────────
  // Which forearm axis is the twist? Measure, do not assume: the twist axis is the one that changes
  // the shield's facing most per unit of hand movement.
  const lFore = hero.getObjectByName('LeftForeArm');
  const twistScores = {};
  for (const axis of ['x','y','z']) {
    const saved = lFore.rotation[axis];
    const n0 = shieldNormal().clone(); const h0 = heroLocal('LeftHand').clone();
    lFore.rotation[axis] = saved + 0.15; hero.updateMatrixWorld(true);
    const dNormal = shieldNormal().distanceTo(n0);
    const dHand = heroLocal('LeftHand').distanceTo(h0);
    lFore.rotation[axis] = saved; hero.updateMatrixWorld(true);
    twistScores[axis] = { dNormal: +dNormal.toFixed(4), dHand: +dHand.toFixed(4),
                          ratio: +(dNormal / Math.max(dHand, 1e-4)).toFixed(2) };
  }
  const twistAxis = Object.keys(twistScores).sort((a,b) => twistScores[b].ratio - twistScores[a].ratio)[0];
  const lFore0 = lFore.rotation[twistAxis];
  const shieldTwist = solveScalar(null, (a) => { lFore.rotation[twistAxis] = lFore0 + a; },
    () => outwardness(), baseline.shieldOutwardness, -1.4, 1.4);

  // ── 3. elbow, after the twist is solved so it does not disturb it ──────────────────────────────
  hero.getObjectByName('RightForeArm').rotation.x += ${ELBOW};
  hero.updateMatrixWorld(true);

  const afterAll = {
    RightHand: r3(heroLocal('RightHand')),
    LeftHand: r3(heroLocal('LeftHand')),
    shieldOutwardness: +outwardness().toFixed(4),
  };

  // ── 4. sword: re-aim, then re-grip ─────────────────────────────────────────────────────────────
  const anchor = hero.getObjectByName('InterimAdapter_sword_ironwood_RightHand');
  let mesh = null; anchor.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
  const geo = mesh.geometry; geo.computeBoundingBox();
  const size = new V(); geo.boundingBox.getSize(size);
  const dims = [size.x, size.y, size.z];
  const longest = dims.indexOf(Math.max(...dims));
  const centre = new V(); geo.boundingBox.getCenter(centre);
  const axes = [new V(1,0,0), new V(0,1,0), new V(0,0,1)];
  const bladeLocal = axes[longest].clone().multiplyScalar(Math.sign(centre.getComponent(longest)) || 1);
  const wscale = new V(); mesh.getWorldScale(wscale);
  const worldHalf = (dims[longest] / 2) * wscale.getComponent(longest);
  const measure = () => {
    hero.updateMatrixWorld(true);
    const q = new Q(); mesh.getWorldQuaternion(q);
    const dir = bladeLocal.clone().applyQuaternion(q).normalize();
    const c = new V(); mesh.localToWorld(c.copy(centre));
    return { dir, tip: c.clone().addScaledVector(dir, worldHalf), grip: c.clone().addScaledVector(dir, -0.43 * worldHalf) };
  };
  const swordBefore = (() => { const m = measure(); const h = new V(); hero.getObjectByName('RightHand').getWorldPosition(h);
    return { pitchDeg: +(Math.asin(-m.dir.y)*180/Math.PI).toFixed(1), gripToHand: +m.grip.distanceTo(h).toFixed(4), tipY: +m.tip.y.toFixed(3) }; })();

  {
    const hq = heroQ();
    const cl = new V(1,0,0).applyQuaternion(hq);
    const cf = new V(0,0,1).applyQuaternion(hq);
    const up = new V(0,1,0);
    const p = ${SWORD_PITCH} * Math.PI/180, o = ${SWORD_OUTBOARD} * Math.PI/180;
    const want = cf.clone().multiplyScalar(Math.cos(p)).addScaledVector(up, -Math.sin(p))
      .addScaledVector(cl, -Math.sin(o) * Math.cos(p)).normalize();
    const arc = new Q().setFromUnitVectors(measure().dir, want);
    const aq = new Q(); anchor.getWorldQuaternion(aq);
    const pq = new Q(); anchor.parent.getWorldQuaternion(pq);
    anchor.quaternion.copy(pq.clone().invert().multiply(arc.clone().multiply(aq)));
    hero.updateMatrixWorld(true);
  }
  {
    const hand = new V(); hero.getObjectByName('RightHand').getWorldPosition(hand);
    // Seat the hilt in the fist, not on the wrist joint: step GRIP_ALONG metres further out along
    // the forearm's own direction (ForeArm -> Hand, extended past the hand bone).
    const fore = new V(); hero.getObjectByName('RightForeArm').getWorldPosition(fore);
    const along = hand.clone().sub(fore).normalize();
    const gripTarget = hand.clone().addScaledVector(along, ${GRIP_ALONG});
    const g = measure().grip;
    const deltaWorld = gripTarget.clone().sub(g);
    const parentInv = anchor.parent.matrixWorld.clone().invert();
    const origin = new V(0,0,0).applyMatrix4(parentInv);
    const moved = deltaWorld.clone().applyMatrix4(parentInv);
    anchor.position.add(moved.sub(origin));
    hero.updateMatrixWorld(true);
  }
  const swordAfter = (() => { const m = measure(); const h = new V(); hero.getObjectByName('RightHand').getWorldPosition(h);
    return { pitchDeg: +(Math.asin(-m.dir.y)*180/Math.PI).toFixed(1), gripToHand: +m.grip.distanceTo(h).toFixed(4),
             gripAlong: ${GRIP_ALONG}, tipY: +m.tip.y.toFixed(3), handY: +h.y.toFixed(3),
             kneeY: +(() => { const k = new V(); hero.getObjectByName('RightLeg').getWorldPosition(k); return k.y; })().toFixed(3) }; })();

  // Bake in BIND pose — the arm settle is a runtime pose and must not leak into a rest transform.
  let skinned = null; hero.traverse(o => { if (!skinned && o.isSkinnedMesh) skinned = o; });
  window.__bake = () => {
    skinned.skeleton.pose(); hero.updateMatrixWorld(true);
    const rig = hero.getObjectByName('Armature');
    const one = (id, bone) => {
      const a = hero.getObjectByName('InterimAdapter_' + id + '_' + bone);
      const rest = new M4().copy(rig.matrixWorld).invert().multiply(a.parent.matrixWorld).multiply(a.matrix);
      const p = new V(), q = new Q(), s = new V(); rest.decompose(p, q, s); q.normalize();
      return { position: p.toArray().map(n => +(n*100).toFixed(5)),
               quaternion: q.toArray().map(n => +n.toFixed(12)),
               scale: s.toArray().map(n => +(n*100).toFixed(5)) };
    };
    return { sword: one('sword_ironwood','RightHand'), shield: one('shield_ironwood','LeftHand') };
  };

  return { rightArmX, leftArmX, elbow: ${ELBOW}, twistAxis, twistScores, shieldTwist,
           baseline, afterSettle, afterAll, swordBefore, swordAfter };
})()`);

console.log('solved:', JSON.stringify(solved, null, 2));

async function look(h, d, p) {
  await page.eval(`(() => { const f = window.__galaQuestRuntime.follow; f.setHeading(${h}); f.setDistance(${d}); f.orbit(0, ${p} - f.pitch); })()`);
  await sleep(400);
}
async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}${TAG}-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured ${TAG}-${name}.png`);
}
for (const [name, h] of [['front', Math.PI], ['front-three-quarter', Math.PI*0.75],
                         ['side-right', Math.PI*0.5], ['side-left', Math.PI*1.5], ['back', 0]]) {
  await look(h, 2.6, 0.18); await shot(`inspect-${name}`);
}
await look(Math.PI, 3.8, 0.3); await shot('play-default-3.8');
await look(Math.PI, 8, 0.35); await shot('play-far-8');

const baked = await page.eval('JSON.stringify(window.__bake())').then(JSON.parse);
console.log('\nsword value for RIGID_TIER2_GEAR:');
console.log(`      position: Object.freeze([${baked.sword.position.join(', ')}]),`);
console.log(`      quaternion: Object.freeze([${baked.sword.quaternion.join(', ')}]),`);
console.log(`      scale: Object.freeze([47, 47, 47]),   // measured ${baked.sword.scale.join(', ')}`);
console.log('shield (unchanged, printed as a self-check):', JSON.stringify(baked.shield.position));
writeFileSync(`${OUT}${TAG}-baked.json`, JSON.stringify({ solved, baked }, null, 2));
await page.send('Target.closeTarget', { targetId });
// The open WebSocket keeps the event loop alive; without this the harness finishes its work and
// then hangs forever, which looks exactly like a harness that is still running.
process.exit(0);
