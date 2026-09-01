import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HERO_MAX_HP,
  WOLF_AGGRO_RANGE,
  WOLF_BITE_RANGE,
} from '../public/src/combat/encounter.js';
import { BEACON_ARENA, ENEMY_POPULATION, HERO_SPAWN } from '../public/src/world/zones/village.js';
import { createSimulation } from '../net/gameServer.mjs';

const STEP = 1 / 60;
const SECONDS = 60;

/**
 * THE PHANTOM RESPAWN: a hero who is alive, at full hearts, and standing in the Beacon arena is
 * silently teleported back to the village spawn by the OTHER engine's copy of their body.
 *
 * The Owner hit this in a live playtest on 2026-08-27 and corrected the first guess himself:
 * nobody died, the hearts never moved, no "You went down" veil, no banner -- the child was just
 * suddenly back at the start area, usually moments after killing a wolf near the Old Beacon.
 *
 * The chain, all of it inside net/gameServerCore.mjs:
 *   1. A hero inside BEACON_ARENA is owned by the siege (settleArenas), but stepParty still steps
 *      the wolf engine's own copy of every hero every tick.
 *   2. An enemy whose aggro circle reaches inside the arena rim chases to its leash limit and bites
 *      that copy. hp drains, the wolf engine raises hero-down and then hero-respawned.
 *   3. keepEvent correctly refuses to put either event on the wire (the siege owns this body), and
 *      encounterSnapshot correctly publishes the siege's untouched copy -- so the child is shown
 *      NOTHING: full hearts, no veil, no banner.
 *   4. ...but the teleport loop that acts on hero-respawned did NOT ask keepEvent, so it moved the
 *      player to encounterState.heroSpawn anyway. Position reconciliation drags the client there
 *      with no event at all.
 *
 * This test pins step 4 at the seam rather than at one coordinate, so it stays meaningful after the
 * placement that made the bug reachable in production (frost-wolf-2) has been moved out of range:
 * the enemy home below is DERIVED from the arena and the combat constants, never typed.
 */

/** An enemy home placed on purpose so its teeth reach a hero standing just inside the arena rim.
 *  Distance from the arena centre is chosen so the gap to the rim is inside WOLF_AGGRO_RANGE (it
 *  aggros a hero in the arena at all) and the body at its leash limit is inside WOLF_BITE_RANGE of
 *  that rim (it can actually land the bite). Production's frost-wolf-2 sat at gap 5.953 against a
 *  6 m aggro range and 1.553 m of reach against a 1.6 m bite -- so marginal that a stationary hero
 *  took 80 s to be bitten once. Half a bite range of slack instead of four centimetres makes the
 *  same mechanism land in seconds, so this test can be short without being lucky. */
const LEASH_RADIUS = 4.4;
const RIM_GAP = LEASH_RADIUS + WOLF_BITE_RANGE * 0.5;
const HOME_DISTANCE = BEACON_ARENA.radiusMeters + RIM_GAP;

function reachingEnemy() {
  assert.ok(RIM_GAP < WOLF_AGGRO_RANGE,
    'the fixture home must sit inside aggro range of the arena rim or it proves nothing');
  return [{
    enemyId: 'rim-biter',
    kind: 'wolf',
    level: 1,
    // Due south of the arena centre: open road, clear of the Beacon plinth and the Lantern Tree
    // that world/obstacles.js pushes a hero's feet out of.
    home: { x: BEACON_ARENA.at[0], z: BEACON_ARENA.at[1] - HOME_DISTANCE },
    leashRadius: LEASH_RADIUS,
  }];
}

/** The rim point nearest that home, offset by `inset` metres along the same line: negative is
 *  inside the arena (the siege owns the body), positive is outside it (the wolf engine does). */
function rimPoint(inset) {
  return {
    x: BEACON_ARENA.at[0],
    z: BEACON_ARENA.at[1] - (BEACON_ARENA.radiusMeters + inset),
  };
}

function runRim(inset) {
  const simulation = createSimulation({ enemies: reachingEnemy() });
  const player = simulation.addPlayer('rim kid', rimPoint(inset));
  const seen = { 'hero-hurt': 0, 'hero-down': 0, 'hero-respawned': 0 };
  let teleports = 0;
  let biggestJump = 0;
  let nowMs = 0;
  let previous = { x: player.x, z: player.z };
  for (let frame = 0; frame < SECONDS / STEP; frame += 1) {
    nowMs += STEP * 1000;
    simulation.step(STEP, nowMs);
    const jump = Math.hypot(player.x - previous.x, player.z - previous.z);
    if (jump > biggestJump) biggestJump = jump;
    if (Math.hypot(player.x - HERO_SPAWN.x, player.z - HERO_SPAWN.z) < 0.5
      && Math.hypot(previous.x - HERO_SPAWN.x, previous.z - HERO_SPAWN.z) >= 0.5) teleports += 1;
    previous = { x: player.x, z: player.z };
    for (const event of simulation.drainEvents()) {
      if (event.heroId === player.id && event.type in seen) seen[event.type] += 1;
    }
  }
  return { simulation, player, seen, teleports, biggestJump };
}

