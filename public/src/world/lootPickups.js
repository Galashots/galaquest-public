// public/src/world/lootPickups.js
//
// GP2's physical loot, as something you SEE: coins and Wildwood Shards that burst out of the
// searched cart, land, sit, and are drawn to whichever hero reaches them.
//
// Presenter only -- everything here is driven by world/cartLoot.js's published state (spawned,
// collected) plus a live hero position to fly toward, the same "pure rules module, separate DOM/
// three.js presenter" split combat/encounter.js + wolf.js and world/trail.js + bramble.js already
// use. Nothing here decides WHETHER a pickup is collected -- that is the server's job, enforced in
// cartLoot.js's requestCollectLoot; this only decides how a pickup that already IS collected (per the
// last snapshot) gets from "sitting on the ground" to "gone", and how one that is not yet collected
// looks while it waits.
//
// Coin vs Shard is told apart FOUR ways, not by colour alone (the Engagement & Reward Quality Gate's
// own GP2 rule): silhouette (a flat disc vs a faceted spike), scale (the shard is visibly the bigger
// object), motion (the coin spins cleanly on one axis like a spun coin; the shard tumbles on two axes
// with an unrelated vertical bob -- an unmistakably different, less orderly motion), and pickup sound
// (audio/recipes.js's coin-chime vs shard-resonance, deliberately opposite shapes -- see that file).

import * as THREE from '../../vendor/three.module.min.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { WORLD, setLayer } from '../render/layers.js';
import { CART_LOOT_TABLE, COIN_KIND, pickupWorldPosition } from './cartLoot.js';

const COIN_COLOR = 0xf2c14e;
const COIN_RADIUS_METERS = 0.1;
const COIN_THICKNESS_METERS = 0.02;
const COIN_SPIN_RADIANS_PER_SECOND = 5.2;
const COIN_REST_HEIGHT_METERS = 0.14;

// Deliberately not WILDWOOD_COLOR (world/wildwoodBlade.js / the GP1-C2 hero-preview marker already
// own that teal for "a Blade is equipped") -- a Shard needs its OWN identity as a currency object, not
// a second use of a colour that already means something else on screen.
const SHARD_COLOR = 0x9b6bde;
const SHARD_RADIUS_METERS = 0.09;
const SHARD_HEIGHT_METERS = 0.26;
const SHARD_TUMBLE_X_RADIANS_PER_SECOND = 2.3;
const SHARD_TUMBLE_Z_RADIANS_PER_SECOND = 1.4;
const SHARD_BOB_RADIANS_PER_SECOND = 3.1;
const SHARD_BOB_METERS = 0.05;
const SHARD_REST_HEIGHT_METERS = 0.2;

// ── the burst: cart -> resting position ────────────────────────────────────────────────────────
export const BURST_FLIGHT_SECONDS = 0.5;
// One entry per CART_LOOT_TABLE index -- staggered launches, not five objects appearing from the cart
// in lockstep, which is what makes it read as a BURST rather than a single teleporting cluster. 0.09s
// apart: fast enough that the whole burst is over in well under a second (readable, not draggy), slow
// enough that a child watching the cart can see each one leave individually.
const BURST_STAGGER_SECONDS = 0.09;
const BURST_HOP_METERS = 1.1;

// ── attraction: resting position -> the collecting hero ───────────────────────────────────────
export const ATTRACT_FLIGHT_SECONDS = 0.4;
const ATTRACT_HOP_METERS = 0.45;
const ATTRACT_TARGET_HEIGHT_METERS = 0.9;

