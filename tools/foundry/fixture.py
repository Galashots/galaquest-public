"""Two clean test articles, and one deliberate mutation per gate.

Neither fixture is a hero. They are the smallest shapes that can establish a clean baseline for each
gate, and they are built by script rather than committed as `.blend` files, because a committed
binary is opaque — "the gates pass on our fixture" is unverifiable if nobody can see the fixture.
This file is the fixture.

**Two of them, on purpose.** The torus alone was too kind. A torus is the one closed all-quad
surface with no poles anywhere, which is what makes it a clean G9/G10 baseline — but because it has
no poles and no triangles, it could not reveal that an earlier G9 was *unsatisfiable* on any real
head. So there is a second article that deliberately has both:

- `torus` — closed, all quads, no poles, one blended ring declared as a joint loop.
- `arm_segment` — a capped cylinder along X. Two poles at the cap centres, 32 triangles in the cap
  fans, and an elbow. It proves the gates can PASS on geometry with the features a real mesh has.

Each mutator breaks exactly one thing. Some mutations necessarily trip more than one gate: on a quad
mesh you cannot add a pole without also adding a triangle or an n-gon, because the face count has to
go somewhere. The proof asserts the *target* gate flips and records the collateral rather than
pretending mutations are surgical.
"""

import math
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Vector

ATLAS_PX = 1024

# Weight split at a declared joint loop. Two influences summing to 1.0 — enough to make the loop
# read as blended, which is what G8 verifies.
JOINT_SPLIT = 0.5


# ── the torus article ─────────────────────────────────────────────────────────────────────────────

TORUS_MESH = "HeroRegion"
TORUS_ARMATURE = "HeroArmature"
MAJOR_SEGMENTS = 24
MINOR_SEGMENTS = 12
TORUS_ARCS = 6

# (name, head, tail, parent, deform)
TORUS_BONES = [
    ("Root", (0.0, 0.0, 0.0), (0.0, 0.0, 0.10), None, False),
    ("DEF_Spine", (0.0, 0.0, 0.10), (0.0, 0.0, 0.50), "Root", True),
    ("DEF_Neck", (0.0, 0.0, 0.50), (0.0, 0.0, 0.60), "DEF_Spine", True),
    ("DEF_Head", (0.0, 0.0, 0.60), (0.0, 0.0, 0.80), "DEF_Neck", True),
    ("DEF_Clavicle_L", (0.0, 0.0, 0.50), (0.10, 0.0, 0.50), "DEF_Spine", True),
    # Roughly along world X, so the T-pose heuristic (G11) has something true to find.
    ("DEF_UpperArm_L", (0.10, 0.0, 0.50), (0.40, 0.0, 0.50), "DEF_Clavicle_L", True),
    ("DEF_UpperArm_R", (-0.10, 0.0, 0.50), (-0.40, 0.0, 0.50), "DEF_Spine", True),
]
TORUS_DEFORM = [name for name, _, _, _, deform in TORUS_BONES if deform]


def build_torus():
    """Closed, all quads, no poles. Returns (mesh_obj, armature_obj, manifest)."""
    reset_scene()

    bpy.ops.mesh.primitive_torus_add(
        align="WORLD",
        location=(0.0, 0.0, 0.0),
        rotation=(0.0, 0.0, 0.0),
        major_segments=MAJOR_SEGMENTS,
        minor_segments=MINOR_SEGMENTS,
        major_radius=1.0,
        minor_radius=0.25,
        generate_uvs=True,
    )
    mesh_obj = bpy.context.view_layer.objects.active
    mesh_obj.name = TORUS_MESH
    mesh_obj.data.name = TORUS_MESH

    armature_obj = _build_armature(TORUS_ARMATURE, TORUS_BONES)
    loop = _weight_torus_arcs(mesh_obj)
    _build_material(mesh_obj)
    _bind(mesh_obj, armature_obj)

    manifest = {
        "formatVersion": 1,
        "authority": "tools/foundry/fixture.py build_torus() — a test article, not a hero",
        "loops": {"TorusJoint": sorted(loop)},
        "documentedStaticTriangles": {},
        "regions": {name: [] for name in TORUS_DEFORM},
        "components": ["Body"] * len(mesh_obj.data.vertices),
    }
    return mesh_obj, armature_obj, manifest


