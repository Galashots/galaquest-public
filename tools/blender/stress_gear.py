# Mount the generated cuirass on the hero's Spine02 and render the combat clips' extreme frames:
# the candy-wrap measurement. v2 -- v1 fell into both traps fit_gear.py documents (bone-tail
# parenting on a rig with importer-garbage tails, then matrix math on top). This version follows
# fit_gear.py: compose the world placement directly in REST pose, then attach with a Child Of
# CONSTRAINT (which anchors at the bone HEAD, not the tail) and let the clips drive it.
#
# blender --background --factory-startup --python stress_chestplate.py -- <hero.glb> <cuirass.glb> <outdir> [worldHeight] [dz_up] [dy_fwd]
import os
import sys
import math

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
HERO, CUIRASS, OUT = (os.path.abspath(p) for p in argv[:3])
WORLD_HEIGHT = float(argv[3]) if len(argv) > 3 else 0.42
DZ_UP = float(argv[4]) if len(argv) > 4 else 0.0
DY_FWD = float(argv[5]) if len(argv) > 5 else 0.0
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=HERO)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
arm.data.pose_position = "REST"
bpy.context.view_layer.update()

hero_mesh = max((o for o in bpy.context.scene.objects if o.type == "MESH"), key=lambda o: len(o.data.vertices))
pts = [hero_mesh.matrix_world @ v.co for v in hero_mesh.data.vertices]
hero_h = max(p.z for p in pts) - min(p.z for p in pts)
print(f"HERO height {hero_h:.4f}  armature scale {tuple(round(s,4) for s in arm.scale)}")

pb = arm.pose.bones["Spine02"]
head_w = arm.matrix_world @ pb.head
tail_w = arm.matrix_world @ pb.tail
print(f"Spine02 head_w=({head_w.x:.4f},{head_w.y:.4f},{head_w.z:.4f}) tail_w=({tail_w.x:.4f},{tail_w.y:.4f},{tail_w.z:.4f})")
if not (0.2 < head_w.z < 1.8):
    for b in arm.pose.bones:
        w = arm.matrix_world @ b.head
        print(f"  bone {b.name}: world head z={w.z:.4f}")
    raise SystemExit("ABORT: Spine02 world head is not at chest height; up-axis assumption wrong")

before = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=CUIRASS)
added = [o for o in bpy.context.scene.objects if o not in before and o.type == "MESH"]
cuirass = max(added, key=lambda o: len(o.data.polygons))
for o in [o for o in bpy.context.scene.objects if o not in before and o is not cuirass]:
    bpy.data.objects.remove(o, do_unlink=True)

local_pts = [Vector(c) for c in cuirass.bound_box]
natural = max(p.z for p in local_pts) - min(p.z for p in local_pts)
centre_local = sum(local_pts, Vector()) / 8
world_scale = WORLD_HEIGHT / natural
# HEAD ONLY. The tail is importer-synthesized garbage (measured z=10.16 on a 1.5m hero, the
# exact defect fit_gear.py documents), so averaging it in placed the cuirass 5m in the air.
centre_target = head_w + Vector((0, -DY_FWD, 0.06 + DZ_UP))
cuirass.scale = (world_scale, world_scale, world_scale)
cuirass.location = centre_target - world_scale * centre_local
bpy.context.view_layer.update()
print(f"CUIRASS natural {natural:.4f} -> world scale {world_scale:.4f}; centre target ({centre_target.x:.4f},{centre_target.y:.4f},{centre_target.z:.4f})")

con = cuirass.constraints.new("CHILD_OF")
con.target = arm
con.subtarget = "Spine02"
# Keep current world placement: inverse of the bone's current world matrix (head-anchored).
con.inverse_matrix = (arm.matrix_world @ pb.matrix).inverted()
bpy.context.view_layer.update()

arm.data.pose_position = "POSE"
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = scene.render.resolution_y = 512
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

def aim(dist, azimuth_deg, height):
    az = math.radians(azimuth_deg)
    cam.location = (dist * math.sin(az), -dist * math.cos(az), height)
    direction = Vector((0, 0, 0.95)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

CLIPS = {
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
        for angle, label in ((35, "threequarter"), (90, "side")):
            aim(2.0, angle, 1.0)
            path = os.path.join(OUT, f"{clip_name}_{f:02d}_{label}.png")
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            assert os.path.exists(path), f"no file at {path}"
print("STRESS_DONE", len(os.listdir(OUT)), "renders")
