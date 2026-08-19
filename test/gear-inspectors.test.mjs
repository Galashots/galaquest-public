// SR5 (CSB): public/src/character/gearInspectors.js -- the Grip Inspector, Shield Inspector, and
// Body Occupancy Envelope measurement/overlay authority (owner-plan.md sections 21-23,
// armour-progression-doctrine.md sections 5.2-5.4). three.js (public/vendor/three.module.min.js) is
// pure JS with no DOM/WebGL dependency for the Object3D/Vector3/Box3/Mesh classes this module uses,
// so it loads fine under plain Node -- these tests build a small synthetic rig (bones + a mounted
// gear anchor, the same InterimAdapter_<id>_<boneName> convention gear.js's real attach functions
// use) rather than loading the real Hero GLB, since gearInspectors.js only ever reads the live scene
// graph, never the GLB file itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.min.js';
import {
  measureGrip, measureShield, computeBodyOccupancyBox, clearOverlay, buildGripOverlay, buildShieldOverlay,
  getShippingTransform, applyTuningOverride, summarizeFitEnvelopeFrames, TUNING_TARGETS, TUNING_BOUNDS,
} from '../public/src/character/gearInspectors.js';
import { cameraPositionFor } from '../public/src/review/cameraPresets.js';

/** A minimal synthetic hero: a root, a handful of named bones at plausible relative offsets, and
 *  (optionally) a sword and/or shield mounted the exact way attachRigidTier2Gear/attachBeltLantern do
 *  it in gear.js -- an InterimAdapter_<id>_<boneName> node parented to the named bone, holding one
 *  child group whose own child is the gear mesh. */
function buildHero({
  sword = false, shield = false, boneOffsets = {}, swordId = 'sword_ironwood',
} = {}) {
  const root = new THREE.Group();
  root.name = 'hero';

  const bones = {};
  const defaults = {
    Spine: [0, 1.0, 0],
    RightForeArm: [-0.2, 1.1, 0],
    RightHand: [-0.3, 0.9, 0],
    LeftForeArm: [0.2, 1.1, 0],
    LeftHand: [0.3, 0.9, 0],
    LeftUpLeg: [0.1, 0.5, 0],
    RightUpLeg: [-0.1, 0.5, 0],
    LeftLeg: [0.1, 0.25, 0],
    RightLeg: [-0.1, 0.25, 0],
    LeftFoot: [0.1, 0, 0],
    RightFoot: [-0.1, 0, 0],
  };
  for (const [name, pos] of Object.entries({ ...defaults, ...boneOffsets })) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(...pos);
    root.add(bone);
    bones[name] = bone;
  }

  function mountGear(id, boneName, { size = [0.02, 0.4, 0.02], localOffset = [0, 0.2, 0] } = {}) {
    const anchor = new THREE.Group();
    anchor.name = `InterimAdapter_${id}_${boneName}`;
    anchor.position.set(...localOffset);
    bones[boneName].add(anchor);
    const gearGroup = new THREE.Group();
    anchor.add(gearGroup);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial());
    gearGroup.add(mesh);
    return anchor;
  }

  if (sword) mountGear(swordId, 'RightHand', { size: [0.02, 0.5, 0.02] });
  if (shield) mountGear('shield_ironwood', 'LeftHand', { size: [0.3, 0.35, 0.02] });

  root.updateMatrixWorld(true);
  return { root, bones };
}

// ── measureGrip ──────────────────────────────────────────────────────────────────────────────────

test('measureGrip returns null when no sword is mounted', () => {
  const { root } = buildHero({ sword: false });
  assert.equal(measureGrip(root), null);
});

test('measureGrip returns numeric wrist/grip/guard/tip/blade data when a sword is mounted', () => {
  const { root } = buildHero({ sword: true });
  const m = measureGrip(root);
  assert.ok(m);
  for (const key of ['wrist', 'gripPoint', 'guardCentre', 'tip', 'bladeAxis']) {
    assert.equal(m[key].length, 3, `${key} is a 3-vector`);
    assert.ok(m[key].every((n) => Number.isFinite(n)), `${key} is all finite numbers`);
  }
  assert.ok(Number.isFinite(m.pitchDeg));
  assert.ok(Number.isFinite(m.yawDeg));
  assert.ok(m.gripToWristDistance >= 0);
});

