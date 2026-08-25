// Shared combat-side application law. This module deliberately knows nothing about items,
// ownership, progression, or POWER; callers resolve those facts into numeric command fields first.

export function resolveIncomingDamage(rawIncomingDamage, damageReductionPercent = 0) {
  if (!Number.isFinite(rawIncomingDamage) || rawIncomingDamage < 0) {
    throw new TypeError(`rawIncomingDamage must be finite and >= 0, got ${JSON.stringify(rawIncomingDamage)}`);
  }
  if (!Number.isFinite(damageReductionPercent) || damageReductionPercent < 0 || damageReductionPercent >= 100) {
    throw new TypeError(
      `damageReductionPercent must be finite and in [0, 100), got ${JSON.stringify(damageReductionPercent)}`,
    );
  }
  return Math.max(1, Math.round(rawIncomingDamage * (100 - damageReductionPercent) / 100));
}
