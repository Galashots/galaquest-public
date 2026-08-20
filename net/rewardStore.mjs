// D2: durable, idempotent Lantern Marks. node:sqlite -- a node: builtin, so this stays inside the
// zero-npm rule (README "Rules that are not preferences") without a single import changing shape.
//
// The append-only event table IS the mechanism (roadmap "Forward compatibility for XP" ruling): marks
// and unlock state are never stored as a mutable counter, only ever DERIVED by counting rows. That is
// what makes a forced double-apply of the same eventId a true no-op rather than a bug that happens
// not to trigger today -- the PRIMARY KEY on `id` plus `INSERT OR IGNORE` is the actual enforcement,
// not a hand-rolled "have I seen this id" check that could drift from what the table itself allows.
//
// Custody (roadmap "Save-data custody" ruling): data/ is a tracked directory (see data/README.md);
// the .db files themselves are gitignored (data/*.db*, covering -wal/-shm). Every real run's store
// lives at data/rewards.db; every test's store lives under the OS temp dir -- never here.

import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isKnownItem, isKnownWeapon } from '../public/src/progression/items.js';

// v2, GP1: one nullable `value` column added for 'weapon-equipped' events, which need to carry
// WHICH weapon rather than just count -- the mark/lantern events only ever needed COUNT, so the
// column did not exist until an event type needed a payload. A v1 store ALTERs in place (below);
// a fresh store creates the v2 shape directly, so there is exactly one column layout to reason
// about once a store has ever been opened under this code.
export const SCHEMA_VERSION = 2;

function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    work();
    db.exec('COMMIT;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch { /* the failing statement may already have aborted it */ }
    throw error;
  }
}

