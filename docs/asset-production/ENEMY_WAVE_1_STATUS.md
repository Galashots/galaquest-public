# Enemy Wave 1 gate status

- Provider Image-to-3D: **PASS** — 13/13 submitted enemy tasks succeeded.
- Provider rigging: **PASS** — 13/13 Wave 1 rig tasks succeeded.
- Spend (historical accounting, not authority): observed total Wave 1 spend was 482 credits against the 500 authorized on 2026-08-20; balance measured at 697 afterwards. No new spend during intake or during the 2026-08-21 consolidation. These figures are provenance for what the wave cost; they grant no current spend authority.
- Base rigged GLB downloadability: **PASS** — every rig task exposes a base rigged GLB.
- GitHub binary intake: **PASS (since relocated)** — all 13 Wave 1 base rigged GLBs were committed on the source branch `feat/enemy-asset-wave-1` (PR #28). During the 2026-08-21 asset-platform consolidation they were moved to the external source archive and are **no longer stored under `public/assets/enemies/candidates/`**; that directory's README and `docs/asset-production/asset-platform-inventory.json` record the exact recovery path (git blob OIDs on the still-open source branch).
- Structural candidate audit: **PASS** — 13/13 files are valid GLB v2, nontrivial, meshed and skinned; every candidate has 24 joints.
- Material export audit: **QUARANTINED CANDIDATE DEFECT** — exact-head CI caught Meshy's known flooded emissive / PBR-default export signature on the new raw rigged candidates. They remain unreachable under `candidates/`; active use or promotion requires material cleanup/re-export or a load path through `normaliseCharacterMaterial()`.
- Free basic movement outputs: **PASS (provider availability)** — walking/running outputs exist for every rig task, but are intentionally not duplicated into Git.
- Visual model acceptance: **UNKNOWN** — requires rendered turntable/Studio review; structural PASS is not visual acceptance.
- Animation deformation acceptance: **UNKNOWN** — walking/running have not yet been reviewed in GalaQuest rendering.
- Gameplay integration / promotion: **BLOCKED BY DESIGN** — intentionally out of scope for the asset lane and this draft candidate PR.

No Wave 1 candidate was rejected at structural intake. All 13 are retained as quarantined candidates; visual review may still mark individual models RETRY or REJECT.
