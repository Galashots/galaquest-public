"""Weld, decimate, re-unwrap and re-bake a rigid gear GLB to a runtime triangle budget.

blender --background --factory-startup --python decimate_gear.py -- <in.glb> <out.glb> <target_tris> [bake_px]

Rigid gear arrives from a generator at 10-100x the triangles the game budget allows; a Dawnwarden
helmet candidate is 311,626 triangles against a 2,000 triangle Owner budget. The production order in
docs/pipeline/character-armoring.md is

    reference -> generate -> silhouette review -> remesh/decimate -> material normalization -> ...

and this is the remesh/decimate step plus the texture transfer that step needs to not ship a broken
asset: it imports, welds the seam-split vertices, collapse-decimates to the requested budget, unwraps
a fresh UV set, bakes the source's base colour onto the reduced mesh, and exports. It performs no
modelling, no anatomy, no rigging, no fit and no material normalization -- the exported material is one
baked Base Color texture, not a normalized PBR set. Decimation is not appearance acceptance: the
reduced bytes still need the visual review in docs/review-guides/asset-visual-review.md.

Why the weld comes first. A glTF mesh splits a vertex at every UV seam, and v1's UV-delimited collapse
then reduced each side of a seam independently, so the two sides pulled apart and opened cracks: the
decimated Dawnwarden helmet at 2,000 triangles showed dark cracks across its dome, and re-baking the
texture alone did not remove them. Merging the seam-split vertices by distance first makes each seam
one vertex ring again, so an unconstrained collapse cannot tear it, and the fresh unwrap below replaces
the atlas that collapse destroys -- which is why the collapse no longer needs delimiting by UV.

Guarantees, all verified and printed rather than assumed:

* the pinned Blender is refused unless it is EXACTLY 4.5.13 -- see the determinism note;
* the source is refused unless it is rigid single-mesh/single-primitive/single-material gear, so this
  cannot silently mangle a skinned character with a rig (use decimate_hero.py for the naked hero);
* every source primitive must be a glTF TRIANGLES primitive (mode 4) that declares POSITION -- the atom
  a triangle budget is counted in, and the attribute the weld, the collapse and the bake all read;
* the source must carry a UV layer, because the texture the bake reads is sampled through it;
* the destination is refused when it is the source file, by resolved path AND by device+inode, so a
  hard link is refused as well as a symlink; the source itself is never written;
* the output is re-read from disk and must declare <= the target triangles, one mesh, one primitive,
  one material, exactly one image (JPEG, wired as Base Color) and exactly one UV set carrying
  POSITION/NORMAL/TEXCOORD_0.

Determinism, per Blender version. The weld, the collapse, Smart UV Project and the bake all run with
fixed parameters -- a fixed weld threshold, a fixed ratio sequence, a fixed unwrap angle and island
margin, a fixed Cycles seed and sample count, and a fixed image size and format -- so identical inputs,
target and bake size produce identical bytes. That promise holds FOR ONE BLENDER BUILD only: the
collapse result, the unwrap and the baked pixels are not promised to match across versions, which is
why the pin below is exact rather than a minimum. Verify by running twice and diffing, which is what
the A1 note records.
"""

from __future__ import annotations

import json
import math
import os
import struct
import sys

import bpy

# Blender's collapse decimation lands within a face or two of the requested ratio rather than exactly
# on it, so a ratio that is merely close to the budget is not good enough for a hard cap.
MAX_RATIO_ATTEMPTS = 4
REQUIRED_ATTRIBUTES = ("POSITION", "NORMAL", "TEXCOORD_0")
TRIANGLES_MODE = 4

