# Character / NPC lane — reference to rigged, animated, shipped GLB

Historical proven run: the Lantern Keeper (2026-08-13) shipped at 5,258 triangles / 662 KB with
`idle` + `wave`. Historical credit totals are planning evidence only; every new paid task still needs
explicit authorization for that specific current work.

> **This lane is governed by the anatomy and artist-review rules in [README.md](README.md).** Read
> "How a human body actually stands and bends" before choosing a motion, and run
> `node tools/foundry/pose_anatomy.mjs` on the candidate before merge. Provider action names do not
> describe anatomy. This lane intentionally has **no default clip**: measure the body/clip you will
> actually ship.

> **Matching joint names are NECESSARY BUT NOT SUFFICIENT. No clip transfers between two bodies until
> rest-skeleton compatibility has been explicitly proven.** Keeper generations have demonstrated that
> identical-looking name sets can still encode different rest skeletons and translation tracks that
> re-proportion another body every frame.
>
> `tools/foundry/verify_native_clip.mjs` checks compatibility at acceptance time, and
> `tools/foundry/merge_clips.mjs` re-checks it at merge time. Do not bypass either by stripping
> translation tracks or treating a refusal as a nuisance.

## Steps

1. **Reference** per [references.md](references.md), with the character additions:
   - strict T-pose, arms horizontal, fingers together, empty hands, front view, feet in frame;
   - explicit stylised proportions rather than "same proportions" hand-waving;
   - connected, rig-friendly clothing volumes; loose overlapping panels increase segmentation and
     deformation risk.

2. **Image-to-3D preflight — free and offline.** Use the guarded public client:
   ```bash
   node tools/meshy/image_to_3d.mjs tmp/<name>.png tmp/<name>-body --polycount 5000
   ```
   Inspect the request. ~5k triangles is a historical starting point for this family, not a guarantee.

3. **Generate only after explicit authorization for this specific work.** Re-run the inspected request
   with `--go`:
   ```bash
   node tools/meshy/image_to_3d.mjs tmp/<name>.png tmp/<name>-body --polycount 5000 --go
   ```
   Keep the returned image-to-3D task id from `tmp/<name>-body/task.json`.

4. **Rig the accepted humanoid body.** Dry-run first, then use `--go` only after the specific rigging
   spend is authorized:
   ```bash
   node tools/meshy/rig_character.mjs <body-task-id> tmp/<name>-rig --height <meters>
   node tools/meshy/rig_character.mjs <body-task-id> tmp/<name>-rig --height <meters> --go
   ```
   Preserve `rigged.glb`, task JSON, and any returned basic animation candidates. A returned clip is a
   source candidate, not automatic gameplay acceptance.

5. **Buy motions one at a time, after measuring what you already have.** Verify the current provider
   animation-library action id before spending. Dry-run the request, then add `--go` only with explicit
   authorization for that motion:
   ```bash
   node tools/meshy/animate_character.mjs <rig-task-id> <action-id> tmp/<name>-clips --name <label>
   node tools/meshy/animate_character.mjs <rig-task-id> <action-id> tmp/<name>-clips --name <label> --go
   ```
   A historically calm-sounding idle (`Idle_02`) measured as the worst standing clip we owned, while a
   more conversational motion read better on the same body. The lesson is not to substitute a new
   favorite. **Measure the candidate you actually chose.**

6. **Prove native compatibility before merging.** For vendor/provider output use strict mode:
   ```bash
   node tools/foundry/verify_native_clip.mjs --body tmp/<name>-rig/rigged.glb --clip tmp/<name>-clips/<clip>.glb
   ```
   For a clip authored by us against the same body, donor mode may forgive joint-array order and
   nothing else:
   ```bash
   node tools/foundry/verify_native_clip.mjs --body tmp/<name>-rig/rigged.glb --clip tmp/<name>-clips/<ours>.glb --mode donor
   ```

7. **Merge accepted clips onto the pristine compatible body.** Example:
   ```bash
   node tools/foundry/merge_clips.mjs --into tmp/<name>-rig/rigged.glb --out tmp/<name>-merged.glb \
     --from "tmp/<name>-clips/<idle>.glb=idle" --from "tmp/<name>-clips/<wave>.glb=wave"
   ```

8. **Recompress, score, inventory, and LOOK.**
   ```bash
   python tools/budget/recompress_glb.py tmp/<name>-merged.glb tmp/<name>-ship.glb --size 1024 --quality 85
   node tools/budget/glb_budget.mjs tmp/<name>-ship.glb
   node tools/foundry/clip_inventory.mjs tmp/<name>-ship.glb
   node tools/foundry/pose_anatomy.mjs tmp/<name>-ship.glb
   ```
   Render/capture multiple frames of every important clip from multiple angles, then run the full
   artist's review pass from the pipeline README. Budgets passing is not the finish line.

9. **Ship and integrate.** Put the accepted file under the consumer's existing `public/assets/` family,
   wire an AnimationMixer/clip selection using runtime identifiers discovered from the actual asset,
   then capture the running game at gameplay and inspection scale. Running-game pixels are final
   appearance authority.

## Cost discipline

Historical runs found body generation, rigging, and animation to be separately charged operations.
Provider prices can change. Read the task's `consumed_credits` and before/after balance for every paid
call. A nominal budget or review ceiling is a stop condition, never authorization.
