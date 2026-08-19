# Character / NPC lane — reference to rigged, animated, shipped GLB. 23+ credits, ~45 minutes

Proven run: the Lantern Keeper (2026-08-13) — 5,258 tri, 662 KB shipped with `idle` + `wave`,
placed by the village zone. Total 29 credits including one 3-credit lesson recorded below.

> **This lane is also governed by MANDATORY iron rule 9, "How a human body actually stands and
> bends"** — see [README.md](README.md#how-a-human-body-actually-stands-and-bends--mandatory-reading-before-posing-anything).
> Read it before choosing an `action_id` in step 4, and run
> `node tools/foundry/pose_anatomy.mjs` on the downloaded clip before merging it in step 5. The
> library's names do not describe their anatomy: **`action_id` 11 = `Idle_02` is the worst-scoring
> standing clip we own**, and this file recommended it as "the default choice" until 2026-08-14.
> **This lane now has no default clip on purpose** — see step 4. Measure the one you picked.
>
> **This lane is governed by the MANDATORY artist's review pass** — see
> [README.md](README.md#the-artists-review-pass--mandatory-for-main-characters-and-important-npcs)
> (iron rule 8, the owner's ruling of 2026-08-15). Everything produced here is either a main character or
> an important NPC by definition, so the pass applies to **every** run of this lane and to every
> later edit of anything it shipped — including a re-fit, a re-pose, a re-texture or a new clip, not
> only a fresh generation. Step 6 below is where it starts, and it does not end until you have
> iterated: searched references, captured the running game at gameplay AND inspection scale from
> front/back/three-quarter, checked anatomy explicitly, swept for overlaps and anomalies explicitly,
> fixed the worst thing, and looked again. Budgets passing is not the finish line.

**The headline fact that makes this lane cheap and scriptable:** the API rigging endpoint returns
the same 24 joint NAMES the hero uses (`Hips`, `Spine`/`Spine01`/`Spine02`,
`Left/RightUpLeg→Leg→Foot→ToeBase`, `Left/RightShoulder→Arm→ForeArm→Hand`, `neck`, `Head`,
`head_end`, `headfront`). Measured on the keeper. That is what lets the whole lane run end-to-end
through the API with zero browser steps.

> **Matching joint names are NECESSARY BUT NOT SUFFICIENT. No clip transfers between two bodies
> until rest-skeleton compatibility has been explicitly proven.**
>
> This paragraph used to say the shared names meant `merge_clips.mjs` "grafts clips between any two
> of these characters by node name". That is false, and acting on it produces an asset that passes
> every name-based check and is visibly broken.
>
> Keeper v1 and Keeper v2 share all 24 joint names, the same hierarchy AND the same joint order, and
> are still different skeletons. A Meshy animation GLB carries a **translation track on every
> joint**, and a joint's local translation IS its bone — so binding v1's clip to v2 does not re-pose
> v2, it re-proportions it, every frame. Measured (Phase C1): forearms **+45% / +39%**, feet
> **+51% / +50%**, shoulders **−48%**, worst bone-length error **1192.97%**. Photographed as well as
> measured: the hand pushed clear of the sleeve, arms sunk into the coat, the face driven forward off
> the head.
>
> Name-matching is not even a reliable guide to ORDER. The hero and Keeper v2 carry the same 24 names
> in different sequence (the hero runs `…LeftHand, neck, Head, head_end, headfront, RightShoulder…`;
> Keeper v2 runs `…LeftHand, RightShoulder, …, neck, Head…`).
>
> Two tools enforce this, and neither may be bypassed, weakened, or worked around by stripping
> translation tracks:
>
> ```bash
> # At acceptance time, on a file that just arrived -- checks the FULL joint set, order, hierarchy
> # and rest pose, not only the nodes one clip happens to drive.
> node tools/foundry/verify_native_clip.mjs --body <body>.glb --clip <candidate>.glb
>
> # For a clip WE authored against that body (the Blender lane), where a joint-array permutation is
> # the exporter's doing and not evidence of a re-rig:
> node tools/foundry/verify_native_clip.mjs --body <body>.glb --clip <ours>.glb --mode donor
> ```
>
> **`strict` is the default and is the right mode for anything arriving from a vendor** — a reordered
> joint array there is real evidence something was re-rigged. `donor` forgives **joint order and
> nothing else**, because three.js binds tracks by node name and `merge_clips.mjs` remaps channels by
> node name into the pristine target, so a donor's ordering never reaches the shipped body. Missing or
> extra joints, a changed parent, a different rest bone length and a different rest rotation are hard
> failures in both modes: the Keeper v1 → v2 graft fails on rest bone length, so donor mode does not
> soften it by one joint. the owner's ruling, AP1 closeout.
>
> `tools/foundry/merge_clips.mjs` re-checks the same precondition at merge time and refuses a
> cross-body graft with the measured offenders named. A refusal from either is a real finding about
> the asset, never an obstacle to route around. See
> [C1's stop report](../superpowers/phases/C1-keeper-v2/state.md).

## Steps

1. **Reference** per [references.md](references.md), with the character additions:
   - **STRICT T-POSE**, arms horizontal, fingers together, empty hands, front view, feet in frame.
   - Anchor proportions with the style anchor image AND explicit language (chunky heads-tall);
     "same proportions" alone drifts.
   - Clothing is one solid connected volume (a robe beats loose panels; tight clothes segment
     best if gearing ever matters — see the armor dossier).

2. **Generate** — same tool as props:
   ```bash
   node tools/meshy/gen_prop.mjs tmp/<name>-flat.png tmp/<name>.glb 5000     # 15 credits
   ```
   ~5,000 tri is the proven character budget (hero 7.4k, keeper 5.3k, wolf 3.1k).

3. **Rig via the API** — 5 credits, ~40 s. POST `input_task_id` = the step-2 task id:
   ```
   POST https://api.meshy.ai/openapi/v1/rigging   { "input_task_id": "<task-id>" }
   GET  https://api.meshy.ai/openapi/v1/rigging/<rig-task-id>
   ```
   `result.rigged_character_glb_url` is the rigged T-pose GLB; `result.basic_animations` carries
   FREE walking/running variants. Record the rig task id — every animation request needs it.
   (The REST rigging API is biped-humanoid ONLY. Quadrupeds still go the browser route — see the
   wolf dossiers.)

4. **Animate via the API** — 3 credits per motion, ~30 s each:
   ```
   POST https://api.meshy.ai/openapi/v1/animations  { "rig_task_id": "<rig-task-id>", "action_id": <int> }
   ```
   `action_id` is an INTEGER from the Animation Library (docs.meshy.ai → Animation Library
   Reference). Ids that matter here: 11 = Idle_02, 0 = Idle (energetic fidget — see the lesson),
   28 = Big_Wave_Hello, **56 = Stand_and_Chat**, 1/30 = walks, 14–16 = runs. Download
   `result.animation_glb_url`.

   **Do not default to `11 = Idle_02`** — that was this file's recommendation until 2026-08-14 and it
   is the worst-scoring clip we own on iron rule 9's measurements (stance 2.30× hip width, shoulder
   tilt range 0.5° over the whole clip: a mannequin). Measured against it on the *same body with the
   same camera*, `56 = Stand_and_Chat` scored stance 1.40× and shoulder range 17.7°, and read as a
   person rather than a costume. Prefer conversational/gestural actions for anyone a child talks to,
   and **measure whatever you pick** — 3 credits buys a clip, and `pose_anatomy.mjs` tells you
   whether it was worth it before you merge it.

   **The 3-credit lesson (2026-08-13):** action 0 "Idle" is an ENERGETIC weight-shifting fidget
   with a raised leg. On the robed elderly keeper it tore the skirt and read as dancing. Preview
   the clip's energy against the character's build and age — render a frame sweep BEFORE accepting.

   That lesson used to end by naming `Idle_02` as the safe pick for anyone calm, clothed or old —
   removed, because it contradicted the correction three paragraphs above it. It is **not** replaced
   with another named clip, deliberately: the mistake was having a default at all. `Idle_02` looked
   like the obvious choice for a calm elderly character and measured as the worst standing clip we
   own. **Measure the candidate you actually chose, on the body you are actually shipping** —
   `pose_anatomy.mjs` costs nothing, and 3 credits buys a clip.

5. **Merge clips onto the rigged body** (each animation GLB is a full ~7 MB copy of the body;
   ship ONE body and lift the clips):
   ```bash
   node tools/foundry/merge_clips.mjs --into tmp/<name>-rigged.glb --out tmp/<name>-clips.glb \
     --from "tmp/<name>-idle.glb=idle" --from "tmp/<name>-wave.glb=wave"
   ```
   The rigged base keeps a residual `Armature|clip0|baselayer` T-pose clip; it is ~60 KB and
   harmless, and consumers select clips by name.

6. **Recompress + score + LOOK.**
   ```bash
   python tools/budget/recompress_glb.py tmp/<name>-clips.glb tmp/<name>.glb --size 1024 --quality 85
   node tools/budget/glb_budget.mjs tmp/<name>.glb
   node tools/foundry/clip_inventory.mjs tmp/<name>.glb
   ```
   Then render a FRAME SWEEP of every clip (several frames each, two angles) and open all of
   them — this is what caught the torn robe. A character is judged animated, never at rest only.

   **Then run the artist's review pass in full** (iron rule 8). The frame sweep is the input to it,
   not a substitute for it: the sweep tells you what the asset does, the pass tells you whether it
   is right, and only the pass includes searched references, the explicit anatomy check, the
   explicit overlap/anomaly sweep, and the iterate-until-it-reads loop. A character that passes
   step 6's three commands and has not had the pass is **not shippable**.

7. **Ship.** `public/assets/world/<name>.glb` (or wherever the consumer expects), scale measured
   at load (keeper imports at 2.70 raw and is scaled to 1.65 m by the zone loader), own
   AnimationMixer, `idle` looping.

## Costs recap

15 (textured body) + 5 (rig) + 3 per motion. Free walking/running ride along with the rig.
Two-motion NPC: 26 credits nominal.
