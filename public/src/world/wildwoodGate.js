// public/src/world/wildwoodGate.js
//
// THE WILDWOOD GATE, as an actual object you can stand under.
//
// Why this exists, from playing the finished quest end to end and looking at the last screenshot:
// the game shouts "You found the Wildwood Gate!" at a stretch of road with two lamp posts on it.
// A child walks north through the trees, is congratulated for arriving somewhere, and arrives at
// nothing. That is the one beat of the whole Lantern Keeper quest where the words and the picture
// disagree, and it is the LAST one -- the note the adventure ends on and the promise it makes about
// whatever comes next.
//
// Built from boxes rather than bought as a GLB on purpose. We do not own an arch, the kit has no
// gateway in it, and a crude timber frame standing in the right place tonight is worth more than a
// perfect model nobody has modelled. Everything here is sized against the things it stands next to
// (the 1.48 m hero, the 1.56 m street lanterns, the 2.4-3.1 m treeline), not against taste.
//
// ONE MESH, not eight. Every part is merged into a single BufferGeometry before it is added to the
// scene, so the whole gateway costs one draw call -- the same trade render/glow.js makes for the
// lanterns, and for the same reason: this is an iPad.

import * as THREE from '../../vendor/three.module.min.js';
import { mergeGeometries } from '../../vendor/utils/BufferGeometryUtils.js';
import { WORLD, setLayer } from '../render/layers.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';

// The village fence's own wood, read out of the Kenney colormap atlas at the fence's own UVs rather
// than picked by eye -- the gate is built by the same people who built that fence, so it is made of
// the same timber. The atlas has a column of tones from #d38c6a down to #b87758; this is the dark
// end of it, which is what weathered outdoor structural timber looks like next to painted panels.
export const GATE_WOOD_COLOR = 0xb87758;

// Sizes in metres, all of them relative to something already in the world.
//
// A gateway has to be tall enough that walking under it is an EVENT. The posts stand 3.2 m, which is
// over twice the hero's height, and the lintel takes the whole frame to 3.54 m -- clear of the
// tallest tree in the zone (2.413 m x scale 1.35 = 3.26 m), so the arch breaks the horizon instead
// of hiding in the treeline it is set into. 2.9 m was the first number and it lost that contest by
// two centimetres; the test caught it, not a screenshot.
//
// It is still well under the Lantern Tree's 5.5 m, which is the order that matters: the tree is
// home and it is the biggest thing you can see, the gate is the way out.
export const POST_HEIGHT_METERS = 3.2;
export const POST_THICKNESS_METERS = 0.34;
const FOOT_HEIGHT_METERS = 0.3;
const FOOT_THICKNESS_METERS = 0.48;
const LINTEL_HEIGHT_METERS = 0.34;
const LINTEL_DEPTH_METERS = 0.44;
// How far the lintel runs past each post. A beam cut flush to its posts reads as a doorframe; one
// that overhangs reads as a built thing, and it is what every torii, farm gate and trailhead arch
// in the reference sweep does.
const LINTEL_OVERHANG_METERS = 0.6;
const COLLAR_DROP_METERS = 0.42;
const COLLAR_HEIGHT_METERS = 0.18;
const COLLAR_DEPTH_METERS = 0.3;
const BRACE_LENGTH_METERS = 1.0;
const BRACE_THICKNESS_METERS = 0.17;

// The lamp hanging in the middle of the arch, and the reason the gate is worth building tonight
// rather than tomorrow: the relight ceremony runs OUT from the Lantern Tree, nearest lantern first,
// so the furthest light in the zone is the last thing to catch. Give the gate a lamp and the last
// beat of the quest's payoff is the light reaching the edge of the world and showing the child the
// way out. It costs one box and one sprite.
const LAMP_SIZE_METERS = 0.3;
const LAMP_HANG_METERS = 0.52;
const LAMP_GLOW_COLOR = 0xffc477;
// Larger and stronger than a street lantern's (0.9 m / 0.72 in zoneLoader.js) because this one hangs
// 2.5 m up with nothing behind it but dark trees, and because it is the one the ceremony ends on.
const LAMP_GLOW_SIZE_METERS = 1.15;
const LAMP_GLOW_STRENGTH = 0.9;

export const GATE_TOTAL_HEIGHT_METERS = POST_HEIGHT_METERS + LINTEL_HEIGHT_METERS;

/** A box of `size` centred at `at`, optionally rolled about Z, baked straight into world-ish local
 *  space so the whole gate can be merged into one geometry. */
