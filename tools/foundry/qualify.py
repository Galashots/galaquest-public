"""Run the binary gates against a .blend and emit a JSON report.

    blender --background --python tools/foundry/qualify.py -- \
        --blend foundry/candidates/claude/hero_region.blend \
        --out foundry/candidates/claude/qualification.json \
        --deform-expected 30

With no --blend it builds the clean fixture from fixture.py instead, which is a useful smoke check
that the harness itself still runs.

The report is machine-readable on purpose. "The shoulder deforms well" was somebody's opinion until
this file existed; a JSON file with a gate id and a pass flag is a result two candidates can be
compared on.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402

import gates  # noqa: E402

# Gates checked here, in order. Export-time gates (G23, G25, G27) belong to the build script; see
# fixture.UNPROVEN_GATES for why, so their absence is recorded rather than silent.
IMPLEMENTED = [
    "G1", "G2", "G3", "G4", "G5", "G6",
    "G7", "G8", "G9", "G10",
    "G11", "G12", "G13", "G14", "G15", "G16", "G17", "G18", "G19", "G20",
    "G21", "G22", "G24", "G26",
]


def run_all(mesh_objs, armature_obj, expected_deform, manifest=None, max_atlas_px=1024, region_share_note=""):
    """Every implemented gate, in id order. Returns a list of result dicts.

    A gate that raises is recorded as a failure carrying its exception, never swallowed. A harness
    that turns a crash into a pass is the single worst outcome available to it.
    """
    primary = mesh_objs[0]
    calls = [
        ("G1", lambda: gates.g1_manifold(primary)),
        ("G2", lambda: gates.g2_no_degenerate_faces(primary)),
        ("G3", lambda: gates.g3_no_doubled_verts(primary)),
        ("G4", lambda: gates.g4_consistent_normals(primary)),
        ("G5", lambda: gates.g5_no_ngons(primary)),
        ("G6", lambda: gates.g6_no_self_intersection(primary)),
        ("G7", lambda: gates.g7_quads_where_it_deforms(primary, armature_obj, manifest)),
        ("G8", lambda: gates.g8_declared_joint_loops(primary, armature_obj, manifest)),
        ("G9", lambda: gates.g9_no_poles_in_joint_zones(primary, armature_obj, manifest)),
        ("G10", lambda: gates.g10_pole_kinds(primary, armature_obj, manifest)),
        ("G11", lambda: gates.g11_t_pose(armature_obj)),
        ("G12", lambda: gates.g12_root_bone(armature_obj)),
        ("G13", lambda: gates.g13_bone_layer_naming(armature_obj)),
        ("G14", lambda: gates.g14_deform_joint_count(armature_obj, expected_deform, region_share_note)),
        ("G15", lambda: gates.g15_deform_flag_set(armature_obj)),
        ("G16", lambda: gates.g16_unit_armature_scale(armature_obj)),
        ("G17", lambda: gates.g17_no_zero_weight_verts(primary, armature_obj)),
        ("G18", lambda: gates.g18_influence_cap(primary, armature_obj)),
        ("G19", lambda: gates.g19_weights_normalised(primary, armature_obj)),
        ("G20", lambda: gates.g20_names_exportable(list(mesh_objs) + [armature_obj])),
        ("G21", lambda: gates.g21_single_material_and_atlas(mesh_objs, max_atlas_px)),
        ("G22", lambda: gates.g22_materials_survive_gltf(mesh_objs)),
        ("G24", lambda: gates.g24_uvs_present(mesh_objs)),
        ("G26", lambda: gates.g26_no_shape_keys_yet(mesh_objs)),
    ]
    results = []
    for gate_id, call in calls:
        try:
            results.append(call())
        except Exception as exc:  # noqa: BLE001 - deliberate: a crash must read as a failure
            results.append(
                {
                    "id": gate_id,
                    "passed": False,
                    "summary": f"gate raised {type(exc).__name__}: {exc}",
                    "crashed": True,
                }
            )
    return results


def find_objects(mesh_name=None, armature_name=None):
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if mesh_name:
        meshes = [o for o in meshes if o.name == mesh_name]
    if armature_name:
        armatures = [o for o in armatures if o.name == armature_name]
    if not meshes:
        raise SystemExit("no mesh object found; nothing to qualify")
    if len(armatures) != 1:
        raise SystemExit(f"expected exactly 1 armature, found {len(armatures)}: {[o.name for o in armatures]}")
    return meshes, armatures[0]


def main(argv):
    ap = argparse.ArgumentParser(prog="qualify.py")
    ap.add_argument("--blend", help="the .blend to qualify; omit to use the clean fixture")
    ap.add_argument("--manifest", help="the candidate's topology manifest: declared joint loops and static triangles")
    ap.add_argument("--fixture", default="arm_segment", choices=("torus", "arm_segment"),
                    help="which built-in fixture to use when --blend is omitted")
    ap.add_argument("--out", help="write the JSON report here; otherwise stdout")
    ap.add_argument("--deform-expected", type=int, default=30, help="contract rig.deformJointTarget")
    ap.add_argument("--max-atlas-px", type=int, default=1024)
    ap.add_argument("--mesh", help="restrict to this mesh object name")
    ap.add_argument("--armature", help="restrict to this armature object name")
    ap.add_argument("--region-share-note", default="", help="documented reason a region claims a share of the budget")
    args = ap.parse_args(argv)

    import fixture

    manifest = None
    if args.blend:
        bpy.ops.wm.open_mainfile(filepath=str(Path(args.blend).resolve()))
        source = args.blend
        if args.manifest:
            manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    else:
        build, deform = fixture.FIXTURES[args.fixture]
        _, _, manifest = build()
        source = f"fixture.{build.__name__}()"
        if args.deform_expected == 30:
            args.deform_expected = deform

    meshes, armature = find_objects(args.mesh, args.armature)
    results = run_all(
        meshes,
        armature,
        args.deform_expected,
        manifest=manifest,
        max_atlas_px=args.max_atlas_px,
        region_share_note=args.region_share_note,
    )

    failed = [r["id"] for r in results if not r["passed"]]
    report = {
        "source": source,
        "manifest": args.manifest,
        "blenderVersion": bpy.app.version_string,
        "meshObjects": [o.name for o in meshes],
        "armatureObject": armature.name,
        "deformExpected": args.deform_expected,
        "gatesImplemented": IMPLEMENTED,
        "gatesNotCheckedHere": fixture.UNPROVEN_GATES,
        "qualified": not failed,
        "failedGates": failed,
        "results": results,
    }

    text = json.dumps(report, indent=2, sort_keys=False)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text + "\n", encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        print(text)

    for r in results:
        print(f"  {'PASS' if r['passed'] else 'FAIL'}  {r['id']:>4}  {r['summary']}")
    print(f"QUALIFIED: {not failed}" + (f"  failed: {', '.join(failed)}" if failed else ""))
    return 0 if not failed else 1


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    sys.exit(main(argv))
