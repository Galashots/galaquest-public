// Rewards earned by playing (content.REWARDS). Each is granted once, the first time its
// condition holds. Pure, no DOM.
import { createEgg } from './state.js';

function conditionMet(state, when = {}) {
  if (when.freeOrderFills !== undefined && (state.freeOrderFills || 0) < when.freeOrderFills) return false;
  return true;
}

function grant(state, reward) {
  let next = { ...state, rewards: { ...state.rewards, earned: [...state.rewards.earned, reward.id] } };
  const { seeds, egg } = reward.grant || {};
  if (seeds) {
    const merged = { ...next.seeds };
    for (const [cropId, n] of Object.entries(seeds)) merged[cropId] = (merged[cropId] || 0) + n;
    next = { ...next, seeds: merged };
  }
  if (egg) next = { ...next, eggs: [...next.eggs, createEgg({ ...egg, ready: true })] };
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

/** Earned rewards the player hasn't opened yet, as content defs. */
export function unseenRewards(state, content) {
  return content.REWARDS.filter((r) => state.rewards.earned.includes(r.id) && !state.rewards.seen.includes(r.id));
}

/** The player opened a reward's announcement. The grant itself already happened. */
export function markRewardSeen(state, rewardId) {
  if (!rewardEarned(state, rewardId) || state.rewards.seen.includes(rewardId)) return state;
  return { ...state, rewards: { ...state.rewards, seen: [...state.rewards.seen, rewardId] } };
}
