// test/forge-combat-seed.mjs
//
// P3-CP2: one reusable way to seed genuine server-observed combat in tests.
//
// This feeds drained-simulation-shaped defeat events through the reward coordinator's own
// processTick -- the production fold (rewards/killXp.js) into applyKillXpAward path that writes
// `kill-xp:<guestId>:<enemyId>:<lifeId>` rows with NO origin, which is exactly what the Relight
// gate's `origin IS NULL` read means by "the server saw this kill". It never touches SQLite
// directly, so a row it plants is indistinguishable from one a real fight planted: same fold,
// same id shape, same null origin, same coordinator-minted distinct lifeIds (randomUUID per
// completed life inside processTick).
//
// The gate reads enemy IDs, not kinds: a kind here is only the vehicle that gets the fold to
// price the kill (combat/enemyStats.js's killXpForKind). The mapping below is arbitrary and
// carries no product meaning -- do not read tuning into it.

import { strict as assert } from 'node:assert';

import { FORGE_RELIGHT_COMBAT_PREREQUISITES } from '../net/gameServerCore.mjs';

const KIND_BY_PREREQUISITE = Object.freeze({
  'emberworks-gremlin-1': 'lava-gremlin',
  'emberworks-alpha-1': 'alpha-wolf',
});

/**
 * Seed server-observed kills for each enemy id through the coordinator's genuine award path.
 *
 * @param rewards  a createRewardCoordinator() instance, already join()ed for heroId.
 * @param heroId  the player/hero id whose guest earns the kills.
 * @param enemyIds  defaults to the Relight gate's own prerequisite list, in order.
 * @returns the announced xp-earned facts, one per enemy id.
 */
export function seedServerKills(rewards, heroId, enemyIds = FORGE_RELIGHT_COMBAT_PREREQUISITES) {
  const announced = [];
  for (const enemyId of enemyIds) {
    const kind = KIND_BY_PREREQUISITE[enemyId];
    assert.ok(kind, `seedServerKills has no priced kind mapped for enemy ${JSON.stringify(enemyId)}`);
    const events = rewards.processTick([{
      type: 'wolf-defeated', enemyId, heroId, kind, level: 1,
    }]);
    const awards = events.filter((event) => event.type === 'xp-earned' && event.heroId === heroId);
    assert.equal(awards.length, 1,
      `seeding a server kill for ${enemyId} must mint exactly one xp-earned award, got ${JSON.stringify(events)}`);
    announced.push(...awards);
  }
  for (const enemyId of enemyIds) {
    assert.equal(rewards.hasServerObservedKill(heroId, enemyId), true,
      `a seeded server kill for ${enemyId} must satisfy the gate read immediately`);
  }
  const eventIds = announced.map((fact) => fact.eventId);
  assert.equal(new Set(eventIds).size, eventIds.length,
    'each seeded kill mints a distinct lifeId -- one shared life would collapse two roles into one row family');
  return announced;
}
