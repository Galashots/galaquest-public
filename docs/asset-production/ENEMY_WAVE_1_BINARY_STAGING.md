# Enemy Wave 1 binary staging note

> **HISTORICAL — state has moved since this note.** The staging commit described below lives on the
> source branch `feat/enemy-asset-wave-1` (PR #28), which was never merged; during the 2026-08-21
> asset-platform consolidation the binaries were moved to the external source archive. On current
> `main`, `public/assets/enemies/candidates/` holds only a README recording the exact recovery path.

The transport blocker is **closed**.

All 13 Wave 1 Meshy base rigged GLBs were fetched from their completed rig tasks and committed under `public/assets/enemies/candidates/` on the source branch in commit `7e859dd35f7591dd60638ad37ac67436b779428a` (branch-only; not in `main` history).

A one-shot GitHub Actions ingestion step was used to bridge the Meshy signed-download surface into the repository. The workflow removed itself from the resulting branch after committing the binaries and the audit artifacts, so it is not a standing production mechanism.

The ingestion deliberately did **not** add Meshy's included walking/running GLB duplicates. Those outputs remain recoverable from the rig task IDs recorded in `ENEMY_WAVE_1_PROVENANCE.json` and should be selectively ingested only after a gameplay/animation review chooses candidates.

Structural intake is recorded in `ENEMY_WAVE_1_STRUCTURAL_AUDIT.json`. All 13 base rigged GLBs passed the minimum GLB/mesh/skin/joint checks. Visual acceptance remains UNKNOWN and no candidate is promoted to shipping by this staging step.
