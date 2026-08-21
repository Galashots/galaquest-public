import * as THREE from '../../vendor/three.module.min.js';
import { createStudioScene } from '../studio/scene.js';
import { loadoutDescriptor } from '../studio/loadoutDescriptors.js';
import { attachStudioCandidate } from '../studio/candidateGear.js';
import { rigidAnchorName } from '../character/gear.js';
import { normaliseCharacterMaterial } from '../character/hero.js';
import { cameraPositionFor } from '../review/cameraPresets.js';
import { loadGLB } from '../world/assets.js';
import { createFitSession } from './fitAuthoring.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fitKey = (assetId) => `gq-forge-fit:${assetId}`;

let sourceSha = 'unbound';
let studioScene;
let current = null;
let dynamicMount = null;
let dynamicObjectUrl = null;
let bearing = 'three-quarter';
let scale = 'inspection';
let nudgeStep = 0.005;
let meshyStatus = { configured: false, tokenConfigured: false };

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
    schema: 'galaquest.asset-forge-fit/1',
    sourceSha,
    assetId: current.assetId,
    displayName: current.displayName,
    boneName: current.boneName,
    loadout: current.loadout ?? null,
    meshyTaskId: current.meshyTaskId ?? null,
    hiddenAnatomy: [...(current.hiddenAnatomy ?? [])],
    delta: shot.delta,
    baseline: shot.baseline,
    effective: shot.effective,
    savedAt: new Date().toISOString(),
  };
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
  $('#fit-provenance').textContent = current.meshyTaskId ? 'MESHY TASK' : 'CANDIDATE';
  $('#coverage-chips').replaceChildren(...(current.hiddenAnatomy?.length
    ? current.hiddenAnatomy.map((name) => {
      const chip = document.createElement('span'); chip.textContent = name; return chip;
    })
    : [(() => { const chip = document.createElement('span'); chip.textContent = 'none'; return chip; })()]));
  $('#transform-readout').textContent = JSON.stringify(currentPacket(), null, 2);
}

function applyInputs() {
  if (!current?.fit) return;
  const snapshot = current.fit.apply({
    positionWorld: [$('#pos-x').value, $('#pos-y').value, $('#pos-z').value],
    rotationDeg: [$('#rot-x').value, $('#rot-y').value, $('#rot-z').value],
    scale: $('#scale-delta').value,
  });
  refreshFit(snapshot);
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
  setActiveRackButton(button);
  if (dynamicMount) dynamicMount.anchor.visible = false;
  await studioScene.setLoadout(button.dataset.loadout);
  const descriptor = loadoutDescriptor(button.dataset.loadout);
  const anchor = anchorFor(button.dataset.asset, button.dataset.bone);
  if (!anchor) throw new Error(`mounted anchor missing for ${button.dataset.asset}`);
  current = {
    assetId: button.dataset.asset,
    displayName: button.querySelector('strong').textContent,
    boneName: button.dataset.bone,
    loadout: button.dataset.loadout,
    hiddenAnatomy: descriptor?.hideAnatomy ?? studioScene.hiddenAnatomy,
    anchor,
    fit: createFitSession(anchor),
  };
  loadSavedFit();
  applyView();
  status(`fitting ${current.displayName}`);
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
  const ready = Boolean(
    meshyStatus.configured
    && $('#forge-token').value.trim()
    && $('#meshy-image').files?.[0]
    && $('#approve-spend').checked,
  );
  $('#meshy-generate').disabled = !ready;
}

