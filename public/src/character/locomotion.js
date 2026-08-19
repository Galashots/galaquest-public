import * as THREE from '../../vendor/three.module.min.js';

// The speed law lives in speed.js so the node game server can import it without three.js, and is
// re-exported here so every existing caller and test keeps its import path. One definition, shared by
// client prediction and server authority -- see speed.js for why that matters.
export {
  groundSpeedForInput,
  locomotionModeForSpeed,
  playbackRateForSpeed,
  RUN_DEFLECTION,
  RUN_SPEED,
  RUN_THRESHOLD,
  WALK_SPEED,
} from './speed.js';

import { playbackRateForSpeed, locomotionModeForSpeed, RUN_SPEED, WALK_SPEED } from './speed.js';

export const CROSSFADE_SECONDS = 0.18;

// Which frame of the walk clip a standing hero holds. The clip runs 1.0417s, so 0.22 and 0.7408 are
// the same pose with the arms swapped, and the choice between them is an art decision rather than a
// technical one. It was 0.22, which holds the SHIELD arm behind the body -- measured on the live rig
// at hero-local Z -0.179 against the sword arm's +0.202 -- so the shield sat tucked behind the torso
// and read as a plate strapped to his back. Half a cycle later the shield arm leads at +0.297 and the
// sword arm trails at -0.176, which is the arrangement in the reference art the owner supplied.
export const IDLE_HOLD_TIME = 0.7408;

// The hero ships with two clips, walking and running, and no idle. Standing therefore froze a
// single walk frame forever, which the status line called "walk frame held" and which reads as a
// broken game rather than a person waiting. Authoring a real idle clip is the proper fix and needs
// Blender; this is the cheap one that makes a standing hero look alive in the meantime.
//
// Rotation only, deliberately. The armature root carries a scale of 0.01, so bone-local TRANSLATION
// is 100x world and a hip bob would need a rig-specific constant to stay subtle. Rotation is
// scale-invariant, so these numbers mean the same thing on any rig.
export const BREATH_PERIOD_SECONDS = 3.4;
export const BREATH_SPINE_RADIANS = 0.028;
export const SWAY_PERIOD_SECONDS = 7.9;
export const SWAY_SPINE_RADIANS = 0.016;
export const IDLE_SPINE_BONE = 'Spine01';

/**
 * Where the spine sits, relative to the held pose, at a given moment of standing still.
 *
 * The two periods are deliberately not a tidy ratio: 7.9 against 3.4 is about 2.32, so the pair
 * takes minutes to return to the same combination. Equal or simply-related periods make the idle
 * repeat every cycle, and the eye reads that as a mechanism rather than a person.
 */
export function breathingOffset(elapsedSeconds) {
  return {
    spinePitch: Math.sin((elapsedSeconds / BREATH_PERIOD_SECONDS) * Math.PI * 2) * BREATH_SPINE_RADIANS,
    spineYaw: Math.sin((elapsedSeconds / SWAY_PERIOD_SECONDS) * Math.PI * 2) * SWAY_SPINE_RADIANS,
  };
}

function findClip(animations, fragment) {
  return animations.find((clip) => clip.name.toLowerCase().includes(fragment));
}

