# Author the wolf's combat clip set, headlessly.
#
# Version 2, for the FIXED rig the owner supplied on 2026-08-13 (tmp/wolf-fixed-walking.glb, 10,435
# triangles, the same 27 semantic bone names). The original rig's two defects -- both lower
# hind-leg chains collapsed onto the X midline, and a zero-length headend bone -- are gone in this
# export: backleg/R_backleg mirror at x=+0.018/-0.022 and headend has real length, measured from
# the GLB's own JSON. That retires the SOUND_SEGMENTS workaround below.
#
# This script authors idle, bite, hit and death ONLY. The walk is Meshy's own from the same
# download ("looks much better" -- the owner, 2026-08-13, and it is measured in-place: Hips translation
# first==last, 0.006 local units of gait bob, zero forward drift). It is grafted in AFTER this
# script by tools/foundry/merge_clips.mjs, at the GLB level, because a Blender round trip through
# this script would break it: rest() forces every pose bone to XYZ euler mode, and the imported
# clip's quaternion fcurves stop evaluating the moment the bone is in euler mode -- the export
# would bake the walk as a rest-pose statue without erroring.
#
# Deliberately modest keyframes. Young players read this wolf at roughly 60 CSS pixels on a tablet.
# Silhouette and timing carry that read; joint-perfect motion does not survive the downscale
# and is not worth chasing. Owner ruling: do not obsess over mathematical perfection where the eye
# cannot see it.
#
# Bone map, as measured off the shipped GLB (unprefixed = left, R_ = right):
#   Hips (root) -> chest -> head -> headend, and earend / R_earend
#   tailstart -> tail -> tail1 -> tail2 -> tail3
#   frontleg -> frontleg0 -> frontleg1 -> frontleg2   (and R_ mirror)
#   backleg  -> backleg0  -> backleg1  -> backleg2    (and R_ mirror)

import bpy, sys, os, math

argv = sys.argv[sys.argv.index("--") + 1:]
# Absolute, always. Blender resolves a relative render path against the .blend file, and a
# factory-reset session has no .blend -- so a relative path silently writes nowhere while
# bpy.ops.render.render still reports success.
SRC, OUT, RENDER_DIR = (os.path.abspath(p) for p in (argv[0], argv[1], argv[2]))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")

# Drop any mesh carrying no weights. NOTE: the wolf does not actually contain one -- an earlier
# version of this comment claimed a stray "Icosphere" was riding along in the shipped GLB, and that
# was wrong. Reading the GLB's own JSON shows exactly one mesh, `char1`. The Icosphere is fabricated
# by Blender's glTF IMPORTER, not present in the file, so it must never be cited as an asset defect.
# The guard stays because an unweighted mesh genuinely would be junk, but it is a precaution now,
# not a fix.
for o in [o for o in bpy.data.objects if o.type == "MESH" and len(o.vertex_groups) == 0]:
    name, mesh_data = o.name, o.data
    bpy.data.objects.remove(o, do_unlink=True)
    if mesh_data.users == 0:
        bpy.data.meshes.remove(mesh_data)
    print(f"DROPPED unweighted mesh {name} (import artifact or junk)")

# Drop the imported base take: one meaningless 25-frame stub with no gameplay reading.
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")

def rest():
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)

def key(frame, bones):
    """bones: {name: (rx, ry, rz) or (rx, ry, rz, dx, dy, dz)} in degrees / v1-rig metres.

    Translations are authored in the v1 rig's local metres (the space every value below was tuned
    in) and scaled by TRANS_SCALE here, so the beat sheets keep their original readable numbers.
    """
    for name, vals in bones.items():
        pb = arm.pose.bones.get(name)
        if pb is None:
            raise KeyError(f"no bone named {name!r}")
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = tuple(math.radians(v) for v in vals[:3])
        if len(vals) > 3:
            pb.location = tuple(v * TRANS_SCALE for v in vals[3:6])
        pb.keyframe_insert("rotation_euler", frame=frame)
        pb.keyframe_insert("location", frame=frame)

def new_clip(name):
    rest()
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = action
    # Blender 5 needs an explicit slot bound before any keyframe will land in the action. Without
    # this the export silently contains empty clips -- it does not error.
    if hasattr(action, "slots"):
        arm.animation_data.action_slot = action.slots.new(id_type="OBJECT", name=arm.name)
    return action

