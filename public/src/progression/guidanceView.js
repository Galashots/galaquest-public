// The small player-facing translation of existing progression state used by #118.
//
// This is deliberately a view model, not a quest store: the immediate objective is supplied by
// world/quest.js and the aspiration is derived from the resolved level state and the already-shipped
// Wildwood Burst gate. No DOM, storage, clock, network or Three.js belongs here.

import {
  SPECIAL_ATTACK_ID,
  SPECIAL_ATTACK_NAME,
  SPECIAL_ATTACK_UNLOCK_LEVEL,
} from '../combat/specialAttack.js';
import { cumulativeXpForLevel } from './levels.js';

const unlockXp = cumulativeXpForLevel(SPECIAL_ATTACK_UNLOCK_LEVEL);

/**
 * Translate the existing Hero level into the one visible longer-horizon desire #118 owns.
 *
 * Unknown or internally inconsistent progression is hidden rather than guessed. In particular, a
 * reconnect must not leave a previously rendered locked/unlocked state on screen while the new
 * authoritative rewards block is still arriving.
 */
export function wildwoodBurstAspirationView({ progressionKnown = false, levelState = null } = {}) {
  if (!progressionKnown) return null;
  if (!Number.isSafeInteger(levelState?.level) || levelState.level < 1) return null;
  if (!Number.isSafeInteger(levelState.totalXp) || levelState.totalXp < 0) return null;

  const unlocked = levelState.level >= SPECIAL_ATTACK_UNLOCK_LEVEL;
  if (!unlocked && levelState.totalXp >= unlockXp) return null;

  if (unlocked) {
    return {
      id: SPECIAL_ATTACK_ID,
      name: SPECIAL_ATTACK_NAME,
      state: 'unlocked',
      stateText: 'UNLOCKED',
      progressText: null,
      progress: 1,
      ariaLabel: `${SPECIAL_ATTACK_NAME} unlocked at level ${SPECIAL_ATTACK_UNLOCK_LEVEL}`,
      desktopText: `${SPECIAL_ATTACK_NAME} unlocked`,
    };
  }

  return {
    id: SPECIAL_ATTACK_ID,
    name: SPECIAL_ATTACK_NAME,
    state: 'locked',
    stateText: `NEXT · LV ${SPECIAL_ATTACK_UNLOCK_LEVEL}`,
    progressText: `${levelState.totalXp} / ${unlockXp} XP`,
    progress: levelState.totalXp / unlockXp,
    ariaLabel: `${SPECIAL_ATTACK_NAME} locked. Reach level ${SPECIAL_ATTACK_UNLOCK_LEVEL}. `
      + `${levelState.totalXp} of ${unlockXp} XP`,
    desktopText: `next: ${SPECIAL_ATTACK_NAME} · reach level ${SPECIAL_ATTACK_UNLOCK_LEVEL}`,
  };
}

/** Keep the current errand and the aspiration as one presentation read without creating a second
 * source for either one. `objective` is the already-resolved world/quest.js object. */
export function persistentGuidanceView({
  objective = null,
  progressionKnown = false,
  levelState = null,
} = {}) {
  return {
    now: objective?.id && typeof objective.text === 'string'
      ? { id: objective.id, text: objective.text }
      : null,
    aspiration: wildwoodBurstAspirationView({ progressionKnown, levelState }),
  };
}
