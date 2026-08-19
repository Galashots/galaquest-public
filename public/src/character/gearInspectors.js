/**
 * SR5 Grip Inspector + Shield Inspector + Fit Envelope (CSB, owner-plan.md sections 21-23,
 * armour-progression-doctrine.md sections 5.2-5.4).
 *
 * Every technique here is the SAME one `tools/runtime-test/fit-sword.mjs`/`fit-shield.mjs`/
 * `fit-carry.mjs` already proved against the live game -- this module does not invent a second
 * definition of "blade axis" or "shield plane", it MEASURES the anchors those harnesses baked:
 *   - blade axis: the gear mesh's own longest local bounding-box dimension, pushed through its
 *     world quaternion (fit-sword.mjs's own method).
 *   - shield plane: local Y = the anchor's own "up the forearm" axis, local Z = the anchor's own
 *     "away from the body" face axis (fit-shield.mjs bakes exactly this basis into the anchor's
 *     quaternion; reading it back is the measurement).
 *   - character axes: hero root world quaternion applied to (1,0,0)/(0,0,1)/(0,1,0) -- the same
 *     charLeft/charFwd/up convention every fit-*.mjs harness already uses.
 *
 * Everything below REPORTS numbers. Per owner-plan.md section 23 and doctrine section 5.5, this file
 * never turns a measurement into an automatic pass/fail verdict or picks a tuning value -- that
 * judgment stays with Sol/the owner, looking at the numbers and the overlay screenshots together.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { cameraPositionFor } from '../review/cameraPresets.js';

const DEG = 180 / Math.PI;

function heroAxes(hero) {
  hero.updateMatrixWorld(true);
  const heroQ = new THREE.Quaternion();
  hero.getWorldQuaternion(heroQ);
  return {
    left: new THREE.Vector3(1, 0, 0).applyQuaternion(heroQ),
    fwd: new THREE.Vector3(0, 0, 1).applyQuaternion(heroQ),
    up: new THREE.Vector3(0, 1, 0),
  };
}

function bonePos(hero, name) {
  const bone = hero.getObjectByName(name);
  if (!bone) return null;
  const p = new THREE.Vector3();
  bone.getWorldPosition(p);
  return p;
}

/** The exact anchor-naming convention gear.js's attachRigidTier2Gear/attachBeltLantern use. */
function anchorFor(hero, id, boneName) {
  return hero.getObjectByName(`InterimAdapter_${id}_${boneName}`);
}

function firstMesh(object) {
  let mesh = null;
  object.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
  return mesh;
}

/** True if `object` sits under any `InterimAdapter_*` anchor -- i.e. it is mounted gear, not body. */
function isMountedGear(object) {
  for (let o = object; o; o = o.parent) {
    if (o.name && o.name.startsWith('InterimAdapter_')) return true;
  }
  return false;
}

/**
 * The gear mesh's longest local bounding-box axis, in world space -- fit-sword.mjs's own technique,
 * reused verbatim, plus the two world-space bounding-box extremes along that axis (needed to tell
 * guard from tip, which fit-sword.mjs itself never had to do because it only ever SET the axis).
 */
function longestAxisWorld(mesh) {
  const geo = mesh.geometry;
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox.getSize(size);
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const dims = [size.x, size.y, size.z];
  const longest = dims.indexOf(Math.max(...dims));
  const localCentre = new THREE.Vector3();
  geo.boundingBox.getCenter(localCentre);
  const sign = Math.sign(localCentre.getComponent(longest)) || 1;
  const meshQ = new THREE.Quaternion();
  mesh.getWorldQuaternion(meshQ);
  const axisWorld = axes[longest].clone().multiplyScalar(sign).applyQuaternion(meshQ).normalize();

  const corners = [];
  for (const x of [geo.boundingBox.min.x, geo.boundingBox.max.x]) {
    for (const y of [geo.boundingBox.min.y, geo.boundingBox.max.y]) {
      for (const z of [geo.boundingBox.min.z, geo.boundingBox.max.z]) {
        corners.push(new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld));
      }
    }
  }
  const centreWorld = localCentre.clone().applyMatrix4(mesh.matrixWorld);
  let minT = Infinity; let maxT = -Infinity; let minPoint = null; let maxPoint = null;
  for (const c of corners) {
    const t = c.clone().sub(centreWorld).dot(axisWorld);
    if (t < minT) { minT = t; minPoint = c; }
    if (t > maxT) { maxT = t; maxPoint = c; }
  }
  return {
    axis: axisWorld, centre: centreWorld, ends: [minPoint, maxPoint],
  };
}

