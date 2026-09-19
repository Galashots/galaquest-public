# Character / NPC lane — reference to rigged, animated, shipped GLB

Historical proven run: the Lantern Keeper (2026-08-13) shipped at 5,258 triangles / 662 KB with
`idle` + `wave`. Historical credit totals are planning evidence only; every new paid task still needs
explicit authorization for that specific current work.

> **Character-specific anatomy, rig, and clip judgment is owned by `.agents/skills/galaquest-character-foundry/SKILL.md`.**
> Run `node tools/foundry/pose_anatomy.mjs` on the candidate before merge and interpret the measurement
> beside the actual visual evidence. Provider action names do not describe anatomy. Use
> `.agents/skills/visual-reference-first/SKILL.md` while iterating and `docs/review-guides/asset-visual-review.md`
> for handoff evidence/acceptance. This lane intentionally has **no default clip**: measure the body/clip
> you will actually ship.

> **Matching joint names are NECESSARY BUT NOT SUFFICIENT. No clip transfers between two bodies until
> rest-skeleton compatibility has been explicitly proven.** Keeper generations have demonstrated that
> identical-looking name sets can still encode different rest skeletons and translation tracks that
> re-proportion another body every frame.
>
> `tools/foundry/verify_native_clip.mjs` checks compatibility at acceptance time, and
> `tools/foundry/merge_clips.mjs` re-checks it at merge time. Do not bypass either by stripping
> translation tracks or treating a refusal as a nuisance.

### Anatomy and stance checks

Stylisation may exaggerate silhouette and proportions; it does not make implausible kinematics invisible. On the actual body/clip being considered, check at minimum:

- major pivots sit at plausible joint centres and the limb chain folds from those centres;
- torso motion is shared through an appropriate spine chain rather than faked at one waist hinge: treat the ribcage and pelvis as largely rigid masses connected by the spine, with bending shared through the lower back and twist carried through the chest/upper spine as the pose requires;
- standing/motion shows believable weight shift rather than a permanently level, mirrored pelvis/shoulder pose;
- feet maintain credible ground contact through important frames; and
- left/right differences are judged by visible consequence, not rejected by an invented symmetry threshold.

Use `pose_anatomy.mjs` as measurement beside visual evidence. A provider action name, green budget, or the previous GalaQuest clip is not anatomy authority; qualify the candidate that would actually ship.

## Rigging procedure: preserve the body, qualify the skeleton

Use this sequence for rig production; the command reference below owns provider invocation.
Inputs are the selected need, semantic asset ID, immutable source hash, intended body family,
metre scale, reference roles, destination and required actions. An unknown family is not permission
to reuse a humanoid rig on a worm or quadruped.

1. **Identify and inspect.** Run `tools/asset-registry/qualify-asset.mjs` for the record and
   `node tools/assets/glb-intake-report.mjs <source.glb>`. Save the raw source and compare its
   silhouette beside accepted content. Existing rigged sources stay pristine; do not re-rig by default.
2. **Resolve topology before skinning.** On a candidate copy, inspect cracks, nonmanifold areas,
   normals and separated shells; measure the exported bytes after any reduction. Split UV-seam
   vertices can turn a decimation into cracks. Choose seam-preserving connectivity treatment before
   reducing, and compare UVs/normals/textures afterward; never blindly weld everything. Use the
   applicable source/GLB gate from `tools/foundry/README.md`. Deliberately open garments are not
   automatically defects. Unsupported gate scope stays UNKNOWN, not zero defects.
3. **Choose the existing rig route.** For an authorized humanoid provider job, use the guarded
   rig client below and preserve task ID plus the pristine rigged result. Provider web-app capability
   is not API-client capability. For a locally authored body, use its explicitly qualified family
   recipe or author a candidate against the approved skeleton. The source-hash-locked
   `tools/blender/author_gremlin_rig.py` is a gremlin recipe, NOT a universal rigger; never remove its
   source guard to process another anatomy. No applicable family means a separate qualification task.
4. **Establish the rest/bind contract.** In Blender, inspect the candidate in Rest Position against
   the immutable reference: hierarchy, joint centres, bone directions/roll, scale and bind state.
   Keep mesh and armature in the agreed metre convention. Do not apply a posed frame as a new rest
   pose, rename joints, or change the Hero's skeleton to accommodate a downloaded clip or gear item.
   Save the editable authoring source and recipe/version before motion work.
5. **Bind and repair weights on the candidate.** Automatic weights are only a starting proposal.
   Inspect each deforming region; remove unintended influences, limit meaningful influences to the
   live character contract's cap, normalize, and compare deformation before/after pruning. Inspect
   shoulders, elbows, hips, knees, hands and facial/cloth regions where present. A skin/joint count
   does not prove normalized weights, valid inverse binds or plausible anatomy.