async function refreshMeshyBridge() {
  try {
    meshyStatus = await forgeApi('/api/forge/meshy/status');
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

  await studioScene.setLoadout('shipping');
  if (dynamicMount?.anchor?.parent) dynamicMount.anchor.parent.remove(dynamicMount.anchor);

  const assetId = `forge_${task.id.replaceAll('-', '').slice(0, 10)}_${kind}`;
  const spec = kind === 'helmet'
    ? {
      id: assetId, boneName: 'Head', kind: 'helmet', targetWorldLongest: 0.38,
      worldUpOffset: 0.10, hideAnatomy: ['hair', 'ears'],
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
    hiddenAnatomy: spec.hideAnatomy,
    anchor: dynamicMount.anchor,
    fit: createFitSession(dynamicMount.anchor),
  };
  loadSavedFit();
  applyView();
  status(`Meshy candidate mounted · ${task.consumed_credits ?? '?'} credits reported by provider`);
}

async function generateCandidate() {
  const file = $('#meshy-image').files?.[0];
  if (!file || !$('#approve-spend').checked) return;
  const kind = $('#meshy-kind').value;
  $('#meshy-generate').disabled = true;
  taskProgress(true, 0, 'encoding reference…');
  try {
    const created = await forgeApi('/api/forge/meshy/image-to-3d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approvedPaidTask: true,
        imageDataUrl: await imageDataUrl(file),
        aiModel: 'meshy-6',
        poseMode: kind === 'character' ? ($('#meshy-pose').value || 't-pose') : null,
        targetPolycount: Number($('#meshy-polycount').value),
        shouldTexture: true,
        enablePbr: false,
        removeLighting: true,
      }),
    });

    taskProgress(true, 1, `task ${created.taskId.slice(0, 8)}… submitted`);
    let task;
    for (let poll = 0; poll < 120; poll += 1) {
      await sleep(poll < 5 ? 2500 : 5000);
      task = await forgeApi(`/api/forge/meshy/image-to-3d/${created.taskId}`);
      taskProgress(true, task.progress ?? 0, `${task.status} · ${task.progress ?? 0}%`);
      if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(task.status)) break;
    }
    if (!task || task.status !== 'SUCCEEDED') {
      throw new Error(task?.task_error?.message || `Meshy task ended ${task?.status ?? 'TIMEOUT'}`);
    }
    taskProgress(true, 100, `SUCCEEDED · consumed ${task.consumed_credits ?? '?'} credits`);
    await mountGeneratedCandidate(task, kind);
    $('#approve-spend').checked = false;
  } catch (error) {
    taskProgress(true, 0, `ERROR · ${error.message}`);
    status(`generation failed · ${error.message}`);
  } finally {
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
  studioScene.setAnimationPlaying(false);
  $('#toggle-animation').textContent = 'play';

  const clips = studioScene.clipNames();
  for (const clip of clips) {
    const option = document.createElement('option');
    option.value = clip;
    option.textContent = clip;
    option.selected = clip === studioScene.currentClipName;
    $('#animation-select').appendChild(option);
  }

  await selectRackCandidate($('.candidate-button.active'));
  $('#runtime-badge').textContent = 'FORGE READY';
  $('#runtime-badge').className = 'badge good';

  const rememberedToken = sessionStorage.getItem('gq-forge-token') ?? '';
  $('#forge-token').value = rememberedToken;
  await refreshMeshyBridge();

  const resize = () => studioScene.resize(canvas.clientWidth, canvas.clientHeight);
  window.addEventListener('resize', resize);
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
  const snapshot = current.fit.nudge(button.dataset.nudge, nudgeStep * Number(button.dataset.sign));
  refreshFit(snapshot);
}));

$$('[data-step]').forEach((button) => button.addEventListener('click', () => {
  nudgeStep = Number(button.dataset.step);
  $$('[data-step]').forEach((item) => item.classList.toggle('active', item === button));
}));

$$('[data-view]').forEach((button) => button.addEventListener('click', () => {
  bearing = button.dataset.view;
  applyView();
}));

$('#view-closeup').addEventListener('click', () => {
  scale = scale === 'closeup' ? 'inspection' : 'closeup';
  applyView();
});

$('#animation-select').addEventListener('change', () => studioScene.setAnimation($('#animation-select').value));
$('#toggle-animation').addEventListener('click', () => {
  studioScene.setAnimationPlaying(!studioScene.playing);
  $('#toggle-animation').textContent = studioScene.playing ? 'pause' : 'play';
});

$('#reset-fit').addEventListener('click', () => {
  if (!current?.fit) return;
  localStorage.removeItem(fitKey(current.assetId));
  refreshFit(current.fit.reset());
  status(`reset ${current.displayName} to candidate baseline`);
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
  sessionStorage.setItem('gq-forge-token', $('#forge-token').value);
  refreshGenerateAvailability();
});
$('#clear-token').addEventListener('click', () => {
  $('#forge-token').value = '';
  sessionStorage.removeItem('gq-forge-token');
  $('#balance-readout').textContent = 'balance: —';
  refreshGenerateAvailability();
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

$('#mobile-assets').addEventListener('click', () => document.body.classList.toggle('show-assets'));
$('#mobile-fit').addEventListener('click', () => document.body.classList.toggle('show-fit'));

bootstrap().catch((error) => {
  console.error('[forge] failed to boot', error);
  status(`Forge failed · ${error.message}`);
  $('#runtime-badge').textContent = 'FORGE ERROR';
  $('#runtime-badge').className = 'badge warn';
});
