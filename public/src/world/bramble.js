// public/src/world/bramble.js
//
// THE BLACK BRAMBLE: a thing in the world you can hit, that stops being there.
//
// Chapter 2's second verb, and the whole feeling it exists to buy is "I can change the world, not
// just hit enemies." Until now a sword in this game did exactly one thing -- take a hit point off a
// wolf -- so the world was scenery with a monster standing in it. A tangle across the trail that
// falls apart when you cut it says something a wolf cannot: the place itself is yours to act on.
//
// Built from merged boxes, the same trade world/wildwoodGate.js makes and for the same reasons: the
// Kenney kit has no bramble, we are not commissioning one tonight, and a crude black tangle standing
// in the right place is worth more than a perfect one nobody has modelled. ONE draw call.
//
// WHAT IT HONESTLY IS NOT: a collision barrier. Nothing in this game collides with anything -- a
// child already walks through houses and trees -- and giving one prop real collision means teaching
// the SERVER about it, because the server owns position and would otherwise walk a hero straight
// through the client's own push-back and reconcile him to the far side. That is a whole system for
// one bush. So the bramble is a thing standing across the path that a child will hit because it is
// in the way and hitting things is what they do, and the objective chip names it. If they squeeze
// past it into the trees instead, nothing breaks; they have just skipped a beat, the same way they
// can skip a trail light.

import * as THREE from '../../vendor/three.module.min.js';
import { mergeGeometries } from '../../vendor/utils/BufferGeometryUtils.js';
import { WORLD, setLayer } from '../render/layers.js';

// Near-black with a bruised violet in it. Everything else in this world is warm or green; the one
// thing in the game that is neither reads as WRONG before a child has been told anything, which is
// the entire job of this colour. Not pure black -- pure black loses its own silhouette against the
// dark trees behind it and flattens to a hole in the picture.
export const BRAMBLE_COLOR = 0x2b1f33;
// Chest-high on the 1.48 m hero, not over his head. Tall enough to read as blocking, short enough
// that a child can see the trail continuing on the other side -- if it hides where you are going, it
// reads as the end of the world rather than as something in the way of somewhere.
export const BRAMBLE_HEIGHT_METERS = 1.15;
const CANE_THICKNESS_METERS = 0.16;
const THORN_LENGTH_METERS = 0.34;
const THORN_THICKNESS_METERS = 0.07;

/**
 * Every box in one bramble, in its own local space: the tangle runs along X and the trail passes
 * through it along Z. Exported so the proportions can be checked without a browser.
 *
 * A LATTICE, not a wall. Canes lean alternately left and right and cross each other, with thorns
 * poking out of the crossings -- which is the difference between reading as "brambles" and reading
 * as "someone painted a fence black". The pattern is fixed and index-driven, never random: both
 * players' iPads have to draw the same bush.
 */
export function brambleParts(spanMeters) {
  const parts = [];
  // One cane every 38 cm. 55 cm was the first number and the running game
  // (.local/runtime-test/bramble-b1-standing-at-it.png) showed daylight between the canes -- it read
  // as a handful of black sticks rather than as a tangle you could not push through. Density is free
  // here: the whole thing is merged into one geometry and costs one draw call either way.
  const canes = Math.max(3, Math.round(spanMeters / 0.38));
  for (let i = 0; i < canes; i += 1) {
    const t = canes === 1 ? 0.5 : i / (canes - 1);
    const x = (t - 0.5) * spanMeters;
    // Alternating lean, and a height that dips in the middle of each pair, so the top edge is ragged
    // rather than a ruled line.
    const lean = (i % 2 === 0 ? 1 : -1) * (0.34 + (i % 3) * 0.09);
    const height = BRAMBLE_HEIGHT_METERS * (0.72 + ((i * 7) % 5) * 0.07);
    const depth = ((i % 4) - 1.5) * 0.22;
    parts.push({
      name: 'cane',
      size: [CANE_THICKNESS_METERS, height, CANE_THICKNESS_METERS],
      at: [x, height / 2, depth],
      roll: lean,
    });
    // One thorn per cane, out of its upper third, on the side it leans away from.
    parts.push({
      name: 'thorn',
      size: [THORN_LENGTH_METERS, THORN_THICKNESS_METERS, THORN_THICKNESS_METERS],
      at: [x - Math.sign(lean) * THORN_LENGTH_METERS * 0.45, height * 0.72, depth],
      roll: -lean * 0.6,
    });
  }
  // Two long runners threaded through the canes, low down, which is what ties the lattice together
  // into one mass instead of a row of sticks.
  for (const [y, roll] of [[0.26, 0.05], [0.62, -0.04]]) {
    parts.push({ name: 'runner', size: [spanMeters, CANE_THICKNESS_METERS * 0.8, CANE_THICKNESS_METERS * 0.8], at: [0, y, 0.1], roll });
  }
  return parts;
}

function slab([width, height, depth], [x, y, z], rollRadians = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const matrix = new THREE.Matrix4();
  if (rollRadians !== 0) matrix.makeRotationZ(rollRadians);
  matrix.setPosition(x, y, z);
  geometry.applyMatrix4(matrix);
  return geometry;
}

