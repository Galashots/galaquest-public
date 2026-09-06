# A3-S1 Spriggan Scrapper Qualification

**Task:** `PROG-A3-S1-SPRIGGAN-QUALIFICATION`
**Status:** A3-S1-C2 qualification complete; Director judgment pending
**Starting main:** `ee2c5e60a29c6c2e6572ad3d0d0b8d36aff33885`
**Starting branch:** `11fd62eab404a035027441b4a8b79da070f381eb`
**C1 checkpoint:** `3bbfebb7008f40f28b0aa386bb26987e2563c7e3`
**Branch:** `asset/a3-s1-spriggan-qualification`
**PR:** #57

This record is qualification evidence only. Spriggan remains a candidate: no gameplay integration, runtime registry change, or production promotion was performed.

## Executive result

Spriggan is recoverable, provenance-sound, structurally coherent, and its known raw Meshy flooded-emissive/PBR-default defect has a minimal asset-side correction that preserves every mesh/rig/animation byte. Static inspection supports the intended fast/fragile forest-skirmisher read.

The already-produced provider walk/run outputs could not be recovered in this execution environment without a functioning provider retrieval tunnel. The repository proves that the recorded rig task succeeded and exposed included walk/run outputs, but direct read/download attempts failed before reaching Meshy and the consolidated Drive archive contains only the base Wave-1 GLBs. No replacement animation was generated.

**Final disposition: `ADVANCE AFTER BOUNDED FOLLOW-UP`.**

Blocking follow-up: recover the existing Spriggan rig-task walk/run files once provider retrieval is available, then perform the missing motion/deformation review. Do not regenerate them. Payload optimization can remain a later bounded asset task before production promotion.

## C1 — exact source + material-safe derivative

### Source identity and custody — PASS

- Candidate: `spriggan-scrapper-v1.glb`.
- Historical source: `origin/feat/enemy-asset-wave-1` / PR #28.
- Historical source commit: `b1a337a394bb12caa6c3b667cc546547111a936d`.
- Historical Git blob: `ebad07f0845e2ce9ee38f05d5477940eb7524e54`.
- Recorded Image-to-3D task: `01a022c2-f4a4-7134-b2a7-190684b04449`.
- Recorded rig task: `01a022c5-8fb4-71c3-ac86-db31b0fa497d`.
- Source Drive path: `/Google Drive/GalaQuest Asset Source Archive/2026-08 Asset Platform Consolidation/enemies/wave-1/spriggan-scrapper-v1.glb`.
- Source Drive file ID: `1bvhPJ7U_2xn5RaYWSjOzFL1w-Oj-KObi`.
- Bounded local source: `/mnt/data/a3-s1-spriggan/source/spriggan-scrapper-v1.glb`.
- Source SHA-256: `379c407db0e65e19be5b182efea4eb38f230e80c3335753af305fe66a11ff667`.
- Source bytes: `8,213,752`.

The recovered source exactly matches the durable repository inventory hash and byte size. The archive original was not overwritten, moved, renamed, or deleted.

### Exact material defect and correction — PASS

Raw `Material_1` reproduced the recorded Wave-1 quarantine signature:

- the same embedded image was bound as base color and emissive;
- explicit white `emissiveFactor: [1, 1, 1]`;
- omitted metallic factor, therefore glTF default `1.0`;
- omitted roughness factor, therefore glTF default `1.0`.

The repo's existing character normalization convention uses non-emissive albedo with metallic `0` and roughness `0.8`; the runtime helper also documents that this correction belongs in the asset rather than a loader/runtime workaround.

C1 derivative correction:

1. removed the duplicate albedo-as-`emissiveTexture` binding;
2. removed explicit white `emissiveFactor`, allowing the glTF default black emissive `[0, 0, 0]`;
3. authored `metallicFactor: 0`;
4. authored `roughnessFactor: 0.8`.

`KHR_materials_specular.specularColorFactor: [2, 2, 2]` and `KHR_materials_ior` were intentionally retained; values above 1 are allowed by the ratified specular extension and were not the quarantine defect.

### Derivative custody

- Local derivative: `/mnt/data/a3-s1-spriggan/output/spriggan-scrapper-a3-material-clean.glb`.
- Drive derivative: `/Google Drive/GalaQuest Review Bridge/A3-S1_spriggan-scrapper_material-clean.glb`.
- Drive file ID: `1YIEtFNtf5q3QVVy7kYZGEQKoMpLP8uP-`.
- Derivative SHA-256: `29d767841d7a2b0905b6d0bb62db25846192333dca7a9c351e5d3e8ce841dbb2`.
- Derivative bytes: `8,213,736`.
- The uploaded Drive derivative was materialized again and independently re-hashed to the same SHA-256.

Outside `materials[]`, source and derivative glTF JSON are identical. The GLB BIN chunk is bit-identical before/after; both BIN chunks hash to `be8f77d07197248fa47bc52dfb0c73fa7fe84441557cd5c79070a15cce187748`. No geometry, skin, joint, node, animation, texture image, extension, transform, or hierarchy was changed.

### Before / after technical metrics

