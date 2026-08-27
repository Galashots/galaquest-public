// public/src/world/enemyDropsPresenter.js
//
// R1: the physical presenter for kill drops -- coins, hearts and gear scattered where an ordinary
// enemy fell (world/enemyDrops.js owns the rules; this owns only what a child SEES). Modelled on
// world/lootPickups.js's own burst/rest/attract/gone lifecycle, with one real difference: a kill drop
// has no cart to fly OUT of -- the server has already scattered it to its resting spot before this
// client ever hears about it (world/enemyDrops.js's own scatterPoint), so there is nothing to burst
// FROM. It POPS IN instead: a quick scale-up at the spot the enemy fell, which reads as "this just
// dropped" without inventing a source position nobody sent.
//
// Diffed by the wire's own `drops[].id` -- the same keyed-collection discipline
// enemies/presenterRegistry.js already uses for ordinary enemies, kept small and bespoke here rather
// than reused because a drop carries extra live per-frame inputs (selfHeroId, the collecting hero's
// own position) that registry's own update(enemies) signature has no room for.

import * as THREE from '../../vendor/three.module.min.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { WORLD, setLayer } from '../render/layers.js';
import { buildCoinMesh } from './lootPickups.js';
// The item's OWN swatch, imported rather than restated -- a gear drop's little box is the same colour
// the Hero screen's owned strip and the unlock ceremony already paint that item with (GQ-007).
import { swatchHexFor } from '../progression/heroScreen.js';

const APPEAR_SECONDS = 0.22;
const ATTRACT_SECONDS = 0.4;
const ATTRACT_TARGET_HEIGHT_METERS = 0.9;
const ATTRACT_HOP_METERS = 0.4;

function ease(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Pure. The next lifecycle phase for one drop presenter, given what changed this call.
 *
 * `phaseComplete` is true once the CURRENT phase's own timer has run out -- appearing's pop-in tween
 * or attracting's flight -- read off the caller's own clock rather than kept here, so this stays a
 * plain state machine over four honest states with no clock inside it. Unit tested directly
 * (test/enemy-drops-presenter.test.mjs) because it is the one part of this file worth proving without
 * a GPU.
 */
export function nextDropPresenterPhase(phase, { collectedBy = null, selfHeroId = null, phaseComplete = false } = {}) {
  if (phase === 'gone') return 'gone';
  if (phase === 'appearing') return phaseComplete ? 'resting' : 'appearing';
  if (phase === 'resting') {
    if (collectedBy == null) return 'resting';
    // Someone else's drop: the shared physical object is gone for every client the instant it is
    // collected -- the same "despawn silently, no attraction flight toward a hero we do not track"
    // rule lootPickups.js's own resting phase already takes.
    return collectedBy === selfHeroId ? 'attracting' : 'gone';
  }
  // 'attracting'
  return phaseComplete ? 'gone' : 'attracting';
}

// ── heart: two spheres and a wedge, the cheapest read of "heart" that still silhouettes as one ────
const HEART_COLOR = 0xff5c7a;
const HEART_REST_HEIGHT_METERS = 0.22;
const HEART_LOBE_RADIUS_METERS = 0.085;
const HEART_PULSE_HZ = 1.6;
const HEART_PULSE_DEPTH = 0.14;
const HEART_BOB_HZ = 0.9;
const HEART_BOB_METERS = 0.04;

function buildHeartMesh() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: HEART_COLOR, emissive: HEART_COLOR, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.1,
  });
  const lobeGeometry = new THREE.SphereGeometry(HEART_LOBE_RADIUS_METERS, 12, 10);
  const left = new THREE.Mesh(lobeGeometry, material);
  left.position.set(-HEART_LOBE_RADIUS_METERS * 0.72, HEART_LOBE_RADIUS_METERS * 0.35, 0);
  const right = new THREE.Mesh(lobeGeometry, material);
  right.position.set(HEART_LOBE_RADIUS_METERS * 0.72, HEART_LOBE_RADIUS_METERS * 0.35, 0);
  // The wedge under the two lobes: a cone, point down, is the cheapest shape that reads as the
  // heart's own bottom taper -- the same "cheap geometry, deliberate facets" trade lootPickups.js's
  // own shard mesh already takes for a different currency.
  const wedge = new THREE.Mesh(
    new THREE.ConeGeometry(HEART_LOBE_RADIUS_METERS * 1.28, HEART_LOBE_RADIUS_METERS * 1.9, 12),
    material,
  );
  wedge.rotation.x = Math.PI;
  wedge.position.set(0, -HEART_LOBE_RADIUS_METERS * 0.55, 0);
  group.add(left, right, wedge);
  // Tipped forward slightly so the wedge point reads toward camera rather than straight down at the
  // grass -- a heart lying flat on the ground reads as a rock; tilted, the two-lobe silhouette shows.
  group.rotation.x = -0.35;
  return group;
}

