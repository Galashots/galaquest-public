# Progression E2 — Enemy Population, Levels & Safety

**Task-ID:** `PROG-E2-ENEMY-POPULATION-LEVELS-SAFETY`  
**Package size:** **L — Vertical**  
**Worker:** **Codex / GPT-5.6 Luna — single semantic write-worker**  
**Director:** ChatGPT / GalaQuest Production Director  
**Repository:** `Galashots/galaquest-public`  
**Starting public fixed point:** `main@b7abb7113386f1ce37d65d460f2475007d7fcb02`  
**Branch:** `feat/progression-e2-enemy-population-levels-safety`  
**Owning product record:** #47 Enemy variety for the progression push  
**Program plan:** `docs/briefs/PROGRESSION_PROGRAM_DECOMPOSITION_V0.md`  
**Governing design:** `docs/product/PRODUCT_VISION.md` + `docs/product/PROGRESSION_CONTRACT_V0.md`

## Objective

Turn E1's stable ordinary-enemy collection architecture into GalaQuest's first real **fixed-world ordinary-enemy field** while preserving the current Wolf as the only production ordinary-enemy archetype.

At E2 completion:

1. the shipped existing slice has **exactly five simultaneously active ordinary Wolves** with stable identities;
2. every Wolf has an authored fixed enemy level that survives authority -> wire -> client -> presentation;
3. enemy level is mechanically truthful: higher-level Wolves are actually stronger, while Level 1 preserves today's baseline fight;
4. nearby enemy presentation clearly communicates **Wolf / level / health** and explicitly warns about dangerous level gaps;
5. ordinary Wolves have an explicit leash/home territory so pursuit terminates and cannot drag indefinitely across the world;
6. a defeated child returns to a safe recovery point with a short authoritative protection window instead of reappearing inside an unavoidable repeat kill;
7. one child's recovery does not reset or corrupt another active child's fight;
8. online, offline, and co-op paths consume the same enemy population/level/safety laws;
9. ordinary-enemy defeat events expose the defeated enemy's stable identity, kind, and level for later R1 reward work;
10. no combat XP, loot, new enemy archetype, new geography, asset promotion, or provider work is added.

E2 should make `I got stronger` observable by putting multiple fixed-level targets in the existing world and make that population safe enough for R1 to add repeatable rewards next.

## Locked package contract

`five-Wolf fixed-world population + authored mechanical levels + readable nameplates + leash + safe recovery -> L -> combat/world/server/wire/client/presentation/runtime evidence -> no XP/loot/new archetype/assets/geography -> three exact-SHA checkpoints -> unit + targeted simulation + running-game + co-op evidence -> side quests remain #47/A3/E3/H2/R1`

## Product invariants

Preserve current Owner direction:

- classic fixed-world MMO progression; **no universal player-level scaling**;
- old enemies remain authored at their own level and eventually become trivial;
- Hero level remains the primary power source;
- enemy population exists to make progression observable, not to justify a larger world;
- Ranger Lodge / geography expansion remains deferred;
- high-level danger may be visible early but must not farm fresh respawns;
- Level-up and Silverguard/gear progression remain real and mechanically consumed;
- Warden remains a separate authored boss/siege system;
- new enemy archetypes remain E3 after applicable A3 qualification;
- no Meshy/provider calls, new assets, or provider spend.

## Current fixed-point facts to refresh before editing

Do not trust this summary if live GitHub has moved.

- E1 is merged and `public/src/combat/encounter.js` owns one canonical stable-ID `enemies[]` collection.
- The production ordinary-enemy kind is still only `wolf`.
- The current Level-1 Wolf baseline is 30 HP / 10 bite damage with the existing Wolf speed, aggro, attack, death, and respawn timing.
- `public/src/world/zones/village.js` currently exposes three `WOLF_PATROL` positions used serially by one Wolf; they are placements, not yet a population.
- The current rules respawn a downed Hero after two seconds and can reset enemies on a party wipe, but there is no complete E2 safe-relocation/protection contract.
- `public/src/enemies/wolf.js` already supports independent cloned Wolf presenters through the E1 registry path, but there is no enemy nameplate implementation.
- E1's defeat/events already carry stable enemy identity/kind; E2 must extend that seam with truthful level rather than inventing a separate reward identity.
- H1 / PR #72 is merged; shared-world restore integrity must remain intact.

