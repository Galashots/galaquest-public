# Progression Program Decomposition v0

**Program fixed point:** `main@b7abb7113386f1ce37d65d460f2475007d7fcb02`  
**Governing design:** `docs/product/PROGRESSION_CONTRACT_V0.md`  
**Owning product records:** #43 Hero XP/levels, #44 meaningful gear, #47 enemy variety, #41 kid-readable POWER, #35 Pet Companions v1  
**Status:** Owner-approved decomposition plan. P1, P2, E1, A1, A2, G1, and engineering interlock H1 are complete. **E2 is the next core implementation package; H2 / Issue #63 follows E2 before R1.** A3-S1 is parked pending its bounded locomotion follow-up. Package scope/order may be reforecast only through the repository workflow.

## Purpose

Turn the XL progression program into bounded S/M/L packages without losing the shared first-15-minute product loop or allowing one PR to absorb adjacent good ideas.

This document owns **package/dependency structure and default execution routing**. It does not replace Product Vision, the Progression Contract, live Issue stage labels, individual committed worker briefs, PR state, or exact-SHA evidence.

Live lifecycle remains in GitHub Issues/Project. Individual package scope lives in `docs/briefs/`. Chats and Drive are not required recovery surfaces for ordinary execution.

## Current program snapshot

- **P1 — XP / Level Authority:** COMPLETE. PR #53 merged; current `main` includes the canonical XP->Level law and durable `xp-earned` fact path.
- **P2 — First Hero Level-Up Vertical:** COMPLETE. PR #56 merged as `8e247b2a395e1fe0a2d53ba8eb66d7e55340b8d4`; current `main` includes the real Level-2 Lantern -> XP path, canonical Hero max-HP/damage resolution, POWER, scalable health presentation, and online/offline combat consumption.
- **E1 — Enemy Collection Foundation:** COMPLETE. PR #59 merged as `480fe426cb915e03071c08ae047bf32ce0a57dbc`; ordinary enemies now have collection-shaped stable identity end-to-end while the shipped default remains one ordinary Wolf.
- **A1 — Armor Bank Inventory:** COMPLETE. Working first-vertical leads are Silverguard Helmet + Ironwood Shield; broader local armor content remains thin. Durable result is recorded on #44.
- **A2 — Mob Bank Inventory:** COMPLETE. Recoverable Wave-1 candidate bank exists; working leads are Spriggan Scrapper, Magmahorn Juggernaut, and conditional Graveflame Reaper. Durable corrected result is recorded on #47.
- **G1 — First Visible Armor Vertical:** COMPLETE. PR #70 merged; Ironwood Shield and Silverguard Helmet now form the first truthful non-weapon armor vertical with real mitigation/POWER/equipment recovery.
- **H1 — Shared-World Restore Integrity:** COMPLETE. PR #72 merged as `b7abb7113386f1ce37d65d460f2475007d7fcb02`; client restore can no longer author shared economy or reserve another profile's server-authored durable identity while legitimate local-first personal recovery remains exactly once.
- **E2 — Enemy Population, Levels & Safety:** NEXT core write package. Prepared on `feat/progression-e2-enemy-population-levels-safety` under `docs/briefs/PROGRESSION_E2_ENEMY_POPULATION_LEVELS_SAFETY.md`.
- **H2 — Issue #63 inbound WebSocket backpressure:** sequenced immediately after E2 and before R1 so two invisible engineering packages do not run back-to-back.
- **A3-S1 — Spriggan Qualification:** PARKED on draft PR #57 at `e6eb12b2895d34bb4255180f270083edc3f85202`, disposition **ADVANCE AFTER BOUNDED FOLLOW-UP**. Static/source/material evidence supports Spriggan as the current skirmisher lead, but the already-generated Meshy walk/run outputs still need recovery and inspection. Current provider retrieval fails before reaching Meshy; do not regenerate substitute locomotion or spend provider credits.

## Operating model

- **Production Director / ChatGPT:** owns live-state refresh, package framing, committed briefs, scope reforecast, GitHub lifecycle coordination, independent exact-SHA audit, bounded Director-direct corrections after worker handoff when appropriate, gate recommendation, and Owner merge handoff.
- **Current progression-push worker routing:** fresh non-project **GPT-5.6 Sol XHigh** is the default semantic implementation worker. The Owner may explicitly switch a package to Luna/Codex when local execution/tooling or session circumstances make that useful; one semantic writer still owns the package at a time. Older Claude/Terra default-worker labels in this document are superseded by this routing rule.
- **Read-only investigations may fan out in parallel.** Core runtime writes stay mostly serial because progression, combat, protocol, and `gameServer` surfaces overlap heavily.
- **Asset work stays a separate lane.** A3 qualification/follow-up must not become a concurrent writer on a core runtime branch, and provider work remains separately authorized.
- **Owner:** owns product-direction changes, material scope resize choices, merge/close authorization where reserved, paid provider spend, and final human product/visual acceptance when required.

