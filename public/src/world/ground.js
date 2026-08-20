import * as THREE from '../../vendor/three.module.min.js';
import { WORLD } from '../render/layers.js';
import { ROAD, ZONE } from './zones/village.js';

// Phase Y/Task C: the flat single-colour ground plane read as props scattered on a test pad -- see
// the brief's own "Replace the flat green test-pad read with one integrated ground + road". This is
// ONE mesh (one BufferGeometry, one material, one draw call): road colour is a per-VERTEX property
// of the SAME surface the grass is, not a second coplanar plane laid on top of it. There is no
// z-fighting risk to avoid by discipline, because there is no second surface for the road to fight
// -- "no z-fighting by construction" is literal here, not a tuned tolerance.
const GRASS_COLOR = new THREE.Color(0x8fb583);
// THE MEADOW. The grass is the single biggest surface in every frame of this game and it was one
// flat colour edge to edge, which is what made an otherwise pretty village read as models standing
// on a snooker table. These two tones are lerped across the ground by a slow deterministic field
// below, so the field has broad patches of lighter and deeper green the way a real meadow does.
//
// Their MIDPOINT is GRASS_COLOR to within a bit per channel, on purpose: the 140 m distance skirt is
// a flat quad in GRASS_COLOR and the playable ground's edge has to meet it invisibly. Vary the two
// tones and that seam opens up 14 m from where a child can stand, well inside the fog.
//
// Costs nothing: same vertices, same one mesh, same one draw call. Only the colours written into
// the buffer change.
const GRASS_DEEP = new THREE.Color(0x83a97b);
const GRASS_PALE = new THREE.Color(0x9cbe89);
// Warm muted earth/tan -- "Look before you derive" (AGENTS.md): checked against WoW's own dirt-road
// screenshots (Goldshire) before picking a value, all warm mid-brown, none saturated or grey.
const ROAD_COLOR = new THREE.Color(0xab8a5f);
// 0.5, not 1. Vertex colours are interpolated across a cell, so a 1 m grid smeared the road's
// 0.6 m soft edge across a further metre in each direction and quantised the road's own curve into
// visible diagonal steps -- a 4 m road had five vertices across it. Looked at in the running game,
// that read as a stain on the grass rather than as a path. At 0.5 m the mesh is 57x57 vertices
// (6,272 triangles against 1,568), which is nothing next to the 15,642-triangle hero, and it is
// still ONE mesh and ONE draw call.
const CELL_METERS = 0.5;
// Smoothstep band width across the road edge, not a hard cutoff -- the brief's own "subtly
// irregular rather than ruler-perfect" edge, without adding procedural noise (brief: "do not
// overengineer procedural terrain"). The 1m grid's own quantisation does the rest.
// 0.35, down from 0.6. That value was chosen against the 1 m grid, where the grid's own
// quantisation was doing half the softening; on the 0.5 m grid the two compounded and the lane to
// the wolf photographed as a fuzzy mud patch rather than a path with sides.
const ROAD_EDGE_SOFTEN_METERS = 0.35;
// Wide enough that its own edge is past render/sky.js's FOG_FAR from anywhere a player can stand:
// the walkable world is +/-13 and the camera sits up to 18 m further out, so 70 m of half-width
// leaves ~39 m of fully fogged grass beyond the furthest thing a child can look at.
const GROUND_SKIRT_METERS = 140;

// ── pure helpers (unit-testable with no three.js, no DOM) ──────────────────────────────────────

/** Shortest distance from point (px,pz) to the line segment (ax,az)-(bx,bz). A zero-length segment
 *  degrades to point-to-point distance rather than dividing by zero. */
export function distanceToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Shortest distance from (px,pz) to a polyline through `points` ([[x,z], ...], at least 2 points
 *  -- the shape a road's own control-point list is). */
export function distanceToPolyline(px, pz, points) {
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    min = Math.min(min, distanceToSegment(px, pz, ax, az, bx, bz));
  }
  return min;
}

