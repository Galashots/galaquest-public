// Final E1 compatibility adapter.
//
// protocolCore.js is the v4 authority: decode is collection-only and rejects literal encounter.wolf
// bytes. A few older in-process fixtures still pass a legacy Wolf-shaped object into the shared
// message builders, so this adapter canonicalizes that input before the core serializes it. The
// emitted v4 bytes always have enemies[] only; this is a one-way fixture boundary, not a second
// mutable Wolf authority. Removing it would cause broad, unrelated fixture churn without changing
// the wire contract.

export * from './protocolCore.js';
import {
  snapshotMessage as coreSnapshotMessage,
  welcomeMessage as coreWelcomeMessage,
} from './protocolCore.js';

function canonicalEncounterForBuilder(encounter) {
  if (encounter?.enemies !== undefined || encounter?.wolf === undefined) return encounter;
  const { wolf, ...rest } = encounter;
  return {
    ...rest,
    enemies: wolf == null ? [] : [{ enemyId: 'wolf-1', kind: 'wolf', ...wolf }],
  };
}

export function welcomeMessage(id, tick, players, encounter, profileFacts) {
  if (encounter === undefined) return coreWelcomeMessage(id, tick, players, encounter, profileFacts);
  return coreWelcomeMessage(id, tick, players, canonicalEncounterForBuilder(encounter), profileFacts);
}

export function snapshotMessage(tick, players, encounter, events) {
  if (encounter === undefined) return coreSnapshotMessage(tick, players, encounter, events);
  return coreSnapshotMessage(tick, players, canonicalEncounterForBuilder(encounter), events);
}
