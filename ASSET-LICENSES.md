# Asset provenance and licensing

Binary assets in this repository do **not** share a single licence. This file records, per family,
where each one came from and on what basis it may be redistributed. Where provenance is partial, that
is stated rather than smoothed over.

Nothing here grants rights over third-party assets beyond what their own licences give. See
[`NOTICE`](NOTICE) for the source-code posture.

## Vendored dependencies — MIT

| Path | Component | Licence |
| --- | --- | --- |
| `public/vendor/three.module.min.js` | three.js r170 | MIT — `Copyright 2010-2024 Three.js Authors`, `SPDX-License-Identifier: MIT` |
| `public/vendor/loaders/GLTFLoader.js` | three.js example loader | MIT, same project |
| `public/vendor/utils/BufferGeometryUtils.js` | three.js example util | MIT, same project |
| `public/vendor/utils/SkeletonUtils.js` | three.js example util | MIT, same project |

The upstream licence headers are intact in these files and must stay intact in any redistribution.

## Village props and environment — CC0 1.0

`public/assets/props/village/*.glb` (14 files) and `public/assets/world/lantern_tree.glb` derive
from public-domain asset packs (`public/assets/world/keeper.glb` is **not** in this CC0 set — it is
paid-plan Meshy output, covered in the Characters section below). Their licences were verified by reading the licence file *inside* each downloaded archive
rather than trusting a store page, and each archive was recorded by SHA-256 in the engineering
archive at selection time.

| Pack | Author | Licence |
| --- | --- | --- |
| KayKit — City Builder Bits, Medieval Hexagon, Dungeon Remastered | Kay Lousberg | CC0 1.0 Universal |
| Quaternius — Universal Base Characters, Modular Character Outfits | Quaternius | CC0 1.0 Universal |

CC0 does not require attribution. It is given because these packs are the origin of measured values
this project relies on.

## Characters — owner-created, generated on a paid plan

`public/assets/hero/*.glb`, `public/assets/world/keeper.glb`, `public/assets/enemies/wolf.glb`,
`public/assets/characters/wren_ranger.glb`

Produced by the project owner using Meshy under a **paid Meshy plan**, then rigged, retopologised and
finished in Blender by the owner. Redistribution rests on the owner's rights in that generated output
together with the paid-plan terms in force at generation time — **not** on CC0 and **not** on the
source licence in `NOTICE`.

`wren_ranger.glb` is a **proposed** optimized production derivative of the owner-directed paid-plan
candidate `wren-ranger-v1` (SHA-256 `5171c4bb...`, 19,150,856 bytes) recovered from the unmerged
branch `feat/ranger-lodge-expansion`. The derivative — 896,476 bytes, SHA-256
`f6f776ce47c78fdea20d99593cde200e7b8dcd162f14a17488e5fd93393ef9b8` — was produced by merging the
base body's idle clip (via `tools/foundry/merge_clips.mjs`), mesh simplification (via
`@gltf-transform/cli`), and texture recompression (via `tools/budget/recompress_glb.py`). **No new
generation was performed and no credits were spent.**

It is a **candidate for production promotion, proposed in PR #127** — not an accepted promotion.
Asset promotion into shipped production is Owner-controlled, and **Owner running-game visual and
product acceptance remains outstanding**. The provenance and derivative bytes above are recorded
now because they are established fact; the product transition is not.

## Gear — owner-created, generated on a paid plan

`public/assets/gear/**/*.glb` (including `candidates/`)

| Asset | Basis |
| --- | --- |
| `sword_ironwood.glb`, `shield_ironwood.glb` | Meshy paid-plan generation, owner-directed, Blender finishing |
| `sword_silverguard.glb` | Meshy paid-plan generation from an owner-drawn concept, Blender finishing |
| `helmet_silverguard.glb`, `shoulder_silverguard.glb` | Meshy paid-plan generation, owner-directed, Blender finishing. The right shoulder is the left mirrored by a negative X scale, not a second generation. |
| `candidates/sword_wildwood_w1a.glb` | Meshy paid-plan generation, owner-directed. Candidate, not yet promoted to gameplay. |
| `candidates/dawnwarden-helmet-v1.glb`, `candidates/dawnwarden-sword-v1.glb` | Meshy paid-plan generation, owner-directed, then re-exported clean (measured generator `pygltflib@v1.16.5`). **Candidate, not shipped.** Kept in-tree only because they are the reference the owner-accepted Asset Forge fit was authored against. |

**Input-provenance check.** These were reviewed for deliberate third-party or franchise input before
publication. The generation prompts themselves are not recoverable from this repository — they lived
in a gitignored working directory — but the surrounding engineering record describes what was asked
for in each case (for example an open-faced helmet with no visor; a single isolated shoulder piece
with no arm sleeve), and it is consistently generic fantasy-armour language. A targeted search of the
full engineering tree for named franchises, characters and recognisable properties returned **no
matches** in any gear-generation record. On that evidence these assets are treated as original work.

## Item icons — renders of the gear above

`public/assets/items/*.png`

