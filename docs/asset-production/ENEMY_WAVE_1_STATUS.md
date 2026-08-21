# Enemy Wave 1 gate status

- Provider Image-to-3D: **PASS** — 13/13 submitted enemy tasks succeeded.
- Provider rigging: **PASS** — 13/13 Wave 1 rig tasks succeeded.
- Budget: **PASS** — observed total Wave 1 spend is 482 / 500 credits; current Meshy balance is 697; no new spend during intake.
- Base rigged GLB downloadability: **PASS** — every rig task exposes a base rigged GLB.
- GitHub binary intake: **PASS** — all 13 Wave 1 base rigged GLBs are committed under `public/assets/enemies/candidates/`.
- Structural candidate audit: **PASS** — 13/13 files are valid GLB v2, nontrivial, meshed and skinned; every candidate has 24 joints.
- Free basic movement outputs: **PASS (provider availability)** — walking/running outputs exist for every rig task, but are intentionally not duplicated into Git.
- Visual model acceptance: **UNKNOWN** — requires rendered turntable/Studio review; structural PASS is not visual acceptance.
- Animation deformation acceptance: **UNKNOWN** — walking/running have not yet been reviewed in GalaQuest rendering.
- Gameplay integration / promotion: **BLOCKED BY DESIGN** — intentionally out of scope for the asset lane and this draft candidate PR.

No Wave 1 candidate was rejected at structural intake. Visual review may still mark individual models RETRY or REJECT.
