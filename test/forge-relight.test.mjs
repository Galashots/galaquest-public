// test/forge-relight.test.mjs
//
// P3 CP1 -- the Emberworks Forge-relight completion/state seam.
//
// One narrow shared-world fact (`emberworks-forge-lit`), one server-adjudicated final action
// (`forge-relight`), one atomic completion transaction (shared lit row + the completing profile's
// own `forge-relight-completed` row), restored through the existing world-fact bootstrap path and
// published on the existing welcome/snapshot encounter block. No new persistence system, no second
// wearable: the later selected wearable reward joins this same transaction batch.
//
// Mirrors the Old Beacon's own test shape (test/game-server.test.mjs's ephemeral-victory test,
// test/beacon-siege-multiplayer.test.mjs's late-joiner read) at the forge's own seam.

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { attachGameServer, createRewardCoordinator, createSimulation } from '../net/gameServerCore.mjs';
import { openRewardStore } from '../net/rewardStore.mjs';
import {
  EMBERWORKS_FORGE_LIT_EVENT_ID,
  FORGE_RELIGHT_COMPLETED,
  MAGMALORD_ENTITLEMENT_ID,
  isRelightEligible,
  relightCompletionFact,
} from '../public/src/learning/runeForge.js';
import {
  WORLD_FACT_TYPES,
  isClientRestorableProfileFact,
  isProfileFact,
} from '../public/src/progression/facts.js';
import { decode, encode, joinMessage } from '../public/src/net/protocol.js';

const ATTACKER = 'profile-aaaaaaaa';
const SIBLING = 'profile-bbbbbbbb';

// Correct hammer answers for the place-value-rounding pack, per
// public/data/learning/rune-forge-v1.json. Read off the state task id at runtime so a content-only
// edit that renames a task fails loudly here rather than answering wrong silently.
const CORRECT_CHOICE_BY_TASK = {
  'value-4582-hundreds': '500',
  'round-6742-hundred': '6700',
  'expanded-3206': '3000-200-6',
};

