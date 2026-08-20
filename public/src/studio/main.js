import { createStudioScene, OVERLAY_MODES } from './scene.js';
import { installStudioApi } from './api.js';
import { STUDIO_LOADOUTS } from './loadoutDescriptors.js';
import { BEARINGS, SCALE_DISTANCES } from '../review/cameraPresets.js';

// Every menu is populated from the module that actually EXECUTES the value -- loadout ids from
// loadoutDescriptors.js, bearings/scales from cameraPresets.js, overlays from scene.js -- never
// hand-typed <option> lists (GQ-007). A menu that offers a state the Studio would refuse, or misses
// one it supports, is impossible by construction rather than caught by a screenshot.
function fillSelect(select, entries, selectedValue) {
  for (const { value, label } of entries) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === selectedValue) option.selected = true;
    select.appendChild(option);
  }
}

async function bootstrap() {
  const canvas = document.querySelector('#studio-canvas');
  const status = document.querySelector('#studio-status');

  const studioScene = await createStudioScene(canvas);
  const api = installStudioApi(studioScene);
  window.__galaQuestStudioReady = true; // worker.mjs polls this before touching the API
  // Same debug-hook convention main.js's own window.__galaQuestRuntime uses for the real game: the
  // narrow api.js surface is what worker.mjs/Sol drive, but a fit-*.mjs harness (tools/runtime-test)
  // needs direct THREE scene-graph access (hero, anchors, meshes) to solve a new mount, exactly like
  // fit-sword.mjs/fit-lantern.mjs already do against window.__galaQuestRuntime.hero.
  window.__galaQuestStudioScene = studioScene;

  status.textContent = 'ready';

  // ── manual UI, for the owner -- the same actions window.__galaQuestStudio exposes to the worker ─────
  const panel = document.querySelector('#studio-panel');
  const clipSelect = document.querySelector('#clip-select');
  fillSelect(
    clipSelect,
    studioScene.clipNames().map((name) => ({ value: name, label: name })),
    studioScene.currentClipName,
  );
  clipSelect.addEventListener('change', () => api.setAnimation(clipSelect.value));

  // EVERY control re-reads getState() whenever the API mutates, no matter who drove the mutation --
  // this button, or the Sol-bridge worker calling window.__galaQuestStudio directly. Without it, a
  // worker's setLoadout('candidate-wildwood-blade') left this menu claiming "shipping" on screen
  // (seen in the first review-studio.mjs captures) -- a candidate masquerading as shipping, the
  // exact outcome the lighting label's own notification already exists to prevent.
  const reviewTarget = document.querySelector('#review-target');
  const playPause = document.querySelector('#play-pause');
  function refreshControls() {
    const state = api.getState();
    reviewTarget.textContent = `${state.reviewTarget} (${state.loadoutClassification})`;
    panel.dataset.classification = state.loadoutClassification ?? '';
    loadoutSelect.value = state.loadout;
    overlaySelect.value = state.overlay;
    if (state.clipName) clipSelect.value = state.clipName;
    playPause.textContent = state.playing ? 'pause' : 'play';
    scaleSelect.value = state.view.scale;
    bearingSelect.value = state.view.bearing;
  }

  const loadoutSelect = document.querySelector('#loadout-select');
  fillSelect(
    loadoutSelect,
    STUDIO_LOADOUTS.map(({ id, label }) => ({ value: id, label })),
    studioScene.loadout,
  );
  loadoutSelect.addEventListener('change', async () => {
    try {
      await api.setLoadout(loadoutSelect.value);
    } catch (error) {
      // Fail closed to the known-good shipping state -- a loadout whose asset is missing must not
      // leave the menu claiming one thing while the scene shows another.
      status.textContent = `loadout failed: ${error.message}`;
      await api.setLoadout('shipping');
    }
    applyView(); // closeup frames the review target, which may just have changed
  });

  const overlaySelect = document.querySelector('#overlay-select');
  fillSelect(overlaySelect, OVERLAY_MODES.map((name) => ({ value: name, label: name })), studioScene.overlay);
  overlaySelect.addEventListener('change', () => api.setOverlay(overlaySelect.value));

  playPause.addEventListener('click', () => {
    api.setAnimationPlaying(!studioScene.playing);
  });

  const scaleSelect = document.querySelector('#scale-select');
  fillSelect(scaleSelect, Object.keys(SCALE_DISTANCES).map((name) => ({ value: name, label: name })), 'inspection');
  const bearingSelect = document.querySelector('#bearing-select');
  fillSelect(bearingSelect, BEARINGS.map(([name]) => ({ value: name, label: name })), 'three-quarter');
  function applyView() {
    api.setView(scaleSelect.value, bearingSelect.value);
  }
  scaleSelect.addEventListener('change', applyView);
  bearingSelect.addEventListener('change', applyView);
  api.onStateChange(refreshControls);
  applyView();
  refreshControls();

  // On tablet-sized viewports the panel is the biggest occlusion risk to the thing being reviewed;
  // one tap folds it to its header row and back.
  const panelToggle = document.querySelector('#panel-toggle');
  panelToggle.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    panelToggle.textContent = collapsed ? 'controls' : 'hide';
    panelToggle.setAttribute('aria-expanded', String(!collapsed));
  });

  const lightingToggle = document.querySelector('#lighting-toggle');
  const lightingLabel = document.querySelector('#lighting-label');
  // Driven from the scene's own notification, not set inline by this click handler -- so the label
  // stays correct even when something OTHER than this button changes the lighting mode (the Sol-
  // bridge worker calls window.__galaQuestStudio.setLightingMode directly, bypassing this handler
  // entirely). See scene.js's onLightingModeChange for why this exists.
  studioScene.onLightingModeChange((mode) => {
    lightingLabel.textContent = mode === 'game' ? 'game (authoritative)' : 'diagnostic (NOT authoritative)';
    lightingToggle.textContent = mode === 'game' ? 'switch to diagnostic' : 'switch to game';
  });
  lightingToggle.addEventListener('click', () => {
    api.setLightingMode(studioScene.lightingMode === 'game' ? 'diagnostic' : 'game');
  });

  window.addEventListener('resize', () => {
    studioScene.resize(canvas.clientWidth, canvas.clientHeight);
  });
}

bootstrap().catch((error) => {
  console.error('[studio] failed to boot', error);
  const status = document.querySelector('#studio-status');
  if (status) status.textContent = `failed: ${error.message}`;
});
