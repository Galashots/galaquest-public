import { strict as assert } from 'node:assert';
import test from 'node:test';

import * as THREE from '../public/vendor/three.module.min.js';
import {
  PITCH_RADIANS_PER_PX,
  STICK_REGION_HEIGHT_FRACTION,
  STICK_REGION_WIDTH_FRACTION,
  YAW_RADIANS_PER_PX,
  createCameraGesture,
  isInStickRegion,
  isInteractiveUiTarget,
  orbitDeltaForDrag,
  pinchSeparation,
  zoomFactorForPinch,
} from '../public/src/input/cameraGesture.js';
import {
  createFollowCamera,
  MAX_DISTANCE,
  MAX_PITCH,
  MIN_DISTANCE,
  MIN_PITCH,
} from '../public/src/camera/follow.js';

// Grown after the second child playtest (see the constants' own comment): the stick has to appear
// wherever a kid's thumb first lands, not only inside a tight 40%x40% box.
test('the stick owns a generous lower-left area, but never the attack button\'s corner', () => {
  const w = 1000;
  const h = 800;
  assert.equal(isInStickRegion(60, 760, w, h), true, 'bottom-left corner');
  assert.equal(isInStickRegion(60, 100, w, h), false, 'top-left is camera');
  assert.equal(isInStickRegion(900, 760, w, h), false, 'bottom-right (the attack button\'s corner) is camera');
  assert.equal(isInStickRegion(500, 400, w, h), false, 'dead centre is camera');
  // Still short of a full quadrant on the width axis: the bottom edge's midpoint stays camera, which
  // is what keeps the attack button's own bottom-right corner clear.
  assert.equal(isInStickRegion(w / 2, h - 1, w, h), false, 'bottom edge midpoint');
  // But generous enough now that a thumb landing only a little high, or a little left of centre, still
  // finds the stick -- exactly the miss the playtest reported. Half the height and a fifth of the
  // width both now belong to the stick.
  assert.equal(isInStickRegion(1, h / 2, w, h), true, 'left edge midpoint is now inside the region');
  assert.equal(isInStickRegion(w * 0.2, h * 0.6, w, h), true, 'a thumb well above the old 40% band');
  // The exact fractions are exported and used here rather than retyped, so this test moves with them
  // instead of silently drifting out of date the next time the region is re-tuned.
  const widthBoundary = w * STICK_REGION_WIDTH_FRACTION;
  const heightBoundary = h * (1 - STICK_REGION_HEIGHT_FRACTION);
  assert.equal(isInStickRegion(widthBoundary - 1, heightBoundary, w, h), true, 'just inside the width boundary');
  assert.equal(isInStickRegion(widthBoundary + 1, heightBoundary, w, h), false, 'just outside the width boundary');
});

test('dragging reverses both orbit axes without changing sensitivity', () => {
  assert.equal(orbitDeltaForDrag(100, 0).yaw, -100 * YAW_RADIANS_PER_PX, 'drag right yaws negative');
  assert.equal(orbitDeltaForDrag(-100, 0).yaw, 100 * YAW_RADIANS_PER_PX, 'drag left yaws positive');
  assert.equal(orbitDeltaForDrag(0, -100).pitch, -100 * PITCH_RADIANS_PER_PX, 'drag up lowers the camera');
  assert.equal(orbitDeltaForDrag(0, 100).pitch, 100 * PITCH_RADIANS_PER_PX, 'drag down raises the camera');
});

test('spreading the fingers pulls the camera in', () => {
  const a = { x: 100, y: 100 };
  const b = { x: 200, y: 100 };
  assert.equal(pinchSeparation(a, b), 100);
  assert.ok(zoomFactorForPinch(100, 200) < 1, 'spread apart zooms in');
  assert.ok(zoomFactorForPinch(200, 100) > 1, 'pinch together zooms out');
  assert.equal(zoomFactorForPinch(100, 100), 1, 'no change is no zoom');
  assert.equal(zoomFactorForPinch(0, 100), 1, 'a degenerate start cannot divide by zero');
});

test('orbit and zoom stay inside their limits however hard they are pushed', () => {
  const follow = createFollowCamera(new THREE.PerspectiveCamera());
  for (let i = 0; i < 200; i += 1) follow.orbit(0, 1);
  assert.ok(follow.pitch <= MAX_PITCH + 1e-12, `pitch ran past max: ${follow.pitch}`);
  for (let i = 0; i < 400; i += 1) follow.orbit(0, -1);
  assert.ok(follow.pitch >= MIN_PITCH - 1e-12, `pitch ran past min: ${follow.pitch}`);
  for (let i = 0; i < 200; i += 1) follow.zoomBy(1.5);
  assert.ok(follow.distance <= MAX_DISTANCE + 1e-12, `distance ran past max: ${follow.distance}`);
  for (let i = 0; i < 400; i += 1) follow.zoomBy(0.5);
  assert.ok(follow.distance >= MIN_DISTANCE - 1e-12, `distance ran past min: ${follow.distance}`);
});

