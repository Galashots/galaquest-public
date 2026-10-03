// Tutorial step bookkeeping: where the player is in content.TUTORIAL. Pure, no DOM.
// What the goal chip *says* lives in guide.js; when a step completes lives in progress.js.
import { TUTORIAL } from '../../content/progression.js';

export const GOAL_STEPS = TUTORIAL.map((s) => s.id);

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

/** Jump directly to a named step. Unknown ids are a no-op. */
export function setStep(goalState, stepId) {
  const index = GOAL_STEPS.indexOf(stepId);
  if (index === -1) return goalState;
  return { stepIndex: index };
}
