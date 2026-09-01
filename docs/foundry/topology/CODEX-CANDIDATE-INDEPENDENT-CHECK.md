# Independent check of the Codex candidate

> **HISTORICAL — the candidate trees this check ran against are not in the public repository.**
> The comparison record stands as provenance; its paths describe the environment at check time.

Codex authored `foundry/candidates/codex/` and ran its own qualification. This is a second,
independently written harness (`tools/foundry/`) run against the same `.blend`.

**Where it ended up:** both harnesses agree on every gate but one. Codex's validator reports 27 of 27
passing; this harness reports 23 of the 24 it implements, the exception being **G13** (bone naming),
which is now a rename rather than a defect. Codex also ran *this* harness independently and got the
same single failure — `qualification-shared-current.json` and `qualification-claude-harness.json`
agree on `failedGates: ["G13"]`.

**How it got there matters more than the score**, so the two disagreements are recorded below with
their evidence. Codex initially reported G6 and G27 failing, and has since fixed both — its G6 now
reports zero intersecting pairs at rest and in every pose, which corroborates the measurement in
disagreement 1.

Run on 2026-08-10, Blender 4.2.23 LTS, against `hero_head_neck_shoulders_codex.blend` with
`topology_template.json` as the manifest. Reports:

- Codex's own: `foundry/candidates/codex/qualification_results.json`
- This one: `foundry/candidates/codex/qualification-claude-harness.json`
- Harness proof: `docs/foundry/topology/GATE-PROOF.json`

## Where the two harnesses agree

23 of the 24 gates this harness implements. Notably the ones that are easy to get wrong:

| Gate | Independently confirmed |
| --- | --- |
| G8 | All three declared loops — `NeckJoint` (32), `Shoulder_L` (28), `Shoulder_R` (28) — are **single closed cycles**, every vertex degree 2, and **every vertex has blended weights**. The declaration is not parked somewhere harmless |
| G9 | Zero poles on or beside any declared joint loop |
| G14 | Exactly 10 deform bones, matching Codex's claimed 10-of-30 regional share |
| G18 | Maximum 2 influences per vertex against the Three.js cap of 4 — comfortable, and the gate that a shipped professional pack breaks on 29% of one mesh |
| G7 | 8 triangles, and **all 8 are rigid** — every vertex single-influence, weighted 1.0 to `DEF_Head` |

## Disagreement 1 — G6 self-intersection. Codex failed its own candidate on a defect that was not there. Now resolved.

Codex initially reported intersecting triangle pairs at rest and in every pose. This harness found
none. The disagreement was settled by measurement, not argument:

| Test | Result |
| --- | --- |
| Non-adjacent intersecting triangle pairs, BVH epsilon 0 | **0** (5 pairs total, all sharing a vertex) |
| Same, epsilon 1e-6, 1e-5, 1e-4, 1e-3 | **0** at every value |
| Hair vertices lying inside the body surface (independent nearest-surface test) | **0 of 40** |

Two independent methods, five epsilon values, same answer. The count of genuinely non-adjacent
intersecting pairs does not depend on triangulation order, so this is comparable across harnesses even
though the two disagree on face indexing — Codex's indices run to 5521 on a 2794-face mesh, so they are
post-triangulation indices in a different order from ours.

The likely cause is that Codex's detector counts triangles that **share an edge or a corner**. Two
triangles meeting at an edge touch by construction; counting that reports every mesh ever made as
self-intersecting. This harness excludes pairs sharing a vertex, which is the adjacency relation
itself rather than a distance fudge — and it still catches a real intersection, proven by the
`push_a_vertex_through_the_far_wall` mutation.

Corroborating detail: the same ~20 pairs recur **unchanged** across rest and eleven of twelve poses.
Real pose-induced intersection changes with the pose.

**So the candidate was better than Codex's own report said.** Worth stating plainly: Codex was being
honest, and honest self-reporting is the behaviour we want. The detector was wrong, not the disclosure.

**Resolved.** Codex has since corrected its detector: `restPairs` is now empty and all twelve poses
report zero pairs. Two independently written detectors now agree, having disagreed — which is a better
outcome than two that agreed from the start.