Stop for reforecast if current `main`, branch head, or these architectural facts have materially changed before implementation begins.

## Locked population/content frame

### Exactly five simultaneous Wolves

Ship **five** active Wolves in the current existing world. Do not create an arbitrary large density field and do not reuse the old three points as five overlapping spawns.

Required authored level mix:

- at least **two Level-1 Wolves** in the early ordinary-combat wilderness;
- at least **two Level-2 Wolves** outside the safe spawn sanctuary and positioned so a new child is not forced into an unavoidable pack pull;
- exactly **one Level-4 danger Wolf** visible/reachable in the existing slice but far enough from spawn that it cannot naturally aggro or leash into the recovery sanctuary.

The exact five coordinates are **not frozen in this brief**. Start from the known existing Wolf patrol positions and the already-shipped north/east playable area, then choose placements from running-game evidence. Do not expand `ZONE`, Ranger Lodge geography, or new terrain to make them fit.

Population acceptance is not merely `enemies.length === 5`: the running game must read as a populated field without obvious spawn stacking, unavoidable chain-aggro, or labels covering the playfield.

## Enemy level and mechanical strength

Enemy level is an authored property of the ordinary enemy definition/state. It must remain fixed for that authored enemy across death/respawn; it does not follow the Hero's level.

### Starting v0 Wolf table

Preserve Level 1 exactly:

| Wolf Level | Max HP | Bite Damage | Movement |
| --- | ---: | ---: | --- |
| 1 | 30 | 10 | existing Wolf speed |
| 2 | 40 | 12 | existing Wolf speed |
| 4 | 60 | 18 | existing Wolf speed |

The Level-1 row is locked preservation. Level-2/4 values are the starting E2 tuning target and may move only when checkpoint/runtime evidence shows the package is otherwise mechanically wrong or unsafe; record any change explicitly rather than tuning by accident.

Do not derive enemy stats from displayed POWER. Prefer one pure/data-driven enemy-level stat authority rather than spreading level tables across combat, UI, server, and tests.

Enemy level must survive:

`authored zone definition -> combat state/events -> authoritative server snapshot -> protocol -> client mirror -> presenter/nameplate -> defeat event`

At minimum, tests must prove no state bleed between Wolves with different levels and that defeat identity/kind/level remain unambiguous for later R1.

## Leash / territory contract

Every ordinary Wolf gets an explicit stable home/territory relationship.

Required outcome:

1. Wolf aggro/chase begins under the existing ordinary-hostility law.
2. Pursuit cannot continue indefinitely away from the Wolf's authored territory.
3. Once the leash condition breaks, the Wolf clears its target and returns home.
4. A returning/evading Wolf cannot bite the child while returning.
5. The Wolf returns to full health no later than reaching home, so kiting cannot permanently cheese a high-level target.
6. Stable `enemyId`, kind, and level are preserved through return/reset.
7. No hostile Wolf can enter or remain hostile inside the Hero recovery sanctuary.

A distinct rules mode such as `returning` / `evading` is acceptable. Reuse the existing walk presentation if needed; **do not add an animation or asset requirement to E2**.

The exact leash radius/shape is implementation/tuning, but it must be explicit data/law rather than an incidental side effect of aggro range.

## Death / safe recovery contract

E2 must close the Progression Contract's mandatory safe-recovery invariant.

Use the existing `HERO_SPAWN` as the first recovery anchor unless running-game evidence proves it unsafe under the five-Wolf layout.

Required behavior:

- define an authored spawn/recovery sanctuary around the recovery anchor;
- after the existing low-friction down/death beat, the authoritative simulation relocates the respawned Hero to the recovery anchor and restores HP;
- grant a short authoritative **target: approximately 2 seconds** post-respawn protection after control returns;
- protected Heroes cannot be damaged/targeted by ordinary Wolves;
- protection may end early if the Hero initiates an attack if that produces cleaner rules and is tested;
- one Hero's respawn must not teleport, heal, retarget, or reset another still-active Hero;
- if the whole party is down, enemies may reset home coherently;
- death never removes XP, gear, inventory, or durable progression.

No corpse run, checkpoint system, revive system, lives, currency penalty, or broader death economy belongs in E2.

## Nameplate / danger presentation

Add a lightweight identity-keyed ordinary-enemy presentation layer. Prefer projected/DOM presentation consistent with the current Three.js + DOM HUD architecture rather than baking text into WebGL materials.

