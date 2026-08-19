# Render an animated character's clips at chosen frames from two angles: the step-back look.
# blender --background --factory-startup --python render_npc.py -- <char.glb> <outdir> <clip:frame> [clip:frame ...]
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
SHOTS = [s.split(":") for s in argv[2:]]
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
hi_z = max(p.z for p in pts)
lo_z = min(p.z for p in pts)
h = hi_z - lo_z
print(f"CHAR height {h:.3f}")

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = scene.render.resolution_y = 512
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam

for clip_name, frame in SHOTS:
    action = next((a for a in bpy.data.actions if clip_name.lower() in a.name.lower()), None)
    if action is None:
        print("MISSING CLIP", clip_name, "have:", [a.name for a in bpy.data.actions])
        continue
    arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(action, "slots") and len(action.slots):
        arm.animation_data.action_slot = action.slots[0]
    scene.frame_set(int(frame))
    for az_deg, label in ((20, "front"), (90, "side")):
        az = math.radians(az_deg)
        dist = h * 1.7
        cam.location = Vector((dist * math.sin(az), -dist * math.cos(az), lo_z + h * 0.55))
        d = Vector((0, 0, lo_z + h * 0.5)) - cam.location
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(OUT, f"{clip_name}_{frame}_{label}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
print("NPC_RENDER_DONE", len(os.listdir(OUT)))
