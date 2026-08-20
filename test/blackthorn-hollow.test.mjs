// The Blackthorn Hollow: the heavy blackthorn wall near the Old Beacon that only the Wildwood Blade
// opens, and the secret pocket behind it.
//
// What these tests pin, in the fantasy's own words: the starter sword BOUNCES forever and costs
// nothing; the Blade cuts on the first blow and finishes on the second; the tear latches for good;
// the chest opens exactly once; and the wall really is the bramble's heavier, taller, darker elder
// rather than a recolour. Every colour is checked against the file it is imported from, never
// against a restated hex (docs/MISTAKES.md GQ-007).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  BLACKTHORN_BLOWS_TO_TEAR,
  BLACKTHORN_COLOR,
  BLACKTHORN_HEIGHT_METERS,
  BLACKTHORN_NOTICE_MARGIN_METERS,
  BLACKTHORN_THORN_TIP_COLOR,
  CHEST_TOTAL_HEIGHT_METERS,
  HOLLOW_MARKER_ROT_Y,
  barrierEnds,
  barrierParts,
  chestParts,
  createHollowState,
  distanceToBarrier,
  nearBarrier,
  nearestPointOnBarrier,
  openChest,
  pocketParts,
  strikeBarrier,
  tearCurve,
} from '../public/src/world/blackthornHollow.js';
import { BRAMBLE_COLOR, BRAMBLE_HEIGHT_METERS } from '../public/src/world/bramble.js';
import { BRAMBLE_BLOWS_TO_CUT } from '../public/src/world/trail.js';
import { STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
import { METAL_COLOR } from '../public/src/world/wildwoodBlade.js';
import { GATE_WOOD_COLOR } from '../public/src/world/wildwoodGate.js';
import { BEACON_IRON_COLOR, BEACON_STONE_COLOR } from '../public/src/world/oldBeacon.js';

const HERO_HEIGHT_METERS = 1.48;

// ── rules: the key and the bounce ────────────────────────────────────────────────────────────────

test('the Blade is a key, not a grind: fewer blows than the trail bramble asks of any sword', () => {
  assert.equal(BLACKTHORN_BLOWS_TO_TEAR, 2);
  assert.ok(BLACKTHORN_BLOWS_TO_TEAR < BRAMBLE_BLOWS_TO_CUT,
    'the right key must open this faster than the common bramble falls, or holding it means nothing');
});

test('the starter sword bounces: too-tough every time, state untouched, forever repeatable', () => {
  const state = createHollowState();
  let current = state;
  for (let swing = 0; swing < 5; swing += 1) {
    const { state: next, events } = strikeBarrier(current, STARTER_SWORD_ID);
    assert.deepEqual(events, [{ type: 'blackthorn-tough' }]);
    assert.equal(next, current, 'a bounce must return the SAME state reference -- nothing happened');
    current = next;
  }
  assert.equal(current.barrierBlows, 0);
  assert.equal(current.barrierTorn, false);
});

test('an unknown weapon id is treated as too-tough, never thrown', () => {
  const state = createHollowState();
  const { state: next, events } = strikeBarrier(state, 'flaming_axe_of_dev');
  assert.deepEqual(events, [{ type: 'blackthorn-tough' }]);
  assert.equal(next, state);
  const missing = strikeBarrier(state, undefined);
  assert.deepEqual(missing.events, [{ type: 'blackthorn-tough' }]);
});

test('the Wildwood Blade advances: first blow proves it works, second tears it open', () => {
  const first = strikeBarrier(createHollowState(), WILDWOOD_BLADE_ID);
  assert.deepEqual(first.events, [{ type: 'blackthorn-cut', blows: 1 }]);
  assert.equal(first.state.barrierBlows, 1);
  assert.equal(first.state.barrierTorn, false);

  const second = strikeBarrier(first.state, WILDWOOD_BLADE_ID);
  assert.deepEqual(second.events, [
    { type: 'blackthorn-cut', blows: 2 },
    { type: 'blackthorn-torn' },
  ]);
  assert.equal(second.state.barrierTorn, true);
});

test('a starter-sword bounce between Blade blows neither resets nor advances the count', () => {
  const first = strikeBarrier(createHollowState(), WILDWOOD_BLADE_ID);
  const bounce = strikeBarrier(first.state, STARTER_SWORD_ID);
  assert.equal(bounce.state, first.state);
  assert.equal(bounce.state.barrierBlows, 1);
  const finish = strikeBarrier(bounce.state, WILDWOOD_BLADE_ID);
  assert.equal(finish.state.barrierTorn, true);
});

test('the tear latches: once torn, every further contact from any weapon is silent', () => {
  let { state } = strikeBarrier(createHollowState(), WILDWOOD_BLADE_ID);
  ({ state } = strikeBarrier(state, WILDWOOD_BLADE_ID));
  for (const weapon of [WILDWOOD_BLADE_ID, STARTER_SWORD_ID, 'nonsense']) {
    const after = strikeBarrier(state, weapon);
    assert.equal(after.state, state, 'a torn barrier must never change state again');
    assert.deepEqual(after.events, [], 'an open door has nothing left to say');
  }
  assert.equal(state.barrierBlows, BLACKTHORN_BLOWS_TO_TEAR, 'the count stops at the latch');
});

test('the chest opens exactly once', () => {
  const first = openChest(createHollowState());
  assert.deepEqual(first.events, [{ type: 'hollow-chest-opened' }]);
  assert.equal(first.state.chestOpened, true);
  const again = openChest(first.state);
  assert.equal(again.state, first.state);
  assert.deepEqual(again.events, []);
});

test('every published state is frozen -- the transitions are the only way forward', () => {
  const state = createHollowState();
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(strikeBarrier(state, WILDWOOD_BLADE_ID).state));
  assert.ok(Object.isFrozen(openChest(state).state));
});

