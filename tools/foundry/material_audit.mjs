#!/usr/bin/env node
/**
 * What does a GLB actually declare about its surfaces, and what survives into three.js?
 *
 *   node tools/foundry/material_audit.mjs <file.glb> [<file.glb> ...]
 *
 * WHY THIS EXISTS. Sol looked at the Keeper v2 review captures and saw a golden waxy statue where
 * a painted elderly man should be. The embedded 2048 texture is correct -- warm skin, grey beard,
 * brown robe -- so something between the atlas and the screen was overriding it, and AP1's contact
 * sheets had gone out without anyone noticing.
 *
 * The obvious suspect was the emissive defect this repo already knows about (an albedo atlas bound
 * a second time as `emissiveTexture` with `emissiveFactor [1,1,1]`, which floods a surface white).
 * But `normaliseCharacterMaterial` already runs on the Keeper -- zoneLoader.js:750 -- so the
 * obvious suspect was already handled, and a fix aimed there would have changed nothing.
 *
 * So this prints the whole surface declaration rather than the one field we expected to be guilty:
 * both PBR factors, every texture slot WITH THE IMAGE SOURCE IT RESOLVES TO (that is what makes
 * "the albedo is also the emissive" visible rather than inferred), and every material extension.
 * Extensions matter here because a glTF extension can carry values a plain PBR reading never shows
 * -- KHR_materials_specular's `specularColorFactor` is not clamped to [0,1] by the format, and a
 * value above 1 is a specular multiplier no amount of emissive correction touches.
 *
 * Reading the container by hand, not through GLTFLoader, is deliberate: this reports what the
 * VENDOR shipped. What three.js then makes of it is a separate question, answered by
 * `--runtime` (which loads the file through the repo's own vendored GLTFLoader and prints the
 * resulting material properties) so the two can be compared instead of conflated.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const JSON_CHUNK = 0x4e4f534a;

function readGlbJson(path) {
  const bytes = readFileSync(path);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    if (bytes.readUInt32LE(offset + 4) === JSON_CHUNK) {
      return JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8'));
    }
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  throw new Error(`${path}: no JSON chunk`);
}

/**
 * The image SOURCE a texture slot ends up sampling.
 *
 * Two texture slots can name two different `textures[]` entries and still be the same picture,
 * because several textures may share one `images[]` source with different samplers. Comparing
 * texture indices would miss that; comparing source indices is the question we actually mean.
 */
export function sourceOf(json, textureIndex) {
  if (textureIndex == null) return null;
  const texture = json.textures?.[textureIndex];
  if (!texture) return null;
  // A GLB may carry the image under an extension (KHR_texture_basisu) rather than `source`.
  const basis = texture.extensions?.KHR_texture_basisu?.source;
  return basis ?? texture.source ?? null;
}

/** Every surface fact of one material, flattened so two files can be diffed by eye. */
export function auditMaterial(json, material) {
  const pbr = material.pbrMetallicRoughness ?? {};
  const slots = {
    baseColor: sourceOf(json, pbr.baseColorTexture?.index),
    metallicRoughness: sourceOf(json, pbr.metallicRoughnessTexture?.index),
    normal: sourceOf(json, material.normalTexture?.index),
    occlusion: sourceOf(json, material.occlusionTexture?.index),
    emissive: sourceOf(json, material.emissiveTexture?.index),
  };
  const emissiveFactor = material.emissiveFactor ?? [0, 0, 0];
  return {
    name: material.name ?? '(unnamed)',
    baseColorFactor: pbr.baseColorFactor ?? [1, 1, 1, 1],
    // glTF 2.0 defaults BOTH of these to 1.0 when absent, which is the white-silhouette defect
    // this repo already knows about -- so absence is reported, never silently defaulted away.
    metallicFactor: pbr.metallicFactor ?? '(absent -> 1.0)',
    roughnessFactor: pbr.roughnessFactor ?? '(absent -> 1.0)',
    emissiveFactor,
    emissiveStrength: material.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? null,
    slots,
    // The finding this tool was written to make visible: the albedo bound a second time as the
    // emissive map. Compared by image SOURCE, so a re-pointed texture entry cannot hide it.
    albedoIsAlsoEmissive: slots.baseColor != null && slots.baseColor === slots.emissive,
    emissiveIsLit: emissiveFactor.some((c) => c > 0),
    extensions: Object.entries(material.extensions ?? {}).map(([k, v]) => `${k} ${JSON.stringify(v)}`),
  };
}

export function auditFile(path) {
  const json = readGlbJson(path);
  return {
    file: basename(path),
    images: (json.images ?? []).map((image, i) => `#${i} ${image.name ?? image.mimeType ?? '?'}`),
    materials: (json.materials ?? []).map((m) => auditMaterial(json, m)),
  };
}

if (process.argv[1]?.endsWith('material_audit.mjs')) {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error('usage: material_audit.mjs <file.glb> [<file.glb> ...]');
    process.exit(2);
  }
  for (const path of paths) {
    const report = auditFile(path);
    console.log(`\n=== ${report.file}`);
    console.log(`  images: ${report.images.length ? report.images.join(', ') : '(none)'}`);
    for (const m of report.materials) {
      console.log(`  material '${m.name}'`);
      console.log(`    baseColorFactor   ${JSON.stringify(m.baseColorFactor)}`);
      console.log(`    metallicFactor    ${m.metallicFactor}`);
      console.log(`    roughnessFactor   ${m.roughnessFactor}`);
      console.log(`    emissiveFactor    ${JSON.stringify(m.emissiveFactor)}`
        + `${m.emissiveStrength != null ? `  (strength ${m.emissiveStrength})` : ''}`);
      console.log(`    texture sources   ${JSON.stringify(m.slots)}`);
      if (m.albedoIsAlsoEmissive) {
        console.log(`    >> the base colour atlas is ALSO the emissive map (image source `
          + `#${m.slots.baseColor})${m.emissiveIsLit ? ' AND emissiveFactor is non-zero' : ''}`);
      }
      for (const e of m.extensions) console.log(`    extension         ${e}`);
      if (!m.extensions.length) console.log('    extension         (none)');
    }
  }
}
