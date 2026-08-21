"""Bake supervised anatomy coverage labels into a one-draw skinned mesh.

Human/DCC workflow:
  1. Open the accepted character in Blender.
  2. Keep its real shipping material as material slot 0.
  3. Add temporary material slots named `GQ_REGION__hair`, `GQ_REGION__ears`, etc.
  4. In Edit Mode, select the faces that belong to a semantic region and Assign that temp material.
     Untagged faces are `core`.
  5. Save the working .blend.
  6. Bake/export:

       blender working.blend --background \
         --python tools/blender/bake_anatomy_regions.py -- out.glb [mesh-name]

The script writes a CORNER-domain float attribute named `_GQ_REGION`, restores every polygon to the
real material, removes the temporary marker materials, verifies that the render mesh has one material,
and exports GLB. The marker materials are authoring UI only; they must never become shipping draw
calls.

Why CORNER rather than POINT: a semantic boundary can pass through a position/UV seam. Authoring the
label per face corner lets glTF split boundary vertices when necessary while every exported triangle
still has one unambiguous region code. Runtime validation in anatomyOcclusion.js fails closed if that
invariant is violated.

This intentionally does NOT guess hair/ears from colour or bounds. Automated proposals are useful,
but a supervised face selection is the production authority for the base topology.
"""

from __future__ import annotations

import json
import os
import sys

import bpy

ATTRIBUTE_NAME = "_GQ_REGION"
MARKER_PREFIX = "GQ_REGION__"
REGION_CODES = {
    "core": 0,
    "hair": 1,
    "ears": 2,
    "beard": 3,
    "torso": 4,
    "upper-arms": 5,
    "lower-arms": 6,
    "hands": 7,
    "hips-legs": 8,
    "feet": 9,
}


def argv_after_double_dash() -> list[str]:
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def skinned_meshes() -> list[bpy.types.Object]:
    result = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        if any(mod.type == "ARMATURE" for mod in obj.modifiers) or obj.parent_type == "ARMATURE":
            result.append(obj)
    return result


def resolve_mesh(name: str | None) -> bpy.types.Object:
    if name:
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH":
            raise SystemExit(f"ABORT: no mesh object named {name!r}")
        return obj
    candidates = skinned_meshes()
    if len(candidates) != 1:
        names = [obj.name for obj in candidates]
        raise SystemExit(
            "ABORT: expected exactly one skinned mesh; "
            f"found {len(candidates)} {names}. Pass the mesh name as the second argument."
        )
    return candidates[0]


def marker_region(material: bpy.types.Material | None) -> str | None:
    if material is None or not material.name.startswith(MARKER_PREFIX):
        return None
    region = material.name[len(MARKER_PREFIX) :].strip().lower()
    if region not in REGION_CODES or region == "core":
        raise SystemExit(
            f"ABORT: marker {material.name!r} names unsupported region {region!r}; "
            f"expected one of {sorted(name for name in REGION_CODES if name != 'core')}"
        )
    return region


def bake(mesh_obj: bpy.types.Object) -> dict:
    mesh = mesh_obj.data
    if len(mesh.materials) < 1 or mesh.materials[0] is None:
        raise SystemExit("ABORT: material slot 0 must be the real shipping character material")
    if marker_region(mesh.materials[0]) is not None:
        raise SystemExit("ABORT: material slot 0 cannot be a GQ_REGION marker")

    material_region = {}
    for index, material in enumerate(mesh.materials):
        region = marker_region(material)
        if region is not None:
            material_region[index] = region

    if not material_region:
        raise SystemExit(
            f"ABORT: no {MARKER_PREFIX}<region> marker materials found; "
            "supervise/select the anatomy faces before baking"
        )

    existing = mesh.attributes.get(ATTRIBUTE_NAME)
    if existing is not None:
        mesh.attributes.remove(existing)
    attribute = mesh.attributes.new(name=ATTRIBUTE_NAME, type="FLOAT", domain="CORNER")

    face_counts = {name: 0 for name in REGION_CODES}
    loop_counts = {name: 0 for name in REGION_CODES}
    polygon_regions = []

    for poly in mesh.polygons:
        region = material_region.get(poly.material_index, "core")
        code = float(REGION_CODES[region])
        face_counts[region] += 1
        loop_counts[region] += poly.loop_total
        polygon_regions.append(region)
        for loop_index in poly.loop_indices:
            attribute.data[loop_index].value = code

    # Marker materials are edit-time overlays only. Return every face to the real material before
    # removing the slots, so the shipping mesh remains one material / one render primitive.
    for poly in mesh.polygons:
        poly.material_index = 0
    while len(mesh.materials) > 1:
        mesh.materials.pop(index=len(mesh.materials) - 1)

    if len(mesh.materials) != 1 or any(poly.material_index != 0 for poly in mesh.polygons):
        raise SystemExit("ABORT: failed to restore a one-material shipping mesh")

    # Cheap boundary sanity: every polygon is one semantic region by construction. Recording exact
    # counts makes the bake reviewable and catches accidental whole-body assignments.
    tagged_faces = sum(face_counts[name] for name in REGION_CODES if name != "core")
    if tagged_faces == 0:
        raise SystemExit("ABORT: marker materials existed but no faces were assigned to them")

    mesh.update()
    return {
        "mesh": mesh_obj.name,
        "attribute": ATTRIBUTE_NAME,
        "regionCodes": REGION_CODES,
        "faceCounts": face_counts,
        "loopCounts": loop_counts,
        "totalFaces": len(mesh.polygons),
        "taggedFaces": tagged_faces,
        "shippingMaterial": mesh.materials[0].name,
        "shippingMaterialSlots": len(mesh.materials),
    }


def export_glb(out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_attributes=True,
        export_animations=True,
        export_skins=True,
    )


def main() -> None:
    args = argv_after_double_dash()
    if not args:
        raise SystemExit(
            "usage: blender working.blend --background --python "
            "tools/blender/bake_anatomy_regions.py -- <out.glb> [mesh-name]"
        )
    out_path = os.path.abspath(args[0])
    mesh_name = args[1] if len(args) > 1 else None
    mesh_obj = resolve_mesh(mesh_name)
    report = bake(mesh_obj)
    export_glb(out_path)
    report["output"] = out_path
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
