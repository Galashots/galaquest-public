# Author `idle_ambient` for the Lantern Keeper (v2 rig), headlessly.
#
#   blender --background --factory-startup --python tools/blender/author_keeper_idle.py \
#           -- <keeper-v2-body.glb> <out-clip.glb>
#
# WHAT THIS IS FOR. AP1's architectural experiment: take the pristine Keeper v2 rig, author ONLY a
# new animation clip against it, and merge that clip back onto the untouched body. Nothing here
# edits the skeleton or the mesh. The body this script exports is a BYPRODUCT to be thrown away --
# `merge_clips.mjs` lifts the clip out and the shipped body stays the one Meshy produced. Phase C1-R
# is explicit that Keeper v2's rest skeleton must not be altered after skinning, because the skin was
# authored against it.
#
# THE POSE IS CONTRAPPOSTO, and it is taken from reference rather than derived (AGENTS.md, "Look
# before you derive"). The convention, in one sentence, written down before any number was chosen:
# *the weight goes on one leg, that hip rides HIGH, the shoulder line counter-tilts against the
# pelvis line, the spine takes an S-curve between them, and the free knee softens.* That is the
# classical contrapposto every figure-drawing source describes, and iron rule 9 measures the same
# thing on our own assets: `Stand_and_Chat` reads as a person at stance 1.40 hip widths with 17.7 deg
# of shoulder-tilt range, `Idle_02` reads as a mannequin at 2.30 and 0.5 deg.
#
# EVERY AXIS BELOW WAS MEASURED ON THIS RIG, NOT INFERRED FROM ITS NAME. The hero cost this lesson
# once already ("rotation.x turned out to be the inward axis for BOTH upper arms, which is not what a
# Z-up intuition would guess"). Perturbing each bone by +0.15 rad about each local axis and reading
# the world displacement of a probe point gives, for Keeper v2 (Blender Z-up, X lateral, Y forward):
#
#   Hips.y      LeftUpLeg dz +0.0149, RightUpLeg dz -0.0160  -> PELVIS ROLL. +y lifts the LEFT hip.
#   Spine.z     head_end dx -0.0866                          -> LUMBAR LATERAL BEND.
#   Spine.x     head_end dy -0.0817                          -> lumbar flexion/extension.
#   Spine01.z   head_end dx -0.1115                          -> thoracic lateral bend (the counter).
#   Spine01.x   head_end dy -0.1797                          -> thoracic flexion.
#   Spine02.y   head_end dy +0.1197                          -> chest rise; used for the breath.
#   neck.z      head_end dx -0.0808                          -> head turn.
#   Head.y      head_end dy +0.0561                          -> nod.
#   LeftUpLeg.z  LeftFoot  dx -0.1217                        -> +z swings the left foot inboard.
#   RightUpLeg.z RightFoot dx -0.1520                        -> -z swings the right foot inboard.
#   RightLeg.x  RightFoot dy -0.0601                         -> knee flexion on the free leg.
#
# WHY THE SHOULDER COUNTER-TILT IS SPINE01 AND NOT THE SHOULDER BONES. Probing Spine02 moved
# LeftShoulder and RightShoulder in the SAME direction on all three axes, so no single chest rotation
# tilts the shoulder line here. The anatomically correct construction is the one that also works:
# bend the lumbar toward the weight side and the thorax back the other way. The shoulder line then
# counter-tilts because it sits on top of the S, which is what contrapposto actually is -- rather
# than because two shoulder bones were posed to fake the symptom.
#
# DELIBERATELY RESTRAINED. The brief asks for "the simplest possible idle_ambient", not a
# performance, for a kindly elderly quest-giver. Amplitudes are small and the two breathing periods
# are deliberately not a tidy ratio, so the loop does not read as a mechanism.

import bpy, sys, os, math

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = (os.path.abspath(p) for p in (argv[0], argv[1]))


def tune(name, default):
    """Every pose constant is overridable from the environment, so a re-tune is a sweep and not an
    edit. `pose_anatomy.mjs` is the oracle for all of them -- the sign of the thoracic bend was
    guessed wrong twice before it was measured, which is exactly what this exists to stop."""
    raw = os.environ.get(f"KEEPER_{name}")
    return default if raw is None else float(raw)

