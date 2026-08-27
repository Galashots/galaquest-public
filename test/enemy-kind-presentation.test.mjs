import { strict as assert } from 'node:assert';
import test from 'node:test';

import { ENEMY_KINDS } from '../public/src/combat/enemyStats.js';
import { BEACON_GLOW_COLOR } from '../public/src/world/oldBeacon.js';
import {
  PRESENTED_ENEMY_KINDS,
  displayNameForKind,
  presentationForKind,
} from '../public/src/enemies/enemyKindPresentation.js';

test('every enemy kind the rules define has a presentation, and no orphans', () => {
  assert.deepEqual([...PRESENTED_ENEMY_KINDS].sort(), [...ENEMY_KINDS].sort());
});

test('the Wolf baseline is an identity tint at ordinary scale, no eyes, not menacing', () => {
  const wolf = presentationForKind('wolf');
  assert.equal(wolf.displayName, 'Wolf');
  assert.equal(wolf.tintColor, 0xffffff);
  assert.equal(wolf.scaleMultiplier, 1);
  assert.equal(wolf.glowEyes, false);
  assert.equal(wolf.menacing, false);
});

test('Ember and Frost Wolves tint and scale up without eyes or menace', () => {
  const ember = presentationForKind('ember-wolf');
  assert.equal(ember.displayName, 'Ember Wolf');
  assert.ok(ember.scaleMultiplier > 1);
  assert.notEqual(ember.tintColor, 0xffffff);
  assert.equal(ember.glowEyes, false);

  const frost = presentationForKind('frost-wolf');
  assert.equal(frost.displayName, 'Frost Wolf');
  assert.ok(frost.scaleMultiplier > 1);
  // GQ-007: the frost tint IS the Beacon's own established rime-blue, not a second guess at it.
  assert.equal(frost.tintColor, BEACON_GLOW_COLOR);
});

test('the Alpha Wolf is the biggest, darkest, only kind with glowing eyes and a menacing plate', () => {
  const alpha = presentationForKind('alpha-wolf');
  assert.equal(alpha.displayName, 'Alpha Wolf');
  assert.ok(alpha.scaleMultiplier > presentationForKind('frost-wolf').scaleMultiplier);
  assert.ok(alpha.scaleMultiplier > presentationForKind('ember-wolf').scaleMultiplier);
  assert.equal(alpha.glowEyes, true);
  assert.equal(typeof alpha.eyeColor, 'number');
  assert.equal(alpha.menacing, true);
  // The eye colour and the (unrelated, imported-nowhere-near-here) lantern-spark colour must never
  // collide -- a threat cue and a health cue sharing a hue is unreadable at speed.
  assert.notEqual(alpha.eyeColor, 0xffc477);

  for (const kind of ['wolf', 'ember-wolf', 'frost-wolf']) {
    assert.equal(presentationForKind(kind).menacing, false, `${kind} must not carry the Alpha's danger plate`);
  }
});

test('an unrecognised kind degrades to the Wolf presentation rather than throwing', () => {
  assert.deepEqual(presentationForKind('dire-wolf-nobody-authored'), presentationForKind('wolf'));
  assert.equal(displayNameForKind('nope'), 'Wolf');
});
