// Presentation ownership for ordinary enemies. The simulation/network own enemy truth; this module
// owns only the visual object keyed by that truth's stable enemyId.
//
// `createPresenter(enemy)` has three deliberate outcomes:
//   presenter object -> this id has a visual; keep it until the id disappears or its kind changes
//   null             -> this kind has no presenter; leave it invisible without inventing one
//   undefined        -> presenter resources are not ready yet; retry on a later frame
//
// No array position ever participates in identity. Reordering a serialized collection therefore
// cannot swap animation state, hit flashes, or disposal between enemies.

function disposePresenter(presenter) {
  presenter?.dispose?.();
}

export function createEnemyPresenterRegistry({ createPresenter } = {}) {
  if (typeof createPresenter !== 'function') throw new TypeError('createPresenter must be a function');

  const byId = new Map();

  function update(deltaSeconds, enemies = []) {
    if (!Array.isArray(enemies)) throw new TypeError('enemies must be an array');
    const seen = new Set();

    for (const enemy of enemies) {
      const enemyId = enemy?.enemyId;
      const kind = enemy?.kind;
      if (typeof enemyId !== 'string' || enemyId.length === 0) {
        throw new TypeError('every enemy presenter requires a non-empty enemyId');
      }
      if (typeof kind !== 'string' || kind.length === 0) {
        throw new TypeError(`enemy ${enemyId} requires a non-empty kind`);
      }
      if (seen.has(enemyId)) throw new Error(`duplicate enemyId in presenter update: ${enemyId}`);
      seen.add(enemyId);

      let entry = byId.get(enemyId);
      if (entry && entry.kind !== kind) {
        disposePresenter(entry.presenter);
        byId.delete(enemyId);
        entry = null;
      }

      if (!entry) {
        const presenter = createPresenter(enemy);
        if (presenter === undefined || presenter === null) continue;
        entry = { kind, presenter };
        byId.set(enemyId, entry);
      }

      entry.presenter.update?.(deltaSeconds, enemy);
    }

    for (const [enemyId, entry] of byId) {
      if (seen.has(enemyId)) continue;
      disposePresenter(entry.presenter);
      byId.delete(enemyId);
    }
  }

  return {
    update,
    get(enemyId) {
      return byId.get(enemyId)?.presenter ?? null;
    },
    describe() {
      return [...byId.entries()].map(([enemyId, entry]) => ({
        enemyId,
        kind: entry.kind,
        state: entry.presenter.getState?.() ?? null,
      }));
    },
    dispose() {
      for (const entry of byId.values()) disposePresenter(entry.presenter);
      byId.clear();
    },
    get count() {
      return byId.size;
    },
  };
}
