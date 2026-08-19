"""Mount gear on the hero at a stated transform, render it, and print the numbers a runtime needs.

blender --background --factory-startup --python fit_gear.py -- <hero.glb> <fit.json> <outdir>

The armour research deliberately stopped short of inventing fit offsets: "its local scale, facing
rotation, and grip offset must be measured in the tracer against the gameplay camera". This is that
tracer. It takes a fit description in hero WORLD units -- which is how a human can reason about it,
because NS-03 measures the hero in those units -- and converts to the bone-local numbers three.js
will actually need.

The conversion is the part that is easy to get wrong by a factor of 100. The armature root carries
a scale of 0.01, so anything parented under a hand Bone inherits it. A gear item that should be
0.49 units tall in the world, from a source 1.0 units tall, needs a bone-local scale of 49, not
0.49. That factor is computed here from the measured bone matrix rather than assumed, and the
achieved world size is measured back afterwards so the arithmetic cannot quietly be wrong.

fit.json:
  { "items": [ { "glb": "...", "bone": "RightHand", "worldHeight": 0.49,
                 "rotationEuler": [0,0,0], "offset": [0,0,0], "name": "sword" } ] }
  rotationEuler is degrees, applied in the bone's space. offset is in HERO WORLD units.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
HERO, FIT, OUT = (os.path.abspath(p) for p in argv[:3])
os.makedirs(OUT, exist_ok=True)
fit = json.load(open(FIT, encoding="utf8"))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=HERO)


def drop_phantoms():
    """Blender's glTF importer fabricates unweighted meshes that are not in the file."""
    for obj in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
        if not any(v.groups for v in obj.data.vertices) and obj.get("gq_gear") is None:
            print(f"  dropping importer artifact {obj.name!r}")
            bpy.data.objects.remove(obj, do_unlink=True)


drop_phantoms()
arm = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"][0]
arm.data.pose_position = "REST"
bpy.context.view_layer.update()
hero_mesh = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
hero_pts = [hero_mesh.matrix_world @ v.co for v in hero_mesh.data.vertices]
hero_height = max(p.z for p in hero_pts) - min(p.z for p in hero_pts)
print(f"HERO height {hero_height:.4f}, armature scale {tuple(round(s, 4) for s in arm.scale)}")

