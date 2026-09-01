import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { inspectGlb } from '../tools/asset-registry/inspect-glb.mjs';

function syntheticGlb(document) {
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, padded]);
}

test('source inspector reports geometry, bounds, rig and measured clip coverage from GLB declarations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gq-inspect-glb-'));
  const path = join(dir, 'fixture.glb');
  writeFileSync(path, syntheticGlb({
    asset: { version: '2.0', generator: 'fixture' },
    accessors: [
      { count: 6, min: [-1, -2, -3], max: [1, 2, 3] },
      { count: 6 },
      { count: 2, min: [0], max: [1.25] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ name: 'Root', children: [1] }, { name: 'Bone' }],
    skins: [{ joints: [1] }],
    animations: [{ name: 'walk', samplers: [{ input: 2 }], channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }] }],
  }));
  const result = inspectGlb(path);
  assert.equal(result.triangle_count, 2);
  assert.equal(result.vertex_count_unique_position_accessors, 6);
  assert.deepEqual(result.bounds_accessor_local.dimensions, [2, 4, 6]);
  assert.equal(result.skins[0].joint_count, 1);
  assert.deepEqual(result.animations[0], { name: 'walk', duration_seconds: 1.25, channel_count: 1, driven_nodes: ['Bone'] });
});

test('source inspector rejects non-GLB input instead of fabricating evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gq-inspect-glb-bad-'));
  const path = join(dir, 'bad.glb');
  writeFileSync(path, 'not a glb');
  assert.throws(() => inspectGlb(path), /not GLB/);
});