// ---------------------------------------------------------------------------
// The idle arm settle (2026-08-14)
// ---------------------------------------------------------------------------
//
// Idle_02's third route, taken. The comment on `idle` below records the owner's judgement -- "I agree
// Idle_02 for now, but it does look awkward... the arms hang wide and straight and the pose reads
// stiff" -- and names three ways out: a different clip, a hand-authored idle, or a small procedural
// lean layered on top. The first was already tried and rejected (combat_stance hides the shield);
// the second needs Blender and an art pass. This is the third, and it is deliberately the smallest
// thing that fixes what he actually named.
//
// WHAT WAS WRONG, measured in the running game rather than described. Idle_02 holds the sword hand
// 0.199 m outboard of its own shoulder and 0.145 m higher than a hanging arm would -- about 46
// degrees off vertical, which is halfway to a T-pose. That is the "scarecrow" read. It also made the
// weapon carry unfixable: with the hand at y=0.824 and only 0.336 m from grip to tip, no blade angle
// reaches a 0.348 m knee, which is why the 2026-08-13 sword re-tune aimed at knee height and landed
// at the hip. Pose first, then gear -- see gear.js's own header.
//
// WHICH AXES, and why these and not the obvious ones. Every value here was measured by perturbing
// one bone axis at a time in the live game and reading where the hand and the shield actually went
// (.local/solve-idle.mjs's Jacobian), NOT derived from what the axis names suggest. AGENTS.md's
// "Look before you derive" applies to rigs as much as to art: rotation.x turned out to be the
// inward axis for BOTH upper arms, which is not what a Z-up intuition would guess.
//
//   RightArm.x  +0.472  brings the sword hand in (+0.028 m per 0.15 rad) and down (-0.022 m).
//   LeftArm.x   +0.156  the same for the shield arm, which is more responsive per radian.
//   LeftForeArm.y +0.333 UNDOES the shield roll the line above causes. Rolling the upper arm in also
//                       rolls the forearm the shield is strapped to, and the first attempt turned
//                       the disc edge-on to the gameplay camera -- a real loss, since both testers
//                       named the shield unprompted when they picked Tier 3. `y` is the forearm's
//                       twist axis, chosen by measurement: it moves the shield's facing 24x more per
//                       unit of hand movement than either other axis (x scores 4.9, z scores 3.0).
//                       Solved to return the shield's outwardness to 0.8276 against the 0.828 it had
//                       before the settle -- i.e. back to the value Sol reviewed and the owner accepted.
//   RightForeArm.x +0.18 a little elbow, so the sword arm reads relaxed rather than ramrod straight.
//
// THE ARM ANGLES ARE 10 DEGREES MORE OPEN THAN THE FIRST SOLVE, ON SOL'S NOTE. Asked to judge the
// first pass against reference, he called the arms "slightly too narrow now, especially the sword
// arm... at gameplay scale both arms collapse into the torso", and named the real cost: "the
// weapon-side silhouette is too compressed -- at play distance the sword, hand, forearm and leg
// nearly become one vertical shape". His prescription was +8-12 degrees outward on each upper arm
// (explicitly "do not return anywhere near the old 46") and 5-10 degrees of outward yaw on the
// blade, which is in gear.js as outboard 22 rather than 15. He also ruled the shield cant and the
// sword pitch finished -- "leave the cant alone", "keep sword pitch" -- so neither moved. Both
// changes are in this pass; the separation is visible at distance 8 in .local/runtime-test/.
//
// THE COMPENSATION IS IN THE POSE, NOT IN THE SHIELD'S MOUNT, and that is the one design decision
// here worth arguing with. gear.js's rest transform is shared by walking, running and the slash, so
// paying for an idle-only pose change out of it would break three animations to fix one. The shield
// mount is therefore untouched -- its baked value is byte-identical to what Fable left.
export const IDLE_ARM_SETTLE = Object.freeze([
  Object.freeze({ bone: 'RightArm', axis: 'x', radians: 0.472 }),
  Object.freeze({ bone: 'LeftArm', axis: 'x', radians: 0.156 }),
  Object.freeze({ bone: 'LeftForeArm', axis: 'y', radians: 0.333 }),
  Object.freeze({ bone: 'RightForeArm', axis: 'x', radians: 0.18 }),
]);

// How long the settle takes to blend in when the hero stops, and out when he moves. Matched to
// CROSSFADE_SECONDS on purpose: the clip crossfade and the settle then arrive together, so stopping
// is one movement rather than a fade with a snap inside it. Applying it instantly is what this
// constant exists to prevent -- the arms visibly jumped inward the frame the stick was released.
export const IDLE_SETTLE_SECONDS = CROSSFADE_SECONDS;

/**
 * @param options.applyIdleSettle Defaults to false as of AP2-A's owner ruling. IDLE_ARM_SETTLE was
 *   measured against Idle_02's specific scarecrow arms (46 degrees off vertical); review-hero-idle11.mjs
 *   proved it visibly harms native Idle_11 -- Sol's call, having reviewed both columns: "the RAW column
 *   is materially better than SETTLED... the old IDLE_ARM_SETTLE clearly damages Idle_11 by collapsing
 *   both arms inward." The shipped hero now carries Idle_11 (see hero.js's HERO_URL / the shipped
 *   hero_lod1_ironwood_atlas.glb), so the settle's whole justification -- Idle_02's stiff, wide-armed
 *   pose -- no longer exists as a rig this game ships. The mechanism stays here, opt-in, rather than
 *   deleted: it is small, still correctly tested, and cheap to reach for again if a future idle needs
 *   the same fix Idle_02 did.
 */
