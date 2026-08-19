import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OBJECTIVE_FIND_THE_GATE,
  OBJECTIVE_KEEP_THE_VILLAGE_SAFE,
  OBJECTIVE_MEET_THE_KEEPER,
  OBJECTIVE_LIGHT_THE_TREE,
  objectiveFindMarks,
  questObjectiveFor,
} from '../public/src/world/quest.js';
import {
  KEEPER_LINE_ALL_MARKS,
  KEEPER_LINE_UNLOCKED,
  KEEPER_NAME,
  keeperLineFor,
} from '../public/src/world/keeperSpeech.js';
import { MARKS_TO_UNLOCK } from '../public/src/rewards/marks.js';

test('nothing is instructed before the server has said what this hero has', () => {
  assert.equal(questObjectiveFor(null, false), null);
  assert.equal(questObjectiveFor(undefined, false), null);
});

test('the hunt counts DOWN, so the objective is a target and not a score', () => {
  assert.equal(questObjectiveFor({ marks: 0, lanternUnlocked: false }, false), objectiveFindMarks(3));
  assert.equal(questObjectiveFor({ marks: 1, lanternUnlocked: false }, false), objectiveFindMarks(2));
  assert.equal(questObjectiveFor({ marks: 2, lanternUnlocked: false }, false), objectiveFindMarks(1));
  assert.match(objectiveFindMarks(1), /1 more Lantern Mark$/, 'the last one must not say "Marks"');
  assert.match(objectiveFindMarks(2), /2 more Lantern Marks/);
});

test('the first objective asks for exactly the number of marks the reward rule needs', () => {
  assert.equal(questObjectiveFor({ marks: 0, lanternUnlocked: false }, false),
    objectiveFindMarks(MARKS_TO_UNLOCK));
});

// The window this whole module exists for: the third mark is earned out at the wolf spawn, the
// lantern is unlocked, and the tree is still dark eighteen metres away.
test('a hero holding the light but standing at a dark tree is sent to the tree BY NAME', () => {
  const line = questObjectiveFor({ marks: 3, lanternUnlocked: true }, false);
  assert.equal(line, OBJECTIVE_LIGHT_THE_TREE);
  // The one step where a child must walk to a specific place. The chip has to name it, and it has to
  // name the same thing the Keeper does -- his line for this state is "stand by the tree".
  assert.match(line, /tree/i, `"${line}" does not say where to go`);
  assert.match(KEEPER_LINE_ALL_MARKS, /tree/i, 'the Keeper stopped naming the tree; the chip is now alone');
});

test('a lit tree points at the Wildwood Gate, and does so before any other branch', () => {
  assert.equal(questObjectiveFor({ marks: 3, lanternUnlocked: true }, true), OBJECTIVE_FIND_THE_GATE);
  // Even a state that "should not happen" -- lit tree, no unlock -- must not put the child back on
  // a finished objective.
  assert.equal(questObjectiveFor({ marks: 0, lanternUnlocked: false }, true), OBJECTIVE_FIND_THE_GATE);
});

// This used to assert the chip goes BLANK once the gate is found. It does not any more, and that was
// the defect rather than the contract: a finished quest with an empty chip is a child standing in a
// village with nothing named to do. The property that matters is that the objective MOVES ON.
test('finding the gate moves the objective on rather than emptying it', () => {
  assert.equal(questObjectiveFor({ marks: 3, lanternUnlocked: true }, true, false), OBJECTIVE_FIND_THE_GATE);
  const afterTheGate = questObjectiveFor({ marks: 3, lanternUnlocked: true }, true, true);
  assert.equal(afterTheGate, OBJECTIVE_KEEP_THE_VILLAGE_SAFE);
  assert.notEqual(afterTheGate, OBJECTIVE_FIND_THE_GATE, 'it must not keep pointing at a place they have been');
  assert.ok(afterTheGate, 'a finished quest still needs to name something a child can do');
  // Finding the gate before the tree is lit cannot skip the quest -- treeLit gates the branch.
  assert.equal(questObjectiveFor({ marks: 1, lanternUnlocked: false }, false, true), objectiveFindMarks(2));
});

