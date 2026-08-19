# Quick prop turntable: 4 angles, textured workbench render.
# blender --background --factory-startup --python render_prop.py -- <prop.glb> <outdir>
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
centre = (lo + hi) / 2
span = max(hi - lo)
print(f"PROP bounds lo={tuple(round(v,4) for v in lo)} hi={tuple(round(v,4) for v in hi)} span={span:.4f}")

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = scene.render.resolution_y = 512
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

for az_deg in (0, 90, 180, 270):
    az = math.radians(az_deg)
    dist = span * 2.2
    cam.location = centre + Vector((dist * math.sin(az), -dist * math.cos(az), span * 0.35))
    direction = centre - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    path = os.path.join(OUT, f"angle_{az_deg:03d}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    assert os.path.exists(path)
print("RENDER_DONE", len(os.listdir(OUT)))
