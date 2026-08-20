import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLD_SEAL_COUNT,
  coldSealGeometry,
  coldSealSpecs,
  coldSealsBroken,
  noColdSealsBroken,
  strikeColdSeals,
} from '../public/src/world/coldSeals.js';
import { COLD_SEAL_OBJECTIVE_DONE, coldSealObjective } from '../public/src/world/coldSealsRuntime.js';
import { OLD_BEACON } from '../public/src/world/zones/village.js';

test('the Old Beacon has three derived Cold Seals just outside its plinth', () => {
  const specs = coldSealSpecs(OLD_BEACON);
  assert.equal(specs.length, COLD_SEAL_COUNT);
  assert.deepEqual(specs.map((seal) => seal.id), ['left', 'right', 'rear']);
  for (const seal of specs) {
    const distance = Math.hypot(seal.at[0] - OLD_BEACON.at[0], seal.at[1] - OLD_BEACON.at[1]);
    assert.ok(distance > 2.45 && distance < 3.0, `${seal.id} sits ${distance.toFixed(2)} m from the Beacon`);
  }
});

test('moving or rotating the Beacon carries the Cold Seals with it', () => {
  const moved = { at: [20, -7], rotY: Math.PI / 2 };
  const specs = coldSealSpecs(moved);
  assert.deepEqual(specs.map((seal) => seal.at.map((value) => +value.toFixed(2))), [
    [22.15, -5.25],
    [22.15, -8.75],
    [17.35, -7],
  ]);
});

test('one sword contact breaks at most one standing seal and does not mutate the old state', () => {
  const specs = coldSealSpecs(OLD_BEACON);
  const initial = noColdSealsBroken();
  const first = strikeColdSeals(initial, specs, () => true);
  assert.deepEqual(initial, [false, false, false]);
  assert.deepEqual(first.broken, [true, false, false]);
  assert.deepEqual(first.struck, [0]);
  assert.equal(coldSealsBroken(first.broken), 1);

  const second = strikeColdSeals(first.broken, specs, (_seal, index) => index <= 1);
  assert.deepEqual(second.broken, [true, true, false]);
  assert.deepEqual(second.struck, [1]);

  const miss = strikeColdSeals(second.broken, specs, () => false);
  assert.equal(miss.broken, second.broken, 'a miss returns the same state object');
  assert.deepEqual(miss.struck, []);
});

test('the Cold Seal objective counts down to the Warden hook without pretending the boss exists', () => {
  assert.equal(coldSealObjective(0), '❄️ Break 3 Cold Seals');
  assert.equal(coldSealObjective(1), '❄️ Break 2 Cold Seals');
  assert.equal(coldSealObjective(2), '❄️ Break the last Cold Seal');
  assert.equal(coldSealObjective(3), COLD_SEAL_OBJECTIVE_DONE);
  assert.doesNotMatch(COLD_SEAL_OBJECTIVE_DONE, /(fight|warden|boss|defeat|kill)/i);
});

test('the procedural Cold Seal is real geometry with vertex colours', () => {
  const geometry = coldSealGeometry();
  assert.ok(geometry.getAttribute('position').count > 20);
  assert.equal(
    geometry.getAttribute('color').count,
    geometry.getAttribute('position').count,
    'every vertex carries the palette that makes the merged mesh one draw call',
  );
  geometry.dispose();
});