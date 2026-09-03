"""Convert one existing GalaQuest GLB to an FBX using Blender's built-in import/export path.

Usage:
  blender --background --factory-startup --python convert_glb_to_fbx.py -- \
    <source.glb> <destination.fbx> <semantic-id>

The script intentionally performs no modelling, retargeting, material repair, or anatomy change.
It is a transfer tool only. Textures are packed by the glTF importer and embedded in the FBX when
the exporter supports them, so the derivative is self-contained for Unity's native model importer.
"""

import os
import sys
import hashlib
import datetime

import bpy


def install_stable_fbx_ids():
    """Make Blender's FBX object ids independent of Python's per-process hash seed.

    Blender's exporter derives FBX ids from ``hash(key)``. Python deliberately randomizes
    string hashes between processes, which otherwise makes otherwise identical exports differ
    byte-for-byte. The key set and collision policy remain the add-on's; only the hash source is
    replaced with a stable digest for this controlled transfer.
    """
    from io_scene_fbx import fbx_utils

    def stable_hash(value):
        digest = hashlib.sha256(repr(value).encode("utf-8")).digest()
        return int.from_bytes(digest[:8], "little") & ((2**63) - 1)

    def stable_key_to_uuid(uuids, key):
        if isinstance(key, int) and 0 <= key < 2**63:
            value = key
        else:
            value = stable_hash(key)
        if value >= 2**63:
            value //= 2
        if value > int(1e9):
            shortened = value % int(1e9)
            if shortened not in uuids:
                value = shortened
        if value in uuids:
            increment = 1 if value < 2**62 else -1
            while value in uuids:
                value += increment
                if not (0 <= value < 2**63):
                    raise ValueError(f"unable to generate deterministic FBX id for {key!r}")
        return fbx_utils.UUID(value)

    fbx_utils._key_to_uuid = stable_key_to_uuid
    # The exporter also uses ObjectWrapper instances as set members while ordering
    # animation relationships. Their default hash delegates to the randomized Python
    # string hash, so stabilize that ordering too.
    fbx_utils.ObjectWrapper.__hash__ = lambda self: stable_hash(self.key)

    # Blender's exporter still writes the wall-clock CreationTimeStamp even when metadata
    # fields are disabled. Keep that header field fixed so the derivative hash is reproducible.
    from io_scene_fbx import export_fbx_bin
    original_header = export_fbx_bin.fbx_header_elements

    def stable_header(root, scene_data, time=None):
        return original_header(root, scene_data, datetime.datetime(1970, 1, 1))

    export_fbx_bin.fbx_header_elements = stable_header


def arguments():
    if "--" not in sys.argv:
        raise SystemExit("expected Blender arguments after --: <source.glb> <destination.fbx> <semantic-id>")
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 3:
        raise SystemExit("expected Blender arguments after --: <source.glb> <destination.fbx> <semantic-id>")
    return tuple(os.path.abspath(value) for value in values[:2]) + (values[2],)


def describe(label):
    objects = list(bpy.context.scene.objects)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    actions = list(bpy.data.actions)
    materials = list(bpy.data.materials)
    print(
        f"{label} objects={len(objects)} meshes={len(meshes)} armatures={len(armatures)} "
        f"materials={len(materials)} actions={len(actions)}"
    )
    for armature in armatures:
        print(f"{label} armature={armature.name!r} bones={len(armature.data.bones)}")
    for action in actions:
        print(f"{label} action={action.name!r} frames={tuple(action.frame_range)}")
    return objects, meshes, armatures, actions, materials


def source_objects(objects, meshes, armatures):
    # Blender's glTF importer can fabricate an unweighted Icosphere while opening a skinned GLB.
    # It is not in the source file and must never cross the conversion boundary. A real skinned
    # mesh has vertex groups; a static source has no armature and therefore keeps every imported
    # mesh. The rejected names are printed so the batch log proves this guard ran.
    if not armatures:
        return objects, meshes
    source_meshes = [mesh for mesh in meshes if len(mesh.vertex_groups) > 0]
    rejected = [mesh for mesh in meshes if mesh not in source_meshes]
    for mesh in rejected:
        print(f"REJECTED_IMPORT_HELPER mesh={mesh.name!r} vertex_groups={len(mesh.vertex_groups)}")
    if not source_meshes:
        raise SystemExit("armature imported but no weighted source mesh was found")
    selected_objects = [obj for obj in objects if obj.type != "MESH" or obj in source_meshes]
    return selected_objects, source_meshes