# Weld threshold as a fraction of the largest dimension: glTF seam splits are exact duplicates of one
# position, so the threshold only has to survive a round trip through float and back.
WELD_FRACTION = 1e-5
# The bake cage, as fractions of the largest dimension of the REDUCED mesh, and the baked image.
CAGE_FRACTION = 0.02
MAX_RAY_FRACTION = 0.05
BAKE_MARGIN_PX = 4
# Cycles DIFFUSE/COLOR is a texture transfer, not a lit render, so a small fixed sample count with a
# fixed seed is enough -- and a fixed pair is what makes the baked pixels reproducible.
BAKE_SAMPLES = 8
BAKE_SEED = 0
SMART_UV_ANGLE_DEGREES = 66.0
SMART_UV_ISLAND_MARGIN = 0.01
BAKE_UV_NAME = "GQ_BAKED"
BAKE_IMAGE_NAME = "GQ_BAKED_BASECOLOR"
BAKE_MATERIAL_NAME = "GQ_Baked"

DEFAULT_BAKE_PX = 1024
MIN_BAKE_PX = 256
MAX_BAKE_PX = 4096


def gltf_json_chunk(path: str) -> dict:
    """Read the JSON chunk of a .glb without any dependency on the importer."""
    with open(path, "rb") as handle:
        magic, version, length = struct.unpack("<4sII", handle.read(12))
        if magic != b"glTF":
            raise SystemExit(f"{path}: not a binary glTF")
        if version != 2:
            raise SystemExit(f"{path}: unsupported glTF version {version}")
        while handle.tell() < length:
            chunk_length, chunk_type = struct.unpack("<II", handle.read(8))
            data = handle.read(chunk_length)
            if chunk_type == 0x4E4F534A:
                return json.loads(data.decode("utf-8").rstrip("\x00 "))
    raise SystemExit(f"{path}: missing JSON chunk")


def primitives_of(gltf: dict) -> list[dict]:
    return [primitive for mesh in gltf.get("meshes", []) for primitive in mesh.get("primitives", [])]


def primitive_triangles(gltf: dict, primitive: dict) -> int | None:
    indices = primitive.get("indices")
    if indices is not None:
        count = gltf.get("accessors", [{}])[indices].get("count")
    else:
        count = gltf.get("accessors", [{}])[primitive["attributes"]["POSITION"]].get("count")
    return None if count is None else count // 3


def declared_shape(gltf: dict) -> dict:
    primitives = primitives_of(gltf)
    return {
        "meshes": len(gltf.get("meshes", [])),
        "primitives": len(primitives),
        "materials": len(gltf.get("materials", [])),
        "images": len(gltf.get("images", [])),
        "skins": len(gltf.get("skins", [])),
        "animations": len(gltf.get("animations", [])),
        "morph_targets": sum(len(p.get("targets", [])) for p in primitives),
        "triangles": sum(t for t in (primitive_triangles(gltf, p) for p in primitives) if t is not None),
    }


def assert_triangle_primitives(source: str, gltf: dict) -> None:
    """Refuse non-triangle primitives and primitives without positions, before Blender touches them.

    A TRIANGLES primitive is the only source shape Blender imports as faces this tool can count a face
    budget in, and POSITION is the attribute the weld, the collapse and the bake all read. Both would
    otherwise fail much later, inside the importer or the depsgraph, about something other than the
    file's actual defect.
    """
    for index, primitive in enumerate(primitives_of(gltf)):
        mode = primitive.get("mode", TRIANGLES_MODE)
        if mode != TRIANGLES_MODE:
            raise SystemExit(
                f"{source}: primitive {index} declares glTF mode {mode}, not {TRIANGLES_MODE} (TRIANGLES); "
                "this tool reduces triangle lists only, because a triangle list is the only shape it can "
                "measure a face budget in"
            )
        if "POSITION" not in primitive.get("attributes", {}):
            raise SystemExit(
                f"{source}: primitive {index} declares no POSITION attribute; the weld, the collapse and "
                "the bake all need vertex positions"
            )


