// public/src/world/workshop.js
//
// THE WORKSHOP, as a building the child owns rather than a pile of props beside one.
//
// What this replaces, and why. The first version of this file was TEMP BY DESIGN: a workbench box, a
// thumbnail anvil and a glow sprite, parked 1.4 m off the longhouse's east wall, built only to prove
// the causal contract "buy Workshop I -> the Village visibly changes". It proved it. Then it was
// looked at from where a child actually stands (.local/workshop-probe/baseline-*.png, follow distance
// 16, four approach bearings) and the verdict was that at gameplay distance it reads as A CRATE LEFT
// ON THE GRASS: detached from the building, about a third of an NPC's height, changing the village's
// silhouette not at all. Worse, the Lantern Mark payoff now floods the whole village with warm gold,
// so the one cue the old version leaned on -- a warm forge glow -- is the one cue that cannot carry
// anything out here. Glow confirms this building up close. It cannot announce it.
//
// THE CONVENTION, extracted from reference before any number below was chosen (AGENTS.md's "look
// before you derive"): a village smithy is read as an ORDINARY BUILDING WEARING THREE ATTACHED PARTS
// -- a bay breaking the roofline, a chimney standing above it, and a hearth-and-anvil pair at ground
// level -- never as a building of its own design. Checked against WoW's own starter settlements first
// as this repository requires (Goldshire, Kharanos, Razor Hill: in all three the forge and the anvil
// are discrete objects placed against a building in that settlement's ordinary vernacular, and Razor
// Hill's is literally named the Heated Forge), then against Minecraft's village smithy (a standard
// house footprint; players are told to identify it by the furnace and the small lava pool beside it,
// nothing else), and against the low-poly smithy asset packs this game's art is a cousin of (Synty
// POLYGON Fantasy Kingdom, polymech's Stylized Low Poly Forge), every one of which sells the smithy
// as a PROP KIT for a generic shell: anvil, furnace, chimney. Two things that convention says NOT to
// do, and that this file therefore does not do: no painted or lettered hanging sign (WoW, Minecraft
// and Stardew all skip signage entirely -- shape, prop and light carry it), and no hand-tool detail,
// which spends geometry saying something only a close-up can hear.
//
// Where that convention had to bend for THIS building, and the measurement that forced it: the
// longhouse GLB is nearly all roof. Its walls stop at y=1.00 and its eave on the east face is at
// y=0.965 -- shoulder height on a 1.48 m hero -- with the ridge at 2.141. A lean-to that politely
// tucks under that eave is a doghouse. So the bay is built TALLER than the eave and overlaps the
// house's own roof, with a solid timber back panel closing the junction so no gap is ever visible
// from outside. That is what a real outshot looks like from the street, and it is the only form that
// reads at distance without touching the house model.
//
// And the part that actually does the work at sixteen metres: THE CHIMNEY. It stands 3.18 m against
// a 2.141 m house -- half again the building's height -- and it is the one element that cannot be
// foreshortened away, which is the failure this village has already been bitten by once (see the Y
// phase's own exit note: a canopy silhouette that read from one bearing and vanished from another).
// A roofline break can hide behind a bearing. A stack against the sky cannot.
//
// ONE MESH PER MATERIAL, not one per plank -- the same trade wildwoodGate.js makes and for the same
// reason: this is an iPad. The whole Workshop is five meshes and four sprites.

import * as THREE from '../../vendor/three.module.min.js';
import { mergeGeometries } from '../../vendor/utils/BufferGeometryUtils.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { prefersReducedMotion } from '../render/motionPreference.js';
import { WORLD, setLayer } from '../render/layers.js';
import { GATE_WOOD_COLOR } from './wildwoodGate.js';

/**
 * Pure. Mirrors zoneLoader.js's treeLitTransition exactly -- same idempotent-via-comparison shape,
 * same reasoning (see that function's own comment): a repeat call with the same resolved value is a
 * clean no-op, not a second transformation.
 */
export function workshopTransition(currentlyBuilt, nextBuilt) {
  const resolved = nextBuilt === true;
  return { changed: resolved !== (currentlyBuilt === true), built: resolved };
}

