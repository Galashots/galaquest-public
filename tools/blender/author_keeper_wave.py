# Author a native `wave` clip for the Lantern Keeper (v2 rig), headlessly -- same architecture as
# author_keeper_idle.py, applied to a greeting gesture instead of a standing idle.
#
#   blender --background --factory-startup --python tools/blender/author_keeper_wave.py \
#           -- <keeper-v2-body.glb> <out-clip.glb>
#
# WHY THIS EXISTS. AP2-A shipped Keeper v2 (Idle_11 + Talk_Passionately + corrected material), and
# neither Meshy pack supplied a v2-native wave -- the only wave clip anywhere is on the old v1 body,
# which fails donor/strict compatibility against v2 (measured, tools/foundry/verify_native_clip.mjs;
# grafting it would re-proportion bones the same way the original v1-to-v2 defect did). Owner ruling:
# do not ship v2 without the existing greeting-wave behaviour, and do not weaken drive-village.mjs's
# wave gate to accept losing it. Author a new one, on the same proven donor lane as the idle:
#   pristine Keeper v2 -> author animation donor only -> verify donor compatibility ->
#   merge by name into pristine body -> runtime review.
#
# EVERY AXIS BELOW WAS MEASURED ON THIS RIG (tmp/probe_wave_axes.py, not kept -- its findings are
# recorded here instead), not inferred from a bone or axis name -- the same discipline
# author_keeper_idle.py's own header names and the hero's IDLE_ARM_SETTLE paid for once already:
#
#   RightArm.x sweep (0 -> 0.6, step 0.15): RightHand world position moves smoothly and
#     monotonically the whole way -- 0.0 is the Meshy bind pose (near-T, arm already high, matching
#     author_keeper_idle.py's own measured "abduction ~74-76 deg at rest"), 0.7-0.85 is where the
#     idle settles it down to a natural hang (~30-40 deg abduction). A wave needs the arm raised, not
#     hanging: 0.35 -- roughly halfway between bind and the idle's hang -- lands at a natural
#     "hand up, ready to wave" height without the stiff, fully-extended read of leaving it at bind.
#   RightForeArm, probed from a bent elbow (x=0.8) at this raised shoulder: the y axis produces the
#     single largest, cleanest swing (measured hand-position delta range ~8.2 units over +/-0.3 rad
#     on the DOMINANT axis of motion, vs ~1.3 and ~0.3 units of cross-axis contamination on the other
#     two) -- the z axis swings a comparable but smaller amount on the same dominant axis (~6.7) with
#     more contamination on the other two. y is the wave's own side-to-side axis; x remains the
#     elbow-bend axis already established by the idle script for this exact rig.
#
# WHAT IS DELIBERATELY NOT HERE. No breathing, no weight sway, no pelvis roll: those are the idle's
# own ambient life, layered on a MUCH longer clip. A ~2 second greeting wave is short enough that the
# brief's own "small friendly torso/head acknowledgement" is one settled tilt held for the gesture,
# not a second life-simulation system.

import bpy, sys, os, math

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = (os.path.abspath(p) for p in (argv[0], argv[1]))


def tune(name, default):
    raw = os.environ.get(f"KEEPERWAVE_{name}")
    return default if raw is None else float(raw)

CLIP_NAME = "wave"
FPS = 30
DURATION_SECONDS = tune("DURATION_SECONDS", 2.0)  # brief's own 1.5-2.5s range, taken at the middle
FRAMES = int(round(DURATION_SECONDS * FPS))
WAVE_COUNT = tune("WAVE_COUNT", 2.5)  # "2-3 clear hand/forearm waves"

# --- the raised arm, held for the whole gesture -------------------------------------------------
RAISE = tune("RAISE", 0.35)          # RightArm.x -- see header: halfway between bind and idle-hang
ELBOW_BEND = tune("ELBOW_BEND", 0.85)    # RightForeArm.x -- a clear bent elbow, not a straight salute
WAVE_AMPLITUDE = tune("WAVE_AMPLITUDE", 0.30)  # RightForeArm.y -- the side-to-side swing itself

