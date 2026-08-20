// The party engine: one wolf, N heroes, keyed by id.
//
// This is new coverage, not a rewrite of the control -- encounter.test.mjs, encounter-seam.test.mjs,
// swing.test.mjs, feedback.test.mjs and wolf.test.mjs all keep testing the solo API and were not
// touched. This file exists to pin down the behaviour Design rulings 4 and 5 add on top of that:
// nearest-living-hero targeting chosen once at bite start, contact checked against that hero's
// position at contact time (not bite-start time), and the wipe-and-reset rule generalised to "only
// if no other hero is currently alive".

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  HERO_MAX_HP,
  WOLF_DAMAGE_PER_HIT,
  WOLF_MAX_HP,
  WOLF_BITE_SECONDS,
  addHero,
  canHeroAttack,
  createPartyEncounterState,
  removeHero,
  requestPartyAttack,
  stepParty,
} from '../public/src/combat/encounter.js';

const STEP = 1 / 60;

// A generous but finite bound on how long a scripted fight is allowed to run before a test gives up
// and fails loudly, rather than hanging, if the rules stop converging the way the script expects.
const MAX_SECONDS = 20;

// --- swings land, and carry heroId -------------------------------------------------------------

test('two heroes each landing one swing take the wolf from 3 to 1 HP, with two wolf-hit events carrying the right heroIds', () => {
  let state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A', 'B'] });

  // heading 0 faces +Z (see encounter.test.mjs's own note on the convention), which is towards
  // the wolf at z=0 from heroes standing at z=-1.
  const heroesCommand = {
    A: { position: { x: -0.3, z: -1 }, heading: 0 },
    B: { position: { x: 0.3, z: -1 }, heading: 0 },
  };

  const attackA = requestPartyAttack(state, 'A', 'a-1');
  assert.equal(attackA.accepted, true);
  state = attackA.state;
  const attackB = requestPartyAttack(state, 'B', 'b-1');
  assert.equal(attackB.accepted, true);
  state = attackB.state;

  const seen = [];
  for (let elapsed = 0; elapsed < 0.6; elapsed += STEP) {
    const result = stepParty(state, { deltaSeconds: STEP, heroes: heroesCommand });
    seen.push(...result.events);
    state = result.state;
  }

  const wolfHits = seen.filter((event) => event.type === 'wolf-hit');
  assert.equal(wolfHits.length, 2, `expected two wolf-hit events, saw ${JSON.stringify(seen)}`);
  assert.deepEqual(new Set(wolfHits.map((event) => event.heroId)), new Set(['A', 'B']));
  assert.equal(state.wolf.hp, WOLF_MAX_HP - 2);
});

// --- targeting: nearest living hero, chosen at bite start ---------------------------------------

test('the wolf bites the nearest living hero', () => {
  let state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A', 'B'] });
  const heroesCommand = {
    A: { position: { x: 0, z: 1.5 }, heading: 0 },
    B: { position: { x: 0, z: 3.0 }, heading: 0 },
  };

  const seen = [];
  for (let elapsed = 0; elapsed < WOLF_BITE_SECONDS + 0.1 && !seen.some((e) => e.type === 'hero-hurt'); elapsed += STEP) {
    const result = stepParty(state, { deltaSeconds: STEP, heroes: heroesCommand });
    seen.push(...result.events);
    state = result.state;
  }

  const hurts = seen.filter((event) => event.type === 'hero-hurt');
  assert.equal(hurts.length, 1, `expected exactly one hero-hurt, saw ${JSON.stringify(seen)}`);
  assert.equal(hurts[0].heroId, 'A', 'the nearer hero (1.5) must take the bite, not the farther one (3.0)');
  assert.equal(state.heroes.A.hp, HERO_MAX_HP - 1);
  assert.equal(state.heroes.B.hp, HERO_MAX_HP, 'the farther hero must be untouched');
});

