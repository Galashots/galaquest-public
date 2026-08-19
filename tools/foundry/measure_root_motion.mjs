#!/usr/bin/env node
/**
 * Measure exactly what a clip's ROOT bone does over its own local translation/rotation tracks --
 * total yaw, total XZ displacement, and whether either one is monotonic or oscillates.
 *
 *   node tools/foundry/measure_root_motion.mjs <file.glb> [--root Hips]
 *
 * WHY THIS EXISTS. AP2-A's Keeper turn clips (Idle_Turn_Left/Right) are rumoured to carry "root
 * motion" -- Sol's inspection put it at roughly 119 degrees plus translation for the left turn and
 * 104 degrees plus translation for the right. The brief is explicit that this has to be RE-MEASURED,
 * not trusted, before any turn/root-motion policy is built on top of it: a policy that strips
 * translation and banks rotation only makes sense if the rotation is genuinely monotonic (one clean
 * turn) rather than, say, a turn-and-settle-back that would get banked twice.
 *
 * Reads the GLB directly rather than through GLTFLoader for the same reason clip_inventory.mjs and
 * material_audit.mjs do: this needs the file's OWN declared keyframes, not a loader's resampling.
 *
 * "Root" here means the topmost joint of the skin -- Hips on this rig, confirmed by
 * clip_inventory.mjs against every file in both Meshy packs -- not the scene-graph Object3D the game
 * calls `root` (that one is never animated; see zoneLoader.js's createKeeperPresenter). A bone's local
 * translation is relative to its OWN rest pose, which is exactly what "how far did this clip move the
 * pelvis from where the bind pose put it" means.
 */

import { readFileSync } from 'node:fs';

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function readGlb(path) {
  const bytes = readFileSync(path);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  let offset = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(body.toString('utf8'));
    else if (type === BIN_CHUNK) bin = Buffer.from(body);
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error(`${path}: no JSON chunk`);
  return { json, bin };
}

const COMPONENT_READERS = {
  5126: (buf, i) => buf.readFloatLE(i * 4), // FLOAT
};
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Every value of an accessor, as an array of plain arrays (one per element). Floats only -- every
 *  animation sampler accessor in a Meshy export is FLOAT, and this refuses rather than mis-decode. */
function readAccessor({ json, bin }, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  if (accessor.componentType !== 5126) {
    throw new Error(`accessor ${accessorIndex}: componentType ${accessor.componentType}, expected FLOAT (5126)`);
  }
  const view = json.bufferViews[accessor.bufferView];
  if (view.byteStride) throw new Error(`accessor ${accessorIndex}: interleaved bufferView, not supported here`);
  const components = TYPE_COMPONENTS[accessor.type];
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const read = COMPONENT_READERS[5126];
  const out = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const element = [];
    for (let c = 0; c < components; c += 1) {
      element.push(read(bin, (start + (i * components + c) * 4) / 4));
    }
    out.push(element);
  }
  return out;
}

/** Yaw (rotation about world/bone-local Y) implied by a quaternion, in the same convention
 *  three.js's Euler('YXZ').y would report for a rotation that is purely about Y. Correct for any
 *  quaternion via atan2 on the appropriate matrix elements, not just a pure-Y special case. */
function yawOf([x, y, z, w]) {
  // Standard quaternion-to-yaw (Y-up, right-handed): atan2(2(wy + xz), 1 - 2(y^2 + x^2)... using the
  // matrix element form is more robust near the poles than a small-angle assumption.
  const m13 = 2 * (x * z + y * w);
  const m33 = 1 - 2 * (x * x + y * y);
  return Math.atan2(m13, m33);
}

function unwrapDegrees(radiansSeries) {
  // Keeps a running unwrapped total so a clip that turns past +/-180 degrees does not fold over and
  // read as a small turn the wrong way -- exactly the seam shortestTurn (zoneLoader.js) exists for,
  // but here we WANT the raw unwrapped total, not the shortest path.
  const out = [radiansSeries[0]];
  for (let i = 1; i < radiansSeries.length; i += 1) {
    let delta = radiansSeries[i] - radiansSeries[i - 1];
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    out.push(out[i - 1] + delta);
  }
  return out.map((r) => (r * 180) / Math.PI);
}

function monotonicity(series) {
  let up = 0;
  let down = 0;
  for (let i = 1; i < series.length; i += 1) {
    if (series[i] > series[i - 1] + 1e-9) up += 1;
    else if (series[i] < series[i - 1] - 1e-9) down += 1;
  }
  if (up > 0 && down > 0) return `NOT monotonic (${up} steps forward, ${down} steps backward)`;
  return 'monotonic';
}

