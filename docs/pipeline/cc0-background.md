# CC0 background lane — zero credits, the village's supporting cast

Ruling (Sol, 2026-08-13, under the owner's delegation): **Kenney's flat-shaded look ships as the
BACKGROUND language** — simple flat buildings → richer painted landmarks/NPCs/rewards → hero at
highest attention. Keep Kenney pieces muted and low-contrast so the painted Meshy assets own the
scene. Do not spend custom-asset budget replacing cottages.

## Custody + licence discipline (roadmap rules, non-negotiable)

1. Download packs into `tmp/cc0-packs/` (gitignored). Record source URL + sha256 in the dossier
   or commit message.
2. **Verify the licence from the downloaded archive itself** — open `License.txt` and read it.
   Kenney Fantasy Town Kit 2.0 and Nature Kit 2.1 both verified CC0 on 2026-08-13.
3. Only converted/selected pieces ship, never the raw pack.

## The measured shape of the Kenney kits

- Fantasy Town Kit: 167 GLBs, 12–732 tri each, 1 m cell modules, ONE shared material.
- **THE TRAP: the GLBs reference `Textures/colormap.png` as an EXTERNAL uri.** Shipping a raw
  kit GLB 404s its texture. Every shipped piece must either go through a Blender import→export
  pass (which embeds the palette — measured, the assembled houses embed it at ~100 KB total) or
  ship alongside the texture at the exact relative path. Assert no external uris in a test.
- Nature Kit's "GLTF format" folder actually contains .glb files. Its style family differs
  slightly from the town kit — prefer the TOWN kit's own trees/rocks for the village so the
  palette stays coherent.

## Assembling buildings from modules

`tools/blender/assemble_kenney_house.py` proved the method and its traps on 2026-08-13
(variants `cottage` and `longhouse`; add new variants inside it):

- Pieces snap on a 1 m cell grid. `wall.glb` occupies the +X EDGE FACE of its cell; Z-rotation
  maps that E→N→W→S (90° steps).
- **Compose placements as world matrices** (`Translation @ RotationZ @ template.matrix_world`).
  Editing `rotation_euler.z` after glTF import rotates in the converted local frame and scatters
  the pieces — the first assembly failed exactly this way.
- Roof orientation is knowable without renders: parse the GLB and find the high edge.
  `roof.glb`'s ridge edge is at glTF x=+0.5 at rot 0 (rises toward +X). Two rows with high edges
  facing each other meet at the shared edge and the ridge closes itself.
- Gable triangles: leave them open. `wall-slope` is 1 m tall against a 0.63 m roof rise and
  reads as broken parapets (tried, rendered, rejected). The gameplay camera is elevated; open
  gables read as shadow.
- Join everything, recentre (footprint centre at origin, base at z=0), export ONE GLB with
  `use_selection=True`. Cottage: 1,500 tri / 103 KB. Longhouse: 1,632 tri / 112 KB.

## Placement

Background pieces are DATA in the zone module (`public/src/world/zones/*.js`), never hardcoded
in a loader. The zone brief's combat-bowl rule stands for all future dressing: nothing within
radius 4 of a spawn-point enemy, nothing within 1.5 of the hero spawn, and the lane between them
stays open. After placing, capture the running game and walk the lane.
