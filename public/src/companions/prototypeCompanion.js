import * as THREE from '../../vendor/three.module.min.js';
import { clone as cloneSkinned } from '../../vendor/utils/SkeletonUtils.js';
import { normaliseCharacterMaterial } from '../character/hero.js';
import { loadGLB } from '../world/assets.js';
import { CHARACTER, setLayer } from '../render/layers.js';
import { nextCompanionState } from './follow.js';
import {
  advanceHappyReaction,
  createHappyReactionState,
  happyReactionProgress,
  requestHappyReaction,
} from './bondReaction.js';

// Temporary Checkpoint 0 stand-in only. The wolf is never imported as an enemy presenter or rules
// object here: this module owns a cosmetic model, a cosmetic mixer, and the pure follow state.
export const PROTOTYPE_COMPANION_URL = 'assets/enemies/wolf.glb';
export const PROTOTYPE_COMPANION_SCALE = 0.55;
const CROSSFADE_SECONDS = 0.16;

function clipNamed(animations, fragment) {
  const needle = fragment.toLowerCase();
  return animations.find((clip) => clip.name.toLowerCase() === needle) ?? null;
}

// wolf.glb's shipped contract is idle, walk, bite, hit, death. Checkpoint 0 has no separate run
// clip, so run intentionally reuses walk; the presenter raises its time scale for the faster state.
export function selectPrototypeCompanionClips(animations = []) {
  const idle = clipNamed(animations, 'idle') ?? clipNamed(animations, 'walk');
  const walk = clipNamed(animations, 'walk');
  return { idle, walk, run: walk };
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
  const clips = selectPrototypeCompanionClips(animations);
  const actions = new Map();
  for (const [mode, clip] of Object.entries(clips)) {
    if (!clip || actions.has(mode)) continue;
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    actions.set(mode, action);
  }

  let state = { x: 0, z: 0, heading: 0, initialized: false };
  let reaction = createHappyReactionState();
  let activeClip = null;
  let activeAction = null;

  function switchMode(mode) {
    const nextMode = actions.has(mode) ? mode : actions.has('idle') ? 'idle' : [...actions.keys()][0];
    const nextAction = actions.get(nextMode);
    if (!nextAction || nextAction === activeAction) return;
    const previous = activeAction;
    activeClip = nextAction.getClip().name;
    activeAction = nextAction;
    activeAction.reset().play();
    if (previous) previous.crossFadeTo(activeAction, CROSSFADE_SECONDS, false);
  }

  return {
    update(deltaSeconds, hero) {
      state = nextCompanionState({ hero, companion: state, deltaSeconds });
      reaction = advanceHappyReaction(reaction, deltaSeconds);
      const reactionProgress = happyReactionProgress(reaction);
      const bounce = Math.sin(reactionProgress * Math.PI) * 0.16;
      const scaleBeat = 1 + Math.sin(reactionProgress * Math.PI) * 0.08;
      root.position.set(state.x, bounce, state.z);
      root.scale.setScalar(PROTOTYPE_COMPANION_SCALE * scaleBeat);
      root.rotation.y = state.heading;
      switchMode(state.mode);
      if (activeAction) {
        activeAction.paused = false;
        activeAction.setEffectiveTimeScale(state.speed > 0 ? Math.max(0.65, state.speed / 2.8) : 1);
      }
      mixer.update(Math.max(0, Math.min(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0.25)));
      return this.getState();
    },
    triggerHappyReaction() {
      const next = requestHappyReaction(reaction);
      reaction = next.state;
      return next.accepted;
    },
    hitTest(clientX, clientY, canvas, camera) {
      if (!root.visible || !canvas || !camera) return false;
      const rect = canvas.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return false;
      const pointer = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.layers.mask = camera.layers.mask;
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObject(root, true).length > 0;
    },
    getState() {
      return {
        ...state,
        clip: activeClip,
        reactionActive: reaction.activeSeconds > 0,
        reactionProgress: happyReactionProgress(reaction),
        reactionCooldownSeconds: reaction.cooldownSeconds,
        reactionCount: reaction.triggerCount,
      };
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
    mixer,
  };
}
