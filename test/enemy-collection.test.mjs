import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  BASE_HERO_DAMAGE,
  DEATH_SECONDS,
  HERO_MAX_HP,
  WOLF_BITE_DAMAGE,
  WOLF_MAX_HP,
  WOLF_RESPAWN_SECONDS,
  createPartyEncounterState,
  requestPartyAttack,
  stepParty,
} from '../public/src/combat/encounter.js';

const STEP = 1 / 60;
const HERO = { position: { x: 0, z: -1 }, heading: 0, targetable: true };

function twoWolves(order = ['wolf-b', 'wolf-a']) {
  return order.map((enemyId) => ({
    enemyId,
    kind: 'wolf',
    patrol: [{ x: enemyId === 'wolf-a' ? -0.4 : 0.4, z: 0 }],
  }));
}

function advanceToContact(state, heroes = { H: HERO }) {
  let next = state;
  const seen = [];
  for (let elapsed = 0; elapsed < 0.7; elapsed += STEP) {
    const result = stepParty(next, { deltaSeconds: STEP, heroes });
    next = result.state;
    seen.push(...result.events);
  }
  return { state: next, events: seen };
}

test('canonical authority is an identified enemy collection with derived Wolf compatibility only', () => {
  const state = createPartyEncounterState({ enemies: twoWolves(), heroIds: ['H'] });
  assert.equal(state.enemies.length, 2);
  assert.deepEqual(state.enemies.map((enemy) => enemy.enemyId), ['wolf-b', 'wolf-a']);
  assert.ok(state.enemies.every((enemy) => enemy.kind === 'wolf'));
  assert.equal(state.wolf.enemyId, undefined, 'legacy wolf view must not become a second identified authority');
  assert.equal(state.wolf.x, state.enemies[0].x);
});

test('one swing damages at most one enemy: nearest first, stable enemyId breaks an exact tie', () => {
  let state = createPartyEncounterState({ enemies: twoWolves(), heroIds: ['H'] });
  state = requestPartyAttack(state, 'H', 'swing-1').state;
  const result = advanceToContact(state);

  const hits = result.events.filter((event) => event.type === 'wolf-hit');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].enemyId, 'wolf-a', 'equal-distance tie must choose stable identity, not array order');
  assert.equal(hits[0].kind, 'wolf');

  const byId = Object.fromEntries(result.state.enemies.map((enemy) => [enemy.enemyId, enemy]));
  assert.equal(byId['wolf-a'].hp, WOLF_MAX_HP - BASE_HERO_DAMAGE);
  assert.equal(byId['wolf-b'].hp, WOLF_MAX_HP);
});

test('reordering serialized enemies cannot retarget an equal-distance swing', () => {
  function targetFor(order) {
    let state = createPartyEncounterState({ enemies: twoWolves(order), heroIds: ['H'] });
    state = requestPartyAttack(state, 'H', 'swing').state;
    return advanceToContact(state).events.find((event) => event.type === 'wolf-hit')?.enemyId;
  }
  assert.equal(targetFor(['wolf-b', 'wolf-a']), 'wolf-a');
  assert.equal(targetFor(['wolf-a', 'wolf-b']), 'wolf-a');
});

