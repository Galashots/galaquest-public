/**
 * Photograph the hero ATTACKING in the running game, frame by frame, and record what the skeleton
 * does on every single rendered frame while he does it.
 *
 *   node tools/runtime-test/review-hero-attack.mjs [--label before|after]
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223.
 *
 * WHY SCREENCAST AND NOT SCREENSHOTS. The defect AP1 proved is ONE FRAME long. `Page.captureScreenshot`
 * takes tens of milliseconds to come back, so a burst of them samples maybe one frame in four and
 * would miss a 16 ms event almost every time -- and "I photographed it and saw nothing" would then
 * be evidence of nothing at all. `Page.startScreencast` pushes a frame as each one is painted, so a
 * one-frame flash is actually in the recording. This is the same trap play-fight.mjs already paid
 * for once, where three swing captures turned out to be photographs of a corpse while every check
 * passed: the assertion and the photograph were of different moments.
 *
 * WHY THERE IS ALSO A PER-FRAME RECORDER. A screencast tells you what it looked like; it cannot tell
 * you which bone moved. An in-page rAF hook samples the hero's head and hip world height, the
 * Armature's world scale, and whether anything under the character is invisible, once per rendered
 * frame. The two together answer the owner's ruling 3 directly: whether the ordinary attack shows a
 * rendering/root/visibility defect, or only the ~0.53 m hard pose cuts AP1 measured.
 *
 * THE SCENARIOS, in the order the ruling names them:
 *   1. repeated attacks from idle, nowhere near the wolf, so he cannot die
 *   2. attacks immediately after movement stops
 *   3. the swing start and end boundaries specifically
 *   4. the death-mid-swing reproducer, which is the one AP1 proved
 *
 * Exits 0 unconditionally. It is an instrument, not a gate -- its product is the frames and the
 * per-frame record, and a person decides what they show.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from './owned-server.mjs';
// The bite, imported rather than assumed. This file used to soften the hero to `hp <= 1`, which was
// "one bite from the floor" on the pre-P2 scale and became unreachable when the fight was rescaled:
// a hero now goes 30 -> 20 -> 10 -> 0 and never passes through 1, so the loop would have run to its
// deadline and the scenario would have swung at full health -- exactly the vacuous pass GQ-017 warns
// about, where a probe stops meaning anything without going red.
import { HERO_MAX_HP, WOLF_BITE_DAMAGE } from '../../public/src/combat/encounter.js';
import { authoredWolfSource } from './in-page-driver.mjs';

const CHROME_PORT = 9224;
const args = process.argv.slice(2);
const LABEL = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'before';

const server = await startOwnedServer();
const ORIGIN_UNDER_TEST = server.origin;
const URL_UNDER_TEST = server.url;
const OUT = fileURLToPath(new URL(`../../.local/runtime-test/hero-attack-${LABEL}/`, import.meta.url));
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  on(fn) { this.listeners.push(fn); }
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
      }, 30000);
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
await page.send('Log.enable');

const consoleErrors = [];
page.on((msg) => {
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(msg.params.entry.text);
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.text);
});

// GQ-008.
await page.send('Storage.clearDataForOrigin', { origin: ORIGIN_UNDER_TEST, storageTypes: 'local_storage' });
await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Page.navigate', { url: URL_UNDER_TEST });

let heroReady = false;
for (let i = 0; i < 80 && !heroReady; i += 1) {
  await sleep(500);
  heroReady = await page.eval('Boolean(window.__galaQuestRuntime && window.__galaQuestRuntime.hero)');
}
if (!heroReady) throw new Error(`runtime never came up on ${URL_UNDER_TEST}`);

/**
 * Sample the character once per RENDERED frame, from inside the page.
 *
 * Deliberately hooks requestAnimationFrame rather than polling over CDP: a poll from Node samples
 * whenever the round trip happens to land, which is exactly the sampling error that would hide a
 * one-frame event. This runs in the same frame cadence the renderer does.
 *
 * It READS the scene graph and writes nothing back, so it cannot itself perturb what it measures.
 */
