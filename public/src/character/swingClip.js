import * as THREE from '../../vendor/three.module.min.js';
import { CROSSFADE_SECONDS } from './locomotion.js';

// The sword swing, played from a real clip.
//
// This supersedes the procedural arc in swing.js, which shipped because the hero had no attack clip
// at all. It exposes the SAME interface -- update(swingSeconds, swingDurationSeconds) and
// isSwinging() -- so main.js can pick one or the other at the call site and nothing downstream cares.
// swing.js stays pure, three.js-free and unit-tested; putting a mixer inside it would have cost that.
//
// THE CLIP IS DRIVEN FROM THE RULES' CLOCK, NOT LEFT TO RUN ON ITS OWN. sword_slash is authored at
// 1.5s and encounter.js's SWING_SECONDS is 0.45s, so a free-running action would still be winding up
// when the rules had already resolved the blow, landed damage, and started the cooldown. Instead the
// action's time is set every frame from swingSeconds/swingDurationSeconds, which locks the two
// together by construction: the clip spans exactly one swing whatever either duration becomes later,
// and nobody has to remember to re-tune a constant in two files. That matters more than it sounds --
// what the child sees and what the rules did have to be the same event, or the wolf flinches before
// the sword arrives and the game reads as cheating.
//
// The consequence, stated plainly because it is a real cost: the clip therefore plays at about 3.3x
// its authored speed. If that reads as frantic the fix is to lengthen SWING_SECONDS in encounter.js
// -- a combat-feel decision for the owner, not a rendering one -- and this file needs no change when he
// makes it.
//
// AP2-A / THE FLICKER, proven in tools/foundry/diagnose_swing_arbitration.mjs's
// 'render-faster-than-authoritative-tick' scenario and pinned in test/swing-render-rate.test.mjs.
// `swingSeconds` above is authoritative-truth, not render-rate truth: online it only changes when a
// new server snapshot arrives (net/protocol.js SNAPSHOT_HZ, 10 Hz), while the render loop calls this
// update() up to 60 times a second (render/renderer.js MAX_FPS). The old code set `action.time`
// straight from that quantized value and called `mixer.update(0)` every render frame regardless.
//
// Read directly out of public/vendor/three.module.min.js (PropertyMixer.apply): a binding is only
// written when the value just accumulated differs from the one the PREVIOUS apply() produced --
// `for (t=e; t!==2e; ++t) if (n[t]!==n[t+e]) { a.setValue(n,i); break }`. Two consecutive render
// frames with an unchanged `action.time` accumulate the identical pose and the second apply() is a
// silent no-op, so whatever locomotion.js wrote earlier THAT SAME frame (it runs first and always
// advances) is what stays on screen. On the one render frame in three where swingSeconds actually
// ticks, the value differs and the swing pose reasserts -- which is exactly AP1's measurement: a
// swing pose on the tick frame, the near-rest locomotion pose on the two render frames either side of
// it, 19 alternations across one attack.
//
// THE FIX is a render-rate visual clock, decoupled from the authoritative one: `visualSeconds` below
// advances by real render deltaSeconds on every call, so `action.time` -- and therefore the
// accumulated buffer PropertyMixer compares against -- changes on every render frame regardless of
// whether the authoritative sample did. `Math.max` with the authoritative value means a fresh tick
// instantly pulls the visual clock forward (no lag accumulates) and it can never go backward (no
// rewind from tick quantization) -- it can only ever be gently ahead of authority by less than one
// render frame, which nobody can see. Combat authority is untouched: this is presentation only, reads
// `swingSeconds` but never writes back to it, and SWING_SECONDS stays encounter.js's call.
export const SWING_CLIP_FRAGMENT = 'sword_slash';

export function findSwingClip(animations = []) {
  return animations.find((clip) => clip.name.toLowerCase().includes(SWING_CLIP_FRAGMENT)) ?? null;
}

/**
 * Returns null when the hero ships no attack clip, so the caller can fall back to swing.js.
 *
 * Null rather than a silent no-op object: a hero with no swing at all is a broken-looking game, and
 * the caller having to handle the absence is what keeps the fallback reachable instead of decorative.
 */
// THE RELEASE BLEND (issue backlog: "hero flashes back to idle after an attack").
//
// When a swing ended, this animator called action.stop() and let the very next frame show whatever
// locomotion had written -- a one-frame cut from the clamped follow-through of a clip driving all 24
// joints to the current idle/walk frame. Correct, as the old comment said, but not continuous, and
// at gameplay framing it read as the hero teleporting between poses.
//
// A mixer crossfade cannot fix it: the two clips live on DIFFERENT mixers (see the mixer comment
// below for why), and the vendored PropertyMixer.apply blends a sub-1 cumulative weight toward the
// binding's SAVED ORIGINAL state -- the buffer at `_origIndex`, captured at bind time -- not toward
// whatever the other mixer wrote this frame. Fading this action's weight out would therefore blend
// the swing toward a stale bind pose, not toward the walk.
//
// So the blend is manual, and it follows the discipline swing.js and the idle breath both paid to
// learn: set from a captured base, never accumulate, never trust a mixer to rewrite anything. While
// the swing runs, the pose it wrote this frame is snapshotted (quaternion + position of every bone
// the clip drives). When it ends, the action stops as before -- and for SWING_RELEASE_SECONDS the
// update slerps each of those bones FROM the locomotion pose (already written this frame, since this
// runs last) TOWARD the snapshot, at a weight that decays to zero. The last swing frame therefore
// dissolves into the stride over one crossfade instead of vanishing between two frames. Presentation
// only: combat authority, isSwinging(), and the rules' clock are untouched, and a hero who dies
// mid-swing simply has the first beat of the fall carry a trace of the swing, which is what dying
// mid-motion looks like.
export const SWING_RELEASE_SECONDS = CROSSFADE_SECONDS;