def _weight_torus_arcs(mesh_obj):
    """One influence per vertex by major-angle arc, with the first arc boundary blended 50/50.

    The blended ring is a closed minor ring of the torus, so it is a genuine closed cycle at a place
    where the weights actually blend — which is exactly what G8 checks a declaration for.
    """
    groups = [mesh_obj.vertex_groups.new(name=name) for name in TORUS_DEFORM]
    step = 2.0 * math.pi / TORUS_ARCS
    boundary = step  # between arc 0 and arc 1
    tol = (2.0 * math.pi / MAJOR_SEGMENTS) * 0.25

    buckets = [[] for _ in groups]
    loop = []
    for v in mesh_obj.data.vertices:
        angle = math.atan2(v.co.y, v.co.x) % (2.0 * math.pi)
        if abs(angle - boundary) < tol:
            loop.append(v.index)
        else:
            buckets[min(int(angle / step), len(groups) - 1)].append(v.index)

    for group, verts in zip(groups, buckets):
        if verts:
            group.add(verts, 1.0, "REPLACE")
    if len(loop) != MINOR_SEGMENTS:
        raise RuntimeError(f"fixture is broken: joint ring has {len(loop)} verts, expected {MINOR_SEGMENTS}")
    groups[0].add(loop, JOINT_SPLIT, "REPLACE")
    groups[1].add(loop, JOINT_SPLIT, "REPLACE")

    empty = [g.name for g, verts in zip(groups, buckets) if not verts]
    if empty:
        raise RuntimeError(f"fixture is broken: vertex groups {empty} came out empty")
    return loop


# ── the arm-segment article ───────────────────────────────────────────────────────────────────────

ARM_MESH = "ArmSegment"
ARM_ARMATURE = "ArmArmature"
ARM_SIDES = 16
ARM_RINGS = 5  # interior rings created by subdividing the side edges

ARM_BONES = [
    ("Root", (0.0, 0.0, 0.0), (0.0, 0.0, 0.10), None, False),
    ("DEF_UpperArm_L", (-0.60, 0.0, 0.0), (0.0, 0.0, 0.0), "Root", True),
    # "fore" in the name keeps G11 from judging this one; only the upper arm defines the T-pose.
    ("DEF_Forearm_L", (0.0, 0.0, 0.0), (0.60, 0.0, 0.0), "DEF_UpperArm_L", True),
]
ARM_DEFORM = [name for name, _, _, _, deform in ARM_BONES if deform]


def build_arm_segment():
    """A capped cylinder with poles, triangles and an elbow. Returns (mesh_obj, armature_obj, manifest).

    This is the article that matters. It has the two features a real mesh cannot avoid — poles where
    a surface closes, and triangles in a rigid fan — and it must still pass every gate. An earlier
    G9 and G10 passed the torus and would have failed this, and that is the bug the second fixture
    exists to catch.
    """
    reset_scene()

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=ARM_SIDES,
        radius=0.16,
        depth=1.2,
        end_fill_type="TRIFAN",
        align="WORLD",
        location=(0.0, 0.0, 0.0),
        rotation=(0.0, math.pi / 2.0, 0.0),  # lay it along X
    )
    mesh_obj = bpy.context.view_layer.objects.active
    mesh_obj.name = ARM_MESH
    mesh_obj.data.name = ARM_MESH
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    _subdivide_along_x(mesh_obj)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.mesh.uv_texture_add()

    armature_obj = _build_armature(ARM_ARMATURE, ARM_BONES)
    loop = _weight_arm_segment(mesh_obj)
    _build_material(mesh_obj)
    _bind(mesh_obj, armature_obj)

    manifest = {
        "formatVersion": 1,
        "authority": "tools/foundry/fixture.py build_arm_segment() — a test article, not a hero",
        "loops": {"Elbow_L": sorted(loop)},
        "documentedStaticTriangles": {
            "CapFans": f"{ARM_SIDES * 2} triangles close the two rigid end caps. Every one of their "
            "vertices is weighted 1.0 to a single bone, so no triangle ever deforms.",
        },
        "regions": {name: [] for name in ARM_DEFORM},
        "components": ["Body"] * len(mesh_obj.data.vertices),
    }
    return mesh_obj, armature_obj, manifest


