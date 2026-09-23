"""Reduce a rigid gear GLB to a runtime triangle budget, and nothing else.

blender --background --factory-startup --python decimate_gear.py -- <in.glb> <out.glb> <target_tris>

Rigid gear arrives from a generator at 10-100x the triangles the game budget allows; a Dawnwarden
helmet candidate is 311,626 triangles against a 2,000 triangle Owner budget. The production order in
docs/pipeline/character-armoring.md is

    reference -> generate -> silhouette review -> remesh/decimate -> material normalization -> ...

and this is the remesh/decimate step, and only that step. It imports, collapse-decimates to the
requested budget, and exports. It performs no modelling, no anatomy, no rigging, no material
normalization, and no fit. Decimation is not appearance acceptance: the reduced bytes still need the
visual review in docs/review-guides/asset-visual-review.md.

Guarantees, all verified and printed rather than assumed:

* the source is refused unless it is rigid single-mesh/single-primitive/single-material gear, so this
  cannot silently mangle a skinned character with a rig (use decimate_hero.py for the naked hero);
* the output is re-read from disk and must declare <= the target triangles, one mesh, one primitive,
  one material, and POSITION/NORMAL/TEXCOORD_0 -- the geometry attributes this pipeline depends on;
* the source file is never written to.

UV handling: collapse decimation interpolates the UV layer, but an unconstrained collapse happily
collapses across UV seams and tears a small texture island apart. The first attempt therefore delimits
by UV. Only if that cannot reach the budget does it retry unconstrained, and it says so.

Determinism: for a given input, target and Blender version the collapse and the export are
deterministic, so identical inputs produce identical bytes. Verify by running twice and diffing, which
is what the A1 note records.
"""

from __future__ import annotations

import json
import os
import struct
import sys

import bpy

# Blender's collapse decimation lands within a face or two of the requested ratio rather than exactly
# on it, so a ratio that is merely close to the budget is not good enough for a hard cap.
MAX_RATIO_ATTEMPTS = 4
REQUIRED_ATTRIBUTES = ("POSITION", "NORMAL", "TEXCOORD_0")


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


def primitive_triangles(gltf: dict, primitive: dict) -> int | None:
    indices = primitive.get("indices")
    if indices is not None:
        count = gltf.get("accessors", [{}])[indices].get("count")
    else:
        count = gltf.get("accessors", [{}])[primitive["attributes"]["POSITION"]].get("count")
    return None if count is None else count // 3


def declared_shape(gltf: dict) -> dict:
    primitives = [p for mesh in gltf.get("meshes", []) for p in mesh.get("primitives", [])]
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


def arguments() -> tuple[str, str, int]:
    if "--" not in sys.argv:
        raise SystemExit("expected Blender arguments after --: <in.glb> <out.glb> <target_tris>")
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 3:
        raise SystemExit("expected Blender arguments after --: <in.glb> <out.glb> <target_tris>")
    try:
        target = int(values[2])
    except ValueError:
        raise SystemExit(f"target_tris must be a whole number, got {values[2]!r}")
    if target < 1:
        raise SystemExit(f"target_tris must be at least 1, got {target}")
    return os.path.abspath(values[0]), os.path.abspath(values[1]), target


# The GalaQuest derivative lane pins Blender 4.5 (see tools/unity-migration/convert-gear-asset.mjs);
# the determinism claim above only holds for one version, so refuse any other.
PINNED_BLENDER = (4, 5)


