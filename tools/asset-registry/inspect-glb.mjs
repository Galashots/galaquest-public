#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export function inspectGlb(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not GLB`);
  if (bytes.readUInt32LE(4) !== 2) throw new Error(`${path}: expected glTF 2`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${path}: first chunk is not JSON`);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));

  let triangles = 0;
  let primitives = 0;
  let vertices = 0;
  const positionAccessors = new Set();
  const mins = [Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity];
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      primitives += 1;
      const position = gltf.accessors?.[primitive.attributes?.POSITION];
      if (position && !positionAccessors.has(primitive.attributes.POSITION)) {
        positionAccessors.add(primitive.attributes.POSITION);
        vertices += position.count;
        if (position.min && position.max) for (let axis = 0; axis < 3; axis += 1) {
          mins[axis] = Math.min(mins[axis], position.min[axis]);
          maxs[axis] = Math.max(maxs[axis], position.max[axis]);
        }
      }
      const count = primitive.indices === undefined
        ? position?.count ?? 0
        : gltf.accessors?.[primitive.indices]?.count ?? 0;
      const mode = primitive.mode ?? 4;
      triangles += mode === 4 ? count / 3 : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
    }
  }

  const names = (gltf.nodes ?? []).map((node, index) => node.name ?? `<node ${index}>`);
  const hierarchy = (gltf.nodes ?? []).map((node, index) => ({
    index,
    name: names[index],
    children: (node.children ?? []).map((child) => names[child]),
  }));
  const animations = (gltf.animations ?? []).map((animation, index) => {
    let start = Infinity;
    let end = -Infinity;
    const drivenNodes = new Set();
    for (const channel of animation.channels ?? []) {
      drivenNodes.add(names[channel.target.node]);
      const input = gltf.accessors?.[animation.samplers?.[channel.sampler]?.input];
      if (input?.min) start = Math.min(start, input.min[0]);
      if (input?.max) end = Math.max(end, input.max[0]);
    }
    return {
      name: animation.name ?? `<animation ${index}>`,
      duration_seconds: Number.isFinite(end) ? end - Math.min(start, 0) : null,
      channel_count: (animation.channels ?? []).length,
      driven_nodes: [...drivenNodes].sort(),
    };
  });

  return {
    file: basename(path),
    byte_size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    format: 'model/gltf-binary',
    asset: gltf.asset ?? {},
    bounds_accessor_local: Number.isFinite(mins[0]) ? { min: mins, max: maxs, dimensions: maxs.map((v, i) => v - mins[i]) } : null,
    mesh_count: (gltf.meshes ?? []).length,
    primitive_count: primitives,
    vertex_count_unique_position_accessors: vertices,
    triangle_count: triangles,
    material_count: (gltf.materials ?? []).length,
    images: (gltf.images ?? []).map((image, index) => ({
      index,
      name: image.name ?? null,
      mime_type: image.mimeType ?? null,
      embedded: image.bufferView !== undefined,
      byte_size: image.bufferView === undefined ? null : gltf.bufferViews?.[image.bufferView]?.byteLength ?? null,
      uri: image.uri ?? null,
    })),
    skin_count: (gltf.skins ?? []).length,
    skins: (gltf.skins ?? []).map((skin, index) => ({
      index,
      name: skin.name ?? null,
      joint_count: (skin.joints ?? []).length,
      joints: (skin.joints ?? []).map((joint) => names[joint]),
    })),
    animation_count: animations.length,
    animations,
    node_count: names.length,
    node_hierarchy: hierarchy,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error('usage: node tools/asset-registry/inspect-glb.mjs <file.glb> [more.glb ...]');
    process.exit(2);
  }
  console.log(JSON.stringify(paths.map(inspectGlb), null, 2));
}