test('a hero who goes down makes the wolf\'s next bite target the other hero, once in range', () => {
  let state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A', 'B'] });

  // B starts well outside aggro range -- the wolf must not so much as glance at it -- and only
  // walks into range (distance 0.5, decisively closer than A's fixed 1.5) once A has gone down at
  // least once. That is "once in range" played out as a script: B arriving is the in-range event,
  // not the wolf closing on a stationary B, which would race the 0.15s gap this file's other
  // reset test documents between a bite's own cooldown clearing and the RESPAWN_SECONDS it competes
  // against (WOLF_BITE_COOLDOWN_SECONDS - WOLF_BITE_CONTACT_SECONDS - RESPAWN_SECONDS = 0.15s) --
  // a race the rules should not have to win for this test to mean anything.
  let bArrived = false;
  const heroesCommand = () => ({
    A: { position: { x: 0, z: 1.5 }, heading: 0 },
    B: { position: bArrived ? { x: 0, z: 0.5 } : { x: 0, z: 100 }, heading: 0 },
  });

  const seen = [];
  let elapsed = 0;
  while (elapsed < MAX_SECONDS && !seen.some((e) => e.type === 'hero-hurt' && e.heroId === 'B')) {
    const result = stepParty(state, { deltaSeconds: STEP, heroes: heroesCommand() });
    seen.push(...result.events);
    state = result.state;
    if (!bArrived && seen.some((e) => e.type === 'hero-down' && e.heroId === 'A')) bArrived = true;
    elapsed += STEP;
  }

  assert.ok(elapsed < MAX_SECONDS, 'B was never bitten within the time budget');

  const hurtsOnA = seen.filter((event) => event.type === 'hero-hurt' && event.heroId === 'A');
  assert.equal(hurtsOnA.length, HERO_MAX_HP, 'A must take exactly enough bites to go down, no more');
  const downIndex = seen.findIndex((event) => event.type === 'hero-down' && event.heroId === 'A');
  assert.notEqual(downIndex, -1, 'A must have gone down');
  const firstBHurtIndex = seen.findIndex((event) => event.type === 'hero-hurt' && event.heroId === 'B');
  assert.ok(downIndex < firstBHurtIndex, 'A must go down BEFORE the wolf ever reaches B');
  assert.equal(state.wolf.targetId, 'B');
});

// --- wipe-and-reset (Design ruling 5) ------------------------------------------------------------
//
// Driven from hand-built states rather than a full bite-AI simulation: downing a hero from full HP
// takes several seconds of continuous exposure and respawn only takes RESPAWN_SECONDS, so getting
// two heroes simultaneously down through the AI alone would mean racing timers that are not meant to
// be raced. The rule itself only reads heroes[*].downSeconds, wolf.hp and wolf.mode -- exactly the
// documented shape -- so constructing that shape directly tests the rule precisely instead of
// incidentally, the same way encounter-seam.test.mjs drives stepEncounter from bare state literals.

function partyStateFor({ wolfHp, aliveOtherId, otherDownSeconds }) {
  return {
    revision: 0,
    wolfSpawn: { x: 0, z: 0 },
    wolf: {
      x: 0, z: 0, heading: 0, hp: wolfHp, mode: 'idle', modeSeconds: 0,
      biteCooldown: 0, biteLanded: false, targetId: null,
    },
    heroes: {
      // A is one tick away from crossing RESPAWN_SECONDS.
      A: { hp: 0, swingSeconds: -1, cooldown: 0, swingLanded: false, downSeconds: 1.99, lastCommandId: null },
      B: {
        hp: aliveOtherId === 'B' ? HERO_MAX_HP : 0,
        swingSeconds: -1,
        cooldown: 0,
        swingLanded: false,
        downSeconds: aliveOtherId === 'B' ? -1 : otherDownSeconds,
        lastCommandId: null,
      },
    },
  };
}

test('a respawn while another hero is alive does not reset wolf HP', () => {
  const state = partyStateFor({ wolfHp: 2, aliveOtherId: 'B' });
  const result = stepParty(state, {
    deltaSeconds: 0.02,
    heroes: { A: { position: { x: 0, z: 1 }, heading: 0 }, B: { position: { x: 0, z: 1 }, heading: 0 } },
  });

  assert.ok(result.events.some((e) => e.type === 'hero-respawned' && e.heroId === 'A'));
  assert.equal(result.state.wolf.hp, 2, 'B was alive, so ruling 5 says the wolf must NOT reset');
  assert.equal(result.state.heroes.A.hp, HERO_MAX_HP);
});

