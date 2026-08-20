// public/src/world/coldSeals.js
//
// THE THREE COLD SEALS: the corruption holding the Old Beacon cold, as three things a child can hit.
//
// The Beacon arc's whole gameplay sentence is "break what is keeping it cold, then face what put it
// there". The seals are the first clause. Each one is a chunky cluster of corrupted ice-crystal
// prisms grown up through a frost-rimed base ring at the Beacon's feet -- the same cold family as
// the dead fire in the cresset above them (BEACON_EMBER_COLD_COLOR, imported rather than restated,
// docs/MISTAKES.md GQ-007), so a child reads them as pieces of the SAME wrongness without a line of
// dialogue. One pale-cyan accent prism per seal in the Beacon's own halo colour is what makes them
// read as magic rather than as rocks.
//
// Built the way world/oldBeacon.js builds the tower: every part baked into ONE BufferGeometry with
// its colour as a vertex attribute, so a whole multi-coloured seal costs one draw call. This is an
// iPad, and there are three of these on screen at once with a Warden walking between them.
//
// Attackable exactly the way world/bramble.js is attackable: the presenter owns only how a seal
// LOOKS. How many blows one takes and whose sword landed them lives with the siege rules, for the
// same reason bramble.js does not import BRAMBLE_BLOWS_TO_CUT. And like the bramble, every shape in
// here is FIXED and index-driven, never Math.random -- both players' iPads have to draw the same
// three seals.

import * as THREE from '../../vendor/three.module.min.js';
import { mergeGeometries } from '../../vendor/utils/BufferGeometryUtils.js';
import { WORLD, setLayer } from '../render/layers.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { prefersReducedMotion } from '../render/motionPreference.js';
import {
  BEACON_EMBER_COLD_COLOR,
  BEACON_GLOW_COLOR,
  BEACON_STONE_COLOR,
} from './oldBeacon.js';
import { BRAMBLE_FALL_SECONDS } from './bramble.js';

// ── the shape ─────────────────────────────────────────────────────────────────────────────────────

// Index-driven variation, one entry per seal. Three identical seals would read as a prop repeated;
// three that differ in count and height read as three growths of the same sickness. The heights sit
// in a 1.0-1.2 m band: waist-to-chest on the 1.48 m hero, tall enough to be a THING a sword answers,
// short enough that all three plus the Warden fit one gameplay frame at the Beacon's base without
// hiding the tower that is the point of the place.
export const SEAL_HEIGHTS_METERS = [1.12, 1.0, 1.2];
export const SEAL_SHARD_COUNTS = [5, 4, 6];
// The frost ring the shards grow through. Wider than the shard cluster so each seal has a FOOT --
// a cluster of leaning prisms with no base reads as debris, one growing out of a rimed plate reads
// as rooted, which is what makes hitting it feel like breaking a hold rather than kicking litter.
export const SEAL_RING_RADIUS_METERS = 0.95;
const SEAL_RING_HEIGHT_METERS = 0.12;
// No shard face thinner than this. docs/GALAQUEST_VISUAL_AUTHORITY.md's detail floor exists because
// thin geometry vanishes at play size; these are hit targets and must survive at 90 px.
export const SEAL_SHARD_MIN_DIAMETER_METERS = 0.12;

// The wound. One blow splays every prism outward by a fixed amount and pushes it off its root --
// large enough that the cracked silhouette differs from the intact one at gameplay distance (the
// bramble's lesson: a 20% change you can measure but not SEE is not feedback). Fixed, not eased:
// the splay is baked into a second merged geometry, see buildColdSeals below.
export const SEAL_CRACK_SPLAY_RADIANS = 0.26;
export const SEAL_CRACK_SPREAD = 1.16;
// The cracked accent brightens toward white -- computed from BEACON_GLOW_COLOR rather than stated
// as a second hex that could drift away from it (GQ-007 again).
export const SEAL_ACCENT_CRACKED_COLOR = new THREE.Color(BEACON_GLOW_COLOR)
  .lerp(new THREE.Color(0xffffff), 0.45).getHex();

/**
 * Every part of one seal in its own local space, y = 0 the ground. `blows >= 1` returns the CRACKED
 * shape. Exported so proportions, chunkiness, determinism and the intact/cracked difference can all
 * be asserted under plain `node --test` -- the same split oldBeacon.js's beaconParts() makes, and for
 * the same reason: the thing most likely to go wrong here is a number.
 */
