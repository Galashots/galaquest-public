"""Measure a rigged character GLB against the quantities hero_contract.json cares about.

blender --background --factory-startup --python measure_hero.py -- <in.glb> [out.json]

Why this exists: the contract locks 3.84 heads tall and states plainly that it is "a TARGET for the
mesh, not a measured property of any mesh. Nothing may claim a GalaQuest mesh is 3.84 heads until a
mesh is measured." Nothing had been measured. This measures it.

Conventions follow docs/teardown/STAGE_T_REFERENCE_BASELINES.md so the output is comparable to the
pack baselines already in the contract, and every deviation is printed rather than assumed:

  * headHeight comes from HEAD-WEIGHTED VERTICES, so hair counts as head. That is the convention the
    3.84 target was measured under; the skull-to-chin figure is a different measurement and quoting
    one against the other is the error that document warns about.
  * shoulderWidth uses UPPER-ARM BONE HEADS. Stage T used clavicle tails where a rig had clavicles,
    and this rig does have them -- but its bone TAILS are synthesized garbage. The glTF importer
    gives LeftShoulder a length of 1233.95 in a character 1.5 units tall, so a clavicle-tail span
    measures 24.39 where the real shoulder span is 0.304. Bone HEADS are correct; tails are not, so
    the bone table below stores no tails at all and the output records whether they were usable.
  * Everything is world space after the armature's own scale is applied. This rig carries 0.01.

Measured, not adopted. Nothing here is a target and nothing here may be copied into the contract as
one without the owner's approval -- that is the same rule the pack baselines live under.
"""

import json
import os
import sys
from collections import defaultdict

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC = os.path.abspath(argv[0])
OUT = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

for obj in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    if not any(v.groups for v in obj.data.vertices):
        print(f"DROPPING {obj.name!r}: importer artifact, no weighted vertices")
        bpy.data.objects.remove(obj, do_unlink=True)

mesh_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
assert len(mesh_objs) == 1 and len(armatures) == 1, "expected exactly one mesh and one armature"
mesh, arm = mesh_objs[0], armatures[0]
arm.data.pose_position = "REST"
bpy.context.view_layer.update()

group_names = {g.index: g.name for g in mesh.vertex_groups}
world = [mesh.matrix_world @ v.co for v in mesh.data.vertices]

# Weight of each vertex toward a named set of groups, so "head" can mean skull+hair+face together.
def weight_toward(vertex, names):
    return sum(g.weight for g in vertex.groups if group_names.get(g.group) in names)

def extent(points, axis):
    values = [p[axis] for p in points]
    return max(values) - min(values) if values else 0.0

def vertices_for(names, threshold=0.5):
    return [world[i] for i, v in enumerate(mesh.data.vertices) if weight_toward(v, names) >= threshold]

HEAD = {"Head", "head_end", "headfront"}
total_height = extent(world, 2)
ground = min(p[2] for p in world)

head_pts = vertices_for(HEAD)
head_height = extent(head_pts, 2)
heads_tall = total_height / head_height if head_height else 0.0

# HEADS ONLY. Bone tails are synthesized by the glTF importer and are not a property of the file:
# on this rig they run to 1,233 units on a character 1.5 units tall. The dict deliberately stores
# no tails, so a later edit cannot reach for one by accident.
bones = {b.name: arm.matrix_world @ b.head_local for b in arm.data.bones}

def span(a, b):
    return (bones[a] - bones[b]).length

upperarm_head_span = span("LeftArm", "RightArm")

# THE HAIR PROBLEM, raised by the owner 2026-08-12 and it changes the headline.
#
# "Head height" measured from head-weighted vertices puts 0H at the top of the HAIR, and this hero's
# hair is spiky. Tall hair inflates head height, which deflates heads-tall -- so the same body reads
# as fewer heads tall purely because of a hairstyle. The contract shows exactly this on the source
# illustration: 3.84 hair-included against a 4.31 skull-to-chin heuristic, a gap of 0.47.
#
# So both are reported. The vertex figure is comparable to the 3.84 target because that is the
# convention the target was measured under. The skeletal figure is the hair-independent one, spanning
# the Head joint to the head_end joint, and it is the better guide to whether the BODY is right.
head_joint_z = bones["Head"].z
head_end_z = bones["head_end"].z
head_height_skeletal = abs(head_end_z - head_joint_z)
heads_tall_skeletal = total_height / head_height_skeletal if head_height_skeletal else 0.0
hair_above_head_end = max(p[2] for p in head_pts) - head_end_z

