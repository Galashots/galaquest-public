// public/src/world/corpseLootGlowPresenter.js
//
// The physical "there is loot here, for YOU" signal #87 asks for: a soft gold glow standing over
// every corpse world/corpseLootPresenter.js's own corpsesToGlowFor(heroId, corpses) says THIS hero can
// still loot. Modelled on world/runeChestPresenter.js's own glow sprite (render/glow.js, reused rather
// than reinvented -- one glow texture, shared with every other lit thing in the game), but keyed like
// world/enemyDropsPresenter.js's own collection: more than one corpse can be waiting on a busy fight,
// unlike the rune chest's own single-slot session cap.
//
// PLAYER-SPECIFIC BY CONSTRUCTION, not by an opinion this file holds: main.js only ever calls
// update() with the list corpseLootPresenter.js's own corpsesToGlowFor(net.selfId, corpses) already
// filtered to one heroId, so this presenter never sees -- and cannot leak -- a sibling's claim. It
// draws exactly the list it is handed and nothing it derives itself.
//
// Browser/harness territory, the same posture world/runeChestPresenter.js and
// world/enemyDropsPresenter.js already take: three.js needs a real canvas, so this is proved by a
// running-game capture, not by node --test.

import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { WORLD, setLayer } from '../render/layers.js';

const GOLD_COLOR = 0xf2b33d;
const GLOW_SIZE_METERS = 0.9;
const GLOW_HEIGHT_METERS = 1.1;
const PULSE_HZ = 1.1;
const PULSE_FLOOR = 0.55;
const PULSE_DEPTH = 0.35;

function buildMarker() {
  const sprite = createGlowSprite(GOLD_COLOR, GLOW_SIZE_METERS, 'lamp');
  sprite.visible = false;
  return sprite;
}

/**
 * Keyed by corpse id. update(deltaSeconds, glowingCorpses) builds a marker for any newly-glowing
 * corpse, retires one the instant it drops off the list (looted, expired, or reassigned away from
 * this hero on reconnect), and pulses every marker still standing. Pure three.js bookkeeping -- no
 * gameplay decision lives here, world/corpseLootPresenter.js already made it.
 */
export function createCorpseLootGlowPresenter(scene) {
  const markers = new Map(); // corpse id -> { sprite, idleSeconds }

  function teardown(id) {
    const entry = markers.get(id);
    if (!entry) return;
    scene.remove(entry.sprite);
    entry.sprite.material.dispose?.();
    markers.delete(id);
  }

  function update(deltaSeconds, glowingCorpses) {
    const seen = new Set();
    for (const corpse of glowingCorpses ?? []) {
      seen.add(corpse.id);
      let entry = markers.get(corpse.id);
      if (!entry) {
        const sprite = buildMarker();
        sprite.name = `corpse-loot-glow-${corpse.id}`;
        setLayer(sprite, WORLD);
        scene.add(sprite);
        entry = { sprite, idleSeconds: 0 };
        markers.set(corpse.id, entry);
      }
      entry.idleSeconds += deltaSeconds;
      entry.sprite.position.set(corpse.x, GLOW_HEIGHT_METERS, corpse.z);
      const pulse = PULSE_FLOOR
        + PULSE_DEPTH * (0.5 + 0.5 * Math.sin(entry.idleSeconds * PULSE_HZ * Math.PI * 2));
      setGlowStrength(entry.sprite, pulse);
    }
    for (const id of [...markers.keys()]) {
      if (!seen.has(id)) teardown(id);
    }
  }

  function dispose() {
    for (const id of [...markers.keys()]) teardown(id);
  }

  return {
    update,
    dispose,
    get activeCount() { return markers.size; },
  };
}
