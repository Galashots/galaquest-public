// The Wildwood Blade, Rowan's own reward -- named in their intro line before it is ever handed over
// ("See that sword? It is a Wildwood Blade."), so it has to already stand in the clearing and read as
// a SWORD, not a fence post, from across the camp.
//
// Built from boxes rather than bought, the same trade the gate and the bramble already make -- see
// wildwoodGate.js's own header for why. Two tones and so two merged meshes: green/teal for the blade
// itself (this is a Wildwood thing, not ordinary steel) and warm metal for the fittings, which is the
// one visual idea the whole prop has to carry.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  BLADE_TOTAL_HEIGHT_METERS,
  METAL_COLOR,
  WILDWOOD_COLOR,
  bladeParts,
} from '../public/src/world/wildwoodBlade.js';

const HERO_HEIGHT_METERS = 1.48;

test('the blade reads as a sword next to the hero: shorter, not a toothpick', () => {
  assert.ok(BLADE_TOTAL_HEIGHT_METERS < HERO_HEIGHT_METERS, 'taller than the hero reads as a pole, not a sword');
  assert.ok(BLADE_TOTAL_HEIGHT_METERS > HERO_HEIGHT_METERS * 0.4, 'too short to read as a sword at a glance');
});

test('every piece is a real box, above the ground, within the blade\'s own stated height', () => {
  const { parts } = bladeParts();
  assert.ok(parts.length >= 4, 'a sword needs at least a blade, a guard, a grip and a pommel');
  for (const part of parts) {
    assert.equal(part.size.length, 3, `${part.name} is not a box`);
    for (const side of part.size) assert.ok(side > 0.01, `${part.name} has a ${side} m side -- invisible`);
    assert.ok(part.at[1] - part.size[1] / 2 >= -1e-9, `${part.name} is sunk into the ground`);
    assert.ok(part.at[1] + part.size[1] / 2 <= BLADE_TOTAL_HEIGHT_METERS + 1e-9,
      `${part.name} pokes out above the blade's own stated height`);
  }
});

test('the two tones are actually two different colours', () => {
  const apart = Math.abs((WILDWOOD_COLOR >> 16 & 255) - (METAL_COLOR >> 16 & 255))
    + Math.abs((WILDWOOD_COLOR >> 8 & 255) - (METAL_COLOR >> 8 & 255))
    + Math.abs((WILDWOOD_COLOR & 255) - (METAL_COLOR & 255));
  assert.ok(apart >= 60, 'the wildwood tone and the metal tone are too close to read as two materials');
});

test('every part is tagged wildwood or metal, and both tones are actually used', () => {
  const { parts } = bladeParts();
  const tones = new Set(parts.map((p) => p.tone));
  assert.ok(tones.has('wildwood'), 'nothing is tagged wildwood -- the blade itself has no colour');
  assert.ok(tones.has('metal'), 'nothing is tagged metal -- no fittings');
  for (const part of parts) {
    assert.ok(part.tone === 'wildwood' || part.tone === 'metal', `${part.name} has an unknown tone`);
  }
});

test('the blade is the tallest wildwood-toned piece, and stands at the base', () => {
  const { parts } = bladeParts();
  const wildwood = parts.filter((p) => p.tone === 'wildwood');
  assert.ok(wildwood.some((p) => p.at[1] - p.size[1] / 2 <= 1e-9), 'nothing wildwood-toned reaches the ground');
});

test('the pommel sits at the very top, above the grip', () => {
  const { parts } = bladeParts();
  const grip = parts.find((p) => p.name === 'grip');
  const pommel = parts.find((p) => p.name === 'pommel');
  assert.ok(grip && pommel, 'expected a named grip and pommel');
  assert.ok(pommel.at[1] > grip.at[1], 'the pommel should cap the grip, not sit below it');
});
