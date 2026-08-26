# Progression R1 — Combat XP + Loot Reward Seam

**Task-ID:** `PROG-R1-COMBAT-XP-LOOT-REWARD-SEAM`  
**Package size:** **M — Coupled**  
**Worker topology:** **Claude Code Team: Opus manager + Sonnet implementation specialist + Sonnet verification specialist**  
**Director:** ChatGPT / GalaQuest Production Director  
**Repository:** `Galashots/galaquest-public`  
**Starting public fixed point:** `main@cb1f40bc03ffd0beacf1f5b7740980bffa3961e7`  
**Branch:** `feat/progression-r1-combat-xp-loot-reward-seam`  
**Owning product record:** #43 Hero XP, levels, and kid-readable progression  
**Related product records:** #44 meaningful gear, #47 enemy variety, #41 POWER  
**Program plan:** `docs/briefs/PROGRESSION_PROGRAM_DECOMPOSITION_V0.md`  
**Governing design:** `docs/product/PRODUCT_VISION.md` + `docs/product/PROGRESSION_CONTRACT_V0.md`

## Objective

Turn the already-shipped P1/P2 XP spine, G1 equipment system, and E2 fixed-level enemy field into GalaQuest's first repeatable ordinary-combat reward loop without inventing a second progression economy.

At R1 completion:

1. defeating a rewardable ordinary enemy awards combat XP exactly once to every **distinct contributing profile**;
2. combat XP is derived from **enemy/content level plus a Hero/enemy level-gap modifier**, never from the Hero's own current-level requirement and never from displayed POWER;
3. reward from badly outleveled enemies decays materially and reaches **zero at a bounded gap**, so old one-shot content demonstrates power without becoming the optimal leveling strategy;
4. two siblings who both contribute receive their own full personal reward rather than splitting one child's progression, while two simultaneous bodies/tabs for the **same profile** cannot double-collect one enemy life;
5. online live combat remains server-adjudicated, while the existing local-first/offline recovery posture can represent honest offline combat progression without introducing mutable XP totals or unstable identities;
6. R1 establishes one low-probability **ownership-aware equipment-drop decision seam** outside the pure combat rules, with no duplicate promise and no randomness inside `public/src/combat/`;
7. guaranteed/signature G1 reward sources remain authored rewards: ordinary combat must not bypass Rowan's Wildwood Blade or Blackthorn Hollow's Silverguard Helmet merely to make a loot test visible;
8. combat XP produces compact kid-readable feedback and moves the existing XP/Level UI truthfully; if one kill also produces a level-up and a gear opportunity, **level-up remains the stronger routine celebration** and the gear choice must not stack over it;
9. equipment rewards, when eligible, remain ownership-only until the child explicitly equips them through the existing G1 choice/equip law; no combat reward auto-equips gear;
10. no G2 content batch, salvage economy, affixes, crafting, physical loot-object system, new enemy archetype, learning system, pet work, new geography, or provider work is added.

## Locked package contract

`repeatable ordinary-combat rewards -> M -> shared reward law + durable attribution + online/offline/co-op integration + compact feedback -> level-gap XP + ownership-aware low-probability gear decision seam -> no G2 content batch/salvage/affixes/physical drops/new enemies/assets -> two exact-SHA checkpoints -> protected unit + targeted reward/persistence/runtime evidence -> side quests route to #43/#44/#47 or later packages`

## Owner/product invariants

Preserve these settled rules:

- Hero progression remains the primary source of strength.
- Ordinary grinding is legitimate MMO play but materially less efficient than authored progression and later learning.
- Old enemies remain fixed-level and eventually become trivial; GalaQuest does **not** universally scale enemies to the Hero.
- XP remains the derived fold of append-only `xp-earned` facts. Do not add a mutable stored XP total.
- POWER is downstream presentation only. Combat rewards must never read POWER to decide XP, drop chance, eligibility, or durable writes.
- Early gear is readable and player-chosen. Ownership is not equip state, and a clear upgrade is never silently auto-equipped.
- Duplicate equipment is avoided for now. Eligibility must be checked **before** a gear reward is promised.
- Level-up is the strongest routine progression celebration; routine gear feedback must defer rather than obscure it.
- Live connected combat remains server-adjudicated. Existing same-device/local-first recovery remains available for personal progression under the current V0 trust model.
- No paid Meshy/provider work is authorized by R1.

