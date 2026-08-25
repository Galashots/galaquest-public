// The authority seam: stepEncounter(state, command) -> { state, events }.
//
// These tests police the seam's PROPERTIES -- purity, freezing, revision, replay -- not the combat
// rules. The rules are covered by encounter.test.mjs, which was deliberately not edited when the
// seam was introduced so that it could act as the control.
//
// Every test here was verified to fail when the property it names is sabotaged. That check matters:
// an adversarial review of this repo previously found three tests whose assertions could not run at
// all, and a test asserting an invariant that is structurally impossible to violate is the same
// class of useless.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTACK_COOLDOWN_SECONDS,
  HERO_MAX_HP,
  SWING_SECONDS,
  BASE_HERO_DAMAGE,
  WOLF_MAX_HP,
  canAttack,
  createEncounter,
  createEncounterState,
  requestAttack,
  stepEncounter,
} from '../public/src/combat/encounter.js';

const STEP = 1 / 60;
const snapshot = (state) => JSON.stringify(state);

function tick(state, overrides = {}) {
  return stepEncounter(state, {
    deltaSeconds: STEP,
    heroPosition: { x: 0, z: 0 },
    heroHeading: 0,
    ...overrides,
  });
}

// --- purity -----------------------------------------------------------------------------------

test('stepEncounter does not touch the state it was handed', () => {
  // Close enough that the wolf walks, bites, and damages the hero -- a step that does nothing is not
  // evidence of purity.
  let state = createEncounterState({ wolfSpawn: { x: 0, z: 1.1 } });
  for (let i = 0; i < 200; i += 1) {
    const before = snapshot(state);
    const result = stepEncounter(state, {
      commandId: i,
      deltaSeconds: STEP,
      heroPosition: { x: 0, z: 0 },
      heroHeading: 0,
      attack: i % 40 === 0,
    });
    assert.equal(snapshot(state), before, `step ${i} wrote through to its input`);
    assert.notEqual(result.state, state, `step ${i} handed back the same object`);
    state = result.state;
  }
  // The loop is only worth running if it actually reached a fight.
  assert.ok(state.hero.hp < HERO_MAX_HP || state.wolf.hp < WOLF_MAX_HP,
    'neither side ever landed a blow, so this proved nothing');
});

test('published state is frozen, so a stray write throws instead of desyncing', () => {
  const { state } = tick(createEncounterState());
  assert.throws(() => { state.wolf.hp = 99; }, TypeError);
  assert.throws(() => { state.hero.hp = 99; }, TypeError);
  assert.throws(() => { state.revision = 99; }, TypeError);
  assert.equal(state.wolf.hp, WOLF_MAX_HP);
});

// --- revision ---------------------------------------------------------------------------------

test('revision counts commands applied, including ones the rules refused', () => {
  let state = createEncounterState({ wolfSpawn: { x: 0, z: 1 } });
  assert.equal(state.revision, 0);

  state = tick(state).state;
  assert.equal(state.revision, 1);

  const accepted = requestAttack(state, 'a');
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.state.revision, 2);

  // Refused -- a swing is already running. The revision still moves: "I saw your command and said
  // no" is a fact the client has to be able to converge on.
  const refused = requestAttack(accepted.state, 'b');
  assert.equal(refused.accepted, false);
  assert.equal(refused.state.revision, 3, 'a refused command still advanced the revision');
  assert.equal(refused.events.length, 0, 'and raised nothing');
});

// --- replay -----------------------------------------------------------------------------------

test('a replayed commandId is a no-op, so a retried attack cannot swing twice', () => {
  const start = createEncounterState({ wolfSpawn: { x: 0, z: 1 } });

  const first = requestAttack(start, 'cmd-7');
  assert.equal(first.accepted, true);
  assert.deepEqual(first.events, [{ type: 'swing' }]);

  // The ack was dropped and the client sent it again.
  const replay = requestAttack(first.state, 'cmd-7');
  assert.equal(replay.state, first.state, 'replay must hand back the very same state');
  assert.equal(replay.events.length, 0, 'and must not raise a second swing');
  assert.equal(replay.state.revision, first.state.revision, 'and must not advance the revision');
});

test('stepEncounter refuses a replayed commandId too, not just requestAttack', () => {
  const start = createEncounterState({ wolfSpawn: { x: 0, z: 1 } });
  const first = tick(start, { commandId: 'tick-1' });
  const replay = tick(first.state, { commandId: 'tick-1' });

  assert.equal(replay.state, first.state, 'time must not advance twice for one command');
  assert.equal(replay.events.length, 0);
});

test('a null commandId is never treated as a replay', () => {
  // main.js has no need of ids yet. If null collided with null, the game would freeze on frame two.
  let state = createEncounterState({ wolfSpawn: { x: 0, z: 1 } });
  const first = tick(state, { commandId: null });
  const second = tick(first.state, { commandId: null });
  assert.equal(second.state.revision, 2, 'two anonymous commands must both apply');
  assert.notEqual(second.state, first.state);
});