def arguments() -> tuple[str, str, int, int]:
    usage = "expected Blender arguments after --: <in.glb> <out.glb> <target_tris> [bake_px]"
    if "--" not in sys.argv:
        raise SystemExit(usage)
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) not in (3, 4):
        raise SystemExit(usage)
    try:
        target = int(values[2])
    except ValueError:
        raise SystemExit(f"target_tris must be a whole number, got {values[2]!r}")
    if target < 1:
        raise SystemExit(f"target_tris must be at least 1, got {target}")
    bake_px = DEFAULT_BAKE_PX
    if len(values) == 4:
        try:
            bake_px = int(values[3])
        except ValueError:
            raise SystemExit(f"bake_px must be a whole number of pixels, got {values[3]!r}")
        if bake_px < MIN_BAKE_PX or bake_px > MAX_BAKE_PX or (bake_px & (bake_px - 1)) != 0:
            raise SystemExit(
                f"bake_px must be a power of two between {MIN_BAKE_PX} and {MAX_BAKE_PX}, got {bake_px}"
            )
    return os.path.abspath(values[0]), os.path.abspath(values[1]), target, bake_px


# The GalaQuest derivative lane pins Blender 4.5.13 (see tools/unity-migration/convert-gear-asset.mjs);
# the determinism claim above only holds for one build, so the version is matched exactly.
PINNED_BLENDER = (4, 5, 13)


def assert_pinned_blender() -> None:
    if tuple(bpy.app.version) != PINNED_BLENDER:
        raise SystemExit(
            f"Blender {bpy.app.version_string} is not the pinned "
            f"{PINNED_BLENDER[0]}.{PINNED_BLENDER[1]}.{PINNED_BLENDER[2]}; the weld, the collapse, the "
            "unwrap and the bake are only reproducible per Blender version"
        )


def file_identity(path: str) -> tuple[int, int] | None:
    """Device and inode: the same bytes under a different name, however the path is spelled."""
    try:
        status = os.stat(path)
    except OSError:
        return None
    return (status.st_dev, status.st_ino)


def assert_distinct_files(source: str, destination: str) -> None:
    if os.path.realpath(destination) == os.path.realpath(source):
        raise SystemExit(f"destination is the source file; refusing to overwrite {source}")
    if os.path.isfile(destination) and file_identity(destination) == file_identity(source):
        raise SystemExit(
            f"destination {destination} is a hard link to the source {source} (same device and inode); "
            "writing it would rewrite the candidate in place"
        )


def import_single_rigid_mesh(source: str, declared: dict) -> bpy.types.Object:
    """Import the source and refuse anything that is not one rigid mesh with one material."""
    if declared["morph_targets"]:
        raise SystemExit(
            f"{source}: declares {declared['morph_targets']} morph targets; this tool reduces rigid gear only"
        )
    if declared["skins"] or declared["animations"]:
        raise SystemExit(
            f"{source}: declares {declared['skins']} skins / {declared['animations']} animations; "
            "this tool reduces rigid gear only (see decimate_hero.py for skinned characters)"
        )
    if declared["meshes"] != 1 or declared["primitives"] != 1 or declared["materials"] != 1:
        raise SystemExit(
            f"{source}: declares {declared['meshes']} meshes / {declared['primitives']} primitives / "
            f"{declared['materials']} materials; this tool reduces single-material rigid gear only"
        )

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=source)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(meshes) != 1:
        # Blender's glTF importer fabricates helper geometry for some files. Rather than guess which
        # mesh is the file's, refuse: a wrong guess here silently decimates the wrong thing.
        raise SystemExit(
            f"{source}: imported {len(meshes)} meshes {[m.name for m in meshes]}, expected exactly 1"
        )
    return meshes[0]


def mesh_triangles(mesh: bpy.types.Mesh) -> int:
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def evaluated_triangles(obj: bpy.types.Object) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    count = len(mesh.loop_triangles)
    evaluated.to_mesh_clear()
    return count


