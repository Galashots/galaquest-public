// Offering help to a child who is lost, and — the part these tests are really about — not offering
// it to a child who is fine.
//
// A guidance system that fires too eagerly is worse than none: it teaches a child that the game
// talks over them, and they stop reading it at exactly the point it has something to say. So most
// of what follows is cases where the right behaviour is SILENCE.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  DEFAULT_PATIENCE_SECONDS,
  MAX_CREDITED_SECONDS,
  PROGRESS_EPSILON_METERS,
  createRescueWatch,
} from '../public/src/ui/guidanceRescue.js';

const OBJ = 'find-the-keeper';

/** Feed the watch a run of distances, one per simulated second. Returns the last result. */
function walk(watch, distances, { objectiveId = OBJ, deltaSeconds = 1 } = {}) {
  let last = null;
  for (const distanceMeters of distances) {
    last = watch.update({ distanceMeters, objectiveId, deltaSeconds });
  }
  return last;
}

/** N seconds of standing perfectly still at one distance. */
const still = (metres, seconds) => Array.from({ length: seconds }, () => metres);

test('a child walking towards the thing is never interrupted', () => {
  const watch = createRescueWatch();
  // Twenty metres closed at one metre a second: twenty seconds, well past the patience, and the
  // watch must stay silent the whole way because every step is progress.
  const result = walk(watch, Array.from({ length: 20 }, (_, i) => 20 - i));
  assert.equal(result.offering, false);
  assert.equal(result.secondsStuck, 0);
});

test('a child who has stopped getting closer is offered help, once the patience is up', () => {
  const watch = createRescueWatch();
  const before = walk(watch, still(15, DEFAULT_PATIENCE_SECONDS - 1));
  assert.equal(before.offering, false, 'not one second early');

  const after = watch.update({ distanceMeters: 15, objectiveId: OBJ, deltaSeconds: 1 });
  assert.equal(after.offering, true);
  assert.equal(after.secondsStuck, DEFAULT_PATIENCE_SECONDS);
});

test('circling counts as stuck, because it is', () => {
  // The case a "are they walking away from it" rule gets wrong. A child running a tight circle two
  // metres from where they started is moving constantly and getting nowhere. Distances wobble
  // without ever beating the best.
  const watch = createRescueWatch();
  // A tight circle AROUND WHERE THEY ARE STANDING: the distance to a thing twelve metres off barely
  // changes. The wobble is deliberately smaller than the progress threshold, because that is what
  // this shape of stuck actually looks like -- my first draft swung +/-1.5 m, which genuinely gets
  // nearer and is therefore a child making progress in a curve, not a child stuck.
  const circle = [];
  for (let i = 0; i < DEFAULT_PATIENCE_SECONDS; i += 1) circle.push(12 + Math.sin(i) * 0.1);
  const result = walk(watch, circle);
  assert.equal(result.offering, true, 'movement is not progress');
});

test('rounding a corner is NOT stuck, even though it walks away', () => {
  // The case the same naive rule gets wrong in the other direction. A child going around a house
  // moves away for several seconds and is not lost at all -- and then beats their best.
  const watch = createRescueWatch();
  const aroundTheHouse = [20, 21, 22, 23, 22, 20, 17, 14];
  const result = walk(watch, aroundTheHouse);
  assert.equal(result.offering, false);
  assert.equal(result.bestMeters, 14, 'the detour is forgiven the moment they get nearer than before');
});

