#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function parseGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error(`${file}: not a binary glTF (.glb)`);
  }
  const version = buf.readUInt32LE(4);
  const declaredLength = buf.readUInt32LE(8);
  if (version !== 2) throw new Error(`${file}: unsupported glTF version ${version}`);
  if (declaredLength !== buf.length) throw new Error(`${file}: GLB length header ${declaredLength} != ${buf.length}`);
  let offset = 12;
  let gltf = null;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    offset += 8;
    const end = offset + length;
    if (end > buf.length) throw new Error(`${file}: truncated GLB chunk`);
    if (type === 0x4e4f534a) {
      gltf = JSON.parse(buf.toString('utf8', offset, end).replace(/[\u0000\u0020]+$/u, ''));
    }
    offset = end;
  }
  if (!gltf) throw new Error(`${file}: missing JSON chunk`);
  return { buf, gltf };
}

function primitiveTriangles(gltf, primitive) {
  const mode = primitive.mode ?? 4; // TRIANGLES
  if (mode !== 4) return null;
  if (primitive.indices !== undefined) {
    const count = gltf.accessors?.[primitive.indices]?.count;
    return Number.isInteger(count) ? Math.floor(count / 3) : null;
  }
  const positionAccessor = primitive.attributes?.POSITION;
  const count = gltf.accessors?.[positionAccessor]?.count;
  return Number.isInteger(count) ? Math.floor(count / 3) : null;
}

function report(file) {
  const { buf, gltf } = parseGlb(file);
  const primitives = (gltf.meshes ?? []).flatMap((mesh, meshIndex) =>
    (mesh.primitives ?? []).map((primitive, primitiveIndex) => ({ meshIndex, primitiveIndex, primitive })),
  );
  const triangleCounts = primitives.map(({ primitive }) => primitiveTriangles(gltf, primitive));
  const knownTriangles = triangleCounts.filter(Number.isInteger).reduce((sum, value) => sum + value, 0);
  const unknownTrianglePrimitives = triangleCounts.filter((value) => value === null).length;
  const positionAccessors = primitives
    .map(({ primitive }) => primitive.attributes?.POSITION)
    .filter((value) => Number.isInteger(value));
  const vertices = positionAccessors.reduce(
    (sum, accessorIndex) => sum + (gltf.accessors?.[accessorIndex]?.count ?? 0),
    0,
  );
  const materialFlags = (gltf.materials ?? []).map((material, index) => {
    const pbr = material.pbrMetallicRoughness ?? {};
    const emissive = material.emissiveFactor ?? [0, 0, 0];
    return {
      index,
      name: material.name ?? null,
      metallicFactor: pbr.metallicFactor ?? 1,
      roughnessFactor: pbr.roughnessFactor ?? 1,
      emissiveFactor: emissive,
      suspiciousEmissive: emissive.some((value) => Number(value) > 0.001),
    };
  });
  return {
    file,
    bytes: buf.length,
    generator: gltf.asset?.generator ?? null,
    meshes: gltf.meshes?.length ?? 0,
    primitives: primitives.length,
    triangles: knownTriangles,
    unknownTrianglePrimitives,
    vertices,
    skins: gltf.skins?.length ?? 0,
    joints: Math.max(0, ...(gltf.skins ?? []).map((skin) => skin.joints?.length ?? 0)),
    animations: (gltf.animations ?? []).map((animation) => animation.name ?? '(unnamed)'),
    materials: materialFlags,
    images: (gltf.images ?? []).length,
    textures: (gltf.textures ?? []).length,
    meshDetails: primitives.map(({ meshIndex, primitiveIndex, primitive }, index) => ({
      meshIndex,
      meshName: gltf.meshes?.[meshIndex]?.name ?? null,
      primitiveIndex,
      triangles: triangleCounts[index],
      attributes: Object.keys(primitive.attributes ?? {}),
      material: primitive.material ?? null,
    })),
  };
}

function humanRow(r) {
  const emissive = r.materials.filter((m) => m.suspiciousEmissive).length;
  return [
    path.basename(r.file),
    `${(r.bytes / 1024 / 1024).toFixed(2)} MiB`,
    `${r.triangles.toLocaleString()} tris`,
    `${r.vertices.toLocaleString()} verts`,
    `${r.meshes} mesh / ${r.primitives} prim`,
    `${r.skins} skin / ${r.joints} joints`,
    `${r.animations.length} anim`,
    `${r.materials.length} mat${emissive ? ` (${emissive} emissive!)` : ''}`,
  ].join('\t');
}

const args = process.argv.slice(2);
const json = args[0] === '--json';
const files = json ? args.slice(1) : args;
if (!files.length) {
  console.error('usage: node tools/assets/glb-intake-report.mjs [--json] <asset.glb> [...]');
  process.exit(2);
}
try {
  const reports = files.map((file) => report(path.resolve(file)));
  if (json) console.log(JSON.stringify(reports, null, 2));
  else for (const r of reports) console.log(humanRow(r));
} catch (error) {
  console.error(error?.stack ?? String(error));
  process.exit(1);
}