// ── the ceremony's clock ─────────────────────────────────────────────────────────────────────────
//
// Five overlapping stages rather than one pop, because what is being asked for here is a readable
// silhouette build beat AND the forge then coming alive -- which is two different events and has to
// be watchable as two. They OVERLAP on purpose: cut end to end they read as four separate pops, and
// a building does not assemble itself in instalments.
//
// The ORDER is the point. Frame, then roof, then the stack rises THROUGH that roof, then the tools
// land, and only then does it light. Every silhouette-changing part is finished and still before the
// forge ignites, so a child is never asked to look at a shape arriving and a light arriving at once.
const BUILD_STAGES = Object.freeze({
  frame: Object.freeze({ start: 0, seconds: 0.55 }),
  roof: Object.freeze({ start: 0.4, seconds: 0.6 }),
  stack: Object.freeze({ start: 0.85, seconds: 0.65 }),
  tools: Object.freeze({ start: 1.35, seconds: 0.35 }),
  ignite: Object.freeze({ start: 1.45, seconds: 0.6 }),
});

// The whole ceremony, in seconds: 2.05. DERIVED from the stages rather than typed beside them, so
// retuning any one of them cannot leave this claiming the ceremony ends before it does -- the exact
// drift GQ-007 exists to stop. Inside the "roughly 1-2 seconds of concentrated transformation
// feedback" this game's own section 7 asks for, and comfortably inside the 4 s budget
// tools/runtime-test/drive-village-board.mjs allows the transformation before it calls a purchase
// hung -- deliberately, so lengthening this is a decision somebody has to make on purpose.
export const WORKSHOP_BUILD_SECONDS = Object.values(BUILD_STAGES)
  .reduce((latest, stage) => Math.max(latest, stage.start + stage.seconds), 0);

/**
 * Pure. How far through each stage the ceremony is at `elapsedSeconds`, every value clamped to 0..1.
 *
 * Split out from the meshes so the ORDER can be asserted without a GPU: what makes this ceremony
 * work is that the silhouette is complete before the forge lights, and that is a claim about five
 * numbers, not about pixels.
 */
export function buildStageProgress(elapsedSeconds) {
  // Compared against the stage's own clock rather than against the ratio, so a stage that has
  // genuinely finished reports exactly 1 instead of 0.9999999999999998 -- which is what the honest
  // division returns here, and which would leave a hydrating client's forge a hair short of lit
  // forever.
  const at = (stage) => {
    if (!(elapsedSeconds > stage.start)) return 0;
    if (elapsedSeconds >= stage.start + stage.seconds) return 1;
    return (elapsedSeconds - stage.start) / stage.seconds;
  };
  return {
    frame: at(BUILD_STAGES.frame),
    roof: at(BUILD_STAGES.roof),
    stack: at(BUILD_STAGES.stack),
    tools: at(BUILD_STAGES.tools),
    ignite: at(BUILD_STAGES.ignite),
  };
}

/** Decelerating -- the shape a raised thing settles with. */
function easeOut(t) { return 1 - (1 - t) ** 3; }

// ── the palette ──────────────────────────────────────────────────────────────────────────────────
//
// The timber is the village fence's and the Wildwood Gate's own, imported rather than re-picked so
// retuning that one tone cannot leave the Workshop built out of different wood from everything else
// in the village (GQ-007: a value two modules use lives in one importable module).
//
// The roof gets a darker tone of that same wood, so it reads as a roof and not as one brown mass,
// and it is deliberately neither of the two roof colours already on this street -- the captures show
// teal and red -- so the Workshop is a third flavour at a glance rather than another of something.
const WORKSHOP_ROOF_COLOR = 0x7d4f34;
// Dark warm stone. The first pass made this a pale cool grey on the reasoning that being the one
// cold-toned mass on a warm street would help it read -- and the capture killed that outright: a
// pale grey stack against this game's pale sky is nearly invisible above the roofline, which is the
// exact place the stack has to do its whole job, and at ground level it matched the boulders and
// read as an appliance rather than as a forge. Dark is the correct answer for a silhouette against
// a light sky, and warm keeps it inside the village's palette instead of next to it.
const MASONRY_COLOR = 0x6e6560;
const ANVIL_COLOR = 0x33363b;
// The mouth of the forge -- near-black when cold, lit from inside by emissive rather than by a real
// light, so it costs no shader recompile and needs no shadow work.
const FORGE_MOUTH_COLOR = 0x1a1210;
const FORGE_MOUTH_EMISSIVE = 0xff6a1a;
// 1.5, not the 2.6 of the first pass: at 2.6 the mouth clipped to white in the capture and stopped
// being a fire at all -- a bright rectangle on a box, which is what made the hearth read as a
// household appliance. A forge mouth has to stay ORANGE to be a forge mouth.
const FORGE_MOUTH_INTENSITY = 1.5;
const FORGE_GLOW_COLOR = 0xff8a3d;
const FORGE_GLOW_SIZE_METERS = 0.95;
const EMBER_COLOR = 0xffcf7a;
const EMBER_SIZE_METERS = 0.13;
const EMBER_COUNT = 3;
const EMBER_RISES_PER_SECOND = 0.42;
const EMBER_RISE_METERS = 0.95;

