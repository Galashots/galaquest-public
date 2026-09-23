# Gear lane — generated gear, mounted on the hero, judged in the running game

## Which pipeline am I in?

| Question | Answer |
| --- | --- |
| Fitting a NEW rigid gear item? | **Unity Gear Production V1** — the next section. This is the only current answer. |
| Repairing a mount that already ships in the Three.js client? | The LEGACY section at the bottom of this file. |
| Diagnosing a Three.js runtime gear defect? | The LEGACY section. |
| Fitting skinned/deformable armour? | Not yet supported. Checkpoint B is not built; do not improvise it. |


## Unity is the gear authoring surface from here (Gear Production V1, Checkpoint A)

Rigid gear is now fitted in Unity, not by deriving quaternions in a headless harness. The Three.js
records in `public/src/character/gear.js` remain the RUNTIME authority for the shipping Three.js client
and are historical/reference for authoring purposes; do not hand-author new fits there.

The Unity spine lives under `unity/GalaQuest/Assets/GalaQuest/Gear/`:

- **Sockets** — named `GearSocket` Transforms under GQ_HERO_V1's bones, matching the bones this file's
  Three.js records already use (`Head`, `LeftHand`, `RightHand`, `LeftArm`, `RightArm`).
- **Items** — one `GearItemDefinition` asset per item: semantic id, source model, socket id, fit class,
  socket-local TRS, mirror flag, anatomy coverage, source repo path.
- **Head Fit Proxy** — the headgear clearance envelope, measured from GQ_HERO_V1's own `head_end` and
  `headfront` helper joints and its Head-weighted vertices. Its eye line is authored, because the Hero's
  eyes are painted into the atlas and cannot be measured from geometry.
- **Gear Workbench** — `GalaQuest > Gear > Gear Workbench`. Loads an item, poses the Hero from its own
  clips, frames front/three-quarter/side/gameplay, runs the machine gates, saves and resets.

Adding another rigid item is **new data, not new code**: import the model, create a
`GearItemDefinition` (Assets > Create > GalaQuest > Gear), fit it with the normal Scene View gizmos,
save, and let the shared gates run. There is no per-item C# anywhere in the gear assembly, and
`GearSpineEditModeTests` fails if an item-named script appears.

Machine gates REJECT; they never visually accept. Running-game pixels remain final appearance
authority, and there is no Unity gameplay/controller seam yet, so Unity Editor renders are inspection
evidence and must not be reported as gameplay evidence.

### Covered hair and ears in the Workbench

Mounted items' `HidesAnatomy` declarations drive the normal coverage preview. A helmet covering hair
and ears hides those supervised regions; disabling/removing it restores the original mesh. Turn off
**Preview hidden anatomy** only to inspect the covered anatomy. Fit against the intended covered head,
not the hairstyle. The preview changes a temporary index-buffer copy, never the Hero source or saved fits.

Regenerate the checked-in Unity region map with
`node tools/unity-migration/export-hero-anatomy-regions.mjs`. The exporter verifies the source GLB hash
against the supervised region authority. Unity requires a complete, unique UV-triangle correspondence
before transferring the regions, allowing face reordering/winding and a single V-flip convention.
Missing or ambiguous correspondence rejects coverage; equal triangle counts are insufficient. Escalate
an unsupported derivative instead of guessing hair by height or hiding arbitrary faces. This remains
Workbench inspection evidence, not a Unity gameplay equip implementation.

The qualified Hero importer must enable **Read/Write**: the preview reads UV/index buffers. An
unreadable mesh rejects coverage rather than throwing repeatedly in the Editor. Keep this requirement
scoped to the Hero; do not turn on CPU mesh copies for unrelated assets.

The existing supervised `hair` atom includes **hair and scalp**, authored for the Dawnwarden full-helm
proof. It is not a hair-only cap suitable for every open-face helmet. Silverguard exposes the removed
scalp boundary with the Owner's current fit and remains an unqualified diagnostic item. Do not enlarge,
move, or reseed an Owner fit to hide that mismatch. A new coverage atom needs supervised authoring and
equip/unequip visual review under [character-armoring.md](character-armoring.md); a new full-cover
helmet must independently prove that it conceals the existing cut boundary. Structural coverage PASS
does not establish either condition.

### One-command rigid intake

A generated rigid-gear GLB becomes a Unity-ready candidate, with its own evidence record, in one
command from the repository root:

