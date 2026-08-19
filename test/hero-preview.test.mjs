// The pure half of the Hero screen's showcase pass: how far the preview camera stands, what it aims
// at, and which side of the hero it stands on. The three.js half (the render passes, the layer swap,
// the backdrop card, the light rig) is judged in captures -- tools/runtime-test/drive-hero-screen.mjs
// takes them at five world positions in both orientations, because "the hero is not occluded" is a
// thing you prove by looking, not by asserting.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HERO_HEIGHT_METERS,
  LANDSCAPE_HERO_SCREEN_FRACTION,
  PORTRAIT_HERO_SCREEN_FRACTION,
  PREVIEW_FOV_DEGREES,
  PREVIEW_ORBIT_YAW_RADIANS,
  heroPreviewCameraPlacement,
  heroPreviewFraming,
} from '../public/src/render/heroPreview.js';
import { CHARACTER, HERO_PREVIEW, HERO_PREVIEW_BACKDROP, WORLD } from '../public/src/render/layers.js';

const PORTRAIT = [768, 1024];
const LANDSCAPE = [1024, 768];

// What a perspective camera actually does: an object of height h, centred, covers this much of the
// frame. Written out here rather than imported, so the test measures the framing against the optics
// instead of against the same expression the implementation used.
function screenFractionOf(heightMeters, distanceMeters, fovDegrees) {
  return heightMeters / (2 * distanceMeters * Math.tan((fovDegrees * Math.PI) / 360));
}

test('the orientation comes from the viewport, not from a caller flag', () => {
  assert.equal(heroPreviewFraming(...PORTRAIT).portrait, true);
  assert.equal(heroPreviewFraming(...LANDSCAPE).portrait, false);
  // A square viewport is not landscape -- the portrait layout is the safer of the two to fall into,
  // because its clear band is the narrower one.
  assert.equal(heroPreviewFraming(900, 900).portrait, true);
});

test('the solved distance really does make the hero the requested fraction of the frame', () => {
  for (const [viewport, wanted] of [[PORTRAIT, PORTRAIT_HERO_SCREEN_FRACTION], [LANDSCAPE, LANDSCAPE_HERO_SCREEN_FRACTION]]) {
    const framing = heroPreviewFraming(...viewport);
    const measured = screenFractionOf(HERO_HEIGHT_METERS, framing.distanceMeters, framing.fovDegrees);
    assert.ok(Math.abs(measured - wanted) < 1e-9, `${viewport} framed ${measured}, wanted ${wanted}`);
  }
});

test('the hero is framed BIG -- over half the frame in either orientation, which is the whole point of a reward screen', () => {
  for (const viewport of [PORTRAIT, LANDSCAPE]) {
    const framing = heroPreviewFraming(...viewport);
    assert.ok(framing.heroScreenFraction > 0.5, `${viewport} -> ${framing.heroScreenFraction}`);
    assert.ok(framing.heroScreenFraction < 0.75, `${viewport} -> ${framing.heroScreenFraction}, no room for the UI`);
  }
});

test('sabotage: the framing is not one constant wearing two names -- the orientations really differ', () => {
  const portrait = heroPreviewFraming(...PORTRAIT);
  const landscape = heroPreviewFraming(...LANDSCAPE);
  assert.notEqual(portrait.distanceMeters, landscape.distanceMeters);
  assert.notEqual(portrait.lookHeightMeters, landscape.lookHeightMeters);
});

// Raising the aim point pushes the subject DOWN the frame. Portrait's bottom dock (owned strip + item
// card) is deeper than its top dock, so portrait has to aim BELOW mid-height to lift the hero into
// the hole the UI leaves; landscape's only intrusion is the header, so it aims slightly above.
test('the vertical bias aims where the UI actually leaves room, in the right direction for each layout', () => {
  const midHeight = HERO_HEIGHT_METERS / 2;
  assert.ok(heroPreviewFraming(...PORTRAIT).lookHeightMeters < midHeight);
  assert.ok(heroPreviewFraming(...LANDSCAPE).lookHeightMeters > midHeight);
});

test('the aim point stays ON the hero -- a bias that walked off his body would frame empty air', () => {
  for (const viewport of [PORTRAIT, LANDSCAPE]) {
    const { lookHeightMeters } = heroPreviewFraming(...viewport);
    assert.ok(lookHeightMeters > 0.35 && lookHeightMeters < 1.15, `${viewport} aims at ${lookHeightMeters}`);
  }
});

// The defect this whole pass exists to fix, stated as arithmetic: the OLD preview inherited
// `follow.heading`, so what a child saw depended on the angle between the camera's heading and the
// hero's own facing -- at spawn, his back. The new camera is placed FROM the hero's facing, so "you
// see his front" is true at every heading there is.
test('the camera stands in FRONT of the hero at every heading, never behind him', () => {
  const framing = heroPreviewFraming(...PORTRAIT);
  for (let heading = -Math.PI; heading <= Math.PI; heading += Math.PI / 12) {
    const { position } = heroPreviewCameraPlacement({
      heroX: 3.2, heroY: 0, heroZ: -7.4, heroHeading: heading, ...framing,
    });
    // The hero's forward is +Z rotated by his heading.
    const towardCamera = { x: position.x - 3.2, z: position.z - -7.4 };
    const forwardDot = towardCamera.x * Math.sin(heading) + towardCamera.z * Math.cos(heading);
    assert.ok(forwardDot > 0, `heading ${heading} put the camera behind the hero (dot ${forwardDot})`);
  }
});

