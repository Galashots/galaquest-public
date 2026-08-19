import { strict as assert } from 'node:assert';
import test from 'node:test';

import { ENCOUNTER_EVENT_TYPES } from '../public/src/combat/feedback.js';
import {
  DIRECTLY_PLAYED_RECIPES,
  EVENT_RECIPE_MAP,
  RECIPES,
  soundForEvent,
} from '../public/src/audio/recipes.js';
import { REWARD_RECIPE_MAP } from '../public/src/rewards/feedback.js';

// Ruling 3: the table must DECIDE every event feedback.js can raise -- mapped to a recipe name, or
// explicitly null. A missing key (as opposed to a key whose value is null) means the table has not
// decided, which is exactly the drift ENCOUNTER_EVENT_TYPES exists to catch.
test('EVENT_RECIPE_MAP decides every event type feedback.js raises', () => {
  const undecided = ENCOUNTER_EVENT_TYPES.filter(
    (type) => !Object.prototype.hasOwnProperty.call(EVENT_RECIPE_MAP, type),
  );
  assert.deepEqual(undecided, [], `these events have no entry at all in EVENT_RECIPE_MAP: ${undecided.join(', ')}`);
});

test('EVENT_RECIPE_MAP has no stray entries for events feedback.js does not raise', () => {
  const known = new Set(ENCOUNTER_EVENT_TYPES);
  const stray = Object.keys(EVENT_RECIPE_MAP).filter((type) => !known.has(type));
  assert.deepEqual(stray, [], `EVENT_RECIPE_MAP has entries feedback.js never raises: ${stray.join(', ')}`);
});

test('soundForEvent agrees with EVENT_RECIPE_MAP for every known event type', () => {
  for (const type of ENCOUNTER_EVENT_TYPES) {
    assert.equal(soundForEvent(type), EVENT_RECIPE_MAP[type], `soundForEvent('${type}') must match the table`);
  }
});

// Ruling 3's six mappings, asserted exactly. Recipe names are ours to choose; this test pins them.
test('the six mapped events resolve to the recipes ruling 3 describes', () => {
  assert.equal(soundForEvent('swing'), 'whoosh');
  assert.equal(soundForEvent('wolf-hit'), 'impact');
  assert.equal(soundForEvent('hero-hurt'), 'thud');
  assert.equal(soundForEvent('wolf-defeated'), 'victory-sting');
  assert.equal(soundForEvent('hero-down'), 'low-sting');
  assert.equal(soundForEvent('hero-respawned'), 'soft-chime');
});

// The two events ruling 3 calls out as explicitly silent -- not merely falsy, exactly null.
// wolf-respawned WAS the third (Phase C ruling 1), until pre-brief-discussion.md decision 4
// (Phase D): a low growl warning, because the wolf respawns at its spawn point, likely
// off-screen, and a young player needs to know it is back.
test('swing-missed and swing-dropped are explicitly silent; bite-missed too', () => {
  assert.equal(soundForEvent('swing-missed'), null);
  assert.equal(soundForEvent('swing-dropped'), null);
  assert.equal(soundForEvent('bite-missed'), null);
});

// Phase D, pre-brief-discussion.md decision 4: wolf-respawned gets a low growl, no longer silent.
test('wolf-respawned resolves to the growl recipe, not silence', () => {
  assert.equal(soundForEvent('wolf-respawned'), 'growl');
});

test('every recipe name EVENT_RECIPE_MAP points at actually exists in RECIPES', () => {
  for (const [type, recipeName] of Object.entries(EVENT_RECIPE_MAP)) {
    if (recipeName === null) continue;
    assert.ok(
      Object.prototype.hasOwnProperty.call(RECIPES, recipeName),
      `event '${type}' maps to recipe '${recipeName}', which is not in RECIPES`,
    );
    assert.ok(Array.isArray(RECIPES[recipeName]) && RECIPES[recipeName].length > 0, `recipe '${recipeName}' must be a non-empty list of steps`);
  }
});