export function sealParts(index, blows = 0) {
  const cracked = blows >= 1;
  const count = SEAL_SHARD_COUNTS[index % SEAL_SHARD_COUNTS.length];
  const tall = SEAL_HEIGHTS_METERS[index % SEAL_HEIGHTS_METERS.length];
  const parts = [];

  parts.push({
    name: 'ring',
    kind: 'cylinder',
    radiusBottom: SEAL_RING_RADIUS_METERS,
    radiusTop: SEAL_RING_RADIUS_METERS * 0.9,
    height: SEAL_RING_HEIGHT_METERS,
    at: [0, SEAL_RING_HEIGHT_METERS / 2, 0],
    // The Beacon's own stone, frost-dulled by the flat shading: the ring ties the seal to the plinth
    // it besieges instead of introducing a fourth material.
    color: BEACON_STONE_COLOR,
    radialSegments: 8,
  });

  // The prisms. Six-sided tapered cylinders -- CHUNKY, silhouette first: at the distance these are
  // fought at, a thin crystal is a flicker and a fat one is a shape. Each leans OUTWARD from the
  // cluster's centre (yaw = angle + PI/2 aims the roll's tilt along the radial -- same Euler 'YZX'
  // convention bakePart uses), so the cluster reads as something that erupted rather than a fence.
  const accentIndex = index % count;
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + index * 0.7;
    // Shard 0 IS the seal's stated height, exactly, so the test can pin the constant against the
    // parts through a separate code path. The others step down in a fixed pattern.
    const height = i === 0 ? tall : tall * (0.55 + ((i * 5 + index) % 4) * 0.1);
    const lean = 0.14 + (i % 3) * 0.05 + (cracked ? SEAL_CRACK_SPLAY_RADIANS : 0);
    const footRadius = (0.3 + (i % 2) * 0.14) * (cracked ? SEAL_CRACK_SPREAD : 1);
    parts.push({
      name: i === accentIndex ? 'accent-shard' : 'shard',
      kind: 'cylinder',
      radiusBottom: 0.16 + (i % 2) * 0.04,
      radiusTop: 0.07 + ((i + index) % 2) * 0.03,
      height,
      at: [Math.sin(angle) * footRadius, height / 2, Math.cos(angle) * footRadius],
      yaw: angle + Math.PI / 2,
      roll: lean,
      color: i === accentIndex
        ? (cracked ? SEAL_ACCENT_CRACKED_COLOR : BEACON_GLOW_COLOR)
        : BEACON_EMBER_COLD_COLOR,
      radialSegments: 6,
    });
  }
  return parts;
}

// ── the glow ──────────────────────────────────────────────────────────────────────────────────────

// The seal's cold shine, in the Beacon halo's own colour. WELL below the gate lamp's lit 0.9 (see
// wildwoodGate.js's LAMP_GLOW_STRENGTH) and below even the Beacon's arrival stir peak: this is
// wrongness leaking, not a light, and the whole zone's grammar depends on warm-and-bright meaning
// "won" -- see BEACON_GLOW_REST's own comment for the rule these numbers obey.
export const SEAL_GLOW_REST = 0.22;
// The jump on the first blow. A wounded seal shines HARDER -- the sickness pushed back -- which
// tells a child the hit counted even if they blinked through the splay. Still under the stir's 0.62
// and nowhere near a lit lamp.
export const SEAL_GLOW_CRACKED = 0.48;
export const SEAL_GLOW_SIZE_METERS = 1.05;
// Slow cold shimmer while intact. Slower than the wolf spark's 0.55 Hz warm pulse on purpose: warm
// light in this game breathes like a living thing, this crawls.
export const SEAL_SHIMMER_HZ = 0.3;
export const SEAL_SHIMMER_DEPTH = 0.25;

/** The intact seal's shimmering strength at a moment. Pure, so the shimmer's bounds are assertable
 *  without a canvas -- the same split beaconStirStrength() makes. */
export function sealShimmerStrength(seconds) {
  return SEAL_GLOW_REST * (1 + Math.sin(seconds * SEAL_SHIMMER_HZ * Math.PI * 2) * SEAL_SHIMMER_DEPTH);
}

// ── the collapse ──────────────────────────────────────────────────────────────────────────────────

// The bramble's own tempo, imported rather than restated: breaking a thing in this world takes one
// consistent beat to watch, whether it is thorns or ice. If the bramble's fall is ever retuned the
// seals follow for free.
export const SEAL_FALL_SECONDS = BRAMBLE_FALL_SECONDS;

/**
 * One frame of the collapse, pure. Mirrors the bramble's shape exactly -- down and slightly out,
 * opacity trailing as t*t -- because "sinks into the grass" is the read that made the bramble's
 * death legible and there is no reason to invent a second vocabulary for the same verb.
 */