test('measureGrip.clearances.toShield is null when no shield is mounted, and numeric when one is', () => {
  const noShield = measureGrip(buildHero({ sword: true, shield: false }).root);
  const withShield = measureGrip(buildHero({ sword: true, shield: true }).root);
  assert.equal(noShield.clearances.toShield, null);
  assert.ok(Number.isFinite(withShield.clearances.toShield));
});

test('sabotage: measureGrip is not a constant -- moving the sword mount changes gripToWristDistance', () => {
  const near = measureGrip(buildHero({ sword: true }).root);
  const { root: farRoot } = buildHero({ sword: true });
  // Re-mount further from the wrist by rebuilding with a bigger localOffset via a second hero.
  const farHero = buildHero({ sword: false });
  const anchor = new THREE.Group();
  anchor.name = 'InterimAdapter_sword_ironwood_RightHand';
  anchor.position.set(0, 0.6, 0); // far from the wrist bone, unlike buildHero's own 0.2 default
  farHero.bones.RightHand.add(anchor);
  const gearGroup = new THREE.Group();
  anchor.add(gearGroup);
  gearGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.02), new THREE.MeshBasicMaterial()));
  farHero.root.updateMatrixWorld(true);
  const far = measureGrip(farHero.root);
  assert.notEqual(near.gripToWristDistance, far.gripToWristDistance);
});

test('measureGrip targets a different sword id when one is passed -- Wave 1A candidate loadout support', () => {
  const { root } = buildHero({ sword: true, swordId: 'sword_wildwood_w1a' });
  assert.equal(measureGrip(root), null, 'the default id must not find a differently-named sword');
  const m = measureGrip(root, 'sword_wildwood_w1a');
  assert.ok(m, 'passing the mounted sword\'s own id must find it');
  assert.ok(Number.isFinite(m.gripToWristDistance));
});

test('buildGripOverlay also accepts a swordId and draws the matching sword\'s markers', () => {
  const { root } = buildHero({ sword: true, swordId: 'sword_wildwood_w1a' });
  assert.equal(buildGripOverlay(root), null, 'the default id must not find a differently-named sword');
  const group = buildGripOverlay(root, 'sword_wildwood_w1a');
  assert.ok(group, 'passing the mounted sword\'s own id must draw its overlay');
});

// ── measureShield ────────────────────────────────────────────────────────────────────────────────

test('measureShield returns null when no shield is mounted', () => {
  const { root } = buildHero({ shield: false });
  assert.equal(measureShield(root), null);
});

test('measureShield returns numeric wrist/elbow/forearmAxis/shieldCentre/faceNormal/longAxis data', () => {
  const { root } = buildHero({ shield: true });
  const m = measureShield(root);
  assert.ok(m);
  for (const key of ['wrist', 'elbow', 'forearmAxis', 'shieldCentre', 'faceNormal', 'longAxis', 'outwardReference']) {
    assert.equal(m[key].length, 3);
    assert.ok(m[key].every((n) => Number.isFinite(n)));
  }
  assert.ok(Number.isFinite(m.longAxisAlignment));
  assert.ok(Number.isFinite(m.palmSideDot));
  assert.ok(Number.isFinite(m.gameplayCameraReadability));
  assert.ok(Number.isFinite(m.handOffset.alongForearm));
  assert.ok(Number.isFinite(m.handOffset.perpendicular));
});