# The v1 rig collapsed both lower hind chains onto the midline, so v1 drove only the segments that
# were geometrically sound: back legs stopped at segment "0". The fixed rig mirrors the full chains
# (measured, see header), so every segment is drivable and the hind legs finally BEND on the same
# falloff the front legs always had. This is the rig fix paying out, not a style change.
SOUND_SEGMENTS = {"front": ("", "0", "1", "2"), "back": ("", "0", "1", "2")}

# Pose-bone translations below were tuned on the v1 rig, whose armature-local space measured
# 0.9056188 units of wolf height (world 0.009056188 at the exported 0.01 armature scale). The
# fixed export uses a different internal unit: 0.2899569 local units of height (world 0.002899569
# at the same 0.01 scale), measured by the same skinned-bind-pose pass. Rotations transfer as
# degrees; translations are in local metres and must shrink by the ratio of the two spaces, or the
# death sink alone would drive the wolf 3x its own height into the floor.
TRANS_SCALE = 0.2899569 / 0.9056188  # = 0.320175, measured on both exports, not assumed

def leg(side, swing):
    """One leg's fore/aft swing, spread down the chain so the limb bends rather than pivoting rigid."""
    falloff = {"": 1.0, "0": 0.55, "1": -0.45, "2": 0.25}
    kind = "back" if "backleg" in side else "front"
    return {f"{side}{seg}": (swing * falloff[seg], 0, 0) for seg in SOUND_SEGMENTS[kind]}

def merge(*ds):
    out = {}
    for d in ds:
        out.update(d)
    return out

# ── idle: weight shift, breath, slow tail ──────────────────────────────────────────────────────
new_clip("idle")
for f, amt in ((1, 0), (20, 1), (40, 0)):
    key(f, {
        "chest": (2.5 * amt, 0, 0),
        "head":  (-2 * amt, 3 * amt, 0),
        "tail1": (0, 0, 7 * amt),
        "tail2": (0, 0, 9 * amt),
        "Hips":  (0, 0, 0, 0, 0, 0.012 * amt),
    })

# ── walk: NOT AUTHORED HERE ────────────────────────────────────────────────────────────────────
# v1 authored a diagonal-gait walk because Meshy's take was "a meaningless 25-frame stub" on the
# broken rig. On the fixed rig Meshy's own walk is the better clip (the owner's judgement, 2026-08-13),
# and it is grafted from the pristine download by merge_clips.mjs after this export -- see the
# header for why it must not round-trip through this script.

# ── bite: load, snap, STOP, recoil ─────────────────────────────────────────────────────────────
# Rebuilt to an animation beat sheet from the visual reviewer, which diagnosed the previous version
# as "too long and too even" -- the action was spread evenly across all 28 frames, so there was no
# strike, only drift. The corrected ratio puts the whole attack in 20 frames: anticipation 1-6,
# strike 7-9, contact 9-10, recoil 11-15, recovery 16-20, and frames 21-28 are a quiet settle with
# no further bite business in them.
#
# The two HOLDS are the point, and their absence is what killed the earlier read. A pose that is
# eased through is a pose the eye never sees. Frame 7 repeats frame 6 so the child gets a beat of
# "it is about to strike"; frame 10 repeats frame 9 so the bite lands and STOPS rather than smearing
# into a lunge. Duplicate keys are how a hold is expressed here.
#
# This rig has NO JAW and no neck bone, so the bite cannot be sold by opening a mouth. It is carried
# by four things only: head travel, chest drive, compression-then-stop, and a foreleg brace that
# makes the front half look like it hit something. Frame 9 is the whole clip -- if that single frame
# does not say "bite" to a child, nothing else in the sequence rescues it.
#
# Body translation is deliberately absent. The reviewer's note was that the attack must be carried by
# the muzzle rather than the whole wolf sliding forward, and Hips translation is in an unmeasured
# bone-local frame anyway.
new_clip("bite")
key(1,  {"chest": (0, 0, 0), "head": (-4, 0, 0)})                                    # ready
key(3,  merge(leg("frontleg", 6), leg("R_frontleg", 6), leg("backleg", 8), leg("R_backleg", 7),
              {"Hips": (-4, 0, 0), "chest": (-5, 0, 0), "head": (10, 0, 0),
               "tail1": (0, 0, 4)}))                                                 # pre-load