CLIP_NAME = "idle_ambient"
FPS = 30
# 5.5 s. Long enough that the two breathing periods do not visibly resynchronise, short enough to
# stay small in the payload. 165 frames.
DURATION_SECONDS = 5.5
FRAMES = int(round(DURATION_SECONDS * FPS))

# --- the standing pose, in radians -------------------------------------------------------------
# Weight on the LEFT leg. Every value is small: this is a person standing, not a pose-off.
WEIGHT_PELVIS_ROLL = tune("WEIGHT_PELVIS_ROLL", 0.055)    # Hips.y   -- left hip rides high
LUMBAR_LATERAL = tune("LUMBAR_LATERAL", -0.045)       # Spine.z  -- lower back bends toward the weight side
# NEGATIVE, and that sign was MEASURED after being guessed wrong twice -- which is the whole reason
# `tune()` exists above. The reasoning "the lumbar bends -z so the thorax must answer +z" is what a
# person derives from a diagram, and it is backwards on this rig. Swept against pose_anatomy.mjs
# with the pelvis held at +2.2 deg (left hip high):
#     +0.105 -> shoulder tilt +6.0 deg,  contrapposto  0/12   (both tilted the same way)
#      0.000 -> shoulder tilt +0.1 deg,  contrapposto  0/12   (shoulder line dead level)
#     -0.050 -> shoulder tilt -2.7 deg,  contrapposto  9/12
#     -0.090 -> shoulder tilt -4.9 deg,  contrapposto  9/12   <- taken
#     -0.140 -> shoulder tilt -7.7 deg,  contrapposto  9/12   (too much for a calm old man)
# -4.9 deg against a +2.2 deg pelvis is a readable S without turning a quest-giver into a statue
# study. AGENTS.md's "Look before you derive" is a rule about rigs as much as about art.
THORACIC_COUNTER = tune("THORACIC_COUNTER", -0.090)     # Spine01.z -- chest tilts the other way: the S-curve
LUMBAR_EXTENSION = tune("LUMBAR_EXTENSION", -0.012)     # Spine.x  -- a touch of settle, not a slump
FREE_KNEE = tune("FREE_KNEE", 0.085)             # RightLeg.x -- the unweighted knee softens
FREE_HIP = tune("FREE_HIP", -0.030)             # RightUpLeg.z -- and its foot comes inboard
STANCE_LEFT = tune("STANCE_LEFT", 0.055)           # LeftUpLeg.z -- narrows the stance from its 1.47 rest ratio
HEAD_LEVEL = tune("HEAD_LEVEL", -0.018)           # Head.y   -- head returns toward level over the counter-tilt