test('progress has to be real progress, not reconciliation drift', () => {
  // The hero is nudged by a tenth of the prediction error per snapshot even while a child stands
  // perfectly still. Counting that as getting closer would reset the clock forever and the offer
  // would never come -- silent failure, and the worst kind, because it looks like restraint.
  // Modelled as a DECAYING settle, which is what reconciliation actually is: the client closes a
  // tenth of its error per snapshot, so the total movement is bounded and converges. My first draft
  // used a steady creep of epsilon/3 per second, which after four seconds has moved a whole metre --
  // and that is a child walking slowly, not drift. The watch was right to call it progress; the
  // test was wrong about the physics.
  const watch = createRescueWatch();
  const drifting = [];
  let error = 0.2; // total settle, deliberately under the epsilon
  let d = 15;
  for (let i = 0; i < DEFAULT_PATIENCE_SECONDS; i += 1) {
    d -= error * 0.1;
    error *= 0.9;
    drifting.push(d);
  }
  assert.ok(drifting[0] - drifting.at(-1) < PROGRESS_EPSILON_METERS,
    'the fixture must settle by LESS than the threshold, or it is not modelling drift');
  const result = walk(watch, drifting);
  assert.equal(result.offering, true, 'sub-threshold settling is not walking');
});

test('one real step forward silences it again', () => {
  const watch = createRescueWatch();
  assert.equal(walk(watch, still(15, DEFAULT_PATIENCE_SECONDS)).offering, true);

  const moved = watch.update({ distanceMeters: 15 - PROGRESS_EPSILON_METERS - 0.1, objectiveId: OBJ, deltaSeconds: 1 });
  assert.equal(moved.offering, false);
  assert.equal(moved.secondsStuck, 0);
});

// ── the silence, which is the hard half ────────────────────────────────────────────────────────

test('a child who waves the offer away is not asked again for standing still longer', () => {
  const watch = createRescueWatch();
  walk(watch, still(15, DEFAULT_PATIENCE_SECONDS));
  watch.dismiss();

  // Another full patience of getting nowhere. Someone who has just said no is the last person to
  // ask again sooner, and time alone must not earn the right to speak.
  const later = walk(watch, still(15, DEFAULT_PATIENCE_SECONDS * 3));
  assert.equal(later.offering, false);
  assert.ok(later.secondsStuck > DEFAULT_PATIENCE_SECONDS, 'still counting, just not talking');
});

test('...but it will speak again once they have actually got somewhere and stuck again', () => {
  const watch = createRescueWatch();
  walk(watch, still(15, DEFAULT_PATIENCE_SECONDS));
  watch.dismiss();

  walk(watch, [10]);                                   // real progress: earns the right to speak
  const stuckAgain = walk(watch, still(10, DEFAULT_PATIENCE_SECONDS));
  assert.equal(stuckAgain.offering, true, 'a new stretch of being lost is a new question');
});

test('accepting the help is as quieting as dismissing it', () => {
  const watch = createRescueWatch();
  walk(watch, still(15, DEFAULT_PATIENCE_SECONDS));
  watch.accept();
  assert.equal(walk(watch, still(15, DEFAULT_PATIENCE_SECONDS * 2)).offering, false);
});

test('a new objective starts a new question, and does not inherit the old clock', () => {
  // Reachable and nasty: finish an errand while stuck on it, and the stale clock would offer help
  // for the NEXT one on the first frame -- the moment a child is least lost and most pleased.
  const watch = createRescueWatch();
  walk(watch, still(15, DEFAULT_PATIENCE_SECONDS));
  assert.equal(watch.debugState().offering, true);

  const fresh = watch.update({ distanceMeters: 40, objectiveId: 'light-the-tree', deltaSeconds: 1 });
  assert.equal(fresh.offering, false);
  assert.ok(fresh.secondsStuck < DEFAULT_PATIENCE_SECONDS,
    `the clock restarted, got ${fresh.secondsStuck}s carried into a brand-new errand`);
  assert.equal(fresh.bestMeters, 40, 'the new errand is measured from where it actually starts');
});

test('an objective with no place says nothing, which is not the same as saying no', () => {
  // "Cut the black bramble" is the thing in front of you; there is no coordinate to be far from.
  // The watch must not accumulate a stuck clock against a distance it cannot measure.
  const watch = createRescueWatch();
  const result = walk(watch, Array.from({ length: DEFAULT_PATIENCE_SECONDS * 2 }, () => NaN));
  assert.equal(result.offering, false);
  assert.equal(result.secondsStuck, 0);
});

