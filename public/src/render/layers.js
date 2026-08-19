export const WORLD = 0;
export const CHARACTER = 1;
// The Hero screen's showcase pass. Nothing lives here during gameplay -- render/heroPreview.js moves
// the LIVE local hero onto this layer for exactly as long as the screen is open, and puts it back on
// CHARACTER on close. Two bits rather than one because the preview draws in two ordered passes (a
// backdrop card, then the hero) and three.js sorts transparent objects AFTER opaque ones inside a
// single render() call regardless of renderOrder -- so the card can only be guaranteed to land
// BEHIND the hero by giving it its own pass, and a pass needs its own layer to select.
export const HERO_PREVIEW = 2;
export const HERO_PREVIEW_BACKDROP = 3;

export function setLayer(root, layer) {
  root.traverse((object) => object.layers.set(layer));
  return root;
}