Rendered by `tools/assets/render-item-icons.mjs` from the gear GLBs listed in the table above, in
this repository, with no third-party input. Each icon is a **derivative of exactly one asset already
covered here**, so it carries that asset's basis and nothing new: an icon of `shield_ironwood.glb`
rests on the same owner-directed paid-plan Meshy generation the mesh does. The renders add no
external art, texture, brush, font or reference.

Two mappings are not one-to-one with the item id, and are recorded here rather than inferred from a
filename (a filename states a role, not a provenance):

| Icon | Rendered from |
| --- | --- |
| `starter_sword.png` | `sword_ironwood.glb` — the Starter Sword has no standalone mesh (the hero's body mesh carries its blade), so this is a **stand-in**, not that item's own model |
| `wildwood_blade.png` | `candidates/sword_wildwood_w1a.glb` — the candidate mesh, which is also the model the running game mounts for this weapon |

These renders are **provisional**: they establish exact identity with the in-game model, not the
polished illustrated portrait #88 asks for. Replacing one is a file drop at the same path; no code
changes. Final illustrated item art is UNKNOWN pending the Owner's art lane.

## Beacon Warden — owner-created, generated on a paid plan

`public/assets/enemies/beacon_warden.glb`

Optimized production derivative of an owner-directed paid-plan Meshy generation. The provider source
is `Meshy_AI_Thornbound_Warlock_biped.zip` (SHA-256
`56448250399a3078a4ed4ef79a66fdd6c2cfedabbee0ee46f674e087abca8c1c`, 19,938,516 bytes, dated
2026-08-27), three per-motion rigged GLBs held in the owner's external Drive archive; the large source
is deliberately not committed. The derivative — 618,224 bytes, SHA-256
`17177d6bb6b2556cefa0f8c7747613492bcd14b8068a8ed7438d5ed996ce8a7d` — merges those three clips onto one
body and recompresses the atlas, using `tools/foundry/merge_clips.mjs` and
`tools/budget/recompress_glb.py`. **No new generation was performed and no credits were spent**
producing it; the provider balance was 662 before and after.

Basis is the same as the character and gear sections above: owner-directed generation on a paid Meshy
plan, redistribution resting on the owner's rights in that generated output together with the
paid-plan terms in force at generation time. **Not CC0.**

The shipped file is named for its ROLE while the provider source is named "Thornbound Warlock"; the
owner confirmed on 2026-08-28 that this asset is the Beacon Warden, and a source or vendor name is not
a runtime identifier. It is loaded by `public/src/enemies/warden.js` and now replaces the procedural
stand-in body in the running encounter. Structural, budget and running-game evidence are recorded in
[`docs/briefs/BW1_BEACON_WARDEN_REAL_GLB.md`](docs/briefs/BW1_BEACON_WARDEN_REAL_GLB.md); **owner
visual acceptance in the running game remains a separate, outstanding gate.**

## Candidate bank held outside this repository

Some owner-directed paid-plan Meshy output is deliberately **not** stored in Git. It is still project
material and is recorded here so its basis is not lost along with its bytes.

| Group | Where the bytes are | Count | Status |
| --- | --- | --- | --- |
| Wren Ranger base (wren-ranger-v1) | external source archive; also reachable on the unmerged branch `feat/ranger-lodge-expansion` | 1 file | **candidate for production promotion** — derivative proposed as `public/assets/characters/wren_ranger.glb` in PR #127, pending Owner acceptance |
| Wren Ranger walk + run | external source archive; also reachable on the unmerged branch `feat/ranger-lodge-expansion` | 2 files | qualified-compatible, not shipped (Wren does not locomote) |
| Bramble Stalker (base + walk + run) | external source archive; also reachable on the unmerged branch `feat/ranger-lodge-expansion` | 3 files | candidate |
| Enemy Wave 1 rigged candidates | external source archive; also reachable on the unmerged branch `feat/enemy-asset-wave-1` | 13 files | candidate |
| Seven gear families x five slots | Meshy provider task output; never downloaded | 35 tasks | candidate |

Basis is the same as the sections above: **owner-directed generation on a paid Meshy plan**,
redistribution resting on the owner's rights in that generated output together with the paid-plan
terms in force at generation time. **Not CC0**, and not covered by the source licence in
[`NOTICE`](NOTICE).

Every item's provider task IDs, byte size, SHA-256, git blob OID and archive destination are recorded
in [`docs/asset-production/asset-platform-inventory.json`](docs/asset-production/asset-platform-inventory.json).

Two honest limits. First, **candidate is not shipped**: nothing in this table has passed visual or
running-game acceptance, and appearing here is not a promotion. Second, the input-provenance review
below was performed against the *gear* generation record; the enemy and character candidates were
generated from the same owner-directed generic-fantasy briefs recorded in
`docs/asset-production/ENEMY_BATCH_2026-08-20.md`, which describes the roster as deliberately
"designed for farming variety without copying any specific game character". That is the evidence
available; it is a reasoned position, not a legal opinion, and no stronger claim is made here.

Design *references* cited in project documentation — naming other games when discussing, say, a row of
hearts as a health-display precedent — are commentary, not derivation. No asset here is traced from
another game's art.

## Audio

Audio is synthesised at runtime in `public/src/audio/`. No third-party audio files ship.

## Reporting

If you believe any asset here infringes your rights, please open an issue and it will be removed
pending review.
