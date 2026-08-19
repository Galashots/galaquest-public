# Read-only inspection of the two candidate wolves.
#
# The question this answers: the shipped wolf already has a Meshy Quadruped-Dog rig but only a
# base-layer clip. The Quaternius wolf has clips. Can those clips reach the shipped skeleton?
# Retargeting needs comparable bone structure, so print both skeletons rather than guessing.

import bpy, sys, os

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def report(label, armatures, actions):
    print(f"\n===== {label} =====")
    for arm in armatures:
        bones = arm.data.bones
        print(f"  armature: {arm.name}  bones={len(bones)}")
        roots = [b.name for b in bones if b.parent is None]
        print(f"  roots: {roots}")
        print("  bone names:")
        for b in sorted(bones, key=lambda b: b.name):
            print(f"    {b.name}")
    print(f"  actions ({len(actions)}):")
    for a in actions:
        fr = a.frame_range
        # Blender 5.x replaced action.fcurves with layered actions and slots; count channels the
        # new way and fall back so this script survives on 4.x too.
        n = 0
        try:
            for layer in a.layers:
                for strip in layer.strips:
                    for slot in a.slots:
                        cb = strip.channelbag(slot)
                        if cb:
                            n += len(cb.fcurves)
        except AttributeError:
            n = len(getattr(a, "fcurves", []))
        print(f"    CLIP  {a.name!r}  frames {fr[0]:.0f}..{fr[1]:.0f}  channels={n}")

fbx = sys.argv[sys.argv.index("--") + 1]
glb = sys.argv[sys.argv.index("--") + 2]

clear()
bpy.ops.import_scene.fbx(filepath=fbx)
report("QUATERNIUS Wolf.fbx",
       [o for o in bpy.data.objects if o.type == "ARMATURE"],
       list(bpy.data.actions))

clear()
bpy.ops.import_scene.gltf(filepath=glb)
arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
report("SHIPPED wolf.glb", arms, list(bpy.data.actions))
for o in bpy.data.objects:
    if o.type == "MESH":
        vgs = len(o.vertex_groups)
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        print(f"  mesh {o.name}: tris={tris} vertex_groups={vgs} verts={len(o.data.vertices)}")
        # A rig that reports success but assigns nothing is the false-green Luna hit. Count real
        # weight assignments rather than trusting the group count.
        assigned = sum(1 for v in o.data.vertices if len(v.groups) > 0)
        print(f"  mesh {o.name}: vertices with any weight = {assigned}/{len(o.data.vertices)}")
print("INSPECT_DONE")
