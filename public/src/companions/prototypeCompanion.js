import * as THREE from '../../vendor/three.module.min.js';
import { clone as cloneSkinned } from '../../vendor/utils/SkeletonUtils.js';
import { normaliseCharacterMaterial } from '../character/hero.js';
import { loadGLB } from '../world/assets.js';
import { CHARACTER, setLayer } from '../render/layers.js';
import { nextCompanionState } from './follow.js';

// Temporary Checkpoint 0 stand-in only. The wolf is never imported as an enemy presenter or rules
// object here: this module owns a cosmetic model, a cosmetic mixer, and the pure follow state.
export const PROTOTYPE_COMPANION_URL = 'assets/enemies/wolf.glb';
export const PROTOTYPE_COMPANION_SCALE = 0.55;
const CROSSFADE_SECONDS = 0.16;

function clipNamed(animations, fragment) {
  const needle = fragment.toLowerCase();
  return animations.find((clip) => clip.name.toLowerCase().includes(needle)) ?? null;
}

export async function loadPrototypeCompanion() {
  const gltf = await loadGLB(PROTOTYPE_COMPANION_URL);
  // loadGLB caches the GLTF scene. SkeletonUtils keeps this cosmetic stand-in's skeleton and
  // animation bindings independent from the real wolf that main.js loads later.
  const root = cloneSkinned(gltf.scene);
  setLayer(root, CHARACTER);
  root.name = 'prototype-companion';
  root.scale.setScalar(PROTOTYPE_COMPANION_SCALE);
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
    for (const material of [].concat(object.material)) normaliseCharacterMaterial(material);
  });
  return {
    animations: gltf.animations ?? [],
    failed: Boolean(gltf.userData?.loadError),
    root,
  };
}

export function createPrototypeCompanionPresenter(root, animations = []) {
  const mixer = new THREE.AnimationMixer(root);
  const clips = {
    idle: clipNamed(animations, 'idle') ?? clipNamed(animations, 'walking'),
    walk: clipNamed(animations, 'walking') ?? clipNamed(animations, 'running'),
    run: clipNamed(animations, 'running') ?? clipNamed(animations, 'walking'),
  };
  const actions = new Map();
  for (const [mode, clip] of Object.entries(clips)) {
    if (!clip || actions.has(mode)) continue;
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    actions.set(mode, action);
  }

  let state = { x: 0, z: 0, heading: 0, initialized: false };
  let activeMode = null;
  let activeAction = null;

  function switchMode(mode) {
    const nextMode = actions.has(mode) ? mode : actions.has('idle') ? 'idle' : [...actions.keys()][0];
    const nextAction = actions.get(nextMode);
    if (!nextAction || nextAction === activeAction) return;
    const previous = activeAction;
    activeMode = nextMode;
    activeAction = nextAction;
    activeAction.reset().play();
    if (previous) previous.crossFadeTo(activeAction, CROSSFADE_SECONDS, false);
  }

  return {
    update(deltaSeconds, hero) {
      state = nextCompanionState({ hero, companion: state, deltaSeconds });
      root.position.set(state.x, 0, state.z);
      root.rotation.y = state.heading;
      switchMode(state.mode);
      if (activeAction) {
        activeAction.paused = false;
        activeAction.setEffectiveTimeScale(state.speed > 0 ? Math.max(0.65, state.speed / 2.8) : 1);
      }
      mixer.update(Math.max(0, Math.min(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0.25)));
      return this.getState();
    },
    getState() {
      return {
        ...state,
        clip: activeMode,
      };
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
    mixer,
  };
}
