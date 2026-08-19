// public/src/world/wildwoodBlade.js
//
// THE WILDWOOD BLADE, Rowan's own reward, planted point-down in the clearing where a child first
// hears about it. Named in Rowan's own intro line before it is ever handed over ("See that sword? It
// is a Wildwood Blade."), so it has to already stand there rather than appear later -- the beat is
// "you can already see the thing I am telling you about", the same trick the gate's own hanging lamp
// and the tree's own canopy motes already use.
//
// Built from boxes rather than bought, the same trade world/wildwoodGate.js and world/bramble.js
// already make: we do not own a sword model, and a crude blade standing in the right place tonight
// reads better than a perfect one nobody has modelled. ONE MESH PER TONE, not eight boxes -- two
// draw calls for the whole prop, the same "this is an iPad" discipline the gate's single merged mesh
// follows, just split once because this is the one prop in the game that needs two materials to say
// what it is: a living, Wildwood-grown blade in warm, ordinary metal fittings.

import * as THREE from '../../vendor/three.module.min.js';
import { mergeGeometries } from '../../vendor/utils/BufferGeometryUtils.js';
import { WORLD, setLayer } from '../render/layers.js';

// A cool teal-green, unlike anything else built in this zone (the gate's timber is warm brown, the
// bramble is near-black) -- this is the one object in the game that is not ordinary material, and the
// colour has to say so before a child reads a word of Rowan's line.
export const WILDWOOD_COLOR = 0x3fa88a;
// Warm brass, the opposite temperature from the blade on purpose: two tones read as two materials
// only if they disagree on more than hue -- see test/wildwood-blade.test.mjs's own colour-distance
// check.
export const METAL_COLOR = 0xcfa15a;

const BLADE_LOWER_HEIGHT_METERS = 0.38;
const BLADE_UPPER_HEIGHT_METERS = 0.30;
const CROSSGUARD_HEIGHT_METERS = 0.07;
const GRIP_HEIGHT_METERS = 0.20;
const POMMEL_SIZE_METERS = 0.10;

// The whole planted height: about 69% of the 1.48 m hero, which reads as a real two-handed sword
// without out-scaling Rowan standing beside it. Exported so a placement check can pin it against the
// hero without restating the arithmetic (GQ-007).
export const BLADE_TOTAL_HEIGHT_METERS = BLADE_LOWER_HEIGHT_METERS + BLADE_UPPER_HEIGHT_METERS
  + CROSSGUARD_HEIGHT_METERS + GRIP_HEIGHT_METERS + POMMEL_SIZE_METERS;

/**
 * Every piece of the blade, in the prop's own local space: y=0 is the ground it is planted in, and
 * each part is tagged `wildwood` or `metal` for the builder to sort into the two merged meshes.
 *
 * Exported so its proportions can be asserted without a browser -- the thing most likely to go wrong
 * here is a number, not a matrix.
 */
export function bladeParts() {
  let y = 0;
  const parts = [];
  const stack = (name, height, width, depth, tone) => {
    parts.push({ name, size: [width, height, depth], at: [0, y + height / 2, 0], tone });
    y += height;
  };
  // Tapered in two steps rather than one box: a single constant-width plank reads as a ruler, and a
  // real blade narrows toward its point.
  stack('blade-lower', BLADE_LOWER_HEIGHT_METERS, 0.13, 0.03, 'wildwood');
  stack('blade-upper', BLADE_UPPER_HEIGHT_METERS, 0.09, 0.025, 'wildwood');
  // Wider than the blade on both axes, the same "the crossguard reads as a crossguard" reasoning the
  // gate's own collar beam follows for its own silhouette.
  stack('crossguard', CROSSGUARD_HEIGHT_METERS, 0.36, 0.08, 'metal');
  stack('grip', GRIP_HEIGHT_METERS, 0.08, 0.06, 'metal');
  stack('pommel', POMMEL_SIZE_METERS, POMMEL_SIZE_METERS, POMMEL_SIZE_METERS, 'metal');
  return { parts };
}

/** A box of `size` centred at `at`, baked into local space -- same helper wildwoodGate.js's own
 *  `slab` provides, kept local rather than shared: the two builders differ only in that this one
 *  never rolls a part, and a one-argument difference is not worth a shared import for. */
function slab([width, height, depth], [x, y, z]) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const matrix = new THREE.Matrix4().setPosition(x, y, z);
  geometry.applyMatrix4(matrix);
  return geometry;
}

function meshFor(parts, tone, color, scene, blade) {
  const geometries = parts.filter((part) => part.tone === tone).map((part) => slab(part.size, part.at));
  const material = new THREE.MeshStandardMaterial({
    color,
    // The wildwood tone gets a faint self-glow -- cheap (no new light) and it is the one thing in
    // this file that tells a child "this is not just a green sword" before Rowan ever says a word.
    // The metal fittings stay lit normally: ordinary steel does not glow.
    ...(tone === 'wildwood' ? { emissive: new THREE.Color(color), emissiveIntensity: 0.35 } : {}),
    roughness: tone === 'metal' ? 0.35 : 0.6,
    metalness: tone === 'metal' ? 0.8 : 0,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(mergeGeometries(geometries, false), material);
  mesh.name = `wildwood-blade-${tone}`;
  setLayer(mesh, WORLD);
  mesh.position.set(blade.at[0], 0, blade.at[1]);
  mesh.rotation.y = blade.rotY ?? 0;
  scene.add(mesh);
  return mesh;
}

/**
 * Build the blade and put it in the scene.
 *
 * @param scene the scene to add to
 * @param blade `{ at: [x, z], rotY }` -- see WILDWOOD_BLADE in the zone data
 */
export function buildWildwoodBlade(scene, blade) {
  const { parts } = bladeParts();
  meshFor(parts, 'wildwood', WILDWOOD_COLOR, scene, blade);
  meshFor(parts, 'metal', METAL_COLOR, scene, blade);
  return { at: blade.at };
}