def assert_pinned_blender() -> None:
    if tuple(bpy.app.version[:2]) != PINNED_BLENDER:
        raise SystemExit(
            f"Blender {bpy.app.version_string} is not the pinned {PINNED_BLENDER[0]}.{PINNED_BLENDER[1]}.x; "
            "decimation output is only deterministic per Blender version"
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


def evaluated_triangles(obj: bpy.types.Object) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    count = len(mesh.loop_triangles)
    evaluated.to_mesh_clear()
    return count


def main() -> None:
    source, destination, target = arguments()
    assert_pinned_blender()
    if not os.path.isfile(source):
        raise SystemExit(f"missing source GLB: {source}")
    if os.path.realpath(destination) == os.path.realpath(source):
        raise SystemExit(f"destination is the source file; refusing to overwrite {source}")
    if not destination.lower().endswith(".glb"):
        raise SystemExit(f"destination must be GLB: {destination}")

    declared = declared_shape(gltf_json_chunk(source))
    print(
        "SOURCE {0} meshes={1} primitives={2} materials={3} images={4} tris={5}".format(
            source, declared["meshes"], declared["primitives"], declared["materials"],
            declared["images"], declared["triangles"],
        )
    )
    obj = import_single_rigid_mesh(source, declared)
    uv_layers = [layer.name for layer in obj.data.uv_layers]
    if not uv_layers:
        raise SystemExit(f"{source}: imported mesh has no UV layer; nothing for the texture to map onto")
    obj.data.calc_loop_triangles()
    before = len(obj.data.loop_triangles)
    if before <= target:
        raise SystemExit(f"{source}: already {before} tris, at or under the {target} budget; nothing to do")
    print(f"MESH {obj.name!r} tris={before} verts={len(obj.data.vertices)} uv={uv_layers} target={target}")

    modifier = obj.modifiers.new("gq_decimate", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"

    chosen: tuple[float, set[str]] | None = None
    for delimit in ({"UV"}, set()):
        ratio = target / before
        modifier.delimit = delimit
        for attempt in range(1, MAX_RATIO_ATTEMPTS + 1):
            modifier.ratio = ratio
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            after = evaluated_triangles(obj)
            label = "uv-delimited" if delimit else "unconstrained"
            print(f"ATTEMPT {label} {attempt} ratio={ratio:.6f} -> {after} tris")
            if after <= target:
                chosen = (ratio, delimit)
                break
            # The ratio is a face-count target, so the miss is small and one correction suffices.
            ratio = max(1e-9, ratio * target / after * 0.98)
        if chosen:
            break

    if not chosen:
        raise SystemExit(
            f"could not reach {target} triangles from {before}; the budget needs a different "
            "reduction strategy (retopology) rather than a lower ratio"
        )
    ratio, delimit = chosen
    print(f"DECIMATED {before} -> {after} tris ({100.0 * after / before:.2f}%) delimit={sorted(delimit) or 'none'}")

    os.makedirs(os.path.dirname(destination), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=destination,
        export_format="GLB",
        export_apply=True,
        export_animations=False,
        export_skins=False,
    )
    if not os.path.isfile(destination) or os.path.getsize(destination) == 0:
        raise SystemExit(f"export reported success but wrote nothing to {destination}")

    result = declared_shape(gltf_json_chunk(destination))
    exported = gltf_json_chunk(destination)
    attributes = {
        name for primitive in (p for mesh in exported.get("meshes", []) for p in mesh.get("primitives", []))
        for name in primitive.get("attributes", {})
    }
    missing = [name for name in REQUIRED_ATTRIBUTES if name not in attributes]
    print(
        "RESULT {0} bytes={1} meshes={2} primitives={3} materials={4} images={5} tris={6}".format(
            destination, os.path.getsize(destination), result["meshes"], result["primitives"],
            result["materials"], result["images"], result["triangles"],
        )
    )
    if result["triangles"] > target:
        raise SystemExit(f"exported {result['triangles']} tris, over the {target} budget")
    if (result["meshes"], result["primitives"], result["materials"]) != (1, 1, 1):
        raise SystemExit(f"exported shape changed: {result['meshes']}/{result['primitives']}/{result['materials']}")
    if missing:
        raise SystemExit(f"exported mesh lost attributes: {missing}")
    print(f"WROTE {destination}")


main()
