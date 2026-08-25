// The server-hosted fight, exercised with no sockets: createSimulation() driven directly with
// injected `now`/`deltaSeconds`, following test/game-server.test.mjs's "the simulation, with time
// injected" pattern for its first half. Task B3 of the private engineering archive

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { WOLF_SPAWN, createSimulation } from '../net/gameServer.mjs';
import {
  BASE_HERO_DAMAGE, HERO_MAX_HP, MIN_BODY_SEPARATION, SWING_CONTACT_SECONDS, WOLF_MAX_HP,
} from '../public/src/combat/encounter.js';
import { BEACON_ARENA } from '../public/src/world/zones/village.js';
import { attackMessage, decode, encode } from '../public/src/net/protocol.js';
import { STARTER_SWORD_ID, WILDWOOD_BLADE_ID, damageFor } from '../public/src/progression/items.js';
import { cumulativeXpForLevel } from '../public/src/progression/levels.js';
import { resolveHeroStats, resolvedHeroDamage, resolvedMaxHp } from '../public/src/progression/heroStats.js';

// A spot within ATTACK_REACH (1.7) of the wolf, straight along +Z from it, so a hero standing here
// with the default heading (0, meaning "facing +Z") is both in range and in the strike arc.
function meleeSpot(offset = 1) {
  return { x: WOLF_SPAWN.x, z: WOLF_SPAWN.z - offset };
}

function attack(sim, playerId, seq) {
  return sim.applyAttack(playerId, decode(encode(attackMessage(seq))));
}

function stepTicks(sim, count, deltaSeconds = 0.05, startAtMs = 1000) {
  let now = startAtMs;
  let tick;
  for (let i = 0; i < count; i += 1) {
    now += deltaSeconds * 1000;
    tick = sim.step(deltaSeconds, now);
  }
  return tick;
}

test('a joined player within reach who attacks produces a swing event, then wolf HP drops at contact', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid', meleeSpot());

  const accepted = attack(sim, player.id, 1);
  assert.equal(accepted, true, 'an in-range, off-cooldown attack should be accepted');

  const immediateEvents = sim.drainEvents();
  assert.ok(immediateEvents.some((e) => e.type === 'swing' && e.heroId === player.id),
    `expected a swing event on arrival, got ${JSON.stringify(immediateEvents)}`);

  const hpBeforeContact = sim.encounterSnapshot().wolf.hp;

  // Step up to just short of contact: no hit yet.
  const ticksToJustBeforeContact = Math.floor(SWING_CONTACT_SECONDS / 0.05) - 1;
  stepTicks(sim, ticksToJustBeforeContact);
  assert.equal(sim.encounterSnapshot().wolf.hp, hpBeforeContact, 'no damage before contact time');

  // Step past contact.
  stepTicks(sim, 3);
  const afterContact = sim.encounterSnapshot();
  assert.equal(afterContact.wolf.hp, hpBeforeContact - BASE_HERO_DAMAGE, 'the wolf should have taken one hit');
  const events = sim.drainEvents();
  assert.ok(events.some((e) => e.type === 'wolf-hit' && e.heroId === player.id),
    `expected a wolf-hit event carrying the attacker's heroId, got ${JSON.stringify(events)}`);
});

test('two players both landing swings both damage the wolf', () => {
  const sim = createSimulation();
  // Offset each hero slightly sideways so neither's separateFromWolf push displaces the other, but
  // both stay within ATTACK_REACH and the strike arc (well under the +/-0.42*PI half-arc).
  const a = sim.addPlayer('a', { x: WOLF_SPAWN.x - 0.3, z: WOLF_SPAWN.z - 1 });
  const b = sim.addPlayer('b', { x: WOLF_SPAWN.x + 0.3, z: WOLF_SPAWN.z - 1 });

  assert.equal(attack(sim, a.id, 1), true);
  assert.equal(attack(sim, b.id, 1), true);
  sim.drainEvents();

  const startHp = sim.encounterSnapshot().wolf.hp;
  stepTicks(sim, Math.ceil(SWING_CONTACT_SECONDS / 0.05) + 1);

  const afterHp = sim.encounterSnapshot().wolf.hp;
  assert.equal(afterHp, startHp - BASE_HERO_DAMAGE * 2,
    `both swings should land; wolf hp ${startHp} -> ${afterHp}`);
  const events = sim.drainEvents();
  const hitHeroIds = events.filter((e) => e.type === 'wolf-hit' || e.type === 'wolf-defeated')
    .map((e) => e.heroId).sort();
  assert.deepEqual(hitHeroIds, [a.id, b.id].sort(),
    `expected both attackers credited, got ${JSON.stringify(events)}`);
});