// ── geometry helpers, mirroring trail.js's bramble discipline ────────────────────────────────────

test('nearestPointOnBarrier projects onto a ROTATED span and clamps to its ends', () => {
  // rotY = pi/2 turns local +X to world (0, -1): a 6 m barrier at [4, -2] runs from [4, 1] to [4, -5].
  const barrier = { at: [4, -2], rotY: Math.PI / 2, spanMeters: 6 };
  const [endA, endB] = barrierEnds(barrier);
  assert.ok(Math.abs(endA[0] - 4) < 1e-9 && Math.abs(endA[1] - 1) < 1e-9);
  assert.ok(Math.abs(endB[0] - 4) < 1e-9 && Math.abs(endB[1] - (-5)) < 1e-9);

  // A hero beside the middle projects straight across.
  const mid = nearestPointOnBarrier(barrier, 6, -2);
  assert.ok(Math.abs(mid[0] - 4) < 1e-9 && Math.abs(mid[1] - (-2)) < 1e-9);
  assert.ok(Math.abs(distanceToBarrier(barrier, 6, -2) - 2) < 1e-9);

  // A hero past the end gets the END, never a point off the tangle.
  const clamped = nearestPointOnBarrier(barrier, 4, 10);
  assert.ok(Math.abs(clamped[0] - 4) < 1e-9 && Math.abs(clamped[1] - 1) < 1e-9);
});

test('nearBarrier means the LINE, not the centre: true anywhere along the span, false beyond the margin', () => {
  const barrier = { at: [0, 0], rotY: 0, spanMeters: 8 };
  // Standing off the far END of the span, well outside centre-distance but within line-distance.
  assert.ok(nearBarrier(barrier, 3.8, BLACKTHORN_NOTICE_MARGIN_METERS - 0.1));
  assert.ok(!nearBarrier(barrier, 0, BLACKTHORN_NOTICE_MARGIN_METERS + 0.1));
  assert.ok(!nearBarrier(barrier, 4 + BLACKTHORN_NOTICE_MARGIN_METERS + 0.1, 0));
});

test('sabotage: nearestPointOnBarrier is not the centre -- a hero at one end gets that end, not `at`', () => {
  const barrier = { at: [10, 5], rotY: 0.7, spanMeters: 6 };
  const [, endB] = barrierEnds(barrier);
  const nearest = nearestPointOnBarrier(barrier, endB[0] + 0.5, endB[1] - 0.5);
  const toEnd = Math.hypot(nearest[0] - endB[0], nearest[1] - endB[1]);
  const toCentre = Math.hypot(nearest[0] - 10, nearest[1] - 5);
  assert.ok(toEnd < 1e-6, 'the nearest point should be the near end of the span');
  assert.ok(toCentre > 1, 'a centre-point answer would have failed the swing-arc check from the ends');
});

// ── the wall really is the bramble's HEAVY elder ─────────────────────────────────────────────────

test('taller than the trail bramble, and over the hero\'s head at the middle -- it hides, the bramble shows', () => {
  assert.ok(BLACKTHORN_HEIGHT_METERS > BRAMBLE_HEIGHT_METERS,
    'the heavy sibling must out-top the trail bramble or the contrast is a rumour');
  const tops = barrierParts(5).filter((p) => p.name === 'cane').map((p) => p.at[1] + p.size[1] / 2);
  assert.ok(Math.max(...tops) > HERO_HEIGHT_METERS,
    'no cane clears the hero -- the pocket behind would be visible over the wall');
});

test('heavier canes than the bramble\'s 0.16 m, and a real lattice: canes, thorns, runners', () => {
  const parts = barrierParts(5);
  const canes = parts.filter((p) => p.name === 'cane');
  assert.ok(canes.length >= 10, 'a 5 m wall this dense should pack more than ten canes');
  for (const cane of canes) assert.ok(cane.size[0] >= 0.2, 'a heavy blackthorn cane under 0.2 m reads as trail bramble');
  assert.ok(parts.some((p) => p.name === 'runner'), 'no runners -- a row of sticks, not a woven mass');
  assert.ok(parts.some((p) => p.name === 'thorn' || p.name === 'thorn-tip'), 'a blackthorn without thorns');
});

