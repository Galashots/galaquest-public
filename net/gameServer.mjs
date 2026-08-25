// E1 C2 compatibility shell.
//
// The server implementation lives unchanged in gameServerCore.mjs for this checkpoint. C2's wire
// and simulation authority are collection-shaped there. Older in-process tests/readers still ask
// createSimulation().encounterSnapshot().wolf, so this public module adds only a derived,
// non-enumerable view of the canonical enemies[] snapshot. attachGameServer is re-exported from the
// core unchanged and therefore never publishes a singular Wolf field. C3 removes this shell once
// every runtime/test reader is keyed by enemyId.

export * from './gameServerCore.mjs';
import { createSimulation as createCoreSimulation } from './gameServerCore.mjs';

export function createSimulation(options = {}) {
  const simulation = createCoreSimulation(options);
  const coreEncounterSnapshot = simulation.encounterSnapshot.bind(simulation);
  simulation.encounterSnapshot = () => {
    const encounter = coreEncounterSnapshot();
    Object.defineProperty(encounter, 'wolf', {
      enumerable: false,
      value: encounter.enemies.find((enemy) => enemy.kind === 'wolf') ?? null,
    });
    return encounter;
  };
  return simulation;
}