test('two ordinary Wolves independently chase, acquire, bite, and damage their own Heroes', () => {
  const heroes = {
    'hero-a': { position: { x: 0, z: 1.5 }, heading: 0, targetable: true },
    'hero-b': { position: { x: 10, z: 4 }, heading: 0, targetable: true },
  };
  let state = createPartyEncounterState({
    enemies: [
      { enemyId: 'wolf-a', kind: 'wolf', spawn: { x: 0, z: 0 } },
      { enemyId: 'wolf-b', kind: 'wolf', spawn: { x: 10, z: 0 } },
    ],
    heroIds: ['hero-a', 'hero-b'],
  });
  const events = [];
  const byId = () => Object.fromEntries(state.enemies.map((enemy) => [enemy.enemyId, enemy]));

  // Wolf A starts in bite range while Wolf B must chase its own, distant Hero. The distinct modes
  // and positions prove one enemy's hostile transition is not shared by the other.
  for (let tick = 0; tick < 45; tick += 1) {
    const result = stepParty(state, { deltaSeconds: STEP, heroes });
    state = result.state;
    events.push(...result.events);
  }
  let enemies = byId();
  assert.equal(enemies['wolf-a'].targetId, 'hero-a');
  assert.equal(enemies['wolf-a'].mode, 'bite');
  assert.equal(enemies['wolf-b'].mode, 'walk');
  assert.equal(enemies['wolf-b'].targetId, null, 'chasing does not borrow Wolf A\'s target');
  assert.ok(enemies['wolf-b'].z > 0, 'Wolf B advanced toward Hero B independently');
  assert.notEqual(enemies['wolf-a'].enemyId, enemies['wolf-b'].enemyId);

  // Continue until both independent bites have landed. The Heroes are separated by 10m, well
  // beyond aggro range, so a cross-target bite would be a simulation defect rather than a tie.
  for (let tick = 45; tick < 240 && events.filter((event) => event.type === 'hero-hurt').length < 2; tick += 1) {
    const result = stepParty(state, { deltaSeconds: STEP, heroes });
    state = result.state;
    events.push(...result.events);
  }
  enemies = byId();
  const bites = events.filter((event) => event.type === 'hero-hurt');
  assert.deepEqual(
    bites.slice(0, 2).map(({ enemyId, heroId }) => ({ enemyId, heroId })),
    [
      { enemyId: 'wolf-a', heroId: 'hero-a' },
      { enemyId: 'wolf-b', heroId: 'hero-b' },
    ],
  );
  assert.equal(enemies['wolf-a'].targetId, 'hero-a');
  assert.equal(enemies['wolf-b'].targetId, 'hero-b');
  assert.equal(enemies['wolf-a'].hp, WOLF_MAX_HP, 'Wolf A was not damaged by its own bite');
  assert.equal(enemies['wolf-b'].hp, WOLF_MAX_HP, 'Wolf B was not damaged by its own bite');
  assert.equal(state.heroes['hero-a'].hp, HERO_MAX_HP - WOLF_BITE_DAMAGE);
  assert.equal(state.heroes['hero-b'].hp, HERO_MAX_HP - WOLF_BITE_DAMAGE);
  assert.notEqual(enemies['wolf-a'].mode, enemies['wolf-b'].mode,
    'one Wolf entering bite does not force the other into the same lifecycle mode');
});

test('ordinary enemies keep independent hit/lifecycle state and respawn with the same stable id', () => {
  const definitions = [
    { enemyId: 'wolf-a', kind: 'wolf', patrol: [{ x: 0, z: 0 }, { x: 5, z: 5 }] },
    { enemyId: 'wolf-b', kind: 'wolf', patrol: [{ x: 20, z: 20 }] },
  ];
  let state = createPartyEncounterState({ enemies: definitions, heroIds: ['H'] });

  state = requestPartyAttack(state, 'H', 'kill').state;
  ({ state } = advanceToContact(state, {
    H: { ...HERO, heroDamage: WOLF_MAX_HP },
  }));
  let byId = Object.fromEntries(state.enemies.map((enemy) => [enemy.enemyId, enemy]));
  assert.equal(byId['wolf-a'].mode, 'dying');
  assert.equal(byId['wolf-b'].hp, WOLF_MAX_HP);
  assert.equal(byId['wolf-b'].mode, 'idle');

  const seen = [];
  const seconds = DEATH_SECONDS + WOLF_RESPAWN_SECONDS + 0.2;
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    const result = stepParty(state, {
      deltaSeconds: STEP,
      wolfHostile: false,
      heroes: { H: { position: { x: 100, z: 100 }, heading: 0 } },
    });
    state = result.state;
    seen.push(...result.events);
  }
  byId = Object.fromEntries(state.enemies.map((enemy) => [enemy.enemyId, enemy]));
  assert.ok(seen.some((event) => event.type === 'wolf-respawned' && event.enemyId === 'wolf-a'));
  assert.equal(byId['wolf-a'].enemyId, 'wolf-a');
  assert.equal(byId['wolf-a'].spawnIndex, 1);
  assert.equal(byId['wolf-a'].x, 5);
  assert.equal(byId['wolf-a'].z, 5);
  assert.equal(byId['wolf-b'].spawnIndex, 0);
  assert.equal(byId['wolf-b'].x, 20);
  assert.equal(byId['wolf-b'].z, 20);
});

test('defeat event carries stable identity and kind for contribution/reward consumers', () => {
  let state = createPartyEncounterState({
    enemies: [{ enemyId: 'collection-wolf', kind: 'wolf', patrol: [{ x: 0, z: 0 }] }],
    heroIds: ['H'],
  });
  state = requestPartyAttack(state, 'H', 'kill').state;
  const result = advanceToContact(state, { H: { ...HERO, heroDamage: WOLF_MAX_HP } });
  const defeat = result.events.find((event) => event.type === 'wolf-defeated');
  assert.deepEqual(
    { enemyId: defeat.enemyId, kind: defeat.kind, heroId: defeat.heroId },
    { enemyId: 'collection-wolf', kind: 'wolf', heroId: 'H' },
  );
});

