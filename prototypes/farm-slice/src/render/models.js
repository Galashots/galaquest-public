// Sculpted creature models (GLB) for the hatch reveal, with the procedural
// body as the fallback. A model is only ever an upgrade: a creature without a
// file, a failed fetch, or a bad parse all leave the procedural body in place,
// so a missing asset can never block the hatch.
import { GLTFLoader } from '../../vendor/loaders/GLTFLoader.js';

/**
 * Creatures with a shipped model in assets/creatures/<id>.glb. Zapkit, Fernsprout and Boltbun
 * keep their procedural bodies: their models are held for an Owner resemblance review (see the
 * batch README in docs/asset-production/farm-creatures-2026-09-24/).
 */
export const CREATURE_MODEL_IDS = Object.freeze([
  'sprout', 'cinderkit', 'flamewhisk', 'puddlefin', 'splashpuff', 'tidekit',
  'mossbun', 'bloomtail', 'glimmerpup',
]);

/** World height of a normalized model, sized against the egg (~1 unit tall). */
export const CREATURE_MODEL_HEIGHT = 1.15;
/** Longest horizontal extent, so a long-bodied creature is not scaled up by its height alone. */
export const CREATURE_MODEL_MAX_LENGTH = 1.6;
/**
 * Yaw per body shape. The models face the camera (+Z); a long body facing the
 * camera hides its length behind its head, so it turns side-on instead.
 */
export const CREATURE_MODEL_YAW = Object.freeze({ long: 1.1 });

/** The mystery egg's height, matching the procedural egg it replaces. */
export const EGG_MODEL_HEIGHT = 0.98;
export const EGG_MODEL_KEY = 'egg';

export function creatureModelUrl(id) {
  return new URL(`../../assets/creatures/${id}.glb`, import.meta.url).href;
}

export function eggModelUrl() {
  return new URL('../../assets/egg.glb', import.meta.url).href;
}

/**
 * Center a model on x/z, stand it on y = 0 and scale it to `height` (or less,
 * if that would make it longer than `maxLength`), inside a wrapper group so
 * callers can position/scale/rotate the wrapper freely.
 */
export function normalizeModel(THREE, root, { height = CREATURE_MODEL_HEIGHT, maxLength = CREATURE_MODEL_MAX_LENGTH } = {}) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.z);
  const scale = Math.min(size.y > 0 ? height / size.y : 1, length > 0 ? maxLength / length : 1);
  const center = box.getCenter(new THREE.Vector3());
  // Scaling happens about the root's own origin, so offsets are measured from it.
  const origin = root.position.clone();
  root.scale.multiplyScalar(scale);
  root.position.set(
    (origin.x - center.x) * scale,
    (origin.y - box.min.y) * scale,
    (origin.z - center.z) * scale,
  );
  const wrapper = new THREE.Group();
  wrapper.add(root);
  wrapper.userData.height = size.y * scale;
  return wrapper;
}

export class CreatureModels {
  constructor(THREE, { ids = CREATURE_MODEL_IDS, loader = new GLTFLoader(), eggUrl = eggModelUrl() } = {}) {
    this.THREE = THREE;
    this.ids = new Set(ids);
    this.loader = loader;
    this.eggUrl = eggUrl;
    this._pending = new Map(); // id -> Promise<Object3D|null>
    this._ready = new Map(); // id -> Object3D template (normalized)
  }

  has(id) { return this.ids.has(id); }

  /** Starts (or joins) the load for one creature; resolves to a template or null. */
  load(id) {
    if (!this.has(id)) return Promise.resolve(null);
    return this._load(id, creatureModelUrl(id), {});
  }

  /** Starts (or joins) the load for the egg; resolves to a template or null. */
  loadEgg() {
    return this._load(EGG_MODEL_KEY, this.eggUrl, { height: EGG_MODEL_HEIGHT });
  }

  _load(key, url, size) {
    if (!this._pending.has(key)) {
      const promise = this.loader.loadAsync(url)
        .then((gltf) => {
          const template = normalizeModel(this.THREE, gltf.scene, size);
          template.traverse((o) => {
            if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
          });
          this._ready.set(key, template);
          return template;
        })
        .catch(() => null);
      this._pending.set(key, promise);
    }
    return this._pending.get(key);
  }

  /** A fresh egg with its own materials (the element hint tints them), or null if not loaded. */
  eggInstance() {
    const template = this._ready.get(EGG_MODEL_KEY);
    if (!template) return null;
    const egg = template.clone(true);
    egg.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
    return egg;
  }

  /** A fresh instance of a loaded model turned for its body shape, or null if it is not loaded (yet). */
  instance(id, shape) {
    const template = this._ready.get(id);
    if (!template) return null;
    const model = template.clone(true);
    model.rotation.y = CREATURE_MODEL_YAW[shape] ?? 0;
    return model;
  }
}