| Measurement | Source | C1 derivative |
| --- | ---: | ---: |
| Bytes | 8,213,752 | 8,213,736 |
| Nodes | 26 | 26 |
| Meshes / primitives | 1 / 1 | 1 / 1 |
| Vertices | 17,265 | 17,265 |
| Triangles | 26,063 | 26,063 |
| Skins / joints | 1 / 24 | 1 / 24 |
| Embedded animations | 1 | 1 |
| Materials | 1 | 1 |
| Textures / images | 2 / 1 | 2 / 1 |
| Embedded image | 2048 x 2048 RGB PNG, 7,132,945 bytes | unchanged |
| Mesh POSITION bounds | min `[-0.486705, ~0, -0.177189]`, max `[0.486705, 1.100000, 0.177189]` | unchanged |
| Metallic | implicit 1.0 | explicit 0.0 |
| Roughness | implicit 1.0 | explicit 0.8 |
| Emissive factor | `[1,1,1]` | default `[0,0,0]` |
| Emissive texture | duplicate albedo image | none |

The embedded animation `Armature|clip0|baselayer` has 72 samplers/channels targeting 24 joints, but all input samples occur at approximately `0.3 s`, so measured duration is `0.0 s`. Its translation/rotation/scale values match the authored node defaults within floating-point noise. It is a static pose snapshot, not walk/run locomotion.

### Structural / skin validation — PASS

A bounded validator checked both source and derivative for GLB 2 header/length/chunk integrity, buffer/bufferView/accessor bounds, mesh references, skin joint references, texture/image references, embedded PNG decode, and independent `trimesh` scene parse. Both passed.

Additional C2 bind-pose analysis resolved the C1 scale caution:

- vertex skin weights sum to approximately 1.0 (`0.99999987` to `1.00000012`);
- the inverse-bind matrices match the inverse bind-pose joint world transforms to within about `4.8e-5`;
- applying glTF skinning and the mesh/world transform reconstructs the source mesh positions with maximum positional error about `4.1e-7`;
- effective bind-pose world bounds remain approximately `0.973 x 1.100 x 0.354` units.

Therefore the root `Armature` scale of `0.01` is part of the rig coordinate conversion and is not, by itself, a centimetre-sized runtime defect. No transform bake is warranted in A3-S1.

The official Khronos `gltf-validator` CLI/package was unavailable in the worker container and the package registry was unreachable. No claim is made that the Khronos CLI ran; Gate 3 PASS is based on the structural/parser and skin-consistency validation actually executed.

## C2 — locomotion, visual and runtime qualification

### Existing walk/run recovery — UNKNOWN

Durable repo evidence states that all 13 Wave-1 rig tasks succeeded and each rig task exposed a base rigged GLB plus Meshy's included walking/running outputs; those walk/run duplicates were intentionally not committed.

For Spriggan, the recorded rig task is `01a022c5-8fb4-71c3-ac86-db31b0fa497d`.

Recovery attempts:

- read-only rig-task status lookup: failed at the Meshy connector tunnel before reaching Meshy;
- read-only download of that exact existing rig task as GLB: failed at the same connector tunnel before reaching Meshy;
- consolidated Drive Wave-1 archive inspection: contains the 13 base candidate GLBs only, including the exact Spriggan source, with no walk/run files;
- `GalaQuest Meshy Outputs` inspection and Drive searches for Spriggan/walk/run/task identity: no recoverable Spriggan locomotion GLB found.

Because prior durable evidence says the outputs existed but current retrieval is unavailable, this gate is **UNKNOWN**, not FAIL. No new provider task, regeneration, or substitute motion was attempted.

### Rig / motion compatibility — UNKNOWN

The base rig itself is structurally coherent: one skin, 24 named humanoid joints, normalized weights, consistent inverse binds, and a stable bind pose. However, without the exact recovered walk/run outputs, clip durations, channel targeting, root-motion behavior, foot sliding, clipping, limb collapse, and deformation quality cannot be honestly accepted or rejected.

### Static visual evidence — produced; motion/deformation UNKNOWN

The C1 material-clean derivative was rendered in a bounded offline inspection harness using the actual mesh UVs and embedded base-color texture. These are isolated inspection renders, not running-game acceptance pixels.

Drive evidence:

- contact sheet: `/Google Drive/GalaQuest Review Bridge/A3-S1_spriggan-static-contact-sheet.png` (`16V4TNh2puLrGjpE-aEOcNkUQn-Ey3l5a`);
- front: `/Google Drive/GalaQuest Review Bridge/A3-S1_spriggan-neutral-front.png` (`1wIYzFgyw_Jr0id_LgEK3OHAKmylQKQnI`);
- 3-quarter: `/Google Drive/GalaQuest Review Bridge/A3-S1_spriggan-neutral-3q.png` (`1010G7ncPCFM7HweLVMjbrXkTDiQs2J5H`);
- side: `/Google Drive/GalaQuest Review Bridge/A3-S1_spriggan-neutral-side.png` (`1WJT00QhmJxkJfe-cgHi9cbMD7_SQnqta`);
- back: `/Google Drive/GalaQuest Review Bridge/A3-S1_spriggan-neutral-back.png` (`16VBr8TXCJhQ6XFn0OC7l9zt-GdVP8_YQ`);
- small/gameplay-distance proxy: `/Google Drive/GalaQuest Review Bridge/A3-S1_spriggan-gameplay-distance-3q.png` (`1OnZ4CVTgw98iTnUCtub9fiI44j6ZJZra`).

