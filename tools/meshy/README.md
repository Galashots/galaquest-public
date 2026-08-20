# Meshy production clients

The public repo now contains the paid-generation clients that the asset pipeline previously assumed existed somewhere else.

These tools are **guarded**:

- `.local/meshy/api-key.txt` is the only key path and remains gitignored.
- every paid client is a **dry run by default**;
- only an explicit `--go` creates a Meshy task;
- balance is read before and after the task;
- the task's own `consumed_credits` is logged as the authoritative per-task cost;
- credentials and full image data URIs are never printed.

## Beacon Warden body

```bash
node tools/meshy/image_to_3d.mjs tmp/warden-flat.png tmp/warden-body --polycount 7000
# inspect the request, then deliberately spend:
node tools/meshy/image_to_3d.mjs tmp/warden-flat.png tmp/warden-body --polycount 7000 --go
```

The output directory keeps the raw GLB, Meshy task JSON, and returned textures as source evidence. Raw Meshy output does **not** ship.

## Rig the accepted body

Use the successful image-to-3D task id so the model does not need temporary public hosting:

```bash
node tools/meshy/rig_character.mjs <body-task-id> tmp/warden-rig --height 2.2
node tools/meshy/rig_character.mjs <body-task-id> tmp/warden-rig --height 2.2 --go
```

The tool preserves `rigged.glb`, the rig task JSON, and any basic animation GLBs returned by Meshy. Returned basic animations are source candidates, **not automatically accepted gameplay clips**.

## Buy one animation at a time

Choose an action id from the Meshy animation library only after measuring the previous candidate. Do not buy an entire motion pack by name.

```bash
node tools/meshy/animate_character.mjs <rig-task-id> <action-id> tmp/warden-clips --name attack
node tools/meshy/animate_character.mjs <rig-task-id> <action-id> tmp/warden-clips --name attack --go
```

For the Warden, the minimum useful set is `idle`, `walk`, `attack`; `hit` and `death` follow only when the body/rig and required clips have passed.

## Qualify before shipping

Every candidate clip stays on the Warden's own rig and is measured before acceptance:

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

## Credit authority

The current owner authorization is **up to 500 Meshy credits** for active GalaQuest production. The Beacon Warden lane keeps its narrower internal stop rule: **35 credits nominal, 60 credits ceiling before a production-director review**, with the separate maul deferred until the body passes.

A tool being present is not proof that the current agent environment can reach `api.meshy.ai` or has the uncommitted key. If either is unavailable, report that execution-surface blocker precisely; do not re-label the public repository as missing its Meshy client.