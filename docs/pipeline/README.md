# The GalaQuest asset pipeline — operator runbooks

This directory is the public, executable operator layer for asset work. It is built from measured
production runs, but it is **not** a session transcript: historical costs and failures are evidence,
while current commands, acceptance rules, and authority boundaries are what an operator should act on.

## Pick the narrow lane

| You are making | Runbook | Spend shape |
| --- | --- | --- |
| A Meshy prop or scenery asset | [props.md](props.md) | paid image-to-3D after dry-run + explicit authorization |
| A humanoid character/NPC | [characters-npcs.md](characters-npcs.md) | body + rig + motions, each separately authorized |
| Wearable/held gear | [gear.md](gear.md) | prop pipeline + measured runtime fit |
| Background village/world dressing | [cc0-background.md](cc0-background.md) | zero-credit licensed-source lane |
| A reference image | [references.md](references.md) | prepare/vet before any paid generation |

Historical credit totals in these runbooks are planning evidence only. Provider pricing can change, and
**no number in this directory authorizes spend**.

## Iron rules — every lane

1. **Credentials stay local.** Guarded Meshy clients read `.local/meshy/api-key.txt` from the current
   public checkout. Never print, log, commit, screenshot, or place credentials in a URL. Never create
   or rotate account credentials on the owner's behalf.

2. **Paid generation requires explicit authorization for the specific current work.** Use the public
   guarded clients under `tools/meshy/`; their dry-run mode is the default and is the right first step.
   A budget, old delegation, balance, task estimate, or `--go` flag is a stop/transport mechanism, not
   permission.

3. **Reference first.** Before changing how an asset looks, hangs, is held, is posed, or is framed,
   inspect multiple visual references and state the convention in words. GalaQuest's current public
   direction outranks external examples; external games provide convention evidence, not art direction.

4. **Raw provider output never ships.** Recompress/qualify the actual GLB the game will load and run the
   applicable budget/material/clip checks. Provider viewers and DCC imports are not shipping truth.

5. **Running-game pixels are final appearance authority.** A render or isolated asset inspection can
   reject a bad file; it cannot visually accept the game. Integrate, capture, and inspect the running
   experience at gameplay framing and, where useful, inspection scale.

6. **Keep source/scratch and shipping custody distinct.** Multi-megabyte inputs and generation evidence
   belong under gitignored scratch such as `tmp/` or `.local/`. Accepted runtime assets belong under the
   existing `public/assets/` family their consumer uses. Do not mix generated assets with unrelated
   gameplay changes merely because they were produced in the same session.

7. **Measure GLBs as GLBs.** Importers may synthesize helpers, bone tails, or material state. Use the
   repository's GLB readers/budget tools for file facts, and use Blender only for the DCC-layer questions
   it actually answers.

8. **Every main-character or important-NPC edit gets an artist's review pass.** Geometry gates passing
   is not the finish line. Search references, inspect the whole running subject, hunt anomalies, fix the
   worst thing, and look again.

9. **Human posing and rigging are checked against anatomy, not against the previous GalaQuest version.**
   Run `node tools/foundry/pose_anatomy.mjs <file.glb> [clip ...]` on biped candidates and read the
   measurement beside the visual evidence. Stylisation can exaggerate silhouette; it does not make a
   mechanically implausible joint chain or weight-bearing pose invisible.

10. **New lessons become durable once, in the right layer.** A reusable failure mode goes in
    `docs/MISTAKES.md`; the stable prevention rule goes into the runbook contributors will read next
    time; an objective repeat failure gets the smallest useful test ratchet. Do not copy the same warning
    into five documents.

## How a human body actually stands and bends — MANDATORY reading before posing anything

Stylisation is free on **silhouette** and constrained on **kinematics**. A four-head-tall character can
stand like a person; a realistic mesh with a welded lumbar, level pelvis, and mirrored weight does not.

| Free to exaggerate | Must remain mechanically believable |
| --- | --- |
| heads-tall, limb thickness, hand/head size | joint centres and hinge locations |
| costume outline and colour | segment relationships that govern folding |
| timing/snap/gesture size | which spinal region bends/twists |
| hair/face volume | weight shift, ground contact, and articulated chain behavior |