/** Distance from point `p` to the segment [a, b] -- the honest "clearance" primitive every check
 *  below uses. Not a mesh-collision solver (doctrine section 3.3: do not build one); a landmark-to-
 *  segment distance is exactly the kind of reported number doctrine section 5.4/5.5 asks for. */
function pointToSegmentDistance(p, a, b) {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
  const closest = a.clone().addScaledVector(ab, t);
  return p.distanceTo(closest);
}

const v3 = (v) => [v.x, v.y, v.z];

/**
 * Grip Inspector (doctrine section 5.2). Measures the CURRENTLY MOUNTED sword against the wrist and
 * the character's own body -- does not solve or suggest a fit, only reports what is actually there.
 * Returns null if the sword isn't mounted (e.g. a non-'shipping' loadout with no sword).
 *
 * `swordId` defaults to the shipping sword so every existing caller is unaffected; a Studio loadout
 * mounting a different sword under the same RightHand-anchor convention (e.g. a Wildwood Blade
 * candidate, scene.js's 'candidate-wildwood-blade') passes its own id instead of a second function.
 */
export function measureGrip(hero, swordId = 'sword_ironwood') {
  const anchor = anchorFor(hero, swordId, 'RightHand');
  if (!anchor) return null;
  const gear = anchor.children[0];
  const mesh = gear && firstMesh(gear);
  if (!mesh) return null;
  hero.updateMatrixWorld(true);

  const wrist = bonePos(hero, 'RightHand');
  const gripPoint = new THREE.Vector3();
  anchor.getWorldPosition(gripPoint);

  const { axis: bladeAxis, ends } = longestAxisWorld(mesh);
  const [end0, end1] = ends;
  // The end nearer the grip is the guard; the far end is the tip -- geometry, not a guess.
  const guardIsEnd0 = gripPoint.distanceTo(end0) <= gripPoint.distanceTo(end1);
  const guardCentre = guardIsEnd0 ? end0 : end1;
  const tip = guardIsEnd0 ? end1 : end0;

  const { left, fwd, up } = heroAxes(hero);
  // Pitch: degrees the blade tips below horizontal (fit-sword.mjs's own convention, read back not set).
  const bladeDown = tip.clone().sub(guardCentre).normalize();
  const pitchDeg = Math.asin(Math.max(-1, Math.min(1, -bladeDown.dot(up)))) * DEG;
  const horiz = bladeDown.clone().addScaledVector(up, -bladeDown.dot(up));
  const yawDeg = horiz.lengthSq() > 1e-9
    ? Math.atan2(-horiz.clone().normalize().dot(left), horiz.clone().normalize().dot(fwd)) * DEG
    : 0;

  const leftUpLeg = bonePos(hero, 'LeftUpLeg');
  const rightUpLeg = bonePos(hero, 'RightUpLeg');
  const leftLeg = bonePos(hero, 'LeftLeg');
  const rightLeg = bonePos(hero, 'RightLeg');
  const leftFoot = bonePos(hero, 'LeftFoot');
  const rightFoot = bonePos(hero, 'RightFoot');
  const spine = bonePos(hero, 'Spine');
  const rightForeArm = bonePos(hero, 'RightForeArm');
  const shieldAnchor = anchorFor(hero, 'shield_ironwood', 'LeftHand');
  const shieldCentre = shieldAnchor ? (() => {
    const p = new THREE.Vector3(); shieldAnchor.getWorldPosition(p); return p;
  })() : null;

  const clearances = {
    // "hand/forearm... clearance": does the blade re-cross its own sword-arm's forearm.
    toOwnForearm: rightForeArm ? pointToSegmentDistance(rightForeArm, guardCentre, tip) : null,
    toNearestThigh: (leftUpLeg && rightUpLeg)
      ? Math.min(pointToSegmentDistance(leftUpLeg, guardCentre, tip), pointToSegmentDistance(rightUpLeg, guardCentre, tip))
      : null,
    toTorso: spine ? pointToSegmentDistance(spine, guardCentre, tip) : null,
    toShield: shieldCentre ? pointToSegmentDistance(shieldCentre, guardCentre, tip) : null,
  };

  return {
    wrist: v3(wrist),
    gripPoint: v3(gripPoint),
    guardCentre: v3(guardCentre),
    tip: v3(tip),
    bladeAxis: v3(bladeDown),
    pitchDeg,
    yawDeg,
    // "grip seating relative to wrist/fist": distance from the wrist bone to where the weapon is
    // actually gripped. Small = seated in the fist; large = floating off the hand (the exact defect
    // gear.js's own header documents finding and fixing at 0.172 m on 2026-08-14).
    gripToWristDistance: gripPoint.distanceTo(wrist),
    tipToNearestKnee: (leftLeg && rightLeg) ? Math.min(tip.distanceTo(leftLeg), tip.distanceTo(rightLeg)) : null,
    tipToNearestFoot: (leftFoot && rightFoot) ? Math.min(tip.distanceTo(leftFoot), tip.distanceTo(rightFoot)) : null,
    clearances,
  };
}

