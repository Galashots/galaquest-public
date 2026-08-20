# Gear lane — generated gear, mounted on the hero, judged in the running game

Historical proven runs include the cuirass generate-and-fit proof and the shipped belt lantern. Gear is
where the mesh pipeline meets the live rig: create/qualify the mesh with [props.md](props.md), then use
this runbook for mounting and running-game acceptance.

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