test('a hero standing inside the Beacon arena is never teleported by the wolf engine\'s copy', () => {
  const { simulation, player, seen, teleports, biggestJump } = runRim(-0.1);

  // THE FIXTURE HAS TO STILL REACH, or every assertion below passes for the wrong reason. All of
  // them are ABSENCES (no teleport, no jump, no lost hearts, no events) -- and a fixture that had
  // stopped reaching into the arena would produce those absences too, leaving the test vacuously
  // green while still claiming to pin the bug. So the two conditions that make the mechanism
  // possible are asserted here, in the same imported terms the placement rule uses: the home must
  // aggro a hero at the rim, and the body at its leash limit must be able to land the bite. If a
  // radius or a range ever moves, this fails loudly and asks to be rewritten rather than quietly
  // protecting nothing.
  assert.ok(RIM_GAP < WOLF_AGGRO_RANGE,
    `the fixture home sits ${RIM_GAP.toFixed(3)} m from the rim, outside WOLF_AGGRO_RANGE `
    + `(${WOLF_AGGRO_RANGE}) -- it can no longer notice a hero in the arena, so the absences below `
    + 'prove nothing');
  assert.ok(RIM_GAP - LEASH_RADIUS < WOLF_BITE_RANGE,
    `the fixture can only close to ${(RIM_GAP - LEASH_RADIUS).toFixed(3)} m of the rim against a `
    + `${WOLF_BITE_RANGE} m bite -- it can no longer reach the hero, so the absences below prove `
    + 'nothing');

  assert.equal(teleports, 0,
    'the hero was moved to the village spawn while standing in the Beacon arena -- the wolf '
    + 'engine raised hero-respawned for a body the siege owns, and the teleport loop obeyed it');
  // A hero with no input only ever moves by the server's own body-separation nudge. Anything on the
  // order of the arena radius is a teleport, whatever its destination.
  assert.ok(biggestJump < 1, `the hero jumped ${biggestJump.toFixed(2)} m in one tick`);

  // ...and nothing may LIE to cover for it either: the published body is the siege's, and the siege
  // never touched this hero.
  const hero = simulation.encounterSnapshot().heroes[player.id];
  assert.equal(hero.hp, HERO_MAX_HP, 'the published hero lost hearts to a fight it was not in');
  assert.ok(hero.downSeconds < 0, 'the published hero was down without the child ever being told');
  assert.equal(seen['hero-down'], 0, 'a hero-down for a body the siege owns reached the wire');
  assert.equal(seen['hero-respawned'], 0, 'a hero-respawned for a body the siege owns reached the wire');
});

test('the same mauling one step OUTSIDE the arena is still fully narrated and still relocates', () => {
  // The control half. Without it the fix could be "stop respawning anybody" and pass.
  const { seen, teleports } = runRim(0.1);

  assert.ok(teleports >= 1, 'a hero downed in the wolf engine\'s own ground must still be relocated');
  assert.ok(seen['hero-hurt'] >= 1, 'the child must hear every heart they actually lost');
  assert.ok(seen['hero-down'] >= 1, 'the child must be told they went down');
  assert.ok(seen['hero-respawned'] >= 1, 'the child must be told they are back on their feet');
});

/**
 * ...and the placement rule that made the defect reachable in the shipped world, pinned over the
 * whole population rather than over the one body that got it wrong.
 *
 * public/src/world/zones/village.js's own ENEMY_POPULATION header claims every home was hand-checked
 * clear of "the Beacon arena handoff zone". The hand-check reasoned about where a BODY may wander
 * (arena radius + leash) and not about where a BITE may reach, and frost-wolf-2 shipped 0.047 m
 * inside the real envelope. Nothing enforced the claim -- so it could be wrong and stay wrong.
 */
test('no authored enemy can bite a hero standing inside the Beacon arena', () => {
  for (const enemy of ENEMY_POPULATION) {
    const distance = Math.hypot(
      enemy.home.x - BEACON_ARENA.at[0],
      enemy.home.z - BEACON_ARENA.at[1],
    );
    const required = BEACON_ARENA.radiusMeters
      + Math.max(enemy.leashRadius + WOLF_BITE_RANGE, WOLF_AGGRO_RANGE);
    assert.ok(distance >= required,
      `${enemy.enemyId} sits ${distance.toFixed(3)} m from the Beacon arena centre but needs `
      + `${required.toFixed(3)} m: its teeth reach inside the handoff zone, where the siege owns `
      + 'the hero body and the wolf engine is talking to itself');
  }
});