// --- the button and the rules cannot drift ------------------------------------------------------

test('canAttack agrees with what a stepEncounter attack command will accept', () => {
  let state = createEncounterState({ wolfSpawn: { x: 0, z: 1.1 } });
  const statesSeen = new Set();

  for (let step = 0; step < 900; step += 1) {
    if (state.hero.downSeconds >= 0) statesSeen.add('down');
    else if (state.hero.swingSeconds >= 0) statesSeen.add('swinging');
    else if (state.hero.cooldown > 0) statesSeen.add('cooling');
    else statesSeen.add('ready');

    const predicted = canAttack(state);
    const asking = step % 120 === 0;
    const result = stepEncounter(state, {
      deltaSeconds: STEP,
      // Facing away, so swings miss and the wolf survives to put the hero down. Without this the
      // wolf dies early and the down state is never reached.
      heroPosition: { x: 0, z: 0 },
      heroHeading: Math.PI,
      attack: asking,
    });
    if (asking) {
      const swung = result.events.some((event) => event.type === 'swing');
      assert.equal(swung, predicted, `canAttack disagreed with the rules at step ${step}`);
    }
    state = result.state;
  }

  // 'cooling' exists only while ATTACK_COOLDOWN_SECONDS is above zero -- it went to 0 on 2026-08-13
  // when the 1.5s swing became the rate limiter. Conditional rather than deleted, so the requirement
  // re-arms by itself if a cooldown returns. See the same note in encounter.test.mjs.
  const reachable = ['ready', 'swinging', 'down'];
  if (ATTACK_COOLDOWN_SECONDS > 0) reachable.push('cooling');
  for (const wanted of reachable) {
    assert.ok(statesSeen.has(wanted), `never reached the ${wanted} state, so this proved little`);
  }
});

// --- the adapter is faithful --------------------------------------------------------------------

test('createEncounter produces exactly what driving the seam directly produces', () => {
  // The strongest guarantee available that introducing the seam moved nothing: run the same script
  // through the legacy stateful object and through the pure function, and require the fights to be
  // identical frame by frame. If the adapter ever drifts from the rules, this is what says so.
  const spawn = { wolfSpawn: { x: 0, z: 1.1 } };
  const wrapped = createEncounter(spawn);
  let raw = createEncounterState(spawn);

  const heroAt = (step) => ({ x: 0, z: Math.sin(step / 90) * 0.6 });

  for (let step = 0; step < 600; step += 1) {
    const asking = step % 37 === 0;
    const position = heroAt(step);

    if (asking) {
      wrapped.requestAttack();
      raw = requestAttack(raw).state;
    }
    wrapped.update(STEP, position, 0);
    const stepped = stepEncounter(raw, { deltaSeconds: STEP, heroPosition: position, heroHeading: 0 });
    raw = stepped.state;

    assert.deepEqual(wrapped.wolf, raw.wolf, `wolf diverged at step ${step}`);
    assert.deepEqual(wrapped.hero, raw.hero, `hero diverged at step ${step}`);
  }

  assert.ok(raw.hero.hp < HERO_MAX_HP || raw.wolf.hp < WOLF_MAX_HP,
    'the script never produced a fight, so agreement is meaningless');
});

test('the wrapper exposes the published state it is standing on', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1 } });
  assert.equal(encounter.state.revision, 0);
  encounter.update(STEP, { x: 0, z: 0 }, 0);
  assert.equal(encounter.state.revision, 1);
  assert.equal(encounter.state.wolf, encounter.wolf, 'the getter and the state must be one object');
});

// --- the events a caller has to handle ----------------------------------------------------------

test('a full kill raises its events through the seam, in order', () => {
  let state = createEncounterState({ wolfSpawn: { x: 0, z: 1 } });
  const seen = [];

  // Blows to kill, derived from the two constants rather than counted as hit points: P2 rescaled
  // both, and a loop that ran WOLF_MAX_HP times would swing thirty times at a wolf that dies on the
  // third -- which would still pass the defeat assertions below while measuring nothing.
  const blowsToKill = Math.ceil(WOLF_MAX_HP / BASE_HERO_DAMAGE);
  for (let blow = 0; blow < blowsToKill; blow += 1) {
    const asked = stepEncounter(state, {
      deltaSeconds: STEP, heroPosition: { x: 0, z: 0 }, heroHeading: 0, attack: true,
    });
    seen.push(...asked.events.map((event) => event.type));
    state = asked.state;

    const settle = SWING_SECONDS + ATTACK_COOLDOWN_SECONDS + 0.02;
    for (let elapsed = 0; elapsed < settle; elapsed += STEP) {
      const result = tick(state);
      seen.push(...result.events.map((event) => event.type));
      state = result.state;
    }
  }

  assert.equal(state.wolf.hp, 0);
  assert.equal(seen.filter((type) => type === 'wolf-defeated').length, 1,
    'exactly one defeat, however many swings followed');
  assert.equal(seen.filter((type) => type === 'wolf-hit').length, blowsToKill - 1);
});
