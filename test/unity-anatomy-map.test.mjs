import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildManifest, triangleUvKeys } from '../tools/unity-migration/export-hero-anatomy-regions.mjs';

const source = readFileSync(new URL('../public/src/character/heroAnatomyRegions.js', import.meta.url), 'utf8');
const hero = readFileSync(new URL('../public/assets/hero/hero_lod1_ironwood_atlas.glb', import.meta.url));

test('Unity coverage export matches the pinned supervised Hero and checked-in map', () => {
  const map = buildManifest(source, hero);
  const committed = JSON.parse(readFileSync(new URL('../unity/GalaQuest/Assets/GalaQuest/Gear/Definitions/HeroAnatomyRegions.json', import.meta.url)));
  assert.deepEqual(map, committed);
  assert.equal(new Set(map.sourceTriangleUvKeys).size, map.triangleCount);
  assert.equal(map.regions.hair.faceCount, 2263);
  assert.equal(map.regions.ears.faceCount, 153);
});

test('source byte changes reject instead of reusing stale anatomy labels', () => {
  const changed = Buffer.from(hero);
  changed[changed.length - 1] ^= 1;
  assert.throws(() => buildManifest(source, changed), /source hash/);
});

test('duplicate UV triangles reject instead of choosing arbitrary anatomy', () => {
  const changed = Buffer.from(hero);
  const length = changed.readUInt32LE(12);
  const doc = JSON.parse(changed.subarray(20, 20 + length));
  const primitive = doc.meshes.flatMap(m => m.primitives).find(p => p.attributes.JOINTS_0 != null);
  const accessor = doc.accessors[primitive.indices];
  const view = doc.bufferViews[accessor.bufferView];
  assert.equal(accessor.componentType, 5123);
  const offset = 28 + length + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  changed.copy(changed, offset + 6, offset, offset + 6);
  assert.throws(() => triangleUvKeys(changed, 6800), /Ambiguous source UV/);
});