def prepare_embedded_images(destination):
    """Give packed GLB images stable adjacent paths so FBX and Unity native import retain bytes."""
    derivative_paths = []
    destination_directory = os.path.dirname(destination)
    destination_stem = os.path.splitext(os.path.basename(destination))[0]
    for index, image in enumerate(bpy.data.images):
        if image.type != "IMAGE" or image.packed_file is None:
            continue
        extension = (image.file_format or "PNG").lower()
        if extension == "jpeg":
            extension = "jpg"
        derivative_path = os.path.join(destination_directory, f"{destination_stem}.texture-{index}.{extension}")
        with open(derivative_path, "wb") as handle:
            handle.write(image.packed_file.data)
        image.filepath = derivative_path
        derivative_paths.append(derivative_path)
        print(f"PREPARED_EMBEDDED_IMAGE name={image.name!r} bytes={len(image.packed_file.data)}")
    return derivative_paths


def main():
    source, destination, semantic_id = arguments()
    if not os.path.isfile(source):
        raise SystemExit(f"missing source GLB: {source}")
    if not destination.lower().endswith(".fbx"):
        raise SystemExit(f"destination must be FBX: {destination}")
    os.makedirs(os.path.dirname(destination), exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    install_stable_fbx_ids()
    result = bpy.ops.import_scene.gltf(filepath=source, import_pack_images=True)
    if "FINISHED" not in result:
        raise SystemExit(f"GLB import did not finish for {source}: {result}")
    objects, meshes, armatures, actions, materials = describe("IMPORTED")
    if not meshes:
        raise SystemExit(f"no mesh imported from {source}")
    objects, meshes = source_objects(objects, meshes, armatures)
    print(f"SOURCE_OBJECTS objects={len(objects)} meshes={len(meshes)} armatures={len(armatures)}")

    # Select only objects originating in the GLB. The factory-startup scene is otherwise empty,
    # but selection is explicit so this remains safe if Blender's importer adds helper objects.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    # Preserve the imported object transforms and all imported actions. Blender's FBX exporter
    # performs the FBX axis conversion; Unity's native importer then owns its FBX interpretation.
    # No bake/retarget or source-material normalization is performed here.
    derivative_images = prepare_embedded_images(destination)
    result = bpy.ops.export_scene.fbx(
            filepath=destination,
            use_selection=True,
            global_scale=1.0,
            apply_unit_scale=True,
            apply_scale_options="FBX_SCALE_NONE",
            axis_forward="-Z",
            axis_up="Y",
            use_space_transform=True,
            bake_space_transform=False,
            object_types={"EMPTY", "MESH", "ARMATURE"},
            use_mesh_modifiers=True,
            mesh_smooth_type="FACE",
            use_custom_props=False,
            use_metadata=False,
            add_leaf_bones=False,
            primary_bone_axis="Y",
            secondary_bone_axis="X",
            use_armature_deform_only=False,
            bake_anim=bool(armatures and actions),
            bake_anim_use_all_actions=bool(armatures and actions),
            bake_anim_use_nla_strips=False,
            bake_anim_use_all_bones=True,
            bake_anim_force_startend_keying=True,
            bake_anim_step=1.0,
            bake_anim_simplify_factor=0.0,
            path_mode="COPY",
            embed_textures=True,
    )
    if "FINISHED" not in result:
        raise SystemExit(f"FBX export did not finish for {destination}: {result}")
    if not os.path.isfile(destination) or os.path.getsize(destination) == 0:
        raise SystemExit(f"FBX export reported success but wrote no bytes: {destination}")
    print(f"DERIVATIVE_TEXTURES count={len(derivative_images)}")

    print(f"CONVERTED semanticId={semantic_id!r} source={source!r} destination={destination!r}")
    print(f"EXPORT_SELECTION objects={len(objects)} meshes={len(meshes)} armatures={len(armatures)} actions={len(actions)} materials={len(materials)}")
    for armature in armatures:
        print(f"EXPORT_SELECTION armature={armature.name!r} bones={len(armature.data.bones)}")
    for action in actions:
        print(f"EXPORT_SELECTION action={action.name!r} frames={tuple(action.frame_range)}")
    print(f"DERIVATIVE_BYTES {os.path.getsize(destination)}")


main()
