export const WORLD = 0;
export const CHARACTER = 1;

export function setLayer(root, layer) {
  root.traverse((object) => object.layers.set(layer));
  return root;
}
