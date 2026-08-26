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
