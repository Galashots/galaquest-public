import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createRimLight } from '../public/src/render/rimLight.js';
import { CHARACTER, WORLD } from '../public/src/render/layers.js';
import { createGround } from '../public/src/world/ground.js';

test('world objects stay on WORLD and never join CHARACTER', () => {
  const world = createGround();
  const worldMask = 1 << WORLD;
  const characterMask = 1 << CHARACTER;
  const objects = [];
  world.traverse((object) => objects.push(object));

  // Phase V/V3: dropped from 6 to 4 when ground.js's three untextured placeholder decorations
  // (box/cylinder/box) were removed -- see ground.js's own comment. What remains: the world
  // group itself, the ground plane, and the two lights.
  assert.ok(objects.length >= 4);
  for (const object of objects) {
    assert.equal(object.layers.mask, worldMask, `${object.name} left WORLD`);
    assert.equal(object.layers.mask & characterMask, 0, `${object.name} joined CHARACTER`);
  }
});

test('rim light and target are CHARACTER-layer-only objects', () => {
  const rim = createRimLight();
  const characterMask = 1 << CHARACTER;
  assert.equal(rim.light.layers.mask, characterMask);
  assert.equal(rim.target.layers.mask, characterMask);
});