/**
 * Shield Inspector (doctrine section 5.3). Reads back the CURRENTLY MOUNTED shield's actual
 * orientation (the anchor's own world quaternion, exactly as fit-shield.mjs baked it) rather than
 * re-deriving an ideal -- this is a measurement of what shipped, not a second opinion on what it
 * should be.
 */
export function measureShield(hero) {
  const anchor = anchorFor(hero, 'shield_ironwood', 'LeftHand');
  if (!anchor) return null;
  const gear = anchor.children[0];
  const mesh = gear && firstMesh(gear);
  if (!mesh) return null;
  hero.updateMatrixWorld(true);

  const wrist = bonePos(hero, 'LeftHand');
  const elbow = bonePos(hero, 'LeftForeArm');
  const forearmAxis = wrist.clone().sub(elbow).normalize(); // fit-shield.mjs's own "up the arm" axis

  const anchorPos = new THREE.Vector3();
  anchor.getWorldPosition(anchorPos);
  const geo = mesh.geometry;
  geo.computeBoundingBox();
  const localCentre = new THREE.Vector3();
  geo.boundingBox.getCenter(localCentre);
  const shieldCentre = localCentre.clone().applyMatrix4(mesh.matrixWorld);

  // fit-shield.mjs bakes local +Y = "up the forearm", local +Z = "away from the body" into the
  // anchor's own quaternion (makeBasis(xA, yA, zA)) -- reading those back off the anchor IS the
  // measurement of the actual current mount, not a re-derivation of an ideal.
  const anchorQ = new THREE.Quaternion();
  anchor.getWorldQuaternion(anchorQ);
  const actualLongAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(anchorQ).normalize();
  const actualFaceNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(anchorQ).normalize();

  const { left: charLeft } = heroAxes(hero);
  // Structural reference direction ("outside of forearm, no roll") -- geometry, not a tuning target:
  // needed to tell which SIDE "away from the body" is, the same way fit-shield.mjs derives it before
  // applying its own --roll parameter on top.
  const outwardReference = charLeft.clone()
    .addScaledVector(forearmAxis, -charLeft.dot(forearmAxis)).normalize();

  const spine = bonePos(hero, 'Spine');
  // Sol's SR5 closeout audit (2026-08-16): this previously read 'inspection' here, silently scoring
  // readability against the wrong camera -- the field's own name promises the GAMEPLAY view. Fixed to
  // the real gameplay/front preset (cameraPresets.js's GAMEPLAY_DISTANCE, not INSPECTION_DISTANCE).
  const [camX, camY, camZ] = cameraPositionFor('gameplay', 'front', 0.9);
  const cameraDirection = new THREE.Vector3(camX, camY, camZ).sub(shieldCentre).normalize();

  return {
    wrist: v3(wrist),
    elbow: v3(elbow),
    forearmAxis: v3(forearmAxis),
    shieldCentre: v3(shieldCentre),
    faceNormal: v3(actualFaceNormal),
    longAxis: v3(actualLongAxis),
    outwardReference: v3(outwardReference),
    clearances: {
      toHand: wrist.distanceTo(shieldCentre),
      toElbow: elbow.distanceTo(shieldCentre),
      toTorso: spine ? spine.distanceTo(shieldCentre) : null,
    },
    // Positive = the shield's own long axis tracks the forearm (mounted along the arm, as intended).
    longAxisAlignment: actualLongAxis.dot(forearmAxis),
    // Positive = the face points away from the body as intended; near zero/negative = palm-side or
    // pointed back toward the character (doctrine 5.3's "shield on palm side" failure).
    palmSideDot: actualFaceNormal.dot(outwardReference),
    // Signed dot(face normal, direction toward the SAME camera a 'gameplay'/'front' capture uses).
    // Positive = the face points toward that camera; negative = it points away (the shield's back is
    // toward the viewer even though it may still be "readable" as a silhouette edge). Kept separate
    // from the unsigned readability score below because the sign carries real information
    // palmSideDot alone does not (palmSideDot is about the character's OWN body, not the camera).
    gameplayCameraFacingDot: actualFaceNormal.dot(cameraDirection),
    // abs(gameplayCameraFacingDot): 0 = fully edge-on (unreadable silhouette), 1 = fully face-on
    // (doctrine 5.3's "shield face edge-on" failure). Deliberately unsigned -- readability from a
    // fixed gameplay camera does not care which side of the shield is facing it, only how much face
    // is visible; palmSideDot (below) is the separate measure of which side that actually is.
    gameplayCameraReadability: Math.abs(actualFaceNormal.dot(cameraDirection)),
    // How far the shield sits off the arm's own line vs along it -- large perpendicular offset with a
    // small along-arm offset is an outside-of-forearm mount; near-zero perpendicular offset close to
    // the hand looks like the shield is gripped IN the fist instead (doctrine 5.3's other failure).
    handOffset: (() => {
      const rel = shieldCentre.clone().sub(wrist);
      const along = rel.dot(forearmAxis);
      const perp = Math.sqrt(Math.max(0, rel.lengthSq() - along * along));
      return { alongForearm: along, perpendicular: perp };
    })(),
  };
}

