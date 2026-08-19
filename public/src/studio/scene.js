/**
 * Character Studio's scene bootstrap (CSB, SR2). Deliberately reuses the exact same functions the
 * real running game calls in main.js -- createRenderer, applySky, createGround (which is also where
 * the game's two authoritative lights live), createRimLight -- rather than a second, hand-copied
 * lighting rig. That is what makes "game lighting" the Studio's default true BY CONSTRUCTION: there
 * is only one place those light values are written, and Studio calls it.
 *
 * Studio is explicitly NOT the running game (owner-plan.md section 38): no village, no quest state,
 * no combat, no networking. It loads one character in isolation, on the same ground plane, under the
 * same sky, under the same lights, and lets it be posed/scrubbed/viewed on request.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { WORLD, CHARACTER } from '../render/layers.js';
import { applySky } from '../render/sky.js';
import { createRenderer } from '../render/renderer.js';
import { createGround } from '../world/ground.js';
import { createRimLight } from '../render/rimLight.js';
import { loadHero } from '../character/hero.js';
import {
  attachBeltLantern, BELT_LANTERN_URL,
  attachWildwoodBladeCandidate, WILDWOOD_BLADE_CANDIDATE_URL, WILDWOOD_BLADE_CANDIDATE_ID,
} from '../character/gear.js';
import { loadGLB } from '../world/assets.js';
import { GAMEPLAY_DISTANCE, cameraPositionFor } from '../review/cameraPresets.js';
import {
  measureGrip, measureShield, computeBodyOccupancyBox,
  buildGripOverlay, buildShieldOverlay, clearOverlay,
  applyTuningOverride, summarizeFitEnvelopeFrames, TUNING_TARGETS, TUNING_BOUNDS,
} from '../character/gearInspectors.js';

/** SR5 (owner-plan.md sections 21-23): the overlay visualizes exactly the measureGrip()/
 *  measureShield() numbers a caller can also read -- see gearInspectors.js's own header. */
const OVERLAY_MODES = Object.freeze(['none', 'grip', 'shield']);
export { OVERLAY_MODES };

/**
 * SR4 locked comparison primitive (owner-plan.md section 19 / armour-progression-doctrine.md
 * section 5.1): a "candidate" is compared against "shipping" by holding camera, viewport, animation
 * time, lighting and character IDENTICAL, and varying only the loadout. `loadHero()` already mounts
 * the real shipping Tier 2 gear (sword_ironwood + shield_ironwood) via attachRigidTier2Gear -- that
 * is `'shipping'`. `'candidate-with-lantern'` adds the real, already-shipped, already-measured belt
 * lantern (main.js's own `attachBeltLantern`/`RIGID_BELT_LANTERN`, mounted the exact same rigid way,
 * unlock-gating aside) -- a real loadout the game genuinely produces post-unlock, not an invented
 * fit. This intentionally does NOT accept an arbitrary candidate GLB/transform: solving a NEW,
 * unproven fit is the Grip/Shield Inspector's job (SR5), not this primitive's.
 *
 * `'candidate-wildwood-blade'` (Wave 1A, added after SR5 ACCEPTED) is the first real exception to
 * "no arbitrary candidate GLB": it mounts a genuinely unproven, unshipped W1-A weapon candidate
 * (public/assets/gear/candidates/, never public/assets/gear/ where accepted gear ships) via
 * gear.js's attachWildwoodBladeCandidate, and REPLACES the shipping sword_ironwood in the same hand
 * (hides its anchor) rather than adding alongside it -- the locked-comparison rule still holds, only
 * the loadout varies, but "loadout" now legitimately includes "which sword is in this hand" for the
 * one candidate Sol explicitly authorized. This is still not a generalized "load any candidate GLB"
 * API: a second candidate weapon would need its own named loadout the same way this one did, not a
 * parameter -- that generalization remains explicitly out of scope (api.js's own header comment).
 */
const LOADOUTS = Object.freeze(['shipping', 'candidate-with-lantern', 'candidate-wildwood-blade']);
export { LOADOUTS };

