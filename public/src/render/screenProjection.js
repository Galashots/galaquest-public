// public/src/render/screenProjection.js
//
// The one piece of "where is this world point on screen" worth testing without a browser: turning a
// three.js NDC coordinate (what Vector3.project(camera) hands back, -1..1 on both axes, +1 up) into
// CSS pixels inside an overlay the same size as the game surface (0..width, 0..height, +y DOWN).
// Pure on purpose so the Y-flip -- the one part of this a naive port gets backwards -- has a test
// that fails loudly instead of a floating number that quietly renders upside down.

export function ndcToOverlayPixels(ndcX, ndcY, width, height) {
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (1 - (ndcY * 0.5 + 0.5)) * height,
  };
}
