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
| `contact-sheet.jpg` | All 14 accepted models side by side, including the three held ones (review copy). |
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
| The batch folder's own tools scripts (prompts, egg re-bake, region recolour) | `recipes/prompts.mjs`, `recipes/rebake_egg.py`, `recipes/recolor_region.py` |
| `tools/budget/recompress_glb.py` | `tools/budget/recompress_glb.py` (the repository's own) |

`test/farm-asset-provenance.test.mjs` keeps each shipped file's SHA-256 equal to the manifest's and
keeps held models out of the game tree.

## Resemblance check (output side)

The prompts ask for original designs, but generated models can still land near a famous character.
Each finished model was compared by eye against well-known creature franchises (contact sheet,
2026-09-24; agent check plus the independent PR review). This is a screen, not legal clearance.

| Model | Reads as | Verdict |
| --- | --- | --- |
| Sprout | sun-maned lion cub | generic; ship |
| Puddlefin | blue fin-tailed pup with a crest | generic; ship |
| Mossbun | leaf-eared rabbit | generic; ship |
| Cinderkit | upright red fox with flame tips | mild, common motif; ship |
| Splashpuff | round blue bird with a rainbow crest | mild, common motif; ship |
| Glimmerpup | small winged yellow fox | generic; ship |
| Flamewhisk | long red lizard with a flame tail | generic; ship |
| Tidekit | long blue sea serpent with shell spines | mild generic resemblance in the fin-ears; ship |
| Bloomtail | antlered green lizard with a flower tail | generic; ship |
| Zapkit | yellow, pointed ears, dark zigzag back stripes, jagged tail | **too close to a famous electric mouse; held** |
| Fernsprout | upright green gecko with a leaf crest | **too close to a famous grass-starter gecko; held** |
| Boltbun | orange, cream belly, lightning-bolt ear | **too close to a famous electric-mouse evolution; held** |

Held models are not in the game tree: the game draws their procedural bodies, and none of them can
hatch in the current slice anyway. Each manifest entry says why and how to recover the file from Git
history. Shipping, reworking or dropping them is the Owner's call (reworking would be new spend).

Raw provider outputs (full-size GLBs, textures, task JSON) are not committed. They are recoverable
from the provider by the task IDs above while the provider retains them (`--recover <task-id>` on the
`tools/meshy/` clients reads an existing task without spending).

Licence basis: `ASSET-LICENSES.md`, farm game section. Promotion into shipped production remains
Owner-controlled (`AGENTS.md`).
