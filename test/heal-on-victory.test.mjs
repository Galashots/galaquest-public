// Beating a wolf gives a heart back.
//
// WHY THIS EXISTS, in one sentence: before it, the only way a hero ever returned to three hearts was
// to DIE. the child playtesters played the quest on 2026-08-15 and "died a few times" -- and the quest is
// three kills, so a child who won the first fight on one heart walked into the second fight on one
// heart and the third on whatever was left. The difficulty of any single fight was never the
// problem; the absence of any recovery between them was.
//
// This is deliberately NOT passive regeneration. Two reasons, both about a young player:
//   - Cause and effect. "I killed it and got a heart back" is legible the instant it happens. "My
//     hearts slowly come back if I stand still" is a rule nobody will notice or be taught.
//   - It rewards winning rather than waiting, so no fight ever becomes easier by retreating from it.
//     Within a single fight NOTHING here changes: same wolf, same bite, same three hero hearts.
//
// And it is a co-op beat, which is the pillar the 2026-08-15 playtest promoted: your BROTHER'S kill
// heals you too, so standing next to each other pays.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  HERO_MAX_HP,
  createEncounter,
  createPartyEncounterState,
  requestPartyAttack,
  stepParty,
} from '../public/src/combat/encounter.js';
import { ENCOUNTER_EVENT_TYPES } from '../public/src/combat/feedback.js';

const STEP = 1 / 60;

/**
 * Land the killing blow, and nothing else.
 *
 * The wolf is put on its last hit point and its bite is held off for the duration, ON PURPOSE: these
 * tests are about what happens at the moment of victory, and a scripted full fight couples every
 * assertion to WOLF_BITE_COOLDOWN_SECONDS and to whether the hero happens to go down and respawn on
 * full hearts part-way through. (The first draft of this file did exactly that, and every expected
 * hp was wrong for reasons that had nothing to do with the heal.) The realistic end-to-end path,
 * bites and all, is covered by the solo test at the bottom.
 */
function killTheWolf(state, heroesCommand, killerId) {
  state = {
    ...state,
    wolf: { ...state.wolf, hp: 1, mode: 'idle', modeSeconds: 0, biteCooldown: 99 },
  };
  const seen = [];
  for (let elapsed = 0; elapsed < 5; elapsed += STEP) {
    const attack = requestPartyAttack(state, killerId, `${killerId}-${elapsed}`);
    state = attack.state;
    seen.push(...attack.events);
    const result = stepParty(state, { deltaSeconds: STEP, heroes: heroesCommand });
    state = result.state;
    seen.push(...result.events);
    if (seen.some((event) => event.type === 'wolf-defeated')) return { state, seen };
  }
  throw new Error('the wolf never went down');
}

test('a hurt hero gets one heart back when the wolf is beaten', () => {
  let state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A'] });
  // Hurt him first, without involving the wolf's own bite timing: this test is about the heal, and
  // a scripted bite would couple it to WOLF_BITE_COOLDOWN_SECONDS for no reason.
  state = {
    ...state,
    heroes: { A: { ...state.heroes.A, hp: 1 } },
  };

  const heroesCommand = { A: { position: { x: 0, z: -1 }, heading: 0 } };
  const { state: after, seen } = killTheWolf(state, heroesCommand, 'A');

  assert.equal(after.heroes.A.hp, 2, 'one heart back, not a full heal');
  const healed = seen.filter((event) => event.type === 'hero-healed');
  assert.equal(healed.length, 1, `expected exactly one hero-healed event, saw ${JSON.stringify(seen.map((e) => e.type))}`);
  assert.equal(healed[0].heroId, 'A', 'the heal is addressed to a hero, so the right hearts light up');
  assert.equal(healed[0].remaining, 2, 'carries the new total, the same shape hero-hurt does');
});

test('a hero already at full health is not healed, and no event is raised for him', () => {
  // A does the fighting (and will be bitten, which is why he is not the subject here). B watches
  // from across the map on full hearts -- he is the one this test is about.
  const state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A', 'B'] });
  const heroesCommand = {
    A: { position: { x: 0, z: -1 }, heading: 0 },
    B: { position: { x: 9, z: 9 }, heading: 0 },
  };
  const { state: after, seen } = killTheWolf(state, heroesCommand, 'A');

  assert.equal(after.heroes.B.hp, HERO_MAX_HP, 'still three');
  assert.equal(
    seen.filter((event) => event.type === 'hero-healed' && event.heroId === 'B').length,
    0,
    'a heal that changes nothing must not flash a heart at the child',
  );
});