test('the colour is DERIVED darker than BRAMBLE_COLOR, same family, and the dead-grey tips exist', () => {
  const channels = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const bramble = channels(BRAMBLE_COLOR);
  const blackthorn = channels(BLACKTHORN_COLOR);
  for (let i = 0; i < 3; i += 1) {
    assert.ok(blackthorn[i] < bramble[i], 'every channel darker: the elder, not a recolour');
  }
  const parts = barrierParts(5);
  assert.ok(parts.some((p) => p.color === BLACKTHORN_THORN_TIP_COLOR),
    'no pale thorn tips -- the one value jump that says OLD is missing');
  for (const part of parts) {
    assert.ok(part.color === BLACKTHORN_COLOR || part.color === BLACKTHORN_THORN_TIP_COLOR,
      `${part.name} wears a colour this wall never declared`);
  }
});

test('the wall splits into two real halves at the middle, so the tear can pull them apart', () => {
  const span = 5;
  const parts = barrierParts(span);
  const left = parts.filter((p) => p.half === 'left');
  const right = parts.filter((p) => p.half === 'right');
  assert.ok(left.length > 0 && right.length > 0, 'both halves must exist or the tear has nothing to part');
  for (const part of left) assert.ok(part.at[0] <= 0.01, `${part.name} tagged left but sits right of the split`);
  for (const part of right) assert.ok(part.at[0] >= -0.01, `${part.name} tagged right but sits left of the split`);
  for (const part of parts) assert.ok(part.half === 'left' || part.half === 'right', `${part.name} belongs to no half`);
});

test('the tear really opens: starts shut, moves through the middle, ends done and gone', () => {
  const shut = tearCurve(0);
  assert.equal(shut.leanRadians, 0);
  assert.equal(shut.opacity, 1);
  assert.equal(shut.done, false);
  const mid = tearCurve(0.4);
  assert.ok(mid.leanRadians > 0, 'sabotage guard: the curve is not a constant');
  assert.ok(mid.opacity < 1 && mid.opacity > 0);
  const open = tearCurve(10);
  assert.equal(open.done, true);
  assert.ok(open.opacity <= 0.01, 'a finished tear should leave nothing to see');
  assert.ok(open.leanRadians > mid.leanRadians, 'the halves keep parting to the end');
});

// ── the pocket: chest, clue, tease ───────────────────────────────────────────────────────────────

test('the chest is knee-high treasure, not furniture: well under the hero', () => {
  assert.ok(CHEST_TOTAL_HEIGHT_METERS < HERO_HEIGHT_METERS * 0.5,
    'a secret chest taller than half the child who finds it reads as a wardrobe');
  const { base, lid, hingeAt } = chestParts();
  for (const part of base) {
    assert.ok(part.at[1] - part.size[1] / 2 >= -1e-9, `${part.name} is sunk into the ground`);
    assert.ok(part.at[1] + part.size[1] / 2 <= CHEST_TOTAL_HEIGHT_METERS + 0.05,
      `${part.name} pokes above the chest's own stated height`);
  }
  assert.ok(lid.length > 0, 'a chest with no lid cannot open');
  assert.ok(hingeAt[1] > 0, 'the hinge sits on top of the base, not on the ground');
});

test('the chest wears imported colours only: gate timber and the Blade\'s own brass', () => {
  const { base, lid } = chestParts();
  const colors = new Set([...base, ...lid].map((p) => p.color));
  assert.ok(colors.has(GATE_WOOD_COLOR), 'the body must be the gate\'s own timber, imported');
  assert.ok(colors.has(METAL_COLOR), 'the one brass band must be the Blade\'s own fitting metal, imported');
  assert.equal(colors.size, 2, 'aged timber plus ONE brass band -- any third colour is a restated hex');
});

test('the marker stone borrows the Beacon\'s slate and its groove points north-east -- Arc 2\'s seed', () => {
  const parts = pocketParts();
  const marker = parts.find((p) => p.name === 'marker-shaft');
  const groove = parts.find((p) => p.name === 'marker-groove');
  assert.ok(marker && groove, 'the pocket needs its waystone-like marker and its carved groove');
  assert.equal(marker.color, BEACON_STONE_COLOR, 'the marker is the Beacon\'s own slate, imported');
  assert.equal(groove.yaw, HOLLOW_MARKER_ROT_Y);
  // Local +X under rotY maps to (cos, -sin): NE means +x (east) and -z (north), both strictly.
  assert.ok(Math.cos(HOLLOW_MARKER_ROT_Y) > 0, 'the groove must point east of north-south');
  assert.ok(-Math.sin(HOLLOW_MARKER_ROT_Y) < 0, 'the groove must point north of east-west');
});

test('the story clue and the dressing are all present, and the broken lantern is cold dead iron', () => {
  const names = new Set(pocketParts().map((p) => p.name));
  assert.ok(names.has('satchel-body'), 'the fallen ranger\'s satchel is the environmental clue');
  assert.ok(names.has('rope-coil'), 'missing the rope coil');
  assert.ok(names.has('broken-lantern'), 'missing the broken lantern');
  const lantern = pocketParts().find((p) => p.name === 'broken-lantern');
  assert.equal(lantern.color, BEACON_IRON_COLOR,
    'the dead lantern is the Beacon\'s own cold iron, imported -- never a warm, lit colour');
});