export function sealCollapseFrame(elapsedSeconds) {
  const t = Math.min(1, Math.max(0, elapsedSeconds) / SEAL_FALL_SECONDS);
  return {
    scaleY: Math.max(0.001, 1 - t),
    scaleXZ: 1 + t * 0.12,
    opacity: 1 - t * t,
    done: elapsedSeconds >= SEAL_FALL_SECONDS,
  };
}

// The spark burst on the killing blow -- rewards/markSpark.js's idiom (a pure per-frame function
// driving pooled glow sprites), in the seal's cold colour instead of the mark's warm one. Five
// sprites at FIXED angles: enough to read as a shatter, and both iPads draw the same shatter.
export const SEAL_BURST_SPARKS = 5;
export const SEAL_BURST_SECONDS = 0.45;
const BURST_REACH_METERS = 0.95;
const BURST_LIFT_METERS = 0.55;
const BURST_START_HEIGHT_METERS = 0.55;
const BURST_SIZE_METERS = 0.42;

/**
 * One frame of one burst spark's flight, pure. Out and up on a decaying arc, bright immediately
 * (the blow just landed -- a fade-in would arrive late), gone before the collapse finishes so the
 * seal's last visible frame is the ground, not a floating light.
 */
export function sealBurstFrame(elapsedSeconds) {
  const t = Math.min(1, Math.max(0, elapsedSeconds) / SEAL_BURST_SECONDS);
  return {
    out01: 1 - (1 - t) * (1 - t),
    liftMeters: Math.sin(Math.PI * Math.min(1, t * 1.2)) * BURST_LIFT_METERS,
    strength01: t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) / 0.5),
    sizeMeters: BURST_SIZE_METERS * (1 - t * 0.55),
    done: elapsedSeconds >= SEAL_BURST_SECONDS,
  };
}

// ── the baking ────────────────────────────────────────────────────────────────────────────────────

/**
 * One part baked into local space with its colour written into a vertex attribute, so a whole
 * multi-coloured structure merges into ONE geometry and ONE draw call.
 *
 * The same bake world/oldBeacon.js performs privately (its bakedPart); restated here because that
 * one is deliberately unexported and this file cannot edit it. Exported from HERE so
 * enemies/warden.js can import it instead of writing a third copy -- two copies is the ceiling,
 * three is the drift GQ-007 exists to stop.
 */
export function bakePart(part) {
  const geometry = part.kind === 'box'
    ? new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2])
    : new THREE.CylinderGeometry(
      part.radiusTop, part.radiusBottom, part.height,
      part.radialSegments ?? 8, 1, part.openEnded === true,
    );
  const matrix = new THREE.Matrix4();
  matrix.makeRotationFromEuler(new THREE.Euler(0, part.yaw ?? 0, part.roll ?? 0, 'YZX'));
  matrix.setPosition(part.at[0], part.at[1], part.at[2]);
  geometry.applyMatrix4(matrix);

  const color = new THREE.Color(part.color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // mergeGeometries refuses a set whose attributes disagree -- nothing here is textured, so uv is
  // ballast. Same note as oldBeacon.js's bake.
  geometry.deleteAttribute('uv');
  return geometry;
}

function sealMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
    // Transparent from the START, not switched on when the collapse begins: flipping `transparent`
    // mid-session makes three.js re-evaluate the material, and the frame a child lands the breaking
    // blow is the worst moment to hitch. Same reasoning as bramble.js and the wolf's dissolve.
    transparent: true,
    depthWrite: true,
  });
}

// ── the presenter ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build the three cold seals and put them in the scene.
 *
 * @param scene    the scene to add to
 * @param sealsAt  `[[x, z], ...]` from the zone data -- index in this array IS the seal's identity,
 *                 which is what keeps both players' seal number two the same shape.
 * @returns one presenter per seal: `{ at, setBlows(blows, burst), update(deltaSeconds), isGone() }`
 *
 * The presenter owns LOOKS only. Blows landed, who may hit what, and when a seal is truly broken
 * belong to the siege rules, exactly as bramble.js defers to world/trail.js.
 */