```bash
node tools/assets/gear-intake.mjs \
  --source public/assets/gear/candidates/<candidate>.glb \
  --id gear.shield.ironwood --name IronwoodShield --tris 1500
```

It orchestrates the existing tools in the order this lane already prescribes, and adds no reducer,
converter, fit or acceptance of its own:

1. `node tools/assets/glb-intake-report.mjs` — the before report;
2. `blender --background --factory-startup --python tools/blender/decimate_gear.py -- <source> <reduced> <tris>`;
3. the same report on the reduced GLB, which must be at or under `--tris` or the run fails;
4. `node tools/unity-migration/convert-gear-asset.mjs` — the Unity FBX, with `--blender` passed through
   so one Blender binary drives both steps.

`--id` is the semantic `gear.<slot>.<name>` id and `--name` is PascalCase; the name supplies the file
stems, so `IronwoodShield` becomes `unity/GalaQuest/GearSources/ironwood-shield-lod.glb` and
`unity/GalaQuest/Assets/GalaQuest/Gear/SourceAssets/IronwoodShield.fbx`. The converter also writes one
`<Name>.texture-<N>.<ext>` sibling beside the FBX per packed image, so those files are outputs of the
run as well.

**Where a run may write is decided by resolved paths, not by spelling.** A run writes to exactly four
locations: the three output roots — `unity/GalaQuest/GearSources/` for the reduced GLB,
`unity/GalaQuest/Assets/GalaQuest/Gear/SourceAssets/` for the FBX and the
`<Name>.texture-<digits>.<jpg|jpeg|png>` siblings beside it, and `docs/asset-production/intake/` for the
record — plus the converter's own provenance file at
`unity/GalaQuest/Assets/GalaQuest/Gear/GearDerivativeProvenance.json`, which this tool does not own but
reuses. The tool refuses a destination under `public/assets` — that tree is runtime payload and
registry-declared territory, and a candidate has no registry entry yet — and it never writes the source.
Each destination's parent directory is created when needed and then resolved with `fs.realpathSync`; a
destination is refused when its path holds a `..` segment, when it resolves outside the checkout, when
its resolved parent is not inside its owned root, when any parent component of its path is a symlink,
when the destination itself already exists as a symlink (a dangling one included, which `fs.existsSync`
cannot see), or when it resolves to the source file. That last check is why a symlink alias pointing at
the source cannot overwrite it even with `--force`: the comparison is between resolved paths, not path
strings. The same confinement covers every path a run may back up or write, not only the three planned
outputs: each texture sibling and the provenance file are checked before either is backed up or written,
so a symlinked sibling or provenance file cannot carry the run's writes out of the checkout. Path
spelling proves nothing about the bytes on either side of it either — a second name for the same bytes
is invisible to a resolved-path comparison — so an existing output, texture sibling or provenance file
with more than one hard link (`statSync().nlink > 1`) is refused even with `--force`, because the other
name of that link can be anywhere on the machine and rewriting this path would change a file outside
every owned root.

**A run is transactional, and it never deletes anything.** Before the first child command, whatever
already exists — each planned output, the FBX's `<Name>.texture-<digits>.<jpg|jpeg|png>` siblings, and
the converter's own provenance file at
`unity/GalaQuest/Assets/GalaQuest/Gear/GearDerivativeProvenance.json` — is copied into a backup
directory under the OS temp directory. Nothing is moved out of the way and no file is ever deleted, by
this tool or on its behalf. Any failure, whether a child exits non-zero, the reduction misses the
triangle budget, or the record cannot be written, deletes only the files and directories this run itself
created, restores every backed-up file byte-for-byte, removes the backup directory and exits non-zero
with the reason. No partial output survives a failed run, and a run refused before it wrote anything
leaves the tree exactly as it found it — and if the rollback itself fails, the tool reports that
incomplete rollback rather than also claiming that no outputs remain.

**Existing files are refused unless you say otherwise.** A real run refuses to replace an existing
output — including an existing `<Name>.texture-<digits>.<jpg|jpeg|png>` sibling — or a
`GearDerivativeProvenance.json` record that already uses this `--id`, unless `--force` is given; the
bytes it replaces are backed up and put back if the run then fails. `--force` grants exactly that and
nothing else: it permits overwriting the files this run writes, it never deletes a file, and it never
overrides a refusal — a symlink, a file that already has more than one hard link, a foreign sibling, or
a provenance file the tool cannot read as JSON.

