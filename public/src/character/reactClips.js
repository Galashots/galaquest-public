import * as THREE from '../../vendor/three.module.min.js';
// The rules own how long a hero stays down; this module only has to fit a clip inside that. Imported
// rather than restated (GQ-007) -- the whole defect below was a clip and a window disagreeing.
import { RESPAWN_SECONDS } from '../combat/encounter.js';

// The hero's hit reaction and death, played from real clips.
//
// The clips LANDED: hero_lod1_ironwood_atlas.glb (the rig character/hero.js actually loads) ships
// `hit` at 1.63s and `death` at 2.97s. This header used to say they never arrived, which was true
// on 2026-08-13 and stale by the time anyone read it again -- and it cost real time, because it sent
// the next person looking for the reason a downed hero stood upright anywhere except at the clip
// that was already playing.
//
// THE REASON HE STOOD UPRIGHT, found by playing it: the death clip is 2.97s long and the hero is
// only DOWN for RESPAWN_SECONDS, which is 2. At the moment the game stands him back up he was barely
// a third of the way through falling over, so what a child saw was a small stagger and then a hero
// back on his feet -- no death at all. See DEATH_FALL_FRACTION below.
//
// THE PRECEDENCE RULE IS THE OWNER'S, verbatim from 2026-08-13: "attack takes precedence, and hit only
// shows if the testers are not attacking and only getting hit." Two mechanisms enforce it, on purpose:
//   1. triggerHit REFUSES while a swing is running -- the rule itself, testable in node.
//   2. main.js updates this animator BETWEEN locomotion and the swing animator, so even a hit that
//      somehow started would be overwritten by the swing's own full-pose write every frame. The
//      ordering is the same last-writer-wins contract swingClip.js documents against locomotion.
// Without mechanism 1, a hit triggered late in a swing would pop in for its tail end the moment the
// swing stopped writing -- refused at the door is the rule; painted over is an accident.
//
// Death is driven from published state (hero.downSeconds), not from the hero-down event, for the
// same reason the wolf presenter reads wolf.mode: state is continuous and survives a dropped
// event, and online the mirror already carries it every snapshot.

export const HIT_CLIP_FRAGMENT = 'hit';
export const DEATH_CLIP_FRAGMENT = 'death';

/**
 * What fraction of the time the hero is DOWN the fall itself is allowed to take. The clip is
 * retimed to fit, so the remaining time is spent lying there on the clamped last frame -- which is
 * the part that actually reads as "you went down", and the part a 2.97s clip in a 2s window never
 * reached at all.
 *
 * 0.55: over in a bit more than a second, then most of a second on the ground before he gets up.
 */
export const DEATH_FALL_FRACTION = 0.55;

/** The playback rate that lands `clipSeconds` of falling inside `downSeconds` of being down.
 *  Never slows a clip down: a death that is already quick enough should play at its authored speed
 *  rather than being stretched to fill the window. */
export function deathTimeScale(clipSeconds, downSeconds, fallFraction = DEATH_FALL_FRACTION) {
  const target = downSeconds * fallFraction;
  if (!(clipSeconds > 0) || !(target > 0)) return 1;
  return Math.max(1, clipSeconds / target);
}

/** Same lowercase-substring rule as locomotion.js findClip and swingClip.js findSwingClip. */
export function findReactionClips(animations = []) {
  const find = (fragment) => animations.find((clip) => clip.name.toLowerCase().includes(fragment)) ?? null;
  return { hit: find(HIT_CLIP_FRAGMENT), death: find(DEATH_CLIP_FRAGMENT) };
}

/**
 * Returns null when the hero ships neither clip, so the caller can see the absence -- the same
 * contract as createClipSwingAnimator. One clip without the other degrades per-clip: a hit-only
 * rig flinches but does not animate death, and vice versa.
 */
export function createReactionAnimator(root, animations = []) {
  const clips = findReactionClips(animations);
  if (!clips.hit && !clips.death) return null;

  // Its own mixer, for the same reason swingClip.js owns one: sharing would blend by weight where
  // the design wants a full override, and update order between the three (locomotion, this, swing)
  // is the whole priority scheme.
  const mixer = new THREE.AnimationMixer(root);

  // LoopOnce WITHOUT clamp: when the flinch finishes it stops writing, and locomotion (which runs
  // first every frame) is already rewriting the pose, so the hero recovers on the next frame.
  const hitAction = clips.hit ? mixer.clipAction(clips.hit) : null;
  if (hitAction) hitAction.setLoop(THREE.LoopOnce, 1);

  const deathAction = clips.death ? mixer.clipAction(clips.death) : null;
  // LoopOnce WITH clamp: the corpse holds its last frame for as long as the hero is down. A death
  // that springs back upright is the exact bug the wolf's death clip was rebuilt to kill -- and it
  // was live on the hero until this was measured. Two separate things were wrong.
  //
  // ONE, the clip is 2.97s and the hero is only down for RESPAWN_SECONDS, which is 2. He was a third
  // of the way through falling over when the game stood him back up. Retimed to fit, below.
  //
  // TWO, clampWhenFinished held nothing, because holding is not something an action DOES -- a
  // finished action simply stops writing, and the wolf's corpse stays put only because nothing else
  // writes the wolf's pose. The hero has locomotion rewriting a full idle pose every frame, so the
  // instant this mixer stopped applying, idle was back. main.js now skips locomotion entirely while
  // the hero is down, which is what makes the clamp mean anything here.
  if (deathAction) {
    deathAction.setLoop(THREE.LoopOnce, 1);
    deathAction.clampWhenFinished = true;
    deathAction.setEffectiveTimeScale(deathTimeScale(clips.death.duration, RESPAWN_SECONDS));
  }

  let down = false;

  return {
    hasHitClip: Boolean(hitAction),
    hasDeathClip: Boolean(deathAction),

    /**
     * Call on the hero-hurt event. Refused -- returns false -- while a swing runs (the owner's rule),
     * while the hero is down (a corpse does not flinch), or when the rig has no hit clip.
     * @param swinging the swing animator's isSwinging() at the moment the event dispatches.
     */
    triggerHit({ swinging = false } = {}) {
      if (!hitAction || swinging || down) return false;
      hitAction.reset().play();
      return true;
    },

    /**
     * Every frame, between locomotion.update() and swing.update().
     * @param hero the published encounter hero state; only downSeconds is read.
     */
    update(deltaSeconds, { downSeconds = -1 } = {}) {
      const nowDown = downSeconds >= 0;
      if (nowDown && !down && deathAction) {
        // Going down cancels an in-flight flinch rather than blending a stagger into a collapse.
        if (hitAction) hitAction.stop();
        deathAction.reset().play();
      } else if (!nowDown && down && deathAction) {
        deathAction.stop();
      }
      down = nowDown;
      mixer.update(deltaSeconds);
    },

    getState() {
      return {
        hit: Boolean(hitAction?.isRunning()),
        death: Boolean(down && deathAction),
      };
    },

    mixer,
  };
}