const VALID_TYPES = new Set(['tone', 'noise']);

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// Ruling 2's step shape, checked on every step of every recipe: finite non-negative startSeconds,
// durationSeconds > 0, gainPeak in (0, 1], type only 'tone' or 'noise', and tones carrying
// frequencyStart/frequencyEnd within the audible-ish 40-8000 Hz band this game uses.
test('every step of every recipe is well-formed per the audio recipe step shape', () => {
  for (const [recipeName, steps] of Object.entries(RECIPES)) {
    steps.forEach((step, index) => {
      const where = `${recipeName}[${index}]`;

      assert.ok(VALID_TYPES.has(step.type), `${where}.type must be 'tone' or 'noise', got ${step.type}`);
      assert.ok(isFiniteNonNegative(step.startSeconds), `${where}.startSeconds must be finite and non-negative`);
      assert.ok(
        typeof step.durationSeconds === 'number' && Number.isFinite(step.durationSeconds) && step.durationSeconds > 0,
        `${where}.durationSeconds must be finite and > 0`,
      );
      assert.ok(
        typeof step.gainPeak === 'number' && Number.isFinite(step.gainPeak) && step.gainPeak > 0 && step.gainPeak <= 1,
        `${where}.gainPeak must be in (0, 1]`,
      );

      if (step.type === 'tone') {
        for (const key of ['frequencyStart', 'frequencyEnd']) {
          const value = step[key];
          assert.ok(
            typeof value === 'number' && Number.isFinite(value) && value >= 40 && value <= 8000,
            `${where}.${key} must be within 40-8000 Hz, got ${value}`,
          );
        }
      }
    });
  }
});

// Every recipe has to be REACHABLE, or the table quietly accumulates sounds nothing can play. Three
// routes now instead of one: encounter events (EVENT_RECIPE_MAP), reward events
// (rewards/feedback.js's own REWARD_RECIPE_MAP -- separate for the reason its header gives), and
// DIRECTLY_PLAYED_RECIPES for the Lantern Tree's relight, which is a client presentation beat with
// no event behind it at all. Naming that third route explicitly is what keeps this a real check
// rather than one weakened to ignore anything it does not recognise.
test('every recipe is reachable by SOME route -- no sound nothing can play', () => {
  const reachable = new Set([
    ...Object.values(EVENT_RECIPE_MAP),
    ...Object.values(REWARD_RECIPE_MAP),
    ...DIRECTLY_PLAYED_RECIPES,
  ].filter((name) => name !== null));
  const unreachable = Object.keys(RECIPES).filter((name) => !reachable.has(name));
  assert.deepEqual(unreachable, [], `RECIPES defines recipes nothing plays: ${unreachable.join(', ')}`);
});

test('every directly-played recipe exists, and is not also driven by an event', () => {
  const byEvent = new Set([
    ...Object.values(EVENT_RECIPE_MAP), ...Object.values(REWARD_RECIPE_MAP),
  ].filter((name) => name !== null));
  for (const name of DIRECTLY_PLAYED_RECIPES) {
    assert.ok(Object.prototype.hasOwnProperty.call(RECIPES, name), `${name} is not a recipe`);
    assert.ok(!byEvent.has(name), `${name} is played directly AND by an event; pick one`);
  }
});

// The Keeper's greeting is the only sound in the game that fires from PROXIMITY rather than from an
// event, and it fires every time a child walks back to him -- more often than anything else here. So
// its two jobs are checked directly: it has to be quiet enough never to become nagging, and it has
// to sit below every reward chime so a person does not sound like a coin.
test('the Keeper greets in a lower, quieter register than any reward sound', async () => {
  const { KEEPER_GREETING_RECIPE_NAME, RECIPES: R } = await import('../public/src/audio/recipes.js');
  const greeting = R[KEEPER_GREETING_RECIPE_NAME];
  assert.ok(Array.isArray(greeting) && greeting.length > 0, 'the greeting is not a recipe');

  const peakGain = (steps) => Math.max(...steps.map((s) => s.gainPeak));
  const topNote = (steps) => Math.max(...steps.map((s) => s.frequencyStart ?? 0));

  const rewardSounds = Object.values(REWARD_RECIPE_MAP)
    .filter(Boolean)
    .map((name) => R[name]);
  assert.ok(rewardSounds.length > 0, 'no reward sounds to compare against -- the control is broken');
  for (const reward of rewardSounds) {
    assert.ok(peakGain(greeting) < peakGain(reward),
      `the greeting is louder than a reward: ${peakGain(greeting)} vs ${peakGain(reward)}`);
    assert.ok(topNote(greeting) < topNote(reward),
      `the greeting is pitched above a reward: ${topNote(greeting)} vs ${topNote(reward)}`);
  }
  // Short. It plays under a speech bubble a child is about to read.
  const end = Math.max(...greeting.map((s) => s.startSeconds + s.durationSeconds));
  assert.ok(end < 0.8, `${end.toFixed(2)}s is long enough to talk over the line it announces`);
});
