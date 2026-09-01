/**
 * The thing that appears where a blow lands.
 *
 * GP1-C5. The wolf's material flash answers "which thing was hit"; it cannot answer "a blow landed",
 * because at the distance this fight is actually played the wolf is a small pale shape and turning it
 * a different small pale shape is not an event. tools/runtime-test/play-fight.mjs's baseline captures
 * are the evidence and they are kept at .local/combat-baseline/: in fight-wolf-hit-flash.png the
 * white flash reads as the wolf having gone foggy, and in fight-04-defeated.png -- a KILL -- it reads
 * as the same foggy wolf. A ten-year-old was being asked to tell those two apart.
 *
 * So contact gets its own object at the contact point, which expands outward and is gone. Outward
 * motion from a point is the one thing that still reads when everything is small, which is why every
 * impact effect in the genre is shaped this way (see combat/feedback.js's own reference note above
 * the burst constants). A hit draws a hollow shockwave edge; a kill draws a soft bloom -- see BURST_PROFILES
 * below for why those are deliberately different shapes and not one effect at two sizes.
 *
 * Presentation only. Nothing here is consulted by a rule: encounter.js decides whether a blow landed
 * and this draws the answer. It cannot change hp, timing, reach or anything a fight is decided by.
 *
 * That is also why it lives in render/ and not in combat/ next to the events it reacts to. combat/
 * is the pure rules layer -- no three.js, no DOM -- because net/gameServer.mjs re-hosts stepEncounter
 * unchanged, and test/combat-purity.test.mjs enforces it. This file is a sprite pool; it belongs
 * with glow.js and layers.js, which it is built out of. (Written into combat/ first and moved when
 * that test said so -- the rule was right and the module was in the wrong place.)
 *
 * Why a pool and not one sprite per burst: two hits can overlap (a kill lands on top of the hit that
 * caused it, by design -- that composition IS the payoff), and allocating a Sprite plus material
 * mid-fight is exactly the kind of per-hit garbage that shows up as a hitch on the frame a child is
 * looking hardest. Four is comfortably more than the fight can produce at once.
 */

import { createGlowSprite, glowTexture, setGlowStrength } from './glow.js';
import { CHARACTER, setLayer } from './layers.js';
import { prefersReducedMotion } from './motionPreference.js';
// The wolf's own stolen-light colour, imported rather than restated: a kill burst IS that light
// leaving, so if the wolf's spark is ever retuned the burst has to follow it without anybody
// remembering to. See WOLF_SPARK_COLOR's own comment in enemies/wolf.js.
import { WOLF_SPARK_COLOR } from '../enemies/wolf.js';
import {
  burstOpacity,
  burstScaleMeters,
  HIT_BURST_END_METERS,
  HIT_BURST_SECONDS,
  HIT_BURST_START_METERS,
  KILL_BURST_END_METERS,
  KILL_BURST_SECONDS,
  KILL_BURST_START_METERS,
  REDUCED_MOTION_FLASH_SECONDS,
} from '../combat/feedback.js';

/** Hot near-white gold. Deliberately NOT red: red is the player's own damage language (the edge
 *  vignette in index.html), and an outgoing hit that is also red would teach a child that the two
 *  mean the same thing. Outgoing is warm/bright, incoming is red -- that is the whole colour rule. */
export const HIT_BURST_COLOR = 0xfff2c4;

/** The stolen light itself, so a kill is unmistakably a different EVENT and not a bigger hit. */
export const KILL_BURST_COLOR = WOLF_SPARK_COLOR;

const POOL_SIZE = 8;
export const SPECIAL_BURST_COLOR = 0x9fffc0;
export const SPECIAL_BURST_SECONDS = 0.58;
export const SPECIAL_BURST_START_METERS = 0.55;
export const SPECIAL_BURST_END_METERS = 3.8;

/** Exported so the "a kill is not a bigger hit" claim can be asserted rather than trusted -- see
 *  test/impact-burst.test.mjs. Frozen; nothing is expected to reach in and retune it at runtime. */