def activate(obj: bpy.types.Object) -> None:
    """Make `obj` the one selected, active object: most of the operators below are context-driven."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def duplicate_object(obj: bpy.types.Object) -> bpy.types.Object:
    """The working copy: the imported object stays the full-resolution source for the bake."""
    duplicate = obj.copy()
    duplicate.data = obj.data.copy()
    bpy.context.collection.objects.link(duplicate)
    return duplicate


def weld_seam_split_vertices(obj: bpy.types.Object) -> dict:
    """Merge the vertices glTF split at UV seams, so a collapse can no longer tear a seam apart."""
    threshold = max(float(value) for value in obj.dimensions) * WELD_FRACTION
    before = len(obj.data.vertices)
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=threshold)
    bpy.ops.object.mode_set(mode="OBJECT")
    return {"before": before, "after": len(obj.data.vertices), "threshold": threshold}


def collapse_to_budget(obj: bpy.types.Object, before: int, target: int) -> float:
    """Collapse-decimate to the budget, deliberately WITHOUT a UV delimit, and apply the result."""
    modifier = obj.modifiers.new("gq_decimate", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    # No UV delimit. Welding made every seam one vertex ring again, so a UV-delimited collapse cannot
    # protect anything a plain collapse would break -- it can only reduce the two sides of a seam
    # separately, which is the v1 crack. The atlas this collapse destroys is replaced below by a fresh
    # unwrap, so there is nothing left for a seam limit to defend.
    modifier.delimit = set()

    ratio = min(1.0, target / before)
    chosen: float | None = None
    for attempt in range(1, MAX_RATIO_ATTEMPTS + 1):
        modifier.ratio = ratio
        after = evaluated_triangles(obj)
        print(f"ATTEMPT collapse {attempt} ratio={ratio:.6f} -> {after} tris")
        if after <= target:
            chosen = ratio
            break
        # The ratio is a face-count target, so the miss is small and one correction suffices.
        ratio = max(1e-9, ratio * target / after * 0.98)
    if chosen is None:
        raise SystemExit(
            f"could not reach {target} triangles from {before}; the budget needs a different "
            "reduction strategy (retopology) rather than a lower ratio"
        )

    activate(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    applied = mesh_triangles(obj.data)
    if applied > target:
        raise SystemExit(f"applying the collapse produced {applied} tris, over the {target} budget")
    print(f"COLLAPSE ratio={chosen:.6f} applied={applied} tris")
    return chosen


def unwrap_fresh_uvs(obj: bpy.types.Object) -> None:
    """A new, non-overlapping atlas for the reduced mesh: the collapse destroyed the imported one."""
    layer = obj.data.uv_layers.new(name=BAKE_UV_NAME)
    obj.data.uv_layers.active = layer
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(SMART_UV_ANGLE_DEGREES),
        island_margin=SMART_UV_ISLAND_MARGIN,
    )
    bpy.ops.object.mode_set(mode="OBJECT")


def build_bake_material(image: bpy.types.Image) -> bpy.types.Material:
    """One material whose Base Color is the bake target, sampled through the fresh UV set.

    The material is new rather than the imported one: the baked mesh stops carrying the source's other
    maps, so "exactly one image" is a property of the export rather than a hope about the source.
    """
    material = bpy.data.materials.new(BAKE_MATERIAL_NAME)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    principled = nodes.get("Principled BSDF")
    if principled is None:
        raise SystemExit("the new bake material has no Principled BSDF; cannot wire the baked Base Color")
    image_node = nodes.new("ShaderNodeTexImage")
    image_node.image = image
    image_node.label = BAKE_MATERIAL_NAME
    uv_node = nodes.new("ShaderNodeUVMap")
    uv_node.uv_map = BAKE_UV_NAME
    material.node_tree.links.new(uv_node.outputs["UV"], image_node.inputs["Vector"])
    material.node_tree.links.new(image_node.outputs["Color"], principled.inputs["Base Color"])
    # Cycles bakes into the tree's ACTIVE image texture node.
    for node in nodes:
        node.select = node is image_node
    nodes.active = image_node
    return material


def bake_base_color(source: bpy.types.Object, target: bpy.types.Object, dimensions: float) -> None:
    """Bake the source's diffuse colour onto the reduced mesh: selected source, active target."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = BAKE_SAMPLES
    scene.cycles.seed = BAKE_SEED
    # Both are defaults, set anyway: a determinism claim that rests on a default is a claim about a
    # preference someone else can change.
    if hasattr(scene.cycles, "use_animated_seed"):
        scene.cycles.use_animated_seed = False
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = False

    activate(target)
    source.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.bake(
        type="DIFFUSE",
        pass_filter={"COLOR"},
        use_selected_to_active=True,
        cage_extrusion=dimensions * CAGE_FRACTION,
        max_ray_distance=dimensions * MAX_RAY_FRACTION,
        margin=BAKE_MARGIN_PX,
        use_clear=True,
    )


