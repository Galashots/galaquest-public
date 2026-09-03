import { readFileSync } from 'node:fs';

const JSON_CHUNK_MAGIC = 0x4e4f534a;

export function readGlbJson(filePath) {
  const bytes = readFileSync(filePath);
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
    throw new Error(`${filePath}: expected a version-2 binary glTF container`);
  }
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== JSON_CHUNK_MAGIC) {
    throw new Error(`${filePath}: first GLB chunk is not JSON`);
  }
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
}

function sourceBounds(document) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let found = false;
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const positionAccessor = document.accessors?.[primitive.attributes?.POSITION];
      if (!positionAccessor?.min || !positionAccessor?.max) continue;
      found = true;
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], positionAccessor.min[axis]);
        max[axis] = Math.max(max[axis], positionAccessor.max[axis]);
      }
    }
  }
  return found ? { min, max, size: max.map((value, axis) => value - min[axis]) } : null;
}

export function inspectSourceGlb(filePath) {
  const document = readGlbJson(filePath);
  const nodes = document.nodes ?? [];
  const skins = document.skins ?? [];
  const animations = (document.animations ?? []).map((animation) => {
    let duration = 0;
    const drivenNodes = new Set();
    for (const channel of animation.channels ?? []) {
      const sampler = animation.samplers?.[channel.sampler];
      const inputAccessor = document.accessors?.[sampler?.input];
      duration = Math.max(duration, inputAccessor?.max?.[0] ?? 0);
      if (channel.target?.node != null) drivenNodes.add(channel.target.node);
    }
    return {
      name: animation.name ?? null,
      duration,
      channelCount: (animation.channels ?? []).length,
      drivenNodeCount: drivenNodes.size,
    };
  });

  return {
    nodeCount: nodes.length,
    meshCount: (document.meshes ?? []).length,
    primitiveCount: (document.meshes ?? []).reduce((sum, mesh) => sum + (mesh.primitives ?? []).length, 0),
    materialCount: (document.materials ?? []).length,
    imageCount: (document.images ?? []).length,
    imageMimeTypes: (document.images ?? []).map(image => image.mimeType ?? null),
    skinCount: skins.length,
    jointCount: skins.reduce((sum, skin) => sum + (skin.joints ?? []).length, 0),
    bounds: sourceBounds(document),
    animations,
  };
}
