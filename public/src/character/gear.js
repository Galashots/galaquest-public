import * as THREE from '../../vendor/three.module.min.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';

export const RIG_ROOT_NAME = 'Armature';

// These are the fit-harness outputs in glTF axes, relative to the exported Armature
// node. Keeping that reference frame intact is deliberate: Blender bone-local values
// are not stable across its Z-up import and must never become runtime data.
// Re-solved 2026-08-12 against the running game, on the owner's direction: "the shield should rest on the
// outside/top of his hand, and the sword should be perpendicular to his forearm", then "perpendicular
// to the INSIDE of his forearm, the only way a human can grab something that long and feel
// comfortable", with two photographs of a fist gripping a hilt as the reference.
//
// Both items previously carried an identity quaternion, so each kept whatever orientation its source
// GLB happened to have. The sword's ran ALONG the forearm and passed through it -- the same
// wrist-not-palm error that was fixed for Tier 3 in docs/foundry/gear/tier3_fit.json and never
// carried back to the Tier 2 gear the runtime actually draws.
//
// How the orientation was found, since the numbers are otherwise unreadable. Measured off the live
// rig, the RightHand bone's own local axes sit at these angles to the forearm:
//     local X  86.3 degrees      local Y  11.4 degrees      local Z  100.8 degrees
// A fist wraps the axis nearest 90 degrees, so local X is the hilt axis and local Y -- 11 degrees off
// the forearm -- is what the old identity rotation was effectively using. The blade is the sword
// mesh's own local +Y (its bounding box is 0.316 x 1.000 x 0.114), rotated onto that hilt axis, with
// the handle seated 0.43 of the way down from centre so the pommel tucks under the hand instead of
// protruding through the back of it.
//
// THE SHIELD IS NOT HELD IN THE FIST. It is strapped to the OUTSIDE OF THE FOREARM, which is the
// convention every game in this genre uses and which no amount of geometry could have told us --
// the owner settled it by pasting six World of Warcraft screenshots. Solved 2026-08-12 by
// tools/runtime-test/fit-shield.mjs with --slide 0.04 --out 0.085 --roll 45.
//
// RE-TUNED 2026-08-13 NIGHT after the owner flagged the carry in running-game captures and Sol reviewed
// them against Toon-Link-class references: at roll 45 the disc read as an edge-on wheel floating by
// the hand, and at idle the sword lay horizontally across the abdomen. Sol's targets, applied and
// baked from the live game: shield plane along the outside of the forearm at 10-20 degrees of
// outward cant (fit-shield.mjs --slide 0.05 --out 0.05 --roll 15); sword blade pitched ~45 degrees
// below horizontal, tip down-forward and slightly outboard, terminating near knee height at idle
// (tools/runtime-test/fit-sword.mjs --pitch 45 --outboard 15 -- shortest-arc reorientation of the
// measured blade axis, position untouched). The mounts are optimized for the IDLE silhouette per
// Sol: the slash has motion to sell it, idle has nothing to hide a bad mount.
//
// THE SWORD WAS RE-GRIPPED 2026-08-14, and the bug was in the words "position untouched" above.
// fit-sword.mjs re-aims by rotating the anchor about its OWN ORIGIN. The sword mesh's handle is
// seated 0.43 of its length away from that origin (see the paragraph above), so rotating the blade
// down through ~90 degrees swung the hilt off the hand and left it hanging in mid-air. Measured in
// the running game, not inferred: the grip sat 0.172 m from the RightHand bone -- 11% of this
// 1.5 m hero's height -- with 0.147 m of that straight forward, which is exactly the "sword floating
// past an open hand" the front and side captures showed. Two further claims in that re-tune were
// measured false at the same time: the blade tip finished at y=0.699, which is this rig's HIP
// (Hips y=0.684), not "near knee height" (RightLeg y=0.348).
//
// The re-fit, solved and baked against the live game by tools/runtime-test/fit-carry.mjs:
//   - Re-aim to 70 degrees below horizontal, 22 degrees outboard, THEN translate the anchor so the
//     handle lands back on the hand. Aim first, seat second -- doing it in the other order just
//     moves the error somewhere else.
//     Outboard is 22 and not 15 on Sol's review of the first pass: he ruled the PITCH finished
//     ("keep sword pitch", 69 below horizontal "is in the useful range") but asked for 5-10 degrees
//     of outward YAW, because at play distance "the sword, hand, forearm and leg nearly become one
//     vertical shape", which he called the single biggest remaining silhouette problem. The blade
//     now separates from the trouser leg at camera distance 8.
//   - The hilt is seated 0.055 m PAST the RightHand bone, along the forearm's own direction, not on
//     it. `RightHand` is the WRIST (see the skeleton note further down); gripping exactly at the
//     bone ran the blade down through the hand mesh, which the first attempt's captures showed
//     plainly. 0.055 m puts it in the fist.
//   - Measured after: grip-to-hand 0.055 m by construction, blade 68.8 degrees below horizontal,
//     tip at y=0.414 against a knee at y=0.348. That is the "terminating near knee height" the
//     re-tune above aimed at and missed by 0.35 m.
//
// This depends on the idle pose, and that is not a hidden coupling -- it is the whole reason the
// first re-tune could not hit its own target. Idle_02 holds the sword hand at y=0.824 with the arm
// splayed 46 degrees off vertical; grip-to-tip is only 0.336 m, so from that hand NO blade angle can
// reach a 0.348 m knee. The arm had to come down before the sword could hang right. locomotion.js's
// IDLE_ARM_SETTLE does that, and these numbers are solved against the settled pose. If that settle
// is ever removed or retuned, re-run the fit -- do not hand-edit these quaternions.
//
// Before the references arrived this was fitted as a disc gripped in the fist and presented forward.
// It was self-consistent, it satisfied every constraint that had been stated in words, and it was
// wrong. See "Look before you derive" in AGENTS.md.
//
// KNOWN LIMIT, and it is not fixable here: this rig has 24 bones and NO finger bones, so the hand
// mesh has splayed fingers baked in and can never close. the owner's reference photographs both show a
// closed fist. Nothing placed in this hand will read as gripped at inspection distance; at the 90 CSS
// px the game is actually played at, the whole hand is a few pixels and it reads correctly.
//
// WHY THAT LIMIT EXISTS, and the way out of it. the owner's observation from working in Meshy directly,
// 2026-08-13, confirmed by measuring the rig: THE SKELETON ENDS AT THE WRISTS, NOT THE HANDS. The
// arm chain is Shoulder -> Arm -> ForeArm -> Hand and stops. `RightHand` and `LeftHand` are not
// palm joints with fingers hanging off them; they ARE the wrist, and the hand past them is
// unarticulated skinned geometry. That is the real reason the sword's first fit read as a wrist
// mount and the reason nothing can ever be gripped -- there is no joint in the palm to grip with,
// and there never will be on this rig.
//
// The convention the owner names for when weapons expand: many games author the weapon mesh WITH A HAND
// ALREADY WRAPPED AROUND IT and hide or replace the character's own hand, which turns attaching at
// the wrist from a compromise into the correct thing to do -- the weapon carries its own grip, and
// the wrist is exactly where a gripped weapon should pivot. That flips this whole comment block from
// "known limit we work around" to "the mount point was right all along".
//
// NOT A CHANGE TO MAKE NOW. the owner's call: "what we have currently works OK". It is recorded here
// because this is the file anyone adding a weapon will open, and because the decision needs making
// BEFORE a second weapon is authored, not after -- baking a hand into a mesh is an authoring choice,
// and retrofitting it across a finished weapon set is the expensive version.
//
// Before acting on it, look it up. AGENTS.md, "Look before you derive": this is a stated convention,
// not a measured fact, and this file already records one case where a self-consistent derivation was
// simply wrong until six World of Warcraft screenshots settled it. Search for how equipped weapon
// meshes are authored and confirm the hand is part of the weapon before anyone models one that way.
// SUPERSEDED 2026-08-24 BY OWNER VISUAL REJECTION. Everything above is the history of how this
// mount was derived; it is kept because it records what was tried and why, and because two of its
// lessons still hold (aim first then seat; this rig's arm chain ends at the wrist). But its
// MEASUREMENTS -- 0.055 m past the bone, 68.8 degrees below horizontal, tip at y=0.414 -- describe
// the RETIRED sword transform and are no longer true of the value below. Nor is the word
// "Sol-approved" authority for it any more: the Owner looked at the shipping sword on a real iPhone
// and on the Forge and rejected the carry. Running-game pixels outrank a prior review.
//
// What the rejection actually was, photographed rather than inferred: in the Forge's bind fit pose
// the blade pointed [-0.999, -0.026, -0.026] -- straight out along the arm -- so the sword lay FLAT
// ACROSS THE BACK OF THE HAND with the guard behind the knuckles. It was not held; it was balanced.
// At idle it read as an unidentifiable stub at the hip.
//
// The re-fit, made in the Forge against the Owner-approved Dawnwarden carry as the visual reference:
// rack entry "Starter Sword (Ironwood)" -> loadout shipping-sword-only (shield hidden so the
// silhouette reads) -> world-XYZ delta position [-0.0115, -0.0192, 0.0158] m, rotation
// [-63.57, 64.18, 49.26] degrees, scale unchanged. The rotation was not guessed and not copied: both
// meshes carry the +Y-blade, origin-at-grip convention (see normalizeSwordPayload), so the delta is
// the world rotation that lands this blade on the direction the Owner already accepted for
// Dawnwarden. The position is a small seat down and outboard so the guard clears the fingers.
// Dawnwarden's own ownerFit was NOT touched; it was read as a reference and nothing else.
//
// Baked through forge/runtimeBake.js, which is the exact inverse of attachRigidTier2Gear and reads
// the bind pose out of the skeleton's boneInverses -- so unlike the 2026-08-17 remediation this
// number was not measured in whatever pose happened to be on screen. See
// test/forge-runtime-bake.test.mjs and test/gear-bake-frame-contract.test.mjs.
//
// SEATED IN THE HAND 2026-08-24, second Owner rejection of the same carry. The re-fit above got the
// ANGLE right and left the sword in the wrong PLACE: the Owner's shipping-hero and Studio captures
// showed the blade hanging off the fingertips with the guard outboard of the fingers -- held by
// nobody, "dangling", against a Dawnwarden reference that plainly reads as gripped.
//
// This time the relationship was measured rather than eyeballed, in the Forge's bind fit pose,
// against the Owner-approved Dawnwarden carry -- the SAME hand, the SAME pose, so the two numbers
// are directly comparable. Distances are from the RightHand bone (the wrist; this rig has no finger
// joints) to the middle of each sword's own handle segment, where a fist would close:
//
//                            handle midpoint      guard        pommel     blade axis
//   Dawnwarden (approved)         0.065 m        0.163 m      0.111 m     reference
//   Starter Sword (rejected)      0.175 m        0.147 m      0.217 m     1.15 deg off Dawnwarden
//   Starter Sword (this fit)      0.065 m        0.112 m      0.080 m     unchanged
//
// The hand mesh reaches 0.188 m from the wrist, so 0.175 m WAS the fingertips: the measurement and
// the photograph agree, which is why this is a seat correction and not another angle experiment.
// Dawnwarden's own grip sits at 0.12 of its length from the pommel -- the middle of its handle --
// and that is the point this fit reproduces for a handle of a different length.
//
// So the change is a PURE TRANSLATION and deliberately nothing else. The blade axis was already
// within 1.15 degrees of the Owner-approved Dawnwarden direction (the re-fit above did that part
// correctly), and re-aiming a sword whose angle is already accepted is how the 2026-08-14 re-grip
// moved its own error somewhere else. Forge rack entry "Starter Sword (Ironwood)" -> loadout
// shipping-sword-only -> world-XYZ delta position [0.026, -0.015, 0.1377] m, rotation [0, 0, 0],
// scale unchanged; baked through forge/runtimeBake.js exactly as above. Only `position` below moved.
// Dawnwarden's ownerFit was read as the reference and NOT touched -- candidateGear.js is unchanged.
export const RIGID_TIER2_GEAR = Object.freeze([
  Object.freeze({
    id: 'sword_ironwood',
    boneName: 'RightHand',
    restRelativeToHeroRoot: Object.freeze({
      // Carried to twelve places and normalised on purpose. Rounded to six, the quaternion is
      // 1.0000003 long, and Matrix4.decompose reads that surplus as scale -- enough to miss the
      // attachment test's 1e-6 tolerance on a magnitude-29 local scale.
      position: Object.freeze([-62.25592, 95.64749, 16.35949]),
      quaternion: Object.freeze([-0.560465386086, 0.623437925195, 0.475258689008, -0.267082165168]),
      // Unchanged, twice over: the 2026-08-24 seat correction is a pure translation, so the bake
      // returned this quaternion back to within 1e-8 and it is kept at its normalised twelve places
      // rather than re-pasted with round-trip noise. The bake reported 47.00001 on two axes, which
      // is decompose noise, not a decision.
      scale: Object.freeze([47, 47, 47]),
    }),
  }),
  Object.freeze({
    id: 'shield_ironwood',
    boneName: 'LeftHand',
    restRelativeToHeroRoot: Object.freeze({
      position: Object.freeze([54.64649, 103.87303, 0.35595]),
      quaternion: Object.freeze([0.585731078266, 0.649580077439, 0.346917188937, -0.338545847659]),
      scale: Object.freeze([45, 45, 45]),
    }),
  }),
]);