# THE ARMS HAVE TO COME DOWN, and the first authored pass forgot to bring them.
#
# Keeper v2's BIND pose holds the arms at abduction L 75.7 deg / R 74.0 deg -- near a T-pose, because
# that is what a Meshy rig is generated in. A clip that never touches the arm bones inherits that,
# and the first measured pass came back L 71.3 / R 77.2: a robed old man standing with his arms held
# out sideways. That is precisely the "wearing a human costume" read the owner's 2026-08-14 ruling names,
# and no amount of good spine work rescues it.
#
# BOTH ARMS SETTLE ON `.x`, POSITIVE -- and the reasoning that picked any other answer was wrong.
#
# The small-angle probe suggested LeftArm.x and RightArm.z, on the grounds that they had the least
# BACKWARD (dy) travel per unit of lateral motion, which is what the brief's "no arms driven
# backward" asks for. Measured over the angles actually needed, that extrapolation broke down
# completely -- a +0.15 rad probe says nothing reliable about a 1.2 rad pose:
#     LeftArm.x  -0.45 -> abduction L 93.8 deg   (bind is 75.7: it went UP, and kept going)
#     LeftArm.x  -0.80 -> abduction L 111.3 deg  (the arm had swung through the body and out again)
#     LeftArm.x  +1.00 -> abduction L  30.6 deg  <- taken
#     LeftArm.x  +1.40 -> abduction L  30.7 deg  (plateaued; no more to gain)
#     RightArm.z -1.20 -> abduction R  58.9 deg  (best .z could do before reversing)
#     RightArm.z -2.00 -> abduction R  70.6 deg  (reversed)
#     RightArm.y -1.00 -> abduction R  77.2 deg  (worse than the bind pose)
#     RightArm.x +1.20 -> abduction R  28.7 deg
# Bind pose is L 75.7 / R 74.0. The axes are configurable (KEEPER_LEFT_ARM_AXIS / _RIGHT_ARM_AXIS)
# precisely because the next rig will not match this one.
#
# THE FINAL VALUES CAME FROM LOOKING, NOT FROM THE NUMBERS. L 1.00 / R 1.20 measured beautifully --
# abduction L 30.6 / R 28.7, an arm hanging neatly beside a robe -- and in the running game both
# hands were INSIDE the coat: fingers drawn over the skirt, wrists disappearing into it, on the
# Keeper and on all three villagers cloned from his rig. The coat flares at the hip and a tucked arm
# lands in the flare. Opened to L 0.70 / R 0.85 (abduction L 39.5 / R 37.9) and the hands clear the
# coat with daylight either side. Iron rule 9 already says abduction is NOT a gate and that a
# controlled swap saw abduction rise while the character read BETTER; this is that finding again,
# on a different character, found the same way -- by opening the capture.
LEFT_ARM_SETTLE = tune("LEFT_ARM_SETTLE", 0.70)     # LeftArm.<LEFT_ARM_AXIS>
RIGHT_ARM_SETTLE = tune("RIGHT_ARM_SETTLE", 0.85)   # RightArm.<RIGHT_ARM_AXIS>
RIGHT_ARM_AXIS = os.environ.get("KEEPER_RIGHT_ARM_AXIS", "x")
LEFT_ARM_AXIS = os.environ.get("KEEPER_LEFT_ARM_AXIS", "x")
# A little elbow, so the arms read relaxed rather than two straight rods hanging off a robe.
LEFT_ELBOW = tune("LEFT_ELBOW", 0.10)               # LeftForeArm.x
RIGHT_ELBOW = tune("RIGHT_ELBOW", 0.10)             # RightForeArm.x

# --- the life on top of it ----------------------------------------------------------------------
BREATH_PERIOD = tune("BREATH_PERIOD", 4.3)           # seconds; ribcage rise
BREATH_AMOUNT = tune("BREATH_AMOUNT", 0.016)         # Spine02.y
SWAY_PERIOD = tune("SWAY_PERIOD", 6.7)             # seconds; the slow weight settle. 6.7/4.3 is not a tidy ratio.
# Iron rule 9: STILLNESS is the tell, not limb angle. The first pass at 0.011 measured a pelvis-tilt
# RANGE of 1.0 deg and a shoulder-tilt range of 0.7 deg over the whole clip -- against Idle_02's
# 1.7/0.5 (the mannequin) and Stand_and_Chat's 7.9/17.7 (reads as a person). Swept:
#     0.042 -> pelvis range 3.8 deg, shoulder range 2.3 deg, hips height range 0.85%
#     0.075 -> pelvis range 6.8 deg, shoulder range 4.0 deg, hips height range 1.52%   <- taken
#     0.110 -> pelvis range 9.9 deg, shoulder range 6.0 deg, hips height range 2.23%
# 0.075 lands the pelvis just under Stand_and_Chat's 7.9 without going past it. Deliberately NOT
# matched to its 17.7 deg shoulder range: that is a talking gesture on a younger character, and this
# is a calm elderly man standing.
SWAY_AMOUNT = tune("SWAY_AMOUNT", 0.075)           # added to Hips.y and mirrored into the lumbar
HEAD_PERIOD = tune("HEAD_PERIOD", 9.1)             # seconds; tiny attention drift
HEAD_TURN_AMOUNT = tune("HEAD_TURN_AMOUNT", 0.030)      # neck.z
HEAD_NOD_AMOUNT = tune("HEAD_NOD_AMOUNT", 0.012)       # Head.y


