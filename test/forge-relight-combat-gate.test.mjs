// test/forge-relight-combat-gate.test.mjs
//
// P3 CP2 -- the Relight combat-authority gate, proved without sockets.
//
// The chosen gate: personal `isRelightEligible` unchanged; shared Relight additionally requires
// server-origin kill-XP for BOTH `emberworks-gremlin-1` and `emberworks-alpha-1`
// (net/gameServerCore.mjs's FORGE_RELIGHT_COMBAT_PREREQUISITES, enforced in the forge-relight
// handler before the atomic claimForgeRelight write). These tests prove every conjunct of that
// allow-rule at the coordinator/store seam: forge readiness derived through the real
// createRuneForgeService wired exactly as attachGameServer wires it, combat evidence seeded only
// through the genuine server award path (test/forge-combat-seed.mjs), and the ungated
// claimForgeRelight write performed only when the handler would actually reach it -- a test that
// called the write under a closed gate would prove nothing, so refusal proofs assert the gate
// reads and the undisturbed durable state instead.
//
// Socket-free by design, so this file stays green where the sandbox cannot open sockets. The
// end-to-end composition (the handler's own three lines) is proved by the socket tests in
// test/forge-relight.test.mjs, which the Director runs authoritatively.

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  FORGE_RELIGHT_COMBAT_PREREQUISITES,
  createRewardCoordinator,
} from '../net/gameServerCore.mjs';
import { openRewardStore } from '../net/rewardStore.mjs';
import { createRuneForgeService, loadRuneForgeCatalog } from '../net/runeForge.mjs';
import {
  FORGE_RELIGHT_COMPLETED,
  completionFact,
  isRelightEligible,
  selectPackFact,
} from '../public/src/learning/runeForge.js';
import { seedServerKills } from './forge-combat-seed.mjs';

const GUEST_A = 'profile-aaaaaaaa';
const GUEST_B = 'profile-bbbbbbbb';
const [GREMLIN_ID, ALPHA_ID] = FORGE_RELIGHT_COMBAT_PREREQUISITES;

// Correct hammer answers for the place-value-rounding pack, per
// public/data/learning/rune-forge-v1.json -- the same table test/forge-relight.test.mjs reads.
// Task ids are read off live state at runtime so a content-only rename fails loudly here rather
// than answering wrong silently.
const CORRECT_CHOICE_BY_TASK = {
  'value-4582-hundreds': '500',
  'round-6742-hundred': '6700',
  'expanded-3206': '3000-200-6',
};