Worker visual finding: **positive static candidate read**. The model has a slim torso and limbs, oversized leaf-like ears/horns, strong forest palette, and an easily distinguished non-wolf silhouette. Front, side and back inspection shows no obvious rest-pose mesh collapse or catastrophic clipping. The distinctive head/ear silhouette survives the small-on-screen proxy, while fine foliage detail predictably falls away.

This does not establish final appearance or animation acceptance. Walk/run deformation samples were not produced because the exact motions were not recoverable. Foot sliding and animated clipping therefore remain UNKNOWN for Director adjudication.

### Runtime / payload evidence

Measured derivative costs:

- GLB payload: `8,213,736` bytes;
- geometry/index bufferViews used by the mesh: about `1,054,158` bytes;
- one skinned mesh primitive and one material: nominally one skinned draw per visible instance;
- 17,265 vertices / 26,063 triangles per instance;
- embedded PNG: `7,132,945` bytes, about `86.84%` of the GLB payload;
- texture decoded RGB footprint: about `12 MiB`;
- typical RGBA8 upload footprint: about `16 MiB`, or about `21.3 MiB` with a full mip chain, subject to renderer/browser implementation;
- worker-side cached-file read median: about `1.34 ms`;
- JSON parse median: about `0.33 ms`;
- PNG decode median: about `89.3 ms`;
- independent `trimesh` GLB scene parse median: about `29.4 ms` across the bounded sample.

Those timings are worker-machine proxies, not browser GLTFLoader benchmarks. A true project-vendored `GLTFLoader` smoke could not be run in the isolated worker container because the repo checkout/vendor module was unavailable locally and external package installation was unreachable. No runtime code was changed to manufacture a test harness.

Performance/payload classification: **bounded follow-up**. Geometry and draw/material count are plausible for a selected enemy, but the 2048² texture dominates payload and GPU memory for a model intended to appear repeatedly on tablets. A later asset-only texture-budget pass is justified if Spriggan survives motion review. A local lossless PNG re-encode experiment saved only about `272 kB` while preserving decoded pixels, which was not a material enough win to replace the C1 derivative. No resize, compression extension, retopology, or loader change was introduced here.

## Acceptance gates

1. **Source identity:** PASS.
2. **Material quarantine resolution:** PASS.
3. **Structural/GLB validation:** PASS on executed structural/parser + skin-consistency validation; Khronos CLI unavailable and explicitly not claimed.
4. **Existing walk/run recovery:** UNKNOWN — prior existence is durable, current retrieval unavailable without a working provider tunnel.
5. **Rig/motion compatibility:** UNKNOWN — base rig structurally coherent, exact walk/run motion compatibility/deformation not inspectable.
6. **Inspection-scale visual/deformation evidence:** UNKNOWN overall — static neutral + small-screen evidence produced and worker-reviewed positively; walk/run deformation evidence unavailable; final Director visual judgment remains separate.
7. **Performance/payload classification:** bounded follow-up.
8. **No runtime integration/provider spend:** PASS.
9. **`node --test test/*.test.mjs`:** C1 hosted `test/unit` PASS at `3bbfebb7008f40f28b0aa386bb26987e2563c7e3`; final-head hosted result is evaluated in the worker handoff after this commit.
10. **`git diff --check`:** PASS on the exact final report content before push; final remote diff is rechecked in the worker handoff.
11. **Hosted protected `unit`:** final-head result is evaluated in the worker handoff after this commit.
12. **Production promotion:** NOT AUTHORIZED / not performed.

## Final disposition

`ADVANCE AFTER BOUNDED FOLLOW-UP`

Required before E3 input: recover the already-generated Spriggan walk/run outputs from rig task `01a022c5-8fb4-71c3-ac86-db31b0fa497d` when read/download access is available, with zero new provider work, then inspect clip identity, compatibility, root behavior and actual deformation. If those motions fail visually or technically, reject/replace rather than broadening rescue work.

Performance optimization is a separate bounded asset side quest before production promotion, not authority to block this qualification branch with speculative remeshing or runtime changes.

## Side quests deliberately not implemented

- no attack/hit/death/cast animation generation;
- no new provider task or regeneration;
- no rig redesign or skeleton surgery;
- no major remesh/retopology;
- no 1024 texture resize or new compression extension;
- no gameplay enemy registry/spawn/AI/combat/progression work;
- no E1/E2/E3 implementation;
- no world/geography, XP, loot, or nameplate changes;
- no Magmahorn or Graveflame qualification;
- no production-asset promotion.

## Explicit safety confirmation

- zero new provider jobs;
- zero provider credits spent;
- zero gameplay/runtime integration;
- zero production promotion;
- no merge or close of PR #57;
- no write to `main`;
- no force-push.
