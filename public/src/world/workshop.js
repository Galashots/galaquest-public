// public/src/world/workshop.js
//
// GP3: the Workshop's own Level 0 -> Level 1 transformation -- an EXISTING village prop (preferably
// the longhouse, world/zones/village.js's own WORKSHOP_PROP at [-7.5, -9.8]) additively dressed the
// instant Workshop I is bought, never replaced or rebuilt. Sibling of world/lootPickups.js's
// createCartReaction, same shape (trigger()/update(deltaSeconds)), same reasoning for why: this is a
// one-shot physical acknowledgement of a server-authoritative edge (the wire's own
// village.workshopOwned flipping true), not a per-frame simulation.
//
// TEMP BY DESIGN, not just by name: the goal is proving the causal contract
// "buy Workshop I -> the Village visibly changes", not shipping art. (GP1-C2's own temporary proof
// marker on the Hero screen took the same posture and has since been deleted outright, replaced by
// render/heroPreview.js's real showcase -- which is what retiring one of these looks like.) Every mesh this file builds is
// named with a -TEMPORARY suffix, isolated inside its own named group, and built from primitive
// geometry rather than a new asset -- delete/replace the group's contents the moment a real Workshop
// model ships. No hero rigging, gear-fit system, Character Studio, or production mesh is touched --
// this file only ever adds children under an ALREADY-PLACED village prop.

import * as THREE from '../../vendor/three.module.min.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { WORLD, setLayer } from '../render/layers.js';

/**
 * Pure. Mirrors zoneLoader.js's treeLitTransition exactly -- same idempotent-via-comparison shape,
 * same reasoning (see that function's own comment): a repeat call with the same resolved value is a
 * clean no-op, not a second transformation.
 */
export function workshopTransition(currentlyBuilt, nextBuilt) {
  const resolved = nextBuilt === true;
  return { changed: resolved !== (currentlyBuilt === true), built: resolved };
}

const WORKBENCH_COLOR = 0x6b4a30;
const ANVIL_COLOR = 0x2b2b2e;
const FORGE_GLOW_COLOR = 0xff8a3d;
const FORGE_GLOW_SIZE_METERS = 0.9;
const SPARK_COLOR = 0xffcf7a;
const SPARK_SIZE_METERS = 0.16;
const SPARK_COUNT = 3;
const SPARK_ORBIT_METERS = 0.35;
const SPARK_RADIANS_PER_SECOND = 2.4;
// Section 7's own target: "roughly 1-2 seconds of concentrated transformation feedback". 1.4s pop-in,
// well inside that window, with the sparks/glow's own idle animation continuing forever after --
// the pop is the CEREMONY, the glow/sparks are the lasting "this place is different now" signal.
const POP_IN_SECONDS = 1.4;

/**
 * @param workshopMesh  the existing prop's own THREE.Object3D (main.js:
 *   `scene.getObjectByName('prop-' + VILLAGE.WORKSHOP_PROP.model)`), or null -- a missing mesh
 *   degrades to "dressing has no home to attach to, added at the scene root instead" rather than
 *   throwing, the same defensiveness createCartReaction already shows a missing cart mesh.
 */
