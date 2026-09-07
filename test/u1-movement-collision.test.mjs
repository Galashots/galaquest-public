import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSimulation } from '../net/gameServer.mjs';
import { inputMessage } from '../public/src/net/protocol.js';
import { movementWorldForDestination, moveMovementWorldPosition } from '../public/src/world/movementWorld.js';

const world = movementWorldForDestination('emberworks-deep');
const cases = JSON.parse(readFileSync(new URL('./fixtures/emberworks-movement-cases.json', import.meta.url))).cases;
for (const scenario of cases) {
  test(`shared collision case: ${scenario.name}`, () => {
    const actual = moveMovementWorldPosition(scenario.from, scenario.to, world);
    assert.ok(Math.abs(actual.x - scenario.expected.x) < 0.0001, `x: ${JSON.stringify(actual)}`);
    assert.ok(Math.abs(actual.z - scenario.expected.z) < 0.0001, `z: ${JSON.stringify(actual)}`);
  });
}

test('Unity blocker coordinates and hero clearance match server authority', () => {
  const source = readFileSync(new URL('../unity/GalaQuest/Assets/GalaQuest/Runtime/Gameplay/GalaQuestEmberworksMovementWorld.cs', import.meta.url), 'utf8');
  const rows = [...source.matchAll(/new SolidRectangle\("([^"]+)", (-?[\d.]+)f, (-?[\d.]+)f, (-?[\d.]+)f, (-?[\d.]+)f\)/g)]
    .map(([, name, minX, maxX, minZ, maxZ]) => ({ name, minX: +minX, maxX: +maxX, minZ: +minZ, maxZ: +maxZ }));
  assert.deepEqual(rows, world.obstacles);
  assert.equal(+source.match(/HeroClearance = ([\d.]+)f/)[1], world.planarClearance);
});

test('Emberworks authoritative movement stops at the visible cavern wing', () => {
  const sim = createSimulation({ destinationId: 'emberworks-deep' });
  const player = sim.addPlayer('wall-test');
  for (let step = 1; step <= 100; step++) {
    sim.applyInput(player.id, inputMessage(step, 0, 1, 1, true), step * 50);
    sim.step(0.05, step * 50);
  }
  assert.ok(player.z > 11, 'the open approach remains traversable');
  assert.ok(player.z <= 12.15 + 1e-6, `hero must stop before wing at z=12.5, got ${player.z}`);
  assert.equal(player.speed, 0, 'holding the stick against a wall must not report running');
});
