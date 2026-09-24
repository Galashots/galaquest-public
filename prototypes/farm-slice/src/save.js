// localStorage save/load, wrapped in try/catch (private browsing, quota, or
// disabled storage must never crash the game). Versioned JSON so future
// shape changes can migrate instead of silently breaking old saves.

import { SAVE_VERSION, createGameState } from './rules/game.js';

const SAVE_KEY = 'gq.farmSlice.v1';

export function saveGame(state) {
  try {
    // Hatch taps are UI-only drama, not part of the saved goal state
    // (CONTRACT.md section 4: "Taps aren't saved") -- always persist zero so
    // a reload mid-hatch doesn't skip ahead or get stuck on a stale count.
    const toSave = state.egg && state.egg.hatchTaps
      ? { ...state, egg: { ...state.egg, hatchTaps: 0 } }
      : state;
    const payload = JSON.stringify({ version: SAVE_VERSION, savedAt: Date.now(), state: toSave });
    window.localStorage.setItem(SAVE_KEY, payload);
    return true;
  } catch (err) {
    console.warn('[save] could not save game', err);
    return false;
  }
}

function readKey(key) {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const payload = JSON.parse(raw);
  if (!payload || payload.version !== SAVE_VERSION || !payload.state) return null;
  const state = payload.state;
  if (!Array.isArray(state.farm?.plots) || state.farm.plots.length !== 3 ||
      !Number.isInteger(state.goals?.stepIndex) || !state.egg || !state.basket || !state.collection) return null;
  return state;
}

/**
 * Loads a saved game, or returns a fresh one for `now` if there is no save,
 * the storage is unavailable, or the payload is unreadable/mismatched.
 * `isNewGame` tells the caller whether this is a first-ever visit (in which
 * case volunteer carrots should NOT be planted -- see game.applyVolunteerCarrots)
 * or a genuine return visit.
 */
export function loadGame(now) {
  try {
    const current = readKey(SAVE_KEY);
    if (current) return { state: current, isNewGame: false };

    return { state: createGameState(now), isNewGame: true };
  } catch (err) {
    console.warn('[save] could not load game, starting fresh', err);
    return { state: createGameState(now), isNewGame: true };
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
    return true;
  } catch (err) {
    console.warn('[save] could not clear save', err);
    return false;
  }
}
