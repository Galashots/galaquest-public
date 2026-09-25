import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import * as THREE from '../vendor/three.module.min.js';
import { CREATURES } from '../content/content.js';
import {
  CREATURE_MODEL_HEIGHT, CREATURE_MODEL_IDS, CREATURE_MODEL_MAX_LENGTH,
  CREATURE_MODEL_YAW, CreatureModels, EGG_MODEL_HEIGHT, normalizeModel,
} from '../src/render/models.js';

const MODEL_DIR = new URL('../assets/creatures/', import.meta.url);
const EGG_FILE = new URL('../assets/egg.glb', import.meta.url);
// An iPad downloads every one of these; keep each small and cheap to draw.
const MAX_BYTES = 600 * 1024;
const MAX_TRIANGLES = 6000;

/** The JSON chunk of a binary glTF, after checking the container header. */
function glbJson(bytes, name) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${name}: not a binary glTF`);
  assert.equal(bytes.readUInt32LE(4), 2, `${name}: not glTF 2.0`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${name}: header length disagrees with the file`);
  assert.equal(bytes.toString('ascii', 16, 20), 'JSON', `${name}: first chunk is not JSON`);
  return JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
}

test('every listed creature model is a real creature, and every shipped file is listed', () => {
  const creatureIds = new Set(CREATURES.map((c) => c.id));
  for (const id of CREATURE_MODEL_IDS) assert.ok(creatureIds.has(id), `${id} is not in CREATURES`);
  const files = readdirSync(MODEL_DIR).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4));
  assert.deepEqual([...files].sort(), [...CREATURE_MODEL_IDS].sort());
});

test('each shipped model is a plain, small glTF the vendored loader can read without extras', () => {
  const files = CREATURE_MODEL_IDS.map((id) => [id, new URL(`${id}.glb`, MODEL_DIR)]).concat([['egg', EGG_FILE]]);
  for (const [id, path] of files) {
    assert.ok(statSync(path).size <= MAX_BYTES, `${id}.glb is over ${MAX_BYTES} bytes`);
    const json = glbJson(readFileSync(path), id);
    // Draco, meshopt or KTX2 would each need a decoder this game does not ship.
    assert.deepEqual(json.extensionsRequired ?? [], [], `${id}: requires glTF extensions`);
    let triangles = 0;
    for (const mesh of json.meshes) {
      for (const primitive of mesh.primitives) {
        const count = primitive.indices !== undefined
          ? json.accessors[primitive.indices].count
          : json.accessors[primitive.attributes.POSITION].count;
        triangles += count / 3;
      }
    }
    assert.ok(triangles > 0 && triangles <= MAX_TRIANGLES, `${id}: ${triangles} triangles`);
    for (const image of json.images ?? []) {
      assert.equal(image.uri, undefined, `${id}: texture must be embedded, not a separate file`);
    }
  }
});

test('normalizing stands a model on the ground, centred, at the creature height', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2));
  mesh.position.set(5, 3, -7);
  const wrapper = normalizeModel(THREE, mesh);
  const box = new THREE.Box3().setFromObject(wrapper);
  assert.ok(Math.abs(box.min.y) < 1e-6, `stands on y=0, min.y=${box.min.y}`);
  assert.ok(Math.abs(box.max.y - CREATURE_MODEL_HEIGHT) < 1e-6, `height ${box.max.y}`);
  assert.ok(Math.abs(box.min.x + box.max.x) < 1e-6 && Math.abs(box.min.z + box.max.z) < 1e-6, 'centred on x/z');
  assert.ok(Math.abs(wrapper.userData.height - CREATURE_MODEL_HEIGHT) < 1e-6, 'records its height for the guide arrow');
  assert.equal(wrapper.clone(true).userData.height, wrapper.userData.height, 'instances carry it');
});

test('a long body is capped by its length, not blown up by its height', () => {
  const wrapper = normalizeModel(THREE, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 4)));
  const size = new THREE.Box3().setFromObject(wrapper).getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.z - CREATURE_MODEL_MAX_LENGTH) < 1e-6, `length ${size.z}`);
  assert.ok(size.y < CREATURE_MODEL_HEIGHT, `height ${size.y} shrinks with it`);
});

test('a failed model load resolves to nothing, so the procedural body stays', async () => {
  const models = new CreatureModels(THREE, {
    ids: ['sprout'],
    loader: { loadAsync: () => Promise.reject(new Error('404')) },
  });
  assert.equal(await models.load('sprout'), null);
  assert.equal(models.instance('sprout'), null);
  assert.equal(await models.load('not-a-model'), null, 'unlisted ids never fetch');
});

test('a loaded model hands out independent, shape-turned instances from one fetch', async () => {
  let fetches = 0;
  const models = new CreatureModels(THREE, {
    ids: ['flamewhisk'],
    loader: {
      loadAsync: async () => { fetches += 1; return { scene: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 3)) }; },
    },
  });
  await Promise.all([models.load('flamewhisk'), models.load('flamewhisk')]);
  assert.equal(fetches, 1, 'concurrent loads share one fetch');
  const a = models.instance('flamewhisk', 'long');
  const b = models.instance('flamewhisk', 'round');
  assert.notEqual(a, b);
  assert.equal(a.rotation.y, CREATURE_MODEL_YAW.long);
  assert.equal(b.rotation.y, 0);
});

test('the egg loads once, at the egg height, and each egg gets its own materials to tint', async () => {
  let fetched = null;
  const models = new CreatureModels(THREE, {
    ids: [],
    eggUrl: 'egg-url',
    loader: {
      loadAsync: async (url) => {
        fetched = url;
        return { scene: new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial()) };
      },
    },
  });
  assert.equal(models.eggInstance(), null, 'nothing before it loads');
  await models.loadEgg();
  assert.equal(fetched, 'egg-url');
  const a = models.eggInstance();
  const b = models.eggInstance();
  const height = new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3()).y;
  assert.ok(Math.abs(height - EGG_MODEL_HEIGHT) < 1e-6, `egg height ${height}`);
  const materialOf = (egg) => { let m = null; egg.traverse((o) => { if (o.isMesh) m = o.material; }); return m; };
  assert.notEqual(materialOf(a), materialOf(b), 'tinting one egg never tints another');
});

test('a failed egg load leaves the procedural egg', async () => {
  const models = new CreatureModels(THREE, { ids: [], loader: { loadAsync: () => Promise.reject(new Error('404')) } });
  assert.equal(await models.loadEgg(), null);
  assert.equal(models.eggInstance(), null);
});