## Current fixed-point facts to refresh before editing

Do not trust these facts if live GitHub has moved.

- P1/P2 are merged: `xp-earned` is durable end-to-end, XP folds through the canonical progression law, and Hero Level changes real max HP/damage plus POWER/UI.
- The current cumulative XP curve begins Level 2 at 100, Level 3 at 250, Level 4 at 450, Level 5 at 700.
- G1 is merged: the Ironwood Shield is truthful baseline equipment; `helmet_silverguard` is a guaranteed Blackthorn Hollow reward with explicit equip choice; Wildwood Blade remains an authored Rowan reward.
- E2 is merged: production has five stable ordinary Wolves with authored levels 1/1/2/2/4, and ordinary-enemy combat/defeat state carries stable `enemyId`, `kind`, and `level`.
- The current `wolf-hit` / `wolf-defeated` reward fold already tracks participation per stable enemy identity and mints one shared enemy-life identity so Lantern Marks do not bleed between simultaneous enemies.
- H1 is merged: client restore may recover personal history but may not author shared economy/world facts or reserve another profile's server-authored durable identity.
- H2 is merged: inbound WebSocket application messages are rate-bounded and inbound restore-profile batches are capped.
- `public/src/combat/` remains a pure rules layer. Progression catalogues, RNG/drop selection, durable storage, and UI do not belong inside it.

Stop for Production Director reforecast if current `main`, branch head, these seams, or the package dependencies have materially changed.

## Reward attribution law

R1 uses **participation credit**, matching the child-friendly Lantern Mark law unless live architecture proves a narrower shared seam is required.

For each completed rewardable ordinary-enemy life:

- any Hero who landed at least one accepted damaging hit during that enemy life is a contributor;
- the killing blow counts as contribution even when it is represented only by the defeat event;
- every **distinct player/profile identity** represented among contributors receives the full XP award; XP is not divided by party size;
- two different profiles can independently receive their own loot opportunity from the same enemy life;
- two heroIds/tabs mapped to one durable profile receive **one** XP award and at most **one** loot opportunity for that enemy life;
- one sibling's ownership/loot eligibility does not affect another sibling's eligibility;
- an enemy that resets/leashes/respawns without being defeated does not pay combat rewards.

Prefer to reuse or generalize the existing per-enemy contributor/life-identity seam rather than creating a second kill ledger beside Lantern Marks. Preserve existing Mark behavior and durable identities unless a deliberate migration is strictly necessary.

### Durable identity requirement

No combat-XP or loot fact may be named from:

- current XP total;
- number of kills already recorded;
- array index;
- process/page-local counter that resets across recovery;
- wall-clock timestamp used as uniqueness by itself.

Use a stable enemy-life/reward identity plus the owning profile where appropriate. The same logical kill reward replayed or recovered twice must collapse to one durable fact. Apply `docs/MISTAKES.md` **GQ-014** directly.

## R1 V0 combat-XP tuning target

This table is a **starting R1 tuning target, not a new Owner-locked law**. The Opus manager may revise it during R1-C1 only if the change is documented with beat-budget/math evidence and still satisfies every reward invariant below.

### Base XP by enemy level

Use one pure/data-driven authority. Starting target:

`baseCombatXp(enemyLevel) = 10 + 5 * enemyLevel`

Representative current values:

| Enemy Level | Base XP |
| ---: | ---: |
| 1 | 15 |
| 2 | 20 |
| 4 | 30 |

### Hero/enemy level-gap modifier

Let `gap = heroLevel - enemyLevel`.

| Gap | Multiplier |
| ---: | ---: |
| `<= -2` | `1.25` |
| `-1` | `1.10` |
| `0` | `1.00` |
| `+1` | `0.60` |
| `+2` | `0.25` |
| `>= +3` | `0.00` |

Round the final positive award to an integer through one canonical function.

Required properties regardless of final exact numbers:

- same enemy/content level -> reward is non-increasing as Hero level rises;
- sufficiently outleveled content -> zero XP at a bounded finite gap;
- same-level/harder authored enemies are worth more than weaker authored enemies;
- no formula uses a percentage of the Hero's own current-level requirement;
- no formula reads POWER;
- no negative, NaN, fractional durable XP amount, or mutable XP counter is introduced;
- representative Levels 20/100/1000 remain finite wherever the current canonical level architecture expects representability.

## Ownership-aware equipment-drop seam

R1 creates the **mechanism**, not the G2 content batch.

### Starting drop policy

- starting gear-drop chance: **10% per distinct eligible profile per defeated ordinary enemy life**;
- determine the profile's eligible **unowned** ordinary-drop items first;
- if no eligible item exists, do **not** roll a duplicate and silently erase it and do **not** display a gear promise;
- only after eligibility is known may the chance roll occur;
- on success, choose from the eligible set through one injected/testable RNG seam outside combat;
- a successful selection grants ownership only. Existing explicit equip logic remains the only path to wearing it;
- the durable gear grant and combat XP created from one reward decision should not introduce a new known partial-write failure; use the existing batch/transaction capability where proportionate.

The 10% value is V0 tuning and may be adjusted in R1-C2 only with explicit rationale. Do not tune by repeatedly running random browser fights until one happens to drop.

### Production content boundary

R1 must **not** steal G2's job merely to make the random branch visible.

- Do not make `wildwood_blade` an ordinary drop; Rowan remains its authored reward.
- Do not make `helmet_silverguard` an ordinary drop; Blackthorn Hollow remains its authored reward.
- Do not add a fake/misnamed production item, new GLB, recolor batch, rarity ladder, or stat-content batch in R1.
- It is acceptable for the live R1 production ordinary-drop-eligible gear set to be empty until G2 if the current truthful catalogue contains no non-conflicting candidate.
- The **gear branch itself must still be mechanically proven** through dependency injection/fixture policy or another deterministic test seam that does not ship fake content.
- When the eligible production set is empty, suppress the gear promise rather than inventing a parallel currency. G2 will populate the seam with bounded qualified gear content.

This is deliberate sequencing: R1 makes reward law correct before G2 makes the content pool larger.

## Online / offline / co-op contract

### Online

- live combat defeat is server-observable and server-adjudicated;
- the server resolves contributor profiles, Hero level, enemy level, XP amount, and loot eligibility from authoritative state;
- a hostile client cannot submit its own enemy level, XP amount, drop result, ownership, or kill claim;
- durable personal facts use the current append-only store and current H1 restore rules.

### Offline/local-first

- the offline fallback uses the **same pure XP and eligibility laws**, not copied tables;
- offline-earned personal XP remains representable as client-attested profile history under the current V0 trust posture;
- any combat reward identity minted offline must remain unique/stable across page reload and later server recovery; do not use a resettable kill index as the durable identity;
- do not weaken H1 by using offline combat to mint shared coin/shard/world facts merely because the gear pool is empty;
- reconnect/union must not double-count offline XP or gear ownership already known on either side.

### Co-op

Prove at minimum:

- two different profiles contributing to one Wolf each receive the correct full XP once;
- the same profile represented by two tabs/bodies cannot double XP or receive two gear rolls for the same enemy life;
- one profile already owning an eligible item does not remove that item from a sibling's independent eligibility set;
- reward processing does not reset/corrupt the E2 encounter, recovery protection, leash state, or another player's Hero body.

## Player-facing feedback

R1 is not a new UI framework.

Required outcome:

- an earned combat XP fact produces compact, nonblocking `+N XP` feedback near the existing progression/HUD treatment or an equally legible current-pattern equivalent;
- the existing XP meter and Level state move from the same canonical fact/state fold;
- a combat award that crosses a level threshold triggers the existing real level-up behavior and mechanics;
- hydration/reconnect adopts already-earned XP silently and does not replay a combat/level-up ceremony merely because durable facts arrived;
- a gear opportunity, when the deterministic proof seam forces one, routes through the existing G1 ownership/equip-choice behavior and never auto-equips;
- if one enemy life yields both a level-up and a gear choice, level-up has presentation priority and the gear choice waits/persists rather than stacking over it.

