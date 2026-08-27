// Final E1 compatibility adapter.
//
// gameServerCore.mjs owns the collection-shaped simulation and wire snapshot. A small set of older
// in-process fixtures still read createSimulation().encounterSnapshot().wolf, so this public entry
// point exposes only a non-enumerable view derived from the kind:'wolf' entry in enemies[] for
// older single-Wolf fixtures.
// attachGameServer is re-exported unchanged and the adapter never publishes or mutates a singular
// Wolf field on the wire. Removing this boundary would create broad, unrelated fixture churn while
// preserving no additional authority.

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
