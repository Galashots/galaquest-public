# Progression A3-S1 — Spriggan Scrapper Qualification

**Task-ID:** `PROG-A3-S1-SPRIGGAN-QUALIFICATION`  
**Package size:** **M — Coupled asset qualification**  
**Worker:** **Terra / Codex — single asset write-worker**  
**Director:** ChatGPT / GalaQuest Production Director  
**Repository:** `Galashots/galaquest-public`  
**Starting public fixed point:** `main@ee2c5e60a29c6c2e6572ad3d0d0b8d36aff33885`  
**Branch:** `asset/a3-s1-spriggan-qualification`  
**Owning product record:** #47 Enemy variety for the progression push  
**Upstream evidence:** A2 Director adjudication on #47  
**Specialist discipline:** browser-game GLB/glTF asset pipeline

## Objective

Turn **Spriggan Scrapper** from a recoverable Wave-1 candidate into a decision-grade, technically qualified input for later E3 enemy-archetype work — or produce a decisive evidence-backed rejection — without integrating it into gameplay, creating new provider work, or promoting it to production.

A3-S1 is the first bounded asset-processing/write trial for Terra. Success means the Director can answer:

1. are the exact source bytes and existing locomotion outputs recoverable and provenance-linked;
2. can the known raw Meshy material defect be corrected through the existing asset pipeline without runtime hacks;
3. is the rig/deformation acceptable for the existing walk/run outputs at inspection scale;
4. what are the real payload/geometry/texture costs after the smallest justified cleanup;
5. does the asset still look like a strong fast/fragile skirmisher lead;
6. what animation/content gaps remain before E3;
7. should Spriggan advance, require a bounded follow-up, or be rejected.

This package does **not** make Spriggan a shipping enemy.

## Locked package contract

`qualify one selected enemy -> M -> exact custody recovery + material cleanup + existing locomotion recovery/inspection + bounded web-runtime asset profiling + durable qualification evidence -> no gameplay integration/new animation/provider jobs/new generation -> two checkpoints -> Director visual/technical audit -> side quests stay on #47`

## Starting evidence

A2 established the following as evidence to verify, not blindly repeat:

- candidate: `spriggan-scrapper-v1.glb`;
- historical source branch: `feat/enemy-asset-wave-1` / PR #28;
- Image-to-3D task: `01a022c2-f4a4-7134-b2a7-190684b04449`;
- rig task: `01a022c5-8fb4-71c3-ac86-db31b0fa497d`;
- base candidate was recorded at ~8.21 MB, one mesh, one skin, 24 joints;
- A2 measured roughly 26.1k triangles and a 2048² embedded texture;
- raw Wave-1 candidates have the known Meshy flooded-emissive/PBR-default material defect and remain quarantined;
- provider walk/run outputs were recorded as having been created but were intentionally not committed to Git;
- running-game visual/deformation acceptance is still UNKNOWN;
- no attack/hit/death animation is currently proven.

Refresh and verify these facts against current repo/archive evidence before processing.

## Source and custody rules

### Preserve originals

Never overwrite, rename destructively, delete, or silently replace the archived source GLB or historical Git blob.

Verify source identity against the durable repository inventory/provenance record before using it. Record at minimum:

- source location actually used;
- SHA-256;
- byte size;
- historical Git blob/source-branch identity when available;
- provider task identities already recorded by the repo.

A mismatch is a STOP condition until reconciled.

### External asset storage

The 2026-08-21 asset-platform consolidation intentionally moved large raw candidate GLBs out of current `main`.

Do **not** reintroduce large raw/derived GLB files into Git merely because this branch exists.

Use an existing GalaQuest asset-working/archive location on Google Drive or a clearly bounded local working directory for source and derivative GLBs. If creating a Drive derivative location, create a new clearly named A3/Spriggan working/output folder and leave archive originals unchanged.

The Git branch should contain only durable, reviewable authority/evidence appropriate for source control, such as:

- this brief;
- qualification report/manifest;
- small scripts/tests if genuinely reusable and scoped;
- small visual evidence files only when repo conventions and file sizes make that sensible.

Do not commit multi-megabyte candidate GLBs without an explicit Director reforecast.

## No provider-generation authority

A3-S1 authorizes **zero new Meshy/provider jobs and zero credit spend**.

You may recover already-existing files from Git/Drive/local project custody. If already-generated walk/run outputs are directly downloadable/recoverable without creating a new provider task, recovery is allowed. Do not request/regenerate them if retrieval would create a new provider job or spend credits.

