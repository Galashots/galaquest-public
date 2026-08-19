// Measures a raw Meshy prop candidate against exactly what Sol's Rowan-camp scoping ruling asked
// for (2026-08-16): triangles, draw calls/materials, texture dimensions/payload, bounds/scale,
// pivot/grounding. A SCOPING instrument, not a shipping gate -- glb_budget.mjs's hero_contract.json
// thresholds do not apply to an arbitrary prop candidate that has not even been recompressed yet.
//
//   node tools/foundry/inspect_prop_candidate.mjs <file.glb> [more.glb ...]
//
// Reads the GLB's own JSON chunk directly (iron rule 7, docs/pipeline/README.md): Blender's glTF
// importer fabricates geometry that is not in the file, and a phantom mesh was reported as a real
// defect on that basis once. Never import these into Blender to "just take a quick look" -- render
// via tools/blender/render_npc.py or an in-game capture instead, same as every other candidate this
// phase has judged.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

function parseGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8; // skip the json chunk header + this chunk's own 8-byte header
  return { json, bin: buf.subarray(binStart), totalBytes: buf.length };
}

/** Pixel dimensions straight from the image's own header, not from any texture that claims a size. */
function imageSize(bytes) {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { kind: 'png', w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length - 9) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { kind: 'jpeg', h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
      }
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  }
  return { kind: 'unknown', w: 0, h: 0 };
}

function mul(a, b) { // column-major 4x4, a*b -- same convention measure_props.mjs already uses
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
    let s = 0;
    for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function nodeMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const rot = [
    (1 - 2 * y * y - 2 * z * z) * sx, (2 * x * y + 2 * z * w) * sx, (2 * x * z - 2 * y * w) * sx, 0,
    (2 * x * y - 2 * z * w) * sy, (1 - 2 * x * x - 2 * z * z) * sy, (2 * y * z + 2 * x * w) * sy, 0,
    (2 * x * z + 2 * y * w) * sz, (2 * y * z - 2 * x * w) * sz, (1 - 2 * x * x - 2 * y * y) * sz, 0,
    tx, ty, tz, 1,
  ];
  return rot;
}

