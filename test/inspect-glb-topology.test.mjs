import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { inspectGlbTopology } from '../tools/asset-registry/inspect-glb-topology.mjs';

// Behavioral tests with tiny synthetic GLBs (all fixtures are <= 6 vertices;
// this cap applies to artificial fixtures only, never to real-asset budgets).
// No supplied-asset answers are hard-coded here: every expectation is derived
// from the fixture construction (e.g. a tetrahedron has 6 undirected edges).

const TETRA_POSITIONS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
const TETRA_FACES = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
const INDEX_WRITERS = new Map([
  [5121, { size: 1, write: (b, o, v) => b.writeUInt8(v, o) }],
  [5123, { size: 2, write: (b, o, v) => b.writeUInt16LE(v, o) }],
  [5125, { size: 4, write: (b, o, v) => b.writeUInt32LE(v, o) }],
]);

function buildGlb(document, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(document));
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const binPadding = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPadding + 8 + bin.length + binPadding;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBytes.length + jsonPadding, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBytes.copy(out, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPadding);
  const binHeader = 20 + jsonBytes.length + jsonPadding;
  out.writeUInt32LE(bin.length + binPadding, binHeader);
  out.writeUInt32LE(0x004e4942, binHeader + 4);
  bin.copy(out, binHeader + 8);
  return out;
}

// Builds a single-primitive GLB. Options exercise the byte layout the tool
// must respect: bufferView byteOffset (prefixBytes), interleaved stride,
// accessor byteOffset (accessorLeadVertices), index component types.
function topologyGlb({
  positions,
  faces,
  indexType = 5123,
  mode = 4,
  prefixBytes = 0,
  stride = 12,
  accessorLeadVertices = 0,
  indexed = true,
  extraPrimitives = 0,
  sparse = false,
}) {
  const writer = INDEX_WRITERS.get(indexType);
  const flat = faces.flat();
  const lead = Buffer.alloc(accessorLeadVertices * stride);
  const body = Buffer.alloc(positions.length * stride);
  positions.forEach(([x, y, z], i) => {
    body.writeFloatLE(x, i * stride);
    body.writeFloatLE(y, i * stride + 4);
    body.writeFloatLE(z, i * stride + 8);
  });
  const indexBytes = Buffer.alloc(flat.length * writer.size);
  flat.forEach((v, i) => writer.write(indexBytes, i * writer.size, v));
  const prefix = Buffer.alloc(prefixBytes);
  const posViewOffset = prefix.length;
  const posByteLength = lead.length + body.length;
  const idxViewOffset = prefix.length + posByteLength;
  const bin = Buffer.concat([prefix, lead, body, indexBytes]);
  const positionAccessor = {
    bufferView: 0,
    byteOffset: lead.length,
    componentType: 5126,
    count: positions.length,
    type: 'VEC3',
  };
  if (sparse) {
    positionAccessor.sparse = {
      count: 1,
      indices: { bufferView: 1, componentType: 5123, byteOffset: 0 },
      values: { bufferView: 1, byteOffset: 0 },
    };
  }
  const document = {
    asset: { version: '2.0', generator: 'topology-fixture' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: posViewOffset, byteLength: posByteLength, ...(stride === 12 ? {} : { byteStride: stride }) },
      { buffer: 0, byteOffset: idxViewOffset, byteLength: indexBytes.length },
    ],
    accessors: [positionAccessor],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0 },
        ...(indexed ? { indices: 1 } : {}),
        ...(mode === 4 ? {} : { mode }),
      }],
    }],
  };
  if (indexed) {
    document.accessors.push({ bufferView: 1, byteOffset: 0, componentType: indexType, count: flat.length, type: 'SCALAR' });
  }
  for (let i = 0; i < extraPrimitives; i += 1) {
    document.meshes[0].primitives.push({ attributes: { POSITION: 0 }, ...(indexed ? { indices: 1 } : {}) });
  }
  return buildGlb(document, bin);
}