If provider access is unavailable, mark that evidence UNKNOWN and use the repository/Drive evidence available. Do not substitute a newly generated animation.

The Owner's future Meshy default — Smart Topology + Meshy T2-style game-ready generation rather than the ultra-detailed/high-end model path — is not relevant authority to generate anything in this package.

## Specialist pipeline discipline

Follow the repo's current asset authorities and browser-game GLB/glTF pipeline. Where available, use the Web 3D Asset Pipeline skill/guidance.

Default principles:

- GLB/glTF 2.0 remains the runtime asset format;
- transforms, units, pivots, hierarchy and naming must remain predictable;
- do not make runtime code compensate for an asset defect that belongs in the asset;
- optimize only where evidence warrants it;
- do not introduce compression/extensions requiring new runtime-loader code inside this package;
- preserve rig/skeleton compatibility when producing derivatives;
- machine metrics may reject an asset, but they do not visually accept it.

## Checkpoint C1 — Exact source + material-safe derivative

C1 should establish the smallest technically clean Spriggan candidate before motion review.

### Required work

1. Recover and verify the exact base rigged Spriggan source.
2. Inspect current repo material-normalization conventions before inventing a new path.
3. Produce a **reversible derivative**, external to Git if large, that corrects the known raw Meshy emissive/PBR defect.
4. Preserve mesh/skin/joint hierarchy unless a change is genuinely necessary and explicitly reported.
5. Do not do major remeshing, retopology, skeleton changes, or artistic redesign.
6. Perform only bounded payload cleanup that is clearly safe under existing runtime support, such as pruning/deduplication or sensible texture resizing/re-encoding where it produces a material win without requiring loader changes.
7. Record before/after metrics and hashes.

### C1 measurements

At minimum record:

- bytes;
- vertices/triangles;
- meshes/nodes;
- skins/joints;
- animations and durations present in the base file;
- materials/textures/images;
- texture dimensions/encoding;
- local bounds;
- transforms/pivot/orientation observations;
- material values before/after relevant to the quarantine defect;
- whether glTF validation passes.

### C1 restraint

Spriggan's ~26k-triangle geometry is not permission to start a speculative remesh project.

If repeated-mob use appears performance-risky, measure/profile it and report the need for a later optimization slice. Do not distort the model merely to hit an invented polygon number.

Commit/push a C1 checkpoint only after the derivative and evidence are internally consistent. Do not commit the large GLB unless separately reforecast.

## Checkpoint C2 — Existing locomotion + visual/deformation/performance qualification

### Existing locomotion recovery

Attempt to recover the **already-produced** walk/run outputs from existing project custody/provider output.

For each recovered motion file:

- verify identity/custody;
- inspect clip duration and channels;
- compare skeleton/joint compatibility with the selected base derivative;
- inspect root motion/orientation/scale;
- verify whether the motion can be applied/reused cleanly without rig surgery.

No attack/hit/death/cast generation is authorized.

### Visual/deformation evidence

Produce enough evidence for Director review, ideally including:

- neutral front/3-quarter/side/back inspection renders;
- walk deformation samples across the cycle;
- run deformation samples across the cycle;
- a gameplay-distance or equivalent small-on-screen inspection view;
- any obvious clipping, foot sliding, limb collapse, scale, silhouette or orientation concern.

You may reject an asset based on obvious defects. Do not call final appearance PASS solely from numeric measurements.

### Runtime/performance evidence

Use the cheapest bounded method available to establish browser suitability without integrating Spriggan into the shipping enemy registry.

Useful evidence may include:

- GLTFLoader parse/load smoke;
- material/texture GPU-cost observations available from a temporary inspection harness;
- draw calls/material count;
- payload/decode/load time where practical;
- memory/texture implications;
- simple repeated-instance stress at inspection scale if it does not require production runtime changes.

Do not modify enemy AI, combat state, protocol, spawn logic, world geography, XP, drops or nameplates.

## Final disposition

End A3-S1 with exactly one recommendation:

### `ADVANCE TO E3 INPUT`
Use only if:
- source/custody is sound;
- material quarantine defect has a bounded clean solution;
- locomotion is recoverable and deformation is acceptable enough for later gameplay work;
- performance/payload is plausible for the intended role or has a clearly bounded known optimization need;
- no major rig/art rewrite is required;
- visual evidence still supports Spriggan as a meaningful non-wolf skirmisher candidate.

### `ADVANCE AFTER BOUNDED FOLLOW-UP`
Use when the asset is still strong but one clearly separable task remains, such as a focused optimization pass or missing locomotion retrieval.

