// public/src/world/trail.js
//
// THE DARK TRAIL'S ONE RULE: walk near an old trail light carrying your own, and it wakes.
//
// PURE. No three.js, no DOM, no clock -- the same split world/relight.js uses, and for the same
// reason: what the beat IS can then be tested with plain `node --test`, while zoneLoader.js owns the
// glow sprites and main.js owns the banners. Nothing in this file may import anything.
//
// WHY THIS IS THE CHAPTER 2 VERB. Chapter 1 ends with a lantern on the hero's belt, and until now
// that lantern was jewellery -- a reward that changed nothing about what a child could do. Past the
// Wildwood Gate the old trail markers are dark, and carrying that light is what wakes them. So the
// reward becomes a tool, and the sentence a child should end up saying is "our light lets us go
// further".
//
// NO NEW BUTTON, deliberately. The screen already has a stick and an ATTACK, and the Microsoft
// streamed-titles layout work that settled the attack button's position is not something to spend
// again on a third control. Proximity IS the interaction: a young player discovers "walk up to it"
// without being told, and cannot fail to press it.

/**
 * How close is close enough.
 *
 * 3.4 m, and it is deliberately bigger than it looks like it should be. A child steering with a
 * thumb does not walk to a point, they walk PAST things; the radius has to catch a hero who
 * trundles by on the far side of a four-metre road. The lamps stand 2.3-2.8 m off the road's
 * centreline (zones/village.js), so from the far shoulder of the road the worst case is about
 * 2.8 + 2.0 = 4.8 m -- which this deliberately does NOT reach, because a light that wakes while you
 * are still level with the previous one destroys the "one at a time, up the trail" beat that is the
 * whole point. Walking the road's near half wakes it; hugging the far edge means stepping over.
 */
export const WAKE_RADIUS_METERS = 3.4;

/** Nothing woken yet, in the shape wakeTrailLights takes and returns. One boolean per light, in the
 *  order the zone lists them. */
export function noTrailLightsLit(count) {
  return new Array(Math.max(0, count | 0)).fill(false);
}

/**
 * One tick of the trail.
 *
 * @param lit        the current per-light booleans (from noTrailLightsLit, then fed back in)
 * @param lights     [[x, z], ...] in the zone's own order
 * @param heroX/Z    where the hero is now
 * @param carrying   whether this player has actually earned the lantern. FALSE MEANS NOTHING WAKES,
 *                   which is the rule that makes the reward a tool: a child who walks up the trail
 *                   before finishing Chapter 1 finds it dark, and the lights are then a reason to go
 *                   back and finish rather than scenery they have already used up.
 * @returns { lit, woken } -- `woken` is the indices that changed THIS tick, so the caller can play a
 *          sound and count them without diffing two arrays itself. Never mutates `lit`.
 *
 * Returns the same array instance when nothing changed, so a caller can cheaply skip work on the
 * overwhelming majority of frames (`next.lit === lit`).
 */
export function wakeTrailLights(lit, lights, heroX, heroZ, carrying) {
  if (carrying !== true) return { lit, woken: [] };
  let next = null;
  const woken = [];
  for (let i = 0; i < lights.length; i += 1) {
    if (lit[i] === true) continue;
    const [x, z] = lights[i];
    if (Math.hypot(heroX - x, heroZ - z) > WAKE_RADIUS_METERS) continue;
    if (next === null) next = lit.slice();
    next[i] = true;
    woken.push(i);
  }
  return next === null ? { lit, woken: [] } : { lit: next, woken };
}

/** How many are awake. Trivial, and here rather than at three call sites. */
export function trailLightsLit(lit) {
  let n = 0;
  for (const one of lit) if (one === true) n += 1;
  return n;
}

/**
 * Whether a hero standing here has reached the camp at the end of the trail.
 *
 * Separate from the lights on purpose: a child can arrive at the clearing having skipped a lamp (the
 * radius above does not catch a hero hugging the far shoulder), and the payoff for GETTING THERE
 * must not be withheld because they missed one on the way. Reaching the place is the achievement;
 * the lights are the road to it.
 */
export function reachedCamp(camp, heroX, heroZ) {
  if (!camp?.at) return false;
  return Math.hypot(heroX - camp.at[0], heroZ - camp.at[1]) <= camp.radiusMeters;
}

// ── the black bramble ──────────────────────────────────────────────────────────────────────────
//
// Three blows. Not one, because a single tap is a switch and gives a child nothing to lean into; not
// five, because the same swing five times over is the shape of a chore. Three is the number the
// wolves already use (WOLF_MAX_HP), so the hand already knows it -- a child who has fought anything
// in this game has learnt "three hits kills a thing" and this spends that lesson rather than
// teaching a second one.
export const BRAMBLE_BLOWS_TO_CUT = 3;

// How much further than a wolf the sword reaches into a bramble, in metres. main.js adds this to
// combat/encounter.js's ATTACK_REACH (this module may not import anything, so it cannot add them
// itself, and duplicating ATTACK_REACH here would be exactly the drift GQ-007 exists to stop).
//
// MEASURED, in the running game, not chosen. A hero walked up the trail at a bramble stops about
// 2.1 m from its nearest cane -- and the probe that found that reported eight swings landing
// nothing, because ATTACK_REACH is 1.7. The reason is the missing collision: nothing stops a child
// AT the tangle, so where they end up is wherever they happened to release the stick, which is
// always short of it or already through it. 1.2 m covers both, and it is defensible on its own
// terms as well -- a wolf is a body you have to close on, a hedge is a thing you can chop at.
export const BRAMBLE_EXTRA_REACH_METERS = 1.2;

