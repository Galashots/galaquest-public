# What makes a topology template *qualified*

> **HISTORICAL — the candidate bake-off this bar governed is over, and its evidence tree is not in
> the public repository.** The candidate working trees (`claude`/`codex` under a repo-root
> `candidates` directory) and the private teardown harness this file names were not ported during the
> public consolidation. The *criteria* below remain the recorded qualification bar; the *paths and
> commands* describe the environment at qualification time, not the current public checkout.

The pass/fail bar for the hero's authored topology. Written **before** either candidate was modelled,
so neither is judged against a target that moved.

Spec §13 says the pipeline starts from a *canonical authored topology template* — "approved topology,
stable vertex indices, approved rest pose, UVs, weights, named anatomical regions, canonical skeleton,
**recorded deformation results**". That list is the requirement. Until now none of it was checkable, so
"the shoulder deforms well" could only ever be somebody's opinion. This file makes it a result.

## The rule that shapes everything below

**No absolute threshold is invented here.**

Where a property is binary — a vertex is weighted or it isn't — this file fails a candidate outright.
Where a property is a matter of degree — how much a shoulder loses volume when the arm lifts — this
file **requires the number to be measured and recorded**, and the comparison between candidates is
*relative*. It does not assert that 8% volume loss passes and 12% fails, because nothing in this project
supports those figures and inventing them is the exact defect Stage T spent a round removing.

Absolute thresholds get pinned **after** we have two real candidates to calibrate against, and they get
the owner's sign-off, like every other adopted number.

---

## Part 1 — Binary gates. Fail any of these and the candidate is not qualified.

Each is machine-checkable in `bpy` or on the exported GLB. No judgement involved.

### 1.1 Mesh integrity, in rest pose **and** in every stress pose

| # | Check | Why |
| --- | --- | --- |
| G1 | Manifold: no holes except by deliberate, documented design | Non-manifold geometry breaks normals and export |
| G2 | No zero-area (degenerate) faces | Produce NaN normals and invisible shading artifacts |
| G3 | No doubled vertices at the same position | Split shading, and they multiply through LOD generation |
| G4 | No inverted normals | Reads as a hole in the character at runtime |
| G5 | No n-gons anywhere | Triangulate unpredictably on export |
| G6 | No self-intersection introduced by any stress pose | Geometry passing through itself is a deformation failure, not a style |

G1–G5 are checked in rest. **G6 is checked in every pose**, which is the point: a mesh can be flawless
at rest and fold through itself the moment it moves.

### 1.2 Deforming topology

| # | Check | Why |
| --- | --- | --- |
| G7 | Quad-dominant. Anything that deforms is quads; triangles only in static, documented places | Quads give predictable edge flow under deformation |
| G8 | Continuous edge loops following the joint lines at **neck, shoulder** (and later elbow, knee) | A joint without a loop crossing it cannot bend without shearing |
| G9 | No pole (a vertex of valence 3, or 5+) inside a deformation zone | Poles pinch when the surface stretches |
| G10 | Where a pole is unavoidable, valence 5 in preference to valence 3 | 5-poles distribute stretch; 3-poles concentrate it |

### 1.3 Rig and weights

| # | Check | Why |
| --- | --- | --- |
| G11 | Rest pose is **T-pose** | Spec §7. See the note below on what this costs |
| G12 | Root bone named `Root`, at world origin `(0,0,0)`, on the ground plane, axis-aligned | A root at hip level breaks ground calculations in every engine |
| G13 | Three-layer bone naming: `DEF_` deform, `CTRL_` control, `MCH_` mechanism. Gear attachment sockets are `MCH_` (owner decision, 2026-08-10) | Makes "30 deform joints" **countable** instead of arguable |
| G14 | Count of bones with the deform flag set == the contract's `rig.deformJointTarget` (30, whole body; a region claims a documented share) | The contract pins 30; nothing currently checks it |
| G15 | Every deform bone actually has the deform flag set | A bone without it leaves its vertices unanimated and silently orphaned |
| G16 | Armature scale is unit `(1,1,1)`, applied before rigging | Non-unit scale deforms animation on export |
| G17 | No vertex has zero total weight | Zero-weight vertices stay behind while the character moves |
| G18 | No vertex exceeds **4** influences | Three.js stores skin weights in a `Vector4`; a fifth influence is dropped **silently**, not with an error |
| G19 | All weights normalised to 1.0 within 1e-4 | Unnormalised weights make vertices drift |
| G20 | Bone and mesh names are `CamelCase` or `snake_case`, no special characters | Special characters cause glTF/FBX export failures |