test('measureShield.longAxisAlignment reads the REAL baked anchor orientation, not a placeholder', () => {
  // Deliberately rotate the anchor so its local +Y points exactly along the forearm axis (elbow ->
  // wrist), the same "bake the alignment into the anchor's own quaternion" convention fit-shield.mjs
  // uses -- longAxisAlignment should then read back ~1. Rotating it 90 degrees off that axis should
  // read back ~0. Two genuinely different bakes producing two genuinely different numbers is the
  // actual thing worth proving here, not a fixed sign this synthetic fixture would have to guess.
  const { root, bones } = buildHero({ shield: true });
  const anchor = root.getObjectByName('InterimAdapter_shield_ironwood_LeftHand');
  const forearmAxis = bones.LeftHand.position.clone().sub(bones.LeftForeArm.position).normalize();
  anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forearmAxis);
  root.updateMatrixWorld(true);
  const aligned = measureShield(root);
  assert.ok(aligned.longAxisAlignment > 0.99, `expected near-perfect alignment, got ${aligned.longAxisAlignment}`);

  const perpendicular = forearmAxis.x !== 0 || forearmAxis.z !== 0
    ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), perpendicular);
  root.updateMatrixWorld(true);
  const rotated = measureShield(root);
  assert.ok(Math.abs(rotated.longAxisAlignment) < 0.2, `expected near-zero alignment, got ${rotated.longAxisAlignment}`);
});

// ── computeBodyOccupancyBox ──────────────────────────────────────────────────────────────────────

test('computeBodyOccupancyBox returns a min/max box covering the bones', () => {
  const { root } = buildHero({});
  const box = computeBodyOccupancyBox(root);
  assert.ok(box);
  assert.equal(box.min.length, 3);
  assert.equal(box.max.length, 3);
  for (let i = 0; i < 3; i += 1) assert.ok(box.min[i] < box.max[i]);
});

test('computeBodyOccupancyBox excludes mounted gear -- a huge sword does not inflate the body box', () => {
  const { root: bare } = buildHero({ sword: false });
  const { root: armed } = buildHero({ sword: true });
  // Blow the sword mesh WAY out (bigger than any bone spread) to prove it would obviously move the
  // box if it were counted.
  armed.getObjectByName('InterimAdapter_sword_ironwood_RightHand').position.set(0, 50, 0);
  armed.updateMatrixWorld(true);
  const bareBox = computeBodyOccupancyBox(bare);
  const armedBox = computeBodyOccupancyBox(armed);
  assert.deepEqual(bareBox, armedBox);
});

test('sabotage: computeBodyOccupancyBox is not a constant -- a genuinely different pose produces a different box (regression guard for the bind-pose bug fixed 2026-08-16)', () => {
  // This is the exact defect Box3.expandByObject() had: it reads a SkinnedMesh's BIND-POSE vertex
  // positions (skinning happens on the GPU, not through matrixWorld), so it reported an IDENTICAL
  // box across every animation frame regardless of pose. Fixed by building the box from bone WORLD
  // positions instead, which genuinely update with the pose. Moving a single bone here stands in for
  // "a different animation frame" -- both change bone world transforms the same way.
  const idlePose = buildHero({});
  const extendedPose = buildHero({ boneOffsets: { RightHand: [-0.3, 0.9, 0.6] } }); // arm swung forward
  const idleBox = computeBodyOccupancyBox(idlePose.root);
  const extendedBox = computeBodyOccupancyBox(extendedPose.root);
  assert.notDeepEqual(idleBox, extendedBox);
});

// ── overlays ─────────────────────────────────────────────────────────────────────────────────────

test('buildGripOverlay returns null when nothing is mounted, a group when a sword is', () => {
  assert.equal(buildGripOverlay(buildHero({ sword: false }).root), null);
  const group = buildGripOverlay(buildHero({ sword: true }).root);
  assert.ok(group);
  assert.equal(group.name, 'gear-inspector-overlay');
  assert.ok(group.children.length > 0);
});

test('buildShieldOverlay returns null when nothing is mounted, a group when a shield is', () => {
  assert.equal(buildShieldOverlay(buildHero({ shield: false }).root), null);
  const group = buildShieldOverlay(buildHero({ shield: true }).root);
  assert.ok(group);
  assert.equal(group.name, 'gear-inspector-overlay');
  assert.ok(group.children.length > 0);
});

test('clearOverlay removes a previously-added overlay group from a scene', () => {
  const scene = new THREE.Scene();
  const group = buildGripOverlay(buildHero({ sword: true }).root);
  scene.add(group);
  assert.ok(scene.getObjectByName('gear-inspector-overlay'));
  clearOverlay(scene);
  assert.equal(scene.getObjectByName('gear-inspector-overlay'), undefined);
});

