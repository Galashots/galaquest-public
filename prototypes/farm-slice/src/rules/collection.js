// Pure collection-book rules. No three.js, no DOM.
// Undiscovered creatures render as silhouettes in the UI layer; here we only
// track which ids are owned and what name (if any) the child gave them.

export function createCollectionState() {
  return { owned: {}, names: {}, fed: {}, bred: {} };
}

export function isDiscovered(collectionState, creatureId) {
  return !!collectionState.owned[creatureId];
}

export function discoverCreature(collectionState, creatureId) {
  if (collectionState.owned[creatureId]) return collectionState;
  return { ...collectionState, owned: { ...collectionState.owned, [creatureId]: true } };
}

/** Name a discovered creature. No-op if it hasn't been discovered yet. */
export function nameCreature(collectionState, creatureId, name) {
  if (!collectionState.owned[creatureId]) return collectionState;
  const trimmed = String(name || '').trim().slice(0, 12);
  if (!trimmed) return collectionState;
  return { ...collectionState, names: { ...collectionState.names, [creatureId]: trimmed } };
}

export function getName(collectionState, creatureId, fallbackName) {
  return collectionState.names[creatureId] || fallbackName;
}

/** Feeding is a gentle, ungated loop-tease (CONTRACT.md 5.1): it just counts up. */
export function feedCreature(collectionState, creatureId) {
  if (!collectionState.owned[creatureId]) return collectionState;
  const fed = { ...collectionState.fed, [creatureId]: (collectionState.fed[creatureId] || 0) + 1 };
  return { ...collectionState, fed };
}

export function getFedCount(collectionState, creatureId) {
  return collectionState.fed[creatureId] || 0;
}

/**
 * Record a breeding-hatched creature: it becomes owned, and its resolved
 * traits (element, shape, rarity, colors) are kept so the shell can render
 * and re-breed it exactly as hatched. No-op if the id is already owned.
 */
export function recordBredCreature(collectionState, creatureId, traits) {
  if (!creatureId || collectionState.owned[creatureId]) return collectionState;
  return {
    ...collectionState,
    owned: { ...collectionState.owned, [creatureId]: true },
    bred: { ...(collectionState.bred || {}), [creatureId]: { ...traits } },
  };
}

/**
 * The visible traits of any owned creature instance: content creatures look
 * up CREATURES, bred creatures use their recorded hatch traits. Returns null
 * for unowned or unknown ids.
 */
export function creatureTraits(collectionState, creatureId, creaturesList) {
  if (!collectionState.owned[creatureId]) return null;
  const bred = (collectionState.bred || {})[creatureId];
  if (bred) return { id: creatureId, ...bred };
  const def = (creaturesList || []).find((c) => c.id === creatureId);
  if (!def) return null;
  return {
    id: def.id,
    element: def.element,
    shape: def.shape,
    rarity: def.rarity,
    colors: { ...def.colors },
  };
}
