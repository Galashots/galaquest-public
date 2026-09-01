// public/src/ui/gearFlight.js
//
// THE ICON THAT TRAVELS. #88's own words: "the new item icon visibly flies from inventory into the
// equipped slot and the replaced item returns visually to inventory".
//
// WHY AN ANIMATION IS LOAD-BEARING HERE AND NOT DECORATION. Equipping changes three things at once
// -- a grid cell stops being armed, a slot fills, and POWER moves -- and on a phone those three are
// far enough apart that a child looking at the one they tapped can miss the other two entirely. The
// Checkpoint 0 session's own note for the existing flow was that nothing told the player where the
// thing they picked had gone. A moving object is the cheapest possible answer: the eye follows it,
// so it ARRIVES at the slot the child now needs to look at. That is the whole design.
//
// SELF-CONTAINED AND FIRE-AND-FORGET. main.js calls flyGearIcon() and never holds a handle: the
// element removes itself when its own animation finishes, and every early-exit below removes it too.
// A ceremony that leaks one absolutely-positioned div per equip would eventually cover the game.
//
// STYLED IN index.html, not here (`.gear-flight`), matching that file's own ledger discipline: the
// whole gear surface's appearance stays legible in one place.
//
// WHAT IT REFUSES TO DO. It does not read game state, does not know what an item IS, and does not
// decide whether an equip happened -- it is handed two rectangles and some art. It also never
// animates when the source or destination cannot be measured (a slot that is off-screen, a grid cell
// that was removed): a flight from 0,0 is worse than no flight, because it points at nothing.

/** How long the outbound icon takes to reach its slot. Slow enough to be followed by an eye that was
 *  not already tracking it -- under about 250ms a moving object reads as a flicker rather than a
 *  journey -- and short enough that a child equipping several pieces is never waiting on it. */
const FLIGHT_MS = 420;

/** The replaced item's return trip, slightly slower and starting late, so the two do not cross as a
 *  single confusing blur. The stagger is what makes it read as "that one went in, this one came
 *  out" rather than as two things moving at once. */
const RETURN_MS = 460;
const RETURN_DELAY_MS = 120;

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A measurable rect, or null. A zero-area rect means the element is display:none or detached, and
 *  flying to it would send the icon to the top-left corner of the screen. */
function rectOf(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return null;
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return rect;
}

/** The travelling copy. Built from the SAME art fields every other gear surface draws from
 *  (progression/itemArt.js, handed in by the caller) rather than by cloning a DOM node: a clone
 *  inherits grid placement, data attributes and CSS custom properties from wherever it came from,
 *  and then has to have all of them undone. */
function buildFlier(doc, { iconUrl, iconSvg, accent }, size) {
  const el = doc.createElement('div');
  el.className = 'gear-flight';
  el.setAttribute('aria-hidden', 'true');
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  if (accent) el.style.setProperty('--flight-edge', accent);
  const fallback = doc.createElement('span');
  fallback.className = 'item-art-fallback';
  fallback.innerHTML = iconSvg ?? '';
  el.appendChild(fallback);
  if (iconUrl) {
    const img = doc.createElement('img');
    img.className = 'item-art-image';
    img.alt = '';
    img.src = iconUrl;
    // No load gate here, unlike the static surfaces: the flight is over in under half a second, and
    // an icon that pops in halfway through is better than a silhouette that never becomes the item.
    img.addEventListener('load', () => { fallback.hidden = true; });
    el.appendChild(img);
  }
  return el;
}

/**
 * Animate one icon from `fromRect` to `toRect`, then remove it.
 *
 * Uses the Web Animations API rather than a CSS transition, for one specific reason: `finish` is a
 * real event with a guaranteed single firing, and `transitionend` is not -- it does not fire at all
 * when the element is display:none'd mid-transition, which is exactly what happens if the child
 * closes the Hero screen while an icon is in the air. A cleanup that depends on transitionend leaks
 * on the one path most likely to occur.
 */
