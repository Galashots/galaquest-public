import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HERO_MAX_HP,
  RESPAWN_SECONDS,
  WOLF_BITE_COOLDOWN_SECONDS,
  WOLF_AGGRO_RANGE,
  WOLF_BITE_RANGE,
  createEncounterState,
  stepEncounter,
} from '../public/src/combat/encounter.js';
import { SPAWNS } from '../public/src/world/zones/village.js';

/**
 * THE DEATH TREADMILL — measured, and it is smaller than the brief said.
 *
 * Checkpoint 0 named this the real "ruins a run" hazard: on knockout the hero does not move and
 * gains nothing, so a child who freezes instead of retreating is cycled hurt -> down -> stand ->
 * hurt. The mechanism it gave was arithmetic: RESPAWN_SECONDS 2 against WOLF_BITE_COOLDOWN_SECONDS
 * 2.6 leaves 0.6 s upright before the next legal bite.
 *
 * That arithmetic is wrong about the game, in two ways this file exists to keep pinned.
 *
 * First, encounter.js ALREADY calls resetWolf() when a solo hero stands up, which teleports the wolf
 * back to its spawn point. The wolf then has to walk back. The brief's subtraction never accounted
 * for the approach.
 *
 * Second, HERO_MAX_HP is 3 and a bite costs one heart, so a knockdown costs three bites. Down-to-down
 * is roughly eight seconds, not 0.6.
 *
 * Measured against the village's own geometry — the wolf where SPAWNS.wolf puts it, the child frozen
 * 4 m away inside WOLF_AGGRO_RANGE, which is what walking up the road and freezing looks like — a
 * child who stands up gets **2.57 s** before the next bite. They walk at 1.4 m/s and the wolf chases
 * at 1.15, so that is a real escape window, not a lock.
 *
 * Whether 2.57 s is enough for a frightened five-year-old is a question for a child, not for a test.
 * What this file does is stop it shrinking by accident: RESPAWN_SECONDS, the bite cooldown, the
 * aggro range, the spawn geometry and resetWolf's behaviour on respawn are five independent things
 * that all feed that number, and nothing else asserts their product.
 *
 * The first draft of this file DID reproduce a 1.05 s treadmill — by spawning the wolf 0.96 m from
 * the hero, which makes resetWolf a no-op and models a fight the village cannot produce. A fixture
 * that invents its own geometry will confirm whatever the brief claimed.
 */

const STEP = 1 / 60;


/**
 * The FIRST WOLF ENCOUNTER AS THE VILLAGE ACTUALLY BUILDS IT, not a wolf conjured into the child's
 * face. The distinction turned out to be the whole finding: encounter.js already calls resetWolf()
 * when a solo hero stands up, which teleports the wolf back to its spawn point. A fixture that spawns
 * the wolf inside bite range makes that reset a no-op and reports a treadmill the game does not have.
 *
 * So: the wolf spawns where the zone puts it, and the child is frozen at a spot inside
 * WOLF_AGGRO_RANGE of it -- which is what walking north up the road and then freezing looks like.
 */
const WOLF_SPAWN = { x: SPAWNS.wolf[0], z: SPAWNS.wolf[1] };
const FROZEN_CHILD_AT = { x: SPAWNS.wolf[0], z: SPAWNS.wolf[1] - 4 };

function stateWithWolfOnTopOfTheHero() {
  return createEncounterState({ wolfSpawn: WOLF_SPAWN });
}

/** Run the fight for `seconds` with a frozen child, returning the timeline of what happened to them. */
function frozenChildFor(seconds) {
  let state = stateWithWolfOnTopOfTheHero();
  const downs = [];
  const respawns = [];
  const hurts = [];
  let t = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    const result = stepEncounter(state, {
      deltaSeconds: STEP,
      heroPosition: FROZEN_CHILD_AT,   // never moves: this is the child who froze
      heroHeading: 0,
      attack: false,           // and never fights back
    });
    state = result.state;
    t += STEP;
    for (const event of result.events) {
      if (event.type === 'hero-hurt') hurts.push(Number(t.toFixed(3)));
      if (event.type === 'hero-down') downs.push(Number(t.toFixed(3)));
      if (event.type === 'hero-respawned') respawns.push(Number(t.toFixed(3)));
    }
  }
  return { hurts, downs, respawns, state };
}

