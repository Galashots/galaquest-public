# Meshy production clients

The public repo contains the guarded paid-generation clients used by the current asset pipeline.

These tools are **guarded**:

- `.local/meshy/api-key.txt` is the only key path and remains gitignored;
- every paid client is a **dry run by default**;
- only an explicit `--go` creates a Meshy task;
- balance is read before and after the task;
- the task's own `consumed_credits` is logged as the authoritative per-task cost;
- credentials and full image data URIs are never printed.

**A dry run, budget, nominal credit estimate, stop ceiling, or presence of `--go` does not grant spend authority.** Before every paid task, the operator still needs explicit owner authorization for that specific current work. Do not carry an authorization forward from an old chat, branch, asset lane, or repository note.

## Image to 3D

```bash
node tools/meshy/image_to_3d.mjs tmp/warden.png tmp/warden-body --polycount 7000
# after explicit authorization for this spend:
node tools/meshy/image_to_3d.mjs tmp/warden.png tmp/warden-body --polycount 7000 --go
```

The output directory keeps the raw GLB, Meshy task JSON, and returned textures as source evidence. Raw Meshy output does **not** ship.

## Rig an accepted humanoid body

Use the successful image-to-3D task id so the model does not need temporary public hosting:

```bash
node tools/meshy/rig_character.mjs <body-task-id> tmp/warden-rig --height 2.2
# after explicit authorization for this spend:
node tools/meshy/rig_character.mjs <body-task-id> tmp/warden-rig --height 2.2 --go
```

The tool preserves `rigged.glb`, the rig task JSON, and any basic animation GLBs returned by Meshy. Returned basic animations are source candidates, **not automatically accepted gameplay clips**.

## Buy one animation at a time

Choose an action id from the current Meshy animation library only after measuring the previous candidate. Do not buy an entire motion pack by name.

```bash
node tools/meshy/animate_character.mjs <rig-task-id> <action-id> tmp/warden-clips --name attack
# after explicit authorization for this spend:
node tools/meshy/animate_character.mjs <rig-task-id> <action-id> tmp/warden-clips --name attack --go
```

A useful planning sequence for a new combatant is `idle`, `walk`, `attack`; additional reactions follow only when the body/rig and required clips have passed. That sequence is planning guidance, not authorization to buy the clips.

## Qualify before shipping

Every candidate clip stays on its own compatible rig and is measured before acceptance:

```bash
node tools/foundry/verify_native_clip.mjs --body tmp/warden-rig/rigged.glb --clip tmp/warden-clips/<clip>.glb
node tools/foundry/pose_anatomy.mjs tmp/warden-clips/<clip>.glb
```

After accepted clips are merged into the pristine body, recompress and enforce the shipping budget:

```bash
python tools/budget/recompress_glb.py tmp/warden-merged.glb public/assets/enemies/beacon_warden.glb --size 1024 --quality 85
node tools/budget/glb_budget.mjs public/assets/enemies/beacon_warden.glb
```

Running-game pixels at gameplay distance and inspection distance remain the final appearance authority.

## Credit budgets are not authority

Historical runs can establish useful cost estimates, and a production plan can define a nominal budget or a review ceiling. Those numbers are **stop conditions only**. They do not authorize the first paid call or any later paid call.

For example, an asset lane may plan around a 35-credit nominal budget and require a production review before crossing 60. The operator must still obtain explicit authorization for the specific paid work before using `--go`.

A tool being present is not proof that the current environment can reach `api.meshy.ai` or has the uncommitted key. If either is unavailable, report that execution-surface blocker precisely; do not re-label the public repository as missing its Meshy client.
