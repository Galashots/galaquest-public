// Pure goal-tracker step bookkeeping. No three.js, no DOM, and no knowledge
// of crops/offers/etc -- that context-aware description lives in game.js
// (currentGoal), which can inspect farm/basket state to phrase the chip and
// pick a target. This module only knows the step order.
//
// Full machine per CONTRACT.md section 4 "State model":
//   PLANT -> GROW -> HARVEST -> MARKET -> OFFER -> ARMOR -> HATCH -> NAME
//   -> BOOK -> FEED -> REPLANT -> FREE (terminal, loops forever)

export const GOAL_STEPS = [
  'plant', 'grow', 'harvest', 'market', 'offer', 'armor',
  'hatch', 'name', 'book', 'feed', 'replant', 'free',
];

export function createGoalState() {
  return { stepIndex: 0 };
}

export function currentStep(goalState) {
  return GOAL_STEPS[Math.min(goalState.stepIndex, GOAL_STEPS.length - 1)];
}

export function isStep(goalState, step) {
  return currentStep(goalState) === step;
}

export function advanceGoal(goalState) {
  return { stepIndex: Math.min(goalState.stepIndex + 1, GOAL_STEPS.length - 1) };
}

/** Jump directly to a named step (e.g. reverting OFFER/ARMOR back to MARKET when the player leaves mid-goal). Unknown ids are a no-op. */
export function setStep(goalState, stepId) {
  const index = GOAL_STEPS.indexOf(stepId);
  if (index === -1) return goalState;
  return { stepIndex: index };
}
