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

## Qualification entrypoint and receipt

Use the existing semantic identity, not a provider filename, to start read-only qualification:

```text
node tools/asset-registry/qualify-asset.mjs --id enemy.wolf --purpose "Enemy movement review" --reference docs/GALAQUEST_VISUAL_AUTHORITY.md
node tools/asset-registry/qualify-asset.mjs --id gear.shield.ironwood --class rigid-gear
node tools/asset-registry/qualify-asset.mjs --id prop.village.cart --class rigid-prop
node tools/asset-registry/qualify-asset.mjs --verify <receipt.json>
```

`--source` names a recovered file already staged in the owned checkout; its hash must match
this registry. `--candidate` names a derivative without claiming proven ancestry. Generic model
and gear records require an explicit class; deformable gear is not the rigid lane. `--clip`
(repeatable) runs the existing strict native-clip check against the candidate body. `--root`
opts into root-motion measurement using the actual root name, never a guessed humanoid default.

Repeat `--reference` for controlling comparison files and `--evidence` for recipes and existing
Unity provenance/review manifests, importer settings, materials, prefabs, scenes and captures.
The entrypoint hashes those files and observed `.meta` companions; it does NOT discover Unity's
whole dependency graph or validate the contents of a review claim. Preserve the dependency set
from the existing Unity capture/import tooling. A GLB hash alone cannot bind a changed mount.

`--out .local/<new-receipt>.json` (or an ignored `tmp/` path) requires an existing parent and
refuses overwrite. The receipt binds registry, sources, candidate resources, tools, authority,
checkout/runtime state and diagnostics. Missing inputs remain UNKNOWN. Re-run after changes;
`--verify` detects changed listed inputs and accidental receipt edits, not malicious forgery.
Keep useful receipts in the existing PR/Drive custody route; this is not another registry.

Exit 1 means rejection/error; 2 means incomplete/UNKNOWN. Exit 0 is possible only for matching
receipt bindings, not asset acceptance. Historical PASS and attached PASS text never become
fresh qualification. The Hero budget printer may emit FAIL with exit 0; its contract is not a
universal prop limit. Specialist and human gates remain separate. No importing, transformation,
registry mutation, upload, provider call or promotion is performed by this entrypoint.

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
