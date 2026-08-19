// public/src/world/rowan.js
//
// ROWAN, watching the trail. A TEMPORARY representation for this slice: Aldric's own rig, cloned the
// way the three villagers already are (world/villagers.js) -- we do not own a second NPC model, and
// this is gameplay/story scaffolding, not Rowan's eventual real rigging, idle animation or gear.
//
// Unlike the villagers, who glance side to side on a timer, Rowan watches whoever walks up -- the
// same "watching-turn" behaviour Keeper Aldric's own presenter already has
// (zoneLoader.js's createKeeperPresenter) -- but with no wave and no quest marker: they have one
// line, delivered through the proximity speech bubble main.js already shares between the two NPCs,
// not a "!" over their head or a greeting gesture.

import * as THREE from '../../vendor/three.module.min.js';
import { clone as cloneSkinned } from '../../vendor/utils/SkeletonUtils.js';
import { normaliseCharacterMaterial } from '../character/hero.js';
import { CHARACTER, setLayer } from '../render/layers.js';
import { distance, headingToward, scaleForHeight, turnToward } from './zoneLoader.js';

// Same target height as the Keeper: they are the same rig, and a child should read them as the same
// kind of person (an adult), not a differently-scaled clone.
export const ROWAN_TARGET_HEIGHT_METERS = 1.65;
// How far away Rowan starts watching -- same reasoning as KEEPER_NOTICE_RADIUS_METERS: they should
// turn to watch a child walking up rather than stare at the horizon until they are already close.
export const ROWAN_NOTICE_RADIUS_METERS = 6.0;
export const ROWAN_TURN_RATE_RADIANS_PER_SECOND = 1.6;
// A dust-and-travel brown, distinct from the Keeper's own robe and from all three villagers' tints
// (0xe8d9b8, 0xa9b0bd, 0xc2a98c) -- reusing his rig untinted would read as "Aldric is at the camp
// now", which is a different and wrong story beat.
export const ROWAN_TINT = 0x8a7355;

/**
 * Clone Rowan off an already-loaded keeper gltf and stand them in the world.
 *
 * @param gltf   the loaded keeper gltf (`.scene`, `.animations`) -- the SAME load zoneLoader.js
 *               already awaits for the Keeper himself, not a second fetch.
 * @param rowan  `{ at: [x, z], facing: [x, z] }` -- see ROWAN in zones/village.js
 */
export function buildRowan(scene, gltf, rowan) {
  const root = setLayer(cloneSkinned(gltf.scene), CHARACTER);
  root.name = 'rowan';
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
    object.material = [].concat(object.material).map((material) => {
      const copy = material.clone();
      normaliseCharacterMaterial(copy);
      copy.color = new THREE.Color(ROWAN_TINT);
      return copy;
    });
    if (object.material.length === 1) [object.material] = object.material;
  });
  // Measured off the SOURCE, not the clone -- the same reasoning buildVillager's own comment gives:
  // measuring an already-scaled clone would compound the scale.
  const box = new THREE.Box3().setFromObject(gltf.scene);
  root.scale.setScalar(scaleForHeight(box.max.y - box.min.y, ROWAN_TARGET_HEIGHT_METERS));
  root.position.set(rowan.at[0], 0, rowan.at[1]);
  const restingHeading = headingToward(rowan.at[0], rowan.at[1], rowan.facing[0], rowan.facing[1]);
  root.rotation.y = restingHeading;
  scene.add(root);

  const mixer = new THREE.AnimationMixer(root);
  const idle = (gltf.animations ?? []).find((clip) => clip.name === 'idle');
  if (idle) {
    const action = mixer.clipAction(idle);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
  }

  return {
    /** @param heroPositions [{x, z}, ...] -- same shape the Keeper's own update takes. */
    update(deltaSeconds, heroPositions) {
      mixer.update(deltaSeconds);
      let nearest = null;
      let nearestDistance = Infinity;
      for (const p of heroPositions) {
        const d = distance(root.position.x, root.position.z, p.x, p.z);
        if (d < nearestDistance) { nearestDistance = d; nearest = p; }
      }
      const watching = nearest !== null && nearestDistance <= ROWAN_NOTICE_RADIUS_METERS;
      const wanted = watching
        ? headingToward(root.position.x, root.position.z, nearest.x, nearest.z)
        : restingHeading;
      root.rotation.y = turnToward(
        root.rotation.y, wanted, ROWAN_TURN_RATE_RADIANS_PER_SECOND * deltaSeconds,
      );
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
  };
}