def _subdivide_along_x(mesh_obj):
    """Cut rings across the tube so there is somewhere for an elbow to be."""
    with edit_mesh(mesh_obj) as bm:
        lengthwise = [
            e for e in bm.edges
            if len(e.link_faces) == 2
            and all(len(f.verts) == 4 for f in e.link_faces)
            and abs(e.verts[0].co.x - e.verts[1].co.x) > 1e-4
        ]
        if not lengthwise:
            raise RuntimeError("fixture is broken: found no lengthwise quad edges to subdivide")
        bmesh.ops.subdivide_edges(bm, edges=lengthwise, cuts=ARM_RINGS, use_grid_fill=True)


def _weight_arm_segment(mesh_obj):
    """Rigid on each side of the elbow, blended on the middle ring only.

    The cap fans and their triangles are weighted 1.0 to one bone, which is what makes them provably
    static rather than merely asserted to be.
    """
    groups = {name: mesh_obj.vertex_groups.new(name=name) for name in ARM_DEFORM}
    xs = sorted({round(v.co.x, 5) for v in mesh_obj.data.vertices})
    middle = xs[len(xs) // 2]

    loop, lower, upper = [], [], []
    for v in mesh_obj.data.vertices:
        if abs(v.co.x - middle) < 1e-4:
            loop.append(v.index)
        elif v.co.x < middle:
            lower.append(v.index)
        else:
            upper.append(v.index)

    groups["DEF_UpperArm_L"].add(lower, 1.0, "REPLACE")
    groups["DEF_Forearm_L"].add(upper, 1.0, "REPLACE")
    groups["DEF_UpperArm_L"].add(loop, JOINT_SPLIT, "REPLACE")
    groups["DEF_Forearm_L"].add(loop, JOINT_SPLIT, "REPLACE")

    if len(loop) != ARM_SIDES:
        raise RuntimeError(f"fixture is broken: elbow ring has {len(loop)} verts, expected {ARM_SIDES}")
    if not lower or not upper:
        raise RuntimeError("fixture is broken: the elbow ring is not between two rigid halves")
    return loop


FIXTURES = {
    "torus": (build_torus, len(TORUS_DEFORM)),
    "arm_segment": (build_arm_segment, len(ARM_DEFORM)),
}


# ── shared building blocks ────────────────────────────────────────────────────────────────────────


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _build_armature(name, bone_specs):
    data = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)

    with edit_bones(obj) as ebs:
        for bone_name, head, tail, parent, deform in bone_specs:
            eb = ebs.new(bone_name)
            eb.head = Vector(head)
            eb.tail = Vector(tail)
            eb.use_deform = deform
            if parent is not None:
                eb.parent = ebs[parent]
                # Explicit positions only. use_connect would snap the head to the parent's tail and
                # quietly move bones away from where this file says they are.
                eb.use_connect = False
    return obj


def _build_material(mesh_obj):
    mat = bpy.data.materials.new("HeroAtlas")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links

    img = bpy.data.images.new("HeroAtlas", ATLAS_PX, ATLAS_PX)
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img

    principled = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    links.new(tex.outputs["Color"], principled.inputs["Base Color"])

    mesh_obj.data.materials.append(mat)
    return mat


def _bind(mesh_obj, armature_obj):
    mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
    mod.object = armature_obj


