// The wolf does not come back where it died.
//
// The quest is three kills. With one spawn point a child spent the whole thing standing in a single
// two-metre circle hitting the same animal three times over, waiting ten seconds between each --
// while the Keeper's own line says "the wolves OUT THERE", plural. The spawn now walks a fixed loop.
//
// A LOOP and not a random pick, and that is the property most worth pinning: the fight is
// server-authoritative and the client replays the same rules offline, so any randomness would have
// the two simulations disagree about where the next wolf is.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  WOLF_AGGRO_RANGE,
  WOLF_ARRIVAL_GRACE_SECONDS,
  WOLF_BITE_COOLDOWN_SECONDS,
  WOLF_RESPAWN_SECONDS,
  addHero,
  createEncounterState,
  createPartyEncounterState,
  requestPartyAttack,
  stepEncounter,
  stepParty,
} from '../public/src/combat/encounter.js';
import { SPAWNS, WOLF_SPAWN, WOLF_SPAWNS } from '../public/src/world/zones/village.js';

const STEP = 1 / 60;
const PATROL = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 10 }];
// Far enough from every patrol point that a respawned wolf never aggros and walks off its spot,
// which would make "did it appear where the patrol says" unmeasurable.
const FAR_AWAY = { x: -40, z: -40 };

function advance(state, seconds, events = []) {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    const stepped = stepParty(state, {
      deltaSeconds: STEP,
      heroes: { hero: { position: FAR_AWAY, heading: 0 } },
    });
    state = stepped.state;
    events.push(...stepped.events);
  }
  return state;
}

/** Kill the wolf wherever it currently stands, and stop the tick it reads 'dead'. */
function kill(state) {
  for (let tick = 0; tick < 100000 && state.wolf.mode !== 'dead'; tick += 1) {
    state = requestPartyAttack(state, 'hero', `kill:${tick}`).state;
    state = stepParty(state, {
      deltaSeconds: STEP,
      // Standing on the wolf, wherever the wolf is -- the patrol moves it, so this cannot be a
      // fixed coordinate or the second kill would be swung at empty grass.
      heroes: { hero: { position: { x: state.wolf.x, z: state.wolf.z }, heading: 0 } },
    }).state;
  }
  assert.equal(state.wolf.mode, 'dead', 'setup failed: never killed the wolf');
  return state;
}

function fresh() {
  return addHero(createPartyEncounterState({ wolfSpawns: PATROL, heroIds: [] }), 'hero');
}

test('the fight starts at the first spot on the patrol', () => {
  const state = fresh();
  assert.deepEqual({ x: state.wolf.x, z: state.wolf.z }, PATROL[0]);
  assert.equal(state.wolfSpawnIndex, 0);
});

test('a beaten wolf comes back at the NEXT spot, not where it fell', () => {
  let state = kill(fresh());
  const fellAt = { x: state.wolf.x, z: state.wolf.z };
  state = advance(state, WOLF_RESPAWN_SECONDS + 0.05);
  assert.equal(state.wolf.mode, 'idle');
  assert.deepEqual({ x: state.wolf.x, z: state.wolf.z }, PATROL[1]);
  assert.notDeepEqual({ x: state.wolf.x, z: state.wolf.z }, fellAt);
});

test('the loop wraps, so a fourth wolf is back at the first spot', () => {
  let state = fresh();
  const seen = [];
  for (let round = 0; round < 4; round += 1) {
    seen.push({ x: state.wolf.x, z: state.wolf.z });
    state = advance(kill(state), WOLF_RESPAWN_SECONDS + 0.05);
  }
  assert.deepEqual(seen, [PATROL[0], PATROL[1], PATROL[2], PATROL[0]]);
});

// Determinism is the whole reason this is a loop. Two independent runs of the same script must put
// the wolf in the same places, or the server and the client's offline replay disagree about where
// the fight is.
test('two independent runs of the same script visit the same spots in the same order', () => {
  function run() {
    let state = fresh();
    const seen = [];
    for (let round = 0; round < 3; round += 1) {
      state = advance(kill(state), WOLF_RESPAWN_SECONDS + 0.05);
      seen.push({ x: state.wolf.x, z: state.wolf.z });
    }
    return seen;
  }
  assert.deepEqual(run(), run());
});

