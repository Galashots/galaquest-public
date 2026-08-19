// Chapter 2's one rule: walk near an old trail light carrying your own, and it wakes.
//
// The interesting assertions in here are not "the maths works". They are the three design decisions
// that make the beat a beat rather than a collectathon, each of which is easy to break by accident:
//
//   1. NOTHING wakes without the lantern. That is what turns the Chapter 1 reward into a tool.
//   2. Reaching the camp finishes the stretch even if a lamp was missed. Being sent back for one you
//      walked past is the game arguing with a child about something it never asked for.
//   3. The lamps are far enough apart that waking one does not wake the next. "One at a time, up the
//      trail" IS the mechanic; a radius that overlaps two lamps deletes it.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  BRAMBLE_BLOWS_TO_CUT,
  WAKE_RADIUS_METERS,
  bramblesCut,
  nearStandingBramble,
  nearestPointOnBramble,
  noBramblesCut,
  noTrailLightsLit,
  strikeBrambles,
  reachedCamp,
  trailLightsLit,
  wakeTrailLights,
} from '../public/src/world/trail.js';
import { BRAMBLE_HEIGHT_METERS, brambleParts } from '../public/src/world/bramble.js';
import {
  OBJECTIVE_CUT_THE_BRAMBLE,
  OBJECTIVE_FIND_THE_GATE,
  OBJECTIVE_FOLLOW_THE_DARK_TRAIL,
  OBJECTIVE_GUARD_THE_CAMP,
  OBJECTIVE_KEEP_THE_VILLAGE_SAFE,
  OBJECTIVE_SEARCH_THE_CART,
  OBJECTIVE_THE_CAMP,
  objectiveWakeLights,
  questObjectiveFor,
} from '../public/src/world/quest.js';
import { BRAMBLES, CAMP, PROPS, ROAD, TRAIL_LIGHTS } from '../public/src/world/zones/village.js';

const LIT = { marks: 3, lanternUnlocked: true };

// ── the rule ────────────────────────────────────────────────────────────────────────────────────

test('a hero carrying the lantern wakes the light they walk up to, and only that one', () => {
  const lights = [[0, 0], [0, 20], [0, 40]];
  const step = wakeTrailLights(noTrailLightsLit(3), lights, 0, 20, true);
  assert.deepEqual(step.lit, [false, true, false]);
  assert.deepEqual(step.woken, [1]);
});

test('NOTHING wakes without the lantern -- the reward is the tool', () => {
  const lights = [[0, 0]];
  const step = wakeTrailLights(noTrailLightsLit(1), lights, 0, 0, false);
  assert.deepEqual(step.lit, [false]);
  assert.deepEqual(step.woken, []);
  // Standing right on top of it, repeatedly, still does nothing.
  assert.equal(wakeTrailLights(step.lit, lights, 0, 0, undefined).woken.length, 0);
});

test('a light already awake is not woken again, so the chime fires once', () => {
  const lights = [[0, 0]];
  const first = wakeTrailLights(noTrailLightsLit(1), lights, 0, 0, true);
  assert.deepEqual(first.woken, [0]);
  const second = wakeTrailLights(first.lit, lights, 0, 0, true);
  assert.deepEqual(second.woken, []);
  assert.equal(second.lit, first.lit, 'an unchanged tick returns the SAME array, so callers can skip work');
});

test('the radius has an outside: standing a hair past it leaves the light dark', () => {
  const lights = [[0, 0]];
  const justInside = wakeTrailLights(noTrailLightsLit(1), lights, 0, WAKE_RADIUS_METERS - 0.01, true);
  const justOutside = wakeTrailLights(noTrailLightsLit(1), lights, 0, WAKE_RADIUS_METERS + 0.01, true);
  assert.deepEqual(justInside.woken, [0]);
  assert.deepEqual(justOutside.woken, []);
});

test('two lights in reach at once both wake, and both are reported', () => {
  const lights = [[0, 0], [1, 0]];
  const step = wakeTrailLights(noTrailLightsLit(2), lights, 0.5, 0, true);
  assert.deepEqual(step.woken, [0, 1]);
  assert.equal(trailLightsLit(step.lit), 2);
});

