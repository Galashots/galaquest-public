"""Author a candidate-only rig and native clips for the approved T2 gremlin body.

Blender --background --factory-startup --python tools/blender/author_gremlin_rig.py --
  <source.glb> <output-directory> [--render] [--landmark-weights]

The source is immutable. Only a uniform metre conversion and ground translation are
applied to this derivative; no remesh, body sculpt, topology or material changes.
This is a new enemy candidate family, not a change to the hero contract. Automatic
weights, diagnostic renders and exported clips are evidence, not asset acceptance.
"""

import hashlib
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector


args = sys.argv[sys.argv.index("--") + 1:]
SOURCE, OUT = (os.path.abspath(path) for path in args[:2])
RENDER = "--render" in args[2:]
LANDMARK_WEIGHTS = "--landmark-weights" in args[2:]
SOURCE_SHA = "80dec302e5ca094d52d528a3116485e83f88b7aba9866b2f5633a89cceeb015b"
assert hashlib.sha256(open(SOURCE, "rb").read()).hexdigest() == SOURCE_SHA, "Unexpected source body"
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
assert len(meshes) == 1 and not any(obj.type == "ARMATURE" for obj in bpy.context.scene.objects)
mesh = meshes[0]
mesh.name = "LavaGremlinBody"
source_vertices = [tuple(mesh.matrix_world @ vertex.co) for vertex in mesh.data.vertices]
source_faces = [tuple(face.vertices) for face in mesh.data.polygons]
floor = min(point[2] for point in source_vertices)
scale = 1.1 / (max(point[2] for point in source_vertices) - floor)
mesh.matrix_world = Matrix.Identity(4)
for vertex, point in zip(mesh.data.vertices, source_vertices):
    vertex.co = (point[0] * scale, point[1] * scale, (point[2] - floor) * scale)
normalized_vertices = [tuple(vertex.co) for vertex in mesh.data.vertices]

rig_data = bpy.data.armatures.new("GQ_LAVA_GREMLIN_CANDIDATE_V1")
rig = bpy.data.objects.new("LavaGremlinRig", rig_data)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")


def bone(name, head, tail, parent=None, deform=True, roll=(0, -1, 0)):
    item = rig_data.edit_bones.new(name)
    item.head, item.tail, item.use_deform = head, tail, deform
    item.align_roll(Vector(roll))
    if parent:
        item.parent = rig_data.edit_bones[parent]
    return item


bone("Root", (0, 0, 0), (0, 0, .12), deform=False)
bone("Hips", (0, .015, .305), (0, .015, .405), "Root")
bone("Spine", (0, .015, .405), (0, .01, .515), "Hips")
bone("Spine01", (0, .01, .515), (0, .0, .635), "Spine")
bone("Neck", (0, .0, .635), (0, .0, .705), "Spine01")
bone("Head", (0, .0, .705), (0, .0, 1.035), "Neck")
# Non-deforming face-direction marker lets the existing anatomy tool independently
# compare the authored facing with the toes. It carries no skin weights.
bone("headfront", (0, -.15, .705), (0, -.20, .705), "Head", deform=False, roll=(0, 0, 1))
for side, sign in (("Left", 1), ("Right", -1)):
    bone(side + "Shoulder", (sign * .075, .0, .622), (sign * .22, .0, .622), "Spine01", roll=(0, 0, 1))
    bone(side + "Arm", (sign * .22, .0, .622), (sign * .43, .0, .622), side + "Shoulder", roll=(0, 0, 1))
    bone(side + "ForeArm", (sign * .43, .0, .622), (sign * .615, .0, .622), side + "Arm", roll=(0, 0, 1))
    bone(side + "Hand", (sign * .615, .0, .622), (sign * .708, -.015, .622), side + "ForeArm", roll=(0, 0, 1))
    bone(side + "UpLeg", (sign * .13, .015, .305), (sign * .13, -.015, .17), "Hips")
    bone(side + "Leg", (sign * .13, -.015, .17), (sign * .13, .015, .065), side + "UpLeg")
    bone(side + "Foot", (sign * .13, .015, .065), (sign * .13, -.115, .035), side + "Leg", roll=(0, 0, 1))
    bone(side + "ToeBase", (sign * .13, -.115, .035), (sign * .13, -.16, .035), side + "Foot", roll=(0, 0, 1))
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
print("WEIGHTING", "authored landmark weights" if LANDMARK_WEIGHTS else "automatic heat weights", flush=True)
bpy.ops.object.parent_set(type="ARMATURE_NAME" if LANDMARK_WEIGHTS else "ARMATURE_AUTO")


def ramp(value, start, end):
    t = min(1, max(0, (value - start) / (end - start)))
    return t * t * (3 - 2 * t)


