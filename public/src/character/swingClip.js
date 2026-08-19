import * as THREE from '../../vendor/three.module.min.js';

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
          // already correct. The procedural animator had to restore because it wrote OFFSETS onto
          // whatever it found; this writes absolute poses from a clip and cannot accumulate.
        }
        return false;
      }
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
      return true;
    },
    isSwinging() {
      return running;
    },
    clipDuration: clip.duration,
    mixer,
  };
}
