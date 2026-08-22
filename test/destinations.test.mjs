// Every objective the game can put on screen has to have an answer to "where is it".
//
// The completeness check is the point of this file, and HOW it enumerates is the point of the check.
// It does not compare two hand-written lists -- that is the failure mode the whole design exists to
// avoid (GQ-011: two implementations of one decision, with a test as the mitigation). It drives the
// REAL branch across a sweep of its inputs and collects the ids it actually produced, so adding an
// objective and forgetting its destination fails here, and it fails because the producer produced
// something nobody had placed (GQ-015: cover the source, not a hand-fed copy of it).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  DESTINATION_IDS,
  destinationFor,
  nearestPlaceTo,
  placelessReasonFor,
} from '../public/src/world/destinations.js';
import {
  OBJECTIVE_LIGHT_THE_TREE,
  OBJECTIVE_MEET_THE_KEEPER,
  objectiveFindMarks,
  questObjectiveFor,
} from '../public/src/world/quest.js';
import { LANDMARKS, OLD_BEACON, SPAWNS } from '../public/src/world/zones/village.js';

/**
 * Every objective the branch can actually reach, by driving it rather than by listing it.
 *
 * The sweep is deliberately coarse and deliberately combinatorial: each flag is a branch in
 * questObjectiveFor, and the product of them covers every leaf. It does not need to be minimal, it
 * needs to be complete, and an over-broad sweep costs a millisecond.
 */
function everyReachableObjective() {
  const found = new Map();
  const booleans = [false, true];

  // Every siege shape beaconObjectiveFor branches on, read off that function rather than guessed.
  // It is ordered most-specific-first internally, so the sweep has to include shapes that fall all
  // the way through as well as ones that stop at the top.
  const sieges = [
    null,
    { sealsLeft: 0 },
    { sealsLeft: 3 },
    { wardenMode: 'waking' },
    { wardenMode: 'rising' },
    { wardenMode: 'dead' },
    { beaconLit: true, wardenMode: 'dying' },
    { beaconLit: true, wardenMode: 'dead' },
    { beaconLit: true, bladeOwned: true },
    { beaconLit: true, bladeOwned: true, blackthornTorn: true },
    { beaconLit: true, bladeOwned: true, blackthornTorn: true, hollowFound: true },
    { beaconLit: true, bladeOwned: true, blackthornTorn: true, hollowFound: true, lodgeFound: true },
  ];

  // The trail flags, as whole shapes rather than a full cross product of seven booleans. The branch
  // reads them in a fixed priority order, so what matters is reaching each level of it -- and 128
  // combinations of flags that cannot co-occur would be a slower way to cover less.
  const trails = [
    null,
    { lights: 6, lit: 0 },
    { lights: 6, lit: 2 },
    { lights: 6, lit: 6 },
    { lights: 0, lit: 0 },
    { lights: 6, lit: 6, atBramble: true },
    { lights: 6, lit: 6, campFound: true },
    { lights: 6, lit: 6, campFound: true, rowanMet: true },
    { lights: 6, lit: 6, campFound: true, rowanMet: true, cartSearched: true },
    { lights: 6, lit: 6, beaconFound: true },
    { lights: 6, lit: 6, campFound: true, rowanMet: true, cartSearched: true, beaconFound: true },
  ];

  for (const marks of [0, 1, 2, 3]) {
    for (const lanternUnlocked of booleans) {
      for (const treeLit of booleans) {
        for (const gateFound of booleans) {
          for (const questGiven of booleans) {
            for (const trail of trails) {
              for (const siege of sieges) {
                const objective = questObjectiveFor(
                  { marks, lanternUnlocked }, treeLit, gateFound, questGiven, trail, siege,
                );
                if (objective) found.set(objective.id, objective);
              }
            }
          }
        }
      }
    }
  }
  return found;
}

test('the sweep actually reaches a useful number of objectives', () => {
  // A completeness check over an empty set passes and proves nothing. This is the guard on the
  // guard: if a refactor makes questObjectiveFor return nothing for these shapes, the test below
  // would go quietly green while covering zero branches.
  const reachable = everyReachableObjective();
  assert.ok(reachable.size >= 10,
    `the sweep only reached ${reachable.size} objectives; it is no longer exercising the branch`);
  assert.ok(reachable.has('meet-the-keeper'), 'the very first objective must be reachable');
  assert.ok(reachable.has('light-the-tree'), 'the quest payoff must be reachable');
});

test('EVERY objective the branch can produce has a destination entry', () => {
  const missing = [];
  for (const [id] of everyReachableObjective()) {
    if (!DESTINATION_IDS.includes(id)) missing.push(id);
  }
  assert.deepEqual(missing, [],
    `these objectives can appear on screen with no answer to "where is it": ${missing.join(', ')}`);
});

test('and every destination entry names an objective that actually exists', () => {
  // The other direction. A stale entry is harmless at runtime and is a lie in the file -- it reads
  // as coverage for an objective nobody can reach any more.
  const reachable = everyReachableObjective();
  // `find-marks` and the counting objectives are reachable; anything here that is not is dead.
  const orphans = DESTINATION_IDS.filter((id) => !reachable.has(id));
  assert.deepEqual(orphans, [],
    `these destinations are for objectives the branch can no longer produce: ${orphans.join(', ')}`);
});

