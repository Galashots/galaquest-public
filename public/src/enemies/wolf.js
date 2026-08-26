import * as THREE from '../../vendor/three.module.min.js';
import { clone as cloneSkinned } from '../../vendor/utils/SkeletonUtils.js';
import { normaliseCharacterMaterial } from '../character/hero.js';
import {
  flashIntensity,
  REDUCED_MOTION_FLASH_SECONDS,
  WOLF_DEFEAT_FLASH_SECONDS,
  WOLF_HIT_FLASH_SECONDS,
} from '../combat/feedback.js';
// The rules own how much punishment a wolf takes; the spark only has to read it. Imported rather
// than restated (GQ-007) -- WOLF_MAX_HP has already been retuned once on the owner's word.
import { WOLF_MAX_HP } from '../combat/encounter.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { prefersReducedMotion } from '../render/motionPreference.js';
import { CHARACTER, setLayer } from '../render/layers.js';
import { loadGLB } from '../world/assets.js';

export const WOLF_URL = 'assets/enemies/wolf.glb';

// The five clips wolf.glb actually ships, read out of its glTF JSON rather than guessed. If a
// re-export renames one, the presenter falls back to idle rather than throwing -- a wolf standing
// still is a bug you can see and play past; an exception during load is a black screen.
export const WOLF_CLIP_FOR_MODE = Object.freeze({
  idle: 'idle',
  walk: 'walk',
  returning: 'walk',
  bite: 'bite',
  hit: 'hit',
  dying: 'death',
  dead: 'death',
});

// bite, hit and death are one-shots. Looping them makes a wolf that chews the air forever, and it
// makes a corpse stand back up, which is worse.
const ONE_SHOT_CLIPS = new Set(['bite', 'hit', 'death']);
const CROSSFADE_SECONDS = 0.12;

// The "damage flash" convention (see combat/feedback.js) -- white, because that is what every
// reference for it used, and full white reads against fur of any colour.
const FLASH_COLOR = new THREE.Color(0xffffff);

// Read once per flash rather than cached, so a child (or a testing adult) toggling the OS setting
// mid-game takes effect on the next hit rather than needing a reload. It now lives in
// render/motionPreference.js, imported above: render/impactBurst.js needed the same answer, and two
// copies of "what counts as reduced" is exactly the drift GQ-007 exists to stop. The no-DOM
// behaviour wolf.test.mjs relies on moved with it, unchanged.

// As authored the wolf measures 1.022m tall and 1.878m long against a 1.479m hero -- its shoulder
// reaches the boy's chest and it is longer than he is tall. That is close to life size for a big grey
// wolf (shoulder height reaches an adult's waist; body 1.05-1.6m), and life size is the wrong target:
// this is the FIRST enemy a young player meets, and it has to read as beatable rather than looming.
// At 0.78 it stands 0.80m -- about hip height on the hero -- and 1.46m long, which is still plainly a
// big wolf. Purely visual: every range in encounter.js is in world metres and is unaffected.
export const WOLF_SCALE = 0.78;

// ── the dissolve ───────────────────────────────────────────────────────────────────────────────
//
// A beaten wolf used to lie on the ground for the whole ten-second respawn wait and then STAND UP
// AND TELEPORT back to its spawn point, because the corpse and the fresh wolf are the same object
// and the server just moves it. Watched end to end in the running game, that is the ugliest moment
// in the fight loop and it happens after every single kill.
//
// It fades out instead, a beat after it goes down, and the new one fades in where it appears. For a
// young player that also turns "the corpse is still lying there" into something closer to the
// game's own lantern language -- the wolf's light goes out, and its Lantern Mark is already flying
// to the hero's belt by then (rewards/markSpark.js).
//
// Driven from the published mode and modeSeconds rather than from an event, so it behaves the same
// online (mirrored server state) and offline (the local rules), with no second source of truth.
export const WOLF_DISSOLVE_DELAY_SECONDS = 0.7;
export const WOLF_DISSOLVE_RATE_PER_SECOND = 1.35;
// Faster coming back than going out: a wolf arriving should feel like it stepped out of the trees,
// not like it developed.
export const WOLF_APPEAR_RATE_PER_SECOND = 2.6;