## Program packages

| ID | Size | Objective | Dependencies | Current execution / status | Hard boundary |
|---|---|---|---|---|---|
| **A1 — Armor Bank Inventory** | M | Inventory existing armor/gear custody and qualify/shortlist the strongest candidates | none | **COMPLETE — read-only audit + Director adjudication** | no generation, asset editing, fit correction, promotion, or gameplay integration |
| **A2 — Mob Bank Inventory** | M | Inventory existing mob candidates and shortlist first contrasting archetypes | none | **COMPLETE — read-only audit + Director/Drive adjudication** | no generation, runtime integration, bestiary expansion, or branch writes |
| **P1 — XP / Level Authority** | M | Create the canonical XP->Level authority and make `xp-earned` safe/durable through current profile recovery | prior main | **COMPLETE — PR #53 merged** | no HUD, combat stat scaling, XP reward sources, POWER UI, gear, enemies, learning, assets |
| **P2 — First Hero Level-Up Vertical** | L | Make gaining a Hero level visible, satisfying, and mechanically stronger | P1 | **COMPLETE — PR #56 merged** | no armor economy, random loot, learning system, enemy expansion, pet work, or Level-5 special |
| **E1 — Enemy Collection Foundation** | L | Convert singular ordinary-enemy state into scalable identified enemy collection architecture end-to-end | P2 recommended; P1 minimum | **COMPLETE — PR #59 merged** | preserve existing fight semantics; no new archetype, density tuning, drops, or geography |
| **G1 — First Visible Armor Vertical** | L | Earn/equip first real non-weapon armor and visibly/statistically improve | P2 + A1 + E1 | **COMPLETE — PR #70 merged** | first content centered on qualified Silverguard Helmet / Ironwood Shield; no broad armor library or loot economy |
| **E2 — Enemy Population, Levels & Safety** | L | Build a real fixed-world mob field with levels/nameplates and safe recovery | E1 + P2 + G1 + H1 | **NEXT — Codex / GPT-5.6 Luna worktree/browser lane** | use the production Wolf population first; no new archetype integration yet |
| **R1 — Combat XP + Loot Reward Seam** | M | Award level-gap-adjusted combat XP and low-probability ownership-aware loot | P1 + E2 + G1 | worker selected under current routing from the actual runtime/tooling surface | no large loot table, salvage economy, random affixes, crafting, elaborate physical drops |
| **G2 — Gear Content Batch + Aspiration** | M | Add qualified gear variety and establish first “how do I get THAT?” aspiration | G1 + A1 | worker selected under current routing after G1 evidence | bounded content batch; no fresh provider generation unless separately authorized |
| **L1 — Learning Interaction v0** | L | One fun-first nonfarmable learning interaction with material progression reward | P1 + G2 | current progression-push routing applies | one interaction, not a curriculum platform/framework |
| **A3 — Selected Enemy Qualification** | M | Turn only selected recoverable enemy candidates into technically/visually qualified inputs for E3 | A2 | **IN PROGRESS / PARKED — S1 PR #57 needs bounded locomotion follow-up** | no enemy AI/gameplay integration, no broad Wave-1 cleanup, no fresh paid generation, no promotion without its gate |
| **E3 — Enemy Contrast Batch** | L | Add first genuinely different enemy archetypes to gameplay | E2 + A3 | worker selected from runtime needs under current routing | max ~2 archetypes initially; Graveflame remains conditional; no geography expansion or large bestiary |
| **M1 — Level 5 Milestone** | M | Deliver first special attack plus bounded milestone movement increase | P2 | current progression-push routing applies | one special slot/attack only; no tree/hotbar |
| **V1 — Opening 15-Minute Integration** | L | Tune and prove the complete opening progression promise | all required predecessors | best demonstrated integrator; Director/Owner acceptance | tuning/integration only; discovery of a missing subsystem triggers reforecast, not silent expansion |

## Preferred order

Completed core sequence:

`P1 -> P2 -> E1 -> G1 -> H1`

Next core sequence:

`E2 -> H2 (#63) -> R1 -> G2 -> L1 -> E3 -> M1 -> V1`