await page.eval(`(() => {
  const r = window.__galaQuestRuntime;
  const THREEVec = r.camera.position.constructor;
  const samples = [];
  window.__apRecord = samples;
  const root = r.hero.root ?? r.hero;
  const find = (n) => root.getObjectByName(n);
  const nodes = { head: find('head_end'), hips: find('Hips'), armature: find('Armature') };
  const p = new THREEVec(); const s = new THREEVec();
  const q = { x: 0, y: 0, z: 0, w: 1 };

  function sample() {
    const state = r.encounterState?.() ?? {};
    const hero = state.hero ?? {};
    let hidden = 0;
    root.traverse((o) => { if (!o.visible) hidden += 1; });
    const rec = {
      t: performance.now(),
      swingSeconds: hero.swingSeconds ?? -1,
      downSeconds: hero.downSeconds ?? -1,
      hidden,
      rootVisible: root.visible,
    };
    if (nodes.head) { nodes.head.getWorldPosition(p); rec.headY = +p.y.toFixed(5); }
    if (nodes.hips) { nodes.hips.getWorldPosition(p); rec.hipsY = +p.y.toFixed(5); }
    if (nodes.armature) {
      nodes.armature.getWorldScale(s); rec.armScale = +s.x.toFixed(6);
      nodes.armature.getWorldPosition(p); rec.armY = +p.y.toFixed(5);
    }
    samples.push(rec);
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
  return true;
})()`);
console.log('per-frame recorder attached');

const touch = (type, points) => page.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: points.map((pt, i) => ({ x: pt.x, y: pt.y, id: pt.id ?? i })),
});
const attackX = VIEWPORT.width - 68;
const attackY = VIEWPORT.height - 68;
async function tapAttack() {
  await touch('touchStart', [{ x: attackX, y: attackY }]);
  await sleep(40);
  await touch('touchEnd', []);
}
const stickX = VIEWPORT.width * 0.18;
const stickY = VIEWPORT.height * 0.86;

// Screencast frames arrive as they are painted. Every one is kept with its metadata timestamp so a
// frame can be matched back to the per-frame record afterwards.
// SCREENCAST WAS TRIED FIRST AND DOES NOT WORK HERE. `Page.startScreencast` delivered THREE frames
// across twenty seconds while the page's own rAF hook recorded 959, and again 3 against 4153 after
// `Page.bringToFront` -- the compositor on this automation Chrome simply does not ship frames to a
// programmatically created target. So the visual strip is burst `Page.captureScreenshot` instead.
//
// The cost is stated rather than hidden: a burst samples roughly every 30-60 ms against a 16.7 ms
// frame, so it CANNOT be relied on to catch a one-frame event. It is the right instrument for "what
// does the attack look like as a sequence", which is what ruling 3 asks for, and the wrong one for
// "photograph the single flash frame" -- that claim rests on the per-frame recorder below and on
// AP1's Node proof, both of which sample every frame.
const frames = [];
async function burst(name, count, gapMs = 0) {
  for (let i = 0; i < count; i += 1) {
    const [{ data }, state] = await Promise.all([
      page.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 }),
      page.eval(`(() => { const s = window.__galaQuestRuntime.encounterState() ?? {};
        return JSON.stringify({ swing: s.hero?.swingSeconds ?? -1, down: s.hero?.downSeconds ?? -1 }); })()`),
    ]);
    frames.push({ name: `${name}-${String(i).padStart(2, '0')}`, data, state: JSON.parse(state) });
    if (gapMs) await sleep(gapMs);
  }
}

const marks = [];
const mark = async (name) => {
  const t = await page.eval('performance.now()');
  marks.push({ name, t, wall: Date.now() });
  console.log(`  mark ${name}`);
};

await page.send('Page.bringToFront');
console.log('capture ready');

