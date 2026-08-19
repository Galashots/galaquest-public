"""Render a GLB from a few angles so a human (or a visual judge) can look at it.

blender --background --factory-startup --python render_glb.py -- <in.glb> <outdir> [thumb_px]

Two things this is careful about, both learned the hard way in this repo:
  * Blender resolves relative render paths against the .blend file, and a factory-startup session
    has none — so every path is made absolute and every write is asserted.
  * Blender's glTF importer can add objects that are not in the file. Anything it creates is
    listed explicitly here rather than assumed away, so a phantom is visible as a phantom.
"""

import os
import sys
import math

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = (os.path.abspath(p) for p in argv[:2])
THUMB = int(argv[2]) if len(argv) > 2 else 64

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# Force the bind pose. Whether an imported rig lands at rest or on some clip's first frame depends
# on how the GLB was exported, so two files of the same character can render in different poses and
# any pixel comparison between them then measures the pose rather than the thing being compared.
# This cost one wrong conclusion about decimation quality before it was pinned down.
for armature in [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]:
    armature.data.pose_position = "REST"
    print(f"REST POSE forced on {armature.name!r}")
bpy.context.view_layer.update()

objs = [o for o in bpy.context.scene.objects]
print("IMPORTED OBJECTS:")
for o in objs:
    tris = len(o.data.loop_triangles) if o.type == "MESH" else 0
    if o.type == "MESH":
        o.data.calc_loop_triangles()
        tris = len(o.data.loop_triangles)
    print(f"  {o.type:10s} {o.name!r} tris={tris}")

meshes = [o for o in objs if o.type == "MESH"]
if not meshes:
    sys.exit("no mesh imported")

# Frame the union of every mesh, so the camera distance does not depend on which object is active.
lo = [float("inf")] * 3
hi = [float("-inf")] * 3
for o in meshes:
    for corner in o.bound_box:
        world = o.matrix_world @ __import__("mathutils").Vector(corner)
        for i in range(3):
            lo[i] = min(lo[i], world[i])
            hi[i] = max(hi[i], world[i])
centre = [(lo[i] + hi[i]) / 2 for i in range(3)]
radius = max(hi[i] - lo[i] for i in range(3)) / 2 or 1.0
print(f"BOUNDS min={['%.3f' % v for v in lo]} max={['%.3f' % v for v in hi]} radius={radius:.3f}")

scene = bpy.context.scene
# Workbench ignores materials and renders everything flat grey. Falling back to it silently makes
# a textured asset look untextured, so the choice is printed and only a real shading engine counts.
available = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
print(f"ENGINES AVAILABLE: {available}")
for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    if candidate in available:
        scene.render.engine = candidate
        break
else:
    sys.exit(f"no shading engine among {available}")
print(f"ENGINE: {scene.render.engine}")
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.8, 0.8, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 1.2

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

key = bpy.data.objects.new("key", bpy.data.lights.new("key", type="SUN"))
key.data.energy = 3.0
key.rotation_euler = (math.radians(55), 0, math.radians(35))
scene.collection.objects.link(key)

VIEWS = {
    "front": (0, 0),
    "threequarter": (35, 20),
    "side": (90, 0),
    "back": (180, 0),
    "top": (0, 75),
}

os.makedirs(OUT, exist_ok=True)


def shoot(name, yaw_deg, pitch_deg, px):
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    dist = radius * 3.2
    cam.location = (
        centre[0] + dist * math.cos(pitch) * math.sin(yaw),
        centre[1] - dist * math.cos(pitch) * math.cos(yaw),
        centre[2] + dist * math.sin(pitch),
    )
    direction = __import__("mathutils").Vector(centre) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x = scene.render.resolution_y = px
    scene.render.resolution_percentage = 100
    path = os.path.join(OUT, f"{name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    assert os.path.exists(path), f"render reported success but wrote no file at {path}"
    print(f"  wrote {path} ({os.path.getsize(path)} bytes, {px}px)")


print("RENDERS:")
for name, (yaw, pitch) in VIEWS.items():
    shoot(name, yaw, pitch, 512)
# The real question for this asset is whether it survives being small on an iPad, so render one
# at true thumbnail size rather than downscaling a big one.
shoot("thumb", 0, 0, THUMB)
print("DONE")