// ── tuning override (SR5 closeout, owner-plan.md's "non-destructive typed tuning override") ───────
// A small, allow-listed Studio-only surface to test a DELIBERATE temporary delta against the real
// shipping mount, for comparison -- not a second fit solver, and never a persistent one: every call
// re-derives from the anchor's own captured shipping baseline, and a request that omits an override
// leaves that baseline untouched. Sol picks the numbers and judges the result; this file only ever
// applies and reports them.

export const TUNING_TARGETS = Object.freeze(['sword', 'shield']);

// Sensible hard numeric bounds on the OVERRIDE INPUT -- a safety rail against a malformed or extreme
// request putting the gear somewhere meaningless, not a chosen tuning value (doctrine 5.5/owner-plan
// section 23: Claude never picks the final number, Sol does). Mirrored in
// sol-review/request.schema.json's tuningOverride field; a regression test pins the two together.
export const TUNING_BOUNDS = Object.freeze({
  positionDeltaMeters: 0.3,
  rotationDeltaDegrees: 90,
  scaleDelta: 0.5, // fractional -- effective scale = shipping scale * (1 + scaleDelta), so +/-0.5 = [0.5x, 1.5x]
});

const TUNING_ANCHOR_IDS = Object.freeze({
  sword: Object.freeze(['sword_ironwood', 'RightHand']),
  shield: Object.freeze(['shield_ironwood', 'LeftHand']),
});

function tuningAnchorFor(hero, target) {
  const spec = TUNING_ANCHOR_IDS[target];
  if (!spec) return null;
  return anchorFor(hero, spec[0], spec[1]);
}

/** Captures the anchor's CURRENT local transform into its own userData, once -- the first time this
 *  runs in a given page's lifetime, that current transform IS the pristine shipping mount (nothing
 *  has touched it yet), so every later call in the SAME page reuses that snapshot rather than
 *  re-reading a possibly-already-overridden live transform. */
