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
// The map is face-INDEX data against a specific triangle order. Whether that order survives the
// GLB -> Blender -> FBX -> Unity conversion is not assumed here; the Unity side validates the triangle
// count and the result is judged by looking at it.
//
// Usage:
//   node tools/unity-migration/export-hero-anatomy-regions.mjs [--out <path>]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

function main(argv) {
  const outIndex = argv.indexOf('--out');
  const out = outIndex >= 0 ? argv[outIndex + 1] : DEFAULT_OUT;

  const parsed = parseSource(readFileSync(SOURCE, 'utf8'));

  const manifest = {
    schema: 'galaquest.hero-anatomy-regions',
    schemaVersion: 1,
    // No timestamp: the same source must export byte-identically.
    sourceModule: SOURCE,
    heroAssetPath: parsed.assetPath,
    heroSha256: parsed.sha256,
    triangleCount: parsed.triangleCount,
    note:
      'Face-index data against the shipping GLB triangle order. Unity uses it to PREVIEW hidden '
      + 'anatomy in the Gear Workbench; it is not the runtime equip system, and it is only valid while '
      + 'the Unity derivative preserves the source triangle order.',
    regions: Object.fromEntries(
      Object.entries(parsed.regions).map(([name, faces]) => [name, { faceCount: faces.length, faces }]),
    ),
  };

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