/** 1 (fully road) at the centreline out to 0 (fully grass) past the road's half-width, smoothstep-
 *  blended across a `softenMeters`-wide band straddling the edge rather than a hard cutoff. A point
 *  exactly on the centreline (distance 0) is always 1; a point far outside is always 0, regardless
 *  of how wide the soften band is -- the band only shapes the transition, never the extremes. */
export function roadBlend(distance, halfWidth, softenMeters) {
  const inner = halfWidth - softenMeters / 2;
  const outer = halfWidth + softenMeters / 2;
  if (distance <= inner) return 1;
  if (distance >= outer) return 0;
  const t = (distance - inner) / (outer - inner);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Where a point sits between the two grass tones: 0 is deepest, 1 is palest, 0.5 is the average the
 * distance skirt is painted.
 *
 * Three sine octaves rather than a noise function or a texture. It has to be DETERMINISTIC (the same
 * ground every load, and the same ground for both brothers on two iPads), it has to be readable by a
 * test, and it is evaluated once per vertex at load and never again -- so the cheapest thing that
 * makes broad, non-repeating-looking patches wins. Periods of about 17 m, 20 m and 7.6 m against a
 * 28 m zone: a handful of large patches with a little variation inside them, not a rash of speckles.
 * The 0.5 m vertex grid resolves all three comfortably.
 */
export function meadowBlend(x, z) {
  const broad = Math.sin(x * 0.37 + 1.7) * Math.cos(z * 0.31 - 0.4);
  const cross = Math.sin((x + z) * 0.83 + 2.9) * 0.45;
  const fine = Math.sin(x * 1.9 - 0.8) * Math.sin(z * 1.7 + 2.1) * 0.16;
  const value = 0.5 + (broad + cross + fine) * 0.31;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// ── geometry ─────────────────────────────────────────────────────────────────────────────────

/**
 * The rectangle the ground mesh covers, from the zone's own numbers.
 *
 * It used to be implicit: `size`x`size` centred on the origin. On 2026-08-15 the world grew north
 * for the Wildwood (see ZONE in zones/village.js), so the extent is no longer square and no longer
 * centred, and the one place that knows how to read that out of zone data is here.
 */
export function groundBounds(zone) {
  const half = zone.size / 2;
  return { minX: -half, maxX: half, minZ: -half, maxZ: half + (zone.northMeters ?? 0) };
}

/** Builds the ONE ground BufferGeometry over `bounds` ({minX,maxX,minZ,maxZ}, from groundBounds())
 *  at `cellMeters` resolution, flat on Y=0 already (no post-hoc rotation), every vertex coloured by
 *  its road-blend against `road` (village.js's ROAD, or undefined for plain grass -- a zone with no
 *  road stays grass-only rather than throwing). Exported so a test can inspect vertex colours
 *  directly without touching the DOM. */
export function buildGroundGeometry(bounds, road, cellMeters = CELL_METERS) {
  const { minX, maxX, minZ, maxZ } = bounds;
  const columns = Math.round((maxX - minX) / cellMeters);
  const rows = Math.round((maxZ - minZ) / cellMeters);
  const verticesPerRow = columns + 1;
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const halfWidth = road ? road.widthMeters / 2 : 0;

  for (let iz = 0; iz <= rows; iz += 1) {
    for (let ix = 0; ix <= columns; ix += 1) {
      const x = minX + ix * cellMeters;
      const z = minZ + iz * cellMeters;
      positions.push(x, 0, z);
      normals.push(0, 1, 0);
      const blend = road
        ? roadBlend(distanceToPolyline(x, z, road.points), halfWidth, ROAD_EDGE_SOFTEN_METERS)
        : 0;
      // Meadow first, road second, so a vertex fully on the road is EXACTLY ROAD_COLOR and the path
      // stays a clean path rather than picking up the field's mottling.
      const color = GRASS_DEEP.clone().lerp(GRASS_PALE, meadowBlend(x, z)).lerp(ROAD_COLOR, blend);
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let iz = 0; iz < rows; iz += 1) {
    for (let ix = 0; ix < columns; ix += 1) {
      const a = iz * verticesPerRow + ix;
      const b = a + 1;
      const c = a + verticesPerRow;
      const d = c + 1;
      // (a, c, b) and (b, c, d): both wind counter-clockwise viewed from +Y, matching the (0,1,0)
      // normals above -- verified by cross product at authoring time, and by the running game (a
      // backwards winding here would cull the whole ground to invisible, not subtly misrender it).
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

export function createGround() {
  const world = new THREE.Group();
  world.name = 'world-ground';

  const bounds = groundBounds(ZONE);
  const ground = new THREE.Mesh(
    buildGroundGeometry(bounds, ROAD),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
  );
  ground.name = 'ground';
  world.add(ground);

  // THE SKIRT. One flat quad, 140 m across, in the same grass colour, a centimetre below the real
  // ground and drawn before it.
  //
  // It exists because the 28x28 playable ground has a visible edge and a child can see it. Standing
  // in the wilderness looking south, the ground simply STOPS on a hard horizontal line with open
  // sky underneath -- caught in .local/runtime-test/fight-swing-contact.png, where the far edge cuts
  // straight across the frame between the trees. render/sky.js's fog was meant to dissolve it and
  // does not reach: the far edge is only ~28 m from the camera and the fog is barely 18% there.
  // Pushing the fog in far enough to hide it would also wash out the village, which is the part
  // worth looking at.
  //
  // Two triangles and one draw call answer it completely instead: the grass now runs past the fog's
  // own far plane in every direction, so the horizon is a soft fade to the sky's own colour rather
  // than a cut edge, from anywhere in the world and at any camera angle. Nothing walks on it -- the
  // hero is clamped to WORLD_LIMIT (world/bounds.js) long before its edge -- it is scenery.
  //
  // Same material family and the same GRASS_COLOR the detailed mesh's own edge vertices carry, so
  // the seam between them is invisible; 0.01 m below, so there is no z-fighting to tune.
  const skirt = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SKIRT_METERS, GROUND_SKIRT_METERS),
    new THREE.MeshStandardMaterial({ color: GRASS_COLOR, roughness: 0.9, metalness: 0 }),
  );
  skirt.name = 'ground-skirt';
  skirt.rotation.x = -Math.PI / 2;
  // CENTRED ON THE GROUND, not on the origin. It was the same thing until the world grew north on
  // 2026-08-15; after that a skirt still centred at z=0 put its own far edge only 70 m from the
  // origin but just 35 m from the north end of the trail -- and the camera sits up to 18 m further
  // out again, which brings that hard edge inside FOG_NEAR and back into frame. Derived from the
  // bounds the detailed mesh was actually built over, so it cannot drift from them.
  skirt.position.set((bounds.minX + bounds.maxX) / 2, -0.01, (bounds.minZ + bounds.maxZ) / 2);
  skirt.renderOrder = -1;
  world.add(skirt);

  // The three untextured placeholder boxes/cylinder that used to fill this empty world (named
  // "placeholder-prop-N" for exactly this reason) are GONE as of Phase V/V3: world/zoneLoader.js
  // now populates the same space with real Kenney/Meshy props, and the placeholders had never
  // moved to make room. One of them (a plain tan box at [-3, 0.45, -2], colour 0xb98a67) sat
  // almost on top of the keeper's own spawn and the fence-gate opening -- found exactly the way
  // the "step back and look at the WHOLE picture" rule expects: a village-loader change made it
  // visible in drive-village.mjs's captures as an ugly untextured cube dominating the frame, not
  // by reading this file. The ground plane and the two lights below are what the brief calls
  // "ground.js keeps its API" -- the placeholder DECORATION was never part of that promise.
  const hemi = new THREE.HemisphereLight(0xd8edff, 0x5d6c4d, 1.8);
  hemi.name = 'world-wrap-light';
  world.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d0, 2.2);
  sun.name = 'world-key-light';
  sun.position.set(-4, 8, 5);
  world.add(sun);

  world.traverse((object) => object.layers.set(WORLD));
  return world;
}
