# Re-exports a supplied Lantern Tree GLB with its three embedded PBR textures downscaled.
# Geometry, primitive count and material count are untouched -- only image resolution/encoding
# changes. Blender 5.2, --background --factory-startup, same convention as
# tools/blender/assemble_kenney_house.py.
#
# blender --background --factory-startup --python optimize_lantern_tree.py -- <in.glb> <out.glb> [--drop-normal]
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
IN_GLB, OUT_GLB = os.path.abspath(argv[0]), os.path.abspath(argv[1])
DROP_NORMAL = "--drop-normal" in argv
BASE_PX, MR_PX, NORMAL_PX = 1024, 512, 512
JPEG_QUALITY = 85

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN_GLB)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
assert len(meshes) == 1, f"expected 1 mesh object, found {len(meshes)}"
mesh_obj = meshes[0]
in_verts, in_tris = len(mesh_obj.data.vertices), len(mesh_obj.data.polygons)
assert len(mesh_obj.data.materials) == 1, f"expected 1 material, found {len(mesh_obj.data.materials)}"
print(f"IMPORTED: vertices={in_verts} triangles={in_tris} materials=1")

# Images are looked up BY NAME, not by import order -- the source GLB's own author named them
# base_color/metallic_roughness/normal (confirmed via diag_material_graph.py against this exact
# file), and asserting the name is a real check; trusting import order would not be.
names = {"base_color": BASE_PX, "metallic_roughness": MR_PX, "normal": NORMAL_PX}
assert set(bpy.data.images.keys()) >= set(names), f"expected images {list(names)}, found {list(bpy.data.images.keys())}"
for name in names:
    img = bpy.data.images[name]
    assert img.size[0] == 2048 and img.size[1] == 2048, f"{name}: expected 2048x2048, found {img.size[0]}x{img.size[1]}"

def downscale(name, px):
    img = bpy.data.images[name]
    before = tuple(img.size)
    img.scale(px, px)
    print(f"RESIZED {name}: {before[0]}x{before[1]} -> {img.size[0]}x{img.size[1]}")

downscale("base_color", BASE_PX)
downscale("metallic_roughness", MR_PX)

if DROP_NORMAL:
    mat = mesh_obj.data.materials[0]
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    normal_map_node = bsdf.inputs["Normal"].links[0].from_node
    mat.node_tree.links.remove(bsdf.inputs["Normal"].links[0])
    mat.node_tree.nodes.remove(normal_map_node)
    print("DROPPED normal map node + link")
else:
    downscale("normal", NORMAL_PX)

bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=False,
    export_image_format="JPEG",
    export_jpeg_quality=JPEG_QUALITY,
    export_unused_images=False,
)

out_bytes = os.path.getsize(OUT_GLB)
print(f"WROTE {OUT_GLB} {out_bytes} bytes (variant={'no-normal' if DROP_NORMAL else 'full'})")
