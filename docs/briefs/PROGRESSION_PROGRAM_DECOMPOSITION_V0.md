# Progression Program Decomposition v0

**Program fixed point:** `main@22d83b74b88aa5903bf5997f646db4843987da92`  
**Governing design:** `docs/product/PROGRESSION_CONTRACT_V0.md`  
**Owning product records:** #43 Hero XP/levels, #44 meaningful gear, #47 enemy variety, #41 kid-readable POWER, #35 Pet Companions v1  
**Status:** Owner-approved decomposition plan; package scope/order may be reforecast only through the repository workflow.

## Purpose

Turn the XL progression program into bounded S/M/L packages without losing the shared first-15-minute product loop or allowing one PR to absorb adjacent good ideas.

This document owns **package/dependency structure and default execution routing**. It does not replace Product Vision, the Progression Contract, live Issue stage labels, individual committed worker briefs, PR state, or exact-SHA evidence.

Live lifecycle remains in GitHub Issues/Project. Individual package scope lives in `docs/briefs/`. Chats and Drive are not required recovery surfaces for ordinary execution.

## Operating model

- **Production Director / ChatGPT:** owns live-state refresh, package framing, committed briefs, scope reforecast, GitHub lifecycle coordination, independent exact-SHA audit, bounded Director-direct corrections after worker handoff when appropriate, gate recommendation, and Owner merge handoff.
- **Claude Execute:** default primary write-worker for high-coupling core runtime packages until another worker has demonstrated equivalent reliability on bounded work.
- **Terra / Codex experiment:** first use is a read-only A2 mob-bank inventory so quality/context/token cost can be observed without creating a second core writer. If successful, Terra may later own a bounded S/M implementation package. Terra must never write the same branch concurrently with Claude.
- **Owner:** owns product-direction changes, material scope resize choices, merge/close authorization where reserved, paid provider spend, and final human product/visual acceptance when required.
- **Read-only investigations may fan out in parallel.** Core runtime writes stay mostly serial because progression, combat, protocol, and `gameServer` surfaces overlap heavily.

## Program packages

| ID | Size | Objective | Dependencies | Default execution | Hard boundary |
|---|---|---|---|---|---|
| **A1 — Armor Bank Inventory** | M | Inventory existing armor/gear custody and qualify/shortlist the strongest candidates | none | Director-led read-only audit using connected sources; specialist/Codex read-only assistance as useful | no generation, asset editing, fit correction, promotion, or gameplay integration |
| **A2 — Mob Bank Inventory** | M | Inventory existing mob candidates and shortlist first contrasting archetypes | none | **Terra / Codex read-only trial**, Director audits/supplements inaccessible provider/Drive evidence | no generation, runtime integration, bestiary expansion, or branch writes |
| **P1 — XP / Level Authority** | M | Create the canonical XP->Level authority and make `xp-earned` safe/durable through current profile recovery | current main | **Claude Execute single writer; Director review** | no HUD, combat stat scaling, XP reward sources, POWER UI, gear, enemies, learning, assets |
| **P2 — First Hero Level-Up Vertical** | L | Make gaining a Hero level visible, satisfying, and mechanically stronger | P1 | Claude Execute by default; Director review; running-game acceptance | no armor economy, random loot, learning system, enemy expansion, pet work, Level-5 special |
| **E1 — Enemy Collection Foundation** | L | Convert singular ordinary-enemy state into scalable identified enemy collection architecture end-to-end | P2 recommended; P1 minimum | Claude Execute by default | preserve existing fight semantics; no new archetype, density tuning, drops, or geography |
| **G1 — First Visible Armor Vertical** | L | Earn/equip first real non-weapon armor and visibly/statistically improve | P2 + A1 + E1 | Claude Execute or proven bounded worker | at most ~2 qualified items; no broad armor library or loot economy |
| **E2 — Enemy Population, Levels & Safety** | L | Build a real fixed-world mob field with levels/nameplates and safe recovery | E1 + P2 | Claude Execute by default | use known enemy assets first; no new archetype/assets yet |
| **R1 — Combat XP + Loot Reward Seam** | M | Award level-gap-adjusted combat XP and low-probability ownership-aware loot | P1 + E2 + G1 | candidate future Terra/Codex implementation if A2 trial is strong; otherwise Claude | no large loot table, salvage economy, random affixes, crafting, elaborate physical drops |
| **G2 — Gear Content Batch + Aspiration** | M | Add qualified gear variety and establish first “how do I get THAT?” aspiration | G1 + A1 | asset/runtime worker chosen after A1 evidence | bounded content batch; no fresh provider generation unless separately authorized |
| **L1 — Learning Interaction v0** | L | One fun-first nonfarmable learning interaction with material progression reward | P1 + G2 | Claude Execute by default; Director product review | one interaction, not a curriculum platform/framework |
| **E3 — Enemy Contrast Batch** | L | Add first genuinely different enemy archetypes | E2 + A2 | worker selected from asset/runtime needs | max ~2 archetypes; no geography expansion or large bestiary |
| **M1 — Level 5 Milestone** | M | Deliver first special attack plus bounded milestone movement increase | P2 | candidate bounded worker package | one special slot/attack only; no tree/hotbar |
| **V1 — Opening 15-Minute Integration** | L | Tune and prove the complete opening progression promise | all required predecessors | Claude Execute or best demonstrated integrator; Director/Owner acceptance | tuning/integration only; discovery of a missing subsystem triggers reforecast, not silent expansion |

## Preferred order

Core write sequence:

`P1 -> P2 -> E1 -> G1 -> E2 -> R1 -> G2 -> L1 -> E3 -> M1 -> V1`

Read-only asset lanes:

`A1 + A2` may run in parallel with `P1/P2`.

E1 does not mechanically require P2, but P2 is intentionally earlier so the highest-priority player-facing outcome — visible Hero improvement — lands before the larger enemy-architecture conversion. E1 must nevertheless land before density/drop-rate/multi-mob XP or enemy-variety tuning.

Pets remain sequenced after the Hero/gear/enemy/learning opening vertical. This does not demote #35; the first vertical intentionally uses the Progression Contract's pet-delayed operational strength budget before real Fox/Bear/Frog combat contribution is added.

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

A1 and A2 may run beside P1/P2 because they are read-only investigations. They may produce inventories, qualification findings, shortlists, and recommendations, but they do not promote assets or edit runtime branches.

Do not run two simultaneous core writers across `net/gameServer.mjs`, `public/src/net/protocol.js`, combat state, or shared progression authority unless a later package has proven non-overlapping file ownership and a merge plan before dispatch.

## Terra / Codex evaluation

The A2 trial is intentionally bounded and read-only. Record, when the Codex surface exposes it:

- model/agent configuration used;
- beginning/end usage or token/credit indicators available to the Owner;
- amount of repo/source material inspected;
- useful findings versus unsupported guesses;
- whether the agent obeyed the no-write/no-generation boundary;
- Director correction burden.

Do not treat raw token count as the only metric. The useful comparison is **cost per accepted finding/package**, including review/correction burden.

## Program gate

No later package is authorized merely because it appears in this table. Each package gets a fresh live-main refresh and committed brief before its writer begins. Each merge remains independently gated.