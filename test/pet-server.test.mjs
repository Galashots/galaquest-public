import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { attachGameServer, createRewardCoordinator } from '../net/gameServerCore.mjs';
import { openRewardStore } from '../net/rewardStore.mjs';
import { WORM_PETS, PET_CAMP_DESTINATION } from '../public/src/progression/pets.js';
import { STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
import { decode, encode, joinMessage } from '../public/src/net/protocolCore.js';

const PROFILE = 'profile-aaaaaaaa';
const SIBLING_PROFILE = 'profile-bbbbbbbb';
const PET = WORM_PETS[0];

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
    socket.send(encode(joinMessage(name, guestId, 'home-hub')));
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
      send(message, worldEpoch = 0) { socket.send(encode({ ...message, v: 4, worldEpoch })); },
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

/** Set the simulation's authoritative body position without any fake action method. */
function placeBody(game, playerId, x, z) {
  const player = game.simulationFor('home-hub').players.get(playerId);
  assert.ok(player, `player ${playerId} must be in the home-hub simulation`);
  Object.assign(player, { x, z });
  return player;
}

function nearPet(offset = 0) { return { x: PET.campX + offset, z: PET.campZ }; }

test('protocol requires epoch for pet-action and rejects malformed pet args', () => {
  const base = { v: 4, type: 'pet-action', action: 'befriend', petId: PET.id,
    eventId: 'e1', rev: 0 };
  const noEpoch = { ...base };
  assert.throws(() => decode(JSON.stringify(noEpoch)), /requires worldEpoch/);
  assert.deepEqual(decode(encode({ ...base, worldEpoch: 0 })), { ...base, worldEpoch: 0 });
  assert.throws(() => decode(encode({ ...base, worldEpoch: 0, action: 'teleport' })), /unknown pet action/);
  assert.throws(() => decode(encode({ ...base, worldEpoch: 0, petId: 'not-a-pet' })), /unknown pet id/);
  assert.throws(() => decode(encode({ ...base, worldEpoch: 0, eventId: 'bad id!!' })), /invalid pet eventId/);
  assert.throws(() => decode(encode({ ...base, worldEpoch: 0, rev: -1 })), /invalid pet revision/);
  assert.throws(() => decode(encode({ ...base, worldEpoch: 0, rev: 1.5 })), /invalid pet revision/);
});

test('coordinator rejects malformed pet args before any write', () => {
  const rewards = createRewardCoordinator({ rewardStorePath: ':memory:' });
  try {
    rewards.join('hero', PROFILE);
    const before = rewards.profileFactsFor('hero').length;
    const malformed = [
      { action: 'dance', petId: PET.id, eventId: 'e1', rev: 0, destinationId: PET_CAMP_DESTINATION, ...nearPet() },
      { action: 'befriend', petId: 'nope', eventId: 'e2', rev: 0, destinationId: PET_CAMP_DESTINATION, ...nearPet() },
      { action: 'befriend', petId: PET.id, eventId: '!!', rev: 0, destinationId: PET_CAMP_DESTINATION, ...nearPet() },
      { action: 'befriend', petId: PET.id, eventId: 'e3', rev: -1, destinationId: PET_CAMP_DESTINATION, ...nearPet() },
    ];
    for (const request of malformed) {
      const result = rewards.applyPetAction('hero', request);
      assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(request)}`);
      assert.equal(result.facts.length, 0);
    }
    assert.equal(rewards.profileFactsFor('hero').length, before, 'no malformed request may persist a fact');
    assert.equal(rewards.rewardsFor(['hero']).hero.pets.equippedPetId, null);
  } finally { rewards.close(); }
});

test('real sockets own on befriend, follow first, and never auto-swap on a second befriend', async () => {
  await withServer(async ({ game, connect }) => {
    const hero = await connect('hero', PROFILE);
    const id = hero.welcome.id;
    placeBody(game, id, PET.campX, PET.campZ);
    hero.send({ type: 'pet-action', action: 'befriend', petId: PET.id, eventId: 'b1', rev: 1 });
    let state = await hero.wait(m => m.type === 'pet-state' && !m.error
      && m.pets.ownedPetIds.includes(PET.id));
    assert.equal(state.pets.equippedPetId, PET.id, 'first befriend owns and follows');

    const other = WORM_PETS[1];
    placeBody(game, id, other.campX, other.campZ);
    hero.send({ type: 'pet-action', action: 'befriend', petId: other.id, eventId: 'b2', rev: 2 });
    state = await hero.wait(m => m.type === 'pet-state' && m.pets.ownedPetIds.includes(other.id));
    assert.ok(state.pets.ownedPetIds.includes(PET.id));
    assert.equal(state.pets.equippedPetId, PET.id, 'a second befriend does not auto-swap the follower');
  });
});

test('explicit follow and rest reach the sibling snapshot as the same equipped pet', async () => {
  await withServer(async ({ game, connect }) => {
    const hero = await connect('hero', PROFILE);
    const sibling = await connect('sib', SIBLING_PROFILE);
    const id = hero.welcome.id;
    placeBody(game, id, PET.campX, PET.campZ);
    hero.send({ type: 'pet-action', action: 'befriend', petId: PET.id, eventId: 'b1', rev: 1 });
    await hero.wait(m => m.type === 'pet-state' && m.pets.ownedPetIds.includes(PET.id));

    const other = WORM_PETS[1];
    placeBody(game, id, other.campX, other.campZ);
    hero.send({ type: 'pet-action', action: 'befriend', petId: other.id, eventId: 'b2', rev: 2 });
    await hero.wait(m => m.type === 'pet-state' && m.pets.ownedPetIds.includes(other.id));

    hero.send({ type: 'pet-action', action: 'follow', petId: other.id, eventId: 'f1', rev: 3 });
    const followed = await hero.wait(m => m.type === 'pet-state' && m.pets.equippedPetId === other.id);
    assert.ok(followed.profileFacts.some(f => f.type === 'pet-equipped' && f.value === other.id));

    const seen = await sibling.wait(m => m.type === 'snapshot'
      && m.encounter?.rewards?.[id]?.pets?.equippedPetId === other.id);
    assert.ok(seen, 'the sibling snapshot observes the caller following the second pet');

    placeBody(game, id, other.campX, other.campZ);
    hero.send({ type: 'pet-action', action: 'rest', petId: other.id, eventId: 'r1', rev: 4 });
    const rested = await hero.wait(m => m.type === 'pet-state' && m.pets.equippedPetId === null);
    assert.equal(rested.pets.equippedPetId, null, 'rest clears the follower');
    const observedRest = await sibling.wait(m => m.type === 'snapshot'
      && m.encounter?.rewards?.[id]?.pets?.equippedPetId === null
      && m.encounter?.rewards?.[id]?.pets?.ownedPetIds.includes(other.id));
    assert.ok(observedRest, 'sibling snapshot reflects rested (still owned) state');
  });
});

test('caller profileFacts stay private and a sibling owns nothing until acting', async () => {
  await withServer(async ({ game, connect }) => {
    const hero = await connect('hero', PROFILE);
    const sibling = await connect('sib', SIBLING_PROFILE);
    placeBody(game, hero.welcome.id, PET.campX, PET.campZ);
    hero.send({ type: 'pet-action', action: 'befriend', petId: PET.id, eventId: 'b1', rev: 1 });
    const owned = await hero.wait(m => m.type === 'pet-state' && m.pets?.ownedPetIds?.includes(PET.id));
    assert.ok(Array.isArray(owned.profileFacts));

    const siblingId = sibling.welcome.id;
    const siblingSnapshot = await sibling.wait(m => m.type === 'snapshot'
      && m.encounter?.rewards?.[siblingId] !== undefined);
    const siblingPets = siblingSnapshot.encounter.rewards[siblingId].pets;
    assert.equal(siblingPets.ownedPetIds.length, 0, 'sibling owns nothing until its own action');
    assert.equal(siblingPets.equippedPetId, null);
    assert.ok(sibling.messages.every(m => m.type !== 'pet-state'
      || m.id === siblingId), 'pet-state is never broadcast to the wrong connection');
  });
});

test('payload position cannot fake range: the simulation body position is authoritative', async () => {
  await withServer(async ({ game, connect }) => {
    const hero = await connect('hero', PROFILE);
    const id = hero.welcome.id;
    placeBody(game, id, 40, 40);
    hero.send({
      type: 'pet-action', action: 'befriend', petId: PET.id, eventId: 'b1', rev: 1,
      x: PET.campX, z: PET.campZ,
    });
    const state = await hero.wait(m => m.type === 'pet-state' && m.error === 'out-of-range');
    assert.equal(state.pets.ownedPetIds.length, 0, 'a faked payload position grants no ownership');

    placeBody(game, id, PET.campX, PET.campZ);
    hero.send({ type: 'pet-action', action: 'befriend', petId: PET.id, eventId: 'b2', rev: 2 });
    const owned = await hero.wait(m => m.type === 'pet-state' && m.pets.ownedPetIds.includes(PET.id));
    assert.ok(owned.pets.ownedPetIds.includes(PET.id), 'only a real in-range body succeeds');
  });
});

test('stale epoch pet-action writes nothing, current epoch then succeeds', async () => {
  await withServer(async ({ game, connect }) => {
    const hero = await connect('hero', PROFILE);
    const id = hero.welcome.id;
    placeBody(game, id, PET.campX, PET.campZ);
    hero.send({ type: 'pet-action', action: 'befriend', petId: PET.id, eventId: 'b1', rev: 1 }, 0);
    await hero.wait(m => m.type === 'pet-state' && m.pets.ownedPetIds.includes(PET.id));

    const staleEpoch = 0;
    hero.send({ type: 'travel', destinationId: 'emberworks-deep' }, staleEpoch);
    const firstTravel = await hero.wait(m => m.type === 'destination-changed');
    const midEpoch = firstTravel.worldEpoch;
    assert.ok(Number.isSafeInteger(midEpoch) && midEpoch > staleEpoch, 'travel bumped the epoch');

    hero.send({ type: 'travel', destinationId: 'home-hub' }, midEpoch);
    const secondTravel = await hero.wait(m => m.type === 'destination-changed' && m.worldEpoch > midEpoch);
    const currentEpoch = secondTravel.worldEpoch;
    placeBody(game, id, PET.campX, PET.campZ);
    await hero.wait(m => m.type === 'snapshot'
      && game.simulationFor('home-hub').players.has(id));

    const factsBefore = game.rewards.profileFactsFor(id).length;
    hero.send({ type: 'pet-action', action: 'rest', petId: PET.id, eventId: 'r1', rev: 5 }, staleEpoch);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(game.rewards.profileFactsFor(id).length, factsBefore,
      'a pet-action under a stale world epoch must not mutate durable pet facts');

    hero.send({ type: 'pet-action', action: 'rest', petId: PET.id, eventId: 'r1', rev: 5 }, currentEpoch);
    const rested = await hero.wait(m => m.type === 'pet-state'
      && m.worldEpoch === currentEpoch && m.pets.equippedPetId === null);
    assert.equal(rested.pets.equippedPetId, null, 'the same action at the current epoch succeeds');
  });
});

test('store validator and applyAll reject an invalid pet fact before partial persistence', () => {
  const store = openRewardStore(':memory:');
  try {
    const good = {
      eventId: `pet-owned:${PROFILE}:${PET.id}`, guestId: PROFILE, type: 'pet-owned', value: PET.id,
    };
    const bad = {
      eventId: `pet-owned:${PROFILE}:bogus`, guestId: PROFILE, type: 'pet-owned', value: 'bogus',
      origin: 'client',
    };
    assert.throws(() => store.apply(bad), /refuses client-restored fact/);
    assert.equal(store.profileFactsFor(PROFILE).length, 0);

    assert.throws(() => store.applyAll([good, bad]), /refuses client-restored fact/);
    assert.equal(store.profileFactsFor(PROFILE).length, 0,
      'applyAll validates the whole batch first, persisting none of it on a bad member');

    const { applied } = store.applyAll([good]);
    assert.equal(applied, 1);
    assert.equal(store.profileFactsFor(PROFILE).filter(f => f.type === 'pet-owned').length, 1);
  } finally { store.close(); }
});

test('restore refuses pet-equipped without ownership but accepts owned facts', () => {
  const rewards = createRewardCoordinator({ rewardStorePath: ':memory:' });
  try {
    rewards.join('hero', PROFILE);
    const refusedEquip = rewards.restoreProfileFacts('hero', [{
      eventId: `pet-equip:${PROFILE}:e1`, type: 'pet-equipped', value: PET.id, rev: 1,
    }]);
    assert.equal(refusedEquip.restored, 0);
    assert.equal(refusedEquip.refused, 1, 'equip without ownership is refused');
    assert.equal(rewards.rewardsFor(['hero']).hero.pets.equippedPetId, null);

    const owned = rewards.restoreProfileFacts('hero', [
      { eventId: `pet-owned:${PROFILE}:${PET.id}`, type: 'pet-owned', value: PET.id },
      { eventId: `pet-equip:${PROFILE}:e2`, type: 'pet-equipped', value: PET.id, rev: 1 },
    ]);
    assert.equal(owned.refused, 0, 'restoring ownership alongside equip is accepted');
    assert.equal(rewards.rewardsFor(['hero']).hero.pets.ownedPetIds.includes(PET.id), true);
    assert.equal(rewards.rewardsFor(['hero']).hero.pets.equippedPetId, PET.id);
  } finally { rewards.close(); }
});

test('existing gear/xp remain identical before and after a pet action aside from pets', () => {
  const rewards = createRewardCoordinator({ rewardStorePath: ':memory:' });
  try {
    rewards.join('hero', PROFILE);
    rewards.grantOwnership('hero', WILDWOOD_BLADE_ID);
    rewards.applyEquip('hero', WILDWOOD_BLADE_ID);
    const before = rewards.rewardsFor(['hero']).hero;
    const gearSnapshot = {
      equippedWeaponId: before.equippedWeaponId,
      equippedItemIds: { ...before.equippedItemIds },
      ownedItemIds: [...before.ownedItemIds].sort(),
      coins: before.coins,
      shards: before.shards,
      xp: before.xp,
    };
    rewards.restoreProfileFacts('hero', [
      { eventId: `pet-owned:${PROFILE}:${PET.id}`, type: 'pet-owned', value: PET.id },
      { eventId: `pet-equip:${PROFILE}:e1`, type: 'pet-equipped', value: PET.id, rev: 1 },
    ]);
    const after = rewards.rewardsFor(['hero']).hero;
    assert.equal(after.pets.equippedPetId, PET.id, 'precondition: pets did change');
    assert.equal(after.equippedWeaponId, gearSnapshot.equippedWeaponId);
    assert.notEqual(after.equippedWeaponId, STARTER_SWORD_ID, 'precondition: the earned weapon is equipped');
    assert.deepEqual(after.equippedItemIds, gearSnapshot.equippedItemIds);
    assert.deepEqual([...after.ownedItemIds].sort(), gearSnapshot.ownedItemIds);
    assert.equal(after.coins, gearSnapshot.coins);
    assert.equal(after.shards, gearSnapshot.shards);
    assert.equal(after.xp, gearSnapshot.xp, 'gear and xp are untouched by pet progression');
  } finally { rewards.close(); }
});

test('same-profile reconnect returns pet choices and history', async () => {
  await withServer(async ({ game, connect }) => {
    const first = await connect('first', PROFILE);
    const id = first.welcome.id;
    placeBody(game, id, PET.campX, PET.campZ);
    first.send({ type: 'pet-action', action: 'befriend', petId: PET.id, eventId: 'b1', rev: 1 });
    await first.wait(m => m.type === 'pet-state' && m.pets.ownedPetIds.includes(PET.id));

    const reborn = await connect('reborn', PROFILE);
    const welcome = await reborn.wait(m => m.type === 'welcome');
    const rebornId = welcome.id;
    const rebornPets = welcome.encounter?.rewards?.[rebornId]?.pets;
    assert.ok(rebornPets, 'welcome carries the profile reward block for the new connection');
    assert.ok(rebornPets.ownedPetIds.includes(PET.id),
      'durable pet ownership follows the profile across reconnect');
    assert.equal(rebornPets.equippedPetId, PET.id);
    assert.ok(game.rewards.profileFactsFor(rebornId)
      .some(f => f.type === 'pet-owned' && f.value === PET.id), 'history is present for the profile');
  });
});

// ── the two pet fact types are PRIVATE addressed/companion state, not announcements ──────────────
//
// Corrected classification (superseding an earlier read of the same code): pet-owned/pet-equipped
// belong beside the forge-* family in PRIVATE_PROFILE_FACT_TYPES, not in the announced PROFILE list.
// Nothing in net/gameServer*.mjs's reward-announcement path ever emits them; they are delivered to
// the OWNING profile only, by the private pet-state/welcome/restore path, while a sibling sees at
// most the AGGREGATE `rewards[heroId].pets` block. The two existing integrity tests
// (currency-fact-announcement.mjs's "every profile fact type the coordinator can write" and
// rewards-hud.mjs's "no profile fact type can be added without a reward handler for it") already
// spell out the PRIVATE_PROFILE_FACT_TYPES exclusion; these checks add the pet-specific pins.

test('pet fact types are private addressed facts, never announced reward events', async () => {
  const { PRIVATE_PROFILE_FACT_TYPES, PROFILE_FACT_TYPES } =
    await import('../public/src/progression/facts.js');
  const { REWARD_EVENT_TYPES } = await import('../public/src/rewards/feedback.js');

  for (const type of ['pet-owned', 'pet-equipped']) {
    assert.ok(PRIVATE_PROFILE_FACT_TYPES.includes(type),
      `${type} must be a private addressed fact (pet-state/welcome/restore), not generic profile state`);
    assert.ok(PROFILE_FACT_TYPES.includes(type),
      `${type} must still be durable/recognized as a profile fact`);
    assert.ok(!REWARD_EVENT_TYPES.includes(type),
      `${type} must have no reward-announcement handler: nothing ever announces it`);
  }

  // The announcement sets stay equal to the announced profile facts minus the known private ones --
  // the rule the two existing tests already own; pinned here so adding pet facts cannot loosen it.
  const announced = new Set(REWARD_EVENT_TYPES);
  const unhandled = PROFILE_FACT_TYPES.filter((type) =>
    type !== 'weapon-equipped'
    && type !== 'xp-earned'
    && !PRIVATE_PROFILE_FACT_TYPES.includes(type)
    && !announced.has(type));
  assert.deepEqual(unhandled, [],
    `profile facts with neither an announcement handler nor a PRIVATE classification: ${unhandled.join(', ')}`);
});

test('pets remain recognized durable facts: fold and restore still resolve the same reward shape', () => {
  const rewards = createRewardCoordinator({ rewardStorePath: ':memory:' });
  try {
    rewards.join('hero', PROFILE);
    const restored = rewards.restoreProfileFacts('hero', [
      { eventId: `pet-owned:${PROFILE}:${PET.id}`, type: 'pet-owned', value: PET.id },
      { eventId: `pet-equip:${PROFILE}:e1`, type: 'pet-equipped', value: PET.id, rev: 1 },
    ]);
    assert.equal(restored.refused, 0, 'pets remain client-restorable profile facts for their owner');
    const pets = rewards.rewardsFor(['hero']).hero.pets;
    assert.deepEqual(pets.ownedPetIds, [PET.id]);
    assert.equal(pets.equippedPetId, PET.id);
  } finally { rewards.close(); }
});

test('pet-state never reaches a sibling connection and its history stays out of every snapshot', async () => {
  await withServer(async ({ game, connect }) => {
    const hero = await connect('hero', PROFILE);
    const sibling = await connect('sib', SIBLING_PROFILE);
    const id = hero.welcome.id;
    const siblingId = sibling.welcome.id;

    placeBody(game, id, PET.campX, PET.campZ);
    hero.send({ type: 'pet-action', action: 'befriend', petId: PET.id, eventId: 'b1', rev: 1 });
    await hero.wait(m => m.type === 'pet-state' && m.pets?.ownedPetIds?.includes(PET.id));

    // The sibling observes only the AGGREGATE follower block (its own empty one, and the hero's
    // follower as a count/enum), and NEVER the hero's private pet history facts (pet-owned /
    // pet-equipped rows) on any snapshot or any pet-state message.
    const aggregate = await sibling.wait(m => m.type === 'snapshot'
      && m.encounter?.rewards?.[id]?.pets?.equippedPetId === PET.id);
    assert.ok(aggregate, 'sibling sees the hero\'s aggregate follower');

    assert.ok(hero.messages.some(m => m.type === 'pet-state'
      && m.profileFacts.some(f => f.eventId === `pet-owned:${PROFILE}:${PET.id}`)));
    assert.equal(JSON.stringify(sibling.messages).includes(`pet-owned:${PROFILE}:`), false);
    assert.equal(JSON.stringify(sibling.messages).includes(`pet-equip:${PROFILE}:`), false);
    const siblingEvidence = [...sibling.messages];
    const leaked = siblingEvidence.flatMap((message) => {
      if (message.type === 'snapshot') {
        return Object.values(message.encounter?.rewards ?? {}).flatMap((block) => block?.profileFacts ?? []);
      }
      if (message.type === 'pet-state') return message.profileFacts ?? [];
      return [];
    });
    const heroPetFactsLeaked = leaked.filter((f) =>
      (f?.type === 'pet-owned' || f?.type === 'pet-equipped')
      && f.eventId?.includes(`:${PROFILE}:`));
    assert.deepEqual(heroPetFactsLeaked, [],
      'a sibling connection must never receive the hero\'s private pet history facts');

    assert.ok(sibling.messages.every((m) => m.type !== 'pet-state' || m.id === siblingId),
      'pet-state is addressed only to the connection it belongs to');
  });
});
