import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANION_FORMATION,
  companionSlotForHero,
  nextCompanionState,
} from '../public/src/companions/follow.js';

const hero = (x = 0, z = 0, heading = 0) => ({ x, z, heading });
const companion = (x = 0, z = 0, heading = 0, initialized = true) => ({
  x, z, heading, initialized,
});

test('the formation slot trails and offsets the hero in the hero heading frame', () => {
  const slot = companionSlotForHero(hero(4, 7, 0));
  assert.ok(slot.z < 7);
  assert.ok(slot.x > 4);
  assert.equal(slot.heading, 0);
});

test('an uninitialised companion starts in a deterministic nearby formation slot', () => {
  const next = nextCompanionState({ hero: hero(4, 7, 0), companion: companion(99, 99, 0, false), deltaSeconds: 1 / 60 });
  const slot = companionSlotForHero(hero(4, 7, 0));
  assert.equal(next.snapped, true);
  assert.equal(next.mode, 'idle');
  assert.equal(next.x, slot.x);
  assert.equal(next.z, slot.z);
});

test('ordinary movement catches the companion toward the slot instead of teleporting it', () => {
  const next = nextCompanionState({
    hero: hero(0, 0, 0),
    companion: companion(0, -3, 0),
    deltaSeconds: 0.2,
  });
  assert.equal(next.snapped, false);
  assert.equal(next.mode, 'walk');
  assert.ok(next.z > -3);
  assert.ok(next.z < companionSlotForHero(hero()).z);
  assert.ok(next.speed > 0);
});

test('a companion inside the idle band holds position without foot shuffling', () => {
  const slot = companionSlotForHero(hero());
  const next = nextCompanionState({
    hero: hero(),
    companion: companion(slot.x + COMPANION_FORMATION.idleBandMeters / 2, slot.z, 0),
    deltaSeconds: 0.2,
  });
  assert.equal(next.mode, 'idle');
  assert.equal(next.speed, 0);
  assert.equal(next.x, slot.x + COMPANION_FORMATION.idleBandMeters / 2);
  assert.equal(next.z, slot.z);
});

test('a large discontinuity snaps near the hero instead of crossing the map', () => {
  const next = nextCompanionState({
    hero: hero(40, -12, Math.PI / 2),
    companion: companion(-40, 60, 0),
    deltaSeconds: 1 / 60,
  });
  assert.equal(next.snapped, true);
  assert.equal(next.mode, 'idle');
  assert.ok(next.distanceToHero < COMPANION_FORMATION.recoveryBehindMeters + COMPANION_FORMATION.recoveryLateralMeters + 0.01);
});

test('follow heading points into the slot, so turns do not slide sideways', () => {
  const next = nextCompanionState({
    hero: hero(0, 0, Math.PI / 2),
    companion: companion(-1, 0, 0),
    deltaSeconds: 0.2,
  });
  assert.notEqual(next.heading, 0);
  assert.ok(Number.isFinite(next.heading));
});
