# AINV1 — Full Asset Bank Reconciliation + Animation Source Recovery

**Package class:** L — checkpointed production/asset vertical
**Owning issue:** #102
**Base:** `main@2ddbd6e2afbd7287df988d4327f8218ff166ed6d`
**Branch:** `chore/asset-bank-reconciliation-20260829`

## Objective

Establish truthful identity, custody, structure, provenance, semantic facets and next action for the
existing GalaQuest asset bank, and recover the existing `hdUs9c` Hero animation source when current
read-only custody/provider access makes that possible. This package inventories and preserves; it does
not promote assets or retarget animation.

## Included surfaces

- Freeze and structurally inspect the 12-file 2026-08-29 Drive intake.
- Reconcile canonical registry evidence against public Git, historical registry evidence, the broader
  Drive archive and surviving read-only provider metadata.
- Add only the schema-backed semantic facets/disposition needed to make the registry filterable and
  operational; regenerate the canonical registry deterministically.
- Resolve and, if available without a write/paid provider operation, archive the exact `hdUs9c`
  animation source and publish a machine-readable clip/source-rig manifest.
- Add deterministic tooling and red-capable tests only where the existing tools cannot prove the
  required evidence.

## Explicit exclusions

No gameplay integration, asset promotion, runtime animation changes, retargeting, Hero rig changes,
provider generation/rigging/animation/remesh/retexture/conversion, bulk raw binary commits, historical
inventory rewrite, or unrelated PR #85/#86/#101 repair. Provider spend is zero.

## Acceptance gates

The final handoff reports intake completeness, Drive custody, all intake identities, full-bank and
duplicate reconciliation, semantic tagging, deterministic canonical output, exact `hdUs9c` identity,
source recovery, clip inventory/extraction, zero spend, the registry gate and the unit gate as
`PASS`, `FAIL`, or `UNKNOWN`. Qualification and Owner visual acceptance remain independent and are not
implied by inventory facts.

## Checkpoint plan

1. **AINV1-C1:** Freeze all 12 Drive records, hash and structurally measure source bytes, and identify
   timestamp-only models only where inspection supports the identity.
2. **AINV1-C2:** Reconcile the full known bank; add stable identities, aliases/duplicate links, semantic
   facets, custody and next actions to mutable evidence; deterministically rebuild the registry.
3. **AINV1-C3:** Conclude `hdUs9c` as recovered with manifest/Drive custody, or not currently
   recoverable with exact evidence and required Owner access/action.
4. **AINV1-C4:** Run exact-head gates, push, open the draft PR, and publish the fixed-point handoff.

## Side-quest destination

Asset-specific implementation or qualification findings remain on their existing Issues (#35 pets,
#44 gear, #47 enemies, #90 Beacon, #91 world richness, #96 NPC cast). Any viable animation reuse is a
separate bounded Animation Lab package following source-rig compatibility evidence and running-game
acceptance.
