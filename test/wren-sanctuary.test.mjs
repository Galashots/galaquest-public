// A conversation the game makes a child stand still for has to be safe long enough to have.
//
// Wren stands at [-1.2, 5.0]. The village wolf spawns 4.76m away and two of its three patrol nodes
// sit 4.76m and 4.30m from her, against a WOLF_AGGRO_RANGE of 6m. So the ground a child must stand
// on to hear her -- inside the two-metre speech radius -- has always been inside the wolf's ambient
// threat envelope. And a hero who goes down does not move: the respawn restores hearts and resets
// the wolf, and touches no position, so he stands up where he fell and the wolf comes again.
//
// Measured in a real browser at her feet under a 12x CPU throttle before this fix: hearts 3-2-1-0-3
// three times in about 25 seconds, hero position constant at 0.34m, drawn and authoritative
// agreeing to the centimetre. A child CAN run once they are standing, so it was never a trap with
// no exit -- but they could not finish the conversation the game required of them.
//
// The rule, per the Director's ruling: once the Beacon is lit, a hero inside Wren's existing claim
// radius is not an eligible target for the village wolf. PER HERO. Not a global pause, and not the
// retirement of the village wolf -- a younger sibling who joins later must still find a first
// fight waiting for them.
//
// The five seams below are the ones the ruling required. Each is written to be RED-CAPABLE against
// the unfixed rules, and the last test in this file proves that by re-running seam 1 with the
// datum removed: an instrument that has never been shown to fail is not evidence (GQ-022).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  HERO_MAX_HP, WOLF_AGGRO_RANGE, createPartyEncounterState, stepParty,
} from '../public/src/combat/encounter.js';
import { rangerSanctuaryHolds } from '../public/src/world/rangerSpeech.js';
import {
  RANGER, RANGER_CLAIM, SINGLE_WOLF_FIXTURE_SPAWN,
} from '../public/src/world/zones/village.js';

const STEP = 1 / 60;

/** Long enough to read a line out loud to a child, which is the thing being protected. */
const CONVERSATION_SECONDS = 12;

/** Standing on Wren, which is inside both her speech radius and her claim radius. */
const AT_WREN = { x: RANGER.at[0], z: RANGER.at[1] };

/**
 * Somewhere the wolf can reach and Wren cannot protect. Derived rather than typed: it has to be
 * outside RANGER_CLAIM but inside WOLF_AGGRO_RANGE of the spawn, or seam 2 proves nothing.
 */
const OUT_IN_THE_OPEN = { x: SINGLE_WOLF_FIXTURE_SPAWN.x, z: SINGLE_WOLF_FIXTURE_SPAWN.z - 1.2 };

function sanctuaryFor(position, beaconLit) {
  return rangerSanctuaryHolds({
    heroX: position.x,
    heroZ: position.z,
    rangerX: RANGER_CLAIM.at[0],
    rangerZ: RANGER_CLAIM.at[1],
    claimRadiusMeters: RANGER_CLAIM.radiusMeters,
    beaconLit,
  });
}

/**
 * Run the fight for `seconds`, deriving each hero's `targetable` every tick exactly the way
 * net/gameServer.mjs and main.js both do. `protect` names which heroes go through the derivation
 * at all -- passing an empty set is how the red-capable test below removes the fix.
 */
function runFight(state, positions, { seconds, beaconLit = true, protect = new Set(Object.keys(positions)) }) {
  const events = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    const heroes = {};
    for (const [heroId, position] of Object.entries(positions)) {
      heroes[heroId] = {
        position,
        heading: 0,
        targetable: protect.has(heroId) ? !sanctuaryFor(position, beaconLit) : true,
      };
    }
    const result = stepParty(state, { deltaSeconds: STEP, heroes });
    events.push(...result.events);
    state = result.state;
  }
  return { state, events };
}

const hurtsTo = (events, heroId) => events.filter((e) => e.type === 'hero-hurt' && e.heroId === heroId);
const downsOf = (events, heroId) => events.filter((e) => e.type === 'hero-down' && e.heroId === heroId);

// --- the fixture is actually dangerous ----------------------------------------------------------

// Every seam below is a claim about a hero NOT being hurt somewhere the wolf could have hurt them.
// If the geometry stopped being threatening, all four would pass for the wrong reason and read as
// a working sanctuary. So pin the danger first, from the shipped zone data.
test('the ground in front of Wren really is inside the wolf\'s reach, or the seams below are vacuous', () => {
  const spawnToWren = Math.hypot(SINGLE_WOLF_FIXTURE_SPAWN.x - RANGER.at[0], SINGLE_WOLF_FIXTURE_SPAWN.z - RANGER.at[1]);
  assert.ok(spawnToWren <= WOLF_AGGRO_RANGE,
    `the wolf spawns ${spawnToWren.toFixed(2)}m from Wren against an aggro range of `
    + `${WOLF_AGGRO_RANGE}m -- if that is no longer true, these tests prove nothing`);
  const openToSpawn = Math.hypot(OUT_IN_THE_OPEN.x - SINGLE_WOLF_FIXTURE_SPAWN.x, OUT_IN_THE_OPEN.z - SINGLE_WOLF_FIXTURE_SPAWN.z);
  assert.ok(openToSpawn <= WOLF_AGGRO_RANGE, 'the open position must be huntable');
  assert.equal(sanctuaryFor(OUT_IN_THE_OPEN, true), false, 'the open position must be unprotected');
  assert.equal(sanctuaryFor(AT_WREN, true), true, 'Wren\'s own spot must be protected');
});

// --- seam 1: a conversation-length window at Wren costs no hearts -------------------------------