test('a replayed attack seq does not start a second swing', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid', meleeSpot());

  assert.equal(attack(sim, player.id, 5), true, 'the first attack at seq 5 should be accepted');
  const firstEvents = sim.drainEvents();
  assert.equal(firstEvents.filter((e) => e.type === 'swing').length, 1);

  // Same seq resent, e.g. a dropped ack causing the client to retry.
  const replayed = attack(sim, player.id, 5);
  assert.equal(replayed, false, 'a replayed seq must not be accepted again');
  const replayEvents = sim.drainEvents();
  assert.equal(replayEvents.filter((e) => e.type === 'swing').length, 0,
    'no second swing event from the replay');

  // Confirm only one swing ever lands, not two, by stepping through contact and checking damage.
  const startHp = sim.encounterSnapshot().wolf.hp;
  stepTicks(sim, Math.ceil(SWING_CONTACT_SECONDS / 0.05) + 1);
  assert.equal(sim.encounterSnapshot().wolf.hp, startHp - BASE_HERO_DAMAGE,
    'exactly one hit should land, not two');
});

test('a player walking into the wolf is held at MIN_BODY_SEPARATION by the server', () => {
  const sim = createSimulation();
  // Start the hero standing exactly on the wolf's spawn point -- as close as a teleporting walk-in
  // could ever get -- and step once with no input at all.
  const player = sim.addPlayer('kid', { x: WOLF_SPAWN.x, z: WOLF_SPAWN.z });

  stepTicks(sim, 1);

  const dx = player.x - WOLF_SPAWN.x;
  const dz = player.z - WOLF_SPAWN.z;
  const distance = Math.hypot(dx, dz);
  assert.ok(Math.abs(distance - MIN_BODY_SEPARATION) < 1e-9,
    `expected the hero held at MIN_BODY_SEPARATION (${MIN_BODY_SEPARATION}), got ${distance}`);
});

test('leaving mid-fight removes the hero from the encounter', () => {
  const sim = createSimulation();
  const a = sim.addPlayer('a', meleeSpot());
  const b = sim.addPlayer('b', { x: WOLF_SPAWN.x, z: WOLF_SPAWN.z - 3 });

  assert.ok(Object.prototype.hasOwnProperty.call(sim.encounterSnapshot().heroes, a.id));
  sim.removePlayer(a.id);

  const afterLeave = sim.encounterSnapshot();
  assert.ok(!Object.prototype.hasOwnProperty.call(afterLeave.heroes, a.id),
    'the departed hero should be out of the encounter');
  assert.ok(Object.prototype.hasOwnProperty.call(afterLeave.heroes, b.id),
    'the remaining hero should still be in the encounter');
});

test('welcome-time encounter and snapshot-time encounter are both available, rounded to 3 decimals', () => {
  const sim = createSimulation();
  sim.addPlayer('kid', meleeSpot());
  const before = sim.encounterSnapshot();
  assert.equal(before.wolf.hp, WOLF_MAX_HP, 'a fresh encounter starts the wolf at full HP');
  // revision counts commands applied (encounter.js's own doc comment) -- addHero is one, so a
  // single joined player already reads 1, not 0.
  assert.equal(before.revision, 1);
  assert.deepEqual(Object.keys(before.heroes).length, 1);

  stepTicks(sim, 3);
  const after = sim.encounterSnapshot();
  // Rounding: every numeric wolf field should already be a multiple of 0.001.
  for (const field of ['x', 'z', 'heading']) {
    const value = after.wolf[field];
    assert.equal(Math.round(value * 1000) / 1000, value, `${field} should already be rounded`);
  }
});

// Task B4.5: enemies/wolf.js needs wolf.modeSeconds to restart a one-shot clip on mode re-entry
// (a second hero's hit landing mid-stagger re-flinches the wolf), and the B2 wire block omitted
// it. No player is added here -- the wolf accrues idle-mode time on its own, which is the simplest
// deterministic way to prove the field both rides the snapshot and advances between ticks.
test('the encounter snapshot carries wolf.modeSeconds, rounded to 3 decimals, and it advances between stepped ticks', () => {
  const sim = createSimulation();

  const before = sim.encounterSnapshot();
  assert.equal(before.wolf.modeSeconds, 0, 'a fresh wolf has spent no time in its mode yet');

  stepTicks(sim, 3);
  const after = sim.encounterSnapshot();
  assert.equal(after.wolf.mode, 'idle', 'no hero joined, so the wolf never leaves idle');
  assert.ok(after.wolf.modeSeconds > before.wolf.modeSeconds,
    `modeSeconds should advance across 3 stepped ticks, got ${before.wolf.modeSeconds} -> ${after.wolf.modeSeconds}`);
  assert.equal(Math.round(after.wolf.modeSeconds * 1000) / 1000, after.wolf.modeSeconds,
    'modeSeconds should already be rounded to 3 decimals like the rest of the wolf block');
});

