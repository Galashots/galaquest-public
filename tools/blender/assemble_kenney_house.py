# Assemble a cottage from Kenney fantasy-town-kit modules and export ONE merged GLB.
# Pieces are 1m cell modules; wall.glb occupies the +X edge face of its cell (measured
# posMin x=0.4, posMax x=0.5), so a wall on a cell edge = place at cell centre, rotate Z.
#
# blender --background --factory-startup --python assemble_house.py -- <kit_glb_dir> <out.glb> <variant> [render_dir]
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
KIT, OUT, VARIANT = os.path.abspath(argv[0]), os.path.abspath(argv[1]), argv[2]
RENDER = os.path.abspath(argv[3]) if len(argv) > 3 else None

bpy.ops.wm.read_factory_settings(use_empty=True)

_cache = {}
def load(name):
    """Import a kit GLB once, return its mesh object template."""
    if name not in _cache:
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(KIT, name + ".glb"))
        added = [o for o in bpy.context.scene.objects if o not in before]
        meshes = [o for o in added if o.type == "MESH"]
        assert meshes, f"{name}: no mesh imported"
        template = meshes[0]
        for o in added:
            if o is not template:
                bpy.data.objects.remove(o, do_unlink=True)
        template.parent = None
        template.hide_set(True)
        _cache[name] = template
    return _cache[name]

placed = []
def put(name, x, y, z=0.0, rot=0):
    """Place a copy at cell position. rot in degrees around WORLD Z, composed onto the
    template's world matrix (which carries the glTF importer's Y-up conversion --
    editing euler.z directly rotates in the converted local frame and scatters pieces)."""
    t = load(name)
    c = t.copy()
    c.data = t.data
    c.hide_set(False)
    bpy.context.scene.collection.objects.link(c)
    c.matrix_world = Matrix.Translation((x, y, z)) @ Matrix.Rotation(math.radians(rot), 4, 'Z') @ t.matrix_world
    placed.append(c)

# Wall orientation convention, from measurement: wall.glb fills the +X edge of its cell.
# rot 0 -> wall on east edge; 90 -> north; 180 -> west; 270 -> south.
E, N, W, S = 0, 90, 180, 270

if VARIANT == "cottage":
    # 3x2 footprint. Cells x=0..2, y=0..1. South = front (door).
    put("wall-door", 1, 0, rot=S)
    put("wall-window-shutters", 0, 0, rot=S)
    put("wall-window-shutters", 2, 0, rot=S)
    for x in range(3):
        put("wall", x, 1, rot=N)
    for y in range(2):
        put("wall-window-small", 0, y, rot=W)
        put("wall", 2, y, rot=E)
    # Roof: measured, roof.glb's high edge is the +x cell edge at rot 0, and Z-rotation
    # maps E->N->W->S. South row needs its high edge on the shared y=0.5 line (north),
    # north row the mirror; the two high edges then meet and the ridge closes itself.
    for x in range(3):
        put("roof", x, 0, z=1.0, rot=N)
        put("roof", x, 1, z=1.0, rot=S)
    # Gable triangles stay open: wall-slope is 1m tall against a 0.63 roof rise and reads
    # as broken parapets (tried, rendered, rejected). The openings face east/west, are
    # above wall height, and the gameplay camera is elevated -- they read as shadow.
elif VARIANT == "longhouse":
    # 4x2 wood-walled house, door on south, banner.
    put("wall-wood-door", 1, 0, rot=S)
    put("wall-wood-window-shutters", 0, 0, rot=S)
    put("wall-wood-window-shutters", 2, 0, rot=S)
    put("wall-wood", 3, 0, rot=S)
    for x in range(4):
        put("wall-wood", x, 1, rot=N)
    for y in range(2):
        put("wall-wood-window-small", 0, y, rot=W)
        put("wall-wood-window-small", 3, y, rot=E)
    for x in range(4):
        put("roof-high", x, 0, z=1.0, rot=N)
        put("roof-high", x, 1, z=1.0, rot=S)
elif VARIANT == "rooftest":
    # Orientation probe: which way does roof.glb slope at each rot?
    for i, r in enumerate((0, 90, 180, 270)):
        put("roof", i * 2, 0, z=0.0, rot=r)
        put("roof-gable-end", i * 2, 2, z=0.0, rot=r)
else:
    raise SystemExit(f"unknown variant {VARIANT}")

# Join all placed copies into one object.
for o in bpy.context.scene.objects:
    o.select_set(False)
for c in placed:
    c.select_set(True)
bpy.context.view_layer.objects.active = placed[0]
bpy.ops.object.join()
house = bpy.context.view_layer.objects.active
house.name = f"house-{VARIANT}"

# Delete hidden templates so the export carries only the house.
for t in list(_cache.values()):
    bpy.data.objects.remove(t, do_unlink=True)

# Recenter: put the footprint centre at origin, base at z=0.
pts = [house.matrix_world @ Vector(c) for c in house.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
house.location -= centre
bpy.context.view_layer.update()
print(f"HOUSE {VARIANT}: span=({hi.x-lo.x:.2f},{hi.y-lo.y:.2f},{hi.z-lo.z:.2f}) tris={sum(len(p.loop_indices)-2 for p in house.data.polygons)}")

for o in bpy.context.scene.objects:
    o.select_set(o is house)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True)
print("WROTE", OUT, os.path.getsize(OUT), "bytes")

if RENDER:
    os.makedirs(RENDER, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = scene.render.resolution_y = 512
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    span = max(hi - lo)
    for az_deg in (35, 215):
        az = math.radians(az_deg)
        cam.location = Vector((span * 2.0 * math.sin(az), -span * 2.0 * math.cos(az), span * 1.1))
        d = Vector((0, 0, (hi.z - lo.z) / 2)) - cam.location
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(RENDER, f"{VARIANT}_{az_deg}.png")
        bpy.ops.render.render(write_still=True)
    print("RENDERED", RENDER)