export function createWorkshopReaction(scene, workshopMesh) {
  const group = new THREE.Group();
  group.name = 'workshop-level1-TEMP';
  group.visible = false;

  if (workshopMesh) {
    // Measured once, from the mesh's own real footprint, so the dressing sits beside the actual
    // structure regardless of that prop's own model dimensions -- the same "measure, do not guess"
    // technique createCartReaction's own dust-puff placement already uses.
    workshopMesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(workshopMesh);
    const width = box.max.x - box.min.x;
    // Offset toward +local-X, clear of the structure's own footprint. Parented to workshopMesh (not
    // placed at an absolute world position), so it inherits that prop's own position/rotation for
    // free and never needs updating if the prop is ever moved in village.js.
    //
    // WHICH side reads cleanest against nearby clutter is a "look at a capture" question
    // (AGENTS.md's own "look before you derive" rule) this file cannot answer without one -- flagged
    // here as the one placement number a runtime capture is expected to correct, not a measurement.
    group.position.set(width / 2 + 0.9, 0, 0);
    workshopMesh.add(group);
  } else {
    scene.add(group);
  }

  const workbench = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.55, 0.5),
    new THREE.MeshStandardMaterial({ color: WORKBENCH_COLOR, roughness: 0.85, metalness: 0.05 }),
  );
  workbench.name = 'workshop-workbench-TEMPORARY';
  workbench.position.set(0, 0.275, 0);
  group.add(workbench);

  const anvil = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.22, 0.16),
    new THREE.MeshStandardMaterial({ color: ANVIL_COLOR, roughness: 0.4, metalness: 0.6 }),
  );
  anvil.name = 'workshop-anvil-silhouette-TEMPORARY';
  anvil.position.set(0, 0.55 + 0.11, 0.05);
  group.add(anvil);

  // The "warm doorway/window/forge glow" ingredient (brief section 6) -- a sprite, not a
  // THREE.PointLight, the same trade render/glow.js's own header explains for the street lanterns:
  // one more real light per Workshop is the wrong cost on an iPad for something felt from ten metres.
  const forgeGlow = createGlowSprite(FORGE_GLOW_COLOR, FORGE_GLOW_SIZE_METERS);
  forgeGlow.name = 'workshop-forge-glow-TEMPORARY';
  forgeGlow.position.set(0, 0.75, 0);
  setLayer(forgeGlow, WORLD);
  group.add(forgeGlow);

  // "Subtle sparks/smoke/working ambience" -- three small glow sprites orbiting the anvil, the
  // cheapest possible "something is happening here" signal, same additive-sprite trade as the glow.
  const sparks = [];
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    const spark = createGlowSprite(SPARK_COLOR, SPARK_SIZE_METERS);
    spark.name = 'workshop-spark-TEMPORARY';
    setLayer(spark, WORLD);
    group.add(spark);
    sparks.push(spark);
  }

  let built = false;
  // -1 means "not currently popping in" -- the same sentinel-clock convention createCartReaction's
  // own joltSeconds already uses.
  let popSeconds = -1;
  let ambientClock = 0;

  return {
    // `instant`: skips the pop-in tween entirely -- for a client whose FIRST known observation of
    // this Workshop is already built (a late joiner, or a page reload after someone else bought it),
    // the same "already unlocked, no ceremony" rule zoneLoader.js's own tree-relight logic applies via
    // setTreeLit(true) rather than beginRelight(). Without this, group.visible only ever flips true
    // from inside a locally-witnessed false->true edge (main.js's own sawWorkshopUnowned gate), so a
    // client that never watched that edge would see the UNBUILT shell forever despite
    // village.workshopOwned being durably true -- caught by reasoning through what a late-joining
    // restart-viewer tab actually observes, not by a failing check (see main.js's own villageKnown
    // comment for the full trace).
    trigger(instant = false) {
      const transition = workshopTransition(built, true);
      if (!transition.changed) return;
      built = transition.built;
      group.visible = true;
      setGlowStrength(forgeGlow, 1);
      if (instant) {
        group.scale.setScalar(1);
        popSeconds = -1;
      } else {
        group.scale.setScalar(0.6);
        popSeconds = 0;
      }
    },
    update(deltaSeconds) {
      if (!built) return;
      ambientClock += deltaSeconds;
      // A slow forge-breathing flicker, always running once built -- the "lasting" half of the
      // ceremony, distinct from the one-shot pop-in below.
      setGlowStrength(forgeGlow, 0.85 + Math.sin(ambientClock * 3) * 0.12);
      sparks.forEach((spark, index) => {
        const angle = ambientClock * SPARK_RADIANS_PER_SECOND + (index / SPARK_COUNT) * Math.PI * 2;
        spark.position.set(
          Math.cos(angle) * SPARK_ORBIT_METERS,
          0.7 + Math.sin(ambientClock * 2 + index) * 0.08,
          0.15 + Math.sin(angle) * SPARK_ORBIT_METERS * 0.4,
        );
        setGlowStrength(spark, 0.5 + Math.sin(ambientClock * 5 + index * 2) * 0.4);
      });
      if (popSeconds >= 0) {
        popSeconds += deltaSeconds;
        const t = Math.min(1, popSeconds / POP_IN_SECONDS);
        // Overshoot-and-settle -- the same "arrives with a little energy" shape
        // world/lootPickups.js's own flightBeat hop already uses, not a flat linear scale-in.
        const eased = 1 - (1 - t) ** 3;
        const overshoot = t < 1 ? Math.sin(t * Math.PI) * 0.08 : 0;
        group.scale.setScalar(0.6 + 0.4 * eased + overshoot);
        if (t >= 1) { popSeconds = -1; group.scale.setScalar(1); }
      }
    },
    isBuilt() { return built; },
    // GP3-C1: gates the deliberate Workshop interaction until the pop-in ceremony has actually
    // finished playing, so "UPGRADE -> Board clears -> transformation is visibly enjoyed -> control
    // returns" is a real sequence rather than a guessed delay -- see main.js's own interact-gate
    // comment. True only during the one-shot tween itself, never during the ambient glow/spark loop.
    isTransforming() { return popSeconds >= 0; },
  };
}