const IDENTITY_EPSILON = 1e-8;

function isIdentityNodeTransform(object) {
  return (
    object.position.lengthSq() <= IDENTITY_EPSILON &&
    Math.abs(object.quaternion.x) <= IDENTITY_EPSILON &&
    Math.abs(object.quaternion.y) <= IDENTITY_EPSILON &&
    Math.abs(object.quaternion.z) <= IDENTITY_EPSILON &&
    Math.abs(object.quaternion.w - 1) <= IDENTITY_EPSILON &&
    Math.abs(object.scale.x - 1) <= IDENTITY_EPSILON &&
    Math.abs(object.scale.y - 1) <= IDENTITY_EPSILON &&
    Math.abs(object.scale.z - 1) <= IDENTITY_EPSILON
  );
}

function matrixFromRestTransform(restRelativeToHeroRoot) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...restRelativeToHeroRoot.position),
    new THREE.Quaternion(...restRelativeToHeroRoot.quaternion),
    new THREE.Vector3(...restRelativeToHeroRoot.scale),
  );
}

/**
 * The name every rigid gear anchor gets. One definition, because three places now need to AGREE on
 * it: the two attach functions that build anchors, and character/weaponLoadout.js, which has to find
 * them again by name inside a SkeletonUtils clone (a clone has new object identities, so the record
 * attachRigidTier2Gear returned for the original is no use there -- the name is the only handle).
 */
