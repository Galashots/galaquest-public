# ARMOR-R1 — Silverguard Shoulders Running-Game Visibility

**Package class:** M — coupled visual/runtime correction  
**Owning issue:** #125 under #44  
**Base:** `main@434862525f7c0a7e9becfaa374a52a7dbe3b4edc`  
**Branch:** `fix/issue-125-silverguard-shoulders-visibility`

## Objective

Make the already-equipped `shoulder_silverguard` item visibly truthful: both pauldrons appear on the
correct Hero at ordinary gameplay framing and in the Hero presentation when equipped, disappear when
not equipped, restore after reload/reconnect, and present correctly on sibling/remote Heroes without
changing the existing equipment, reward, stat, POWER, or persistence laws.

The current main branch already contains the Shoulder GLB, left/right mount definitions, lazy
equip-state wiring, and remote/sibling mount path. The Owner nevertheless failed the running-game
visual outcome during the later gear review. Treat the existing source comment that the Shoulder fit
never received the Helmet's live WebGL confirmation as a causal lead, not a conclusion.

## Included surfaces

- Reproduce the current failure on the real equipped-Shoulders path before changing the mount.
- Determine whether the bounded cause is transform/scale/seat/orientation, visibility timing,
  clone/material state, or another presentation seam.
- Reuse `public/assets/gear/shoulder_silverguard.glb` and the existing mount architecture in
  `public/src/character/gear.js` and `public/src/main.js`.
- If fit is causal, solve it against the live Hero/bind-pose/running-game seam rather than copying
  stale source-only measurements or hand-tuning unexplained constants.
- Preserve local Hero, Hero preview, sibling/remote, equip/unequip, and reload/reconnect visual truth.
- Add the smallest red-capable test and runtime proof needed to keep this exact failure from returning.
- Capture portrait and landscape running-game evidence at the final exact head.

## Explicit exclusions

No new gear or armor generation, provider work or spend, stat/POWER/drop/economy tuning, generalized
equipment rewrite, permanent slot-taxonomy decision, Hero rig/skeleton/body/anatomy/topology change,
unrelated Helmet/Shield retuning, HUD/guidance work, enemy/NPC/map expansion, or resurrection of the
old Ranger Lodge branch as the implementation surface.

If the running-game reproduction proves the defect requires one of those excluded surfaces, stop and
reforecast rather than silently broadening this package.

## Acceptance gates

- **Reproduction:** exact current-main evidence demonstrates the pre-fix visual failure or establishes
  a comparably strong red-capable runtime seam.
- **Local presentation:** equipping produces two visible pauldrons on the correct Hero; unequipping
  removes them; ordinary gameplay and Hero presentation agree.
- **Fit/readability:** both sides read as intentionally worn at gameplay distance with no gross
  floating, implausible scale, head/neck collision, or obvious left/right mis-seat.
- **Persistence:** reload/reconnect restores equipped pixels without replaying unrelated ceremony.
- **Multiplayer:** sibling/remote presentation follows each profile's own equipped state independently.
- **Mechanical preservation:** existing Shoulder stats, POWER, reward/drop behavior and durable equip
  facts are unchanged.
- **Engineering:** targeted tests/runtime proof PASS; required hosted `unit` PASS; Director runtime
  bundle PASS when applicable; final evidence names the exact public head SHA.
- **Visual/product fit:** Owner running-game acceptance remains **UNKNOWN** until human review of the
  final running game. Machine measurements may reject a bad result but cannot visually accept it.

## Checkpoint plan

1. **R1-C0 — reproduce and diagnose:** prove the current failure and identify the smallest causal seam.
2. **R1-C1 — correct and prove locally:** make only the bounded presentation correction and verify
   local equip/unequip, preview and reload behavior.
3. **R1-C2 — final exact-head evidence:** prove sibling independence plus portrait/landscape running-game
   presentation, run required hosted gates, and stop for independent Director/Owner review.

## Side-quest destination

Broader armor-bank disposition, recovered provider assets, retexture variants and future fresh armor
production remain under #44 as separate bounded packages. Animation, enemy/NPC variety and geography
remain on their existing owning records and do not enter this branch.
