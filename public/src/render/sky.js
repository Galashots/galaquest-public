// public/src/render/sky.js
//
// The sky and the distance haze. Two changes that cost nothing per frame and change every single
// screenshot in the game.
//
// What was there: `scene.background = new THREE.Color(0x9bb9cc)`, one flat pale grey-blue, and no
// fog. Looked at in the running game while walking out to the wolf
// (.local/runtime-test/moment-02-at-the-wolf.png) that is the top forty per cent of a 768x1024
// frame with nothing in it, and worse, the 28x28 ground plane simply STOPS: from the wilderness you
// can see the horizon line end and open sky underneath the edge of the world.
//
// A gradient sky fixes the first and linear fog fixes the second -- the ground fades into the
// horizon colour before its own edge is reachable, so the world reads as continuing into haze
// rather than as a tabletop. Both are what a stylised game does; neither is a shader, an extra draw
// call, or an asset.

import * as THREE from '../../vendor/three.module.min.js';

// Read bottom-to-top as EQUIRECTANGULAR LATITUDE: 0.0 is straight down, 0.5 is the HORIZON, 1.0 is
// straight up.
//
// The stop VALUES look wrong until you know how little sky this camera shows, which was measured
// rather than reasoned about (tmp probe: sample the rendered pixel at the top of frame at eight
// headings). The follow camera's DEFAULT_PITCH is 0.3 rad, i.e. it looks 17 degrees DOWN, and the
// vertical FOV is 42 degrees -- so the top edge of a 768x1024 frame sits about 4 degrees above the
// horizon. The whole visible sky is v 0.500 to 0.522. At MIN_PITCH it reaches about v 0.60 and no
// further.
//
// So the entire gradient a child will ever see has to live inside 0.50..0.60. Two earlier versions
// spread it over 0..1 and then over 0.48..1.0 and both rendered as one flat wash, because the
// visible 2% slice sat in the middle of a long ramp. Measured before this version: rgb(232,233,221)
// at the top of frame, identical at all eight headings -- and identical is the point. A vertical
// gradient cannot vary with heading, and an earlier read of the captures that thought it did was
// simply wrong about the colours.
//
// Above 0.60 the ramp continues to a deeper blue purely so nothing bands if the camera is ever
// allowed to look higher. Below the horizon is never visible and is kept a muted ground tone.
export const SKY_STOPS = Object.freeze([
  Object.freeze([0.000, '#cdd6cc']),
  Object.freeze([0.496, '#f8dfb0']),
  Object.freeze([0.504, '#f2e2c8']),
  Object.freeze([0.510, '#d5dfe6']),
  Object.freeze([0.517, '#aacdea']),
  Object.freeze([0.526, '#8ab9e5']),
  Object.freeze([0.560, '#6ba6dd']),
  Object.freeze([1.000, '#3f86cc']),
]);

// The colour distance dissolves into. It has to be the sky's colour AT THE HORIZON -- v=0.500 in
// SKY_STOPS -- because that is where fully-fogged ground meets sky, and any difference between the
// two draws a line exactly where the horizon is supposed to disappear.
//
// It was 0xd3e1e6, a pale blue picked to match the sky's upper band, and once the ground skirt
// landed that mismatch was visible as a distinct edge: cool grey haze below, warm cream sky above,
// with a wobbly seam between them (.local/runtime-test/look-05-far-corner-outward.png). Warm now,
// sampled from the horizon stop rather than chosen separately.
export const FOG_COLOR = 0xf0e1c4;
// Tuned against the camera, not the world: the follow camera sits DEFAULT_DISTANCE (16 m) behind
// the hero, so anything closer than that is the player's own business and must never be hazed.
//
// Pushed out from 24/46 once the ground skirt existed. The skirt is what actually hides the world's
// edge now, so the fog no longer has to reach anything a player interacts with -- and at 24 m it
// was starting only 8 m past the hero, which put mid-distance TREES and the far half of the village
// under real haze and pulled the colour out of the parts of the frame worth looking at. This game
// wants to be colourful, not atmospheric. At 30 m nothing within the playable view is touched at
// all (three.js linear fog is exactly zero below `near`), and 58 m still fully dissolves the skirt
// long before its own 70 m half-width.
export const FOG_NEAR = 30;
export const FOG_FAR = 58;

// 2048, not 256, because of the measurement above: the visible strip is v 0.500..0.522, which is
// 2.2% of the image. At 256 rows that is FIVE pixels of gradient stretched over a whole screen and
// it bands visibly. At 2048 it is 45 rows. The texture is 8 px wide, so this is still only 64 KB
// and no asset file.
const SKY_TEXTURE_HEIGHT = 2048;

/** The gradient as an equirectangular background texture. 8 px wide because it varies only
 *  vertically; three.js samples it as a full sphere, so the horizon stays level whichever way the
 *  camera turns and no geometry, draw call or asset file is involved. */
export function createSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = SKY_TEXTURE_HEIGHT;
  const context = canvas.getContext('2d');
  // Canvas y grows downward and the texture's top row is the zenith, so the gradient is built from
  // the bottom of the image up -- 0 in SKY_STOPS is the horizon.
  const gradient = context.createLinearGradient(0, SKY_TEXTURE_HEIGHT, 0, 0);
  for (const [stop, colour] of SKY_STOPS) gradient.addColorStop(stop, colour);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, SKY_TEXTURE_HEIGHT);
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Applies both to a scene. One call at boot; nothing to update per frame. */
export function applySky(scene) {
  scene.background = createSkyTexture();
  scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
  return scene.fog;
}
