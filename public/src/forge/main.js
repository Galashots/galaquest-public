import './responsive.js';
import * as THREE from '../../vendor/three.module.min.js';
import { createStudioScene } from '../studio/scene.js';
import { loadoutDescriptor } from '../studio/loadoutDescriptors.js';
import { attachStudioCandidate } from '../studio/candidateGear.js';
import { OPEN_FACE_HELMET_PROFILE_V1 } from '../studio/gearFitProfiles.js';
import { rigidAnchorName } from '../character/gear.js';
import { normaliseCharacterMaterial } from '../character/hero.js';
import { cameraPositionFor } from '../review/cameraPresets.js';
import { loadGLB } from '../world/assets.js';
import { createFitSession, FORGE_FIT_SCHEMA } from './fitAuthoring.js';
import { runtimeRestTransform, runtimeRestSource } from './runtimeBake.js';
import {
  clearPendingTask, isTerminalMeshyStatus, loadPendingTask,
  MAX_CONSECUTIVE_POLL_FAILURES, savePendingTask, shouldAbandonPolling,
} from './pendingTask.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fitKey = (assetId) => `gq-forge-fit:${FORGE_FIT_SCHEMA}:${sourceSha}:${assetId}`;

let sourceSha = 'unbound';
let studioScene;
// Set once the scene exists; called whenever the layout over the stage changes, not just on a
// window resize. See toggleDrawer below.
let refreshViewport = () => {};
let current = null;
let dynamicMount = null;
let dynamicObjectUrl = null;
let bearing = 'three-quarter';
let scale = 'inspection';
let nudgeStep = 0.005;
let rotationStep = 5;
let scaleStep = 0.02;
let meshyStatus = { configured: false, tokenConfigured: false };
let selectionRevision = 0;

function status(message) {
  $('#stage-status').textContent = message;
}

function cleanNumber(value, digits = 4) {
  const n = Number(value) || 0;
  return Number(n.toFixed(digits)).toString();
}

