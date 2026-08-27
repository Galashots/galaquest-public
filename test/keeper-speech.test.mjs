import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KEEPER_LINE_ALL_MARKS,
  KEEPER_LINE_ONE_MARK,
  KEEPER_LINE_QUEST,
  KEEPER_LINE_TWO_MARKS,
  KEEPER_LINE_UNLOCKED,
  keeperLineFor,
  keeperSpeechState,
  readAloudUnlocked,
  resetReadAloudForTests,
  speakKeeperLine,
  speakKeeperLineIfUnlocked,
} from '../public/src/world/keeperSpeech.js';
import { KEEPER_WAVE_RADIUS_METERS } from '../public/src/world/zoneLoader.js';

// W1: the game's first tap-to-hear control. Unit-test the pure parts named in the brief --
// proximity edge, line selection by unlock state, show/hide -- and the TTS handoff through an
// injectable speak function. No DOM, no three.js, no real speechSynthesis anywhere in this file.

test('keeperLineFor picks the quest line when the local hero is not yet unlocked', () => {
  assert.equal(keeperLineFor(false), KEEPER_LINE_QUEST);
  assert.equal(keeperLineFor(undefined), KEEPER_LINE_QUEST);
});

test('keeperLineFor picks the congratulation line once the local hero IS unlocked', () => {
  assert.equal(keeperLineFor(true), KEEPER_LINE_UNLOCKED);
});

// Sabotage-verify: a selector that always returned the quest line would pass the test above too.
test('sabotage: keeperLineFor is NOT a constant -- true and false give different lines', () => {
  assert.notEqual(keeperLineFor(true), keeperLineFor(false));
});

test('the quest line still names the three marks and the wolves', () => {
  assert.match(KEEPER_LINE_QUEST, /three Lantern Marks/);
  assert.match(KEEPER_LINE_QUEST, /wolves/);
});

// Written for the the younger bracket reader, so the shape of the sentences is part of the feature and not a
// matter of taste that can quietly drift. "Wilderness" was in the shipped line; it is exactly the
// class of word this checks against, along with the em dash and the 27-word single sentence.
//
// EVERY line, discovered from the module rather than listed here. A hardcoded list is a promise that
// somebody will remember to extend it, and the sixth line (KEEPER_LINE_GATE_FOUND) was written and
// shipped past this check before that was noticed.
test('every keeper line reads for a young player: short sentences, no em dashes', async () => {
  const speech = await import('../public/src/world/keeperSpeech.js');
  const lines = Object.entries(speech)
    .filter(([name, value]) => name.startsWith('KEEPER_LINE_') && typeof value === 'string')
    .map(([, value]) => value);
  assert.ok(lines.length >= 6, `only found ${lines.length} keeper lines -- the discovery is broken`);
  for (const line of lines) {
    assert.doesNotMatch(line, /[—;]/, `"${line}" uses punctuation a young reader stops at`);
    assert.doesNotMatch(line, /Keeper Aldric/, `"${line}" repeats the speaker's name inside the line`);
    for (const sentence of line.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean)) {
      const words = sentence.split(/\s+/).length;
      assert.ok(words <= 10, `"${sentence}" is ${words} words; keep sentences to ten or fewer`);
    }
  }
});

test('the keeper counts the marks the player has actually earned', () => {
  assert.equal(keeperLineFor(false, 0), KEEPER_LINE_QUEST);
  assert.equal(keeperLineFor(false, 1), KEEPER_LINE_ONE_MARK);
  assert.equal(keeperLineFor(false, 2), KEEPER_LINE_TWO_MARKS);
  assert.equal(keeperLineFor(false, 3), KEEPER_LINE_ALL_MARKS);
  // Five distinct lines, not four with a repeat -- the point of the change is that walking back
  // mid-quest is worth doing.
  assert.equal(new Set([
    keeperLineFor(false, 0), keeperLineFor(false, 1), keeperLineFor(false, 2),
    keeperLineFor(false, 3), keeperLineFor(true, 3),
  ]).size, 5);
});

test('an unlocked lantern wins over any mark count, and a missing count reads as none', () => {
  assert.equal(keeperLineFor(true, 0), KEEPER_LINE_UNLOCKED);
  assert.equal(keeperLineFor(true, 9), KEEPER_LINE_UNLOCKED);
  assert.equal(keeperLineFor(false), KEEPER_LINE_QUEST);
  assert.equal(keeperLineFor(false, Number.NaN), KEEPER_LINE_QUEST);
  // More kills than the quest needs still reads as finished, not as an unknown state.
  assert.equal(keeperLineFor(false, 7), KEEPER_LINE_ALL_MARKS);
});

const KEEPER_AT = { keeperX: -3.8, keeperZ: -3.2 };

test('keeperSpeechState is visible with the quest line at the keeper\'s own position (distance 0)', () => {
  const state = keeperSpeechState({
    heroX: KEEPER_AT.keeperX, heroZ: KEEPER_AT.keeperZ, ...KEEPER_AT,
    radiusMeters: KEEPER_WAVE_RADIUS_METERS, lanternUnlocked: false,
  });
  assert.deepEqual(state, { visible: true, line: KEEPER_LINE_QUEST });
});

