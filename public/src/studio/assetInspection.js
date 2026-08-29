/**
 * Studio Inspect facts (#92 STUDIO-V2A). Framework-free, pure data shaping: takes one augmented
 * registry record (as net/registryApi.mjs serves it) and returns exactly the facts Issue #92 asks
 * Inspect to show -- nothing invented, nothing defaulted. A field the registry records as the
 * literal string "UNKNOWN" is passed through as "UNKNOWN"; it is never coerced to 0, null, or
 * omitted, because a silent default is exactly the failure mode this surface exists to prevent.
 */

/** `declared` facts come straight from the registry; nothing here is measured from real bytes. */
export function buildInspectionFacts(record) {
  if (!record) return null;
  return Object.freeze({
    assetId: record.asset_id,
    displayName: record.display_name,
    kind: record.asset_kind,
    lifecycle: record.lifecycle,
    nextAction: record.next_action,
    custody: record.custody,
    recoverability: record.recoverability,
    custodyLocations: Object.freeze((record.custody_locations ?? []).map((loc) => Object.freeze({ ...loc }))),
    source: Object.freeze({ ...record.source }),
    runtimeAvailability: record.runtime_availability ? Object.freeze({ ...record.runtime_availability }) : null,
    declaredStructuralMetrics: Object.freeze({ ...record.structural_metrics }),
    measuredStructuralMetrics: null,
    rights: Object.freeze({
      provenance: Object.freeze({ ...record.rights?.provenance }),
      license: Object.freeze({ ...record.rights?.license }),
      usageRights: Object.freeze({ ...record.rights?.usage_rights }),
    }),
    parentAssetId: record.parent_asset_id ?? null,
    derivativeOf: record.derivative_of ?? null,
    relatedAssetIds: [...(record.related_asset_ids ?? [])],
    aliases: [...(record.aliases ?? [])],
    qualificationGates: Object.freeze(
      Object.fromEntries(
        Object.entries(record.qualification_gates ?? {}).map(([name, gate]) => [name, Object.freeze({ ...gate })]),
      ),
    ),
    evidenceRefs: [...(record.evidence_refs ?? [])],
    notes: record.notes ?? null,
  });
}

/**
 * Merges structural facts actually MEASURED from loaded bytes in this runtime (scene.js's
 * `loadGenericAsset`) into the declared facts above, without ever touching or hiding the declared
 * (registry) values -- a caller can always tell "what the registry says" from "what this session
 * actually measured" rather than one field silently overwriting the other.
 */
export function mergeMeasuredFacts(facts, measured) {
  if (!facts) return facts;
  return Object.freeze({
    ...facts,
    measuredStructuralMetrics: measured ? Object.freeze({ ...measured }) : null,
  });
}