export function rigidAnchorName(gearId, boneName) {
  return `InterimAdapter_${gearId}_${boneName}`;
}

function requiredObject(root, name, kind) {
  const object = root.getObjectByName(name);
  if (!object) {
    throw new Error(`Cannot attach Tier 2 gear: missing ${kind} ${name}.`);
  }
  return object;
}

/**
 * The bone's matrixWorld AS AUTHORED, not as the clip currently has it.
 *
 * Every rest transform in this file is root-relative, so mounting one means solving
 * `inverse(bone.matrixWorld) x rigRoot.matrixWorld x rest` -- and the answer depends entirely on
 * WHICH bone.matrixWorld. All of them were baked against the bind pose (the fit-*.mjs tools pose the
 * skeleton before measuring), so a mount that reads the LIVE bone bakes the delta between bind and
 * whatever pose happened to be playing into the anchor's local transform permanently: a rigid child
 * inherits that error every subsequent frame. attachRigidTier2Gear never notices because its only
 * caller is loadHero(), which runs before the AnimationMixer's first update. The lazy mounts below
 * -- a reward unlocking mid-play, a sibling's gear arriving over the network, a Studio loadout swap
 * -- always land mid-clip, and on the shipped rig the Hips bone leaves bind in EVERY clip (least in
 * `idle`, 3.57 units and 12.20 degrees at its extreme; most in `death`, 80.03 and 97.03).
 *
 * Computed from the skeleton's own boneInverses (matrixWorld = invert(boneInverse), exactly what
 * Skeleton.pose() does internally) rather than by calling skeleton.pose(): pose() OVERWRITES every
 * bone's live position/quaternion/scale, and on this rig doing that visibly destroys the character
 * -- confirmed directly, not assumed. Reading boneInverses never touches a live bone, so there is
 * nothing to restore afterwards.
 *
 * Degrades to the live matrix on a rig with no SkinnedMesh (the synthetic heroes in the unit tests),
 * where bind is the only pose there is.
 */
export function bindPoseMatrixWorld(heroRoot, bone) {
  let skinned = null;
  heroRoot.traverse((object) => { if (!skinned && object.isSkinnedMesh) skinned = object; });
  if (!skinned) return bone.matrixWorld;
  const boneIndex = skinned.skeleton.bones.indexOf(bone);
  if (boneIndex === -1) return bone.matrixWorld;
  return new THREE.Matrix4().copy(skinned.skeleton.boneInverses[boneIndex]).invert();
}