def blend(a, b, factor):
    return {name: a.get(name, 0) * (1 - factor) + b.get(name, 0) * factor for name in a.keys() | b.keys()}


def chain_weights(value, names, transitions):
    weights = {names[0]: 1}
    for name, (start, end) in zip(names[1:], transitions):
        weights = blend(weights, {name: 1}, ramp(value, start, end))
    return weights


if LANDMARK_WEIGHTS:
    # Explicit alternative after this body's heat solve failed completely. These
    # are authored joint cross-sections for this SHA, not a generic auto-rigger.
    # Torso/arm/leg masks overlap smoothly; the stone head is rigid above the neck.
    for vertex in mesh.data.vertices:
        x, y, z = vertex.co
        side = "Left" if x >= 0 else "Right"
        torso = chain_weights(z, ["Hips", "Spine", "Spine01", "Neck", "Head"],
                              [(.36, .45), (.48, .56), (.63, .675), (.675, .715)])
        arm = chain_weights(abs(x), [side + "Shoulder", side + "Arm", side + "ForeArm", side + "Hand"],
                            [(.195, .27), (.385, .47), (.59, .65)])
        arm_mask = ramp(abs(x), .20, .29) * ramp(z, .49, .55) * (1 - ramp(z, .68, .73))
        weights = blend(torso, arm, arm_mask)
        leg = chain_weights(-z, [side + "UpLeg", side + "Leg", side + "Foot"],
                            [(-.205, -.135), (-.105, -.065)])
        # Toe weight follows the foot's forward axis, not its vertical height.
        leg = blend(leg, {side + "ToeBase": 1}, (1 - ramp(z, .05, .09)) * (1 - ramp(y, -.155, -.105)))
        leg_mask = (1 - ramp(z, .24, .31)) * ramp(abs(x), .035, .08)
        weights = blend(weights, leg, leg_mask)
        for name, weight in weights.items():
            if weight > 1e-6:
                mesh.vertex_groups[name].add([vertex.index], weight, "REPLACE")

# Reject heat-weight failures instead of silently fabricating a successful rig.
unweighted = [v.index for v in mesh.data.vertices if not any(g.weight > 1e-6 for g in v.groups)]
assert not unweighted, f"Automatic weighting left {len(unweighted)} unweighted vertices"
for vertex in mesh.data.vertices:
    groups = sorted(((item.group, item.weight) for item in vertex.groups if item.weight > 1e-6), key=lambda pair: pair[1], reverse=True)
    for group_id, _ in groups:
        mesh.vertex_groups[group_id].remove([vertex.index])
    top = groups[:4]
    total = sum(weight for _, weight in top)
    for group_id, weight in top:
        mesh.vertex_groups[group_id].add([vertex.index], weight / total, "REPLACE")
assert [tuple(v.co) for v in mesh.data.vertices] == normalized_vertices
assert [tuple(face.vertices) for face in mesh.data.polygons] == source_faces
print("WEIGHTED", len(mesh.data.vertices), "vertices", flush=True)

scene = bpy.context.scene
scene.render.fps = 50
rig.animation_data_create()
rest_matrices = {b.name: b.matrix_local.copy() for b in rig_data.bones}


def reset():
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.matrix_basis = Matrix.Identity(4)


def rotate(name, x=0, y=0, z=0):
    from mathutils import Euler
    rig.pose.bones[name].rotation_quaternion = Euler(tuple(math.radians(value) for value in (x, y, z)), "XYZ").to_quaternion()


def ready():
    reset()
    for side in ("Left", "Right"):
        rotate(side + "Arm", x=-66)
        rotate(side + "ForeArm", z=-12 if side == "Left" else 12)


def point_bone(name, head, tail):
    """Set a world-space segment while retaining the rest roll, then bake local TRS."""
    pb = rig.pose.bones[name]
    rest = rest_matrices[name]
    direction = (tail - head).normalized()
    rest_direction = rest.to_3x3() @ Vector((0, 1, 0))
    rotation = rest_direction.rotation_difference(direction) @ rest.to_quaternion()
    pb.matrix = Matrix.LocRotScale(head, rotation, Vector((1, 1, 1)))
    bpy.context.view_layer.update()