// ── the building, in metres ──────────────────────────────────────────────────────────────────────
//
// All of it in the bay's own frame: x runs OUT from the house's east face, y up from the ground, z
// along that face with 0 at the building's middle. That frame's origin is measured off the prop at
// build time and never typed in, so moving the longhouse in village.js moves the Workshop with it.
//
// Sized against things already in this world rather than against taste: the hero is 1.48 m, the
// house is 2.141 m to the ridge over a 0.965 m eave and 2.0 m deep by 4.1 m long, the street
// lanterns are 1.56 m and the Wildwood Gate is 3.54 m. The stack tops out at 3.21 m, above the house
// and below the gate -- the gate is still the way out of the village, and the Workshop is now the
// second tallest thing in it that a child owns.
//
// Every one of the three numbers below came DOWN after the first capture, and this is the note for
// whoever is tempted to put them back up. The bay was first built 2.80 m along the wall, 1.66 m
// deep, with a roof 3.30 m across -- and photographed from the east it covered four fifths of the
// house's wall and reached further out than the house is deep, so what the child had bought read as
// A BIG BROWN SHED PARKED IN FRONT OF THE HOUSE. The convention this file is built on says the
// smithy is an ordinary building WEARING attached parts; a part that is bigger than the thing it is
// attached to is not a part. So: 2.15 m along a 4.1 m wall (a bit over half), 1.42 m out from a 2.0
// m deep house, and a 1.92 m back panel under a 2.141 m ridge. Subordinate on all three axes, on
// purpose. The chimney is what makes it unmissable; the bay is what makes it a workshop.
const BAY_DEPTH_METERS = 1.42;
const BAY_LENGTH_METERS = 2.15;
const BACK_PANEL_HEIGHT_METERS = 1.92;
const FRONT_EAVE_METERS = 1.42;
const CHIMNEY_TOTAL_METERS = 3.21;

// The roof plane's pitch, derived from the two heights it has to connect rather than chosen: it
// leaves the back panel's top at 1.92 and lands on the front beam at 1.42 over a 1.42 m run, which
// is 19.4 degrees. The first pass was 14.8 and from this game's elevated camera that photographed as
// a flat lid on posts -- a carport, not a roof. Pitch is not decoration here: a shallower roof also
// presents MORE of its area to a camera looking down at it, which is the second reason the first bay
// hid the house behind it.
const ROOF_PITCH_RADIANS = Math.atan((BACK_PANEL_HEIGHT_METERS - FRONT_EAVE_METERS) / BAY_DEPTH_METERS);

/** A box of `size` centred at `at`, optionally rolled about Z, baked into the bay's own space so a
 *  whole material's worth of parts merges into one geometry. Same helper and same reasoning as
 *  wildwoodGate.js's own slab(). */
function slab([width, height, depth], [x, y, z], rollRadians = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const matrix = new THREE.Matrix4();
  if (rollRadians !== 0) matrix.makeRotationZ(rollRadians);
  matrix.setPosition(x, y, z);
  geometry.applyMatrix4(matrix);
  return geometry;
}

