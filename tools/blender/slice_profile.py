"""Print how wide a mesh is at each height, so gear can be sized against the body it must fit over.

blender --background --factory-startup --python slice_profile.py -- <file.glb> [--bones Head,head_end]

A single bounding box is not enough to fit armour, and sizing from one led straight to a bad result:
the hero's head bounding box is 0.4489 wide, so a 0.49-wide helmet looks like it clears it by 9%.
It does not. The head is 0.444 wide at EAR level (z 1.259) and only 0.159 wide near the crown
(z 1.473), while the generated helmet is widest at its BOTTOM RIM. Sized by bounding boxes the two
numbers look compatible; in the render the helmet's widest ring sat where the head is 0.345 wide and
it read as a mushroom cap. What matters is width AT THE HEIGHT THE PIECE SITS, which is this.

--bones restricts to vertices weighted >= 0.5 to those groups, which is how you isolate "the head"
from a single-mesh character. Without it every vertex counts, which is what you want for a prop.
Rest pose is forced: a posed limb reports the width of a diagonal slice through it.
"""

import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
path = argv[0]
bones = set()
if "--bones" in argv:
    bones = {b.strip() for b in argv[argv.index("--bones") + 1].split(",") if b.strip()}
steps = int(argv[argv.index("--steps") + 1]) if "--steps" in argv else 16

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)

# The glTF importer fabricates an unweighted 'Icosphere' that is not in the file. Dropping
# unweighted meshes is only safe when we are isolating skinned vertices anyway; a rigid prop is
# legitimately unweighted, so only do it when --bones was asked for.
if bones:
    for o in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
        if not any(v.groups for v in o.data.vertices):
            print(f"  dropping importer artifact {o.name!r}")
            bpy.data.objects.remove(o, do_unlink=True)

for a in [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]:
    a.data.pose_position = "REST"
bpy.context.view_layer.update()

pts = []
for mesh in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    names = {g.index: g.name for g in mesh.vertex_groups}
    for v in mesh.data.vertices:
        if bones:
            if sum(g.weight for g in v.groups if names.get(g.group) in bones) < 0.5:
                continue
        pts.append(mesh.matrix_world @ v.co)

if not pts:
    sys.exit(f"ABORT: no vertices matched (bones={sorted(bones) or 'all'})")

lo, hi = min(p.z for p in pts), max(p.z for p in pts)
print(f"{len(pts)} vertices" + (f" weighted to {sorted(bones)}" if bones else ""))
print(f"bbox  X {min(p.x for p in pts):.4f}..{max(p.x for p in pts):.4f}"
      f"  Y {min(p.y for p in pts):.4f}..{max(p.y for p in pts):.4f}  Z {lo:.4f}..{hi:.4f}")

rows = []
print(f"\n{'z':>9} {'frac':>6} {'width X':>9} {'depth Y':>9} {'n':>6}")
for i in range(steps):
    z0 = lo + (hi - lo) * i / steps
    z1 = lo + (hi - lo) * (i + 1) / steps
    band = [p for p in pts if z0 <= p.z < (z1 if i < steps - 1 else z1 + 1e-9)]
    if not band:
        continue
    wx = max(p.x for p in band) - min(p.x for p in band)
    wy = max(p.y for p in band) - min(p.y for p in band)
    rows.append((z0, i / steps, wx))
    print(f"{z0:9.4f} {i / steps:6.2f} {wx:9.4f} {wy:9.4f} {len(band):6d}")

# The single most useful number when fitting: the height at which this thing is widest. For a piece
# of gear that is where it will collide with, or overhang, the body.
z_at_max, frac_at_max, wmax = max(rows, key=lambda r: r[2])
print(f"\nwidest {wmax:.4f} at z {z_at_max:.4f} ({frac_at_max * 100:.0f}% up from the bottom)")
