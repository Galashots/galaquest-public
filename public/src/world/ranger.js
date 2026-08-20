// public/src/world/ranger.js
//
// WREN, who came because the Beacon was lit.
//
// The same TEMPORARY representation world/rowan.js documents at length: Aldric's rig, cloned the way
// the three villagers already are, tinted to a colour nobody else in the world wears. We do not own
// a fourth NPC model, and this is story scaffolding rather than Wren's eventual rigging, idle
// animation or gear. Written as a near-twin of buildRowan on purpose -- a child should read her as
// the same KIND of thing (a person who watches you walk up and has something to say) and a reader
// should be able to diff the two files and see exactly what is different about her.
//
// What IS different is when she is DRAWN. Wren is not in the world until the Beacon is burning --
// that is the whole payoff (world/rangerSpeech.js's rangerIsHere) -- but she is BUILT with the zone
// like everyone else, and simply not drawn until then.
//
// That is not a shortcut, it is the only correct order. SkeletonUtils.clone copies the scene graph
// as it finds it, and world/zoneLoader.js scales and moves the Keeper's own root immediately after
// cloning the villagers and Rowan off it. A Wren cloned later -- on the frame the Beacon catches,
// twenty minutes into a session -- would inherit the Keeper's position, his height and his
// transparent-when-in-the-way materials. Building her cold costs one hidden skinned mesh and no
// per-frame work, and it also means the biggest moment in the game never waits on a clone.

import * as THREE from '../../vendor/three.module.min.js';
import { clone as cloneSkinned } from '../../vendor/utils/SkeletonUtils.js';
import { normaliseCharacterMaterial } from '../character/hero.js';
import { CHARACTER, setLayer } from '../render/layers.js';
import { distance, headingToward, scaleForHeight, turnToward } from './zoneLoader.js';

// The same adult height as the Keeper and Rowan: same rig, same kind of person. A ranger who read as
// a different SIZE would read as a different species, which is a story this game is not telling.
export const RANGER_TARGET_HEIGHT_METERS = 1.65;
// She notices a child further out than Rowan does (6.0), and that is characterisation rather than a
// tuning preference: noticing things at a distance is the entire job she has just described herself
// as having. It also means she turns while a child is still walking toward her down the lane, so the
// turn is something they see happen rather than something already done when they arrive.
export const RANGER_NOTICE_RADIUS_METERS = 8.0;
export const RANGER_TURN_RATE_RADIANS_PER_SECOND = 1.6;
// Deep forest green, and chosen against every tint already in the world rather than in isolation:
// the Keeper's robe, Rowan's dust brown 0x8a7355, and the three villagers' 0xe8d9b8 / 0xa9b0bd /
// 0xc2a98c. Every one of those is warm and pale. Wren is the only cool, dark, saturated person in
// the village, which is what makes a stranger read as a stranger from across the plaza -- and green
// because she is the first character who belongs to the WOOD rather than to the village.
export const RANGER_TINT = 0x3f6b4a;

/**
 * Clone Wren off an already-loaded keeper gltf and stand her in the world.
 *
 * @param gltf    the loaded keeper gltf (`.scene`, `.animations`) -- the SAME load the Keeper,
 *                the villagers and Rowan already share, not a fourth fetch.
 * @param ranger  `{ at: [x, z], facing: [x, z] }` -- see RANGER in zones/village.js
 */
export function buildRanger(scene, gltf, ranger) {
  const root = setLayer(cloneSkinned(gltf.scene), CHARACTER);
  root.name = 'ranger';
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
    object.material = [].concat(object.material).map((material) => {
      const copy = material.clone();
      normaliseCharacterMaterial(copy);
      copy.color = new THREE.Color(RANGER_TINT);
      return copy;
    });
    if (object.material.length === 1) [object.material] = object.material;
  });
  // Measured off the SOURCE, not the clone -- measuring an already-scaled clone compounds the scale.
  // Same note buildVillager and buildRowan both carry, for the same reason.
  const box = new THREE.Box3().setFromObject(gltf.scene);
  root.scale.setScalar(scaleForHeight(box.max.y - box.min.y, RANGER_TARGET_HEIGHT_METERS));
  root.position.set(ranger.at[0], 0, ranger.at[1]);
  const restingHeading = headingToward(ranger.at[0], ranger.at[1], ranger.facing[0], ranger.facing[1]);
  root.rotation.y = restingHeading;
  // NOT IN THE WORLD YET. See the header: built with the zone, drawn only once somebody has lit the
  // signal she came to answer.
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
      // A woman who is not in the world does not breathe, does not turn, and costs nothing. This is
      // the one line that makes "built cold" honest rather than merely invisible.
      if (!root.visible) return;
      mixer.update(deltaSeconds);
      let nearest = null;
      let nearestDistance = Infinity;
      for (const p of heroPositions) {
        const d = distance(root.position.x, root.position.z, p.x, p.z);
        if (d < nearestDistance) { nearestDistance = d; nearest = p; }
      }
      const watching = nearest !== null && nearestDistance <= RANGER_NOTICE_RADIUS_METERS;
      // ...and when nobody is near she goes back to looking north-east, at the hollow her brother
      // walked into. That resting heading is the whole reason `facing` is a coordinate rather than an
      // angle: it stays true if the hollow ever moves.
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