function ease(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Shared by both flights: an eased 0..1 travel fraction plus a parabolic hop, zero at both ends. */
function flightBeat(elapsedSeconds, flightSeconds, hopMeters) {
  const t = flightSeconds > 0 ? Math.max(0, elapsedSeconds) / flightSeconds : 1;
  const clamped = t > 1 ? 1 : t;
  return { travel01: ease(clamped), hopMeters: Math.sin(Math.PI * clamped) * hopMeters, done: t >= 1 };
}

function buildCoinMesh() {
  const geometry = new THREE.CylinderGeometry(
    COIN_RADIUS_METERS, COIN_RADIUS_METERS, COIN_THICKNESS_METERS, 20,
  );
  const material = new THREE.MeshStandardMaterial({
    color: COIN_COLOR, emissive: COIN_COLOR, emissiveIntensity: 0.25, roughness: 0.35, metalness: 0.6,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // Stood on edge, like a spinning coin, rather than lying flat -- a coin lying flat and spinning
  // about its own vertical axis barely reads as motion from a normal third-person camera angle; on
  // edge, the spin sweeps its flat face in and out of view the way a spun coin on a table does.
  mesh.rotation.z = Math.PI / 2;
  return mesh;
}

function buildShardMesh() {
  // A 5-sided cone, not a smooth one: low segment count is what makes it read as a rough, faceted
  // crystal spike rather than a smooth pointed pill -- the same "cheap geometry, deliberate facets"
  // trade bramble.js's boxes and the Hero-preview marker's flat-shaded octahedron already make.
  const geometry = new THREE.ConeGeometry(SHARD_RADIUS_METERS, SHARD_HEIGHT_METERS, 5);
  const material = new THREE.MeshStandardMaterial({
    color: SHARD_COLOR, emissive: SHARD_COLOR, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.15,
    flatShading: true,
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * One pickup's own presenter. `restPosition` and `cartPosition` are plain `{x, z}` -- the caller
 * (createLootPickups) resolves them once from cartLoot.js's own table, never restated here.
 */
function buildPickupPresenter(scene, pickup, cartPosition, restPosition, burstIndex, initiallyCollected) {
  const mesh = pickup.kind === COIN_KIND ? buildCoinMesh() : buildShardMesh();
  mesh.name = `loot-pickup-${pickup.id}`;
  mesh.visible = false;
  setLayer(mesh, WORLD);
  scene.add(mesh);

  const restHeight = pickup.kind === COIN_KIND ? COIN_REST_HEIGHT_METERS : SHARD_REST_HEIGHT_METERS;
  const staggerSeconds = burstIndex * BURST_STAGGER_SECONDS;
  // Hydration is state reconstruction, not a new ceremony. A pickup already collected in the very
  // first snapshot (restart or late join) begins gone and never flashes through the burst phase.
  let phase = initiallyCollected ? 'gone' : 'bursting';
  let elapsed = 0;
  let attractElapsed = 0;
  let attractFrom = null;
  let idleSeconds = 0;

  function applyIdleMotion(deltaSeconds) {
    idleSeconds += deltaSeconds;
    if (pickup.kind === COIN_KIND) {
      mesh.rotation.y += COIN_SPIN_RADIANS_PER_SECOND * deltaSeconds;
    } else {
      mesh.rotation.x += SHARD_TUMBLE_X_RADIANS_PER_SECOND * deltaSeconds;
      mesh.rotation.z += SHARD_TUMBLE_Z_RADIANS_PER_SECOND * deltaSeconds;
      mesh.position.y = restHeight + Math.sin(idleSeconds * SHARD_BOB_RADIANS_PER_SECOND) * SHARD_BOB_METERS;
    }
  }

  return {
    /** @returns {id, kind} the instant its attraction flight completes, else null. Everything else
     *  (bursting, resting, idle motion, instant despawn for someone else's collect) is silent. */
    update(deltaSeconds, collectedBy, selfHeroId, selfPosition) {
      if (phase === 'gone') return null;

      if (phase === 'bursting') {
        elapsed += deltaSeconds;
        if (elapsed < staggerSeconds) return null; // not launched yet
        mesh.visible = true;
        const burstElapsed = elapsed - staggerSeconds;
        const beat = flightBeat(burstElapsed, BURST_FLIGHT_SECONDS, BURST_HOP_METERS);
        mesh.position.set(
          cartPosition.x + (restPosition.x - cartPosition.x) * beat.travel01,
          beat.hopMeters + restHeight * beat.travel01,
          cartPosition.z + (restPosition.z - cartPosition.z) * beat.travel01,
        );
        if (beat.done) { phase = 'resting'; mesh.position.set(restPosition.x, restHeight, restPosition.z); }
        return null;
      }

      if (phase === 'resting') {
        if (collectedBy != null) {
          if (collectedBy === selfHeroId) {
            phase = 'attracting';
            attractElapsed = 0;
            attractFrom = mesh.position.clone();
          } else {
            // Someone else's pickup: the shared physical object is gone, so it despawns for this
            // client too (both clients observe the despawn) -- just not WITH an attraction flight
            // toward a hero this presenter has no reason to track the live position of.
            phase = 'gone';
            mesh.visible = false;
          }
          return null;
        }
        applyIdleMotion(deltaSeconds);
        return null;
      }

      // phase === 'attracting'
      attractElapsed += deltaSeconds;
      const beat = flightBeat(attractElapsed, ATTRACT_FLIGHT_SECONDS, ATTRACT_HOP_METERS);
      mesh.position.set(
        attractFrom.x + (selfPosition.x - attractFrom.x) * beat.travel01,
        attractFrom.y + (ATTRACT_TARGET_HEIGHT_METERS - attractFrom.y) * beat.travel01 + beat.hopMeters,
        attractFrom.z + (selfPosition.z - attractFrom.z) * beat.travel01,
      );
      const shrink = 1 - beat.travel01 * 0.7;
      mesh.scale.setScalar(Math.max(0.1, shrink));
      if (beat.done) {
        phase = 'gone';
        mesh.visible = false;
        return { id: pickup.id, kind: pickup.kind };
      }
      return null;
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}

/**
 * All five pickups off world/cartLoot.js's CART_LOOT_TABLE, built lazily the first time `update` sees
 * `loot.spawned === true` (never before -- nothing to show for a cart nobody has searched yet).
 *
 * @param cartAt  `[x, z]`, CART_SEARCH.at -- passed in rather than imported a second time, so a test
 *   or a future second cart could hand this a different anchor without this file caring.
 */
export function createLootPickups(scene, cartAt) {
  const cartPosition = { x: cartAt[0], z: cartAt[1] };
  const presenters = new Map();
  let built = false;

  function build(loot) {
    if (built) return;
    built = true;
    CART_LOOT_TABLE.forEach((pickup, index) => {
      const restPosition = pickupWorldPosition(pickup, cartAt);
      const initiallyCollected = loot.collected[pickup.id] != null;
      presenters.set(
        pickup.id,
        buildPickupPresenter(scene, pickup, cartPosition, restPosition, index, initiallyCollected),
      );
    });
  }

  return {
    /**
     * @param loot          this frame's cartLoot snapshot, `{ spawned, collected }`
     * @param selfHeroId    net.selfId, or null offline/before welcome
     * @param selfPosition  the local hero's own LIVE position, `{x, z}` -- read every frame, never
     *   captured, the same "track the mover, not a point in time" rule markSpark.js's own update()
     *   already documents.
     * @returns pickups whose attraction flight completed THIS frame -- `[{id, kind}, ...]`, usually
     *   empty. The caller (main.js) is what turns this into "bump the HUD, play the pickup sound".
     */
    update(deltaSeconds, loot, selfHeroId, selfPosition) {
      if (!loot.spawned) return [];
      build(loot);
      const arrived = [];
      for (const [pickupId, presenter] of presenters) {
        const collectedBy = loot.collected[pickupId];
        const result = presenter.update(deltaSeconds, collectedBy, selfHeroId, selfPosition);
        if (result) arrived.push(result);
      }
      return arrived;
    },
    dispose() {
      for (const presenter of presenters.values()) presenter.dispose();
      presenters.clear();
      built = false;
    },
  };
}

// ── the cart's own cheap physical acknowledgement, before any loot appears ────────────────────
//
// GP2's own required beat: "give the cart a cheap physical acknowledgement before the loot appears --
// small jolt/settle plus subtle dust". A rock-and-settle on the cart's OWN mesh (out-and-back, the
// same shape bramble.js's hit-flinch already uses, so it returns to exactly the tilted-over rest pose
// zoneLoader.js's tiltZ handling gave it -- never drifting further tilted on repeat triggers) plus one
// glow sprite standing in for a dust puff (render/glow.js's existing "additive quad, no new particle
// system" trade, reused rather than building a second effects pipeline for one moment).
const JOLT_SECONDS = 0.32;
const JOLT_TILT_RADIANS = 0.07;
const DUST_COLOR = 0xcbb894;
const DUST_START_SIZE_METERS = 0.4;
const DUST_END_SIZE_METERS = 1.7;
const DUST_SECONDS = 0.55;

/**
 * @param cartMesh  the cart's own THREE.Object3D (main.js: `scene.getObjectByName('prop-' +
 *   VILLAGE.CART_PROP.model)`), or null -- a missing cart mesh degrades to "dust only, no jolt"
 *   rather than throwing, the same defensiveness the belt-lantern mount already shows a missing asset.
 */
export function createCartReaction(scene, cartMesh) {
  const dust = createGlowSprite(DUST_COLOR, DUST_START_SIZE_METERS);
  dust.name = 'cart-dust-puff-TEMPORARY';
  setLayer(dust, WORLD);
  scene.add(dust);

  // Read once, at construction (after the zone has placed the cart), so the jolt oscillates AROUND
  // the cart's own lie-down tilt rather than around zero -- and never accumulates drift if triggered
  // more than once (only ever happens once in practice; harmless either way).
  const baseRotationZ = cartMesh?.rotation.z ?? 0;
  let joltSeconds = -1;

  return {
    trigger() {
      joltSeconds = 0;
      if (cartMesh) {
        cartMesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(cartMesh);
        dust.position.set((box.min.x + box.max.x) / 2, box.min.y + 0.08, (box.min.z + box.max.z) / 2);
      }
      dust.scale.setScalar(DUST_START_SIZE_METERS);
      setGlowStrength(dust, 1);
    },
    update(deltaSeconds) {
      if (joltSeconds < 0) return;
      joltSeconds += deltaSeconds;
      if (cartMesh) {
        const jt = Math.min(1, joltSeconds / JOLT_SECONDS);
        // Out and back, so the rock ends exactly where it started -- bramble.js's flinch uses the
        // same sin(pi*t) shape for the identical reason.
        cartMesh.rotation.z = baseRotationZ + Math.sin(jt * Math.PI) * JOLT_TILT_RADIANS;
      }
      const dt = Math.min(1, joltSeconds / DUST_SECONDS);
      dust.scale.setScalar(DUST_START_SIZE_METERS + (DUST_END_SIZE_METERS - DUST_START_SIZE_METERS) * dt);
      setGlowStrength(dust, 1 - dt);
      if (joltSeconds >= Math.max(JOLT_SECONDS, DUST_SECONDS)) {
        joltSeconds = -1;
        if (cartMesh) cartMesh.rotation.z = baseRotationZ;
        setGlowStrength(dust, 0);
      }
    },
  };
}
