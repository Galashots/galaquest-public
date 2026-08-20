/**
 * The local half of the Sol review bridge (the private engineering archive).
 *
 *   node tools/sol-review/worker.mjs --once
 *
 * Reads the newest request Sol wrote to sol-review/request.json on the `sol-review-control` branch
 * (never merged to main -- see that branch's own sol-review/README.md), validates it strictly against
 * the schema stored beside this trusted worker, resolves the requested ref, runs every runtime mode
 * from a fresh detached worktree at that exact commit, and writes the result to the
 * Drive Review Bridge where Sol can fetch it herself.
 *
 * SR1 implemented `ping`: no Chrome, no game server, no checkout, proving the trust chain itself
 * (GitHub write -> local pickup -> real repo state -> Drive answer Sol verifies herself) before
 * anything with more moving parts was built on it. SR3 added `studioCapture`: opens Character Studio
 * (public/studio.html) in the isolated automation Chrome, poses the shipped Hero, and photographs it.
 * SR4 adds `studioState`: the same Studio boot, but read-only discovery -- no screenshots, no evidence
 * images -- so a caller can look up the loaded character's real runtime clip names and the protocol's
 * supported values (view scales, bearings, lighting modes, viewport presets) before spending a
 * `studioCapture` request on a guessed identifier. This is the architectural gap SR3's own seq-1 miss
 * exposed (Idle_11 vs runtime `idle`) -- see docs/MISTAKES.md's runtime-identity entry. SR5 adds
 * `studioCapture`'s optional `overlay`/`includeMeasurements` fields (Grip/Shield Inspector overlays
 * and numeric measurements drawn from the same gearInspectors.js authority) and a new `studioFitEnvelope`
 * mode: numeric-only BOE/clearance/collision reporting sampled across named clips, no screenshots
 * (armour-progression-doctrine.md section 5.4). SR5's closeout pass (Sol's own audit) adds an optional
 * `tuningOverride` field to both `studioCapture` and `studioFitEnvelope`: a small, allow-listed,
 * non-destructive typed delta (position/rotation/scale) against the shipping sword/shield mount, for
 * Sol's own direct deliberate-tuning-delta proof -- never persistent, never a second fit solver, always
 * composed on top of the immutable shipping transform (see gearInspectors.js's own header).
 *
 * SECURITY: this worker is a narrow, allow-listed protocol handler, not a command executor. It never
 * shells out to anything named IN the request, never eval()s request content, and the schema's
 * `additionalProperties: false` plus closed `mode` enum are what actually enforce that -- this file
 * trusts the schema rather than re-deciding safety per field.
 *
 * REUSES RP1's evidence vocabulary (the private engineering archive)
 * rather than inventing a parallel one: SHA attribution, explicit timestamps, and stating limitations
 * plainly (Drive unreachable, request rejected, Chrome busy, and why) instead of a manifest that only
 * ever says ok.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validate, alreadySeen, withSeen } from './protocol.mjs';
import { startOwnedServer } from '../runtime-test/owned-server.mjs';
import { createDetachedReviewWorktree, resolveRequestedRef } from './reviewCheckout.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CONTROL_BRANCH = 'sol-review-control';
const CONTROL_JSON_PATH = 'sol-review/request.json';
const TRUSTED_SCHEMA_PATH = join(REPO_ROOT, 'tools', 'sol-review', 'request.schema.json');
const WORKTREE_ROOT = join(REPO_ROOT, '.local', 'sol-review', 'worktrees');
const SEEN_STORE = join(REPO_ROOT, '.local', 'sol-review', 'seen.json');
const DRIVE_ROOT = process.env.GQ_REVIEW_BRIDGE_ROOT ?? "";
const LOCAL_FALLBACK_ROOT = join(REPO_ROOT, '.local', 'sol-review', 'out');
const WORKER_VERSION = 'sol-review-worker/1';
const CHROME_PORT = 9224;
// Mirrors public/src/character/hero.js's own HERO_URL -- not imported directly, because that module
// (and everything it pulls in: assets.js's GLTFLoader, three.js) assumes a browser (fetch, Image,
// WebGL), same reason every other Node-side harness in tools/runtime-test/ hardcodes this path too
// (review-shipping-assets.mjs's own manifest does the same thing).
const HERO_ASSET_RELATIVE_PATH = 'assets/hero/hero_lod1_ironwood_atlas.glb';

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

/** Same "try, fall back to null rather than throw" shape RP1's run-review-suite.mjs uses for git
 *  facts that are allowed to be unavailable (e.g. resolving a ref that does not exist). */