test('and on the SWORD side -- the hero\'s right, where the blade hangs', () => {
  const framing = heroPreviewFraming(...PORTRAIT);
  for (let heading = -Math.PI; heading <= Math.PI; heading += Math.PI / 12) {
    const { position } = heroPreviewCameraPlacement({ heroX: 0, heroY: 0, heroZ: 0, heroHeading: heading, ...framing });
    // For a +Z-forward, +Y-up character in a right-handed frame, local +X is the character's LEFT,
    // so their right is -X rotated by the heading.
    const rightDot = position.x * -Math.cos(heading) + position.z * Math.sin(heading);
    assert.ok(rightDot > 0, `heading ${heading} put the camera on the shield side (dot ${rightDot})`);
  }
});

test('sabotage: flipping the authored yaw really does swing the camera to the shield side', () => {
  const framing = heroPreviewFraming(...PORTRAIT);
  const { position } = heroPreviewCameraPlacement({
    heroX: 0, heroY: 0, heroZ: 0, heroHeading: 0, ...framing,
    orbitYawRadians: -2 * PREVIEW_ORBIT_YAW_RADIANS,
  });
  assert.ok(position.x * -1 < 0, 'a mirrored yaw should land on the hero\'s LEFT, and does not');
});

test('the camera really is the solved distance from what it looks at, at any orbit', () => {
  const framing = heroPreviewFraming(...LANDSCAPE);
  for (const orbitYawRadians of [0, 0.9, -2.4, Math.PI]) {
    const { position, lookAt } = heroPreviewCameraPlacement({
      heroX: -6.5, heroY: 0.4, heroZ: 11.25, heroHeading: 2.1, ...framing, orbitYawRadians,
    });
    const measured = Math.hypot(position.x - lookAt.x, position.y - lookAt.y, position.z - lookAt.z);
    assert.ok(Math.abs(measured - framing.distanceMeters) < 1e-9,
      `orbit ${orbitYawRadians} sat at ${measured}, framing solved ${framing.distanceMeters}`);
  }
});

test('dragging turns the hero on a turntable: same height, same distance, different side', () => {
  const framing = heroPreviewFraming(...PORTRAIT);
  const base = heroPreviewCameraPlacement({ heroX: 0, heroY: 0, heroZ: 0, heroHeading: 0.4, ...framing });
  const turned = heroPreviewCameraPlacement({
    heroX: 0, heroY: 0, heroZ: 0, heroHeading: 0.4, ...framing, orbitYawRadians: 1.2,
  });
  assert.ok(Math.abs(base.position.y - turned.position.y) < 1e-12, 'a yaw drag must not change height');
  assert.ok(Math.hypot(base.position.x - turned.position.x, base.position.z - turned.position.z) > 0.5);
  assert.deepEqual(base.lookAt, turned.lookAt, 'the turntable turns around the hero, it does not pan off him');
});

// The hero's own y matters: he can be standing on something, and the preview has to follow him up.
test('the framing rides the hero\'s own ground height rather than assuming y = 0', () => {
  const framing = heroPreviewFraming(...PORTRAIT);
  const low = heroPreviewCameraPlacement({ heroX: 1, heroY: 0, heroZ: 1, heroHeading: 0, ...framing });
  const high = heroPreviewCameraPlacement({ heroX: 1, heroY: 2.5, heroZ: 1, heroHeading: 0, ...framing });
  assert.ok(Math.abs((high.position.y - low.position.y) - 2.5) < 1e-12);
  assert.ok(Math.abs((high.lookAt.y - low.lookAt.y) - 2.5) < 1e-12);
});

test('the preview lens is longer than the gameplay lens -- a character screen is a portrait, not a field of view', () => {
  // camera/follow.js's gameplay camera is a 42 degree vertical FOV (main.js's own PerspectiveCamera).
  assert.ok(PREVIEW_FOV_DEGREES < 42);
});

test('the four render layers are four distinct bits', () => {
  const all = [WORLD, CHARACTER, HERO_PREVIEW, HERO_PREVIEW_BACKDROP];
  assert.equal(new Set(all).size, all.length);
  for (const layer of all) assert.ok(Number.isInteger(layer) && layer >= 0 && layer < 32);
  // The showcase layers must not overlap the two gameplay ones, or moving the hero onto the preview
  // layer would leave it visible to the world camera and it would be drawn twice.
  assert.notEqual(1 << HERO_PREVIEW, (1 << WORLD) | (1 << CHARACTER));
  assert.equal((1 << HERO_PREVIEW) & ((1 << WORLD) | (1 << CHARACTER)), 0);
  assert.equal((1 << HERO_PREVIEW_BACKDROP) & ((1 << WORLD) | (1 << CHARACTER) | (1 << HERO_PREVIEW)), 0);
});