test('a respawn after both heroes were down DOES reset wolf HP', () => {
  // B is down too (0.5s into its own respawn timer -- well short of crossing it this tick). Both
  // heroes are commanded far away this tick so the reset is observed cleanly, rather than the
  // freshly-reset wolf immediately re-acquiring A (who respawns in this very same step) and
  // moving straight on to 'bite' -- which it is entitled to do, per Design ruling 4's "chase
  // tracks the nearest living hero each step", but which would make this assertion about the
  // wrong thing.
  const state = partyStateFor({ wolfHp: 2, aliveOtherId: null, otherDownSeconds: 0.5 });
  const result = stepParty(state, {
    deltaSeconds: 0.02,
    heroes: { A: { position: { x: 0, z: 100 }, heading: 0 }, B: { position: { x: 0, z: 100 }, heading: 0 } },
  });

  assert.ok(result.events.some((e) => e.type === 'hero-respawned' && e.heroId === 'A'));
  assert.equal(result.state.wolf.hp, WOLF_MAX_HP, 'nobody else was alive, so ruling 5 says the wolf DOES reset');
  assert.equal(result.state.wolf.mode, 'idle');
  assert.equal(result.state.wolf.x, 0);
  assert.equal(result.state.wolf.z, 0);
});

// --- replay guard is per hero --------------------------------------------------------------------

test('a replayed (heroId, commandId) attack is a no-op, not a second swing', () => {
  const state = createPartyEncounterState({ wolfSpawn: { x: 0, z: -4 }, heroIds: ['A'] });

  const first = requestPartyAttack(state, 'A', 'cmd-1');
  assert.equal(first.accepted, true);
  assert.deepEqual(first.events, [{ type: 'swing', heroId: 'A' }]);

  const replay = requestPartyAttack(first.state, 'A', 'cmd-1');
  assert.equal(replay.state, first.state, 'replay must hand back the very same state');
  assert.equal(replay.accepted, false);
  assert.equal(replay.events.length, 0, 'must not raise a second swing');
  assert.equal(replay.state.revision, first.state.revision, 'must not advance the revision');
});

// --- removeHero mid-bite --------------------------------------------------------------------------

test('removeHero mid-bite clears targetId and the bite\'s contact misses cleanly', () => {
  let state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A', 'B'] });
  const heroesCommand = {
    A: { position: { x: 0, z: 1.5 }, heading: 0 },
    B: { position: { x: 0, z: 100 }, heading: 0 },
  };

  let guard = 0;
  while (state.wolf.mode !== 'bite') {
    guard += 1;
    assert.ok(guard < 200, 'the wolf never entered bite mode');
    const result = stepParty(state, { deltaSeconds: STEP, heroes: heroesCommand });
    state = result.state;
  }
  assert.equal(state.wolf.targetId, 'A');

  state = removeHero(state, 'A');
  assert.equal(state.wolf.targetId, null, 'targetId must be cleared the instant its hero leaves');
  assert.equal(Object.prototype.hasOwnProperty.call(state.heroes, 'A'), false);

  const seen = [];
  for (let elapsed = 0; elapsed < WOLF_BITE_SECONDS + 0.1; elapsed += STEP) {
    const result = stepParty(state, { deltaSeconds: STEP, heroes: heroesCommand });
    seen.push(...result.events);
    state = result.state;
  }

  assert.ok(seen.some((event) => event.type === 'bite-missed'), 'the contact must resolve as a clean miss');
  assert.ok(!seen.some((event) => event.type === 'hero-hurt'), 'there was no target left to hurt');
  assert.equal(state.wolf.mode, 'idle', 'the bite still ends on schedule with no target');
});

// --- addHero / removeHero / canHeroAttack: the small binding behaviours -------------------------

test('addHero is a no-op if the hero is already in the fight', () => {
  const state = createPartyEncounterState({ heroIds: ['A'] });
  const again = addHero(state, 'A');
  assert.equal(again, state, 'a duplicate join must not reset the hero or bump the revision');
});

