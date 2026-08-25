# Enemy candidate intake

These files are **candidate-only**. Do not wire them into shipping enemy registries or gameplay until they pass visual, animation, and running-game review.

Enemy Wave 1 base rigged GLBs are **not stored in this directory**. They were committed on the
source branch `feat/enemy-asset-wave-1` (PR #28) and moved to the external source archive during the
2026-08-21 asset-platform consolidation: 13 raw provider exports totalling ~131 MiB — several times
the entire shipped `public/assets` tree — with no runtime load path reaching them.

Nothing was lost. Each file's byte size, SHA-256 and git blob OID are recorded in
`docs/asset-production/asset-platform-inventory.json`, and the source branch is not closed, so any
candidate can be recovered exactly:

```bash
git fetch origin feat/enemy-asset-wave-1
git cat-file -p <git_blob_oid> > <name>.glb
```

The archive destination folder for each file is named in the same manifest. The free Meshy
walking/running outputs were never committed either; retrieve them from the recorded rig task when a
gameplay lane selects an enemy.

| Enemy | Candidate GLB | Image-to-3D task | Rig task |
|---|---|---|---|
| Spriggan Scrapper | `spriggan-scrapper-v1.glb` | `01a022c2-f4a4-7134-b2a7-190684b04449` | `01a022c5-8fb4-71c3-ac86-db31b0fa497d` |
| Thornback Orc | `thornback-orc-v1.glb` | `01a022c3-03de-7dfe-9616-b58d8a9b5c4f` | `01a022c5-c06a-770e-9883-a21e6ae12e35` |
| Stagroot Warden | `stagroot-warden-v1.glb` | `01a022c3-1355-7cbb-88df-111a2248a7f3` | `01a022c5-e4cd-7710-9e27-61976c468f5e` |
| Coalclaw Kobold | `coalclaw-kobold-v1.glb` | `01a022c3-2173-7cbd-9f84-b233c003bbe6` | `01a022c7-1190-7ebf-a3a6-3eabb4a690ba` |
| Cinderfang Raider | `cinderfang-raider-v1.glb` | `01a022c3-2f7c-7e10-8508-72c176cc9cdd` | `01a022c7-5c78-7234-bec0-e31f5c328227` |
| Magmahorn Juggernaut | `magmahorn-juggernaut-v1.glb` | `01a022c3-3f4e-76a3-8b03-f42da4c6be6d` | `01a022c7-8283-7ee0-9f69-2d40003958de` |
| Snowfang Marauder | `snowfang-marauder-v1.glb` | `01a022c3-4d65-76a8-913b-1d0ef9360a24` | `01a022c7-aade-7ee3-8042-c4a1bffae41c` |
| Iceback Ogre | `iceback-ogre-v1.glb` | `01a022c3-5cd0-7144-b5c7-ca75d5bdd5f9` | `01a022c7-d8c8-7255-bec7-e335bc585994` |
| Frostbound Warden | `frostbound-warden-v1.glb` | `01a022c3-77c1-7e19-8251-cb1649bc8e53` | `01a022c8-0132-7db6-9f98-4e34ffabf7d6` |
| Boneguard Raider | `boneguard-raider-v1.glb` | `01a022c3-950d-7e1f-a29a-ffe70afc8677` | `01a022c8-3270-7270-808a-c6fa6b7bd71e` |
| Tombmaul Knight | `tombmaul-knight-v1.glb` | `01a022c3-a5f2-7e24-b58e-dd509791e724` | `01a022c8-5863-7dbc-8c98-868b5599cc34` |
| Graveflame Reaper | `graveflame-reaper-v1.glb` | `01a022c3-b8ca-7ccb-bb21-7c04a9c745f6` | `01a022c8-7d2a-7277-9ab2-0965094e9cd0` |
| Stormbreaker Colossus | `stormbreaker-colossus-v1.glb` | `01a022c3-cc9a-76b8-a968-3a86e078e61c` | `01a022c8-a568-7dbf-9254-43d45434a91b` |

Concept reserve only:

- Voidfang Overlord — concept Meshy `01a022c2-a744-7119-a0ab-5fc6daaadbec`; no 3D job in Wave 1.

Source-to-rig mapping was reconstructed from the matching Wave 1 launch order because Meshy's rig listing does not expose the upstream source task id. See `docs/asset-production/ENEMY_WAVE_1_PROVENANCE.json` and `ENEMY_WAVE_1_STRUCTURAL_AUDIT.json` for the durable intake record.