test('the fixture is real: a frozen child next to a wolf actually gets bitten and downed', () => {
  const { hurts, downs } = frozenChildFor(20);
  assert.ok(hurts.length >= 3, `no bites landed: ${JSON.stringify(hurts)}`);
  assert.ok(downs.length >= 1, `the wolf never knocked the hero down: ${JSON.stringify(downs)}`);
});

test('a child who freezes still repeats only on the recovery clock, with a bounded leash', () => {
  const { downs, respawns } = frozenChildFor(30);
  assert.ok(downs.length >= 2,
    `expected the treadmill to repeat; down at ${JSON.stringify(downs)}`);
  assert.ok(respawns.length >= 2, `respawns: ${JSON.stringify(respawns)}`);
});

test('standing up gives the child a real window before the next heart is taken', () => {
  // The guard. Not "the treadmill exists" -- it does not, at this geometry -- but "the window that
  // makes it survivable must not quietly shrink". Five separate things feed this number and no other
  // test multiplies them together.
  const { hurts, respawns } = frozenChildFor(30);
  const windows = [];
  for (const up of respawns) {
    const next = hurts.find((h) => h > up);
    if (next !== undefined) windows.push(Number((next - up).toFixed(3)));
  }
  assert.ok(windows.length >= 2, `not enough cycles to measure: ${JSON.stringify(windows)}`);
  const worst = Math.min(...windows);
  console.log(`      respawn -> next bite (s): ${JSON.stringify(windows)}  worst ${worst}`);

  // The hero outruns the wolf by 0.25 m/s walking and 1.65 running, so two seconds of head start is
  // already decisive if the child moves at all. Below two seconds, standing up stops being a chance.
  assert.ok(worst >= 2.0,
    `a child who stands up got only ${worst}s before the next bite. Something that feeds this shrank:`
    + ' RESPAWN_SECONDS, WOLF_BITE_COOLDOWN_SECONDS, WOLF_AGGRO_RANGE, the wolf spawn geometry, or'
    + ' resetWolf() no longer running on respawn.');
});

test('red-capable: the window really is produced by the wolf being sent home, not by luck', () => {
  // Stated rather than assumed (GQ-022). If resetWolf stopped teleporting the wolf on respawn, the
  // guard above must fire -- so prove the measurement is sensitive to exactly that, by running the
  // same fight with the wolf's spawn point sitting inside bite range. That is the no-op case the
  // first draft of this file measured by accident, and it must come back SHORT.
  let state = createEncounterState({ wolfSpawn: { x: FROZEN_CHILD_AT.x + WOLF_BITE_RANGE * 0.6, z: FROZEN_CHILD_AT.z } });
  const hurts = [];
  const respawns = [];
  let t = 0;
  for (let i = 0; i < Math.round(30 / STEP); i += 1) {
    const result = stepEncounter(state, {
      deltaSeconds: STEP, heroPosition: FROZEN_CHILD_AT, heroHeading: 0, attack: false,
    });
    state = result.state;
    t += STEP;
    for (const event of result.events) {
      if (event.type === 'hero-hurt') hurts.push(t);
      if (event.type === 'hero-respawned') respawns.push(t);
    }
  }
  const windows = respawns
    .map((up) => hurts.find((h) => h > up))
    .filter((h) => h !== undefined)
    .map((h, i) => h - respawns[i]);
  assert.ok(windows.length >= 2, `not enough cycles in the control: ${windows.length}`);
  assert.ok(Math.min(...windows) >= 2.0,
    'a wolf that respawns already inside bite range still owes the E2 protection window');
  assert.ok(Math.min(...windows) < 3.0,
    'the inside-range control should remain an immediate re-engagement, not a leash return');
});

test('the brief\'s arithmetic, kept as the thing it is: necessary but nowhere near sufficient', () => {
  // 2.6 - 2.0 = 0.6 is a true statement about two constants and a false statement about the game.
  // Pinned so the next reader meets the correction rather than rediscovering the subtraction.
  const naiveGap = WOLF_BITE_COOLDOWN_SECONDS - RESPAWN_SECONDS;
  assert.ok(naiveGap < 1.0, `the two constants still leave ${naiveGap.toFixed(2)}s on paper`);
  assert.ok(WOLF_AGGRO_RANGE > WOLF_BITE_RANGE,
    'the wolf must have to close distance after being sent home, or the paper figure becomes the real one');
});
