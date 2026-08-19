import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  ROWAN_LINE_CART_SEARCHED,
  ROWAN_LINE_INTRO,
  ROWAN_NAME,
  rowanLineFor,
  rowanSpeechState,
} from '../public/src/world/rowanSpeech.js';

test('ROWAN_NAME is Rowan', () => {
  assert.equal(ROWAN_NAME, 'Rowan');
});

// The seven lines are locked prose from the design brief, not placeholder text -- pinned here so
// nobody accidentally reflows or rewrites them while touching the file for something else.
test('the intro line carries the whole locked sequence, in order, ending on what to do next', () => {
  const sentences = [
    'This was a supply camp.',
    'Everyone ran.',
    'I followed their tracks.',
    'Something drove them off.',
    'The old Beacon has gone cold too.',
    'You woke these lanterns.',
    'I could use help.',
    'See that sword?',
    'It is a Wildwood Blade.',
    'Wake the Beacon.',
    'This Wildwood Blade is yours.',
    'First, search the broken cart for clues.',
  ];
  for (const sentence of sentences) {
    assert.ok(ROWAN_LINE_INTRO.includes(sentence), `missing "${sentence}"`);
  }
  // Order matters -- the mystery answer has to land before the reward tease, or the beat reads as
  // a shopping list instead of a conversation.
  assert.ok(
    ROWAN_LINE_INTRO.indexOf('Everyone ran.') < ROWAN_LINE_INTRO.indexOf('Wildwood Blade')
    && ROWAN_LINE_INTRO.indexOf('Wildwood Blade') < ROWAN_LINE_INTRO.indexOf('search the broken cart'),
    'expected mystery, then the reward tease, then the instruction, in that order',
  );
});

test('the name is never folded into either line -- index.html gives it its own row', () => {
  assert.ok(!ROWAN_LINE_INTRO.includes(ROWAN_NAME));
  assert.ok(!ROWAN_LINE_CART_SEARCHED.includes(ROWAN_NAME));
});

test('rowanLineFor: the cart un-searched is the intro; searched is the short thank-you', () => {
  assert.equal(rowanLineFor(false), ROWAN_LINE_INTRO);
  assert.equal(rowanLineFor(true), ROWAN_LINE_CART_SEARCHED);
});

test('rowanSpeechState: hidden outside the radius, visible with the right line inside it', () => {
  const args = { heroX: 0, heroZ: 0, rowanX: 0, rowanZ: 3, radiusMeters: 2.5, cartSearched: false };
  assert.deepEqual(rowanSpeechState(args), { visible: false, line: null });
  assert.deepEqual(
    rowanSpeechState({ ...args, rowanZ: 2 }),
    { visible: true, line: ROWAN_LINE_INTRO },
  );
  assert.deepEqual(
    rowanSpeechState({ ...args, rowanZ: 2, cartSearched: true }),
    { visible: true, line: ROWAN_LINE_CART_SEARCHED },
  );
});

// sabotage: proves the radius check is a real boundary and not a function that always returns
// visible (or always hidden) regardless of distance.
test('sabotage: moving from just inside to just outside the radius actually flips visibility', () => {
  const base = { heroX: 0, heroZ: 0, rowanX: 0, radiusMeters: 3, cartSearched: false };
  const inside = rowanSpeechState({ ...base, rowanZ: 2.99 });
  const outside = rowanSpeechState({ ...base, rowanZ: 3.01 });
  assert.equal(inside.visible, true);
  assert.equal(outside.visible, false);
});