A sibling beside the FBX whose name only *starts* like a texture this run writes — a Unity
`<Name>.texture-0.jpg.meta`, another extension such as `.tga`, or a non-numeric index — is somebody
else's file. The run refuses and names it, telling the operator to move it manually, with or without
`--force`; no `*.meta` file is ever touched. Add `--dry-run` to print the exact commands, the four write
locations and every refusal the next real run would raise — including an existing provenance record for
this `--id` — while running and writing nothing.

Known follow-up, out of scope for this command: `tools/unity-migration/convert-gear-asset.mjs` records
only a `texture-0.jpg` sibling in the shared provenance file, so a derivative with several packed images
is under-described there even though this run's intake record lists them all.

The record is a machine-readable account of what ran — paths, sha256, triangle counts, the Blender
version, every texture sibling the conversion produced (path, sha256 and size, sorted) and the exact
commands — and it states `"status": "CANDIDATE"` with `fit`, `cavity` and `visual` all `"UNKNOWN"`.
That is the honest claim: intake reduces bytes and records the derivative, and it answers none of the
fit, cavity or appearance questions. Reduced bytes still need the human review in
[asset-visual-review.md](../review-guides/asset-visual-review.md); running-game pixels remain the final
appearance authority; and promotion into shipped production stays Owner-controlled. The record
directory is described in [intake/README.md](../asset-production/intake/README.md).

**An intake output is a candidate that requires producer visual self-review before handoff.** Render it
from front, three-quarter, side and back — for example with `tools/blender/render_glb.py` — and look at
the result rather than trusting the triangle count. An aggressive budget on a fragmented Meshy atlas can
open **cracks in the geometry**: the glTF import splits vertices at every UV seam, and a UV-delimited
collapse reduces each side of a seam separately, so the seams pull apart. The decimated Dawnwarden helmet
at 2,000 triangles showed dark cracks across its dome for exactly that reason; rebaking the texture alone
did not remove them. The fix found in a runner self-review is to weld the seam-split vertices, decimate,
unwrap fresh UVs, and bake the base colour from the full-resolution source onto the reduced mesh. That
weld-and-bake step is not yet part of this command.

## Gear Datum Contract V0 — what the Hero requires, and what an asset intends

Checkpoint A answers WHERE gear attaches. The datum contract answers HOW BIG and WHICH WAY ROUND, in a
form a machine can check.

Each of the five slots has a `GearFitFixtureDefinition` under `Gear/Editor/Fixtures/Definitions/`,
measured from GQ_HERO_V1 itself. A fixture states:

- a canonical wearable convention — **+X wearer right, +Y up, +Z forward, 1 Unity unit = 1 metre**;
- one or more **Gear Frames**, which re-express those canonical axes in an anchor bone's own space so
  that arbitrary imported bone roll is cancelled once, at authoring time;
- named **datums** (`FIT_CROWN`, `FIT_GRIP`, `FIT_HEAD_CAVITY`, …), each classified `FunctionalFit`,
  `KeepClear`, `CollisionWarning`, `ReferenceZone` or `DecorativeExtent`;
- one **primary measurement** per slot, the only thing normalization may use;
- **secondary proportion bands** that Warn or Reject an absurd silhouette.

Every contract-critical number is classified `MEASURED`, `AUTHORED` or `DERIVED`. `Unclassified` is a
hard validation failure: the contract refuses to claim authority for a number nobody has classified.

### The asset side: `GearAssetFitProfile`

A Hero fixture states required NEGATIVE SPACE. An asset's outer mesh bounds are not the same quantity —
they include shell thickness, rivets and crests — so normalizing on them makes a thicker or more
decorated helmet scale *down*, which is backwards.

So each registerable item gets a `GearAssetFitProfile` asset beside its registration, holding what the
asset itself intends to wear:

- the **slot** it is fitted against. This is explicit and is never inferred from `GearFitClass`: a sword
  and a shield are both `Handheld` and obey entirely different fit semantics;
- its **raw-to-canonical rotation**, with explicit `Measured`, `Authored` or `Derived` orientation
  provenance and a non-empty note stating the evidence. Unclassified, nonfinite rotations and blank
  notes reject. The operator never infers orientation from mesh bounds;
- its **fit cavity**;
- named **landmarks** such as `ASSET_FIT_GRIP`.

