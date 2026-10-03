// Rewards earned by playing (content.REWARDS). Each is granted once, the first time its
// condition holds. Pure, no DOM.
import { createEgg } from './state.js';

function conditionMet(state, when = {}) {
  if (when.freeOrderFills !== undefined && (state.freeOrderFills || 0) < when.freeOrderFills) return false;
  return true;
}

function grant(state, reward) {
  let next = { ...state, rewards: { ...state.rewards, earned: [...state.rewards.earned, reward.id] } };
  const { seeds, egg, decoration } = reward.grant || {};
  if (seeds) {
    const merged = { ...next.seeds };
    for (const [cropId, n] of Object.entries(seeds)) merged[cropId] = (merged[cropId] || 0) + n;
    next = { ...next, seeds: merged };
  }
  if (egg) next = { ...next, eggs: [...next.eggs, createEgg({ ...egg, ready: true })] };
  if (decoration && !next.decorations.includes(decoration)) next = { ...next, decorations: [...next.decorations, decoration] };
  return next;
}

/** Grant every reward whose condition now holds and that hasn't been granted yet. */
export function checkRewards(state, content) {
  let next = state;
  for (const reward of content.REWARDS) {
    if (!next.rewards.earned.includes(reward.id) && conditionMet(next, reward.when)) next = grant(next, reward);
  }
  return next;
}

export function rewardEarned(state, rewardId) {
  return state.rewards.earned.includes(rewardId);
}

/** Rewards earned between two states, as content defs (for toasts and celebrations). */
export function newlyEarned(before, after, content) {
  return content.REWARDS.filter((r) => after.rewards.earned.includes(r.id) && !before.rewards.earned.includes(r.id));
}

/** Announced rewards (those with a `title`) the player hasn't opened yet, as content defs. */
export function unseenRewards(state, content) {
  return content.REWARDS.filter((r) => r.title && state.rewards.earned.includes(r.id) && !state.rewards.seen.includes(r.id));
}

/**
 * Progress along a reward track (content.TRACKS), measured in free-play order fills:
 * { track, done, total, next: { label, remaining } | null }, or null for an unknown track.
 */
export function trackProgress(state, content, trackId) {
  const track = content.TRACKS.find((t) => t.id === trackId);
  const steps = content.REWARDS.filter((r) => r.track === trackId && r.when?.freeOrderFills !== undefined)
    .sort((a, b) => a.when.freeOrderFills - b.when.freeOrderFills);
  if (!track || !steps.length) return null;
  const fills = state.freeOrderFills || 0;
  const total = steps[steps.length - 1].when.freeOrderFills;
  const upcoming = steps.find((r) => !state.rewards.earned.includes(r.id));
  return {
    track,
    done: Math.min(fills, total),
    total,
    next: upcoming ? { label: upcoming.label, remaining: Math.max(0, upcoming.when.freeOrderFills - fills) } : null,
  };
}

/** The player opened a reward's announcement. The grant itself already happened. */
export function markRewardSeen(state, rewardId) {
  if (!rewardEarned(state, rewardId) || state.rewards.seen.includes(rewardId)) return state;
  return { ...state, rewards: { ...state.rewards, seen: [...state.rewards.seen, rewardId] } };
}
