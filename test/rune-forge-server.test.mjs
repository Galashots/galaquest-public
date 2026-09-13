import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { attachGameServer, createRewardCoordinator } from '../net/gameServerCore.mjs';
import { createRuneForgeService } from '../net/runeForge.mjs';
import { resolveIncomingDamage } from '../public/src/combat/damage.js';
import {
  MAGMALORD_ENTITLEMENT_ID,
  MAGMALORD_HELMET_ID,
} from '../public/src/learning/runeForge.js';
import { decode, encode, joinMessage } from '../public/src/net/protocolCore.js';
import { resolveHeroStats } from '../public/src/progression/heroStats.js';
import { powerFor } from '../public/src/progression/power.js';

const catalogPath = new URL('../public/data/learning/rune-forge-v1.json', import.meta.url);

function memoryForge(path = catalogPath) {
  const facts = new Map();
  let grants = 0;
  const service = createRuneForgeService({
    catalogPath: path,
    factsFor: profileId => facts.get(profileId) ?? [],
    recordFact(profileId, fact) {
      const previous = facts.get(profileId) ?? [];
      if (!previous.some(item => item.eventId === fact.eventId)) facts.set(profileId, [...previous, fact]);
    },
    grantEntitlement(profileId, entitlement) {
      const previous = facts.get(profileId) ?? [];
      if (previous.some(item => item.type === 'gear-owned' && item.value === entitlement.itemId)) return false;
      grants += 1;
      facts.set(profileId, [...previous, {
        eventId: `forge-entitlement:${profileId}:${entitlement.id}`,
        type: 'gear-owned', value: entitlement.itemId,
      }]);
      return true;
    },
  });
  return { service, facts, grants: () => grants };
}

test('protocol accepts bounded forge actions and durable completion values, and rejects malformed identity', () => {
  assert.deepEqual(decode(encode({ v: 4, type: 'forge-open', worldEpoch: 0 })),
    { v: 4, type: 'forge-open', worldEpoch: 0 });
  assert.deepEqual(decode(encode({
    v: 4, type: 'forge-answer', taskId: 'round-6742-hundred', choiceId: '6700',
    contentVersion: '2026-09-08.1', worldEpoch: 3,
  })), {
    v: 4, type: 'forge-answer', taskId: 'round-6742-hundred', choiceId: '6700',
    contentVersion: '2026-09-08.1', worldEpoch: 3,
  });
  const completionValue = JSON.stringify({
    entitlementId: MAGMALORD_ENTITLEMENT_ID, packId: 'place-value-rounding',
    taskId: 'round-6742-hundred', contentVersion: '2026-09-08.1', outcome: 'independent',
  });
  assert.ok(completionValue.length > 32, 'precondition: this would fail the former item-id cap');
  assert.equal(decode(encode({
    v: 4, type: 'forge-state', id: 'p1', destinationId: 'emberworks-deep', worldEpoch: 0,
    forge: { status: 'active' },
    profileFacts: [{ eventId: 'forge-complete:profile-aaaaaaaa:e:t', type: 'forge-task-completed', value: completionValue }],
  })).profileFacts[0].value, completionValue);
  assert.throws(() => decode(encode({
    v: 4, type: 'forge-answer', taskId: '', choiceId: 'a', contentVersion: '1', worldEpoch: 0,
  })), /must not be empty/);
  assert.throws(() => decode(encode({
    v: 4, type: 'forge-state', id: 'p1', destinationId: 'emberworks-deep',
    forge: {}, profileFacts: [],
  })), /requires worldEpoch/);
});

