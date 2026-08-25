# A3-S1 Spriggan Scrapper Qualification

**Task:** `PROG-A3-S1-SPRIGGAN-QUALIFICATION`  
**Status:** C1 checkpoint complete; C2 qualification pending  
**Starting main:** `ee2c5e60a29c6c2e6572ad3d0d0b8d36aff33885`  
**Starting branch:** `11fd62eab404a035027441b4a8b79da070f381eb`  
**Branch:** `asset/a3-s1-spriggan-qualification`  
**PR:** #57

This record is qualification evidence only. It does not promote Spriggan Scrapper to production and does not integrate it into gameplay.

## C1 — exact source + material-safe derivative

### Source identity and custody

- Candidate: `spriggan-scrapper-v1.glb`.
- Historical Git source: `origin/feat/enemy-asset-wave-1` / PR #28.
- Historical source commit: `b1a337a394bb12caa6c3b667cc546547111a936d`.
- Historical Git blob: `ebad07f0845e2ce9ee38f05d5477940eb7524e54`.
- Recorded Image-to-3D task: `01a022c2-f4a4-7134-b2a7-190684b04449`.
- Recorded rig task: `01a022c5-8fb4-71c3-ac86-db31b0fa497d`.
- Archived source actually used: Google Drive file ID `1bvhPJ7U_2xn5RaYWSjOzFL1w-Oj-KObi`, recovered from the existing Wave-1 enemy archive custody.
- Bounded local source copy: `/mnt/data/a3-s1-spriggan/source/spriggan-scrapper-v1.glb`.
- Source SHA-256: `379c407db0e65e19be5b182efea4eb38f230e80c3335753af305fe66a11ff667`.
- Source bytes: `8,213,752`.

The recovered source byte size and SHA-256 exactly match the durable `asset-platform-inventory.json` record. The archived Drive original was not renamed, overwritten, moved, or deleted.

### Raw technical measurements

| Measurement | Source |
| --- | ---: |
| Bytes | 8,213,752 |
| Nodes | 26 |
| Meshes / primitives | 1 / 1 |
| Vertices | 17,265 |
| Triangles | 26,063 |
| Skins / joints | 1 / 24 |
| Embedded animations | 1 |
| Materials | 1 |
| Textures / images | 2 / 1 |
| Image | embedded PNG, 2048 x 2048 RGB, 7,132,945 encoded bytes |
| Local mesh bounds | min `[-0.486705, ~0, -0.177189]`, max `[0.486705, 1.100000, 0.177189]` |
| Local mesh dimensions | approximately `0.973409 x 1.100000 x 0.354379` |
| Scene-root transform | `Armature`, translation zero, identity rotation, scale approximately `[0.01, 0.01, 0.01]` |

The embedded animation is `Armature|clip0|baselayer`, with 72 samplers/channels across 24 target nodes and rotation/scale/translation paths, but its sampled duration is `0.0 s`. It is therefore a static pose snapshot, not usable walk/run locomotion.

The root `0.01` scale is preserved. If consumed literally it produces approximately centimetre-scale world bounds. This is a qualification observation for C2/runtime review, not authority to bake or rewrite transforms in C1.

### Raw material quarantine defect

The single material `Material_1` had the known Wave-1 signature:

- base-color texture references image 0 through texture 1;
- emissive texture also references the same image 0 through texture 0;
- explicit `emissiveFactor: [1, 1, 1]`;
- no authored `metallicFactor`, therefore glTF default `1.0`;
- no authored `roughnessFactor`, therefore glTF default `1.0`.

This reproduces the repo's quarantined flooded-emissive/PBR-default defect. The existing character normalization convention uses non-emissive albedo with metallic `0` and roughness `0.8`, and the runtime helper explicitly documents that this normalization belongs in the GLB rather than in a runtime workaround.

`KHR_materials_specular.specularColorFactor: [2, 2, 2]` and `KHR_materials_ior` were retained. Values above 1 are allowed by the ratified `KHR_materials_specular` extension and were not part of the known quarantine defect.

### C1 derivative

Derivative name: `spriggan-scrapper-a3-material-clean.glb`.