/** Whether the wolf should be on screen at all, from its published state alone. 1 = solid, 0 = gone.
 *  `dying` deliberately stays at 1: that is the death animation, and it has to be watchable. */
export function wolfPresenceTarget(mode, modeSeconds) {
  const elapsed = Number.isFinite(modeSeconds) ? modeSeconds : 0;
  return mode === 'dead' && elapsed >= WOLF_DISSOLVE_DELAY_SECONDS ? 0 : 1;
}

// ── the stolen light ───────────────────────────────────────────────────────────────────────────
//
// Keeper Aldric's own words: "Our Lantern Tree has gone dark. The wolves out there are carrying its
// light." A warm spark rides on the wolf's back, and it is the reason the wolf is worth hunting --
// strike it down and that light leaves the wolf and flies to your belt as a Lantern Mark
// (rewards/markSpark.js), which is a sentence a young player can follow without being told.
//
// It also does a job the quest badly needed. The wolf respawns at the next spot on its patrol
// (world/zones/village.js), so after a kill the child is standing in an empty field with a "2 more
// Lantern Marks" chip and no idea which way to walk. A warm point of light on an otherwise green
// horizon is the direction, in the game's own language, with no arrow, minimap or compass.
//
// One additive sprite -- see render/glow.js on why a light would be the wrong tool here.
export const WOLF_SPARK_COLOR = 0xffc477;
export const WOLF_SPARK_SIZE_METERS = 0.62;
export const WOLF_SPARK_HEIGHT_METERS = 0.95;
export const WOLF_SPARK_STRENGTH = 0.85;
/** How small the spark gets on the wolf's last hit point, as a fraction of its full size. */
export const WOLF_SPARK_MIN_SIZE_FRACTION = 0.55;
// Breathes, so it catches the eye at distance the way a still dot never does.
export const WOLF_SPARK_PULSE_HZ = 0.55;
export const WOLF_SPARK_PULSE_DEPTH = 0.22;
// It goes out on the killing blow rather than fading with the body: the light leaving is the whole
// point of the moment, and it has to read as separate from the wolf falling over.
export const WOLF_SPARK_FADE_PER_SECOND = 3.2;

// The spark is ALSO the wolf's health bar, and this is the reason it is worth having one.
//
// How close a wolf is to going down was only readable off `wolf 3hp` in the debug pill at the bottom
// of the screen -- four words of jargon in a game for a young player, who is looking at the wolf
// and not at a readout. The light it stole dims and shrinks as you knock it out of him, so the thing
// a child watches during the fight is the wolf itself. No new UI, no bar, no numbers.
//
// It never goes fully out while the wolf lives: a wolf on its last hit point still has to be findable
// across the map, which is the spark's other job.
export const WOLF_SPARK_LAST_HIT_STRENGTH = 0.4;

// GP1-C5: the finishing blow's own colour, and the reason a kill is no longer a hit held longer.
//
// WOLF_DEFEAT_FLASH_SECONDS has claimed since it was written that duration alone made the two read
// differently. The baseline captures say otherwise -- fight-wolf-hit-flash.png and
// fight-04-defeated.png are the same white shape, because both flashes lerped the same materials
// toward the same white, and a still frame is what a child actually gets. Duration cannot separate
// two events for someone who is not timing them.
//
// So the wolf does not blanch on the killing blow: it briefly blazes with the light it stole, in
// that light's OWN colour, and then the light leaves (tickSpark takes the spark out on the same
// frame, and render/impactBurst.js blooms that same colour outward from the body -- soft and wide,
// where a hit draws a hard little shockwave ring). White means "struck"; warm gold means "the
// light is coming out of it". Two colours and two shapes, one glance.
const DEFEAT_FLASH_COLOR = new THREE.Color(WOLF_SPARK_COLOR);

