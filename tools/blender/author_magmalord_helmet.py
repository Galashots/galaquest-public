"""Author the bounded MagmaLord Helmet candidate with Blender 5.2.

Usage:
  blender --background --factory-startup --python tools/blender/author_magmalord_helmet.py -- \
    <output.fbx> <working.blend> <report.json>

The script is the editable public source recipe. It makes one helmet candidate, uses no provider,
and exports three renderer groups: forged plate, horns, and molten seams.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector


def args():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(values) != 3:
        raise SystemExit("expected <output.fbx> <working.blend> <report.json>")
    return [os.path.abspath(value) for value in values]


def material(name, rgba, metallic, roughness, emission=None):
    value = bpy.data.materials.new(name)
    value.diffuse_color = rgba
    value.use_nodes = True
    node = value.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = rgba
    node.inputs["Metallic"].default_value = metallic
    node.inputs["Roughness"].default_value = roughness
    if emission:
        node.inputs["Emission Color"].default_value = emission
        node.inputs["Emission Strength"].default_value = 4.0
    return value


def bevel(object_, width=0.018, segments=2):
    modifier = object_.modifiers.new("Forged edge", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    bpy.context.view_layer.objects.active = object_
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return object_


def cube(name, location, scale, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    value = bpy.context.object
    value.name = name
    value.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return bevel(value)


def hemisphere(name):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=(0, 0, 0.17))
    value = bpy.context.object
    value.name = name
    value.scale = (0.28, 0.255, 0.30)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mesh = value.data
    keep = [polygon for polygon in mesh.polygons
            if all(mesh.vertices[index].co.z >= 0.155 for index in polygon.vertices)]
    delete = [polygon.index for polygon in mesh.polygons if polygon not in keep]
    bpy.context.view_layer.objects.active = value
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for index in delete:
        mesh.polygons[index].select = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="FACE")
    bpy.ops.object.mode_set(mode="OBJECT")
    solid = value.modifiers.new("Plate thickness", "SOLIDIFY")
    solid.thickness = 0.025
    solid.offset = -0.3
    bpy.ops.object.modifier_apply(modifier=solid.name)
    return value


def cone_between(name, start, end, start_radius, end_radius):
    start, end = Vector(start), Vector(end)
    direction = end - start
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=start_radius, radius2=end_radius,
                                    depth=direction.length, location=(start + end) / 2)
    value = bpy.context.object
    value.name = name
    value.rotation_mode = "QUATERNION"
    value.rotation_quaternion = direction.to_track_quat("Z", "Y")
    return value


def horn(side):
    points = [
        (side * 0.22, -0.015, 0.30),
        (side * 0.35, -0.005, 0.34),
        (side * 0.46, 0.015, 0.42),
        (side * 0.52, 0.045, 0.53),
        (side * 0.48, 0.08, 0.62),
    ]
    radii = [0.09, 0.075, 0.058, 0.038, 0.008]
    return [cone_between("Horn", points[index], points[index + 1], radii[index], radii[index + 1])
            for index in range(len(points) - 1)]


def tube(name, points, radius):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 1
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for target, source in zip(spline.points, points):
        target.co = (*source, 1)
    value = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(value)
    bpy.context.view_layer.objects.active = value
    value.select_set(True)
    bpy.ops.object.convert(target="MESH")
    return value


def join_objects(name, objects, material_):
    bpy.ops.object.select_all(action="DESELECT")
    for value in objects:
        value.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    result.data.materials.clear()
    result.data.materials.append(material_)
    for polygon in result.data.polygons:
        polygon.use_smooth = name != "MoltenSeams"
    return result


def main():
    output_fbx, output_blend, output_report = args()
    for path in (output_fbx, output_blend, output_report):
        os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    plate_material = material("MagmaLord Forged Plate", (0.025, 0.018, 0.016, 1), 0.82, 0.27)
    horn_material = material("MagmaLord Horn", (0.10, 0.045, 0.025, 1), 0.15, 0.42)
    seam_material = material("MagmaLord Molten Seam", (1.0, 0.12, 0.005, 1), 0.1, 0.22,
                             (1.0, 0.035, 0.001, 1))

    plates = [hemisphere("Crown")]
    plates += [
        cube("BrowLeft", (-0.13, 0.238, 0.17), (0.14, 0.035, 0.045), (math.radians(-9), 0, math.radians(-7))),
        cube("BrowRight", (0.13, 0.238, 0.17), (0.14, 0.035, 0.045), (math.radians(-9), 0, math.radians(7))),
        cube("CheekLeft", (-0.225, 0.215, 0.035), (0.048, 0.032, 0.12), (math.radians(-8), 0, math.radians(-10))),
        cube("CheekRight", (0.225, 0.215, 0.035), (0.048, 0.032, 0.12), (math.radians(-8), 0, math.radians(10))),
        cube("Nape", (0, -0.225, 0.03), (0.22, 0.032, 0.105), (math.radians(8), 0, 0)),
        cube("Crest", (0, -0.015, 0.47), (0.035, 0.12, 0.11), (0, 0, 0)),
    ]
    horns = horn(-1) + horn(1)
    seams = [
        tube("CrownRift", [(-0.02, 0.247, 0.19), (0.01, 0.257, 0.27), (-0.015, 0.235, 0.35),
                           (0.025, 0.18, 0.43)], 0.012),
        tube("BrowRift", [(-0.25, 0.277, 0.19), (-0.12, 0.282, 0.155), (0, 0.284, 0.18),
                          (0.12, 0.282, 0.155), (0.25, 0.277, 0.19)], 0.011),
        tube("LeftRift", [(-0.25, 0.247, 0.12), (-0.20, 0.253, 0.05), (-0.22, 0.248, -0.035)], 0.009),
        tube("RightRift", [(0.25, 0.247, 0.12), (0.20, 0.253, 0.05), (0.22, 0.248, -0.035)], 0.009),
    ]

    groups = [join_objects("ForgedPlate", plates, plate_material),
              join_objects("Horns", horns, horn_material),
              join_objects("MoltenSeams", seams, seam_material)]
    root = bpy.data.objects.new("MagmaLordHelmet", None)
    bpy.context.collection.objects.link(root)
    for group in groups:
        group.parent = root

    bpy.ops.wm.save_as_mainfile(filepath=output_blend)
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for group in groups:
        group.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.fbx(filepath=output_fbx, use_selection=True, object_types={"EMPTY", "MESH"},
                             apply_unit_scale=True, axis_forward="-Z", axis_up="Y",
                             bake_anim=False, add_leaf_bones=False, path_mode="AUTO")

    triangles = sum(sum(len(poly.vertices) - 2 for poly in group.data.polygons) for group in groups)
    with open(output_report, "w", encoding="utf-8") as stream:
        json.dump({
            "schema": "galaquest-magmalord-candidate-report",
            "schemaVersion": 1,
            "blenderVersion": bpy.app.version_string,
            "method": "direct-blender deterministic public recipe",
            "providerSpend": False,
            "promotion": False,
            "rendererGroups": [group.name for group in groups],
            "triangles": triangles,
            "materials": [plate_material.name, horn_material.name, seam_material.name],
        }, stream, indent=2)
        stream.write("\n")


main()