test('clearOverlay on a scene with no overlay is a harmless no-op', () => {
  const scene = new THREE.Scene();
  assert.doesNotThrow(() => clearOverlay(scene));
});

// ── SR5 closeout: shield camera semantics fix ───────────────────────────────────────────────────

test('measureShield.gameplayCameraFacingDot/gameplayCameraReadability read the GAMEPLAY camera, not inspection (regression guard for the bug Sol\'s audit caught 2026-08-16)', () => {
  const { root } = buildHero({ shield: true });
  const anchor = root.getObjectByName('InterimAdapter_shield_ironwood_LeftHand');
  anchor.quaternion.identity(); // local +Z (face normal) == world (0,0,1) exactly, easy to reason about
  root.updateMatrixWorld(true);

  const m = measureShield(root);
  const shieldCentre = new THREE.Vector3(...m.shieldCentre);
  const faceNormal = new THREE.Vector3(0, 0, 1);

  const gameplayCamera = new THREE.Vector3(...cameraPositionFor('gameplay', 'front', 0.9));
  const inspectionCamera = new THREE.Vector3(...cameraPositionFor('inspection', 'front', 0.9));
  const expectedGameplayDot = faceNormal.dot(gameplayCamera.clone().sub(shieldCentre).normalize());
  const expectedInspectionDot = faceNormal.dot(inspectionCamera.clone().sub(shieldCentre).normalize());

  assert.ok(Math.abs(expectedGameplayDot - expectedInspectionDot) > 1e-4,
    'fixture sanity: the two camera presets must actually produce measurably different directions here');
  assert.ok(Math.abs(m.gameplayCameraFacingDot - expectedGameplayDot) < 1e-9,
    `expected the gameplay-camera dot ${expectedGameplayDot}, got ${m.gameplayCameraFacingDot}`);
  assert.ok(Math.abs(m.gameplayCameraFacingDot - expectedInspectionDot) > 1e-4,
    'measureShield must not still be reading the inspection camera');
});

test('gameplayCameraReadability is abs(gameplayCameraFacingDot) -- 0 edge-on, 1 face-on, unsigned', () => {
  const { root } = buildHero({ shield: true });
  const anchor = root.getObjectByName('InterimAdapter_shield_ironwood_LeftHand');
  // Face the shield's normal directly AWAY from the gameplay camera -- facingDot should go negative,
  // readability should still read its magnitude (positive).
  anchor.quaternion.setFromEuler(new THREE.Euler(0, Math.PI, 0));
  root.updateMatrixWorld(true);
  const m = measureShield(root);
  assert.ok(m.gameplayCameraFacingDot < 0, `expected a negative facing dot, got ${m.gameplayCameraFacingDot}`);
  assert.ok(Math.abs(m.gameplayCameraReadability - Math.abs(m.gameplayCameraFacingDot)) < 1e-9);
  assert.ok(m.gameplayCameraReadability >= 0);
});

test('palmSideDot stays a separate body-outwardness measure, independent of the camera fix', () => {
  const { root } = buildHero({ shield: true });
  const m = measureShield(root);
  assert.ok(Number.isFinite(m.palmSideDot));
  assert.notEqual(m.palmSideDot, m.gameplayCameraReadability);
});

// ── SR5 closeout: non-destructive typed tuning override ────────────────────────────────────────

test('getShippingTransform returns null for a target that is not mounted', () => {
  const { root } = buildHero({ sword: false });
  assert.equal(getShippingTransform(root, 'sword'), null);
});

test('getShippingTransform returns null for a target outside TUNING_TARGETS', () => {
  const { root } = buildHero({ sword: true });
  assert.equal(getShippingTransform(root, 'helmet'), null);
  assert.deepEqual(TUNING_TARGETS, ['sword', 'shield']);
});

test('applyTuningOverride(target, null) renders the pristine shipping transform with no delta', () => {
  const { root } = buildHero({ sword: true });
  const shipping = getShippingTransform(root, 'sword');
  const result = applyTuningOverride(root, 'sword', null);
  assert.deepEqual(result.shippingTransform, shipping);
  assert.equal(result.tuningOverride, null);
  assert.deepEqual(result.effectiveTransform, shipping);
});

