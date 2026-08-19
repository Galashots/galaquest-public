// D4: the pure translation from a mark count to filled/empty pips, and the reward-event dispatch
// table -- both deliberately outside public/src/combat/, mirroring combat/feedback.js's own
// heartsForHp/createEncounterFeedback shapes exactly (same discipline, sibling directory) because
// mark-earned/lantern-unlocked are never raised by combat/encounter.js and so can never enter
// ENCOUNTER_EVENT_TYPES (which feedback.test.mjs pins to encounter.js's own source text) without
// either editing the guarded directory or breaking that guard's own regression test.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { MARKS_TO_UNLOCK } from '../public/src/rewards/marks.js';
import { RECIPES } from '../public/src/audio/recipes.js';
import { pipsForMarks } from '../public/src/rewards/hud.js';
import {
  REWARD_EVENT_TYPES,
  REWARD_RECIPE_MAP,
  createRewardFeedback,
  soundForRewardEvent,
} from '../public/src/rewards/feedback.js';

test('pipsForMarks fills from the left and leaves the rest empty', () => {
  assert.deepEqual(pipsForMarks(0), [false, false, false]);
  assert.deepEqual(pipsForMarks(1), [true, false, false]);
  assert.deepEqual(pipsForMarks(2), [true, true, false]);
  assert.deepEqual(pipsForMarks(3), [true, true, true]);
});

test('pipsForMarks clamps instead of drawing a negative or a fourth pip', () => {
  assert.deepEqual(pipsForMarks(-1), [false, false, false]);
  assert.deepEqual(pipsForMarks(99), [true, true, true]);
});

test('pipsForMarks defaults its length to MARKS_TO_UNLOCK', () => {
  assert.equal(pipsForMarks(0).length, MARKS_TO_UNLOCK);
});

test('REWARD_EVENT_TYPES is exactly the two award types marks.js can produce', () => {
  assert.deepEqual([...REWARD_EVENT_TYPES].sort(), ['lantern-unlocked', 'mark-earned']);
});

test('createRewardFeedback refuses to build with a missing handler', () => {
  assert.throws(() => createRewardFeedback({ 'mark-earned': () => {} }), /lantern-unlocked/);
});

test('createRewardFeedback accepts a complete handler table and dispatches by type', () => {
  const seen = [];
  const onRewardEvent = createRewardFeedback({
    'mark-earned': (event) => seen.push(event),
    'lantern-unlocked': (event) => seen.push(event),
  });
  onRewardEvent({ type: 'mark-earned', heroId: 'p1' });
  onRewardEvent({ type: 'lantern-unlocked', heroId: 'p1' });
  assert.deepEqual(seen.map((event) => event.type), ['mark-earned', 'lantern-unlocked']);
});

test('an event type outside the known set is logged rather than crashing the frame loop', () => {
  const onRewardEvent = createRewardFeedback({ 'mark-earned': () => {}, 'lantern-unlocked': () => {} });
  assert.doesNotThrow(() => onRewardEvent({ type: 'not-a-real-reward-event' }));
});

// Ruling 3's convention (audio/recipes.js) extended to the two reward events: every one DECIDED,
// not merely absent. Kept as its own table rather than folded into EVENT_RECIPE_MAP because that
// table's completeness tests are checked against combat/encounter.js's raised event types
// specifically -- these two are never raised there.
//
// They were both explicit `null` and are both real recipes now. The rule this test protects is
// unchanged and is the one that matters: neither may be UNDECIDED, and both names have to exist in
// RECIPES rather than being a string nothing can play.
test('both reward events are decided, and point at recipes that actually exist', () => {
  for (const type of ['mark-earned', 'lantern-unlocked']) {
    assert.ok(Object.prototype.hasOwnProperty.call(REWARD_RECIPE_MAP, type), `${type} is undecided`);
    const name = soundForRewardEvent(type);
    assert.equal(name, REWARD_RECIPE_MAP[type]);
    assert.ok(name !== null && Object.prototype.hasOwnProperty.call(RECIPES, name),
      `${type} maps to "${name}", which is not a recipe`);
  }
  // The two must not be the SAME sound: they fire seconds apart at the end of the same fight, and a
  // child has to be able to tell "another mark" from "that was the last one".
  assert.notEqual(soundForRewardEvent('mark-earned'), soundForRewardEvent('lantern-unlocked'));
});

test('soundForRewardEvent never throws on an unknown type', () => {
  assert.equal(soundForRewardEvent('not-a-real-event'), null);
});

// The same coupling test feedback.test.mjs runs for HERO_MAX_HP hearts, applied to the pips: the
// markup must be updated by hand if MARKS_TO_UNLOCK ever changes.
test('index.html draws exactly MARKS_TO_UNLOCK lantern-mark pips', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = readFileSync(resolve(repoRoot, 'public/index.html'), 'utf8');
  const pips = source.match(/class="mark"/g) ?? [];
  assert.equal(pips.length, MARKS_TO_UNLOCK, 'the markup must be updated by hand if MARKS_TO_UNLOCK changes');
});