For a nearby visible Wolf, communicate:

- `Wolf`;
- `Lv N`;
- current health with a compact bar or equivalently legible compact treatment.

Danger rule for E2:

`enemyLevel >= heroLevel + 2`

A dangerous enemy must use **explicit text such as `DANGER` plus strong red treatment**. Do not rely on color alone.

Other requirements:

- bind every nameplate to stable `enemyId`, never array index/render-object accident;
- health must track the correct Wolf when several are visible;
- hide/remove labels for dead/dissolved/removed enemies as appropriate;
- keep presentation bounded by useful distance/visibility so five enemies do not turn the normal playfield into a dashboard;
- no Recommended POWER number in E2;
- portrait and landscape running-game review are required for readability/occlusion acceptance.

Machine DOM assertions can prove truthful text/state, but they cannot visually accept the nameplate. Running-game captures remain the appearance authority.

## Expected write surface

Expected production surfaces, only as required:

- `public/src/combat/encounter.js` and/or one narrow pure enemy-stat/safety module;
- `public/src/world/zones/village.js` for authored population/levels/territories;
- `net/gameServer.mjs` / `net/gameServerCore.mjs` as required by authoritative movement/state;
- `public/src/net/protocol.js` / `protocolCore.js` only if current E1 shape needs level/safety fields;
- `public/src/main.js` for offline/client mirror integration;
- `public/src/enemies/presenterRegistry.js`;
- `public/src/enemies/wolf.js` only for a narrow presentation hook if needed;
- preferably a narrow new `public/src/enemies/nameplate.js` or equivalent focused UI adapter;
- targeted `test/` coverage;
- bounded `tools/runtime-test/` changes/new E2 harnesses for population, recovery, nameplate, and two-client proof.

This is expected ownership, not permission for cleanup outside the package.

## Explicit exclusions

Do **not** implement in E2:

- combat XP or any XP award source;
- level-gap XP reward math;
- loot/drop chances, rarity, gear drops, salvage, crafting, or physical reward drops;
- any new ordinary enemy kind/archetype;
- Spriggan, Magmahorn, Graveflame, or A3 asset work;
- new GLBs, animations, materials, textures, asset promotion, Meshy calls, or provider spend;
- Warden/Beacon architecture changes beyond regression preservation;
- universal/dynamic player-relative enemy scaling;
- Recommended POWER;
- pets;
- learning;
- geography expansion, Ranger Lodge expansion, or new terrain;
- minimap/quest overhaul;
- revive/corpse-run/checkpoint/death-economy systems;
- auth/security work;
- H2 / Issue #63 WebSocket backpressure work;
- R1 reward work;
- unrelated browser-matrix debt or opportunistic cleanup.

## Checkpoint plan

E2 is one L PR with **three exact-SHA checkpoints**. Each checkpoint must remain runnable/reviewable. The semantic writer may continue after a green checkpoint unless a stop/reforecast condition is hit.

### E2-C1 — Population + level/stat authority

Establish the fixed-world content/rules truth first.

Must prove:

- exactly five stable authored ordinary-enemy identities in production configuration;
- required Level-1/Level-2/Level-4 mix;
- Level 1 still resolves to current 30 HP / 10 bite baseline;
- higher-level Wolves are mechanically stronger from one canonical enemy-stat law;
- online/offline ordinary combat consume the same authored level/stat law;
- server/wire/client preserve level truth and reject malformed level values if the wire changed;
- events/defeat seam carries enemyId + kind + level;
- simultaneous Wolves with different levels do not bleed HP/mode/stats into each other;
- no XP/drop behavior exists.

Evidence:

- focused enemy-level/population tests PASS;
- relevant E1 collection preservation tests PASS;
- required `node --test test/*.test.mjs` PASS;
- exact pushed C1 SHA recorded.

### E2-C2 — Leash + safe recovery

Close the safety mechanics before UI polish.

Must prove:

- a Wolf can be kited beyond its leash and deterministically disengages/returns;
- returning Wolf cannot keep biting/chasing;
- home/reset behavior restores an appropriate clean fight state;
- sanctuary rejects ordinary hostile pressure;
- a downed Hero respawns/relocates safely and cannot be immediately re-killed during protection;
- after protection ends, ordinary combat resumes normally;
- one Hero's recovery does not reset another active child's fight;
- all-down/party-wipe behavior remains coherent;
- stable Wolf identity/level remain intact after leash/reset/respawn.

