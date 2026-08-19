// public/src/render/questMarker.js
//
// The floating "!" over the head of the person you are supposed to talk to.
//
// Why: the village now has four people standing in it and exactly one of them has the quest. From
// the road they are four robed silhouettes, and a young player has no way to know which one to
// walk up to -- the objective chip says "Talk to Keeper Aldric" and nothing in the world says which
// one Aldric is. This is the oldest piece of vocabulary in the genre for exactly that problem, and
// it is vocabulary a child already knows before they can read the chip.
//
// Drawn into a canvas at boot rather than shipped as a PNG, the same trade render/glow.js makes and
// for the same reason: it is a glyph on a disc, and a file would be one more asset to load, cache
// bust and keep in the budget for no gain.

import * as THREE from '../../vendor/three.module.min.js';

const TEXTURE_SIZE = 128;
const GOLD = '#ffc23d';
const GOLD_DARK = '#a35c07';
let cached = null;

/** The marker's own texture: a warm disc with a bold exclamation on it, made once and shared. */
export function questMarkerTexture() {
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const c = canvas.getContext('2d');
  const half = TEXTURE_SIZE / 2;

  // A soft halo first, so the marker still reads against a bright sky OR a dark canopy without an
  // outline heavy enough to look like a UI sticker pasted over the world.
  const halo = c.createRadialGradient(half, half, 0, half, half, half);
  halo.addColorStop(0, 'rgba(255,196,84,0.85)');
  halo.addColorStop(0.45, 'rgba(255,178,60,0.45)');
  halo.addColorStop(1, 'rgba(255,170,50,0)');
  c.fillStyle = halo;
  c.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  // The glyph, drawn as two rounded shapes rather than as text: a font would render differently on
  // every device and there is no web font to wait for.
  const barWidth = TEXTURE_SIZE * 0.15;
  const barTop = TEXTURE_SIZE * 0.2;
  const barHeight = TEXTURE_SIZE * 0.42;
  const dotRadius = barWidth * 0.62;
  const dotY = TEXTURE_SIZE * 0.78;

  c.lineJoin = 'round';
  c.lineCap = 'round';
  // A dark rim under the gold, so the glyph holds its shape against the halo behind it.
  for (const [colour, grow] of [[GOLD_DARK, TEXTURE_SIZE * 0.035], [GOLD, 0]]) {
    c.fillStyle = colour;
    const w = barWidth + grow * 2;
    c.beginPath();
    c.roundRect(half - w / 2, barTop - grow, w, barHeight + grow * 2, w / 2);
    c.fill();
    c.beginPath();
    c.arc(half, dotY, dotRadius + grow, 0, Math.PI * 2);
    c.fill();
  }

  cached = new THREE.CanvasTexture(canvas);
  cached.colorSpace = THREE.SRGBColorSpace;
  return cached;
}

// How far it floats above the head it belongs to, and how big it is. Both in metres and both tuned
// against the 1.65 m Keeper: high enough to clear his hood at every camera angle, small enough that
// it never becomes the biggest thing in the frame.
export const MARKER_LIFT_METERS = 0.66;
// 0.56 first. From the wilderness -- the shot that matters, because that is where a child decides
// whether the village is worth walking back to -- it held, but only just, at about eighteen pixels
// on a portrait iPad. 0.68 still does not out-shout the Lantern Tree and is legible from the far
// side of the map.
export const MARKER_SIZE_METERS = 0.68;
// A slow, shallow bob. Fast enough to catch the eye from across the plaza, slow enough that it is
// not shouting.
export const MARKER_BOB_METERS = 0.09;
export const MARKER_BOB_HZ = 0.55;

/** Where the marker sits at `seconds`, relative to its resting height. Pure, so the bob can be
 *  checked without a scene. */
export function markerBob(seconds) {
  return Math.sin(seconds * MARKER_BOB_HZ * Math.PI * 2) * MARKER_BOB_METERS;
}

/**
 * A quest marker sprite, hidden until someone shows it.
 *
 * NOT additive, unlike the lantern glows: an exclamation mark that brightens whatever is behind it
 * loses its own dark rim and turns into a smear the moment it drifts over the lit tree.
 */
export function createQuestMarker() {
  const material = new THREE.SpriteMaterial({
    map: questMarkerTexture(),
    transparent: true,
    depthWrite: false,
    // It is a signpost, not scenery: a child must be able to see WHO to talk to even when the
    // Keeper is behind the tree trunk from where they are standing.
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(MARKER_SIZE_METERS);
  sprite.visible = false;
  // Above everything else that draws in the world pass, for the same reason depthTest is off.
  sprite.renderOrder = 10;
  return sprite;
}