test('applyTuningOverride composes a position delta ON TOP of the shipping position, not in place of it', () => {
  const { root } = buildHero({ sword: true });
  const shipping = getShippingTransform(root, 'sword');
  const result = applyTuningOverride(root, 'sword', { positionDelta: [0.05, -0.02, 0] });
  assert.deepEqual(result.tuningOverride.positionDelta, [0.05, -0.02, 0]);
  assert.ok(Math.abs(result.effectiveTransform.position[0] - (shipping.position[0] + 0.05)) < 1e-9);
  assert.ok(Math.abs(result.effectiveTransform.position[1] - (shipping.position[1] - 0.02)) < 1e-9);
  assert.ok(Math.abs(result.effectiveTransform.position[2] - shipping.position[2]) < 1e-9);
});

test('applyTuningOverride clamps each component independently to TUNING_BOUNDS rather than rejecting the request', () => {
  const { root } = buildHero({ sword: true });
  const result = applyTuningOverride(root, 'sword', {
    positionDelta: [10, -10, 0.1],
    rotationDeltaDeg: [500, -500, 10],
    scaleDelta: 50,
  });
  assert.deepEqual(result.tuningOverride.positionDelta, [
    TUNING_BOUNDS.positionDeltaMeters, -TUNING_BOUNDS.positionDeltaMeters, 0.1,
  ]);
  assert.deepEqual(result.tuningOverride.rotationDeltaDeg, [
    TUNING_BOUNDS.rotationDeltaDegrees, -TUNING_BOUNDS.rotationDeltaDegrees, 10,
  ]);
  assert.equal(result.tuningOverride.scaleDelta, TUNING_BOUNDS.scaleDelta);
});

test('the shipping baseline is captured ONCE and survives repeated overrides -- it never drifts to a previously-overridden transform', () => {
  const { root } = buildHero({ sword: true });
  const shipping = getShippingTransform(root, 'sword');
  applyTuningOverride(root, 'sword', { positionDelta: [0.1, 0, 0] });
  applyTuningOverride(root, 'sword', { positionDelta: [-0.1, 0.2, 0] });
  const stillShipping = getShippingTransform(root, 'sword');
  assert.deepEqual(stillShipping, shipping);
});

test('resetting after an override (override then null) returns the anchor exactly to the shipping transform', () => {
  const { root } = buildHero({ sword: true });
  const shipping = getShippingTransform(root, 'sword');
  applyTuningOverride(root, 'sword', { positionDelta: [0.1, 0.1, 0.1], rotationDeltaDeg: [10, 10, 10] });
  const reset = applyTuningOverride(root, 'sword', null);
  assert.deepEqual(reset.effectiveTransform, shipping);
});

test('applyTuningOverride returns null when the target is not mounted, and does not throw', () => {
  const { root } = buildHero({ sword: false });
  assert.equal(applyTuningOverride(root, 'sword', { positionDelta: [0.1, 0, 0] }), null);
});

test('sabotage: applyTuningOverride is not a constant -- two different overrides produce two different effective transforms', () => {
  const a = applyTuningOverride(buildHero({ sword: true }).root, 'sword', { positionDelta: [0.05, 0, 0] });
  const b = applyTuningOverride(buildHero({ sword: true }).root, 'sword', { positionDelta: [-0.05, 0, 0] });
  assert.notDeepEqual(a.effectiveTransform, b.effectiveTransform);
});

// ── SR5 closeout: Fit Envelope per-clip numeric summary ────────────────────────────────────────