// Being knocked down is not a victory. Moving the wolf on when the party wipes would hand a child a
// shorter walk for losing, and would move the fight out from under them mid-round.
test('a party wipe resets the wolf in place rather than advancing the patrol', () => {
  let state = fresh();
  // Stand in the wolf's face and never swing: it bites until the hero goes down.
  for (let tick = 0; tick < 100000 && state.heroes.hero.downSeconds < 0; tick += 1) {
    state = stepParty(state, {
      deltaSeconds: STEP,
      heroes: { hero: { position: { x: state.wolf.x, z: state.wolf.z }, heading: 0 } },
    }).state;
  }
  assert.ok(state.heroes.hero.downSeconds >= 0, 'setup failed: the wolf never downed the hero');
  const indexWhenDowned = state.wolfSpawnIndex;
  state = advance(state, 3);
  assert.equal(state.heroes.hero.downSeconds, -1, 'the hero never came back');
  assert.equal(state.wolfSpawnIndex, indexWhenDowned, 'losing moved the wolf');
  assert.deepEqual({ x: state.wolf.x, z: state.wolf.z }, PATROL[0]);
});

// Every existing caller passes one spawn and must keep the behaviour it always had.
test('a fight created with a single spawn never moves', () => {
  let state = addHero(createPartyEncounterState({ wolfSpawn: { x: 3, z: 4 }, heroIds: [] }), 'hero');
  for (let round = 0; round < 3; round += 1) {
    state = advance(kill(state), WOLF_RESPAWN_SECONDS + 0.05);
    assert.deepEqual({ x: state.wolf.x, z: state.wolf.z }, { x: 3, z: 4 });
  }
});

// Offline is the same fight (Design ruling 1), so a child with no server hunts the same three spots.
test('the solo wrapper walks the patrol too, and carries the index across ticks', () => {
  let state = createEncounterState({ wolfSpawns: PATROL });
  let commandSeq = 0;
  assert.deepEqual({ x: state.wolf.x, z: state.wolf.z }, PATROL[0]);

  // TWO kills, not one, and that is the point of the test. The solo wrapper rebuilds a scratch party
  // state on every single call, so the patrol index has to make a full round trip out of published
  // state and back in. Drop it and the FIRST respawn still looks right -- the wolf's own coordinates
  // carry it -- and every respawn after that comes back to spot two forever.
  const seen = [];
  for (let round = 0; round < 2; round += 1) {
    for (let tick = 0; tick < 100000 && state.wolf.mode !== 'dead'; tick += 1) {
      state = stepEncounter(state, {
        commandId: `k${commandSeq += 1}`,
        deltaSeconds: STEP,
        heroPosition: { x: state.wolf.x, z: state.wolf.z },
        heroHeading: 0,
        attack: true,
      }).state;
    }
    for (let elapsed = 0; elapsed < WOLF_RESPAWN_SECONDS + 0.05; elapsed += STEP) {
      state = stepEncounter(state, {
        commandId: `w${commandSeq += 1}`, deltaSeconds: STEP, heroPosition: FAR_AWAY, heroHeading: 0,
      }).state;
    }
    seen.push({ x: state.wolf.x, z: state.wolf.z });
  }
  assert.deepEqual(seen, [PATROL[1], PATROL[2]]);
});

// ── the village's own patrol ────────────────────────────────────────────────────────────────────

test('the village patrol starts where the fight has always started', () => {
  assert.deepEqual(WOLF_SPAWNS[0], WOLF_SPAWN);
  assert.deepEqual(SPAWNS.patrol[0], SPAWNS.wolf);
});

