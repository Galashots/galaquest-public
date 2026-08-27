import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createKeyboardInput, isEditableTarget, keysToScreenVector } from '../public/src/input/keyboard.js';

/**
 * A minimal stand-in for `window`: real enough for createKeyboardInput to wire its three listeners
 * against, with a `dispatch` a test can use to hand it a fake event without going anywhere near a
 * real DOM. `event.target` is set by the CALLER, exactly like a real bubbled keydown -- window never
 * decides what was focused, it only hears about it.
 */
function fakeWindow() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type, event) {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
  };
}

function keyEvent(code, target, overrides = {}) {
  let prevented = false;
  return {
    code,
    target,
    repeat: false,
    preventDefault: () => { prevented = true; },
    wasPrevented: () => prevented,
    ...overrides,
  };
}

test('isEditableTarget recognises inputs, textareas, selects and contenteditable', () => {
  assert.equal(isEditableTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditableTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditableTarget({ tagName: 'SELECT' }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV' }), false);
  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isEditableTarget(null), false);
  assert.equal(isEditableTarget(undefined), false);
});

// The bug the whole file exists to pin: naming a hero, W did not appear. #profile-gate-name is a
// real <input> and every keydown reaches window regardless of focus, so without this guard a hero
// typed "Wander" arrived as "ander".
test('a keydown on a text input is invisible to the keyboard module -- no key recorded, nothing prevented', () => {
  const target = fakeWindow();
  const keyboard = createKeyboardInput(target);
  const nameField = { tagName: 'INPUT' };

  const event = keyEvent('KeyW', nameField);
  target.dispatch('keydown', event);

  assert.equal(keyboard.keys.has('KeyW'), false, 'W must not be recorded as a movement key');
  assert.equal(event.wasPrevented(), false, 'the input must receive the keystroke, not lose it to preventDefault');
  assert.equal(keyboard.read().screen.x, 0);
  assert.equal(keyboard.read().screen.y, 0);
});

test('the same guard applies to a textarea and a contenteditable element', () => {
  const target = fakeWindow();
  const keyboard = createKeyboardInput(target);

  target.dispatch('keydown', keyEvent('Space', { tagName: 'TEXTAREA' }));
  assert.equal(keyboard.takeAttack(), false, 'Space typed into a textarea must not queue a swing');

  target.dispatch('keydown', keyEvent('KeyA', { tagName: 'DIV', isContentEditable: true }));
  assert.equal(keyboard.keys.has('KeyA'), false);
});

test('a stray keyup for a key that was never recorded is a harmless no-op', () => {
  const target = fakeWindow();
  const keyboard = createKeyboardInput(target);
  const nameField = { tagName: 'INPUT' };

  target.dispatch('keydown', keyEvent('KeyD', nameField));
  // keyup fires on the SAME field the keydown did (a real browser would never route it elsewhere).
  target.dispatch('keyup', keyEvent('KeyD', nameField));
  assert.equal(keyboard.keys.has('KeyD'), false);
});

// The fix must not cost the game its own controls: a keydown with no focused text field (the
// ordinary case -- document.activeElement is <body> while playing) still drives movement exactly as
// before.
test('gameplay keys keep working when nothing is focused', () => {
  const target = fakeWindow();
  const keyboard = createKeyboardInput(target);
  const body = { tagName: 'BODY' };

  const event = keyEvent('KeyW', body);
  target.dispatch('keydown', event);

  assert.equal(keyboard.keys.has('KeyW'), true);
  assert.equal(event.wasPrevented(), true, 'movement keys still preventDefault outside a text field');
  assert.equal(keyboard.read().screen.y, 1);

  target.dispatch('keyup', keyEvent('KeyW', body));
  assert.equal(keyboard.keys.has('KeyW'), false);
});

test('the attack key still queues a swing outside a text field', () => {
  const target = fakeWindow();
  const keyboard = createKeyboardInput(target);
  target.dispatch('keydown', keyEvent('Space', { tagName: 'BODY' }));
  assert.equal(keyboard.takeAttack(), true);
  assert.equal(keyboard.takeAttack(), false, 'takeAttack is an edge, taken once');
});

test('keysToScreenVector still normalises diagonals (unchanged by the focus guard)', () => {
  const vector = keysToScreenVector(new Set(['KeyW', 'KeyD']));
  assert.ok(Math.abs(vector.x - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(vector.y - Math.SQRT1_2) < 1e-12);
});