Because `+XP` is player-visible, final R1 evidence includes a bounded human running-game inspection for readability. Machine assertions may prove state and timing but do not visually accept the result.

## Expected write surface

Expected only as required by the final design:

- one narrow pure progression/reward module for combat-XP/drop policy, or a justified extension of current reward authority;
- `public/src/rewards/marks.js` only if generalizing the existing contributor/life seam is the smallest way to preserve one attribution law;
- `public/src/progression/facts.js` / profile utilities only for stable combat-reward fact identity and existing fold integration;
- `net/gameServerCore.mjs` and/or reward coordinator/store surfaces for server adjudication and durable application;
- `public/src/main.js` for offline/shared-policy consumption and compact feedback;
- `public/src/progression/items.js` only for generic ordinary-drop eligibility metadata/seam, **not new G2 content**;
- existing UI reward/level-up surfaces only as needed for compact feedback/collision handling;
- targeted `test/` coverage;
- one bounded focused runtime harness if needed to prove online/offline/co-op reward flow and ceremony ordering.

This is expected ownership, not permission for adjacent cleanup.

## Explicit exclusions

Do **not** implement in R1:

- G2 gear content batch, aspirational showcase, broad rarity/content expansion, recolor/material variant batch, or new production item assets;
- salvage/duplicate conversion, crafting, sockets, random affixes, vendor economy, trading, gifting, auction/economy systems;
- physical world loot bags/objects or a generalized loot pickup engine;
- new enemy archetypes, A3 asset qualification, E3 AI/behavior, new geography or Ranger Lodge expansion;
- learning interaction/reward work (L1);
- Level-5 special or movement milestone (M1);
- first-15-minute final tuning/acceptance (V1);
- pet combat/progression;
- POWER redesign or using POWER as reward authority;
- universal enemy scaling;
- auth/account/competitive anti-cheat redesign;
- H2/network-security cleanup beyond regression preservation;
- provider/Meshy calls, asset generation, asset promotion, or provider spend;
- unrelated full-browser-matrix cleanup.

## Checkpoint plan

R1 is one M PR with **two exact-SHA checkpoints**.

### R1-C1 — Reward basis, XP law, identity, attribution

Must establish and prove:

- one canonical level-gap combat-XP law;
- stable rewardable enemy-life identity and no duplicate kill ledger;
- contributor accounting remains isolated per stable enemy identity;
- distinct-profile full XP / same-profile dedupe law;
- online durable XP uses one append-only fact identity per profile per enemy life;
- offline uses the same XP law and a durable identity that cannot collide merely because a page/process restarted;
- malformed or impossible XP facts remain refused by current fact/store boundaries;
- existing Lantern Mark behavior and P2 authored Lantern XP remain unchanged;
- XP reaches actual level/stat mechanics, not merely the HUD (**GQ-013**);
- required unit suite passes.

Record exact C1 SHA and evidence before continuing.

### R1-C2 — Ownership-aware loot seam + complete reward loop

Must establish and prove:

- eligibility is computed before chance/selection;
- owned items cannot be re-promised as gear drops;
- same-profile multi-tab participation yields at most one roll per enemy life;
- siblings roll independently against their own ownership;
- random selection is injected/testable and remains outside `public/src/combat/`;
- signature guaranteed items are not ordinary production drops;
- empty production eligible pool suppresses gear promise cleanly;
- forced deterministic fixture proves the actual gear-grant path without shipping fake G2 content;
- ownership does not auto-equip, and the existing equip law remains authoritative;
- combat XP feedback is readable and nonblocking;
- a combat-driven level-up visibly/actually strengthens the next fight;
- level-up/gear presentation collision follows the priority rule;
- offline/reconnect/co-op reward flow does not duplicate durable facts;
- protected exact-head `unit` passes;
- relevant Director/runtime bundle or focused browser proof passes;
- broad matrix is diagnostic only if the changed surface warrants it; classify non-causal reds under `docs/WORKFLOW.md`.

Record exact final candidate SHA and stop for independent Production Director audit.