key(6,  merge(leg("frontleg", 11), leg("R_frontleg", 11), leg("backleg", 12), leg("R_backleg", 11),
              {"Hips": (-6, 0, 0), "chest": (-9, 0, 0), "head": (18, 0, 0),
               "tail1": (0, 0, 3)}))                                                 # full coil
key(7,  merge(leg("frontleg", 11), leg("R_frontleg", 11), leg("backleg", 12), leg("R_backleg", 11),
              {"Hips": (-6, 0, 0), "chest": (-9, 0, 0), "head": (18, 0, 0),
               "tail1": (0, 0, 3)}))                                                 # HOLD the coil
key(8,  merge(leg("frontleg", -6), leg("R_frontleg", -6), leg("backleg", 2), leg("R_backleg", 2),
              {"Hips": (2, 0, 0), "chest": (6, 0, 0), "head": (-10, 0, 0)}))         # launch
key(9,  merge(leg("frontleg", -2), leg("R_frontleg", -8), leg("backleg", 0), leg("R_backleg", 0),
              {"Hips": (4, 0, 0), "chest": (10, 0, 0), "head": (-22, 0, 0),
               "tail1": (0, 0, -3)}))                                                # CONTACT
key(10, merge(leg("frontleg", -2), leg("R_frontleg", -8), leg("backleg", 0), leg("R_backleg", 0),
              {"Hips": (4, 0, 0), "chest": (10, 0, 0), "head": (-22, 0, 0),
               "tail1": (0, 0, -3)}))                                                # HOLD the bite
key(12, merge(leg("frontleg", 0), leg("R_frontleg", -3),
              {"Hips": (2, 0, 0), "chest": (4, 0, 0), "head": (-9, 0, 0)}))          # recoil
key(15, {"Hips": (0, 0, 0), "chest": (2, 0, 0), "head": (-4, 0, 0)})                 # recovery
key(20, merge(leg("frontleg", 0), leg("R_frontleg", 0), leg("backleg", 0), leg("R_backleg", 0),
              {"Hips": (0, 0, 0), "chest": (0, 0, 0), "head": (-4, 0, 0),
               "tail1": (0, 0, 0)}))                                                 # returned
key(28, {"Hips": (0, 0, 0), "chest": (0, 0, 0), "head": (-4, 0, 0)})                 # settle buffer

# ── hit: a flinch that cannot be mistaken for the bite ─────────────────────────────────────────
# Short, and away from the player rather than toward them. A hit reaction that leans in reads as a
# second attack, which teaches a child exactly the wrong thing about whether they are winning.
new_clip("hit")
key(1, {"Hips": (0, 0, 0, 0, 0, 0), "chest": (0, 0, 0), "head": (0, 0, 0)})
key(4, merge(leg("frontleg", -10), leg("R_frontleg", -6),
             {"Hips": (-10, 0, -7, 0, -0.10, -0.02), "chest": (-9, 0, 8), "head": (7, -6, 0),
              "tail1": (0, 0, -16), "tail2": (0, 0, -18)}))
key(9, {"Hips": (-4, 0, -3, 0, -0.04, 0), "chest": (-3, 0, 3), "head": (5, -4, 0)})
key(16, merge(leg("frontleg", 0), leg("R_frontleg", 0),
              {"Hips": (0, 0, 0, 0, 0, 0), "chest": (0, 0, 0), "head": (0, 0, 0),
               "tail1": (0, 0, 0), "tail2": (0, 0, 0)}))

