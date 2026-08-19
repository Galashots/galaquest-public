/**
 * Build a REAL three.js node hierarchy and REAL AnimationClips out of a GLB, in plain Node.
 *
 * WHY THIS EXISTS. AP1 had to characterise a hero attack defect that only shows up when three
 * independent AnimationMixers write the same bones (locomotion, reactions, swing). That is mixer
 * machinery, not rendering machinery, so it can be reproduced without a browser -- but only against
 * the REAL clips, because the defect depends on what a track actually holds frame to frame.
 * `GLTFLoader` cannot run here: it reaches for ImageBitmap/HTMLImageElement to decode the atlas, and
 * the atlas is irrelevant to a question about bone transforms.
 *
 * So this reads the glTF JSON chunk and the BIN chunk directly and builds only the two things a
 * mixer needs: the node graph with its rest TRS, and the animation tracks. No meshes, no materials,
 * no textures. What it returns is bindable by `THREE.AnimationMixer` exactly as GLTFLoader's output
 * is, because three binds tracks to nodes BY NAME (`PropertyBinding`) and the names are preserved.
 *
 * SCOPE, stated so nobody mistakes this for a loader: it is a diagnostic instrument. It does not
 * load geometry, and a pose measured through it is a claim about the SKELETON, never about how the
 * game looks. AGENTS.md's rule stands -- a visual claim comes from the running game.
 */

import { readFileSync } from 'node:fs';
import * as THREE from '../../public/vendor/three.module.min.js';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

const COMPONENT = {
  5120: { array: Int8Array, denom: 127 },
  5121: { array: Uint8Array, denom: 255 },
  5122: { array: Int16Array, denom: 32767 },
  5123: { array: Uint16Array, denom: 65535 },
  5125: { array: Uint32Array, denom: 4294967295 },
  5126: { array: Float32Array, denom: 1 },
};

const COMPONENTS_PER = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Split a GLB into its JSON and BIN chunks. */
export function readGlbChunks(path) {
  const bytes = readFileSync(path);
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${path}: not a GLB`);
  let json = null;
  let bin = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(body.toString('utf8'));
    else if (type === BIN_CHUNK) bin = body;
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error(`${path}: no JSON chunk`);
  return { json, bin };
}

/**
 * Read one accessor as a plain Float32Array, de-interleaving a strided bufferView and un-normalising
 * integer component types. Sparse accessors are refused rather than silently half-read -- Meshy has
 * never emitted one here, and a wrong animation track is worse than a stopped tool.
 */
export function readAccessor(json, bin, index) {
  const accessor = json.accessors[index];
  if (accessor.sparse) throw new Error(`accessor ${index}: sparse accessors are not supported`);
  const spec = COMPONENT[accessor.componentType];
  if (!spec) throw new Error(`accessor ${index}: unknown componentType ${accessor.componentType}`);
  const perElement = COMPONENTS_PER[accessor.type];
  if (!perElement) throw new Error(`accessor ${index}: unknown type ${accessor.type}`);

  const out = new Float32Array(accessor.count * perElement);
  if (accessor.bufferView === undefined) return out; // spec-legal all-zero accessor

  const view = json.bufferViews[accessor.bufferView];
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const elementBytes = spec.array.BYTES_PER_ELEMENT;
  const stride = view.byteStride ?? perElement * elementBytes;

  for (let i = 0; i < accessor.count; i += 1) {
    const start = base + i * stride;
    // Copy each element out of the (possibly unaligned) chunk before viewing it as a typed array:
    // `bin` is a Node Buffer over the whole file, so byteOffset is rarely a multiple of 4 and a
    // direct typed-array view throws "start offset must be a multiple of N".
    const slice = Buffer.from(bin.buffer, bin.byteOffset + start, perElement * elementBytes);
    const typed = new spec.array(new Uint8Array(slice).buffer);
    for (let c = 0; c < perElement; c += 1) {
      const raw = typed[c];
      out[i * perElement + c] = accessor.normalized ? Math.max(raw / spec.denom, -1) : raw;
    }
  }
  return out;
}

/**
 * The node graph, as three.js Object3Ds carrying their rest TRS.
 *
 * Every node becomes a plain Object3D rather than a Bone. A mixer binds by name and property and
 * never asks what class the target is, and using Bone would imply a Skeleton this file deliberately
 * does not build.
 */
export function buildNodes(json) {
  const objects = json.nodes.map((node, index) => {
    const object = new THREE.Object3D();
    object.name = THREE.PropertyBinding.sanitizeNodeName(node.name ?? `node_${index}`);
    if (node.matrix) {
      const matrix = new THREE.Matrix4().fromArray(node.matrix);
      matrix.decompose(object.position, object.quaternion, object.scale);
    } else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    return object;
  });
  json.nodes.forEach((node, index) => {
    for (const child of node.children ?? []) objects[index].add(objects[child]);
  });
  return objects;
}

/** glTF interpolation -> three.js. CUBICSPLINE is refused: it needs GLTFLoader's own interpolant. */
function interpolationOf(sampler, accessorIndex) {
  switch (sampler.interpolation ?? 'LINEAR') {
    case 'LINEAR': return THREE.InterpolateLinear;
    case 'STEP': return THREE.InterpolateDiscrete;
    default:
      throw new Error(`sampler on accessor ${accessorIndex}: `
        + `${sampler.interpolation} interpolation is not supported by this diagnostic loader`);
  }
}

/** The animations, as three.js AnimationClips whose track names are `<nodeName>.<property>`. */
export function buildClips(json, bin, objects) {
  return (json.animations ?? []).map((animation, animationIndex) => {
    const tracks = [];
    let duration = 0;
    for (const channel of animation.channels) {
      if (channel.target.node === undefined) continue;
      const sampler = animation.samplers[channel.sampler];
      const times = readAccessor(json, bin, sampler.input);
      const values = readAccessor(json, bin, sampler.output);
      const name = objects[channel.target.node].name;
      const interpolation = interpolationOf(sampler, sampler.input);
      duration = Math.max(duration, times[times.length - 1] ?? 0);

      switch (channel.target.path) {
        case 'translation':
          tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, times, values, interpolation));
          break;
        case 'rotation':
          tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values, interpolation));
          break;
        case 'scale':
          tracks.push(new THREE.VectorKeyframeTrack(`${name}.scale`, times, values, interpolation));
          break;
        default:
          break; // weights: this rig has no morph targets
      }
    }
    return new THREE.AnimationClip(animation.name ?? `clip_${animationIndex}`, duration, tracks);
  });
}

/**
 * The whole thing: a root whose subtree a mixer can drive, and the clips to drive it with.
 *
 * `root` mirrors what `hero.js` hands the animators -- glTF's default scene, one Object3D deep --
 * so the three character modules bind exactly as they do in the game.
 */
export function loadRigScene(path) {
  const { json, bin } = readGlbChunks(path);
  if (!bin) throw new Error(`${path}: no BIN chunk`);
  const objects = buildNodes(json);
  const scene = json.scenes[json.scene ?? 0];
  const root = new THREE.Object3D();
  root.name = 'hero';
  for (const index of scene.nodes) root.add(objects[index]);
  const animations = buildClips(json, bin, objects);
  const jointNames = (json.skins?.[0]?.joints ?? []).map((index) => objects[index].name);
  return { root, animations, objects, jointNames, json };
}
