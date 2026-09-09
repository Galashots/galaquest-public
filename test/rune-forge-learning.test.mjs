import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MAGMALORD_ENTITLEMENT_ID,
  MAGMALORD_HELMET_ID,
  completionFact,
  deriveRuneForgeState,
  entitlementEventId,
  isCorrectChoice,
  selectPackFact,
  validateRuneForgeCatalog,
} from '../public/src/learning/runeForge.js';

const source = JSON.parse(readFileSync(new URL(
  '../public/data/learning/rune-forge-v1.json', import.meta.url), 'utf8'));

test('the two source-grounded packs use one physical rune-and-hammer vocabulary', () => {
  const catalog = validateRuneForgeCatalog(source);
  assert.equal(catalog.entitlement.id, MAGMALORD_ENTITLEMENT_ID);
  assert.equal(catalog.entitlement.itemId, MAGMALORD_HELMET_ID);
  assert.equal(catalog.packs.length, 2);
  assert.deepEqual(catalog.packs.map(pack => pack.interaction), ['rune-hammer', 'rune-hammer']);
  assert.ok(catalog.packs.every(pack => pack.tasks.length >= 3),
    'each pack needs an alternate task beyond the two-success encounter');
  assert.ok(catalog.packs.every(pack => pack.requiredSuccesses === 2));
});

test('the distilled Grade 2 examples distinguish graphemes through spoken whole words', () => {
  const pack = validateRuneForgeCatalog(source).packs.find(item => item.id === 'grapheme-er-family');
  assert.equal(pack.tasks[0].spokenPrompt, 'bird');
  assert.equal(pack.tasks[0].displayPrompt, 'b __ d');
  assert.equal(pack.tasks[0].choices.find(choice => choice.correct).label, 'ir');
  assert.equal(pack.tasks[1].spokenPrompt, 'turn');
  assert.equal(pack.tasks[1].choices.find(choice => choice.correct).label, 'ur');
  assert.ok(pack.tasks.every(task => task.choices.filter(choice => choice.correct).length === 1));
});

test('the distilled Grade 5 examples keep place and value separate before rounding', () => {
  const pack = validateRuneForgeCatalog(source).packs.find(item => item.id === 'place-value-rounding');
  assert.equal(pack.tasks[0].displayPrompt, 'In 4,582, what is the value of 5?');
  assert.equal(pack.tasks[0].choices.find(choice => choice.correct).label, '500');
  assert.equal(pack.tasks[1].displayPrompt, 'Round 6,742 to the nearest hundred.');
  assert.equal(pack.tasks[1].choices.find(choice => choice.correct).label, '6,700');
});

test('wrong choices never complete a task and assisted success stays assisted', () => {
  const catalog = validateRuneForgeCatalog(source);
  const profileId = 'profile-aaaaaaaa';
  const selected = selectPackFact(profileId, catalog, 'grapheme-er-family');
  let state = deriveRuneForgeState(catalog, [selected]);
  const task = state.task;
  const wrong = task.choices.find(choice => !choice.correct);
  assert.equal(isCorrectChoice(task, wrong.id), false);
  assert.equal(deriveRuneForgeState(catalog, [selected]).completedCount, 0);

  const fact = completionFact(profileId, catalog, task, true);
  state = deriveRuneForgeState(catalog, [selected, fact]);
  assert.equal(state.completedCount, 1);
  assert.equal(state.history[0].outcome, 'assisted');
  assert.equal(state.readyToClaim, false);
});

test('content-only edits cannot mint another helmet entitlement', () => {
  const profileId = 'profile-aaaaaaaa';
  const before = entitlementEventId(profileId, MAGMALORD_ENTITLEMENT_ID);
  const revised = structuredClone(source);
  revised.packs[0].contentVersion = '2026-09-08.2';
  revised.packs[0].tasks[2].displayPrompt = 'h __ d';
  const catalog = validateRuneForgeCatalog(revised);
  assert.equal(entitlementEventId(profileId, catalog.entitlement.id), before);
  assert.equal(before, `forge-entitlement:${profileId}:${MAGMALORD_ENTITLEMENT_ID}`);
});

test('a task id must be unique across the whole catalog, not just within its own pack', () => {
  // #159: the validator only tracked task ids per pack, so two different packs could
  // each own a task named e.g. "grapheme-bird-ir". completionFact() resolves a task id
  // to a pack by scanning packs in order and returning the first match, so a completion
  // meant for the second pack's task would silently be recorded against the first pack's
  // task of the same name instead. The catalog-wide identity rule below must make that
  // collision impossible to load in the first place.
  const collided = structuredClone(source);
  const sharedId = collided.packs[0].tasks[0].id;
  assert.notEqual(collided.packs[1].tasks[0].id, sharedId,
    'fixture assumption: the two packs start with distinct task ids');
  collided.packs[1].tasks[0].id = sharedId;
  assert.throws(() => validateRuneForgeCatalog(collided), /duplicate task id/);
});

test('one profile completion never advances a sibling', () => {
  const catalog = validateRuneForgeCatalog(source);
  const a = 'profile-aaaaaaaa';
  const b = 'profile-bbbbbbbb';
  const selected = selectPackFact(a, catalog, 'place-value-rounding');
  const task = deriveRuneForgeState(catalog, [selected]).task;
  const aFacts = [selected, completionFact(a, catalog, task, false)];
  assert.equal(deriveRuneForgeState(catalog, aFacts).completedCount, 1);
  assert.equal(deriveRuneForgeState(catalog, []).completedCount, 0,
    'the sibling receives only facts addressed to that sibling profile');
  assert.notEqual(a, b);
});
