import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  STARTER_SWORD_ID,
  WILDWOOD_BLADE_ID,
  damageFor,
  itemDef,
} from '../public/src/progression/items.js';
import { WILDWOOD_COLOR } from '../public/src/world/wildwoodBlade.js';
import {
  UNLOCK_CARD_CSS,
  UNLOCK_CARD_SECONDS,
  createUnlockCard,
  unlockCardState,
} from '../public/src/ui/unlockCard.js';

// Viewmodel-only, same as test/boss-bar.test.mjs and for the same hero-screen.test.mjs reason:
// unlockCardState is provable in plain node; createUnlockCard is browser/harness territory.
//
// DAMAGE HONESTY: every expected number below is READ off progression/items.js (damageFor), never
// restated as a literal (GQ-007) -- if GP9 retunes the Blade, these tests retune with it and the
// card cannot quietly disagree with the item table it announces.

// The real ceremony's inputs, built the way main.js will build them: names and damages from
// items.js, nothing invented here.
function wildwoodMoment() {
  return {
    itemName: itemDef(WILDWOOD_BLADE_ID).name,
    fromDamage: damageFor(STARTER_SWORD_ID),
    toDamage: damageFor(WILDWOOD_BLADE_ID),
  };
}

test('the Wildwood moment reads WILDWOOD BLADE under an UNLOCKED eyebrow', () => {
  const state = unlockCardState(wildwoodMoment());
  assert.equal(state.eyebrow, 'UNLOCKED');
  assert.equal(state.name, itemDef(WILDWOOD_BLADE_ID).name.toUpperCase());
  assert.equal(state.name, 'WILDWOOD BLADE');
});

test('the comparison line is items.js\'s own numbers in the Hero screen\'s exact 1 → 2 DAMAGE shape', () => {
  const from = damageFor(STARTER_SWORD_ID);
  const to = damageFor(WILDWOOD_BLADE_ID);
  const state = unlockCardState(wildwoodMoment());
  assert.equal(state.comparison, `${from} → ${to} DAMAGE`);
  // The same arrow-line pattern heroScreen.js's renderCard paints into #hero-item-compare -- the
  // ceremony and the Gear screen a child opens ten seconds later must say it identically.
  assert.match(state.comparison, /^\d+ → \d+ DAMAGE$/);
});

test('the Blade really is an upgrade today, and isUpgrade agrees with items.js rather than assuming it', () => {
  const from = damageFor(STARTER_SWORD_ID);
  const to = damageFor(WILDWOOD_BLADE_ID);
  assert.ok(to > from, 'items.js no longer says the Blade out-damages the starter -- this ceremony\'s premise changed');
  assert.equal(unlockCardState(wildwoodMoment()).isUpgrade, to > from);
});

test('sabotage: swapping the damages must read as NOT an upgrade -- the flag reacts to the numbers, it is not hardcoded', () => {
  const moment = wildwoodMoment();
  const swapped = unlockCardState({
    itemName: moment.itemName, fromDamage: moment.toDamage, toDamage: moment.fromDamage,
  });
  assert.equal(swapped.isUpgrade, false);
  assert.equal(swapped.comparison, `${moment.toDamage} → ${moment.fromDamage} DAMAGE`,
    'the line must still tell the truth about the numbers it was handed');
});

test('a missing or non-finite damage yields NO comparison line, never a string with a hole in it', () => {
  const moment = wildwoodMoment();
  for (const broken of [undefined, null, NaN, Infinity, 'two']) {
    const noFrom = unlockCardState({ ...moment, fromDamage: broken });
    assert.equal(noFrom.comparison, null, `fromDamage=${broken} must suppress the comparison`);
    assert.equal(noFrom.isUpgrade, false);
    const noTo = unlockCardState({ ...moment, toDamage: broken });
    assert.equal(noTo.comparison, null, `toDamage=${broken} must suppress the comparison`);
    assert.equal(noTo.isUpgrade, false);
  }
});