/**
 * Parent the merged-atlas gear nodes to their live three.js hand Bones.
 *
 * The tracer records a rest matrix relative to Armature, which is the GLTF rig
 * root rather than the outer scene. Reconstructing its desired world matrix,
 * then expressing it in the current bone matrix, lets the exported 0.01 rig
 * scale participate in the calculation. In particular, 47 is data in the
 * root-relative tracer matrix, not a copied local-scale compensation factor.
 */
export function attachRigidTier2Gear(heroRoot) {
  const rigRoot = requiredObject(heroRoot, RIG_ROOT_NAME, 'rig root');
  heroRoot.updateMatrixWorld(true);

  return RIGID_TIER2_GEAR.map((item) => {
    const gear = requiredObject(heroRoot, item.id, 'gear node');
    const bone = requiredObject(heroRoot, item.boneName, 'hand Bone');
    if (!bone.isBone) {
      throw new Error(`Cannot attach Tier 2 gear: ${item.boneName} is not a Bone.`);
    }
    if (!isIdentityNodeTransform(gear)) {
      throw new Error(`Cannot attach Tier 2 gear: ${item.id} must have an identity node transform.`);
    }

    const restRelativeToHeroRoot = matrixFromRestTransform(item.restRelativeToHeroRoot);
    const world = new THREE.Matrix4().multiplyMatrices(rigRoot.matrixWorld, restRelativeToHeroRoot);
    const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(world);
    const anchor = new THREE.Group();
    anchor.name = rigidAnchorName(item.id, item.boneName);
    local.decompose(anchor.position, anchor.quaternion, anchor.scale);

    // The merged GLB supplies canonical source-space gear at identity. Reparenting
    // that object under a solved anchor preserves its atlas material and avoids an
    // unwrap, a duplicated material, or a Blender-axis conversion in the runtime.
    bone.add(anchor);
    gear.parent.remove(gear);
    anchor.add(gear);

    return { id: item.id, anchor, bone, gear };
  });
}

// ---------------------------------------------------------------------------
// Phase D: the belt lantern (the private engineering archive, D4)
// ---------------------------------------------------------------------------
//
// Sol's ruling implemented: three Lantern Marks unlock a real lantern prop, worn on the belt,
// mounted the same rigid-attachment way the sword and shield are. Two real differences from
// RIGID_TIER2_GEAR above, both because of WHERE this asset comes from rather than anything about
// the mounting technique itself:
//
//   1. public/assets/gear/lantern_belt.glb is a SEPARATE file loaded independently (world/assets.js's
//      loadGLB), not baked into the hero's own merged atlas -- the asset lands on its own
//      orchestrator/Meshy track (pre-brief-discussion.md decision 1), decoupled from a hero
//      re-export. attachRigidTier2Gear expects its gear nodes to already be children of heroRoot
//      (RE-parenting a merged node); attachBeltLantern PARENTS IN a freshly loaded root instead.
//   2. The transform below is NOT a measured fit. As of this commit the asset does not exist in this
//      repo -- Meshy generation and the fit measurement (RIGID_TIER2_GEAR's own header documents the
//      fit-shield.mjs process that produced its own numbers) are the orchestrator's track, out of
//      scope here per the brief. FIT PENDING marks every number below as provisional.
export const BELT_LANTERN_BONE_NAME = 'Hips';
export const BELT_LANTERN_URL = 'assets/gear/lantern_belt.glb';

export const RIGID_BELT_LANTERN = Object.freeze({
  id: 'lantern_belt',
  boneName: BELT_LANTERN_BONE_NAME,
  restRelativeToHeroRoot: Object.freeze({
    // Measured 2026-08-13 night by tools/runtime-test/fit-lantern.mjs --left -0.16 --up -0.04
    // --fwd -0.05 --height 0.2, baked from the live game the same way the sword and shield were.
    // RIGHT hip, not left: the re-tuned shield hangs along the left forearm and at idle covers the
    // left hip completely -- the first fit put the lantern there and it vanished behind the disc.
    // 0.2m tall, upright, at the belt line beside the buckle; judged in captures from four angles.
    position: Object.freeze([-17.29008, 66.15153, 9.84118]),
    quaternion: Object.freeze([0.082588846331, 0.217058108017, 0.014322217236, 0.97255320384]),
    scale: Object.freeze([20, 20, 20]),
  }),
});

/**
 * Mount an already-loaded lantern root onto the hero's Hips bone, rigidly -- the same
 * bone-relative-matrix technique attachRigidTier2Gear uses (see its own comment for why the rig
 * root's matrixWorld has to participate). Unlike attachRigidTier2Gear, `lanternRoot` is NOT
 * expected to already be a child of `heroRoot`: it is loaded independently because the asset ships
 * on its own track, not baked into a hero re-export, so this PARENTS IT IN rather than
 * re-parenting an existing child.
 *
 * Deliberately does not touch loading or 404 handling -- that is main.js's job (world/assets.js's
 * loadGLB already degrades a missing file to a labelled placeholder + userData.loadError; the
 * caller decides whether that placeholder is worth mounting at all). This function's only job is
 * the geometry, and it throws if the hero rig itself is missing the Hips bone -- a real defect,
 * not a missing-asset situation, and one every other rigid attachment in this file also throws on.
 */