// How long the tangle takes to collapse once the last blow lands. Long enough to WATCH -- the reward
// for cutting it is seeing it go -- and short enough that a child does not stand waiting to walk on.
export const BRAMBLE_FALL_SECONDS = 0.55;
// How far a struck-but-not-broken bramble flinches, as a fraction of its own size, ONE ENTRY PER
// BLOW LANDED SO FAR (not per BRAMBLE_BLOWS_TO_CUT -- trail.js owns that number, this file does not
// import it, same separation the module header above already states). A flat flinch made every hit
// on a three-blow tangle look identical, which is not what "getting somewhere" should look like on
// the second hit versus the first. Longer than this array and later hits repeat its last entry.
const HIT_SHRINK_BY_BLOW = [0.09, 0.16];
const HIT_FLINCH_SECONDS = 0.22;
// The tangle darkens permanently with each landed blow -- "stronger damaged silhouette/value
// change" in the brief's own words, "value" meaning darkness in the painter's sense. Kept separate
// from the flinch (which recoils back to nothing) because this is the part that STAYS: a bramble
// hit twice should still look hit twice a second later, not just while it is recoiling.
// Measured, not eyeballed (AGENTS.md: do not trust your eye on colour in a capture -- sample the
// pixel): the first version, 0.22 toward a near-black in the SAME violet hue as BRAMBLE_COLOR,
// sampled #2b1f33 -> #271c2e -> #231929 over two hits, a ~20% channel drop invisible at a glance
// against a busy forest. Ash-grey rather than a darker violet reads as damaged rather than merely
// dim, and 0.4/hit makes two hits unmistakable rather than measured-but-not-seen.
const HIT_DARKEN_COLOR = 0x2f2b26;
const HIT_DARKEN_PER_BLOW = 0.4;

/**
 * Build one bramble and put it in the scene.
 *
 * @param scene the scene to add to
 * @param spec  `{ at: [x, z], rotY, spanMeters }` from the zone data
 * @returns `{ at, spanMeters, hit(blowsLanded, broken), isGone(), update(deltaSeconds) }`
 *
 * The presenter owns only how it LOOKS -- how many blows it takes and whether this player has cut it
 * lives in world/trail.js with the rest of the trail's rules, for the same reason the relight's
 * timeline is separate from the tree that plays it.
 */
export function buildBramble(scene, spec) {
  const merged = mergeGeometries(
    brambleParts(spec.spanMeters).map((part) => slab(part.size, part.at, part.roll ?? 0)),
    false,
  );
  const baseColor = new THREE.Color(BRAMBLE_COLOR);
  const darkColor = new THREE.Color(HIT_DARKEN_COLOR);
  const material = new THREE.MeshStandardMaterial({
    color: baseColor.clone(),
    roughness: 1,
    metalness: 0,
    flatShading: true,
    // Transparent from the START, not switched on when it begins to fall: flipping `transparent`
    // mid-session makes three.js re-evaluate the material, and taking that hitch at the exact moment
    // a child lands the winning blow is the worst possible time to take it. Same reasoning
    // zoneLoader.js gives for the Keeper's fade-when-in-the-way materials.
    transparent: true,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = `bramble-${spec.at[0]}-${spec.at[1]}`;
  mesh.position.set(spec.at[0], 0, spec.at[1]);
  mesh.rotation.y = spec.rotY ?? 0;
  setLayer(mesh, WORLD);
  scene.add(mesh);

  let flinchSeconds = -1;
  let flinchAmount = HIT_SHRINK_BY_BLOW[0];
  let fallSeconds = -1;

  return {
    at: spec.at,
    spanMeters: spec.spanMeters,
    /**
     * A blow landed. `blowsLanded` is this bramble's own running total (1 on the first hit, 2 on
     * the second, ...); `broken` says whether it was the last one.
     */
    hit(blowsLanded, broken) {
      if (broken) { fallSeconds = 0; return; }
      flinchSeconds = 0;
      flinchAmount = HIT_SHRINK_BY_BLOW[Math.min(blowsLanded - 1, HIT_SHRINK_BY_BLOW.length - 1)];
      // Permanent, unlike the flinch: still this dark a second later, so two hits still LOOKS like
      // two hits rather than only feeling like it for the quarter-second the recoil plays.
      material.color.lerpColors(baseColor, darkColor, Math.min(1, blowsLanded * HIT_DARKEN_PER_BLOW));
    },
    isGone: () => fallSeconds >= BRAMBLE_FALL_SECONDS,
    update(deltaSeconds) {
      if (fallSeconds >= 0) {
        fallSeconds += deltaSeconds;
        const t = Math.min(1, fallSeconds / BRAMBLE_FALL_SECONDS);
        // It goes DOWN and out, not out alone: scaling y toward nothing while the footprint stays
        // reads as the tangle collapsing into the grass, where a plain fade reads as a ghost.
        mesh.scale.set(1 + t * 0.12, Math.max(0.001, 1 - t), 1 + t * 0.12);
        material.opacity = 1 - t * t;
        if (t >= 1) mesh.visible = false;
        return;
      }
      if (flinchSeconds >= 0) {
        flinchSeconds += deltaSeconds;
        const t = Math.min(1, flinchSeconds / HIT_FLINCH_SECONDS);
        // Out and back, so the recoil ends exactly where it started and repeated hits cannot drift.
        const swell = Math.sin(t * Math.PI) * flinchAmount;
        mesh.scale.set(1 + swell, 1 - swell, 1 + swell);
        if (t >= 1) { flinchSeconds = -1; mesh.scale.set(1, 1, 1); }
      }
    },
  };
}
