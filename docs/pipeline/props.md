# Prop lane — reference image to shipped GLB, 15 credits, ~15 minutes

Proven runs: the belt lantern (838 tri, 135 KB shipped) and the dark Lantern Tree (~3k tri,
386 KB shipped), both 2026-08-13.

## Steps

1. **Reference.** Follow [references.md](references.md). Output: `tmp/<name>.png`, vetted and
   flattened to `tmp/<name>-flat.png` by `tools/meshy/flatten_bg.py`.

2. **Generate.**
   ```bash
   node tools/meshy/gen_prop.mjs tmp/<name>-flat.png tmp/<name>.glb <target_polycount>
   ```
   Polycount guide, from shipped results: small worn prop 800; landmark 3000; complete building
   would be ~2500 (untested — Kenney covers buildings today). The tool brackets the balance,
   polls synchronously (~90 s), and downloads the GLB. `consumed_credits` should read 15.

3. **Recompress.** `--size 512` for hand-scale props, `--size 1024` for landmarks:
   ```bash
   python tools/budget/recompress_glb.py tmp/<name>.glb tmp/<name>-512.glb --size 512 --quality 85
   ```
   Expect ~4–10% of the raw size. If the material needs real cutout alpha, STOP — jpeg is the
   wrong container and nothing shipped so far needed it.

4. **Score.** `node tools/budget/glb_budget.mjs tmp/<name>-512.glb` — all PASS, or write down why.

5. **Look.** Render a turntable and open every image:
   ```bash
   blender --background --factory-startup --python tools/blender/render_prop.py -- tmp/<name>-512.glb tmp/<name>-renders
   ```
   (Blender lives at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`.) For animated
   characters use `tools/blender/render_npc.py -- <char.glb> <outdir> <clip:frame> ...` instead —
   a static render cannot catch a torn clip. What you are checking: did holes/rings survive (the lantern's carry ring did), did
   painted lines become geometry channels (they will if the reference broke the flat-value rule),
   does the silhouette read at gameplay scale (~90 CSS px — squint or downscale the render).

6. **Ship.** Copy to `public/assets/<world|props|gear>/<name>.glb`, wire the consumer, and let
   the zone/asset test that pins byte ceilings catch bloat. Scale is set AT LOAD by measuring the
   import (the wolf and the Lantern Tree both do this) — Meshy normalizes exports to a unit-ish
   bound, so never hardcode a magic scale from the file.

## Known traps

- Meshy reconstructs painted seams as real channels; the reference rules exist for this.
- The ×N badge / retries in the browser are free retries of the SAME generation; the API has no
  equivalent — a bad result means fixing the reference, not re-rolling.
- `should_texture: false` saves nothing on this route; texturing is included in the 15.
- The task id is worth recording in your ledger line — it is the only handle for re-downloading.