test('service preserves retry and assistance history, grants once, and reloads a content-only edit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gq-forge-catalog-'));
  const editedPath = join(dir, 'catalog.json');
  try {
    writeFileSync(editedPath, readFileSync(catalogPath));
    const profile = 'profile-aaaaaaaa';
    const forge = memoryForge(editedPath);
    let state = forge.service.select(profile, 'grapheme-er-family');
    assert.equal(state.task.id, 'grapheme-bird-ir');
    assert.ok(state.task.choices.every(choice => !Object.hasOwn(choice, 'correct')),
      'answer keys never cross the presentation boundary');
    state = forge.service.answer(profile, state.task.id, 'er', state.contentVersion);
    assert.equal(state.response, 'retry');
    assert.equal(state.completedCount, 0);
    state = forge.service.hint(profile, state.task.id, state.contentVersion);
    assert.equal(state.response, 'hint');
    state = forge.service.answer(profile, state.task.id, 'ir', state.contentVersion);
    assert.equal(state.response, 'assisted-success');
    assert.equal(state.history[0].outcome, 'assisted');
    state = forge.service.answer(profile, state.task.id, 'ur', state.contentVersion);
    assert.equal(state.response, 'independent-success');
    assert.equal(state.readyToClaim, true);
    assert.equal(forge.service.claim(profile).justGranted, true);
    assert.equal(forge.service.claim(profile).owned, true);
    assert.equal(forge.grants(), 1);

    const edited = JSON.parse(readFileSync(editedPath, 'utf8'));
    edited.packs[0].tasks[2].displayPrompt = 'w __ ld';
    edited.packs[0].contentVersion = '2026-09-08.2';
    writeFileSync(editedPath, `${JSON.stringify(edited, null, 2)}\n`);
    const siblingState = forge.service.select('profile-bbbbbbbb', 'grapheme-er-family');
    assert.equal(siblingState.contentVersion, '2026-09-08.2',
      'the running service rereads an ordinary task edit through the validated data boundary');
    assert.equal(forge.service.stateFor(profile).owned, true,
      'the stable entitlement survives editorial content version changes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MagmaLord ownership and explicit equip feed the real defence and POWER consumers', () => {
  const rewards = createRewardCoordinator({ rewardStorePath: ':memory:' });
  try {
    rewards.join('p1', 'profile-aaaaaaaa');
    assert.equal(rewards.grantRuneForgeEntitlement('p1', {
      id: MAGMALORD_ENTITLEMENT_ID, itemId: MAGMALORD_HELMET_ID,
    }), true);
    assert.equal(rewards.grantRuneForgeEntitlement('p1', {
      id: MAGMALORD_ENTITLEMENT_ID, itemId: MAGMALORD_HELMET_ID,
    }), false, 'the same stable entitlement cannot grant twice');
    assert.ok(rewards.ownedItemIdsFor('p1').includes(MAGMALORD_HELMET_ID));
    rewards.applyEquip('p1', MAGMALORD_HELMET_ID);
    const equipped = rewards.rewardsFor(['p1']).p1.equippedItemIds;
    const before = resolveHeroStats();
    const after = resolveHeroStats({ equippedItemIds: equipped });
    assert.equal(after.damageReductionPercent, 20);
    assert.equal(resolveIncomingDamage(10, after.damageReductionPercent), 8);
    assert.ok(powerFor(after) > powerFor(before));
    assert.equal(rewards.profileFactsFor('p1').filter(fact => fact.type === 'gear-owned'
      && fact.value === MAGMALORD_HELMET_ID).length, 1);
  } finally { rewards.close(); }
});

async function withServer(run) {
  const http = createServer();
  const game = attachGameServer(http, { rewardStorePath: ':memory:', allowMissingOrigin: true });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const sockets = [];
  async function connect(name, guestId) {
    const socket = new WebSocket(`ws://127.0.0.1:${http.address().port}/ws`);
    const messages = [];
    let closed = false;
    socket.addEventListener('message', event => messages.push(decode(event.data)));
    socket.addEventListener('close', () => { closed = true; });
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
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    const welcome = await wait(message => message.type === 'welcome');
    return {
      socket, messages, welcome, wait,
      send(message) { socket.send(encode({ ...message, v: 4, worldEpoch: 0 })); },
      isClosed: () => closed,
    };
  }
  try { await run({ game, connect }); }
  finally {
    for (const socket of sockets) socket.close();
    game.stop();
    await new Promise(resolve => http.close(resolve));
  }
}

function putAtForge(game, playerId) {
  const player = game.simulationFor('emberworks-deep').players.get(playerId);
  Object.assign(player, { x: 7.2, z: 17.2 });
}

test('real sockets keep sibling forge progress private and retire an old same-profile claimant', async () => {
  await withServer(async ({ game, connect }) => {
    const sibling = await connect('sibling', 'profile-bbbbbbbb');
    const old = await connect('old', 'profile-aaaaaaaa');
    putAtForge(game, old.welcome.id);
    old.send({ type: 'forge-select-pack', packId: 'place-value-rounding' });
    let state = await old.wait(message => message.type === 'forge-state'
      && message.forge.response === 'pack-selected');
    old.send({ type: 'forge-answer', taskId: state.forge.task.id, choiceId: '500',
      contentVersion: state.forge.contentVersion });
    state = await old.wait(message => message.type === 'forge-state'
      && message.forge.response === 'independent-success');
    assert.equal(state.forge.completedCount, 1);

    const active = await connect('active', 'profile-aaaaaaaa');
    putAtForge(game, active.welcome.id);
    await active.wait(message => message.type === 'snapshot');
    assert.equal(game.simulationFor('emberworks-deep').players.has(old.welcome.id), false);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(old.isClosed(), true, 'the old same-profile socket is explicitly retired');

    active.send({ type: 'forge-open' });
    state = await active.wait(message => message.type === 'forge-state');
    assert.equal(state.forge.completedCount, 1, 'durable task work follows the profile takeover');
    assert.equal(state.forge.task.id, 'round-6742-hundred');
    active.send({ type: 'forge-answer', taskId: state.forge.task.id, choiceId: '6700',
      contentVersion: state.forge.contentVersion });
    state = await active.wait(message => message.type === 'forge-state'
      && message.forge.readyToClaim === true);
    active.send({ type: 'forge-claim' });
    const claimed = await active.wait(message => message.type === 'forge-state'
      && message.forge.justGranted === true);
    assert.equal(claimed.forge.owned, true);
    active.send({ type: 'forge-claim' });
    const owned = await active.wait(message => message.type === 'forge-state'
      && message.forge.owned === true && message !== claimed);
    assert.notEqual(owned.forge.justGranted, true, 'a repeated claim has no second ceremony');
    assert.equal(game.rewards.profileFactsFor(active.welcome.id).filter(fact => fact.type === 'gear-owned'
      && fact.value === MAGMALORD_HELMET_ID).length, 1);

    putAtForge(game, sibling.welcome.id);
    sibling.send({ type: 'forge-open' });
    const siblingState = await sibling.wait(message => message.type === 'forge-state');
    assert.equal(siblingState.forge.status, 'choose-pack');
    assert.equal(siblingState.forge.completedCount, 0);
    assert.equal(siblingState.forge.owned, false);
    assert.ok(sibling.messages.every(message => message.type !== 'forge-state'
      || message.id === sibling.welcome.id), 'private learning state is never broadcast');
  });
});