### Trunk and weight

The ribcage and pelvis behave as two largely rigid masses connected by the spine. Do not fake all torso
motion at one waist ring. Lower-back/chest joints should share the motion appropriate to the pose, and
the pelvis/shoulders should not stay mechanically level through an entire standing clip.

The most useful controlled lesson in this repo was not an arm-angle threshold: swapping one idle clip
for a more conversational clip made the same body look more human because stance width narrowed and
pelvis/shoulder motion increased. That is why this pipeline has **no named default idle clip**.
Measure the candidate on the body that will ship.

### Skeleton before pose

For every new biped/re-rig, check at least:

- pivots sit at plausible anatomical joint centres;
- clavicle/shoulder origins allow believable arm movement;
- limb segment relationships are not grossly distorted;
- a usable lumbar/spine chain exists and is actually animated;
- left/right differences are **reported and judged by consequence**, not rejected by an invented
  symmetry percentage;
- feet contact the ground through the important clip frames.

The public contract is the numeric/status authority for the hero. `pose_anatomy.mjs` is measurement,
not permission to overwrite an owner-locked stylised proportion.

### Clip acceptance

A provider action name is metadata, not anatomy. Before merging a clip:

1. prove native/rest-skeleton compatibility with `tools/foundry/verify_native_clip.mjs`;
2. measure the actual clip with `tools/foundry/pose_anatomy.mjs`;
3. inspect several frames/angles for weight, contact, overlap and deformation;
4. merge only onto the compatible pristine body with `tools/foundry/merge_clips.mjs`;
5. inspect the integrated running character.

A green budget score says nothing about whether a person stands naturally.

## The artist's review pass — MANDATORY for main characters and important NPCs

This applies whenever the hero, a playable character, or an NPC a child meaningfully interacts with is
edited, regenerated, re-rigged, re-posed, re-fitted, re-textured, or re-animated.

1. **Search references first.** Look at several examples of the specific thing that changed. Do not
   compare only against our previous version; that can preserve the original mistake.
2. **Capture the running game whole-frame at gameplay scale and inspection scale.** Gameplay scale asks
   whether it reads; inspection scale exposes anatomy, clipping, floating mounts, and material defects.
3. **Use multiple angles.** Front, back, and three-quarter are the minimum useful character sweep;
   add side/profile when the changed feature is angle-sensitive.
4. **Check anatomy explicitly.** Weight shift, joint locations, spine behavior, ground contact, limb
   folding, and pose energy should agree with the references and the character's role.
5. **Hunt overlaps/anomalies explicitly.** Examples: garment through limb, beard into chest, blade
   through palm, floating gear, hand inside shield, hair through shoulder, feet below ground, stretched
   triangles, or a mount that only works from one camera angle.
6. **Iterate.** Fix the worst visible problem, re-capture, and look again. Continue until remaining
   defects are consciously named/accepted rather than merely unnoticed.
7. **Report evidence, not adjectives.** Name the references, angles, clips, anatomy/overlap findings,
   changes between iterations, and any knowingly accepted limitation.

**Hard stop:** if the visible defect is actually in the mesh/rig and cannot be corrected honestly by
fit/pose/mounting, report the asset deficiency. Do not search for a transform that hides it.

## Paid-task ledger discipline

For every authorized paid task, retain enough evidence to answer what was spent and on what:

- task id and operation;
- exact input/brief identity;
- balance before/after when the client reports it;
- provider `consumed_credits` when available;
- accepted/rejected outcome and why.

Keep the ledger with the task/PR evidence, not as a permanent blanket authorization in this README.

## Maintaining this Markdown system

`docs/GUIDANCE.md` defines continual guidance linting. When a public tool/path changes, update the
runbook in the same PR. New Markdown under this directory is automatically included in
`test/guidance-integrity.test.mjs`, so a dead relative link or dead repo-local command should fail the
required unit suite instead of surviving until the next operator tries it.
