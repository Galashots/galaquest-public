// localStorage save/load, wrapped in try/catch (private browsing, quota, or
// disabled storage must never crash the game). Versioned JSON so future
// shape changes can migrate instead of silently breaking old saves.

import { SAVE_VERSION, createGameState } from './rules/game.js';

const SAVE_KEY = 'galaquest-farm-slice-save';

export function saveGame(state) {
  try {
    const payload = JSON.stringify({ version: SAVE_VERSION, savedAt: Date.now(), state });
    window.localStorage.setItem(SAVE_KEY, payload);
    return true;
  } catch (err) {
    console.warn('[save] could not save game', err);
    return false;
  }
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
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return { state: createGameState(now), isNewGame: true };
    const payload = JSON.parse(raw);
    if (!payload || payload.version !== SAVE_VERSION || !payload.state) {
      return { state: createGameState(now), isNewGame: true };
    }
    return { state: payload.state, isNewGame: false };
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