@contextmanager
def edit_bones(armature_obj):
    prev = bpy.context.view_layer.objects.active
    bpy.context.view_layer.objects.active = armature_obj
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        yield armature_obj.data.edit_bones
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")
        if prev is not None:
            bpy.context.view_layer.objects.active = prev


@contextmanager
def edit_mesh(mesh_obj):
    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    try:
        yield bm
        bm.to_mesh(mesh_obj.data)
        mesh_obj.data.update()
    finally:
        bm.free()


def _first_interior_edge(bm):
    for e in bm.edges:
        if len(e.link_faces) == 2:
            return e
    raise RuntimeError("fixture is broken: no edge shared by two faces")


def _single_group_vertex(mesh_obj):
    """A vertex with exactly one influence, so weight mutations start from a known state."""
    for v in mesh_obj.data.vertices:
        if len(v.groups) == 1:
            return v.index, next(g for g in mesh_obj.vertex_groups if g.index == v.groups[0].group)
    raise RuntimeError("fixture is broken: no vertex has exactly one vertex group")


def _quad_diagonal_touching(bm, members):
    """A quad with at least one vertex in `members`, and the diagonal starting at such a vertex.

    Not "a quad wholly inside": a declared joint loop is a single ring of vertices, and no quad has
    all four vertices on one ring — every quad spans two. Asking for containment found nothing.
    """
    for f in bm.faces:
        vs = list(f.verts)
        if len(vs) != 4:
            continue
        for i, v in enumerate(vs):
            if v.index in members:
                return vs[i], vs[(i + 2) % 4]
    raise RuntimeError("fixture is broken: no quad touches the given vertex set")


# ── mutators ──────────────────────────────────────────────────────────────────────────────────────
# Each takes (mesh_obj, armature_obj, manifest) and mutates in place. Some mutate the manifest, which
# is part of the candidate's claim and therefore fair game to break.


def m_delete_face(mesh_obj, armature_obj, manifest):
    with edit_mesh(mesh_obj) as bm:
        bmesh.ops.delete(bm, geom=[bm.faces[0]], context="FACES_ONLY")


def m_loose_vert(mesh_obj, armature_obj, manifest):
    with edit_mesh(mesh_obj) as bm:
        bm.verts.new(Vector((3.0, 0.0, 0.0)))


def m_zero_area_face(mesh_obj, armature_obj, manifest):
    with edit_mesh(mesh_obj) as bm:
        vs = list(bm.faces[0].verts)
        vs[0].co = vs[3].co.copy()
        vs[1].co = vs[2].co.copy()


def m_doubled_vert(mesh_obj, armature_obj, manifest):
    with edit_mesh(mesh_obj) as bm:
        bm.verts.new(bm.verts[0].co.copy())


def m_flip_normal(mesh_obj, armature_obj, manifest):
    with edit_mesh(mesh_obj) as bm:
        bm.faces[0].normal_flip()


def m_ngon(mesh_obj, armature_obj, manifest):
    with edit_mesh(mesh_obj) as bm:
        bmesh.ops.dissolve_edges(bm, edges=[_first_interior_edge(bm)], use_verts=False)


def m_self_intersect(mesh_obj, armature_obj, manifest):
    """Drag one vertex through to the far side of the ring so its faces pierce the opposite wall."""
    with edit_mesh(mesh_obj) as bm:
        v = bm.verts[0]
        v.co = Vector((-v.co.x, -v.co.y, v.co.z))


def m_bleed_weights_into_a_cap_triangle(mesh_obj, armature_obj, manifest):
    """Blend the weights of a vertex in a rigid cap fan, so its triangles now deform.

    The isolated G7 failure: no topology changes at all, so no pole appears and no other gate moves.
    It is also the realistic version — weight painting bleeding out of a rigid cap is far more likely
    than somebody hand-placing a triangle at a joint.
    """
    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    bm.verts.ensure_lookup_table()
    try:
        target = next((v.index for v in bm.verts if any(len(f.verts) == 3 for f in v.link_faces)), None)
    finally:
        bm.free()
    if target is None:
        raise RuntimeError("fixture is broken: no vertex belongs to a triangle")
    groups = [g for g in mesh_obj.vertex_groups if g.name in ARM_DEFORM][:2]
    if len(groups) != 2:
        raise RuntimeError("fixture is broken: need two deform groups to blend between")
    for g in groups:
        g.add([target], JOINT_SPLIT, "REPLACE")


