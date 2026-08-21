import { CHARACTER, setLayer } from '../render/layers.js';
import { loadGLB } from '../world/assets.js';
import { attachRigidTier2Gear } from './gear.js';
import {
  attachTriangleAnatomyRegions, geometryForAnatomyCoverage, normalizeHiddenRegions,
} from './anatomyOcclusion.js';
import { HERO_ANATOMY_SOURCE, HERO_ANATOMY_TRIANGLES } from './heroAnatomyRegions.js';

export const HERO_URL = 'assets/hero/hero_lod1_ironwood_atlas.glb';

// What the correct gear exports declare, so a corrected material matches the rest of the pipeline
// rather than introducing a third opinion about how rough a character is.
const AUTHORED_ROUGHNESS = 0.8;

/**
 * Undo two defects in the hero export that together made the character invisible.
 *
 * Measured in the browser on 2026-08-12: the hero rendered as a featureless white silhouette. Its
 * 1024 atlas was loaded and decoded correctly and contributed nothing to a single pixel, so every
 * tier of armour painting had been judged in Blender renders and none of it had ever reached the
 * screen.
 *
 * Two causes, both declared in the GLB:
 *   emissiveFactor [1,1,1] -- emissive is ADDED after all lighting, unshaded and uniform, so a
 *     white one floods the surface and erases both texture and shading.
 *   metallicFactor and roughnessFactor ABSENT -- and glTF defines each as defaulting to 1.0, not
 *     0. A fully rough metal has no diffuse response, so even with the emissive gone the base
 *     colour cannot show through.
 *
 * Deliberately narrow. An emissive backed by an emissiveMap is authored intent and is left alone.
 *
 * THE TWO PBR CORRECTIONS ARE INDEPENDENT, and were not always. Until AP2-A both were behind one
 * guard, `metalness === 1 && roughness === 1`, read as the signature of BOTH factors having been
 * omitted. Meshy's newer exports write a real `roughnessFactor` while still omitting
 * `metallicFactor`, so that guard stopped matching and Keeper v2 kept **metalness 1.0**. A fully
 * metallic surface has no diffuse response at all: its painted atlas stops acting as albedo and
 * becomes a specular tint, and the warm skin / grey beard / brown robe genuinely present in his
 * 2048 texture rendered as a golden waxy statue. Measured in the running game, not inferred --
 * tools/runtime-test/review-keeper-material.mjs, variant A vs variant B.
 *
 * So metalness is now corrected on its own signature: exactly 1 with no metalnessMap. That is
 * always wrong HERE, because this function is only ever called on characters (loadHero,
 * zoneLoader's loadKeeper, villagers.js, loadWolf) and a character painted with a colour atlas is
 * never a bare uniform metal. A real polished blade still survives untouched -- gear GLBs are
 * loaded by gear.js and never pass through this function, and every one of them already declares
 * metalness 0 / roughness 0.8 anyway.
 *
 * Roughness is still only corrected when it was OMITTED. An authored 0.41 is a value the vendor
 * actually chose, and overriding it would be taste rather than defect repair; Keeper v2's remains
 * 0.41 and is on Sol's desk with captures at both values.
 *
 * This is a workaround at the wrong end. The right fix is re-exporting the hero with correct
 * factors; test/character-material.test.mjs pins the defect so that doing so fails loudly and
 * prompts deleting this function.
 */
export function normaliseCharacterMaterial(material) {
  let changed = false;

  // An emissive backed by its OWN map is authored intent -- glowing runes, a lantern -- and is left
  // alone. An emissive map that is the base colour atlas AGAIN is not intent: it is the exporter
  // dumping albedo into the emissive slot, which makes the character self-lit in its own colours.
  // public/assets/hero/hero.glb does exactly that, emissiveTexture index 0 being baseColorTexture
  // index 0, so guarding only on "has an emissiveMap" would skip the very asset Sol's Q3 ruling
  // tells us to revert to, and the plain hero would still render as a flooded white silhouette.
  const emissiveMapIsTheAlbedo = Boolean(material.emissiveMap)
    && (material.emissiveMap === material.map
      || (Boolean(material.emissiveMap.image) && material.emissiveMap.image === material.map?.image));

  if (material.emissive && material.emissive.getHex() !== 0x000000
      && (!material.emissiveMap || emissiveMapIsTheAlbedo)) {
    material.emissive.setHex(0x000000);
    // A black emissive already contributes nothing, but leaving the map bound costs a per-fragment
    // texture sample for a term multiplied by zero.
    if (emissiveMapIsTheAlbedo) material.emissiveMap = null;
    changed = true;
  }
  if (material.metalness === 1 && !material.metalnessMap) {
    material.metalness = 0;
    changed = true;
  }
  if (material.roughness === 1 && !material.roughnessMap) {
    material.roughness = AUTHORED_ROUGHNESS;
    changed = true;
  }

  if (changed) material.needsUpdate = true;
  return changed;
}

function installHeroAnatomy(root) {
  const skinnedBodies = [];
  root.traverse((object) => {
    if (object.isSkinnedMesh && object.geometry) skinnedBodies.push(object);
  });
  if (skinnedBodies.length !== 1) {
    throw new Error(`Hero anatomy proof expected exactly one skinned body mesh, found ${skinnedBodies.length}`);
  }
  if (HERO_ANATOMY_SOURCE.assetPath !== HERO_URL) {
    throw new Error(`Hero anatomy sidecar targets ${HERO_ANATOMY_SOURCE.assetPath}, runtime loads ${HERO_URL}`);
  }

  const body = skinnedBodies[0];
  const sourceGeometry = body.geometry;
  attachTriangleAnatomyRegions(sourceGeometry, HERO_ANATOMY_TRIANGLES, HERO_ANATOMY_SOURCE);
  let coverage = Object.freeze([]);

  return {
    setCoverage(hiddenRegions = []) {
      const normalized = Object.freeze(normalizeHiddenRegions(hiddenRegions));
      body.geometry = geometryForAnatomyCoverage(sourceGeometry, normalized);
      coverage = normalized;
      return [...coverage];
    },
    get coverage() { return [...coverage]; },
    body,
    sourceGeometry,
  };
}

export async function loadHero() {
  const gltf = await loadGLB(HERO_URL);
  const root = setLayer(gltf.scene, CHARACTER);
  root.name = 'hero';
  root.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = false;
      object.receiveShadow = false;
      for (const material of [].concat(object.material)) {
        normaliseCharacterMaterial(material);
      }
    }
  });
  const failed = Boolean(gltf.userData?.loadError);
  const anatomy = failed ? null : installHeroAnatomy(root);

  // This runs before the local hero becomes the remote-player template, so
  // SkeletonUtils clones each solved anchor with the rest of the rig.
  const rigidGear = failed ? [] : attachRigidTier2Gear(root);

  return {
    animations: gltf.animations ?? [],
    failed,
    rigidGear,
    root,
    setAnatomyCoverage(hiddenRegions = []) {
      if (!anatomy) {
        if (hiddenRegions.length) throw new Error('cannot apply anatomy coverage to failed Hero fallback');
        return [];
      }
      return anatomy.setCoverage(hiddenRegions);
    },
    get anatomyCoverage() { return anatomy?.coverage ?? []; },
  };
}
