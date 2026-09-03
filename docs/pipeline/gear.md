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