export function attachBeltLantern(heroRoot, lanternRoot) {
  const rigRoot = requiredObject(heroRoot, RIG_ROOT_NAME, 'rig root');
  const bone = heroRoot.getObjectByName(RIGID_BELT_LANTERN.boneName);
  if (!bone) {
    throw new Error(`Cannot attach the belt lantern: missing bone ${RIGID_BELT_LANTERN.boneName}.`);
  }
  if (!bone.isBone) {
    throw new Error(`Cannot attach the belt lantern: ${RIGID_BELT_LANTERN.boneName} is not a Bone.`);
  }
  heroRoot.updateMatrixWorld(true);

  // Bind, never the live Hips -- see bindPoseMatrixWorld. NEITHER caller of this function mounts at
  // load time: main.js's ensureLanternMounted fires when the reward unlocks mid-play, and its
  // mountGearOnRemote fires when a sibling's gear arrives, both after an await. Reading the live
  // bone here put the lantern 18.24 units and 30.04 degrees off its authored seat under a bone
  // perturbation no larger than the idle loop's own (test/lazy-mount-bind-frame.test.mjs).
  const restRelativeToHeroRoot = matrixFromRestTransform(RIGID_BELT_LANTERN.restRelativeToHeroRoot);
  const world = new THREE.Matrix4().multiplyMatrices(rigRoot.matrixWorld, restRelativeToHeroRoot);
  const local = new THREE.Matrix4().copy(bindPoseMatrixWorld(heroRoot, bone)).invert().multiply(world);
  const anchor = new THREE.Group();
  anchor.name = rigidAnchorName(RIGID_BELT_LANTERN.id, RIGID_BELT_LANTERN.boneName);
  local.decompose(anchor.position, anchor.quaternion, anchor.scale);

  bone.add(anchor);
  anchor.add(lanternRoot);
  lightTheLantern(lanternRoot);

  return { id: RIGID_BELT_LANTERN.id, anchor, bone, gear: lanternRoot };
}

// ---------------------------------------------------------------------------
// Wave 1A: the Wildwood Blade candidate (CSB phase, armour-progression-doctrine.md section 6)
// ---------------------------------------------------------------------------
//
// Sol's explicit instruction after SR5 ACCEPTED: generate one Wildwood Blade candidate (W1-A) and
// mount it "using the real shipping Hero conventions" for Character Studio review -- Grip Inspector,
// Fit Envelope, gameplay/inspection framing. This is NOT a second shipped weapon: it lives under
// public/assets/gear/candidates/ (not public/assets/gear/ where accepted gear ships), is loaded
// independently exactly like the belt lantern above (not baked into the hero's own atlas), and is
// never mounted by loadHero()/attachRigidTier2Gear -- only Character Studio's 'candidate-wildwood-
// blade' loadout (scene.js) ever calls attachWildwoodBladeCandidate, and only after first hiding the
// shipping sword_ironwood anchor so the two swords are never visible in the same hand at once
// (doctrine 5.1's locked-comparison rule: only the loadout varies, and a candidate must never render
// alongside shipping gear it is meant to replace).
export const WILDWOOD_BLADE_CANDIDATE_BONE_NAME = 'RightHand';
export const WILDWOOD_BLADE_CANDIDATE_URL = 'assets/gear/candidates/sword_wildwood_w1a.glb';
export const WILDWOOD_BLADE_CANDIDATE_ID = 'sword_wildwood_w1a';

export const RIGID_WILDWOOD_BLADE_CANDIDATE = Object.freeze({
  id: WILDWOOD_BLADE_CANDIDATE_ID,
  boneName: WILDWOOD_BLADE_CANDIDATE_BONE_NAME,
  restRelativeToHeroRoot: Object.freeze({
    // SOLVED 2026-08-16 by tools/runtime-test/fit-wildwood-blade.mjs (default --grip-frac 0.45,
    // --roll 0) against Character Studio -- not sword_ironwood's transform reused (that was this
    // field's original placeholder, and the live selftest that followed it showed the blade floating
    // near the character's HEAD, nowhere close to the hand: this new mesh's own local origin does not
    // sit at its grip the way sword_ironwood's authored pivot does, so reusing sword_ironwood's anchor
    // verbatim swung the wrong offset to a different wrong place rather than fixing it).
    //
    // The fit tool measures THIS mesh's own geometry rather than assuming it shares sword_ironwood's
    // conventions: longest local bounding-box axis = the blade-to-pommel axis, and the crossguard's
    // own wider cross-section (bucketed along that axis) marks the hilt end -- geometry, not a guess.
    // The grip point sits inward from the crossguard toward the pommel by --grip-frac of that span.
    // Orientation and world length are matched to the SHIPPING sword's own current live measurement
    // (blade direction, flat-face normal, grip-to-tip length) rather than hardcoded angles, so a
    // future re-tune of sword_ironwood's own mount is picked up automatically by re-running this tool.
    // The grip point is seated 0.055m past the RightHand bone along the forearm's own direction --
    // sword_ironwood's own documented convention (gear.js's Tier 2 header, "THE SWORD WAS
    // RE-GRIPPED 2026-08-14").
    //
    // Verified visually against real Character Studio captures (gameplay + inspection, front +
    // three-quarter, grip overlay on) before trusting it -- the blade sits in the fist, tip clear of
    // the leg, not floating or clipping. gripToWristDistance reads higher than sword_ironwood's own
    // 0.055m (this mesh's local origin is not at its grip point the way sword_ironwood's authored
    // pivot is, so that particular Grip Inspector number is not directly comparable across the two
    // meshes) -- judged by the screenshots, per this field's own standing rule, not by forcing that
    // one number to match.
    //
    // Checked across the WHOLE idle loop, not one lucky frame: the first version of this fit looked
    // right in the fit tool's own live session but floated off the hand again after being baked and
    // reloaded, because Character Studio mounts this candidate LAZILY (setLoadout, well after the
    // AnimationMixer's first update), while this rest transform is solved and baked against BIND
    // POSE -- attachWildwoodBladeCandidate now reads the bind-pose bone matrix from the skeleton's
    // own boneInverses rather than the live (mid-animation) bone.matrixWorld, so the mount is correct
    // no matter when in the loop it happens to be called. See that function's own comment for why
    // calling skeleton.pose() directly is NOT the fix (it visibly shrinks the whole character on this
    // rig -- confirmed directly, not assumed).
    //
    // RE-SOLVED 2026-08-28 against the RUNNING GAME (Issue #82). The 2026-08-16 value above was
    // solved and screenshot-verified in Character Studio, but in the live game it left the grip
    // 0.243m from the RightHand bone: the blade sat buried against the chest, edge-on to the
    // gameplay camera, and the hand read as EMPTY -- the Owner's playtest report. The Studio
    // showcase pose and camera happened to make that same 0.243m offset look almost seated, which
    // is how it passed visual acceptance (GQ-010: flags/one-pose captures are not gameplay pixels).
    // This value was produced by the same geometry solve (grip-frac 0.45, shipping-sword-matched
    // direction/length/seat) run against window.__galaQuestRuntime, then baked through THIS
    // function's own inversion (rest = rigRoot.matrixWorld^-1 * bindPoseMatrixWorld * local) so the
    // attach below reconstructs it exactly -- no skeleton.pose() roundtrip, whose bind frame is NOT
    // the boneInverses bind frame this function reads. Note the old value ALSO measured a 0.055m
    // grip seat -- its defect was pure orientation (blade pitch 26.9 degrees vs the shipping
    // sword's 68.8; this value measures 63.9) -- so the drive-hero-screen regression asserts the
    // pitch, not just the seat. Verified by running-game screenshots at gameplay framing, world and
    // Hero screen, on a fresh reload.
    // The blade-axis sign is flipped relative to the raw shipping-sword bbox measurement: the
    // guard-nearest-anchor heuristic picks the wrong end on the live-game ironwood mesh, and the
    // unflipped solve held the blade tip-up through the chest. Flipped, the presentation matches
    // the shipping sword's own (tip down-forward from the fist at idle) -- judged from running-game
    // captures of both swords, not from the heuristic.
    position: Object.freeze([-61.7927, 89.96901, 19.44264]),
    quaternion: Object.freeze([0.637740055228, -0.502196269715, -0.53841711913, 0.22625988259]),
    scale: Object.freeze([59.92007, 59.92008, 59.92008]),
  }),
});