test('seam 1: Beacon lit, a hero standing at Wren for a whole conversation is never bitten', () => {
  const state = createPartyEncounterState({ wolfSpawn: SINGLE_WOLF_FIXTURE_SPAWN, heroIds: ['A'] });
  const after = runFight(state, { A: AT_WREN }, { seconds: CONVERSATION_SECONDS });

  assert.deepEqual(hurtsTo(after.events, 'A'), [],
    'a child standing where the game told them to stand was bitten while Wren talked to them');
  assert.deepEqual(downsOf(after.events, 'A'), []);
  assert.equal(after.state.heroes.A.hp, HERO_MAX_HP);
});

// --- seam 2: per hero, not a global freeze ------------------------------------------------------

test('seam 2: one hero protected at Wren, one out in the open -- only the open one is hunted', () => {
  const state = createPartyEncounterState({ wolfSpawn: SINGLE_WOLF_FIXTURE_SPAWN, heroIds: ['A', 'B'] });
  const after = runFight(state, { A: AT_WREN, B: OUT_IN_THE_OPEN }, { seconds: CONVERSATION_SECONDS });

  assert.deepEqual(hurtsTo(after.events, 'A'), [], 'the hero at Wren must be safe');
  assert.ok(hurtsTo(after.events, 'B').length > 0,
    'the wolf must still hunt the sibling out in the open -- this is a sanctuary, not a truce, and '
    + 'a global pause would steal the other child\'s fight');
});

// --- seam 3: walking away gives the wolf its hero back ------------------------------------------

test('seam 3: a hero who leaves the sanctuary is an ordinary target again', () => {
  let state = createPartyEncounterState({ wolfSpawn: SINGLE_WOLF_FIXTURE_SPAWN, heroIds: ['A'] });
  const sheltered = runFight(state, { A: AT_WREN }, { seconds: 4 });
  assert.deepEqual(hurtsTo(sheltered.events, 'A'), [], 'still safe while standing there');

  const left = runFight(sheltered.state, { A: OUT_IN_THE_OPEN }, { seconds: CONVERSATION_SECONDS });
  assert.ok(hurtsTo(left.events, 'A').length > 0,
    'stepping out of Wren\'s circle must hand the child back to the wolf -- a sanctuary a child '
    + 'carries around with them is just a disabled wolf');
});

// --- seam 4: the wolf is still there for a sibling who arrives later ----------------------------

test('seam 4: the village wolf is not retired by the Beacon -- a late sibling still gets the fight', () => {
  const state = createPartyEncounterState({ wolfSpawn: SINGLE_WOLF_FIXTURE_SPAWN, heroIds: ['LATE'] });
  const after = runFight(state, { LATE: OUT_IN_THE_OPEN }, { seconds: CONVERSATION_SECONDS });

  assert.ok(hurtsTo(after.events, 'LATE').length > 0,
    'a younger brother who joins after the Beacon is lit must still find the village wolf hunting, '
    + 'or lighting the Beacon has quietly taken his first fight away from him');
});

// --- the sanctuary is gated on the Beacon, because that is what puts Wren there ------------------

test('before the Beacon burns there is nobody standing there, so the ground is ordinary village', () => {
  assert.equal(sanctuaryFor(AT_WREN, false), false);
  const state = createPartyEncounterState({ wolfSpawn: SINGLE_WOLF_FIXTURE_SPAWN, heroIds: ['A'] });
  const after = runFight(state, { A: AT_WREN }, { seconds: CONVERSATION_SECONDS, beaconLit: false });
  assert.ok(hurtsTo(after.events, 'A').length > 0,
    'an unlit Beacon means no Wren, and no Wren means no sanctuary');
});

// --- the predicate's own edges ------------------------------------------------------------------

test('the sanctuary reaches exactly RANGER_CLAIM and not a centimetre further', () => {
  const justInside = { x: RANGER_CLAIM.at[0], z: RANGER_CLAIM.at[1] + RANGER_CLAIM.radiusMeters - 0.01 };
  const justOutside = { x: RANGER_CLAIM.at[0], z: RANGER_CLAIM.at[1] + RANGER_CLAIM.radiusMeters + 0.01 };
  assert.equal(sanctuaryFor(justInside, true), true);
  assert.equal(sanctuaryFor(justOutside, true), false);
  // On the line counts as inside, the same way rangerSpeechState's own radius test does.
  assert.equal(sanctuaryFor({ x: RANGER_CLAIM.at[0], z: RANGER_CLAIM.at[1] + RANGER_CLAIM.radiusMeters }, true), true);
});

test('a hero whose position is not a number is not accidentally protected', () => {
  assert.equal(sanctuaryFor({ x: Number.NaN, z: RANGER_CLAIM.at[1] }, true), false);
  assert.equal(sanctuaryFor({ x: undefined, z: undefined }, true), false);
});

// --- red-capable: the same seam, with the fix removed -------------------------------------------

// The whole file asserts absences -- "was never bitten" -- and an absence is exactly what a broken
// test reports too. So run seam 1's scenario again with `targetable` never supplied, which is the
// rules as they shipped before this change, and require that it DOES bite. If this ever goes quiet,
// seam 1 has stopped proving anything and the two must be fixed together.
test('red-capable: without the targetable datum, the same twelve seconds at Wren is a mauling', () => {
  const state = createPartyEncounterState({ wolfSpawn: SINGLE_WOLF_FIXTURE_SPAWN, heroIds: ['A'] });
  const after = runFight(state, { A: AT_WREN }, { seconds: CONVERSATION_SECONDS, protect: new Set() });

  assert.ok(hurtsTo(after.events, 'A').length > 0,
    'the unprotected case must still be dangerous, or seam 1 is passing for the wrong reason');
  assert.ok(downsOf(after.events, 'A').length > 0,
    'and it must still knock the child down -- this is the defect the sanctuary exists to fix');
});
