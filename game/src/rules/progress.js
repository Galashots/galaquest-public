// Completing tutorial steps. Pure, no DOM.
import * as goals from './goals.js';
import * as egg from './egg.js';
import { starterEgg, replaceEgg } from './state.js';
import { TUTORIAL } from '../../content/progression.js';

export function step(state) {
  return goals.currentStep(state.goals);
}

export function inFreePlay(state) {
  return step(state) === 'free';
}

/**
 * If the player is on `stepId`, move to the next step, cracking the starter egg when the
 * tutorial says so. Otherwise return the state unchanged.
 */
export function completeStep(state, stepId) {
  if (step(state) !== stepId) return state;
  const def = TUTORIAL.find((s) => s.id === stepId);
  let next = { ...state, goals: goals.advanceGoal(state.goals) };
  if (def?.crack) next = replaceEgg(next, egg.addCrack(starterEgg(next)));
  return next;
}
