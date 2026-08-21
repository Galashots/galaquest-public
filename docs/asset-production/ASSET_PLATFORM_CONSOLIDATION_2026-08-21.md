# Asset platform consolidation — 2026-08-21

This document is the **"nothing got lost" proof** for folding the asset-production work of PRs #26,
#27, #28 and #29, plus the still-useful parts of #11, onto a clean branch cut from public `main`.

Its companion is [`asset-platform-inventory.json`](asset-platform-inventory.json), the
machine-readable record of every asset, provider task and disposition.

Nothing here merges, closes or rewrites a source PR. Nothing here spends provider credit.

## 1. Verified fixed point

Refreshed from live GitHub on 2026-08-21 with `gh pr list` and `git fetch origin --prune`. Every head
below was **observed**, not carried over from the brief.

| Ref | Head SHA | State |
| --- | --- | --- |
| `main` | `f14dd476614df6b6d927c512bb31b2505c991a20` | base of this branch |
| #26 `feat/ranger-lodge-expansion` | `d8adec775bc8a94f64d967a5adf842d31f751d7b` | OPEN, draft |
| #27 `feat/asset-forge` | `f7fbb23209f03f66cbcf05f332a8ac8e68243fff` | OPEN, draft |
| #28 `feat/enemy-asset-wave-1` | `b1a337a394bb12caa6c3b667cc546547111a936d` | OPEN, draft |
| #29 `fix/forge-meshy-spend-hardening` | `53d54e17e8a38ba3a076818f07feeb06a7bf515e` | OPEN, draft |
| #11 `agent/a1-beacon-warden-lane` | `40b95c8101135b1503147203924b5f8212b5b2bd` | OPEN, draft |

All six matched the values recorded when the consolidation brief was written; no source head had
moved. The stack is **strictly linear** — `main → #26 → #27 → {#28, #29}` — verified with
`git merge-base --is-ancestor`. That fact is what makes a clean port possible without replaying
conflicting diffs (see §7).

One further SHA matters and is not a branch head:

- `687f903f33def5dddc7662e9093de4d80f55fc12` — the commit on `feat/asset-forge` at which the
  owner-locked Dawnwarden helmet and sword fit packets were authored. It is pinned as a **literal**
  in `test/forge-owner-fit.test.mjs`, so it survives the port unchanged. It must **not** be rewritten
  to this branch's head; doing so would erase the provenance of the accepted fit.

## 2. What these PRs actually became

PR #26 is titled *"expand Ranger Lodge and progression"*. In practice it became the **asset,
armoring and Character Studio R&D lane**: semantic anatomy occlusion, a supervised Hero anatomy map
with an exact byte/topology proof, a Blender anatomy bake, GLB intake tooling, Studio candidate gear
mounting and world-space position tuning.

It is judged here on what it became, not on its title.

- #26 — the platform substrate: anatomy, armoring, Studio.
- #27 — the **Asset Forge**: the tool that produced the first genuinely convincing armor fit, and
  with it the accepted Dawnwarden helmet and sword placements.
- #29 — spend-safety hardening for that Forge. Treated here as **part of the Forge**, not an
  optional follow-up.
- #28 — Enemy Wave 1 intake: 13 rigged candidates with full provenance, deliberately not promoted.
- #11 — an older, heavily diverged lane. Selective salvage only.

## 3. Binary and archive policy, and the evidence for it

The canonical archival 3D format is **GLB**.

Three measured facts drove the split between what stays in Git and what goes to the external
archive:

1. The entire `public/assets` tree on `main` is **6,273,437 bytes** across 27 GLBs.
2. PRs #26 and #28 together add **272,232,744 bytes** of raw candidate GLBs — a roughly **43×**
   inflation of the publicly served asset tree, for bytes that no code path loads.
3. The repository already declares this policy. `.gitignore` reserves `.local/` as *"Scratch space
   for large third-party assets under evaluation (Meshy exports, etc). Never committed: a single
   rigged export is ~25 MB."* The pre-existing in-tree candidate,
   `public/assets/gear/candidates/sword_wildwood_w1a.glb`, is **88,364 bytes** — an optimised export.
   The 8–20 MB raw Meshy candidates are the exception to the repository's own convention, not the
   rule.

So:

