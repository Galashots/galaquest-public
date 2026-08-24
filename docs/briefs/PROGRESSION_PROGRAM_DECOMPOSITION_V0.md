# Progression Program Decomposition v0

**Program fixed point:** `main@ee2c5e60a29c6c2e6572ad3d0d0b8d36aff33885`  
**Governing design:** `docs/product/PROGRESSION_CONTRACT_V0.md`  
**Owning product records:** #43 Hero XP/levels, #44 meaningful gear, #47 enemy variety, #41 kid-readable POWER, #35 Pet Companions v1  
**Status:** Owner-approved decomposition plan. P1, A1, and A2 are complete; P2 is the next core implementation package. Package scope/order may be reforecast only through the repository workflow.

## Purpose

Turn the XL progression program into bounded S/M/L packages without losing the shared first-15-minute product loop or allowing one PR to absorb adjacent good ideas.

This document owns **package/dependency structure and default execution routing**. It does not replace Product Vision, the Progression Contract, live Issue stage labels, individual committed worker briefs, PR state, or exact-SHA evidence.

Live lifecycle remains in GitHub Issues/Project. Individual package scope lives in `docs/briefs/`. Chats and Drive are not required recovery surfaces for ordinary execution.

## Current program snapshot

- **P1 — XP / Level Authority:** COMPLETE. PR #53 merged; current `main` includes the canonical XP->Level law and durable `xp-earned` fact path.
- **A1 — Armor Bank Inventory:** COMPLETE. Working first-vertical leads are Silverguard Helmet + Ironwood Shield; broader local armor content remains thin. Durable result is recorded on #44.
- **A2 — Mob Bank Inventory:** COMPLETE. Recoverable Wave-1 candidate bank exists; working leads are Spriggan Scrapper, Magmahorn Juggernaut, and conditional Graveflame Reaper. Durable corrected result is recorded on #47.
- **P2 — First Hero Level-Up Vertical:** NEXT core write package.
- **A3 — Selected Enemy Qualification:** PLANNED asset predecessor to E3. It prevents candidate recovery/material/animation/visual work from silently bloating the later enemy-archetype implementation package.

## Operating model

- **Production Director / ChatGPT:** owns live-state refresh, package framing, committed briefs, scope reforecast, GitHub lifecycle coordination, independent exact-SHA audit, bounded Director-direct corrections after worker handoff when appropriate, gate recommendation, and Owner merge handoff.
- **Claude Execute:** default primary write-worker for high-coupling core runtime packages until another worker has demonstrated equivalent reliability on bounded implementation work.
- **Terra / Codex:** now proven useful for bounded read-only GalaQuest investigation work from A1 and A2. A future selected-enemy qualification slice is a candidate first bounded asset-write trial; Terra must not become a concurrent writer on a Claude-owned core branch.
- **Owner:** owns product-direction changes, material scope resize choices, merge/close authorization where reserved, paid provider spend, and final human product/visual acceptance when required.
- **Read-only investigations may fan out in parallel.** Core runtime writes stay mostly serial because progression, combat, protocol, and `gameServer` surfaces overlap heavily.

## Program packages

| ID | Size | Objective | Dependencies | Default execution | Hard boundary |
|---|---|---|---|---|---|
| **A1 — Armor Bank Inventory** | M | Inventory existing armor/gear custody and qualify/shortlist the strongest candidates | none | **COMPLETE — Terra High read-only audit + Director adjudication** | no generation, asset editing, fit correction, promotion, or gameplay integration |
| **A2 — Mob Bank Inventory** | M | Inventory existing mob candidates and shortlist first contrasting archetypes | none | **COMPLETE — Terra High read-only audit + Director/Drive adjudication** | no generation, runtime integration, bestiary expansion, or branch writes |
| **P1 — XP / Level Authority** | M | Create the canonical XP->Level authority and make `xp-earned` safe/durable through current profile recovery | prior main | **COMPLETE — PR #53 merged** | no HUD, combat stat scaling, XP reward sources, POWER UI, gear, enemies, learning, assets |
| **P2 — First Hero Level-Up Vertical** | L | Make gaining a Hero level visible, satisfying, and mechanically stronger | P1 | **Claude Execute single writer; Director checkpoint/final review; running-game acceptance** | no armor economy, random loot, learning system, enemy expansion, pet work, or Level-5 special |
| **E1 — Enemy Collection Foundation** | L | Convert singular ordinary-enemy state into scalable identified enemy collection architecture end-to-end | P2 recommended; P1 minimum | Claude Execute by default | preserve existing fight semantics; no new archetype, density tuning, drops, or geography |
| **G1 — First Visible Armor Vertical** | L | Earn/equip first real non-weapon armor and visibly/statistically improve | P2 + A1 + E1 | Claude Execute or proven bounded worker | first content centered on qualified Silverguard Helmet / Ironwood Shield; no broad armor library or loot economy |
| **E2 — Enemy Population, Levels & Safety** | L | Build a real fixed-world mob field with levels/nameplates and safe recovery | E1 + P2 | Claude Execute by default | use known active enemy assets first; no new archetype integration yet |
| **R1 — Combat XP + Loot Reward Seam** | M | Award level-gap-adjusted combat XP and low-probability ownership-aware loot | P1 + E2 + G1 | candidate future Terra/Codex implementation if a write trial has succeeded; otherwise Claude | no large loot table, salvage economy, random affixes, crafting, elaborate physical drops |
| **G2 — Gear Content Batch + Aspiration** | M | Add qualified gear variety and establish first “how do I get THAT?” aspiration | G1 + A1 | asset/runtime worker chosen after G1 evidence | bounded content batch; no fresh provider generation unless separately authorized |
| **L1 — Learning Interaction v0** | L | One fun-first nonfarmable learning interaction with material progression reward | P1 + G2 | Claude Execute by default; Director product review | one interaction, not a curriculum platform/framework |
| **A3 — Selected Enemy Qualification** | M | Turn only selected recoverable enemy candidates into technically/visually qualified inputs for E3 | A2 | candidate Terra/Codex asset-write trial under separate committed brief; Director visual/technical gates | no enemy AI/gameplay integration, no broad Wave-1 cleanup, no fresh paid generation, no promotion without its gate |
| **E3 — Enemy Contrast Batch** | L | Add first genuinely different enemy archetypes to gameplay | E2 + A3 | worker selected from runtime needs | max ~2 archetypes initially; Graveflame remains conditional; no geography expansion or large bestiary |
| **M1 — Level 5 Milestone** | M | Deliver first special attack plus bounded milestone movement increase | P2 | candidate bounded worker package | one special slot/attack only; no tree/hotbar |
| **V1 — Opening 15-Minute Integration** | L | Tune and prove the complete opening progression promise | all required predecessors | best demonstrated integrator; Director/Owner acceptance | tuning/integration only; discovery of a missing subsystem triggers reforecast, not silent expansion |

