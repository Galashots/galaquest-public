# GalaQuest Enemy Asset Wave 1 — 2026-08-20

## Purpose

Candidate-only enemy manufacturing ledger for the first mass enemy wave. This work stays in the asset lane: no gameplay wiring, no promotion to shipping enemy registries, no merge, and no production acceptance.

## Budget authority

Owner authorized up to **500 additional Meshy credits** for this enemy wave.

- Observed Meshy balance immediately before the enemy wave: **1179 credits**.
- Current balance after concepts, 3D generation, and rigging: **697 credits**.
- Observed total wave spend: **482 credits**.
- Remaining authorization headroom: **18 credits**.

No new generation, retry, retexture, or custom-animation spend was made during repository intake.

## Art direction

The roster was designed for farming variety without copying any specific game character: strong readable silhouettes, clear regional themes, different perceived combat roles, and child-friendly fantasy menace rather than gore.

Regions represented:
- Forest: Spriggan Scrapper, Thornback Orc, Stagroot Warden
- Volcanic: Coalclaw Kobold, Cinderfang Raider, Magmahorn Juggernaut
- Frost: Snowfang Marauder, Iceback Ogre, Frostbound Warden
- Crypt: Boneguard Raider, Tombmaul Knight, Graveflame Reaper
- Storm: Stormbreaker Colossus
- Void: Voidfang Overlord concept reserve

The 13 modeled enemies were generated as full-body, symmetrical, empty-hand, T-pose-compatible candidates so weapons can remain separate reusable attachments.

## Provider outcome

- **13/13 Image-to-3D tasks: SUCCEEDED.**
- **13/13 Wave 1 rig tasks: SUCCEEDED.**
- Every rig task exposes a base rigged GLB plus Meshy's included walking/running outputs.
- The base rigged GLBs are committed as candidates; walk/run duplicates are intentionally not committed.
- Voidfang Overlord remains a concept-only reserve and did not receive a 3D job in this wave.

The Meshy rig-task listing does not expose the upstream source task id, so the source-to-rig mapping is recorded in the same chronological launch order as the Wave 1 source model ledger. That assumption is explicit in `ENEMY_WAVE_1_PROVENANCE.json` rather than hidden.

## Durable provenance

See:
- `public/assets/enemies/candidates/README.md` — human-readable filename/source/rig mapping.
- `docs/asset-production/ENEMY_WAVE_1_PROVENANCE.json` — machine-readable intake provenance and candidate status.
- `docs/asset-production/ENEMY_WAVE_1_STRUCTURAL_AUDIT.json` — structural audit captured at ingestion.

## Structural audit

The repository ingestion job validated every committed Wave 1 base rigged GLB against the same minimum contract:

- GLB v2 header and declared byte length are valid;
- file size is greater than 1 MB;
- at least one mesh;
- at least one skin;
- at least 10 joints.

Result: **13/13 PASS_STRUCTURAL**. In practice every candidate reports one mesh, one skin, 24 joints, 26 nodes, one material, two textures, one image, and one embedded animation. File sizes are approximately 8.2–11.7 MB.

This rejects obvious corrupt/empty/unrigged intake failures. It is **not visual acceptance**: silhouette quality, mesh defects visible only in rendering, skin deformation, animation clipping, materials under GalaQuest lighting, and gameplay readability remain UNKNOWN until browser/Studio review.

## Repository staging

Branch: `feat/enemy-asset-wave-1`
PR: #28
Candidate path: `public/assets/enemies/candidates/`
Binary ingestion commit: `7e859dd35f7591dd60638ad37ac67436b779428a`

The branch contains 13 base rigged Wave 1 GLBs plus provenance/audit records. No Wave 1 walk/run duplicates were added. Existing unrelated candidate files inherited from the base branch are not part of this Wave 1 count.

## Gates

- Provider 3D generation: **PASS** — 13/13.
- Provider rigging: **PASS** — 13/13.
- Base rigged GLB availability: **PASS** — 13/13.
- Repository binary intake: **PASS** — 13/13 candidate GLBs committed.
- Structural GLB/skin audit: **PASS** — 13/13.
- Visual model acceptance: **UNKNOWN** — requires rendered review.
- Walk/run gameplay acceptance: **UNKNOWN** — outputs are available provider-side but intentionally not committed yet.
- Gameplay integration / shipping promotion: **BLOCKED BY DESIGN** — out of scope for this candidate-only asset branch.

## Next permitted actions

1. Render/turntable the 13 base rigged candidates and mark visual PASS / RETRY / REJECT.
2. Exercise skin deformation using representative motions; only then select which free walk/run outputs are worth ingesting.
3. Keep gameplay wiring and shipping promotion in a later, deliberate integration lane.
4. Do not spend the remaining 18-credit headroom merely to use it; any retry should be justified by the visual audit and remain within explicit owner authorization.