test('the heal never carries a hero past HERO_MAX_HP even after several kills', () => {
  let state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A'] });
  state = { ...state, heroes: { A: { ...state.heroes.A, hp: 1 } } };
  const heroesCommand = { A: { position: { x: 0, z: -1 }, heading: 0 } };

  for (let kill = 0; kill < 4; kill += 1) {
    const fought = killTheWolf(state, heroesCommand, 'A');
    state = fought.state;
    assert.ok(state.heroes.A.hp <= HERO_MAX_HP, `hp went to ${state.heroes.A.hp} after kill ${kill + 1}`);
    // Walk the clock past the death and respawn so the next kill has a live wolf to swing at --
    // from OUTSIDE WOLF_AGGRO_RANGE, or the fresh wolf spends the wait chewing on him and this stops
    // being a test about the cap.
    const wellClear = { A: { position: { x: 40, z: 40 }, heading: 0 } };
    for (let elapsed = 0; elapsed < 15; elapsed += STEP) {
      state = stepParty(state, { deltaSeconds: STEP, heroes: wellClear }).state;
    }
  }
  assert.equal(state.heroes.A.hp, HERO_MAX_HP);
});

test("a brother's kill heals you too, but a hero who is down gets nothing", () => {
  let state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A', 'B', 'C'] });
  state = {
    ...state,
    heroes: {
      A: { ...state.heroes.A, hp: 2 },
      // B is hurt and standing well away from the fight -- the heal is for being on the team, not
      // for being in range, because "come and stand here to be healed" is a rule and this is a gift.
      B: { ...state.heroes.B, hp: 1 },
      // C is down. He is about to respawn on full hearts anyway; healing him would mean a knocked-out
      // player quietly banking a heart he never earned.
      C: { ...state.heroes.C, hp: 0, downSeconds: 0 },
    },
  };

  const heroesCommand = {
    A: { position: { x: 0, z: -1 }, heading: 0 },
    B: { position: { x: 9, z: 9 }, heading: 0 },
    C: { position: { x: 0, z: -1 }, heading: 0 },
  };
  // Only A swings; B is miles away and C is on the floor.
  const { state: after, seen } = killTheWolf(state, heroesCommand, 'A');

  assert.equal(after.heroes.A.hp, 3, 'the one who landed the blow');
  assert.equal(after.heroes.B.hp, 2, 'the brother across the map');
  assert.equal(after.heroes.C.hp, 0, 'the one who is down');
  assert.deepEqual(
    new Set(seen.filter((event) => event.type === 'hero-healed').map((event) => event.heroId)),
    new Set(['A', 'B']),
  );
});

test('the solo API heals too, and its published hero keeps exactly its old shape', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 0 } });
  const position = { x: 0, z: -1 };

  let defeated = false;
  let hpBeforeTheKill = HERO_MAX_HP;
  let healed = null;
  for (let elapsed = 0; elapsed < 30 && !defeated; elapsed += STEP) {
    const hpAtTickStart = encounter.state.hero.hp;
    encounter.requestAttack();
    encounter.update(STEP, position, 0);
    const events = encounter.drainEvents();
    if (events.some((event) => event.type === 'wolf-defeated')) {
      defeated = true;
      hpBeforeTheKill = hpAtTickStart;
      healed = events.find((event) => event.type === 'hero-healed') ?? null;
    }
  }
  assert.equal(defeated, true, 'the wolf never went down');
  // The wolf gets its bites in during a real fight, so this hero is genuinely hurt by the time he
  // wins -- which is the case worth pinning: he ends the fight one heart better off than he was.
  assert.ok(hpBeforeTheKill < HERO_MAX_HP, `expected the fight to cost him a heart, hp was ${hpBeforeTheKill}`);
  assert.equal(encounter.state.hero.hp, hpBeforeTheKill + 1);
  assert.ok(healed, 'the solo wrapper must pass the heal event through');
  assert.equal('heroId' in healed, false, 'solo events never carry a heroId -- Design ruling 1');
  assert.equal(healed.remaining, hpBeforeTheKill + 1);

  // Design ruling 1: the solo published hero is byte-identical to what it always was. A heal that
  // needed a new field on this object would break every client that decodes it.
  assert.deepEqual(
    Object.keys(encounter.state.hero).sort(),
    ['cooldown', 'downSeconds', 'hp', 'swingLanded', 'swingSeconds'],
  );
});

test('hero-healed is declared in ENCOUNTER_EVENT_TYPES, so main.js is forced to handle it', () => {
  assert.ok(
    ENCOUNTER_EVENT_TYPES.includes('hero-healed'),
    'feedback.test.mjs scans encounter.js source for event types; this is the other half of that guard',
  );
});