test('reachedCamp is a place, not a checklist -- it does not care how many lights are lit', () => {
  assert.equal(reachedCamp({ at: [0, 30], radiusMeters: 4 }, 0, 27), true);
  assert.equal(reachedCamp({ at: [0, 30], radiusMeters: 4 }, 0, 25), false);
  assert.equal(reachedCamp(null, 0, 30), false, 'a zone with no camp must not throw');
});

// ── the layout the rule is played on ────────────────────────────────────────────────────────────

test('the zone really places dormant lights, and TRAIL_LIGHTS is derived from them rather than retyped', () => {
  const dormant = PROPS.filter((prop) => prop.dormant === true);
  assert.ok(dormant.length >= 4, `a trail needs several lights, found ${dormant.length}`);
  assert.deepEqual(TRAIL_LIGHTS.map((at) => [...at]), dormant.map((prop) => [...prop.at]));
  for (const prop of dormant) {
    assert.match(prop.model, /lantern/, 'a dormant prop that is not a lantern would never get a glow');
  }
});

// THE ONE THAT MATTERS: standing AT one lamp must never be standing at the next. Break this and the
// trail wakes itself in two strides and the beat is gone.
//
// Note what this deliberately does NOT require -- that no single POINT can reach two lamps at once.
// That would need every gap over 2 x the radius, and it is not the property a walking child
// experiences: coming up the trail you always cross into the next lamp's radius before you reach the
// midpoint of the pair, so they light one at a time regardless. The only way to catch two together
// is to arrive sideways at the exact midpoint, which costs nothing when it happens.
test('standing at one trail light never wakes the next one', () => {
  for (let i = 0; i < TRAIL_LIGHTS.length; i += 1) {
    for (let j = i + 1; j < TRAIL_LIGHTS.length; j += 1) {
      const [ax, az] = TRAIL_LIGHTS[i];
      const [bx, bz] = TRAIL_LIGHTS[j];
      const gap = Math.hypot(bx - ax, bz - az);
      assert.ok(
        gap > WAKE_RADIUS_METERS,
        `lights ${i + 1} and ${j + 1} are ${gap.toFixed(2)} m apart, inside the ${WAKE_RADIUS_METERS} m reach`,
      );
    }
  }
});

// And the other half of the same design constraint, from the other side: too FAR apart and a child
// standing at one cannot see the next, at which point "follow the lights" is a scavenger hunt.
test('every trail light is within sight of the one before it', () => {
  const FURTHEST_THAT_STILL_READS_METERS = 9;
  for (let i = 1; i < TRAIL_LIGHTS.length; i += 1) {
    const [ax, az] = TRAIL_LIGHTS[i - 1];
    const [bx, bz] = TRAIL_LIGHTS[i];
    const gap = Math.hypot(bx - ax, bz - az);
    assert.ok(gap <= FURTHEST_THAT_STILL_READS_METERS, `lights ${i} and ${i + 1} are ${gap.toFixed(2)} m apart`);
  }
});

test('the trail lights stand BESIDE the trail, near enough to light it and never in it', () => {
  const half = ROAD.widthMeters / 2;
  const toSegment = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax; const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
  };
  for (const [x, z] of TRAIL_LIGHTS) {
    const d = Math.min(...ROAD.points.slice(0, -1).map((p, i) => toSegment(x, z, p[0], p[1], ROAD.points[i + 1][0], ROAD.points[i + 1][1])));
    assert.ok(d > half, `a lamp at [${x}, ${z}] is standing in the road (${d.toFixed(2)} m from its centre)`);
    assert.ok(d < half + 2.5, `a lamp at [${x}, ${z}] is ${d.toFixed(2)} m out -- too far off to light the path`);
  }
});

test('the camp is the LAST light, derived, so moving that lamp moves the trigger with it', () => {
  assert.deepEqual([...CAMP.at], [...TRAIL_LIGHTS[TRAIL_LIGHTS.length - 1]]);
  assert.ok(CAMP.radiusMeters > 0);
});