test('the camera never falls below the hero, at any pitch or zoom', () => {
  const camera = new THREE.PerspectiveCamera();
  const follow = createFollowCamera(camera);
  const feet = new THREE.Vector3(0, 0, 0);
  for (const pitchPushes of [0, 20, 200]) {
    for (const zoom of [0.5, 1, 1.5]) {
      const fresh = createFollowCamera(camera);
      for (let i = 0; i < pitchPushes; i += 1) fresh.orbit(0, 0.05);
      fresh.zoomBy(zoom);
      fresh.update(feet);
      assert.ok(
        camera.position.y > 0.1,
        `camera sank to y=${camera.position.y.toFixed(3)} at pitch ${fresh.pitch.toFixed(3)}`,
      );
    }
  }
  follow.update(feet);
});

// Turning the camera has to turn what "up on the stick" means, or the scheme is not camera-relative.
test('orbiting the camera re-aims the movement input', () => {
  const follow = createFollowCamera(new THREE.PerspectiveCamera());
  const before = follow.screenToWorld({ x: 0, y: 1 });
  follow.orbit(Math.PI / 2, 0);
  const after = follow.screenToWorld({ x: 0, y: 1 });
  const dot = before.x * after.x + before.z * after.z;
  assert.ok(Math.abs(dot) < 1e-9, `a quarter turn should make forward orthogonal, dot ${dot}`);
});

// ── the un-closeable-menu fix ──────────────────────────────────────────────────────────────────
//
// A DOM-free stand-in for "an element that either is, or sits inside, some interactive thing".
// `matches` names which selector fragments (as substrings of the real compound selector this module
// asks for) this fake target answers true to -- e.g. fakeElement(['button']) behaves the way a real
// <button> would under `target.closest('button, input, ...')`.
function fakeElement(matchingFragments) {
  return {
    closest(selector) {
      const fragments = selector.split(',').map((s) => s.trim());
      return fragments.some((fragment) => matchingFragments.includes(fragment)) ? {} : null;
    },
  };
}

test('isInteractiveUiTarget recognises every native control the veto names', () => {
  for (const tag of ['button', 'input', 'textarea', 'select', 'a', 'label']) {
    assert.equal(isInteractiveUiTarget({ target: fakeElement([tag]) }), true, tag);
  }
  assert.equal(isInteractiveUiTarget({ target: fakeElement(['[data-thumb-surface]']) }), true, 'thumb surface');
  assert.equal(isInteractiveUiTarget({ target: fakeElement(['[data-ui-surface]']) }), true, 'ui surface');
});

test('isInteractiveUiTarget is false for the ordinary world/canvas and for a malformed event', () => {
  assert.equal(isInteractiveUiTarget({ target: fakeElement([]) }), false, 'a plain element matches nothing');
  assert.equal(isInteractiveUiTarget({ target: null }), false);
  assert.equal(isInteractiveUiTarget({}), false, 'no target at all');
  assert.equal(isInteractiveUiTarget({ target: {} }), false, 'a target with no closest() (not a real Element)');
});

/** A minimal EventTarget-shaped stand-in for #game, just enough for createCameraGesture to wire its
 *  five listeners against and for a test to fire one back in. */
function fakeSurface() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    dispatch(type, event) { for (const handler of listeners.get(type) ?? []) handler(event); },
  };
}

function fakeFollow() {
  let orbited = 0;
  return {
    distance: 4,
    orbit() { orbited += 1; },
    setDistance() {},
    zoomBy() {},
    orbitedCount: () => orbited,
  };
}

// The playtest's own bug, pinned directly: a pointer that lands on a button-shaped target (the close
// X, or any future overlay button) must never become a drag candidate, even when the finger travels
// past DRAG_DEADZONE_PX before lifting -- which is exactly what turned "tap the X" into "the world
// spins and the X never closes" before this veto existed.
test('a pointerdown on a button-shaped target never seeds a camera drag', () => {
  const surface = fakeSurface();
  const follow = fakeFollow();
  createCameraGesture(surface, follow, { isStickPointer: () => false });

  const closeButtonTarget = fakeElement(['button']);
  surface.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, target: closeButtonTarget });
  // A real tap always has a little travel in it -- this is well past DRAG_DEADZONE_PX (4px).
  surface.dispatch('pointermove', { pointerId: 1, clientX: 130, clientY: 100, target: closeButtonTarget });
  surface.dispatch('pointerup', { pointerId: 1, clientX: 130, clientY: 100, target: closeButtonTarget });

  assert.equal(follow.orbitedCount(), 0, 'the camera must not move from a tap that landed on a button');
});

// The property this veto must NOT break: the Hero screen's own deliberately click-through middle
// (index.html's comment on #hero-screen) still drives a drag exactly as before, because a real tap
// there lands on the game surface itself, not inside any tagged UI surface.
test('a pointerdown on the plain game surface still seeds a camera drag, unaffected by the veto', () => {
  const surface = fakeSurface();
  const follow = fakeFollow();
  createCameraGesture(surface, follow, { isStickPointer: () => false });

  const gameTarget = fakeElement([]);
  surface.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, target: gameTarget });
  surface.dispatch('pointermove', { pointerId: 1, clientX: 130, clientY: 100, target: gameTarget });

  assert.ok(follow.orbitedCount() > 0, 'a drag on the open game surface must still turn the camera');
});
