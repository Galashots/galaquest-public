import test from 'node:test';
import assert from 'node:assert/strict';

import { HERO_MAX_HP } from '../public/src/combat/encounter.js';
import { BEACON_ARENA, WOLF_SPAWN } from '../public/src/world/zones/village.js';
import { createSimulation } from '../net/gameServer.mjs';

const STEP = 1 / 60;

/**
 * One child has one body. The wolf fight and the Beacon fight are two combat contexts, not two
 * independent health bars that happen to share a player id.
 *
 * This is deliberately an end-to-end simulation regression rather than a reducer test: the bug was
 * created at the orchestration seam by adding the hero to two otherwise-correct engines and choosing
 * whichever copy to publish by location. Both individual engines could be perfectly tested while a
 * child crossing the arena boundary silently got their hearts back.
 */
test('damage follows a hero across the wolf / Beacon arena boundary', () => {
  const simulation = createSimulation();
  const player = simulation.addPlayer('boundary kid', {
    // Start in the wolf's bite bowl, not exactly on its body. The server's ordinary separation rule
    // is still active, so this exercises the same path a real player does.
    x: WOLF_SPAWN.x,
    z: WOLF_SPAWN.z - 1.1,
  });

  let nowMs = 0;
  let wolfSideHp = HERO_MAX_HP;
  for (let frame = 0; frame < 1800 && wolfSideHp === HERO_MAX_HP; frame += 1) {
    nowMs += STEP * 1000;
    simulation.step(STEP, nowMs);
    wolfSideHp = simulation.encounterSnapshot().heroes[player.id].hp;
  }
  assert.ok(wolfSideHp < HERO_MAX_HP,
    `the wolf never damaged the hero, so the arena handoff was not exercised (hp ${wolfSideHp})`);

  // Cross directly into a dormant Beacon arena. Nothing there has earned the right to heal us.
  player.x = BEACON_ARENA.at[0];
  player.z = BEACON_ARENA.at[1];
  nowMs += STEP * 1000;
  simulation.step(STEP, nowMs);
  const beaconSideHp = simulation.encounterSnapshot().heroes[player.id].hp;
  assert.equal(beaconSideHp, wolfSideHp,
    'entering the Beacon arena must not swap in a fresh independent hero body');

  // And crossing back cannot resurrect the old wolf copy either. This second assertion matters once
  // the handoff is implemented: a one-way copy can make the first crossing pass while still keeping
  // two diverging bodies behind the scenes.
  player.x = WOLF_SPAWN.x;
  player.z = WOLF_SPAWN.z - 1.1;
  nowMs += STEP * 1000;
  simulation.step(STEP, nowMs);
  assert.equal(simulation.encounterSnapshot().heroes[player.id].hp, beaconSideHp,
    'leaving the Beacon arena must preserve the same body state');
});
