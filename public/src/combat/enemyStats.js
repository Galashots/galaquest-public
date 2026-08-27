// Canonical ordinary-enemy level/stat authority. This module is deliberately pure so the
// encounter rules, authoritative server, protocol boundary, and tests all consume the same table.
// Enemy level is authored content; it is never derived from the Hero's level or displayed POWER.

const WOLF_LEVEL_STATS = Object.freeze({
  1: Object.freeze({ level: 1, maxHp: 30, biteDamage: 10, speed: 1.15 }),
  2: Object.freeze({ level: 2, maxHp: 40, biteDamage: 12, speed: 1.15 }),
  4: Object.freeze({ level: 4, maxHp: 60, biteDamage: 18, speed: 1.15 }),
});

export { WOLF_LEVEL_STATS };

export function isSupportedWolfLevel(level) {
  return Number.isSafeInteger(level) && Object.prototype.hasOwnProperty.call(WOLF_LEVEL_STATS, level);
}

export function wolfStatsForLevel(level) {
  if (!isSupportedWolfLevel(level)) {
    throw new TypeError(`unsupported Wolf level: ${JSON.stringify(level)}`);
  }
  return WOLF_LEVEL_STATS[level];
}

// ── THE COMBAT-DENSITY PACKAGE: ENEMY VARIANTS ─────────────────────────────────────────────────
//
// "Maximum dopamine" density means more than one silhouette in the wilderness. Each variant is its
// own KIND rather than a new Wolf level, deliberately: WOLF_LEVEL_STATS above is a closed, pinned
// table (test/progression-e2-enemy.test.mjs's own deepEqual) that predates this package and stays
// exactly what it was -- a level is a Wolf's own strength tier, not a slot every future creature
// has to fit into. A kind gets its own table, keyed by ITS OWN level namespace; today every variant
// below authors exactly one ("Level 1" for that kind), which leaves room for a future variant to
// grow the same way the Wolf itself did without touching this one's row.
//
// Speeds and bite damage are tuned relative to the Wolf's own three rows (30/40/60 hp, 10/12/18
// bite) rather than invented cold: an Ember Wolf reads as "a bit more than a Level-2 Wolf and a bit
// faster", a Frost Wolf as "tougher and slower to close", and the Alpha as a boss-shaped step up
// from all of them -- the family reads as one escalating threat rather than four unrelated animals.
const EMBER_WOLF_LEVEL_STATS = Object.freeze({
  1: Object.freeze({ level: 1, maxHp: 40, biteDamage: 12, speed: 1.25 }),
});
const FROST_WOLF_LEVEL_STATS = Object.freeze({
  1: Object.freeze({ level: 1, maxHp: 55, biteDamage: 14, speed: 1.1 }),
});
const ALPHA_WOLF_LEVEL_STATS = Object.freeze({
  1: Object.freeze({ level: 1, maxHp: 90, biteDamage: 20, speed: 1.2 }),
});

// One dispatch table, keyed by `kind`, so a new kind is one new entry rather than a new branch
// scattered across every caller that used to assume "Wolf" (GQ-007). `ENEMY_KINDS` below is DERIVED
// from this table's own keys rather than a parallel list, for the identical reason: net/protocol.js
// and combat/encounter.js both need "every kind this game knows about", and two hand-kept copies of
// that set is exactly the drift this repo's own guidance ledger is about.
const LEVEL_STATS_BY_KIND = Object.freeze({
  wolf: WOLF_LEVEL_STATS,
  'ember-wolf': EMBER_WOLF_LEVEL_STATS,
  'frost-wolf': FROST_WOLF_LEVEL_STATS,
  'alpha-wolf': ALPHA_WOLF_LEVEL_STATS,
});

/** Every ordinary-enemy kind this game defines, in table order. Frozen so a caller cannot mutate the
 *  one list every consumer (the wire's enemy-kind allowlist, the party engine's hostility check)
 *  shares. */