// The chip and the Keeper have to agree about what a finished hero should be doing, or the game
// gives two answers -- which is exactly what it did before this pass, in the other direction.
test('the chip and the Keeper both stop sending a finished hero north once they have been', () => {
  assert.equal(keeperLineFor(true, 3, false), KEEPER_LINE_UNLOCKED);
  assert.match(KEEPER_LINE_UNLOCKED, /north/i, 'the pre-gate line is the one that points north');
  const afterTheGate = keeperLineFor(true, 3, true);
  assert.notEqual(afterTheGate, KEEPER_LINE_UNLOCKED);
  assert.doesNotMatch(afterTheGate, /north/i, 'he is still sending them somewhere they have been');
  assert.match(afterTheGate, /wolves/i, 'he should name the same thing the chip does');
});

test('a nonsense mark count never produces a nonsense objective', () => {
  for (const marks of [Number.NaN, undefined, -4, 99]) {
    const line = questObjectiveFor({ marks, lanternUnlocked: false }, false);
    assert.doesNotMatch(line, /NaN|undefined|-/, `"${line}" leaked a bad count`);
    assert.doesNotMatch(line, /\b0 more\b/, `"${line}" asks for nothing while the quest is open`);
  }
});

// The quest-giver has to be worth walking to. Before he speaks, the chip points AT him instead of
// announcing his quest for him.
test('a brand new player is sent to the Keeper, not handed his quest', () => {
  assert.equal(
    questObjectiveFor({ marks: 0, lanternUnlocked: false }, false, false, false),
    OBJECTIVE_MEET_THE_KEEPER,
  );
  assert.equal(
    questObjectiveFor({ marks: 0, lanternUnlocked: false }, false, false, true),
    objectiveFindMarks(3),
    'once he has spoken, the chip is the hunt',
  );
});

test('a returning player with progress is never sent back to be told what they are doing', () => {
  for (const marks of [1, 2, 3]) {
    assert.equal(
      questObjectiveFor({ marks, lanternUnlocked: false }, false, false, false),
      objectiveFindMarks(Math.max(1, 3 - marks)),
      `${marks} marks in and still being told to go and talk to someone`,
    );
  }
  assert.equal(
    questObjectiveFor({ marks: 3, lanternUnlocked: true }, false, false, false),
    OBJECTIVE_LIGHT_THE_TREE,
  );
  assert.equal(
    questObjectiveFor({ marks: 0, lanternUnlocked: false }, true, false, false),
    OBJECTIVE_FIND_THE_GATE,
    'a lit tree is past the introduction whatever the mark count says',
  );
});

test('the chip names the same Keeper the speech bubble does', () => {
  assert.ok(
    OBJECTIVE_MEET_THE_KEEPER.includes(KEEPER_NAME),
    `"${OBJECTIVE_MEET_THE_KEEPER}" points at somebody the game never introduces`,
  );
});

test('every objective reads at a glance and leads with a symbol', () => {
  const lines = [OBJECTIVE_LIGHT_THE_TREE, OBJECTIVE_FIND_THE_GATE, OBJECTIVE_MEET_THE_KEEPER,
    OBJECTIVE_KEEP_THE_VILLAGE_SAFE, objectiveFindMarks(1), objectiveFindMarks(3)];
  for (const line of lines) {
    assert.ok(line.split(/\s+/).length <= 6, `"${line}" is too long to read at a glance`);
    // A leading symbol, so it reads before it is read (AGENTS.md: signs use symbols, not text).
    assert.doesNotMatch(line[0], /[a-z0-9]/i, `"${line}" should lead with a symbol`);
  }
  assert.notEqual(OBJECTIVE_LIGHT_THE_TREE, objectiveFindMarks(1));
});