def remove_other_uv_layers(obj: bpy.types.Object) -> None:
    """Leave exactly the baked UV set, so the export declares one UV set rather than an atlas nobody reads."""
    for layer in list(obj.data.uv_layers):
        if layer.name != BAKE_UV_NAME:
            obj.data.uv_layers.remove(layer)
    obj.data.uv_layers.active = obj.data.uv_layers[BAKE_UV_NAME]


def verify_export(destination: str, target: int) -> dict:
    """Re-read the written GLB and refuse it unless it is one in-budget, one-texture, one-UV mesh."""
    gltf = gltf_json_chunk(destination)
    result = declared_shape(gltf)
    primitives = primitives_of(gltf)
    attributes = {name for primitive in primitives for name in primitive.get("attributes", {})}
    uv_sets = sorted(name for name in attributes if name.startswith("TEXCOORD_"))
    images = gltf.get("images", [])
    mime_types = sorted({image.get("mimeType", "(none)") for image in images})
    materials = gltf.get("materials", [])
    base_colour_wired = bool(materials) and all(
        "baseColorTexture" in (material.get("pbrMetallicRoughness") or {}) for material in materials
    )
    print(
        "RESULT {0} bytes={1} meshes={2} primitives={3} materials={4} images={5} mime={6} tris={7} uv={8}".format(
            destination, os.path.getsize(destination), result["meshes"], result["primitives"],
            result["materials"], result["images"], mime_types or "(none)", result["triangles"],
            uv_sets or "(none)",
        )
    )

    failures = []
    if result["triangles"] > target:
        failures.append(f"exported {result['triangles']} tris, over the {target} budget")
    if (result["meshes"], result["primitives"], result["materials"]) != (1, 1, 1):
        failures.append(
            f"exported shape changed: {result['meshes']} meshes / {result['primitives']} primitives / "
            f"{result['materials']} materials, expected 1/1/1"
        )
    if result["images"] != 1:
        failures.append(f"exported {result['images']} images, expected exactly the one baked Base Color")
    elif mime_types != ["image/jpeg"]:
        failures.append(f"exported image format {mime_types}, expected exactly ['image/jpeg']")
    if not base_colour_wired:
        failures.append("the exported material has no baseColorTexture; the baked image is not wired as Base Color")
    missing = [name for name in REQUIRED_ATTRIBUTES if name not in attributes]
    if missing:
        failures.append(f"exported mesh lost attributes: {missing}")
    if uv_sets != ["TEXCOORD_0"]:
        failures.append(f"exported UV sets {uv_sets or '(none)'}, expected exactly ['TEXCOORD_0']")
    if failures:
        raise SystemExit(f"{destination}: bake/export verification failed: " + "; ".join(failures))
    return result