def plant_leg(side, ankle, foot_pitch=0):
    """Analytic two-segment IK: visible knee bends forward; foot stays level in stance."""
    upper = rig.pose.bones[side + "UpLeg"]
    hip = upper.head.copy()
    a = rig_data.bones[side + "UpLeg"].length
    b = rig_data.bones[side + "Leg"].length
    delta = ankle - hip
    distance = delta.length
    assert abs(a - b) < distance < a + b, f"Unreachable {side} ankle {distance} / {a + b}"
    along = delta.normalized()
    forward = Vector((0, -1, 0))
    bend = (forward - along * forward.dot(along)).normalized()
    projection = (a * a - b * b + distance * distance) / (2 * distance)
    knee = hip + along * projection + bend * math.sqrt(max(0, a * a - projection * projection))
    point_bone(side + "UpLeg", hip, knee)
    point_bone(side + "Leg", knee, ankle)
    rest = rest_matrices[side + "Foot"]
    rotation = Quaternion(Vector((1, 0, 0)), math.radians(foot_pitch)) @ rest.to_quaternion()
    rig.pose.bones[side + "Foot"].matrix = Matrix.LocRotScale(ankle, rotation, Vector((1, 1, 1)))
    bpy.context.view_layer.update()


def action(name, end, pose):
    clip = bpy.data.actions.new(name)
    clip.use_fake_user = True
    rig.animation_data.action = clip
    rig.animation_data.action_slot = clip.slots.new(id_type="OBJECT", name=rig.name)
    for frame in range(1, end + 1):
        scene.frame_set(frame)
        ready()
        pose((frame - 1) / (end - 1))
        bpy.context.view_layer.update()
        for pb in rig.pose.bones:
            pb.keyframe_insert("location", frame=frame)
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            pb.keyframe_insert("scale", frame=frame)
    # Baked sampling must not overshoot contact keys between export frames.
    for layer in clip.layers:
        for strip in layer.strips:
            for slot in clip.slots:
                bag = strip.channelbag(slot)
                if bag:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:
                            key.interpolation = "LINEAR"
    print("AUTHORED", name, (end - 1) / scene.render.fps, "seconds", flush=True)
    return clip


def idle(t):
    breathe = math.sin(t * math.tau)
    rotate("Spine", x=2 + breathe)
    rotate("Head", z=breathe * 2)
    for side in ("Left", "Right"):
        rotate(side + "Arm", x=-66 + breathe * 2)


def walk(t):
    # 0.44-second in-place scuttle. Each stance travels exactly speed * stanceTime;
    # the host supplies 1.1 m/s translation. No keyframe ever moves the rig root.
    duration, speed, duty = .44, 1.1, .54
    half_travel = duration * speed * duty / 2
    bob = .005 * (1 - math.cos(t * math.tau * 2))
    rig.pose.bones["Hips"].location = (0, 0, 0)
    # Hips local Y is body-up, not Blender world Y.
    rig.pose.bones["Hips"].location.y = -.045 + bob
    rotate("Spine", x=5)
    rotate("Spine01", z=3 * math.sin(t * math.tau))
    bpy.context.view_layer.update()
    for side, offset in (("Left", 0), ("Right", .5)):
        phase = (t + offset) % 1
        if phase < duty:
            u = phase / duty
            y, lift = -half_travel + 2 * half_travel * u, 0
        else:
            u = (phase - duty) / (1 - duty)
            y = half_travel * math.cos(math.pi * u)
            lift = .05 * math.sin(math.pi * u)
        sign = 1 if side == "Left" else -1
        plant_leg(side, Vector((sign * .13, .015 + y, .065 + lift)))
        swing = math.sin((t + offset) * math.tau)
        rotate(side + "Arm", x=-65, z=sign * (swing * 20 - 10))
        rotate(side + "ForeArm", z=-sign * 12)


def smooth_keys(t, keys):
    for index in range(1, len(keys)):
        if t <= keys[index][0]:
            a, b = keys[index - 1], keys[index]
            u = (t - a[0]) / (b[0] - a[0])
            u = u * u * (3 - 2 * u)
            return a[1] + (b[1] - a[1]) * u
    return keys[-1][1]


def bash(t):
    # Wind up 0-.45s, strike .45-.63s, recover through 1.05s. Host timing owns damage.
    lean = smooth_keys(t, [(0, 2), (.43, -19), (.60, 27), (.73, 15), (1, 2)])
    crouch = smooth_keys(t, [(0, 0), (.43, -.045), (.60, -.015), (1, 0)])
    rig.pose.bones["Hips"].location.y = crouch
    rotate("Spine", x=lean)
    rotate("Head", x=-lean * .3)
    for side in ("Left", "Right"):
        rotate(side + "Arm", x=-66 + max(0, -lean) * 1.4)
    bpy.context.view_layer.update()
    # A small persistent bend makes the two-segment solution well-defined at rest.
    for side, sign in (("Left", 1), ("Right", -1)):
        plant_leg(side, Vector((sign * .13, .015, .065)))


def hit(t):
    recoil = smooth_keys(t, [(0, 0), (.22, -15), (.5, 7), (1, 0)])
    rotate("Spine", x=recoil)
    rotate("Head", x=recoil * .25)


