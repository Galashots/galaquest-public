// public/src/world/ranger.js
//
// WREN, who came because the Beacon was lit.
//
// Wren has her own model (characters/wren_ranger.glb) loaded independently from the Keeper. She is
// BUILT with the zone like everyone else and simply not drawn until the Beacon is burning -- that is
// the whole payoff (world/rangerSpeech.js's rangerIsHere). Building her cold costs one hidden
// skinned mesh and no per-frame work, and it means the biggest moment in the game never waits on a
// load.

import * as THREE from '../../vendor/three.module.min.js';
import { normaliseCharacterMaterial } from '../character/hero.js';
import { CHARACTER, setLayer } from '../render/layers.js';
import { distance, headingToward, scaleForHeight, turnToward } from './zoneLoader.js';

// The same adult height as the Keeper and Rowan: same kind of person. A ranger who read as a
// different SIZE would read as a different species, which is a story this game is not telling.
export const RANGER_TARGET_HEIGHT_METERS = 1.65;
// She notices a child further out than Rowan does (6.0), and that is characterisation rather than a
// tuning preference: noticing things at a distance is the entire job she has just described herself
// as having. It also means she turns while a child is still walking toward her down the lane, so the
// turn is something they see happen rather than something already done when they arrive.
export const RANGER_NOTICE_RADIUS_METERS = 8.0;
export const RANGER_TURN_RATE_RADIANS_PER_SECOND = 1.6;

/**
 * Stand Wren in the world from her own loaded model.
 *
 * @param gltf    the loaded wren_ranger gltf (`.scene`, `.animations`) -- her own dedicated load,
 *                not a clone of the Keeper.
 * @param ranger  `{ at: [x, z], facing: [x, z] }` -- see RANGER in zones/village.js
 */
export function buildRanger(scene, gltf, ranger) {
  const root = setLayer(gltf.scene, CHARACTER);
  root.name = 'ranger';
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
    for (const material of [].concat(object.material)) normaliseCharacterMaterial(material);
  });
  const box = new THREE.Box3().setFromObject(root);
  root.scale.setScalar(scaleForHeight(box.max.y - box.min.y, RANGER_TARGET_HEIGHT_METERS));
  root.position.set(ranger.at[0], 0, ranger.at[1]);
  const restingHeading = headingToward(ranger.at[0], ranger.at[1], ranger.facing[0], ranger.facing[1]);
  root.rotation.y = restingHeading;
  // NOT IN THE WORLD YET. Built with the zone, drawn only once somebody has lit the signal she came
  // to answer.
  root.visible = false;
  scene.add(root);

  const mixer = new THREE.AnimationMixer(root);
  const idle = (gltf.animations ?? []).find((clip) => clip.name === 'idle');
  if (idle) {
    const action = mixer.clipAction(idle);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
  }

  return {
    at: ranger.at,
    /**
     * She walks into the village. Idempotent, because the caller learns the Beacon is lit from a
     * published world fact it re-reads every frame rather than from an edge -- and a late joiner
     * learns it on their very first frame, which must produce a woman standing there rather than an
     * arrival ceremony for something that happened before they logged in.
     */
    arrive() {
      root.visible = true;
    },
    isHere: () => root.visible === true,
    /** @param heroPositions [{x, z}, ...] -- the same shape the Keeper's and Rowan's updates take. */
    update(deltaSeconds, heroPositions) {
      if (!root.visible) return;
      mixer.update(deltaSeconds);
      let nearest = null;
      let nearestDistance = Infinity;
      for (const p of heroPositions) {
        const d = distance(root.position.x, root.position.z, p.x, p.z);
        if (d < nearestDistance) { nearestDistance = d; nearest = p; }
      }
      const watching = nearest !== null && nearestDistance <= RANGER_NOTICE_RADIUS_METERS;
      const wanted = watching
        ? headingToward(root.position.x, root.position.z, nearest.x, nearest.z)
        : restingHeading;
      root.rotation.y = turnToward(
        root.rotation.y, wanted, RANGER_TURN_RATE_RADIANS_PER_SECOND * deltaSeconds,
      );
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      scene.remove(root);
    },
  };
}