/**
 * Diagnostic lighting exists so a reviewer can strip away directional shading for silhouette/colour
 * checks -- but it must never be mistaken for what Sol or the owner actually approves against. It is
 * always OFF by default; every capture records which mode produced it (worker.mjs), and studio.html
 * puts a visible border on screen whenever it's active. It intentionally stays simple (flat, roughly
 * shadowless) rather than trying to be a second "good-looking" rig -- a diagnostic mode that looks
 * appealing invites exactly the confusion this whole rule exists to prevent.
 */
const LIGHTING_MODES = Object.freeze(['game', 'diagnostic']);
export { LIGHTING_MODES };

export async function createStudioScene(canvas) {
  const scene = new THREE.Scene();
  applySky(scene);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.layers.enable(WORLD);
  camera.layers.enable(CHARACTER);

  const runtimeRenderer = createRenderer(canvas, {});

  // ── game lighting (the default, authoritative rig) ──────────────────────────────────────────
  const ground = createGround(); // also carries the hemisphere + directional key light -- see ground.js
  scene.add(ground);
  const rimLight = createRimLight();
  scene.add(rimLight.light, rimLight.target);

  // Captured from the objects ground.js/rimLight.js actually built, NOT re-typed as literals here --
  // a hardcoded copy of "1.8"/"2.2"/"1.5" would silently drift the moment either file's own tuning
  // changed, which is exactly the failure mode a "game lighting is authoritative" rule exists to
  // prevent.
  const gameLightIntensity = new Map();
  ground.traverse((o) => { if (o.isLight) gameLightIntensity.set(o, o.intensity); });
  gameLightIntensity.set(rimLight.light, rimLight.light.intensity);

  // ── diagnostic lighting (opt-in, non-authoritative) ──────────────────────────────────────────
  // Flat and even on purpose: this is for "can I see the silhouette/material clearly", not for a
  // second opinion on how the game should look. Off (intensity 0) until setLightingMode('diagnostic').
  const diagnosticAmbient = new THREE.AmbientLight(0xffffff, 0);
  diagnosticAmbient.name = 'studio-diagnostic-ambient';
  scene.add(diagnosticAmbient);
  const diagnosticFill = new THREE.DirectionalLight(0xffffff, 0);
  diagnosticFill.name = 'studio-diagnostic-fill';
  diagnosticFill.position.set(0, 5, 6);
  scene.add(diagnosticFill);

  let lightingMode = 'game';
  const lightingModeListeners = new Set();
  function setLightingMode(mode) {
    if (!LIGHTING_MODES.includes(mode)) throw new Error(`unknown lighting mode "${mode}"`);
    lightingMode = mode;
    const gameOn = mode === 'game';
    for (const [light, originalIntensity] of gameLightIntensity) light.intensity = gameOn ? originalIntensity : 0;
    diagnosticAmbient.intensity = gameOn ? 0 : 2.2;
    diagnosticFill.intensity = gameOn ? 0 : 1.4;
    document.body.dataset.lightingMode = mode;
    // Notified rather than left for a caller to poll: main.js's on-screen label must never go stale
    // relative to the actual lights, because a caller (the Sol-bridge worker, driving this through
    // window.__galaQuestStudio directly, not the button) bypasses any click handler entirely. A
    // label that only updates from a button click is exactly how a diagnostic capture could get
    // labelled "game (authoritative)" on screen -- caught by actually looking at 04-diagnostic-
    // lighting.png during this phase's own verification, not assumed safe.
    for (const listener of lightingModeListeners) listener(mode);
  }
  function onLightingModeChange(listener) {
    lightingModeListeners.add(listener);
    return () => lightingModeListeners.delete(listener);
  }
  setLightingMode('game');

  const hero = await loadHero();
  scene.add(hero.root);
  hero.root.position.set(0, 0, 0);

  // ── loadout (SR4 locked comparison primitive) ────────────────────────────────────────────────
  let loadout = 'shipping';
  let candidateLanternMount = null; // lazily loaded once, then toggled by visibility -- see below.
  let candidateWildwoodBladeMount = null; // same lazy-load-once-toggle-after pattern.
  // hero.rigidGear is attachRigidTier2Gear's own return value (character/hero.js), carrying the
  // shipping sword_ironwood/shield_ironwood mount records -- reused here to find the shipping
  // sword's anchor rather than re-deriving it, so the candidate-wildwood-blade swap can hide it.
  const shippingSwordMount = hero.rigidGear?.find((g) => g.id === 'sword_ironwood') ?? null;
  async function setLoadout(name) {
    if (!LOADOUTS.includes(name)) throw new Error(`unknown loadout "${name}" -- expected one of ${LOADOUTS.join(', ')}`);
    if (name === 'candidate-with-lantern' && !candidateLanternMount) {
      const gltf = await loadGLB(BELT_LANTERN_URL);
      if (gltf.userData?.loadError) throw new Error(`candidate lantern asset missing: ${BELT_LANTERN_URL}`);
      candidateLanternMount = attachBeltLantern(hero.root, gltf.scene);
    }
    if (name === 'candidate-wildwood-blade' && !candidateWildwoodBladeMount) {
      const gltf = await loadGLB(WILDWOOD_BLADE_CANDIDATE_URL);
      if (gltf.userData?.loadError) throw new Error(`Wildwood Blade candidate asset missing: ${WILDWOOD_BLADE_CANDIDATE_URL}`);
      candidateWildwoodBladeMount = attachWildwoodBladeCandidate(hero.root, gltf.scene);
    }
    if (candidateLanternMount) candidateLanternMount.anchor.visible = name === 'candidate-with-lantern';
    if (candidateWildwoodBladeMount) candidateWildwoodBladeMount.anchor.visible = name === 'candidate-wildwood-blade';
    // The two swords must never both be visible in the same hand -- doctrine 5.1's locked-comparison
    // rule (only the loadout varies), applied to "which sword" the same way loadoutIsShipping applies
    // to "which loadout" for a caller reading studioState.
    if (shippingSwordMount) shippingSwordMount.anchor.visible = name !== 'candidate-wildwood-blade';
    loadout = name;
  }

  const mixer = new THREE.AnimationMixer(hero.root);
  let currentAction = null;
  let playing = true;

  function clipNames() {
    return hero.animations.map((c) => c.name);
  }

  function setAnimation(name) {
    const clip = hero.animations.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!clip) throw new Error(`no clip named "${name}" -- available: ${clipNames().join(', ')}`);
    if (currentAction) currentAction.stop();
    currentAction = mixer.clipAction(clip);
    currentAction.play();
    currentAction.paused = !playing;
    return clip.name;
  }

  function setAnimationTime(seconds) {
    if (!currentAction) return;
    mixer.setTime(0); // reset accumulated internal clock before forcing an explicit time
    currentAction.time = Math.max(0, seconds);
    mixer.update(0);
  }

  function setAnimationPlaying(next) {
    playing = Boolean(next);
    if (currentAction) currentAction.paused = !playing;
  }

  // Default to the first clip whose name matches the shipped locomotion lookup ('idle'), falling
  // back to whatever clip is first -- same "idle first" expectation a fresh Studio load should meet.
  const defaultClip = hero.animations.find((c) => c.name.toLowerCase().includes('idle')) ?? hero.animations[0];
  if (defaultClip) setAnimation(defaultClip.name);

  // ── SR5: Grip Inspector, Shield Inspector, Fit Envelope ─────────────────────────────────────────
  function clipDurationOf(name) {
    const clip = hero.animations.find((c) => c.name.toLowerCase() === name.toLowerCase());
    return clip ? clip.duration : null;
  }

  let overlay = 'none';
  function setOverlay(name) {
    if (!OVERLAY_MODES.includes(name)) throw new Error(`unknown overlay "${name}" -- expected one of ${OVERLAY_MODES.join(', ')}`);
    clearOverlay(scene);
    overlay = name;
    const swordId = loadout === 'candidate-wildwood-blade' ? WILDWOOD_BLADE_CANDIDATE_ID : 'sword_ironwood';
    let group = null;
    if (name === 'grip') group = buildGripOverlay(hero.root, swordId);
    else if (name === 'shield') group = buildShieldOverlay(hero.root);
    if (group) scene.add(group);
  }

  function getGripMeasurement() {
    const swordId = loadout === 'candidate-wildwood-blade' ? WILDWOOD_BLADE_CANDIDATE_ID : 'sword_ironwood';
    return measureGrip(hero.root, swordId);
  }
  function getShieldMeasurement() {
    return measureShield(hero.root);
  }

  /** SR5 closeout: the non-destructive typed tuning override (owner-plan.md). `override` is
   *  `{ positionDelta?, rotationDeltaDeg?, scaleDelta? }` or `null`/omitted to reset `target` to its
   *  pristine shipping mount. See gearInspectors.js's own header for the exact composition/bounds. */
  function setTuningOverride(target, override) {
    return applyTuningOverride(hero.root, target, override ?? null);
  }

  /** Fit Envelope (doctrine section 5.4): for each requested clip, samples evenly-timed frames (the
   *  same sampling scheme pose_anatomy.mjs's --sweep uses) and reports grip/shield measurements plus
   *  the body occupancy box at each. An unknown clip name fails closed per-clip (present: false)
   *  rather than throwing for the whole request -- one bad clip name in a list of five should not
   *  discard the other four. */
  async function getFitEnvelope(requestedClips, samples = 8) {
    const wasPlaying = playing;
    setAnimationPlaying(false);
    const report = {};
    for (const clipName of requestedClips) {
      const duration = clipDurationOf(clipName);
      if (duration === null) { report[clipName] = { present: false }; continue; }
      setAnimation(clipName);
      const times = Array.from({ length: samples }, (_, i) => (duration * i) / samples);
      const frames = times.map((t) => {
        setAnimationTime(t);
        return {
          t,
          grip: getGripMeasurement(),
          shield: getShieldMeasurement(),
          boe: computeBodyOccupancyBox(hero.root),
        };
      });
      report[clipName] = {
        present: true, duration, samples: times.length, frames, summary: summarizeFitEnvelopeFrames(frames),
      };
    }
    setAnimationPlaying(wasPlaying);
    return report;
  }

  function frame(scale, bearingName, height = 0.9) {
    const p = new THREE.Vector3();
    hero.root.getWorldPosition(p);
    const [x, y, z] = cameraPositionFor(scale, bearingName, height, [p.x, p.y, p.z]);
    camera.position.set(x, y, z);
    camera.lookAt(p.x, p.y + height, p.z);
    camera.updateMatrixWorld(true);
  }
  frame('inspection', 'three-quarter');

  function resize(width, height) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    runtimeRenderer.resize(width, height);
  }
  resize(canvas.clientWidth || 800, canvas.clientHeight || 600);

  const clock = new THREE.Clock();
  function tick() {
    const delta = clock.getDelta();
    if (playing) mixer.update(delta);
    runtimeRenderer.renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    scene,
    camera,
    hero,
    frame,
    resize,
    setAnimation,
    setAnimationTime,
    setAnimationPlaying,
    clipNames,
    setLightingMode,
    onLightingModeChange,
    setLoadout,
    setOverlay,
    getGripMeasurement,
    getShieldMeasurement,
    getFitEnvelope,
    setTuningOverride,
    TUNING_TARGETS,
    TUNING_BOUNDS,
    get lightingMode() { return lightingMode; },
    get currentClipName() { return currentAction?.getClip().name ?? null; },
    get currentTime() { return currentAction?.time ?? 0; },
    get playing() { return playing; },
    get loadout() { return loadout; },
    get overlay() { return overlay; },
    GAMEPLAY_DISTANCE,
  };
}
