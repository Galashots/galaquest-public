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
export const RIGID_TIER2_GEAR = Object.freeze([
  Object.freeze({
    id: 'sword_ironwood',
    boneName: 'RightHand',
    restRelativeToHeroRoot: Object.freeze({
      // Carried to twelve places and normalised on purpose. Rounded to six, the quaternion is
      // 1.0000003 long, and Matrix4.decompose reads that surplus as scale -- enough to miss the
      // attachment test's 1e-6 tolerance on a magnitude-29 local scale.
      position: Object.freeze([-63.70592, 99.06745, 1.00951]),
      quaternion: Object.freeze([0.74529070327, -0.562439008148, -0.180036303612, -0.309501307129]),
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

function requiredObject(root, name, kind) {
  const object = root.getObjectByName(name);
  if (!object) {
    throw new Error(`Cannot attach Tier 2 gear: missing ${kind} ${name}.`);
  }
  return object;
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
    anchor.name = `InterimAdapter_${item.id}_${item.boneName}`;
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

  const restRelativeToHeroRoot = matrixFromRestTransform(RIGID_BELT_LANTERN.restRelativeToHeroRoot);
  const world = new THREE.Matrix4().multiplyMatrices(rigRoot.matrixWorld, restRelativeToHeroRoot);
  const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(world);
  const anchor = new THREE.Group();
  anchor.name = `InterimAdapter_${RIGID_BELT_LANTERN.id}_${RIGID_BELT_LANTERN.boneName}`;
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
    // sword_ironwood's own already-Sol-approved convention (gear.js's Tier 2 header, "THE SWORD WAS
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
    position: Object.freeze([-69.7551, 91.67212, -7.1324]),
    quaternion: Object.freeze([0.803156021057, -0.448527140425, -0.106576043911, -0.377366343235]),
    scale: Object.freeze([59.92, 59.92, 59.92]),
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
  // almost always already mid-animation. Reading bone.matrixWorld in that state bakes the DELTA
  // between bind pose and whatever pose happened to be active at mount time into the anchor's local
  // transform permanently (a rigid child inherits that error every subsequent frame) -- caught by
  // comparing this candidate's own live, pre-bake fit-tool screenshots (good) against a fresh-page
  // reload of the same baked value at the same animation time (blade floating off the hand entirely).
  //
  // The bind-pose matrixWorld is computed directly from the skeleton's own boneInverses (exactly
  // what Skeleton.pose() does internally: matrixWorld = invert(boneInverse)) rather than by calling
  // skeleton.pose() itself -- pose() OVERWRITES every bone's live position/quaternion/scale, and on
  // this rig that visibly SHRINKS the whole character (fit-sword.mjs's own header documents the
  // same ~100x glTF-inverseBindMatrix/Armature-unit collapse): confirmed directly, calling pose()
  // here made the entire hero disappear from every subsequent frame, because the animation clip has
  // no scale track to restore what pose() overwrote. Reading boneInverses instead never touches a
  // single live bone, so there is nothing to restore afterward.
  let bindMatrixWorld = bone.matrixWorld;
  let skinned = null;
  heroRoot.traverse((o) => { if (!skinned && o.isSkinnedMesh) skinned = o; });
  if (skinned) {
    const boneIndex = skinned.skeleton.bones.indexOf(bone);
    if (boneIndex !== -1) {
      bindMatrixWorld = new THREE.Matrix4().copy(skinned.skeleton.boneInverses[boneIndex]).invert();
    }
  }

  const restRelativeToHeroRoot = matrixFromRestTransform(RIGID_WILDWOOD_BLADE_CANDIDATE.restRelativeToHeroRoot);
  const world = new THREE.Matrix4().multiplyMatrices(rigRoot.matrixWorld, restRelativeToHeroRoot);
  const local = new THREE.Matrix4().copy(bindMatrixWorld).invert().multiply(world);
  const anchor = new THREE.Group();
  anchor.name = `InterimAdapter_${RIGID_WILDWOOD_BLADE_CANDIDATE.id}_${RIGID_WILDWOOD_BLADE_CANDIDATE.boneName}`;
  local.decompose(anchor.position, anchor.quaternion, anchor.scale);

  bone.add(anchor);
  anchor.add(bladeRoot);

  return { id: RIGID_WILDWOOD_BLADE_CANDIDATE.id, anchor, bone, gear: bladeRoot };
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