export function buildColdSeals(scene, sealsAt) {
  return (sealsAt ?? []).map(([x, z], index) => {
    const mesh = new THREE.Mesh(
      mergeGeometries(sealParts(index, 0).map(bakePart), false),
      sealMaterial(),
    );
    mesh.name = `cold-seal-${index}`;
    mesh.position.set(x, 0, z);
    setLayer(mesh, WORLD);
    scene.add(mesh);
    // The cracked shape, built NOW rather than on the first hit, so taking the wound never costs a
    // frame -- the same buy-it-at-load trade the transparent flag above makes.
    const crackedGeometry = mergeGeometries(sealParts(index, 1).map(bakePart), false);

    const tall = SEAL_HEIGHTS_METERS[index % SEAL_HEIGHTS_METERS.length];
    const glow = createGlowSprite(BEACON_GLOW_COLOR, SEAL_GLOW_SIZE_METERS);
    glow.name = `cold-seal-glow-${index}`;
    setLayer(glow, WORLD);
    glow.position.set(x, tall * 0.55, z);
    setGlowStrength(glow, SEAL_GLOW_REST);
    scene.add(glow);

    // The burst pool: made at build time, hidden, spent once. Three seals never burst twice, so
    // this is markSpark.js's pool idea collapsed to its one-shot case -- the sprites still exist
    // BEFORE the killing blow so nothing is constructed on the frame that matters.
    const sparks = [];
    for (let s = 0; s < SEAL_BURST_SPARKS; s += 1) {
      const spark = createGlowSprite(BEACON_GLOW_COLOR, BURST_SIZE_METERS, 'mote');
      spark.name = `cold-seal-burst-${index}-${s}`;
      setLayer(spark, WORLD);
      scene.add(spark);
      sparks.push(spark);
    }

    let blowsShown = 0;
    let shimmerSeconds = index * 1.7; // desynchronised starts, fixed per index -- never random
    let fallSeconds = -1;
    let burstSeconds = -1;
    let gone = false;

    function vanishInstantly() {
      mesh.visible = false;
      setGlowStrength(glow, 0);
      for (const spark of sparks) setGlowStrength(spark, 0);
      gone = true;
    }

    return {
      at: [x, z],
      /**
       * The siege rules report this seal's state. `blows` is its running total of landed hits;
       * `burst` means the last one broke it. Idempotent per state, so a rejoin that replays the
       * current totals lands on the right picture.
       */
      setBlows(blows, burst) {
        if (gone || fallSeconds >= 0) return;
        if (burst) {
          // Under reduced motion the collapse and the shatter are skipped whole: the seal is
          // simply gone, the same "nothing is LOST, only the nonessential movement" contract the
          // Beacon's own stir keeps.
          if (prefersReducedMotion()) { vanishInstantly(); return; }
          fallSeconds = 0;
          burstSeconds = 0;
          return;
        }
        if (blows >= 1 && blowsShown === 0) {
          // The wound: the pre-built splayed geometry with the brightened accent. A swap, not a
          // tween -- ice breaks, it does not bend.
          mesh.geometry = crackedGeometry;
          setGlowStrength(glow, SEAL_GLOW_CRACKED);
        }
        blowsShown = Math.max(blowsShown, blows);
      },
      isGone: () => gone,
      update(deltaSeconds) {
        if (gone) return;
        if (fallSeconds >= 0) {
          fallSeconds += deltaSeconds;
          burstSeconds += deltaSeconds;
          const fall = sealCollapseFrame(fallSeconds);
          mesh.scale.set(fall.scaleXZ, fall.scaleY, fall.scaleXZ);
          mesh.material.opacity = fall.opacity;
          setGlowStrength(glow, SEAL_GLOW_CRACKED * fall.opacity);
          const beat = sealBurstFrame(burstSeconds);
          for (let s = 0; s < sparks.length; s += 1) {
            const angle = (s / sparks.length) * Math.PI * 2 + index; // fixed fan, per-seal offset
            sparks[s].position.set(
              x + Math.sin(angle) * beat.out01 * BURST_REACH_METERS,
              BURST_START_HEIGHT_METERS + beat.liftMeters,
              z + Math.cos(angle) * beat.out01 * BURST_REACH_METERS,
            );
            sparks[s].scale.setScalar(beat.sizeMeters);
            setGlowStrength(sparks[s], beat.done ? 0 : beat.strength01);
          }
          if (fall.done) vanishInstantly();
          return;
        }
        // Intact: the slow cold shimmer. Skipped under reduced motion (checked per frame, like the
        // wolf's flash, so an OS toggle takes effect without a reload); cracked seals hold their
        // brighter strength steady -- the jump IS the message, a wobble would blur it.
        if (blowsShown === 0 && !prefersReducedMotion()) {
          shimmerSeconds += deltaSeconds;
          setGlowStrength(glow, sealShimmerStrength(shimmerSeconds));
        }
      },
    };
  });
}