test('a placed objective resolves to the world coordinate it names', () => {
  const keeper = destinationFor(OBJECTIVE_MEET_THE_KEEPER);
  assert.deepEqual(keeper, { x: SPAWNS.keeper[0], z: SPAWNS.keeper[1] },
    'the arrow points at the Keeper the game actually spawned, not at a number typed twice');

  const tree = LANDMARKS.find((l) => l.model.includes('lantern_tree'));
  assert.deepEqual(destinationFor(OBJECTIVE_LIGHT_THE_TREE), { x: tree.at[0], z: tree.at[1] });
});

test('the Lantern Tree lookup finds exactly one landmark', () => {
  // The ledger's rule for a name-fragment lookup. A second lantern-tree model would make `find`
  // return whichever came first, and the arrow would point at an arbitrary one of them.
  const matches = LANDMARKS.filter((l) => l.model.includes('lantern_tree'));
  assert.equal(matches.length, 1, `expected one lantern tree, found ${matches.length}`);
});

test('an objective with no place says so, and says why', () => {
  const hunting = objectiveFindMarks(3);
  assert.equal(destinationFor(hunting), null);
  const reason = placelessReasonFor(hunting);
  assert.ok(reason && reason.length > 0, 'a null with no reason reads as an oversight');
  assert.match(reason, /moves/i, 'and the reason should say what makes it placeless');
});

test('a dynamic place comes from the caller, because only the caller knows it', () => {
  const waking = questObjectiveFor(
    { marks: 3, lanternUnlocked: true }, true, true, true,
    { lights: 6, lit: 2, campFound: false, rowanMet: false, cartSearched: false, beaconFound: false },
  );
  assert.equal(waking.id, 'wake-lights', 'premise: this shape reaches the counting objective');

  assert.equal(destinationFor(waking), null, 'with nothing supplied there is nowhere to point');
  assert.deepEqual(
    destinationFor(waking, { nearestUnlitLight: { x: 3, z: 20 } }),
    { x: 3, z: 20 },
    'and with the caller supplying it, the arrow points at the light still out',
  );
});

test('an unknown or absent objective is nowhere rather than a crash', () => {
  // Reachable: questObjectiveFor returns null before the server has said anything.
  assert.equal(destinationFor(null), null);
  assert.equal(destinationFor(undefined), null);
  assert.equal(destinationFor({ id: 'not-a-real-objective' }), null);
  assert.equal(placelessReasonFor({ id: 'not-a-real-objective' }), null,
    'unknown is not the same as deliberately placeless, and must not borrow its reason');
});

test('the destination is the same object shape whichever way it was reached', () => {
  // A caller should not have to know whether a place was fixed or supplied.
  const fixed = destinationFor(OBJECTIVE_MEET_THE_KEEPER);
  const dynamic = destinationFor({ id: 'wake-lights' }, { nearestUnlitLight: { x: 1, z: 2 } });
  assert.deepEqual(Object.keys(fixed).sort(), ['x', 'z']);
  assert.deepEqual(Object.keys(dynamic).sort(), ['x', 'z']);
});

test('moving a place in the world moves the arrow, with nothing to remember', () => {
  // The property that makes importing rather than retyping worth doing. Asserted against the real
  // constant so that a change to the Beacon's position cannot leave this file behind.
  const beacon = questObjectiveFor(
    { marks: 3, lanternUnlocked: true }, true, true, true,
    { lights: 6, lit: 6, campFound: true, rowanMet: true, cartSearched: true, beaconFound: false },
  );
  assert.equal(beacon.id, 'find-the-beacon');
  assert.deepEqual(destinationFor(beacon), { x: OLD_BEACON.at[0], z: OLD_BEACON.at[1] });
});

// ── the nearest of several ─────────────────────────────────────────────────────────────────────

test('the next light is the CLOSEST one still out, not the first one written down', () => {
  // The whole reason this exists. A child at the far end of the trail must be sent to the light
  // beside them, not walked back to the start because that one happens to be first in the array.
  const stillOut = [{ x: 0, z: 0 }, { x: 0, z: 40 }, { x: 0, z: 20 }];
  assert.deepEqual(nearestPlaceTo(stillOut, 0, 38), { x: 0, z: 40 });
  assert.deepEqual(nearestPlaceTo(stillOut, 0, 1), { x: 0, z: 0 });
});

test('nothing left to do is null, not a crash and not the last one', () => {
  assert.equal(nearestPlaceTo([], 0, 0), null);
  assert.equal(nearestPlaceTo([null, undefined], 0, 0), null);
});

test('the same frame twice does not flip the arrow', () => {
  // Ties are arbitrary; what matters is that they are STABLE. An arrow that alternates between two
  // equidistant lights every frame is worse than no arrow.
  const tied = [{ x: -5, z: 0 }, { x: 5, z: 0 }];
  assert.deepEqual(nearestPlaceTo(tied, 0, 0), nearestPlaceTo(tied, 0, 0));
  assert.deepEqual(nearestPlaceTo(tied, 0, 0), { x: -5, z: 0 });
});

test('a dynamic objective resolves through it end to end', () => {
  // Not hand-feeding destinationFor a coordinate: this drives the real branch to the real objective
  // and then supplies the context the way main.js does.
  const waking = questObjectiveFor(
    { marks: 3, lanternUnlocked: true }, true, true, true,
    { lights: 6, lit: 2, campFound: false, rowanMet: false, cartSearched: false, beaconFound: false },
  );
  assert.equal(waking.id, 'wake-lights');
  const unlit = [{ x: 2, z: 30 }, { x: 3, z: 12 }];
  assert.deepEqual(
    destinationFor(waking, { nearestUnlitLight: nearestPlaceTo(unlit, 3, 10) }),
    { x: 3, z: 12 },
  );
});