def pose_at(seconds):
    """Bone-local Euler offsets at a moment. One dict per frame; nothing accumulates."""
    breath = math.sin(seconds / BREATH_PERIOD * math.tau)
    sway = math.sin(seconds / SWAY_PERIOD * math.tau)
    head = math.sin(seconds / HEAD_PERIOD * math.tau)
    return {
        # The pelvis carries the weight shift and drifts a little; the lumbar answers it in the
        # opposite direction, so the head stays roughly over the engaged foot rather than swinging.
        "Hips":        ("y", WEIGHT_PELVIS_ROLL + SWAY_AMOUNT * sway),
        "Spine":       [("z", LUMBAR_LATERAL - SWAY_AMOUNT * 0.6 * sway), ("x", LUMBAR_EXTENSION)],
        "Spine01":     ("z", THORACIC_COUNTER + SWAY_AMOUNT * 0.3 * sway),
        "Spine02":     ("y", BREATH_AMOUNT * breath),
        "neck":        ("z", HEAD_TURN_AMOUNT * head),
        "Head":        [("y", HEAD_LEVEL + HEAD_NOD_AMOUNT * head), ("z", -HEAD_TURN_AMOUNT * 0.4 * head)],
        # The arms hang, with the faintest drift so they are not two frozen sticks. The drift rides
        # the breath rather than the sway, because an arm resting against a body moves with the
        # ribcage under it.
        "LeftArm":     (LEFT_ARM_AXIS, LEFT_ARM_SETTLE + BREATH_AMOUNT * 0.5 * breath),
        "RightArm":    (RIGHT_ARM_AXIS, RIGHT_ARM_SETTLE - BREATH_AMOUNT * 0.5 * breath),
        "LeftForeArm": ("x", LEFT_ELBOW),
        "RightForeArm": ("x", RIGHT_ELBOW),
        # The legs are static: planted feet are the point. A foot that slides is the single most
        # obvious tell there is, because ground contact is the one cue with an absolute reference.
        "RightLeg":    ("x", FREE_KNEE),
        "RightUpLeg":  ("z", FREE_HIP),
        "LeftUpLeg":   ("z", STANCE_LEFT),
    }


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")

# Blender's glTF importer FABRICATES an unweighted `Icosphere` that is not in the file (AGENTS.md:
# "Never trust the Blender importer as evidence"). Confirmed present here: 80 polygons, 0 vertex
# groups, against the real mesh `char1` at 5,113. Drop it so the exported byproduct is not junk.
for o in [o for o in bpy.data.objects if o.type == "MESH" and len(o.vertex_groups) == 0]:
    name, mesh_data = o.name, o.data
    bpy.data.objects.remove(o, do_unlink=True)
    if mesh_data.users == 0:
        bpy.data.meshes.remove(mesh_data)
    print(f"DROPPED unweighted mesh {name} (importer artifact, not in the source file)")

# Drop the source's own clip. We are authoring, not layering on top of Talk_Passionately.
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")

# XYZ euler on every bone. author_wolf_clips.py records why this matters: a bone left in quaternion
# mode while euler fcurves are written exports as a rest-pose statue without erroring.
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
    # Frame 1 is t=0 and frame FRAMES+1 would be t=DURATION; the last authored frame stops one step
    # short so the loop closes without holding a duplicate pose for two frames.
    seconds = (frame - 1) / FPS
    scene.frame_set(frame)

    # Clear first, so a bone that stops being posed returns to rest rather than holding a stale value.
    for pb in arm.pose.bones:
        pb.rotation_euler = (0.0, 0.0, 0.0)

    for bone_name, spec in pose_at(seconds).items():
        pb = arm.pose.bones.get(bone_name)
        if pb is None:
            print(f"WARNING bone {bone_name} not on this rig -- skipped")
            continue
        for axis, value in ([spec] if isinstance(spec, tuple) else spec):
            pb.rotation_euler["xyz".index(axis)] = value

    for pb in arm.pose.bones:
        pb.keyframe_insert(data_path="rotation_euler", frame=frame)

print(f"AUTHORED {CLIP_NAME}: {FRAMES} frames at {FPS} fps = {FRAMES / FPS:.4f}s")

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
