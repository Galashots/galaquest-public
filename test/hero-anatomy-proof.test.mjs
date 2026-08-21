import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as THREE from '../public/vendor/three.module.min.js';
import {
  attachTriangleAnatomyRegions,
  geometryForAnatomyCoverage,
} from '../public/src/character/anatomyOcclusion.js';
import {
  HERO_ANATOMY_SOURCE,
  HERO_ANATOMY_TRIANGLES,
} from '../public/src/character/heroAnatomyRegions.js';
import { DAWNWARDEN_HELMET_CANDIDATE } from '../public/src/studio/candidateGear.js';

const HERO_PATH = `public/${HERO_ANATOMY_SOURCE.assetPath}`;

function glbParts(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'JSON') json = JSON.parse(payload.toString('utf8').replace(/\u0000+$/g, '').trimEnd());
    if (type === 'BIN\u0000') bin = payload;
    offset += 8 + length;
  }
  assert.ok(json, 'GLB JSON chunk missing');
  assert.ok(bin, 'GLB BIN chunk missing');
  return { json, bin };
}

function accessorArray(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const byteOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const component = {
    5121: Uint8Array,
    5123: Uint16Array,
    5125: Uint32Array,
  }[accessor.componentType];
  assert.ok(component, `unsupported index component type ${accessor.componentType}`);
  return new component(bin.buffer, bin.byteOffset + byteOffset, accessor.count);
}

function sortedStrict(values) {
  for (let i = 1; i < values.length; i += 1) assert.ok(values[i - 1] < values[i], 'face ids must be unique and sorted');
}

test('the supervised Hero anatomy proof is pinned to the exact current shipping body bytes', () => {
  const bytes = readFileSync(HERO_PATH);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, HERO_ANATOMY_SOURCE.sha256, 'Hero GLB changed without re-authoring semantic anatomy');

  const { json } = glbParts(bytes);
  const bodyPrimitive = json.meshes[0].primitives[0];
  const bodyIndexAccessor = json.accessors[bodyPrimitive.indices];
  assert.equal(bodyIndexAccessor.count / 3, HERO_ANATOMY_SOURCE.triangleCount);
  assert.equal(HERO_ANATOMY_SOURCE.triangleCount, 6800);
});

test('Dawnwarden full-helm proof hides one disjoint hair/scalp atom plus ears', () => {
  const hair = HERO_ANATOMY_TRIANGLES.hair;
  const ears = HERO_ANATOMY_TRIANGLES.ears;
  assert.equal(hair.length, 2263);
  assert.equal(ears.length, 153);
  sortedStrict(hair);
  sortedStrict(ears);
  const union = new Set([...hair, ...ears]);
  assert.equal(union.size, hair.length + ears.length, 'semantic regions must not overlap');
  assert.equal(HERO_ANATOMY_SOURCE.triangleCount - union.size, 4384);
  assert.deepEqual(DAWNWARDEN_HELMET_CANDIDATE.hideAnatomy, ['hair', 'ears']);
});

test('the exact Hero index buffer produces a shared-buffer 4,384-triangle covered body', () => {
  const bytes = readFileSync(HERO_PATH);
  const { json, bin } = glbParts(bytes);
  const primitive = json.meshes[0].primitives[0];
  const indices = accessorArray(json, bin, primitive.indices);
  const maxIndex = indices.reduce((maximum, value) => Math.max(maximum, value), 0);

  const source = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array((maxIndex + 1) * 3), 3);
  source.setAttribute('position', positions);
  source.setIndex(new THREE.BufferAttribute(indices, 1));
  attachTriangleAnatomyRegions(source, HERO_ANATOMY_TRIANGLES, HERO_ANATOMY_SOURCE);

  const covered = geometryForAnatomyCoverage(source, ['ears', 'hair']);
  assert.equal(covered.getAttribute('position'), positions, 'covered body must reuse the source skinned payload');
  assert.equal(covered.groups.length, 0, 'covered body remains one draw/primitive');
  assert.equal(covered.getIndex().count / 3, 4384);
  assert.equal(covered.userData.gqAnatomyCoverage.regionSource, 'triangle-sidecar');
  assert.deepEqual(covered.userData.gqAnatomyCoverage.hiddenTriangleCounts, { hair: 2263, ears: 153 });
});
