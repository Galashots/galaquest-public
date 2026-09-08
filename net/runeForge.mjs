import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  FORGE_TASK_ASSISTED,
  FORGE_TASK_ATTEMPTED,
  completionFact,
  deriveRuneForgeState,
  isCorrectChoice,
  selectPackFact,
  validateRuneForgeCatalog,
} from '../public/src/learning/runeForge.js';

export const DEFAULT_RUNE_FORGE_CATALOG_PATH = fileURLToPath(new URL(
  '../public/data/learning/rune-forge-v1.json', import.meta.url));

export function loadRuneForgeCatalog(path = DEFAULT_RUNE_FORGE_CATALOG_PATH) {
  return validateRuneForgeCatalog(JSON.parse(readFileSync(path, 'utf8')));
}

export function createRuneForgeService(options) {
  const factsFor = options?.factsFor;
  const recordFact = options?.recordFact;
  const grantEntitlement = options?.grantEntitlement;
  const profileIdFor = options?.profileIdFor ?? (playerId => playerId);
  if (typeof factsFor !== 'function' || typeof recordFact !== 'function'
    || typeof grantEntitlement !== 'function') throw new Error('Rune Forge service needs durable reward seams.');
  const catalogPath = options.catalogPath ?? DEFAULT_RUNE_FORGE_CATALOG_PATH;

  function catalog() {
    // Deliberately reread through the validated boundary for every bounded forge action. An ordinary
    // task correction therefore reaches the running server without changing C#, a scene, or the
    // Unity player build. The files are tiny and this interaction happens a handful of times.
    return loadRuneForgeCatalog(catalogPath);
  }

  function rawStateFor(playerId) {
    return deriveRuneForgeState(catalog(), factsFor(playerId));
  }

  function expose(state, extra = {}) {
    const task = state.task ? {
      ...state.task,
      choices: state.task.choices.map(({ id, label }) => ({ id, label })),
    } : null;
    return { ...state, task, ...extra };
  }

  function stateFor(playerId, extra = {}) {
    return expose(rawStateFor(playerId), extra);
  }

  function select(playerId, packId) {
    const current = rawStateFor(playerId);
    if (current.selectedPackId) return expose(current);
    recordFact(playerId, selectPackFact(profileIdFor(playerId), catalog(), packId));
    return stateFor(playerId, { response: 'pack-selected' });
  }

  function hint(playerId, taskId, contentVersion) {
    const current = rawStateFor(playerId);
    if (!current.task || current.task.id !== taskId || current.contentVersion !== contentVersion) return expose(current);
    const profileId = profileIdFor(playerId);
    recordFact(playerId, {
      eventId: `forge-assist:${profileId}:${current.entitlement.id}:${taskId}`,
      type: FORGE_TASK_ASSISTED,
      value: JSON.stringify({
        entitlementId: current.entitlement.id, packId: current.selectedPackId,
        taskId, contentVersion,
      }),
    });
    return stateFor(playerId, { response: 'hint', hint: current.task.hint });
  }

  function answer(playerId, taskId, choiceId, contentVersion) {
    const current = rawStateFor(playerId);
    if (!current.task || current.task.id !== taskId || current.contentVersion !== contentVersion)
      return expose(current, { response: 'stale-task' });
    const profileId = profileIdFor(playerId);
    if (!isCorrectChoice(current.task, choiceId)) {
      recordFact(playerId, {
        eventId: `forge-attempt:${profileId}:${current.entitlement.id}:${taskId}`,
        type: FORGE_TASK_ATTEMPTED,
        value: JSON.stringify({
          entitlementId: current.entitlement.id, packId: current.selectedPackId,
          taskId, contentVersion, outcome: 'retry',
        }),
      });
      return stateFor(playerId, { response: 'retry', hint: current.task.hint });
    }
    const assisted = factsFor(playerId).some(fact => fact?.type === FORGE_TASK_ASSISTED
      && fact.eventId === `forge-assist:${profileId}:${current.entitlement.id}:${taskId}`);
    recordFact(playerId, completionFact(profileId, catalog(), current.task, assisted));
    return stateFor(playerId, { response: assisted ? 'assisted-success' : 'independent-success' });
  }

  function claim(playerId) {
    const current = rawStateFor(playerId);
    if (!current.readyToClaim) return expose(current);
    const granted = grantEntitlement(playerId, current.entitlement);
    return stateFor(playerId, { response: granted ? 'claimed' : 'already-owned', justGranted: granted });
  }

  return { stateFor, select, hint, answer, claim };
}