G27 is also now passing: two clean rebuilds produce an identical GLB sha256
(`1ee8c832…`), atlas, and topology template. Note that `rawBlendSha256` **differs** between the two
builds and Codex reports it rather than hiding it — `.blend` files embed volatile state, so
determinism is asserted over a defined canonical artifact instead. That is the right call and it is
visible in `determinism_results.json`.

## Disagreement 2 — G13 bone naming. Real, and it needs an owner decision, not a harness change.

Codex's armature carries four bones this harness rejects:

```
Socket_Headgear   Socket_Shoulder_L   Socket_Shoulder_R   Socket_Back
```

QUALIFICATION.md G13 requires three-layer naming — `DEF_` deform, `CTRL_` control, `MCH_` mechanism.
`Socket_*` is none of them, so the gate fails the candidate **as the document is written**, and Codex's
own check permitted a fourth prefix the document does not have.

But gear attachment points are a real requirement — headgear, shoulders, back — and the three-layer
scheme had no category for them, which made this a **gap in the bar** as much as a slip in the
candidate.

**Resolved by owner decision, 2026-08-10: attachment sockets are `MCH_`.** So
`Socket_Headgear` becomes `MCH_Socket_Headgear`, and G13's accepted prefixes are **unchanged** —
`MCH_` already means "a bone that exists for the rig's plumbing rather than to deform skin", which is
exactly what a socket is. The document gained a clarifying clause, not a fourth layer.

That distinction matters. Widening a gate's accepted set after a candidate fails it is how a bar stops
meaning anything; clarifying which existing category a case falls into is not. The alternative on the
table — a fourth `SKT_` layer — was declined for that reason.

Codex's handoff declines the rename, citing an explicit `Socket_*` requirement in its task brief and
describing G13 as a harness defect. The first half is fair — it was right not to work around a rule it
had been given — but the second is not: G13 rejected the names because the bar as written has three
prefixes, which is the bar doing its job. The owner decision above now supersedes the brief.

**Action for the Codex candidate:** rename the four bones to `MCH_Socket_*`. It fails G13 until then,
and this is the only gate it fails in this harness.

## Recorded, not gating — the joints the weights imply

G8 records every pair of deform bones sharing blended vertices. Codex declared loops at three joints;
the weights show eight:

| Joint implied by the weights | Shared vertices | Declared loop |
| --- | --- | --- |
| `DEF_Neck` ↔ `DEF_NeckBase` | 332 | — |
| `DEF_Head` ↔ `DEF_Neck` | 218 | `NeckJoint` |
| `DEF_Chest` ↔ `DEF_SpineUpper` | 175 | — |
| `DEF_Chest` ↔ `DEF_Clavicle_R` | 156 | — |
| `DEF_Chest` ↔ `DEF_Clavicle_L` | 155 | — |
| `DEF_Clavicle_R` ↔ `DEF_UpperArm_R` | 84 | `Shoulder_R` |
| `DEF_Clavicle_L` ↔ `DEF_UpperArm_L` | 84 | `Shoulder_L` |
| `DEF_Head` ↔ `DEF_Jaw` | 40 | — |

**This is not a failure.** QUALIFICATION.md G8 asks for loops at neck and shoulder, and all three are
declared and verified. The table is here because the harness should make an undeclared joint *visible*
without inventing a quota for how many loops a region owes — which would be exactly the invented
threshold the governing rule forbids.

## What this exercise cost, and why it was worth it

Running against a real candidate found **four defects in this harness**, all of them the harness being
wrong rather than the mesh:

- G7 demanded 100% quads — stricter than the bar it enforces.
- G9 treated a whole `DEF_` vertex group as the deformation zone — **unsatisfiable by any character**,
  since a closed head must have poles.
- G10 gated on 3-poles outnumbering 5-poles — an invented threshold, and wrong for poles in rigid caps.
- G8 checked almost nothing.

The mutation proof did not catch any of them, because a torus has no poles and no triangles. That is
why there is now a second fixture with both, and why proof 2 of 3 exists.