- Bounded local output: `/mnt/data/a3-s1-spriggan/output/spriggan-scrapper-a3-material-clean.glb`.
- Durable Drive output: `/Google Drive/GalaQuest Review Bridge/A3-S1_spriggan-scrapper_material-clean.glb`.
- Drive file ID: `1YIEtFNtf5q3QVVy7kYZGEQKoMpLP8uP-`.
- Derivative SHA-256: `29d767841d7a2b0905b6d0bb62db25846192333dca7a9c351e5d3e8ce841dbb2`.
- Derivative bytes: `8,213,736`.
- The uploaded Drive derivative was re-read and independently hashed to the same SHA-256.

Exact material correction:

1. removed the duplicate albedo-as-`emissiveTexture` binding;
2. removed explicit white `emissiveFactor`, allowing the glTF black-emissive default `[0, 0, 0]`;
3. authored `metallicFactor: 0`;
4. authored `roughnessFactor: 0.8`.

No mesh, primitive, accessor, buffer view, binary payload, image, texture image, skin, joint, node, animation, extension, transform, or hierarchy was changed. Comparison proved:

- non-material glTF JSON is identical;
- GLB BIN chunk is bit-identical before/after;
- source BIN SHA-256 = derivative BIN SHA-256 = `be8f77d07197248fa47bc52dfb0c73fa7fe84441557cd5c79070a15cce187748`.

The 16-byte payload reduction is incidental JSON-size change, not an optimization claim. No speculative texture resize/re-encode, remesh, retopology, skeleton work, compression extension, or loader dependency was introduced.

### Before / after

| Measurement | Source | C1 derivative | Change |
| --- | ---: | ---: | --- |
| Bytes | 8,213,752 | 8,213,736 | -16 |
| Vertices | 17,265 | 17,265 | none |
| Triangles | 26,063 | 26,063 | none |
| Nodes | 26 | 26 | none |
| Meshes / primitives | 1 / 1 | 1 / 1 | none |
| Skins / joints | 1 / 24 | 1 / 24 | none |
| Animations | 1 static pose clip | 1 static pose clip | none |
| Materials | 1 | 1 | values only |
| Textures / images | 2 / 1 | 2 / 1 | none |
| Image | 2048² RGB PNG | 2048² RGB PNG | none |
| Metallic factor | implicit 1.0 | explicit 0.0 | corrected |
| Roughness factor | implicit 1.0 | explicit 0.8 | corrected |
| Emissive factor | explicit `[1,1,1]` | default `[0,0,0]` | corrected |
| Emissive texture | duplicate albedo image | none | corrected |

### C1 validation

A bounded structural/parser validator checked both source and derivative for:

- valid GLB 2 header/declared length and aligned JSON/BIN chunk structure;
- buffer, bufferView and accessor bounds;
- mesh POSITION/index/material references;
- skin joint references;
- texture/image/sampler references;
- embedded PNG decode;
- independent `trimesh` scene parse.

Result: **PASS** for source and derivative. The derivative preserves the source's parseable structure and changes only the intended material JSON.

The Khronos `gltf-validator` CLI/package was not available in the worker container, and the package registry was unreachable. No claim is made that the official Khronos CLI was run. Gate 3 is nevertheless PASS on the structural/parser validation actually executed; this limitation remains visible for Director audit.

### C1 gate status

1. **Source identity:** PASS.
2. **Material quarantine resolution:** PASS.
3. **Structural/GLB validation:** PASS on executed structural/parser validation; Khronos CLI not available.
4. **Existing walk/run recovery:** pending C2.
5. **Rig/motion compatibility:** pending C2.
6. **Inspection-scale visual/deformation evidence:** pending C2.
7. **Performance/payload classification:** pending C2.
8. **No runtime integration/provider spend:** PASS to C1.
9. **Repo tests:** pending final C2/head validation; C1 changes are documentation-only.
10. **`git diff --check`:** pending exact branch diff check at final C2.
11. **Hosted protected `unit`:** pending final head.
12. **Production promotion:** NOT AUTHORIZED / not performed.

## C2 — pending

C2 will attempt read-only recovery of already-produced walk/run outputs, produce the bounded visual/deformation evidence that is possible without new provider work, classify runtime/payload implications, and record the final disposition. No new provider task is authorized.
