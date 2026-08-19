import * as THREE from '../../vendor/three.module.min.js';
import { GLTFLoader } from '../../vendor/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();

export function createMagentaPlaceholder(label = 'missing asset') {
  const root = new THREE.Group();
  root.name = `missing-${label}`;
  const material = new THREE.MeshBasicMaterial({ color: 0xff00aa });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = `${label}-placeholder`;
  root.add(mesh);
  return root;
}

export function loadGLB(url) {
  if (!cache.has(url)) {
    const promise = loader.loadAsync(url).catch((error) => {
      console.error(`[assets] failed to load ${url}`, error);
      return {
        animations: [],
        scene: createMagentaPlaceholder(url),
        userData: { loadError: error },
      };
    });
    cache.set(url, promise);
  }
  return cache.get(url);
}

export function clearAssetCache() {
  cache.clear();
}
