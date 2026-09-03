# Unity foundation guidance

This directory is the Unity production foundation. Keep these rules durable and project-local.

## Foundation authority

- Pin the Unity Editor to `6000.3.23f1` and use the Universal Render Pipeline (URP) as the production baseline.
- Preserve every Unity `.meta` file and its GUID identity. Unity GUIDs identify Unity assets; they are not GalaQuest semantic IDs and must not become gameplay or content identifiers.
- Use Visible Meta Files and Force Text serialization for project authoring.
- Prefer Unity Editor APIs for scene, prefab, and serialized asset authoring. Direct YAML editing is exceptional; when it is necessary, validate the result through the Unity Editor and its command-line gates.
- Generated Unity directories are derived state, not authority. Do not treat `Library`, `Temp`, `Logs`, `UserSettings`, `obj`, `Builds`, `MemoryCaptures`, or `Recordings` as source truth.
- Do not opportunistically upgrade packages. Change package versions only as part of an explicit, reviewed task.

## Automation and validation

- Prefer checked-in C# Editor automation for repeatable validation, build entry points, and project checks.
- Unity CLI/MCP may drive the Editor when available. Raw Unity batch-mode fallback must remain possible for CI and for environments without a connected Editor.
- Compile errors and unexplained Console errors fail validation. A green command is not sufficient if the Editor is in Safe Mode or has unexplained errors.
- Bind evidence to the exact Git SHA that produced it. The generated evidence root is `.local/unity/review-pack/`; future Owner Review Pack states must be deterministic and explicit.
- **Every new or materially changed Unity-bound visual asset must be visually self-reviewed in Unity before handoff.** At minimum capture a neutral inspection view and an intended gameplay-framing view; inspect motion in Play Mode when animation, VFX, cloth, deformation, or moving parts matter.
- Meshy, Blender, DCC, or importer previews may expose defects but do not replace the Unity self-review. Follow `docs/review-guides/asset-visual-review.md` and the `visual-reference-first` skill for comparative reference review.
- A producer review must state the strongest visual defect/counterargument found. Self-review does not independently accept the producer's own consequential work.
- Prefer phone-readable stills on the PR/review surface. Large recordings and large raw/source masters may use the Owner-controlled Google Drive custody/review tier, linked from an exact-SHA review manifest; do not bloat Git merely to transport review media.
- When publishing Unity review evidence to Drive, use only the controlled root and `30_OWNER_REVIEW/00_NEEDS_OWNER_REVIEW` lifecycle defined in `docs/pipeline/google-drive-asset-custody.md`. Keep `.local/unity/review-pack/` as generated local evidence; Drive is the durable transfer/review surface, not a second Unity source tree.
- Running-game pixels remain the final visual authority. Asset inspection, serialized files, and renders can establish file facts but cannot establish how the game looks.

## Migration boundaries

- Three.js remains the reference client during migration.
- The existing Node server and protocol remain authoritative until an approved package explicitly changes them.
- Networking libraries stay behind a GalaQuest-owned abstraction; do not let provider APIs become gameplay contracts.
- Centralize future coordinate conversion rather than scattering axis or unit fixes through content code.
- Future migration importers must be deterministic and idempotent: the same source and settings produce the same result, and rerunning them does not duplicate or drift assets.

## Owner and provider boundaries

- Do not make paid provider calls without explicit Owner authorization for that specific work.
- Do not merge, push to `main`, or force-push without separate authorization.
- Durable guidance must not contain machine-local executable paths, user-specific checkout paths, or environment-specific commands that cannot travel with the repository.