function tempStorePath(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return {
    path: join(directory, 'rewards.db'),
    cleanup: () => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

function countWorldRows(storePath) {
  const db = new DatabaseSync(storePath);
  try {
    return db.prepare("SELECT COUNT(*) AS c FROM reward_events WHERE type = 'emberworks-forge-lit'").get().c;
  } finally {
    db.close();
  }
}

// The forge service wired exactly as attachGameServer wires it: readiness derived from the
// coordinator's own durable profile facts, writes through its adjudicated record path.
function wireForge(rewards) {
  return createRuneForgeService({
    factsFor: (playerId) => rewards.profileFactsFor(playerId),
    profileIdFor: (playerId) => rewards.profileIdFor(playerId),
    recordFact: (playerId, fact) => rewards.recordForgeFact(playerId, fact),
    grantEntitlement: (playerId, entitlement) => rewards.grantRuneForgeEntitlement(playerId, entitlement),
  });
}

// Earn forge readiness the honest server-side way: select the pack, hammer two runes.
function earnReadiness(forge, heroId) {
  forge.select(heroId, 'place-value-rounding');
  for (let answered = 0; answered < 2; answered += 1) {
    const state = forge.stateFor(heroId);
    forge.answer(heroId, state.task.id, CORRECT_CHOICE_BY_TASK[state.task.id], state.contentVersion);
  }
  const ready = forge.stateFor(heroId);
  assert.equal(ready.readyToClaim, true, 'test setup: two hammered runes earn the finale');
  assert.equal(isRelightEligible(ready), true);
  return ready;
}

// The handler's own allow-rule (net/gameServerCore.mjs's forge-relight branch): personal
// readiness AND server-observed kills for BOTH roles. Named here so each proof below asserts the
// composition the server actually enforces, not a restatement invented for the test.
function handlerWouldAllow(rewards, forge, heroId) {
  return isRelightEligible(forge.stateFor(heroId))
    && FORGE_RELIGHT_COMBAT_PREREQUISITES.every((enemyId) => rewards.hasServerObservedKill(heroId, enemyId));
}

function personalCompletions(rewards, heroId) {
  return rewards.profileFactsFor(heroId).filter((fact) => fact.type === FORGE_RELIGHT_COMPLETED);
}

// (1) A structurally valid CLIENT-RESTORED forge journal earns readiness but never combat.
test('P3-CP2 a client-restored forge journal earns readiness yet leaves the gate closed', () => {
  const fixture = tempStorePath('gq-relight-gate-restoredready-');
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-a', GUEST_A);
    const forge = wireForge(rewards);
    const catalog = loadRuneForgeCatalog();
    const pack = catalog.packs.find((candidate) => candidate.id === 'place-value-rounding');
    const journal = [
      selectPackFact(GUEST_A, catalog, 'place-value-rounding'),
      completionFact(GUEST_A, catalog, pack.tasks[0], false),
      completionFact(GUEST_A, catalog, pack.tasks[1], false),
    ];
    assert.deepEqual(rewards.restoreProfileFacts('hero-a', journal), { restored: 3, refused: 0 });

    const state = forge.stateFor('hero-a');
    assert.equal(isRelightEligible(state), true,
      'the restored journal is structurally valid: readiness derives from it');
    assert.equal(handlerWouldAllow(rewards, forge, 'hero-a'), false,
      'but no server ever saw combat, so the handler still refuses before any write');
    assert.equal(rewards.forgeLit(), false, 'the shared forge stays dark');
    assert.deepEqual(personalCompletions(rewards, 'hero-a'), [], 'no personal completion is minted');
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});

// (2) CLIENT-ORIGIN kill-XP rows for BOTH roles -- byte-identical id shape, wrong attestation.
test('P3-CP2 client-origin kill rows for both roles still cannot satisfy the gate', () => {
  const fixture = tempStorePath('gq-relight-gate-clientkills-');
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-a', GUEST_A);
    const journal = FORGE_RELIGHT_COMBAT_PREREQUISITES.map((enemyId, index) => ({
      eventId: `kill-xp:${GUEST_A}:${enemyId}:restored-life-${index}`,
      type: 'xp-earned',
      value: '20',
    }));
    assert.deepEqual(rewards.restoreProfileFacts('hero-a', journal), { restored: 2, refused: 0 });

    const restored = rewards.profileFactsFor('hero-a').filter((fact) => fact.type === 'xp-earned');
    assert.equal(restored.length, 2, 'the kills remain readable as personal history');
    assert.ok(restored.every((fact) => fact.origin === 'client'), 'stamped client-attested, forever');
    for (const enemyId of FORGE_RELIGHT_COMBAT_PREREQUISITES) {
      assert.equal(rewards.hasServerObservedKill('hero-a', enemyId), false,
        `a restored ${enemyId} kill is provenance, never authority`);
    }
    assert.equal(rewards.forgeLit(), false);
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});

// (3) Exactly one genuine server kill is still a closed gate.
test('P3-CP2 exactly one genuine server kill still leaves the gate closed', () => {
  const fixture = tempStorePath('gq-relight-gate-onekill-');
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-a', GUEST_A);
    const forge = wireForge(rewards);
    earnReadiness(forge, 'hero-a');
    seedServerKills(rewards, 'hero-a', [GREMLIN_ID]);

    assert.equal(rewards.hasServerObservedKill('hero-a', GREMLIN_ID), true);
    assert.equal(rewards.hasServerObservedKill('hero-a', ALPHA_ID), false);
    assert.equal(handlerWouldAllow(rewards, forge, 'hero-a'), false,
      'one of two roles is still a refusal before any write');
    assert.equal(rewards.forgeLit(), false);
    assert.deepEqual(personalCompletions(rewards, 'hero-a'), []);
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});

// (4) Genuine kills for BOTH roles open the gate and the first Relight lands.
test('P3-CP2 genuine kills for both roles open the gate and the first Relight lands', () => {
  const fixture = tempStorePath('gq-relight-gate-bothkills-');
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-a', GUEST_A);
    const forge = wireForge(rewards);
    earnReadiness(forge, 'hero-a');
    seedServerKills(rewards, 'hero-a');

    assert.equal(handlerWouldAllow(rewards, forge, 'hero-a'), true,
      'readiness plus both server-observed kills is exactly what the handler demands');
    const relight = rewards.claimForgeRelight('hero-a');
    assert.equal(relight.granted, true, 'the personal row lands');
    assert.equal(relight.worldApplied, true, 'and lights the shared forge');
    assert.deepEqual(relight.facts.map((fact) => fact.type), [FORGE_RELIGHT_COMPLETED, 'gear-owned'],
      'only personal facts (completion + #192 Shoulders reward) are announced, never shared truth');
    assert.equal(rewards.forgeLit(), true);
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});

// (5) Duplicate/retry remains idempotent.
test('P3-CP2 retrying the gated finale stays a no-op after both kills', () => {
  const fixture = tempStorePath('gq-relight-gate-retry-');
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-a', GUEST_A);
    const forge = wireForge(rewards);
    earnReadiness(forge, 'hero-a');
    seedServerKills(rewards, 'hero-a');

    const first = rewards.claimForgeRelight('hero-a');
    assert.deepEqual(
      { granted: first.granted, worldApplied: first.worldApplied },
      { granted: true, worldApplied: true },
    );
    const replay = rewards.claimForgeRelight('hero-a');
    assert.deepEqual(
      { granted: replay.granted, worldApplied: replay.worldApplied, facts: replay.facts },
      { granted: false, worldApplied: false, facts: [] },
      'identical replay is a no-op, not a second grant or a second ceremony',
    );
    assert.equal(personalCompletions(rewards, 'hero-a').length, 1);
    assert.equal(countWorldRows(fixture.path), 1, 'one shared world result, however many retries');
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});

// (6) A late sibling in an already-lit world needs their OWN kills, then completes without
// relighting the world.
test('P3-CP2 a late sibling needs their own kills, then completes into the lit world', () => {
  const fixture = tempStorePath('gq-relight-gate-sibling-');
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-a', GUEST_A);
    const forge = wireForge(rewards);
    earnReadiness(forge, 'hero-a');
    seedServerKills(rewards, 'hero-a');
    assert.equal(rewards.claimForgeRelight('hero-a').worldApplied, true, 'test setup: the world is lit');

    rewards.join('hero-b', GUEST_B);
    earnReadiness(forge, 'hero-b');
    assert.equal(handlerWouldAllow(rewards, forge, 'hero-b'), false,
      'the sibling inherits the lit world, never the lighter combat history');
    for (const enemyId of FORGE_RELIGHT_COMBAT_PREREQUISITES) {
      assert.equal(rewards.hasServerObservedKill('hero-b', enemyId), false);
    }

    seedServerKills(rewards, 'hero-b');
    assert.equal(handlerWouldAllow(rewards, forge, 'hero-b'), true,
      'after their own two kills the sibling meets the same gate');
    const second = rewards.claimForgeRelight('hero-b');
    assert.equal(second.granted, true, 'their own completion lands');
    assert.equal(second.worldApplied, false, 'but the already-lit world is not written twice');
    assert.equal(countWorldRows(fixture.path), 1, 'one shared world result for both completions');
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});

// (7) Restart preserves genuine kill evidence and the lit world alike.
test('P3-CP2 restart preserves genuine kill evidence and gate semantics', () => {
  const fixture = tempStorePath('gq-relight-gate-restart-');
  const first = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    first.join('hero-a', GUEST_A);
    const forge = wireForge(first);
    earnReadiness(forge, 'hero-a');
    seedServerKills(first, 'hero-a');
    assert.equal(first.claimForgeRelight('hero-a').worldApplied, true);
  } finally {
    first.close();
  }
  const second = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    assert.equal(second.forgeLit(), true, 'the store still knows before any player joins');
    second.join('hero-a2', GUEST_A);
    for (const enemyId of FORGE_RELIGHT_COMBAT_PREREQUISITES) {
      assert.equal(second.hasServerObservedKill('hero-a2', enemyId), true,
        `genuine ${enemyId} evidence survives the restart under the same guest`);
    }
    assert.equal(personalCompletions(second, 'hero-a2').length, 1,
      'the completion follows the profile, not the retired session');
  } finally {
    second.close();
    fixture.cleanup();
  }
});