/** How brightly a wolf carries the tree's light: full at full health, down to
 *  WOLF_SPARK_LAST_HIT_STRENGTH on its last hit point, and out the moment it goes down. */
export function wolfSparkTarget(mode, hp = WOLF_MAX_HP, maxHp = WOLF_MAX_HP) {
  if (mode === 'dying' || mode === 'dead') return 0;
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 1) return 1;
  // Measured in HITS TAKEN, not in fraction of health: the floor has to land on the wolf's LAST hit
  // point, which is the reading a child actually needs ("one more and it goes down"). Dividing by
  // maxHp instead puts the floor on a wolf that is already dead and makes the last live step 0.55.
  const remaining = Math.min(1, Math.max(0, (hp - 1) / (maxHp - 1)));
  return WOLF_SPARK_LAST_HIT_STRENGTH + (1 - WOLF_SPARK_LAST_HIT_STRENGTH) * remaining;
}

function prepareWolfRoot(source) {
  // loadGLB caches the GLTF scene. E1 can present more than one stable ordinary enemy, so every
  // presenter needs its own skinned hierarchy AND its own materials. SkeletonUtils gives the rig
  // independent bones; cloning materials prevents one Wolf's hit flash/dissolve from tinting every
  // other Wolf that happens to share the same cached atlas/material objects. Geometry and textures
  // stay shared, which is both safe and the cheap path.
  const root = setLayer(cloneSkinned(source), CHARACTER);
  root.name = 'wolf';
  root.scale.setScalar(WOLF_SCALE);
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => material?.clone?.() ?? material);
    } else if (object.material?.clone) {
      object.material = object.material.clone();
    }
    // The same two export defects the hero had, and the wolf has both: emissiveFactor [1,1,1] with
    // an emissiveTexture that is the base colour atlas again (both glTF textures resolve to image
    // source 0), and metallicFactor/roughnessFactor omitted so glTF defaults each to 1.0. Left
    // alone, the wolf renders as a white silhouette exactly as the hero did.
    for (const material of [].concat(object.material)) {
      normaliseCharacterMaterial(material);
      // Marked transparent AT LOAD, not when the dissolve starts -- flipping `transparent` mid-session
      // makes three.js re-evaluate the material, and taking that hitch on the frame a child lands the
      // killing blow is the worst possible moment for it. Same reasoning as the Keeper's fade.
      // depthWrite stays on so the wolf's own legs and muzzle sort correctly at full opacity.
      if (material) {
        material.transparent = true;
        material.depthWrite = true;
      }
    }
  });
  return root;
}

export async function loadWolfFactory() {
  const gltf = await loadGLB(WOLF_URL);
  const animations = gltf.animations ?? [];
  const failed = Boolean(gltf.userData?.loadError);
  return Object.freeze({
    failed,
    create() {
      return { animations, root: prepareWolfRoot(gltf.scene) };
    },
  });
}

// Kept as the simple one-Wolf loader for existing callers/tests. The implementation now comes from
// the same factory C3 uses for keyed presenters, so one Wolf and several Wolves cannot drift into
// different scale/material/animation preparation paths.
export async function loadWolf() {
  const factory = await loadWolfFactory();
  return { ...factory.create(), failed: factory.failed };
}

/**
 * Play the clip that matches the encounter's wolf mode.
 *
 * Deliberately dumb: it reads `mode` and plays the matching clip. All the timing lives in
 * encounter.js, whose constants were measured from these clips, so the animation cannot disagree
 * with the rules -- and encounter.js stays importable by a node server that has no three.js.
 */
