// Pure timing/cooldown seam for the prototype companion's tiny direct-interaction delight beat.
// It owns no DOM, Three.js, combat, rewards, profile, persistence, or network state.

export const COMPANION_HAPPY_REACTION = Object.freeze({
  durationSeconds: 0.62,
  cooldownSeconds: 0.28,
});

export function createHappyReactionState() {
  return {
    activeSeconds: 0,
    cooldownSeconds: 0,
    triggerCount: 0,
  };
}

export function requestHappyReaction(state = createHappyReactionState()) {
  if (state.cooldownSeconds > 0) return { state, accepted: false };
  return {
    state: {
      ...state,
      activeSeconds: COMPANION_HAPPY_REACTION.durationSeconds,
      cooldownSeconds: COMPANION_HAPPY_REACTION.cooldownSeconds,
      triggerCount: state.triggerCount + 1,
    },
    accepted: true,
  };
}

export function advanceHappyReaction(state, deltaSeconds) {
  const step = Math.max(0, Math.min(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0.25));
  return {
    ...state,
    activeSeconds: Math.max(0, state.activeSeconds - step),
    cooldownSeconds: Math.max(0, state.cooldownSeconds - step),
  };
}

export function happyReactionProgress(state) {
  if (!(state.activeSeconds > 0)) return 0;
  return state.activeSeconds / COMPANION_HAPPY_REACTION.durationSeconds;
}