/** Nothing cut yet, in the shape strikeBrambles takes and returns: blows landed, per bramble. */
export function noBramblesCut(count) {
  return new Array(Math.max(0, count | 0)).fill(0);
}

/**
 * Resolve one sword blow against the brambles.
 *
 * @param blows     the current per-bramble blow counts (from noBramblesCut, then fed back in)
 * @param brambles  [{ at: [x, z], spanMeters }, ...] in the zone's own order
 * @param reaches   (at) => boolean -- whether the hero's swing reaches that point. Passed IN rather
 *                  than computed here because the reach and arc rules belong to combat/encounter.js,
 *                  which this module may not import (it may not import anything) and should not
 *                  duplicate: one definition of "did the sword get there", two callers.
 * @returns { blows, struck, broken } -- indices struck by this blow, and of those, the ones this
 *          blow finished off. Never mutates `blows`; returns the same array when nothing was hit.
 *
 * ONE BRAMBLE PER SWING, deliberately, even if two overlap the arc: a blow that cuts two things at
 * once reads as a bug rather than as a bonus, and there is no swing in this game that is supposed to
 * be worth double.
 */
export function strikeBrambles(blows, brambles, reaches) {
  for (let i = 0; i < brambles.length; i += 1) {
    if (blows[i] >= BRAMBLE_BLOWS_TO_CUT) continue;
    if (!reaches(brambles[i])) continue;
    const next = blows.slice();
    next[i] += 1;
    return { blows: next, struck: [i], broken: next[i] >= BRAMBLE_BLOWS_TO_CUT ? [i] : [] };
  }
  return { blows, struck: [], broken: [] };
}

/** How many brambles are fully cut. */
export function bramblesCut(blows) {
  let n = 0;
  for (const count of blows) if (count >= BRAMBLE_BLOWS_TO_CUT) n += 1;
  return n;
}

/**
 * Is the hero close enough to a still-standing bramble for the game to be talking about it?
 *
 * Used only to decide what the objective chip says.
 *
 * Measured to the tangle's own LINE, not to its centre point, and this is the second version. The
 * first took centre distance and allowed half the span plus a margin, which sounds equivalent and is
 * not: a 5.6 m tangle then claimed the chip from 6.8 m away in EVERY direction, and the running game
 * showed the chip reading "Cut the black bramble" from the previous lamp -- before the child could
 * see the thing -- and still reading it two metres PAST the tangle on the far side. A child was being
 * told to cut something that was behind them.
 *
 * Against the line, the margin means what it says: 2.5 m is arm's length plus a step, from anywhere
 * along a tangle of any width.
 */
export const BRAMBLE_NOTICE_MARGIN_METERS = 2.5;

/** The two ends of a bramble in world x/z, from its centre, span and rotY. The mesh's own local +X
 *  runs along (cos rotY, -sin rotY) -- bramble.js lays the canes out along X -- so the tangle is the
 *  segment half a span either side of `at` along that direction. */
export function brambleEnds(bramble) {
  const half = bramble.spanMeters / 2;
  const alongX = Math.cos(bramble.rotY ?? 0) * half;
  const alongZ = -Math.sin(bramble.rotY ?? 0) * half;
  const [x, z] = bramble.at;
  return [[x - alongX, z - alongZ], [x + alongX, z + alongZ]];
}

function closestOnSegment(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared));
  return [ax + t * dx, az + t * dz];
}

function distanceToSegment(px, pz, from, to) {
  const [x, z] = closestOnSegment(px, pz, from, to);
  return Math.hypot(px - x, pz - z);
}

/**
 * The point ON the tangle nearest the hero -- what a sword swing should actually be aimed at.
 *
 * The first version handed encounter.js's isWithinStrike the bramble's CENTRE with the half-span
 * added to the reach, which is wrong in the one way that matters: the arc check then measures the
 * angle to the middle of a five-metre hedge, so standing at one end and facing the part of it
 * directly in front of you counts as swinging sideways and misses.
 */
export function nearestPointOnBramble(bramble, heroX, heroZ) {
  const [from, to] = brambleEnds(bramble);
  return closestOnSegment(heroX, heroZ, from, to);
}

export function nearStandingBramble(blows, brambles, heroX, heroZ) {
  for (let i = 0; i < brambles.length; i += 1) {
    if (blows[i] >= BRAMBLE_BLOWS_TO_CUT) continue;
    const [from, to] = brambleEnds(brambles[i]);
    if (distanceToSegment(heroX, heroZ, from, to) <= BRAMBLE_NOTICE_MARGIN_METERS) return true;
  }
  return false;
}

/** How far the hero is from a bramble's own body, for the strike reach. Same line measurement as
 *  above, exported so main.js does not have to reconstruct it -- the sword should reach the tangle
 *  anywhere along it, not only at the one point its coordinate happens to sit. */
export function distanceToBramble(bramble, heroX, heroZ) {
  const [from, to] = brambleEnds(bramble);
  return distanceToSegment(heroX, heroZ, from, to);
}