def death(t):
    fall = smooth_keys(t, [(0, 0), (.2, 8), (.68, -83), (.82, -75), (1, -83)])
    rotate("Hips", x=fall)
    rig.pose.bones["Hips"].location.y = -.13 * min(t / .68, 1)
    rotate("Head", x=10 * t)
    for side in ("Left", "Right"):
        rotate(side + "Arm", x=-66 + 50 * math.sin(t * math.pi))
    bpy.context.view_layer.update()
    # Collision with the diagnostic floor only; never scale or distort the body.
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    bottom = min((evaluated.matrix_world @ vertex.co).z for vertex in evaluated.data.vertices)
    if bottom < 0:
        rig.pose.bones["Root"].location.y -= bottom


clips = {
    "idle": action("idle", 101, idle),
    "walk": action("walk", 23, walk),
    "bash": action("bash", 54, bash),
    "hit": action("hit", 21, hit),
    "death": action("death", 61, death),
}
rig.animation_data.action = None
reset()
scene.frame_set(1)
bpy.context.view_layer.update()
mesh.data.calc_loop_triangles()
report = {
    "status": "CANDIDATE_REQUIRES_DEFORMATION_AND_UNITY_REVIEW",
    "sourceSha256": SOURCE_SHA,
    "sourceGeometryPreserved": True,
    "normalization": {"heightMeters": 1.1, "uniformScale": scale, "sourceFloorZ": floor},
    "vertices": len(mesh.data.vertices), "triangles": len(mesh.data.loop_triangles),
    "bones": [{"name": b.name, "parent": b.parent.name if b.parent else None,
               "deform": b.use_deform, "head": list(b.head_local), "tail": list(b.tail_local)} for b in rig_data.bones],
    "weights": {"method": ("Authored joint cross-sections after heat solve failed" if LANDMARK_WEIGHTS else "Blender heat weights") + "; largest four normalized", "unweighted": len(unweighted),
                "maxInfluences": max(len(v.groups) for v in mesh.data.vertices),
                "maxSumError": max(abs(1 - sum(g.weight for g in v.groups)) for v in mesh.data.vertices)},
    "clips": {name: {"durationSeconds": (clip.frame_range[1] - clip.frame_range[0]) / 50} for name, clip in clips.items()},
}
assert report["weights"]["maxInfluences"] <= 4
with open(os.path.join(OUT, "authoring-report.json"), "w") as handle:
    json.dump(report, handle, indent=2)
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "lava-gremlin-local-v1-bind.glb"), export_format="GLB",
                          use_selection=True, export_animations=False)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "lava-gremlin-local-v1.glb"), export_format="GLB",
                          use_selection=True, export_animations=True, export_animation_mode="ACTIONS",
                          export_bake_animation=True)
bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, "lava-gremlin-local-v1.fbx"), use_selection=True,
                         object_types={"MESH", "ARMATURE"}, axis_forward="-Z", axis_up="Y",
                         add_leaf_bones=False, bake_anim=True, bake_anim_use_all_actions=True,
                         bake_anim_use_nla_strips=False, bake_anim_simplify_factor=0,
                         path_mode="COPY", embed_textures=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "lava-gremlin-local-v1.blend"))
print("EXPORTED candidate GLB, FBX and working blend", flush=True)

if RENDER:
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.world = bpy.data.worlds.new("DiagnosticWorld")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.8, .8, .8, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .8
    key = bpy.data.objects.new("DiagnosticKey", bpy.data.lights.new("DiagnosticKey", type="SUN"))
    scene.collection.objects.link(key)
    key.data.energy = 2
    key.rotation_euler = (math.radians(35), math.radians(-20), math.radians(-25))
    camera = bpy.data.objects.new("DiagnosticCamera", bpy.data.cameras.new("DiagnosticCamera"))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 1.48
    for name, frame, yaw in (("idle", 1, 0), ("idle", 1, 60), ("walk", 1, 35), ("walk", 7, 90),
                             ("bash", 24, 35), ("bash", 33, 90), ("death", 61, 35)):
        clip = clips[name]
        rig.animation_data.action = clip
        rig.animation_data.action_slot = clip.slots[0]
        scene.frame_set(frame)
        angle = math.radians(yaw)
        camera.location = (3 * math.sin(angle), -3 * math.cos(angle), .9)
        camera.rotation_euler = (Vector((0, 0, .52)) - camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(OUT, f"{name}-{frame:02d}-{yaw}.png")
        bpy.ops.render.render(write_still=True)
        assert os.path.isfile(scene.render.filepath)
    print("RENDERED deformation beats", flush=True)