// A fault in any one scenario must not throw away the frames the earlier ones already produced --
// the first run of this file died on the last scenario and wrote nothing at all.
let scenarioError = null;
try {
// --- 1. repeated attacks from idle, far from the wolf so he cannot die -------------------------
await mark('idle-before-attacks');
await sleep(600);
for (let i = 0; i < 4; i += 1) {
  await mark(`attack-${i}-start`);
  if (i === 0) await burst('a-pre', 4);          // the frames immediately BEFORE the swing
  await tapAttack();
  if (i === 0) await burst('b-during', 24);      // straight through the 1.5 s swing
  else await sleep(1700);
  await mark(`attack-${i}-end`);
  if (i === 0) await burst('c-post', 10);        // and the boundary out of it
  await sleep(400);
}

// --- 2. attack immediately after movement stops -------------------------------------------------
await mark('walk-start');
await touch('touchStart', [{ x: stickX, y: stickY }]);
await touch('touchMove', [{ x: stickX + 40, y: stickY - 40 }]);
await sleep(900);
await touch('touchEnd', []);
await mark('walk-stopped');
await sleep(60);
await mark('attack-after-walk-start');
await tapAttack();
await sleep(1900);
await mark('attack-after-walk-end');

// --- 3. attack DURING movement, with two real fingers -------------------------------------------
//
// This is how a child actually plays -- left thumb on the stick, right thumb on ATTACK -- and it is
// the one case a single-finger harness cannot reach. It needs genuine multi-touch: CDP wants EVERY
// live touch point in each event, and each finger needs its own id. The first version reused id 0
// for both, so the attack's touchStart replaced the stick, its touchEnd released everything, and the
// stick's own touchEnd then failed with "Must send a TouchStart first to start a new touch" -- after
// the whole run had otherwise completed and with nothing yet written to disk.
const STICK = { x: stickX + 40, y: stickY - 40, id: 0 };
const ATTACK = { x: attackX, y: attackY, id: 1 };
await touch('touchStart', [{ x: stickX, y: stickY, id: 0 }]);
await touch('touchMove', [STICK]);
await sleep(300);
await mark('attack-while-walking');
await touch('touchStart', [STICK, ATTACK]);   // second finger down, first still held
await sleep(40);
await touch('touchEnd', [STICK]);             // attack finger up, stick still held
await sleep(1700);
await touch('touchEnd', []);                  // stick up
await sleep(600);

// --- 4. the death-mid-swing reproducer ----------------------------------------------------------
//
// This is the case AP1 PROVED in Node: a swing ending while the hero is down restores the pose
// captured when the swing began, and locomotion is not running to correct it. Everything above is
// the ordinary attack, which is what the owner actually described; this is the one the numbers predict.
// Reaching it means genuinely losing a fight, so the harness walks to the wolf and keeps swinging.
await mark('walk-to-wolf-start');
const liveState = () => page.eval(`(() => {
  const r = window.__galaQuestRuntime;
  const s = r.encounterState() ?? {};
  const authoredWolf = ${authoredWolfSource()};
  return JSON.stringify({
    hero: { x: r.player.position.x, z: r.player.position.z, hp: s.hero?.hp, down: s.hero?.downSeconds ?? -1 },
    enemy: { enemyId: authoredWolf.enemyId, x: authoredWolf.x, z: authoredWolf.z, hp: authoredWolf.hp },
    heading: r.follow.heading,
  });
})()`).then(JSON.parse);

// Inverting camera/rotation.js's screenToWorld for a world direction, exactly as drive-village.mjs
// documents: sx = -cos(h)*nx + sin(h)*nz, sy = sin(h)*nx + cos(h)*nz, then the stick pixel offset is
// (sx*radius, -sy*radius). Hardcoding "screen-right is world -X" is only true at heading 0.
const STICK_PX = 56;
async function stickToward(nx, nz, heading) {
  const len = Math.hypot(nx, nz) || 1;
  const [ux, uz] = [nx / len, nz / len];
  const sx = -Math.cos(heading) * ux + Math.sin(heading) * uz;
  const sy = Math.sin(heading) * ux + Math.cos(heading) * uz;
  await touch('touchMove', [{ x: stickX + sx * STICK_PX, y: stickY - sy * STICK_PX, id: 0 }]);
}

let live = await liveState();
if (live.enemy) {
  await touch('touchStart', [{ x: stickX, y: stickY, id: 0 }]);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    live = await liveState();
    if (!live.enemy) break;
    const dx = live.enemy.x - live.hero.x;
    const dz = live.enemy.z - live.hero.z;
    if (Math.hypot(dx, dz) < 1.3) break;
    await stickToward(dx, dz, live.heading);
    await sleep(120);
  }
  await touch('touchEnd', []);
  await mark('at-wolf');

  // Keep swinging until he goes down. A swing is 1.5 s and the wolf bites every 2.6 s, so a hero
  // who never disengages loses eventually -- which is the state this scenario needs.
  // DO NOT ATTACK YET. The first version swung continuously and simply won every fight -- 2425
  // frames of swing and zero frames down. Standing and taking bites until one bite is left, and
  // only THEN swinging, is what makes the killing bite land while a swing is actually running.
  const softenDeadline = Date.now() + 40000;
  while (Date.now() < softenDeadline) {
    live = await liveState();
    if (live.hero.down >= 0 || (live.hero.hp ?? HERO_MAX_HP) <= WOLF_BITE_DAMAGE) break;
    await sleep(200);
  }
  await mark(`softened-to-hp-${live.hero.hp}`);

  const fightDeadline = Date.now() + 40000;
  let wentDown = false;
  while (Date.now() < fightDeadline && !wentDown) {
    await tapAttack();
    for (let i = 0; i < 16 && !wentDown; i += 1) {
      await sleep(90);
      live = await liveState();
      if (live.hero.down >= 0) {
        wentDown = true;
        await mark('hero-down-mid-swing');
        await burst('d-death', 14);   // through the fall and the stand-up
      }
    }
  }
  console.log(`  hero went down: ${wentDown}`);
  await sleep(2500); // through the respawn, so the stand-up frames are in the recording too
  await mark('after-respawn');
} else {
  console.log('  no wolf in the encounter state -- death-mid-swing scenario skipped');
}

} catch (error) {
  scenarioError = error;
  console.error(`SCENARIO FAILED (frames so far are still written): ${error.message}`);
}

