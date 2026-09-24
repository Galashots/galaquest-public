# Farm creatures, egg and hero: Meshy batch of 2026-09-24

Provenance for the models the farm game (`prototypes/farm-slice/`) loads. The Owner authorized up to
500 Meshy credits for new farm-game assets on 2026-09-24. An agent produced the batch under that
authorization; it spent **353 credits** over 36 paid calls (balance 4801 → 4448, matching the sum of
per-task `consumed_credits` exactly).

| File | What it is |
| --- | --- |
| `manifest.json` | Per asset: status, prompt, measured bounds, triangles, bytes, SHA-256 of the shipped file, provider task IDs, credits, licence note; plus the rejected attempts. |
| `ledger.json` | Every paid call in order: task ID, model, inputs (prompt and its hash), balance before/after, consumed credits, accept/reject and why. |
| `refs/*.jpg` | The reference image each model was generated from, downsized to 512 px for review. |
| `contact-sheet.jpg` | All 14 shipped models side by side. |
| `recipes/prompts.mjs` | The shared house-style prompt template. |
| `recipes/rebake_egg.py`, `recipes/recolor_region.py` | Project-authored texture edits: the egg's redrawn texture (both paid attempts had a ghosted band) and Zapkit's recoloured ear tips. |

## Paths

The manifest names files as the batch folder did. In this repository:

| Manifest | Repository |
| --- | --- |
| `ship/<creature>.glb` | `prototypes/farm-slice/assets/creatures/<creature>.glb` |
| `ship/egg.glb` | `prototypes/farm-slice/assets/egg.glb` |
| `ship/hero.glb` | `prototypes/farm-slice/assets/candidates/hero.glb`: a candidate, not loaded by the game yet |
| `refs/<asset>.png` | `refs/<asset>.jpg` (downsized) |

`test/farm-asset-provenance.test.mjs` keeps each shipped file's SHA-256 equal to the manifest's.

Raw provider outputs (full-size GLBs, textures, task JSON) are not committed. They are recoverable
from the provider by the task IDs above while the provider retains them (`--recover <task-id>` on the
`tools/meshy/` clients reads an existing task without spending).

Licence basis: `ASSET-LICENSES.md`, farm game section. Promotion into shipped production remains
Owner-controlled (`AGENTS.md`).
