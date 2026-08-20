# Prop lane — reference image to shipped GLB

Historical measured runs include the belt lantern (838 tri, 135 KB shipped) and the dark Lantern Tree
(~3k tri, 386 KB shipped), both produced in 2026-08. Treat those costs as planning evidence, not spend
authority.

## Steps

1. **Reference.** Follow [references.md](references.md). Output a clean PNG such as `tmp/<name>.png` and
   inspect it before any paid call.

2. **Preflight generation — free and offline.** Use the guarded public client:
   ```bash
   node tools/meshy/image_to_3d.mjs tmp/<name>.png tmp/<name>-meshy --polycount <target>
   ```
   The command prints the request shape and exits without credentials/network/spend. Polycount guides
   from historical shipped results: small worn prop ~800; landmark ~3000. They are starting points,
   not universal gates.

3. **Generate only after explicit authorization for this specific work.** Re-run the same inspected
   request with `--go`:
   ```bash
   node tools/meshy/image_to_3d.mjs tmp/<name>.png tmp/<name>-meshy --polycount <target> --go
   ```
   The tool records `task.json`, the raw GLB, returned textures, balance before/after, and the task's
   authoritative `consumed_credits`. Raw Meshy output does not ship.

4. **Recompress.** `--size 512` for hand-scale props, `--size 1024` for landmarks:
   ```bash
   python tools/budget/recompress_glb.py tmp/<name>-meshy/<name>.glb tmp/<name>-ship.glb --size 512 --quality 85
   ```
   If the material requires true cutout alpha, stop and choose an alpha-preserving texture path rather
   than blindly converting it to JPEG.

5. **Score.** Run `node tools/budget/glb_budget.mjs tmp/<name>-ship.glb`. Every applicable gate should
   pass or have an explicit, reviewable ruling.

6. **Look.** Render/inspect the whole asset and then integrate it into the running game. A current
   Blender executable may be supplied by the local environment; do not encode one machine's absolute
   executable path in this runbook. Example render command when Blender is available on PATH:
   ```bash
   blender --background --factory-startup --python tools/blender/render_prop.py -- tmp/<name>-ship.glb tmp/<name>-renders
   ```
   Check intended openings, accidental channels, silhouette at gameplay scale, material response, and
   whether the object still reads after integration. The running game is final appearance authority.

7. **Ship.** Place the accepted asset under the consumer's existing `public/assets/` family, wire the
   consumer, and run the relevant asset/runtime tests. Scale is set at load from measured bounds where
   the consumer supports that pattern; do not copy a magic scale merely because Meshy normalized a file.

## Known traps

- Image-to-3D reconstructs painted seams and accidental gaps; reference quality is part of production.
- A bad generation is a reason to fix the reference/brief before paying for another task.
- Provider cost and model behavior can change. Measure each paid task; do not turn historical credit
  numbers into durable permission or guarantees.
- Record the task id with the asset evidence so a result can be traced without relying on chat history.
