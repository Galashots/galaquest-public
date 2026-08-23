// Other players' heroes: spawn on first sight, drive from interpolated snapshots, remove on leave.
//
// Each clone gets its OWN skeleton and its OWN AnimationMixer. Sharing either would make every remote
// play the same frame of the same clip as the local hero -- the animation equivalent of everyone
// moving in lockstep.
//
// A REMOTE HERO IS DRAWN BY THE SAME THREE ANIMATORS AS THE LOCAL ONE, and for a while it was drawn
// by one. `encounter.heroes[id].{swingSeconds, downSeconds}` has ridden every snapshot for every
// hero since the party fight was written -- net/protocol.js validates them per id, gameServer.mjs
// publishes them from whichever engine holds that body -- and only main.js's own hero ever read
// them. So on the screen where two children fight one wolf, the sibling glided around in idle while
// the wolf lost hp from nowhere, and stood up straight through the two seconds they were dead. The
// data was already here; nothing was drawing it.
//
// DRIVEN FROM STATE, NOT FROM EVENTS, and that is not a shortcut. main.js filters swing/hero-hurt/
// hero-down to the local hero on purpose (GLOBAL_ENCOUNTER_EVENT_TYPES) -- a sibling's bite must not
// flash THIS child's hurt vignette or rewrite their hearts -- so the events are gone before anything
// could draw another body with them. reactClips.js's header already argued the right answer for the
// local hero: "state is continuous and survives a dropped event, and online the mirror already
// carries it every snapshot." One body over, that stops being a preference and becomes the only
// road in.
//
// The flinch is therefore NOT mirrored. It is the one reaction with no continuous state behind it
// -- `hero-hurt` is an event and nothing else -- and reconstructing it from hp falling between two
// snapshots would be a derived fact standing in for a real one, which is the shape of half this
// repo's lessons ledger. A sibling's knockdown and their swing are the two beats a child actually
// reads across the field; a 1.6s stagger is not worth inventing a second event lane for.
//
// One honest imprecision: a remote's POSITION comes from the interpolation buffer, which is
// deliberately behind live by the interpolation delay, while the encounter block is the newest
// snapshot. So a sibling's swing animation leads their body by that delay. Naming it rather than
// pretending otherwise -- it is tens of milliseconds against a 1.5s swing, and the alternative is
// buffering the encounter too, which would delay the local hero's own fight state to match.

import { clone as cloneSkinned } from '../../vendor/utils/SkeletonUtils.js';
import { CHARACTER, setLayer } from '../render/layers.js';
import {
  cloneWeaponAnchors, showWeaponOnClone, weaponMeshIdFor, WILDWOOD_BLADE_CANDIDATE_ID,
} from '../character/weaponLoadout.js';
import { createLocomotionController } from '../character/locomotion.js';
import { locomotionModeForSpeed } from '../character/speed.js';
import { createReactionAnimator } from '../character/reactClips.js';
import { createClipSwingAnimator } from '../character/swingClip.js';
// The clip has to fit the window the RULES own, exactly as reactClips.js imports RESPAWN_SECONDS
// rather than restating it (GQ-007). A presenter reading a rules constant is fine; the rules
// reading a presenter is not.
import { SWING_SECONDS } from '../combat/encounter.js';

/**
 * @param mountWeapon  optional `(clonedRoot, meshId) -> Promise<anchor|null>`. Supplied by main.js,
 *   which owns the loader and the solved transforms; this module holds no handle on either and does
 *   not want one. Absent (offline, tests, the studio) simply means a sibling keeps whatever sword
 *   their clone was born with, which is the same honest fallback as an asset that never lands.
 */