### Real cavity vs authored virtual fit data

There are exactly two honest ways to get a cavity, and inference is not one of them:

- **`MeasuredFromAssetLocator`** — the source art carries a `GQ_FIT_CAVITY` locator whose bounds ARE the
  cavity. The artist declared it; the contract measured what they declared. Recorded `MEASURED`.
- **`AuthoredVirtualCavity`** — a human states the intended envelope because the geometry cannot supply
  one. Recorded `AUTHORED`, with the reasoning written down in the asset.

There is deliberately no inner-surface detection, wall-thickness heuristic or vertex threshold, because
each of those turns a guess into a "measurement". Fit locators are excluded from render bounds, so
silhouette checks judge only what is actually drawn.

### `NeedsAuthoring` is a correct outcome

An asset with no declared cavity and no authored profile registers as **`NeedsAuthoring`** and claims
**no fit scale at all**. That is honest, not a failure. Do not invent a shell thickness, and do not
derive an enclosing item's cavity from its exterior, in order to avoid it. The Silverguard Helmet sits
in this state today: its source art predates the contract and exposes no interior.

### Registering an item

Select its `GearItemDefinition` and run:

- **`GalaQuest > Gear > Register selected gear item against fit contract`** — measures the asset against
  the fixture its profile names and writes a `GearFitAssetRegistration`, including a single uniform
  normalization scalar. There is never a per-axis correction: an asset outside a proportion band is
  reported and corrected in the ASSET, never squashed to fit.
- **`GalaQuest > Gear > Seed selected gear item from its registration`** — derives the socket-local seed
  transform and writes it onto the item.

Profiles and registrations are ordinary Unity assets; author them in the Inspector.

### Explicit socket/frame/seat authority

The fixture serializes `seatBindings`: `socketId`, `frameId`, `seatingDatumId`. The item socket must
resolve exactly one binding, one compatible frame anchored to the socket's actual bone parent, and
one `FunctionalFit` datum belonging to that frame. There is no primary-frame or left-side fallback:

- `leftShoulder -> GQ_SHOULDER_L_FRAME -> FIT_SHOULDER_CUP_L`;
- `rightShoulder -> GQ_SHOULDER_R_FRAME -> FIT_SHOULDER_CUP_R`;
- `leftHand` in the Shield fixture `-> GQ_SHIELD_FRAME -> FIT_GRIP`.

Profiles answer the seat with `ASSET_` plus that exact datum id. A slot with no binding for the item's
socket is not seedable. Chest/Bracer fixture visualization does not imply a supported Hero socket.
Registration records the resolved seat's frame. Before seeding, item/profile/registration identity,
profile/fixture/registration slot, frame/seat, orientation and primary measurement must agree.
The normal seed entry point refreshes only that item's registration immediately before derivation.

### One-item headless production

Use the Unity CLI with this existing entry point from the repository root:

```bash
unity run unity/GalaQuest --timeout 600 -- -executeMethod GalaQuest.Gear.Editor.GearFitSeedBatch.RunOne -gqGearItem gear.shield.ironwood -gqGearReport .local/unity/gear-item-report.json
```

The report path is relative to the Unity process working directory; use an absolute path when needed.
The item id must resolve exactly one definition. Missing/duplicate ids fail; there is no all-items
fallback. This registers/refreshes, derives a seed, preserves Owner-authored fits, and runs runtime
plus registration-consistency checks against an actual mounted instance. Only the selected definition
and registration may be saved. Registration proportion warnings remain `WARN` in the combined report
and Workbench checks. Missing, empty, invisible or unsupported mounted geometry rejects.
`PASS` means no machine rejection, never visual acceptance. Reports include a unique `runId`, UTC
start time and actual output path. Missing/duplicate/malformed item arguments write `FAIL` to the
valid requested report path; a malformed/unwritable report destination uses the default report when
possible. Always check the exit code and the current run's report, never a previous `PASS` file.

For exact-commit captures, commit the derived data first, then repeat the same invocation with
`-gqGearCapture` (graphics required; do not use `-nographics`). The capture reuses the review renderer
with just that item mounted in memory; it does not rebuild or save the shared scene. Output is under
`.local/unity/review-pack/gear-v1/gear-shield-ironwood/`. Dirty input refuses an exact-SHA claim.
The packet includes neutral front/three-quarter/side/gameplay framings and required idle/running/attack
samples, plus combat stance and shield push. Clip aliases resolve to exactly one actual controller
state, including imported FBX name prefixes; missing/ambiguous poses fail rather than silently
producing an incomplete packet.

