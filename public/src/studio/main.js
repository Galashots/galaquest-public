import { createStudioScene } from './scene.js';
import { installStudioApi } from './api.js';

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
  const clipSelect = document.querySelector('#clip-select');
  for (const name of studioScene.clipNames()) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    if (name === studioScene.currentClipName) option.selected = true;
    clipSelect.appendChild(option);
  }
  clipSelect.addEventListener('change', () => api.setAnimation(clipSelect.value));

  const playPause = document.querySelector('#play-pause');
  playPause.addEventListener('click', () => {
    api.setAnimationPlaying(!studioScene.playing);
    playPause.textContent = studioScene.playing ? 'pause' : 'play';
  });

  const scaleSelect = document.querySelector('#scale-select');
  const bearingSelect = document.querySelector('#bearing-select');
  function applyView() {
    api.setView(scaleSelect.value, bearingSelect.value);
  }
  scaleSelect.addEventListener('change', applyView);
  bearingSelect.addEventListener('change', applyView);
  applyView();

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
