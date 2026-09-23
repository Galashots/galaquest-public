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

* the pinned Blender is refused unless it is EXACTLY 4.5.13 LTS, and the SUMMARY line carries its
  build hash as well -- see the determinism note;
* the source is refused unless it is rigid single-mesh/single-primitive/single-material gear, so this
  cannot silently mangle a skinned character with a rig (use decimate_hero.py for the naked hero);
* every source primitive must be a glTF TRIANGLES primitive (mode 4) that declares POSITION -- the atom
  a triangle budget is counted in, and the attribute the weld, the collapse and the bake all read;
* the source must carry a UV layer, because the texture the bake reads is sampled through it;
* the destination is refused when it is the source file, by resolved path AND by device+inode, so a
  hard link is refused as well as a symlink; the source itself is never written;
* the fresh unwrap owns the only UV map on the reduced mesh and the bake sampled that same map, so a
  name collision cannot leave the destroyed atlas in the file with the new one deleted;
* the bake is refused unless it wrote pixels of more than one colour: `bake` reports success for a ray
  cast that hits nothing just as it does for a hit, and a blank bake is only measurable, not visible;
* the output is re-read from disk and must declare <= the target triangles, one mesh, one primitive,
  one material, exactly one image (JPEG, wired as Base Color) and exactly one UV set carrying
  POSITION/NORMAL/TEXCOORD_0 -- with every primitive a TRIANGLES primitive whose index count is a whole
  number of triangles matching the reported total, and the Base Color texture followed through
  textures[i].source to that one embedded image.

Determinism, byte-identical per exact Blender build. The weld, the collapse, Smart UV Project and the
bake all run with fixed parameters -- a fixed weld threshold, a fixed ratio sequence, a fixed unwrap
angle and island margin, a fixed Cycles seed and sample count, and a fixed image size and format -- so
identical inputs, target and bake size produce byte-identical output FOR ONE EXACT BLENDER BUILD. That
is a claim about a build, not about the semantic version "4.5.13": the collapse result, the unwrap and
the baked pixels are not promised to match a different build that reports the same version, so the gate
below matches the full version string AND the SUMMARY line records bpy.app.build_hash, the two together
naming the binary the bytes belong to. Verify by running twice and diffing, which is what the A1 note
records.
"""

from __future__ import annotations

import array
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

# Weld threshold as a fraction of the largest MESH-LOCAL dimension. glTF seam splits are exact
# duplicates of one position, so the threshold only has to survive a round trip through float and back.
WELD_FRACTION = 1e-5
# The bake cage, as fractions of the largest MESH-LOCAL dimension of the REDUCED mesh, and the baked
# image. See mesh_local_max_dimension for why all three distances are derived from that one number.
CAGE_FRACTION = 0.02
MAX_RAY_FRACTION = 0.05
BAKE_MARGIN_PX = 4
# A bake that hit nothing clears to a flat colour and still reports success, so the baked pixels are
# measured: a genuine transfer spreads over a range of colours, a miss does not.
BAKE_MIN_COLOUR_RANGE = 1e-4
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


# The GalaQuest derivative lane pins Blender 4.5.13 (see tools/unity-migration/convert-gear-asset.mjs).
# bpy.app.version is (4, 5, 13) on that release; the full version string is what is matched, and the
# SUMMARY line records the build hash, because the determinism claim above is per exact build -- a
# version number alone does not name the binary, and the same version ships as more than one build.
PINNED_BLENDER_VERSION_STRING = "4.5.13 LTS"


def blender_build_hash() -> str:
    """The build hash of the running binary: the half of "which Blender" a version string cannot give."""
    build_hash = getattr(bpy.app, "build_hash", None)
    if isinstance(build_hash, bytes):
        return build_hash.decode("utf-8", "replace")
    return str(build_hash) if build_hash else "(unknown)"


def assert_pinned_blender() -> str:
    """Refuse any binary but the pinned one, and return its build hash for the run's SUMMARY line."""
    if bpy.app.version_string != PINNED_BLENDER_VERSION_STRING:
        raise SystemExit(
            f"Blender {bpy.app.version_string} is not the pinned {PINNED_BLENDER_VERSION_STRING}; the "
            "weld, the collapse, the unwrap and the bake are only reproducible per exact Blender build"
        )
    return blender_build_hash()


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


