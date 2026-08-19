# Mount a rigid gear GLB on ANY named hero bone and render the clips that would betray a bad
# fit. Generalized from stress_gear.py (which is Spine02-specific): bone name and a full XYZ
# offset are arguments, and the walk clip joins the stress set because hip/leg-adjacent gear
# fails in locomotion before it fails in combat.
#
# Placement follows fit_gear.py's two hard-won rules: compose world placement in REST pose,
# anchor at the bone HEAD (this rig's importer tails are garbage -- Spine02's tail measured
# z=10.16 on a 1.5m hero), and attach with a Child Of CONSTRAINT so the clips drive it.
#
# blender --background --factory-startup --python fit_stress_gear.py -- \
#   <hero.glb> <gear.glb> <outdir> <bone> <worldHeight> [dx_left] [dy_fwd] [dz_up]
#
# Frame convention (this rig, measured): hero faces -Y, so +X is the character's LEFT,
# -Y is forward, +Z is up. All offsets are metres in world space at rest.
#
# The printed GEAR_FIT line is the record to carry into gear.js: scale + the world-space
# offset from the bone head, in this same frame.
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
HERO, GEAR, OUT = (os.path.abspath(p) for p in argv[:3])
BONE = argv[3]
WORLD_HEIGHT = float(argv[4])
DX_LEFT = float(argv[5]) if len(argv) > 5 else 0.0
DY_FWD = float(argv[6]) if len(argv) > 6 else 0.0
DZ_UP = float(argv[7]) if len(argv) > 7 else 0.0
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=HERO)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
arm.data.pose_position = "REST"
bpy.context.view_layer.update()

hero_mesh = max((o for o in bpy.context.scene.objects if o.type == "MESH"), key=lambda o: len(o.data.vertices))
pts = [hero_mesh.matrix_world @ v.co for v in hero_mesh.data.vertices]
hero_h = max(p.z for p in pts) - min(p.z for p in pts)
print(f"HERO height {hero_h:.4f}")

pb = arm.pose.bones[BONE]
head_w = arm.matrix_world @ pb.head
print(f"{BONE} head_w=({head_w.x:.4f},{head_w.y:.4f},{head_w.z:.4f})")
if not (0.05 < head_w.z < 1.8):
    for b in arm.pose.bones:
        w = arm.matrix_world @ b.head
        print(f"  bone {b.name}: world head z={w.z:.4f}")
    raise SystemExit(f"ABORT: {BONE} world head z={head_w.z:.4f} is not on the body; check the bone name")

before = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=GEAR)
added = [o for o in bpy.context.scene.objects if o not in before and o.type == "MESH"]
gear = max(added, key=lambda o: len(o.data.polygons))
for o in [o for o in bpy.context.scene.objects if o not in before and o is not gear]:
    bpy.data.objects.remove(o, do_unlink=True)

local_pts = [Vector(c) for c in gear.bound_box]
natural = max(p.z for p in local_pts) - min(p.z for p in local_pts)
centre_local = sum(local_pts, Vector()) / 8
world_scale = WORLD_HEIGHT / natural
offset = Vector((DX_LEFT, -DY_FWD, DZ_UP))
centre_target = head_w + offset
gear.scale = (world_scale, world_scale, world_scale)
gear.location = centre_target - world_scale * centre_local
bpy.context.view_layer.update()
print(f"GEAR_FIT bone={BONE} scale={world_scale:.4f} offsetFromBoneHead=({offset.x:.4f},{offset.y:.4f},{offset.z:.4f}) worldHeight={WORLD_HEIGHT}")

con = gear.constraints.new("CHILD_OF")
con.target = arm
con.subtarget = BONE
con.inverse_matrix = (arm.matrix_world @ pb.matrix).inverted()
bpy.context.view_layer.update()

arm.data.pose_position = "POSE"
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = scene.render.resolution_y = 512
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

def aim(dist, azimuth_deg, height, look_z=0.75):
    az = math.radians(azimuth_deg)
    cam.location = (dist * math.sin(az), -dist * math.cos(az), height)
    direction = Vector((0, 0, look_z)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

CLIPS = {
    "walking_man": (1, 8, 16, 24),
    "sword_slash": (1, 9, 13, 19, 30),
    "hit": (1, 6, 12, 24),
    "death": (1, 18, 40, 70),
}
for clip_name, frames in CLIPS.items():
    action = next((a for a in bpy.data.actions if clip_name in a.name.lower()), None)
    if action is None:
        print("MISSING CLIP", clip_name)
        continue
    arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(action, "slots") and len(action.slots):
        arm.animation_data.action_slot = action.slots[0]
    for f in frames:
        scene.frame_set(f)
        for angle, label in ((35, "threequarter"), (90, "side"), (145, "back")):
            aim(2.0, angle, 1.0)
            path = os.path.join(OUT, f"{clip_name}_{f:02d}_{label}.png")
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            assert os.path.exists(path), f"no file at {path}"
print("STRESS_DONE", len(os.listdir(OUT)), "renders")