function animateFlight(doc, art, fromRect, toRect, { durationMs, delayMs = 0, scaleTo = 1.15 }) {
  const size = Math.max(28, Math.min(fromRect.width, 96));
  const flier = buildFlier(doc, art, size);
  // Positioned by its CENTRE, so a small grid cell and a large slot line up on the thing a child was
  // actually looking at rather than on their top-left corners.
  const from = { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 };
  const to = { x: toRect.left + toRect.width / 2, y: toRect.top + toRect.height / 2 };
  flier.style.left = `${from.x - size / 2}px`;
  flier.style.top = `${from.y - size / 2}px`;
  doc.body.appendChild(flier);

  const remove = () => { if (flier.isConnected) flier.remove(); };

  if (prefersReducedMotion() || typeof flier.animate !== 'function') {
    // Still SHOW it, briefly, at the destination: someone who asked for less motion still needs to
    // be told where the item went. A static flash at the target is the honest reduced version of a
    // flight, and silently skipping the feedback would be reading "reduce motion" as "reduce
    // information".
    flier.style.left = `${to.x - size / 2}px`;
    flier.style.top = `${to.y - size / 2}px`;
    setTimeout(remove, 320);
    return;
  }

  const animation = flier.animate(
    [
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0 },
      {
        // An arc, not a straight line: the midpoint is lifted, which is what makes the motion read
        // as a thrown object rather than a UI element sliding. Cheap, and it is the difference
        // between "satisfying" and "correct".
        transform: `translate(${(to.x - from.x) * 0.5}px, ${(to.y - from.y) * 0.5 - 34}px) scale(${scaleTo})`,
        opacity: 1,
        offset: 0.55,
      },
      { transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(0.72)`, opacity: 0.9, offset: 1 },
    ],
    { duration: durationMs, delay: delayMs, easing: 'cubic-bezier(0.34, 0.9, 0.4, 1)', fill: 'forwards' },
  );
  animation.addEventListener('finish', remove);
  animation.addEventListener('cancel', remove);
}

/**
 * A short bloom on the destination slot, so the arrival lands on something rather than just
 * stopping. Separate from the flight because the slot is a real, persistent element and must be left
 * exactly as it was found -- this adds a data attribute and removes it, and touches nothing else.
 */
function pulseSlot(slotElement) {
  if (!slotElement) return;
  slotElement.dataset.justEquipped = 'true';
  setTimeout(() => { delete slotElement.dataset.justEquipped; }, 700);
}

/**
 * THE WHOLE EQUIP FEEDBACK, in one call.
 *
 * @param options.doc            the document to build in (injectable for a test).
 * @param options.sourceElement  the inventory cell the child tapped.
 * @param options.slotElement    the equipped slot it is going to.
 * @param options.art            { iconUrl, iconSvg, accent } for the item being equipped.
 * @param options.replacedArt    the same for whatever left the slot, or null on a first fill.
 *
 * Both directions are optional and independent: a first fill flies one icon in and returns nothing,
 * which is correct -- inventing a return flight for an item that never existed would tell the child
 * something false about what they own.
 */
export function flyGearIcon({
  doc = document,
  sourceElement = null,
  slotElement = null,
  art = null,
  replacedArt = null,
} = {}) {
  const fromRect = rectOf(sourceElement);
  const toRect = rectOf(slotElement);
  // Fail quietly and completely. A missing rect means the surface is not on screen -- the child is
  // not looking at it, so there is nothing to explain and nothing to animate.
  if (!fromRect || !toRect || !art) return;

  animateFlight(doc, art, fromRect, toRect, { durationMs: FLIGHT_MS });
  pulseSlot(slotElement);

  // The replaced item goes the other way, from the slot back to where the new one came from -- which
  // is the cell it will actually occupy, because the grid keeps items in a stable order. "It went
  // back in your bag" is the claim, and the animation makes it literally true on screen.
  if (replacedArt) {
    animateFlight(doc, replacedArt, toRect, fromRect, {
      durationMs: RETURN_MS,
      delayMs: RETURN_DELAY_MS,
      scaleTo: 0.95,
    });
  }
}

export const GEAR_FLIGHT_TIMINGS = Object.freeze({
  FLIGHT_MS, RETURN_MS, RETURN_DELAY_MS,
});
