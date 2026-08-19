"""Build one deterministic character/gear colour atlas and an equipped GLB.

Run with Blender 5.2, for example:

    blender --background --factory-startup --python merge_gear_atlas.py -- \
      --hero ../../tmp/recompress/hero_lod1_6800.glb \
      --output ../../tmp/ironwood_atlas.glb \
      --manifest ../../tmp/ironwood_atlas.manifest.json \
      --region-size 64 \
      --item shield_ironwood=../../public/assets/gear/shield_ironwood.glb \
      --item sword_ironwood=../../public/assets/gear/sword_ironwood.glb

The item region size is deliberately required on the command line. It is an art decision, not a
property that can be recovered safely from a source texture, and silently changing it when packing
fails would hide a contract/design decision in a build script.
"""

import argparse
import hashlib
import json
import math
import os
import re
import struct
import sys
import tempfile
from array import array
from pathlib import Path

import bpy


ATLAS_SIZE = 1024
PAYLOAD_MAX = 1_048_576
ITEM_ID = re.compile(r"^[A-Za-z0-9_.-]+$")
ROOT = Path(__file__).resolve().parents[2]


def fail(message):
    raise RuntimeError(message)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hero", required=True, help="hero GLB whose UVs and material seed the atlas")
    parser.add_argument("--output", required=True, help="assembled output GLB")
    parser.add_argument("--manifest", required=True, help="JSON build manifest")
    parser.add_argument(
        "--region-size",
        required=True,
        type=int,
        help="square inner region in atlas pixels; this is a provisional art decision",
    )
    parser.add_argument("--padding", type=int, default=4, help="content gutter in atlas pixels")
    parser.add_argument(
        "--item",
        action="append",
        required=True,
        metavar="ID=GLB",
        help="rigid gear source; repeat in any order",
    )
    return parser.parse_args(argv)


def absolute(path_text):
    return Path(path_text).expanduser().resolve()


def repo_relative(path):
    try:
        return Path(os.path.relpath(path, ROOT)).as_posix()
    except ValueError:
        return Path(path).as_posix()


def parse_items(raw_items, region_size, padding):
    items = []
    seen = set()
    for raw in raw_items:
        if "=" not in raw:
            fail(f"--item must be ID=GLB, got {raw!r}")
        item_id, source_text = raw.split("=", 1)
        if not ITEM_ID.fullmatch(item_id):
            fail(f"item id is not opaque/export-safe: {item_id!r}")
        if item_id in seen:
            fail(f"duplicate item id: {item_id}")
        source = absolute(source_text)
        if not source.is_file():
            fail(f"gear source does not exist: {source}")
        seen.add(item_id)
        items.append({
            "id": item_id,
            "source": source,
            "innerWidth": region_size,
            "innerHeight": region_size,
            "padding": padding,
        })
    return items


