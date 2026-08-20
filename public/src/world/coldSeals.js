// public/src/world/coldSeals.js
//
// G2: three physical locks around the Old Beacon. The player already owns the verb this slice needs:
// swing the sword, wait for the blade-contact frame, change something in the world. No new button,
// prompt, currency or framework sits between seeing the cold blue objects and trying the sword on
// them.
//
// The RULES are the tiny pure helpers at the top. The PRESENTER below them owns only pixels: three
// chunky low-poly seal stones, a pale-cyan core, and a short collapse/burst when one breaks. main.js
// decides when a sword actually touched one, just as it already does for black bramble.

import * as THREE from '../../vendor/three.module.min.js';
import { mergeGeometries } from '../../vendor/utils/BufferGeometryUtils.js';
import { WORLD, setLayer } from '../render/layers.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { BEACON_STONE_COLOR, BEACON_TRIM_COLOR } from './oldBeacon.js';

export const COLD_SEAL_COUNT = 3;
export const COLD_SEAL_GLOW_COLOR = 0xa9e8ff;
export const COLD_SEAL_BREAK_SECONDS = 0.55;
export const COLD_SEAL_HIT_HEIGHT_METERS = 0.82;

// Local +Z points back down the road (oldBeacon.js). Two seals therefore confront the player on
// arrival; the third sits behind the plinth and asks for one small circle around the landmark rather
// than another stretch of road. All three sit just outside the 2.05 m stone plinth.
const LOCAL_SEALS = Object.freeze([
  Object.freeze({ id: 'left', at: Object.freeze([-1.75, 2.15]) }),
  Object.freeze({ id: 'right', at: Object.freeze([1.75, 2.15]) }),
  Object.freeze({ id: 'rear', at: Object.freeze([0, -2.65]) }),
]);

/** Turn the Beacon-relative layout into world coordinates. Derived from OLD_BEACON rather than
 * repeating [2.6, 51] here, so moving/turning the landmark carries its locks with it. */
export function coldSealSpecs(beacon) {
  const yaw = beacon.rotY ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return LOCAL_SEALS.map((seal) => {
    const [lx, lz] = seal.at;
    const x = beacon.at[0] + lx * cos + lz * sin;
    const z = beacon.at[1] - lx * sin + lz * cos;
    return Object.freeze({
      id: seal.id,
      at: Object.freeze([x, z]),
      // Face away from the tower. The geometry is almost symmetrical, but the slight crystal lean
      // makes this visible enough that the three read as deliberately placed locks, not debris.
      rotY: Math.atan2(x - beacon.at[0], z - beacon.at[1]),
    });
  });
}

export function noColdSealsBroken(count = COLD_SEAL_COUNT) {
  return Array.from({ length: Math.max(0, count) }, () => false);
}

export function coldSealsBroken(broken) {
  return broken.filter(Boolean).length;
}

/** One blade contact can break at most one seal. `isStruck(spec,index)` is supplied by the caller so
 * this rule knows nothing about three.js, hero headings or combat modules and stays node-testable. */
export function strikeColdSeals(broken, specs, isStruck) {
  for (let i = 0; i < specs.length; i += 1) {
    if (broken[i] === true || !isStruck(specs[i], i)) continue;
    const next = [...broken];
    next[i] = true;
    return { broken: next, struck: [i] };
  }
  return { broken, struck: [] };
}

function colored(geometry, colorHex) {
  const color = new THREE.Color(colorHex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.deleteAttribute('uv');
  return geometry;
}

function moved(geometry, x, y, z, scaleX = 1, scaleY = 1, scaleZ = 1, roll = 0) {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, roll)),
    new THREE.Vector3(scaleX, scaleY, scaleZ),
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

/** One seal is intentionally a very simple silhouette: stone foot, narrow upright lock, one icy
 * crystal. Thick forms survive portrait distance; the pale-cyan part is the only thing asking to be
 * hit. One merged mesh means each breakable seal costs one ordinary draw plus one glow sprite. */
export function coldSealGeometry() {
  const foot = moved(
    colored(new THREE.CylinderGeometry(0.40, 0.46, 0.20, 6, 1), BEACON_STONE_COLOR),
    0, 0.10, 0,
  );
  const lock = moved(
    colored(new THREE.BoxGeometry(0.76, 0.82, 0.24), BEACON_TRIM_COLOR),
    0, 0.59, 0,
    1, 1, 1, 0.06,
  );
  const crystal = moved(
    colored(new THREE.OctahedronGeometry(0.33, 0), COLD_SEAL_GLOW_COLOR),
    0, 1.10, 0.05,
    0.72, 1.25, 0.52, -0.08,
  );
  return mergeGeometries([foot, lock, crystal], false);
}

function sealMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    flatShading: true,
  });
}

/**
 * Build the three seals and return a presentation controller.
 *
 * `break(index)` is idempotent. Rule state flips in main.js immediately on contact; this presenter
 * then spends 0.55 s making that truth readable -- flare, kick, sink, gone -- without delaying the
 * objective or making animation authoritative.
 */
export function buildColdSeals(scene, beacon) {
  const specs = coldSealSpecs(beacon);
  const entries = specs.map((spec, index) => {
    const mesh = new THREE.Mesh(coldSealGeometry(), sealMaterial());
    mesh.name = `cold-seal-${spec.id}`;
    setLayer(mesh, WORLD);
    mesh.position.set(spec.at[0], 0, spec.at[1]);
    mesh.rotation.y = spec.rotY;
    scene.add(mesh);

    const glow = createGlowSprite(COLD_SEAL_GLOW_COLOR, 0.92, 'mote');
    glow.name = `cold-seal-glow-${spec.id}`;
    setLayer(glow, WORLD);
    glow.position.set(spec.at[0], COLD_SEAL_HIT_HEIGHT_METERS, spec.at[1]);
    setGlowStrength(glow, 0.66);
    scene.add(glow);

    return {
      index,
      mesh,
      glow,
      seconds: -1,
      broken: false,
      baseY: mesh.position.y,
      kick: index % 2 === 0 ? -1 : 1,
    };
  });

  return {
    specs,
    count: entries.length,
    break(index) {
      const entry = entries[index];
      if (!entry || entry.broken || entry.seconds >= 0) return false;
      entry.seconds = 0;
      setGlowStrength(entry.glow, 1);
      return true;
    },
    update(deltaSeconds) {
      for (const entry of entries) {
        if (entry.seconds < 0 || entry.broken) continue;
        entry.seconds += deltaSeconds;
        const t = Math.min(1, entry.seconds / COLD_SEAL_BREAK_SECONDS);
        const burst = Math.sin(Math.PI * Math.min(1, t * 1.55));
        const settle = t * t * (3 - 2 * t);
        const scale = 1 + burst * 0.18;
        entry.mesh.scale.setScalar(scale);
        entry.mesh.rotation.z = entry.kick * settle * 0.34;
        entry.mesh.position.y = entry.baseY - settle * 0.72;
        setGlowStrength(entry.glow, Math.max(0, 1 - settle));
        entry.glow.scale.setScalar(0.92 * (1 + burst * 1.05));
        if (t >= 1) {
          entry.broken = true;
          entry.mesh.visible = false;
          setGlowStrength(entry.glow, 0);
        }
      }
    },
    visualBrokenCount: () => entries.filter((entry) => entry.broken).length,
  };
}