// Direct store law: origin, guest scope, enemy scope, validation, reopen.
test('P3-CP2 hasServerKillXpFor is a literal server-origin prefix proof, nothing more', () => {
  const fixture = tempStorePath('gq-relight-gate-storelaw-');
  const store = openRewardStore(fixture.path);
  try {
    store.apply({ guestId: GUEST_A, type: 'xp-earned', eventId: `kill-xp:${GUEST_A}:${GREMLIN_ID}:life-1`, value: '20' });
    assert.equal(store.hasServerKillXpFor(GUEST_A, GREMLIN_ID), true, 'a server row matches');
    assert.equal(store.hasServerKillXpFor(GUEST_A, ALPHA_ID), false, 'the unslain role does not');
    assert.equal(store.hasServerKillXpFor(GUEST_B, GREMLIN_ID), false, 'another guest cannot spend this kill');
    assert.equal(store.hasServerKillXpFor(GUEST_A, 'emberworks-gremlin-10'), false,
      'the trailing-colon prefix keeps a longer enemy id from shadowing the shorter one');
    assert.equal(store.hasServerKillXpFor('profile-%_', GREMLIN_ID), false,
      'a literal comparison gives LIKE metacharacters no meaning');

    store.apply({
      guestId: GUEST_A, type: 'xp-earned',
      eventId: `kill-xp:${GUEST_A}:${ALPHA_ID}:restored-life`, value: '100', origin: 'client',
    });
    assert.equal(store.hasServerKillXpFor(GUEST_A, ALPHA_ID), false,
      'a byte-identical client-origin row is invisible to the gate');

    store.apply({ guestId: GUEST_A, type: 'mark-earned', eventId: `kill-xp:${GUEST_A}:${ALPHA_ID}:wrong-type` });
    assert.equal(store.hasServerKillXpFor(GUEST_A, ALPHA_ID), false,
      'a cross-type row squatting the kill identity is not a kill');

    store.apply({ guestId: GUEST_A, type: 'xp-earned', eventId: `kill-xp:${GUEST_B}:${GREMLIN_ID}:wrong-column`, value: '20' });
    assert.equal(store.hasServerKillXpFor(GUEST_B, GREMLIN_ID), false,
      'the guest column scopes even when the id names another profile');
    assert.equal(store.hasServerKillXpFor(GUEST_A, GREMLIN_ID), true, 'the honest row still reads');

    assert.equal(store.hasServerKillXpFor('', GREMLIN_ID), false, 'narrow validation: empty guest');
    assert.equal(store.hasServerKillXpFor(GUEST_A, ''), false, 'narrow validation: empty enemy');
    assert.equal(store.hasServerKillXpFor(null, GREMLIN_ID), false, 'narrow validation: non-string guest');
    assert.equal(store.hasServerKillXpFor(GUEST_A, 42), false, 'narrow validation: non-string enemy');
  } finally {
    store.close();
  }
  const reopened = openRewardStore(fixture.path);
  try {
    assert.equal(reopened.hasServerKillXpFor(GUEST_A, GREMLIN_ID), true, 'genuine evidence survives reopen');
    assert.equal(reopened.hasServerKillXpFor(GUEST_A, ALPHA_ID), false,
      'client-origin invisibility survives reopen too');
  } finally {
    reopened.close();
    fixture.cleanup();
  }
});

