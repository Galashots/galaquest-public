// D2: net/rewardStore.mjs -- durable, idempotent Lantern Marks via node:sqlite. Every test here runs
// against a temp db under the OS temp dir (node:os tmpdir()), NEVER the real data/rewards.db -- the
// brief is explicit that the children's save must never be touched by a test run.

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DatabaseSync } from 'node:sqlite';

import { openRewardStore, SCHEMA_VERSION } from '../net/rewardStore.mjs';
import { STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'galaquest-reward-store-'));
}

function markAward(guestId, eventId) {
  return { guestId, heroId: 'p1', type: 'mark-earned', eventId };
}

function equipAward(guestId, itemId, eventId) {
  return { guestId, heroId: 'p1', type: 'weapon-equipped', eventId, value: itemId };
}

function ownAward(guestId, itemId, eventId) {
  return { guestId, heroId: 'p1', type: 'gear-owned', eventId, value: itemId };
}

// GP2: eventId is the PICKUP'S OWN id, not guestId-prefixed -- see net/gameServer.mjs's
// applyLootAward for why (a pickup is globally unique by construction, so its own id already carries
// all the idempotency the durable layer needs).
function coinAward(guestId, pickupId) {
  return { guestId, heroId: 'p1', type: 'coin-earned', eventId: pickupId };
}

function shardAward(guestId, pickupId) {
  return { guestId, heroId: 'p1', type: 'shard-earned', eventId: pickupId };
}