## Preferred order

Core write sequence:

`P2 -> E1 -> G1 -> E2 -> R1 -> G2 -> L1 -> E3 -> M1 -> V1`

Completed predecessors:

`P1 + A1 + A2`

Asset qualification lane:

`A3` may run in parallel after A2, but must finish before E3 selects/integrates new enemy assets. It is not a prerequisite to P2/E1/G1/E2.

E1 does not mechanically require P2, but P2 remains intentionally earlier so the highest-priority player-facing outcome — visible Hero improvement — lands before the larger enemy-architecture conversion. E1 must nevertheless land before density/drop-rate/multi-mob XP or enemy-variety tuning.

Pets remain sequenced after the Hero/gear/enemy/learning opening vertical. This does not demote #35; the first vertical intentionally uses the Progression Contract's pet-delayed operational strength budget before real Fox/Bear/Frog combat contribution is added.

## A1/A2 evidence ratchets

### Armor

A1 established that the first bounded visible-gear vertical has credible existing content in the Silverguard Helmet and Ironwood Shield, with Silverguard Shoulders as an experiment rather than a settled slot. It did **not** establish enough qualified local armor to promise the full first-15-minute 4–6 visible-upgrade target. Later content work must respect that gap rather than manufacturing a quota.

### Enemies

A2 established a recoverable Wave-1 bank but did **not** visually accept or gameplay-promote it. Working qualification leads are:

1. **Spriggan Scrapper** — normal pack/skirmisher lead;
2. **Magmahorn Juggernaut** — durable brute / initial elite lead;
3. **Graveflame Reaper** — conditional ranged/zone lead only if visual/animation/combat qualification supports that read.

Current repository authority records the Wave-1 base GLBs as externally archived/recoverable candidate bytes, with provider walk/run outputs available but not committed, a known raw Meshy material-export quarantine, and visual/deformation acceptance still UNKNOWN. Therefore recovery/material/motion/performance/visual work belongs in A3, not silently inside E3.

## Scope-reforecast rule

Every package starts with:

`objective -> size -> included surfaces -> explicit exclusions -> acceptance gates -> checkpoint plan -> side-quest destination`

Any new idea or discovery — including an Owner-originated addition — is classified before entering the active branch:

1. necessary to finish the locked objective -> include and resize/checkpoint if materially expanded;
2. useful but scope-changing -> explicitly resize or split;
3. valuable and separable -> route to the owning product/engineering/asset record;
4. low-value/passing thought -> conversation only.

No package absorbs work merely because the relevant file is already open.

## Parallel-lane rule

Read-only investigation may run beside a core write lane. Candidate asset work may also run in parallel only when it is on a separate branch with explicit file/authority ownership and no overlap with the core runtime writer.

Do not run two simultaneous core writers across `net/gameServer.mjs`, `public/src/net/protocol.js`, combat state, or shared progression authority unless a later package has proven non-overlapping file ownership and a merge plan before dispatch.

## Terra / Codex evaluation

A1 and A2 established Terra High as a useful read-only investigation tier. Owner-observed weekly usage moved approximately 89% -> 87% for A1 and 87% -> 86% for A2; the UI percentage is coarse, so treat this only as a practical cost signal, not exact token accounting.

A future write trial must be evaluated separately. The useful comparison remains **cost per accepted result**, including Director correction burden, not raw token count alone.

## Program gate

No later package is authorized merely because it appears in this table. Each package gets a fresh live-main refresh and committed brief before its writer begins. Each merge remains independently gated.