Evidence:

- red-capable deterministic safety tests PASS;
- targeted server/co-op tests PASS;
- one bounded real-browser recovery/leash proof if the deterministic seam cannot prove actual relocation/controls;
- required unit gate PASS;
- exact pushed C2 SHA recorded.

### E2-C3 — Nameplates + running-game acceptance

Make the fixed-world field child-readable and prove the complete vertical in the running game.

Must prove:

- five-Wolf world reads as deliberate population, not stacked duplicates;
- a fresh/Level-1 child can reach an ordinary Level-1 fight without unavoidable pack aggro;
- Level-1/2/4 labels show truthful name/level/health;
- Level-4 Wolf visibly reads `DANGER` to a Level-1/2 child under the gap rule;
- several simultaneous labels keep correct per-enemy health identity;
- labels do not dominate/obscure the playfield in representative portrait and landscape views;
- leash/reset is understandable in play rather than looking like a frozen/broken enemy;
- death returns the child to safety and the child can resume playing;
- two-client proof shows one child's death/recovery does not corrupt the sibling's active encounter;
- G1 Silverguard mitigation still reaches real incoming damage;
- E1 collection/marks/Lantern/P2 level progression remain intact.

Final evidence:

- targeted E2 runtime/browser harness(es) PASS;
- representative portrait + landscape captures inspected by a human reviewer;
- co-op/two-client evidence PASS;
- protected exact-head `unit` PASS;
- relevant runtime bundle PASS;
- run the full browser matrix once as broad diagnostic coverage if warranted; classify unrelated/base/flaky reds under `docs/WORKFLOW.md` rather than repairing them on E2;
- exact final candidate SHA recorded.

## Director acceptance gates

Report these independently as PASS / FAIL / UNKNOWN:

1. **Scope/authority** — one coherent E2 vertical, no E3/R1/H2/assets/geography leakage.
2. **Fixed-world level authority** — authored levels are mechanically truthful and do not scale to the Hero.
3. **Population** — five stable active Wolves and intended level mix without obvious field/pathing defects.
4. **Leash/territory** — pursuit terminates; return/reset works.
5. **Safe recovery/co-op** — respawn safety holds without resetting a surviving sibling.
6. **Nameplate/runtime readability** — truthful and visually readable in running-game portrait + landscape evidence.
7. **Regression** — E1/P2/G1/H1 behavior materially preserved.
8. **Exact-head evidence** — candidate SHA, required hosted unit, targeted runtime evidence, changed surface.

No visual gate may be accepted solely from code or DOM numbers.

## Stop / reforecast conditions

Stop and report rather than silently broadening if E2 appears to require:

- a new enemy archetype or asset;
- new geography/world bounds;
- a persistence/schema migration;
- redesign of Hero level/stat progression;
- a materially larger checkpoint/death/revive system;
- a general UI framework rewrite;
- protocol redesign materially beyond carrying honest E2 state;
- H2/#63 networking work;
- R1 reward implementation;
- broad baseline/browser harness repair unrelated to E2 causality.

## Worker lane / execution discipline

E2 is intentionally routed to **Codex / GPT-5.6 Luna** rather than normal Chat semantic execution because running-game placement, multi-enemy interaction, leash behavior, death/recovery, responsive nameplates, and browser evidence require repeated local/worktree/browser feedback during implementation.

Use the applicable Game Studio disciplines for architecture/runtime/UI/playtest. Preserve simulation truth outside Three.js/render objects and keep DOM presentation downstream of authoritative state.

One semantic writer owns this branch during implementation. Read-only investigation may fan out, but no second writer edits the E2 branch.

## Worker final handoff

Stop with the PR open/unmerged and provide:

- exact final candidate SHA;
- C1/C2/C3 checkpoint SHAs;
- changed-file list;
- targeted/unit/runtime results bound to exact SHAs;
- portrait/landscape capture locations and what they prove;
- two-client safety evidence;
- broad-matrix causality classification if run;
- any side quests routed to their existing authority;
- explicit statement that no merge/close, provider spend, or E3/R1/H2 work was performed.

The semantic writer may self-check, but final implementation acceptance remains an independent Production Director gate.