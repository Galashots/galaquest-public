// public/src/world/villagers.js
//
// PEOPLE IN THE VILLAGE.
//
// Why, from walking up to the place and looking at it: the village is a set of very good buildings
// with nobody in them. One old man stands beside the tree and everything else is furniture. A child
// coming up the road has no reason to believe anyone lives there, and "go and see what is happening"
// is the entire motivation for walking in.
//
// These are Keeper Aldric's own rig, cloned. We do not own a villager model and we are not going to
// spend the night making one -- and the honest trade is that three robed figures at gameplay
// distance read as "the village has people in it", which is the whole job, where an empty market
// stall reads as "this place is abandoned". They are told apart by height, by robe tint, by which
// way they face and by where they are in their idle loop, so they do not read as one man copied.
//
// SkeletonUtils.clone, not Object3D.clone: a skinned mesh cloned the plain way shares its skeleton
// with the original, so all three villagers and the Keeper would animate as one puppet.
//
// They have no dialogue, no pathfinding and no AI. They stand where the village would put them --
// at the market, outside a door, staring up at the tree that has gone dark -- they breathe, and they
// look around. That is the whole feature, and it is what "inhabited" actually looks like from
// fifteen metres away on an iPad.

import * as THREE from '../../vendor/three.module.min.js';
import { clone as cloneSkinned } from '../../vendor/utils/SkeletonUtils.js';
import { normaliseCharacterMaterial } from '../character/hero.js';
import { CHARACTER, setLayer } from '../render/layers.js';
// zoneLoader imports this module and this module imports four of its pure helpers back. The cycle
// is deliberate and safe -- nothing here runs at module-evaluation time, only inside functions the
// loader calls once both modules exist -- and it is better than a second copy of headingToward.
import { headingToward, scaleForHeight, shortestTurn, turnToward } from './zoneLoader.js';

// How far a villager turns off their resting heading when they look around, and how long a full
// there-and-back takes. Small and slow on purpose: a villager who swings 90 degrees every two
// seconds reads as a malfunctioning turret, not as a person waiting for someone.
export const LOOK_SWING_RADIANS = 0.55;
export const LOOK_TURN_RATE_RADIANS_PER_SECOND = 0.7;

/**
 * Which way a villager WANTS to be looking at `seconds`, as -1 or +1 off their resting heading.
 *
 * A square wave, not a sine, and that is the whole trick: the turn rate below is what shapes the
 * movement, so a villager swings over at a human speed and then STANDS THERE looking at the thing
 * until the wave flips. A sine would have them sweeping continuously, which reads as a security
 * camera. Look, pause, look back, pause.
 *
 * Pure, so the behaviour can be checked without a scene.
 */
export function lookOffset01(seconds, periodSeconds, phase01 = 0) {
  if (!(periodSeconds > 0)) return 0;
  const t = (((seconds / periodSeconds) + phase01) % 1 + 1) % 1;
  return t < 0.5 ? 1 : -1;
}

/** One villager's tint, applied as a multiplier over the shared colormap so each robe reads as a
 *  different dye lot rather than as a different species. Kept close to white -- this texture
 *  carries the face and the hands too, and a hard tint turns a villager green. */
function tintMaterials(root, tint) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
    object.material = [].concat(object.material).map((material) => {
      const copy = material.clone();
      normaliseCharacterMaterial(copy);
      copy.color = new THREE.Color(tint);
      return copy;
    });
    if (object.material.length === 1) [object.material] = object.material;
  });
}

/**
 * Clone one villager off an already-loaded keeper GLTF and stand them in the world.
 *
 * @param gltf     the loaded keeper gltf (`.scene`, `.animations`)
 * @param villager `{ at: [x, z], facing: [x, z], heightMeters, tint, phase01, lookPeriodSeconds }`
 */
function buildVillager(scene, gltf, villager, index) {
  const root = setLayer(cloneSkinned(gltf.scene), CHARACTER);
  root.name = `villager-${index}`;
  tintMaterials(root, villager.tint);
  // Measured off the SOURCE, not the clone: measuring a clone that has already been scaled once
  // would compound the scale on every villager after the first.
  const box = new THREE.Box3().setFromObject(gltf.scene);
  root.scale.setScalar(scaleForHeight(box.max.y - box.min.y, villager.heightMeters));
  root.position.set(villager.at[0], 0, villager.at[1]);

  const resting = headingToward(
    villager.at[0], villager.at[1], villager.facing[0], villager.facing[1],
  );
  root.rotation.y = resting;
  scene.add(root);

  const mixer = new THREE.AnimationMixer(root);
  const idle = (gltf.animations ?? []).find((clip) => clip.name === 'idle');
  if (idle) {
    const action = mixer.clipAction(idle);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    // Three villagers breathing in perfect unison is worse than three villagers standing still,
    // because unison is a thing bodies do not do. Each starts somewhere else in the same loop.
    action.time = idle.duration * villager.phase01;
  }

  let elapsed = 0;
  return {
    root,
    update(deltaSeconds) {
      elapsed += deltaSeconds;
      mixer.update(deltaSeconds);
      const wanted = resting
        + LOOK_SWING_RADIANS * lookOffset01(elapsed, villager.lookPeriodSeconds, villager.phase01);
      root.rotation.y = turnToward(
        root.rotation.y, wanted, LOOK_TURN_RATE_RADIANS_PER_SECOND * deltaSeconds,
      );
    },
    /** For a harness: is this villager actually moving, without reading pixels. */
    headingOffset: () => shortestTurn(resting, root.rotation.y),
  };
}

/**
 * Build every villager the zone asks for. Returns `{ update, count }`; an empty zone (or a keeper
 * model that failed to load) returns a no-op rather than throwing, the same "degrade to something
 * visible, never throw" rule the keeper presenter follows.
 */
export function buildVillagers(scene, gltf, villagers = []) {
  if (!gltf?.scene || villagers.length === 0) {
    return { update() {}, count: 0, headingOffsets: () => [] };
  }
  const built = villagers.map((villager, index) => buildVillager(scene, gltf, villager, index));
  return {
    count: built.length,
    update(deltaSeconds) {
      for (const villager of built) villager.update(deltaSeconds);
    },
    headingOffsets: () => built.map((v) => v.headingOffset()),
  };
}