export function createRemotePlayers(scene, template, { mountWeapon = null } = {}) {
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
    // GP1-C4 was: a clone inherits whatever sword the LOCAL hero happened to be holding when it was
    // taken, so a sibling who joined after you equipped the Blade appeared carrying YOUR blade while
    // one who joined before carried the Ironwood -- the same player drawn two ways depending on join
    // order. The answer then was to force every remote to the shipping sword, because the wire had
    // no per-player equipment field and consistency was the best available honesty.
    //
    // The wire has one now (`players[].weaponId`), so the same bug is closed by KNOWING rather than
    // by flattening -- and two children who really are holding different swords are allowed to look
    // different, which is most of the point of earning one. Looked up once here, set every frame.
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
      anchors: cloneWeaponAnchors(root),
      weaponMountInFlight: false,
      // Both degrade per-clip and return null when the rig ships nothing to play, the same contract
      // main.js gets: a remote on a rig with no death clip is still positioned, still walks, and
      // simply cannot be shown falling over.
      reactions: createReactionAnimator(root, template.animations),
      swing: createClipSwingAnimator(root, template.animations),
    };
    remotes.set(id, remote);
    return remote;
  }

  function remove(id) {
    const remote = remotes.get(id);
    if (!remote) return false;
    // ALL THREE MIXERS, not just locomotion's. A mixer keys its bindings by root and holds them
    // until told otherwise; taking the root out of the scene does not touch them. Locomotion has
    // always had a dispose() because it has always been per-remote -- the other two were written for
    // the local hero, who has exactly one for the lifetime of the page and never leaves. Siblings
    // join and leave all session, so they needed the same contract and now have it.
    remote.locomotion.dispose();
    remote.reactions?.dispose();
    remote.swing?.dispose();
    scene.remove(remote.root);
    // Geometry and materials belong to the template and are shared by every clone, so disposing them
    // here would blank out the local hero too. Only the scene-graph reference is dropped.
    remotes.delete(id);
    return true;
  }

  // Mount the mesh this sibling's weapon needs, if this clone has not got it and somebody can
  // fetch it. The Wildwood GLB is loaded lazily -- only when the hero this clone was taken from had
  // equipped it -- so the common case at the moment a child earns the Blade is that their SIBLING'S
  // client has never had a reason to load it. Without this the wire would say "Blade" and every
  // other screen would still draw an Ironwood, which is the defect with an extra step.
  //
  // Fire-and-forget, once per remote: `mountWeapon` resolves null for an asset that is missing or
  // failed, and the in-flight flag is cleared without setting the anchor, so the visibility rule
  // below keeps returning the shipping sword. It does NOT retry -- a mount that failed once will
  // fail again every frame, and a hero holding the wrong sword is a small thing next to a fetch
  // loop at frame rate. loadGLB caches by URL, so a dozen siblings cost one download.
  function ensureRemoteWeapon(remote, weaponId) {
    if (mountWeapon
      && weaponMeshIdFor(weaponId) === WILDWOOD_BLADE_CANDIDATE_ID
      && remote.anchors.candidate === null
      && !remote.weaponMountInFlight) {
      remote.weaponMountInFlight = true;
      Promise.resolve(mountWeapon(remote.root, WILDWOOD_BLADE_CANDIDATE_ID))
        .then((anchor) => {
          // Mounted hidden; showWeaponOnClone is the only thing that ever makes a sword visible, so
          // an arriving asset cannot show itself before the rule agrees. Same discipline main.js
          // applies to the local hero's own lazy mount.
          if (anchor) {
            anchor.visible = false;
            remote.anchors.candidate = anchor;
          }
        })
        // WARNED, NOT SWALLOWED. The first version of this was `.catch(() => {})`, in code whose
        // entire purpose is to make something visible -- and it duly hid the first real failure:
        // the browser check reported a sibling with no blade and nothing said why. A mount that
        // throws is a bug in the attach, not weather. Once per remote, because it will not
        // succeed on a later frame either.
        .catch((error) => {
          console.warn(`[remotes] could not mount ${WILDWOOD_BLADE_CANDIDATE_ID} on ${remote.id}:`, error);
        })
        // Cleared in both directions, and only after the anchor is stored: clearing it first would
        // let the next frame start a second fetch for a mount that had already succeeded.
        .finally(() => { remote.weaponMountInFlight = false; });
    }
    // Recorded so describe() can report what this remote was TOLD, beside what its anchors show.
    // A harness seeing the wrong sword otherwise cannot tell "the server never said" from "it said
    // and we could not draw it" -- repairs in different files. One string, no traversal.
    remote.weaponId = weaponId;
    showWeaponOnClone(remote.anchors, weaponId);
  }

  /**
   * @param sampled  Map<id, {x, z, heading, speed}> from the interpolator
   * @param deltaSeconds  the CLAMPED frame delta, for locomotion and the swing
   * @param reactionDeltaSeconds  the RAW frame delta, for the reaction mixer -- see below
   * @param heroes  encounter.heroes from the newest snapshot, keyed by the same player id the
   *                samples are. Absent or missing entries are fine: a player can be in the players
   *                list before the fight knows about them, and offline there is no encounter at all.
   * @param weapons  equipped item id per player id, from the same snapshot. Missing means "we have
   *                not been told", which resolves to the shipping sword -- the same answer
   *                weaponMeshIdFor gives an unknown id, rather than a second rule about absence.
   *
   * THE TWO DELTAS ARE SEPARATE ARGUMENTS ON PURPOSE. main.js clamps its frame delta so a hitch
   * cannot teleport a hero; an animation mixer has no such hazard, because advancing a clip further
   * is exactly what more elapsed time should do. Passing the clamped one to a reaction mixer plays
   * every reaction in slow motion by the ratio, and the death clip is retimed to only just fit its
   * window at full speed -- measured on the local hero at 3.1fps, his hips never got below 65% of
   * standing height and a child saw him drop to one knee and pop back up. That defect shipped, was
   * found by measuring the rendered skeleton, and would have been reintroduced here verbatim by a
   * single shared `deltaSeconds`. There is deliberately no default: a caller has to say which is
   * which, because the wrong one is silent.
   */
  function update(sampled, { deltaSeconds, reactionDeltaSeconds, heroes = {}, weapons = {} } = {}) {
    for (const [id, sample] of sampled) {
      const remote = remotes.get(id) ?? spawn(id, sample);
      remote.root.position.set(sample.x, 0, sample.z);
      remote.root.rotation.y = sample.heading;

      // WHICH SWORD IS IN THEIR HAND. Every frame rather than on change, because it is two boolean
      // writes against cached anchors -- there is no state to keep in step and therefore no way for
      // it to drift out of step, which is worth more here than the two writes cost.
      ensureRemoteWeapon(remote, weapons[id] ?? null);

      const hero = heroes[id] ?? null;
      const downSeconds = hero?.downSeconds ?? -1;
      const isDown = downSeconds >= 0;
      // Server truth only. main.js predicts its OWN swing so the button feels immediate; there is
      // nothing to predict here -- we have no idea what another child's thumb is doing, and a
      // guessed swing would be an arc that never happened.
      const swingSeconds = hero?.swingSeconds ?? -1;

      // Same locomotion controller as the local hero, so walk/run/idle-hold read identically. Speed
      // comes from the snapshot rather than from differentiating position: differentiating an
      // interpolated path would jitter the clip selection every time a packet arrived late.
      //
      // ...and not at all while they are down, which is the half that makes clampWhenFinished mean
      // anything. A finished action stops writing; it does not hold. The wolf's corpse stays down
      // only because nothing else writes the wolf's pose, and locomotion here would be rewriting a
      // full idle pose underneath the death clip every single frame.
      if (!isDown) remote.locomotion.update(deltaSeconds, sample.speed);

      // Reactions over the stride, an active swing over a reaction: the mechanical half of the
      // owner's attack-takes-precedence rule, in the same order main.js runs it.
      //
      // EXCEPT while down, where the two swap. swingClip's action.stop() restores the pose the
      // skeleton held when the swing STARTED, which is stale the moment a hero dies mid-swing.
      // Locomotion papers over that one frame later in the ordinary case; while down it is not
      // running, so nothing does. Swing first means the stale restore lands before the death pose
      // is written, and death is the write that survives the frame.
      //
      // HONESTLY: no test in test/remote-heroes.test.mjs proves this swap. Removing it and running
      // the die-mid-swing case leaves all nine green, so on this path the restore never won a frame
      // to begin with. It is kept because it matches what main.js does for the local hero, where the
      // hazard WAS measured, and because a remote is drawn by the same three animators in the same
      // order -- not because anything here caught it. Said out loud so the next person does not read
      // the comment above as a claim the suite backs.
      if (isDown) {
        remote.swing?.update(swingSeconds, SWING_SECONDS, deltaSeconds);
        remote.reactions?.update(reactionDeltaSeconds, { downSeconds });
      } else {
        remote.reactions?.update(reactionDeltaSeconds, { downSeconds });
        remote.swing?.update(swingSeconds, SWING_SECONDS, deltaSeconds);
      }
      remote.down = isDown;
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
        // Read off the animators, not off the snapshot that was handed in: a harness asking what a
        // sibling looks like must get the answer from whatever is posing the body. `down` falls back
        // to the flag because a rig with no death clip has no animator to ask, and it is still down.
        down: remote.reactions?.getState().death ?? remote.down === true,
        swinging: remote.swing?.isSwinging() === true,
        weaponId: remote.weaponId ?? null,
        visible: remote.root.visible,
      }));
    },
    dispose() {
      for (const id of [...remotes.keys()]) remove(id);
    },
    locomotionModeForSpeed,
  };
}
