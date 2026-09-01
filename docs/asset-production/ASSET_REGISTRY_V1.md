# GalaQuest Asset Registry v1

`asset-registry-v1.json` is the current canonical inventory. The dated
`asset-platform-inventory.json` remains historical consolidation evidence and
is intentionally not rewritten; `candidate-registry.json` remains local R&D
evidence.

Every logical asset has a stable semantic `asset_id` that is independent of its
physical path. `asset-registry-v1.evidence.json` is the checked-in Package A
snapshot input for mutable observations and the runtime path-to-identity map;
a rename or move changes the path mapping, not the logical identity.

Every record carries deterministic semantic `facets`, one operational
`next_action`, filename/provider `aliases`, and explicit `related_asset_ids`.
Facets contain only known facts and do not duplicate `asset_kind` or lifecycle;
`next_action` never upgrades an independent qualification gate.

Custody is explicit and multi-location: records can retain historical Git refs,
repo paths, Git blob OIDs, Drive file IDs/URLs/archive paths, current runtime
Git paths, provider context, and local-only evidence without treating a local
copy as durable. Qualification gates are independent `{status,evidence_refs}`
objects. A GLB extension or presence under `public/assets` proves neither
structural nor runtime qualification. Unproven gates remain `UNKNOWN`.

Structural metrics are explicit, using `UNKNOWN` or `N/A` when a measurement is
not available. Provenance, licensing, and usage-rights facts are separate; no
license or right is inferred from file location, provider identity, or a
successful technical gate.

Provider reconciliation is a dated GET-only evidence snapshot. Refresh
`asset-registry-v1.evidence.json` deliberately before treating provider state as
current. No replacement task is created by the registry generator and the
builder performs no provider calls.

The current Drive intake evidence is `ASSET_INTAKE_2026-08-29.json`.
`HDUS9C_ANIMATION_SOURCE_RECOVERY.json` records the separate read-only animation
source recovery conclusion. Neither file promotes raw binaries into the public
runtime tree.

## Package B interface

Animation Lab v1 consumes registry records and emits evidence references for
source/target rig identity, rest-pose compatibility, clip/root-motion
inspection, visual playback, export hashes, and independent qualification
gates. Authoring, retarget promotion, and runtime integration remain outside
this package.

Run the deterministic generator after a deliberate evidence, inventory, or
public-asset change, then run the schema-backed registry test:

```text
node tools/asset-registry/build-registry.mjs
node --test test/asset-registry-v1.test.mjs
```