results = []
for item in fit["items"]:
    name = item["name"]
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(item["glb"]))
    added = [o for o in bpy.context.scene.objects if o not in before and o.type == "MESH"]
    # Tag before dropping phantoms, or the gear itself (which has no weights, being a rigid prop)
    # would be deleted as an artifact.
    for o in added:
        o["gq_gear"] = name
    gear = max(added, key=lambda o: len(o.data.polygons))
    for o in added:
        if o is not gear:
            bpy.data.objects.remove(o, do_unlink=True)

    local_pts = [Vector(c) for c in gear.bound_box]
    natural = max(max(p[a] for p in local_pts) - min(p[a] for p in local_pts) for a in range(3))
    centre_local = sum(local_pts, Vector()) / 8

    bone = arm.data.bones[item["bone"]]
    bone_world = arm.matrix_world @ bone.matrix_local
    bone_scale = bone_world.to_scale()[0]

    # World size wanted / natural size / whatever scale the bone already imposes.
    want = item["worldHeight"]
    local_scale = want / natural / bone_scale
    print(f"\n{name}: natural {natural:.4f}, want {want:.4f} world, bone scale {bone_scale:.5f}")
    print(f"  -> bone-local scale {local_scale:.4f}")

    # NO PARENTING. Two earlier attempts went wrong here in opposite directions: writing a
    # world-space offset into Blender's bone-parent slot put the sword at x = -18 (that space is
    # anchored at the bone TAIL, and this rig's tails are importer-synthesized garbage running to
    # 1,233 units), and then assigning matrix_world on a bone-parented object produced a mesh 100x
    # too big. This renders the REST pose, so the parent buys nothing; the world matrix is composed
    # directly and the bone-relative numbers three.js needs are derived from it afterwards.
    world_scale = want / natural
    # Optional per-axis stretch, applied on top of the uniform fit. A generated prop carries the
    # proportions of its reference image, and those are not obliged to match the body. The helmet
    # came back 0.69 tall per unit width while the hero's skull above its widest band is only 0.50
    # -- fitted by width it towers, fitted by height it is too narrow to clear the ears. Squashing
    # one axis of a faceted prop is invisible at 90px and is the cheapest of the three fixes; the
    # others were regenerating the reference (15 credits, no guarantee) or accepting a chef's hat.
    stretch = item.get("stretch", [1, 1, 1])
    scale = Matrix.Diagonal((world_scale * stretch[0], world_scale * stretch[1],
                             world_scale * stretch[2], 1.0))
    rot = Matrix.Identity(4)
    for axis, deg in zip("XYZ", item.get("rotationEuler", [0, 0, 0])):
        rot = rot @ Matrix.Rotation(math.radians(deg), 4, axis)
    # WHERE TO ANCHOR. The bone HEAD is the joint, and for a hand that joint is the WRIST -- so
    # anchoring gear there hangs it off the wrist and leaves the palm empty. the owner caught this from a
    # render: the Tier 3 sword's broad crossguard lay across the forearm and the grip never reached
    # the hand. Measured, the right hand's mesh spans x -0.674..-0.479 while the bone head sits at
    # -0.489, so every hand-held item was ~0.085 too far inboard. It was wrong for the Tier 2 shield
    # too and simply less visible on a disc than on a crossguard.
    #
    # "grip" anchors at the centre of the mesh actually weighted to the bone, which for a hand is
    # the palm. That is measured per rig rather than hand-tuned per item, so it cannot drift.
    if item.get("anchor", "joint") == "grip":
        names = {g.index: g.name for g in hero_mesh.vertex_groups}
        owned = [hero_mesh.matrix_world @ v.co for v in hero_mesh.data.vertices
                 if sum(g.weight for g in v.groups if names.get(g.group) == item["bone"]) >= 0.5]
        if not owned:
            raise SystemExit(f"ABORT: no vertices weighted to {item['bone']!r}, cannot anchor to grip")
        anchor_point = Vector((
            (min(p.x for p in owned) + max(p.x for p in owned)) / 2,
            (min(p.y for p in owned) + max(p.y for p in owned)) / 2,
            (min(p.z for p in owned) + max(p.z for p in owned)) / 2,
        ))
        joint = arm.matrix_world @ bone.head_local
        print(f"  anchor: grip (mesh centre of {len(owned)} verts) {tuple(round(v, 4) for v in anchor_point)}")
        print(f"          vs the {item['bone']} joint at {tuple(round(v, 4) for v in joint)} "
              f"-- moved {(anchor_point - joint).length:.4f}")
    else:
        anchor_point = arm.matrix_world @ bone.head_local
    # Recentring on the anchor first means `offset` moves the item from a known origin rather than
    # from wherever the generator happened to leave its pivot.
    anchor = Matrix.Translation(anchor_point + Vector(item.get("offset", [0, 0, 0])))
    gear.matrix_world = anchor @ rot @ scale @ Matrix.Translation(-centre_local)
    bpy.context.view_layer.update()

    # Measure what actually happened, rather than trusting the arithmetic above.
    world_pts = [gear.matrix_world @ Vector(c) for c in gear.bound_box]
    achieved = max(max(p[a] for p in world_pts) - min(p[a] for p in world_pts) for a in range(3))
    lo = Vector((min(p[a] for p in world_pts) for a in range(3)))
    hi = Vector((max(p[a] for p in world_pts) for a in range(3)))
    if stretch == [1, 1, 1]:
        print(f"  achieved world size {achieved:.4f} (wanted {want:.4f}, error {achieved - want:+.4f})")
    else:
        # With a stretch the largest axis need not be the one `want` described, so comparing the two
        # is meaningless. Report the box instead and let the bounds below be the check.
        print(f"  achieved world size {achieved:.4f}, stretch {stretch} applied (so `want` "
              f"{want:.4f} describes the pre-stretch fit only)")
    print(f"  world bounds x {lo.x:.3f}..{hi.x:.3f}  y {lo.y:.3f}..{hi.y:.3f}  z {lo.z:.3f}..{hi.z:.3f}")
    print(f"  as a fraction of hero height: {achieved / hero_height:.3f}")

    # Does the thing actually touch the hand? the owner caught by eye that the sword "pokes through his
    # arm and doesn't even reach his hand", and nothing in this tool would have noticed: every
    # number above was correct for gear hanging off the wrist. A held item must overlap the mesh of
    # the bone holding it, so that is now measured rather than left to whoever looks at the render.
    if item.get("anchor") == "grip":
        names = {g.index: g.name for g in hero_mesh.vertex_groups}
        owned = [hero_mesh.matrix_world @ v.co for v in hero_mesh.data.vertices
                 if sum(g.weight for g in v.groups if names.get(g.group) == item["bone"]) >= 0.5]
        hlo = Vector((min(p[a] for p in owned) for a in range(3)))
        hhi = Vector((max(p[a] for p in owned) for a in range(3)))
        overlap = [max(0.0, min(hi[a], hhi[a]) - max(lo[a], hlo[a])) for a in range(3)]
        hand_span = [hhi[a] - hlo[a] for a in range(3)]
        frac = min(overlap[a] / hand_span[a] if hand_span[a] > 1e-9 else 1.0 for a in range(3))
        print(f"  grip overlap with the {item['bone']} mesh: "
              f"{tuple(round(o, 4) for o in overlap)} ({frac * 100:.0f}% of the hand's smallest span)")
        if frac <= 0.0:
            print(f"  WARNING: {name} does not intersect the hand mesh at all -- it is being held by")
            print("  nobody. The bone HEAD is the wrist joint, not the palm; use anchor 'grip'.")
    # DO NOT paste the Blender bone-local numbers into three.js. Blender is Z-up and re-derives its
    # own bone axes on import; glTF is Y-up and three.js sees the original joint nodes. The two
    # disagree, and a transform that looks right here would be silently wrong there.
    #
    # What IS safe to hand over is the gear's rest transform relative to the HERO ROOT, converted
    # into glTF axes by the importer's own mapping, Blender (x, y, z) -> glTF (x, z, -y). The
    # runtime then solves for its own bone-local matrix using three.js's bone matrices:
    #
    #   const world = new THREE.Matrix4().multiplyMatrices(heroRoot.matrixWorld, restRelativeToRoot);
    #   const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(world);
    #   local.decompose(anchor.position, anchor.quaternion, anchor.scale);
    #   bone.add(anchor);
    B2G = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    rest_relative_to_root = arm.matrix_world.inverted() @ gear.matrix_world
    gltf_matrix = B2G @ rest_relative_to_root @ B2G.inverted()
    g_pos, g_quat, g_scale = gltf_matrix.decompose()
    print(f"  glTF-space rest, relative to hero root:")
    print(f"    position   {tuple(round(v, 5) for v in g_pos)}")
    print(f"    quat xyzw  {(round(g_quat.x, 5), round(g_quat.y, 5), round(g_quat.z, 5), round(g_quat.w, 5))}")
    print(f"    scale      {tuple(round(v, 5) for v in g_scale)}")

    # Kept for inspection only, clearly labelled, so nobody mistakes it for the runtime value.
    bone_local = bone_world.inverted() @ gear.matrix_world
    bl_pos, bl_quat, bl_scale = bone_local.decompose()
    print(f"  bone-local position {tuple(round(v, 4) for v in bl_pos)}")
    print(f"  bone-local quaternion (xyzw) {(round(bl_quat.x,5), round(bl_quat.y,5), round(bl_quat.z,5), round(bl_quat.w,5))}")
    print(f"  bone-local scale {tuple(round(v, 4) for v in bl_scale)}")
    results.append({
        "restRelativeToHeroRoot_gltfAxes": {
            "position": list(g_pos),
            "quaternionXYZW": [g_quat.x, g_quat.y, g_quat.z, g_quat.w],
            "scale": list(g_scale),
        },
        "blenderBoneLocal_INSPECTION_ONLY": {
            "position": list(bl_pos),
            "quaternionXYZW": [bl_quat.x, bl_quat.y, bl_quat.z, bl_quat.w],
            "scale": list(bl_scale),
        },
        "name": name, "bone": item["bone"], "naturalSize": natural,
        "wantedWorldSize": want, "achievedWorldSize": achieved,
        "boneWorldScale": bone_scale, "boneLocalScale": local_scale,
        "rotationEuler": item.get("rotationEuler", [0, 0, 0]),
        "offset": item.get("offset", [0, 0, 0]),
        "stretch": stretch,
        "worldBounds": {"min": list(lo), "max": list(hi)},
    })

