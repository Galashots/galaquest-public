// Pure goal-tracker state machine. No three.js, no DOM.
// Drives the always-visible goal chip and tells the UI which on-screen
// target the bouncing arrow should point at. `loop` is a terminal, free-play
// state -- nothing ever expires or fails past it.

export const GOAL_STEPS = ['plant', 'harvest', 'market', 'armor', 'hatch', 'name', 'loop'];

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

/**
 * @returns {{step: string, text: string, targetKey: string|null}}
 * targetKey is a hint the renderer maps to a 3D-projected screen point:
 * 'plot' | 'ripeCrop' | 'market' | 'mannequin' | 'egg' | 'nameDialog' | null.
 */
export function describeGoal(goalState) {
  const step = currentStep(goalState);
  switch (step) {
    case 'plant':
      return { step, text: 'Plant a seed', targetKey: 'plot' };
    case 'harvest':
      return { step, text: 'Pick your crops', targetKey: 'ripeCrop' };
    case 'market':
      return { step, text: 'Go to the market', targetKey: 'market' };
    case 'armor':
      return { step, text: 'Buy the helmet', targetKey: 'mannequin' };
    case 'hatch':
      return { step, text: 'Tap the egg!', targetKey: 'egg' };
    case 'name':
      return { step, text: 'Name your creature', targetKey: 'nameDialog' };
    case 'loop':
    default:
      return { step, text: 'Feed your friend, or plant again', targetKey: 'plot' };
  }
}