# ── death: buckle, roll onto the side, and HOLD ────────────────────────────────────────────────
# Judged by an independent visual reviewer at gameplay scale, the earlier collapse-in-place version
# was a HARD FAIL: "still upright on all four legs, visibly weight-bearing... I would expect some
# children to wait for it to attack again." A dead enemy that reads as crouching is the worst bug in
# the set, so this clip is built around the reviewer's criterion -- show the final frame to someone
# with no label, and if "dead" is not their immediate answer, it fails.
#
# The roll comes from rotating `Hips` about its OWN axis. Hips points along the spine toward the
# head, so its local Y is the roll axis, and Hips is one of the sound bones -- unlike the hind-leg
# chains, which is why the earlier attempts to fold the animal down tore it apart. Rotating the
# armature OBJECT does not work here: the evaluated mesh bounding box is unchanged by it, measured.
#
# The body also has to LAND. Rolling alone leaves it hovering at standing hip height -- measured
# minZ +0.548 against a lying height of 0.434, so more than a full body off the floor. Hips local
# +Z maps to world -Z at 0.5 -> -0.570 (measured, not assumed), hence the 0.48 sink keyed alongside
# the roll.
new_clip("death")
key(1,  {"chest": (0, 0, 0), "head": (0, 0, 0)})
key(6,  merge(leg("frontleg", 16), leg("R_frontleg", 14),
              {"Hips": (0, 8, 0, 0, 0, 0.02), "chest": (-6, 0, 0), "head": (7, 0, 0)}))     # stagger
key(17, merge(leg("frontleg", 24), leg("R_frontleg", 20), leg("backleg", 18), leg("R_backleg", 16),
              {"Hips": (0, 42, 0, 0, 0, 0.07), "chest": (10, 0, 4), "head": (10, 0, -4)}))  # legs give, roll starts
key(30, merge(leg("frontleg", 12), leg("R_frontleg", 10), leg("backleg", 10), leg("R_backleg", 8),
              {"Hips": (0, 86, 0, 0, 0, 0.48), "chest": (6, 0, 3), "head": (6, 0, -6),
               "tail1": (0, 0, 8), "tail2": (0, 0, 10)}))                       # on its side
# Held, not returned to rest. A death that springs back upright is the most common way a children's
# game accidentally says an enemy is still alive.
key(42, merge(leg("frontleg", 10), leg("R_frontleg", 9), leg("backleg", 9), leg("R_backleg", 7),
              {"Hips": (0, 88, 0, 0, 0, 0.49), "chest": (5, 0, 3), "head": (5, 0, -6),
               "tail1": (0, 0, 6), "tail2": (0, 0, 7)}))

bpy.ops.object.mode_set(mode="OBJECT")

# An empty clip exports without complaint, so count the keys rather than trusting the authoring ran.
for a in sorted(bpy.data.actions, key=lambda a: a.name):
    fr = a.frame_range
    n = 0
    try:
        for layer in a.layers:
            for strip in layer.strips:
                for slot in a.slots:
                    cb = strip.channelbag(slot)
                    if cb:
                        n += len(cb.fcurves)
    except AttributeError:
        n = len(getattr(a, "fcurves", []))
    assert n > 0, f"clip {a.name!r} exported with no channels"
    print(f"AUTHORED {a.name:6s} frames {fr[0]:.0f}..{fr[1]:.0f}  channels={n}")

# Render key beats of every clip so the motion is looked at rather than assumed.
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = scene.render.resolution_y = 420
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cam.location = (2.7, -2.7, 1.15)
cam.rotation_euler = (math.radians(78), 0, math.radians(45))
scene.camera = cam
os.makedirs(RENDER_DIR, exist_ok=True)

BEATS = {"idle": (1, 20), "bite": (1, 6, 8, 9, 12, 20),
         "hit": (1, 4, 9), "death": (1, 6, 17, 30, 42)}
for name, frames in BEATS.items():
    action = bpy.data.actions[name]
    arm.animation_data.action = action
    if hasattr(action, "slots"):
        arm.animation_data.action_slot = action.slots[0]
    for f in frames:
        scene.frame_set(f)
        path = os.path.join(RENDER_DIR, f"{name}_{f:02d}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        # render() reports success whether or not a file lands, so check the file rather than the
        # return value. An earlier version of this script printed "RENDERED 17 frames" having
        # written none of them.
        assert os.path.exists(path), f"render reported success but wrote no file at {path}"
written = len(os.listdir(RENDER_DIR))
print("RENDERED", written, "frames to", RENDER_DIR)

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB",
    export_animations=True, export_animation_mode="ACTIONS",
    export_bake_animation=True,
)
print("EXPORTED", OUT, os.path.getsize(OUT), "bytes")
print("AUTHOR_DONE")