def m_undeclare_static_triangles(mesh_obj, armature_obj, manifest):
    """The triangles are still rigid, but nothing documents them. 'Documented' is half the gate."""
    manifest["documentedStaticTriangles"] = {}


def m_declare_no_loops(mesh_obj, armature_obj, manifest):
    """Nothing to check. A gate with no input must fail, not pass."""
    manifest["loops"] = {}


def m_break_the_loop_cycle(mesh_obj, armature_obj, manifest):
    """Drop three vertices so the declaration is an arc, not a closed cycle."""
    name = next(iter(manifest["loops"]))
    manifest["loops"][name] = manifest["loops"][name][3:]


def m_declare_a_loop_in_rigid_geometry(mesh_obj, armature_obj, manifest):
    """Declare a ring parked in single-influence geometry, where nothing deforms.

    This is the gaming move G8 exists to refuse: a candidate could otherwise declare its joint loop
    somewhere harmless and pass G9 trivially.
    """
    infl = {}
    for v in mesh_obj.data.vertices:
        infl[v.index] = len(v.groups)
    rigid = [i for i, n in sorted(infl.items()) if n == 1]
    manifest["loops"] = {"ParkedLoop": rigid[: MINOR_SEGMENTS]}


def m_pole_in_joint_zone(mesh_obj, armature_obj, manifest):
    """Split a quad touching the joint loop, putting a valence-5 pole on the loop itself.

    This necessarily also trips G7, because splitting a quad produces triangles. On a quad mesh a
    pole cannot be added without the face count going somewhere; that is arithmetic, not sloppiness.
    """
    members = set(manifest["loops"]["TorusJoint"])
    with edit_mesh(mesh_obj) as bm:
        a, b = _quad_diagonal_touching(bm, members)
        bmesh.ops.connect_verts(bm, verts=[a, b])


def m_three_pole_in_joint_zone(mesh_obj, armature_obj, manifest):
    """Dissolve a vertex on the joint loop. Its four neighbours drop to valence 3, at the joint."""
    victim = manifest["loops"]["TorusJoint"][0]
    with edit_mesh(mesh_obj) as bm:
        bmesh.ops.dissolve_verts(bm, verts=[bm.verts[victim]])


def m_droop_arm(mesh_obj, armature_obj, manifest):
    with edit_bones(armature_obj) as ebs:
        ebs["DEF_UpperArm_L"].tail = Vector((0.12, 0.0, 0.22))


def m_rename_arms_unrecognisably(mesh_obj, armature_obj, manifest):
    """Nothing left for the T-pose heuristic to look at. Must fail, not pass."""
    bones = armature_obj.data.bones
    bones["DEF_UpperArm_L"].name = "DEF_Limb_L"
    bones["DEF_UpperArm_R"].name = "DEF_Limb_R"


def m_rename_root(mesh_obj, armature_obj, manifest):
    armature_obj.data.bones["Root"].name = "MCH_Hips"


def m_move_root_off_origin(mesh_obj, armature_obj, manifest):
    with edit_bones(armature_obj) as ebs:
        root = ebs["Root"]
        root.head = Vector((0.0, 0.0, 0.45))
        root.tail = Vector((0.0, 0.0, 0.55))


def m_second_root(mesh_obj, armature_obj, manifest):
    with edit_bones(armature_obj) as ebs:
        eb = ebs.new("MCH_Floating")
        eb.head = Vector((1.0, 0.0, 0.0))
        eb.tail = Vector((1.0, 0.0, 0.1))
        eb.use_deform = False