function withTempGlb(bytes, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'gq-glb-topology-'));
  try {
    const path = join(dir, 'fixture.glb');
    writeFileSync(path, bytes);
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('closed tetrahedron reports CLOSED with six manifold edges', () => {
  const result = withTempGlb(
    topologyGlb({ positions: TETRA_POSITIONS, faces: TETRA_FACES }),
    inspectGlbTopology,
  );
  assert.equal(result.supported, true);
  assert.equal(result.status, 'CLOSED');
  assert.deepEqual(result.counts, {
    vertices: 4,
    triangles: 4,
    degenerateTriangles: 0,
    uniquePositions: 4,
    uniqueEdges: 6,
    manifoldEdges: 6,
    boundaryEdges: 0,
    nonmanifoldEdges: 0,
  });
});

test('duplicate-position attribute seam still reports CLOSED after exact welding', () => {
  const positions = [...TETRA_POSITIONS, [0, 0, 0]];
  const faces = [[0, 2, 1], [4, 1, 3], [0, 3, 2], [1, 2, 3]];
  const result = withTempGlb(topologyGlb({ positions, faces }), inspectGlbTopology);
  assert.equal(result.supported, true);
  assert.equal(result.status, 'CLOSED');
  assert.equal(result.counts.vertices, 5);
  assert.equal(result.counts.uniquePositions, 4);
  assert.equal(result.counts.boundaryEdges, 0);
});

test('moved seam vertex reports OPEN with four boundary edges', () => {
  const positions = [...TETRA_POSITIONS, [0.001, 0, 0]];
  const faces = [[0, 2, 1], [4, 1, 3], [0, 3, 2], [1, 2, 3]];
  const result = withTempGlb(topologyGlb({ positions, faces }), inspectGlbTopology);
  assert.equal(result.supported, true);
  assert.equal(result.status, 'OPEN');
  assert.equal(result.counts.uniquePositions, 5);
  assert.equal(result.counts.boundaryEdges, 4);
  assert.equal(result.counts.nonmanifoldEdges, 0);
});

test('non-manifold edge is counted, never hidden', () => {
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]];
  const faces = [[0, 1, 2], [0, 1, 3], [0, 1, 4]];
  const result = withTempGlb(topologyGlb({ positions, faces }), inspectGlbTopology);
  assert.equal(result.supported, true);
  assert.equal(result.status, 'OPEN');
  assert.equal(result.counts.nonmanifoldEdges, 1);
});

test('degenerate triangle is counted and excluded from edge multiplicity', () => {
  const faces = [...TETRA_FACES, [0, 0, 1]];
  const result = withTempGlb(topologyGlb({ positions: TETRA_POSITIONS, faces }), inspectGlbTopology);
  assert.equal(result.supported, true);
  assert.equal(result.counts.degenerateTriangles, 1);
  assert.equal(result.counts.triangles, 5);
  assert.equal(result.status, 'DEGENERATE');
  assert.equal(result.counts.boundaryEdges, 0);
});

test('buffer offsets, accessor offsets, and interleaved stride are respected', () => {
  const bytes = topologyGlb({
    positions: TETRA_POSITIONS,
    faces: TETRA_FACES,
    indexType: 5125,
    prefixBytes: 8,
    stride: 16,
    accessorLeadVertices: 1,
  });
  const result = withTempGlb(bytes, inspectGlbTopology);
  assert.equal(result.supported, true);
  assert.equal(result.status, 'CLOSED');
  assert.equal(result.counts.uniqueEdges, 6);
  assert.equal(result.counts.boundaryEdges, 0);
});

test('out-of-range index fails explicitly instead of miscounting', () => {
  const bytes = topologyGlb({ positions: TETRA_POSITIONS, faces: [[0, 1, 9]] });
  assert.throws(() => withTempGlb(bytes, inspectGlbTopology), /out of range/);
});

test('truncated file fails explicitly instead of reporting zero defects', () => {
  const bytes = topologyGlb({ positions: TETRA_POSITIONS, faces: TETRA_FACES });
  const truncated = bytes.subarray(0, bytes.length - 4);
  assert.throws(() => withTempGlb(truncated, inspectGlbTopology), /malformed\/truncated|header length/);
});

