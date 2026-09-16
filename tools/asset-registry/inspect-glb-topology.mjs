#!/usr/bin/env node
// OPT-IN standalone GLB topology diagnostic. Not part of automatic
// inspect-glb/registry scanning: it reads raw position/index bytes and is
// only run when explicitly invoked, so it never slows every asset read and
// changes no gameplay contract.
//
// What it does: exact-position-welded undirected edge multiplicity over one
// indexed TRIANGLES primitive (boundary / manifold / non-manifold counts),
// degenerate-triangle count, and explicit UNKNOWN for anything outside the
// supported scope. Analysis only: source bytes are never welded or modified.
//
// Supported scope (deliberately narrow): exactly one mesh with exactly one
// primitive, indexed TRIANGLES (mode 4), FLOAT VEC3 positions, resident BIN
// chunk. Everything else (multi-mesh/primitive, non-indexed, non-triangle
// modes, sparse accessors, meshopt/draco compression, external buffers)
// reports UNKNOWN with a reason rather than pretending zero defects.
// Malformed, truncated, out-of-range, or non-finite data throws.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const GLB_MAGIC = 0x46546c67;
const GLTF_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

const TRIANGLES_MODE = 4;
const FLOAT_COMPONENT = 5126;
const INDEX_BYTE_SIZE = new Map([[5121, 1], [5123, 2], [5125, 4]]);

export const TOPOLOGY_SCOPE_NOTE =
  'Primitive-local scope: counts cover mesh 0 / primitive 0 only. ' +
  'Supported input is single-mesh / single-primitive indexed TRIANGLES. ' +
  'Anything else reports UNKNOWN with a reason; this tool is not an importer framework.';
export const CLOSEDNESS_NOTE =
  'Closedness describes edge incidence, NOT solidity or artistic acceptance. ' +
  'A CLOSED result says every welded edge is shared by exactly two triangles; ' +
  'it says nothing about normals, UVs, materials, silhouette, or visual quality.';

// Internal signal for "answer honestly UNKNOWN" (vs malformed input, which throws).
class UnknownTopology extends Error {}