test('every spot is somewhere a child has to walk to, and nowhere they are standing', () => {
  assert.ok(WOLF_SPAWNS.length >= 3, 'three kills finish the quest, so three spots is one each');
  const [heroX, heroZ] = SPAWNS.heroes;
  for (const spot of WOLF_SPAWNS) {
    const fromHero = Math.hypot(spot.x - heroX, spot.z - heroZ);
    assert.ok(fromHero > WOLF_AGGRO_RANGE,
      `a wolf at [${spot.x}, ${spot.z}] is ${fromHero.toFixed(1)}m from spawn and would charge a `
      + 'child who has not moved yet');
  }
  for (let i = 0; i < WOLF_SPAWNS.length; i += 1) {
    for (let j = i + 1; j < WOLF_SPAWNS.length; j += 1) {
      const apart = Math.hypot(WOLF_SPAWNS[i].x - WOLF_SPAWNS[j].x, WOLF_SPAWNS[i].z - WOLF_SPAWNS[j].z);
      assert.ok(apart >= 5,
        `spots ${i} and ${j} are ${apart.toFixed(1)}m apart -- close enough that moving between them `
        + 'is not a journey');
    }
  }
});

test('every spot is inside the world the hero is allowed to walk in', () => {
  // Same bound clampToWorld enforces, restated through the zone's own size rather than a literal.
  const limit = 28 / 2 - 1;
  for (const spot of WOLF_SPAWNS) {
    assert.ok(Math.abs(spot.x) <= limit && Math.abs(spot.z) <= limit,
      `a wolf at [${spot.x}, ${spot.z}] stands outside the walkable world`);
  }
});

// ── the arrival grace ───────────────────────────────────────────────────────────────────────────
//
// Watched in the running game: the frame a wolf respawned it was already in `bite` mode at 8%
// opacity, so the windup happened while it was invisible and a child was bitten by something that
// had not finished appearing.

test('a wolf that has just arrived cannot bite immediately', () => {
  const state = addHero(createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: [] }), 'hero');
  assert.equal(state.wolf.biteCooldown, WOLF_ARRIVAL_GRACE_SECONDS);
  assert.ok(WOLF_ARRIVAL_GRACE_SECONDS > 0.38,
    'the grace has to outlast the presenter\'s own fade-in, or the bite still starts on an invisible wolf');
  assert.ok(WOLF_ARRIVAL_GRACE_SECONDS < WOLF_BITE_COOLDOWN_SECONDS,
    'it is a moment to appear in, not a free pass');
});

test('a respawned wolf standing on the hero waits before its first bite', () => {
  let state = fresh();
  state = kill(state);
  state = advance(state, WOLF_RESPAWN_SECONDS + 0.05);
  assert.equal(state.wolf.mode, 'idle', 'setup: the wolf should be back');

  // Stand right on it and count how long until it lands a bite.
  const events = [];
  let elapsed = 0;
  for (let tick = 0; tick < 600 && !events.some((e) => e.type === 'hero-hurt'); tick += 1) {
    const stepped = stepParty(state, {
      deltaSeconds: STEP,
      heroes: { hero: { position: { x: state.wolf.x, z: state.wolf.z }, heading: 0 } },
    });
    state = stepped.state;
    events.push(...stepped.events);
    elapsed += STEP;
  }
  assert.ok(events.some((e) => e.type === 'hero-hurt'), 'it never bit at all -- the grace is not a grace, it is a bug');
  assert.ok(elapsed >= WOLF_ARRIVAL_GRACE_SECONDS,
    `bit after only ${elapsed.toFixed(2)}s, inside its own ${WOLF_ARRIVAL_GRACE_SECONDS}s arrival grace`);
});

// Offline is the same fight, and the solo entry point builds its wolf by hand rather than through
// freshWolf -- which is exactly how the two drifted apart before this was checked.
test('the solo fight gives its wolf the same arrival grace as the party one', () => {
  const solo = createEncounterState({ wolfSpawn: { x: 0, z: 0 } });
  const party = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 } });
  assert.equal(solo.wolf.biteCooldown, party.wolf.biteCooldown);
});