**G18 is ours and it is hard.** The 4-influence cap is not a style preference — it is a Three.js
implementation fact. Stage T measured a shipped professional pack breaking it on 29% of one mesh's
vertices (`Female_Ranger_Body`, 1351 of 4641 vertices, fifth weights 0.0016–0.0462 in a real `WEIGHTS_1`
accessor). So the cap is routinely violated in the wild and we cannot assume tooling respects it.

### 1.4 Surface and export

| # | Check | Why |
| --- | --- | --- |
| G21 | One material. One 1024² atlas covering the character and its gear | Owner-approved 2026-08-09, contract v7 |
| G22 | Every material round-trips to GLB. **No procedural nodes, no Color Ramps** | They are silently lost on glTF export; the Blender viewport lies |
| G22b | The exported GLB is re-opened by a **non-Blender reader** and checked against the build's own claims: `tools/foundry/verify-glb.mjs` | Every other gate reads a `.blend` in Blender's memory. G22 as written inspects Blender node types and never opens the file the game loads, so the shipping artifact was checked by nothing |
| G23 | Exported with `export_apply=False` | Applying modifiers on glTF export balloons file size |
| G24 | UVs present, no overlapping UVs except deliberate mirrored pairs, documented | Overlaps corrupt baked lighting and atlas packing |
| G25 | `.blend` is committed as the topology authority; GLB is the shipping artifact | Spec §13. GLB triangulates, so quad flow cannot be audited there |
| G26 | Vertex indices are stable and documented, and geometry is final before any shape key exists | Changing vertex order after shape keys corrupts them silently |
| G27 | Build runs from a script, and two clean rebuilds of unchanged input produce the same artifact hash | Determinism is a spec requirement, not an aspiration |

---

## Part 2 — Recorded deformation results. Measured, not judged.

Every candidate runs the same poses and **records the same numbers**. No pose has a pass threshold yet.

### 2.1 The stress poses for this region

| Pose | What it attacks |
| --- | --- |
| P1 | Neck yaw to its usable limit, left and right |
| P2 | Neck pitch up and down |
| P3 | Neck roll, both directions |
| P4 | Arm raised to horizontal, then overhead |
| P5 | Arm forward, and arm back — the shoulder's worst case, because the deltoid mass has to travel |
| P6 | **Axial twist of the upper arm through 90°** — the candy-wrapper test |
| P7 | Two extremes combined, e.g. arm overhead with the neck turned toward it |

**P6 is the one that matters most.** The candy-wrapper failure — a segment rotating past ~90° with no
twist bone, so the mesh collapses along its axis — is the named reason twist bones exist, and it is why
the 30-joint budget bought forearm twist rather than staying at the 25 both measured packs ship. P6 is
the test that says whether that purchase was worth it.

### 2.2 What is recorded, per pose

1. **Cross-sectional area** at the mid-joint, as a fraction of its rest value. Collapse is what
   candy-wrapping *is*.
2. **Volume** of the region, as a fraction of rest.
3. **Worst per-vertex displacement** relative to its neighbours — localised spikes are pinching.
4. **Whether any self-intersection appears** (this one is binary, gate G6).
5. **A render**, from front, three-quarter and profile.

The render is evidence for a human, **not** the test. A pose can look fine from three angles and still
have folded through itself; that is what the numbers are for.

### 2.3 Owner directive note-5 — re-anchored, recorded, not a gate

the owner's note-5 required the torso cross-sections — shoulder/chest taper, narrower waist, pelvis
transition — to arrive "without substantially changing the overall **C** silhouette". C was the
4.5-head blockout, superseded by the 3.84 lock, so the clause had lost its baseline as well as never
having had a threshold.