// The frame: two posts, the beam they carry, and the back panel that closes the junction against the
// house. The anvil's stump is timber too, so it merges here rather than costing its own draw call.
const TIMBER_PARTS = [
  {
    name: 'back-panel',
    size: [0.16, BACK_PANEL_HEIGHT_METERS, BAY_LENGTH_METERS],
    at: [0.12, BACK_PANEL_HEIGHT_METERS / 2, 0],
  },
  { name: 'post-north', size: [0.17, 1.22, 0.17], at: [BAY_DEPTH_METERS, 0.61, -1.02] },
  { name: 'post-south', size: [0.17, 1.22, 0.17], at: [BAY_DEPTH_METERS, 0.61, 1.02] },
  { name: 'front-beam', size: [0.2, 0.2, 2.3], at: [BAY_DEPTH_METERS, 1.32, 0] },
  { name: 'anvil-stump', size: [0.3, 0.36, 0.3], at: [1.1, 0.18, -0.62] },
];

// One plane, overhanging the beam it lands on and buried at its high end inside the house's own roof
// so the two never show a seam. 2.55 m along the wall against a 2.30 m beam: that overhang is what
// makes a roof read as a roof rather than as a lid.
const ROOF_PARTS = [
  { name: 'bay-roof', size: [1.8, 0.15, 2.55], at: [0.81, 1.67, 0], roll: -ROOF_PITCH_RADIANS },
];

// Chimney, cap and hearth are one masonry mass and overlap on purpose -- a stack meeting its own
// hearth at a visible joint reads as two objects. The stack stands hard against the back panel and
// pierces the bay roof at 1.81 m, so 1.40 m of it is above that roof and 1.07 m above the house.
const MASONRY_PARTS = [
  { name: 'chimney', size: [0.46, 3.05, 0.46], at: [0.4, 1.525, 0.5] },
  { name: 'chimney-cap', size: [0.66, 0.16, 0.66], at: [0.4, CHIMNEY_TOTAL_METERS - 0.08, 0.5] },
  { name: 'hearth', size: [0.86, 0.76, 0.78], at: [0.92, 0.38, 0.5] },
];

// A waist and an overhanging body. Not an anvil in any detail sense, and deliberately not: at
// gameplay distance the entire job of this shape is to be a dark, top-heavy blob at knee height,
// which is the one anvil-ish thing that survives being eight pixels tall.
const ANVIL_PARTS = [
  { name: 'anvil-waist', size: [0.18, 0.15, 0.15], at: [1.1, 0.435, -0.62] },
  { name: 'anvil-body', size: [0.5, 0.13, 0.2], at: [1.12, 0.575, -0.62] },
];

const FORGE_MOUTH_PART = { name: 'forge-mouth', size: [0.1, 0.32, 0.44], at: [1.35, 0.46, 0.5] };
const FORGE_GLOW_AT = [1.48, 0.48, 0.5];
const EMBER_ORIGIN = [1.32, 0.56, 0.5];

function mergedMesh(parts, material, name) {
  const mesh = new THREE.Mesh(
    mergeGeometries(parts.map((part) => slab(part.size, part.at, part.roll ?? 0)), false),
    material,
  );
  mesh.name = name;
  setLayer(mesh, WORLD);
  return mesh;
}

/**
 * @param workshopMesh  the existing prop's own THREE.Object3D (main.js:
 *   `scene.getObjectByName('prop-' + VILLAGE.WORKSHOP_PROP.model)`), or null -- a missing mesh
 *   degrades to "the Workshop has no building to attach to, added at the scene root instead" rather
 *   than throwing, the same defensiveness createCartReaction already shows a missing cart mesh.
 */
