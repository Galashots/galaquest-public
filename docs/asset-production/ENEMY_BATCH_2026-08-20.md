# GalaQuest Enemy Asset Wave 1 — 2026-08-20

## Purpose

Candidate-only enemy manufacturing ledger for the first mass enemy wave. This work stays in the asset lane: no gameplay wiring, no promotion to shipping enemy registries, no merge, and no production acceptance.

## Budget authority

Owner authorized up to **500 additional Meshy credits** for this enemy wave.

Observed Meshy balance immediately before enemy generation: **1179 credits**.
Observed balance after concept + 3D generation: **697 credits**.
Observed balance delta during the wave: **482 credits**.

Because only 18 credits of the authorized ceiling remained, **no rigging jobs were launched** in this wave. Do not add paid rigging/retries to this batch without a fresh owner credit authorization.

## Art direction

The roster was designed for Sword-Masters-style farming variety without copying any specific game character: strong readable silhouettes, clear regional themes, different perceived combat roles, and child-friendly fantasy menace rather than gore.

Regions / tiers represented:
- Forest: Spriggan Scrapper, Thornback Orc, Stagroot Warden
- Volcanic: Coalclaw Kobold, Cinderfang Raider, Magmahorn Juggernaut
- Frost: Snowfang Marauder, Iceback Ogre, Frostbound Warden
- Crypt: Boneguard Raider, Tombmaul Knight, Graveflame Reaper
- Storm: Stormbreaker Colossus
- Void: Voidfang Overlord concept reserve

All modeled enemies were intentionally generated as full-body, symmetrical, empty-hand, T-pose-compatible character candidates so weapons can remain separate reusable attachments later.

## Provider outcome

All **13 submitted Image-to-3D jobs succeeded**. The fourteenth design, Voidfang Overlord, remains a successful concept-only reserve and did not receive a 3D job because the budget ceiling was nearly exhausted.

No Image-to-3D failures were observed. No rigging jobs exist for this wave.

| Enemy | Concept task | Image-to-3D task | Provider state |
|---|---|---|---|
| Spriggan Scrapper | `01a022c1-a6dd-766b-a737-4e38b15ae50c` | `01a022c2-f4a4-7134-b2a7-190684b04449` | SUCCEEDED |
| Thornback Orc | `01a022c1-bbf6-7dcd-a2b8-93515407ace3` | `01a022c3-03de-7dfe-9616-b58d8a9b5c4f` | SUCCEEDED |
| Stagroot Warden | `01a022c1-d1d4-7dd1-add8-06ee0a3d94bc` | `01a022c3-1355-7cbb-88df-111a2248a7f3` | SUCCEEDED |
| Coalclaw Kobold | `01a022c1-ebb2-766e-8d3c-2a25baab6a83` | `01a022c3-2173-7cbd-9f84-b233c003bbe6` | SUCCEEDED |
| Cinderfang Raider | `01a022c1-fdd2-70fd-a5e4-bcef3f9ca9b4` | `01a022c3-2f7c-7e10-8508-72c176cc9cdd` | SUCCEEDED |
| Magmahorn Juggernaut | `01a022c2-0d94-7677-b4e8-0696f5e70da8` | `01a022c3-3f4e-76a3-8b03-f42da4c6be6d` | SUCCEEDED |
| Snowfang Marauder | `01a022c2-1d4e-7101-b618-58937c670218` | `01a022c3-4d65-76a8-913b-1d0ef9360a24` | SUCCEEDED |
| Iceback Ogre | `01a022c2-2df8-767c-98e3-1adcacad7801` | `01a022c3-5cd0-7144-b5c7-ca75d5bdd5f9` | SUCCEEDED |
| Frostbound Warden | `01a022c2-3f87-7c93-a424-931e8e6e0836` | `01a022c3-77c1-7e19-8251-cb1649bc8e53` | SUCCEEDED |
| Boneguard Raider | `01a022c2-5184-7103-a75d-9049ec77bd92` | `01a022c3-950d-7e1f-a29a-ffe70afc8677` | SUCCEEDED |
| Tombmaul Knight | `01a022c2-64b3-710f-b6ed-596b55101b0d` | `01a022c3-a5f2-7e24-b58e-dd509791e724` | SUCCEEDED |
| Graveflame Reaper | `01a022c2-782d-7ca1-a248-d7899682bc98` | `01a022c3-b8ca-7ccb-bb21-7c04a9c745f6` | SUCCEEDED |
| Stormbreaker Colossus | `01a022c2-92be-7690-aa05-c93c31d26ce5` | `01a022c3-cc9a-76b8-a968-3a86e078e61c` | SUCCEEDED |
| Voidfang Overlord | `01a022c2-a744-7119-a0ab-5fc6daaadbec` | — | concept reserve only |

## Download / structural audit

GLB download was proven for the batch. Sampled downloaded files were substantial textured assets rather than empty placeholders (roughly 9–18 MB) and exposed base-color/metallic/roughness/normal textures, with emission maps on several glow-heavy designs.

Examples observed during download:
- Spriggan Scrapper: ~9.1 MB GLB
- Thornback Orc: ~12.8 MB GLB
- Stagroot Warden: ~16.9 MB GLB
- Coalclaw Kobold: ~13.9 MB GLB
- Cinderfang Raider: ~16.1 MB GLB
- Magmahorn Juggernaut: ~14.3 MB GLB
- Snowfang Marauder: ~14.7 MB GLB
- Iceback Ogre: ~18.1 MB GLB

The remaining successful jobs exposed downloadable GLB URLs through Meshy and were not provider failures.

This is a **structural intake PASS**, not a visual production acceptance. A proper thumbnail / model-turntable audit and later running-game review still have authority to RETRY or REJECT individual candidates.

## Repository staging

Branch: `feat/enemy-asset-wave-1`
Base when opened: current `feat/asset-forge` head.
Intended candidate path: `public/assets/enemies/candidates/`.

The durable task ledger is committed here so every model can be re-downloaded from Meshy by task id. Binary GLBs remain candidate artifacts and must not be promoted to shipping registries until visual review, rigging, animation, and gameplay qualification are complete.

## Next permitted actions

1. Drop the 13 successful GLBs into `public/assets/enemies/candidates/` using the filenames in that directory's README.
2. Perform a visual turntable/thumb audit; mark each PASS / RETRY / REJECT.
3. Obtain fresh credit authorization before any rigging, retries, or the Voidfang 3D conversion.
4. Rig only visually accepted humanoid candidates.
5. Add combat animations / gameplay wiring in a later gameplay lane, not this asset-production branch.