export const BURST_PROFILES = Object.freeze({
  // A hit is a hollow shockwave: a bright EDGE travelling outward. See the 'shock' profile in
  // glow.js for why -- this started as a filled bloom and photographed as the wolf getting brighter.
  hit: Object.freeze({
    color: HIT_BURST_COLOR,
    seconds: HIT_BURST_SECONDS,
    startMeters: HIT_BURST_START_METERS,
    endMeters: HIT_BURST_END_METERS,
    profile: 'shock',
  }),
  // A kill is a soft bloom, on purpose: this one is not an impact, it is the light the wolf stole
  // coming out of it and dispersing. Different SHAPE as well as different colour and size, so the
  // two events cannot be confused by someone who is glancing rather than studying.
  kill: Object.freeze({
    color: KILL_BURST_COLOR,
    seconds: KILL_BURST_SECONDS,
    startMeters: KILL_BURST_START_METERS,
    endMeters: KILL_BURST_END_METERS,
    profile: 'lamp',
  }),
  special: Object.freeze({
    color: SPECIAL_BURST_COLOR,
    seconds: SPECIAL_BURST_SECONDS,
    startMeters: SPECIAL_BURST_START_METERS,
    endMeters: SPECIAL_BURST_END_METERS,
    profile: 'lamp',
  }),
});

/**
 * @param scene the world scene; bursts are added to it directly, in world space, because a burst
 *   belongs to the PLACE the blow landed and must not ride the wolf as it staggers away from it.
 */
export function createImpactBursts(scene) {
  // One sprite per slot, created once. `createGlowSprite` starts them hidden at opacity 0.
  const slots = Array.from({ length: POOL_SIZE }, () => {
    const sprite = createGlowSprite(HIT_BURST_COLOR, BURST_PROFILES.hit.startMeters, BURST_PROFILES.hit.profile);
    setLayer(sprite, CHARACTER);
    scene.add(sprite);
    return { sprite, live: false, elapsedSeconds: 0, profile: BURST_PROFILES.hit };
  });

  function freeSlot() {
    const idle = slots.find((slot) => !slot.live);
    if (idle) return idle;
    // Everything is busy: steal the OLDEST, because the burst nearest the end of its life is the one
    // whose disappearance nobody notices. Dropping the new burst instead would silently swallow the
    // hit a child just made, which is the one outcome this whole file exists to prevent.
    return slots.reduce((oldest, slot) => (slot.elapsedSeconds > oldest.elapsedSeconds ? slot : oldest));
  }

  return {
    /**
     * @param kind 'hit' or 'kill'. Anything else is treated as a hit rather than throwing: a
     *   presentation layer refusing to draw is worse than it drawing the commoner of two things.
     */
    burst({ x, y, z, kind = 'hit' } = {}) {
      const profile = BURST_PROFILES[kind] ?? BURST_PROFILES.hit;
      const slot = freeSlot();
      slot.live = true;
      slot.elapsedSeconds = 0;
      // Reduced motion still gets the EVENT -- a player who asked for less movement has not asked to
      // be told less about the fight -- it just does not travel. Two frames, in place, same
      // reasoning (and the same constant) as the wolf's own flash.
      slot.profile = prefersReducedMotion()
        ? { ...profile, seconds: REDUCED_MOTION_FLASH_SECONDS, endMeters: profile.startMeters }
        : profile;
      slot.sprite.material.color.setHex(profile.color);
      // Textures are cached and shared by glowTexture(), so swapping which one this slot draws costs
      // a pointer, not an upload. needsUpdate because three.js will not notice the map changed.
      slot.sprite.material.map = glowTexture(profile.profile);
      slot.sprite.material.needsUpdate = true;
      slot.sprite.position.set(x, y, z);
      slot.sprite.scale.setScalar(slot.profile.startMeters);
      setGlowStrength(slot.sprite, 1);
    },

    update(deltaSeconds) {
      for (const slot of slots) {
        if (!slot.live) continue;
        slot.elapsedSeconds += deltaSeconds;
        const { seconds, startMeters, endMeters } = slot.profile;
        const strength = burstOpacity(slot.elapsedSeconds, seconds);
        if (strength <= 0) {
          slot.live = false;
          setGlowStrength(slot.sprite, 0);
          continue;
        }
        slot.sprite.scale.setScalar(burstScaleMeters(slot.elapsedSeconds, seconds, startMeters, endMeters));
        setGlowStrength(slot.sprite, strength);
      }
    },

    /** For harnesses: how many bursts are on screen this instant. Observable without seeing it. */
    liveCount() {
      return slots.filter((slot) => slot.live).length;
    },

    dispose() {
      for (const slot of slots) {
        scene.remove(slot.sprite);
        slot.sprite.material.dispose();
      }
    },
  };
}
