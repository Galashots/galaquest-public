// the owner's ruling, 2026-08-13: a dead wolf comes back after 10 seconds, so the reward loop's
// mark-per-kill has repeatable kills instead of a wolf that stays dead for the process's lifetime
// (Phase B5's open item, the private engineering archive). This is a rules change to the party engine --
// stepParty/advancePartyFight in public/src/combat/encounter.js -- covered on its own here rather
// than folded into encounter-party.test.mjs, a pre-existing file that stays unedited.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  WOLF_AGGRO_RANGE,
  WOLF_MAX_HP,
  WOLF_RESPAWN_SECONDS,
  addHero,
  createEncounterState,
  createPartyEncounterState,
  requestAttack,
  requestPartyAttack,
  stepEncounter,
  stepParty,
} from '../public/src/combat/encounter.js';

const STEP = 1 / 60;
const WOLF_SPAWN = { x: 0, z: 1 };
// Well outside WOLF_AGGRO_RANGE, so a respawned wolf has nobody to chase and stays 'idle' long
// enough to observe -- the moment it woke up is the thing under test here, not what it does next.
const FAR_AWAY = { x: 0, z: WOLF_SPAWN.z + WOLF_AGGRO_RANGE * 5 };

/** Advance `state` by `seconds` of ticks, with the hero standing at `position` throughout. */
function advance(state, seconds, position, events = []) {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    const stepped = stepParty(state, {
      deltaSeconds: STEP,
      heroes: { hero: { position, heading: 0 } },
    });
    state = stepped.state;
    events.push(...stepped.events);
  }
  return state;
}

/**
 * Kill the wolf and stop on the exact tick it first reads 'dead', so state.wolf.modeSeconds -- which
 * resets to 0 on entry to 'dead' -- is the true elapsed dead-time the tests below build on, not a
 * fixed-duration guess that could already have run past the respawn threshold before the timed
 * assertions even start.
 */
function killWolf() {
  let state = createPartyEncounterState({ wolfSpawn: WOLF_SPAWN, heroIds: [] });
  state = addHero(state, 'hero');

  // Retry the attack every tick; requestPartyAttack is a no-op whenever heroCanAttack() says no
  // (mid-swing or on cooldown), so this cannot double-swing -- it just starts one the instant the
  // rules allow it, without this file having to hand-time SWING_SECONDS/ATTACK_COOLDOWN_SECONDS itself.
  for (let tick = 0; tick < 100000 && state.wolf.mode !== 'dead'; tick += 1) {
    const attacked = requestPartyAttack(state, 'hero', `kill:${tick}`);
    state = attacked.state;
    const stepped = stepParty(state, {
      deltaSeconds: STEP,
      heroes: { hero: { position: WOLF_SPAWN, heading: 0 } },
    });
    state = stepped.state;
  }
  assert.equal(state.wolf.mode, 'dead', 'setup failed: the wolf never finished dying');
  assert.ok(state.wolf.modeSeconds < STEP * 2, 'setup overshot the death transition by more than one tick');
  // Once dead, move the hero away so the post-death waiting the tests below do does not also drive
  // the fight -- separateFromWolf/aggro are irrelevant to what this file is checking.
  return state;
}

test('WOLF_RESPAWN_SECONDS is 10, the owner\'s number', () => {
  assert.equal(WOLF_RESPAWN_SECONDS, 10);
});

// RED before the fix: this reproduces Phase B5's open item -- a dead wolf accumulates modeSeconds
// and, without a respawn rule, simply stays dead forever. Advancing 9.9s past death must still find
// it dead; 10.0s must find it back at full hp, idle, at its spawn point, with the event raised.
test('a dead wolf stays dead at 9.9 seconds', () => {
  let state = killWolf();
  state = advance(state, WOLF_RESPAWN_SECONDS - 0.1, FAR_AWAY);
  assert.equal(state.wolf.mode, 'dead', `expected still dead at ${WOLF_RESPAWN_SECONDS - 0.1}s`);
  assert.equal(state.wolf.hp, 0);
});

test('a dead wolf is back at full hp, idle, at its spawn, at 10.0 seconds', () => {
  let state = killWolf();
  const events = [];
  state = advance(state, WOLF_RESPAWN_SECONDS + 0.05, FAR_AWAY, events);

  assert.equal(state.wolf.mode, 'idle', 'the wolf must come back idle, not mid-transition');
  assert.equal(state.wolf.hp, WOLF_MAX_HP);
  assert.equal(state.wolf.x, WOLF_SPAWN.x);
  assert.equal(state.wolf.z, WOLF_SPAWN.z);

  const respawnEvents = events.filter((event) => event.type === 'wolf-respawned');
  assert.equal(respawnEvents.length, 1, 'expected exactly one wolf-respawned event');
  // Party path: no heroId on this event -- nobody in particular caused a respawn, the same reasoning
  // bite-missed already uses for an event that isn't anyone's.
  assert.ok(!('heroId' in respawnEvents[0]), 'wolf-respawned must not carry a heroId');
});

test('the wolf only respawns once, not every tick past the threshold', () => {
  let state = killWolf();
  const events = [];
  // Run well past the threshold -- if the reset re-fired every tick this would report many events
  // instead of one, and the wolf would never be able to die again from this state.
  state = advance(state, WOLF_RESPAWN_SECONDS + 1, FAR_AWAY, events);
  const respawnEvents = events.filter((event) => event.type === 'wolf-respawned');
  assert.equal(respawnEvents.length, 1);
  assert.equal(state.wolf.mode, 'idle');
});

function advanceSolo(state, seconds, position, events = []) {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    const stepped = stepEncounter(state, { deltaSeconds: STEP, heroPosition: position, heroHeading: 0 });
    state = stepped.state;
    events.push(...stepped.events);
  }
  return state;
}

function killSoloWolf() {
  let state = createEncounterState({ wolfSpawn: WOLF_SPAWN });
  for (let tick = 0; tick < 100000 && state.wolf.mode !== 'dead'; tick += 1) {
    const attacked = requestAttack(state, `kill:${tick}`);
    state = attacked.state;
    state = stepEncounter(state, { deltaSeconds: STEP, heroPosition: WOLF_SPAWN, heroHeading: 0 }).state;
  }
  return state;
}

// The solo API is a thin wrapper over the same party engine (Design ruling 1), so this is coverage
// of the wrapper's plumbing, not a second copy of the rule -- combat-purity.test.mjs's control
// already guarantees the two cannot drift apart.
test('the solo wrapper also respawns the wolf, with no heroId on the event', () => {
  let state = killSoloWolf();
  assert.equal(state.wolf.mode, 'dead', 'setup failed: solo wolf never finished dying');
  const events = [];
  state = advanceSolo(state, WOLF_RESPAWN_SECONDS + 0.05, FAR_AWAY, events);

  assert.equal(state.wolf.mode, 'idle');
  assert.equal(state.wolf.hp, WOLF_MAX_HP);
  const respawnEvents = events.filter((event) => event.type === 'wolf-respawned');
  assert.equal(respawnEvents.length, 1);
  assert.ok(!('heroId' in respawnEvents[0]));
});