test('the camp is dressed -- the trail does not end in an empty field again', () => {
  const nearCamp = PROPS.filter((prop) => prop.dormant !== true
    && Math.hypot(prop.at[0] - CAMP.at[0], prop.at[1] - CAMP.at[1]) <= 9);
  assert.ok(nearCamp.length >= 4, `only ${nearCamp.length} props within 9 m of the camp`);
  assert.ok(
    nearCamp.some((prop) => prop.tiltZ),
    'nothing at the camp is knocked over, which is the whole thing a child is supposed to read',
  );
});

// ── what the chip says ──────────────────────────────────────────────────────────────────────────

test('the chip points up the trail before any light is woken, then counts down', () => {
  const trail = (lit, campFound = false) => ({ lights: 6, lit, campFound });
  assert.equal(questObjectiveFor(LIT, true, true, true, trail(0)), OBJECTIVE_FOLLOW_THE_DARK_TRAIL);
  assert.equal(questObjectiveFor(LIT, true, true, true, trail(1)), objectiveWakeLights(5));
  assert.equal(questObjectiveFor(LIT, true, true, true, trail(5)), objectiveWakeLights(1));
  assert.match(objectiveWakeLights(1), /1 more/, 'singular, not "1 more dark lights"');
});

test('reaching the camp ends the stretch even with a light still dark', () => {
  assert.equal(
    questObjectiveFor(LIT, true, true, true, { lights: 6, lit: 4, campFound: true }),
    OBJECTIVE_THE_CAMP,
  );
});

// Rowan answers "Who left this camp?" -- the objective has to follow the story forward rather than
// stay parked on a question that has been answered, the same defect the finished-quest chip had
// before Chapter 2 existed at all.
test('meeting Rowan sends the chip from the mystery to the cart, then to nothing further built yet', () => {
  const trail = (rowanMet, cartSearched) => ({ lights: 6, lit: 6, campFound: true, rowanMet, cartSearched });
  assert.equal(
    questObjectiveFor(LIT, true, true, true, trail(false, false)), OBJECTIVE_THE_CAMP,
    'arrived, has not found Rowan yet -- still the mystery',
  );
  assert.equal(
    questObjectiveFor(LIT, true, true, true, trail(true, false)), OBJECTIVE_SEARCH_THE_CART,
    'Rowan has spoken -- the mystery is answered, the cart is the new instruction',
  );
  assert.equal(
    questObjectiveFor(LIT, true, true, true, trail(true, true)), OBJECTIVE_GUARD_THE_CAMP,
    'cart searched -- no Beacon route exists yet, so the chip must not promise one',
  );
});

test('sabotage: rowanMet alone, without campFound, changes nothing -- the camp gates the whole beat', () => {
  assert.equal(
    questObjectiveFor(LIT, true, true, true, { lights: 6, lit: 4, campFound: false, rowanMet: true, cartSearched: true }),
    objectiveWakeLights(2),
    'still on the trail; Rowan cannot be met before the camp is reached',
  );
});

test('the trail objective never appears before the gate is found', () => {
  assert.equal(
    questObjectiveFor(LIT, true, false, true, { lights: 6, lit: 0, campFound: false }),
    OBJECTIVE_FIND_THE_GATE,
  );
});

test('a zone with no trail still says something rather than going blank', () => {
  assert.equal(questObjectiveFor(LIT, true, true, true, null), OBJECTIVE_KEEP_THE_VILLAGE_SAFE);
  assert.equal(questObjectiveFor(LIT, true, true, true, { lights: 0, lit: 0 }), OBJECTIVE_KEEP_THE_VILLAGE_SAFE);
});

test('sabotage: the countdown is not a constant -- it really tracks how many are left', () => {
  assert.notEqual(objectiveWakeLights(1), objectiveWakeLights(2));
});

// ── the black bramble ───────────────────────────────────────────────────────────────────────────
//
// Chapter 2's second verb: a sword can be used on the WORLD. What is worth pinning here is not the
// arithmetic of three blows but the two things that decide whether the beat happens at all -- that
// the tangle is actually across the trail a child walks, and that one swing cuts one thing.

