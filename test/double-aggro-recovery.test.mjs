// A hero who gets pulled by TWO ordinary enemies at once must have a real way out: run clear of both,
// then heal back up before the next fight. This is the property a faster hero (character/speed.js's
// own RUN_SPEED) makes newly relevant -- covering more ground while kiting is exactly what makes a
// second enemy's aggro range reachable along the way, which is the density push's own risk. Two
// structural guarantees make it survivable regardless of the exact tuning either speed pass lands on:
//
//   1. A hero's own RUN_SPEED must outrun the fastest ordinary enemy this game authors, so "run away"
//      is always a real option and never a losing race.
//   2. Once clear of both leashes, out-of-combat regen (combat/encounter.js's OUT_OF_COMBAT_REGEN_*)
//      must actually restore the health that double-aggro cost, before a next engagement.
//
// Driven against the real server simulation (net/gameServerCore.mjs's createSimulation/step), not a
// hand-rolled fixture, so this exercises the same movement/aggro/regen code path production runs.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { RUN_SPEED } from '../public/src/character/speed.js';
import { enemyStatsForLevel } from '../public/src/combat/enemyStats.js';
import {
  OUT_OF_COMBAT_REGEN_DELAY_SECONDS, OUT_OF_COMBAT_REGEN_HP_PER_SECOND, WOLF_AGGRO_RANGE,
} from '../public/src/combat/encounter.js';
import { ENEMY_POPULATION } from '../public/src/world/zones/village.js';
import { createSimulation } from '../net/gameServerCore.mjs';

test('a hero\'s own run speed outruns every ordinary enemy this game authors', () => {
  const fastestEnemySpeed = Math.max(
    ...ENEMY_POPULATION.map((enemy) => enemyStatsForLevel(enemy.kind, enemy.level).speed),
  );
  assert.ok(RUN_SPEED > fastestEnemySpeed,
    `RUN_SPEED (${RUN_SPEED}) must clear the fastest authored enemy speed (${fastestEnemySpeed}) `
    + 'or fleeing a double-aggro pull is a losing race by construction');
});

// Two commons placed close enough that a hero standing between them sits inside BOTH aggro ranges at
// once -- the exact "unintended hot zone" shape a faster hero can now reach. This is a synthetic
// worst case, not a claim about any specific pair in village.js's own ENEMY_POPULATION.
// z=8, not near the origin: RECOVERY_SANCTUARY sits at HERO_SPAWN (0,0) with a 3m no-hostility
// bubble, and this scenario needs the hero to be a real, targetable body -- placing it inside the
// sanctuary would make "double-aggro" untestable by construction (neither wolf may ever target it).
function doubleAggroSimulation() {
  return createSimulation({
    enemies: [
      { enemyId: 'hot-a', kind: 'wolf', spawn: { x: -2, z: 8 }, leashRadius: 10 },
      { enemyId: 'hot-b', kind: 'wolf', spawn: { x: 2, z: 8 }, leashRadius: 10 },
    ],
  });
}

// Steps until the hero has taken at least one hit but stops the instant it goes down -- the fixed
// tick counts a bite-timing hand-calculation would need are exactly the kind of number this repo's
// own docs/MISTAKES.md warns against re-deriving by hand; polling the real state is the honest way
// to prove "hurt, but still standing" without guessing at WOLF_BITE_SECONDS/WOLF_BITE_COOLDOWN_SECONDS.
function stepUntilHurtButStanding(sim, playerId, startAtMs, { maxTicks = 400 } = {}) {
  let now = startAtMs;
  for (let i = 0; i < maxTicks; i += 1) {
    now += 50;
    sim.step(0.05, now);
    const hero = sim.encounterSnapshot().heroes[playerId];
    if (hero.downSeconds >= 0) {
      throw new Error('the hero went down before the double-aggro premise could be observed while standing');
    }
    if (hero.hp < hero.maxHp) return now;
  }
  throw new Error('the hero was never hurt within the tick budget -- the double-aggro premise is not real');
}

function moveToward(sim, playerId, from, to, seconds, startAtMs) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz) || 1;
  const dirX = dx / distance;
  const dirZ = dz / distance;
  let seq = 1;
  let now = startAtMs;
  const stepSeconds = 0.05;
  const ticks = Math.round(seconds / stepSeconds);
  for (let i = 0; i < ticks; i += 1) {
    sim.applyInput(playerId, {
      seq: seq++, dirX, dirZ, magnitude: 1, run: true,
    }, now);
    now += stepSeconds * 1000;
    sim.step(stepSeconds, now);
  }
  return now;
}

test('a hero pulled by two wolves at once can run clear of both leashes', () => {
  const sim = doubleAggroSimulation();
  const player = sim.addPlayer('kid', { x: 0, z: 7.5 });
  const now0 = stepUntilHurtButStanding(sim, player.id, 1000);

  // Flee due north at a full run, far past both wolves' own leash radius.
  let now = moveToward(sim, player.id, { x: 0, z: 7.5 }, { x: 0, z: 55 }, 25, now0);

  const fled = sim.encounterSnapshot();
  for (const enemy of fled.enemies) {
    assert.notEqual(enemy.mode, 'bite', `${enemy.enemyId} must not still be landing bites after a 60m flee`);
  }
  const hpAfterFleeing = fled.heroes[player.id].hp;

  // No further damage once clear: hold position a while and confirm hp does not keep dropping.
  for (let i = 0; i < 100; i += 1) {
    now += 50;
    sim.step(0.05, now);
  }
  assert.equal(sim.encounterSnapshot().heroes[player.id].hp, hpAfterFleeing,
    'a hero standing clear of both leashes must take no further damage');
});

test('regen restores a double-aggro hero to full before a next engagement', () => {
  const sim = doubleAggroSimulation();
  const player = sim.addPlayer('kid', { x: 0, z: 7.5 });
  const now0 = stepUntilHurtButStanding(sim, player.id, 1000);
  const maxHp = sim.encounterSnapshot().heroes[player.id].maxHp;

  let now = moveToward(sim, player.id, { x: 0, z: 7.5 }, { x: 0, z: 55 }, 25, now0);

  // Idle clear of both leashes for the regen delay plus enough seconds to close the gap at
  // OUT_OF_COMBAT_REGEN_HP_PER_SECOND, with slack for the fractional-accumulation banking.
  const hpMissing = maxHp - sim.encounterSnapshot().heroes[player.id].hp;
  const secondsToFullyRegen = OUT_OF_COMBAT_REGEN_DELAY_SECONDS
    + hpMissing / OUT_OF_COMBAT_REGEN_HP_PER_SECOND + 1;
  for (let i = 0; i < Math.ceil(secondsToFullyRegen / 0.05); i += 1) {
    now += 50;
    sim.step(0.05, now);
  }
  assert.equal(sim.encounterSnapshot().heroes[player.id].hp, maxHp,
    'out-of-combat regen must fully restore a double-aggro hero before the next fight, given enough clear time');
});

test('WOLF_AGGRO_RANGE stays the number a fleeing hero actually has to clear', () => {
  // Not a tautology: this exists so a future re-tune of the aggro range is forced to look at this
  // file rather than silently changing what "clear of both leashes" means above.
  assert.equal(WOLF_AGGRO_RANGE, 6);
});