// The gate reads durable kill rows, never the spawn table, so it cannot notice on its own when a
// prerequisite has no spawner: Relight then refuses every live player, forever. That
// happened once (emberworks-alpha-1 was named here before any zone authored it), so pin the
// agreement against the population a real Emberworks simulation actually spawns.
test('every Relight combat prerequisite is actually spawned in Emberworks, with the seeded kind', async () => {
  const { createSimulation } = await import('../net/gameServerCore.mjs');
  const { EMBERWORKS_DEEP_DESTINATION_ID } = await import('../public/src/world/zones/emberworksDeep.js');
  const sim = createSimulation({ destinationId: EMBERWORKS_DEEP_DESTINATION_ID });
  sim.addPlayer('relight-reachability');
  const spawned = new Map(sim.encounterSnapshot().enemies.map((enemy) => [enemy.enemyId, enemy.kind]));
  const seededKind = { [GREMLIN_ID]: 'lava-gremlin', [ALPHA_ID]: 'alpha-wolf' };
  assert.equal(FORGE_RELIGHT_COMBAT_PREREQUISITES.length, 2);
  for (const enemyId of FORGE_RELIGHT_COMBAT_PREREQUISITES) {
    assert.ok(spawned.has(enemyId),
      `Relight requires a server-observed kill of ${enemyId}, but Emberworks spawns only ${JSON.stringify([...spawned.keys()])}`);
    assert.equal(spawned.get(enemyId), seededKind[enemyId],
      `test/forge-combat-seed.mjs prices ${enemyId} as ${seededKind[enemyId]}; the live spawn must agree`);
  }
});
