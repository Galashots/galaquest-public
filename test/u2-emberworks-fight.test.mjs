import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../net/gameServerCore.mjs';
import { EMBERWORKS_DEEP_ENEMIES } from '../public/src/world/zones/emberworksDeep.js';

const destinationId = 'emberworks-deep';
const advance = (sim, frames, offset = 0) => {
  for (let i = 1; i <= frames; i++) sim.step(0.05, offset + i * 50);
};

test('Emberworks owns a gremlin pursuer and an Alpha heavy, including first-join selection', () => {
  for (const direct of [true, false]) {
    const sim = createSimulation(direct ? { destinationId } : {});
    if (!direct) sim.activateDestination(destinationId);
    const hero = sim.addPlayer('fighter');
    const enemies = sim.encounterSnapshot().enemies;
    assert.equal(enemies.length, 2);
    assert.deepEqual(enemies.map((enemy) => enemy.kind), ['lava-gremlin', 'alpha-wolf']);
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
  assert.equal(sim.encounterSnapshot().enemies.find((enemy) => enemy.kind === 'lava-gremlin').hp, 0);
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

test('wounded authored Alpha pursues a stationary 5m target without returning or healing', () => {
  const alphaSpawn = EMBERWORKS_DEEP_ENEMIES.find((enemy) => enemy.enemyId === 'emberworks-alpha-1').spawn;
  const sim = createSimulation({ destinationId });
  const hero = sim.addPlayer('pursuit', { x: alphaSpawn.x, z: alphaSpawn.z - 1.5 });
  advance(sim, 31);
  assert.equal(sim.applyAttack(hero.id, { seq: 1 }), true);
  advance(sim, 31, 2000);
  const wounded = sim.encounterSnapshot().enemies.find((enemy) => enemy.enemyId === 'emberworks-alpha-1');
  assert.ok(wounded.hp < wounded.maxHp, 'setup must wound the authored Alpha');
  const woundedHp = wounded.hp;
  // Stationary target 5m south of the visible spawn: ordinary in-aggro distance.
  hero.x = alphaSpawn.x; hero.z = alphaSpawn.z - 5;
  sim.drainEvents();
  let sawPursuit = false;
  let hurtByAlpha = false;
  for (let frame = 0; frame < 900; frame++) {
    sim.step(0.05, 4000 + frame * 50);
    const alpha = sim.encounterSnapshot().enemies.find((enemy) => enemy.enemyId === 'emberworks-alpha-1');
    assert.notEqual(alpha.mode, 'returning', 'ordinary pursuit must not trip the territory escape');
    assert.equal(alpha.hp, woundedHp, 'a wounded pursuer must not full-heal without reaching home');
    if (alpha.mode === 'walk' || alpha.mode === 'bite') sawPursuit = true;
    for (const event of sim.drainEvents()) {
      if ((event.type === 'hero-hurt' || event.type === 'hero-down') && event.enemyId === 'emberworks-alpha-1') {
        hurtByAlpha = true;
      }
    }
  }
  assert.equal(sawPursuit, true, 'the Alpha must actually pursue/attack the stationary target');
  assert.equal(hurtByAlpha, true, 'the Heavy must land its committed smash on a standing-still target');
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