/**
 * Mount an already-loaded Wildwood Blade candidate root onto the hero's RightHand bone -- the same
 * independently-loaded-GLB pattern attachBeltLantern uses (see its own comment), applied to the
 * SAME bone the shipping sword_ironwood uses. Callers (scene.js) are responsible for hiding the
 * shipping sword's anchor while this candidate's anchor is visible; this function only mounts the
 * geometry, exactly like every other rigid attachment in this file.
 */
export function attachWildwoodBladeCandidate(heroRoot, bladeRoot) {
  const rigRoot = requiredObject(heroRoot, RIG_ROOT_NAME, 'rig root');
  const bone = heroRoot.getObjectByName(RIGID_WILDWOOD_BLADE_CANDIDATE.boneName);
  if (!bone) {
    throw new Error(`Cannot attach the Wildwood Blade candidate: missing bone ${RIGID_WILDWOOD_BLADE_CANDIDATE.boneName}.`);
  }
  if (!bone.isBone) {
    throw new Error(`Cannot attach the Wildwood Blade candidate: ${RIGID_WILDWOOD_BLADE_CANDIDATE.boneName} is not a Bone.`);
  }

  heroRoot.updateMatrixWorld(true);

  // restRelativeToHeroRoot was solved (fit-wildwood-blade.mjs) and baked against BIND POSE bone
  // matrices -- the same assumption attachRigidTier2Gear gets for free by running inside loadHero()
  // before the AnimationMixer's first update() ever runs. This mount is lazy (Character Studio's
  // on-demand loadout swap, scene.js's setLoadout), so by the time it actually runs the skeleton is
  // almost always already mid-animation. Reading bone.matrixWorld in that state was caught by
  // comparing this candidate's own live, pre-bake fit-tool screenshots (good) against a fresh-page
  // reload of the same baked value at the same animation time (blade floating off the hand
  // entirely). bindPoseMatrixWorld is the shared answer -- see its comment for the arithmetic and
  // for why calling skeleton.pose() is not it.
  const bindMatrixWorld = bindPoseMatrixWorld(heroRoot, bone);

  const restRelativeToHeroRoot = matrixFromRestTransform(RIGID_WILDWOOD_BLADE_CANDIDATE.restRelativeToHeroRoot);
  const world = new THREE.Matrix4().multiplyMatrices(rigRoot.matrixWorld, restRelativeToHeroRoot);
  const local = new THREE.Matrix4().copy(bindMatrixWorld).invert().multiply(world);
  const anchor = new THREE.Group();
  anchor.name = rigidAnchorName(RIGID_WILDWOOD_BLADE_CANDIDATE.id, RIGID_WILDWOOD_BLADE_CANDIDATE.boneName);
  local.decompose(anchor.position, anchor.quaternion, anchor.scale);

  bone.add(anchor);
  anchor.add(bladeRoot);

  return { id: RIGID_WILDWOOD_BLADE_CANDIDATE.id, anchor, bone, gear: bladeRoot };
}

// ---------------------------------------------------------------------------
// G1-C3: the Silverguard Helmet (progression-g1-first-visible-armor)
// ---------------------------------------------------------------------------
//
// The first piece of earned armour. Mounted on the Head bone the same independently-loaded-GLB way
// the belt lantern is -- a separate file, loaded only when THIS child equips the helmet, never baked
// into the hero's own merged atlas. Anatomy occlusion (hair/ears hidden while equipped) is handled
// by main.js calling hero.setAnatomyCoverage; this module only owns the geometry.
export const SILVERGUARD_HELMET_BONE_NAME = 'Head';
export const SILVERGUARD_HELMET_URL = 'assets/gear/helmet_silverguard.glb';
export const SILVERGUARD_HELMET_ID = 'helmet_silverguard';

// What an open-face helmet hides so the hair and ears do not poke through it -- the shipping
// Silverguard's own occlusion, stated here with the rest of its geometry authority rather than
// borrowed from the studio's Dawnwarden candidate profile (gearFitProfiles.js), which happens to
// hide the same two regions but is a different, owner-locked mesh. main.js and net/remotes.js both
// import THIS when they toggle coverage for the local hero and for siblings; the region names are
// validated against the baked anatomy by hero.setAnatomyCoverage at the seam (it throws on an
// unknown region), so a typo here cannot pass silently.
export const SILVERGUARD_HELMET_HIDES_ANATOMY = Object.freeze(['hair', 'ears']);

