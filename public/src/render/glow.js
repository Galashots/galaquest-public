// public/src/render/glow.js
//
// One soft round glow, drawn once into a canvas at boot and shared by everything in the game that
// needs to look like it is giving off light: the lantern tree's motes, the street lanterns as they
// catch, and the hero's belt lantern.
//
// A sprite rather than a light. Every street lantern getting a real PointLight would be five more
// lights in every shader on the page, on an iPad, for a lamp the child sees from ten metres -- and
// three.js recompiles when the light count changes. An additive sprite is one quad, always faces
// the camera, needs no shadow work, and at gameplay distance is indistinguishable from a lamp that
// is actually lit. Real lights are spent only where the light has to fall on something else: the
// Lantern Tree's own canopy.
//
// Generated rather than shipped as a PNG because it is 64x64 of radial gradient -- a file would be
// one more asset to load, cache-bust and keep in the budget for no gain.

import * as THREE from '../../vendor/three.module.min.js';

const GLOW_TEXTURE_SIZE = 64;
const cache = new Map();

// Three profiles, because one did not work for all three jobs and the difference is visible in a
// capture.
//
//   'lamp'  a hot white core inside a warm falloff. A flame reads as white in the middle whatever
//           colour its halo is, and this is what makes a street lantern look switched ON.
//   'mote'  no white core at all. The first pass drew the Lantern Tree's drifting motes with the
//           lamp profile at 0.34 m, and at gameplay distance a small sprite is ALL core -- the tint
//           never gets a chance to show, so they photographed as white specks and read as falling
//           snow in a warm tree. A mote has to be the colour it is tinted, all the way through.
//   'shock' HOLLOW: nothing in the middle, a bright edge, gone again outside it. Added for GP1-C5's
//           combat impacts, and added only after looking: the first hit burst used 'lamp', and in
//           .local/runtime-test/fight-wolf-hit-flash.png it reads as the wolf briefly getting
//           brighter rather than as something striking it. A filled blob that grows is a light
//           turning up; an EDGE that travels outward is an impact, and the edge is the part that
//           still reads when the whole fight is a tenth of frame height. The kill burst deliberately
//           keeps 'lamp' -- a wolf's stolen light dissipating SHOULD be a soft bloom, and having the
//           two events differ in shape as well as colour and size is the entire point of that phase.
const PROFILES = {
  lamp: [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.85)'], [0.55, 'rgba(255,255,255,0.28)'], [1, 'rgba(255,255,255,0)']],
  mote: [[0, 'rgba(255,255,255,0.72)'], [0.35, 'rgba(255,255,255,0.42)'], [0.7, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']],
  shock: [
    [0, 'rgba(255,255,255,0)'], [0.42, 'rgba(255,255,255,0)'],
    [0.62, 'rgba(255,255,255,0.55)'], [0.76, 'rgba(255,255,255,1)'],
    [0.88, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)'],
  ],
};

/** A glow texture by profile name, made on first use and shared forever after. Callers never
 *  dispose these -- they live as long as the page. */
export function glowTexture(profile = 'lamp') {
  const cached = cache.get(profile);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = GLOW_TEXTURE_SIZE;
  canvas.height = GLOW_TEXTURE_SIZE;
  const context = canvas.getContext('2d');
  const half = GLOW_TEXTURE_SIZE / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  for (const [stop, colour] of PROFILES[profile] ?? PROFILES.lamp) gradient.addColorStop(stop, colour);
  context.fillStyle = gradient;
  context.fillRect(0, 0, GLOW_TEXTURE_SIZE, GLOW_TEXTURE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cache.set(profile, texture);
  return texture;
}

/**
 * A camera-facing glow of `sizeMeters` across, tinted `color`, starting invisible.
 *
 * Additive with depthWrite off, which is the standard treatment for a light source: it brightens
 * whatever is behind it instead of punching a dark hole in it, and never sorts wrongly against the
 * foliage it hangs in.
 */
export function createGlowSprite(color, sizeMeters, profile = 'lamp') {
  const material = new THREE.SpriteMaterial({
    map: glowTexture(profile),
    color,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(sizeMeters);
  sprite.visible = false;
  return sprite;
}

/** Set a glow's strength. `0` hides it outright rather than drawing a fully transparent quad. */
export function setGlowStrength(sprite, strength01) {
  const strength = strength01 < 0 ? 0 : strength01 > 1 ? 1 : strength01;
  sprite.material.opacity = strength;
  sprite.visible = strength > 0;
}