function displayNameFor(assetId) {
  return assetId
    .replace(/^forge_[^_]+_/, '')
    .replace(/_v\d+$/, '')
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function currentPacket() {
  if (!current?.fit) return null;
  const shot = current.fit.snapshot();
  return {
    schema: FORGE_FIT_SCHEMA,
    sourceSha,
    assetId: current.assetId,
    displayName: current.displayName,
    boneName: current.boneName,
    loadout: current.loadout ?? null,
    meshyTaskId: current.meshyTaskId ?? null,
    fitProfile: current.fitProfile ?? null,
    hiddenAnatomy: [...(current.hiddenAnatomy ?? [])],
    delta: shot.delta,
    baseline: shot.baseline,
    reference: shot.reference,
    effective: shot.effective,
    // What character/gear.js actually stores. `effective` is bone-local, which is what the Forge
    // authors in; the runtime keeps a rig-root-relative rest transform instead, and converting
    // between them consumes a bone matrix. runtimeRestTransform reads BIND for that, so this block
    // is the same number whether the Owner exports from the fit pose or mid-clip, and it is the
    // exact inverse of the attach (test/forge-runtime-bake.test.mjs).
    runtime: runtimeBlock(),
    savedAt: new Date().toISOString(),
  };
}

function runtimeBlock() {
  if (!current?.anchor || !studioScene?.hero?.root) return null;
  try {
    const rest = runtimeRestTransform(studioScene.hero.root, current.anchor);
    return { restRelativeToHeroRoot: rest, source: runtimeRestSource(rest) };
  } catch (error) {
    // A candidate mounted somewhere the runtime has no rest-transform contract for still fits and
    // still exports; it just has nothing to bake into gear.js. Say so rather than emitting nothing.
    return { unavailable: error.message };
  }
}

function refreshFit(snapshot = current?.fit?.snapshot()) {
  if (!current || !snapshot) return;
  const [px, py, pz] = snapshot.delta.positionWorld;
  const [rx, ry, rz] = snapshot.delta.rotationDeg;
  $('#pos-x').value = cleanNumber(px);
  $('#pos-y').value = cleanNumber(py);
  $('#pos-z').value = cleanNumber(pz);
  $('#rot-x').value = cleanNumber(rx, 2);
  $('#rot-y').value = cleanNumber(ry, 2);
  $('#rot-z').value = cleanNumber(rz, 2);
  $('#scale-delta').value = cleanNumber(snapshot.delta.scale, 3);
  $('#fit-asset-name').textContent = current.displayName;
  $('#fit-bone').textContent = `${current.boneName} anchor`;
  // Never label shipped gear a candidate: the rack now carries both, and the Owner has to be able
  // to tell at a glance whether the thing under the cursor is already in a child's hands.
  $('#fit-provenance').textContent = current.meshyTaskId ? 'MESHY TASK' : (current.provenance ?? 'CANDIDATE');
  $('#coverage-chips').replaceChildren(...(current.hiddenAnatomy?.length
    ? current.hiddenAnatomy.map((name) => {
      const chip = document.createElement('span'); chip.textContent = name; return chip;
    })
    : [(() => { const chip = document.createElement('span'); chip.textContent = 'none'; return chip; })()]));
  $('#transform-readout').textContent = JSON.stringify(currentPacket(), null, 2);
}

function enterFitPose(announce = false) {
  if (!studioScene) return;
  const result = studioScene.setFitPose();
  $('#toggle-animation').textContent = 'play';
  if (announce) status(`fit pose · ${current?.displayName ?? 'Hero'} · ${result.boneCount} bones restored`);
}

function parsedFitInputs() {
  const values = [
    $('#pos-x').value, $('#pos-y').value, $('#pos-z').value,
    $('#rot-x').value, $('#rot-y').value, $('#rot-z').value,
    $('#scale-delta').value,
  ];
  // Number inputs report an empty string while a reviewer is midway through typing a negative or
  // decimal value. Do not normalize the field back to zero until the value is actually parseable.
  if (values.some((value) => value.trim() === '' || !Number.isFinite(Number(value)))) return null;
  return {
    positionWorld: values.slice(0, 3).map(Number),
    rotationDeg: values.slice(3, 6).map(Number),
    scale: Number(values[6]),
  };
}

function applyInputs() {
  if (!current?.fit) return;
  const next = parsedFitInputs();
  if (!next) return;
  enterFitPose();
  refreshFit(current.fit.apply(next));
}

function loadSavedFit() {
  if (!current?.fit) return;
  const raw = localStorage.getItem(fitKey(current.assetId));
  if (!raw) {
    refreshFit(current.fit.reset());
    return;
  }
  try {
    const packet = JSON.parse(raw);
    if (packet.schema !== FORGE_FIT_SCHEMA) throw new Error('stale Forge fit schema');
    refreshFit(current.fit.apply(packet.delta ?? {}));
    status(`restored saved fit · ${current.displayName}`);
  } catch {
    localStorage.removeItem(fitKey(current.assetId));
    refreshFit(current.fit.reset());
  }
}

function setActiveRackButton(button) {
  $$('.candidate-button').forEach((item) => item.classList.toggle('active', item === button));
}

function anchorFor(assetId, boneName) {
  return studioScene.hero.root.getObjectByName(rigidAnchorName(assetId, boneName));
}

async function selectRackCandidate(button) {
  const revision = ++selectionRevision;
  setActiveRackButton(button);
  if (dynamicMount) dynamicMount.anchor.visible = false;
  enterFitPose();
  const applied = await studioScene.setLoadout(button.dataset.loadout);
  if (!applied || revision !== selectionRevision) return;
  const descriptor = loadoutDescriptor(button.dataset.loadout);
  const anchor = anchorFor(button.dataset.asset, button.dataset.bone);
  if (!anchor) throw new Error(`mounted anchor missing for ${button.dataset.asset}`);
  current = {
    assetId: button.dataset.asset,
    displayName: button.querySelector('strong').textContent,
    boneName: button.dataset.bone,
    loadout: button.dataset.loadout,
    provenance: button.dataset.provenance ?? 'CANDIDATE',
    fitProfile: anchor.userData?.gqFitProfile ?? null,
    hiddenAnatomy: descriptor?.hideAnatomy ?? studioScene.hiddenAnatomy,
    anchor,
    fit: createFitSession(anchor),
  };
  loadSavedFit();
  applyView();
  status(`fitting ${current.displayName} · world XYZ fit frame`);
}

function applyView() {
  if (!studioScene) return;
  if (scale === 'closeup' && current?.meshyTaskId && current.anchor) {
    const target = new THREE.Vector3();
    current.anchor.getWorldPosition(target);
    const [x, y, z] = cameraPositionFor('closeup', bearing, 0, target.toArray());
    studioScene.camera.position.set(x, y, z);
    studioScene.camera.lookAt(target);
    studioScene.camera.updateMatrixWorld(true);
  } else {
    studioScene.frame(scale, bearing);
  }
  $$('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === bearing)));
  $('#view-closeup').setAttribute('aria-pressed', String(scale === 'closeup'));
}

function forgeToken() {
  return $('#forge-token').value.trim();
}

function apiHeaders(extra = {}) {
  const token = forgeToken();
  return { ...(token ? { 'x-gq-forge-token': token } : {}), ...extra };
}

async function forgeApi(path, init = {}) {
  const response = await fetch(path, { ...init, headers: apiHeaders(init.headers ?? {}) });
  const type = response.headers.get('content-type') ?? '';
  const payload = type.includes('application/json') ? await response.json() : await response.blob();
  if (!response.ok) {
    const message = payload?.message || payload?.error || `Forge API returned ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function refreshGenerateAvailability() {
  // A recorded unfinished paid task blocks new submissions entirely: the owner must resume or
  // explicitly abandon it first, so a reload/timeout can never quietly turn into a second spend.
  const ready = Boolean(
    meshyStatus.configured
    && !loadPendingTask(localStorage)
    && $('#forge-token').value.trim()
    && $('#meshy-image').files?.[0]
    && $('#approve-spend').checked,
  );
  $('#meshy-generate').disabled = !ready;
}

function refreshResumePanel() {
  const pending = loadPendingTask(localStorage);
  const panel = $('#resume-panel');
  panel.hidden = !pending;
  if (pending) {
    $('#resume-info').textContent = `${pending.kind} · task ${pending.taskId.slice(0, 12)}… · started ${pending.createdAt}`;
  }
  refreshGenerateAvailability();
}

async function refreshMeshyBridge() {
  try {
    meshyStatus = await forgeApi('/api/forge/meshy/status');
    if (meshyStatus.enabled === false) {
      // Fail-closed server: fit authoring works, the paid lane does not exist here.
      meshyStatus = { configured: false, tokenConfigured: false, enabled: false };
      $('#meshy-dot').className = 'dot warn';
      $('#meshy-state').textContent = 'paid lane disabled on this server';
      $('#meshy-badge').textContent = 'MESHY LOCKED';
      $('#meshy-badge').className = 'badge warn';
      $('#meshy-message').textContent = 'This server does not run the paid Forge lane (GALAQUEST_FORGE_ENABLED is not set). Fit authoring stays fully available. The public game host must never enable this.';
      refreshGenerateAvailability();
      return;
    }
    const configured = meshyStatus.configured;
    $('#meshy-dot').className = `dot ${configured ? 'good' : 'warn'}`;
    $('#meshy-state').textContent = configured ? 'bridge configured' : 'Meshy key not configured';
    $('#meshy-badge').textContent = configured ? 'MESHY READY' : 'MESHY LOCKED';
    $('#meshy-badge').className = `badge ${configured ? 'good' : 'warn'}`;
    $('#meshy-message').textContent = configured
      ? (meshyStatus.tokenConfigured
        ? 'Meshy key is server-side. Paid actions still require the Forge unlock token and an explicit spend checkbox.'
        : 'Meshy key is present, but paid actions remain disabled until GALAQUEST_FORGE_TOKEN is configured.')
      : 'Fit authoring is ready. To generate from this site, configure MESHY_API_KEY (or local .local key) plus GALAQUEST_FORGE_TOKEN on the server.';
  } catch (error) {
    $('#meshy-dot').className = 'dot warn';
    $('#meshy-state').textContent = 'bridge unavailable';
    $('#meshy-message').textContent = error.message;
  }
  refreshGenerateAvailability();
}

function imageDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('image read failed'));
    reader.readAsDataURL(file);
  });
}

function taskProgress(active, value = 0, label = '') {
  $('#task-progress').classList.toggle('active', active);
  $('#task-bar').value = Number(value) || 0;
  $('#task-label').textContent = label;
}

async function mountGeneratedCandidate(task, kind) {
  if (kind === 'character') {
    status(`Meshy character generated · ${task.id} · ready for the character-intake lane`);
    return;
  }

  const response = await fetch(`/api/forge/meshy/image-to-3d/${task.id}/model.glb`, { headers: apiHeaders() });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `model download returned ${response.status}`);
  }
  const blob = await response.blob();
  if (dynamicObjectUrl) URL.revokeObjectURL(dynamicObjectUrl);
  dynamicObjectUrl = URL.createObjectURL(blob);
  const gltf = await loadGLB(dynamicObjectUrl);
  if (gltf.userData?.loadError) throw new Error('generated Meshy GLB could not be loaded into Three.js');
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of [].concat(object.material)) normaliseCharacterMaterial(material);
  });

  enterFitPose();
  await studioScene.setLoadout('shipping');
  if (dynamicMount?.anchor?.parent) dynamicMount.anchor.parent.remove(dynamicMount.anchor);

  const assetId = `forge_${task.id.replaceAll('-', '').slice(0, 10)}_${kind}`;
  const spec = kind === 'helmet'
    ? {
      id: assetId,
      boneName: 'Head',
      kind: 'helmet',
      fitProfile: OPEN_FACE_HELMET_PROFILE_V1,
      targetWorldLongest: OPEN_FACE_HELMET_PROFILE_V1.targetWorldLongest,
      hideAnatomy: OPEN_FACE_HELMET_PROFILE_V1.hideAnatomy,
    }
    : {
      id: assetId, boneName: 'RightHand', kind: 'sword', targetWorldLongest: 0.9,
      gripFractionFromMin: 0.12, hideAnatomy: [],
    };

  dynamicMount = attachStudioCandidate(studioScene.hero.root, spec, gltf.scene);
  dynamicMount.anchor.visible = true;
  if (kind === 'helmet') {
    studioScene.hero.setAnatomyCoverage(spec.hideAnatomy);
  } else {
    studioScene.hero.setAnatomyCoverage([]);
    const shippingSword = anchorFor('sword_ironwood', 'RightHand');
    if (shippingSword) shippingSword.visible = false;
  }

  setActiveRackButton(null);
  current = {
    assetId,
    displayName: `Meshy ${kind} ${task.id.slice(0, 8)}`,
    boneName: spec.boneName,
    meshyTaskId: task.id,
    fitProfile: spec.fitProfile?.id ?? null,
    hiddenAnatomy: spec.hideAnatomy,
    anchor: dynamicMount.anchor,
    fit: createFitSession(dynamicMount.anchor),
  };
  loadSavedFit();
  applyView();
  status(`Meshy candidate mounted · ${task.consumed_credits ?? '?'} credits reported by provider`);
}

/**
 * Poll one ALREADY-PAID provider task to a terminal state, then mount it. Deliberately reusable by
 * both a fresh submission and the Resume path: it only ever GETs the existing taskId. Nothing in
 * here can start a new paid task -- a timeout or transient network failure leaves the pending
 * record in place and tells the human to resume, never resubmits.
 */
async function pollAndMountTask(taskId, kind) {
  let task = null;
  let consecutiveFailures = 0;
  for (let poll = 0; poll < 120; poll += 1) {
    await sleep(poll < 5 ? 2500 : 5000);
    try {
      task = await forgeApi(`/api/forge/meshy/image-to-3d/${taskId}`);
      consecutiveFailures = 0;
    } catch (error) {
      // Transient poll failures (network blip, server restart) must not abandon a paid task.
      consecutiveFailures += 1;
      taskProgress(true, task?.progress ?? 0,
        `poll failed (${consecutiveFailures}/${MAX_CONSECUTIVE_POLL_FAILURES}) · ${error.message}`);
      if (shouldAbandonPolling(consecutiveFailures)) break;
      continue;
    }
    taskProgress(true, task.progress ?? 0, `${task.status} · ${task.progress ?? 0}%`);
    if (isTerminalMeshyStatus(task.status)) break;
  }

  if (!task || !isTerminalMeshyStatus(task.status)) {
    // Not terminal: the paid task is still running (or unreachable). Keep the pending record so the
    // owner can resume this exact taskId later instead of paying for a replacement.
    refreshResumePanel();
    throw new Error(`Meshy task ${taskId.slice(0, 8)}… is still pending — use "Resume paid task", do not start a new generation`);
  }

  if (task.status !== 'SUCCEEDED') {
    clearPendingTask(localStorage);
    refreshResumePanel();
    throw new Error(task.task_error?.message || `Meshy task ended ${task.status}`);
  }

  taskProgress(true, 100, `SUCCEEDED · consumed ${task.consumed_credits ?? '?'} credits`);
  await mountGeneratedCandidate(task, kind);
  clearPendingTask(localStorage);
  refreshResumePanel();
}

async function generateCandidate() {
  const file = $('#meshy-image').files?.[0];
  if (!file || !$('#approve-spend').checked) return;
  if (loadPendingTask(localStorage)) {
    status('an unfinished paid task exists — resume or abandon it before generating again');
    refreshResumePanel();
    return;
  }
  const kind = $('#meshy-kind').value;
  $('#meshy-generate').disabled = true;
  taskProgress(true, 0, 'encoding reference…');
  try {
    // One key per human generation attempt: the server's spend ledger folds any duplicate
    // submission of this attempt (double-click, retry, replayed request) into one provider task.
    const idempotencyKey = crypto.randomUUID();
    const created = await forgeApi('/api/forge/meshy/image-to-3d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approvedPaidTask: true,
        idempotencyKey,
        imageDataUrl: await imageDataUrl(file),
        aiModel: 'meshy-6',
        poseMode: kind === 'character' ? ($('#meshy-pose').value || 't-pose') : null,
        targetPolycount: Number($('#meshy-polycount').value),
        shouldTexture: true,
        enablePbr: false,
        removeLighting: true,
      }),
    });

    savePendingTask(localStorage, {
      taskId: created.taskId,
      kind,
      idempotencyKey,
      createdAt: new Date().toISOString(),
    });
    refreshResumePanel();
    taskProgress(true, 1, `task ${created.taskId.slice(0, 8)}… submitted`);
    await pollAndMountTask(created.taskId, kind);
    $('#approve-spend').checked = false;
  } catch (error) {
    taskProgress(true, 0, `ERROR · ${error.message}`);
    status(`generation failed · ${error.message}`);
  } finally {
    refreshGenerateAvailability();
  }
}

async function resumePendingTask() {
  const pending = loadPendingTask(localStorage);
  if (!pending) { refreshResumePanel(); return; }
  if (!forgeToken()) {
    status('enter the Forge unlock token to resume the paid task');
    return;
  }
  $('#resume-task').disabled = true;
  taskProgress(true, 0, `resuming task ${pending.taskId.slice(0, 8)}…`);
  try {
    await pollAndMountTask(pending.taskId, pending.kind);
    status(`resumed and mounted paid task ${pending.taskId.slice(0, 8)}…`);
  } catch (error) {
    taskProgress(true, 0, `ERROR · ${error.message}`);
    status(`resume failed · ${error.message}`);
  } finally {
    $('#resume-task').disabled = false;
    refreshGenerateAvailability();
  }
}

async function bootstrap() {
  try {
    const provenance = await fetch('source-sha.json', { cache: 'no-store' });
    if (provenance.ok) sourceSha = (await provenance.json()).sourceSha || sourceSha;
  } catch { /* local Forge is allowed to be unbound */ }

  const canvas = $('#forge-canvas');
  studioScene = await createStudioScene(canvas);
  window.__galaQuestForgeScene = studioScene;
  enterFitPose();

  const clips = studioScene.clipNames();
  for (const clip of clips) {
    const option = document.createElement('option');
    option.value = clip;
    option.textContent = clip;
    $('#animation-select').appendChild(option);
  }

  await selectRackCandidate($('.candidate-button.active'));
  $('#runtime-badge').textContent = 'FORGE READY';
  $('#runtime-badge').className = 'badge good';

  // The unlock token is deliberately NOT persisted anywhere in the browser (see the input handler
  // below): it is spend authorization on the origin the game shares. Re-enter it after a reload --
  // including to resume a pending paid task, whose record persists without the token.
  refreshResumePanel();
  await refreshMeshyBridge();

  const resize = () => studioScene.resize(canvas.clientWidth, canvas.clientHeight);
  window.addEventListener('resize', resize);
  refreshViewport = resize;
  resize();
}

$$('.candidate-button').forEach((button) => button.addEventListener('click', async () => {
  try { await selectRackCandidate(button); } catch (error) { status(`candidate failed · ${error.message}`); }
}));

for (const id of ['pos-x', 'pos-y', 'pos-z', 'rot-x', 'rot-y', 'rot-z', 'scale-delta']) {
  $(`#${id}`).addEventListener('input', applyInputs);
}

$$('[data-nudge]').forEach((button) => button.addEventListener('click', () => {
  if (!current?.fit) return;
  enterFitPose();
  refreshFit(current.fit.nudge(button.dataset.nudge, nudgeStep * Number(button.dataset.sign)));
}));

$$('[data-step]').forEach((button) => button.addEventListener('click', () => {
  nudgeStep = Number(button.dataset.step);
  $$('[data-step]').forEach((item) => item.classList.toggle('active', item === button));
}));

$$('[data-rotate]').forEach((button) => button.addEventListener('click', () => {
  if (!current?.fit) return;
  enterFitPose();
  refreshFit(current.fit.nudgeRotation(button.dataset.rotate, rotationStep * Number(button.dataset.sign)));
}));

$$('[data-rotation-step]').forEach((button) => button.addEventListener('click', () => {
  rotationStep = Number(button.dataset.rotationStep);
  $$('[data-rotation-step]').forEach((item) => item.classList.toggle('active', item === button));
}));

$$('[data-scale-nudge]').forEach((button) => button.addEventListener('click', () => {
  if (!current?.fit) return;
  enterFitPose();
  refreshFit(current.fit.nudgeScale(scaleStep * Number(button.dataset.scaleNudge)));
}));

$$('[data-scale-step]').forEach((button) => button.addEventListener('click', () => {
  scaleStep = Number(button.dataset.scaleStep);
  $$('[data-scale-step]').forEach((item) => item.classList.toggle('active', item === button));
}));

$$('[data-view]').forEach((button) => button.addEventListener('click', () => {
  bearing = button.dataset.view;
  applyView();
}));

$('#view-closeup').addEventListener('click', () => {
  scale = scale === 'closeup' ? 'inspection' : 'closeup';
  applyView();
});

$('#fit-pose').addEventListener('click', () => {
  enterFitPose(true);
  refreshFit();
});

$('#animation-select').addEventListener('change', () => {
  const clip = studioScene.setAnimation($('#animation-select').value);
  studioScene.setAnimationPlaying(true);
  $('#toggle-animation').textContent = 'pause';
  status(`previewing ${clip} · ${current?.displayName ?? 'candidate'}`);
});
$('#toggle-animation').addEventListener('click', () => {
  if (studioScene.playing) {
    studioScene.setAnimationPlaying(false);
  } else {
    if (!studioScene.currentClipName && $('#animation-select').value) {
      studioScene.setAnimation($('#animation-select').value);
    }
    studioScene.setAnimationPlaying(true);
  }
  $('#toggle-animation').textContent = studioScene.playing ? 'pause' : 'play';
});

$('#reset-fit').addEventListener('click', () => {
  if (!current?.fit) return;
  enterFitPose();
  localStorage.removeItem(fitKey(current.assetId));
  refreshFit(current.fit.reset());
  status(`reset ${current.displayName} to locked candidate baseline`);
});

$('#save-fit').addEventListener('click', () => {
  const packet = currentPacket();
  if (!packet) return;
  localStorage.setItem(fitKey(current.assetId), JSON.stringify(packet));
  status(`saved fit locally · ${current.displayName}`);
});

$('#copy-fit').addEventListener('click', async () => {
  const packet = currentPacket();
  if (!packet) return;
  const text = JSON.stringify(packet, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    status('fit JSON copied — ready to paste into the GalaQuest agent session');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    status('fit JSON copied');
  }
});

$('#forge-token').addEventListener('input', () => {
  refreshGenerateAvailability();
});
$('#clear-token').addEventListener('click', () => {
  $('#forge-token').value = '';
  $('#balance-readout').textContent = 'balance: —';
  refreshGenerateAvailability();
});
$('#resume-task').addEventListener('click', resumePendingTask);
$('#abandon-task').addEventListener('click', () => {
  const pending = loadPendingTask(localStorage);
  clearPendingTask(localStorage);
  refreshResumePanel();
  if (pending) status(`abandoned pending task record ${pending.taskId.slice(0, 8)}… (the provider task itself is not cancelled)`);
});
$('#check-balance').addEventListener('click', async () => {
  try {
    const result = await forgeApi('/api/forge/meshy/balance');
    $('#balance-readout').textContent = `balance: ${result.balance} credits`;
  } catch (error) {
    $('#balance-readout').textContent = `balance: ${error.message}`;
  }
});

for (const control of ['meshy-image', 'approve-spend']) {
  $(`#${control}`).addEventListener('change', refreshGenerateAvailability);
}
$('#meshy-kind').addEventListener('change', () => {
  const kind = $('#meshy-kind').value;
  $('#meshy-pose').disabled = kind !== 'character';
  $('#meshy-polycount').value = kind === 'character' ? '30000' : kind === 'helmet' ? '20000' : '12000';
});
$('#meshy-generate').addEventListener('click', generateCandidate);

/**
 * Open or close one of the narrow-viewport panels.
 *
 * The renderer only ever hears about WINDOW resizes, but a drawer sliding over the stage -- or the
 * fit sheet taking the bottom half of a phone -- changes what the Owner can actually see of the
 * Hero without the window changing size at all. Tell the scene the layout moved, once when the
 * class flips and once after the 140ms slide settles, so the viewport is never left showing a
 * stale frame behind a panel that just moved.
 */
function toggleDrawer(className) {
  document.body.classList.toggle(className);
  requestAnimationFrame(() => refreshViewport());
  setTimeout(() => refreshViewport(), 200);
}

$('#mobile-assets').addEventListener('click', () => toggleDrawer('show-assets'));
$('#mobile-fit').addEventListener('click', () => toggleDrawer('show-fit'));

bootstrap().catch((error) => {
  console.error('[forge] failed to boot', error);
  status(`Forge failed · ${error.message}`);
  $('#runtime-badge').textContent = 'FORGE ERROR';
  $('#runtime-badge').className = 'badge warn';
});
