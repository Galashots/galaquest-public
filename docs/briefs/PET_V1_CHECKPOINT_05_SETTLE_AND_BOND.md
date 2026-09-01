# Pet Companions v1 — Checkpoint 0.5: settle cleanly + feel like a buddy

> **STATUS: HISTORICAL — this checkpoint's implementation landed via PR #33 and the pet lane is
> currently sequenced behind the progression spine (see #35 and
> `docs/briefs/PROGRESSION_PROGRAM_DECOMPOSITION_V0.md`).** This brief no longer authorizes work.

**Task-ID:** PET-V1-C05-SETTLE-BOND  
**Worker:** Luna / Codex — single write-worker  
**Repository:** `Galashots/galaquest-public`  
**Starting product head:** `feat/pet-companions-v1@fa0475e28ed64104447d3a78d93040297a8811e3`  
**Branch:** `feat/pet-companions-v1`  
**PR:** #33 `[render preview] feat: pet companions v1`

## Owner observation and production decision

The Owner visually tested Checkpoint 0 at `fa0475e28ed64104447d3a78d93040297a8811e3`.

- Sustained/main companion movement is now materially better and acceptable as the basis for continued work.
- A remaining visual defect is visible when the hero stops: the prototype companion still jitters/micro-adjusts enough to look awkward.
- Rather than spend a whole worker cycle on a microscopic tuning-only repair, this checkpoint pairs the stop-settle correction with one tiny kid-facing expansion: **the player can tap/click the companion and get an immediate happy cosmetic reaction**.

The purpose is still to prove the companion fantasy, not to build pet economy or combat. We want the temporary companion to feel stable when idle and a little more like *your buddy* instead of scenery.

## Goal

On the real running GalaQuest client:

1. sustained movement remains smooth as accepted at the prior head;
2. after the hero stops, the companion finishes any necessary catch-up/settling once, then becomes visually stable — no rapid micro-translation, foot shuffling, heading twitch, or walk/idle chatter while the hero remains stationary;
3. tapping/clicking directly on the visible companion produces a short, unmistakably positive local reaction;
4. the reaction remains cosmetic and local-only and does not alter combat, rewards, quests, profile state, persistence, multiplayer authority, or collision.

## Settle feel requirement

Do not solve the stationary jitter by simply freezing the companion at an obviously wrong distance or by making the idle band huge.

Prefer a small stateful settle/hysteresis seam that distinguishes:

- hero/slot genuinely moving;
- companion finishing a catch-up after the hero stops;
- companion genuinely settled.

After settling, a stationary hero should yield stable companion position and facing over time. Tiny numerical noise must not repeatedly restart locomotion or rotate the companion back and forth.

Preserve:

- the smooth sustained-motion behavior proved by the prior regression test;
- decisive larger-gap catch-up;
- deterministic discontinuity recovery;
- intentional turning while actually moving.

## Tiny expansion: companion bond reaction

Add one simple direct interaction:

- pointer/tap/click on the companion itself triggers a short happy cosmetic reaction;
- use the smallest robust implementation: e.g. a brief hop/bounce/scale beat plus a simple heart/sparkle/ring cue made from existing/local primitives or lightweight UI/Three techniques;
- the reaction should read clearly at normal gameplay framing on desktop and touch-sized viewports;
- it may reuse the current idle animation underneath; no new authored animation is required;
- throttle/reject spam with a short cooldown so repeated taps do not create runaway objects or overlapping effects;
- tapping empty world space must not trigger it;
- do not steal or break the game's existing movement/attack/menu input paths.

This is deliberately a prototype delight beat. Do not build affection points, bond levels, petting economy, dialogue, sound systems, inventory, or persistence around it.

## File ownership

Keep the write surface narrow. Expected files are:

- `public/src/companions/**`;
- minimal necessary companion-specific wiring in `public/src/main.js`;
- targeted tests under `test/`;
- only if needed for exact-head Chrome proof, a small companion-specific runtime-test helper under `tools/runtime-test/`.

Stop before modifying profile/progression schemas, server/network authority, combat/enemy rules, hero rig/anatomy, existing GLB bytes, unrelated UI, or broad input architecture.

If direct companion hit-testing cannot be implemented cleanly inside the existing client input seams without broader ownership, stop and report instead of refactoring the input system.

## Required red-capable coverage

Before accepting the settle fix, add a regression seam that would fail on the Owner-observed behavior. At minimum simulate:

1. several seconds of sustained hero travel;
2. hero becomes stationary;
3. companion is allowed to finish settling;
4. then at least ~2 seconds / 120 frames of stationary hero state.

The test must prove both:

- sustained travel does not regress into the old walk/idle chatter;
- once settled, repeated stationary frames do not cause renewed locomotion or meaningful position/facing oscillation.

For the bond reaction, factor the smallest testable state/cooldown seam practical for the implementation. A DOM-only assertion is not sufficient for final acceptance; real Chrome pixels/input remain required.

## Verification and closing evidence

At the exact result head:

1. `node --test test/companion-follow.test.mjs` PASS.
2. `node --test test/*.test.mjs` PASS.
3. `git diff --check` PASS.
4. Real Chrome at normal gameplay framing shows:
   - sustained walking remains smooth;
   - hero stops and companion settles without visible jitter for multiple seconds;
   - starting movement again resumes clean locomotion;
   - direct mouse click on the companion triggers the positive reaction;
   - direct touch/pointer-equivalent interaction is exercised at a touch-sized viewport and triggers the reaction;
   - empty-space taps do not trigger the reaction;
   - no console errors or obvious leaked/repeated reaction objects after several taps respecting/pressing against the cooldown.
5. Capture/report evidence paths and the exact result SHA.

Machine state may reject a bad settle implementation, but it may not visually accept the game feel. Final visual acceptance remains Owner-controlled in the Render preview.

## Explicitly out of scope

Do **not** add in this checkpoint:

- Fox/Bear/Frog final assets;
- starter-choice UI;
- pet ownership/collection/profile persistence;
- pet combat, buffs, damage, targeting, health, or death;
- rarity, power, XP, levels, upgrades, eggs/hatching, trading/gifting;
- multiplayer pet replication;
- new sound/music systems;
- paid/provider/Meshy calls or asset generation;
- unrelated cleanup/refactors.

## Authorization envelope

Authorized:

- implement this checkpoint only on `feat/pet-companions-v1`;
- commit/push the branch;
- update PR #33;
- run tests and produce local/CI/Chrome evidence;
- post `GQ-WORKER-REPORT v1`.

Not authorized:

- merge or close PR #33;
- write to `main`;
- force-push/rewrite shared history;
- Meshy/provider spend;
- production promotion;
- silent expansion beyond this brief.

## Stop conditions

Stop and report if:

- PR #33 head moves after this brief is relayed and the move is not this brief commit;
- the jitter cannot be reproduced or a materially different root cause emerges requiring broader ownership;
- companion hit-testing requires broad input refactoring;
- any provider/asset spend becomes necessary;
- a new owner product decision is required.

## Worker report

Return `GQ-WORKER-REPORT v1` containing:

- `Task-ID: PET-V1-C05-SETTLE-BOND`
- start head;
- result head;
- DONE/BLOCKED/FAILED;
- changed-file summary;
- pre-fix reproduction evidence for stationary jitter;
- exact tests/results;
- Chrome evidence/capture paths for settle + click/touch reaction;
- explicit not-verified gaps;
- confirmation owner-only actions were not performed.