export function createLocomotionController(root, animations, options = {}) {
  const { applyIdleSettle = false } = options;
  const mixer = new THREE.AnimationMixer(root);
  const clips = {
    run: findClip(animations, 'running'),
    walk: findClip(animations, 'walking'),
    // Added 2026-08-13. The hero finally has a real idle -- the owner's playtest note was that the
    // character "still idles in a mid-walk stance", which is exactly what IDLE_HOLD_TIME below was a
    // stand-in for. Everything about the held frame and the procedural breath stays in this file as
    // the fallback path for a rig without this clip, and is what runs if `idle` is ever absent.
    //
    // 'idle' and not 'combat_stance', which is also merged into the hero and was tried side by side.
    // combat_stance is the better-looking pose in isolation -- side-on, weight on the back foot,
    // sword forward -- but it carries the left arm across the body, and since the shield is mounted
    // on that forearm it ends up behind his shoulder reading as slung rather than carried. both testers
    // named the shield unprompted when they picked Tier 3, so hiding it is a real loss. Idle_02 also
    // reads correctly from any camera angle, where a side-on stance only reads when he happens to be
    // facing across the view. the owner's call to revisit; combat_stance is one word away.
    //
    // RESOLVED, AP2-A: Idle_02's stiff wide-armed pose (2026-08-13's "I agree Idle_02 for now, but it
    // does look awkward" note) is gone -- 'idle' now names native Idle_11, reviewed against Idle_02
    // and against IDLE_ARM_SETTLE-corrected Idle_02, and shipped on Sol's ruling. The 'idle' vs
    // combat_stance reasoning above is unchanged and still the reason 'idle' is the lookup key: it is
    // about the shield-hiding cost of combat_stance's crossed arm, not about which idle clip wins.
    // breathingOffset below is still here, unused on any rig that has an idle clip.
    idle: findClip(animations, 'idle'),
  };
  const actions = new Map();
  for (const [mode, clip] of Object.entries(clips)) {
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.enabled = true;
    actions.set(mode, action);
  }

  let activeMode = actions.has('walk') ? 'walk' : actions.has('run') ? 'run' : null;
  let activeAction = activeMode ? actions.get(activeMode) : null;
  if (activeAction) activeAction.play();

  function switchMode(nextMode, immediate = false) {
    const nextAction = actions.get(nextMode) ?? activeAction;
    if (!nextAction || nextAction === activeAction) return;
    const previousAction = activeAction;
    activeMode = actions.has(nextMode) ? nextMode : activeMode;
    activeAction = nextAction;
    activeAction.reset().play();
    activeAction.paused = false;
    if (previousAction) {
      if (immediate) previousAction.stop();
      else previousAction.crossFadeTo(activeAction, CROSSFADE_SECONDS, false);
    }
  }

  // Resolved once. A rig without this bone simply gets the old frozen hold rather than an error.
  const idleSpine = root.getObjectByName(IDLE_SPINE_BONE) ?? null;
  let standingSeconds = 0;
  // The pose the breath is measured FROM, captured when standing starts and restored when it ends.
  //
  // The first version of this added the offset onto whatever the bone already held, assuming the
  // mixer rewrote the pose from the clip every frame. Measured in the running game, the spine reached
  // 1.82 radians -- 104 degrees -- while every unit test passed, because breathingOffset itself was
  // correct the whole time.
  //
  // CORRECTED 2026-08-12. This comment used to say the drift happened because "the hero's walk clip
  // carries no track for Spine01". That is false, and re-measuring the shipped GLB is what showed it:
  // both clips carry 72 channels over all 24 joints, translation/rotation/scale for every one,
  // Spine01 included. So the clip does drive the bone, and the real mechanism -- most likely the
  // standing branch's mixer.update(0) with the action paused, which does not reliably re-apply the
  // binding -- has NOT been proven. The fix is right and the drift was real; only the stated cause
  // was wrong. Set from a base, never accumulate, and do not rely on the clip to reset anything.
  let idleBase = null;

  // Resolved once, the same way idleSpine is. A rig missing one of these bones simply does not get
  // that part of the settle rather than throwing.
  const settleBones = IDLE_ARM_SETTLE
    .map((entry) => ({ ...entry, node: root.getObjectByName(entry.bone) ?? null }))
    .filter((entry) => entry.node !== null);
  let settleWeight = 0;
  // The pose each settled bone held BEFORE the settle was added, so it can be handed back untouched.
  const settleBase = settleBones.map(() => ({ x: 0, y: 0, z: 0 }));
  let settleApplied = false;

  // WHY THIS IS A RESTORE-THEN-REAPPLY AND NOT A `+=` AFTER `mixer.update()`.
  //
  // The obvious version -- add the offset once the mixer has written the clip's pose, and trust the
  // next frame's write to wipe it -- was written, and it drifts to 515 radians in eight stop-start
  // cycles. `test/idle-arm-settle.test.mjs` pins it.
  //
  // The cause is measured, not guessed, and it is worth knowing for anything else layered on a clip:
  // three.js's PropertyMixer only calls `binding.setValue` when the value it accumulated DIFFERS
  // from the one it applied last time. A track that holds the same value across two frames is
  // therefore not written at all, and an offset added on top is never cleared. Probed directly on
  // r170 with a constant quaternion track: frame 0 reads 0.0000 and leaves 0.6400, frame 1 reads
  // 0.6400 and leaves 1.2800, and so on -- the mixer stops writing after the first frame.
  //
  // This is the same class of hazard the breath below already pays for, and this file's own comment
  // on it -- "Set from a base, never accumulate, and do not rely on the clip to reset anything" --
  // is exactly right. It just did not go far enough: the earlier comment blamed the PAUSED fallback
  // path, and a PLAYING action on a constant track has the identical problem.
  //
  // So the settle is removed before the mixer runs and re-added after. The bone the mixer sees is
  // always the clip's own pose, whether or not the mixer chooses to write it that frame.
  function restoreArmSettle() {
    if (!settleApplied) return;
    settleBones.forEach((entry, index) => {
      const base = settleBase[index];
      entry.node.rotation.set(base.x, base.y, base.z);
    });
    settleApplied = false;
  }

  function applyArmSettle() {
    if (settleWeight <= 0) return;
    settleBones.forEach((entry, index) => {
      const { rotation } = entry.node;
      const base = settleBase[index];
      base.x = rotation.x;
      base.y = rotation.y;
      base.z = rotation.z;
      rotation[entry.axis] = base[entry.axis] + entry.radians * settleWeight;
    });
    settleApplied = true;
  }

  return {
    update(deltaSeconds, groundSpeed) {
      if (!activeAction) return;

      // Hand the settled bones back to the clip before the mixer touches them. See the comment on
      // restoreArmSettle: the mixer cannot be relied on to overwrite them itself.
      restoreArmSettle();

      const nextMode = locomotionModeForSpeed(groundSpeed);
      // Blend the settle toward standing or moving before either branch uses it, so the walk branch
      // keeps applying a decaying settle for the length of one crossfade instead of dropping it.
      const settleTarget = groundSpeed === 0 && actions.has('idle') && applyIdleSettle ? 1 : 0;
      const settleStep = IDLE_SETTLE_SECONDS > 0 ? deltaSeconds / IDLE_SETTLE_SECONDS : 1;
      settleWeight += Math.max(-settleStep, Math.min(settleStep, settleTarget - settleWeight));
      settleWeight = Math.max(0, Math.min(1, settleWeight));

      if (groundSpeed === 0) {
        // A real idle clip: just play it. It carries its own breathing, so the procedural breath
        // below is not layered on top -- doing both would fight, and the clip drives Spine01 every
        // frame, which is the bone the breath writes.
        if (actions.has('idle')) {
          switchMode('idle');
          activeAction.paused = false;
          activeAction.setEffectiveTimeScale(1);
          mixer.update(deltaSeconds);
          applyArmSettle();
          return;
        }

        // FALLBACK, for a rig with no idle clip: hold one walk frame and fake a breath on top. This
        // is what shipped until 2026-08-13 and what the owner's playtest called "idling in a mid-walk
        // stance". Kept because it is the only thing standing between a clipless rig and a hero
        // frozen mid-stride, not because it is good.
        switchMode('walk', true);
        activeAction.paused = false;
        activeAction.time = IDLE_HOLD_TIME;
        activeAction.setEffectiveWeight(1);
        mixer.update(0);
        activeAction.paused = true;

        // The breath goes on AFTER the mixer has written the held pose, and is SET from a captured
        // base rather than added, so a bone the clip never touches cannot drift.
        standingSeconds += deltaSeconds;
        if (idleSpine) {
          if (idleBase === null) {
            idleBase = { x: idleSpine.rotation.x, y: idleSpine.rotation.y };
          }
          const { spinePitch, spineYaw } = breathingOffset(standingSeconds);
          idleSpine.rotation.x = idleBase.x + spinePitch;
          idleSpine.rotation.y = idleBase.y + spineYaw;
        }
        return;
      }

      // Put the spine back before walking, so the next stop captures a clean base. Without this the
      // base picks up the previous breath and standing still drifts a little further every time.
      if (idleBase !== null && idleSpine) {
        idleSpine.rotation.x = idleBase.x;
        idleSpine.rotation.y = idleBase.y;
      }
      idleBase = null;
      standingSeconds = 0;

      switchMode(nextMode);
      activeAction.paused = false;
      activeAction.setEffectiveTimeScale(
        playbackRateForSpeed(groundSpeed, activeMode === 'run' ? RUN_SPEED : WALK_SPEED),
      );
      mixer.update(deltaSeconds);
      // Still applied while moving, at a weight that is on its way to zero. Without this the settle
      // would vanish on the first walking frame and the arms would snap outward under the crossfade.
      applyArmSettle();
    },
    getState() {
      return {
        activeMode,
        idleHeld: Boolean(activeAction?.paused),
        playbackRate: activeAction?.getEffectiveTimeScale() ?? 0,
        settleWeight,
      };
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
    mixer,
  };
}
