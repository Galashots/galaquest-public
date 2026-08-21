import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as THREE from '../public/vendor/three.module.min.js';
import { HERO_URL, normaliseCharacterMaterial } from '../public/src/character/hero.js';
import { WOLF_URL } from '../public/src/enemies/wolf.js';
import { KEEPER } from '../public/src/world/zones/village.js';

// zoneLoader.js resolves a zone data module's `model` fields by prefixing 'assets/' -- see its own
// ASSET_PREFIX constant. Reconstructed here rather than imported so this file keeps naming its
// active load paths as *_URL constants the same way HERO_URL/WOLF_URL already do.
const KEEPER_URL = `assets/${KEEPER.model}`;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = resolve(repoRoot, 'public/assets');

// The white-silhouette defect, measured in the browser on 2026-08-12 (see the docstring on
// normaliseCharacterMaterial in public/src/character/hero.js): two independent glTF material
// faults that each independently make a character invisible, and which shipped together.
//   1. emissiveFactor [1,1,1] -- unshaded, additive, floods the surface white regardless of
//      lighting or base colour.
//   2. metallicFactor/roughnessFactor ABSENT from the JSON. glTF 2.0 defines the default for
//      each as 1.0, not 0 -- a fully rough metal has no diffuse response at all.
// This file is the ongoing guard: it parses every shipped .glb directly (not Blender, not
// three.js's GLTFLoader) so a newly added asset that ships either fault cannot pass silently.

// ---------------------------------------------------------------------------------------------
// GLB parsing -- same approach as test/gear-attachment.test.mjs's readGlbJson: a .glb is a
// 12-byte header (magic 'glTF', version, total length) followed by chunks, and the first chunk
// of every glTF-Binary export is JSON (chunk type 0x4E4F534A, the ASCII bytes 'JSON' read as a
// little-endian uint32). Reading the container by hand is deliberate -- it is exactly what the
// browser's GLTFLoader itself parses, with nothing translated or re-interpreted on the way.
function readGlbJson(absolutePath) {
  const bytes = readFileSync(absolutePath);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${absolutePath}: not a glb (bad magic)`);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${absolutePath}: first chunk is not JSON`);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
}

function findGlbFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findGlbFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.glb')) found.push(full);
  }
  return found;
}

function repoRelativePath(absolutePath) {
  // Compared against KNOWN_DORMANT_DEFECTS keys and HERO_URL below, so normalised to forward
  // slashes -- path.relative returns backslashes on Windows.
  return relative(repoRoot, absolutePath).split('\\').join('/');
}

// glTF textures reference an image indirectly (texture -> source -> image). Two DIFFERENT
// texture indices can still point at the same image, which is exactly what public/assets/hero/
// hero.glb, hero_lod1_6800.glb and public/assets/enemies/wolf.glb do: comparing texture indices
// would miss it, so this resolves all the way down to the image.
function imageIndexForTexture(json, textureIndex) {
  if (textureIndex === undefined) return undefined;
  return json.textures?.[textureIndex]?.source;
}

// The measured facts for one material, with glTF 2.0's own spec defaults applied exactly where
// public/vendor/loaders/GLTFLoader.js applies them (read directly, not assumed):
//   materialParams.metalness = metallicFactor !== undefined ? metallicFactor : 1.0   (line 3544)
//   materialParams.roughness = roughnessFactor !== undefined ? roughnessFactor : 1.0 (line 3545)
// emissiveFactor's default of [0, 0, 0] is the glTF 2.0 core spec default for an absent key.
function materialFacts(json, material) {
  const pbr = material.pbrMetallicRoughness ?? {};
  const baseColorImage = imageIndexForTexture(json, pbr.baseColorTexture?.index);
  const emissiveImage = imageIndexForTexture(json, material.emissiveTexture?.index);
  return {
    name: material.name ?? '(unnamed)',
    emissiveFactor: material.emissiveFactor ?? [0, 0, 0],
    hasEmissiveTexture: material.emissiveTexture !== undefined,
    emissiveTextureIsBaseColorImage:
      material.emissiveTexture !== undefined
      && baseColorImage !== undefined
      && emissiveImage === baseColorImage,
    metallicFactorPresent: pbr.metallicFactor !== undefined,
    roughnessFactorPresent: pbr.roughnessFactor !== undefined,
    metallicFactor: pbr.metallicFactor ?? 1,
    roughnessFactor: pbr.roughnessFactor ?? 1,
    hasMetallicRoughnessTexture: Boolean(pbr.metallicRoughnessTexture),
  };
}