test('removeHero is a no-op if the hero was never in the fight', () => {
  const state = createPartyEncounterState({ heroIds: ['A'] });
  const still = removeHero(state, 'nobody');
  assert.equal(still, state);
});

test('canHeroAttack reads only the three wire fields, and is false for an unknown hero', () => {
  const state = createPartyEncounterState({ heroIds: ['A'] });
  assert.equal(canHeroAttack(state, 'A'), true);
  assert.equal(canHeroAttack(state, 'ghost'), false);

  const swung = requestPartyAttack(state, 'A', 'x').state;
  assert.equal(canHeroAttack(swung, 'A'), false, 'mid-swing, the button must grey out');
});

// --- and a better sword is worth more ----------------------------------------------------------
//
// For two chapters every blow anywhere took off a flat WOLF_DAMAGE_PER_HIT, so the Wildwood Blade
// -- earned at the end of the longest promise in the game, with an unlock card and a "2 DAMAGE"
// line on the Hero screen -- swung exactly like the sword the child started with. The damage now
// rides in on the per-hero command as a number (see WOLF_DAMAGE_PER_HIT's own comment on why an
// item id would reach outside combat/), and these pin both halves of that.

test('a blow is worth what the command says it is worth, and says so in its own event', () => {
  let state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A'] });
  const heroes = { A: { position: { x: 0, z: -1 }, heading: 0, weaponDamage: 2 } };

  const asked = requestPartyAttack(state, 'A', 'a-1');
  assert.equal(asked.accepted, true);
  state = asked.state;

  const seen = [];
  for (let elapsed = 0; elapsed < 0.6; elapsed += STEP) {
    const result = stepParty(state, { deltaSeconds: STEP, heroes });
    seen.push(...result.events);
    state = result.state;
  }

  assert.equal(state.wolf.hp, WOLF_MAX_HP - 2, 'two damage came off, not one');
  const hit = seen.find((event) => event.type === 'wolf-hit');
  assert.equal(hit.damage, 2,
    'the event reports what actually landed -- a floating damage number reads this, and a "1" '
    + 'printed over a two-damage blow is the same lie in a different font');
});

test('two heroes in the same fight are each worth their OWN weapon', () => {
  // The co-op half, and the reason damage rides per hero rather than per fight: an older brother
  // carrying the Blade and a younger one still on the starter sword are in the same party, hitting
  // the same wolf, and each blow has to be worth what THAT child earned.
  let state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A', 'B'] });
  const heroes = {
    A: { position: { x: -0.3, z: -1 }, heading: 0, weaponDamage: 2 },
    B: { position: { x: 0.3, z: -1 }, heading: 0 },
  };

  state = requestPartyAttack(state, 'A', 'a-1').state;
  state = requestPartyAttack(state, 'B', 'b-1').state;

  const seen = [];
  for (let elapsed = 0; elapsed < 0.6; elapsed += STEP) {
    const result = stepParty(state, { deltaSeconds: STEP, heroes });
    seen.push(...result.events);
    state = result.state;
  }

  const byHero = Object.fromEntries(
    seen.filter((event) => event.type === 'wolf-hit' || event.type === 'wolf-defeated')
      .map((event) => [event.heroId, event.damage ?? null]),
  );
  // Three HP, a two and a one: the wolf is down, and whichever landed last carries the defeat.
  assert.equal(state.wolf.mode, 'dying');
  assert.deepEqual(new Set(Object.keys(byHero)), new Set(['A', 'B']));
});

test('a fight nobody told about equipment is exactly the fight it has always been', () => {
  // Every test above this line, the whole offline fallback before it was wired, and any future
  // caller that forgets: no weaponDamage on the command must mean WOLF_DAMAGE_PER_HIT, not zero.
  let state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A'] });
  const heroes = { A: { position: { x: 0, z: -1 }, heading: 0 } };
  state = requestPartyAttack(state, 'A', 'a-1').state;
  for (let elapsed = 0; elapsed < 0.6; elapsed += STEP) {
    state = stepParty(state, { deltaSeconds: STEP, heroes }).state;
  }
  assert.equal(state.wolf.hp, WOLF_MAX_HP - WOLF_DAMAGE_PER_HIT);
});
