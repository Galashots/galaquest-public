# The qualification harness

Runs the binary gates from [`docs/foundry/topology/QUALIFICATION.md`](../../docs/foundry/topology/QUALIFICATION.md)
against a `.blend` and emits a JSON report.

| File | What it is |
| --- | --- |
| `gates.py` | One function per gate. Pure reads over `bpy`/`bmesh` data, no CLI, no side effects |
| `qualify.py` | Opens a `.blend`, runs every implemented gate, writes the report |
| `fixture.py` | Two clean test articles, built by script, plus one deliberate mutation per gate |
| `prove_gates.py` | Proves both fixtures pass **and** that every gate can be made to fail |
| `verify-glb.mjs` | Opens the exported **GLB** with a non-Blender reader and checks it against the build's claims |
| `verify-determinism.mjs` | G27: two clean rebuilds into separate directories produce the same hashes |

Blender is portable and not on `PATH`. On this machine:

```powershell
$blender = "<local path>"
```

## Always pass `--python-exit-code`

**Blender exits 0 when a `--python` script raises an unhandled exception.** Verified on 4.2.23: a
script whose only statement is `raise RuntimeError` still returns 0. So any check on Blender's exit
status — a `&&` chain, a CI step, `if ($LASTEXITCODE -ne 0)` — silently passes over a crashed run, and
the next command happily reads whatever stale artifact was left on disk from the previous build.

That already happened here: an assertion correctly failed a build, the guard did not fire, and the
qualify and pose steps that followed reported PASS for a mesh that had never been rebuilt.

```powershell
& $blender --background --factory-startup --python-exit-code 42 --python <script> -- <args>
```

## Prove the harness works

Run this before trusting any report it produces.

```powershell
& $blender --background --factory-startup --python tools\foundry\prove_gates.py -- `
    --out docs\foundry\topology\GATE-PROOF.json
```

Exit code 0 means all three proofs held. It fails if either fixture fails any gate, or if any gate
survives every mutation.

## Qualify a candidate

```powershell
& $blender --background --factory-startup --python tools\foundry\qualify.py -- `
    --blend foundry\candidates\claude\hero_region.blend `
    --manifest foundry\candidates\claude\topology_template.json `
    --out foundry\candidates\claude\qualification.json `
    --deform-expected 30
```

Exit code 0 means qualified. `--deform-expected` is the contract's `rig.deformJointTarget`; a region
candidate that legitimately claims a share of the 30 passes its own number and explains it with
`--region-share-note`.

Omit `--blend` to run against a built-in fixture, which is a quick check that the harness still runs.

## The manifest is not optional

G7, G8, G9 and G10 read the candidate's topology manifest and **fail without one**. Two keys matter:

- `loops` — the candidate's declared joint loops, as vertex-index lists. G8 verifies each is a real
  closed cycle whose every vertex has blended weights, so the declaration cannot be parked somewhere
  harmless to make G9 pass. G9 then bans poles on those loops and one ring either side.
- `documentedStaticTriangles` — why any triangles exist. G7 permits triangles only where every vertex
  has a single influence, which is the checkable form of "static".

Spec §13 rejects building an edge-loop *detector*, so the candidate declares and the harness verifies
the declaration against the mesh. The manifest is the candidate's claim; these gates are what makes it
a checkable one.

## What "deforms" means here

A vertex weighted 1.0 to one bone is **carried** by that bone. A vertex whose weight is split across
two or more is where the surface actually stretches. That single distinction — `influence_counts()` —
is what lets G7/G9/G10 be measured instead of argued about.

## Validate the shipping GLB

Every gate above reads a `.blend` in Blender's memory. **G22 claims materials "round-trip to glTF" by
looking at Blender node types — it never opens the exported file.** So the artifact the game actually
loads was, until this script, checked by nothing at all.

```powershell
node tools\foundry\verify-glb.mjs `
    --glb foundry\candidates\claude\hero_head_neck_shoulders_claude.glb `
    --build-report foundry\candidates\claude\build_report.json `
    --manifest foundry\candidates\claude\topology_template.json `
    --out foundry\candidates\claude\glb_validation.json
```

Fourteen checks, exit 0 when all pass. Two of them need a second reader to be meaningful: the file has
to parse outside Blender, and it has to survive a **round trip** — read, write, read again, with every
accessor's numbers unchanged. The rest compare the file against the build's own written claims rather
than against constants kept here, so the check fails the moment the build and the artifact disagree
instead of when someone remembers to update a number.

`--self-test` proves each check can fail, by mutating the real document one way per check:

```powershell
node tools\foundry\verify-glb.mjs --self-test --glb ... --build-report ... --manifest ...
```

It aborts if the real GLB fails anything first, since a mutation proves nothing against a broken
baseline. Two of the fourteen earned their keep on the first run: `R13` failed a correct file because it
asked whether Y was the *largest* extent, and in a T-pose the arm span is 3.2 against a height of 2.28;
`R9`'s mutation was too small to break its own check and said so.

Reads `@gltf-transform/core` from `tools/teardown/node_modules`, where it is already pinned at 4.4.2. A
second install would be a second version waiting to drift, and npm registry lookups take about six
minutes on this machine.

## Three gates are not checked here

`G23` (`export_apply=False`), `G25` (`.blend` committed as the authority) and `G27` (two rebuilds
produce the same hash) are properties of the **export and build steps**, not of a `.blend` in
memory. They are named in every report under `gatesNotCheckedHere` so their absence is visible
rather than looking like coverage.

## Why there are two fixtures

`torus` is the only closed all-quad surface with no poles anywhere. A sphere or a cube cannot be
pole-free — Euler's formula forbids it — so either one would fail G9/G10 forever and no clean
baseline could be established at all.

But a torus is **too kind**, and that cost real work. An earlier G9 treated a whole `DEF_` vertex
group as the deformation zone. It passed the torus and would have failed every character ever made:
`DEF_Head` covers the entire head, and a closed head must have poles somewhere. A gate no correct mesh
can satisfy is as useless as one nothing can fail, and it is harder to notice, because the harness
looks healthy right until it rejects everything.

So `arm_segment` exists: a capped cylinder with poles at the two cap centres, 32 triangles in the cap
fans, and an elbow. It has the features a real mesh cannot avoid, and every gate must **pass** on it.

Some mutations trip more than one gate: on a quad mesh you cannot add a pole without also adding a
triangle or an n-gon, because the face count has to go somewhere. That is arithmetic, not sloppiness.
The proof asserts the **target** gate flips and records the collateral rather than pretending
mutations are surgical.