function readContainer(path, bytes) {
  if (bytes.length < 12) throw new Error(`${path}: malformed GLB (file shorter than 12-byte header)`);
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${path}: not GLB (bad magic)`);
  const version = bytes.readUInt32LE(4);
  if (version !== GLTF_VERSION) throw new Error(`${path}: expected glTF 2, got version ${version}`);
  const declaredLength = bytes.readUInt32LE(8);
  if (declaredLength !== bytes.length) {
    throw new Error(`${path}: malformed/truncated GLB (header length ${declaredLength} != file size ${bytes.length})`);
  }
  if (bytes.length < 20) throw new Error(`${path}: malformed GLB (missing JSON chunk header)`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== JSON_CHUNK_TYPE) throw new Error(`${path}: malformed GLB (first chunk is not JSON)`);
  if (20 + jsonLength > bytes.length) throw new Error(`${path}: malformed/truncated GLB (JSON chunk exceeds file)`);
  let document;
  try {
    document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  } catch {
    throw new Error(`${path}: malformed GLB (JSON chunk is not valid JSON)`);
  }
  let bin = Buffer.alloc(0);
  let offset = 20 + jsonLength;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error(`${path}: malformed/truncated GLB (truncated chunk header)`);
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + length > bytes.length) throw new Error(`${path}: malformed/truncated GLB (chunk exceeds file)`);
    if (type === BIN_CHUNK_TYPE && bin.length === 0) bin = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length;
  }
  return { document, bin };
}

export function inspectGlbTopology(path) {
  const bytes = readFileSync(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const { document: gltf, bin } = readContainer(path, bytes);
  const base = { file: basename(path), byte_size: bytes.length, sha256 };
  const meshes = gltf.meshes ?? [];
  const primitiveCount = meshes.reduce((n, mesh) => n + ((mesh.primitives ?? []).length), 0);
  const scope = {
    meshCount: meshes.length,
    primitiveCount,
    mesh: 0,
    primitive: 0,
    primitiveLocal: true,
    note: TOPOLOGY_SCOPE_NOTE,
  };
  const unknown = (reason) => ({
    ...base, supported: false, status: 'UNKNOWN', unknownReason: reason, scope, closednessNote: CLOSEDNESS_NOTE,
  });
  try {
    if (meshes.length !== 1) {
      throw new UnknownTopology(
        `supported scope is one mesh with one primitive; file declares ${meshes.length} meshes`,
      );
    }
    const primitives = meshes[0].primitives ?? [];
    if (primitives.length !== 1) {
      throw new UnknownTopology(
        `supported scope is one mesh with one primitive; mesh 0 declares ${primitives.length} primitives`,
      );
    }
    const primitive = primitives[0];
    const mode = primitive.mode ?? TRIANGLES_MODE;
    if (mode !== TRIANGLES_MODE) {
      throw new UnknownTopology(`unsupported primitive mode ${mode}; only indexed TRIANGLES (mode 4) is supported`);
    }
    if (primitive.indices === undefined) {
      throw new UnknownTopology('unsupported topology: primitive has no indices (non-indexed); only indexed TRIANGLES is supported');
    }
    if (primitive.extensions?.KHR_draco_mesh_compression) {
      throw new UnknownTopology('unsupported: KHR_draco_mesh_compression; compressed topology cannot be edge-counted from raw bytes');
    }

    const accessors = gltf.accessors ?? [];
    const bufferViews = gltf.bufferViews ?? [];
    const buffers = gltf.buffers ?? [];
    const positionRef = primitive.attributes?.POSITION;
    if (positionRef === undefined) throw new UnknownTopology('unsupported topology: primitive has no POSITION attribute');
    const pos = accessors[positionRef];
    const idx = accessors[primitive.indices];
    if (pos === undefined || idx === undefined) {
      throw new Error(`${path}: malformed glTF (POSITION or indices accessor index out of range)`);
    }
    for (const [accessor, name] of [[pos, 'POSITION'], [idx, 'indices']]) {
      if (accessor.sparse !== undefined) {
        throw new UnknownTopology(`unsupported: sparse ${name} accessor; sparse topology reports UNKNOWN, never zero defects`);
      }
      if (accessor.bufferView === undefined) {
        throw new UnknownTopology(`unsupported: ${name} accessor has no bufferView`);
      }
    }
    if (pos.componentType !== FLOAT_COMPONENT) {
      throw new UnknownTopology(`unsupported: POSITION componentType ${pos.componentType}; only FLOAT (5126) is supported`);
    }
    if (pos.type !== 'VEC3') throw new Error(`${path}: malformed glTF (POSITION accessor type ${pos.type}, expected VEC3)`);
    if (idx.type !== 'SCALAR') throw new Error(`${path}: malformed glTF (indices accessor type ${idx.type}, expected SCALAR)`);
    const indexSize = INDEX_BYTE_SIZE.get(idx.componentType);
    if (indexSize === undefined) {
      throw new Error(`${path}: malformed glTF (indices componentType ${idx.componentType} is not a valid index type)`);
    }
    if (!Number.isInteger(pos.count) || pos.count <= 0) {
      throw new Error(`${path}: malformed glTF (POSITION count ${pos.count})`);
    }
    if (!Number.isInteger(idx.count) || idx.count <= 0) {
      throw new Error(`${path}: malformed glTF (indices count ${idx.count})`);
    }
    if (idx.count % 3 !== 0) {
      throw new Error(`${path}: malformed glTF (indices count ${idx.count} is not a multiple of 3 for TRIANGLES)`);
    }

    // Resolve one accessor's byte range against its view and the BIN chunk.
    // Returns the view's absolute start plus the accessor-relative stride/count.
    const resolveRange = (kind, accessor, elementBytes, stride) => {
      const view = bufferViews[accessor.bufferView];
      if (view === undefined) throw new Error(`${path}: malformed glTF (${kind} bufferView ${accessor.bufferView} out of range)`);
      if (view.extensions?.EXT_meshopt_compression) {
        throw new UnknownTopology(`unsupported: EXT_meshopt_compression on ${kind} bufferView; compressed data reports UNKNOWN`);
      }
      const buffer = buffers[view.buffer ?? 0];
      if (buffer === undefined) throw new Error(`${path}: malformed glTF (${kind} buffer index out of range)`);
      if (buffer.uri !== undefined) {
        throw new UnknownTopology(`unsupported: external buffer for ${kind}; only the resident GLB BIN chunk is supported`);
      }
      if ((view.buffer ?? 0) !== 0) throw new UnknownTopology('unsupported: only GLB resident buffer 0 is supported');
      const viewStart = view.byteOffset ?? 0;
      if (!Number.isSafeInteger(viewStart) || viewStart < 0) throw new Error(`${path}: malformed bufferView byteOffset`);
      if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0 || buffer.byteLength > bin.length) throw new Error(`${path}: malformed/truncated buffer byteLength`);
      const viewLength = view.byteLength;
      if (!Number.isInteger(viewLength) || viewLength < 0) {
        throw new Error(`${path}: malformed glTF (${kind} bufferView byteLength ${viewLength})`);
      }
      if (viewStart + viewLength > buffer.byteLength) throw new Error(`${path}: malformed/truncated bufferView exceeds declared buffer`);
      const accessorOffset = accessor.byteOffset ?? 0;
      if (!Number.isInteger(accessorOffset) || accessorOffset < 0) {
        throw new Error(`${path}: malformed glTF (${kind} accessor byteOffset ${accessorOffset})`);
      }
      const need = (accessor.count - 1) * stride + elementBytes;
      if (accessorOffset + need > viewLength) {
        throw new Error(`${path}: malformed/truncated glTF (${kind} accessor range exceeds bufferView byteLength)`);
      }
      if (viewStart + accessorOffset + need > bin.length) {
        throw new Error(`${path}: malformed/truncated glTF (${kind} bytes exceed BIN chunk)`);
      }
      return { absolute: viewStart + accessorOffset, stride };
    };

    const posView = bufferViews[pos.bufferView];
    if (posView === undefined) throw new Error(`${path}: malformed glTF (POSITION bufferView out of range)`);
    const posStride = posView.byteStride ?? 12;
    if (!Number.isInteger(posStride) || posStride < 12 || posStride % 4 !== 0) {
      throw new Error(`${path}: malformed glTF (POSITION byteStride ${posView.byteStride})`);
    }
    const posRange = resolveRange('POSITION', pos, 12, posStride);
    const idxRange = resolveRange('indices', idx, indexSize, indexSize);

    const positions = new Float64Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) {
      const o = posRange.absolute + i * posRange.stride;
      const x = bin.readFloatLE(o);
      const y = bin.readFloatLE(o + 4);
      const z = bin.readFloatLE(o + 8);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(`${path}: non-finite POSITION at vertex ${i} (analysis refuses to weld NaN/Infinity)`);
      }
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }

    const readIndex = indexSize === 1
      ? (o) => bin.readUInt8(o)
      : indexSize === 2
        ? (o) => bin.readUInt16LE(o)
        : (o) => bin.readUInt32LE(o);
    const indices = new Uint32Array(idx.count);
    for (let i = 0; i < idx.count; i += 1) {
      const v = readIndex(idxRange.absolute + i * idxRange.stride);
      if (v >= pos.count) throw new Error(`${path}: index out of range (indices[${i}] = ${v}, vertex count ${pos.count})`);
      indices[i] = v;
    }

    // Exact-position weld (analysis only): float32 identity, with signed zero canonicalized.
    const f32 = new Float32Array(1);
    const u32 = new Uint32Array(f32.buffer);
    const bitsOf = (v) => {
      if (v === 0) return '0'; // Signed zero denotes the same geometric coordinate.
      f32[0] = v;
      return u32[0].toString(16);
    };
    const weldIds = new Uint32Array(pos.count);
    const weldMap = new Map();
    let uniquePositions = 0;
    for (let i = 0; i < pos.count; i += 1) {
      const key = `${bitsOf(positions[i * 3])},${bitsOf(positions[i * 3 + 1])},${bitsOf(positions[i * 3 + 2])}`;
      let id = weldMap.get(key);
      if (id === undefined) {
        id = uniquePositions;
        uniquePositions += 1;
        weldMap.set(key, id);
      }
      weldIds[i] = id;
    }

    // Edge multiplicity over non-degenerate triangles. A triangle is
    // degenerate when its area is zero or two corners weld to the same exact position (covers
    // both repeated indices and duplicated positions); degenerate triangles
    // are counted separately and excluded from edge multiplicity.
    const triangleCount = idx.count / 3;
    let degenerateTriangles = 0;
    const edgeUses = new Map();
    for (let t = 0; t < triangleCount; t += 1) {
      const wa = weldIds[indices[t * 3]];
      const wb = weldIds[indices[t * 3 + 1]];
      const wc = weldIds[indices[t * 3 + 2]];
      const ia = indices[t * 3] * 3, ib = indices[t * 3 + 1] * 3, ic = indices[t * 3 + 2] * 3;
      const ux = positions[ib] - positions[ia], uy = positions[ib + 1] - positions[ia + 1], uz = positions[ib + 2] - positions[ia + 2];
      const vx = positions[ic] - positions[ia], vy = positions[ic + 1] - positions[ia + 1], vz = positions[ic + 2] - positions[ia + 2];
      const zeroArea = uy * vz - uz * vy === 0 && uz * vx - ux * vz === 0 && ux * vy - uy * vx === 0;
      if (wa === wb || wb === wc || wa === wc || zeroArea) {
        degenerateTriangles += 1;
        continue;
      }
      for (const [p, q] of [[wa, wb], [wb, wc], [wa, wc]]) {
        const lo = Math.min(p, q);
        const hi = Math.max(p, q);
        const key = `${lo}:${hi}`;
        edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1);
      }
    }
    let boundaryEdges = 0;
    let manifoldEdges = 0;
    let nonmanifoldEdges = 0;
    for (const uses of edgeUses.values()) {
      if (uses === 1) boundaryEdges += 1;
      else if (uses === 2) manifoldEdges += 1;
      else nonmanifoldEdges += 1;
    }
    const closed = boundaryEdges === 0 && nonmanifoldEdges === 0 && degenerateTriangles === 0;
    return {
      ...base,
      supported: true,
      status: degenerateTriangles > 0 ? 'DEGENERATE' : closed ? 'CLOSED' : 'OPEN',
      scope,
      closednessNote: CLOSEDNESS_NOTE,
      weld: 'exact-position (float32, signed-zero canonicalized) undirected edge multiplicity; source bytes never modified',
      counts: {
        vertices: pos.count,
        triangles: triangleCount,
        degenerateTriangles,
        uniquePositions,
        uniqueEdges: edgeUses.size,
        manifoldEdges,
        boundaryEdges,
        nonmanifoldEdges,
      },
    };
  } catch (error) {
    if (error instanceof UnknownTopology) return unknown(error.message);
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error('usage: node tools/asset-registry/inspect-glb-topology.mjs <file.glb> [more.glb ...]');
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(paths.map(inspectGlbTopology), null, 2));
  } catch (error) {
    console.error(`inspect-glb-topology: ${error.message}`);
    process.exit(1);
  }
}
