"""Can the hero reach the LOD1 triangle target and still read at 90 CSS px?

blender --background --factory-startup --python decimate_hero.py -- <in.glb> <out.glb> <target_tris>

The naked hero is 15,642 triangles against an LOD1 target of 8,000. No texture work touches that.
This asks whether a plain collapse decimation gets there without wrecking the silhouette or the
skinning, which is the cheapest possible answer before anyone considers authoring a second mesh.
"""

import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = (os.path.abspath(p) for p in argv[:2])
TARGET = int(argv[2])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# Blender's glTF importer fabricates meshes that are not in the file -- an 80-triangle Icosphere
# shows up importing a hero whose own JSON declares exactly one mesh. Exporting the scene would
# bake that phantom into the output, so anything carrying no skin weights is dropped by name.
for obj in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    weighted = sum(1 for v in obj.data.vertices if v.groups)
    if weighted == 0:
        print(f"DROPPING {obj.name!r}: {len(obj.data.polygons)} faces, 0 weighted vertices")
        bpy.data.objects.remove(obj, do_unlink=True)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
assert len(meshes) == 1, f"expected one mesh, got {[m.name for m in meshes]}"
hero = meshes[0]
hero.data.calc_loop_triangles()
before = len(hero.data.loop_triangles)
ratio = TARGET / before
print(f"MESH {hero.name!r} {before} tris -> target {TARGET} (ratio {ratio:.4f})")

mod = hero.modifiers.new("decimate", "DECIMATE")
mod.decimate_type = "COLLAPSE"
mod.ratio = ratio
# Symmetry keeps the two halves of a character collapsing the same way, which matters far more at
# 90px than the raw count does: an asymmetric face reads as a broken face.
mod.use_symmetry = True
mod.symmetry_axis = "X"

depsgraph = bpy.context.evaluated_depsgraph_get()
evaluated = hero.evaluated_get(depsgraph).to_mesh()
evaluated.calc_loop_triangles()
after = len(evaluated.loop_triangles)
print(f"DECIMATED to {after} tris ({100.0 * after / before:.1f}% of original)")

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_apply=True,
    export_animations=True,
    export_skins=True,
)
assert os.path.exists(OUT), f"export reported success but wrote nothing to {OUT}"
print(f"WROTE {OUT} ({os.path.getsize(OUT)} bytes)")