function isoStamp() {
  // Filesystem-safe: ':' and '.' are awkward in Windows paths, so this reads
  // 2026-08-13T12-34-56-789Z rather than the raw ISO string.
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Roadmap ruling: a timestamped copy on server start. Only fires when the target file already
 * exists -- a brand-new store has nothing to lose, so a fresh boot never litters the directory with
 * an empty backup of nothing.
 */
function backupIfExists(path) {
  if (!existsSync(path)) return null;
  const backupPath = join(dirname(path), `backup-${isoStamp()}.db`);
  copyFileSync(path, backupPath);
  return backupPath;
}

/**
 * @param path  where the store lives. Real runs: data/rewards.db. Tests: an OS-temp path, always.
 * @returns { apply(award), marksFor(guestId), unlockedFor(guestId), backupPath, close() }
 */
export function openRewardStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const backupPath = backupIfExists(path);

  let db;
  try {
    db = new DatabaseSync(path);
    // Without this BEFORE the very first real query, a second process touching the SAME file (a
    // backup script, a harness seeding a fixture guest -- see tools/runtime-test/drive-village-
    // board.mjs and drive-cart-loot.mjs) can make a concurrent read throw "database is locked"
    // (SQLITE_BUSY) INSTEAD of just waiting the brief moment the other process's write actually
    // takes. Found the hard way, twice: first as net/gameServer.mjs's 10Hz snapshot timer calling
    // villageSnapshot() -> this store, uncaught in a setInterval callback, crashing the ENTIRE server
    // process -- fixed by adding this PRAGMA, but placed AFTER the corruption-check query below,
    // which left that one query still unprotected. Reproduced a second time, deterministically, by
    // drive-cart-loot.mjs's own harness-side seedUnlockedGuest racing an owned server's startup open
    // of the identical fresh store: the corruption-check probe itself is a real query against the
    // file, so it needs the SAME protection every other query already gets. PRAGMA busy_timeout is a
    // per-connection, in-memory setting -- it never touches the file itself, so setting it
    // immediately after DatabaseSync's own constructor is always safe, corrupt file or not. 5s is
    // generous relative to how long a single INSERT OR IGNORE actually holds the write lock
    // (milliseconds); it exists to absorb contention, not to mask a real deadlock -- a genuine hang
    // still surfaces as a timeout, just a 5-second one instead of an instant crash.
    db.exec('PRAGMA busy_timeout = 5000;');
    // SQLite opens a garbage file without complaint -- corruption is only proven by touching it.
    // Forcing that touch HERE, at open, is what turns "a corrupt save silently looks like a fresh
    // one three queries from now" into a loud, immediate, nameable failure.
    db.exec('PRAGMA schema_version;');
  } catch (error) {
    // Release the file handle DatabaseSync already opened before rethrowing -- on Windows an open
    // handle on a "corrupt" file blocks even deleting the temp directory it lives in, which a test
    // for exactly this path discovered the hard way.
    try { db?.close(); } catch { /* already unusable; nothing more to release */ }
    throw new Error(`reward store at ${path} is unreadable (corrupt, or not a SQLite database): ${error.message}`);
  }

  // PRAGMA user_version IS the schema version record (brief D2: "Record schema version"). 0 is
  // SQLite's own default for a file that has never had it set, which is indistinguishable from "this
  // store has no tables yet" -- exactly the fresh-file case this branch creates the schema for.
  const versionRow = db.prepare('PRAGMA user_version').get();
  const currentVersion = versionRow.user_version;
  if (currentVersion === 0) {
    transaction(db, () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS reward_events (
          id TEXT PRIMARY KEY,
          guest_id TEXT NOT NULL,
          type TEXT NOT NULL,
          created_at TEXT NOT NULL,
          value TEXT
        );
      `);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    });
  } else if (currentVersion === 1) {
    // A real v1 store (marks/lantern-unlocked only, no value column) from before GP1. ALTER, not
    // recreate -- every existing mark/lantern row is untouched, `value` reads NULL for all of them,
    // which is exactly right: they never had a payload. The column check also repairs the precise
    // interrupted-migration state where ALTER committed but the old two-statement migration crashed
    // before user_version advanced: retrying that state must finish, not fail on a duplicate column.
    transaction(db, () => {
      // Read the table shape only AFTER BEGIN IMMEDIATE has acquired the migration lock. Reading it
      // beforehand creates a classic check-then-act race: two processes can both observe a v1 table
      // without `value`, then one migrates while the other is waiting, and the second wakes up and
      // retries the stale ALTER against the now-v2 table. The transaction makes the inspection and
      // repair one serialized decision.
      const columns = db.prepare('PRAGMA table_info(reward_events)').all().map((row) => row.name);
      if (!columns.includes('value')) db.exec('ALTER TABLE reward_events ADD COLUMN value TEXT;');
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    });
  } else if (currentVersion !== SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `reward store at ${path} has schema version ${currentVersion}, this code expects ${SCHEMA_VERSION}`,
    );
  }

  // INSERT OR IGNORE against the PRIMARY KEY on id: the whole idempotency guarantee lives in this one
  // line plus the schema's PRIMARY KEY constraint, not in application code that could drift from it.
  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO reward_events (id, guest_id, type, created_at, value) VALUES (?, ?, ?, ?, ?)',
  );
  const marksStmt = db.prepare("SELECT COUNT(*) AS c FROM reward_events WHERE guest_id = ? AND type = 'mark-earned'");
  // GP2: coins and Wildwood Shards, counted exactly like marks -- one row per pickup ever credited to
  // this guest. The eventId a caller applies these under is the PICKUP'S OWN id (net/gameServer.mjs's
  // applyLootAward), which is globally unique by construction (public/src/world/cartLoot.js's table
  // has exactly one row per physical object) -- so INSERT OR IGNORE's ordinary idempotency is what
  // makes "this physical loot cannot be awarded twice" hold at the durable layer too, not only in the
  // in-memory simulation state that decided to award it in the first place.
  const coinsStmt = db.prepare("SELECT COUNT(*) AS c FROM reward_events WHERE guest_id = ? AND type = 'coin-earned'");
  const shardsStmt = db.prepare("SELECT COUNT(*) AS c FROM reward_events WHERE guest_id = ? AND type = 'shard-earned'");
  const unlockedStmt = db.prepare(
    "SELECT COUNT(*) AS c FROM reward_events WHERE guest_id = ? AND type = 'lantern-unlocked'",
  );
  // ── ARC 2: THE SATCHEL AND THE CHARM ──────────────────────────────────────────────────────────
  //
  // Both PER GUEST and both latches, so both are existence checks rather than counts -- unlike marks
  // and coins, which are events you can have more of, these are things that are either true about a
  // child or are not. Two brothers each pick the satchel up for themselves and each earn their own
  // charm, exactly the way the Wildwood Blade already works: a co-op game where one child's progress
  // silently completes another child's is a game where the younger one never gets to do anything.
  const satchelStmt = db.prepare(
    "SELECT 1 AS found FROM reward_events WHERE guest_id = ? AND type = 'satchel-taken' LIMIT 1",
  );
  const charmStmt = db.prepare(
    "SELECT 1 AS found FROM reward_events WHERE guest_id = ? AND type = 'charm-earned' LIMIT 1",
  );
  // Latest INSERT wins, unlike marks/unlocked which are counted: equipping is a CHOICE, not an
  // accumulation, so the current state is "whatever was equipped most recently". rowid is SQLite's
  // own insertion order for this ordinary table, and therefore remains correct across process
  // restarts, same-millisecond writes and wall-clock rollback. Event ids remain idempotency keys;
  // they are no longer overloaded as an ordering mechanism.
  const equippedWeaponStmt = db.prepare(
    "SELECT value FROM reward_events WHERE guest_id = ? AND type = 'weapon-equipped' "
    + 'ORDER BY rowid DESC LIMIT 1',
  );
  // GP1-C1: ownership is a SET (has this guest ever been granted item X), unlike equip's latest-wins
  // read above -- DISTINCT because the same durable grant could in principle be applied more than
  // once (the eventId's own idempotency already prevents a literal duplicate ROW, but nothing stops
  // two different eventIds naming the same item, e.g. a future re-grant path). The starter sword is
  // deliberately NOT a row here at all: every guest owns it by construction, not by durable event --
  // see net/gameServer.mjs's rewardsFor, the one place that prepends it.
  const ownedItemIdsStmt = db.prepare(
    "SELECT DISTINCT value FROM reward_events WHERE guest_id = ? AND type = 'gear-owned'",
  );
  // GP3-0: unlike every query above, NOT guest-scoped -- this is the restart-coherence fix's whole
  // read side. net/gameServer.mjs's in-memory cart lootState resets on every process restart, but
  // these rows do not; a pickup id that already has a coin-earned/shard-earned row here (awarded to
  // ANY guest, ever) must never again present as fresh collectible loot. coin-earned/shard-earned
  // have no other source today (public/src/world/cartLoot.js's CART_LOOT_TABLE is the only thing
  // that ever calls applyLootAward), so this doubles as exactly "which cart-loot:* ids are already
  // spent" without this file needing to know that table exists.
  const creditedLootIdsStmt = db.prepare(
    "SELECT id FROM reward_events WHERE type IN ('coin-earned', 'shard-earned')",
  );
  // GP3: Village Supplies' whole read side -- ALSO not guest-scoped, for the reason the GP3 brief's
  // "economy ruling" gives (section 2.1): who physically picked a coin off the ground stays personal
  // (coinsFor/shardsFor above), but what the Village can spend is communal. Deliberately the exact
  // COUNT(*) shape coinsFor/shardsFor already use, just without the "AND guest_id = ?" clause.
  const totalCoinsEarnedStmt = db.prepare("SELECT COUNT(*) AS c FROM reward_events WHERE type = 'coin-earned'");
  const totalShardsEarnedStmt = db.prepare("SELECT COUNT(*) AS c FROM reward_events WHERE type = 'shard-earned'");
  // GP3: a village-upgrade row's mere existence IS ownership, by the brief's own ruling (section
  // 2.3) -- there is no separate mutable balance to drift from it. `id` is already the table's own
  // PRIMARY KEY, so this is an existence check on it; `type` is checked too only so a caller passing
  // a stray id that happens to collide with some OTHER event's id can never misread as ownership.
  const villageUpgradeOwnedStmt = db.prepare(
    "SELECT 1 AS found FROM reward_events WHERE id = ? AND type = 'village-upgrade' LIMIT 1",
  );
  // G3: THE OLD BEACON IS LIT, and it is a WORLD fact rather than a personal one -- so this read is
  // not guest-scoped, exactly like villageUpgradeOwned just above and for the same reason the GP3
  // economy ruling gives: what one child physically did stays personal provenance (the `gear-owned`
  // Blade below is per guest), but what happened to the WORLD is communal. Two brothers who beat the
  // Warden together are standing under one lit Beacon, not two, and a brother who was not there when
  // it happened must not arrive to find it cold again.
  //
  // An existence check on a single well-known row rather than a count: the Beacon lights once, ever,
  // and "how many times was it lit" is not a question anything can ask.
  const beaconLitStmt = db.prepare(
    "SELECT 1 AS found FROM reward_events WHERE type = 'beacon-lit' LIMIT 1",
  );

  const KNOWN_AWARD_TYPES = new Set([
    'mark-earned', 'lantern-unlocked', 'weapon-equipped', 'gear-owned', 'coin-earned', 'shard-earned',
    'village-upgrade', 'beacon-lit', 'satchel-taken', 'charm-earned',
  ]);

  /**
   * Append one award, once, ever. Returns { applied: false } on a replay of an eventId already on
   * record -- the caller (net/gameServer.mjs) never has to ask "have I seen this?" first; the store
   * answers it atomically as part of the write.
   */
  function apply(award) {
    if (!award || typeof award.guestId !== 'string' || award.guestId.length === 0) {
      throw new Error(`reward store apply() requires a non-empty guestId, got ${JSON.stringify(award?.guestId)}`);
    }
    if (!KNOWN_AWARD_TYPES.has(award.type)) {
      throw new Error(`reward store apply() got an unknown award type ${JSON.stringify(award.type)}`);
    }
    if (typeof award.eventId !== 'string' || award.eventId.length === 0) {
      throw new Error('reward store apply() requires a non-empty eventId');
    }
    if (award.type === 'weapon-equipped' && !isKnownWeapon(award.value)) {
      // Business-rule validation, the same layer net/protocol.js's decodeRewards leaves to its
      // caller -- the wire only checks SHAPE (a string), the store is what refuses to durably record
      // a weapon id nobody defined, whether that came from a stale client or a bug upstream of here.
      throw new Error(`reward store apply() got an unknown weapon id ${JSON.stringify(award.value)}`);
    }
    if (award.type === 'gear-owned' && !isKnownItem(award.value)) {
      throw new Error(`reward store apply() got an unknown item id ${JSON.stringify(award.value)}`);
    }
    const result = insertStmt.run(
      award.eventId, award.guestId, award.type, new Date().toISOString(), award.value ?? null,
    );
    return { applied: result.changes > 0 };
  }

  function marksFor(guestId) {
    return marksStmt.get(guestId).c;
  }

  function coinsFor(guestId) {
    return coinsStmt.get(guestId).c;
  }

  function shardsFor(guestId) {
    return shardsStmt.get(guestId).c;
  }

  function unlockedFor(guestId) {
    return unlockedStmt.get(guestId).c > 0;
  }

  /** Is this child carrying the fallen ranger's satchel out of Blackthorn Hollow. */
  function satchelTakenFor(guestId) {
    return satchelStmt.get(guestId) !== undefined;
  }

  /** Has Wren already given this child her charm -- the fourth heart. */
  function charmEarnedFor(guestId) {
    return charmStmt.get(guestId) !== undefined;
  }

  /** The most recently equipped weapon id for this guest, or null if they have never equipped one --
   *  the caller (progression/state.js, mirrored through net/gameServer.mjs) is what knows the
   *  default to fall back to; this store only ever reports what actually happened. */
  function equippedWeaponFor(guestId) {
    return equippedWeaponStmt.get(guestId)?.value ?? null;
  }

  /** Every item this guest has been durably granted, NOT including the starter sword (see this
   *  function's own preparation comment above for why). Empty array for a guest who has never been
   *  granted anything -- normal for every real player until GP9's reward ceremony exists; non-empty
   *  today only for a guestId a harness/test fixture seeded on purpose (GP1-C1). */
  function ownedItemIdsFor(guestId) {
    return ownedItemIdsStmt.all(guestId).map((row) => row.value);
  }

  /** Every pickup id ever durably credited to any guest -- see this statement's own preparation
   *  comment above for why this is the restart-coherence read. */
  function creditedLootIds() {
    return creditedLootIdsStmt.all().map((row) => row.id);
  }

  /** Village Supplies' shared coin total -- every coin-earned row ever, regardless of guest. */
  function totalCoinsEarned() {
    return totalCoinsEarnedStmt.get().c;
  }

  /** Village Supplies' shared Wildwood Shard total -- every shard-earned row ever, regardless of guest. */
  function totalShardsEarned() {
    return totalShardsEarnedStmt.get().c;
  }

  /** Whether upgradeId (e.g. WORKSHOP_I_ID) has ever been durably purchased, by anyone. */
  function villageUpgradeOwned(upgradeId) {
    return villageUpgradeOwnedStmt.get(upgradeId) !== undefined;
  }

  /** G3: whether the Old Beacon has ever been lit, by anyone. See beaconLitStmt's own comment for
   *  why this is a world fact and not a per-guest one. */
  function beaconLit() {
    return beaconLitStmt.get() !== undefined;
  }

  return {
    apply,
    marksFor,
    unlockedFor,
    satchelTakenFor,
    charmEarnedFor,
    equippedWeaponFor,
    ownedItemIdsFor,
    coinsFor,
    shardsFor,
    creditedLootIds,
    totalCoinsEarned,
    totalShardsEarned,
    villageUpgradeOwned,
    beaconLit,
    // Exposed for the harness/tests that want to assert a backup landed, and for a server boot log
    // line -- never read back by this module itself.
    backupPath,
    close() {
      db.close();
    },
  };
}