Escalate `NeedsAuthoring`, mismatched/ambiguous records, rejected proportions, unavailable source
intent, or a visually bad carry despite clean machine checks. Do not move landmarks to conceal a
carry defect, invent cavities, modify the Hero, or reseed unrelated items. The Silverguard Helmet
remains `NeedsAuthoring`; its incumbent fit is not a cavity measurement.

### Connected Editor validation

The project pins `com.unity.pipeline` and its required Input System dependency in the package
manifest/lockfile. Keep Unity and URP versions unchanged when setting up this command path.

From the repository root, verify the actual Editor command before starting work:

```bash
unity command editor_status --project-path unity/GalaQuest --timeout 10 --format json
unity command run_tests --mode editor --filter AnatomyCoverageEditModeTests --project-path unity/GalaQuest --timeout 180 --format json
unity command run_tests --mode editor --filter GearFitSeedEditModeTests --project-path unity/GalaQuest --timeout 180 --format json
```

Before tests, preserve and save any intended Workbench edits: Unity Test Framework asks about dirty
scenes before execution, and an unanswered native save dialog blocks unattended commands. Coverage
restores the source mesh during scene serialization and reapplies the preview afterward. Never discard
an Owner scene or save unrelated dirty assets merely to clear that prompt.

Inspect `data.result.Summary`: transport `success: true` also occurs when tests fail. Require a nonzero
test count, zero failed/inconclusive tests, and no unexpected skips. A timeout has no test verdict;
inspect Editor/runner state before retrying rather than repeatedly increasing the timeout. Afterward,
verify Owner-fit hashes and absence of scratch assets. These tests do not visually qualify a helmet.

### Registration-derived seed

`GearMounter` consumes plain socket-local TRS and knows nothing about fixtures or canonical space, and
that is deliberate: a shipped build should carry no editor-only concepts. The conversion therefore lives
in editor authoring, in `GearFitSeedSolver`:

```
asset raw space --(profile raw-to-canonical)--> canonical
                --(fixture Gear Frame)--------> anchor bone
                --(socket inverse)------------> socket-local seed TRS
```

- **scale** is exactly the registration's uniform scalar;
- **rotation** is derived so the asset's canonical axes coincide with the Gear Frame, which is what makes
  bone roll cancel. Never hand-author this Euler; a correct one is usually unintuitive;
- **position** aligns the asset's own landmark onto the fixture datum that seats it — for a shield,
  `ASSET_FIT_GRIP` onto `FIT_GRIP`.

If the profile lacks the landmark a slot seats on, the solver **refuses to claim a complete seed** and
says what needs authoring. It does not invent a landmark position.

A seed never overwrites an Owner-authored fit: `GearItemDefinition.TryApplySeedFit` refuses, and only the
explicitly-named destructive reseed command can discard human work.

### Machine rejection vs human visual acceptance

Two gates run, and neither accepts anything:

- `GearFitValidator` (runtime) — socket/proxy/anatomy checks. It must NOT gain a dependency on
  editor-only registration data.
- `GearFitSeedConsistency` (editor) — does the MOUNTED item agree with its registration? It rejects a
  canonical basis that disagrees with its Gear Frame, a non-uniform or mismatched scale, a landmark that
  missed its datum, and extents that disagree with the registered size.

That second gate exists because a shield was once mounted sideways and tilted while the runtime validator
reported zero findings. A defect no gate can express is a defect that ships.

The Workbench **Run checks on current pose** button also invokes the consistency gate, reading the
mounted transform rather than trusting the definition's saved scale. An unseedable record is reported
explicitly, not treated as a clean consistency result.

Both only ever REJECT. Fit visually in the Gear Workbench, inspect front / three-quarter / side /
gameplay framings, and remember that Unity Editor renders are inspection evidence: running-game pixels
remain the final appearance authority.

Export the Unity-authored fits with:

```bash
node tools/unity-migration/export-gear-fits.mjs
```

That writes `docs/foundry/gear/unity_gear_fits.json` deterministically. It does not synthesise
`gear.js` numbers: converting a socket-local Unity transform back into Armature-relative Three.js space
is the coordinate tax this migration exists to stop paying, and doing it silently would hide which
layer a future defect lives in.


