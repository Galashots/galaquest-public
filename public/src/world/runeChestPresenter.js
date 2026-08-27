// public/src/world/runeChestPresenter.js
//
// The physical presenter for ONE rune chest -- progression/runeChests.js owns whether a chest is
// standing, where, and what question it holds; this owns only what a child SEES. Modelled on
// world/enemyDropsPresenter.js's own pop-in/idle/gone lifecycle (that file's own header explains the
// same trade this one takes), simplified to a SINGLE object because runeChests.js's own session cap
// already guarantees at most one chest stands at a time -- a keyed collection here would be a
// registry with never more than one entry in it.
//
// Cheap procedural mesh, no textures, no GLB: a small box (the chest body) in a warm gold-purple that
// reads as "this is not a coin or a wolf" at a glance, plus a glow sprite (render/glow.js, the same
// sprite gear drops already use for their sparkle) that PULSES gently at rest and brightens a step
// with every shimmerTier the rules layer hands it -- runeChests.js's own MAX_SHIMMER_TIER comment:
// "8 more kills while one already stands... makes the one waiting brighter", and this is that
// brightening made visible.

import * as THREE from '../../vendor/three.module.min.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { WORLD, setLayer } from '../render/layers.js';

const APPEAR_SECONDS = 0.3;
const BOX_WIDTH_METERS = 0.34;
const BOX_HEIGHT_METERS = 0.26;
const BOX_DEPTH_METERS = 0.24;
const REST_HEIGHT_METERS = BOX_HEIGHT_METERS / 2;
const GOLD_COLOR = 0xf2b33d;
const PURPLE_COLOR = 0x8a5cf6;
const SPARKLE_BASE_SIZE_METERS = 0.55;
const SPARKLE_PULSE_HZ = 0.9;
const BOB_HZ = 0.7;
const BOB_METERS = 0.03;

function ease(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function buildChestMesh() {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: PURPLE_COLOR, emissive: PURPLE_COLOR, emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.4,
  });
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(BOX_WIDTH_METERS, BOX_HEIGHT_METERS, BOX_DEPTH_METERS),
    bodyMaterial,
  );
  group.add(body);

  // A gold band across the lid -- the one silhouette detail that reads "chest" rather than "crate"
  // from the ten-metre distance this game is actually played at, the same "cheap geometry, deliberate
  // facets" trade world/enemyDropsPresenter.js's own gear box comment states.
  const bandMaterial = new THREE.MeshStandardMaterial({
    color: GOLD_COLOR, emissive: GOLD_COLOR, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.6,
  });
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(BOX_WIDTH_METERS * 1.04, BOX_HEIGHT_METERS * 0.22, BOX_DEPTH_METERS * 1.04),
    bandMaterial,
  );
  band.position.y = BOX_HEIGHT_METERS * 0.15;
  group.add(band);

  const sparkle = createGlowSprite(GOLD_COLOR, SPARKLE_BASE_SIZE_METERS, 'lamp');
  sparkle.position.set(0, BOX_HEIGHT_METERS * 0.3, 0);
  group.add(sparkle);
  group.userData.sparkle = sparkle;
  group.userData.bandMaterial = bandMaterial;
  return group;
}

function disposeMesh(mesh) {
  mesh.traverse((object) => {
    if (object.isMesh) {
      object.geometry.dispose();
      object.material.dispose?.();
    }
    if (object.isSprite) object.material.dispose?.();
  });
}

/**
 * Keyed by nothing -- a single-slot presenter, given the current `chest` (progression/runeChests.js's
 * own `state.chest`, or null) every frame. Builds its mesh lazily the first time it sees a non-null
 * chest, tears it down the frame the chest goes null (answered), and rebuilds fresh for the next one
 * -- so an id change (a new chest after the old one closed) is never mistaken for the same chest
 * moving, even though runeChests.js's own session cap means that almost never happens back to back.
 */
export function createRuneChestPresenter(scene) {
  let mesh = null;
  let currentId = null;
  let appearElapsed = 0;
  let idleSeconds = 0;

  function teardown() {
    if (!mesh) return;
    scene.remove(mesh);
    disposeMesh(mesh);
    mesh = null;
    currentId = null;
    appearElapsed = 0;
    idleSeconds = 0;
  }

  function update(deltaSeconds, chest) {
    if (!chest) {
      teardown();
      return;
    }
    if (!mesh || currentId !== chest.id) {
      teardown();
      mesh = buildChestMesh();
      mesh.name = `rune-chest-${chest.id}`;
      setLayer(mesh, WORLD);
      scene.add(mesh);
      currentId = chest.id;
      appearElapsed = 0;
      idleSeconds = 0;
    }

    if (appearElapsed < APPEAR_SECONDS) {
      appearElapsed += deltaSeconds;
      const t = ease(Math.min(1, appearElapsed / APPEAR_SECONDS));
      mesh.scale.setScalar(Math.max(0.001, t));
      mesh.position.set(chest.x, REST_HEIGHT_METERS * t, chest.z);
      return;
    }

    idleSeconds += deltaSeconds;
    mesh.scale.setScalar(1);
    mesh.position.set(
      chest.x,
      REST_HEIGHT_METERS + Math.sin(idleSeconds * BOB_HZ * Math.PI * 2) * BOB_METERS,
      chest.z,
    );
    mesh.rotation.y += 0.6 * deltaSeconds;
    // shimmerTier (1..MAX_SHIMMER_TIER) steps the sparkle's own resting brightness AND its pulse
    // depth up -- a chest that has earned two more upgrades reads as visibly more excited to be
    // opened than one that just spawned, without needing a second mesh or a numeric readout a
    // pre-reader could not use anyway.
    const tier = chest.shimmerTier ?? 1;
    const floor = 0.3 + tier * 0.12;
    const depth = 0.25 + tier * 0.1;
    const pulse = floor + depth * (0.5 + 0.5 * Math.sin(idleSeconds * SPARKLE_PULSE_HZ * Math.PI * 2));
    setGlowStrength(mesh.userData.sparkle, pulse);
    mesh.userData.bandMaterial.emissiveIntensity = 0.4 + tier * 0.15;
  }

  return {
    update,
    get isShowing() { return mesh !== null; },
    dispose() { teardown(); },
  };
}