test('three blows cut a bramble, and the third is the one that breaks it', () => {
  const brambles = [{ at: [0, 0], spanMeters: 5 }];
  const reaches = () => true;
  let blows = noBramblesCut(1);
  for (let i = 1; i < BRAMBLE_BLOWS_TO_CUT; i += 1) {
    const step = strikeBrambles(blows, brambles, reaches);
    assert.deepEqual(step.struck, [0]);
    assert.deepEqual(step.broken, [], `blow ${i} must not break it`);
    blows = step.blows;
  }
  const last = strikeBrambles(blows, brambles, reaches);
  assert.deepEqual(last.broken, [0]);
  assert.equal(bramblesCut(last.blows), 1);
});

test('a cut bramble stops taking blows, so the chime cannot be farmed', () => {
  const brambles = [{ at: [0, 0], spanMeters: 5 }];
  let blows = noBramblesCut(1);
  for (let i = 0; i < BRAMBLE_BLOWS_TO_CUT; i += 1) blows = strikeBrambles(blows, brambles, () => true).blows;
  const after = strikeBrambles(blows, brambles, () => true);
  assert.deepEqual(after.struck, []);
  assert.equal(after.blows, blows, 'an unchanged strike returns the SAME array');
});

test('a swing that reaches nothing changes nothing', () => {
  const blows = noBramblesCut(2);
  const step = strikeBrambles(blows, [{ at: [0, 0], spanMeters: 5 }, { at: [9, 9], spanMeters: 5 }], () => false);
  assert.deepEqual(step.struck, []);
  assert.equal(step.blows, blows);
});

test('one swing cuts ONE bramble even when two are in the arc', () => {
  const step = strikeBrambles(noBramblesCut(2), [{ at: [0, 0], spanMeters: 5 }, { at: [1, 0], spanMeters: 5 }], () => true);
  assert.equal(step.struck.length, 1, 'a blow worth double reads as a bug, not a bonus');
});

test('the chip only claims the bramble while it is standing, and gives it straight back', () => {
  // rotY 0 lays this one along world X, so it runs from x -2.8 to +2.8 at z = 20.
  const brambles = [{ at: [0, 20], rotY: 0, spanMeters: 5.6 }];
  const standing = noBramblesCut(1);
  assert.equal(nearStandingBramble(standing, brambles, 0, 18), true, 'right in front of it');
  assert.equal(nearStandingBramble(standing, brambles, 0, 0), false, 'twenty metres away');
  const cut = [BRAMBLE_BLOWS_TO_CUT];
  assert.equal(nearStandingBramble(cut, brambles, 0, 18), false, 'standing where one USED to be');
});

// The defect this measurement exists to fix, pinned so it cannot come back. Against CENTRE distance
// plus half the span, a 5.6 m tangle claimed the objective chip from 6.8 m away in every direction:
// the running game showed "Cut the black bramble" from the previous lamp, before the child could see
// the thing, and still showed it two metres PAST the tangle on the far side.
test('the bramble claims the chip along its LENGTH, not in a circle around its middle', () => {
  const brambles = [{ at: [0, 20], rotY: 0, spanMeters: 5.6 }];
  const standing = noBramblesCut(1);
  assert.equal(nearStandingBramble(standing, brambles, 2.7, 19), true, 'at one END of it, close up');
  assert.equal(nearStandingBramble(standing, brambles, 0, 15), false, 'five metres short of it');
  assert.equal(nearStandingBramble(standing, brambles, 0, 25), false, 'five metres past it');
});

test('a swing is aimed at the nearest point ON the tangle, not at its midpoint', () => {
  const bramble = { at: [0, 20], rotY: 0, spanMeters: 5.6 };
  const [x, z] = nearestPointOnBramble(bramble, 2.0, 18);
  assert.ok(Math.abs(x - 2.0) < 1e-9, `nearest x was ${x}, not the hero's own x`);
  assert.ok(Math.abs(z - 20) < 1e-9);
  // And it stops at the ends rather than running off along the line.
  const [endX] = nearestPointOnBramble(bramble, 40, 20);
  assert.ok(Math.abs(endX - 2.8) < 1e-9, `clamped to ${endX}, expected the tangle's own end`);
});