// ── the arena handoff (Director gate, PR #14) ───────────────────────────────────────────────────
//
// A CHILD HAS ONE BODY. Both engines keep hero clocks because both resolve their own swings, but
// exactly one is authoritative for a given hero at a time, and crossing the Beacon arena's edge is
// an explicit transfer rather than a change of which copy gets published.
//
// The first version of this published by distance test alone -- selection, not continuity -- and
// these are the two cases that exposed it: hearts lost to a wolf came back on arrival at the Beacon,
// and walking home resurrected the pre-Warden body.

/** Walk a player to a point without going through input, then let the tick settle their arena. */
function placeAndSettle(sim, id, x, z) {
  const player = sim.players.get(id);
  player.x = x;
  player.z = z;
  sim.step(0.05, 1000);
  return sim;
}

test('hearts lost to the wolf survive walking into the Beacon arena', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  // Hurt this hero in the wolf fight by standing in the wolf's jaws until it bites.
  let bitten = false;
  for (let i = 0; i < 400 && !bitten; i += 1) {
    const wolf = sim.encounterSnapshot().wolf;
    player.x = wolf.x;
    player.z = wolf.z;
    sim.step(0.05, 1000 + i * 50);
    bitten = sim.encounterSnapshot().heroes[player.id].hp < HERO_MAX_HP;
  }
  const hurtHp = sim.encounterSnapshot().heroes[player.id].hp;
  assert.ok(hurtHp < HERO_MAX_HP, 'setup: the wolf has to actually land a bite');

  placeAndSettle(sim, player.id, BEACON_ARENA.at[0], BEACON_ARENA.at[1]);
  assert.equal(
    sim.encounterSnapshot().heroes[player.id].hp, hurtHp,
    'the Beacon must not hand a wounded child full hearts for crossing a line',
  );

  // ...and walking back must not resurrect the body they had before the Beacon either.
  placeAndSettle(sim, player.id, WOLF_SPAWN.x, WOLF_SPAWN.z + 6);
  assert.equal(
    sim.encounterSnapshot().heroes[player.id].hp, hurtHp,
    'and going home must not resurrect a stale copy',
  );
});

test('an in-flight swing is cancelled at the arena boundary rather than carried across', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid');
  sim.applyAttack(player.id, decode(encode(attackMessage(1))));
  assert.ok(sim.encounterSnapshot().heroes[player.id].swingSeconds >= 0, 'setup: mid-swing');

  placeAndSettle(sim, player.id, BEACON_ARENA.at[0], BEACON_ARENA.at[1]);
  assert.equal(
    sim.encounterSnapshot().heroes[player.id].swingSeconds, -1,
    'a swing belongs to the fight it was thrown in',
  );
});

// ── HOW STRONG THIS HERO IS REACHES THE FIGHT ──────────────────────────────────────────────────
//
// createSimulation() does not own equipment or progression and must not: what a guest owns, has
// equipped and has earned is durable, per-guest reward-store truth, and guestId is a CONNECTION fact
// this factory has no business knowing. So the owner of that truth hands in a lookup. These pin the
// two ends of that wire -- the default (nobody said anything) and the wired case (a stronger hero
// actually hits harder) -- because between them sits the exact seam where a shipped reward quietly
// did nothing for two chapters (docs/MISTAKES.md GQ-013).
//
// The lookup used to be `weaponIdFor` returning an item id. Since P2 it is `heroStatsFor` returning
// `{ maxHp, heroDamage }`, because a Hero LEVEL moves both numbers and two separate lookups is a
// hero whose body and arm can disagree about what level they are.

test('a simulation nobody told about equipment fights exactly as it always has', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('kid', meleeSpot());
  const before = sim.encounterSnapshot().wolf.hp;
  attack(sim, player.id, 1);
  stepTicks(sim, Math.ceil(SWING_CONTACT_SECONDS / 0.05) + 2);
  assert.equal(sim.encounterSnapshot().wolf.hp, before - BASE_HERO_DAMAGE,
    'an unnamed weapon is a Level-1 hero with the starter sword, and an unwired simulation swings it');
});