def mesh_local_max_dimension(mesh: bpy.types.Mesh) -> float:
    """Largest extent of the mesh's own bounding box, from the vertex coordinates themselves.

    obj.dimensions is that box multiplied by the object's world scale, so on an import carrying a node
    scale it is a world-space number -- while remove_doubles, cage_extrusion and max_ray_distance all
    measure vertex coordinates in mesh-local space. Every distance below is derived from this one
    number so the weld and the bake stay in the same space as the geometry they act on: a scaled-up
    import would otherwise weld across real gaps, and a scaled-down one would fail to weld the seams
    it must.
    """
    if not mesh.vertices:
        return 0.0
    minima = [math.inf, math.inf, math.inf]
    maxima = [-math.inf, -math.inf, -math.inf]
    for vertex in mesh.vertices:
        for axis, value in enumerate(vertex.co):
            if value < minima[axis]:
                minima[axis] = value
            if value > maxima[axis]:
                maxima[axis] = value
    return max(maximum - minimum for minimum, maximum in zip(minima, maxima))


def weld_seam_split_vertices(obj: bpy.types.Object) -> dict:
    """Merge the vertices glTF split at UV seams, so a collapse can no longer tear a seam apart."""
    threshold = mesh_local_max_dimension(obj.data) * WELD_FRACTION
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
    # uv_layers.new(name=...) silently picks a unique name when `name` is already taken, so a source
    # that shipped a layer called BAKE_UV_NAME would leave the layer the bake resolves BY NAME pointing
    # at the old, collapse-destroyed atlas -- and remove_other_uv_layers would then delete the fresh
    # unwrap as "the other layer". Delete every imported layer first, then assert the name is ours.
    for layer in list(obj.data.uv_layers):
        obj.data.uv_layers.remove(layer)
    layer = obj.data.uv_layers.new(name=BAKE_UV_NAME)
    if len(obj.data.uv_layers) != 1 or layer.name != BAKE_UV_NAME:
        raise SystemExit(
            f"the fresh unwrap produced UV maps {[uv.name for uv in obj.data.uv_layers]}, expected "
            f"exactly [{BAKE_UV_NAME!r}]; the bake would sample a different atlas than the export ships"
        )
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
    if uv_node.uv_map != BAKE_UV_NAME:
        raise SystemExit(
            f"the bake material's UV Map node resolved {uv_node.uv_map!r}, not {BAKE_UV_NAME!r}; the bake "
            "would sample a different atlas than the export ships"
        )
    material.node_tree.links.new(uv_node.outputs["UV"], image_node.inputs["Vector"])
    material.node_tree.links.new(image_node.outputs["Color"], principled.inputs["Base Color"])
    # Cycles bakes into the tree's ACTIVE image texture node.
    for node in nodes:
        node.select = node is image_node
    nodes.active = image_node
    return material


def bake_base_color(source: bpy.types.Object, target: bpy.types.Object, local_extent: float) -> None:
    """Bake the source's diffuse colour onto the reduced mesh: selected source, active target.

    `local_extent` is the target's mesh-local extent, the space the cage and the ray distance are
    measured in; see mesh_local_max_dimension.
    """
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

    # The bake writes through the target's ACTIVE UV map, and the material samples the source image
    # through its UVMap node: both must be the fresh atlas, or the bake reads one map and the export
    # ships the pixels bound to another.
    uv_names = [layer.name for layer in target.data.uv_layers]
    active_uv = target.data.uv_layers.active.name if target.data.uv_layers.active else "(none)"
    if uv_names != [BAKE_UV_NAME] or active_uv != BAKE_UV_NAME:
        raise SystemExit(
            f"the bake target carries UV maps {uv_names} with {active_uv!r} active, expected exactly "
            f"[{BAKE_UV_NAME!r}] active; the bake would sample a different atlas than the export ships"
        )

    activate(target)
    source.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.bake(
        type="DIFFUSE",
        pass_filter={"COLOR"},
        use_selected_to_active=True,
        cage_extrusion=local_extent * CAGE_FRACTION,
        max_ray_distance=local_extent * MAX_RAY_FRACTION,
        margin=BAKE_MARGIN_PX,
        use_clear=True,
    )


