// E1 C2 compatibility shell.
//
// protocolCore.js is the actual v4 protocol: decode is collection-only and rejects literal
// encounter.wolf bytes. A few older in-process callers still pass a singular Wolf object INTO the
// shared message builders, so this shell canonicalizes that builder input before the core serializes
// it. The emitted v4 bytes have enemies[] only. C3 removes this shell when those callers/readers are
// migrated to stable IDs.

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