function slab([width, height, depth], [x, y, z], rollRadians = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const matrix = new THREE.Matrix4();
  if (rollRadians !== 0) matrix.makeRotationZ(rollRadians);
  matrix.setPosition(x, y, z);
  geometry.applyMatrix4(matrix);
  return geometry;
}

/**
 * Every piece of the gate, in the gate's own local space: the span runs along X, the road runs
 * through it along Z, and y=0 is the ground.
 *
 * Exported so its proportions can be asserted without a browser -- the thing most likely to go
 * wrong here is a number, not a matrix.
 */
export function gateParts(spanMeters) {
  const half = spanMeters / 2;
  const lintelY = POST_HEIGHT_METERS + LINTEL_HEIGHT_METERS / 2;
  const parts = [];
  for (const side of [-1, 1]) {
    const x = side * half;
    parts.push({ name: 'foot', size: [FOOT_THICKNESS_METERS, FOOT_HEIGHT_METERS, FOOT_THICKNESS_METERS], at: [x, FOOT_HEIGHT_METERS / 2, 0] });
    parts.push({ name: 'post', size: [POST_THICKNESS_METERS, POST_HEIGHT_METERS, POST_THICKNESS_METERS], at: [x, POST_HEIGHT_METERS / 2, 0] });
    // The braces sit in the inner corners, leaning from post to lintel. Rolled 45 degrees toward the
    // centre, which is which way a brace actually carries load and which way it reads.
    parts.push({
      name: 'brace',
      size: [BRACE_LENGTH_METERS, BRACE_THICKNESS_METERS, BRACE_THICKNESS_METERS],
      at: [
        x - side * (BRACE_LENGTH_METERS / 2) * Math.SQRT1_2,
        POST_HEIGHT_METERS - (BRACE_LENGTH_METERS / 2) * Math.SQRT1_2,
        0,
      ],
      roll: side * (Math.PI / 4),
    });
  }
  parts.push({
    name: 'collar',
    size: [spanMeters + POST_THICKNESS_METERS * 2, COLLAR_HEIGHT_METERS, COLLAR_DEPTH_METERS],
    at: [0, POST_HEIGHT_METERS - COLLAR_DROP_METERS, 0],
  });
  parts.push({
    name: 'lintel',
    size: [spanMeters + LINTEL_OVERHANG_METERS * 2, LINTEL_HEIGHT_METERS, LINTEL_DEPTH_METERS],
    at: [0, lintelY, 0],
  });
  // The lamp's own strut and housing, hanging from the middle of the collar.
  const lampY = POST_HEIGHT_METERS - COLLAR_DROP_METERS - LAMP_HANG_METERS;
  parts.push({ name: 'strut', size: [0.08, LAMP_HANG_METERS, 0.08], at: [0, lampY + LAMP_HANG_METERS / 2, 0] });
  parts.push({ name: 'lamp', size: [LAMP_SIZE_METERS, LAMP_SIZE_METERS, LAMP_SIZE_METERS], at: [0, lampY, 0] });
  return { parts, lampAt: [0, lampY, 0] };
}

/**
 * Build the gate and put it in the scene.
 *
 * Returns the same `{ at, setLit }` shape zoneLoader's street lanterns return, on purpose: the
 * relight chain takes a list of those and lights them in order, so the gate joins the ceremony
 * without the ceremony knowing anything about gates.
 *
 * @param scene the scene to add to
 * @param gate  `{ at: [x, z], rotY, spanMeters }` -- see WILDWOOD_GATE in the zone data
 */
export function buildWildwoodGate(scene, gate) {
  const { parts, lampAt } = gateParts(gate.spanMeters);
  const merged = mergeGeometries(parts.map((p) => slab(p.size, p.at, p.roll ?? 0)), false);
  const material = new THREE.MeshStandardMaterial({
    color: GATE_WOOD_COLOR,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = 'wildwood-gate';
  setLayer(mesh, WORLD);
  mesh.position.set(gate.at[0], 0, gate.at[1]);
  mesh.rotation.y = gate.rotY ?? 0;
  scene.add(mesh);

  const sprite = createGlowSprite(LAMP_GLOW_COLOR, LAMP_GLOW_SIZE_METERS);
  sprite.name = 'wildwood-gate-glow';
  setLayer(sprite, WORLD);
  sprite.position.set(gate.at[0] + lampAt[0], lampAt[1], gate.at[1] + lampAt[2]);
  scene.add(sprite);

  return {
    at: gate.at,
    setLit(nextLit) { setGlowStrength(sprite, nextLit ? LAMP_GLOW_STRENGTH : 0); },
  };
}