**Re-anchored by owner decision, 2026-08-10:** the reference silhouette is now the hero identity
master render (**MISSING IN PUBLIC** — the NS-02 gap recorded in
`docs/GALAQUEST_VISUAL_AUTHORITY.md`; it was never ported into the public tree). **Recorded, not
gating** — the same rule as everything else in Part 2. Every build records its silhouette delta against the master; no pass mark
exists until there are real numbers to set one from, and setting one needs the owner's sign-off.

The private teardown harness's silhouette tool provided the measurement (it was not ported to the
public repository). Two things it must state rather than
paper over: the master is an **illustration** and the candidate is a **render of a mesh**, so a
non-zero delta is expected and is not by itself evidence of anything; and the master is stamped DO NOT
TRACE, so a small delta is not permission to treat it as geometry.

### 2.4 Also recorded, at gameplay scale

The hero is ~90 CSS px on the iPad and Stage T finding M7 measured that at that size only silhouette
survives — arms 1–2 px wide, no interior edge resolvable. So every stress pose is **also** rendered at
90 px, and the silhouette recorded. A deformation flaw invisible at 90 px is a lower priority than one
that changes the silhouette, and we should be able to tell which is which.

---

## Part 3 — What is deliberately *not* a gate

- **Owner directive note-5's silhouette bound.** Re-anchored to the identity master by owner decision
  on 2026-08-10 and moved to §2.3 as a **recorded measurement**. Still not a gate, and still no
  invented threshold — but it now has a valid baseline, which it did not before.
- **Facial rig, blend shapes, fingers.** Out of P0 scope.
- **"Looks good."** Not a gate anywhere in this document. It is the owner's call and the children's, and it is
  recorded separately from qualification.

---

## Part 4 — How the two candidates are compared

Claude and Codex author this region independently, in `foundry/candidates/claude/` and
`foundry/candidates/codex/`.

1. **Binary gates first.** A candidate failing any of G1–G27 is not qualified, regardless of how it
   looks. This is decided before anyone renders anything.
2. **Recorded results side by side.** Same poses, same metrics, same renders.
3. **Then taste.** the owner judges the renders at 90 px first and inspection size second — deliberately in
   that order, because inspection size is where a weaker mesh looks best.
4. **Method is part of the deliverable.** Each side records what tools it used and where they helped or
   fought. the owner's question is whether we can run this pipeline ourselves or need to buy something, and
   that is answered by how the work went, not only by which mesh won.

A tie on the gates is the expected outcome, and it is fine. The gates exist to stop us shipping a mesh
that fails on facts; the comparison is for the part facts cannot settle.

---

## Provenance of this document

The spec supplies the requirement list (§13) and the constraints (§5 surface, §7 rig, §9 performance),
and the contract supplies the pinned numbers.

**The following are adopted from [`elithril/blender-kiln`](https://github.com/elithril/blender-kiln)**,
a third-party Claude Code skill read on 2026-08-10, and are credited rather than presented as ours:
the `DEF_`/`CTRL_`/`MCH_` three-layer bone naming; `Root` at world origin as an explicit anti-pattern
check; the deform-flag check; the candy-wrapper failure mode and the >90° twist that provokes it;
"poles away from deformation zones, 5-poles over 3-poles"; the material-export audit for procedural
nodes lost on glTF; `export_apply=False`; the vertex-order-before-shape-keys ordering; and the
zero-weight and normalisation checks. Its triangle budget for a web hero is 5–15k, which puts our
LOD0 ≤16k slightly above its web band and inside its mobile band — noted, not changed.

**Two places where we knowingly differ from it:**

- It caps skeletons at 75 bones for a mobile draw call and recommends 50–65. We measured iOS WebGL2
  offering 1024 vec4 vertex uniforms on 100% of surveyed devices and concluded bone count is not the
  mobile risk — draw calls from slot granularity are. At 30 joints we are far under either figure, so
  the disagreement does not bite, and we are not adopting its number.
- It mandates T-pose **for auto-rigger compatibility**, while noting A-pose deforms shoulders better.
  We author our own rig, so that particular argument does not apply to us — but we intend to retarget
  CC0 animation, which generally assumes T-pose, and spec §7 already says T-pose. So T-pose stands, on
  a different reason than the one it gives, and **G11 costs us shoulder deformation quality**. If P4–P6
  fail badly on both candidates, this is the first assumption to revisit.