// The defect signature is the exact one described above: a full [1, 1, 1] flood. A partial,
// distinctly-textured emissive (a lantern, a glowing rune) is a different, legitimate authoring
// pattern and is exactly what normaliseCharacterMaterial itself is written to leave alone.
function isEmissiveFlooded(facts) {
  return facts.emissiveFactor.length === 3 && facts.emissiveFactor.every((component) => component === 1);
}

function isPbrDefaulted(facts) {
  return !facts.metallicFactorPresent && !facts.roughnessFactorPresent && !facts.hasMetallicRoughnessTexture;
}

// The Keeper v2 shape, and the reason this file grew a third classifier in AP2-A.
//
// `isPbrDefaulted` demands that BOTH factors be missing, because that was the only shape the
// 2026-08-12 audit had ever seen. Meshy's newer exports write a real `roughnessFactor` (0.41 on every
// file in both new packs) while still omitting `metallicFactor`, so glTF's own default of 1.0 makes
// the character fully metallic and `isPbrDefaulted` reports it clean. Measured in the running game:
// the Keeper rendered as a golden waxy statue with his painted skin and beard tinting reflections
// instead of colouring him.
//
// Deliberately NOT folded into isPbrDefaulted: these are two different faults with two different
// cures, and the dormant-defect bookkeeping below records which one each shipped file has.
function isMetallicByOmission(facts) {
  return !facts.metallicFactorPresent && !facts.hasMetallicRoughnessTexture;
}

// The albedo atlas bound a SECOND time as the emissive map, with a non-zero emissive factor: a
// character lit by its own colours, unshaded and additive.
//
// `isEmissiveFlooded` only catches the full [1,1,1] case. This catches the same authoring mistake at
// any strength, which matters because nothing about the defect requires the factor to be exactly 1 --
// Meshy simply happens to write 1 today. Compared by IMAGE index, not texture index, because the
// hero, the wolf and the keeper all reach one image through two texture entries.
//
// FAIL, not warn, and the measurement that decided it: no .glb under public/assets/ ships an emissive
// backed by its own distinct map. There is not one legitimate emissive asset for this to be unfair
// to. The Lantern Tree does glow, but that is applied at runtime by zoneLoader.js against a material
// whose export declares no emissive at all -- so authored-glow assets remain possible and simply are
// not something we ship yet. If one ever is, it will have its own emissive image and this returns
// false for it by construction.
function isAlbedoBoundAsEmissive(facts) {
  return facts.emissiveTextureIsBaseColorImage && facts.emissiveFactor.some((component) => component > 0);
}

// Reconstructs the THREE.MeshStandardMaterial that GLTFLoader would hand the runtime for these
// facts, closely enough to run the real normaliseCharacterMaterial against it and trust the
// result. The shared plain object per image index reproduces GLTFLoader's own guarantee that two
// texture entries over one image end up as texture objects with an equal .image: its
// loadImageSource caches by image index and returns `texture.clone()` on a repeat (GLTFLoader.js
// ~line 3260), and Texture.clone()/copy() shares .image by reference rather than duplicating it
// -- verified directly against public/vendor/three.module.min.js in this repo, not assumed from
// upstream three.js docs.
function materialFromFacts(json, material) {
  const pbr = material.pbrMetallicRoughness ?? {};
  const threeMaterial = new THREE.MeshStandardMaterial();
  const [er, eg, eb] = material.emissiveFactor ?? [0, 0, 0];
  threeMaterial.emissive.setRGB(er, eg, eb);
  threeMaterial.metalness = pbr.metallicFactor ?? 1;
  threeMaterial.roughness = pbr.roughnessFactor ?? 1;

  const imagesByIndex = new Map();
  const textureForIndex = (textureIndex) => {
    const imageIndex = imageIndexForTexture(json, textureIndex);
    if (imageIndex === undefined) return null;
    if (!imagesByIndex.has(imageIndex)) imagesByIndex.set(imageIndex, { sourceImageIndex: imageIndex });
    const texture = new THREE.Texture();
    texture.image = imagesByIndex.get(imageIndex);
    return texture;
  };

  threeMaterial.map = textureForIndex(pbr.baseColorTexture?.index);
  threeMaterial.emissiveMap = textureForIndex(material.emissiveTexture?.index);
  if (pbr.metallicRoughnessTexture) {
    threeMaterial.metalnessMap = new THREE.Texture();
    threeMaterial.roughnessMap = threeMaterial.metalnessMap;
  }
  return threeMaterial;
}

