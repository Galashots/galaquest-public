// Other players' heroes: spawn on first sight, drive from interpolated snapshots, remove on leave.
//
// Each clone gets its OWN skeleton and its OWN AnimationMixer. Sharing either would make every remote
// play the same frame of the same clip as the local hero -- the animation equivalent of everyone
// moving in lockstep.

import { clone as cloneSkinned } from '../../vendor/utils/SkeletonUtils.js';
import { CHARACTER, setLayer } from '../render/layers.js';
import { forceShippingWeaponOnClone } from '../character/weaponLoadout.js';
import { createLocomotionController } from '../character/locomotion.js';
import { locomotionModeForSpeed } from '../character/speed.js';

export function createRemotePlayers(scene, template) {
  // template: { root, animations } — the loaded hero. Cloned per remote via SkeletonUtils, because a
  // plain .clone() copies the mesh but leaves it bound to the ORIGINAL bones: every remote would then
  // deform to the local hero's pose. Verified rather than assumed -- see the vendoring commit.
  const remotes = new Map();

  function spawn(id, sample) {
    const root = cloneSkinned(template.root);
    root.name = `remote-${id}`;
    // The template is mid-animation when cloned, so its transform is meaningless here.
    root.position.set(sample.x, 0, sample.z);
    root.rotation.set(0, sample.heading, 0);
    root.scale.copy(template.root.scale);
    setLayer(root, CHARACTER);
    // GP1-C4: a clone inherits whatever sword the LOCAL hero happened to be holding when it was
    // taken, so without this a sibling who joined after you equipped the Blade would appear carrying
    // YOUR blade while one who joined before carried the Ironwood -- the same player drawn two ways
    // depending on join order. The wire has no per-player equipment field, so every remote gets the
    // shipping sword: consistent, and never a lie about a specific item. See
    // character/weaponLoadout.js's own comment.
    forceShippingWeaponOnClone(root);
    root.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = false;
        object.receiveShadow = false;
        // Skinned meshes are frustum-culled against their bind-pose bounds, which is wrong once the
        // skeleton moves: a remote can vanish while still on screen. Cheap to disable for a handful.
        object.frustumCulled = false;
      }
    });
    scene.add(root);
    const remote = {
      id,
      root,
      locomotion: createLocomotionController(root, template.animations),
    };
    remotes.set(id, remote);
    return remote;
  }

  function remove(id) {
    const remote = remotes.get(id);
    if (!remote) return false;
    remote.locomotion.dispose();
    scene.remove(remote.root);
    // Geometry and materials belong to the template and are shared by every clone, so disposing them
    // here would blank out the local hero too. Only the scene-graph reference is dropped.
    remotes.delete(id);
    return true;
  }

  /**
   * @param sampled  Map<id, {x, z, heading, speed}> from the interpolator
   * @param deltaSeconds  for the animation mixers
   */
  function update(sampled, deltaSeconds) {
    for (const [id, sample] of sampled) {
      const remote = remotes.get(id) ?? spawn(id, sample);
      remote.root.position.set(sample.x, 0, sample.z);
      remote.root.rotation.y = sample.heading;
      // Same locomotion controller as the local hero, so walk/run/idle-hold read identically. Speed
      // comes from the snapshot rather than from differentiating position: differentiating an
      // interpolated path would jitter the clip selection every time a packet arrived late.
      remote.locomotion.update(deltaSeconds, sample.speed);
    }
    // Anyone in the scene but no longer in the sample has gone. This catches a silent disappearance
    // as well as an announced leave, so a dropped connection cannot leave a statue behind.
    for (const id of [...remotes.keys()]) {
      if (!sampled.has(id)) remove(id);
    }
  }

  return {
    update,
    remove,
    get count() {
      return remotes.size;
    },
    get ids() {
      return [...remotes.keys()];
    },
    // For harnesses: what each remote is actually doing, not what it was told to do.
    describe() {
      return [...remotes.values()].map((remote) => ({
        id: remote.id,
        x: remote.root.position.x,
        z: remote.root.position.z,
        heading: remote.root.rotation.y,
        mode: remote.locomotion.getState().activeMode,
        visible: remote.root.visible,
      }));
    },
    dispose() {
      for (const id of [...remotes.keys()]) remove(id);
    },
    locomotionModeForSpeed,
  };
}