export function createWorkshopReaction(scene, workshopMesh) {
  const group = new THREE.Group();
  group.name = 'workshop-level1';
  group.visible = false;

  if (workshopMesh) {
    // Measured off the prop's own real footprint, in the prop's own local frame, so the bay lands
    // against the actual east face whatever that model's dimensions are and wherever village.js
    // moves it -- "measure, do not guess", the same technique createCartReaction's dust puff uses.
    // setFromObject answers in world space; the inverse of the prop's own world matrix brings that
    // answer back into the frame the group is about to be parented into.
    workshopMesh.updateMatrixWorld(true);
    const local = new THREE.Box3()
      .setFromObject(workshopMesh)
      .applyMatrix4(new THREE.Matrix4().copy(workshopMesh.matrixWorld).invert());
    group.position.set(local.max.x, local.min.y, (local.min.z + local.max.z) / 2);
    workshopMesh.add(group);
  } else {
    scene.add(group);
  }

  const timberMaterial = new THREE.MeshStandardMaterial({
    color: GATE_WOOD_COLOR, roughness: 1, metalness: 0, flatShading: true,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: WORKSHOP_ROOF_COLOR, roughness: 1, metalness: 0, flatShading: true,
  });
  const masonryMaterial = new THREE.MeshStandardMaterial({
    color: MASONRY_COLOR, roughness: 0.95, metalness: 0, flatShading: true,
  });
  const anvilMaterial = new THREE.MeshStandardMaterial({
    color: ANVIL_COLOR, roughness: 0.35, metalness: 0.55, flatShading: true,
  });
  const mouthMaterial = new THREE.MeshStandardMaterial({
    color: FORGE_MOUTH_COLOR,
    emissive: new THREE.Color(FORGE_MOUTH_EMISSIVE),
    emissiveIntensity: 0,
    roughness: 1,
    metalness: 0,
  });

  const frame = mergedMesh(TIMBER_PARTS, timberMaterial, 'workshop-frame');
  const roof = mergedMesh(ROOF_PARTS, roofMaterial, 'workshop-bay-roof');
  const masonry = mergedMesh(MASONRY_PARTS, masonryMaterial, 'workshop-forge-masonry');
  const anvil = mergedMesh(ANVIL_PARTS, anvilMaterial, 'workshop-anvil');
  const mouth = mergedMesh([FORGE_MOUTH_PART], mouthMaterial, 'workshop-forge-mouth');
  group.add(frame, roof, masonry, anvil, mouth);

  // A sprite, not a THREE.PointLight -- the same trade render/glow.js's own header explains for the
  // street lanterns: one more real light per Workshop is the wrong cost on an iPad for something felt
  // from ten metres. It sits at the hearth's mouth, low and inside the bay, where the bay's own shade
  // gives an additive sprite something to be brighter THAN. Which is exactly why this is no longer
  // the cue the upgrade leads with: out on the open grass, in a village the Lantern Mark payoff has
  // already flooded with warm gold, it had nothing to be brighter than.
  const forgeGlow = createGlowSprite(FORGE_GLOW_COLOR, FORGE_GLOW_SIZE_METERS);
  forgeGlow.name = 'workshop-forge-glow';
  forgeGlow.position.set(FORGE_GLOW_AT[0], FORGE_GLOW_AT[1], FORGE_GLOW_AT[2]);
  setLayer(forgeGlow, WORLD);
  group.add(forgeGlow);

  // Three embers rising out of the hearth and going out. The one moving thing on the finished
  // building, and kept to three on purpose: every low-poly forge in the reference sweep treats sparks
  // as a small designed effect rather than as a simulation, and this village is already busy.
  const embers = [];
  for (let i = 0; i < EMBER_COUNT; i += 1) {
    const ember = createGlowSprite(EMBER_COLOR, EMBER_SIZE_METERS, 'mote');
    ember.name = 'workshop-ember';
    setLayer(ember, WORLD);
    group.add(ember);
    embers.push(ember);
  }

  let built = false;
  // -1 means "not currently building" -- the same sentinel-clock convention createCartReaction's own
  // joltSeconds already uses.
  let buildSeconds = -1;
  let ambientClock = 0;
  let quiet = false;

  /** The ENTIRE pose of the Workshop, from one number, returning how lit the forge is at that
   *  moment. Instant hydration is this called at the end of the clock rather than a second code
   *  path, so there is exactly one description of what a finished Workshop looks like and a late
   *  joiner cannot drift from what the buyer watched being built. */
  function poseAt(elapsedSeconds) {
    const stage = buildStageProgress(elapsedSeconds);
    // Every part is HIDDEN until its own stage opens, not merely scaled to nothing. A mesh flattened
    // to 2% of its height is not invisible -- it is a dark slab lying on the grass, which is exactly
    // what the masonry photographed as in .local/workshop-probe/v2-build-02.png: a shadow puddle
    // under the bay for the first second of the ceremony, before the chimney had any business
    // existing. Scale alone is not a way to hide something.
    frame.visible = stage.frame > 0;
    // Up out of the ground. Every part of this geometry is baked from y=0 upward, so scaling Y raises
    // it off the grass rather than inflating it about its middle -- posts, beam and back panel rise
    // together like a frame being stood up, which is the readable half of "a building is going up".
    frame.scale.y = Math.max(0.02, easeOut(stage.frame));
    // The roof is a rolled plane, so scaling it would shear it. It comes down instead, from a metre
    // up, and settles onto the frame that just finished rising.
    roof.visible = stage.roof > 0;
    roof.position.y = (1 - easeOut(stage.roof)) * 1;
    // The money beat: the stack climbs out of its own hearth, through the roof that has just landed,
    // and past the house's ridge. This is the frame of the ceremony that changes the skyline.
    masonry.visible = stage.stack > 0;
    masonry.scale.y = Math.max(0.02, easeOut(stage.stack));
    anvil.visible = stage.tools > 0;
    anvil.position.y = (1 - easeOut(stage.tools)) * 1.1;
    // The mouth is a hole in the hearth's front face and has nowhere to be until that hearth is
    // built -- it does not scale with the masonry, so shown early it would hang in the air.
    mouth.visible = stage.ignite > 0;
    mouthMaterial.emissiveIntensity = stage.ignite * FORGE_MOUTH_INTENSITY;
    return stage.ignite;
  }

  return {
    // `instant`: skips the ceremony entirely -- for a client whose FIRST known observation of this
    // Workshop is already built (a late joiner, or a page reload after someone else bought it), the
    // same "already unlocked, no ceremony" rule zoneLoader.js's own tree-relight logic applies via
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
      // A player who has asked for less motion gets the BUILDING, immediately and permanently, and
      // does not get the thing that moves. Never the other way round: the payoff is what they paid
      // for, the ceremony is only how it arrives.
      quiet = prefersReducedMotion();
      if (instant || quiet) {
        poseAt(WORKSHOP_BUILD_SECONDS);
        setGlowStrength(forgeGlow, 0.85);
        buildSeconds = -1;
      } else {
        poseAt(0);
        setGlowStrength(forgeGlow, 0);
        buildSeconds = 0;
      }
    },
    update(deltaSeconds) {
      if (!built) return;
      ambientClock += deltaSeconds;

      let lit = 1;
      if (buildSeconds >= 0) {
        buildSeconds += deltaSeconds;
        lit = poseAt(buildSeconds);
        if (buildSeconds >= WORKSHOP_BUILD_SECONDS) buildSeconds = -1;
      }

      // A slow forge breath, always running once lit. Bounded on purpose: one sine, one opacity, no
      // allocation, and nothing whose cost grows with how long the page has been open.
      const breath = quiet ? 0.85 : 0.82 + Math.sin(ambientClock * 2.6) * 0.11;
      setGlowStrength(forgeGlow, breath * lit);

      for (let i = 0; i < embers.length; i += 1) {
        // Each ember owns its own slice of one shared cycle, so the three leave the hearth staggered
        // rather than as a burst. Frozen at a resting height when motion is unwelcome.
        const phase = i / EMBER_COUNT;
        const rise = quiet ? phase * 0.5 : (ambientClock * EMBER_RISES_PER_SECOND + phase) % 1;
        embers[i].position.set(
          EMBER_ORIGIN[0] + Math.sin(rise * 5.4 + i) * 0.09,
          EMBER_ORIGIN[1] + rise * EMBER_RISE_METERS,
          EMBER_ORIGIN[2] + Math.cos(rise * 4.1 + i) * 0.11,
        );
        setGlowStrength(embers[i], Math.sin(rise * Math.PI) * 0.9 * lit);
      }
    },
    isBuilt() { return built; },
    // GP3-C1: gates the deliberate Workshop interaction until the ceremony has actually finished
    // playing, so "UPGRADE -> Board clears -> transformation is visibly enjoyed -> control returns"
    // is a real sequence rather than a guessed delay -- see main.js's own interact-gate comment. True
    // only during the one-shot build itself, never during the ambient forge loop, and never at all
    // for a hydrating client or for one that has asked for less motion.
    isTransforming() { return buildSeconds >= 0; },
  };
}
