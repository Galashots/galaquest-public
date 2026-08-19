// What does this GLB actually cost against hero_contract.json?
//
//   node tools/budget/glb_budget.mjs <file.glb> [more.glb ...]
//
// Reads the GLB's own JSON chunk. Never imports it: Blender's glTF importer fabricates geometry
// that is not in the file, and a phantom was once reported here as a defect on that basis.
//
// Triangles are counted from index accessors, because that is what the scene budget counts and it
// is the only figure that does not depend on how some tool chose to display the mesh.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTRACT = JSON.parse(
  readFileSync(new URL('../../docs/teardown/hero_contract.json', import.meta.url), 'utf8'),
);
const { triangles: TRI, heroMaxDraws, heroPayloadMaxBytes } = CONTRACT.budgets;
const ATLAS_MAX = CONTRACT.surface.sharedAtlasMaxPx;

/** Pixel dimensions straight from the image header, so a mislabelled mime type cannot lie. */
function imageSize(bytes) {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { kind: 'png', w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length - 9) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      // SOF0..SOF15, excluding the four markers in that range that are not frame headers.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { kind: 'jpeg', h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
      }
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  }
  return { kind: 'unknown', w: 0, h: 0 };
}

function report(path) {
  const glb = readFileSync(path);
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB`);
  const jsonLen = glb.readUInt32LE(12);
  const g = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;

  let triangles = 0;
  let primitives = 0;
  for (const mesh of g.meshes ?? []) {
    for (const prim of mesh.primitives) {
      primitives += 1;
      // Non-indexed primitives count by vertex; mode 4 is TRIANGLES and is the only mode used here.
      const count = prim.indices !== undefined
        ? g.accessors[prim.indices].count
        : g.accessors[prim.attributes.POSITION].count;
      triangles += count / 3;
    }
  }

  const images = (g.images ?? []).map((img) => {
    if (img.bufferView === undefined) return { ...imageSize(Buffer.alloc(0)), bytes: 0, uri: img.uri };
    const bv = g.bufferViews[img.bufferView];
    const bytes = glb.subarray(binStart + (bv.byteOffset ?? 0), binStart + (bv.byteOffset ?? 0) + bv.byteLength);
    return { ...imageSize(bytes), bytes: bv.byteLength };
  });

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n${basename(path)}  ${glb.length.toLocaleString()} bytes`);
  console.log(`  ${pad('triangles', 22)} ${triangles.toLocaleString()}`);
  console.log(`  ${pad('primitives (draw floor)', 22)} ${primitives}`);
  console.log(`  ${pad('materials', 22)} ${(g.materials ?? []).length}`);
  console.log(`  ${pad('meshes / nodes', 22)} ${(g.meshes ?? []).length} / ${(g.nodes ?? []).length}`);
  console.log(`  ${pad('skins / joints', 22)} ${(g.skins ?? []).length} / ${(g.skins ?? []).reduce((n, s) => n + s.joints.length, 0)}`);
  console.log(`  ${pad('animations', 22)} ${(g.animations ?? []).length}${(g.animations ?? []).length ? ` (${g.animations.map((a) => a.name).join(', ')})` : ''}`);
  for (const [i, im] of images.entries()) {
    console.log(`  ${pad(`image[${i}]`, 22)} ${im.w}x${im.h} ${im.kind}, ${im.bytes.toLocaleString()} bytes`);
  }

  const verdicts = [
    ['LOD0 target', triangles <= TRI.lod0.target, `${triangles} vs ${TRI.lod0.target}`],
    ['LOD0 hard cap', triangles <= TRI.lod0.hardCap, `${triangles} vs ${TRI.lod0.hardCap}`],
    ['LOD1 target', triangles <= TRI.lod1.target, `${triangles} vs ${TRI.lod1.target}`],
    ['draws <= max', primitives <= heroMaxDraws, `${primitives} primitives vs ${heroMaxDraws} draws`],
    ['payload', glb.length <= heroPayloadMaxBytes, `${glb.length.toLocaleString()} vs ${heroPayloadMaxBytes.toLocaleString()} bytes`],
    ['atlas <= max px', images.every((im) => Math.max(im.w, im.h) <= ATLAS_MAX),
      images.map((im) => `${im.w}x${im.h}`).join(', ') || 'no images'],
    ['one atlas', images.length <= CONTRACT.surface.uniqueFullBodyTextures, `${images.length} images`],
  ];
  console.log('  --- against hero_contract.json ---');
  for (const [name, ok, detail] of verdicts) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${pad(name, 16)} ${detail}`);
  }
  return { path, triangles, primitives, bytes: glb.length, images: images.length };
}

/**
 * Score one equipped character assembled from several files.
 *
 * Sol's Q10 ruling of 2026-08-12: we budget against the WORST LEGAL RUNTIME STATE, not against
 * one file at a time. Six gear files each passing a four-draw budget individually is how a
 * six-draw character passed review.
 *
 * Two totals count instances and two count distinct files, and the difference is not cosmetic.
 * Both pauldrons are the same GLB mirrored by a negative X scale: that is two meshes drawn and
 * two lots of triangles rasterised, but one download and one texture resident on the GPU.
 * Counting bytes twice would overstate the payload; counting draws once would understate the
 * breach.
 */
export function scoreEquipped(results) {
  const distinct = new Map();
  for (const result of results) {
    if (!distinct.has(result.path)) distinct.set(result.path, result);
  }
  const unique = [...distinct.values()];

  const totals = {
    triangles: results.reduce((n, r) => n + r.triangles, 0),
    primitives: results.reduce((n, r) => n + r.primitives, 0),
    bytes: unique.reduce((n, r) => n + r.bytes, 0),
    images: unique.reduce((n, r) => n + (r.images ?? 0), 0),
    files: results.length,
    distinctFiles: unique.length,
  };

  const verdicts = [
    ['LOD0 target', totals.triangles <= TRI.lod0.target, `${totals.triangles.toLocaleString()} vs ${TRI.lod0.target.toLocaleString()}`],
    ['LOD0 hard cap', totals.triangles <= TRI.lod0.hardCap, `${totals.triangles.toLocaleString()} vs ${TRI.lod0.hardCap.toLocaleString()}`],
    ['LOD1 target', totals.triangles <= TRI.lod1.target, `${totals.triangles.toLocaleString()} vs ${TRI.lod1.target.toLocaleString()}`],
    ['LOD1 hard cap', totals.triangles <= TRI.lod1.hardCap, `${totals.triangles.toLocaleString()} vs ${TRI.lod1.hardCap.toLocaleString()}`],
    ['heroMaxDraws', totals.primitives <= heroMaxDraws, `${totals.primitives} primitives vs ${heroMaxDraws} draws`],
    // Contract version 8 re-scoped uniqueFullBodyTextures to the body alone, with each gear file
    // carrying its own single atlas, counted per file rather than in total. The scoreable rule is
    // therefore per distinct file, not a cap on the sum.
    ['one atlas per file', unique.every((r) => (r.images ?? 0) <= CONTRACT.surface.uniqueFullBodyTextures),
      `${totals.images} distinct atlases across ${unique.length} files, max ${CONTRACT.surface.uniqueFullBodyTextures} each`],
    // Scored since contract version 8. The scope this verdict used to decline is ruled (the owner,
    // 2026-08-13, the private engineering archive item 3): the cap
    // covers the whole equipped character, counted as distinct bytes.
    ['payload', totals.bytes <= heroPayloadMaxBytes, `${totals.bytes.toLocaleString()} distinct bytes vs ${heroPayloadMaxBytes.toLocaleString()}`],
  ].map(([name, ok, detail]) => ({ name, ok, detail }));

  return { totals, verdicts };
}

// Importing this module must not run the CLI: test/glb-budget.test.mjs imports scoreEquipped, and
// a bare process.exit(2) at module scope would kill the test runner before a single assertion.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('usage: node tools/budget/glb_budget.mjs <file.glb> [more.glb ...] [--as-one-character]');
    process.exit(2);
  }
  const all = files.map(report);

  if (all.length > 1) {
    // The LOD budgets are per equipped character. Summing a hero and a wolf and scoring the total
    // against them answers a question nobody asked, so the comparison is only printed when it is
    // asked for, and it is labelled with what it assumes.
    if (process.argv.includes('--as-one-character')) {
      const { totals, verdicts } = scoreEquipped(all);
      const pad = (s, n) => String(s).padEnd(n);
      console.log(`\nWORST LEGAL EQUIPPED STATE  ${totals.files} files, ${totals.distinctFiles} distinct`);
      console.log(`  ${pad('triangles', 22)} ${totals.triangles.toLocaleString()}   (every instance rasterises)`);
      console.log(`  ${pad('draw calls', 22)} ${totals.primitives}   (one per visible primitive; three.js does not batch)`);
      console.log(`  ${pad('distinct atlases', 22)} ${totals.images}`);
      console.log(`  ${pad('distinct bytes', 22)} ${totals.bytes.toLocaleString()}   (one download per file, however often worn)`);
      console.log('  --- against hero_contract.json ---');
      for (const { name, ok, detail } of verdicts) {
        console.log(`  ${ok === null ? '????' : ok ? 'PASS' : 'FAIL'}  ${pad(name, 16)} ${detail}`);
      }
    } else {
      const tri = all.reduce((n, r) => n + r.triangles, 0);
      const bytes = all.reduce((n, r) => n + r.bytes, 0);
      console.log(`\nSUM OF THE ${all.length} FILES GIVEN  ${tri.toLocaleString()} triangles, ${bytes.toLocaleString()} bytes`);
      console.log('  (pass --as-one-character to score the sum as one equipped character)');
    }
  }
}