---

# LEGACY — Three.js runtime maintenance and reference only

**Everything below this line is the pre-Unity pipeline.** It remains accurate for the Three.js client
that ships the game today, and it is the right procedure for:

- maintaining or repairing a mount that already ships in `public/src/character/gear.js`;
- diagnosing a defect in the currently shipping Three.js runtime;
- reading how an existing accepted fit was reached, and why.

**Do not use any of it to author a NEW rigid gear item.** New rigid gear is fitted in Unity by the
process at the top of this file. In particular, for new gear do not run the `fit-*.mjs` harnesses as
the authoritative fit loop, do not move measured transforms into `gear.js`, and do not use the Forge
authoring/bake loop — those steps exist here to keep the shipping Three.js client maintainable, not
because they are still how gear is designed.

The knowledge below is deliberately preserved rather than deleted: the carry-convention discipline,
the reference-anchoring procedure, and the recorded failure modes are all still true, and the Unity
process at the top inherits them.

Historical proven runs include the cuirass generate-and-fit proof and the shipped belt lantern. Gear is
where the mesh pipeline meets the live rig: create/qualify the mesh with [props.md](props.md), apply the
topology/anatomy-coverage gates in [character-armoring.md](character-armoring.md), then use this runbook
for mounting and running-game acceptance.

## Mounting facts

- Meshy has no GalaQuest socket/attachment system. Runtime mounting lives in
  `public/src/character/gear.js`; read its current records/comments before changing a transform.
- The current hero contract records no finger chains. `RightHand`/`LeftHand` are wrist-level rig
  joints, so do not silently redesign the skeleton to make a held item pass.
- Use the live bone transform/approved mounting convention; do not trust importer-synthesized bone
  tails as anatomical authority.
- Runtime gear transforms are produced from measured fit work, never typed from aesthetic guesswork.
- For an approved hand-seated sword, preserve proximal hand seating when changing length: extend the
  change toward the tip. Never recenter through the mesh/bounding-box center, world-min, or length
  compensation.
- Before solving any mount, use the visual-reference-first procedure and state the carry convention in
  words. Geometry can produce a perfectly consistent wrong convention.

## Fit loop

1. **Blender pre-fit (cheap, catches disasters)** when Blender is available:
   ```bash
   blender --background --factory-startup --python tools/blender/fit_stress_gear.py -- \
     public/assets/hero/hero_lod1_ironwood_atlas.glb tmp/<gear>.glb tmp/<gear>-fit <Bone> <height_m> [dx_left] [dy_fwd] [dz_up]
   ```
   Treat this as stress evidence for the piece being fitted. It does not replace runtime mounting or
   running-game appearance review.

2. **Runtime fit is authoritative for the mount.** The runtime-test harnesses own their own isolated
   GalaQuest server; **do not pre-start `server.mjs` for them**. Provide the dedicated CDP Chrome
   required by the harness, then use the closest existing mount-style tool:
   - `tools/runtime-test/fit-shield.mjs` — forearm/shield-style fit;
   - `tools/runtime-test/fit-sword.mjs` — weapon-hand aiming/clearance;
   - `tools/runtime-test/fit-lantern.mjs` — belt/body offset fit.

   Read each tool's current CLI instead of copying an old flag list into a new harness. Capture the
   exact public SHA and open every produced view.

3. **Judge the whole character against references.** Optimize a static mount for a strong idle read,
   then check movement/combat/reaction poses too. A slash has motion to help it; a bad idle mount has
   nowhere to hide.

4. **Interactions between pieces are real.** Additions can occlude, clip, or collide with existing
   gear. Re-capture with the intended complete loadout rather than judging the new item alone.

5. **Wire + verify.** Move the measured transform into the runtime source, run the required unit suite
   plus the relevant fit/combat/progression harnesses, and inspect their captures. Do not preserve
   historical pass counts as current acceptance criteria.

## Forge acceptance loop — reference-anchored

For a piece that already has an accepted same-family sibling, this is the shortest path that has
actually produced an Owner-accepted fit. It does not replace the fit loop above; it is what to reach
for when GalaQuest already contains a good example of the thing you are fitting. README rules 3
(reference first) and 5 (running-game pixels are final appearance authority) both apply unchanged —
this is how they are executed for gear, not an exception to them.

