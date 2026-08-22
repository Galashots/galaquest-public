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

// The list is pinned rather than derived, and the pin is the point: anything not in it falls through
// to the COMBAT dispatcher, which logs "no handler" -- and a console error is itself a harness
// failure ("no console errors across the whole run"). So a reward event type is only half-added
// until it is here, and this test is what makes the other half impossible to forget.
//
// It used to read "exactly the two award types marks.js can produce", which stopped being the right
// description before it stopped being the right list: these are the durable-fact events the reward
// coordinator ANNOUNCES, and net/gameServer.mjs's applyLootAward announces currency for the same
// reason applyMarkAward announces a mark -- so a device can journal the fact under the store's own
// id instead of receiving a count it cannot deduplicate.
test('REWARD_EVENT_TYPES is exactly the durable facts the reward coordinator announces', () => {
  assert.deepEqual(
    [...REWARD_EVENT_TYPES].sort(),
    [
      'charm-earned', 'coin-earned', 'gear-owned', 'lantern-unlocked',
      'mark-earned', 'satchel-taken', 'shard-earned',
    ],
  );
});

test('createRewardFeedback refuses to build with a missing handler', () => {
  assert.throws(() => createRewardFeedback({ 'mark-earned': () => {} }), /lantern-unlocked/);
});

/** A complete table, built from the list rather than typed out, so this helper cannot go stale the
 *  way the assertions above deliberately can. */
function completeHandlers(onEvent = () => {}) {
  return Object.fromEntries(REWARD_EVENT_TYPES.map((type) => [type, onEvent]));
}

test('createRewardFeedback accepts a complete handler table and dispatches by type', () => {
  const seen = [];
  const onRewardEvent = createRewardFeedback(completeHandlers((event) => seen.push(event)));
  for (const type of REWARD_EVENT_TYPES) onRewardEvent({ type, heroId: 'p1' });
  assert.deepEqual(seen.map((event) => event.type), [...REWARD_EVENT_TYPES]);
});

test('an event type outside the known set is logged rather than crashing the frame loop', () => {
  const onRewardEvent = createRewardFeedback(completeHandlers());
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
test('every reward event is decided, and any sound it names actually exists', () => {
  // DECIDED, not necessarily audible. Explicit `null` is a decision and this file's own history is
  // why: mark-earned and lantern-unlocked were both null on purpose while their sound was an open
  // taste call. What is forbidden is UNDECIDED -- a type with no entry at all, which reads the same
  // as silence and means nobody thought about it.
  for (const type of REWARD_EVENT_TYPES) {
    assert.ok(Object.prototype.hasOwnProperty.call(REWARD_RECIPE_MAP, type), `${type} is undecided`);
    const name = soundForRewardEvent(type);
    assert.equal(name, REWARD_RECIPE_MAP[type]);
    if (name !== null) {
      assert.ok(Object.prototype.hasOwnProperty.call(RECIPES, name),
        `${type} maps to "${name}", which is not a recipe`);
    }
  }

  // The quest beats must not be the SAME sound: they fire seconds apart at the end of the same
  // fight, and a child has to be able to tell "another mark" from "that was the last one".
  assert.notEqual(soundForRewardEvent('mark-earned'), soundForRewardEvent('lantern-unlocked'));

  // Currency is deliberately silent HERE, because the pickup already has its own sound and its own
  // burst -- a second one fired from the durable announcement would play one moment twice, which is
  // the defect GP1-C6 fixed for marks in the other direction. Asserted rather than assumed, so
  // giving them a sound later is a deliberate edit to this line and not an accident.
  for (const durableOnly of ['coin-earned', 'shard-earned', 'gear-owned', 'satchel-taken', 'charm-earned']) {
    assert.equal(soundForRewardEvent(durableOnly), null,
      `${durableOnly} announces a fact for the journal; its beat is fired by diffing the rewards block`);
  }
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