test('the objective interrupts the countdown for the bramble and resumes after it', () => {
  const atIt = { lights: 6, lit: 3, campFound: false, atBramble: true };
  assert.equal(questObjectiveFor(LIT, true, true, true, atIt), OBJECTIVE_CUT_THE_BRAMBLE);
  assert.equal(questObjectiveFor(LIT, true, true, true, { ...atIt, atBramble: false }), objectiveWakeLights(3));
});

// THE PLACEMENT TEST. A bramble beside the trail is scenery; a bramble ACROSS it is the beat.
test('every bramble spans the trail it is meant to block, shoulders included', () => {
  const toSegment = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax; const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
  };
  assert.ok(BRAMBLES.length >= 1, 'there is supposed to be one');
  for (const bramble of BRAMBLES) {
    const [x, z] = bramble.at;
    const d = Math.min(...ROAD.points.slice(0, -1).map((p, i) => toSegment(x, z, p[0], p[1], ROAD.points[i + 1][0], ROAD.points[i + 1][1])));
    assert.ok(d < 0.6, `a bramble at [${x}, ${z}] sits ${d.toFixed(2)} m off the trail -- it is beside it, not across it`);
    assert.ok(bramble.spanMeters > ROAD.widthMeters, 'it must be wider than the road, or there is a gap to walk through');
  }
});

// The rotY in the zone data is a literal (deriving it would mean indexing into ROAD.points, a worse
// coupling). THIS is the guard on it: the number has to actually be square to the trail, and would
// go stale silently the moment the trail is re-routed.
test('every bramble stands SQUARE to the trail rather than at an angle across it', () => {
  for (const bramble of BRAMBLES) {
    const [x, z] = bramble.at;
    // The nearest road leg, and the heading of its perpendicular.
    let best = null;
    for (let i = 0; i < ROAD.points.length - 1; i += 1) {
      const [ax, az] = ROAD.points[i];
      const [bx, bz] = ROAD.points[i + 1];
      const dx = bx - ax; const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
      if (best === null || d < best.d) best = { d, dx, dz };
    }
    // The mesh's local +X runs along (cos rotY, -sin rotY) in world x/z; square to the leg means
    // that direction is perpendicular to (dx, dz), i.e. their dot product is ~0.
    const alongX = Math.cos(bramble.rotY);
    const alongZ = -Math.sin(bramble.rotY);
    const legLength = Math.hypot(best.dx, best.dz);
    const dot = (alongX * best.dx + alongZ * best.dz) / legLength;
    assert.ok(Math.abs(dot) < 0.09, `rotY ${bramble.rotY} is ${(Math.asin(Math.min(1, Math.abs(dot))) * 180 / Math.PI).toFixed(1)} degrees off square to the trail`);
  }
});

test('the bramble is chest-high, not a wall -- you can see the trail continuing past it', () => {
  const HERO_HEIGHT_METERS = 1.48;
  assert.ok(BRAMBLE_HEIGHT_METERS < HERO_HEIGHT_METERS, 'over his head and it reads as the end of the world');
  assert.ok(BRAMBLE_HEIGHT_METERS > HERO_HEIGHT_METERS * 0.5, 'under his waist and it reads as a weed');
});

test('the bramble is a tangle and not a black fence: canes lean both ways and cross', () => {
  const parts = brambleParts(5.6);
  const canes = parts.filter((part) => part.name === 'cane');
  assert.ok(canes.length >= 8, `only ${canes.length} canes across 5.6 m`);
  assert.ok(canes.some((c) => c.roll > 0) && canes.some((c) => c.roll < 0), 'they all lean the same way');
  assert.ok(new Set(canes.map((c) => c.size[1].toFixed(3))).size > 1, 'a ruled top edge reads as a fence');
  assert.ok(parts.some((part) => part.name === 'thorn'), 'no thorns');
  // Every box is a real box standing on or above the ground.
  for (const part of parts) {
    assert.ok(part.size.every((n) => n > 0), `${part.name} has a zero dimension`);
    assert.ok(part.at[1] > 0, `${part.name} is at or below the ground`);
  }
});
