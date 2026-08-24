import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HERO_MAX_HP,
  WOLF_AGGRO_RANGE,
  WOLF_BITE_RANGE,
  createEncounterState,
  stepEncounter,
} from '../public/src/combat/encounter.js';

/**
 * The first wolf must be able to be HELD, and holding it takes two gates, not one.
 *
 * Checkpoint 0: combat runs every frame regardless of quest state, the first wolf sits on the road
 * at SPAWNS.wolf with WOLF_AGGRO_RANGE 6, and the Keeper who would explain any of it is in the
 * opposite direction. A child who walks north meets an unbriefed fight. The ruling was "gate it, do
 * not move it" -- three alternative coordinates were tested and all three violated the 4 m combat
 * bowl.
 *
 * THE TRAP, verified by reading the order rather than discovered by debugging: advancePartyFight
 * checks the bite BEFORE it checks aggro, and the bite branch RETURNS. A gate applied only to the
 * aggro branch therefore never executes for a wolf that is already standing next to the child. That
 * wolf stops chasing -- it looks calm, it plays no walk animation -- and goes on taking a heart every
 * WOLF_BITE_COOLDOWN_SECONDS. Half-gated is worse than ungated, because it looks fixed.
 *
 * So the load-bearing test here is the one that starts the wolf INSIDE bite range, where the aggro
 * branch never runs at all: it can only pass if the bite branch itself is gated.
 *
 * `wolfHostile` defaults to true, so this is inert for every caller that does not pass it. The gate
 * is not wired to quest state in this change -- that is the caller's job and a separate seam.
 */

const STEP = 1 / 60;
const HERO_AT = { x: 0, z: 0 };
const SECONDS = 20;

function runFight({ wolfDistance, wolfHostile }) {
  let state = createEncounterState({ wolfSpawn: { x: wolfDistance, z: 0 } });
  const hurts = [];
  const modes = new Set();
  // Track the CLOSEST the wolf ever got, not where it ended up. resetWolf() sends it home the moment
  // the hero stands up, so a final-position check reports "never moved" for a wolf that charged in,
  // took three hearts and was teleported back -- which is how the first draft of this file measured
  // the ungated control as motionless.
  let closest = Infinity;
  let t = 0;
  for (let i = 0; i < Math.round(SECONDS / STEP); i += 1) {
    const result = stepEncounter(state, {
      deltaSeconds: STEP,
      heroPosition: HERO_AT,
      heroHeading: 0,
      attack: false,
      ...(wolfHostile === undefined ? {} : { wolfHostile }),
    });
    state = result.state;
    t += STEP;
    modes.add(state.wolf.mode);
    closest = Math.min(closest, Math.hypot(state.wolf.x - HERO_AT.x, state.wolf.z - HERO_AT.z));
    for (const event of result.events) if (event.type === 'hero-hurt') hurts.push(Number(t.toFixed(2)));
  }
  return {
    hurts,
    modes: [...modes],
    finalHp: state.heroes ? undefined : state.hero?.hp,
    wolfMovedTo: { x: Number(state.wolf.x.toFixed(3)), z: Number(state.wolf.z.toFixed(3)) },
    closest: Number(closest.toFixed(3)),
    startedAt: wolfDistance,
  };
}

// --- the trap: a wolf already in the child's face ------------------------------------------------

test('THE TRAP: a held wolf already inside bite range takes no hearts', () => {
  // The aggro branch never runs at this distance, so this passes only if the BITE branch is gated.
  // Gate only the approach and this test goes red while the wolf stands there looking peaceful.
  const held = runFight({ wolfDistance: WOLF_BITE_RANGE * 0.6, wolfHostile: false });
  assert.deepEqual(held.hurts, [],
    `a held wolf bit the child ${held.hurts.length} time(s) at ${JSON.stringify(held.hurts)}`
    + ' -- the bite branch is not gated, and it returns before the aggro branch is ever reached');
});

test('red-capable: that same wolf, NOT held, does take hearts', () => {
  // Stated rather than assumed (GQ-022). Without this, the test above would pass just as happily on
  // a fixture where the wolf could never reach the child for some unrelated reason.
  const hostile = runFight({ wolfDistance: WOLF_BITE_RANGE * 0.6, wolfHostile: true });
  assert.ok(hostile.hurts.length >= 2,
    `the ungated control took no hearts (${JSON.stringify(hostile.hurts)}), so the gate test proves nothing`);
});

// --- the approach ---------------------------------------------------------------------------------

test('a held wolf inside aggro range does not close on the child', () => {
  const startedAt = WOLF_AGGRO_RANGE * 0.7;
  const held = runFight({ wolfDistance: startedAt, wolfHostile: false });
  assert.ok(Math.abs(held.closest - startedAt) < 1e-6,
    `a held wolf closed from ${startedAt} to ${held.closest} at its nearest`);
  assert.deepEqual(held.hurts, [], 'a held wolf that never approached still bit the child');
});

test('red-capable: that same wolf, NOT held, closes and bites', () => {
  const startedAt = WOLF_AGGRO_RANGE * 0.7;
  const hostile = runFight({ wolfDistance: startedAt, wolfHostile: true });
  assert.ok(hostile.closest < WOLF_BITE_RANGE,
    `the ungated control never closed to bite range from ${startedAt}; nearest ${hostile.closest}`);
  assert.ok(hostile.hurts.length >= 1, 'the ungated control never bit, so the hold proves nothing');
});

// --- the default must not change any existing caller ----------------------------------------------

test('omitting wolfHostile entirely leaves the fight exactly as it was', () => {
  // Every caller written before this gate existed passes no such field. They must be untouched.
  const omitted = runFight({ wolfDistance: WOLF_AGGRO_RANGE * 0.7, wolfHostile: undefined });
  const explicit = runFight({ wolfDistance: WOLF_AGGRO_RANGE * 0.7, wolfHostile: true });
  assert.deepEqual(omitted.hurts, explicit.hurts,
    'a caller that names no gate got a different fight from one that asked for a hostile wolf');
  assert.deepEqual(omitted.wolfMovedTo, explicit.wolfMovedTo);
});

test('a held wolf is idle, not stuck mid-lunge', () => {
  // What a child sees matters as much as what the rules do: a gated wolf must read as a wolf that
  // has not noticed them, never as one frozen in a bite.
  const held = runFight({ wolfDistance: WOLF_BITE_RANGE * 0.6, wolfHostile: false });
  assert.deepEqual(held.modes, ['idle'],
    `a held wolf passed through modes ${JSON.stringify(held.modes)}; it should only ever be idle`);
});

test('the hero keeps every heart while the wolf is held', () => {
  const held = runFight({ wolfDistance: WOLF_BITE_RANGE * 0.6, wolfHostile: false });
  assert.equal(held.hurts.length, 0);
  assert.ok(HERO_MAX_HP >= 1);
});