def assert_bake_has_content(image: bpy.types.Image) -> tuple[float, float]:
    """Refuse a flat bake: `bake` reports success for a ray cast that reached nothing.

    A miss -- a cage that does not reach the source, a target outside it, an unwired Base Color --
    writes the cleared colour across the whole image and returns {"FINISHED"} exactly like a hit, so
    the pixels are measured instead of trusted. A material that really is one colour with no variation
    is refused here too: that is the fail-closed side of the trade, and it is visible on the next run,
    whereas a blank texture ships unnoticed.
    """
    width, height = image.size
    if width < 1 or height < 1:
        raise SystemExit(f"the bake image is {width}x{height}px; there are no pixels to measure")
    if not image.has_data:
        raise SystemExit("the bake left the image with no pixel buffer at all; nothing was written")
    pixels = array.array("f", bytes(4 * 4 * width * height))
    image.pixels.foreach_get(pixels)
    channels = [pixels[channel::4] for channel in range(3)]
    # Per channel, because "not all one colour" is about the IMAGE, not about the spread between the
    # channels: a clear colour that happens to be tinted (say 1, 0, 0) has a wide whole-image RGB range
    # while still being one colour everywhere, and only a per-channel span catches it.
    spans = [max(channel) - min(channel) for channel in channels]
    minimum = min(min(channel) for channel in channels)
    maximum = max(max(channel) for channel in channels)
    if max(spans) < BAKE_MIN_COLOUR_RANGE:
        raise SystemExit(
            f"the bake wrote one colour everywhere: every RGB channel is constant across the "
            f"{width}x{height} image (largest channel span {max(spans):.6g} < {BAKE_MIN_COLOUR_RANGE:g}, "
            f"whole-image RGB range {maximum - minimum:.6g}), so the ray cast reached no source pixels; "
            "nothing is written"
        )
    return (minimum, maximum)


def remove_other_uv_layers(obj: bpy.types.Object) -> None:
    """Leave exactly the baked UV set, so the export declares one UV set rather than an atlas nobody reads."""
    for layer in list(obj.data.uv_layers):
        if layer.name != BAKE_UV_NAME:
            obj.data.uv_layers.remove(layer)
    remaining = [layer.name for layer in obj.data.uv_layers]
    if remaining != [BAKE_UV_NAME]:
        raise SystemExit(
            f"the reduced mesh carries UV maps {remaining} after cleanup, expected exactly "
            f"[{BAKE_UV_NAME!r}]; the exported atlas is not the one the bake sampled"
        )
    obj.data.uv_layers.active = obj.data.uv_layers[BAKE_UV_NAME]