1. **Anchor on approved GalaQuest pixels, same family, before anything else.** An accepted sibling
   already in this game outranks external convention references for how a piece of this kind is
   carried. Capture the reference and the piece under review from the SAME camera, pose and framing;
   a comparison across different views is not a comparison.

2. **State the visual relationship in words before touching a number.** What crosses the palm, where
   the guard sits relative to the fingers, what is beyond it, what is behind it. This is what you are
   solving for, and it is what an Owner accepts or rejects. Geometry will happily produce a
   perfectly self-consistent wrong convention.

3. **Fit independently. Do not paste a sibling's transform.** Different meshes carry different
   origins and normalization, so the same numbers mean different things. Reuse the sibling's
   *geometry* — the direction its blade points, where its grip meets the hand — and solve this
   mesh's own values against it. Deriving the world rotation that lands this piece on the accepted
   piece's direction is reference use; copying its `ownerFit` is not.

4. **Solve in the order the rig forces: aim, then seat, then scale.** State the seating you want
   first (step 2), but solve orientation before position — the anchor rotates about its own origin,
   so re-aiming moves the seat and re-seating first just relocates the error. This is the 2026-08-14
   re-grip lesson recorded in `gear.js`'s own Tier 2 header; read it before reversing the order.
   Leave scale alone unless the piece is the wrong size — a fit is usually a move and a turn.

5. **Review the fit pose plus idle, run and attack, at more than one bearing.** The deterministic fit
   pose is the authoring frame; the animations are where torso, thigh and forearm intersections show
   up. A slash has motion to hide a bad mount; idle has nowhere to hide.

6. **The Owner accepts on pixels, and good enough is a finishing condition.** Convincing grip and
   guard placement, nothing floating, no gross wrist/forearm or torso/thigh intersection, a readable
   silhouette at gameplay distance. When those hold, **stop.** Continuing to nudge an accepted fit is
   how a good result becomes a worse one, and this rig's open fingers mean some compromises are
   permanent rather than unfinished.

7. **Bake through the canonical path, never by hand.** The Forge authors a bone-local anchor; the
   runtime stores a rig-root-relative rest transform, and converting between them consumes a bone
   matrix. `public/src/forge/runtimeBake.js` is that conversion and is the exact inverse of
   `attachRigidTier2Gear`; it reads the bind pose from the skeleton's own `boneInverses`, so the
   number is the same whether it is exported from the fit pose or mid-clip. A transform measured in
   whatever pose happened to be on screen is the 2026-08-17 remediation's failure repeated.

8. **Runtime correctness never depends on browser storage.** A saved Forge fit is authoring state.
   The accepted value belongs in `public/src/character/gear.js`, and the proof it landed is a fresh
   page load with zero authoring delta reproducing it.

9. **Capture the shipped result after the bake, not the live authoring session.** Running game,
   portrait and landscape, plus the gear screen where the piece is presented as a reward. This is
   README rule 5; a Forge preview is not the game.

10. **An accepted fit is frozen.** Reopen it only when new visual evidence — an Owner rejection, a
    running-game capture, a rig change — says to. Re-deriving a settled transform because a
    measurement looks improvable is how accepted work regresses.

## Character Studio

Character Studio is now a public, tested review/fit surface. Use it for the loadouts, camera presets,
overlays, measurements, and tuning overrides it **actually exposes today**; discover current identifiers
from the runtime descriptors rather than from old phase names.

- Prefer Studio for controlled comparison/fit work it implements.
- Keep the fit harnesses and Foundry scripts as backends, independent cross-checks, and fallbacks.
- Every accepted player-visible gear change still requires running-game portrait/landscape review as
  relevant to the change.
- Animation-driven fit checks use the shipping runtime clip identifier discovered from the actual
  loaded Hero, never a provider/source/review label.

Do not document a future Gear Contract/Studio feature as shipped until the code and tests exist.

## Unlock-gated gear and save safety

**Never seed the repository's real `data/` save to make a fit harness pass.** `server.mjs` explicitly
supports `GALAQUEST_REWARD_STORE_PATH` so owned harnesses/manual review servers can use a scratch DB.
The children's durable save is not test fixture state.

Prefer the existing harness's fresh-guest/reward setup. If a manual review truly needs a seeded store,
point the runtime at a gitignored scratch file such as `.local/fit/rewards.db`, seed that same scratch
store through `net/rewardStore.mjs`, and record the disposable guest id. Delete/recreate the scratch
store when a clean state is required.
