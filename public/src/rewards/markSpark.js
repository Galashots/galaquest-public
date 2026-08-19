// public/src/rewards/markSpark.js
//
// The Lantern Mark, as something you SEE. A warm spark lifts off the beaten wolf, arcs across the
// ground and lands on the hero's belt.
//
// Why it exists: earning a mark -- the entire reward for a fight a young player just survived on
// one heart -- moved a 1.1 rem grey dot to orange in the top-left corner, which is the last place
// on screen a child is looking while a wolf is biting them. There was no sound (audio/recipes.js
// maps the event to explicit null, the owner's taste call) and, until this commit, no banner. A thing
// that flies from the enemy to you is the oldest and clearest way a game says "that was worth
// something", and it costs one sprite.
//
// The flight curve is pure and lives here; the sprite pool that follows it is below and needs
// three.js only for the object, not for any of the timing.

import * as THREE from '../../vendor/three.module.min.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { CHARACTER, setLayer } from '../render/layers.js';

export const SPARK_FLIGHT_SECONDS = 0.95;
// How high above the straight line it arcs at the midpoint. A spark that travels in a straight line
// reads as a bullet; one that lofts reads as something being handed over.
export const SPARK_HOP_METERS = 1.25;
export const SPARK_COLOR = 0xffcb63;
export const SPARK_START_SIZE_METERS = 0.75;
export const SPARK_END_SIZE_METERS = 0.3;
// Where on the hero it lands: the belt line, which is also where the lantern reward eventually
// mounts (character/gear.js's RIGID_BELT_LANTERN sits on the Hips bone).
export const SPARK_TARGET_HEIGHT_METERS = 0.85;
// Where it lifts off the fallen wolf, which lies flat.
export const SPARK_SOURCE_HEIGHT_METERS = 0.55;

/** 0..1 eased both ends, so the spark sets off and arrives smoothly instead of snapping. */
function ease(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * One frame of a spark's flight from `elapsedSeconds`.
 *
 *   travel01    how far along the path, eased -- the caller lerps source to target with this
 *   hopMeters   how far ABOVE that lerped point it currently sits (a parabola, zero at both ends)
 *   strength01  brightness: snaps on, holds, fades out over the last third
 *   sizeMeters  shrinks as it arrives, so it reads as being absorbed rather than passing through
 *   done        the flight is over and the sprite can go back in the pool
 */
export function sparkFlight(elapsedSeconds, flightSeconds = SPARK_FLIGHT_SECONDS) {
  const t = flightSeconds > 0 ? Math.max(0, elapsedSeconds) / flightSeconds : 1;
  const clamped = t > 1 ? 1 : t;
  const travel01 = ease(clamped);
  // sin(pi*t) is zero at both ends and 1 in the middle: the arc lands exactly on the target rather
  // than hovering above it.
  const hopMeters = Math.sin(Math.PI * clamped) * SPARK_HOP_METERS;
  const strength01 = clamped < 0.12
    ? clamped / 0.12
    : clamped < 0.66 ? 1 : 1 - (clamped - 0.66) / 0.34;
  const sizeMeters = SPARK_START_SIZE_METERS
    + (SPARK_END_SIZE_METERS - SPARK_START_SIZE_METERS) * travel01;
  return { travel01, hopMeters, strength01: Math.max(0, strength01), sizeMeters, done: t >= 1 };
}

/**
 * A small pool of spark sprites. `launch` starts one from a world point; `update` flies every live
 * spark toward the hero's CURRENT position, so a child who keeps walking is still caught up with.
 *
 * Pooled rather than created per kill because a mark can be earned every ten seconds for a whole
 * session, and building and disposing a sprite each time is how a game acquires a stutter.
 */
export function createMarkSparks(scene) {
  const sparks = [];

  function acquire() {
    const idle = sparks.find((spark) => !spark.live);
    if (idle) return idle;
    const sprite = createGlowSprite(SPARK_COLOR, SPARK_START_SIZE_METERS);
    sprite.name = `mark-spark-${sparks.length}`;
    // CHARACTER, same layer as the hero and the wolf it flies between, so a camera that enables one
    // and not the other can never cull it. Via setLayer() rather than by building a mask by hand --
    // three.js's Layers.set() returns undefined, and reading `.mask` off that result is what took
    // the whole runtime down on the first attempt at this (bootstrap threw, no hero, blank screen).
    setLayer(sprite, CHARACTER);
    scene.add(sprite);
    const spark = { sprite, live: false, elapsed: 0, from: new THREE.Vector3() };
    sparks.push(spark);
    return spark;
  }

  return {
    /** @param from {x, z} in world space -- usually the wolf that just went down. */
    launch(from) {
      const spark = acquire();
      spark.live = true;
      spark.elapsed = 0;
      spark.from.set(from.x, SPARK_SOURCE_HEIGHT_METERS, from.z);
      setGlowStrength(spark.sprite, 0);
      spark.sprite.position.copy(spark.from);
    },
    /** @param heroPosition a live THREE.Vector3-ish `{x, z}`; read every frame, never captured. */
    update(deltaSeconds, heroPosition) {
      for (const spark of sparks) {
        if (!spark.live) continue;
        spark.elapsed += deltaSeconds;
        const beat = sparkFlight(spark.elapsed);
        if (beat.done) {
          spark.live = false;
          setGlowStrength(spark.sprite, 0);
          continue;
        }
        spark.sprite.position.set(
          spark.from.x + (heroPosition.x - spark.from.x) * beat.travel01,
          spark.from.y + (SPARK_TARGET_HEIGHT_METERS - spark.from.y) * beat.travel01 + beat.hopMeters,
          spark.from.z + (heroPosition.z - spark.from.z) * beat.travel01,
        );
        spark.sprite.scale.setScalar(beat.sizeMeters);
        setGlowStrength(spark.sprite, beat.strength01);
      }
    },
    /** For a harness: how many sparks are in flight right now. */
    liveCount: () => sparks.filter((spark) => spark.live).length,
  };
}
