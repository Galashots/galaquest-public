import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANION_FORMATION,
  companionSlotForHero,
  nextCompanionState,
} from '../public/src/companions/follow.js';
import { selectPrototypeCompanionClips } from '../public/src/companions/prototypeCompanion.js';
import {
  COMPANION_HAPPY_REACTION,
  advanceHappyReaction,
  createHappyReactionState,
  requestHappyReaction,
} from '../public/src/companions/bondReaction.js';

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

test('sustained hero travel stays in locomotion and fully settles after stopping', () => {
  const deltaSeconds = 1 / 60;
  const heroSpeed = 2.8;
  let movingHero = hero();
  let state = nextCompanionState({
    hero: movingHero,
    companion: { ...companionSlotForHero(movingHero), initialized: false },
    deltaSeconds,
  });
  const sustainedModes = [];

  for (let frame = 0; frame < 180; frame += 1) {
    movingHero = hero(0, (frame + 1) * heroSpeed * deltaSeconds, 0);
    state = nextCompanionState({ hero: movingHero, companion: state, deltaSeconds });
    sustainedModes.push(state.mode);
  }

  assert.ok(sustainedModes.slice(30).every((mode) => mode !== 'idle'), 'steady travel must not stutter into idle');

  for (let frame = 0; frame < 30; frame += 1) {
    state = nextCompanionState({ hero: movingHero, companion: state, deltaSeconds });
  }
  assert.equal(state.mode, 'idle');
  assert.ok(state.distanceToSlot < 0.001, 'a stopped hero should leave the companion on its slot');
});

test('sustained travel then multi-second idle ignores settled-state position noise', () => {
  const deltaSeconds = 1 / 60;
  const heroSpeed = 2.8;
  let movingHero = hero();
  let state = nextCompanionState({
    hero: movingHero,
    companion: { ...companionSlotForHero(movingHero), initialized: false },
    deltaSeconds,
  });

  for (let frame = 0; frame < 240; frame += 1) {
    movingHero = hero(0, (frame + 1) * heroSpeed * deltaSeconds, 0);
    state = nextCompanionState({ hero: movingHero, companion: state, deltaSeconds });
  }
  const stoppedHero = movingHero;
  for (let frame = 0; frame < 60; frame += 1) {
    state = nextCompanionState({ hero: stoppedHero, companion: state, deltaSeconds });
  }

  const settledPosition = { x: state.x, z: state.z };
  const settledHeading = state.heading;
  const stationaryModes = [];
  for (let frame = 0; frame < 120; frame += 1) {
    // This is deliberately above the old per-frame motion epsilon but still below a meaningful
    // gameplay movement step: a deterministic stand-in for reconciliation/float noise after stop.
    const noise = frame % 2 === 0 ? 0.0003 : -0.0003;
    const noisyHero = hero(stoppedHero.x + noise, stoppedHero.z, stoppedHero.heading);
    state = nextCompanionState({ hero: noisyHero, companion: state, deltaSeconds });
    stationaryModes.push(state.mode);
  }

  assert.ok(stationaryModes.every((mode) => mode === 'idle'), 'settled noise must not restart locomotion');
  assert.ok(Math.hypot(state.x - settledPosition.x, state.z - settledPosition.z) < 0.001);
  assert.ok(Math.abs(state.heading - settledHeading) < 0.001, 'settled facing must remain stable');
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

test('prototype presenter maps the shipped wolf movement clip to walk and run', () => {
  const animations = ['idle', 'walk', 'bite', 'hit', 'death'].map((name) => ({ name }));
  const clips = selectPrototypeCompanionClips(animations);

  assert.equal(clips.idle.name, 'idle');
  assert.equal(clips.walk.name, 'walk');
  assert.strictEqual(clips.run, clips.walk, 'run intentionally reuses the shipped walk clip');
  assert.equal(selectPrototypeCompanionClips([{ name: 'idle' }, { name: 'walking' }]).walk, null);
});

test('direct companion happiness accepts one tap and throttles repeated taps', () => {
  const first = requestHappyReaction(createHappyReactionState());
  assert.equal(first.accepted, true);
  assert.equal(first.state.triggerCount, 1);
  assert.equal(first.state.activeSeconds, COMPANION_HAPPY_REACTION.durationSeconds);

  const blocked = requestHappyReaction(first.state);
  assert.equal(blocked.accepted, false);
  assert.strictEqual(blocked.state, first.state);

  const ready = advanceHappyReaction(
    advanceHappyReaction(first.state, 0.25),
    COMPANION_HAPPY_REACTION.cooldownSeconds,
  );
  const second = requestHappyReaction(ready);
  assert.equal(second.accepted, true);
  assert.equal(second.state.triggerCount, 2);
});