def m_unprefixed_bone(mesh_obj, armature_obj, manifest):
    with edit_bones(armature_obj) as ebs:
        eb = ebs.new("Socket_Headgear")
        eb.head = Vector((0.0, 0.2, 0.10))
        eb.tail = Vector((0.0, 0.4, 0.10))
        eb.parent = ebs["Root"]
        eb.use_connect = False
        eb.use_deform = False


def m_extra_deform_bone(mesh_obj, armature_obj, manifest):
    with edit_bones(armature_obj) as ebs:
        eb = ebs.new("DEF_Extra")
        eb.head = Vector((0.0, 0.2, 0.20))
        eb.tail = Vector((0.0, 0.4, 0.20))
        eb.parent = ebs["Root"]
        eb.use_connect = False
        eb.use_deform = True


def m_clear_deform_flag(mesh_obj, armature_obj, manifest):
    armature_obj.data.bones["DEF_Head"].use_deform = False


def m_scale_armature(mesh_obj, armature_obj, manifest):
    armature_obj.scale = Vector((1.0, 1.0, 1.2))


def m_unweight_vertex(mesh_obj, armature_obj, manifest):
    index, group = _single_group_vertex(mesh_obj)
    group.remove([index])


def m_five_influences(mesh_obj, armature_obj, manifest):
    """Five influences summing to exactly 1.0, so G18 fails while G19 still passes.

    This is the realistic shape of the bug: auto-weighting produces well-normalised weights that
    Three.js then silently truncates to four. Nothing except G18 notices.
    """
    index, own = _single_group_vertex(mesh_obj)
    others = [g for g in mesh_obj.vertex_groups if g.name in TORUS_DEFORM and g.name != own.name][:4]
    if len(others) != 4:
        raise RuntimeError("fixture is broken: fewer than 5 deform groups available")
    for g in [own] + others:
        g.add([index], 0.2, "REPLACE")


def m_unnormalised_weight(mesh_obj, armature_obj, manifest):
    index, group = _single_group_vertex(mesh_obj)
    group.add([index], 0.5, "REPLACE")


def m_unsafe_name(mesh_obj, armature_obj, manifest):
    mesh_obj.name = "Hero Region!"


def m_second_material(mesh_obj, armature_obj, manifest):
    mesh_obj.data.materials.append(bpy.data.materials.new("StrayMaterial"))


def m_oversize_atlas(mesh_obj, armature_obj, manifest):
    bpy.data.images["HeroAtlas"].scale(ATLAS_PX * 2, ATLAS_PX * 2)


def m_color_ramp(mesh_obj, armature_obj, manifest):
    mesh_obj.data.materials[0].node_tree.nodes.new("ShaderNodeValToRGB")


def m_remove_uvs(mesh_obj, armature_obj, manifest):
    uvs = mesh_obj.data.uv_layers
    uvs.remove(uvs[0])


def m_shape_key(mesh_obj, armature_obj, manifest):
    mesh_obj.shape_key_add(name="Basis")