test('a placeless stretch does not poison the objective it interrupts', () => {
  const watch = createRescueWatch();
  walk(watch, still(15, DEFAULT_PATIENCE_SECONDS - 2));
  walk(watch, [NaN, NaN]);                      // the bramble takes over for two seconds
  const back = walk(watch, still(15, 2));        // and hands it back
  assert.equal(back.offering, false, 'the clock restarted rather than resuming at the threshold');
});

// ── shapes a real frame loop produces ──────────────────────────────────────────────────────────

test('it counts seconds, not frames', () => {
  // main.js clamps deltaSeconds to 0.1, so a starved runner advances slower than wall clock. A
  // frame counter would make "twelve seconds" mean two different things on two devices; the same
  // reasoning the harness budgets carry.
  // One frame past the threshold, not exactly on it. Summing 720 times 1/60 in binary floating point
  // lands at 11.999999999999998, so an assertion on the exact boundary would be testing IEEE-754
  // rather than the rule. Being offered help one sixtieth of a second late is not a defect worth
  // engineering against, and pretending the accumulator is exact would be.
  const frames = (fps) => {
    const watch = createRescueWatch();
    for (let i = 0; i <= DEFAULT_PATIENCE_SECONDS * fps; i += 1) {
      watch.update({ distanceMeters: 9, objectiveId: OBJ, deltaSeconds: 1 / fps });
    }
    return watch.debugState();
  };
  assert.equal(frames(60).offering, true, '60 fps');
  assert.equal(frames(5).offering, true, '5 fps, same twelve seconds');
  // And a frame rate below the threshold's own granularity still counts real time rather than ticks.
  assert.equal(frames(2).offering, true, '2 fps, the starved-runner case');
});

test('a tablet put down and picked up again is not a child standing still', () => {
  // The other half of "patience is wall-clock". main.js hands this the RAW frame delta, because the
  // movement clamp of 0.1 s made the clock run at 40% of real time on a starved device -- measured
  // in a browser, 5.97 s of patience over 15 wall-clock seconds, and the offer never came.
  //
  // Raw wall-clock then fails the opposite way: a device asleep for five minutes returns ONE frame
  // with a 300-second delta, and a child coming back to their game would be met instantly with an
  // offer of help for standing still while the screen was off. They were not staring at it. They
  // were not there.
  const watch = createRescueWatch();
  const back = watch.update({ distanceMeters: 15, objectiveId: OBJ, deltaSeconds: 300 });
  assert.equal(back.offering, false, 'five minutes of being elsewhere is not five minutes of being lost');
  assert.equal(back.secondsStuck, MAX_CREDITED_SECONDS, 'the gap is credited as one second, not as nothing and not as 300');

  // And a genuinely slow device is still counted honestly, which is what stops the bound becoming
  // a second version of the bug it fixes.
  const starved = createRescueWatch();
  for (let i = 0; i < DEFAULT_PATIENCE_SECONDS * 2; i += 1) {
    starved.update({ distanceMeters: 9, objectiveId: OBJ, deltaSeconds: 0.5 });
  }
  assert.equal(starved.debugState().offering, true, '2 fps for twelve real seconds is twelve real seconds');
});

test('a negative or absent delta cannot rush the offer', () => {
  const watch = createRescueWatch();
  for (let i = 0; i < 500; i += 1) watch.update({ distanceMeters: 9, objectiveId: OBJ, deltaSeconds: -1 });
  assert.equal(watch.debugState().offering, false);
  assert.equal(watch.debugState().secondsStuck, 0);
});

test('the patience is configurable, so the integrated opening can tune it', () => {
  const impatient = createRescueWatch({ patienceSeconds: 3 });
  assert.equal(walk(impatient, still(9, 2)).offering, false);
  assert.equal(walk(impatient, still(9, 1)).offering, true);
});