| Kept in Git | Sent to the external archive |
| --- | --- |
| Code, tests, runbooks, manifests, provenance JSON/Markdown, checksums, task metadata | Unoptimised raw Meshy candidate GLBs |
| Optimised assets that genuinely belong in the runtime | Large rigged source models with no runtime use |
| The **minimum** reference assets automated Forge/Studio acceptance actually needs | Raw Enemy Wave 1 canonical GLBs |

The minimum reference set is exactly two files, **16,190,780 bytes**: the Dawnwarden helmet and
sword. They are not kept for sentiment — `public/src/studio/candidateGear.js` loads those exact
paths and `test/forge-owner-fit.test.mjs` pins their fit packets, so Forge and Studio acceptance
cannot run without them. They are deliberately **not** re-exported or optimised, because their bytes
are the reference the owner-locked fit was authored against.

Everything else — **256,041,964 bytes** — leaves the served tree.

Verified as safe: `test/glb-materials.test.mjs` walks the assets **directory** and looks each file it
finds up in `KNOWN_DORMANT_DEFECTS`. It never asserts that a mapped file exists. Removing the bytes
therefore cannot fail it, and `main` retains 27 GLBs against its `>= 9` floor. All 21 quarantine
entries are kept regardless, because the material-defect knowledge is worth preserving and because
it lets the owner re-hydrate a candidate from the archive without editing a test.

## 4. The recovery contract

**No binary is at risk today, with or without Google Drive.** No source PR is closed and no source
branch is modified, so every blob stays reachable on GitHub. The inventory records, for each file,
its `source_ref`, `git_blob_oid`, `sha256` and `size_bytes`.

```bash
git fetch origin <source_ref> && git cat-file -p <git_blob_oid> > <name>.glb
```

Hash the result and compare against the manifest. That is the preservation guarantee; the Drive
archive is where the bytes should *live*, not the only place they *exist*.

### Google Drive archive

The folder hierarchy has been created in the owner's Drive and every folder URL is recorded in the
inventory:

- Root — <https://drive.google.com/drive/folders/1rwHbW5aZNwGXnL0_QNFZOI-9TNU8-LlA>
- This consolidation — <https://drive.google.com/drive/folders/1g_sSIyfNUJI9vuCI2ifkNdltx9so3IHH>

Layout: `gear/{embermaw,frostfang,stormwing,voidstar,wildthorn,sunlion,behemoth,dawnwarden}`,
`enemies/{wave-1,bramble-stalker}`, `characters/wren`, `historical/beacon-warden`.

The folders are **empty**. The Drive integration available to this session cannot stream 8–20 MB
binaries, so every binary is recorded `PENDING_OWNER_UPLOAD` against a real, named destination
folder. No URL is invented. The unresolved byte count is stated in §9.

## 5. The seven gear families — 35 tasks, zero bytes

`docs/asset-production/GEAR_BATCH_2026-08-20.md` is the **most critical single artefact in this
consolidation**, because these 35 candidates have no binary anywhere. They were never downloaded.
The concept + Image-to-3D task ID pair *is* the asset handle; if the ledger is lost, the generated
output is unrecoverable.

Reconciled and verified structurally: **7 families × 5 slots = 35**, with 35 unique concept task IDs
and 35 unique Image-to-3D task IDs, no duplicates and no missing slot. Slot naming varies by family
and is preserved verbatim (`weapon` is Sword, Spear, Axe or War hammer; `shield` is Shield or Tower
shield).

Families: Embermaw, Frostfang, Stormwing, Voidstar, Wildthorn, Sunlion, Behemoth.

**Both provider states are recorded, and history is not erased:**

- *As recorded in the ledger:* the snapshot was taken during an upstream HTTP 502 window — 35
  submitted, at least 8 `SUCCEEDED`, the remainder `IN_PROGRESS` (several at 93–99%), no known
  failures, completion recorded as `UNKNOWN`. The ledger therefore **understates** completion.
- *Reconciled claim:* the consolidation brief states an independent audit found all 35 now report
  `SUCCEEDED` provider-side.
- *Verification status:* **not re-verified here.** This consolidation issued no provider call of any
  kind, paid or read-only. The reconciled claim is recorded as owner-supplied, with
  `provider_state_reconciled_verified_here: false`, until a read-only refresh is separately
  authorised and recorded.