test('non-finite position fails explicitly instead of being welded', () => {
  const positions = [[Infinity, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const bytes = topologyGlb({ positions, faces: TETRA_FACES });
  assert.throws(() => withTempGlb(bytes, inspectGlbTopology), /non-finite/);
});

test('unsupported combinations report UNKNOWN instead of pretending zero defects', () => {
  const strip = withTempGlb(
    topologyGlb({ positions: TETRA_POSITIONS, faces: TETRA_FACES, mode: 5 }), inspectGlbTopology,
  );
  assert.equal(strip.supported, false);
  assert.equal(strip.status, 'UNKNOWN');
  assert.match(strip.unknownReason, /mode/);

  const nonIndexed = withTempGlb(
    topologyGlb({ positions: TETRA_POSITIONS, faces: TETRA_FACES, indexed: false }), inspectGlbTopology,
  );
  assert.equal(nonIndexed.status, 'UNKNOWN');

  const multi = withTempGlb(
    topologyGlb({ positions: TETRA_POSITIONS, faces: TETRA_FACES, extraPrimitives: 1 }), inspectGlbTopology,
  );
  assert.equal(multi.status, 'UNKNOWN');

  const sparseDoc = withTempGlb(
    topologyGlb({ positions: TETRA_POSITIONS, faces: TETRA_FACES, sparse: true }), inspectGlbTopology,
  );
  assert.equal(sparseDoc.status, 'UNKNOWN');
});

test('non-GLB input is rejected instead of fabricating evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gq-glb-topology-bad-'));
  try {
    const path = join(dir, 'bad.glb');
    writeFileSync(path, 'not a glb header');
    assert.throws(() => inspectGlbTopology(path), /not GLB/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Independent adversarial cases added during Director verification.
function mutateDocument(bytes, edit) {
  const len=bytes.readUInt32LE(12);
  const doc=JSON.parse(bytes.subarray(20,20+len).toString('utf8'));
  edit(doc); return buildGlb(doc,bytes.subarray(28+len));
}
test('signed zero does not open an attribute seam', () => {
  const positions=[...TETRA_POSITIONS,[-0,0,-0]];
  const faces=[[0,2,1],[4,1,3],[0,3,2],[1,2,3]];
  const r=withTempGlb(topologyGlb({positions,faces}),inspectGlbTopology);
  assert.equal(r.status,'CLOSED'); assert.equal(r.counts.uniquePositions,4);
});
test('zero-area and all-degenerate geometry is not declared CLOSED', () => {
  for(const positions of [[[0,0,0],[1,0,0],[2,0,0]],[[0,0,0],[0,0,0],[0,0,0]]]) {
    const r=withTempGlb(topologyGlb({positions,faces:[[0,1,2]]}),inspectGlbTopology);
    assert.equal(r.status,'DEGENERATE'); assert.equal(r.counts.degenerateTriangles,1);
  }
});

test('byte index accessors read BIN bytes too', () => {
  const r=withTempGlb(topologyGlb({positions:TETRA_POSITIONS,faces:TETRA_FACES,indexType:5121}),inspectGlbTopology);
  assert.equal(r.status,'CLOSED'); assert.equal(r.counts.uniqueEdges,6);
});
test('malformed byte ranges are rejected instead of reading arbitrary bytes', () => {
  const bytes=topologyGlb({positions:TETRA_POSITIONS,faces:TETRA_FACES});
  for(const edit of [d=>d.bufferViews[0].byteOffset=-4,d=>d.buffers[0].byteLength=4,d=>d.accessors[0].bufferView=88,d=>d.accessors[0].byteOffset=100000]) {
    assert.throws(()=>withTempGlb(mutateDocument(bytes,edit),inspectGlbTopology),/malformed|truncated/);
  }
});
test('compressed or external topology remains UNKNOWN with no fabricated counts', () => {
  const bytes=topologyGlb({positions:TETRA_POSITIONS,faces:TETRA_FACES});
  for(const edit of [d=>d.buffers[0].uri='external.bin',d=>d.meshes[0].primitives[0].extensions={KHR_draco_mesh_compression:{}},d=>d.bufferViews[0].extensions={EXT_meshopt_compression:{}}]) {
    const r=withTempGlb(mutateDocument(bytes,edit),inspectGlbTopology);
    assert.equal(r.status,'UNKNOWN'); assert.equal(r.counts,undefined);
  }
});