// The bones sword_slash actually drives, read off the clip's own track names rather than assumed.
// A track name is `NodeName.property`; nodes the rig does not contain are skipped the same way the
// settle and the swing skip missing bones.
function trackedNodes(root, clip) {
  const byNode = new Map();
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot <= 0) continue;
    const nodeName = track.name.slice(0, dot);
    const property = track.name.slice(dot + 1);
    if (property !== 'quaternion' && property !== 'position') continue;
    const node = root.getObjectByName(nodeName);
    if (!node) continue;
    const entry = byNode.get(node) ?? { node, quaternion: false, position: false };
    entry[property] = true;
    byNode.set(node, entry);
  }
  return [...byNode.values()].map((entry) => ({
    ...entry,
    // Snapshot storage, allocated once here rather than per frame.
    snapshotQuaternion: entry.quaternion ? new THREE.Quaternion() : null,
    snapshotPosition: entry.position ? new THREE.Vector3() : null,
  }));
}

export function createClipSwingAnimator(root, animations = []) {
  const clip = findSwingClip(animations);
  if (!clip) return null;

  // Its own mixer, deliberately. The locomotion controller owns a mixer running the walk and idle
  // clips, and sword_slash drives all 24 joints -- sharing a mixer would blend the two by weight and
  // produce a hero half-walking and half-swinging. Two mixers on one root means last writer wins, and
  // main.js updates this one AFTER locomotion, which is the same ordering the procedural swing relied
  // on. A swing therefore fully overrides the stride, which is what a rooted melee attack should do.
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  let running = false;
  // The render-rate visual clock the header above describes. Only meaningful while running; reset to
  // 0 the moment a swing ends so the next one starts clean rather than off some stale leftover value.
  let visualSeconds = 0;

  // The release blend's state -- see SWING_RELEASE_SECONDS above. `tracked` is resolved once from
  // the clip's own tracks; `releaseRemaining` counts down from SWING_RELEASE_SECONDS after a swing
  // ends; the per-node snapshots hold the last pose the swing actually wrote.
  const tracked = trackedNodes(root, clip);
  let releaseRemaining = 0;
  let snapshotValid = false;

  function snapshotSwingPose() {
    for (const entry of tracked) {
      if (entry.snapshotQuaternion) entry.snapshotQuaternion.copy(entry.node.quaternion);
      if (entry.snapshotPosition) entry.snapshotPosition.copy(entry.node.position);
    }
    snapshotValid = tracked.length > 0;
  }

  function applyReleaseBlend(weight) {
    for (const entry of tracked) {
      if (entry.snapshotQuaternion) entry.node.quaternion.slerp(entry.snapshotQuaternion, weight);
      if (entry.snapshotPosition) entry.node.position.lerp(entry.snapshotPosition, weight);
    }
  }

  return {
    /**
     * @param swingSeconds encounter.hero.swingSeconds -- negative when no swing is running.
     * @param deltaSeconds real render-frame time, driving the visual clock (see header). Optional --
     *   defaults to 0, which degrades to the old tick-locked behaviour rather than throwing, for any
     *   caller (a diagnostic, a test) that only cares about a specific swingSeconds and does not model
     *   render cadence at all. swing.js's own update() ignores this third argument entirely; JS drops
     *   extra call arguments rather than erroring, so one call site in main.js serves both animators.
     */
    update(swingSeconds, swingDurationSeconds, deltaSeconds = 0) {
      if (swingSeconds < 0) {
        if (running) {
          action.stop();
          running = false;
          visualSeconds = 0;
          // Nothing is restored here on purpose. locomotion.update() runs before this every frame
          // and rewrites the whole pose from its own clip, so the frame after a swing ends is
          // already correct in VALUE -- the release blend below exists because it is not continuous,
          // and carries the last swing pose out over one crossfade instead of one frame.
          releaseRemaining = snapshotValid ? SWING_RELEASE_SECONDS : 0;
        }
        if (releaseRemaining > 0) {
          releaseRemaining = Math.max(0, releaseRemaining - Math.max(0, deltaSeconds));
          const weight = SWING_RELEASE_SECONDS > 0 ? releaseRemaining / SWING_RELEASE_SECONDS : 0;
          // The bones currently hold the locomotion pose (it ran first); pull them part-way back
          // toward the snapshot, by less each frame, until the blend has nothing left to say.
          if (weight > 0) applyReleaseBlend(weight);
          else snapshotValid = false;
        }
        return false;
      }
      // A fresh swing pre-empts any release still fading -- the new clip owns the pose outright.
      releaseRemaining = 0;
      if (!running) {
        action.reset().play();
        running = true;
        visualSeconds = Math.max(0, swingSeconds);
      } else {
        visualSeconds = Math.max(visualSeconds + Math.max(0, deltaSeconds), swingSeconds);
      }
      const progress = swingDurationSeconds > 0 ? visualSeconds / swingDurationSeconds : 1;
      action.time = Math.min(clip.duration, Math.max(0, progress) * clip.duration);
      // Zero delta: the mixer evaluates at the time just set (visualSeconds, above) rather than
      // advancing a clock of its own. See the header for why action.time itself must still change on
      // every call even when swingSeconds does not.
      mixer.update(0);
      // The pose just written is what the release blend will dissolve from if this turns out to be
      // the swing's last frame -- refreshed every frame because the END of a swing is only ever
      // known one frame late, when swingSeconds has already gone negative and locomotion has
      // already overwritten the rig.
      snapshotSwingPose();
      return true;
    },
    isSwinging() {
      return running;
    },
    /** See reactClips.js's dispose(): the local hero never needed one, a remote clone does. */
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
    clipDuration: clip.duration,
    mixer,
  };
}
