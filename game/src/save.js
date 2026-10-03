// localStorage save/load, wrapped in try/catch: private browsing, a full quota or disabled
// storage must never crash the game. Old saves are migrated by rules/state.js.
import { SAVE_VERSION, createGameState, migrateSave, ensureOrderBoard, checkRewards } from './rules/game.js';
import * as content from '../content/index.js';

const SAVE_KEY = 'gq.farmSlice.v1'; // the key predates save version 2; the payload carries the version

export function saveGame(state) {
  try {
    // Hatch taps are moment-to-moment drama, not progress (docs/CONTRACT.md §4).
    const toSave = { ...state, eggs: state.eggs.map((e) => (e.hatchTaps ? { ...e, hatchTaps: 0 } : e)) };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, savedAt: Date.now(), state: toSave }));
    return true;
  } catch (err) {
    console.warn('[save] could not save game', err);
    return false;
  }
}

/**
 * Load the saved game, or a fresh one if there is none or it can't be read.
 * `isNewGame` is false on a return visit (which may plant a volunteer crop).
 */
export function loadGame(now) {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    const payload = raw ? JSON.parse(raw) : null;
    const state = payload ? migrateSave(payload.state, payload.version) : null;
    // checkRewards grants anything added to content since this save was made.
    if (state) return { state: checkRewards(ensureOrderBoard(state, content), content), isNewGame: false };
  } catch (err) {
    console.warn('[save] could not load game, starting fresh', err);
  }
  return { state: createGameState(now), isNewGame: true };
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