export const ENEMY_KINDS = Object.freeze(Object.keys(LEVEL_STATS_BY_KIND));

export function isSupportedEnemyLevel(kind, level) {
  const table = LEVEL_STATS_BY_KIND[kind];
  return table !== undefined
    && Number.isSafeInteger(level)
    && Object.prototype.hasOwnProperty.call(table, level);
}

/** The kind-aware generalisation of wolfStatsForLevel. Every ordinary-enemy stat lookup in
 *  combat/encounter.js and net/protocol.js goes through this one function so a Wolf and an Ember
 *  Wolf standing at "level 1" can never silently share a stat row neither of them authored. */
export function enemyStatsForLevel(kind, level) {
  if (!isSupportedEnemyLevel(kind, level)) {
    throw new TypeError(`unsupported level ${JSON.stringify(level)} for enemy kind ${JSON.stringify(kind)}`);
  }
  return LEVEL_STATS_BY_KIND[kind][level];
}

// ── PER-KIND RESPAWN TIMING ─────────────────────────────────────────────────────────────────────
//
// WOLF_RESPAWN_SECONDS used to be one constant applied to every ordinary enemy, back when "every
// ordinary enemy" meant "the Wolf". An Alpha is meant to read as a rarer, slower-returning danger --
// the density package's own brief asks for it explicitly -- so this becomes a per-KIND table for the
// same reason the stat rows above did: one home, so a caller cannot silently apply the Wolf's own
// clock to a kind that has never agreed to it. combat/encounter.js's own WOLF_RESPAWN_SECONDS export
// stays wired to this table's 'wolf' row, so every existing reader (including the test that times a
// Wolf's own respawn) keeps reading the exact same number under the exact same name.
const ENEMY_KIND_RESPAWN_SECONDS = Object.freeze({
  wolf: 10,
  'ember-wolf': 10,
  'frost-wolf': 12,
  'alpha-wolf': 20,
});

/** How long a defeated enemy of this kind stays gone before returning to its authored home. Falls
 *  back to the Wolf's own clock for an unrecognised kind, the same "never a silent zero" posture
 *  swingDamageFor's own header explains for an unnamed weapon. */
export function respawnSecondsForKind(kind) {
  return ENEMY_KIND_RESPAWN_SECONDS[kind] ?? ENEMY_KIND_RESPAWN_SECONDS.wolf;
}

// ── KILL XP, BY KIND ────────────────────────────────────────────────────────────────────────────
//
// R1: repeatable combat XP's own award table -- progression/facts.js's pendingLanternXpFact reserves
// this exact door ("Repeatable combat XP is R1's package... the brief is explicit that neither may
// arrive early through this door"). Lives beside the stat rows it is priced against, not in
// progression/, because combat purity forbids the rules layer from reaching OUT to progression/ for
// a number, but nothing stops progression/rewards code from reaching IN here for one that is
// honestly about combat -- the same one-way seam swingDamageFor's own header documents for damage.
//
// Escalates with the stat rows above rather than being invented separately: roughly the ordinary
// Wolf's XP for each 10 hp of extra body, and the Alpha's 100 is the first XP award in this game
// worth a full Hero level on its own (progression/levels.js's own BASE_XP_TO_ADVANCE), which is the
// whole point of a rare, dangerous kill.
const KILL_XP_BY_KIND = Object.freeze({
  wolf: 20,
  'ember-wolf': 30,
  'frost-wolf': 40,
  'alpha-wolf': 100,
});

/** XP every contributing hero earns for defeating one enemy of this kind, or null for a kind this
 *  table does not price -- a caller (rewards/killXp.js) treats null as "no award", never as zero
 *  spent through the fold by accident. */
export function killXpForKind(kind) {
  return Object.prototype.hasOwnProperty.call(KILL_XP_BY_KIND, kind) ? KILL_XP_BY_KIND[kind] : null;
}