### `REJECT / REPLACE LEAD`
Use when the visual, rig, custody, material, deformation or runtime cost makes Spriggan a poor near-term choice. Do not rescue it through unbounded work merely because A2 ranked it first.

## Expected write surface

Allowed, as needed:

- `docs/asset-production/**` for A3-S1 qualification evidence/manifest;
- small bounded asset-inspection scripts/tests under existing repo conventions;
- small evidence images under an existing evidence convention if appropriate;
- PR #57 metadata/comments once created;
- external/Drive A3 working derivatives, without altering source archive files.

Do not edit:

- P2 branch/files;
- `net/**`;
- progression/combat/gameplay source;
- enemy runtime registries/spawn/AI;
- world/zones;
- gear/pet systems;
- production asset manifests in a way that declares Spriggan promoted/shipping.

If an existing shared asset helper truly must change, stop and reforecast before editing it unless the change is demonstrably asset-only, backward-compatible, and within this package.

## Explicit exclusions

A3-S1 does not include:

- E1 enemy collection architecture;
- E2 population/levels/nameplates/safety;
- E3 combat-archetype implementation;
- enemy XP or loot;
- attack/hit/death/cast animation creation;
- new rigging or skeleton design;
- major geometry remesh/retopology;
- new texture/art direction;
- provider generation or spend;
- Magmahorn/Graveflame qualification;
- public/runtime promotion;
- geography expansion;
- unrelated asset cleanup.

## Acceptance gates

1. **Source identity:** PASS / FAIL / UNKNOWN.
2. **Material quarantine resolution:** PASS / FAIL / UNKNOWN.
3. **Structural/GLB validation:** PASS / FAIL.
4. **Existing walk/run recovery:** PASS / FAIL / UNKNOWN.
5. **Rig/motion compatibility:** PASS / FAIL / UNKNOWN.
6. **Inspection-scale visual/deformation evidence:** produced and reviewed by worker; final Director judgment remains separate.
7. **Performance/payload classification:** PASS for intended use / bounded follow-up / FAIL.
8. **No runtime integration/provider spend:** PASS.
9. `node --test test/*.test.mjs` PASS for any repo changes that can affect checked-in tests/guidance.
10. `git diff --check` PASS.
11. Hosted protected `unit` PASS on final PR merge result/head as applicable before any merge recommendation.
12. **Production promotion:** NOT AUTHORIZED / not part of this package.

## Checkpoint plan

### A3-S1-C1
Exact source verified; clean material-safe derivative produced externally; before/after metrics and hash evidence recorded; no major scope expansion.

### A3-S1-C2 / final
Existing walk/run recovered if possible; deformation/visual/performance evidence produced; exact final disposition recorded; durable report committed and pushed.

## Stop / reforecast conditions

Stop and report before broadening if:

- the recovered base bytes do not match the durable inventory;
- only a new provider task can obtain required locomotion;
- material correction would require changing production runtime code;
- a new loader/compression extension is required;
- the rig/skeleton must be rebuilt;
- major remeshing/retopology becomes necessary;
- source/provenance becomes materially uncertain;
- a large GLB would need to be committed against the external-archive convention;
- the package begins implementing combat/AI/E3 behavior;
- another writer is active on this branch;
- paid provider work appears useful.

## Side-quest routing

- Spriggan bounded optimization -> #47 / future A3 follow-up.
- Missing attack/hit/death animations -> #47 / future selected-enemy animation package.
- Magmahorn qualification -> later A3-S2 after Spriggan result.
- Graveflame/ranged viability -> later A3-S3 only if still warranted.
- runtime archetype implementation -> E3.
- general asset-pipeline lesson -> existing asset/pipeline authority only if genuinely reusable.

## Worker report

Return a concise `GQ-WORKER-REPORT v1` containing:

- starting main SHA and branch starting SHA;
- C1 exact SHA and evidence summary;
- final exact SHA;
- repo files changed;
- external/Drive source + derivative locations without moving originals;
- source/derivative hashes and key metrics;
- exact material correction performed;
- walk/run recovery result and identity;
- deformation/visual evidence paths;
- performance/payload classification;
- final disposition: `ADVANCE TO E3 INPUT`, `ADVANCE AFTER BOUNDED FOLLOW-UP`, or `REJECT / REPLACE LEAD`;
- all gates PASS/FAIL/UNKNOWN;
- tests and `git diff --check` results;
- side quests deliberately not implemented;
- confirmation of zero new provider jobs/credit spend, zero runtime integration, zero production promotion, no merge/close/force-push/main write.