const SUMMARY_FIXTURE_FRAMES = [
  {
    t: 0,
    grip: { gripToWristDistance: 0.1, clearances: { toOwnForearm: 0.2, toNearestThigh: 0.3, toTorso: 0.4, toShield: 0.5 } },
    shield: { clearances: { toHand: 0.05, toElbow: 0.15, toTorso: 0.25 }, palmSideDot: 0.8, gameplayCameraReadability: 0.9 },
    boe: { min: [-0.2, 0, -0.1], max: [0.2, 1.5, 0.1] },
  },
  {
    t: 1,
    grip: { gripToWristDistance: 0.05, clearances: { toOwnForearm: 0.1, toNearestThigh: 0.35, toTorso: 0.2, toShield: 0.6 } },
    shield: { clearances: { toHand: 0.06, toElbow: 0.1, toTorso: 0.3 }, palmSideDot: 0.3, gameplayCameraReadability: 0.4 },
    boe: { min: [-0.4, 0, -0.15], max: [0.5, 1.6, 0.2] },
  },
];

test('summarizeFitEnvelopeFrames returns null for an empty frame list', () => {
  assert.equal(summarizeFitEnvelopeFrames([]), null);
  assert.equal(summarizeFitEnvelopeFrames(null), null);
});

test('summarizeFitEnvelopeFrames aggregates BOE width/height/depth min/max from the frames', () => {
  const s = summarizeFitEnvelopeFrames(SUMMARY_FIXTURE_FRAMES);
  assert.deepEqual(s.boe.width, { min: 0.4, max: 0.9 });
  assert.deepEqual(s.boe.height, { min: 1.5, max: 1.6 });
  assert.ok(Math.abs(s.boe.depth.min - 0.2) < 1e-9);
  assert.ok(Math.abs(s.boe.depth.max - 0.35) < 1e-9);
});

test('summarizeFitEnvelopeFrames reports the minimum sword/shield clearance PLUS the timestamp it occurred at', () => {
  const s = summarizeFitEnvelopeFrames(SUMMARY_FIXTURE_FRAMES);
  assert.deepEqual(s.minSwordClearance.toOwnForearm, { value: 0.1, t: 1 });
  assert.deepEqual(s.minSwordClearance.toNearestThigh, { value: 0.3, t: 0 });
  assert.deepEqual(s.minShieldClearance.toHand, { value: 0.05, t: 0 });
  assert.deepEqual(s.minShieldClearance.toElbow, { value: 0.1, t: 1 });
});

test('summarizeFitEnvelopeFrames reports grip-seating min/max and shield outwardness/readability extrema with timestamps', () => {
  const s = summarizeFitEnvelopeFrames(SUMMARY_FIXTURE_FRAMES);
  assert.deepEqual(s.gripSeating, { min: 0.05, max: 0.1 });
  assert.deepEqual(s.shieldOutwardness.palmSideDot.min, { value: 0.3, t: 1 });
  assert.deepEqual(s.shieldOutwardness.palmSideDot.max, { value: 0.8, t: 0 });
  assert.deepEqual(s.shieldOutwardness.gameplayCameraReadability.min, { value: 0.4, t: 1 });
  assert.deepEqual(s.shieldOutwardness.gameplayCameraReadability.max, { value: 0.9, t: 0 });
});

test('summarizeFitEnvelopeFrames degrades gracefully when grip/shield are null on every frame (gear not mounted)', () => {
  const framesNoGear = SUMMARY_FIXTURE_FRAMES.map((f) => ({ t: f.t, grip: null, shield: null, boe: f.boe }));
  const s = summarizeFitEnvelopeFrames(framesNoGear);
  assert.equal(s.minSwordClearance.toOwnForearm, null);
  assert.equal(s.minShieldClearance.toHand, null);
  assert.equal(s.gripSeating, null);
  assert.ok(s.boe.width, 'BOE itself is independent of grip/shield and must still be reported');
});

test('sabotage: summarizeFitEnvelopeFrames is not a constant -- a genuinely different frame set produces a different summary', () => {
  const a = summarizeFitEnvelopeFrames(SUMMARY_FIXTURE_FRAMES);
  const shifted = SUMMARY_FIXTURE_FRAMES.map((f) => ({ ...f, boe: { min: f.boe.min, max: [f.boe.max[0] + 5, f.boe.max[1], f.boe.max[2]] } }));
  const b = summarizeFitEnvelopeFrames(shifted);
  assert.notDeepEqual(a.boe.width, b.boe.width);
});