function measure(path, rootName) {
  const glb = readGlb(path);
  const names = (glb.json.nodes ?? []).map((n) => n.name);
  const rootIndex = names.indexOf(rootName);
  if (rootIndex === -1) throw new Error(`${path}: no node named '${rootName}' (have: ${names.join(', ')})`);

  const animation = glb.json.animations?.[0];
  if (!animation) throw new Error(`${path}: no animation`);

  const rotChannel = animation.channels.find(
    (c) => c.target.node === rootIndex && c.target.path === 'rotation',
  );
  const posChannel = animation.channels.find(
    (c) => c.target.node === rootIndex && c.target.path === 'translation',
  );

  console.log(`\n${path}`);
  console.log(`  clip '${animation.name}', root node '${rootName}' (node ${rootIndex})`);

  if (rotChannel) {
    const sampler = animation.samplers[rotChannel.sampler];
    const times = readAccessor(glb, sampler.input).map((t) => t[0]);
    const quats = readAccessor(glb, sampler.output);
    const yawsDeg = unwrapDegrees(quats.map(yawOf));
    const totalYaw = yawsDeg[yawsDeg.length - 1] - yawsDeg[0];
    const maxYaw = Math.max(...yawsDeg);
    const minYaw = Math.min(...yawsDeg);
    console.log(`  rotation: ${times.length} keyframes over ${times[times.length - 1].toFixed(4)}s`);
    console.log(`    net yaw (last - first)   ${totalYaw.toFixed(2)} deg`);
    console.log(`    yaw range through clip   ${minYaw.toFixed(2)} .. ${maxYaw.toFixed(2)} deg `
      + `(span ${(maxYaw - minYaw).toFixed(2)} deg)`);
    console.log(`    ${monotonicity(yawsDeg)}`);
  } else {
    console.log('  rotation: NOT ANIMATED on this node');
  }

  if (posChannel) {
    const sampler = animation.samplers[posChannel.sampler];
    const times = readAccessor(glb, sampler.input).map((t) => t[0]);
    const positions = readAccessor(glb, sampler.output);
    const [x0, y0, z0] = positions[0];
    const [xN, yN, zN] = positions[positions.length - 1];
    const netXZ = Math.hypot(xN - x0, zN - z0);
    let maxStepXZ = 0;
    let maxRadiusXZ = 0;
    for (let i = 1; i < positions.length; i += 1) {
      const [xa, , za] = positions[i - 1];
      const [xb, , zb] = positions[i];
      maxStepXZ = Math.max(maxStepXZ, Math.hypot(xb - xa, zb - za));
      maxRadiusXZ = Math.max(maxRadiusXZ, Math.hypot(xb - x0, zb - z0));
    }
    console.log(`  translation: ${times.length} keyframes`);
    console.log(`    start  (${x0.toFixed(4)}, ${y0.toFixed(4)}, ${z0.toFixed(4)})`);
    console.log(`    end    (${xN.toFixed(4)}, ${yN.toFixed(4)}, ${zN.toFixed(4)})`);
    console.log(`    net XZ displacement (start -> end)   ${netXZ.toFixed(4)} m`);
    console.log(`    largest single-frame XZ step          ${maxStepXZ.toFixed(4)} m`);
    console.log(`    largest XZ distance from start         ${maxRadiusXZ.toFixed(4)} m`);
    console.log(`    Y range                                ${Math.min(...positions.map((p) => p[1])).toFixed(4)} `
      + `.. ${Math.max(...positions.map((p) => p[1])).toFixed(4)}`);
  } else {
    console.log('  translation: NOT ANIMATED on this node');
  }
}

const args = process.argv.slice(2);
const rootFlagIndex = args.indexOf('--root');
const rootName = rootFlagIndex === -1 ? 'Hips' : args[rootFlagIndex + 1];
const paths = args.filter((a, i) => a !== '--root' && (rootFlagIndex === -1 || i !== rootFlagIndex + 1));

if (paths.length === 0) {
  console.error('usage: node tools/foundry/measure_root_motion.mjs <file.glb> [more.glb...] [--root Hips]');
  process.exit(2);
}

let failed = false;
for (const path of paths) {
  try {
    measure(path, rootName);
  } catch (err) {
    failed = true;
    console.error(`\n${path}: FAILED -- ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