test('keeperSpeechState is visible right at the radius edge (<=), not just strictly inside it', () => {
  const state = keeperSpeechState({
    heroX: KEEPER_AT.keeperX + KEEPER_WAVE_RADIUS_METERS, heroZ: KEEPER_AT.keeperZ, ...KEEPER_AT,
    radiusMeters: KEEPER_WAVE_RADIUS_METERS, lanternUnlocked: false,
  });
  assert.equal(state.visible, true);
});

test('keeperSpeechState hides (and drops the line) just outside the radius -- "hide when the hero walks away"', () => {
  const state = keeperSpeechState({
    heroX: KEEPER_AT.keeperX + KEEPER_WAVE_RADIUS_METERS + 0.01, heroZ: KEEPER_AT.keeperZ, ...KEEPER_AT,
    radiusMeters: KEEPER_WAVE_RADIUS_METERS, lanternUnlocked: false,
  });
  assert.deepEqual(state, { visible: false, line: null });
});

test('keeperSpeechState carries the unlock state through to the line it picks, while near', () => {
  const near = { heroX: KEEPER_AT.keeperX, heroZ: KEEPER_AT.keeperZ, ...KEEPER_AT, radiusMeters: KEEPER_WAVE_RADIUS_METERS };
  assert.equal(keeperSpeechState({ ...near, lanternUnlocked: false }).line, KEEPER_LINE_QUEST);
  assert.equal(keeperSpeechState({ ...near, lanternUnlocked: true }).line, KEEPER_LINE_UNLOCKED);
});

// Sabotage-verify: a state function that always reported visible:true would pass every "is
// visible" assertion above -- prove the far case really is measured as outside the radius, the
// same discipline zoneLoader.js's own distance() sabotage test uses.
test('sabotage: keeperSpeechState correctly reports a point FAR outside the radius as hidden', () => {
  const far = keeperSpeechState({
    heroX: KEEPER_AT.keeperX + 50, heroZ: KEEPER_AT.keeperZ, ...KEEPER_AT,
    radiusMeters: KEEPER_WAVE_RADIUS_METERS, lanternUnlocked: true,
  });
  assert.equal(far.visible, false);
});

test('speakKeeperLine hands the exact line to an injectable speak function', () => {
  const heard = [];
  speakKeeperLine(KEEPER_LINE_QUEST, (text) => heard.push(text));
  assert.deepEqual(heard, [KEEPER_LINE_QUEST]);
});

test('speakKeeperLine never calls speak for a null line (nothing to hear when hidden)', () => {
  const heard = [];
  speakKeeperLine(null, (text) => heard.push(text));
  assert.deepEqual(heard, []);
});

// Sabotage-verify: a speakKeeperLine that silently swallowed everything would pass the "never
// calls" test above for the wrong reason too -- prove the real line DOES reach the function.
test('sabotage: speakKeeperLine is not a no-op -- a real line reaches the injected speak function', () => {
  let calls = 0;
  speakKeeperLine(KEEPER_LINE_UNLOCKED, () => { calls += 1; });
  assert.equal(calls, 1);
});

// ── read-aloud, for the child this game is actually for ─────────────────────────────────────────
//
// The whole of this game's narrative reached a pre-reader only through a 44px grey circle they had
// to notice and guess the purpose of. Nothing ever spoke on its own, because iOS will not make a
// sound until speechSynthesis has been called inside a real gesture. So the first line buys the
// permission and every line after it speaks itself.

test('nothing is read aloud before the child has asked to be read to', () => {
  resetReadAloudForTests();
  const spoken = [];
  const said = speakKeeperLineIfUnlocked(KEEPER_LINE_QUEST, (text) => spoken.push(text));
  assert.equal(said, false, 'a line spoke itself to a child who never tapped the button');
  assert.deepEqual(spoken, []);
});

test('one tap on the button, and every line after it reads itself', () => {
  resetReadAloudForTests();
  const spoken = [];
  const speak = (text) => spoken.push(text);

  assert.equal(readAloudUnlocked(), false, 'premise: a fresh page has not been unlocked');
  speakKeeperLine(KEEPER_LINE_QUEST, speak);
  assert.equal(readAloudUnlocked(), true, 'the tap did not record that read-aloud is wanted');

  speakKeeperLineIfUnlocked(KEEPER_LINE_ONE_MARK, speak);
  speakKeeperLineIfUnlocked(KEEPER_LINE_TWO_MARKS, speak);
  assert.deepEqual(spoken, [KEEPER_LINE_QUEST, KEEPER_LINE_ONE_MARK, KEEPER_LINE_TWO_MARKS],
    'the child tapped once and the game stopped reading to them');
});

test('an empty line is not read aloud, unlocked or not', () => {
  resetReadAloudForTests();
  const spoken = [];
  speakKeeperLine(KEEPER_LINE_QUEST, (text) => spoken.push(text));
  assert.equal(speakKeeperLineIfUnlocked(null, (text) => spoken.push(text)), false);
  assert.equal(speakKeeperLineIfUnlocked('', (text) => spoken.push(text)), false);
  assert.deepEqual(spoken, [KEEPER_LINE_QUEST], 'silence was announced out loud');
});