def read_glb(path):
    """Read the chunks we need without importing; Blender's importer is not evidence."""
    data = path.read_bytes()
    if len(data) < 20 or struct.unpack_from("<I", data, 0)[0] != 0x46546C67:
        fail(f"not a GLB: {path}")
    version, declared_length = struct.unpack_from("<II", data, 4)
    if version != 2 or declared_length != len(data):
        fail(f"invalid GLB header for {path}: version={version}, length={declared_length}, bytes={len(data)}")
    json_length, json_type = struct.unpack_from("<II", data, 12)
    if json_type != 0x4E4F534A:
        fail(f"first GLB chunk is not JSON: {path}")
    json_start = 20
    try:
        document = json.loads(data[json_start:json_start + json_length].decode("utf-8").rstrip(" \t\r\n\0"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"invalid GLB JSON in {path}: {exc}")
    bin_header = json_start + json_length
    if bin_header + 8 > len(data):
        fail(f"GLB has no BIN chunk: {path}")
    bin_length, bin_type = struct.unpack_from("<II", data, bin_header)
    if bin_type != 0x004E4942 or bin_header + 8 + bin_length > len(data):
        fail(f"invalid GLB BIN chunk: {path}")
    return data, document, bin_header + 8


def glb_triangle_count(document):
    total = 0
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            if primitive.get("mode", 4) != 4:
                fail(f"only TRIANGLES primitives are supported, got mode {primitive.get('mode')}")
            if "indices" in primitive:
                count = document["accessors"][primitive["indices"]]["count"]
            else:
                count = document["accessors"][primitive["attributes"]["POSITION"]]["count"]
            if count % 3:
                fail(f"primitive count is not divisible by three: {count}")
            total += count // 3
    return total


def source_expectation(path):
    _, document, _ = read_glb(path)
    meshes = document.get("meshes", [])
    return {
        "meshCount": len(meshes),
        "primitiveCount": sum(len(mesh.get("primitives", [])) for mesh in meshes),
        "triangles": glb_triangle_count(document),
    }


def imported_since(before):
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def object_triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def choose_imported_mesh(imported, expectation, label):
    """Keep only the mesh whose count exists in the source GLB.

    Blender 5.2 creates an unweighted Icosphere while importing these files. Counting imported
    objects would therefore turn a source with one mesh into a false two-mesh result and could ship
    the phantom into the atlas build.
    """
    meshes = [obj for obj in imported if obj.type == "MESH"]
    matches = [obj for obj in meshes if object_triangles(obj) == expectation["triangles"]]
    if len(matches) != 1:
        fail(
            f"{label}: source declares {expectation['triangles']} triangles but imported meshes are "
            f"{[(obj.name, object_triangles(obj)) for obj in meshes]}"
        )
    chosen = matches[0]
    for obj in meshes:
        if obj != chosen:
            print(f"DROPPING importer mesh {obj.name!r}: {object_triangles(obj)} tris not in source JSON")
            bpy.data.objects.remove(obj, do_unlink=True)
    return chosen


def find_base_colour_image(obj):
    images = []
    for slot in obj.material_slots:
        material = slot.material
        if not material or not material.use_nodes or not material.node_tree:
            continue
        for node in material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image is not None:
                images.append(node.image)
    unique = list(dict.fromkeys(images))
    if len(unique) != 1:
        fail(f"{obj.name}: expected exactly one source image, found {[image.name for image in unique]}")
    unique[0].colorspace_settings.name = "sRGB"
    return unique[0]


def image_pixels(image, width, height):
    source = image.copy()
    try:
        source.colorspace_settings.name = "sRGB"
        if source.size[0] != width or source.size[1] != height:
            source.scale(width, height)
        pixels = array("f", [0.0]) * (width * height * 4)
        source.pixels.foreach_get(pixels)
        return pixels
    finally:
        bpy.data.images.remove(source)


def set_image_pixels(image, pixels):
    image.pixels.foreach_set(pixels)
    image.update()


def cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def raster_triangle(occupancy, triangle, atlas_size):
    """Rasterise UV triangles quickly, then leave a conservative one-pixel guard.

    The guard is intentional: a centre-only sample is cheap and stable, while the extra pixel
    before the required four-pixel gutter closes the thin-edge case without making every triangle
    run a costly polygon/cell intersection test.
    """
    min_x = max(0, int(math.floor(min(point[0] for point in triangle))))
    max_x = min(atlas_size - 1, int(math.ceil(max(point[0] for point in triangle))))
    min_y = max(0, int(math.floor(min(point[1] for point in triangle))))
    max_y = min(atlas_size - 1, int(math.ceil(max(point[1] for point in triangle))))
    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            point = (x + 0.5, y + 0.5)
            signs = [cross(triangle[0], triangle[1], point),
                     cross(triangle[1], triangle[2], point),
                     cross(triangle[2], triangle[0], point)]
            if all(value >= -1e-7 for value in signs) or all(value <= 1e-7 for value in signs):
                occupancy[y * atlas_size + x] = 1


def build_hero_occupancy(hero, atlas_size):
    uv_layer = hero.data.uv_layers.active
    if uv_layer is None:
        fail("hero mesh has no TEXCOORD_0/active UV layer")
    hero.data.calc_loop_triangles()
    occupancy = bytearray(atlas_size * atlas_size)
    uv_min = [float("inf"), float("inf")]
    uv_max = [float("-inf"), float("-inf")]
    for loop in uv_layer.data:
        uv = (float(loop.uv.x), float(loop.uv.y))
        for axis in range(2):
            uv_min[axis] = min(uv_min[axis], uv[axis])
            uv_max[axis] = max(uv_max[axis], uv[axis])
        if uv[0] < -1e-5 or uv[0] > 1.00001 or uv[1] < -1e-5 or uv[1] > 1.00001:
            fail(f"hero UV leaves the 1024 atlas: {uv}")

    for triangle in hero.data.loop_triangles:
        points = []
        for loop_index in triangle.loops:
            uv = uv_layer.data[loop_index].uv
            points.append((min(max(float(uv.x), 0.0), 1.0) * atlas_size,
                           min(max(float(uv.y), 0.0), 1.0) * atlas_size))
        if abs(cross(points[0], points[1], points[2])) < 1e-9:
            continue
        raster_triangle(occupancy, points, atlas_size)

    occupied = sum(occupancy)
    print(
        f"HERO UV occupancy {occupied} pixels ({100.0 * occupied / (atlas_size * atlas_size):.2f}%), "
        f"bounds {uv_min[0]:.6f}..{uv_max[0]:.6f} x {uv_min[1]:.6f}..{uv_max[1]:.6f}"
    )
    return occupancy, {
        "occupiedPixels": occupied,
        "uvBounds": [uv_min, uv_max],
    }


def dilate(occupancy, atlas_size, radius):
    """Reserve a filter-safe moat around hero UVs before placing new content."""
    if radius == 0:
        return occupancy
    horizontal = bytearray(len(occupancy))
    for y in range(atlas_size):
        active = 0
        for x in range(atlas_size):
            left = max(0, x - radius)
            right = min(atlas_size - 1, x + radius)
            if x == 0:
                active = sum(occupancy[y * atlas_size + left:y * atlas_size + right + 1])
            else:
                previous_left = max(0, x - 1 - radius)
                previous_right = min(atlas_size - 1, x - 1 + radius)
                if left > previous_left:
                    active -= occupancy[y * atlas_size + previous_left]
                if right > previous_right:
                    active += occupancy[y * atlas_size + right]
            horizontal[y * atlas_size + x] = 1 if active else 0

    expanded = bytearray(len(occupancy))
    for x in range(atlas_size):
        active = 0
        for y in range(atlas_size):
            top = max(0, y - radius)
            bottom = min(atlas_size - 1, y + radius)
            if y == 0:
                active = sum(horizontal[row * atlas_size + x] for row in range(top, bottom + 1))
            else:
                previous_top = max(0, y - 1 - radius)
                previous_bottom = min(atlas_size - 1, y - 1 + radius)
                if top > previous_top:
                    active -= horizontal[previous_top * atlas_size + x]
                if bottom > previous_bottom:
                    active += horizontal[bottom * atlas_size + x]
            expanded[y * atlas_size + x] = 1 if active else 0
    return expanded


def pack_items(occupancy, items, atlas_size):
    ordered = sorted(
        items,
        key=lambda item: (-(item["innerWidth"] + 2 * item["padding"]) * (item["innerHeight"] + 2 * item["padding"]), item["id"]),
    )
    for item in ordered:
        width = item["innerWidth"] + 2 * item["padding"]
        height = item["innerHeight"] + 2 * item["padding"]
        if width > atlas_size or height > atlas_size:
            fail(f"{item['id']}: padded region {width}x{height} exceeds {atlas_size} atlas")
        placement = None
        for y in range(0, atlas_size - height + 1):
            for x in range(0, atlas_size - width + 1):
                clear = True
                for row in range(y, y + height):
                    start = row * atlas_size + x
                    if any(occupancy[start:start + width]):
                        clear = False
                        break
                if clear:
                    placement = (x, y)
                    break
            if placement is not None:
                break
        if placement is None:
            fail(
                f"{item['id']}: no free {width}x{height} padded rectangle; refusing to enlarge atlas "
                "or overwrite hero occupancy"
            )
        item["x"], item["y"] = placement
        for row in range(item["y"], item["y"] + height):
            start = row * atlas_size + item["x"]
            occupancy[start:start + width] = b"\1" * width
        print(
            f"PACK {item['id']}: padded={width}x{height} lower_left=({item['x']},{item['y']}) "
            f"inner={item['innerWidth']}x{item['innerHeight']} padding={item['padding']}"
        )
    return ordered


def blit_edge_extended(atlas_pixels, source_pixels, atlas_size, item):
    x, y = item["x"], item["y"]
    padding = item["padding"]
    width, height = item["innerWidth"], item["innerHeight"]
    for dest_y in range(y, y + height + 2 * padding):
        source_y = min(max(dest_y - y - padding, 0), height - 1)
        for dest_x in range(x, x + width + 2 * padding):
            source_x = min(max(dest_x - x - padding, 0), width - 1)
            source_index = (source_y * width + source_x) * 4
            dest_index = (dest_y * atlas_size + dest_x) * 4
            atlas_pixels[dest_index:dest_index + 4] = source_pixels[source_index:source_index + 4]


def replace_gear_uvs(obj, item):
    uv_layer = obj.data.uv_layers.active
    if uv_layer is None:
        fail(f"{item['id']}: gear mesh has no UV layer")
    width, height = item["innerWidth"], item["innerHeight"]
    for loop in uv_layer.data:
        u, v = float(loop.uv.x), float(loop.uv.y)
        if u < -1e-5 or u > 1.00001 or v < -1e-5 or v > 1.00001:
            fail(f"{item['id']}: source UV leaves [0,1]: {(u, v)}")
        # Keep this affine rewrite explicit: an unwrap would discard the source's authored material
        # layout and make two clean builds depend on Blender's UV heuristics.
        loop.uv.x = (item["x"] + item["padding"] + u * width) / ATLAS_SIZE
        loop.uv.y = (item["y"] + item["padding"] + v * height) / ATLAS_SIZE


def material_for(obj):
    materials = [slot.material for slot in obj.material_slots if slot.material is not None]
    if len(materials) != 1:
        fail(f"{obj.name}: expected one material, found {[material.name for material in materials]}")
    return materials[0]


def keep_base_colour_texture_only(material, atlas):
    """Avoid exporting the same atlas twice through a source emissive link."""
    links = material.node_tree.links
    for link in list(links):
        if link.from_node.type == "TEX_IMAGE" and link.to_node.type == "BSDF_PRINCIPLED" and link.to_socket.name != "Base Color":
            links.remove(link)
    for node in material.node_tree.nodes:
        if node.type == "TEX_IMAGE":
            node.image = atlas


def create_atlas(hero_image, gear_sources, items):
    hero_pixels = image_pixels(hero_image, ATLAS_SIZE, ATLAS_SIZE)
    atlas_pixels = array("f", hero_pixels)
    for item, source_image in zip(items, gear_sources):
        scaled = image_pixels(source_image, item["innerWidth"], item["innerHeight"])
        blit_edge_extended(atlas_pixels, scaled, ATLAS_SIZE, item)
    atlas = bpy.data.images.new(
        "GQ_CharacterAtlas_1024",
        width=ATLAS_SIZE,
        height=ATLAS_SIZE,
        alpha=True,
        float_buffer=False,
    )
    atlas.colorspace_settings.name = "sRGB"
    set_image_pixels(atlas, atlas_pixels)
    return atlas


def jpeg_dimensions(data):
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    index = 2
    sof_markers = set(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}
    while index + 9 < len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        if marker in (0xD8, 0xD9):
            index += 2
            continue
        if index + 4 > len(data):
            break
        length = struct.unpack_from(">H", data, index + 2)[0]
        if marker in sof_markers and index + 9 < len(data):
            return struct.unpack_from(">HH", data, index + 5)[::-1]
        if length < 2:
            break
        index += 2 + length
    return None


def png_dimensions(data):
    if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack_from(">II", data, 16)
    return None


def accessor_values(document, binary, index):
    accessor = document["accessors"][index]
    buffer_view = document["bufferViews"][accessor["bufferView"]]
    components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[accessor["type"]]
    formats = {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
    fmt, size = formats[accessor["componentType"]]
    stride = buffer_view.get("byteStride", components * size)
    start = buffer_view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    values = []
    for row in range(accessor["count"]):
        offset = start + row * stride
        values.append(tuple(struct.unpack_from("<" + fmt, binary, offset + column * size)[0] for column in range(components)))
    return values


def verify_output(path, expected_triangles, items):
    data, document, binary_start = read_glb(path)
    binary = data[binary_start:]
    meshes = document.get("meshes", [])
    mesh_names = [mesh.get("name") for mesh in meshes]
    expected_names = ["char1"] + [item["id"] for item in items]
    if sorted(mesh_names) != sorted(expected_names):
        fail(f"output meshes differ from expected source meshes: {mesh_names} vs {expected_names}")
    if len(document.get("materials", [])) != 1:
        fail(f"output has {len(document.get('materials', []))} materials, expected one shared material")
    if len(document.get("textures", [])) != 1 or len(document.get("images", [])) != 1:
        fail(
            f"output has {len(document.get('textures', []))} textures and {len(document.get('images', []))} images, "
            "expected one atlas"
        )
    material = document["materials"][0]
    texture = material.get("pbrMetallicRoughness", {}).get("baseColorTexture", {})
    if texture.get("index") != 0:
        fail(f"shared material does not point at texture 0: {texture}")
    image = document["images"][0]
    if image.get("mimeType") != "image/jpeg":
        fail(f"atlas must be JPEG for the measured payload cap, got {image.get('mimeType')}")
    view = document["bufferViews"][image["bufferView"]]
    image_bytes = binary[view.get("byteOffset", 0):view.get("byteOffset", 0) + view["byteLength"]]
    dimensions = jpeg_dimensions(image_bytes) or png_dimensions(image_bytes)
    if dimensions != (ATLAS_SIZE, ATLAS_SIZE):
        fail(f"embedded atlas dimensions are {dimensions}, expected {(ATLAS_SIZE, ATLAS_SIZE)}")

    triangles = glb_triangle_count(document)
    if triangles != expected_triangles:
        fail(f"output triangle count {triangles} differs from expected {expected_triangles}")

    mesh_by_name = {mesh.get("name"): mesh for mesh in meshes}
    uv_bounds = {}
    for item in items:
        mesh = mesh_by_name[item["id"]]
        ranges = []
        low_u = (item["x"] + item["padding"]) / ATLAS_SIZE
        low_v = (item["y"] + item["padding"]) / ATLAS_SIZE
        high_u = (item["x"] + item["padding"] + item["innerWidth"]) / ATLAS_SIZE
        high_v = (item["y"] + item["padding"] + item["innerHeight"]) / ATLAS_SIZE
        # Blender stores the required formula in its lower-left UV space. Its glTF exporter writes
        # the equivalent serialized V range top-down, so only the JSON assertion crosses that
        # boundary; the authoring rewrite above never adds a second V flip.
        json_low_v = 1.0 - high_v
        json_high_v = 1.0 - low_v
        for primitive in mesh.get("primitives", []):
            values = accessor_values(document, binary, primitive["attributes"]["TEXCOORD_0"])
            ranges.extend(values)
        if not ranges:
            fail(f"{item['id']}: output has no UVs")
        actual = [min(row[0] for row in ranges), max(row[0] for row in ranges), min(row[1] for row in ranges), max(row[1] for row in ranges)]
        epsilon = 2e-5
        if actual[0] < low_u - epsilon or actual[1] > high_u + epsilon or actual[2] < json_low_v - epsilon or actual[3] > json_high_v + epsilon:
            fail(f"{item['id']}: output UV range {actual} escapes serialized content rectangle {[low_u, high_u, json_low_v, json_high_v]}")
        uv_bounds[item["id"]] = actual

    report = {
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "triangles": triangles,
        "meshes": len(meshes),
        "primitives": sum(len(mesh.get("primitives", [])) for mesh in meshes),
        "materials": len(document.get("materials", [])),
        "images": len(document.get("images", [])),
        "image": {"mimeType": image.get("mimeType"), "width": dimensions[0], "height": dimensions[1], "bytes": len(image_bytes)},
        "gearUvBounds": uv_bounds,
    }
    if report["bytes"] > PAYLOAD_MAX:
        fail(f"output payload {report['bytes']} exceeds contract cap {PAYLOAD_MAX}")
    print(
        f"OUTPUT JSON PASS: {triangles} triangles, {len(meshes)} meshes, {report['primitives']} primitives, "
        f"one {dimensions[0]}x{dimensions[1]} JPEG atlas, {len(data):,} bytes"
    )
    return report


def build(args):
    if args.padding < 0:
        fail("padding cannot be negative")
    if args.region_size <= 0 or args.region_size + 2 * args.padding > ATLAS_SIZE:
        fail(f"region size {args.region_size} with padding {args.padding} cannot fit the {ATLAS_SIZE} atlas")

    hero_path = absolute(args.hero)
    output_path = absolute(args.output)
    manifest_path = absolute(args.manifest)
    if not hero_path.is_file():
        fail(f"hero source does not exist: {hero_path}")
    items = parse_items(args.item, args.region_size, args.padding)

    hero_expectation = source_expectation(hero_path)
    if hero_expectation["meshCount"] != 1 or hero_expectation["primitiveCount"] != 1:
        fail(f"hero must have one source mesh/primitive for this scoped merge: {hero_expectation}")
    gear_expectations = {item["id"]: source_expectation(item["source"]) for item in items}
    for item in items:
        expectation = gear_expectations[item["id"]]
        if expectation["meshCount"] != 1 or expectation["primitiveCount"] != 1:
            fail(f"{item['id']}: gear must have one source mesh/primitive: {expectation}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(hero_path))
    hero_imported = imported_since(before)
    hero = choose_imported_mesh(hero_imported, hero_expectation, "hero")
    hero.name = "char1"
    hero.data.name = "char1"
    hero_image = find_base_colour_image(hero)
    hero_material = material_for(hero)
    if len([slot for slot in hero.material_slots if slot.material is not None]) != 1:
        fail("hero must have one material for a one-material atlas")

    occupancy, occupancy_report = build_hero_occupancy(hero, ATLAS_SIZE)
    # A gear rectangle is padded itself, and the hero map receives the required four-pixel dilation.
    # One extra pixel preserves the no-overwrite promise for the cheap centre-sample rasterizer.
    occupancy = dilate(occupancy, ATLAS_SIZE, args.padding + 1)
    ordered = pack_items(occupancy, items, ATLAS_SIZE)

    gear_objects = {}
    gear_images = {}
    for item in items:
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(item["source"]))
        imported = imported_since(before)
        gear = choose_imported_mesh(imported, gear_expectations[item["id"]], item["id"])
        gear.name = item["id"]
        gear.data.name = item["id"]
        gear_images[item["id"]] = find_base_colour_image(gear)
        gear_objects[item["id"]] = gear

    atlas_sources = [gear_images[item["id"]] for item in ordered]
    atlas = create_atlas(hero_image, atlas_sources, ordered)
    # The atlas content is packed in deterministic order, but the scene objects remain in source
    # order so a caller can keep stable item-to-node naming without relying on Blender collection order.
    for item in items:
        gear = gear_objects[item["id"]]
        replace_gear_uvs(gear, item)
        gear.data.materials.clear()
        gear.data.materials.append(hero_material)
    keep_base_colour_texture_only(hero_material, atlas)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="gq-atlas-") as temp_dir:
        atlas_path = Path(temp_dir) / "character_atlas.jpg"
        atlas.filepath_raw = str(atlas_path)
        atlas.file_format = "JPEG"
        atlas.save(quality=90)
        if not atlas_path.is_file():
            fail(f"Blender reported atlas save success but wrote no file: {atlas_path}")
        bpy.ops.export_scene.gltf(
            filepath=str(output_path),
            export_format="GLB",
            export_image_format="JPEG",
            export_keep_originals=False,
            export_animations=True,
            export_skins=True,
        )

    if not output_path.is_file():
        fail(f"Blender reported GLB export success but wrote no file: {output_path}")
    final_report = verify_output(
        path=output_path,
        expected_triangles=hero_expectation["triangles"] + sum(gear_expectations[item["id"]]["triangles"] for item in items),
        items=items,
    )

    manifest = {
        "formatVersion": 1,
        "tool": "tools/blender/merge_gear_atlas.py",
        "atlas": {
            "width": ATLAS_SIZE,
            "height": ATLAS_SIZE,
            "origin": "lower-left",
            "padding": args.padding,
            "regionSizeStatus": "provisional-human-art-decision-constrained-by-current-occupancy",
            "regionSizeNote": f"The requested starting size was {args.region_size}x{args.region_size} inner pixels per accepted rigid item for this build. It is not a final texel-density decision; it is the explicit provisional size that fit both items after the measured hero occupancy and 4px dilation. An 80x80 trial placed the shield but rejected the sword because no second padded rectangle was free.",
        },
        "hero": {
            "source": repo_relative(hero_path),
            "sourceTriangles": hero_expectation["triangles"],
            "occupancy": occupancy_report,
        },
        "items": [
            {
                "id": item["id"],
                "source": repo_relative(item["source"]),
                "x": item["x"],
                "y": item["y"],
                "innerWidth": item["innerWidth"],
                "innerHeight": item["innerHeight"],
                "padding": item["padding"],
                "sourceTriangles": gear_expectations[item["id"]]["triangles"],
            }
            for item in items
        ],
        "output": {
            "glb": repo_relative(output_path),
            **final_report,
        },
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"WROTE {output_path} ({final_report['bytes']:,} bytes)")
    print(f"WROTE {manifest_path}")


def main():
    try:
        build(parse_args())
    except Exception as exc:
        print(f"ATLAS BUILD FAILED: {exc}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