function transformPoint(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function accessorMinMax(g, accIdx) {
  const acc = g.accessors[accIdx];
  return { min: acc.min, max: acc.max };
}

function report(path) {
  const glb = readFileSync(path);
  const { json: g } = parseGLB(glb);

  let triangles = 0;
  let primitives = 0;
  const materialsUsed = new Set();
  for (const mesh of g.meshes ?? []) {
    for (const prim of mesh.primitives) {
      primitives += 1;
      if (prim.material !== undefined) materialsUsed.add(prim.material);
      const acc = g.accessors[prim.indices];
      if (acc) triangles += acc.count / 3;
      else {
        // No index accessor: draw-as-triangles from POSITION count (rare, but a Meshy export could).
        const posAcc = g.accessors[prim.attributes.POSITION];
        if (posAcc) triangles += posAcc.count / 3;
      }
    }
  }

  // World bounds: walk every node with a mesh, accumulate its matrix from the scene root, transform
  // each primitive's own POSITION accessor min/max corners (same technique measure_props.mjs uses).
  const parentOf = new Map();
  const nodes = g.nodes ?? [];
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
  const worldMatrixCache = new Map();
  function worldMatrix(idx) {
    if (worldMatrixCache.has(idx)) return worldMatrixCache.get(idx);
    const local = nodeMatrix(nodes[idx]);
    const parent = parentOf.get(idx);
    const world = parent === undefined ? local : mul(worldMatrix(parent), local);
    worldMatrixCache.set(idx, world);
    return world;
  }

  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  nodes.forEach((n, idx) => {
    if (n.mesh === undefined) return;
    const m = worldMatrix(idx);
    for (const prim of g.meshes[n.mesh].primitives) {
      const { min: bmin, max: bmax } = accessorMinMax(g, prim.attributes.POSITION);
      // All 8 corners of the local AABB, since a rotation can turn a min/max corner pair into a
      // NON-corner of the world-space box if only those two points are transformed directly.
      for (const cx of [bmin[0], bmax[0]]) for (const cy of [bmin[1], bmax[1]]) for (const cz of [bmin[2], bmax[2]]) {
        const [wx, wy, wz] = transformPoint(m, [cx, cy, cz]);
        min = [Math.min(min[0], wx), Math.min(min[1], wy), Math.min(min[2], wz)];
        max = [Math.max(max[0], wx), Math.max(max[1], wy), Math.max(max[2], wz)];
      }
    }
  });

  const images = (g.images ?? []).map((img, i) => {
    let bytes;
    if (img.bufferView !== undefined) {
      const bv = g.bufferViews[img.bufferView];
      // byteOffset is OPTIONAL per the glTF spec (defaults to 0, meaning "the start of the
      // buffer") -- omitting the `?? 0` here silently produced a NaN offset and an empty read for
      // this exact case, on every one of these three candidates' own base_color texture.
      const byteOffset = bv.byteOffset ?? 0;
      const binChunkStart = 20 + readGLBJsonLen(glb) + 8;
      bytes = glb.subarray(binChunkStart + byteOffset, binChunkStart + byteOffset + bv.byteLength);
    } else {
      return { index: i, kind: 'external-uri', bytes: 0, w: 0, h: 0 };
    }
    const { kind, w, h } = imageSize(bytes);
    return { index: i, name: img.name ?? '(unnamed)', kind, bytes: bytes.length, w, h };
  });

  return {
    file: basename(path),
    totalBytes: glb.length,
    triangles: Math.round(triangles),
    primitives,
    meshes: (g.meshes ?? []).length,
    materials: (g.materials ?? []).length,
    materialsActuallyUsed: materialsUsed.size,
    nodes: nodes.length,
    hasSkin: (g.skins ?? []).length > 0,
    hasAnimation: (g.animations ?? []).length > 0,
    images,
    bounds: {
      min: min.map((v) => +v.toFixed(4)),
      max: max.map((v) => +v.toFixed(4)),
      size: [0, 1, 2].map((i) => +(max[i] - min[i]).toFixed(4)),
      // Grounding: does the mesh's own lowest point sit near Y=0 (a model authored to rest on the
      // ground already) or well above/below it (needs a groundOffsetY correction before placement,
      // same convention public/src/world/zoneLoader.js's groundOffsetY already exists for)?
      minY: +min[1].toFixed(4),
    },
  };
}

function readGLBJsonLen(buf) { return buf.readUInt32LE(12); }

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node tools/foundry/inspect_prop_candidate.mjs <file.glb> [more.glb ...]');
  process.exit(1);
}
for (const f of files) {
  const r = report(f);
  console.log(`\n${r.file}`);
  console.log(`  ${(r.totalBytes / 1024 / 1024).toFixed(2)} MB total`);
  console.log(`  triangles: ${r.triangles}`);
  console.log(`  draw calls (primitives): ${r.primitives}  meshes: ${r.meshes}  nodes: ${r.nodes}`);
  console.log(`  materials: ${r.materials} defined, ${r.materialsActuallyUsed} actually used by a primitive`);
  console.log(`  skin: ${r.hasSkin}  animation: ${r.hasAnimation}`);
  for (const img of r.images) {
    console.log(`  image[${img.index}] ${img.name}: ${img.kind} ${img.w}x${img.h}, ${(img.bytes / 1024).toFixed(0)} KiB`);
  }
  console.log(`  world bounds: min [${r.bounds.min}] max [${r.bounds.max}]`);
  console.log(`  size (w,h,d): [${r.bounds.size}]`);
  console.log(`  minY (grounding): ${r.bounds.minY}  ${Math.abs(r.bounds.minY) < 0.05 ? '(already rests near Y=0)' : '(needs a ground offset before placement)'}`);
}