function captureShippingTransform(anchor) {
  if (!anchor.userData.shippingLocalPosition) {
    anchor.userData.shippingLocalPosition = anchor.position.clone();
    anchor.userData.shippingLocalQuaternion = anchor.quaternion.clone();
    anchor.userData.shippingLocalScale = anchor.scale.clone();
  }
}

function clamp(value, bound) {
  return Math.max(-bound, Math.min(bound, value));
}

function transformOut(position, quaternion, scale) {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: v3(position),
    rotationDeg: [euler.x * DEG, euler.y * DEG, euler.z * DEG],
    scale: scale.x,
  };
}

/** The anchor's pristine shipping-mount local transform (position/rotation/uniform scale), captured
 *  once per page and never mutated by an override -- what a request WITHOUT a tuningOverride always
 *  renders. Returns null if `target` isn't mounted (e.g. the wrong loadout, or an unknown target). */
export function getShippingTransform(hero, target) {
  const anchor = tuningAnchorFor(hero, target);
  if (!anchor) return null;
  captureShippingTransform(anchor);
  return transformOut(anchor.userData.shippingLocalPosition, anchor.userData.shippingLocalQuaternion, anchor.userData.shippingLocalScale);
}

/**
 * Applies (or clears) a temporary local-space delta to `target`'s mount anchor, ALWAYS composed on
 * top of the captured shipping baseline -- never on top of whatever the anchor's live transform
 * happens to already be, so repeated calls in the same page never accumulate. `override` is
 * `{ positionDelta?: [x,y,z], rotationDeltaDeg?: [x,y,z], scaleDelta?: number }`; each component is
 * clamped to `TUNING_BOUNDS` independently, not rejected -- the caller can read the clamped values
 * back out of the returned `tuningOverride` to see exactly what was actually applied. Passing
 * `override` as `null`/`undefined` resets the anchor to the pristine shipping transform.
 *
 * Rotation composition: `effectiveQuaternion = shippingQuaternion.multiply(deltaQuaternion)` (three.js
 * `Quaternion.multiply` -- the delta is applied in the anchor's OWN local frame, after its shipping
 * orientation, not in world space). Reported back as `effectiveTransform` either way, so the exact
 * composition convention never has to be reasoned about separately from what the render shows.
 *
 * Returns null if `target` isn't mounted. Never writes to any production file, never accepts a path,
 * expression, or code string -- only the three bounded numeric fields above.
 */
export function applyTuningOverride(hero, target, override) {
  const anchor = tuningAnchorFor(hero, target);
  if (!anchor) return null;
  captureShippingTransform(anchor);
  const basePos = anchor.userData.shippingLocalPosition;
  const baseQuat = anchor.userData.shippingLocalQuaternion;
  const baseScale = anchor.userData.shippingLocalScale;
  const shippingTransform = transformOut(basePos, baseQuat, baseScale);

  if (!override) {
    anchor.position.copy(basePos);
    anchor.quaternion.copy(baseQuat);
    anchor.scale.copy(baseScale);
    anchor.updateMatrixWorld(true);
    return { shippingTransform, tuningOverride: null, effectiveTransform: shippingTransform };
  }

  const positionDelta = (override.positionDelta ?? [0, 0, 0]).map((v) => clamp(v, TUNING_BOUNDS.positionDeltaMeters));
  const rotationDeltaDeg = (override.rotationDeltaDeg ?? [0, 0, 0]).map((v) => clamp(v, TUNING_BOUNDS.rotationDeltaDegrees));
  const scaleDelta = clamp(override.scaleDelta ?? 0, TUNING_BOUNDS.scaleDelta);

  const effectivePosition = basePos.clone().add(new THREE.Vector3(...positionDelta));
  const deltaQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    rotationDeltaDeg[0] / DEG, rotationDeltaDeg[1] / DEG, rotationDeltaDeg[2] / DEG, 'XYZ',
  ));
  const effectiveQuaternion = baseQuat.clone().multiply(deltaQuaternion);
  const effectiveScaleValue = baseScale.x * (1 + scaleDelta);
  const effectiveScale = new THREE.Vector3(effectiveScaleValue, effectiveScaleValue, effectiveScaleValue);

  anchor.position.copy(effectivePosition);
  anchor.quaternion.copy(effectiveQuaternion);
  anchor.scale.copy(effectiveScale);
  anchor.updateMatrixWorld(true);

  return {
    shippingTransform,
    tuningOverride: { positionDelta, rotationDeltaDeg, scaleDelta },
    effectiveTransform: transformOut(effectivePosition, effectiveQuaternion, effectiveScale),
  };
}