// Every GLB the shipped runtime actually fetches and hands to a mesh today, paired with the
// loader responsible for sanitising it. Measured by grepping public/src for every loadGLB( call
// site, not assumed: as of this writing there are exactly two, hero.js's loadHero() and (added
// concurrently with this very audit -- see the dossier) wolf.js's loadWolf(). Both already call
// normaliseCharacterMaterial over every mesh material before the model is used for anything else.
const ACTIVE_LOAD_PATHS = [
  { url: HERO_URL, source: 'hero.js loadHero()' },
  { url: WOLF_URL, source: 'wolf.js loadWolf()' },
  { url: KEEPER_URL, source: 'zoneLoader.js loadKeeper()' },
];

// Shipped .glb files that are measured, today, to declare this defect but sit on no runtime load
// path -- so nothing currently puts a wrong pixel on screen from them. Each entry is accounted
// for elsewhere; this list exists so that a genuinely NEW broken asset cannot hide next to them.
// Anything not listed here must be either clean or one of ACTIVE_LOAD_PATHS above (checked below).
const KNOWN_DORMANT_DEFECTS = new Map([
  // The pre-split "plain" hero. Not HERO_URL -- the private engineering archive
  // records Sol's Q3 ruling to revert to loading this file and attach gear at runtime, but that
  // revert has not happened yet (public/src/character/hero.js still points at the Tier 2
  // baked-atlas export). Its exact signature is separately pinned in test/character-material.test.mjs.
  ['public/assets/hero/hero.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  // Sol's Q10 budget scenario (see test/glb-budget.test.mjs): the plain decimated hero LOD1 that
  // a future runtime-attach arrangement would use. Only ever read by tools/budget/glb_budget.mjs,
  // which sums triangle/primitive/byte counts and never constructs a material. No renderer
  // reaches this file today.
  ['public/assets/hero/hero_lod1_6800.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  // PR #26 raw Meshy candidates: Wren Ranger and Bramble Stalker, base plus walk/run. Measured
  // signature is the raw provider export -- generator "Khronos glTF Blender I/O v4.0.43",
  // emissiveFactor [1,1,1] with the albedo bound as an emissive texture, and no metallic/roughness
  // factors at all.
  //
  // These six files are NOT in the tree. The 2026-08-21 asset-platform consolidation moved them to
  // the external source archive; see docs/asset-production/asset-platform-inventory.json for each
  // one's SHA-256, git blob OID and recovery command. The entries stay because the walk below is
  // filesystem-driven -- an absent file is simply never looked up -- so they cost nothing, they keep
  // the measured defect knowledge next to the assets it describes, and they let a candidate be
  // pulled back out of the archive for review without anyone having to edit this test first.
  //
  // The Dawnwarden helmet and sword are deliberately NOT listed. They were listed here on #26/#28,
  // but that was wrong: both measure clean (generator "pygltflib@v1.16.5", no emissive, explicit
  // metallicFactor 0 / roughnessFactor 0.8) -- the same already-processed signature as the shipped
  // Wildwood sword, not the raw-Meshy signature above. Listing a clean asset as a known defect is
  // misleading dead data, and the guard at the end of this file now fails if it reappears.
  ['public/assets/characters/candidates/wren-ranger-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/characters/candidates/wren-ranger-v1-walk.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/characters/candidates/wren-ranger-v1-run.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/bramble-stalker-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/bramble-stalker-v1-walk.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/bramble-stalker-v1-run.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  // Enemy Wave 1 rigged Meshy candidates. Structural intake passed, but the raw provider export
  // keeps the same flooded emissive / PBR-default material signature. These files are candidate-only
  // and have no active runtime load path; promotion requires material cleanup/re-export or a loader
  // path that applies normaliseCharacterMaterial().
  ['public/assets/enemies/candidates/spriggan-scrapper-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/thornback-orc-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/stagroot-warden-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/coalclaw-kobold-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/cinderfang-raider-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/magmahorn-juggernaut-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/snowfang-marauder-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/iceback-ogre-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/frostbound-warden-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/boneguard-raider-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/tombmaul-knight-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/graveflame-reaper-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
  ['public/assets/enemies/candidates/stormbreaker-colossus-v1.glb', { emissiveFlooded: true, pbrDefaulted: true }],
]);

test('every actively-loaded character GLB has its material defect, if any, either absent or fully neutralised by normaliseCharacterMaterial', () => {
  for (const { url, source } of ACTIVE_LOAD_PATHS) {
    const relPath = `public/${url}`;
    const absolutePath = resolve(repoRoot, 'public', ...url.split('/'));
    const json = readGlbJson(absolutePath);
    assert.ok(json.materials?.length > 0, `${relPath} declares at least one material`);

    for (const material of json.materials) {
      const facts = materialFacts(json, material);
      const flooded = isEmissiveFlooded(facts);
      const pbrDefaulted = isPbrDefaulted(facts);
      const metallicByOmission = isMetallicByOmission(facts);
      const albedoAsEmissive = isAlbedoBoundAsEmissive(facts);
      const threeMaterial = materialFromFacts(json, material);
      const wasChanged = normaliseCharacterMaterial(threeMaterial);

      if (!flooded && !pbrDefaulted && !metallicByOmission && !albedoAsEmissive) {
        // Clean by construction: nothing for the normaliser to do. If this branch starts running
        // because the shipped asset was re-exported with correct factors, that is good news --
        // see the instructions at the top of normaliseCharacterMaterial for what to delete next.
        continue;
      }

      assert.equal(wasChanged, true,
        `${relPath} (loaded by ${source}) material "${facts.name}" declares a known material defect ` +
        `(emissiveFlooded=${flooded}, pbrDefaulted=${pbrDefaulted}, metallicByOmission=${metallicByOmission}, ` +
        `albedoAsEmissive=${albedoAsEmissive}) but normaliseCharacterMaterial left it untouched`);
      assert.equal(threeMaterial.emissive.getHex(), 0x000000,
        `${relPath} (loaded by ${source}) material "${facts.name}" would still render with a flooded emissive`);
      assert.equal(threeMaterial.emissiveMap, null,
        `${relPath} (loaded by ${source}) material "${facts.name}" still samples its albedo as an emissive map`);
      // Metalness ALONE, not "metalness and roughness together". This assertion used to read
      // `!(metalness === 1 && roughness === 1)`, and that is precisely how Keeper v2's golden-statue
      // defect got past it: metalness 1 with roughness 0.41 satisfies the old form while the surface
      // still has no diffuse response whatever. Roughness never rescues metalness -- a rough metal is
      // a rough metal.
      assert.notEqual(threeMaterial.metalness, 1,
        `${relPath} (loaded by ${source}) material "${facts.name}" would still render fully metallic `
        + `(roughness ${threeMaterial.roughness}), so its painted atlas tints reflections instead of `
        + 'colouring the surface -- the golden-statue defect');
    }
  }
});

test('no other .glb under public/assets/ ships this defect outside the short, justified dormant list', () => {
  const files = findGlbFiles(ASSET_ROOT);
  // A loose floor, not a pin: new CLEAN assets are welcome and must not have to edit this test to
  // land. This only guards against the walk itself silently returning nothing.
  assert.ok(files.length >= 9, `expected to find shipped .glb files under public/assets/, found ${files.length}`);

  const activeRelPaths = new Set(ACTIVE_LOAD_PATHS.map(({ url }) => `public/${url}`));

  for (const absolutePath of files) {
    const relPath = repoRelativePath(absolutePath);
    if (activeRelPaths.has(relPath)) continue; // covered by the test above

    const json = readGlbJson(absolutePath);
    for (const material of json.materials ?? []) {
      const facts = materialFacts(json, material);
      const flooded = isEmissiveFlooded(facts);
      const pbrDefaulted = isPbrDefaulted(facts);
      const metallicByOmission = isMetallicByOmission(facts);
      const albedoAsEmissive = isAlbedoBoundAsEmissive(facts);
      if (!flooded && !pbrDefaulted && !metallicByOmission && !albedoAsEmissive) continue; // clean

      const known = KNOWN_DORMANT_DEFECTS.get(relPath);
      assert.ok(known, [
        `${relPath} material "${facts.name}" declares a known material defect`,
        `(emissiveFlooded=${flooded}, pbrDefaulted=${pbrDefaulted},`,
        `metallicByOmission=${metallicByOmission}, albedoAsEmissive=${albedoAsEmissive})`,
        'and is not on an active load path',
        `(${[...activeRelPaths].join(', ')}) or on the KNOWN_DORMANT_DEFECTS list in this file.`,
        'Before this ships: either route its load path through normaliseCharacterMaterial(),',
        're-export it with correct emissive/metallic/roughness factors, or -- only if it is',
        'genuinely unreachable at runtime today -- add it to KNOWN_DORMANT_DEFECTS with the same',
        'kind of justification as its neighbours.',
      ].join(' '));
      assert.equal(flooded, known.emissiveFlooded,
        `${relPath}: measured emissive-flood status changed (now ${flooded}); update KNOWN_DORMANT_DEFECTS or investigate`);
      assert.equal(pbrDefaulted, known.pbrDefaulted,
        `${relPath}: measured pbr-defaulted status changed (now ${pbrDefaulted}); update KNOWN_DORMANT_DEFECTS or investigate`);
    }
  }
});

// A positive control: proves the classifier can recognise a CLEAN file as clean, not merely that
// it happens to recognise every currently-known defect. Without this, isEmissiveFlooded and
// isPbrDefaulted could be miswired to always report "no fault" and every test above would still
// pass for the wrong reason.
// -------------------------------------------------------------------------------------------
// AP2-A: the golden-statue defect. Keeper v2 arrived with a REAL roughnessFactor and no
// metallicFactor, a shape neither the classifier nor normaliseCharacterMaterial had seen.
// -------------------------------------------------------------------------------------------

/** The exact material JSON every file in both 2026-08-15 Meshy packs declares. Measured, not typed. */
const MESHY_V2_MATERIAL = Object.freeze({
  name: 'Material_1',
  pbrMetallicRoughness: {
    baseColorFactor: [1, 1, 1, 1],
    baseColorTexture: { index: 0 },
    roughnessFactor: 0.4100847542285919,
    // metallicFactor deliberately ABSENT -- that is the whole defect.
  },
  emissiveFactor: [1, 1, 1],
  emissiveTexture: { index: 0 },
  extensions: { KHR_materials_specular: { specularColorFactor: [2, 2, 2] } },
});
const MESHY_V2_JSON = Object.freeze({
  images: [{ name: 'texture_0' }],
  textures: [{ source: 0 }],
  materials: [MESHY_V2_MATERIAL],
});

test('the Meshy v2 export shape is CLASSIFIED as defective even though roughnessFactor is present', () => {
  const facts = materialFacts(MESHY_V2_JSON, MESHY_V2_MATERIAL);

  // The old pair of classifiers, both of which say "clean" about this material. Asserted rather
  // than described, so that if either is ever widened this test explains why it no longer needs to.
  assert.equal(isPbrDefaulted(facts), false,
    'isPbrDefaulted requires BOTH factors absent, so it cannot see this shape -- that is why it slipped through');

  assert.equal(isMetallicByOmission(facts), true,
    'metallicFactor is absent and there is no metallicRoughness texture, so glTF defaults it to 1.0');
  assert.equal(isAlbedoBoundAsEmissive(facts), true,
    'baseColorTexture and emissiveTexture resolve to the same image, with a non-zero emissiveFactor');
});

test('normaliseCharacterMaterial fully cures the Meshy v2 shape', () => {
  const material = materialFromFacts(MESHY_V2_JSON, MESHY_V2_MATERIAL);
  assert.equal(material.metalness, 1, 'precondition: GLTFLoader hands us metalness 1 for an absent metallicFactor');
  assert.equal(material.roughness, MESHY_V2_MATERIAL.pbrMetallicRoughness.roughnessFactor,
    'precondition: the authored roughness survives GLTFLoader unchanged');

  assert.equal(normaliseCharacterMaterial(material), true);

  assert.equal(material.metalness, 0,
    'a character painted with a colour atlas is never a bare uniform metal -- this is the golden-statue cure');
  assert.equal(material.emissive.getHex(), 0x000000);
  assert.equal(material.emissiveMap, null);
  // The authored roughness is RESPECTED, not overwritten. 0.41 is a value the vendor chose; the
  // 0.8 correction is only for a roughnessFactor that was omitted entirely. Changing this one is a
  // taste call for art review, not a defect repair, and is deliberately not made here.
  assert.equal(material.roughness, MESHY_V2_MATERIAL.pbrMetallicRoughness.roughnessFactor,
    'an AUTHORED roughness must survive normalisation');
});

test('sabotage: the cure is not unconditional -- a genuinely metallic material with its own map survives', () => {
  const material = new THREE.MeshStandardMaterial();
  material.metalness = 1;
  material.roughness = 0.2;
  material.metalnessMap = new THREE.Texture();
  material.roughnessMap = material.metalnessMap;

  normaliseCharacterMaterial(material);

  assert.equal(material.metalness, 1, 'a polished blade authored at metalness 1 with a real map must not be flattened');
  assert.equal(material.roughness, 0.2);
});

test('sabotage: an emissive backed by its OWN distinct map is authored intent and survives', () => {
  const json = {
    images: [{ name: 'albedo' }, { name: 'glow' }],
    textures: [{ source: 0 }, { source: 1 }],
    materials: [{
      name: 'lantern',
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 },
      emissiveFactor: [1, 1, 1],
      emissiveTexture: { index: 1 },
    }],
  };
  const facts = materialFacts(json, json.materials[0]);
  assert.equal(isAlbedoBoundAsEmissive(facts), false,
    'a distinct emissive image is a deliberately glowing asset, not the exporter dumping albedo twice');

  const material = materialFromFacts(json, json.materials[0]);
  normaliseCharacterMaterial(material);
  assert.notEqual(material.emissive.getHex(), 0x000000, 'authored glow must not be neutralised');
  assert.notEqual(material.emissiveMap, null);
});

test('a correctly authored gear export is recognised as clean, not merely unlisted', () => {
  const json = readGlbJson(resolve(repoRoot, 'public/assets/gear/helmet_silverguard.glb'));
  const facts = materialFacts(json, json.materials[0]);

  assert.equal(facts.metallicFactorPresent, true);
  assert.equal(facts.roughnessFactorPresent, true);
  assert.equal(isEmissiveFlooded(facts), false);
  assert.equal(isPbrDefaulted(facts), false);
});

test('every file still in the tree that is listed as a known dormant defect actually has one', () => {
  // The registry is an allowlist for measured defects, so a CLEAN file listed here is dead data that
  // quietly misreports the state of an asset. That is exactly how the Dawnwarden helmet and sword --
  // both already re-exported clean through pygltflib -- came to be filed next to raw Meshy output and
  // described as flooded. Entries whose file is not in the tree are skipped: those are deliberate
  // archive records for bytes held outside Git.
  let checked = 0;

  for (const [relPath] of KNOWN_DORMANT_DEFECTS) {
    const absolutePath = resolve(repoRoot, ...relPath.split('/'));
    if (!existsSync(absolutePath)) continue;
    checked += 1;

    const json = readGlbJson(absolutePath);
    const defective = (json.materials ?? []).some((material) => {
      const facts = materialFacts(json, material);
      return isEmissiveFlooded(facts) || isPbrDefaulted(facts)
        || isMetallicByOmission(facts) || isAlbedoBoundAsEmissive(facts);
    });

    assert.ok(defective, [
      `${relPath} is listed in KNOWN_DORMANT_DEFECTS but measures CLEAN.`,
      'Either it was re-exported and the entry should be deleted, or it never had the defect it was',
      'filed under. Do not leave a clean asset described as broken.',
    ].join(' '));
  }

  assert.ok(checked > 0, 'the guard must actually measure something, not vacuously pass');
});