# --- the resting arm, matching the idle's own settled hang so the two arms agree -----------------
LEFT_ARM_SETTLE = tune("LEFT_ARM_SETTLE", 0.70)   # same value author_keeper_idle.py landed on
LEFT_ELBOW = tune("LEFT_ELBOW", 0.10)

# --- one small, held acknowledgement -- not animated further, just a settled greeting tilt -------
HEAD_TILT = tune("HEAD_TILT", 0.05)        # neck.z -- a small turn toward whoever is being greeted
HEAD_NOD = tune("HEAD_NOD", -0.04)         # Head.y -- chin very slightly up, an open, friendly read
CHEST_LIFT = tune("CHEST_LIFT", 0.02)       # Spine02.y -- the smallest breath-in, not a bow

# --- envelope: arm raises in, waves, settles back out ---------------------------------------------
RAISE_IN_FRACTION = tune("RAISE_IN_FRACTION", 0.20)   # first 20% of the clip: 0 -> raised
SETTLE_OUT_FRACTION = tune("SETTLE_OUT_FRACTION", 0.20)  # last 20% of the clip: raised -> 0


def envelope(t01):
    """0 at the very start and end, 1 through the held/waving middle -- so the clip loops cleanly
    back to whatever idle it crossfades from/to rather than snapping the arm to/from a raised pose."""
    if t01 < RAISE_IN_FRACTION:
        return t01 / RAISE_IN_FRACTION
    if t01 > 1 - SETTLE_OUT_FRACTION:
        return (1 - t01) / SETTLE_OUT_FRACTION
    return 1.0


def pose_at(seconds, total_seconds):
    t01 = seconds / total_seconds
    env = envelope(t01)
    # The wave itself only runs while the arm is actually up (the raise/settle edges hold still),
    # so the oscillation is scaled by the SAME envelope rather than running underneath a moving arm.
    wave_phase = math.sin(t01 * WAVE_COUNT * math.tau)
    return {
        "RightArm":     ("x", RAISE * env),
        "RightForeArm": [("x", ELBOW_BEND * env), ("y", WAVE_AMPLITUDE * env * wave_phase)],
        "LeftArm":      ("x", LEFT_ARM_SETTLE),
        "LeftForeArm":  ("x", LEFT_ELBOW),
        "neck":         ("z", HEAD_TILT * env),
        "Head":         ("y", HEAD_NOD * env),
        "Spine02":      ("y", CHEST_LIFT * env),
    }


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")

for o in [o for o in bpy.data.objects if o.type == "MESH" and len(o.vertex_groups) == 0]:
    name, mesh_data = o.name, o.data
    bpy.data.objects.remove(o, do_unlink=True)
    if mesh_data.users == 0:
        bpy.data.meshes.remove(mesh_data)
    print(f"DROPPED unweighted mesh {name} (importer artifact, not in the source file)")

for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")

for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (0.0, 0.0, 0.0)
    pb.location = (0.0, 0.0, 0.0)
    pb.scale = (1.0, 1.0, 1.0)

action = bpy.data.actions.new(CLIP_NAME)
arm.animation_data_create()
arm.animation_data.action = action

scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = FRAMES

for frame in range(1, FRAMES + 1):
    seconds = (frame - 1) / FPS
    scene.frame_set(frame)

    for pb in arm.pose.bones:
        pb.rotation_euler = (0.0, 0.0, 0.0)

    for bone_name, spec in pose_at(seconds, DURATION_SECONDS).items():
        pb = arm.pose.bones.get(bone_name)
        if pb is None:
            print(f"WARNING bone {bone_name} not on this rig -- skipped")
            continue
        for axis, value in ([spec] if isinstance(spec, tuple) else spec):
            pb.rotation_euler["xyz".index(axis)] = value

    for pb in arm.pose.bones:
        pb.keyframe_insert(data_path="rotation_euler", frame=frame)

print(f"AUTHORED {CLIP_NAME}: {FRAMES} frames at {FPS} fps = {FRAMES / FPS:.4f}s, "
      f"{WAVE_COUNT} waves, raise {RAISE}, amplitude {WAVE_AMPLITUDE}")

bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_skins=True,
    export_animations=True,
    export_yup=True,
    export_apply=False,
)
print(f"WROTE {OUT}")
