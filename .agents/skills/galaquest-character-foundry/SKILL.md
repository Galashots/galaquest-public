---
name: galaquest-character-foundry
description: Use for GalaQuest 3D character work involving identity references, proportions, topology, canonical meshes, rigging or retargeting, modular armour, character materials and textures, LOD budgets, animation coverage, GLB export, or character validation. Enforces the repository's live contracts, evidence rules, and owner-decision boundaries.
---

# GalaQuest Character Foundry

Use the public repository as the durable source of truth for GQ character production. Keep measured facts, hypotheses, and owner decisions visibly separate, and stop when a required owner decision is unresolved.

## Start here

0. **If the task involves how anything LOOKS — how gear is carried, how armour sits, how a pose
   reads — invoke the `visual-reference-first` skill and inspect reference images BEFORE writing any
   orientation or offset value.** Presentation is convention, and convention is observed, never
   derived. A shield fitted to the hand instead of the forearm cost three internally consistent
   wrong solves on 2026-08-12.
1. Run `git status --short --branch` and inspect the existing diff. Preserve unrelated and unfinished work.
2. Read [references/authority-map.md](references/authority-map.md), then open every public source it marks required for the task.
3. Re-read the live public contract instead of copying values from this skill: [`hero_contract.json`](../../../docs/teardown/hero_contract.json). If a document claims a companion authority exists, verify the path before relying on it.
4. Classify every important claim as **measured fact**, **hypothesis**, or **owner decision/directive**. Use the contract's provenance/status vocabulary when writing contract artifacts.
5. Identify unresolved owner decisions before planning production. Do not cross a decision boundary by selecting a candidate, midpoint, threshold, topology target, or source pack yourself.

Public repository contracts and exact-SHA runtime evidence override plans, chat history, comparison packs, and generic guidance. Private archive material is provenance/source only when a bounded task explicitly needs it; it is never a startup prerequisite.

## Production guardrails

### Identity, reference art, and proportions

- AI-generated character art carries identity and taste only to the extent the current public visual authority records it. Orthographic-looking generated views are advisory design references, not calibrated dimensions or traceable geometry.
- The numeric contract and approved canonical 3D model are geometric authority. Once approved, reference art cannot silently override the model.
- Use only a proportion decision that the public repository records as locked. Never infer lock from a candidate page, render, draft measurement, or old working value.
- If a required value remains open in the contract, label it **unresolved** and stop before contract or production-geometry changes that would silently decide it.

### Topology and authored source

- Start from one canonical authored topology template per qualified body family. Keep connectivity and vertex ordering fixed inside that family.
- Procedural code moves vertices using semantic landmarks and cross-sections; it does not generate arbitrary humanoid topology from ring counts or add/remove loops for morphology changes.
- Never restore retired projection-cluster measurements as edge-loop targets. Comparative quad ratios are not GQ targets either.
- The editable approved authoring source is topology authority. The triangulated GLB is the shipping artifact and cannot audit quad flow.
- A substantially different anatomy or proportion envelope requires a new qualified topology family, not an extreme parameter.

### Rigging and modular equipment

- GQ owns the canonical runtime skeleton. External animation rigs and libraries retarget into it only after compatibility is proven.
- Four meaningful, normalized skin influences per vertex is the current hard shipping cap. Imported/source assets may exceed four only before pruning, renormalization, deformation comparison, and shipped-GLB validation.
- Keep bone, socket, pivot, axis, bind-pose, scale, and coordinate naming deterministic. Do not improvise names per asset.
- Classify gear before authoring: rigid attachment, deforming garment, or hybrid. Do not smooth-skin an item merely because it occupies an armour slot.
- **Before solving any attachment transform, look up how the item is actually carried.** Write the convention down before writing numbers. A shield straps to the outside of the forearm; it is not gripped in the fist. See the `visual-reference-first` skill.
- Full-cover gear declares covered body regions, which are hidden. Adjacent garments overlap below visible seams. Every deforming item uses the canonical bind pose, skeleton version, and world scale.
- Encode compatibility explicitly: hair/helmet policy, shoulder/head clearance, cape/back-weapon volumes, socket dependencies, body-family qualification, coverage, and visibility interactions.

### Surface, LOD, and shipping

- GQ is texture-primary. Use the current common character material/shader family; vertex colour is optional modulation, never the artwork.
- Read current atlas, texture-count, payload, material, draw, and LOD limits from the live contract and tests. Do not copy old planning values.
- Track material count, glTF primitive count, and runtime draw submissions separately; none is a proxy for another.
- Count visible equipped geometry exactly as the contract defines it, excluding body regions hidden by full-cover gear.
- Third-party measurements are comparative baselines only. Never promote their triangles, joints, proportions, quad ratios, atlas sizes, slot spans, or other measurements into a GQ target without explicit evidence and owner approval.

### Movement and validation

- Preserve viability for tab-target combat from the start. Do not assume a downloaded pack supplies the required movement and casting set.
- Keep documented animation gaps open until real clips are sourced or authored, retargeted, and validated.
- Gameplay-size renders validate silhouette and readability only. They do not validate topology or deformation.
- Use inspection renders plus the approved deformation stress suite for geometry, weights, clipping, and rig behavior.
- Golden evidence includes front, three-quarter, side, and rear views; relevant idle/movement/attack/casting frames; deformation stress poses; and actual GQ gameplay scale.
- Measure the shipped GLB, not merely DCC state. Preserve provenance, hash, deterministic-rebuild, and source-custody checks that actually exist in the public repository.

### Runtime identity is asset data

- Source/vendor/review names may be renamed during merge or import.
- Before driving a shipping animation, gear item, candidate, view or other typed Studio/game operation, query/read the actual current runtime inventory/state and use its identifiers.
- Never infer a runtime identifier from Meshy action IDs, donor filenames, source filenames or historical docs.

### Character Studio role

Character Studio is a controlled review/fit surface for the capabilities it currently exposes. Re-read its actual runtime descriptors and tests before assuming a view, loadout, overlay, or inspector exists.

- prefer Studio for reproducible comparison/fit work that it implements today;
- keep `fit-*`, GLB parsers and Foundry scripts as measurement backends, independent checks and fallbacks;
- Studio evidence must identify exact asset/hash, runtime clip, viewport, camera/lighting state and any tuning override;
- diagnostic Studio lighting is non-authoritative;
- running GalaQuest remains final appearance + interaction authority for player-visible changes.

### Discovery before command

Before issuing a typed remote Studio request, obtain the supported/current state from the Studio/asset itself. Unknown identifiers must fail closed and return the available canonical identifiers rather than silently substituting a value.

## Working method

For each task:

1. State the authority files and exact contract fields in scope.
2. Record known facts, open hypotheses, owner decisions, and stop conditions separately.
3. Choose the simplest pipeline that satisfies the contract.
4. Make the smallest scoped change. Do not begin later production stages unless requested.
5. Validate at the right layer:
   - source topology in the authoring source;
   - rig, influence, material, primitive, texture, triangle, metadata, and clip gates on the shipped GLB;
   - silhouette at actual gameplay scale;
   - deformation and clipping at inspection scale in stress poses;
   - provenance and determinism through automated tests that actually exist.
6. Report exact commands, outcomes, hashes where relevant, unresolved owner decisions, and any contract/document conflict. Never turn a partial check into a blanket pass.

When evidence is missing, measure before asserting. When the missing item is an owner choice, stop and ask rather than guessing.