test('a junk item name degrades to an empty string, never the word UNDEFINED on a ceremony card', () => {
  assert.equal(unlockCardState({ fromDamage: 1, toDamage: 2 }).name, '');
  assert.equal(unlockCardState({ itemName: null, fromDamage: 1, toDamage: 2 }).name, '');
  assert.equal(unlockCardState({ itemName: '  wildwood blade  ', fromDamage: 1, toDamage: 2 }).name, 'WILDWOOD BLADE');
});

test('the Gear affordance hint names GEAR with the Hero button\'s own glyph', () => {
  const state = unlockCardState(wildwoodMoment());
  assert.ok(state.hint.includes('GEAR'), 'the hint must point at the Gear screen by name');
  assert.ok(state.hint.includes('🗡'), 'the hint must echo #hero-button\'s own 🗡 glyph');
});

// Same text-not-DOM CSS assertions test/boss-bar.test.mjs makes, plus the single-source colour rule:
// the card's teal must be DERIVED from WILDWOOD_COLOR (the planted prop's / Hero swatch's own
// colour), never a second opinion about what the Blade looks like.
test('the card\'s accent is derived from WILDWOOD_COLOR, and the CSS is reduced-motion safe', () => {
  const derived = `#${WILDWOOD_COLOR.toString(16).padStart(6, '0')}`;
  assert.ok(UNLOCK_CARD_CSS.includes(derived), `UNLOCK_CARD_CSS must carry ${derived}`);
  assert.ok(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(UNLOCK_CARD_CSS), 'reduced motion must be handled in CSS');
});

test('the ceremony auto-dismisses around 4.5s -- short enough to stay a moment, not a modal wall', () => {
  assert.ok(UNLOCK_CARD_SECONDS >= 3 && UNLOCK_CARD_SECONDS <= 6, `${UNLOCK_CARD_SECONDS}s is not a brief ceremony`);
});

test('the DOM half exports the factory shape main.js will wire (not exercised here -- browser/harness territory)', () => {
  assert.equal(typeof createUnlockCard, 'function');
});

// THE CEREMONY HAS TO BE HEARABLE, not just readable. It is the biggest moment in this game -- the
// thing you were sent for, arriving -- and until now all four of its fields were text, which is the
// one form the stated audience cannot use. keeperSpeech.js makes the whole argument; these assert
// that the ear gets its OWN wording rather than the card's, because the card's is wrong out loud.
test('the ceremony carries a spoken form, and it is not the four strings on the card', () => {
  const state = unlockCardState({ itemName: 'Wildwood Blade', fromDamage: 1, toDamage: 2 });
  assert.ok(state.spoken.startsWith('Unlocked!'), state.spoken);
  assert.ok(state.spoken.includes('Wildwood Blade'),
    'the spoken name must be the readable one, not the card\'s shout');
  assert.ok(!state.spoken.includes('WILDWOOD BLADE'), 'a voice should not shout');
  assert.ok(!state.spoken.includes('→'), 'an arrow read aloud is the word "arrow"');
  assert.ok(!state.spoken.includes('🗡'), 'the hint is a picture of a button, which cannot be said');
  assert.ok(state.spoken.includes('2 damage') && state.spoken.includes('1'),
    `the upgrade must be spoken as a sentence: ${state.spoken}`);
});

test('an unlock with no damage numbers still says what arrived', () => {
  const state = unlockCardState({ itemName: 'Belt Lantern' });
  assert.equal(state.spoken, 'Unlocked! Belt Lantern.');
  assert.ok(!state.spoken.includes('undefined'), state.spoken);
  assert.ok(!state.spoken.includes('NaN'), state.spoken);
});

test('a missing name says something a child can act on, not "Unlocked! ."', () => {
  const state = unlockCardState({});
  assert.equal(state.name, '', 'the card itself still shows nothing rather than inventing a name');
  assert.equal(state.spoken, 'Unlocked! new gear.');
});

test('sabotage: the spoken form is not a constant -- two different items say different things', () => {
  const blade = unlockCardState({ itemName: 'Wildwood Blade', fromDamage: 1, toDamage: 2 });
  const lantern = unlockCardState({ itemName: 'Belt Lantern' });
  assert.notEqual(blade.spoken, lantern.spoken);
});