## Team topology

The Owner explicitly selected a Claude Code team for R1.

### Opus manager — semantic owner

Opus owns:

- live-state refresh and authority recovery;
- architecture and exact R1 design closure;
- package scope/reforecast decisions;
- task decomposition and sequencing between the Sonnet specialists;
- cross-system decisions involving reward identity, durable state, online/offline parity, co-op attribution, and presentation priority;
- integration and worker-side final review;
- exact-SHA checkpoint/handoff quality.

Opus must not run a competing parallel source-write stream while Sonnet A is actively writing the same package. If Opus takes a tiny integration correction after Sonnet A stops, make that ownership transfer explicit.

### Sonnet A — implementation specialist / primary writer

Sonnet A is the primary semantic code writer. Execute C1 then C2 under the Opus-approved design. Keep changes inside the brief and report any required scope expansion to Opus rather than absorbing it.

### Sonnet B — verification / adversarial specialist

Sonnet B is primarily read/test/evidence, not a competing writer. Focus on:

- reward-farming/exploit edge cases;
- same-profile/two-tab dedupe;
- sibling isolation;
- offline -> reconnect -> server union;
- stable fact identity across reload/restart;
- ownership-aware selection and no duplicate promise;
- combat-purity/randomness boundary;
- deterministic tests and focused runtime evidence;
- whether presentation sequencing lies or stacks ceremonies.

If Sonnet B finds a code defect, report it to Opus. Opus decides whether Sonnet A repairs it or whether a tiny integration correction is justified after write ownership transfers.

Worker-side team review does **not** replace the independent Production Director audit.

## Applicable durable lessons

At minimum reread and apply:

- **GQ-007 — Never restate a constant/law. Import it.** XP tables, eligibility, level resolution, equipment ownership, and fact parsing each need one authority.
- **GQ-013 — A reward the rules never read is a lie with a ceremony attached.** Combat XP must actually change Level-derived mechanics when thresholds cross.
- **GQ-014 — An identity derived from mutable state is not an identity.** Kill/reward facts must survive replay/restart/union without collision or double credit.
- Relevant harness timing/identity rules if a browser harness is touched; do not tune gameplay/reward numbers merely to satisfy hosted timing.

## Stop / reforecast conditions

Stop and report to the Production Director rather than silently broadening if R1 appears to require:

- a new production gear asset/item/content batch to make loot visible;
- changing Wildwood/Silverguard authored reward ownership to populate the random pool;
- a new currency or salvage system;
- random affix/stat generation;
- combat-layer imports of progression/item/RNG modules;
- a persistence/schema redesign rather than narrow use of the current append-only fact/store seam;
- auth/competitive anti-cheat redesign;
- new enemy archetype/AI/geography;
- a generalized modal/notification framework rewrite;
- material redesign of P1/P2 level/stat/POWER laws;
- enough additional scope to move R1 from M to L.

## Final Director acceptance gates

Report independently as PASS / FAIL / UNKNOWN:

1. **Scope/authority** — one coherent R1 reward seam, no G2/E3/L1/M1/V1/assets leakage.
2. **XP law** — canonical, level-gap-adjusted, fixed-world compatible, no Hero-requirement percentage or POWER input.
3. **Attribution/idempotency** — distinct profiles rewarded once; same profile cannot double collect; stable across restart/recovery.
4. **Persistence/offline parity** — append-only XP and ownership survive local/server union without double counting.
5. **Ownership-aware loot** — eligibility before chance, duplicates never promised, RNG outside combat, empty pool honest.
6. **Mechanics** — combat-earned levels reach real HP/damage and the next fight.
7. **Co-op** — sibling isolation and same-profile multi-tab dedupe hold.
8. **Presentation** — compact XP feedback is truthful/readable and ceremony priority is preserved.
9. **Regression** — P2/G1/E2/H1/H2 and Lantern Marks materially preserved.
10. **Exact-head evidence** — candidate SHA, protected unit, targeted tests/runtime, changed-file surface, and any remaining diagnostics classified by causality.

Do not merge, close #43, mark the PR ready, begin G2, or perform provider work. Stop for independent Production Director audit.