// ── Fit Envelope per-clip summary (SR5 closeout) ────────────────────────────────────────────────────
// Pure aggregation over the SAME per-frame measureGrip()/measureShield()/computeBodyOccupancyBox()
// numbers getFitEnvelope() already collects -- doctrine 5.4/5.5: no new fit logic, no automatic
// PASS/FAIL threshold, just extrema (and the timestamp each extremum occurred at) so a caller does not
// have to manually scan every frame of a 12-sample sweep to find the worst moment.

function minWithTimestamp(frames, get) {
  let best = null;
  for (const f of frames) {
    const v = get(f);
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (best === null || v < best.value) best = { value: v, t: f.t };
  }
  return best;
}

function maxWithTimestamp(frames, get) {
  let best = null;
  for (const f of frames) {
    const v = get(f);
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (best === null || v > best.value) best = { value: v, t: f.t };
  }
  return best;
}

function extrema(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  return { min: Math.min(...finite), max: Math.max(...finite) };
}

/** `frames` is `getFitEnvelope()`'s own per-frame array for one clip (each `{ t, grip, shield, boe }`).
 *  Returns null if `frames` is empty. Every field here is derived ONLY from those same frames -- this
 *  is aggregation of existing authority, not a second measurement pass. */
export function summarizeFitEnvelopeFrames(frames) {
  if (!frames || frames.length === 0) return null;

  const boeWidth = frames.map((f) => f.boe.max[0] - f.boe.min[0]);
  const boeHeight = frames.map((f) => f.boe.max[1] - f.boe.min[1]);
  const boeDepth = frames.map((f) => f.boe.max[2] - f.boe.min[2]);

  const gripSeating = frames.map((f) => f.grip?.gripToWristDistance).filter((v) => v !== undefined);

  return {
    boe: { width: extrema(boeWidth), height: extrema(boeHeight), depth: extrema(boeDepth) },
    minSwordClearance: {
      toOwnForearm: minWithTimestamp(frames, (f) => f.grip?.clearances?.toOwnForearm),
      toNearestThigh: minWithTimestamp(frames, (f) => f.grip?.clearances?.toNearestThigh),
      toTorso: minWithTimestamp(frames, (f) => f.grip?.clearances?.toTorso),
      toShield: minWithTimestamp(frames, (f) => f.grip?.clearances?.toShield),
    },
    minShieldClearance: {
      toHand: minWithTimestamp(frames, (f) => f.shield?.clearances?.toHand),
      toElbow: minWithTimestamp(frames, (f) => f.shield?.clearances?.toElbow),
      toTorso: minWithTimestamp(frames, (f) => f.shield?.clearances?.toTorso),
    },
    gripSeating: gripSeating.length > 0 ? extrema(gripSeating) : null,
    shieldOutwardness: {
      palmSideDot: {
        min: minWithTimestamp(frames, (f) => f.shield?.palmSideDot),
        max: maxWithTimestamp(frames, (f) => f.shield?.palmSideDot),
      },
      gameplayCameraReadability: {
        min: minWithTimestamp(frames, (f) => f.shield?.gameplayCameraReadability),
        max: maxWithTimestamp(frames, (f) => f.shield?.gameplayCameraReadability),
      },
    },
  };
}

// Padding around each bone's world position, standing in for that joint's own flesh/cloth radius --
// a fixed approximation (doctrine 3.3/5.5: not a mesh-collision solver), not a per-bone tuned value.
const BONE_ENVELOPE_PADDING = 0.08;