// ── gear: a small swatch-coloured chest with a sparkle, spinning slowly ────────────────────────────
const GEAR_BOX_SIZE_METERS = 0.16;
const GEAR_REST_HEIGHT_METERS = 0.2;
const GEAR_SPIN_RADIANS_PER_SECOND = 1.3;
const GEAR_SPARKLE_SIZE_METERS = 0.34;
const GEAR_SPARKLE_PULSE_HZ = 1.1;

function buildGearMesh(itemId) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: swatchHexFor(itemId), emissive: swatchHexFor(itemId), emissiveIntensity: 0.35,
    roughness: 0.4, metalness: 0.5,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(
    GEAR_BOX_SIZE_METERS, GEAR_BOX_SIZE_METERS * 0.8, GEAR_BOX_SIZE_METERS,
  ), material);
  group.add(box);
  const sparkle = createGlowSprite(0xffffff, GEAR_SPARKLE_SIZE_METERS, 'shock');
  sparkle.position.set(0, 0, 0);
  group.add(sparkle);
  group.userData.sparkle = sparkle;
  group.userData.box = box;
  return group;
}

function restHeightFor(kind) {
  if (kind === 'heart') return HEART_REST_HEIGHT_METERS;
  if (kind === 'gear') return GEAR_REST_HEIGHT_METERS;
  return 0.14; // coin, matching lootPickups.js's own COIN_REST_HEIGHT_METERS
}

function buildMeshFor(drop) {
  if (drop.kind === 'heart') return buildHeartMesh();
  if (drop.kind === 'gear') return buildGearMesh(drop.itemId);
  return buildCoinMesh();
}

function disposeMesh(mesh) {
  mesh.traverse((object) => {
    if (object.isMesh) {
      object.geometry.dispose();
      object.material.dispose?.();
    }
    if (object.isSprite) {
      object.material.dispose?.();
    }
  });
}