function gitOrNull(args) {
  try { return git(args); } catch { return null; }
}

// ── seen-sequence protection (.local/, per-machine, gitignored -- same convention every runtime-test
//    harness's own .local/ scratch state already uses) ─────────────────────────────────────────────
function loadSeen() {
  if (!existsSync(SEEN_STORE)) return {};
  try { return JSON.parse(readFileSync(SEEN_STORE, 'utf8')); } catch { return {}; }
}
function recordSeen(seen, sessionId, seq) {
  mkdirSync(join(REPO_ROOT, '.local', 'sol-review'), { recursive: true });
  writeFileSync(SEEN_STORE, JSON.stringify(withSeen(seen, sessionId, seq), null, 2));
}

function driveRootAvailable() {
  return existsSync((process.env.GQ_REVIEW_BRIDGE_ROOT ?? ""));
}

function sessionStepDir(sessionId, seq) {
  const stepDir = `step-${String(seq).padStart(4, '0')}`;
  const useDrive = driveRootAvailable();
  const base = useDrive ? join(DRIVE_ROOT, sessionId, stepDir) : join(LOCAL_FALLBACK_ROOT, sessionId, stepDir);
  mkdirSync(base, { recursive: true });
  return { base, useDrive };
}

function writeResult(sessionId, seq, result, useDrive) {
  const { base } = sessionStepDir(sessionId, seq);
  const file = join(base, 'result.json');
  result.driveOutputPath = useDrive
    ? `SolSessions/${sessionId}/step-${String(seq).padStart(4, '0')}/result.json`
    : null;
  if (!useDrive) result.status = result.status === 'ok' ? 'ok-not-synced' : result.status;
  writeFileSync(file, JSON.stringify(result, null, 2));
  return file;
}

function baseResultFields(sessionId, seq, requestCommitSha, ref, review = null) {
  // Attribution should still be written if origin/main becomes temporarily unreachable after the
  // exact review checkout has already been created. Main is context; `actualReviewedSha` is proof.
  gitOrNull(['fetch', '--no-tags', 'origin', '+main:refs/remotes/origin/main']);
  return {
    protocolVersion: 1,
    sessionId,
    seq,
    requestCommitSha,
    requestedRef: review?.requestedRef ?? ref ?? null,
    resolvedRequestedRefSha: review?.sha
      ?? (ref ? gitOrNull(['rev-parse', `origin/${ref}`]) ?? gitOrNull(['rev-parse', ref]) : null),
    actualReviewedSha: review?.actualSha ?? null,
    reviewCheckout: review ? 'isolated-detached-worktree' : null,
    resolvedOriginMainSha: gitOrNull(['rev-parse', 'origin/main']),
    workerVersion: WORKER_VERSION,
    workerImplementationSha: gitOrNull(['rev-parse', 'HEAD']),
    timestamp: new Date().toISOString(),
  };
}

// ── ping (SR1) ──────────────────────────────────────────────────────────────────────────────────
// No checkout happens here (Sol's own instruction: do not couple the communication proof to runtime
// complexity), so "dirty/ambiguous review checkout" does not apply -- that check belongs to
// studioCapture below, which does load real assets.
function executePing(sessionId, seq, requestCommitSha, ref) {
  const result = { ...baseResultFields(sessionId, seq, requestCommitSha, ref), status: 'ok' };
  const { useDrive } = sessionStepDir(sessionId, seq);
  const file = writeResult(sessionId, seq, result, useDrive);
  return { file, useDrive, result };
}