export const RIGID_SILVERGUARD_HELMET = Object.freeze({
  id: SILVERGUARD_HELMET_ID,
  boneName: SILVERGUARD_HELMET_BONE_NAME,
  restRelativeToHeroRoot: Object.freeze({
    // Measured 2026-08-25 by tools/runtime-test/fit-helmet.mjs --up 0.12 --fwd 0.01 --height 0.26,
    // baked from the live game the same bind-frame way the sword, shield and lantern were. The Head
    // bone sits at the base of the skull, not its centre, so the seat is raised 0.12m to cap the
    // crown rather than swallow the face; height 0.26m matches the head and leaves the face open, the
    // open-face read the anatomy occlusion (hair/ears) is authored for. Judged in head-framed captures
    // from four angles: crown covered, face clear, no clip through the shoulders, Shield unregressed.
    position: Object.freeze([-0.4735, 122.46235, 1.66404]),
    quaternion: Object.freeze([-0.084336314711, 0.000883790884, 0.006155776196, 0.9964179401]),
    scale: Object.freeze([32.71, 32.71, 32.71]),
  }),
});

/**
 * Mount an already-loaded Silverguard helmet root onto the hero's Head bone -- the same
 * independently-loaded-GLB pattern attachBeltLantern uses. Unlike the Tier 2 gear baked into the
 * atlas, this is loaded and parented in only when a child equips the helmet, not at hero load time.
 */
export function attachSilverguardHelmet(heroRoot, helmetRoot) {
  const rigRoot = requiredObject(heroRoot, RIG_ROOT_NAME, 'rig root');
  const bone = heroRoot.getObjectByName(RIGID_SILVERGUARD_HELMET.boneName);
  if (!bone) {
    throw new Error(`Cannot attach the Silverguard Helmet: missing bone ${RIGID_SILVERGUARD_HELMET.boneName}.`);
  }
  if (!bone.isBone) {
    throw new Error(`Cannot attach the Silverguard Helmet: ${RIGID_SILVERGUARD_HELMET.boneName} is not a Bone.`);
  }

  heroRoot.updateMatrixWorld(true);

  const bindMatrixWorld = bindPoseMatrixWorld(heroRoot, bone);

  const restRelativeToHeroRoot = matrixFromRestTransform(RIGID_SILVERGUARD_HELMET.restRelativeToHeroRoot);
  const world = new THREE.Matrix4().multiplyMatrices(rigRoot.matrixWorld, restRelativeToHeroRoot);
  const local = new THREE.Matrix4().copy(bindMatrixWorld).invert().multiply(world);
  const anchor = new THREE.Group();
  anchor.name = rigidAnchorName(RIGID_SILVERGUARD_HELMET.id, RIGID_SILVERGUARD_HELMET.boneName);
  local.decompose(anchor.position, anchor.quaternion, anchor.scale);

  bone.add(anchor);
  anchor.add(helmetRoot);

  return { id: RIGID_SILVERGUARD_HELMET.id, anchor, bone, gear: helmetRoot };
}

// The reward is a LANTERN, and it shipped dark. Looked at in the running game at the plaza camera
// (.local/runtime-test/moment-13-after-closer.png) it reads as a small grey box on the hero's hip:
// the one thing the whole quest is for, and nothing about it says light. One additive sprite fixes
// that, the same treatment render/glow.js gives the street lanterns -- no extra light in the scene,
// and it rides the Hips bone with the rest of the mount for free.
//
// Sized in the LANTERN's own local space, which the mount scales by 20 (see
// RIGID_BELT_LANTERN.scale), so these are hundredths of a world metre, not metres.
const BELT_LANTERN_GLOW_COLOR = 0xffc477;
const BELT_LANTERN_GLOW_LOCAL_SIZE = 0.024;
const BELT_LANTERN_GLOW_STRENGTH = 0.85;

// ---------------------------------------------------------------------------
// R1: the Silverguard Shoulders (kill-drop gear, progression/items.js's SHOULDER_SILVERGUARD_ID)
// ---------------------------------------------------------------------------
//
// Mounted the same independently-loaded-GLB, bind-pose-bone way attachSilverguardHelmet is: a
// separate file, loaded only when this child equips the piece, never baked into the hero's own merged
// atlas. TWO instances of the SAME file, one per arm -- test/glb-budget.test.mjs's own Tier 3 fixture
// prices exactly this arrangement ("shoulder_silverguard.glb, worn twice, mirrored") at one atlas and
// two primitives, which together with the helmet, sword and shield still lands the fully-equipped
// hero at exactly six draw calls, the contract's own cap. Checked BEFORE writing this, not assumed --
// see that test file.
//
// THE FIT NUMBERS are not derived here; they are read from docs/foundry/gear/tier3/fit_measured.json,
// the Meshy/Blender pipeline's own output for this exact asset (docs/foundry/gear/tier3_fit.json is
// the human-authored brief that JSON was measured against: LeftArm/RightArm bones, the right pauldron
// the SAME mesh as the left mirrored by a negative X scale rather than a second generation). That file
// already expresses `restRelativeToHeroRoot_gltfAxes` in the exact root-relative
// {position, quaternion, scale} shape matrixFromRestTransform below expects -- the same convention
// every other RIGID_* table in this file already uses -- so the numbers are copied rather than
// re-derived, per AGENTS.md's "Look before you derive": a foundry tool that already measured this
// mesh against this rig is a better source than a fresh guess.
//
// HONEST CAVEAT, because this game's own visual-acceptance rule (AGENTS.md, "running-game pixels are
// final appearance authority") means a measurement is not the same thing as a verified fit: the
// helmet's own equivalent foundry number (docs/foundry/gear/tier3_fit.json's own "helmet" entry, world
// height 0.5) was superseded once already by tools/runtime-test/fit-helmet.mjs's LIVE, in-game
// measurement (RIGID_SILVERGUARD_HELMET's own scale ended up 32.71, not the foundry pass's naive
// figure) -- because the foundry tool assumes the source mesh's own natural bounding size is exactly
// 1.0 unit, which does not always hold for a shipped export. No WebGL is available in this sandbox to
// run the equivalent live check on the shoulders (see this repo's own hard rule on that), so these
// numbers are the best available MEASURED source -- real geometry against the real rig, not a guess --
// but are pending the same live confirmation the helmet's foundry pass eventually needed. If a running-
// game capture ever shows the pauldrons floating, oversized, or clipping the head, re-solve with
// tools/runtime-test/fit-helmet.mjs's own technique (a live bind-pose measurement) rather than
// hand-tuning these numbers by eye.
export const SILVERGUARD_SHOULDER_URL = 'assets/gear/shoulder_silverguard.glb';
export const SILVERGUARD_SHOULDER_ID = 'shoulder_silverguard';

