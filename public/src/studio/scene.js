/**
 * Character Studio scene bootstrap. Studio is deliberately not the running game: it isolates one
 * character under the real game sky/ground/lights so review can hold camera, animation and lighting
 * constant while changing only the thing under inspection.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { WORLD, CHARACTER } from '../render/layers.js';
import { applySky } from '../render/sky.js';
import { createRenderer } from '../render/renderer.js';
import { createGround } from '../world/ground.js';
import { createRimLight } from '../render/rimLight.js';
import { loadHero, normaliseCharacterMaterial } from '../character/hero.js';
import {
  attachBeltLantern, BELT_LANTERN_URL,
  attachWildwoodBladeCandidate, WILDWOOD_BLADE_CANDIDATE_URL, WILDWOOD_BLADE_CANDIDATE_ID,
  rigidAnchorName,
} from '../character/gear.js';
import {
  attachStudioCandidate,
  DAWNWARDEN_HELMET_CANDIDATE,
  DAWNWARDEN_SWORD_CANDIDATE,
} from './candidateGear.js';
import { ALL_STUDIO_GEAR, LOADOUT_IDS, loadoutDescriptor } from './loadoutDescriptors.js';
import { loadGLB } from '../world/assets.js';
import { GAMEPLAY_DISTANCE, cameraPositionFor, bearingRadians } from '../review/cameraPresets.js';
import {
  measureGrip, measureShield, computeBodyOccupancyBox,
  buildGripOverlay, buildShieldOverlay, clearOverlay,
  applyTuningOverride, summarizeFitEnvelopeFrames, TUNING_TARGETS, TUNING_BOUNDS,
} from '../character/gearInspectors.js';

const OVERLAY_MODES = Object.freeze(['none', 'grip', 'shield']);
export { OVERLAY_MODES };

// The descriptor vocabulary is the protocol vocabulary. Candidate additions remain explicit named
// states -- never an arbitrary path/URL surface -- so a reviewer always knows exactly what bytes are
// in frame and candidate gear cannot masquerade as shipping.
const LOADOUTS = LOADOUT_IDS;
export { LOADOUTS };

const LIGHTING_MODES = Object.freeze(['game', 'diagnostic']);
export { LIGHTING_MODES };

export async function createStudioScene(canvas) {
  const scene = new THREE.Scene();
  applySky(scene);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.layers.enable(WORLD);
  camera.layers.enable(CHARACTER);

  const runtimeRenderer = createRenderer(canvas, {});

  // Game lighting is authoritative by construction: reuse the exact game objects rather than a
  // copied review-light rig.
  const ground = createGround();
  scene.add(ground);
  const rimLight = createRimLight();
  scene.add(rimLight.light, rimLight.target);

  const gameLightIntensity = new Map();
  ground.traverse((o) => { if (o.isLight) gameLightIntensity.set(o, o.intensity); });
  gameLightIntensity.set(rimLight.light, rimLight.light.intensity);

  // Diagnostic lighting is deliberately flat and non-authoritative.
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
  hero.root.updateMatrixWorld(true);

  // Capture the authored bind/rest pose before any AnimationMixer action is allowed to touch it.
  // The Forge uses this as its deterministic manufacturing frame; animations are inspection only.
  const fitPoseBones = [];
  hero.root.traverse((object) => {
    if (!object.isBone) return;
    fitPoseBones.push(Object.freeze({
      bone: object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    }));
  });

  // ── Library generic asset stage (#92 STUDIO-V2A) ────────────────────────────────────────────
  // A separate, empty-by-default group for any registry-selected asset (character/model/gear/
  // texture-bearing GLB) that is NOT the hero -- Library must be able to load ANY renderable
  // registry record generically, not just the fixed hero+gear loadout vocabulary above. The hero
  // is hidden (not removed -- its rig/animation state stays intact) while a Library asset is on
  // stage, and restored the moment the Library asset is cleared.
  const genericAssetGroup = new THREE.Group();
  genericAssetGroup.name = 'studio-generic-asset';
  genericAssetGroup.visible = false;
  scene.add(genericAssetGroup);
  let genericAssetState = null; // { assetId, runtimeUrl, measured } | null

  function clearGenericAsset() {
    for (const child of [...genericAssetGroup.children]) genericAssetGroup.remove(child);
    genericAssetGroup.visible = false;
    genericAssetState = null;
    hero.root.visible = true;
  }

  /**
   * Like clearGenericAsset(), but for a REFUSED (never-staged) Library selection rather than an
   * explicit "go back to the hero" request. Falling back to `hero.root.visible = true` here would
   * make the canvas silently show the fully-dressed shipping hero while getState().libraryAsset
   * still names a refused, unrelated asset_id -- a screenshot taken at that moment reads as "the
   * refused asset rendered as the hero" rather than "nothing is staged". Leaves the stage visibly
   * empty instead, so canvas-only evidence (e.g. a Review packet capture) cannot be misread.
   */
  function clearGenericAssetStage() {
    for (const child of [...genericAssetGroup.children]) genericAssetGroup.remove(child);
    genericAssetGroup.visible = false;
    genericAssetState = null;
    hero.root.visible = false;
  }

  /**
   * Loads real bytes from `runtimeUrl` (already proven servable by the caller -- api.js only calls
   * this after the registry's own `runtime_availability.loadable` said so) and measures the loaded
   * scene graph directly, rather than trusting any declared number. A load failure throws; it must
   * never silently fall back to the shared magenta placeholder and claim success.
   */
  async function loadGenericAsset(assetId, runtimeUrl) {
    clearGenericAsset();
    if (!runtimeUrl) throw new Error(`loadGenericAsset: no runtime URL for "${assetId}"`);

    const gltf = await loadGLB(runtimeUrl);
    if (gltf.userData?.loadError) {
      throw new Error(`asset bytes unavailable at runtime for "${assetId}": ${runtimeUrl}`);
    }
    const root = gltf.scene;

    // Deterministic neutral framing: centre on X/Z and ground at Y=0 from the asset's OWN bounding
    // box, independent of the hero rig's conventions -- a village prop and a hand-held sword must
    // both land predictably regardless of how their source file was authored/pivoted.
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;

    let meshCount = 0;
    let triangleCount = 0;
    const materialUuids = new Set();
    root.traverse((object) => {
      if (!object.isMesh) return;
      meshCount += 1;
      const geometry = object.geometry;
      if (geometry?.index) triangleCount += geometry.index.count / 3;
      else if (geometry?.attributes?.position) triangleCount += geometry.attributes.position.count / 3;
      for (const material of [].concat(object.material ?? [])) if (material) materialUuids.add(material.uuid);
    });

    genericAssetGroup.add(root);
    genericAssetGroup.visible = true;
    hero.root.visible = false;

    genericAssetState = Object.freeze({
      assetId,
      runtimeUrl,
      measured: Object.freeze({
        meshCount,
        triangleCount: Math.round(triangleCount),
        materialCount: materialUuids.size,
        animationClipCount: gltf.animations?.length ?? 0,
        boundingBoxSize: Object.freeze({ x: size.x, y: size.y, z: size.z }),
      }),
    });
    return genericAssetState;
  }

  /** Deterministic standard view for whatever is currently on the generic asset stage. */
  function frameGenericAsset(bearingName = 'three-quarter') {
    if (!genericAssetState) return null;
    const box = new THREE.Box3().setFromObject(genericAssetGroup);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const radius = Math.max(size.length() * 0.5, 0.15);
    const distance = radius * 2.4 + 0.4;
    const bearing = bearingRadians(bearingName);
    const x = center.x + Math.sin(bearing) * distance;
    const z = center.z + Math.cos(bearing) * distance;
    const y = center.y + distance * 0.28;
    camera.position.set(x, y, z);
    camera.lookAt(center.x, center.y, center.z);
    camera.updateMatrixWorld(true);
    return Object.freeze({ bearing: bearingName, distance, center: { x: center.x, y: center.y, z: center.z } });
  }

  // ── explicit locked-comparison loadouts ─────────────────────────────────────────────────────
  let loadout = 'shipping';
  let loadoutRevision = 0;
  let hiddenAnatomy = Object.freeze(hero.setAnatomyCoverage([]));
  let candidateLanternMount = null;
  let candidateWildwoodBladeMount = null;
  let candidateDawnwardenSwordMount = null;
  let candidateDawnwardenHelmetMount = null;

  const shippingSwordMount = hero.rigidGear?.find((g) => g.id === 'sword_ironwood') ?? null;
  const shippingShieldMount = hero.rigidGear?.find((g) => g.id === 'shield_ironwood') ?? null;

  async function loadStudioCandidate(spec) {
    const gltf = await loadGLB(spec.url);
    if (gltf.userData?.loadError) throw new Error(`Studio candidate asset missing: ${spec.url}`);
    // Raw Meshy outputs can carry the same emissive/metalness export defect already documented for
    // generated characters. Studio must judge the candidate's real painted texture, not a flooded
    // provider-export artefact. This is review-only normalization; accepted shipping assets still
    // have to be cleaned/re-exported before leaving candidates/.
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      for (const material of [].concat(object.material)) normaliseCharacterMaterial(material);
    });
    return attachStudioCandidate(hero.root, spec, gltf.scene);
  }

  async function setLoadout(name) {
    if (!LOADOUTS.includes(name)) throw new Error(`unknown loadout "${name}" -- expected one of ${LOADOUTS.join(', ')}`);
    const revision = ++loadoutRevision;

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
    if (name === 'candidate-dawnwarden-sword' && !candidateDawnwardenSwordMount) {
      candidateDawnwardenSwordMount = await loadStudioCandidate(DAWNWARDEN_SWORD_CANDIDATE);
    }
    if (name === 'candidate-dawnwarden-helmet' && !candidateDawnwardenHelmetMount) {
      candidateDawnwardenHelmetMount = await loadStudioCandidate(DAWNWARDEN_HELMET_CANDIDATE);
    }

    // Candidate GLB loading is async. A slower earlier click must never overwrite the state chosen by
    // a later click after it finally finishes loading.
    if (revision !== loadoutRevision) return false;

    if (candidateLanternMount) candidateLanternMount.anchor.visible = name === 'candidate-with-lantern';
    if (candidateWildwoodBladeMount) candidateWildwoodBladeMount.anchor.visible = name === 'candidate-wildwood-blade';
    if (candidateDawnwardenSwordMount) candidateDawnwardenSwordMount.anchor.visible = name === 'candidate-dawnwarden-sword';
    const descriptor = loadoutDescriptor(name);
    if (!descriptor) throw new Error(`loadout descriptor missing for "${name}"`);
    const nextHiddenAnatomy = Object.freeze(hero.setAnatomyCoverage(descriptor.hideAnatomy));

    if (candidateDawnwardenHelmetMount) candidateDawnwardenHelmetMount.anchor.visible = name === 'candidate-dawnwarden-helmet';

    // Exactly one weapon in the hand. Helmet review keeps the full shipping baseline and adds only
    // the helmet; weapon-candidate states replace the shipping sword but keep the shield constant.
    const replacesSword = name === 'candidate-wildwood-blade' || name === 'candidate-dawnwarden-sword';
    if (shippingSwordMount) shippingSwordMount.anchor.visible = !replacesSword;
    if (shippingShieldMount) shippingShieldMount.anchor.visible = name !== 'shipping-sword-only';
    hiddenAnatomy = nextHiddenAnatomy;
    loadout = name;
    return true;
  }

  function gearVisibility() {
    return ALL_STUDIO_GEAR.map(({ id, bone, provenance }) => {
      const anchor = hero.root.getObjectByName(rigidAnchorName(id, bone));
      return {
        id,
        bone,
        provenance,
        mounted: Boolean(anchor),
        visible: Boolean(anchor && anchor.visible),
      };
    });
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
    currentAction.reset();
    currentAction.play();
    currentAction.paused = !playing;
    return clip.name;
  }

  function setAnimationTime(seconds) {
    if (!currentAction) return;
    mixer.setTime(0);
    currentAction.time = Math.max(0, seconds);
    mixer.update(0);
  }

  function setAnimationPlaying(next) {
    playing = Boolean(next);
    if (currentAction) currentAction.paused = !playing;
  }

  function setFitPose() {
    playing = false;
    mixer.stopAllAction();
    currentAction = null;
    for (const record of fitPoseBones) {
      record.bone.position.copy(record.position);
      record.bone.quaternion.copy(record.quaternion);
      record.bone.scale.copy(record.scale);
    }
    hero.root.updateMatrixWorld(true);
    return Object.freeze({ pose: 'bind', boneCount: fitPoseBones.length });
  }

  const defaultClip = hero.animations.find((c) => c.name.toLowerCase().includes('idle')) ?? hero.animations[0];
  if (defaultClip) setAnimation(defaultClip.name);

  function clipDurationOf(name) {
    const clip = hero.animations.find((c) => c.name.toLowerCase() === name.toLowerCase());
    return clip ? clip.duration : null;
  }

  function activeSwordId() {
    if (loadout === 'candidate-wildwood-blade') return WILDWOOD_BLADE_CANDIDATE_ID;
    if (loadout === 'candidate-dawnwarden-sword') return DAWNWARDEN_SWORD_CANDIDATE.id;
    return 'sword_ironwood';
  }

  let overlay = 'none';
  function setOverlay(name) {
    if (!OVERLAY_MODES.includes(name)) throw new Error(`unknown overlay "${name}" -- expected one of ${OVERLAY_MODES.join(', ')}`);
    clearOverlay(scene);
    overlay = name;
    let group = null;
    if (name === 'grip') group = buildGripOverlay(hero.root, activeSwordId());
    else if (name === 'shield') group = buildShieldOverlay(hero.root);
    if (group) scene.add(group);
  }

  function getGripMeasurement() {
    return measureGrip(hero.root, activeSwordId());
  }
  function getShieldMeasurement() {
    return measureShield(hero.root);
  }

  function setTuningOverride(target, override) {
    return applyTuningOverride(hero.root, target, override ?? null);
  }

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
    let target = p;
    let targetHeight = height;
    if (scale === 'closeup') {
      const descriptor = loadoutDescriptor(loadout);
      const gear = descriptor ? gearVisibility().find((item) => item.id === descriptor.reviewTarget) : null;
      const anchor = gear?.mounted ? hero.root.getObjectByName(rigidAnchorName(gear.id, gear.bone)) : null;
      if (anchor) {
        target = new THREE.Vector3();
        anchor.getWorldPosition(target);
        targetHeight = 0;
      }
    }
    const [x, y, z] = cameraPositionFor(scale, bearingName, targetHeight, [target.x, target.y, target.z]);
    camera.position.set(x, y, z);
    camera.lookAt(target.x, target.y + targetHeight, target.z);
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
    setFitPose,
    clipNames,
    setLightingMode,
    onLightingModeChange,
    setLoadout,
    gearVisibility,
    setOverlay,
    getGripMeasurement,
    getShieldMeasurement,
    getFitEnvelope,
    setTuningOverride,
    TUNING_TARGETS,
    TUNING_BOUNDS,
    loadGenericAsset,
    clearGenericAsset,
    clearGenericAssetStage,
    frameGenericAsset,
    get activeAsset() { return genericAssetState; },
    get lightingMode() { return lightingMode; },
    get currentClipName() { return currentAction?.getClip().name ?? null; },
    get currentTime() { return currentAction?.time ?? 0; },
    get playing() { return playing; },
    get loadout() { return loadout; },
    get hiddenAnatomy() { return [...hiddenAnatomy]; },
    get overlay() { return overlay; },
    GAMEPLAY_DISTANCE,
  };
}
