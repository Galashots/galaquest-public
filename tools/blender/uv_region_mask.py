"""Rasterise the UV island of the faces owned by a set of bones, so a body region can be repainted.

blender --background --factory-startup --python uv_region_mask.py -- <hero.glb> <bones> <outdir> [--size 1024]

Armour that changes the silhouette needs geometry, but armour that only changes the SURFACE does not
-- and the surface half is the half GalaQuest skipped. The slot ranking says the chest is "texture
and value only, no separate geometry", and other games agree: their characters read as armoured
mostly through texture on the body mesh. To paint a region you first have to know where it lives in
the atlas, which is what this finds.

A face belongs to the region when its vertices are weighted to one of the named bones. Weight is
summed per face and averaged, so a face straddling the shoulder seam is included only if the region
genuinely owns most of it -- a per-vertex test alone pulls in a fringe of neighbouring faces and the
mask then bleeds armour onto the arm.

Writes mask.png (white = region), region.png (the current texture, cropped to the mask's bounding
box) and region.json (the crop box, so a repainted crop can be composited back exactly).
"""

import json
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, BONES, OUT = argv[0], {b.strip() for b in argv[1].split(",") if b.strip()}, argv[2]
SIZE = int(argv[argv.index("--size") + 1]) if "--size" in argv else 1024
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(GLB))
for o in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    if not any(v.groups for v in o.data.vertices):
        print(f"  dropping importer artifact {o.name!r}")
        bpy.data.objects.remove(o, do_unlink=True)

mesh = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
names = {g.index: g.name for g in mesh.vertex_groups}
missing = BONES - set(names.values())
if missing:
    sys.exit(f"ABORT: no vertex group(s) named {sorted(missing)}; have {sorted(names.values())}")

weight = {}
for v in mesh.data.vertices:
    weight[v.index] = sum(g.weight for g in v.groups if names.get(g.group) in BONES)

for a in [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]:
    a.data.pose_position = "REST"
bpy.context.view_layer.update()

# Each triangle carries BOTH its UV corners and its world-space corners. A character's UV islands
# are scattered all over the atlas -- the torso's bounding box here covers almost the whole 1024
# square while owning only 7.7% of its pixels -- so a cropped patch is not something anyone can
# paint on. Carrying the 3D position lets a painter work in WORLD space and project the result
# through the UVs, which is how texture painting actually works and is immune to island scatter.
uv = mesh.data.uv_layers.active.data
tris, pos = [], []
for poly in mesh.data.polygons:
    w = sum(weight[mesh.data.loops[li].vertex_index] for li in poly.loop_indices) / poly.loop_total
    if w < 0.5:
        continue
    corners = [(uv[li].uv[0], uv[li].uv[1]) for li in poly.loop_indices]
    world = [tuple(mesh.matrix_world @ mesh.data.vertices[mesh.data.loops[li].vertex_index].co)
             for li in poly.loop_indices]
    for i in range(1, len(corners) - 1):
        tris.append((corners[0], corners[i], corners[i + 1]))
        pos.append((world[0], world[i], world[i + 1]))

print(f"region {sorted(BONES)}: {len(tris)} UV triangles from {len(mesh.data.polygons)} faces")
if not tris:
    sys.exit("ABORT: the region owns no faces at >= 0.5 average weight")

zs = [p[2] for t in pos for p in t]
xs = [p[0] for t in pos for p in t]
ys = [p[1] for t in pos for p in t]
print(f"world extent  x {min(xs):.4f}..{max(xs):.4f}  y {min(ys):.4f}..{max(ys):.4f}  z {min(zs):.4f}..{max(zs):.4f}")

with open(os.path.join(OUT, "uv_tris.json"), "w", encoding="utf8") as f:
    json.dump({"size": SIZE, "tris": tris, "pos": pos,
               "worldBounds": {"min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]}}, f)
print(f"wrote {os.path.join(OUT, 'uv_tris.json')}")