/** BOE (Body Occupancy Envelope, doctrine section 5.4): an approximate body-only world bounding box,
 *  excluding any mounted gear. Built from the SKELETON's own bone world positions, not
 *  `Box3.expandByObject()` on the body mesh -- three.js's `expandByObject` reads a SkinnedMesh's
 *  BIND-POSE vertex positions (skinning happens on the GPU, not through `matrixWorld`), so it reports
 *  the same box regardless of which animation frame is posed. Bone world transforms DO update every
 *  frame from the AnimationMixer, so a box built from them genuinely tracks the current pose -- an
 *  approximation of body occupancy, not an exact silhouette, but one that actually varies with idle
 *  vs. a full running/attack extension the way doctrine 5.4's clip sweep requires. */
export function computeBodyOccupancyBox(hero) {
  hero.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const padding = new THREE.Vector3(BONE_ENVELOPE_PADDING, BONE_ENVELOPE_PADDING, BONE_ENVELOPE_PADDING);
  let any = false;
  hero.traverse((o) => {
    if (o.isBone && !isMountedGear(o)) {
      const p = new THREE.Vector3();
      o.getWorldPosition(p);
      box.expandByPoint(p.clone().sub(padding));
      box.expandByPoint(p.clone().add(padding));
      any = true;
    }
  });
  if (!any) return null;
  return { min: v3(box.min), max: v3(box.max) };
}

// ── visual overlays (the "visually" half of "visually and numerically") ────────────────────────────
// Built directly from the SAME measureGrip()/measureShield() numbers a caller can also read, so the
// overlay a screenshot shows and the JSON a caller reads describe the identical measurement -- never
// a second, drifting visualization of a different computation.

const OVERLAY_GROUP_NAME = 'gear-inspector-overlay';

function marker(position, color, size = 0.02) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size, 8, 6),
    new THREE.MeshBasicMaterial({ color, depthTest: false }),
  );
  mesh.position.set(...position);
  mesh.renderOrder = 999;
  return mesh;
}

function line(pointA, pointB, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...pointA), new THREE.Vector3(...pointB),
  ]);
  const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
  l.renderOrder = 999;
  return l;
}

/** Removes any existing overlay group from `scene` and returns nothing -- call before building a new
 *  one, or with `overlay === 'none'` to just clear. */
export function clearOverlay(scene) {
  const existing = scene.getObjectByName(OVERLAY_GROUP_NAME);
  if (existing) scene.remove(existing);
}

/** Red blade-axis line (guard->tip) plus wrist/grip/tip markers -- makes exactly the doctrine 5.2
 *  failure modes visible: a floating grip reads as daylight between the wrist marker and the grip
 *  marker; a horizontal idle carry reads as a near-flat red line; a tip riding high or low against
 *  the leg is a direct visual comparison once the same screenshot also shows the leg. */
export function buildGripOverlay(hero, swordId = 'sword_ironwood') {
  const m = measureGrip(hero, swordId);
  if (!m) return null;
  const group = new THREE.Group();
  group.name = OVERLAY_GROUP_NAME;
  group.add(line(m.guardCentre, m.tip, 0xff2222));
  group.add(marker(m.wrist, 0x2266ff));
  group.add(marker(m.gripPoint, 0xffaa00));
  group.add(marker(m.tip, 0xff2222));
  return group;
}

/** Yellow forearm-axis line, cyan face-normal arrow (scaled for visibility, not to true length), and
 *  a wrist marker -- makes edge-on/palm-side mounting visible: a readable face shows the cyan line
 *  pointing at the viewer (foreshortened to a dot); an edge-on face shows it running parallel to the
 *  screen. */
export function buildShieldOverlay(hero) {
  const m = measureShield(hero);
  if (!m) return null;
  const group = new THREE.Group();
  group.name = OVERLAY_GROUP_NAME;
  const centre = new THREE.Vector3(...m.shieldCentre);
  const forearmEnd = centre.clone().add(new THREE.Vector3(...m.forearmAxis).multiplyScalar(0.15));
  const faceEnd = centre.clone().add(new THREE.Vector3(...m.faceNormal).multiplyScalar(0.15));
  group.add(line(v3(centre), v3(forearmEnd), 0xffee00));
  group.add(line(v3(centre), v3(faceEnd), 0x22eeff));
  group.add(marker(m.wrist, 0x2266ff));
  group.add(marker(m.shieldCentre, 0x22eeff, 0.015));
  return group;
}