test('applying a mark-earned award makes it count for that guest', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    assert.equal(store.marksFor('guest-a'), 0);
    const result = store.apply(markAward('guest-a', 'mark:guest-a:0'));
    assert.equal(result.applied, true);
    assert.equal(store.marksFor('guest-a'), 1);
  } finally {
    store.close();
    // maxRetries/retryDelay: Windows can hold a just-closed SQLite file handle open slightly longer
    // than close() takes to return; plain rmSync's EPERM here is a timing artifact, not a real bug.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// The roadmap's stop-when, proven at the store level: a forced double-apply of the same eventId is a
// no-op, not a double-count. This is the mechanism that makes an idempotency key meaningful at all.
test('double-apply of the same eventId leaves the count unchanged', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    const award = markAward('guest-a', 'mark:guest-a:0');
    const first = store.apply(award);
    const second = store.apply(award);
    assert.equal(first.applied, true, 'the first apply should record the event');
    assert.equal(second.applied, false, 'the second, identical apply must be a no-op');
    assert.equal(store.marksFor('guest-a'), 1, 'a forced double-apply must not double-count');
  } finally {
    store.close();
    // maxRetries/retryDelay: Windows can hold a just-closed SQLite file handle open slightly longer
    // than close() takes to return; plain rmSync's EPERM here is a timing artifact, not a real bug.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('two different guests are counted independently', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    store.apply(markAward('guest-a', 'mark:guest-a:0'));
    store.apply(markAward('guest-b', 'mark:guest-b:0'));
    store.apply(markAward('guest-b', 'mark:guest-b:1'));
    assert.equal(store.marksFor('guest-a'), 1);
    assert.equal(store.marksFor('guest-b'), 2);
  } finally {
    store.close();
    // maxRetries/retryDelay: Windows can hold a just-closed SQLite file handle open slightly longer
    // than close() takes to return; plain rmSync's EPERM here is a timing artifact, not a real bug.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('unlockedFor is false until a lantern-unlocked award is applied, then stays true', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    assert.equal(store.unlockedFor('guest-a'), false);
    store.apply({ guestId: 'guest-a', heroId: 'p1', type: 'lantern-unlocked', eventId: 'lantern:guest-a' });
    assert.equal(store.unlockedFor('guest-a'), true);
  } finally {
    store.close();
    // maxRetries/retryDelay: Windows can hold a just-closed SQLite file handle open slightly longer
    // than close() takes to return; plain rmSync's EPERM here is a timing artifact, not a real bug.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('close then reopen the same path preserves counts', () => {
  const dir = tempDir();
  const path = join(dir, 'rewards.db');
  try {
    const store1 = openRewardStore(path);
    store1.apply(markAward('guest-a', 'mark:guest-a:0'));
    store1.apply(markAward('guest-a', 'mark:guest-a:1'));
    store1.close();

    const store2 = openRewardStore(path);
    assert.equal(store2.marksFor('guest-a'), 2, 'counts must survive a close and reopen');
    store2.close();
  } finally {
    // maxRetries/retryDelay: Windows can hold a just-closed SQLite file handle open slightly longer
    // than close() takes to return; plain rmSync's EPERM here is a timing artifact, not a real bug.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// Roadmap ruling: a timestamped copy on server start. Reopening a path that already has data on
// disk must leave a backup-<stamp>.db beside it before anything else touches the file.
test('opening an existing db file writes a timestamped backup beside it first', () => {
  const dir = tempDir();
  const path = join(dir, 'rewards.db');
  try {
    const store1 = openRewardStore(path);
    store1.apply(markAward('guest-a', 'mark:guest-a:0'));
    store1.close();

    const beforeReopen = readdirSync(dir).filter((name) => name.startsWith('backup-'));
    assert.deepEqual(beforeReopen, [], 'no backup yet -- the file did not exist before the first open');

    const store2 = openRewardStore(path);
    store2.close();

    const backups = readdirSync(dir).filter((name) => name.startsWith('backup-') && name.endsWith('.db'));
    assert.equal(backups.length, 1, `expected exactly one backup file, found ${JSON.stringify(backups)}`);
  } finally {
    // maxRetries/retryDelay: Windows can hold a just-closed SQLite file handle open slightly longer
    // than close() takes to return; plain rmSync's EPERM here is a timing artifact, not a real bug.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// A corrupt file must fail loudly rather than silently starting a fresh save over the top of it --
// that would look like the children's marks were simply lost, with no error anywhere.
test('a corrupt db file fails loudly at open rather than silently starting fresh', () => {
  const dir = tempDir();
  const path = join(dir, 'rewards.db');
  writeFileSync(path, 'this is not a sqlite database, just garbage bytes');
  try {
    assert.throws(() => openRewardStore(path), /reward store/i,
      'a corrupt file must throw a clear, nameable error');
  } finally {
    // maxRetries/retryDelay: Windows can hold a just-closed SQLite file handle open slightly longer
    // than close() takes to return; plain rmSync's EPERM here is a timing artifact, not a real bug.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('apply() rejects an award with no guestId -- the store never silently drops a guest-scoped award', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    assert.throws(() => store.apply({ heroId: 'p1', type: 'mark-earned', eventId: 'mark:x:0' }));
  } finally {
    store.close();
    // maxRetries/retryDelay: Windows can hold a just-closed SQLite file handle open slightly longer
    // than close() takes to return; plain rmSync's EPERM here is a timing artifact, not a real bug.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('equippedWeaponFor is null until an equip award lands, then reads the equipped item', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    assert.equal(store.equippedWeaponFor('guest-a'), null);
    store.apply(equipAward('guest-a', WILDWOOD_BLADE_ID, 'equip:guest-a:1'));
    assert.equal(store.equippedWeaponFor('guest-a'), WILDWOOD_BLADE_ID);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('equipping is a choice, not an accumulation: the LATEST event wins, not the count', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    store.apply(equipAward('guest-a', WILDWOOD_BLADE_ID, 'equip:guest-a:1'));
    store.apply(equipAward('guest-a', STARTER_SWORD_ID, 'equip:guest-a:2'));
    assert.equal(store.equippedWeaponFor('guest-a'), STARTER_SWORD_ID, 'switching back must actually switch back');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('GP1-C1: ownedItemIdsFor is empty until a gear-owned award lands', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    assert.deepEqual(store.ownedItemIdsFor('guest-a'), []);
    store.apply(ownAward('guest-a', WILDWOOD_BLADE_ID, 'own:guest-a:1'));
    assert.deepEqual(store.ownedItemIdsFor('guest-a'), [WILDWOOD_BLADE_ID]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('GP1-C1: ownedItemIdsFor never includes the starter sword -- that is prepended by the caller', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    store.apply(ownAward('guest-a', WILDWOOD_BLADE_ID, 'own:guest-a:1'));
    assert.ok(!store.ownedItemIdsFor('guest-a').includes(STARTER_SWORD_ID),
      'the store only records durable GRANTS -- everyone owning the starter sword is a rule, not an event');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('GP1-C1: apply() refuses a gear-owned award naming an item nobody defined', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    assert.throws(
      () => store.apply(ownAward('guest-a', 'not-a-real-item', 'own:guest-a:1')),
      /unknown item id/i,
    );
    assert.deepEqual(store.ownedItemIdsFor('guest-a'), []);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('GP1-C1: ownership survives a close and reopen, the same durability guarantee marks have', () => {
  const dir = tempDir();
  const path = join(dir, 'rewards.db');
  try {
    const store1 = openRewardStore(path);
    store1.apply(ownAward('guest-a', WILDWOOD_BLADE_ID, 'own:guest-a:1'));
    store1.close();

    const store2 = openRewardStore(path);
    assert.deepEqual(store2.ownedItemIdsFor('guest-a'), [WILDWOOD_BLADE_ID]);
    store2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('apply() refuses a weapon-equipped award naming an item nobody defined', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    assert.throws(
      () => store.apply(equipAward('guest-a', 'not-a-real-weapon', 'equip:guest-a:1')),
      /unknown weapon id/i,
    );
    assert.equal(store.equippedWeaponFor('guest-a'), null, 'a rejected apply must not have written anything');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('apply() still refuses a wholly unknown award type', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    assert.throws(
      () => store.apply({ guestId: 'guest-a', heroId: 'p1', type: 'not-a-real-type', eventId: 'x:1' }),
      /unknown award type/i,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// A store from before GP1 has no `value` column at all. Building one directly with node:sqlite --
// not by hand-editing openRewardStore's own schema constant, which would prove nothing about a REAL
// old file -- and confirming the marks it already carried survive the migration untouched.
test('a v1 store (marks/lantern only, no value column) migrates in place and keeps its marks', () => {
  const dir = tempDir();
  const path = join(dir, 'rewards.db');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE reward_events (
        id TEXT PRIMARY KEY,
        guest_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    legacy.exec('PRAGMA user_version = 1;');
    legacy.prepare('INSERT INTO reward_events (id, guest_id, type, created_at) VALUES (?, ?, ?, ?)')
      .run('mark:guest-a:0', 'guest-a', 'mark-earned', new Date().toISOString());
    legacy.close();

    const store = openRewardStore(path);
    assert.equal(store.marksFor('guest-a'), 1, 'a pre-existing mark must survive the v1 -> v2 migration');
    assert.equal(store.equippedWeaponFor('guest-a'), null, 'no equip has ever happened for this guest');
    store.apply(equipAward('guest-a', WILDWOOD_BLADE_ID, 'equip:guest-a:1'));
    assert.equal(store.equippedWeaponFor('guest-a'), WILDWOOD_BLADE_ID);
    store.close();

    const reread = new DatabaseSync(path);
    assert.equal(reread.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    reread.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('an interrupted v1 -> v2 migration with value already added finishes instead of retrying ALTER', () => {
  const dir = tempDir();
  const path = join(dir, 'rewards.db');
  try {
    // Exact crash window from the old migration: ALTER TABLE committed, then the process died before
    // PRAGMA user_version advanced. SQLite therefore reports version 1 even though the v2 column is
    // already present. Reopening must repair the version marker, not throw "duplicate column".
    const interrupted = new DatabaseSync(path);
    interrupted.exec(`
      CREATE TABLE reward_events (
        id TEXT PRIMARY KEY,
        guest_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        value TEXT
      );
    `);
    interrupted.exec('PRAGMA user_version = 1;');
    interrupted.prepare(
      'INSERT INTO reward_events (id, guest_id, type, created_at, value) VALUES (?, ?, ?, ?, ?)',
    ).run('equip:guest-a:old', 'guest-a', 'weapon-equipped', new Date().toISOString(), WILDWOOD_BLADE_ID);
    interrupted.close();

    const store = openRewardStore(path);
    assert.equal(store.equippedWeaponFor('guest-a'), WILDWOOD_BLADE_ID);
    store.close();

    const reread = new DatabaseSync(path);
    assert.equal(reread.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    const valueColumns = reread.prepare('PRAGMA table_info(reward_events)').all()
      .filter((row) => row.name === 'value');
    assert.equal(valueColumns.length, 1, 'the repair must not add a second value column');
    reread.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ── GP2: coins and Wildwood Shards ─────────────────────────────────────────────────────────────

test('coinsFor/shardsFor are 0 until an award lands, and count independently of marks', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    assert.equal(store.coinsFor('guest-a'), 0);
    assert.equal(store.shardsFor('guest-a'), 0);
    store.apply(coinAward('guest-a', 'cart-loot:coin:0'));
    store.apply(shardAward('guest-a', 'cart-loot:shard:0'));
    store.apply(markAward('guest-a', 'mark:guest-a:0'));
    assert.equal(store.coinsFor('guest-a'), 1);
    assert.equal(store.shardsFor('guest-a'), 1);
    assert.equal(store.marksFor('guest-a'), 1, 'coins/shards must not leak into the mark count or vice versa');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('GP2: a pickup\'s eventId is globally unique -- crediting it to a SECOND guest is refused, not double-applied', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    const first = store.apply(coinAward('guest-a', 'cart-loot:coin:0'));
    assert.equal(first.applied, true);
    // The exact defect this guards against: two players racing the same physical pickup. The
    // simulation layer (world/cartLoot.js) is what is SUPPOSED to prevent this from ever being
    // attempted twice -- this proves the durable store refuses it independently, as a second line
    // of defence, even if that guarantee were somehow bypassed upstream.
    const second = store.apply(coinAward('guest-b', 'cart-loot:coin:0'));
    assert.equal(second.applied, false, 'the same physical coin must not be creditable to a second guest');
    assert.equal(store.coinsFor('guest-a'), 1);
    assert.equal(store.coinsFor('guest-b'), 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('GP2: reconnect/retry cannot re-award the same pickup -- a resent apply() is a clean no-op', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    store.apply(coinAward('guest-a', 'cart-loot:coin:0'));
    // A reconnecting client's own retried request, or a duplicate server-side attempt after a
    // dropped ack -- same eventId, same guest, must still be refused.
    const replay = store.apply(coinAward('guest-a', 'cart-loot:coin:0'));
    assert.equal(replay.applied, false);
    assert.equal(store.coinsFor('guest-a'), 1, 'a replay must not double-credit the same guest either');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('GP2: coins and shards survive a close and reopen, the same durability guarantee marks have', () => {
  const dir = tempDir();
  const path = join(dir, 'rewards.db');
  try {
    const store1 = openRewardStore(path);
    store1.apply(coinAward('guest-a', 'cart-loot:coin:0'));
    store1.apply(coinAward('guest-a', 'cart-loot:coin:1'));
    store1.apply(shardAward('guest-a', 'cart-loot:shard:0'));
    store1.close();

    const store2 = openRewardStore(path);
    assert.equal(store2.coinsFor('guest-a'), 2, 'coin count must survive a close and reopen');
    assert.equal(store2.shardsFor('guest-a'), 1, 'shard count must survive a close and reopen');
    store2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ── GP3-0: creditedLootIds -- the restart-coherence read ────────────────────────────────────────

test('creditedLootIds is empty until a coin or shard is credited to anyone', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    assert.deepEqual(store.creditedLootIds(), []);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('creditedLootIds is NOT guest-scoped -- it reports pickups credited to every guest, pooled', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    store.apply(coinAward('guest-a', 'cart-loot:coin:0'));
    store.apply(shardAward('guest-b', 'cart-loot:shard:0'));
    store.apply(markAward('guest-a', 'mark:guest-a:0'));
    assert.deepEqual(
      [...store.creditedLootIds()].sort(),
      ['cart-loot:coin:0', 'cart-loot:shard:0'],
      'mark-earned rows must not leak in, and both guests\' pickups must both be present',
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ── GP3-1: Village Supplies (shared totals) and Workshop I ownership ────────────────────────────

test('totalCoinsEarned/totalShardsEarned sum across ALL guests, unlike coinsFor/shardsFor', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    assert.equal(store.totalCoinsEarned(), 0);
    assert.equal(store.totalShardsEarned(), 0);
    store.apply(coinAward('guest-a', 'cart-loot:coin:0'));
    store.apply(coinAward('guest-b', 'cart-loot:coin:1'));
    store.apply(shardAward('guest-a', 'cart-loot:shard:0'));
    assert.equal(store.totalCoinsEarned(), 2, 'both guests\' coins count toward the shared total');
    assert.equal(store.totalShardsEarned(), 1);
    // The per-guest reads stay exactly what they always were -- this is an ADDITIONAL shared view,
    // not a replacement for the personal-provenance one.
    assert.equal(store.coinsFor('guest-a'), 1);
    assert.equal(store.coinsFor('guest-b'), 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('villageUpgradeOwned is false until the exact upgrade eventId is durably applied', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    assert.equal(store.villageUpgradeOwned('village-upgrade:workshop:1'), false);
    const result = store.apply({
      guestId: 'guest-a', type: 'village-upgrade', eventId: 'village-upgrade:workshop:1', value: null,
    });
    assert.equal(result.applied, true);
    assert.equal(store.villageUpgradeOwned('village-upgrade:workshop:1'), true);
    // A DIFFERENT (future) upgrade id is still unowned -- ownership is per-id, not a single flag.
    assert.equal(store.villageUpgradeOwned('village-upgrade:library:1'), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a village-upgrade purchase is intrinsically idempotent -- a second apply() for the same id is refused', () => {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    const first = store.apply({
      guestId: 'guest-a', type: 'village-upgrade', eventId: 'village-upgrade:workshop:1', value: null,
    });
    assert.equal(first.applied, true);
    // A different guest (the sibling) racing the same purchase -- same posture the GP2 pickup
    // idempotency test above takes for a physical coin: the SECOND apply(), whoever sends it, is a
    // clean no-op, not a double-buy.
    const second = store.apply({
      guestId: 'guest-b', type: 'village-upgrade', eventId: 'village-upgrade:workshop:1', value: null,
    });
    assert.equal(second.applied, false, 'the same upgrade must not be buyable twice, even by a different guest');
    assert.equal(store.villageUpgradeOwned('village-upgrade:workshop:1'), true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('Village Supplies totals and Workshop I ownership survive a close and reopen', () => {
  const dir = tempDir();
  const path = join(dir, 'rewards.db');
  try {
    const store1 = openRewardStore(path);
    store1.apply(coinAward('guest-a', 'cart-loot:coin:0'));
    store1.apply(coinAward('guest-a', 'cart-loot:coin:1'));
    store1.apply(coinAward('guest-a', 'cart-loot:coin:2'));
    store1.apply(shardAward('guest-a', 'cart-loot:shard:0'));
    store1.apply(shardAward('guest-a', 'cart-loot:shard:1'));
    store1.apply({
      guestId: 'guest-a', type: 'village-upgrade', eventId: 'village-upgrade:workshop:1', value: null,
    });
    store1.close();

    const store2 = openRewardStore(path);
    assert.equal(store2.totalCoinsEarned(), 3);
    assert.equal(store2.totalShardsEarned(), 2);
    assert.equal(store2.villageUpgradeOwned('village-upgrade:workshop:1'), true);
    store2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('the db file actually exists on disk after opening', () => {
  const dir = tempDir();
  const path = join(dir, 'rewards.db');
  const store = openRewardStore(path);
  try {
    assert.ok(existsSync(path));
  } finally {
    store.close();
    // maxRetries/retryDelay: Windows can hold a just-closed SQLite file handle open slightly longer
    // than close() takes to return; plain rmSync's EPERM here is a timing artifact, not a real bug.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
