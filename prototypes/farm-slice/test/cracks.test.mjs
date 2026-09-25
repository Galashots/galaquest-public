import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as THREE from '../vendor/three.module.min.js';
import { CRACK_LIFT, addCrack, buildCrack, seatCrack } from '../src/render/cracks.js';
import { EGG_MODEL_HEIGHT, normalizeModel } from '../src/render/models.js';
import { buildEgg } from '../src/render/procgen.js';

// 4 goal cracks plus the 2 drama taps before the one that hatches.
const CRACKS = 6;
// A seated point sits CRACK_LIFT off the shell along its normal; measured
// sideways toward the axis that reads a little longer on the egg's slopes.
const MAX_STANDOFF = CRACK_LIFT * 2.5;

function proceduralEgg() {
  const egg = buildEgg(THREE);
  egg.userData.surfaces = [egg.userData.shell];
  return egg;
}

/** The shipped egg's mesh (geometry only: node cannot decode its texture), placed as the game places it. */
function sculptedEgg() {
  const bytes = readFileSync(new URL('../assets/egg.glb', import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binary = 20 + jsonLength + 8;
  const read = (index, Type, components) => {
    const accessor = json.accessors[index];
    const start = binary + (json.bufferViews[accessor.bufferView].byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const end = start + accessor.count * components * Type.BYTES_PER_ELEMENT;
    return new Type(bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + end));
  };
  assert.equal(json.meshes.length, 1);
  const [primitive] = json.meshes[0].primitives;
  assert.equal(json.accessors[primitive.attributes.POSITION].componentType, 5126, 'float positions');
  assert.equal(json.accessors[primitive.indices].componentType, 5125, 'uint32 indices');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(read(primitive.attributes.POSITION, Float32Array, 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(read(primitive.indices, Uint32Array, 1), 1));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  if (json.nodes[0].matrix) mesh.applyMatrix4(new THREE.Matrix4().fromArray(json.nodes[0].matrix));
  const egg = buildEgg(THREE);
  egg.userData.shell.visible = false;
  egg.add(normalizeModel(THREE, mesh, { height: EGG_MODEL_HEIGHT }));
  egg.userData.surfaces = [mesh];
  return egg;
}

/** How far a point (egg-group space) stands off the shell, measured toward the egg's axis. */
function standoff(egg, point) {
  const out = new THREE.Vector3(point.x, 0, point.z).normalize();
  const axis = new THREE.Vector3(0, point.y, 0);
  const raycaster = new THREE.Raycaster(egg.localToWorld(axis.clone().addScaledVector(out, 3)));
  raycaster.ray.direction.copy(out).negate().transformDirection(egg.matrixWorld);
  const hit = raycaster.intersectObjects(egg.userData.surfaces, false)[0];
  assert.ok(hit, 'the shell is under every crack point');
  const onShell = egg.worldToLocal(hit.point.clone());
  return Math.hypot(point.x, point.z) - Math.hypot(onShell.x, onShell.z);
}

function assertOnShell(egg, label) {
  egg.updateMatrixWorld(true);
  assert.equal(egg.userData.cracks.length, CRACKS);
  for (const [index, crack] of egg.userData.cracks.entries()) {
    const position = crack.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const gap = standoff(egg, new THREE.Vector3().fromBufferAttribute(position, i));
      assert.ok(gap > 0 && gap <= MAX_STANDOFF, `${label} crack ${index} point ${i}: ${gap.toFixed(4)} off the shell`);
    }
  }
}

for (const [label, makeEgg] of [['procedural', proceduralEgg], ['sculpted', sculptedEgg]]) {
  test(`every crack lies on the ${label} egg's shell and never sticks out past it`, () => {
    const egg = makeEgg();
    // The egg wobbles; seating happens mid-wobble and must still land on the shell.
    egg.position.set(-3.8, 0, 2.4);
    egg.rotation.z = 0.12;
    for (let i = 0; i < CRACKS; i++) assert.ok(seatCrack(THREE, egg, addCrack(THREE, egg, i)), `crack ${i} seats`);
    assertOnShell(egg, label);
  });
}

test('cracks already on the procedural egg move onto the sculpted egg when it arrives', () => {
  const egg = proceduralEgg();
  for (let i = 0; i < CRACKS; i++) addCrack(THREE, egg, i);
  const sculpted = sculptedEgg();
  const model = sculpted.children.find((child) => child.isGroup);
  egg.userData.shell.visible = false;
  egg.add(model);
  egg.userData.surfaces = sculpted.userData.surfaces;
  for (const crack of egg.userData.cracks) assert.ok(seatCrack(THREE, egg, crack));
  assertOnShell(egg, 're-seated');
});

test('a crack with no shell under it keeps its layout', () => {
  const egg = buildEgg(THREE);
  const crack = buildCrack(THREE, 0);
  const before = Array.from(crack.geometry.attributes.position.array);
  egg.userData.surfaces = [];
  assert.equal(seatCrack(THREE, egg, crack), false, 'no shell at all');
  // A shell that only some of the strip's points reach: none of them move.
  const partial = new THREE.Mesh(new THREE.SphereGeometry(0.4));
  partial.position.y = crack.userData.height - 0.45;
  egg.add(partial);
  egg.userData.surfaces = [partial];
  assert.equal(seatCrack(THREE, egg, crack), false, 'a shell under only part of the crack');
  assert.deepEqual(Array.from(crack.geometry.attributes.position.array), before);
});
