import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createRewardCoordinator } from '../net/gameServer.mjs';
import { openRewardStore } from '../net/rewardStore.mjs';
import { isClientRestorableProfileFact } from '../public/src/progression/facts.js';
import {
  HELMET_SILVERGUARD_ID,
  WILDWOOD_BLADE_ID,
} from '../public/src/progression/items.js';
import {
  CART_LOOT_TABLE,
  pickupWorldPosition,
  requestCollectLoot,
  requestSearchCart,
  restoreCartLootState,
} from '../public/src/world/cartLoot.js';

const ATTACKER = 'p-h1-attacker';
const SIBLING = 'p-h1-sibling';

function tempStorePath() {
  const directory = mkdtempSync(join(tmpdir(), 'gq-h1-restore-'));
  return {
    directory,
    path: join(directory, 'rewards.db'),
    cleanup: () => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

function xpFact(eventId, value = '1') {
  return { eventId, type: 'xp-earned', value };
}

test('H1 recovery authority refuses shared-world and cross-profile event namespaces', () => {
  assert.equal(isClientRestorableProfileFact(xpFact('xp:device:one'), ATTACKER), true);
  assert.equal(isClientRestorableProfileFact({ eventId: 'device:coin', type: 'coin-earned' }, ATTACKER), false);
  assert.equal(isClientRestorableProfileFact({ eventId: 'device:shard', type: 'shard-earned' }, ATTACKER), false);
  assert.equal(
    isClientRestorableProfileFact({
      eventId: `own:${ATTACKER}:${WILDWOOD_BLADE_ID}`, type: 'gear-owned', value: WILDWOOD_BLADE_ID,
    }, ATTACKER),
    true,
  );
  assert.equal(
    isClientRestorableProfileFact({
      eventId: `own:${SIBLING}:${WILDWOOD_BLADE_ID}`, type: 'gear-owned', value: WILDWOOD_BLADE_ID,
    }, ATTACKER),
    false,
  );
  assert.equal(isClientRestorableProfileFact(xpFact(`xp:lantern:${SIBLING}`), ATTACKER), false);
  assert.equal(
    isClientRestorableProfileFact({ eventId: 'mark:offline-hero:device-life', type: 'mark-earned' }, ATTACKER),
    true,
    'offline marks have no server profile identity yet and remain recoverable',
  );

  for (const eventId of [
    'cart-loot:coin:0',
    'hollow-cache:p-h1-attacker:1',
    'village-upgrade:workshop:1',
    'beacon-lit:old-beacon',
  ]) {
    assert.equal(
      isClientRestorableProfileFact(xpFact(eventId), ATTACKER),
      false,
      `${eventId} is reserved for server-authored shared-world state`,
    );
  }
});

test('H1 reward store independently refuses client-origin world authority and shared-world ID reservation', () => {
  const fixture = tempStorePath();
  const store = openRewardStore(fixture.path);
  try {
    assert.throws(
      () => store.apply({
        guestId: ATTACKER, type: 'coin-earned', eventId: 'device:coin', origin: 'client',
      }),
      /client-restored fact/i,
    );
    assert.throws(
      () => store.apply({
        guestId: ATTACKER, type: 'xp-earned', eventId: 'cart-loot:coin:0', value: '1', origin: 'client',
      }),
      /client-restored fact/i,
    );

    const serverAward = store.apply({
      guestId: SIBLING, type: 'coin-earned', eventId: 'cart-loot:coin:0',
    });
    assert.equal(serverAward.applied, true, 'a legitimate server award still owns the shared event identity');
  } finally {
    store.close();
    fixture.cleanup();
  }
});

test('H1 shared-world reads ignore legacy client-origin currency rows', () => {
  const fixture = tempStorePath();
  const seed = openRewardStore(fixture.path);
  seed.close();

  const db = new DatabaseSync(fixture.path);
  db.prepare(
    'INSERT INTO reward_events (id, guest_id, type, created_at, value, rev, origin) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('legacy-client-coin', ATTACKER, 'coin-earned', new Date().toISOString(), null, null, 'client');
  db.prepare(
    'INSERT INTO reward_events (id, guest_id, type, created_at, value, rev, origin) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('legacy-client-shard', ATTACKER, 'shard-earned', new Date().toISOString(), null, null, 'client');
  db.close();

  const store = openRewardStore(fixture.path);
  try {
    assert.equal(store.coinsFor(ATTACKER), 1, 'legacy personal provenance is still readable as personal data');
    assert.equal(store.shardsFor(ATTACKER), 1);
    assert.deepEqual(store.creditedLootIds(), [], 'client rows cannot mark shared physical loot as spent');
    assert.equal(store.totalCoinsEarned(), 0, 'client rows cannot inflate communal Village coins');
    assert.equal(store.totalShardsEarned(), 0, 'client rows cannot inflate communal Village shards');
  } finally {
    store.close();
    fixture.cleanup();
  }
});

test('H1 legitimate local-first profile recovery remains exactly-once and sibling-isolated', () => {
  const fixture = tempStorePath();
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-a', ATTACKER);
    rewards.join('hero-b', SIBLING);

    const facts = [
      { eventId: 'mark:offline-hero:device-one', type: 'mark-earned' },
      { eventId: `lantern-unlocked:${ATTACKER}`, type: 'lantern-unlocked' },
      xpFact(`xp:lantern-unlocked:${ATTACKER}`, '100'),
      { eventId: `own:${ATTACKER}:${WILDWOOD_BLADE_ID}`, type: 'gear-owned', value: WILDWOOD_BLADE_ID },
      { eventId: `equip:${ATTACKER}:10:device-weapon`, type: 'weapon-equipped', value: WILDWOOD_BLADE_ID, rev: 10 },
      { eventId: `own:${ATTACKER}:${HELMET_SILVERGUARD_ID}`, type: 'gear-owned', value: HELMET_SILVERGUARD_ID },
      { eventId: `equip:${ATTACKER}:11:device-helmet`, type: 'gear-equipped', value: HELMET_SILVERGUARD_ID, rev: 11 },
      { eventId: `satchel:${ATTACKER}`, type: 'satchel-taken' },
      { eventId: `charm:${ATTACKER}`, type: 'charm-earned' },
      xpFact('xp:malformed', '-5'),
      { eventId: 'device:coin', type: 'coin-earned' },
      xpFact('village-upgrade:workshop:1', '1'),
    ];

    assert.deepEqual(rewards.restoreProfileFacts('hero-a', facts), { restored: 9, refused: 3 });
    assert.deepEqual(
      rewards.restoreProfileFacts('hero-a', facts),
      { restored: 0, refused: 3 },
      'replaying the same journal is exactly-once while refused rows stay refused',
    );

    const own = rewards.rewardsFor(['hero-a', 'hero-b']);
    assert.equal(own['hero-a'].marks, 1);
    assert.equal(own['hero-a'].lanternUnlocked, true);
    assert.equal(own['hero-a'].xp, 100);
    assert.ok(own['hero-a'].ownedItemIds.includes(WILDWOOD_BLADE_ID));
    assert.ok(own['hero-a'].ownedItemIds.includes(HELMET_SILVERGUARD_ID));
    assert.equal(own['hero-a'].equippedWeaponId, WILDWOOD_BLADE_ID);
    assert.equal(own['hero-a'].equippedItemIds.helmet, HELMET_SILVERGUARD_ID);
    assert.equal(own['hero-a'].satchelCarried, true);
    assert.equal(own['hero-a'].charmOwned, true);

    assert.equal(own['hero-b'].marks, 0, 'sibling marks stay isolated');
    assert.equal(own['hero-b'].xp, 0, 'sibling XP stays isolated');
    assert.ok(!own['hero-b'].ownedItemIds.includes(WILDWOOD_BLADE_ID), 'sibling ownership stays isolated');
    assert.equal(own['hero-b'].equippedItemIds.helmet, undefined, 'sibling equipment stays isolated');
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});

test('H1 refused currency restore cannot alter shared Village state or spent-loot state', () => {
  const fixture = tempStorePath();
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-a', ATTACKER);
    assert.deepEqual(rewards.restoreProfileFacts('hero-a', [
      { eventId: 'device:coin', type: 'coin-earned' },
      { eventId: 'device:shard', type: 'shard-earned' },
    ]), { restored: 0, refused: 2 });

    assert.deepEqual(rewards.villageSnapshot(), { coins: 0, shards: 0, workshopOwned: false });
    assert.deepEqual(rewards.creditedLootIds(), []);
    const personal = rewards.rewardsFor(['hero-a'])['hero-a'];
    assert.equal(personal.coins, 0);
    assert.equal(personal.shards, 0);
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});

test('H1 cross-type cart ID attack survives restart as collectible loot and the real server award succeeds', () => {
  const fixture = tempStorePath();
  const pickup = CART_LOOT_TABLE[0];

  const first = createRewardCoordinator({ rewardStorePath: fixture.path });
  first.join('hero-a', ATTACKER);
  assert.deepEqual(
    first.restoreProfileFacts('hero-a', [xpFact(pickup.id, '1')]),
    { restored: 0, refused: 1 },
    'an otherwise-valid XP fact cannot reserve a cart-loot identity',
  );
  first.close();

  const restarted = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    restarted.join('hero-b', SIBLING);
    assert.deepEqual(restarted.creditedLootIds(), [], 'restart must not resurrect the rejected attack as spent loot');

    let loot = restoreCartLootState(restarted.creditedLootIds());
    loot = requestSearchCart(loot);
    const collected = requestCollectLoot(loot, 'hero-b', pickup.id, pickupWorldPosition(pickup));
    assert.equal(collected.accepted, true, 'the physical pickup must still be collectible after restart');

    const facts = restarted.applyLootAward('hero-b', pickup.id, pickup.kind);
    assert.equal(facts.length, 1, 'the real server-authored pickup award must still be writable');
    assert.equal(facts[0].eventId, pickup.id);
    assert.deepEqual(restarted.creditedLootIds(), [pickup.id]);
    assert.equal(restarted.villageSnapshot().coins, 1, 'the legitimate award, not the attacker, funds the shared Village');
  } finally {
    restarted.close();
    fixture.cleanup();
  }
});

test('H1 reward store independently rejects cross-profile client identity reservation', () => {
  const fixture = tempStorePath();
  const store = openRewardStore(fixture.path);
  try {
    const siblingOwnId = `own:${SIBLING}:${WILDWOOD_BLADE_ID}`;
    assert.throws(
      () => store.apply({
        guestId: ATTACKER, type: 'xp-earned', eventId: siblingOwnId, value: '1', origin: 'client',
      }),
      /client-restored fact/i,
    );
    const serverAward = store.apply({
      guestId: SIBLING, type: 'gear-owned', eventId: siblingOwnId, value: WILDWOOD_BLADE_ID,
    });
    assert.equal(serverAward.applied, true, 'the rightful profile server award must still own its id');
  } finally {
    store.close();
    fixture.cleanup();
  }
});

test('H1 one profile cannot reserve another profile server-authored personal identities', () => {
  const fixture = tempStorePath();
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-a', ATTACKER);
    rewards.join('hero-b', SIBLING);

    const siblingOwnId = `own:${SIBLING}:${WILDWOOD_BLADE_ID}`;
    const siblingCharmId = `charm:${SIBLING}`;
    const siblingLanternXpId = `xp:lantern:${SIBLING}`;
    assert.deepEqual(rewards.restoreProfileFacts('hero-a', [
      xpFact(siblingOwnId),
      { eventId: siblingCharmId, type: 'charm-earned' },
      xpFact(siblingLanternXpId, '100'),
    ]), { restored: 0, refused: 3 });

    const blade = rewards.claimWildwoodBlade('hero-b');
    assert.equal(blade.granted, true, 'the sibling legitimate Blade award must not be poisoned');
    assert.equal(blade.facts[0]?.eventId, siblingOwnId);
    const charm = rewards.claimCharm('hero-b');
    assert.equal(charm.granted, true, 'the sibling legitimate Charm award must not be poisoned');
    assert.equal(charm.facts[0]?.eventId, siblingCharmId);
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});

test('H1 rightful profile restores its own server-announced personal identities exactly once', () => {
  const fixture = tempStorePath();
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-b', SIBLING);
    const facts = [
      { eventId: `mark:${SIBLING}:server-life`, type: 'mark-earned' },
      { eventId: `lantern:${SIBLING}`, type: 'lantern-unlocked' },
      xpFact(`xp:lantern:${SIBLING}`, '100'),
      { eventId: `own:${SIBLING}:${WILDWOOD_BLADE_ID}`, type: 'gear-owned', value: WILDWOOD_BLADE_ID },
      {
        eventId: `equip:${SIBLING}:1700000000000:device`,
        type: 'weapon-equipped',
        value: WILDWOOD_BLADE_ID,
        rev: 1_700_000_000_000,
      },
      { eventId: `satchel:${SIBLING}`, type: 'satchel-taken' },
      { eventId: `charm:${SIBLING}`, type: 'charm-earned' },
    ];

    assert.deepEqual(rewards.restoreProfileFacts('hero-b', facts), { restored: 7, refused: 0 });
    assert.deepEqual(rewards.restoreProfileFacts('hero-b', facts), { restored: 0, refused: 0 });

    const own = rewards.rewardsFor(['hero-b'])['hero-b'];
    assert.equal(own.marks, 1);
    assert.equal(own.lanternUnlocked, true);
    assert.equal(own.xp, 100);
    assert.ok(own.ownedItemIds.includes(WILDWOOD_BLADE_ID));
    assert.equal(own.equippedWeaponId, WILDWOOD_BLADE_ID);
    assert.equal(own.satchelCarried, true);
    assert.equal(own.charmOwned, true);
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});