console.log(`captured ${frames.length} frames`);

const record = await page.eval('JSON.stringify(window.__apRecord)').then(JSON.parse);
console.log(`per-frame record: ${record.length} frames`);

/**
 * A "flash" in this record is a frame whose head height differs sharply from BOTH neighbours -- a
 * spike, not a transition. A transition (going down, standing up) moves and stays moved.
 */
const SPIKE_METRES = 0.20;
const spikes = [];
for (let i = 1; i < record.length - 1; i += 1) {
  const a = record[i - 1]; const b = record[i]; const c = record[i + 1];
  if (a.headY === undefined || b.headY === undefined || c.headY === undefined) continue;
  const up = b.headY - a.headY;
  const down = b.headY - c.headY;
  if (Math.abs(up) > SPIKE_METRES && Math.abs(down) > SPIKE_METRES && Math.sign(up) === Math.sign(down)) {
    spikes.push({ index: i, ...b, prevHeadY: a.headY, nextHeadY: c.headY });
  }
}

const headYs = record.filter((r) => r.headY !== undefined).map((r) => r.headY);
const scales = record.filter((r) => r.armScale !== undefined).map((r) => r.armScale);
const everHidden = record.some((r) => r.hidden > 0 || r.rootVisible === false);

console.log('');
console.log(`head_end world Y   min ${Math.min(...headYs).toFixed(4)}  max ${Math.max(...headYs).toFixed(4)}`);
console.log(`armature scale     min ${Math.min(...scales).toFixed(6)}  max ${Math.max(...scales).toFixed(6)}`);
console.log(`anything invisible ${everHidden ? 'YES' : 'no'}`);
console.log(`one-frame head spikes over ${SPIKE_METRES} m: ${spikes.length}`);
for (const s of spikes.slice(0, 10)) {
  console.log(`  frame ${s.index}  head ${s.prevHeadY.toFixed(4)} -> ${s.headY.toFixed(4)} -> ${s.nextHeadY.toFixed(4)}`
    + `  swing=${s.swingSeconds.toFixed(3)} down=${s.downSeconds.toFixed(2)}`);
}

// Save a contiguous strip of screencast frames around each mark, so the sheet shows the attack as a
// sequence rather than as one lucky still.
const kept = [];
frames.forEach((f) => {
  const name = `${f.name}_swing${f.state.swing.toFixed(2)}_down${f.state.down.toFixed(2)}.jpg`;
  writeFileSync(`${OUT}${name}`, Buffer.from(f.data, 'base64'));
  kept.push(name);
});

writeFileSync(`${OUT}record.json`, JSON.stringify({
  label: LABEL, marks, spikes, everHidden,
  scenarioError: scenarioError ? scenarioError.message : null,
  headY: { min: Math.min(...headYs), max: Math.max(...headYs) },
  armScale: { min: Math.min(...scales), max: Math.max(...scales) },
  frameCount: frames.length, recordCount: record.length,
  consoleErrors,
  record,
}, null, 2));

console.log(`\n${kept.length} of ${frames.length} screencast frames written to ${OUT}`);
console.log(`console errors: ${consoleErrors.length}`);
console.log('NOTHING IS JUDGED BY THIS SCRIPT. Open the frames.');

await server.kill();
await browser.send('Target.closeTarget', { targetId }).catch(() => {});
process.exit(0);