# (mutation name, target gate, fixture, mutator, why this is the realistic form of the defect)
MUTATIONS = [
    ("delete_a_face", "G1", "torus", m_delete_face, "a hole left by a bad boolean or a stray delete"),
    ("add_a_loose_vertex", "G1", "torus", m_loose_vert, "left over from modelling; exports as a stray vertex"),
    ("collapse_a_face_to_a_line", "G2", "torus", m_zero_area_face, "a face squashed flat; produces NaN normals"),
    ("duplicate_a_vertex", "G3", "torus", m_doubled_vert, "merging two halves without merging by distance"),
    ("flip_one_face", "G4", "torus", m_flip_normal, "reads as a hole in the character at runtime"),
    ("dissolve_an_edge_into_an_ngon", "G5", "torus", m_ngon, "n-gons triangulate unpredictably on export"),
    ("push_a_vertex_through_the_far_wall", "G6", "torus", m_self_intersect, "geometry through itself"),
    ("bleed_weights_into_a_cap_triangle", "G7", "arm_segment", m_bleed_weights_into_a_cap_triangle,
     "weight painting escaping a rigid cap, so its triangles start to deform"),
    ("stop_documenting_the_static_triangles", "G7", "arm_segment", m_undeclare_static_triangles,
     "the triangles are still rigid, but 'documented' is half the gate"),
    ("declare_a_joint_loop_in_rigid_geometry", "G8", "torus", m_declare_a_loop_in_rigid_geometry,
     "the gaming move: park the declaration somewhere harmless"),
    ("break_the_declared_loop_into_an_arc", "G8", "torus", m_break_the_loop_cycle,
     "a declaration that is a bag of vertices, not a closed loop"),
    ("declare_no_joint_loops_at_all", "G9", "torus", m_declare_no_loops,
     "nothing to check: a gate with no input must fail, not pass"),
    ("split_a_quad_touching_the_joint_loop", "G9", "torus", m_pole_in_joint_zone,
     "a pole exactly where the surface has to stretch"),
    ("dissolve_a_vertex_on_the_joint_loop", "G10", "torus", m_three_pole_in_joint_zone,
     "tidying topology by dissolving, right at a joint"),
    ("droop_the_arm_out_of_T_pose", "G11", "torus", m_droop_arm, "an A-pose rest breaks CC0 retargeting"),
    ("rename_the_arms_unrecognisably", "G11", "torus", m_rename_arms_unrecognisably,
     "nothing to check: the heuristic must fail, not pass, when it finds no arm"),
    ("rename_the_root_bone", "G12", "torus", m_rename_root, "engines look for Root by name"),
    ("move_the_root_bone_to_hip_height", "G12", "torus", m_move_root_off_origin,
     "the named anti-pattern; breaks ground calculations"),
    ("add_a_second_root_bone", "G12", "torus", m_second_root, "two roots, no single transform"),
    ("add_a_Socket_bone_with_no_layer_prefix", "G13", "torus", m_unprefixed_bone,
     "gear attachment points are a real need the three-layer scheme has no category for"),
    ("add_an_extra_deform_bone", "G14", "torus", m_extra_deform_bone, "budget creep; the contract pins the count"),
    ("clear_a_deform_flag", "G15", "torus", m_clear_deform_flag, "the bone exists, its vertices stay behind"),
    ("scale_the_armature", "G16", "torus", m_scale_armature, "non-unit scale deforms animation on export"),
    ("unweight_a_vertex", "G17", "torus", m_unweight_vertex, "the vertex stays put while the character moves"),
    ("give_a_vertex_five_influences", "G18", "torus", m_five_influences, "Three.js drops the fifth silently"),
    ("unnormalise_a_vertex_weight", "G19", "torus", m_unnormalised_weight, "the vertex drifts"),
    ("use_an_unsafe_object_name", "G20", "torus", m_unsafe_name, "special characters break glTF/FBX export"),
    ("add_a_second_material", "G21", "torus", m_second_material, "an extra material is an extra draw call"),
    ("double_the_atlas_resolution", "G21", "torus", m_oversize_atlas, "silently blows the texture budget"),
    ("add_a_Color_Ramp_node", "G22", "torus", m_color_ramp, "renders in Blender, gone in the GLB"),
    ("remove_the_UV_layer", "G24", "torus", m_remove_uvs, "no UVs, no atlas"),
    ("add_a_shape_key", "G26", "torus", m_shape_key, "freezes vertex order before geometry is final"),
]

# Gates with no mutation here, and the honest reason. Not a silent gap.
UNPROVEN_GATES = {
    "G23": "export_apply=False is an argument to the export call, so it is proven when the export step exists.",
    "G25": "'.blend is committed' is a repository fact, checked by the build script, not by bpy.",
    "G27": "Determinism needs two real builds to compare, so it is proven by the build script.",
}