// ── studioCapture (SR3) ─────────────────────────────────────────────────────────────────────────
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
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, 20000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`eval threw: ${r.exceptionDetails.text ?? JSON.stringify(r.exceptionDetails)}`);
    return r.result.value;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Shared automation Chrome, not this worker's own. Never kill/restart it to take ownership
 *  (owner-plan.md section 10/RP1 doctrine) -- if a GAME server page is already open there, another
 *  session is using it and this request is deferred rather than colliding with it. A non-game tab
 *  (e.g. someone's ChatGPT tab) does not count as busy. */
async function chromeBusyWithAGame() {
  const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json()).catch(() => null);
  if (!list) throw new Error(`isolated Chrome not reachable on port ${CHROME_PORT}`);
  return list.some((t) => /^https?:\/\/127\.0\.0\.1:5\d{3}\//.test(t.url ?? ''));
}

// Sol's SR4 audit finding: bootStudioPage() advertised 'portrait'/'landscape' as supported
// (studioState's supportedViewportPresets) while unconditionally applying PORTRAIT_VIEWPORT --
// studioCapture could never actually produce a landscape capture. Fixed by threading the preset
// through and applying the matching constant; no dimensions are re-typed here, both come from
// cameraPresets.js, the same canonical source every other review harness already uses.
const VIEWPORT_PRESET_NAMES = Object.freeze(['portrait', 'landscape']);

/** Shared boot sequence for both studioCapture and studioState -- owned server, a fresh target in
 *  the shared automation Chrome, Character Studio navigated and polled for
 *  window.__galaQuestStudioReady. Caller still owns the chrome-busy and asset-existence checks
 *  above this, since the two modes write different result shapes on those failures. */
async function bootStudioPage(viewportPreset = 'portrait', repoRoot = REPO_ROOT) {
  if (!VIEWPORT_PRESET_NAMES.includes(viewportPreset)) {
    throw new Error(`unknown viewportPreset "${viewportPreset}" -- expected one of ${VIEWPORT_PRESET_NAMES.join(', ')}`);
  }
  const server = await startOwnedServer({ repoRoot });
  let page = null;
  let targetId = null;
  try {
    const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((r) => r.json());
    const browser = new CDP(version.webSocketDebuggerUrl);
    await browser.ready();
    ({ targetId } = await browser.send('Target.createTarget', { url: 'about:blank' }));
    const list = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((r) => r.json());
    const target = list.find((t) => t.id === targetId);
    if (!target?.webSocketDebuggerUrl) throw new Error(`Chrome target ${targetId} was not discoverable`);
    page = new CDP(target.webSocketDebuggerUrl);
    await page.ready();
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    const { PORTRAIT_VIEWPORT, LANDSCAPE_VIEWPORT } = await import(
      pathToFileURL(join(repoRoot, 'public', 'src', 'review', 'cameraPresets.js')).href,
    );
    const viewportMetrics = viewportPreset === 'landscape' ? LANDSCAPE_VIEWPORT : PORTRAIT_VIEWPORT;
    await page.send('Emulation.setDeviceMetricsOverride', viewportMetrics);
    await page.send('Page.navigate', { url: `${server.url}studio.html` });

    let ready = false;
    for (let i = 0; i < 40 && !ready; i += 1) {
      await sleep(500);
      ready = await page.eval('Boolean(window.__galaQuestStudioReady)').catch(() => false);
    }
    return {
      server, page, targetId, ready, viewportPreset,
    };
  } catch (error) {
    if (page && targetId) await page.send('Target.closeTarget', { targetId }).catch(() => {});
    await server.kill?.();
    throw error;
  }
}

async function closeStudioPage({ page, targetId, server }) {
  await page.send('Target.closeTarget', { targetId }).catch(() => {});
  // owned-server.mjs's kill() now independently verifies the port is actually free before resolving
  // true (SR5 closeout fix, docs/MISTAKES.md's selftest-teardown entry) -- a false here means teardown
  // could not be confirmed, worth logging loudly rather than silently proceeding as if it succeeded.
  const confirmed = await server.kill?.();
  if (confirmed === false) {
    console.error(`WARNING: could not confirm owned server on port ${server.port} actually terminated`);
  }
}

async function executeStudioCapture(sessionId, seq, requestCommitSha, ref, req, review) {
  if (await chromeBusyWithAGame()) {
    const result = {
      ...baseResultFields(sessionId, seq, requestCommitSha, ref, review),
      status: 'blocked-chrome-busy',
      message: `port ${CHROME_PORT} already has a game page open -- another session may be using it. Not killing/restarting it (owner-plan.md section 10). Ask the owner for a runtime-review window and retry with a new seq.`,
    };
    const { useDrive } = sessionStepDir(sessionId, seq);
    return { file: writeResult(sessionId, seq, result, useDrive), useDrive, result };
  }

  const heroPath = join(review.repoRoot, 'public', HERO_ASSET_RELATIVE_PATH);
  if (!existsSync(heroPath)) {
    const result = {
      ...baseResultFields(sessionId, seq, requestCommitSha, ref, review),
      status: 'error',
      message: `expected asset missing: ${HERO_ASSET_RELATIVE_PATH}`,
    };
    const { useDrive } = sessionStepDir(sessionId, seq);
    return { file: writeResult(sessionId, seq, result, useDrive), useDrive, result };
  }
  const assetSha256 = createHash('sha256').update(readFileSync(heroPath)).digest('hex');

  // Allow-listed, not a generalized viewport system -- exactly the two presets studioState
  // advertises and cameraPresets.js defines. Never silently substitutes a different one.
  const viewportPreset = req.viewportPreset ?? 'portrait';
  const { server, page, targetId, ready } = await bootStudioPage(viewportPreset, review.repoRoot);

  const captures = [];
  let status = 'ok';
  let message = null;
  // Declared OUTSIDE the try block -- a const/let scoped inside it is not visible when the result
  // object is built below the try/catch (the exact scoping mistake caught and fixed earlier in this
  // same file for `overlay`/`loadout`; those are re-read from `req.*` directly for the same reason).
  let tuningOverrideReport = null;
  try {
    if (!ready) throw new Error('Character Studio never became ready (window.__galaQuestStudioReady stayed false)');

    const availableClips = await page.eval('window.__galaQuestStudio.getState().availableClips');
    const clipExists = availableClips.some((c) => c.toLowerCase() === String(req.animation).toLowerCase());
    if (!clipExists) throw new Error(`no clip named "${req.animation}" on the loaded hero -- available: ${availableClips.join(', ')}`);

    // SR4 locked comparison primitive: loadout is the ONE thing allowed to vary between two
    // otherwise-identical requests (same animation/timeSeconds/lightingMode/views) -- set it before
    // anything else so a caller comparing 'shipping' against 'candidate-with-lantern' gets truly
    // locked camera/viewport/animation-time/lighting conditions on both captures.
    const loadout = req.loadout ?? 'shipping'; // never silently defaults to a candidate state
    await page.eval(`window.__galaQuestStudio.setLoadout(${JSON.stringify(loadout)})`);

    await page.eval(`window.__galaQuestStudio.setAnimation(${JSON.stringify(req.animation)})`);
    if (req.timeSeconds !== undefined) {
      await page.eval('window.__galaQuestStudio.setAnimationPlaying(false)');
      await page.eval(`window.__galaQuestStudio.setAnimationTime(${req.timeSeconds})`);
    }
    const lightingMode = req.lightingMode ?? 'game'; // never silently defaults to diagnostic
    await page.eval(`window.__galaQuestStudio.setLightingMode(${JSON.stringify(lightingMode)})`);

    // SR5 closeout: the non-destructive typed tuning override, applied BEFORE the overlay/
    // measurements below so both reflect the tuned pose. Omitting this field entirely means
    // setTuningOverride is never called -- a fresh page boot already starts at the pristine shipping
    // mount, so "no override" always renders exact shipping state with no extra reset step needed.
    if (req.tuningOverride) {
      tuningOverrideReport = await page.eval(`window.__galaQuestStudio.setTuningOverride(${JSON.stringify(req.tuningOverride.target)}, ${JSON.stringify({
        positionDelta: req.tuningOverride.positionDelta,
        rotationDeltaDeg: req.tuningOverride.rotationDeltaDeg,
        scaleDelta: req.tuningOverride.scaleDelta,
      })})`);
      if (!tuningOverrideReport) throw new Error(`tuningOverride target "${req.tuningOverride.target}" is not mounted under the current loadout "${loadout}"`);
    }

    // SR5: the inspector overlay (if any), drawn from the same measureGrip()/measureShield() numbers
    // includeMeasurements below reads back -- see gearInspectors.js. Set after the pose is final so
    // it visualizes the pose actually captured, not a stale one.
    const overlay = req.overlay ?? 'none'; // never silently draws an overlay the caller didn't ask for
    await page.eval(`window.__galaQuestStudio.setOverlay(${JSON.stringify(overlay)})`);

    // Hide the manual-use control panel for evidence captures -- same "hide fixed/absolute overlay
    // elements outside the canvas" convention review-shipping-assets.mjs's hideHud() uses. (Studio's
    // own on-screen HUD panel, unrelated to the SR5 inspector overlay drawn in the 3D scene above.)
    await page.eval(`(() => {
      const canvas = document.querySelector('#studio-canvas');
      for (const el of document.body.querySelectorAll('*')) {
        if (el === canvas || el.contains(canvas) || el.closest('canvas')) continue;
        const style = getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'absolute') el.style.display = 'none';
      }
      return true;
    })()`);

    const { base, useDrive } = sessionStepDir(sessionId, seq);
    for (const view of req.views) {
      await page.eval(`window.__galaQuestStudio.setView(${JSON.stringify(view.scale)}, ${JSON.stringify(view.bearing)})`);
      await sleep(150);
      const state = await page.eval('window.__galaQuestStudio.getState()');
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      // loadout is IN the filename so a capture never reads as shipping out of context, even
      // detached from result.json (armour-progression-doctrine.md section 5.1: a candidate must
      // never masquerade as shipping).
      const fileName = `hero-${state.loadout}-${view.scale}-${view.bearing}.png`;
      writeFileSync(join(base, fileName), Buffer.from(data, 'base64'));
      captures.push({
        scale: view.scale,
        bearing: view.bearing,
        file: fileName,
        driveOutputPath: useDrive ? `SolSessions/${sessionId}/step-${String(seq).padStart(4, '0')}/${fileName}` : null,
        clipName: state.clipName,
        animationTimeSeconds: state.animationTimeSeconds,
        lightingMode: state.lightingMode,
        lightingAuthoritative: state.lightingAuthoritative,
        viewport: state.viewport,
        viewportPreset,
        loadout: state.loadout,
        loadoutIsShipping: state.loadoutIsShipping,
        overlay: state.overlay,
      });
    }

    if (captures.length === 0) status = 'error';
  } catch (err) {
    status = 'error';
    message = err.message;
  }

  // SR5: numeric grip/shield measurements, read at the SAME pose the captures above were taken at
  // (the loop above only changes camera scale/bearing between views, not the pose). Optional and
  // separate from the overlay -- a caller can request either, both, or neither.
  let measurements = null;
  if (req.includeMeasurements && status === 'ok') {
    measurements = await page.eval(`({
      grip: window.__galaQuestStudio.getGripMeasurement(),
      shield: window.__galaQuestStudio.getShieldMeasurement(),
    })`).catch((err) => ({ error: err.message }));
  }

  await closeStudioPage({ page, targetId, server });

  const result = {
    ...baseResultFields(sessionId, seq, requestCommitSha, ref, review),
    status,
    ...(message ? { message } : {}),
    character: 'hero',
    assetPath: HERO_ASSET_RELATIVE_PATH,
    assetSha256,
    requestedAnimation: req.animation,
    requestedTimeSeconds: req.timeSeconds ?? null,
    requestedLightingMode: req.lightingMode ?? 'game',
    requestedLoadout: req.loadout ?? 'shipping',
    requestedViewportPreset: viewportPreset,
    requestedOverlay: req.overlay ?? 'none',
    ...(req.tuningOverride ? { requestedTuningOverride: req.tuningOverride } : {}),
    ...(tuningOverrideReport ? { tuningOverride: tuningOverrideReport } : {}),
    ...(measurements ? { measurements } : {}),
    captures,
  };
  const { useDrive } = sessionStepDir(sessionId, seq);
  return { file: writeResult(sessionId, seq, result, useDrive), useDrive, result };
}

// ── studioState (SR4) ───────────────────────────────────────────────────────────────────────────
// Read-only discovery: no screenshots, no evidence images written. Boots the same Character Studio
// page studioCapture does, reads window.__galaQuestStudio.getState() once, and reports the protocol's
// own fixed vocabulary (view scales/bearings/lighting modes/viewport presets) alongside it, so a
// caller can build a studioCapture request entirely from one studioState answer plus a chosen clip
// name -- never from a Meshy/source/review label. See docs/MISTAKES.md's runtime-identity entry.
async function executeStudioState(sessionId, seq, requestCommitSha, ref, review) {
  if (await chromeBusyWithAGame()) {
    const result = {
      ...baseResultFields(sessionId, seq, requestCommitSha, ref, review),
      status: 'blocked-chrome-busy',
      message: `port ${CHROME_PORT} already has a game page open -- another session may be using it. Not killing/restarting it (owner-plan.md section 10). Ask the owner for a runtime-review window and retry with a new seq.`,
    };
    const { useDrive } = sessionStepDir(sessionId, seq);
    return { file: writeResult(sessionId, seq, result, useDrive), useDrive, result };
  }

  const heroPath = join(review.repoRoot, 'public', HERO_ASSET_RELATIVE_PATH);
  if (!existsSync(heroPath)) {
    const result = {
      ...baseResultFields(sessionId, seq, requestCommitSha, ref, review),
      status: 'error',
      message: `expected asset missing: ${HERO_ASSET_RELATIVE_PATH}`,
    };
    const { useDrive } = sessionStepDir(sessionId, seq);
    return { file: writeResult(sessionId, seq, result, useDrive), useDrive, result };
  }
  const assetSha256 = createHash('sha256').update(readFileSync(heroPath)).digest('hex');

  const { server, page, targetId, ready } = await bootStudioPage('portrait', review.repoRoot);

  let status = 'ok';
  let message = null;
  let state = null;
  try {
    if (!ready) throw new Error('Character Studio never became ready (window.__galaQuestStudioReady stayed false)');
    state = await page.eval('window.__galaQuestStudio.getState()');
  } catch (err) {
    status = 'error';
    message = err.message;
  }

  await closeStudioPage({ page, targetId, server });

  const { BEARINGS, SCALE_DISTANCES } = await import(
    pathToFileURL(join(review.repoRoot, 'public', 'src', 'review', 'cameraPresets.js')).href,
  );
  // Single source of truth: TUNING_TARGETS/TUNING_BOUNDS are gearInspectors.js's own exported
  // constants, not a second, hand-typed copy here -- the same discipline every other supported*
  // vocabulary field on this result already follows.
  const { LOADOUT_IDS } = await import(
    pathToFileURL(join(review.repoRoot, 'public', 'src', 'studio', 'loadoutDescriptors.js')).href,
  );
  const { TUNING_TARGETS, TUNING_BOUNDS } = await import(
    pathToFileURL(join(review.repoRoot, 'public', 'src', 'character', 'gearInspectors.js')).href,
  );
  const result = {
    ...baseResultFields(sessionId, seq, requestCommitSha, ref, review),
    status,
    ...(message ? { message } : {}),
    studioVersion: state?.studioVersion ?? null,
    character: state?.character ?? 'hero',
    assetPath: HERO_ASSET_RELATIVE_PATH,
    assetSha256,
    availableClips: state?.availableClips ?? [],
    currentClip: state?.clipName ?? null,
    animationTimeSeconds: state?.animationTimeSeconds ?? null,
    playing: state?.playing ?? null,
    lightingMode: state?.lightingMode ?? null,
    lightingAuthoritative: state?.lightingAuthoritative ?? null,
    viewport: state?.viewport ?? null,
    // SR4 locked comparison primitive: current loadout plus the protocol's closed vocabulary for it,
    // so a caller can discover valid `loadout` values before issuing a studioCapture request rather
    // than guessing (same discovery-before-command principle this mode already exists to serve).
    loadout: state?.loadout ?? null,
    loadoutIsShipping: state?.loadoutIsShipping ?? null,
    supportedLoadouts: LOADOUT_IDS,
    // The protocol's own fixed vocabulary, not asset data -- true regardless of which character or
    // clip is loaded, so a caller does not have to guess these from a studioCapture rejection.
    // Both derive from the same modules the Studio itself executes (scale map, loadout descriptors)
    // rather than hand-typed copies -- the exact "advertise only what you can execute" lesson
    // docs/MISTAKES.md records for viewportPreset.
    supportedViewScales: Object.keys(SCALE_DISTANCES),
    supportedBearings: BEARINGS.map(([name]) => name),
    supportedLightingModes: ['game', 'diagnostic'],
    supportedViewportPresets: ['portrait', 'landscape'],
    // SR5: same discipline the viewportPreset defect taught (docs/MISTAKES.md -- a discovery
    // endpoint must only advertise capabilities it can actually execute). setOverlay only accepts
    // these three names (scene.js's OVERLAY_MODES); studioCapture's own `overlay` field and
    // studioFitEnvelope both draw from this same closed list, never a second one.
    supportedOverlays: ['none', 'grip', 'shield'],
    // SR5 closeout: the non-destructive typed tuning override's own vocabulary -- both from
    // gearInspectors.js directly, so this can never drift from what setTuningOverride() actually
    // enforces (the exact viewportPreset-gap discipline docs/MISTAKES.md already records).
    supportedTuningTargets: TUNING_TARGETS,
    tuningBounds: TUNING_BOUNDS,
  };
  const { useDrive } = sessionStepDir(sessionId, seq);
  return { file: writeResult(sessionId, seq, result, useDrive), useDrive, result };
}

// ── studioFitEnvelope (SR5) ─────────────────────────────────────────────────────────────────────
// Doctrine 5.4 (armour-progression-doctrine.md): BOE body occupancy, FCE required clearance, MCE
// motion clearance, collision/extrema reporting over relevant clips (idle/walk/run/attack/hit).
// Numeric-only -- no screenshots, no evidence images -- the same "read-only discovery" shape
// studioState already uses. Every number here comes from scene.js's getFitEnvelope(), which itself
// only calls measureGrip()/measureShield()/computeBodyOccupancyBox() at sampled times through the
// SAME setAnimation/setAnimationTime path studioCapture uses -- no separate physics/collision
// engine, no procedural auto-fit solver (owner-plan.md section 3.3), no pass/fail verdict computed
// here. Sol reads the reported per-frame numbers and judges; this mode never grades them.
async function executeStudioFitEnvelope(sessionId, seq, requestCommitSha, ref, req, review) {
  if (await chromeBusyWithAGame()) {
    const result = {
      ...baseResultFields(sessionId, seq, requestCommitSha, ref, review),
      status: 'blocked-chrome-busy',
      message: `port ${CHROME_PORT} already has a game page open -- another session may be using it. Not killing/restarting it (owner-plan.md section 10). Ask the owner for a runtime-review window and retry with a new seq.`,
    };
    const { useDrive } = sessionStepDir(sessionId, seq);
    return { file: writeResult(sessionId, seq, result, useDrive), useDrive, result };
  }

  const heroPath = join(review.repoRoot, 'public', HERO_ASSET_RELATIVE_PATH);
  if (!existsSync(heroPath)) {
    const result = {
      ...baseResultFields(sessionId, seq, requestCommitSha, ref, review),
      status: 'error',
      message: `expected asset missing: ${HERO_ASSET_RELATIVE_PATH}`,
    };
    const { useDrive } = sessionStepDir(sessionId, seq);
    return { file: writeResult(sessionId, seq, result, useDrive), useDrive, result };
  }
  const assetSha256 = createHash('sha256').update(readFileSync(heroPath)).digest('hex');

  const { server, page, targetId, ready } = await bootStudioPage('portrait', review.repoRoot);

  let status = 'ok';
  let message = null;
  let envelope = null;
  // Declared outside the try block for the same reason studioCapture's tuningOverrideReport is --
  // needs to survive into the result object below the try/catch.
  let tuningOverrideReport = null;
  try {
    if (!ready) throw new Error('Character Studio never became ready (window.__galaQuestStudioReady stayed false)');

    const availableClips = await page.eval('window.__galaQuestStudio.getState().availableClips');
    const missing = req.clips.filter((c) => !availableClips.some((a) => a.toLowerCase() === c.toLowerCase()));
    if (missing.length > 0) throw new Error(`no clip(s) named ${missing.join(', ')} on the loaded hero -- available: ${availableClips.join(', ')}`);

    // Loadout is the one thing allowed to vary, same SR4 primitive studioCapture reuses -- a fit
    // envelope for 'candidate-with-lantern' reports genuinely different clearances than 'shipping'.
    const loadout = req.loadout ?? 'shipping';
    await page.eval(`window.__galaQuestStudio.setLoadout(${JSON.stringify(loadout)})`);

    // SR5 closeout: applied ONCE before the whole clip sweep, held constant across every sampled
    // frame -- a Fit Envelope answers "what does this delta look like across motion", not "does the
    // delta itself change per frame" (this file never invents per-frame tuning).
    if (req.tuningOverride) {
      tuningOverrideReport = await page.eval(`window.__galaQuestStudio.setTuningOverride(${JSON.stringify(req.tuningOverride.target)}, ${JSON.stringify({
        positionDelta: req.tuningOverride.positionDelta,
        rotationDeltaDeg: req.tuningOverride.rotationDeltaDeg,
        scaleDelta: req.tuningOverride.scaleDelta,
      })})`);
      if (!tuningOverrideReport) throw new Error(`tuningOverride target "${req.tuningOverride.target}" is not mounted under the current loadout "${loadout}"`);
    }

    const samples = req.samples ?? 8;
    envelope = await page.eval(
      `window.__galaQuestStudio.getFitEnvelope(${JSON.stringify(req.clips)}, ${JSON.stringify(samples)})`,
    );
  } catch (err) {
    status = 'error';
    message = err.message;
  }

  await closeStudioPage({ page, targetId, server });

  const result = {
    ...baseResultFields(sessionId, seq, requestCommitSha, ref, review),
    status,
    ...(message ? { message } : {}),
    character: 'hero',
    assetPath: HERO_ASSET_RELATIVE_PATH,
    assetSha256,
    requestedClips: req.clips,
    requestedSamples: req.samples ?? 8,
    requestedLoadout: req.loadout ?? 'shipping',
    ...(req.tuningOverride ? { requestedTuningOverride: req.tuningOverride } : {}),
    ...(tuningOverrideReport ? { tuningOverride: tuningOverrideReport } : {}),
    envelope,
  };
  const { useDrive } = sessionStepDir(sessionId, seq);
  return { file: writeResult(sessionId, seq, result, useDrive), useDrive, result };
}

// ── dispatch ────────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.argv.includes('--once')) {
    console.error('usage: node tools/sol-review/worker.mjs --once');
    console.error('(--watch is not implemented -- run --once, e.g. from a short poll loop, until it lands)');
    process.exit(2);
  }

  console.log(`fetching ${CONTROL_BRANCH}...`);
  try {
    git(['fetch', 'origin', CONTROL_BRANCH]);
  } catch (err) {
    console.error(`could not fetch origin/${CONTROL_BRANCH}: ${err.message}`);
    process.exit(1);
  }

  const requestCommitSha = gitOrNull(['rev-parse', `origin/${CONTROL_BRANCH}`]);
  if (!requestCommitSha) {
    console.error(`origin/${CONTROL_BRANCH} does not exist -- nothing to read`);
    process.exit(1);
  }

  let rawRequest;
  try {
    rawRequest = git(['show', `origin/${CONTROL_BRANCH}:${CONTROL_JSON_PATH}`]);
  } catch (err) {
    console.error(`could not read ${CONTROL_JSON_PATH} from origin/${CONTROL_BRANCH}: ${err.message}`);
    process.exit(1);
  }

  let request;
  let schema;
  try {
    schema = JSON.parse(readFileSync(TRUSTED_SCHEMA_PATH, 'utf8'));
  } catch (err) {
    console.error(`trusted schema ${TRUSTED_SCHEMA_PATH} is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  try {
    request = JSON.parse(rawRequest);
  } catch (err) {
    console.log(`REJECTED: request.json on origin/${CONTROL_BRANCH} is not valid JSON (${err.message}) -- malformed control JSON`);
    process.exit(0); // a bad request is an expected, handled outcome, not a worker failure
  }

  const errors = validate(schema, request);
  if (errors.length > 0) {
    console.log(`REJECTED: request.json at ${requestCommitSha} failed schema validation:`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(0);
  }

  const { sessionId, seq, mode, ref } = request;
  const seen = loadSeen();
  if (alreadySeen(seen, sessionId, seq)) {
    console.log(`(${sessionId}, seq ${seq}) was already processed -- skipping (bump seq for a new request)`);
    process.exit(0);
  }

  console.log(`executing ${mode} for (${sessionId}, seq ${seq})...`);

  let outcome;
  if (mode === 'ping') {
    outcome = executePing(sessionId, seq, requestCommitSha, ref);
  } else {
    // Runtime evidence must come from the requested commit, never the worker's current/dirty tree.
    // `main` is the deterministic backwards-compatible default for older requests that omitted ref;
    // new requests should always send an explicit branch, tag or exact SHA.
    const requestedRef = ref ?? 'main';
    let checkout = null;
    try {
      const sha = resolveRequestedRef(REPO_ROOT, requestedRef);
      const worktreePath = join(
        WORKTREE_ROOT,
        `${sessionId}-${String(seq).padStart(4, '0')}-${sha.slice(0, 12)}-${process.pid}`,
      );
      checkout = createDetachedReviewWorktree({ repoRoot: REPO_ROOT, sha, worktreePath });
      const review = { ...checkout, requestedRef };

      if (mode === 'studioCapture') {
        outcome = await executeStudioCapture(sessionId, seq, requestCommitSha, ref, request.request, review);
      } else if (mode === 'studioState') {
        outcome = await executeStudioState(sessionId, seq, requestCommitSha, ref, review);
      } else if (mode === 'studioFitEnvelope') {
        outcome = await executeStudioFitEnvelope(sessionId, seq, requestCommitSha, ref, request.request, review);
      } else {
        // Schema's mode enum may outrun worker support if it is ever extended without a matching
        // implementation here -- fail loudly rather than silently no-op.
        console.log(`REJECTED: mode "${mode}" passed schema but has no worker implementation yet`);
        process.exit(0);
      }
    } catch (err) {
      // No seen-record on infrastructure/checkout failure: the same request may be retried after the
      // machine or remote is repaired, and no evidence is ever mislabeled as coming from this ref.
      console.error(`could not execute ${mode} at requested ref ${JSON.stringify(requestedRef)}: ${err.message}`);
      process.exitCode = 1;
      return;
    } finally {
      checkout?.cleanup();
    }
  }

  recordSeen(seen, sessionId, seq);
  console.log(`wrote ${outcome.file} (synced to Drive: ${outcome.useDrive})`);
  console.log(JSON.stringify(outcome.result, null, 2));
  process.exit(0);
}

main();
