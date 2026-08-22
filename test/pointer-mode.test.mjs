// Which controls a device gets, and -- the half that matters -- which it never loses.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  POINTER_MODE_MOUSE,
  POINTER_MODE_TOUCH,
  pointerModeFor,
} from '../public/src/input/pointerMode.js';

test('a tablet keeps the stick', () => {
  assert.equal(pointerModeFor(5), POINTER_MODE_TOUCH);
  assert.equal(pointerModeFor(1), POINTER_MODE_TOUCH);
});

test('a device with no touch at all is the ONLY one that loses it', () => {
  assert.equal(pointerModeFor(0), POINTER_MODE_MOUSE);
});

test('a touchscreen laptop keeps the stick, even though it also has a mouse', () => {
  // The asymmetry this rule exists for. Showing a mouse user a stick costs them a corner of the
  // screen; hiding it from a child who needs it costs them the game. Ten touch points and a
  // trackpad is a device where the conservative answer is the correct one.
  assert.equal(pointerModeFor(10), POINTER_MODE_TOUCH);
});

test('an unreadable value never takes the controls away', () => {
  // navigator.maxTouchPoints is undefined on old browsers and could be anything in an embedded
  // webview. Not knowing is not a reason to hide a child's only way to move.
  for (const unreadable of [undefined, null, NaN, 'lots', {}, Infinity]) {
    assert.equal(pointerModeFor(unreadable), POINTER_MODE_TOUCH, `${String(unreadable)} must keep the stick`);
  }
});

test('the two modes are distinct strings, because CSS selects on them', () => {
  assert.notEqual(POINTER_MODE_TOUCH, POINTER_MODE_MOUSE);
});
