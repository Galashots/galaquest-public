# Render a prop from an ABSOLUTE, caller-fixed camera -- not render_prop.py's own per-object
# auto-framing (camera distance = object's own span * 2.2), which would defeat the entire point of a
# current-placeholder-vs-Meshy-candidate contact sheet: two objects of genuinely different real size
# would each get framed to fill their own picture and look deceptively similar. Sol's ruling
# (2026-08-16) explicitly asked for "the exact same cameras" across candidates precisely so relative
# scale stays honest.
#
# Grounds the object at its own measured minY before rendering (matching how zoneLoader.js's
# groundOffsetY would place it in-game), so an ungrounded Meshy export and an already-grounded
# shipped prop both render standing on the same floor plane, not floating at different heights.
#
#   blender --background --factory-startup --python render_prop_fixed_camera.py -- \
#     <prop.glb> <outdir> <camDistance> <camHeight> [azDeg=25]
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
CAM_DISTANCE = float(argv[2])
CAM_HEIGHT = float(argv[3])
AZ_DEG = float(argv[4]) if len(argv) > 4 else 25.0
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
print(f"PROP bounds (pre-ground) lo={tuple(round(v,4) for v in lo)} hi={tuple(round(v,4) for v in hi)}")

# Blender's glTF importer converts the file's Y-up axis to Blender's own Z-up convention on import
# -- render_prop.py's own camera math already treats Z as up (span * 0.35 lands in the THIRD Vector
# component), and this script follows the same convention rather than the raw glTF Y-up axis
# tools/foundry/inspect_prop_candidate.mjs measures directly from the un-imported file.
#
# Ground it: shift every mesh up by -lo.z, so the object's own lowest point sits at world Z=0, same
# convention as zoneLoader.js's groundOffsetY (applied to the axis Blender actually renders as up).
ground_shift = -lo.z
for o in meshes:
    o.location.z += ground_shift
print(f"grounded: shifted +Z by {ground_shift:.4f}")

# Fixed pivot for the camera to look at: X/Y centre of the (now-grounded) object, a fraction of the
# FIXED camera height up -- NOT re-derived per object's own span, so two differently-sized objects
# are still shot from literally the same camera rig, only their own silhouette differs in frame.
cx = (lo.x + hi.x) / 2
cy = (lo.y + hi.y) / 2
look_at = Vector((cx, cy, CAM_HEIGHT * 0.4))

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = scene.render.resolution_y = 640
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

az = math.radians(AZ_DEG)
cam.location = look_at + Vector((CAM_DISTANCE * math.sin(az), -CAM_DISTANCE * math.cos(az), CAM_HEIGHT - look_at.z))
direction = look_at - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

name = os.path.splitext(os.path.basename(SRC))[0]
path = os.path.join(OUT, f"{name}_fixedcam.png")
scene.render.filepath = path
bpy.ops.render.render(write_still=True)
print(f"RENDERED {path}")
