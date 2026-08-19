/**
 * Fit the WILDWOOD BLADE CANDIDATE (W1-A) against Character Studio and print the value to bake into
 * gear.js's RIGID_WILDWOOD_BLADE_CANDIDATE (sibling of fit-sword.mjs/fit-lantern.mjs).
 *
 *   node tools/runtime-test/fit-wildwood-blade.mjs [--grip-frac 0.45] [--roll 0] [--length N] [--tag fit]
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 *
 * WHY THIS TOOL EXISTS AND WHY IT DIFFERS FROM fit-sword.mjs/fit-lantern.mjs. The candidate's
 * placeholder mount (gear.js's RIGID_WILDWOOD_BLADE_CANDIDATE) is sword_ironwood's own solved
 * anchor transform, reused verbatim -- a reasonable starting guess, but wrong in practice: the live
 * selftest (2026-08-16) showed the blade floating up near the character's head, nowhere near the
 * hand, and Grip Inspector measured gripToWristDistance at 0.45m against the shipping sword's own
 * 0.055m. fit-sword.mjs can get away with ROTATING an anchor about its own origin (leaving position
 * untouched) because sword_ironwood's mesh origin was already known-good and only the AIM needed
 * correcting. This is a brand-new Meshy export with an unknown pivot -- rotating in place would just
 * swing an already-wrong offset to a different wrong place. This tool solves position AND rotation
 * AND scale from scratch, by actually measuring the candidate's own geometry rather than assuming it
 * shares sword_ironwood's conventions.
 *
 * THE METHOD, in three steps:
 *   1. Find the candidate's own blade axis and hilt end from its geometry alone. The longest local
 *      bounding-box axis is the blade-to-pommel axis (same convention gearInspectors.js's
 *      longestAxisWorld already uses to tell guard from tip on the SHIPPING sword). Bucket the
 *      mesh's actual vertices along that axis and measure cross-section footprint (bbox area) per
 *      bucket: the crossguard is a flat bar wider than the blade, so its bucket spikes. Whichever
 *      axis extreme that spike sits nearest is the hilt end -- geometry, not a guess.
 *   2. Solve a grip point on the hilt side of that crossguard (parameterised by --grip-frac, the
 *      fraction of the crossguard-to-pommel-extreme distance to walk inward) and a target world
 *      transform that seats it exactly the way sword_ironwood is already seated: 0.055m past the
 *      RightHand bone along the forearm's own direction (gear.js's own documented, Sol-approved
 *      convention -- re-measured live off the shipping sword's own current anchor, not copied as a
 *      literal, so a future re-tune of the shipping sword is picked up automatically). Orientation is
 *      solved as a full local-to-world basis change (blade axis -> measured shipping blade direction,
 *      thinnest/flat-face axis -> measured shipping flat-face direction), the same makeBasis technique
 *      fit-shield.mjs already uses for the shield's plane, so roll is not a free/arbitrary choice --
 *      it inherits the shipping sword's own already-approved presentation.
 *   3. Bake in bind pose -- IDENTICAL to fit-sword.mjs/fit-lantern.mjs's own __bake* functions, which
 *      already handle the glTF-inverseBindMatrix/Armature-unit 100x collapse. Copied verbatim; this
 *      tool invents nothing new there.
 *
 * Studio, not the running game: the candidate is Character-Studio-loadout-only (scene.js's
 * 'candidate-wildwood-blade'), never mounted by main.js/loadHero(). This tool therefore drives
 * public/studio.html, not the game, and uses window.__galaQuestStudio (the narrow, typed surface
 * worker.mjs/Sol also drive -- setLoadout/setAnimation/setView/getGripMeasurement) for everything
 * that surface already covers. For direct THREE scene-graph access (hero.root, anchors, mesh
 * geometry) it uses window.__galaQuestStudioScene, a raw debug hook added to studio/main.js
 * specifically for this -- the Studio equivalent of window.__galaQuestRuntime in the real game's
 * main.js. Deliberately NOT added to studio/api.js: that file's own header states it is "the ONLY
 * surface tools/sol-review/worker.mjs's studioCapture drives" and is kept intentionally narrow for
 * Sol; a fit harness reaching into mesh geometry belongs alongside window.__galaQuestRuntime's
 * existing precedent, not folded into the typed API Sol relies on staying small.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from './owned-server.mjs';

const CHROME_PORT = 9224;
const server = await startOwnedServer();
const URL_UNDER_TEST = server.url;
const ORIGIN_UNDER_TEST = server.origin;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/', import.meta.url));
const VIEWPORT = { width: 900, height: 1000, deviceScaleFactor: 1, mobile: true };

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const GRIP_FRAC = arg('grip-frac', 0.45); // 0 = right at the crossguard spike, 1 = at the pommel extreme
const ROLL = arg('roll', 0); // extra degrees of roll about the blade axis, on top of the inherited shipping presentation
const LENGTH_OVERRIDE = arg('length', NaN); // world-metres grip-to-tip override; NaN = match the shipping sword's own measured length

const TAG = process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : 'fit';

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
    if (r.exceptionDetails) throw new Error(`eval threw: ${r.exceptionDetails.text ?? JSON.stringify(r.exceptionDetails)}`);
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
// Fresh-guest discipline (GQ-008) -- see docs/MISTAKES.md. Every harness that navigates starts from
// a known identity rather than whatever the persistent automation profile was holding.
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
await page.send('Page.navigate', { url: `${URL_UNDER_TEST}studio.html` });

let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) {
  await sleep(500);
  ready = await page.eval('Boolean(window.__galaQuestStudioReady)').catch(() => false);
}
if (!ready) throw new Error(`Character Studio never became ready on ${URL_UNDER_TEST}studio.html`);
await sleep(300);

await page.eval('window.__galaQuestStudio.setLoadout("candidate-wildwood-blade")');
await page.eval('window.__galaQuestStudio.setAnimationPlaying(false)');
await page.eval('window.__galaQuestStudio.setAnimationTime(0.6)'); // fixed idle moment, so the fit is reproducible

let anchored = false;
for (let i = 0; i < 20 && !anchored; i += 1) {
  await sleep(300);
  anchored = await page.eval(
    "Boolean(window.__galaQuestStudioScene.hero.root.getObjectByName('InterimAdapter_sword_wildwood_w1a_RightHand'))",
  );
}
if (!anchored) {
  console.error('Wildwood Blade anchor never appeared -- is the candidate GLB present at public/assets/gear/candidates/sword_wildwood_w1a.glb?');
  await page.send('Target.closeTarget', { targetId });
  process.exit(2);
}

// ── the fit ────────────────────────────────────────────────────────────────────────────────────
const applied = await page.eval(`(() => {
  const rt = window.__galaQuestStudioScene, hero = rt.hero.root;
  const V = Object.getPrototypeOf(rt.camera.position).constructor;
  const Q = Object.getPrototypeOf(rt.camera.quaternion).constructor;
  const M4 = Object.getPrototypeOf(rt.camera.matrixWorld).constructor;
  let skinned = null; hero.traverse(o => { if (!skinned && o.isSkinnedMesh) skinned = o; });

  window.__fitWildwoodBlade = (gripFrac, rollDeg, lengthOverride) => {
    hero.updateMatrixWorld(true);

    // ── 1. Measure the SHIPPING sword's own current world blade direction, flat-face normal, and
    //    grip-to-tip length -- the target this candidate should match. Still measurable even though
    //    scene.js hides its anchor while the candidate loadout is active: visibility does not affect
    //    matrixWorld. Same longest-local-axis + guard-is-nearest-the-anchor technique gearInspectors.js's
    //    longestAxisWorld/measureGrip already use on this exact mesh.
    const swordAnchor = hero.getObjectByName('InterimAdapter_sword_ironwood_RightHand');
    const swordGear = swordAnchor.children[0];
    let swordMesh = null; swordGear.traverse(o => { if (!swordMesh && o.isMesh) swordMesh = o; });
    const sGeo = swordMesh.geometry; sGeo.computeBoundingBox();
    const sSize = new V(); sGeo.boundingBox.getSize(sSize);
    const sDims = [sSize.x, sSize.y, sSize.z];
    const sLongest = sDims.indexOf(Math.max(...sDims));
    const sThinnest = sDims.indexOf(Math.min(...sDims));
    const axes3 = [new V(1, 0, 0), new V(0, 1, 0), new V(0, 0, 1)];
    const sLocalCentre = new V(); sGeo.boundingBox.getCenter(sLocalCentre);
    const sSign = Math.sign(sLocalCentre.getComponent(sLongest)) || 1;
    const sMeshQ = new Q(); swordMesh.getWorldQuaternion(sMeshQ);
    const sAxisWorld = axes3[sLongest].clone().multiplyScalar(sSign).applyQuaternion(sMeshQ).normalize();
    const sThinWorldRaw = axes3[sThinnest].clone().applyQuaternion(sMeshQ).normalize();

    const sCorners = [];
    for (const x of [sGeo.boundingBox.min.x, sGeo.boundingBox.max.x])
      for (const y of [sGeo.boundingBox.min.y, sGeo.boundingBox.max.y])
        for (const z of [sGeo.boundingBox.min.z, sGeo.boundingBox.max.z])
          sCorners.push(new V(x, y, z).applyMatrix4(swordMesh.matrixWorld));
    const sCentreWorld = sLocalCentre.clone().applyMatrix4(swordMesh.matrixWorld);
    let sMinT = Infinity, sMaxT = -Infinity, sMinPt = null, sMaxPt = null;
    for (const c of sCorners) {
      const t = c.clone().sub(sCentreWorld).dot(sAxisWorld);
      if (t < sMinT) { sMinT = t; sMinPt = c; }
      if (t > sMaxT) { sMaxT = t; sMaxPt = c; }
    }
    const swordAnchorWorldPos = new V(); swordAnchor.getWorldPosition(swordAnchorWorldPos);
    const sGuardIsMin = swordAnchorWorldPos.distanceTo(sMinPt) <= swordAnchorWorldPos.distanceTo(sMaxPt);
    const sGuard = sGuardIsMin ? sMinPt : sMaxPt;
    const sTip = sGuardIsMin ? sMaxPt : sMinPt;
    const desiredWorldBladeDir = sTip.clone().sub(sGuard).normalize();
    const shippingBladeLength = sGuard.distanceTo(sTip);
    const desiredFlatNormalRaw = sThinWorldRaw.clone();

    // ── 2. Measure the CANDIDATE's own geometry in its own local (gear-root-relative) frame,
    //    independent of whatever placeholder transform the anchor currently carries.
    const anchor = hero.getObjectByName('InterimAdapter_sword_wildwood_w1a_RightHand');
    const gear = anchor.children[0];
    hero.updateMatrixWorld(true);
    const gearInv = new M4().copy(gear.matrixWorld).invert();
    const verts = [];
    gear.traverse((o) => {
      if (!o.isMesh) return;
      const rel = gearInv.clone().multiply(o.matrixWorld);
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 1) {
        verts.push(new V(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(rel));
      }
    });
    if (verts.length === 0) throw new Error('candidate gear has no mesh vertices to measure');

    const lmin = new V(Infinity, Infinity, Infinity);
    const lmax = new V(-Infinity, -Infinity, -Infinity);
    for (const v of verts) { lmin.min(v); lmax.max(v); }
    const lsize = lmax.clone().sub(lmin);
    const ldims = [lsize.x, lsize.y, lsize.z];
    const laxisIdx = ldims.indexOf(Math.max(...ldims));
    const laxes = [new V(1, 0, 0), new V(0, 1, 0), new V(0, 0, 1)];
    const perpIdx = [0, 1, 2].filter((i) => i !== laxisIdx);

    // Bucket by position along the long axis; per-bucket footprint area on the two perpendicular
    // axes is the "how wide is the mesh here" signal a crossguard spikes.
    const BUCKETS = 24;
    const axisMin = lmin.getComponent(laxisIdx);
    const axisMax = lmax.getComponent(laxisIdx);
    const span = axisMax - axisMin || 1;
    const buckets = Array.from({ length: BUCKETS }, () => ({
      pMin: [Infinity, Infinity], pMax: [-Infinity, -Infinity], count: 0, axisSum: 0,
    }));
    for (const v of verts) {
      const t = (v.getComponent(laxisIdx) - axisMin) / span;
      const bi = Math.max(0, Math.min(BUCKETS - 1, Math.floor(t * BUCKETS)));
      const b = buckets[bi];
      const p0 = v.getComponent(perpIdx[0]); const p1 = v.getComponent(perpIdx[1]);
      b.pMin[0] = Math.min(b.pMin[0], p0); b.pMax[0] = Math.max(b.pMax[0], p0);
      b.pMin[1] = Math.min(b.pMin[1], p1); b.pMax[1] = Math.max(b.pMax[1], p1);
      b.count += 1; b.axisSum += v.getComponent(laxisIdx);
    }
    const areas = buckets.map((b) => (b.count > 0 ? (b.pMax[0] - b.pMin[0]) * (b.pMax[1] - b.pMin[1]) : 0));
    const peakBucket = areas.indexOf(Math.max(...areas));
    const peakAxisVal = buckets[peakBucket].count > 0
      ? buckets[peakBucket].axisSum / buckets[peakBucket].count
      : axisMin + (peakBucket + 0.5) / BUCKETS * span;

    // Which extreme is the peak (crossguard) nearer to? That is the hilt side.
    const hiltIsMin = Math.abs(peakAxisVal - axisMin) <= Math.abs(peakAxisVal - axisMax);
    const hiltExtremeVal = hiltIsMin ? axisMin : axisMax;
    const tipExtremeVal = hiltIsMin ? axisMax : axisMin;

    const gripAxisVal = peakAxisVal + (hiltExtremeVal - peakAxisVal) * gripFrac;
    // Perpendicular centre from vertices near the grip axis position, so the grip point sits ON the
    // mesh's own centreline there, not at the whole-mesh bbox centre.
    let p0Sum = 0, p1Sum = 0, nearCount = 0;
    const nearWindow = span / BUCKETS * 2;
    for (const v of verts) {
      if (Math.abs(v.getComponent(laxisIdx) - gripAxisVal) <= nearWindow) {
        p0Sum += v.getComponent(perpIdx[0]); p1Sum += v.getComponent(perpIdx[1]); nearCount += 1;
      }
    }
    const gripP0 = nearCount > 0 ? p0Sum / nearCount : (lmin.getComponent(perpIdx[0]) + lmax.getComponent(perpIdx[0])) / 2;
    const gripP1 = nearCount > 0 ? p1Sum / nearCount : (lmin.getComponent(perpIdx[1]) + lmax.getComponent(perpIdx[1])) / 2;

    const localGripPoint = new V();
    localGripPoint.setComponent(laxisIdx, gripAxisVal);
    localGripPoint.setComponent(perpIdx[0], gripP0);
    localGripPoint.setComponent(perpIdx[1], gripP1);

    const tipSign = hiltIsMin ? 1 : -1;
    const localBladeDir = laxes[laxisIdx].clone().multiplyScalar(tipSign);
    const localBladeLength = Math.abs(tipExtremeVal - gripAxisVal);

    // "Thinnest" perpendicular axis = the flat-face normal (blade width axis is the other one).
    const perpSizes = perpIdx.map((i) => ldims[i]);
    const thinPerpIdx = perpSizes[0] <= perpSizes[1] ? perpIdx[0] : perpIdx[1];
    const localThin = laxes[thinPerpIdx].clone();

    // ── 3. Solve the anchor's WORLD transform: rotation maps (localBladeDir, localThin) onto the
    //    shipping sword's own (desiredWorldBladeDir, desiredFlatNormal) via an orthonormal basis
    //    change (Matrix4.makeBasis -- the same technique fit-shield.mjs bakes into its own anchor).
    let Lmid = localBladeDir.clone().cross(localThin).normalize();
    if (Lmid.lengthSq() < 1e-6) Lmid = laxes[perpIdx[0] === thinPerpIdx ? perpIdx[1] : perpIdx[0]].clone();
    const Lthin = Lmid.clone().cross(localBladeDir).normalize();
    const Ldir = localBladeDir.clone().normalize();

    const Wdir = desiredWorldBladeDir.clone().normalize();
    const WthinRaw = desiredFlatNormalRaw.clone();
    let Wthin = WthinRaw.clone().addScaledVector(Wdir, -WthinRaw.dot(Wdir));
    if (Wthin.lengthSq() < 1e-6) Wthin = new V(0, 1, 0).addScaledVector(Wdir, -Wdir.y);
    Wthin.normalize();
    const Wmid = Wdir.clone().cross(Wthin).normalize();
    Wthin.copy(Wmid.clone().cross(Wdir).normalize());

    const localBasis = new M4().makeBasis(Lmid, Ldir, Lthin);
    const worldBasis = new M4().makeBasis(Wmid, Wdir, Wthin);
    const rotMatrix = worldBasis.clone().multiply(localBasis.clone().transpose());
    let solvedQ = new Q().setFromRotationMatrix(rotMatrix);
    if (rollDeg) {
      const rollQ = new Q().setFromAxisAngle(Wdir, rollDeg * Math.PI / 180);
      solvedQ = rollQ.multiply(solvedQ);
    }

    const targetLength = Number.isFinite(lengthOverride) ? lengthOverride : shippingBladeLength;
    const s = targetLength / (localBladeLength || 1);

    const rightHand = new V(); hero.getObjectByName('RightHand').getWorldPosition(rightHand);
    const rightForeArm = new V(); hero.getObjectByName('RightForeArm').getWorldPosition(rightForeArm);
    const forearmDir = rightHand.clone().sub(rightForeArm).normalize();
    const desiredWorldGrip = rightHand.clone().addScaledVector(forearmDir, 0.055);

    const scaledGrip = localGripPoint.clone().multiplyScalar(s);
    const rotatedGrip = scaledGrip.clone().applyQuaternion(solvedQ);
    const anchorWorldPos = desiredWorldGrip.clone().sub(rotatedGrip);

    const worldGear = new M4().compose(anchorWorldPos, solvedQ, new V(s, s, s));
    const bone = anchor.parent; // RightHand bone
    const localMat = new M4().copy(bone.matrixWorld).invert().multiply(worldGear);
    localMat.decompose(anchor.position, anchor.quaternion, anchor.scale);
    hero.updateMatrixWorld(true);

    return {
      gripFrac, rollDeg, targetLength: +targetLength.toFixed(4),
      hiltIsMin, peakBucket, localBladeLength: +localBladeLength.toFixed(4),
      shippingBladeLength: +shippingBladeLength.toFixed(4),
      solvedScale: +s.toFixed(4),
      desiredWorldGrip: desiredWorldGrip.toArray().map((n) => +n.toFixed(4)),
    };
  };

  window.__bakeWildwoodBlade = () => {
    skinned.skeleton.pose();
    hero.updateMatrixWorld(true);
    const rig = hero.getObjectByName('Armature');
    const anchor = hero.getObjectByName('InterimAdapter_sword_wildwood_w1a_RightHand');
    const rest = new M4().copy(rig.matrixWorld).invert()
      .multiply(anchor.parent.matrixWorld).multiply(anchor.matrix);
    const p2 = new V(), q2 = new Q(), s2 = new V();
    rest.decompose(p2, q2, s2); q2.normalize();
    return {
      position: p2.toArray().map((n) => +(n * 100).toFixed(5)),
      quaternion: q2.toArray().map((n) => +n.toFixed(12)),
      scale: s2.toArray().map((n) => +(n * 100).toFixed(5)),
    };
  };
  return window.__fitWildwoodBlade(${GRIP_FRAC}, ${ROLL}, ${LENGTH_OVERRIDE});
})()`);
console.log('wildwood blade fit applied:', JSON.stringify(applied));

await page.eval('window.__galaQuestStudio.setOverlay("grip")');

async function shot(scale, bearing, name) {
  await page.eval(`window.__galaQuestStudio.setView(${JSON.stringify(scale)}, ${JSON.stringify(bearing)})`);
  await sleep(150);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}${TAG}-${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  captured ${file}`);
}

console.log('capturing…');
await shot('inspection', 'front', 'inspection-front');
await shot('inspection', 'three-quarter', 'inspection-three-quarter');
await shot('gameplay', 'front', 'gameplay-front');
await shot('gameplay', 'three-quarter', 'gameplay-three-quarter');

const grip = await page.eval('window.__galaQuestStudio.getGripMeasurement()');
console.log('\nlive grip measurement:', JSON.stringify(grip));

const baked = await page.eval('JSON.stringify(window.__bakeWildwoodBlade())').then(JSON.parse);
console.log('\nwildwood blade value for RIGID_WILDWOOD_BLADE_CANDIDATE:');
console.log(`      position: Object.freeze([${baked.position.join(', ')}]),`);
console.log(`      quaternion: Object.freeze([${baked.quaternion.join(', ')}]),`);
console.log(`      scale: Object.freeze([${baked.scale.map((n) => +n.toFixed(2)).join(', ')}]),`);
writeFileSync(`${OUT}${TAG}-baked.json`, JSON.stringify({ applied, grip, baked }, null, 2));
await page.send('Target.closeTarget', { targetId });
await server.kill();
process.exit(0);