export const RIGID_SILVERGUARD_SHOULDER_BY_SIDE = Object.freeze({
  left: Object.freeze({
    boneName: 'LeftArm',
    restRelativeToHeroRoot: Object.freeze({
      position: Object.freeze([18.48353385925293, 102.73785400390625, 1.5291625261306763]),
      quaternion: Object.freeze([0, 0, 0, 1]),
      scale: Object.freeze([21, 21, 52.499996185302734]),
    }),
  }),
  // The SAME mesh as the left, mirrored by a negative scale rather than generated twice -- the
  // foundry brief's own reasoning (tier3_fit.json's "shoulderR" entry), and the reason
  // test/glb-budget.test.mjs prices this pair at one atlas.
  right: Object.freeze({
    boneName: 'RightArm',
    restRelativeToHeroRoot: Object.freeze({
      position: Object.freeze([-19.133033752441406, 103.05963897705078, 1.4613072872161865]),
      quaternion: Object.freeze([1, -0, -0, 0]),
      scale: Object.freeze([-21, -21, -52.499996185302734]),
    }),
  }),
});

/** The name the shoulders' own rigid anchors get, one per side -- distinct from the catalogue's own
 *  `shoulder_silverguard` item id (progression/items.js), which names ONE owned/equipped thing while
 *  this names TWO mounted meshes. character/weaponLoadout.js's own rigidAnchorName precedent is what
 *  every other gear anchor in this file already keys by; this is the same idea for a two-anchor item. */
export function silverguardShoulderAnchorId(side) {
  if (side !== 'left' && side !== 'right') throw new TypeError(`unknown shoulder side: ${JSON.stringify(side)}`);
  return `${SILVERGUARD_SHOULDER_ID}_${side}`;
}

/**
 * Mount one already-loaded Silverguard Shoulder root onto the hero's LeftArm or RightArm bone -- the
 * same independently-loaded-GLB, bind-pose pattern attachSilverguardHelmet uses (see its own comment
 * for the bindPoseMatrixWorld reasoning: this mount is lazy, well after the AnimationMixer's first
 * update, so reading the LIVE bone here would bake whatever pose happened to be playing into the
 * anchor permanently).
 */
export function attachSilverguardShoulder(heroRoot, shoulderRoot, side) {
  const spec = RIGID_SILVERGUARD_SHOULDER_BY_SIDE[side];
  if (!spec) throw new TypeError(`unknown shoulder side: ${JSON.stringify(side)}`);
  const rigRoot = requiredObject(heroRoot, RIG_ROOT_NAME, 'rig root');
  const bone = heroRoot.getObjectByName(spec.boneName);
  if (!bone) {
    throw new Error(`Cannot attach the Silverguard Shoulder (${side}): missing bone ${spec.boneName}.`);
  }
  if (!bone.isBone) {
    throw new Error(`Cannot attach the Silverguard Shoulder (${side}): ${spec.boneName} is not a Bone.`);
  }

  heroRoot.updateMatrixWorld(true);
  const bindMatrixWorld = bindPoseMatrixWorld(heroRoot, bone);
  const restRelativeToHeroRoot = matrixFromRestTransform(spec.restRelativeToHeroRoot);
  const world = new THREE.Matrix4().multiplyMatrices(rigRoot.matrixWorld, restRelativeToHeroRoot);
  const local = new THREE.Matrix4().copy(bindMatrixWorld).invert().multiply(world);
  const anchor = new THREE.Group();
  anchor.name = rigidAnchorName(silverguardShoulderAnchorId(side), spec.boneName);
  local.decompose(anchor.position, anchor.quaternion, anchor.scale);

  bone.add(anchor);
  anchor.add(shoulderRoot);
  return { id: silverguardShoulderAnchorId(side), anchor, bone, gear: shoulderRoot };
}

function lightTheLantern(lanternRoot) {
  const box = new THREE.Box3().setFromObject(lanternRoot);
  if (box.isEmpty()) return;
  const centre = box.getCenter(new THREE.Vector3());
  const sprite = createGlowSprite(BELT_LANTERN_GLOW_COLOR, BELT_LANTERN_GLOW_LOCAL_SIZE);
  sprite.name = 'belt-lantern-glow';
  // Local to lanternRoot, so it stays inside the housing however the hips move.
  lanternRoot.worldToLocal(centre);
  sprite.position.copy(centre);
  setGlowStrength(sprite, BELT_LANTERN_GLOW_STRENGTH);
  // The lantern is drawn on the hero's own render layer; a sprite left on layer 0 would be
  // invisible to a camera that only enables WORLD and CHARACTER.
  sprite.layers.mask = lanternRoot.layers.mask;
  lanternRoot.add(sprite);
}