Completed supporting predecessors:

`A1 + A2`

Asset qualification lane:

`A3-S1` may resume independently when the already-generated Spriggan locomotion outputs can be recovered. A3 must finish before E3 selects/integrates new enemy assets, but it is not a prerequisite to E2. Do not create replacement provider jobs merely to unblock the parked retrieval seam.

Pets remain sequenced after the Hero/gear/enemy/learning opening vertical. This does not demote #35; the first vertical intentionally uses the Progression Contract's pet-delayed operational strength budget before real Fox/Bear/Frog combat contribution is added.

## Safe-point ratchets after P2 + E1

### Mechanics must consume the progression-derived stat, not merely display it

`docs/MISTAKES.md` already owns this as **GQ-013 — “A reward the rules never read is a lie with a ceremony attached.”** Do not create a duplicate lesson.

P2 exposed the exact failure shape during Director audit: the offline Wolf caller supplied both resolved `heroDamage` and `maxHp`, but the solo encounter adapter forwarded only damage, leaving Level-2/charm max HP stuck on the Level-1 fallback. The final P2 correction made the resolved max HP reach the actual fight body as well as the UI. Future progression packages must therefore prove the new strength reaches the mechanics it claims to change, not merely the item catalogue, Hero screen, POWER calculation, or celebration.

### E1 is architecture complete, not enemy-content complete

E1 established stable ordinary-enemy identity through simulation -> events -> server/wire -> client presenter and proved simultaneous enemies mechanically, but intentionally preserved one authored Wolf in the shipped world. E2 now owns population, enemy levels/nameplates/safety; new archetypes remain E3 after A3 qualification. E2 must not absorb A3/E3 asset/archetype work merely because the collection foundation now exists.

### Final-checkpoint diagnostic chasing is bounded

The reusable P2 process lesson is already ratcheted into `docs/WORKFLOW.md` by PR #58: once a final checkpoint is feature-complete, broad diagnostic failures are classified by causality; only proven in-scope regressions are repaired on that package. E2 inherits that stop boundary rather than reopening unrelated browser-matrix debt.

## A1/A2 evidence ratchets

### Armor

A1 established that the first bounded visible-gear vertical has credible existing content in the Silverguard Helmet and Ironwood Shield, with Silverguard Shoulders as an experiment rather than a settled slot. It did **not** establish enough qualified local armor to promise the full first-15-minute 4–6 visible-upgrade target. Later content work must respect that gap rather than manufacturing a quota.

### Enemies

A2 established a recoverable Wave-1 bank but did **not** visually accept or gameplay-promote it. Working qualification leads are:

1. **Spriggan Scrapper** — normal pack/skirmisher lead;
2. **Magmahorn Juggernaut** — durable brute / initial elite lead;
3. **Graveflame Reaper** — conditional ranged/zone lead only if visual/animation/combat qualification supports that read.

Current repository authority records the Wave-1 base GLBs as externally archived/recoverable candidate bytes, with provider walk/run outputs available but not committed, a known raw Meshy material-export quarantine, and visual/deformation acceptance still UNKNOWN. Therefore recovery/material/motion/performance/visual work belongs in A3, not silently inside E3.

A3-S1 adds one live qualification result: Spriggan remains the preferred skirmisher lead after source/static/material review, with a verified materials-only cleanup derivative. Production qualification is **not** complete until the already-generated locomotion outputs are recovered/inspected and the payload/texture budget receives its bounded follow-up. PR #57 remains parked; no substitute generation is authorized.

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

## Worker-routing evidence

A1 and A2 established Codex/Terra as useful for bounded read-only investigation. That remains evidence about a capability, not a standing assignment.

A3-S1's historical planning text named Terra/Codex, but live PR #57 records that the actual slice was executed by a fresh regular non-project GPT-5.6 Sol XHigh chat and independently audited by the Director. The Owner's later progression-push routing therefore supersedes the old fixed model labels: use fresh non-project GPT-5.6 Sol XHigh by default, and choose Luna/Codex when a concrete execution/tooling need or explicit Owner direction makes it the better worker.

E2 is such a concrete exception: multi-enemy placement, leash behavior, safe respawn, responsive nameplates, and final running-game evidence require repeated local/browser feedback, so its committed brief routes the single semantic writer to Codex / GPT-5.6 Luna. Evaluate future workers by **cost per accepted result**, including Director correction burden, not raw token count alone.

## Program gate

No later package is authorized merely because it appears in this table. Each package gets a fresh live-main refresh and committed brief before its worker begins. Each merge remains independently gated.