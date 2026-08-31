// The first authored special attack. Pure combat vocabulary only: no DOM, three.js, progression
// storage, or network imports. The caller supplies the already-resolved Hero level and damage.

export const SPECIAL_ATTACK_ID = 'wildwood-burst';
export const SPECIAL_ATTACK_NAME = 'WILDWOOD BURST';
export const SPECIAL_ATTACK_UNLOCK_LEVEL = 5;
export const SPECIAL_ATTACK_COOLDOWN_SECONDS = 8;
export const SPECIAL_ATTACK_SECONDS = 0.72;
export const SPECIAL_ATTACK_CONTACT_SECONDS = 0.24;
export const SPECIAL_ATTACK_REACH = 4.5;
export const SPECIAL_ATTACK_HALF_ARC_RADIANS = Math.PI * 0.62;
export const SPECIAL_ATTACK_DAMAGE_MULTIPLIER = 3;
export const SPECIAL_ATTACK_MAX_TARGETS = 3;

function compareStableIds(a, b) {
  return String(a).localeCompare(String(b));
}

/** A generous forward cone: a child only needs to face the group, not line up one target. */
export function isWithinSpecialStrike(
  from,
  heading,
  target,
  reach = SPECIAL_ATTACK_REACH,
  halfArc = SPECIAL_ATTACK_HALF_ARC_RADIANS,
) {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance > reach) return false;
  if (distance === 0) return true;
  const facing = (dx * Math.sin(heading) + dz * Math.cos(heading)) / distance;
  return facing >= Math.cos(halfArc);
}

/** Stable nearest-first selection makes a multi-target burst deterministic across clients. */
export function specialAttackTargets(
  enemies,
  position,
  heading,
  maxTargets = SPECIAL_ATTACK_MAX_TARGETS,
) {
  return [...(enemies ?? [])]
    .filter((enemy) => enemy.mode !== 'dead' && enemy.mode !== 'dying')
    .filter((enemy) => isWithinSpecialStrike(position, heading, enemy))
    .sort((a, b) => {
      const distance = Math.hypot(a.x - position.x, a.z - position.z)
        - Math.hypot(b.x - position.x, b.z - position.z);
      return Math.abs(distance) > 1e-9 ? distance : compareStableIds(a.enemyId, b.enemyId);
    })
    .slice(0, Math.max(0, Math.floor(maxTargets)));
}

export function specialAttackDamageFor(heroDamage) {
  const damage = Number.isFinite(heroDamage) ? Math.max(0, heroDamage) : 0;
  return Math.max(1, Math.round(damage * SPECIAL_ATTACK_DAMAGE_MULTIPLIER));
}

export function canUseSpecialAttack({
  level = 0,
  specialSeconds = -1,
  specialCooldown = 0,
  downSeconds = -1,
  swingSeconds = -1,
} = {}) {
  return level >= SPECIAL_ATTACK_UNLOCK_LEVEL
    && downSeconds < 0
    && swingSeconds < 0
    && specialSeconds < 0
    && specialCooldown <= 0;
}