Processing is deliberately deferred: **preserve now, process when gameplay needs a set.** None of the
35 is fitted or promoted by this work.

## 6. Enemy Wave 1 — preserved, not promoted

13 enemies, each with its Image-to-3D task ID, its rig task ID and a committed base rigged GLB.
Ledger names reconcile 1:1 against the 13 committed binaries with no orphans on either side.

Preserved: concepts and provenance, both task ID sets, the structural audit, the material-defect
quarantine, the 13 candidate identities, and the note that the free walk/run outputs exist
provider-side and were deliberately not duplicated into Git.

A 14th entry is preserved as **concept reserve only** — Voidfang Overlord, concept task
`01a022c2-a744-7119-a0ab-5fc6daaadbec`, no 3D job in Wave 1. Recorded so the concept spend is not
forgotten.

Acceptance state is unchanged and honest:

- structural intake — **PASS**
- material defect — **QUARANTINED** (raw flooded-emissive / PBR-default signature)
- visual and deformation acceptance — **UNKNOWN**
- gameplay promotion — **NOT DONE**, and deliberately not attempted here

## 7. Port strategy

Because the stack is strictly linear, `origin/fix/forge-meshy-spend-hardening` (#29) already contains
the union of #26 + #27 + #29, and `origin/feat/enemy-asset-wave-1` (#28) contains #26 + #27 + #28.
The port therefore takes **final file states** rather than replaying diffs, which removes any chance
of silently dropping a layer during a conflict resolution:

- non-binary surfaces of #26, #27 and #29 — taken from #29's tree;
- `test/glb-materials.test.mjs` and #28's documentation — taken from #28's tree, because #28 is the
  only ref carrying the Wave 1 quarantine entries on top of #26's;
- the two Dawnwarden GLBs — taken from #26's tree;
- everything else binary — recorded in the inventory and left out of the tree.

The four files touched by more than one PR (`public/src/studio/scene.js`,
`public/src/studio/candidateGear.js`, `net/forgeApi.mjs`, `public/forge.html`,
`public/src/forge/main.js`, `test/glb-materials.test.mjs`) are all covered by that rule.

## 8. Dispositions

Every item in the inventory carries one of `PRESERVE_NOW`, `PRESERVE_EXTERNAL_ARCHIVE`,
`PRESERVE_LATER`, `SUPERSEDED_BY`, `HISTORICAL_ONLY`, `DO_NOT_PORT` or `UNKNOWN_NEEDS_REVIEW`, and a
written reason. There is no generic discard bucket.

| Group | Count | Disposition |
| --- | --- | --- |
| Dawnwarden helmet + sword | 2 | `PRESERVE_NOW` — in Git, Forge regression reference |
| Wren Ranger (base + walk + run) | 3 | `PRESERVE_EXTERNAL_ARCHIVE` |
| Bramble Stalker (base + walk + run) | 3 | `PRESERVE_EXTERNAL_ARCHIVE` |
| Enemy Wave 1 rigged candidates | 13 | `PRESERVE_EXTERNAL_ARCHIVE` |
| Seven gear families | 35 | `PRESERVE_LATER` — provider-side only, task IDs are the handle |
| Voidfang Overlord concept | 1 | `PRESERVE_LATER` |
| `sword_wildwood_w1a` (already on main) | 1 | `PRESERVE_NOW` — untouched |

Neither Wren nor Bramble Stalker is referenced by any code path in any of the four source branches;
every `bramble` hit in the source tree is the unrelated gameplay obstacle in `VILLAGE.BRAMBLES`. They
archive cleanly with zero runtime risk.

## 9. Deliberately not done

- No source PR merged, closed or modified.
- No new Meshy generation, rigging or animation. No provider call at all, paid or read-only.
- No promotion of any candidate to shipping. Every item is `status: candidate`.
- No Hero rig, skeleton, body or topology change.
- No fitting of the 35 gear candidates and no wiring of the 13 enemies into gameplay.
- No Stage-1 opening rescue work; that starts on a clean branch after this is accepted.
- No visual acceptance claimed from machine tests. Screenshots go to the owner and the Production
  Director; this document does not self-certify a visual PASS.

Wildthorn is a plausible first onboarding family later, given the Wildwood theme. That is an
observation, **not** a promotion instruction.
