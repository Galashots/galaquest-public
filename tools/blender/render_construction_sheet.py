"""Render the orthographic views that NS-03, the Character Construction Master, is made of.

blender --background --factory-startup --python render_construction_sheet.py -- <in.glb> <outdir>

ORTHOGRAPHIC on purpose. NS-03 is dimensional evidence, and a perspective camera makes near limbs
larger than far ones, which is exactly the error that makes people read dimensions off paintings.
All four views share one camera scale, so widths are comparable between them.

The 90px view is a real render at 90px, never a downscale of a large one: downscaling antialiases
detail that would never have been drawn, which flatters the silhouette.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = (os.path.abspath(p) for p in argv[:2])
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

for obj in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    if not any(v.groups for v in obj.data.vertices):
        print(f"DROPPING {obj.name!r}: importer artifact")
        bpy.data.objects.remove(obj, do_unlink=True)

mesh = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
for arm in [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]:
    arm.data.pose_position = "REST"
bpy.context.view_layer.update()

pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
centre = (lo + hi) / 2
height = hi.z - lo.z
print(f"BOUNDS height={height:.4f} centre=({centre.x:.4f},{centre.y:.4f},{centre.z:.4f})")

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in {
    i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
} else "BLENDER_EEVEE_NEXT"
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.82, 0.82, 0.82, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 1.15

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
# One scale for every view, with a 12% margin, so a width in the front view and a width in the
# side view can honestly be compared to each other.
cam_data.ortho_scale = height * 1.12
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

for angle, energy in ((math.radians(40), 2.6), (math.radians(-60), 1.1)):
    light = bpy.data.objects.new("l", bpy.data.lights.new("l", type="SUN"))
    light.data.energy = energy
    light.rotation_euler = (math.radians(58), 0, angle)
    scene.collection.objects.link(light)

VIEWS = {"front": 0, "threequarter": 35, "side": 90, "back": 180}
DIST = max(height, hi.x - lo.x, hi.y - lo.y) * 3


def shoot(name, yaw_deg, px):
    yaw = math.radians(yaw_deg)
    cam.location = (centre.x + DIST * math.sin(yaw), centre.y - DIST * math.cos(yaw), centre.z)
    cam.rotation_euler = (math.radians(90), 0, yaw)
    scene.render.resolution_x = scene.render.resolution_y = px
    scene.render.resolution_percentage = 100
    path = os.path.join(OUT, f"{name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    assert os.path.exists(path), f"render reported success but wrote nothing to {path}"
    print(f"  {name}.png {px}px {os.path.getsize(path)} bytes")


print("ORTHOGRAPHIC VIEWS:")
for name, yaw in VIEWS.items():
    shoot(name, yaw, 640)
# The gameplay truth: a real 90px render, at the same framing as the front view.
shoot("gameplay_90", 0, 90)
shoot("gameplay_150", 0, 150)
print("DONE")
