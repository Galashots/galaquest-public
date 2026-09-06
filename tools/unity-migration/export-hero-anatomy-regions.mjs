#!/usr/bin/env node
// Export the committed Hero anatomy region map into a Unity-consumable JSON file.
//
// public/src/character/heroAnatomyRegions.js already holds a supervised per-triangle semantic map for
// the exact shipping Hero, pinned to that GLB's SHA256. It is the same data the Three.js runtime uses
// to build a one-draw index-buffer variant when equipment declares coverage.
//
// This re-expresses it as face-index arrays so the Unity Gear Workbench can PREVIEW what covered
// anatomy will look like hidden. It is a preview, not the runtime equip system: Unity gets to show the
// Owner "the hair will be hidden under this helmet" so a helmet is not fitted around hair volume that
// will not be there.
//
// Source face indices are accompanied by unique UV-triangle keys. Unity requires a complete bijection
// against its imported mesh before transferring regions; equal triangle counts alone prove nothing.
//
// Usage:
//   node tools/unity-migration/export-hero-anatomy-regions.mjs [--out <path>]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE = 'public/src/character/heroAnatomyRegions.js';
const DEFAULT_OUT = 'unity/GalaQuest/Assets/GalaQuest/Gear/Definitions/HeroAnatomyRegions.json';

export function decodeBitset(encoded, triangleCount) {
  const bytes = Buffer.from(encoded, 'base64');
  const faces = [];
  for (let face = 0; face < triangleCount; face += 1) {
    if (bytes[face >> 3] & (1 << (face & 7))) faces.push(face);
  }
  return faces;
}

export function parseSource(source) {
  const triangleCount = Number(source.match(/triangleCount:\s*(\d+)/)?.[1]);
  const sha256 = source.match(/sha256:\s*'([0-9a-f]{64})'/)?.[1];
  const assetPath = source.match(/assetPath:\s*'([^']+)'/)?.[1];
  if (!triangleCount || !sha256) throw new Error(`${SOURCE}: could not read the pinned source header`);

  const regions = {};
  for (const [, name, encoded] of source.matchAll(/const ([A-Z_]+)_BITSET = '([^']+)'/g)) {
    const key = name.toLowerCase().replace(/_scalp$/, '');
    regions[key] = decodeBitset(encoded, triangleCount);
  }

  if (Object.keys(regions).length === 0) throw new Error(`${SOURCE}: no region bitsets found`);
  return { triangleCount, sha256, assetPath, regions };
}

export function triangleUvKeys(bytes, triangleCount, quantization = 100000) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error('Expected GLB v2');
  const jsonLength = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const binary = bytes.subarray(28 + jsonLength);
  const candidates = doc.meshes.flatMap(mesh => mesh.primitives).filter(p => p.attributes.JOINTS_0 != null);
  if (candidates.length !== 1) throw new Error('Expected exactly one skinned Hero primitive');
  function accessor(index, width) {
    const a = doc.accessors[index], view = doc.bufferViews[a.bufferView];
    if (a.sparse || view.buffer !== 0) throw new Error('Unsupported source accessor');
    const formats = { 5121: [1, 'readUInt8'], 5123: [2, 'readUInt16LE'], 5125: [4, 'readUInt32LE'], 5126: [4, 'readFloatLE'] };
    const [size, read] = formats[a.componentType] ?? [];
    if (!size) throw new Error('Unsupported accessor component');
    return Array.from({ length: a.count }, (_, i) => Array.from({ length: width }, (_, j) =>
      binary[read]((view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? width * size) + j * size)));
  }
  const primitive = candidates[0];
  const uvs = accessor(primitive.attributes.TEXCOORD_0, 2), indices = accessor(primitive.indices, 1).flat();
  if (indices.length !== triangleCount * 3) throw new Error('Anatomy source triangle count mismatch');
  const keys = Array.from({ length: triangleCount }, (_, face) => indices.slice(face * 3, face * 3 + 3)
    .map(i => {
      if (!uvs[i]?.every(Number.isFinite)) throw new Error('Missing/nonfinite source UV');
      return uvs[i].map(v => Math.round(v * quantization)).join(',');
    }).sort().join(';'));
  if (new Set(keys).size !== keys.length) throw new Error('Ambiguous source UV triangles; refuse anatomy transfer');
  return keys;
}

export function buildManifest(source, bytes) {
  const parsed = parseSource(source);
  if (createHash('sha256').update(bytes).digest('hex') !== parsed.sha256) throw new Error('Hero source hash does not match supervised regions');
  return {
    schema: 'galaquest.hero-anatomy-regions',
    schemaVersion: 2,
    sourceModule: SOURCE,
    heroAssetPath: parsed.assetPath,
    heroSha256: parsed.sha256,
    triangleCount: parsed.triangleCount,
    uvQuantization: 100000,
    sourceTriangleUvKeys: triangleUvKeys(bytes, parsed.triangleCount),
    note: 'Supervised source regions transferred by a unique complete UV-triangle correspondence. Face order and winding may change; missing/ambiguous correspondence rejects. Source mesh, rig, and texture are unchanged.',
    regions: Object.fromEntries(Object.entries(parsed.regions).map(([name, faces]) => [name, { faceCount: faces.length, faces }])),
  };
}

function main(argv) {
  const outIndex = argv.indexOf('--out');
  const out = outIndex >= 0 ? argv[outIndex + 1] : DEFAULT_OUT;
  const source = readFileSync(SOURCE, 'utf8');
  const parsed = parseSource(source);
  const manifest = buildManifest(source, readFileSync(`public/${parsed.assetPath.replace(/^\//, '')}`));

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);

  const summary = Object.entries(parsed.regions)
    .map(([name, faces]) => `${name}=${faces.length}`)
    .join(', ');
  process.stdout.write(`Wrote ${out} (${parsed.triangleCount} triangles; ${summary}).\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