def main() -> None:
    source, destination, target, bake_px = arguments()
    assert_pinned_blender()
    if not os.path.isfile(source):
        raise SystemExit(f"missing source GLB: {source}")
    assert_distinct_files(source, destination)
    if not destination.lower().endswith(".glb"):
        raise SystemExit(f"destination must be GLB: {destination}")

    source_gltf = gltf_json_chunk(source)
    assert_triangle_primitives(source, source_gltf)
    declared = declared_shape(source_gltf)
    print(
        "SOURCE {0} meshes={1} primitives={2} materials={3} images={4} tris={5}".format(
            source, declared["meshes"], declared["primitives"], declared["materials"],
            declared["images"], declared["triangles"],
        )
    )
    high = import_single_rigid_mesh(source, declared)
    source_uv_layers = [layer.name for layer in high.data.uv_layers]
    if not source_uv_layers:
        raise SystemExit(f"{source}: imported mesh has no UV layer; nothing for the texture to map onto")
    original = mesh_triangles(high.data)
    if original <= target:
        raise SystemExit(f"{source}: already {original} tris, at or under the {target} budget; nothing to do")
    print(
        f"MESH {high.name!r} tris={original} verts={len(high.data.vertices)} "
        f"uv={source_uv_layers} target={target} bake_px={bake_px}"
    )

    # The imported object stays the bake source, full resolution and with its original texture; the
    # working copy is what gets welded, reduced and re-unwrapped.
    low = duplicate_object(high)

    welded = weld_seam_split_vertices(low)
    before = mesh_triangles(low.data)
    print(
        f"WELDED verts={welded['before']} -> {welded['after']} "
        f"threshold={welded['threshold']:.6g} tris={before}"
    )
    if before < 1:
        raise SystemExit(f"{source}: welding left {before} triangles; nothing to decimate or unwrap")

    ratio = collapse_to_budget(low, before, target)
    after = mesh_triangles(low.data)
    if after < 1:
        raise SystemExit(f"{source}: the collapse left {after} triangles; there is nothing to unwrap or bake")
    print(
        f"DECIMATED {source} -> {destination} {before} -> {after} tris "
        f"({100.0 * after / before:.2f}%) ratio={ratio:.6f} delimit=[]"
    )

    unwrap_fresh_uvs(low)
    image = bpy.data.images.new(BAKE_IMAGE_NAME, bake_px, bake_px, alpha=False)
    image.colorspace_settings.name = "sRGB"
    # The exporter re-encodes a generated image with its own file format; fixing it here is what makes
    # the exported bytes a JPEG rather than a PNG the size assertion below would not notice.
    image.file_format = "JPEG"
    low.data.materials.clear()
    low.data.materials.append(build_bake_material(image))
    for polygon in low.data.polygons:
        polygon.material_index = 0

    dimensions = max(float(value) for value in low.dimensions)
    bake_base_color(high, low, dimensions)
    image.pack()
    remove_other_uv_layers(low)
    print(
        "BAKED {0}px {1} seed={2} samples={3} cage={4:.6g} max_ray={5:.6g} margin={6}px".format(
            bake_px, BAKE_UV_NAME, BAKE_SEED, BAKE_SAMPLES, dimensions * CAGE_FRACTION,
            dimensions * MAX_RAY_FRACTION, BAKE_MARGIN_PX,
        )
    )

    bpy.data.objects.remove(high, do_unlink=True)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=destination,
        export_format="GLB",
        export_apply=True,
        export_animations=False,
        export_skins=False,
        export_image_format="JPEG",
    )
    if not os.path.isfile(destination) or os.path.getsize(destination) == 0:
        raise SystemExit(f"export reported success but wrote nothing to {destination}")

    verify_export(destination, target)
    print(
        f"SUMMARY DECIMATED {source}->{destination} tris={before}->{after} target={target} "
        f"BAKED {bake_px}px bytes={os.path.getsize(destination)}"
    )
    print(f"WROTE {destination}")


main()
