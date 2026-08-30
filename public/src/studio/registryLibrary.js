/**
 * Studio Library filtering/search (#92 STUDIO-V2A). Framework-free (no DOM, no THREE, no fetch) so
 * it is directly unit-testable in Node against the same records net/registryApi.mjs serves.
 *
 * This module is the whole "registry-driven, not a hand-maintained rack" contract: every filter
 * value and every summarized field is READ from a record the canonical registry actually produced.
 * Nothing here hand-types a second copy of the catalogue -- filterOptions() derives its own
 * dropdown values from the records it is given, the same GQ-007 convention the rest of Studio's
 * menus already follow (loadoutDescriptors.js, cameraPresets.js).
 */

/** Stable identity is asset_id -- never a provider filename, never a display label. */
export function assetId(record) {
  return record.asset_id;
}

/**
 * The compact shape the Library list/menu renders. Pulls only fields the registry already has;
 * never invents a status. `loadable`/`runtimeUrl`/`unavailableReason` come from the server's live
 * `runtime_availability` augmentation -- when a record has not gone through that augmentation (e.g.
 * a raw canonical-file fixture in a test), loadability is explicitly reported unknown rather than
 * guessed true or false.
 */
export function summarizeAsset(record) {
  const availability = record.runtime_availability ?? null;
  return Object.freeze({
    assetId: record.asset_id,
    displayName: record.display_name,
    kind: record.asset_kind,
    lifecycle: record.lifecycle,
    nextAction: record.next_action,
    custody: record.custody,
    recoverability: record.recoverability,
    facets: [...(record.facets ?? [])],
    loadable: availability ? availability.loadable : 'UNKNOWN',
    runtimeUrl: availability ? availability.runtimeUrl : null,
    unavailableReason: availability && !availability.loadable ? availability.reason : null,
  });
}

function matchesText(record, query) {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    record.asset_id,
    record.display_name,
    ...(record.facets ?? []),
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(needle);
}

/**
 * `filter` fields are all optional and all drawn from fields the registry already has:
 * `kind` -> asset_kind, `facet` -> one entry of facets[], `lifecycle`, `nextAction` -> next_action,
 * `custody`, `loadableOnly` -> runtime_availability.loadable, `query` -> free-text search.
 */
export function filterAssets(records, filter = {}) {
  const { kind, facet, lifecycle, nextAction, custody, loadableOnly, query } = filter;
  return records.filter((record) => {
    if (kind && record.asset_kind !== kind) return false;
    if (facet && !(record.facets ?? []).includes(facet)) return false;
    if (lifecycle && record.lifecycle !== lifecycle) return false;
    if (nextAction && record.next_action !== nextAction) return false;
    if (custody && record.custody !== custody) return false;
    if (loadableOnly && !(record.runtime_availability?.loadable)) return false;
    if (!matchesText(record, query)) return false;
    return true;
  });
}

/** Derives menu options from the records themselves -- never a hand-typed enum living twice. */
export function filterOptions(records) {
  const kinds = new Set();
  const facets = new Set();
  const lifecycles = new Set();
  const nextActions = new Set();
  const custodies = new Set();
  for (const record of records) {
    if (record.asset_kind) kinds.add(record.asset_kind);
    for (const facet of record.facets ?? []) facets.add(facet);
    if (record.lifecycle) lifecycles.add(record.lifecycle);
    if (record.next_action) nextActions.add(record.next_action);
    if (record.custody) custodies.add(record.custody);
  }
  return Object.freeze({
    kinds: [...kinds].sort(),
    facets: [...facets].sort(),
    lifecycles: [...lifecycles].sort(),
    nextActions: [...nextActions].sort(),
    custodies: [...custodies].sort(),
  });
}

/** Fail-closed lookup by stable asset_id -- null on miss, never a guessed nearest match. */
export function findAssetById(records, id) {
  return records.find((record) => record.asset_id === id) ?? null;
}