function tempDir(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return {
    directory,
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

// ── vocabulary and identity ───────────────────────────────────────────────────

test('P3-CP1 the Forge-lit world fact and the personal relight completion live in their own categories', () => {
  assert.ok(WORLD_FACT_TYPES.includes('emberworks-forge-lit'), 'shared-world vocabulary names the lit forge');
  assert.equal(
    isProfileFact({ eventId: EMBERWORKS_FORGE_LIT_EVENT_ID, type: 'emberworks-forge-lit' }),
    false,
    'the lit forge is world truth, never one profile earning folded into personal state',
  );
  assert.equal(EMBERWORKS_FORGE_LIT_EVENT_ID, 'emberworks-forge-lit:rune-forge');

  const fact = relightCompletionFact(ATTACKER);
  assert.deepEqual(fact, {
    eventId: `forge-relight:${ATTACKER}:${MAGMALORD_ENTITLEMENT_ID}`,
    type: FORGE_RELIGHT_COMPLETED,
    value: JSON.stringify({ entitlementId: MAGMALORD_ENTITLEMENT_ID }),
  });
  assert.equal(isProfileFact(fact), true, 'the completing profile owns a durable personal fact');
  assert.deepEqual(relightCompletionFact(ATTACKER), fact, 'the identity is stable, not minted per call');
});

test('P3-CP1 relight eligibility is the forge own readiness, not a second rule', () => {
  assert.equal(isRelightEligible({ readyToClaim: true, owned: false }), true);
  assert.equal(isRelightEligible({ readyToClaim: false, owned: true }), true);
  assert.equal(isRelightEligible({ readyToClaim: false, owned: false }), false);
  assert.equal(isRelightEligible(null), false);
});

test('P3-CP1 a device journal can neither mint nor reserve Forge-lit truth', () => {
  assert.equal(
    isClientRestorableProfileFact({ eventId: EMBERWORKS_FORGE_LIT_EVENT_ID, type: 'emberworks-forge-lit' }, ATTACKER),
    false,
    'the world fact itself is not a profile fact and never restores',
  );
  assert.equal(
    isClientRestorableProfileFact(
      { eventId: EMBERWORKS_FORGE_LIT_EVENT_ID, type: 'xp-earned', value: '1' }, ATTACKER,
    ),
    false,
    'a cross-type row cannot reserve the shared Forge-lit identity either',
  );
  assert.equal(
    isClientRestorableProfileFact(relightCompletionFact(ATTACKER), ATTACKER),
    true,
    'the rightful profile restores its own relight completion',
  );
  assert.equal(
    isClientRestorableProfileFact(relightCompletionFact(SIBLING), ATTACKER),
    false,
    'one profile cannot reserve the sibling completion identity out from under them',
  );
});

// ── durable store ─────────────────────────────────────────────────────────────

test('P3-CP1 the store writes the lit forge once, refuses client origin, and survives restart', () => {
  const fixture = tempDir('gq-forge-relight-store-');
  const path = join(fixture.directory, 'rewards.db');
  try {
    const store = openRewardStore(path);
    try {
      assert.equal(store.forgeLit(), false);
      assert.throws(
        () => store.apply({
          guestId: ATTACKER, type: 'emberworks-forge-lit',
          eventId: EMBERWORKS_FORGE_LIT_EVENT_ID, origin: 'client',
        }),
        /client-restored fact/i,
        'a device handing back shared Forge-lit truth is refused at the store boundary too',
      );
      assert.equal(
        store.apply({ guestId: ATTACKER, type: 'emberworks-forge-lit', eventId: EMBERWORKS_FORGE_LIT_EVENT_ID }).applied,
        true,
      );
      assert.equal(store.forgeLit(), true);
      assert.equal(
        store.apply({ guestId: SIBLING, type: 'emberworks-forge-lit', eventId: EMBERWORKS_FORGE_LIT_EVENT_ID }).applied,
        false,
        'identical replay is a no-op, however many guests claim to have lit it',
      );
    } finally {
      store.close();
    }
    const restarted = openRewardStore(path);
    try {
      assert.equal(restarted.forgeLit(), true, 'restart must not put the forge out');
    } finally {
      restarted.close();
    }
    assert.equal(countWorldRows(path), 1, 'one shared world result on disk, not one per claimant');
  } finally {
    fixture.cleanup();
  }
});

// ── the completion transaction ────────────────────────────────────────────────

test('P3-CP1 one atomic transaction: shared lit row plus the completing profile own row', () => {
  const fixture = tempDir('gq-forge-relight-txn-');
  const path = join(fixture.directory, 'rewards.db');
  try {
    const rewards = createRewardCoordinator({ rewardStorePath: path });
    try {
      rewards.join('hero-a', ATTACKER);
      rewards.join('hero-b', SIBLING);

      const first = rewards.claimForgeRelight('hero-a');
      assert.equal(first.granted, true, 'the first completion lands the personal row');
      assert.equal(first.worldApplied, true, 'and lights the shared forge');
      assert.equal(first.facts.length, 1, 'only the personal fact is announced, never shared truth');
      assert.equal(first.facts[0].type, FORGE_RELIGHT_COMPLETED);
      assert.equal(first.facts[0].eventId, `forge-relight:${ATTACKER}:${MAGMALORD_ENTITLEMENT_ID}`);
      assert.equal(rewards.forgeLit(), true);

      const replay = rewards.claimForgeRelight('hero-a');
      assert.deepEqual(
        { granted: replay.granted, worldApplied: replay.worldApplied, facts: replay.facts },
        { granted: false, worldApplied: false, facts: [] },
        'identical replay is a no-op, not a second grant or a second ceremony',
      );

      const concurrent = rewards.claimForgeRelight('hero-b');
      assert.equal(concurrent.granted, true, 'a concurrent sibling still earns their own completion');
      assert.equal(concurrent.worldApplied, false, 'but the already-lit world is not written twice');
      assert.equal(countWorldRows(path), 1, 'one shared world result however many profiles complete');

      const personal = (hero) => rewards.profileFactsFor(hero).filter((fact) => fact.type === FORGE_RELIGHT_COMPLETED);
      assert.equal(personal('hero-a').length, 1);
      assert.equal(personal('hero-b').length, 1);
      assert.equal(personal('hero-a')[0].eventId, `forge-relight:${ATTACKER}:${MAGMALORD_ENTITLEMENT_ID}`);
      assert.notEqual(personal('hero-a')[0].eventId, personal('hero-b')[0].eventId);

      rewards.join('hero-ghost', undefined);
      assert.deepEqual(rewards.claimForgeRelight('hero-ghost'), { granted: false, worldApplied: false, facts: [] });
    } finally {
      rewards.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('P3-CP1 a refused journal cannot mint Forge-lit truth through the restore door', () => {
  const fixture = tempDir('gq-forge-relight-restore-');
  try {
    const rewards = createRewardCoordinator({ rewardStorePath: join(fixture.directory, 'rewards.db') });
    try {
      rewards.join('hero-a', ATTACKER);
      assert.deepEqual(rewards.restoreProfileFacts('hero-a', [
        { eventId: EMBERWORKS_FORGE_LIT_EVENT_ID, type: 'emberworks-forge-lit' },
        { eventId: EMBERWORKS_FORGE_LIT_EVENT_ID, type: 'xp-earned', value: '1' },
        relightCompletionFact(SIBLING),
      ]), { restored: 0, refused: 3 });
      assert.equal(rewards.forgeLit(), false, 'the refused attack leaves the shared forge dark');
      assert.deepEqual(rewards.restoreProfileFacts('hero-a', [relightCompletionFact(ATTACKER)]),
        { restored: 1, refused: 0 }, 'the rightful personal completion still restores');
    } finally {
      rewards.close();
    }
  } finally {
    fixture.cleanup();
  }
});

// ── simulation latch (socket-free: the same seed/read/flip the handler composes) ──

test('P3-CP1 the simulation seeds the latch at construction and never puts it out', () => {
  const dark = createSimulation({ destinationId: 'emberworks-deep' });
  assert.deepEqual(dark.forgeSnapshot(), { lit: false }, 'a fresh forge is dark');
  dark.markForgeLit();
  assert.deepEqual(dark.forgeSnapshot(), { lit: true });
  dark.markForgeLit();
  assert.deepEqual(dark.forgeSnapshot(), { lit: true }, 'relighting the latch is a no-op, never a toggle');
  const restored = createSimulation({ destinationId: 'emberworks-deep', forgeLit: true });
  assert.deepEqual(restored.forgeSnapshot(), { lit: true },
    'the bootstrap read seeds the fresh simulation before any snapshot is built');
});

// ── live sockets ──────────────────────────────────────────────────────────────

async function withServer(rewardStorePath, run) {
  const http = createServer();
  const game = attachGameServer(http, { rewardStorePath, allowMissingOrigin: true });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const sockets = [];
  async function connect(name, guestId) {
    const socket = new WebSocket(`ws://127.0.0.1:${http.address().port}/ws`);
    const messages = [];
    let closed = false;
    let closeCode = null;
    socket.addEventListener('message', (event) => messages.push(decode(event.data)));
    socket.addEventListener('close', (event) => { closed = true; closeCode = event.code; });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    socket.send(encode(joinMessage(name, guestId, 'emberworks-deep')));
    const wait = async (predicate, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const match = messages.find(predicate);
        if (match) return match;
        if (Date.now() > deadline) throw new Error(`timed out; latest=${JSON.stringify(messages.at(-1))}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    const welcome = await wait((message) => message.type === 'welcome');
    return {
      socket, messages, welcome, wait,
      send(message) { socket.send(encode({ ...message, v: 4, worldEpoch: 0 })); },
      isClosed: () => closed,
      closeCode: () => closeCode,
    };
  }
  try {
    await run({ game, connect });
  } finally {
    for (const socket of sockets) socket.close();
    game.stop();
    await new Promise((resolve) => http.close(resolve));
  }
}

function putAtForge(game, playerId) {
  Object.assign(game.simulationFor('emberworks-deep').players.get(playerId), { x: 7.2, z: 17.2 });
}

function moveTo(game, playerId, x, z) {
  Object.assign(game.simulationFor('emberworks-deep').players.get(playerId), { x, z });
}

async function completeBothTasks(peer) {
  peer.send({ type: 'forge-select-pack', packId: 'place-value-rounding' });
  let state = await peer.wait((message) => message.type === 'forge-state' && message.forge.response === 'pack-selected');
  for (let answered = 0; answered < 2; answered += 1) {
    const task = state.forge.task;
    peer.send({
      type: 'forge-answer', taskId: task.id,
      choiceId: CORRECT_CHOICE_BY_TASK[task.id], contentVersion: state.forge.contentVersion,
    });
    state = await peer.wait((message) => message.type === 'forge-state'
      && message.forge.completedCount === answered + 1);
  }
  assert.equal(state.forge.readyToClaim, true, 'test setup: two hammered runes earn the finale');
  return state;
}

test('P3-CP1 sockets: an unready, displaced, or ephemeral relight is a clean silent no-op', async () => {
  const fixture = tempDir('gq-forge-relight-noop-');
  try {
    await withServer(join(fixture.directory, 'rewards.db'), async ({ game, connect }) => {
      const unready = await connect('unready', ATTACKER);
      putAtForge(game, unready.welcome.id);
      unready.send({ type: 'forge-relight' });
      const displaced = await connect('displaced', SIBLING);
      putAtForge(game, displaced.welcome.id);
      await completeBothTasks(displaced);
      moveTo(game, displaced.welcome.id, 0, 4);
      displaced.send({ type: 'forge-relight' });
      const ghost = await connect('ghost', undefined);
      putAtForge(game, ghost.welcome.id);
      ghost.send({ type: 'forge-relight' });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(unready.isClosed(), false, 'an early ask must not cost the connection');
      assert.equal(displaced.isClosed(), false, 'asking from across the room must not cost the connection');
      assert.equal(game.rewards.forgeLit(), false, 'no ask without readiness AND presence AND identity lights anything');
      assert.deepEqual(game.rewards.profileFactsFor(unready.welcome.id)
        .filter((fact) => fact.type === FORGE_RELIGHT_COMPLETED), []);
      assert.deepEqual(game.rewards.profileFactsFor(displaced.welcome.id)
        .filter((fact) => fact.type === FORGE_RELIGHT_COMPLETED), []);
    });
  } finally {
    fixture.cleanup();
  }
});

test('P3-CP1 sockets: one shared lit forge, per-profile completion, retry-safe, epoch-guarded', async () => {
  const fixture = tempDir('gq-forge-relight-live-');
  const storePath = join(fixture.directory, 'rewards.db');
  try {
    await withServer(storePath, async ({ game, connect }) => {
      const first = await connect('first', ATTACKER);
      putAtForge(game, first.welcome.id);
      await completeBothTasks(first);

      first.send({ type: 'forge-relight' });
      const lit = await first.wait((message) => message.type === 'snapshot' && message.encounter.forge.lit === true);
      assert.equal(lit.destinationId, 'emberworks-deep');
      const ceremony = await first.wait((message) => message.type === 'forge-state' && message.forge.response === 'relit');
      assert.equal(ceremony.forge.justLit, true);
      assert.equal(
        ceremony.profileFacts.filter((fact) => fact.type === FORGE_RELIGHT_COMPLETED).length, 1,
        'the personal completion rides the private state straight away',
      );

      first.send({ type: 'forge-relight' });
      const secondCeremony = await first.wait((message) => message.type === 'forge-state'
        && message.forge.response === 'already-lit' && message !== ceremony);
      assert.notEqual(secondCeremony.forge.justLit, true, 'a repeated relight has no second ceremony');
      assert.equal(
        game.rewards.profileFactsFor(first.welcome.id)
          .filter((fact) => fact.type === FORGE_RELIGHT_COMPLETED).length, 1,
        'retrying the finale cannot complete twice',
      );

      // A stale-epoch duplicate of the same intent dies at the existing session rule.
      first.socket.send(encode({ v: 4, type: 'forge-relight', worldEpoch: 7 }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(
        game.rewards.profileFactsFor(first.welcome.id)
          .filter((fact) => fact.type === FORGE_RELIGHT_COMPLETED).length, 1,
      );

      // A late sibling enters an already-lit world while remaining personally incomplete.
      const sibling = await connect('sibling', SIBLING);
      assert.equal(sibling.welcome.encounter.forge.lit, true, 'welcome already carries the lit forge');
      putAtForge(game, sibling.welcome.id);
      sibling.send({ type: 'forge-open' });
      const siblingState = await sibling.wait((message) => message.type === 'forge-state');
      assert.equal(siblingState.forge.status, 'choose-pack');
      assert.equal(siblingState.forge.completedCount, 0);
      assert.ok(sibling.messages.every((message) => message.type !== 'forge-state'
        || message.id === sibling.welcome.id), 'private learning state is never broadcast');

      await completeBothTasks(sibling);
      sibling.send({ type: 'forge-relight' });
      // The lit snapshot predates this action (the world was already lit), so it cannot
      // synchronize on it: wait for the private post-action signal the handler sends only after
      // the durable write lands, then assert the personal completion fact.
      await sibling.wait((message) => message.type === 'forge-state' && message.forge.response === 'already-lit');
      await sibling.wait((message) => message.type === 'snapshot' && message.encounter.forge.lit === true);
      assert.equal(
        game.rewards.profileFactsFor(sibling.welcome.id)
          .filter((fact) => fact.type === FORGE_RELIGHT_COMPLETED).length, 1,
        'the sibling earns their own completion in the shared lit world',
      );
      assert.equal(countWorldRows(storePath), 1, 'one shared world result for both completions');
    });
  } finally {
    fixture.cleanup();
  }
});

test('P3-CP1 sockets: reconnect replaces the session and the completion follows the profile', async () => {
  const fixture = tempDir('gq-forge-relight-reconnect-');
  try {
    await withServer(join(fixture.directory, 'rewards.db'), async ({ game, connect }) => {
      const old = await connect('old', ATTACKER);
      putAtForge(game, old.welcome.id);
      await completeBothTasks(old);
      old.send({ type: 'forge-relight' });
      await old.wait((message) => message.type === 'snapshot' && message.encounter.forge.lit === true);

      const active = await connect('active', ATTACKER);
      await active.wait((message) => message.type === 'snapshot');
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(old.isClosed(), true, 'the old same-profile socket is explicitly retired');
      assert.equal(
        active.welcome.profileFacts.filter((fact) => fact.type === FORGE_RELIGHT_COMPLETED).length, 1,
        'the completion follows the profile to the new session, not the retired socket',
      );
      putAtForge(game, active.welcome.id);
      active.send({ type: 'forge-open' });
      const state = await active.wait((message) => message.type === 'forge-state');
      assert.equal(state.forge.completedCount, 2, 'durable task work follows the profile takeover');
    });
  } finally {
    fixture.cleanup();
  }
});

test('P3-CP1 sockets: a server restart restores the lit forge before any simulation exists', async () => {
  const fixture = tempDir('gq-forge-relight-restart-');
  const storePath = join(fixture.directory, 'rewards.db');
  try {
    await withServer(storePath, async ({ game, connect }) => {
      const first = await connect('first', ATTACKER);
      putAtForge(game, first.welcome.id);
      await completeBothTasks(first);
      first.send({ type: 'forge-relight' });
      await first.wait((message) => message.type === 'snapshot' && message.encounter.forge.lit === true);
    });

    await withServer(storePath, async ({ game, connect }) => {
      assert.equal(game.rewards.forgeLit(), true, 'the store still knows before any player joins');
      assert.equal(
        game.simulationFor('emberworks-deep').forgeSnapshot().lit, true,
        'the bootstrap read seeds the fresh simulation before any snapshot is built',
      );
      const late = await connect('late', SIBLING);
      assert.equal(late.welcome.encounter.forge.lit, true, 'a late joiner never arrives to find it cold again');
      putAtForge(game, late.welcome.id);
      late.send({ type: 'forge-open' });
      const state = await late.wait((message) => message.type === 'forge-state');
      assert.equal(state.forge.status, 'choose-pack', 'while remaining personally incomplete');
    });
  } finally {
    fixture.cleanup();
  }
});