6. **Stress the actual exported body.** Pose flexion, twist, crouch/reach and important action extremes.
   Inspect volume collapse, opposite-limb pulling, disconnected pieces and joint pivots from front,
   side, rear and three-quarter. Run `pose_anatomy.mjs` only for an applicable humanoid skeleton;
   its humanoid axis assumptions are not a quadruped/worm gate. Preserve raw observations and the
   strongest visible defect. Missing applicable weight/bind proof stays UNKNOWN.
7. **Prove the Unity import before authoring a library.** Use the destination procedure below on
   one body and one representative motion. Check native imported rig type, skeleton/clip binding,
   unit scale, axes, material response and ground contact. Preserve source, exported GLB, FBX and
   texture hashes plus Blender/Unity versions and importer settings. Rigging is not complete merely
   because Blender plays a clip. Fix/reject the owned candidate before multiplying motions.

## Animation procedure: native motion before more clips

1. **Declare what the player must read.** Choose the required actions from the selected behavior,
   not an attractive motion pack: anticipation, contact/action, recovery and loop transitions.
   Record whether gameplay or animation owns translation/yaw. No provider name is anatomy evidence.
2. **Inventory before sourcing.** Run `node tools/foundry/clip_inventory.mjs <body.glb>` and inspect
   existing clips. Select actual exported names, durations and roots. Use the body's family recipe
   for local authoring or the individually authorized provider command below. Preserve each donor.
3. **Check compatibility before merge.** Run the strict native check below for provider clips.
   Donor mode is only for our same-body export whose joint order changed. Matching names alone is
   insufficient. A refusal is a repair/re-source condition, not permission to delete translation
   tracks. The current verifier is a scoped rest-joint check, not full inverse-bind/weight proof.
4. **Measure root behavior and anatomy.** Run
   `node tools/foundry/measure_root_motion.mjs <clip.glb> --root <actual-root-name>`.
   For humanoids also use `node tools/foundry/pose_anatomy.mjs <clip.glb> --json --sweep`.
   Compare the start/end and extrema, foot contact, pelvis/shoulder weight shift, joint folding and
   torso articulation. A rigid sliding follower is not a finished slither or walk. Correct the
   candidate motion or use a compatible source; never hide a rig error with global body offsets.
5. **Merge once onto the pristine compatible body.** Use `merge_clips.mjs` below, which repeats
   compatibility at the mutation boundary. Export/recompress a new derivative, never overwrite the
   original. Re-inventory that derivative and inspect meaningful frames and transitions; neither
   compatible skeletons nor seamless endpoints prove appealing movement or correct contact timing.
6. **Verify Unity motion in context.** Confirm actual imported clips and controller states; inspect
   idle-to-move, move-to-stop, turning and action transitions in Play Mode, then the connected game.
   Compare root/controller displacement with the declared motion owner to catch double movement,
   sliding, teleports and rotation drift. Observe baked/current deformed feet against the actual
   floor, not just rest bounds. Sample wind-up, contact and recovery rather than one flattering frame.
7. **Close the evidence, not the artistic decision.** Bind source/donor/export/import/controller,
   scene/material/capture files in the qualification receipt and existing Unity review manifest.
   Producer critique, fresh review, device evidence and Owner promotion remain distinct. Any changed
   relevant input invalidates the affected proof. No batch of fifty clips advances from one good idle.

## Provider and GLB command reference

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
   Render/capture multiple meaningful frames of every important clip from multiple angles. Apply the
   Character Foundry anatomy/rig judgment, then the shared `visual-reference-first` loop and asset visual
   review guide. Budgets passing is not the finish line.

9. **Qualify the Unity destination, then integrate under the owning package.** Follow `unity/AGENTS.md`
   and `tools/unity-migration/README.md`. The existing bridge converter/proof scene has a declared
   asset set; it is not a universal character importer. Use the applicable family converter and native
   ModelImporter settings, preserve `.meta` identities, and record any missing family adapter as UNKNOWN.
   Compare source/export/native-import skeleton, actual clip names, scale, material slots and grounding.
   Refresh through the explicitly targeted owned Editor; verify ready state and nonzero focused-test
   discovery. Inspect neutral, gameplay and motion views before a connected-game handoff. Keep
   qualification candidates in controlled custody; do not copy unapproved art into production merely
   to make an import succeed. An AnimationMixer or legacy Three.js render is not Unity acceptance.

## Cost discipline

Historical runs found body generation, rigging, and animation to be separately charged operations.
Provider prices can change. Read the task's `consumed_credits` and before/after balance for every paid
call. A nominal budget or review ceiling is a stop condition, never authorization.
