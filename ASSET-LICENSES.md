# Asset provenance and licensing

Binary assets in this repository do **not** share a single licence. This file records, per family,
where each one came from and on what basis it may be redistributed. Where provenance is partial, that
is stated rather than smoothed over.

Nothing here grants rights over third-party assets beyond what their own licences give. See
[`NOTICE`](NOTICE) for the source-code posture.

## Vendored dependencies — MIT

| Path | Component | Licence |
| --- | --- | --- |
| `game/vendor/three.module.min.js` | three.js r170 | MIT — `Copyright 2010-2024 Three.js Authors`, `SPDX-License-Identifier: MIT` |
| `game/vendor/loaders/GLTFLoader.js` | three.js example loader | MIT, same project |
| `game/vendor/utils/BufferGeometryUtils.js` | three.js example util | MIT, same project |

## Farm game creatures, egg and hero — Owner-authorized, agent-produced on a paid plan

`game/assets/creatures/*.glb` (9 files), `game/assets/egg.glb`,
and `game/assets/candidates/hero.glb`

Generated on the project's **paid Meshy plan** on 2026-09-24, under the Owner's explicit authorization
of up to 500 credits for new farm-game assets. An agent produced them, not the owner by hand, and they
were **not** Blender-finished. Each shipped file is the provider mesh with its texture recompressed to
one 1024 JPEG and its material set to metallic 0 / roughness 0.8. Two texture edits are
project-authored: the egg's texture was redrawn by script (both paid attempts had a ghosted band), and
Zapkit's dark ear tips were recoloured to yellow to avoid a franchise-like cue. The hero is a
candidate that the game does not load yet.

Redistribution rests on the owner's rights in that generated output together with the paid-plan terms
in force at generation time — **not** CC0 and **not** the source licence in [`NOTICE`](NOTICE).

**Input-provenance check.** Every prompt is recorded, with its hash, in the batch ledger. All prompts
share one house-style template that asks for a wholly original design resembling no existing franchise
character. Per-asset provider task IDs, SHA-256 hashes, credits and rejected attempts are in
[`docs/asset-production/farm-creatures-2026-09-24/`](docs/asset-production/farm-creatures-2026-09-24/README.md).
**Output-side resemblance check.** The finished models were also compared against well-known franchise
characters (batch README). Zapkit, Fernsprout and Boltbun read too close and are **held out of the game
tree** pending an Owner review; the game draws their procedural bodies. Owner visual acceptance in the
running game remains a separate gate.

## Audio

Audio is synthesised at runtime in `game/src/audio.js`. No third-party audio files ship.

## Archived assets

Provenance for assets removed in the October 2026 rescue (village props, gear, characters, enemies) is
in this file on the `archive/pre-rescue` branch.

## Reporting

If you believe any asset here infringes your rights, please open an issue and it will be removed
pending review.
