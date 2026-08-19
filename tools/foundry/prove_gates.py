"""Prove the gates can fail, prove they can pass, and prove they can pass on realistic geometry.

    blender --background --factory-startup --python tools/foundry/prove_gates.py -- \
        --out docs/foundry/topology/GATE-PROOF.json

A bar that cannot fail is worse than no bar. A gate that always fails is equally useless. And a gate
that only passes on a shape no character could ever be is the subtlest of the three, because it looks
like a working harness right up until it rejects every real mesh. So this runs three proofs:

1. **The torus fixture passes every implemented gate.** Closed, all quads, no poles.
2. **The arm-segment fixture passes every implemented gate.** Poles at the cap centres, 32 triangles
   in the cap fans, an elbow. This is the proof that the gates are *satisfiable* by geometry with the
   features a real mesh cannot avoid. An earlier G9 passed proof 1 and failed proof 2 — it treated a
   whole DEF_ vertex group as a deformation zone, which no closed head can ever satisfy.
3. **Every implemented gate is flipped to fail by at least one deliberate mutation.**

Exits non-zero unless all three hold. Gates not covered are listed with their reason rather than
left to look covered.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402

import fixture  # noqa: E402
from qualify import IMPLEMENTED, run_all  # noqa: E402


def _build(name):
    build, deform = fixture.FIXTURES[name]
    mesh_obj, armature_obj, manifest = build()
    return mesh_obj, armature_obj, manifest, deform


def _run(mesh_obj, armature_obj, manifest, deform):
    results = run_all([mesh_obj], armature_obj, deform, manifest=manifest, max_atlas_px=fixture.ATLAS_PX)
    return {r["id"]: r for r in results}


def main(argv):
    ap = argparse.ArgumentParser(prog="prove_gates.py")
    ap.add_argument("--out", help="write the JSON proof here; otherwise stdout only")
    args = ap.parse_args(argv)

    baselines = {}
    for step, name in enumerate(fixture.FIXTURES, start=1):
        print("=" * 78)
        print(f"Proof {step} of 3 — the {name} fixture passes every implemented gate")
        print("=" * 78)
        baseline = _run(*_build(name))
        baselines[name] = baseline
        for gate_id in IMPLEMENTED:
            r = baseline[gate_id]
            print(f"  {'PASS' if r['passed'] else 'FAIL'}  {gate_id:>4}  {r['summary']}")

        failures = sorted(g for g, r in baseline.items() if not r["passed"])
        if failures:
            print()
            print(f"HARNESS BROKEN: the {name} fixture failed " + ", ".join(failures) + ".")
            print("Nothing below would be meaningful, so the mutation proof was not run.")
            _write(args.out, {
                "baselineClean": False,
                "brokenFixture": name,
                "baselineFailures": failures,
                "baselines": baselines,
                "mutationsRun": False,
            })
            return 1
        print(f"\n  {name} passes all {len(IMPLEMENTED)} implemented gates\n")

    print("=" * 78)
    print("Proof 3 of 3 — every implemented gate is flipped to fail by a real mutation")
    print("=" * 78)

    flipped_by = {gate_id: [] for gate_id in IMPLEMENTED}
    records = []

    for name, target, fixture_name, mutate, why in fixture.MUTATIONS:
        mesh_obj, armature_obj, manifest, deform = _build(fixture_name)
        base = baselines[fixture_name]
        try:
            mutate(mesh_obj, armature_obj, manifest)
        except Exception as exc:  # noqa: BLE001
            records.append({
                "mutation": name, "targetGate": target, "fixture": fixture_name, "why": why,
                "targetFlipped": False,
                "error": f"the mutator itself raised {type(exc).__name__}: {exc}",
            })
            print(f"  ERROR {target:>4}  {name}: mutator raised {type(exc).__name__}: {exc}")
            continue

        after = _run(mesh_obj, armature_obj, manifest, deform)
        newly_failed = sorted(g for g in IMPLEMENTED if base[g]["passed"] and not after[g]["passed"])
        hit = target in newly_failed
        collateral = [g for g in newly_failed if g != target]

        for gate_id in newly_failed:
            flipped_by[gate_id].append(name)

        records.append({
            "mutation": name,
            "targetGate": target,
            "fixture": fixture_name,
            "why": why,
            "targetFlipped": hit,
            "targetSummary": after[target]["summary"],
            "collateralGates": collateral,
        })

        extra = f"   (also flipped {', '.join(collateral)})" if collateral else ""
        print(f"  {'OK  ' if hit else 'MISS'}  {target:>4}  {name}  [{fixture_name}]")
        print(f"           -> {after[target]['summary']}{extra}")

    print()
    print("=" * 78)
    print("Coverage")
    print("=" * 78)

    never_flipped = [g for g in IMPLEMENTED if not flipped_by[g]]
    missed = [r for r in records if not r["targetFlipped"]]

    for gate_id in IMPLEMENTED:
        muts = flipped_by[gate_id]
        print(f"  {gate_id:>4}  {f'{len(muts)} mutation(s)' if muts else 'NEVER FLIPPED'}")
    for gate_id, reason in fixture.UNPROVEN_GATES.items():
        print(f"  {gate_id:>4}  not checked here — {reason}")

    ok = not never_flipped and not missed
    print()
    if never_flipped:
        print("FAIL: these gates were never made to fail: " + ", ".join(never_flipped))
    if missed:
        print("FAIL: these mutations did not flip their target gate: "
              + ", ".join(f"{r['mutation']}->{r['targetGate']}" for r in missed))
    if ok:
        print(f"PROVEN: {len(IMPLEMENTED)} gates pass on {len(fixture.FIXTURES)} clean fixtures, one of "
              f"which has poles and triangles, and each gate is broken by at least one of "
              f"{len(fixture.MUTATIONS)} mutations.")

    _write(args.out, {
        "blenderVersion": bpy.app.version_string,
        "baselineClean": True,
        "fixtures": list(fixture.FIXTURES),
        "baselines": baselines,
        "mutationsRun": True,
        "gatesImplemented": IMPLEMENTED,
        "gatesNotCheckedHere": fixture.UNPROVEN_GATES,
        "flippedBy": flipped_by,
        "mutations": records,
        "neverFlipped": never_flipped,
        "proven": ok,
    })
    return 0 if ok else 1


def _write(out, payload):
    if not out:
        return
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    sys.exit(main(argv))
