// The line names a control the child can actually see.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  COACH_PRESS_TO_FIGHT,
  COACH_TAP_TO_FIGHT,
  firstHurtCoachingLine,
} from '../public/src/ui/coaching.js';
import { POINTER_MODE_MOUSE, POINTER_MODE_TOUCH } from '../public/src/input/pointerMode.js';

test('a thumb is told to tap the button that is on screen', () => {
  assert.equal(firstHurtCoachingLine(POINTER_MODE_TOUCH), COACH_TAP_TO_FIGHT);
});

test('a keyboard is told the key, because the button is NOT on screen for it', () => {
  // The two changes have to agree: hiding ATTACK on a device with no touch and then telling that
  // device to "Tap ATTACK" would point a child at something that is not there, which is worse than
  // saying nothing.
  assert.equal(firstHurtCoachingLine(POINTER_MODE_MOUSE), COACH_PRESS_TO_FIGHT);
});

test('an unknown mode still says something usable', () => {
  // Reachable if pointerMode ever grows a third value. Falling back to the tablet line is the safe
  // direction: this is a tablet-first game, and the button is visible in every mode but one.
  assert.equal(firstHurtCoachingLine(undefined), COACH_TAP_TO_FIGHT);
  assert.equal(firstHurtCoachingLine('gamepad'), COACH_TAP_TO_FIGHT);
});

test('the key it names is a key the game actually listens for', () => {
  // The line is a promise about the controls. If Space stopped being an attack key this would be a
  // lie printed to a child at the worst possible moment, and nothing else would catch it -- the
  // keyboard map and this string have no other connection.
  const keyboard = readFileSync(join(import.meta.dirname, '..', 'public', 'src', 'input', 'keyboard.js'), 'utf8');
  assert.match(keyboard, /ATTACK_KEYS[\s\S]{0,80}'Space'/,
    'the coaching line says Space, and keyboard.js no longer treats Space as an attack');
});

test('the button it names is the button that is in the page', () => {
  // Same promise, other half. "Tap ATTACK" has to name the label a child is looking at.
  const markup = readFileSync(join(import.meta.dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(markup, /id="attack-button"[^>]*>ATTACK</,
    'the coaching line says ATTACK, and the button in the page is labelled something else');
});