test('a hero holding the Wildwood Blade takes two blows\' worth off the wolf, not one', () => {
  const sim = createSimulation({
    heroStatsFor: () => resolveHeroStats({ equippedWeaponId: WILDWOOD_BLADE_ID }),
  });
  const player = sim.addPlayer('kid', meleeSpot());
  const before = sim.encounterSnapshot().wolf.hp;
  attack(sim, player.id, 1);
  stepTicks(sim, Math.ceil(SWING_CONTACT_SECONDS / 0.05) + 2);
  assert.equal(sim.encounterSnapshot().wolf.hp, before - damageFor(WILDWOOD_BLADE_ID),
    'the reward at the end of the longest promise in the game has to be felt in the fight');
});

test('a LEVELLED hero hits harder in the server-hosted fight, with no gear change at all', () => {
  // P2's whole claim, at the seam where it can be checked without a browser: the same starter sword,
  // the same wolf, and the only difference is that the child earned a level. If this ever stops
  // being true, the level-up ceremony is a lie with numbers attached (GQ-013).
  const levelled = createSimulation({
    heroStatsFor: () => resolveHeroStats({
      totalXp: cumulativeXpForLevel(2), equippedWeaponId: STARTER_SWORD_ID,
    }),
  });
  const player = levelled.addPlayer('kid', meleeSpot());
  const before = levelled.encounterSnapshot().wolf.hp;
  attack(levelled, player.id, 1);
  stepTicks(levelled, Math.ceil(SWING_CONTACT_SECONDS / 0.05) + 2);
  const dealt = before - levelled.encounterSnapshot().wolf.hp;

  assert.equal(dealt, resolvedHeroDamage(2, STARTER_SWORD_ID), 'the level reached the blade');
  assert.ok(dealt > damageFor(STARTER_SWORD_ID), 'and it is strictly more than the sword alone');
});

test('a LEVELLED hero has a bigger body in the server-hosted fight', () => {
  const levelled = createSimulation({
    heroStatsFor: () => resolveHeroStats({
      totalXp: cumulativeXpForLevel(2), equippedWeaponId: STARTER_SWORD_ID,
    }),
  });
  const player = levelled.addPlayer('kid', { x: WOLF_SPAWN.x + 40, z: WOLF_SPAWN.z + 40 });
  // One tick is all it takes: reconcileMaxHp runs before anything else in the step, and a gain tops
  // the hero up in the same frame it is granted.
  stepTicks(levelled, 1);
  const hero = levelled.encounterSnapshot().heroes[player.id];
  assert.equal(hero.maxHp, resolvedMaxHp(2), 'the level reached the body');
  assert.equal(hero.hp, hero.maxHp, 'and the new health is filled, not left as an empty promise');
  assert.ok(hero.maxHp > HERO_MAX_HP, 'strictly bigger than the body they started the game with');
});

test('the lookup is asked every tick, so equipping mid-fight works without a reconnect', () => {
  // A value copied at construction would mean the sword you just equipped on the Hero screen only
  // started working after the socket dropped and came back -- which is the shape of bug nobody
  // reports and every child notices.
  let held = null;
  const sim = createSimulation({
    heroStatsFor: () => resolveHeroStats({ equippedWeaponId: held }),
  });
  const player = sim.addPlayer('kid', meleeSpot());

  const start = sim.encounterSnapshot().wolf.hp;
  attack(sim, player.id, 1);
  stepTicks(sim, Math.ceil(SWING_CONTACT_SECONDS / 0.05) + 2);
  const afterFirst = sim.encounterSnapshot().wolf.hp;
  assert.equal(afterFirst, start - BASE_HERO_DAMAGE,
    'the first blow was thrown bare-handed of any named weapon');

  held = WILDWOOD_BLADE_ID;
  let seq = 2;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (attack(sim, player.id, seq)) break;
    seq += 1;
    stepTicks(sim, 1);
  }
  stepTicks(sim, Math.ceil(SWING_CONTACT_SECONDS / 0.05) + 2);
  const wolf = sim.encounterSnapshot().wolf;
  // A base blow and then a Blade blow together exceed WOLF_MAX_HP: the wolf is down, and it took two
  // blows rather than three.
  assert.ok(wolf.hp <= 0 || wolf.mode === 'dying' || wolf.mode === 'dead',
    `the second blow should have finished it, wolf reads ${JSON.stringify(wolf)}`);
});