export function createWolfPresenter(root, animations) {
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map();
  for (const clip of animations) {
    const action = mixer.clipAction(clip);
    if (ONE_SHOT_CLIPS.has(clip.name)) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    actions.set(clip.name, action);
  }

  let currentName = null;
  let currentAction = null;

  // Each material's OWN emissive colour, captured once so a flash can lerp back to whatever that
  // actually is rather than assuming black. Right now normaliseCharacterMaterial forces every wolf
  // material to a black emissive (see hero.js), so today that assumption would happen to hold -- but
  // "assumed instead of measured" is exactly the mistake the shield fitting cost a day on (AGENTS.md,
  // "Look before you derive"), and swing.js was written the safe way for the identical reason: capture
  // the real base and restore it, so a future authored glow (eyes, a rune) cannot be silently erased
  // the first time this wolf is hit.
  const flashTargets = [];
  root.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of [].concat(object.material)) {
      if (material?.emissive) flashTargets.push({ base: material.emissive.clone(), material });
    }
  });
  let flash = null; // { durationSeconds, elapsedSeconds }

  // The dissolve, over the same materials the flash writes to (emissive and opacity are independent,
  // so a wolf can flash white and fade out at once -- which is exactly what the killing blow looks
  // like).
  const fadeMaterials = [];
  root.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of [].concat(object.material)) if (material) fadeMaterials.push(material);
  });
  let presence = 1;

  // The stolen light. A child of `root`, so it follows the wolf for free -- root is scaled by
  // WOLF_SCALE, so both the height and the size are divided back out to stay in real metres.
  const spark = createGlowSprite(WOLF_SPARK_COLOR, WOLF_SPARK_SIZE_METERS / WOLF_SCALE);
  spark.name = 'wolf-lantern-spark';
  spark.position.set(0, WOLF_SPARK_HEIGHT_METERS / WOLF_SCALE, 0);
  setLayer(spark, CHARACTER);
  root.add(spark);
  let sparkStrength = WOLF_SPARK_STRENGTH;
  let sparkSeconds = 0;

  function tickSpark(deltaSeconds, wolf) {
    const target = wolfSparkTarget(wolf.mode, wolf.hp, wolf.maxHp) * WOLF_SPARK_STRENGTH;
    if (sparkStrength !== target) {
      const step = WOLF_SPARK_FADE_PER_SECOND * deltaSeconds;
      sparkStrength = Math.abs(target - sparkStrength) <= step
        ? target
        : sparkStrength + Math.sign(target - sparkStrength) * step;
    }
    sparkSeconds += deltaSeconds;
    const pulse = 1 + Math.sin(sparkSeconds * WOLF_SPARK_PULSE_HZ * Math.PI * 2) * WOLF_SPARK_PULSE_DEPTH;
    setGlowStrength(spark, sparkStrength * pulse);
    // It shrinks as well as dims. Brightness alone is hard to judge against a bright sky; a smaller
    // light next to a bigger one a minute ago is not, and the two together make the wolf's condition
    // legible at a glance from across the map.
    const size = (WOLF_SPARK_SIZE_METERS / WOLF_SCALE)
      * (WOLF_SPARK_MIN_SIZE_FRACTION + (1 - WOLF_SPARK_MIN_SIZE_FRACTION) * (sparkStrength / WOLF_SPARK_STRENGTH));
    spark.scale.setScalar(size);
  }

  function tickPresence(deltaSeconds, wolf) {
    const target = wolfPresenceTarget(wolf.mode, wolf.modeSeconds);
    if (presence === target) {
      root.visible = presence > 0;
      return;
    }
    const rate = target > presence ? WOLF_APPEAR_RATE_PER_SECOND : WOLF_DISSOLVE_RATE_PER_SECOND;
    const step = rate * deltaSeconds;
    presence = Math.abs(target - presence) <= step ? target : presence + Math.sign(target - presence) * step;
    for (const material of fadeMaterials) material.opacity = presence;
    root.visible = presence > 0;
  }

  function beginFlash(durationSeconds, color, kind) {
    // Counters reset HERE rather than in flashHit(), so a defeat flash cannot pile its frames onto
    // the last hit's tally. Written the wrong way round first: with the reset in flashHit(), the
    // 0.5s defeat flash landed on the same counters as the 0.18s hit before it, and the number a
    // harness read back was the defeat's wearing the hit's label.
    flashPeak = 0;
    flashFrames = 0;
    flashKind = kind;
    flash = {
      durationSeconds: prefersReducedMotion() ? REDUCED_MOTION_FLASH_SECONDS : durationSeconds,
      elapsedSeconds: 0,
      color,
    };
  }

  // WHAT WAS ACTUALLY WRITTEN TO THE MATERIALS, kept so a harness can ask what a child SAW rather
  // than what the constants say they should have seen. The two are not the same on a starved page:
  // the flash is authored in seconds (WOLF_HIT_FLASH_SECONDS, 0.18) while combat/feedback.js's own
  // header describes the technique in FRAMES ("solid white for a couple of frames"), and elapsed
  // advances by a whole frame delta before this computes anything. Read-only, and a peak rather
  // than an instant, because a per-frame poll on a page painting three frames a second cannot see
  // an instant -- the same reason startWatch exists.
  let flashPeak = 0;
  let flashFrames = 0;
  let flashKind = null;
  function tickFlash(deltaSeconds) {
    if (!flash) return;
    flash.elapsedSeconds += deltaSeconds;
    const t = flashIntensity(flash.elapsedSeconds, flash.durationSeconds);
    for (const target of flashTargets) target.material.emissive.lerpColors(target.base, flash.color, t);
    if (t > 0) { flashFrames += 1; if (t > flashPeak) flashPeak = t; }
    if (t <= 0) flash = null;
  }

  function play(name, restart) {
    const next = actions.get(name) ?? actions.get('idle');
    if (!next) return;
    // A one-shot re-entered for the same mode has to be rewound, or the second bite of a fight plays
    // nothing because the action is already sitting clamped on its last frame.
    if (next === currentAction && !restart) return;
    const previous = currentAction;
    currentAction = next;
    currentName = name;
    next.reset();
    next.setEffectiveWeight(1);
    next.play();
    if (previous && previous !== next) previous.crossFadeTo(next, CROSSFADE_SECONDS, false);
  }

  return {
    /** @param wolf the encounter's wolf state: { x, z, heading, mode } */
    update(deltaSeconds, wolf) {
      root.position.set(wolf.x, 0, wolf.z);
      root.rotation.y = wolf.heading;
      const wanted = WOLF_CLIP_FOR_MODE[wolf.mode] ?? 'idle';
      // Restart on re-entry into a one-shot mode, so a second bite or a second stagger reads.
      play(wanted, ONE_SHOT_CLIPS.has(wanted) && wolf.modeSeconds < deltaSeconds * 2);
      mixer.update(deltaSeconds);
      tickFlash(deltaSeconds);
      tickPresence(deltaSeconds, wolf);
      tickSpark(deltaSeconds, wolf);
    },
    /** Call when encounter.js raises wolf-hit. A quick white flash -- see FLASH_COLOR above. */
    flashHit() {
      beginFlash(WOLF_HIT_FLASH_SECONDS, FLASH_COLOR, 'hit');
    },
    /** For a harness: the brightest THIS flash ever actually got, over how many rendered frames, and
     *  which flash it was. `{ peak: 0, frames: 0 }` means the child saw no flash at all. */
    flashSeen: () => ({ peak: flashPeak, frames: flashFrames, kind: flashKind }),
    /** Call when encounter.js raises wolf-defeated. Longer than flashHit() AND a different colour --
     *  the length keeps it on screen, the colour is what actually tells the two apart. See
     *  DEFEAT_FLASH_COLOR above for why the original duration-only claim did not survive a capture. */
    flashDefeated() {
      beginFlash(WOLF_DEFEAT_FLASH_SECONDS, DEFEAT_FLASH_COLOR, 'defeat');
    },
    getState() {
      return { clip: currentName, presence: +presence.toFixed(3), spark: +sparkStrength.toFixed(3) };
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      root.remove(spark);
      spark.material.dispose();
    },
    mixer,
  };
}