def triangle_count_failures(gltf: dict, primitives: list[dict], reported: int) -> list[str]:
    """Every primitive: mode TRIANGLES, and a whole number of triangles that matches the reported total.

    The index count is what a triangle budget is actually spent on, so an index count that is not a
    multiple of 3 must not be silently truncated into the reported total -- that is a primitive this
    tool cannot measure, which is exactly when it has to refuse rather than print a smaller number.
    """
    failures: list[str] = []
    counts: list[int] = []
    accessors = gltf.get("accessors", [])
    for index, primitive in enumerate(primitives):
        mode = primitive.get("mode", TRIANGLES_MODE)
        if mode != TRIANGLES_MODE:
            failures.append(f"primitive {index} declares mode {mode}, not {TRIANGLES_MODE} (TRIANGLES)")
            continue
        indices = primitive.get("indices")
        accessor = indices if indices is not None else primitive.get("attributes", {}).get("POSITION")
        if not isinstance(accessor, int) or not 0 <= accessor < len(accessors):
            which = "index" if indices is not None else "POSITION"
            failures.append(f"primitive {index} has no readable {which} accessor, so its triangles cannot be counted")
            continue
        count = accessors[accessor].get("count")
        if not isinstance(count, int):
            failures.append(f"primitive {index} declares an accessor without an element count")
            continue
        where = "indices" if indices is not None else "unindexed POSITION entries"
        if count % 3:
            failures.append(f"primitive {index} has {count} {where}, which is not a whole number of triangles")
            continue
        counts.append(count // 3)
    if not failures and sum(counts) != reported:
        failures.append(f"primitives account for {sum(counts)} triangles but the file reports {reported}")
    return failures


def base_colour_image_sources(gltf: dict) -> tuple[list[int], list[str]]:
    """Follow pbrMetallicRoughness.baseColorTexture -> textures[i].source -> images[j] for each material.

    A `baseColorTexture` that merely EXISTS proves nothing: it has to resolve, through its texture and
    that texture's image source, to the one image this run embedded, or the exported Base Color points
    at something the file does not contain.
    """
    textures = gltf.get("textures", [])
    images = gltf.get("images", [])
    sources: list[int] = []
    failures: list[str] = []
    for index, material in enumerate(gltf.get("materials", [])):
        base = (material.get("pbrMetallicRoughness") or {}).get("baseColorTexture")
        if not isinstance(base, dict) or not isinstance(base.get("index"), int):
            failures.append(f"material {index} declares no pbrMetallicRoughness.baseColorTexture index")
            continue
        texture_index = base["index"]
        if not 0 <= texture_index < len(textures):
            failures.append(
                f"material {index} baseColorTexture index {texture_index} names no declared texture "
                f"(the file declares {len(textures)})"
            )
            continue
        source = textures[texture_index].get("source")
        if not isinstance(source, int) or not 0 <= source < len(images):
            failures.append(
                f"material {index} texture {texture_index} resolves to image source {source!r}, outside "
                f"the {len(images)} declared images"
            )
            continue
        sources.append(source)
    return sources, failures


def non_mesh_scene_failures(gltf: dict) -> list[str]:
    """Cameras and lights are the objects that can ride along beside the reduced mesh; refuse them."""
    failures = []
    cameras = gltf.get("cameras") or []
    if cameras:
        failures.append(f"exported {len(cameras)} cameras beside the reduced mesh")
    lights = ((gltf.get("extensions") or {}).get("KHR_lights_punctual") or {}).get("lights") or []
    if lights:
        failures.append(f"exported {len(lights)} lights beside the reduced mesh")
    return failures


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
    sources, chain_failures = base_colour_image_sources(gltf)
    resolved = sorted(set(sources))
    print(
        "RESULT {0} bytes={1} meshes={2} primitives={3} materials={4} images={5} mime={6} tris={7} uv={8} "
        "basecolor={9}".format(
            destination, os.path.getsize(destination), result["meshes"], result["primitives"],
            result["materials"], result["images"], mime_types or "(none)", result["triangles"],
            uv_sets or "(none)", resolved or "(none)",
        )
    )

    failures = list(chain_failures)
    failures.extend(triangle_count_failures(gltf, primitives, result["triangles"]))
    failures.extend(non_mesh_scene_failures(gltf))
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
    elif len(sources) == result["materials"] and set(sources) != set(range(result["images"])):
        failures.append(
            f"Base Color resolves to image(s) {resolved} but the file embeds "
            f"{sorted(range(result['images']))}; the baked Base Color does not point at the embedded image"
        )
    missing = [name for name in REQUIRED_ATTRIBUTES if name not in attributes]
    if missing:
        failures.append(f"exported mesh lost attributes: {missing}")
    if uv_sets != ["TEXCOORD_0"]:
        failures.append(f"exported UV sets {uv_sets or '(none)'}, expected exactly ['TEXCOORD_0']")
    if failures:
        raise SystemExit(f"{destination}: bake/export verification failed: " + "; ".join(failures))
    return result


def isolate_for_export(obj: bpy.types.Object) -> None:
    """Leave the reduced mesh as the scene's only object, so nothing else can reach the GLB.

    The glTF importer creates an empty for each node it cannot merge into the mesh object, and a camera
    or a light in the source is imported beside the mesh; exporting the whole scene would ship them.
    The parent link is dropped with the world matrix copied first, because dropping it naively would
    move, rotate or rescale the mesh at export time.
    """
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = world
    for other in list(bpy.context.scene.objects):
        if other is not obj:
            bpy.data.objects.remove(other, do_unlink=True)


def main() -> None:
    source, destination, target, bake_px = arguments()
    build = assert_pinned_blender()
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
    # the exported bytes a JPEG rather than the PNG the format check in verify_export would refuse.
    image.file_format = "JPEG"
    low.data.materials.clear()
    low.data.materials.append(build_bake_material(image))
    for polygon in low.data.polygons:
        polygon.material_index = 0

    # Mesh-local, like the weld threshold: the cage and the ray distance are measured along the target's
    # vertex coordinates, so obj.dimensions (local box times world scale) would size them in another space.
    local_extent = mesh_local_max_dimension(low.data)
    if local_extent <= 0.0:
        raise SystemExit(f"{source}: the reduced mesh has no extent in any axis; there is no surface to bake from")
    bake_base_color(high, low, local_extent)
    bake_min, bake_max = assert_bake_has_content(image)
    image.pack()
    remove_other_uv_layers(low)
    print(
        "BAKED {0}px {1} seed={2} samples={3} cage={4:.6g} max_ray={5:.6g} margin={6}px "
        "rgb={7:.6g}..{8:.6g}".format(
            bake_px, BAKE_UV_NAME, BAKE_SEED, BAKE_SAMPLES, local_extent * CAGE_FRACTION,
            local_extent * MAX_RAY_FRACTION, BAKE_MARGIN_PX, bake_min, bake_max,
        )
    )

    isolate_for_export(low)
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
        f"SUMMARY BLENDER {PINNED_BLENDER_VERSION_STRING} build={build} DECIMATED {source}->{destination} "
        f"tris={before}->{after} target={target} BAKED {bake_px}px bytes={os.path.getsize(destination)}"
    )
    print(f"WROTE {destination}")


main()
