/**
 * Asset Forge real-browser acceptance matrix.
 *
 * This proves the connected authoring surface, not just isolated math: real Hero, real Dawnwarden
 * candidates, DOM controls, Three.js anchors, semantic coverage, animation mixer, reset behavior,
 * responsive drawers, and the CI spend lock. Screenshots remain human visual evidence; mechanical
 * checks only claim state changes that can be measured directly.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from '../runtime-test/owned-server.mjs';

const CHROME_PORT = 9224;
const OUT = fileURLToPath(new URL('../../.local/runtime-test/forge-review/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = await startOwnedServer({ quiet: true });
let failures = 0;

function check(name, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function near(a, b, epsilon = 1e-5) { return Math.abs(a - b) <= epsilon; }
function sameVector(a, b, epsilon = 1e-5) {
  return a.length === b.length && a.every((value, index) => near(value, b[index], epsilon));
}
function quaternionChanged(a, b, epsilon = 1e-5) {
  const dot = Math.abs(a.reduce((sum, value, index) => sum + value * b[index], 0));
  return 1 - dot > epsilon;
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
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
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
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, 20_000);
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
}

async function screenshot(page, name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  captured ${name}.png`);
}

async function waitFor(page, expression, tries = 80, delay = 250) {
  for (let i = 0; i < tries; i += 1) {
    const value = await page.eval(expression).catch(() => false);
    if (value) return value;
    await sleep(delay);
  }
  return false;
}

const anchorState = (id, bone) => `(() => {
  const scene = window.__galaQuestForgeScene;
  const anchor = scene?.hero.root.getObjectByName('InterimAdapter_${id}_${bone}');
  if (!scene || !anchor) return null;
  scene.hero.root.updateMatrixWorld(true);
  const P = anchor.position.constructor;
  const Q = anchor.quaternion.constructor;
  const p = new P(); const q = new Q();
  anchor.getWorldPosition(p); anchor.getWorldQuaternion(q);
  let mesh = null; anchor.traverse((o) => { if (!mesh && o.isMesh && o.geometry?.attributes?.position?.count) mesh = o; });
  let sample = null;
  if (mesh) {
    mesh.updateMatrixWorld(true);
    const v = new P().fromBufferAttribute(mesh.geometry.attributes.position, 0).applyMatrix4(mesh.matrixWorld);
    sample = v.toArray();
  }
  return {
    position: p.toArray(), quaternion: q.toArray(), localPosition: anchor.position.toArray(),
    localQuaternion: anchor.quaternion.toArray(), localScale: anchor.scale.toArray(), sample,
    visible: anchor.visible, playing: scene.playing, clip: scene.currentClipName, time: scene.currentTime,
    hidden: scene.hiddenAnatomy,
  };
})()`;

let browser; let page; let targetId;
try {
  const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((response) => response.json());
  browser = new CDP(version.webSocketDebuggerUrl);
  await browser.ready();
  const target = await browser.send('Target.createTarget', { url: 'about:blank' });
  targetId = target.targetId;
  const targets = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((response) => response.json());
  page = new CDP(targets.find((entry) => entry.id === targetId).webSocketDebuggerUrl);
  await page.ready();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'all' });
  // ORIGIN, NOT `server.url`. `startOwnedServer().url` is the GAME's address and carries a query
  // string -- `${origin}/?hero=Harness` -- so `${server.url}forge.html` concatenates into
  // `${origin}/?hero=Harnessforge.html`: a request for the site root with a nonsense query, which
  // serves index.html. This tool then waited for a badge that only exists on the forge page and
  // reported "Forge never reached FORGE READY" for fourteen hours, on a page that was never the
  // Forge. The game gained its `?hero=` for a good reason (landing on the profile gate instead of
  // in the world); nothing warned the one tool that builds a DIFFERENT page's address from it.
  const forgeUrl = `${server.origin}/forge.html`;
  await page.send('Page.navigate', { url: forgeUrl });

  // WHICH PAGE DID WE ACTUALLY LAND ON. Checked before the badge, because "the badge never appeared"
  // is the same symptom whether the Forge is broken or whether this never opened the Forge at all --
  // and those are repairs in different files. A wrong address should say so in one line.
  const landed = await waitFor(page, `location.pathname === '/forge.html'`, 40, 250);
  check('the review actually opened the Forge page', Boolean(landed),
    landed ? forgeUrl : `landed on ${await page.eval('location.href')} instead of ${forgeUrl}`);
  if (!landed) throw new Error(`the review never reached ${forgeUrl}`);

  const ready = await waitFor(page, `document.querySelector('#runtime-badge')?.textContent === 'FORGE READY'`);
  check('Forge boots in the real browser', Boolean(ready));
  if (!ready) throw new Error('Forge never reached FORGE READY');

  await waitFor(page, `document.querySelector('#meshy-badge')?.textContent !== 'MESHY …'`, 40, 100);
  const boot = await page.eval(`({
    animationCount: document.querySelector('#animation-select').options.length,
    fitName: document.querySelector('#fit-asset-name').textContent,
    meshyBadge: document.querySelector('#meshy-badge').textContent,
    generateDisabled: document.querySelector('#meshy-generate').disabled,
    transformText: document.querySelector('#transform-readout').textContent,
  })`);
  check('Hero animation clips populate the Forge selector', boot.animationCount > 0, `count=${boot.animationCount}`);
  check('CI Forge cannot spend Meshy credits', boot.meshyBadge === 'MESHY LOCKED' && boot.generateDisabled === true,
    `${boot.meshyBadge}; generateDisabled=${boot.generateDisabled}`);
  check('fit packet advertises v2 world-space schema',
    boot.transformText.includes('galaquest.asset-forge-fit/2') && boot.transformText.includes('"rotationSpace": "world"'));

  const helmetInitial = await page.eval(anchorState('helmet_dawnwarden_v1', 'Head'));
  check('Dawnwarden helmet is the live locked initial candidate', helmetInitial?.visible === true && boot.fitName === 'Dawnwarden Helmet');
  check('helmet semantic coverage is live hair + ears', JSON.stringify(helmetInitial?.hidden) === JSON.stringify(['hair', 'ears']), JSON.stringify(helmetInitial?.hidden));
  check('Forge starts in deterministic fit pose', helmetInitial?.playing === false && helmetInitial?.clip === null,
    `playing=${helmetInitial?.playing}; clip=${helmetInitial?.clip}`);
  await screenshot(page, 'forge-helmet-locked-baseline');

  await page.eval(`document.querySelector('[data-nudge="y"][data-sign="1"]').click()`);
  await sleep(120);
  const helmetNudged = await page.eval(anchorState('helmet_dawnwarden_v1', 'Head'));
  const helmetDelta = helmetNudged.position.map((value, index) => value - helmetInitial.position[index]);
  check('helmet Y+ moves the actual anchor +5 mm in WORLD Y',
    near(helmetDelta[0], 0) && near(helmetDelta[1], 0.005) && near(helmetDelta[2], 0), JSON.stringify(helmetDelta));
  await page.eval(`document.querySelector('#reset-fit').click()`);
  await sleep(80);
  const helmetReset = await page.eval(anchorState('helmet_dawnwarden_v1', 'Head'));
  check('helmet Reset restores the owner-locked baseline', sameVector(helmetReset.position, helmetInitial.position));

  // Switch through the actual asynchronous candidate loader, not a synthetic mount.
  await page.eval(`document.querySelector('[data-asset="sword_dawnwarden_v1"]').click()`);
  const swordSelected = await waitFor(page, `document.querySelector('#fit-asset-name')?.textContent === 'Dawnwarden Sword'`, 100, 150);
  check('Dawnwarden sword candidate loads and becomes active', Boolean(swordSelected));
  const swordInitial = await page.eval(anchorState('sword_dawnwarden_v1', 'RightHand'));
  check('switching helmet -> sword clears semantic head coverage', JSON.stringify(swordInitial?.hidden) === JSON.stringify([]), JSON.stringify(swordInitial?.hidden));
  check('sword starts in fit pose with owner placement as zero delta', swordInitial?.playing === false && swordInitial?.clip === null
    && Number(await page.eval(`document.querySelector('#rot-z').value`)) === 0);

  await page.eval(`document.querySelector('[data-rotate="z"][data-sign="1"]').click()`);
  await sleep(120);
  const swordRotated = await page.eval(anchorState('sword_dawnwarden_v1', 'RightHand'));
  check('visible sword rotation nudge writes +5 degrees', near(Number(await page.eval(`document.querySelector('#rot-z').value`)), 5, 1e-9));
  check('sword rotation changes the actual mounted anchor quaternion', quaternionChanged(swordInitial.quaternion, swordRotated.quaternion),
    `before=${JSON.stringify(swordInitial.quaternion)} after=${JSON.stringify(swordRotated.quaternion)}`);
  check('sword rotation moves real candidate geometry', swordInitial.sample && swordRotated.sample && !sameVector(swordInitial.sample, swordRotated.sample, 1e-4),
    `before=${JSON.stringify(swordInitial.sample)} after=${JSON.stringify(swordRotated.sample)}`);
  await screenshot(page, 'forge-sword-world-rotation');

  // Direct typed values use the same path as the user-reported failure and must visibly change the mesh.
  const beforeTyped = swordRotated;
  await page.eval(`(() => { const el = document.querySelector('#rot-y'); el.value = '73'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(120);
  const afterTyped = await page.eval(anchorState('sword_dawnwarden_v1', 'RightHand'));
  check('typed large sword rotation is applied, not swallowed', Number(await page.eval(`document.querySelector('#rot-y').value`)) === 73
    && quaternionChanged(beforeTyped.quaternion, afterTyped.quaternion));

  const beforeScale = afterTyped.localScale;
  await page.eval(`document.querySelector('[data-scale-nudge="1"]').click()`);
  await sleep(80);
  const afterScale = await page.eval(anchorState('sword_dawnwarden_v1', 'RightHand'));
  check('scale +2% changes all local scale axes', afterScale.localScale.every((value, index) => near(value / beforeScale[index], 1.02, 1e-5)),
    `${JSON.stringify(beforeScale)} -> ${JSON.stringify(afterScale.localScale)}`);

  await page.eval(`document.querySelector('#reset-fit').click()`);
  await sleep(80);
  const swordReset = await page.eval(anchorState('sword_dawnwarden_v1', 'RightHand'));
  check('sword Reset restores exact owner baseline after rotation + scale edits',
    sameVector(swordReset.localPosition, swordInitial.localPosition) && sameVector(swordReset.localQuaternion, swordInitial.localQuaternion)
      && sameVector(swordReset.localScale, swordInitial.localScale));

  // Animation is an inspection lane. It must advance; the next fit edit must return to bind pose.
  const animationName = await page.eval(`document.querySelector('#animation-select').options[0].value`);
  await page.eval(`(() => { const el = document.querySelector('#animation-select'); el.value = el.options[0].value; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  // WAIT FOR THE ANIMATION TO ADVANCE, DO NOT SLEEP AND HOPE. This was `sleep(450)`, and 450ms is a
  // guess about frames dressed as a guess about time: mixer time advances only when a frame renders,
  // so on a fast machine that buys about 27 frames and half a second of clip, and on a starved CI
  // runner it buys one. Measured hosted at 5b5f0aa -- the clip was selected and playing exactly as
  // asked (`clip=Armature|running|baselayer`) and `time=0.0043`, so the check reported the animation
  // lane broken because it had looked 4 milliseconds in. Locally the same line reads 0.5545.
  //
  // Polling for the condition costs nothing when the machine is quick and simply waits when it is
  // not, which is the whole difference. Fifth instance of this in the repo; the walks, the animation
  // clocks and play-fight's settle budget are the others.
  await waitFor(page, `(${anchorState('sword_dawnwarden_v1', 'RightHand')}).time > 0.05`);
  const animated = await page.eval(anchorState('sword_dawnwarden_v1', 'RightHand'));
  check('animation selection starts playback and advances time', animated.playing === true && animated.clip === animationName && animated.time > 0.05,
    `clip=${animated.clip}; time=${animated.time}`);

  await page.eval(`document.querySelector('[data-rotate="x"][data-sign="1"]').click()`);
  await sleep(100);
  const editAfterAnimation = await page.eval(anchorState('sword_dawnwarden_v1', 'RightHand'));
  check('editing after animation automatically returns to deterministic fit pose', editAfterAnimation.playing === false && editAfterAnimation.clip === null,
    `playing=${editAfterAnimation.playing}; clip=${editAfterAnimation.clip}`);
  await page.eval(`document.querySelector('#reset-fit').click()`);

  await page.send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true });
  await page.eval(`window.dispatchEvent(new Event('resize'))`);
  await sleep(150);
  const tablet = await page.eval(`({
    assetToggle: getComputedStyle(document.querySelector('#mobile-assets')).display,
    fitToggle: getComputedStyle(document.querySelector('#mobile-fit')).display,
    canvasWidth: document.querySelector('#forge-canvas').getBoundingClientRect().width,
    canvasHeight: document.querySelector('#forge-canvas').getBoundingClientRect().height,
  })`);
  check('tablet Forge uses drawers and preserves a real 3D viewport', tablet.assetToggle !== 'none' && tablet.fitToggle !== 'none'
    && tablet.canvasWidth > 600 && tablet.canvasHeight > 850, JSON.stringify(tablet));
  await screenshot(page, 'forge-tablet-audited');
} finally {
  if (browser && targetId) await browser.send('Target.closeTarget', { targetId }).catch(() => {});
  const stopped = await server.kill();
  check('owned Forge server tears down cleanly', stopped);
}

console.log(`\n${failures === 0 ? 'FORGE REVIEW HARNESS GREEN' : `FORGE REVIEW HARNESS: ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