# ── render ────────────────────────────────────────────────────────────────────────────────────
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in {
    i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
} else "BLENDER_EEVEE_NEXT"
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.82, 0.82, 0.82, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 1.15
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = hero_height * 1.25
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
for angle, energy in ((math.radians(40), 2.6), (math.radians(-60), 1.1)):
    light = bpy.data.objects.new("l", bpy.data.lights.new("l", type="SUN"))
    light.data.energy = energy
    light.rotation_euler = (math.radians(58), 0, angle)
    scene.collection.objects.link(light)

centre = Vector((0, 0, hero_height / 2))
dist = hero_height * 3


def shoot(name, yaw_deg, px):
    yaw = math.radians(yaw_deg)
    cam.location = (centre.x + dist * math.sin(yaw), centre.y - dist * math.cos(yaw), centre.z)
    cam.rotation_euler = (math.radians(90), 0, yaw)
    scene.render.resolution_x = scene.render.resolution_y = px
    path = os.path.join(OUT, f"{name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    assert os.path.exists(path), f"render wrote nothing to {path}"


for label, yaw in (("front", 0), ("threequarter", 35), ("side", 90), ("back", 180)):
    shoot(label, yaw, 640)
shoot("gameplay_90", 0, 90)
shoot("gameplay_90_tq", 35, 90)
print(f"\nrendered to {OUT}")

with open(os.path.join(OUT, "fit_measured.json"), "w", encoding="utf8") as f:
    json.dump({"heroHeight": hero_height, "items": results}, f, indent=2)
print("wrote fit_measured.json")