# Not fatal -- nothing above uses a tail -- but recorded loudly, because the first version of this
# script did use tails and reported a shoulder span of 24.39 on a 1.5-unit character.
scale = arm.matrix_world.to_scale()[0]
longest_length, longest_name = max((scale * b.length, b.name) for b in arm.data.bones)
tails_usable = longest_length <= total_height
if not tails_usable:
    print(f"WARNING: bone tails are unusable on this rig -- {longest_name!r} is {longest_length:.2f} "
          f"long on a character {total_height:.2f} tall. Measured from bone heads only.")

hand_pts = vertices_for({"LeftHand"})
foot_pts = vertices_for({"LeftFoot", "LeftToeBase"})
forearm_pts = vertices_for({"LeftForeArm"})
upperarm_pts = vertices_for({"LeftArm"})

# Stage T's convention: arm is upperarm + lowerarm and stops at the wrist, because wrist and hand
# are separate joints in these rigs.
arm_length = span("LeftArm", "LeftForeArm") + span("LeftForeArm", "LeftHand")
leg_length = span("LeftUpLeg", "LeftLeg") + span("LeftLeg", "LeftFoot")

result = {
    "source": os.path.basename(SRC),
    "armatureScale": list(arm.scale),
    "convention": {
        "headHeight": "Z extent of vertices with combined weight >= 0.5 to Head/head_end/headfront; HAIR COUNTS AS HEAD",
        "shoulderWidth": "upper-arm bone HEADS; this rig's bone tails are importer-synthesized and unusable",
        "space": "world space, armature scale applied",
        "pose": "rest",
        "boneTailsUsable": tails_usable,
    },
    "counts": {
        "triangles": len(mesh.data.loop_triangles),
        "vertices": len(mesh.data.vertices),
        "joints": len(arm.data.bones),
        "headWeightedVertices": len(head_pts),
        "handWeightedVertices": len(hand_pts),
    },
    "absolute": {
        "totalHeight": total_height,
        "feetMinZ": ground,
        "headHeight": head_height,
        "headHeightSkeletal": head_height_skeletal,
        "hairAboveHeadEnd": hair_above_head_end,
        "shoulderWidthUpperArmHeads": upperarm_head_span,
        "handWidthX": extent(hand_pts, 0),
        "handLengthZ": extent(hand_pts, 2),
        "footLengthY": extent(foot_pts, 1),
        "footWidthX": extent(foot_pts, 0),
        "forearmThicknessX": extent(forearm_pts, 0),
        "upperArmThicknessX": extent(upperarm_pts, 0),
        "armLength": arm_length,
        "legLength": leg_length,
    },
}
# In heads, which is the unit the contract and the pack baselines both speak.
result["inHeads"] = {
    "headsTall": heads_tall,
    "headsTallSkeletal": heads_tall_skeletal,
    **{k: v / head_height for k, v in result["absolute"].items()
       if k not in ("totalHeight", "feetMinZ", "headHeight", "headHeightSkeletal",
                    "hairAboveHeadEnd") and head_height},
}

mesh.data.calc_loop_triangles()
result["counts"]["triangles"] = len(mesh.data.loop_triangles)

print(json.dumps(result, indent=2))
print(f"\nHEADS TALL depends entirely on where the head starts and stops. Both are reported.")
print(f"  vertex-weighted (0H at the top of the HAIR): {heads_tall:.4f}  -> {heads_tall - 3.84:+.4f} vs 3.84")
print(f"  skeletal (Head joint to head_end joint):     {heads_tall_skeletal:.4f}  -> {heads_tall_skeletal - 3.84:+.4f} vs 3.84")
print(f"  head height {head_height:.4f} vertex vs {head_height_skeletal:.4f} skeletal, a gap of "
      f"{head_height - head_height_skeletal:.4f}, made up of:")
print(f"    {hair_above_head_end:.4f} of hair ABOVE the head_end joint")
print(f"    {head_joint_z - min(p[2] for p in head_pts):.4f} of jaw and neck BELOW the Head joint")
print(f"  So the top-of-hair boundary is real but small here; most of the difference is at the chin.")
print(f"  forearm/upperarm thickness ratio: {result['absolute']['forearmThicknessX'] / result['absolute']['upperArmThicknessX']:.4f}")
print("  (owner directive note-4 requires forearm thickness may only INCREASE from candidate C,")
print("   whose forearmTaper of 0.78 made the forearm strictly thinner than the upper arm.)")

if OUT:
    with open(OUT, "w", encoding="utf8") as f:
        json.dump(result, f, indent=2)
    print(f"\nwrote {OUT}")
