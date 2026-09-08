import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../net/gameServerCore.mjs';

const destinationId = 'emberworks-deep';
const advance = (sim, frames, offset = 0) => {
  for (let i = 1; i <= frames; i++) sim.step(0.05, offset + i * 50);
};

test('Emberworks owns one gremlin, including destination selected by the first join', () => {
  for (const direct of [true, false]) {
    const sim = createSimulation(direct ? { destinationId } : {});
    if (!direct) sim.activateDestination(destinationId);
    const hero = sim.addPlayer('fighter');
    const enemies = sim.encounterSnapshot().enemies;
    assert.equal(enemies.length, 1);
    assert.equal(enemies[0].kind, 'lava-gremlin');
    assert.deepEqual({ x: hero.x, z: hero.z }, { x: 0, z: 4 });
    assert.deepEqual({ x: enemies[0].x, z: enemies[0].z }, { x: -4, z: 9 });
  }
});

test('three starter strikes defeat the shared gremlin; replayed attack does not add contact', () => {
  const sim = createSimulation({ destinationId });
  const hero = sim.addPlayer('fighter', { x: -4, z: 7.5 });
  const sibling = sim.addPlayer('sibling');
  sim.step(0, 0);
  const events = [];
  for (let seq = 1; seq <= 3; seq++) {
    assert.equal(sim.applyAttack(hero.id, { seq }), true);
    assert.equal(sim.applyAttack(hero.id, { seq }), false);
    advance(sim, 31, seq * 2000);
    events.push(...sim.drainEvents());
  }
  const defeats = events.filter(e => e.type === 'wolf-defeated');
  assert.equal(defeats.length, 1);
  assert.equal(defeats[0].kind, 'lava-gremlin');
  assert.equal(sim.encounterSnapshot().enemies[0].hp, 0);
  assert.equal(sim.encounterSnapshot().heroes[sibling.id].hp, 30);
});

test('gremlin pursuit stays on its side of the cavern wing', () => {
  const sim = createSimulation({ destinationId, enemies: [{
    enemyId: 'wall-test', kind: 'lava-gremlin', level: 1,
    spawn: { x: -1.6, z: 14 }, leashRadius: 8,
  }] });
  const hero = sim.addPlayer('across-wall', { x: 1.6, z: 14 });
  advance(sim, 200);
  const frame = sim.encounterSnapshot();
  assert.ok(frame.enemies[0].x <= -1.05 + 1e-6, JSON.stringify(frame.enemies[0]));
  assert.equal(frame.heroes[hero.id].hp, 30);
});

test('defeat and quick recovery use the Emberworks spawn', () => {
  const sim = createSimulation({ destinationId });
  const hero = sim.addPlayer('learning-to-dodge', { x: -4, z: 7.6 });
  let down = false;
  let respawned = false;
  for (let frame = 0; frame < 800 && !respawned; frame++) {
    sim.step(0.05, frame * 50);
    for (const event of sim.drainEvents()) {
      if (event.type === 'hero-down') down = true;
      if (event.type === 'hero-respawned') respawned = true;
    }
  }
  assert.equal(down, true);
  assert.equal(respawned, true);
  assert.deepEqual({ x: hero.x, z: hero.z }, { x: 0, z: 4 });
  assert.equal(sim.encounterSnapshot().heroes[hero.id].hp, 30);
});

test('Emberworks recovery sanctuary prevents immediate spawn camping', () => {
  const sim = createSimulation({ destinationId, enemies: [{
    enemyId: 'near-recovery', kind: 'lava-gremlin', level: 1,
    spawn: { x: 0, z: 6.5 }, leashRadius: 7,
  }] });
  const hero = sim.addPlayer('recovering');
  advance(sim, 200);
  const frame = sim.encounterSnapshot();
  assert.equal(frame.heroes[hero.id].hp, 30);
  assert.equal(frame.enemies[0].z, 6.5);
  assert.equal(sim.drainEvents().some(e => e.type === 'hero-hurt'), false);
});
