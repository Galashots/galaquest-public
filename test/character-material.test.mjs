import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as THREE from '../public/vendor/three.module.min.js';
import { normaliseCharacterMaterial } from '../public/src/character/hero.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function glbMaterials(relativePath) {
  const bytes = readFileSync(resolve(repoRoot, relativePath));
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')).materials ?? [];
}

// The defect this guards against, measured in the browser on 2026-08-12: the hero rendered as a
// featureless white silhouette with its 1024 atlas loaded and completely invisible. Two causes,
// both in the shipped GLB, and the second is a glTF spec trap.
test('the shipped hero GLB still declares the material defect this normaliser exists for', () => {
  const [material] = glbMaterials('public/assets/hero/hero.glb');

  // Full white emissive is ADDED on top of all lighting, unshaded and uniform.
  assert.deepEqual(material.emissiveFactor, [1, 1, 1]);

  // metallicFactor and roughnessFactor are ABSENT, and glTF defines both as defaulting to 1.0 --
  // not 0. A fully rough metal has no diffuse response at all, so the base colour texture cannot
  // show through even with the emissive removed.
  const pbr = material.pbrMetallicRoughness ?? {};
  assert.equal(pbr.metallicFactor, undefined, 'metallicFactor omitted, so it defaults to 1.0');
  assert.equal(pbr.roughnessFactor, undefined, 'roughnessFactor omitted, so it defaults to 1.0');

  // When this asset is re-exported correctly this test fails, which is the intended signal to
  // delete both it and the runtime normaliser rather than leave a workaround nobody remembers.
});

test('a gear export that declares its factors properly is left completely alone', () => {
  const [material] = glbMaterials('public/assets/gear/helmet_silverguard.glb');
  const pbr = material.pbrMetallicRoughness ?? {};

  // The newer Meshy exports are correct, which is what proves the hero's values are a defect
  // rather than the pipeline's normal output.
  assert.equal(pbr.metallicFactor, 0);
  assert.equal(pbr.roughnessFactor, 0.8);
  assert.equal(material.emissiveFactor, undefined, 'absent emissiveFactor defaults to black');
});

test('the hero material signature is normalised into something that can show its texture', () => {
  const material = new THREE.MeshStandardMaterial();
  material.emissive.setHex(0xffffff);
  material.metalness = 1;
  material.roughness = 1;

  assert.equal(normaliseCharacterMaterial(material), true, 'the defect signature must be corrected');
  assert.equal(material.emissive.getHex(), 0x000000);
  assert.equal(material.metalness, 0);
  assert.equal(material.roughness, 0.8, 'matches what the correct gear exports declare');
});

test('an authored material is not clobbered', () => {
  const material = new THREE.MeshStandardMaterial();
  material.emissive.setHex(0x000000);
  material.metalness = 0;
  material.roughness = 0.8;

  assert.equal(normaliseCharacterMaterial(material), false, 'nothing to correct');
  assert.equal(material.roughness, 0.8);
});

test('a deliberately metallic material keeps its metalness', () => {
  // The discriminator is the metalness MAP, and until AP2-A it was "metalness and roughness both
  // exactly 1". That earlier reading had to change, because it is the one Keeper v2 walked straight
  // through: metallicFactor omitted (so glTF defaults it to 1.0) but roughnessFactor authored at
  // 0.41, which satisfies "not both 1" while leaving the character fully metallic and therefore
  // with no diffuse response at all. He rendered as a golden waxy statue -- photographed in the
  // running game, tools/runtime-test/review-keeper-material.mjs variant A.
  //
  // The concern behind the original test is still right and still guarded: this normaliser must not
  // become a bug the first time somebody authors a real metal. What changed is the evidence used to
  // recognise one. A polished blade carries a metalnessMap; a Meshy character omits the factor and
  // has no map at all. And the blade never reaches this function regardless -- measured, not
  // assumed: normaliseCharacterMaterial has exactly four call sites (hero.js loadHero, wolf.js
  // loadWolf, zoneLoader.js loadKeeper, villagers.js), gear is loaded by gear.js and passes through
  // none of them, and every shipped gear GLB already declares metalness 0 / roughness 0.8.
  const material = new THREE.MeshStandardMaterial();
  material.metalness = 1;
  material.roughness = 0.2;
  material.metalnessMap = new THREE.Texture();

  normaliseCharacterMaterial(material);
  assert.equal(material.metalness, 1, 'an authored metal with a real map is not the defect signature');
  assert.equal(material.roughness, 0.2);
});

test('a character whose metallicFactor was merely omitted is corrected even when roughness was authored', () => {
  // Keeper v2's exact shape, and the regression that would have caught it. Every file in both
  // 2026-08-15 Meshy packs declares roughnessFactor 0.41 and no metallicFactor.
  const material = new THREE.MeshStandardMaterial();
  material.metalness = 1;      // GLTFLoader's value for an ABSENT metallicFactor
  material.roughness = 0.4100847542285919;
  material.map = new THREE.Texture();

  assert.equal(normaliseCharacterMaterial(material), true);
  assert.equal(material.metalness, 0, 'the golden-statue cure');
  assert.equal(material.roughness, 0.4100847542285919,
    'an AUTHORED roughness is respected -- overriding it would be taste, not defect repair');
});

test('an emissive material with its OWN emissive map is respected', () => {
  const material = new THREE.MeshStandardMaterial();
  material.emissive.setHex(0xffffff);
  material.map = new THREE.Texture();
  material.emissiveMap = new THREE.Texture();
  material.metalness = 0;
  material.roughness = 0.8;

  normaliseCharacterMaterial(material);
  assert.equal(material.emissive.getHex(), 0xffffff, 'a separately mapped emissive is intent');
  assert.notEqual(material.emissiveMap, null, 'and its map survives');
});

// The case that nearly shipped broken. hero.glb declares emissiveTexture index 0 AND
// baseColorTexture index 0 -- the same image. Guarding only on "has an emissiveMap" skipped it,
// so the plain hero would still have flooded white the moment Sol's Q3 revert happened.
test('an emissive map that is the albedo atlas again is the defect, not intent', () => {
  const atlas = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial();
  material.emissive.setHex(0xffffff);
  material.map = atlas;
  material.emissiveMap = atlas;

  assert.equal(normaliseCharacterMaterial(material), true);
  assert.equal(material.emissive.getHex(), 0x000000);
  assert.equal(material.emissiveMap, null, 'the redundant sample is dropped too');
});

test('the same albedo reused as emissive is recognised even as a distinct Texture object', () => {
  // GLTFLoader memoises by texture index so both slots normally share one Texture instance, but a
  // re-export or a different loader can produce two objects over one image. Identity of the image
  // is the durable signal.
  const image = { width: 1024, height: 1024 };
  const material = new THREE.MeshStandardMaterial();
  material.emissive.setHex(0xffffff);
  material.map = new THREE.Texture();
  material.map.image = image;
  material.emissiveMap = new THREE.Texture();
  material.emissiveMap.image = image;

  assert.equal(normaliseCharacterMaterial(material), true);
  assert.equal(material.emissive.getHex(), 0x000000);
});

test('the plain hero, which Q3 says to revert to, declares the albedo-as-emissive defect', () => {
  const [material] = glbMaterials('public/assets/hero/hero.glb');

  assert.deepEqual(material.emissiveFactor, [1, 1, 1]);
  assert.equal(material.emissiveTexture?.index, 0);
  assert.equal(material.pbrMetallicRoughness?.baseColorTexture?.index, 0);
});