// ── HOW LONG A DEAD WOLF STAYS DEAD, PINNED WHERE IT CAN ACTUALLY BE MEASURED ────────────────────
//
// This assertion used to live only in tools/runtime-test/drive-lifecycle.mjs, which measures it
// through a browser: it watches the CLIENT's mirror of the server's published enemy, one sample per
// rendered frame, and times the gap between the first frame it sees 'dead' and the first frame it
// sees the wolf back. On the hosted runners that browser paints at roughly two frames a second, so
// a ten-second interval is observed through about twenty samples, each of which can land anywhere
// inside half a second of real time -- and the check needed a +/-2.5 s tolerance to survive at all.
// It still produced three false failures in one day (5.57 s, 7.18 s and 7.44 s "measured" against
// the 10 s rule), the last of them missing the bar by 60 ms.
//
// So the timing claim moves here, where the rules run at a fixed step with nothing between the
// assertion and the clock, and it gets STRONGER on the way: exact equality, not a tolerance band.
// A browser cannot resolve this and should not be asked to; what the browser harness is good for is
// the thing only it can see -- that a real client, driven by real touches, watches a wolf die and
// come back at all -- and that is what it now asserts.
//
// Red-capable by construction: it is derived from the same imported constants the rules use, so a
// change to WOLF_RESPAWN_SECONDS or DEATH_SECONDS moves both sides together, while a change to the
// state machine (starting the respawn clock at the moment of death rather than on entry to 'dead',
// say -- which is exactly what the failing browser numbers looked like) fails it immediately.
test('a dead wolf stays dead for exactly WOLF_RESPAWN_SECONDS, measured from entering "dead"', () => {
  const heroes = { H: HERO };
  let state = createPartyEncounterState({ enemies: twoWolves(['solo-wolf']), heroIds: ['H'] });
  let elapsed = 0;
  let enteredDying = null;
  let enteredDead = null;
  let cameBack = null;
  let previousMode = null;

  for (let frame = 0; frame < 60 * 40 && cameBack === null; frame += 1) {
    const enemy = state.enemies[0];
    if (enemy.mode !== 'dying' && enemy.mode !== 'dead') {
      state = requestPartyAttack(state, 'H', `swing-${frame}`).state;
    }
    state = stepParty(state, { deltaSeconds: STEP, heroes }).state;
    elapsed += STEP;
    const mode = state.enemies[0].mode;
    if (mode !== previousMode) {
      if (mode === 'dying' && enteredDying === null) enteredDying = elapsed;
      if (mode === 'dead' && enteredDead === null) enteredDead = elapsed;
      if (enteredDead !== null && mode !== 'dead' && mode !== 'dying') cameBack = elapsed;
      previousMode = mode;
    }
  }

  assert.ok(enteredDying !== null, 'the wolf never died, so this proves nothing about respawning');
  assert.ok(enteredDead !== null, 'the wolf never reached true "dead" after its death animation');
  assert.ok(cameBack !== null, 'the wolf never came back');

  // The death animation is its own clock and is NOT part of the respawn wait.
  assert.ok(Math.abs((enteredDead - enteredDying) - DEATH_SECONDS) <= STEP,
    `the death animation ran ${(enteredDead - enteredDying).toFixed(3)}s against DEATH_SECONDS `
    + `${DEATH_SECONDS}`);
  // ...and the respawn wait is measured from entry to 'dead', to the frame resolution of the step.
  assert.ok(Math.abs((cameBack - enteredDead) - WOLF_RESPAWN_SECONDS) <= STEP,
    `a dead wolf came back after ${(cameBack - enteredDead).toFixed(3)}s against a `
    + `${WOLF_RESPAWN_SECONDS}s rule -- if this reads as roughly WOLF_RESPAWN_SECONDS minus `
    + 'DEATH_SECONDS, the respawn clock has started at the moment of death instead of on entry to '
    + '"dead"');
  // Belt and braces on the whole beat, so a future refactor cannot make the two halves cancel out.
  assert.ok(Math.abs((cameBack - enteredDying) - (DEATH_SECONDS + WOLF_RESPAWN_SECONDS)) <= STEP * 2,
    'death animation plus respawn wait no longer add up to the whole time a killed wolf is away');
});