function buildDropPresenter(scene, drop) {
  const mesh = buildMeshFor(drop);
  mesh.name = `enemy-drop-${drop.id}`;
  mesh.visible = false;
  setLayer(mesh, WORLD);
  scene.add(mesh);

  let phase = 'appearing';
  let elapsed = 0;
  let attractElapsed = 0;
  let attractFrom = null;
  let idleSeconds = 0;
  const restHeight = restHeightFor(drop.kind);

  function applyIdleMotion(deltaSeconds) {
    idleSeconds += deltaSeconds;
    if (drop.kind === 'coin') {
      mesh.rotation.y += 5.2 * deltaSeconds;
    } else if (drop.kind === 'heart') {
      const pulse = 1 + Math.sin(idleSeconds * HEART_PULSE_HZ * Math.PI * 2) * HEART_PULSE_DEPTH;
      mesh.scale.setScalar(pulse);
      mesh.position.y = restHeight + Math.sin(idleSeconds * HEART_BOB_HZ * Math.PI * 2) * HEART_BOB_METERS;
    } else {
      mesh.userData.box.rotation.y += GEAR_SPIN_RADIANS_PER_SECOND * deltaSeconds;
      const sparklePulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(idleSeconds * GEAR_SPARKLE_PULSE_HZ * Math.PI * 2));
      setGlowStrength(mesh.userData.sparkle, sparklePulse);
    }
  }

  return {
    /** @returns {id, kind, itemId} the instant this drop's OWN attraction flight completes (this
     *  client collected it), else null. Bursting/resting/idle motion/someone-else's despawn stay
     *  silent, the same contract world/lootPickups.js's own presenter update() keeps. */
    update(deltaSeconds, collectedBy, selfHeroId, selfPosition) {
      if (phase === 'gone') return null;

      if (phase === 'appearing') {
        elapsed += deltaSeconds;
        mesh.visible = true;
        const t = ease(Math.min(1, elapsed / APPEAR_SECONDS));
        mesh.scale.setScalar(Math.max(0.001, t));
        mesh.position.set(drop.x, restHeight * t, drop.z);
        phase = nextDropPresenterPhase(phase, { phaseComplete: elapsed >= APPEAR_SECONDS });
        if (phase === 'resting') mesh.position.set(drop.x, restHeight, drop.z);
        return null;
      }

      if (phase === 'resting') {
        const next = nextDropPresenterPhase(phase, { collectedBy, selfHeroId });
        if (next !== phase) {
          phase = next;
          if (phase === 'attracting') {
            attractElapsed = 0;
            attractFrom = mesh.position.clone();
          } else {
            mesh.visible = false;
          }
          return null;
        }
        applyIdleMotion(deltaSeconds);
        return null;
      }

      // phase === 'attracting'
      attractElapsed += deltaSeconds;
      const t = ease(Math.min(1, attractElapsed / ATTRACT_SECONDS));
      const hop = Math.sin(Math.PI * Math.min(1, attractElapsed / ATTRACT_SECONDS)) * ATTRACT_HOP_METERS;
      mesh.position.set(
        attractFrom.x + (selfPosition.x - attractFrom.x) * t,
        attractFrom.y + (ATTRACT_TARGET_HEIGHT_METERS - attractFrom.y) * t + hop,
        attractFrom.z + (selfPosition.z - attractFrom.z) * t,
      );
      mesh.scale.setScalar(Math.max(0.1, 1 - t * 0.7));
      const done = attractElapsed >= ATTRACT_SECONDS;
      phase = nextDropPresenterPhase(phase, { phaseComplete: done });
      if (!done) return null;
      mesh.visible = false;
      return { id: drop.id, kind: drop.kind, itemId: drop.itemId ?? null };
    },
    dispose() {
      scene.remove(mesh);
      disposeMesh(mesh);
    },
  };
}

/**
 * Keyed by `drop.id`, diffed every frame against the encounter's own `drops` array (or the offline
 * fallback's own local array, same shape) -- an id no longer present is disposed silently, exactly
 * enemies/presenterRegistry.js's own contract for enemyId.
 */
export function createEnemyDropsPresenter(scene) {
  const byId = new Map();

  function update(deltaSeconds, drops, selfHeroId, selfPosition) {
    const seen = new Set();
    const arrived = [];
    for (const drop of drops ?? []) {
      seen.add(drop.id);
      let presenter = byId.get(drop.id);
      if (!presenter) {
        presenter = buildDropPresenter(scene, drop);
        byId.set(drop.id, presenter);
      }
      const result = presenter.update(deltaSeconds, drop.collectedBy ?? null, selfHeroId, selfPosition);
      if (result) arrived.push(result);
    }
    for (const [id, presenter] of byId) {
      if (seen.has(id)) continue;
      presenter.dispose();
      byId.delete(id);
    }
    return arrived;
  }

  return {
    update,
    get count() { return byId.size; },
    dispose() {
      for (const presenter of byId.values()) presenter.dispose();
      byId.clear();
    },
  };
}
