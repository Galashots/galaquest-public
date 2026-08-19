// Measures the world-space bounding box of every GLB under a directory (or a single file), by
// walking the glTF node graph and transforming each mesh primitive's POSITION accessor min/max by
// that node's world matrix. Prints width x height x depth x minY x triangle count. Reads the GLB's
// own JSON chunk directly, same as glb_budget.mjs in this directory -- no Blender, no three.js.
//
//   node tools/budget/measure_props.mjs <file.glb | directory> [more...]
//
// test/zone-data.test.mjs's FOOTPRINT_RADIUS_METERS is this tool's output, by hand, against the
// shipped public/assets/props/village/ + public/assets/world/lantern_tree.glb.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function parseGLB(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12;
  let json = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(buf.subarray(off + 8, off + 8 + len)));
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  return json;
}

function mul(a, b) { // column-major 4x4, a*b
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

function nodeMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function measure(json) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  const visit = (idx, parent) => {
    const n = json.nodes[idx];
    const world = mul(parent, nodeMatrix(n));
    if (n.mesh != null) {
      for (const prim of json.meshes[n.mesh].primitives ?? []) {
        const acc = json.accessors[prim.attributes?.POSITION];
        if (prim.indices != null) tris += json.accessors[prim.indices].count / 3;
        if (!acc?.min || !acc?.max) continue;
        for (let i = 0; i < 8; i++) {
          const corner = [
            i & 1 ? acc.max[0] : acc.min[0],
            i & 2 ? acc.max[1] : acc.min[1],
            i & 4 ? acc.max[2] : acc.min[2],
          ];
          const w = apply(world, corner);
          for (let a = 0; a < 3; a++) { if (w[a] < min[a]) min[a] = w[a]; if (w[a] > max[a]) max[a] = w[a]; }
        }
      }
    }
    for (const c of n.children ?? []) visit(c, world);
  };
  for (const s of json.scenes[json.scene ?? 0].nodes) visit(s, IDENT);
  return { min, max, tris: Math.round(tris) };
}

const roots = process.argv.slice(2);
const files = [];
for (const root of roots) {
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.glb')) files.push(p);
    }
  };
  statSync(root).isDirectory() ? walk(root) : files.push(root);
}

console.log('file'.padEnd(42), 'W'.padStart(7), 'H'.padStart(7), 'D'.padStart(7), 'minY'.padStart(7), 'tris'.padStart(7));
for (const f of files.sort()) {
  try {
    const j = parseGLB(readFileSync(f));
    const { min, max, tris } = measure(j);
    const name = relative(process.cwd(), f).replace(/\\/g, '/');
    console.log(
      name.padEnd(42),
      (max[0] - min[0]).toFixed(3).padStart(7),
      (max[1] - min[1]).toFixed(3).padStart(7),
      (max[2] - min[2]).toFixed(3).padStart(7),
      min[1].toFixed(3).padStart(7),
      String(tris).padStart(7),
    );
  } catch (err) {
    console.log(f, 'ERROR', err.message);
  }
}
