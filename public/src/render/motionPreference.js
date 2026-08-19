/**
 * Does this player want less motion?
 *
 * Read on every effect rather than cached at startup, so toggling the OS setting mid-game takes
 * effect on the next hit instead of needing a reload -- the behaviour enemies/wolf.js's own flash
 * already had when this lived privately inside it.
 *
 * Extracted (GP1-C5) the moment a SECOND effect needed the same answer: render/impactBurst.js. One
 * definition, not two that can drift into disagreeing about what "reduced" means -- the same rule
 * that put WIRE_POSITION_QUANTUM and the gear anchor name in one place each.
 *
 * `matchMedia` deliberately does not exist under plain `node --test`, and this returns false there
 * rather than throwing. That is what lets wolf.test.mjs exercise flashHit()/flashDefeated() with no
 * DOM at all, and the same freedom is now available to anything else that asks.
 */
export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}
