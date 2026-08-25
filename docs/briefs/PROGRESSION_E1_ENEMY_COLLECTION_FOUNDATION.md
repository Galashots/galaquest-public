# Progression E1 — Enemy Collection Foundation

**Task-ID:** `PROG-E1-ENEMY-COLLECTION-FOUNDATION`  
**Package size:** **L — Vertical architecture**  
**Worker:** **Fresh non-project GPT-5.6 Sol, XHigh reasoning — single semantic write-worker**  
**Director:** ChatGPT / GalaQuest Production Director  
**Repository:** `Galashots/galaquest-public`  
**Starting public fixed point:** `main@38f753e3b470796a38c2274645e9f286da25a07a`  
**Branch:** `feat/progression-e1-enemy-collection-foundation`  
**Owning product record:** #47 Enemy variety for the progression push  
**Program plan:** `docs/briefs/PROGRESSION_PROGRAM_DECOMPOSITION_V0.md`  
**Governing design:** `docs/product/PROGRESSION_CONTRACT_V0.md`

> **Current execution-routing override:** for the remainder of the Owner's current progression push, fresh non-project GPT-5.6 Sol XHigh chats are the default implementation workers. Use Codex only when a later package genuinely requires its environment/tooling. Any older model-routing names in the program decomposition are superseded by this Owner direction; package order and product dependencies remain authoritative.

## Objective

Convert GalaQuest's **singular ordinary-enemy model** into a scalable, stable-identity **ordinary enemy collection architecture end-to-end** while preserving the current player's game.

At E1 completion:

1. ordinary enemies are represented authoritatively as a collection of identified entities rather than one special `wolf` slot;
2. each ordinary enemy has a stable identity that survives simulation -> events -> server snapshot -> wire -> client mirror/presentation;
3. the combat engine can correctly simulate more than one ordinary enemy in deterministic tests/fixtures;
4. server and offline fallback consume the same collection law;
5. client presentation can create/update/dispose presenters by enemy identity rather than owning one special Wolf presenter;
6. current Lantern-mark/reward behavior still works for the existing Wolf fight;
7. the **default shipped world still contains the same effective single Wolf encounter/patrol behavior** as before E1;
8. no new enemy archetype, enemy density, loot, XP, level, nameplate, geography, asset, or tuning outcome is introduced.

E1 is infrastructure for later E2/R1/E3. It must make those packages possible without prematurely implementing them.

## Locked package contract

`ordinary enemy collection + stable identity end-to-end -> L -> combat state/events + server/wire + client mirror/presentation + tests/harness readers -> preserve today's one-Wolf game -> no extra population/levels/drops/new archetypes -> three exact-SHA checkpoints -> targeted + unit + bounded runtime regression evidence -> side quests routed to E2/R1/E3/A3`

## Why this package exists

The Progression Contract records the architectural prerequisite explicitly: current ordinary-enemy state is singular end-to-end. The core encounter owns one `wolf`, the protocol decodes one `wolf`, the server publishes one `wolf`, and the village's several Wolf positions are patrol/respawn locations for that one enemy rather than a population.

That architecture cannot honestly support later mob density, per-mob XP/drop rolls, enemy levels, nameplates, or multiple archetypes. E1 changes the **shape and identity model**, not the content/tuning.

The Warden is a separate authored boss/siege system and is **not** part of E1's ordinary-enemy collection.

## Owner / product invariants

Preserve all current product decisions:

- fixed-world progression, not universal player scaling;
- ordinary enemies eventually become numerous, but **not in E1**;
- Hero levels/P2 remain real and drive max HP/damage identically online/offline;
- current Wolf fight semantics remain the player's baseline;
- current Lantern Mark/Lantern unlock/100-XP authored progression path remains intact;
- Warden/Beacon behavior remains intact;
- no paid/provider/asset work;
- no Spriggan/Magmahorn/Graveflame integration;
- no enemy level/nameplate/safety/density tuning yet;
- POWER remains downstream-only and is irrelevant to enemy authority in E1.

## Current fixed-point facts to verify before editing

Refresh them from live code rather than trusting this summary:

- `public/src/combat/encounter.js` currently exposes a singular Wolf-oriented ordinary encounter, including `encounterState.wolf` and Wolf-specific separation/step seams;
- `net/gameServer.mjs` imports the ordinary encounter and publishes one `wolf` in the encounter snapshot;
- `public/src/net/protocol.js` currently validates `encounter.wolf` through a Wolf-specific decoder;
- `public/src/main.js` mirrors one ordinary enemy and owns one Wolf presenter path;
- `public/src/enemies/wolf.js` is the current Wolf visual/presenter implementation;
- `WOLF_SPAWNS` are multiple authored positions for the current single Wolf's spawn/patrol lifecycle, not a mob population;
- current combat/reward tests and browser harnesses contain Wolf-shaped readers that must move with the state-shape change (GQ-017 posture);
- `combat/` purity remains enforced and must stay framework/progression/DOM independent.

If live `main` or this branch has moved, or these facts are materially false, stop and reforecast before semantic work.

## Architecture requirements

### 1. One authoritative ordinary-enemy collection

Create one canonical ordinary-enemy state shape. Exact naming/representation may follow repository conventions, but it must support:

- stable `enemyId` identity;
- enemy kind/type identity (currently only Wolf in production);
- independent position/heading/HP/mode/timers/lifecycle per enemy;
- deterministic iteration/selection behavior;
- future addition of more instances/types without another singular-state rewrite.

Do **not** maintain two authoritative truths such as a mutable `wolf` plus mutable `enemies` collection.

A thin compatibility adapter is acceptable only where it derives from the collection and does not become a second state owner. Prefer removing stale singular names where the reason has changed (GQ-002).

### 2. Stable identity is not array position

Enemy identity must not be derived from array index, current spawn index, current position, loop order, mutable HP, or another changing field.

Identity must survive across:

`simulation -> combat events -> server snapshot -> protocol decode -> client mirror -> presenter`

Respawning the same authored ordinary enemy should preserve its entity identity unless live project authority clearly requires a new identity; a patrol/spawn change is not itself a new enemy.

Tests must prove reordering collection serialization does not change which enemy an event/presenter refers to.

### 3. Existing one-Wolf semantics are preservation requirements

The default shipped game must still behave like the current game:

- one ordinary Wolf effectively active under today's authored world configuration;
- same starting spawn/patrol/respawn positions;
- same Wolf AI, movement, aggro, bite, hit/death/respawn timing;
- same Hero collision/separation behavior for the one-Wolf case;
- same Level-1 hit/down counts and P2 level-derived Hero stats;
- same Lantern Mark award logic and first Lantern -> 100 XP behavior;
- same online/offline/co-op semantics;
- same Wolf asset/presenter appearance.

E1 is not permission to improve or retune any of these.

### 4. Multi-enemy simulation must be real enough to prove the architecture

Tests/fixtures must exercise at least two ordinary Wolf instances simultaneously even though the shipped default world remains one.

Prove at minimum:

- two identified enemies can hold different HP/modes/positions without state bleed;
- a Hero swing damages **at most one** eligible ordinary enemy per contact unless current rules explicitly say otherwise;
- target selection is deterministic. Preserve today's reach/facing semantics; for a multi-enemy tie use a stable rule such as nearest eligible target then stable identity, rather than object/array accident;
- each enemy independently selects/chases/attacks according to the existing Wolf rules;
- each enemy can die/respawn without resetting the other;
- combat events identify which enemy caused/received the event;
- separation/collision reasoning handles the collection rather than only a special Wolf;
- co-op contributor/reward bookkeeping cannot confuse two enemies' life cycles.

Do not tune whether two Wolves together are fun or fair. E2 owns population and safety tuning.

### 5. Identity-bearing combat/reward seam

Later R1 needs to award XP/drop opportunities from the enemy that actually died. E3 needs multiple kinds. E1 therefore must leave one unambiguous ordinary-enemy defeat seam that carries at least:

- stable enemy identity; and
- enemy kind/type.

The exact event vocabulary may be refactored if that is the cleanest implementation. If Wolf-specific event names remain as compatibility presentation vocabulary, do not let them remain the only source of entity identity.

Current Lantern Marks are a Wolf-specific authored progression beat. Preserve that behavior by explicit Wolf-kind semantics; do **not** accidentally make every hypothetical future enemy count as a Lantern Wolf merely because the event became generic.

Do not implement XP-per-enemy, level-gap XP, loot rolls, or drops here.

### 6. Server and protocol are collection-shaped

The authoritative server snapshot and shared protocol must represent the ordinary-enemy collection without a second mutable singular Wolf authority.

If the honest wire shape is incompatible with protocol v3, make an intentional protocol-version change and update client/server/tests/fixtures together. Do not preserve a misleading protocol version merely to avoid touching fixtures.

Protocol validation must reject malformed enemy identities/kinds/state at the boundary. Keep the shape bounded and deterministic.

### 7. Client presentation is identity keyed

Replace the one-special-Wolf presentation ownership with an identity-keyed presenter collection/registry:

- create presenter when an enemy identity appears;
- update the correct presenter from that enemy's state;
- dispose/remove it when the authoritative entity is removed;
- do not use render-object identity as simulation identity;
- keep the existing Wolf presenter implementation reusable for `kind: wolf`;
- do not create visuals for unimplemented enemy kinds.

The default game should look materially unchanged after E1.

### 8. Offline and online are the same Hero/enemy laws

P2 established shared Hero stat authority. E1 must preserve it.

The offline fallback and server-hosted ordinary fight must both use the same collection-capable combat rules. Do not create a simplified single-enemy offline model beside a collection server model.

### 9. Warden remains separate

Do not absorb `world/beaconSiege.js` / Warden into the ordinary enemy collection. Preserve existing transfer/body continuity between ordinary combat and the Beacon fight.

The purpose of E1 is to unblock ordinary mob population/content work, not to invent one universal combat framework for every boss/puzzle in GalaQuest.

## Expected write surface

Expected production surfaces, only as required:

- `public/src/combat/encounter.js` and/or a new narrow combat-local ordinary-enemy collection module;
- `net/gameServer.mjs`;
- `public/src/net/protocol.js`;
- `public/src/main.js`;
- `public/src/enemies/wolf.js` and/or a narrow presenter-registry adapter;
- current world spawn configuration only as needed to give the existing Wolf a stable authored identity without adding population;
- reward/mark folding only as needed to preserve the current Wolf-specific Lantern behavior against identity-bearing defeat events;
- targeted `test/` surfaces;
- `tools/runtime-test/` readers/harnesses whose state assumptions change;
- one bounded E1-specific runtime/fixture harness only if existing seams cannot honestly prove client collection presentation.

This is expected ownership, not permission for unrelated cleanup.

## Explicit exclusions

Do **not** implement in E1:

- a second default-world Wolf or any increased ordinary-enemy density;
- enemy levels;
- enemy names/nameplates/health bars beyond current Wolf presentation;
- Recommended Power;
- level-gap XP;
- combat XP;
- loot/drop chances or physical drops;
- armor or G1;
- new enemy archetype behavior;
- Spriggan/Magmahorn/Graveflame integration;
- A3 asset follow-up;
- new animations/assets/materials;
- Meshy/provider calls or spend;
- leash/safe-respawn/high-level-danger tuning (E2 owns it unless a pre-existing one-Wolf invariant must merely be preserved);
- geography/world expansion;
- Warden architecture rewrite;
- pet work;
- learning;
- final first-15-minute tuning;
- general refactors, harness hardening, or baseline cleanup not causally required by the state-shape change.

## Checkpoint plan

E1 is one L PR with **three exact-SHA checkpoints**. Each checkpoint must remain independently reviewable. The worker may continue after a green checkpoint unless a stop/reforecast condition is hit.

### E1-C1 — Collection simulation authority

Establish the rules-layer architecture first.

Must prove:

- canonical ordinary-enemy collection state with stable IDs/kind;
- current one-Wolf fixture preserves existing combat behavior;
- multi-Wolf fixtures prove independent state/lifecycle;
- deterministic single-target Hero swing selection;
- per-enemy attack/lifecycle events carry identity;
- collection-aware collision/separation;
- combat purity remains intact;
- no client/server/protocol dual-state shortcut is introduced merely to get C1 green.

Evidence:

- focused combat/collection tests PASS;
- existing Wolf combat preservation tests PASS;
- P2 Hero stat/preservation tests PASS;
- `git diff --check` PASS;
- full required unit gate PASS;
- exact pushed C1 SHA recorded.

### E1-C2 — Server/wire/reward integration

Move the authoritative collection through networking and reward seams.

Must prove:

- server simulation owns the collection;
- snapshot/welcome protocol carries stable identified ordinary enemies;
- protocol rejects malformed collection entries;
- client decode mirrors identities correctly;
- two enemy lifecycles cannot be conflated in server events/reward contribution bookkeeping;
- Lantern Marks still advance only from the intended Wolf defeats;
- Lantern -> 100 XP P2 path remains exactly once;
- protocol version/fixtures are updated honestly if the wire is breaking;
- offline and online Hero/enemy stat laws remain equivalent.

Evidence:

- focused protocol/game-server/reward/mark/idempotency tests PASS;
- multi-enemy server fixture PASS;
- existing P2 Lantern XP tests PASS;
- full required unit gate PASS;
- `git diff --check` PASS;
- exact pushed C2 SHA recorded.

### E1-C3 — Client presenter/runtime conversion and final regression

Finish the end-to-end state-shape change.

Must prove:

- main/client consumes the collection rather than a singular ordinary `wolf` authority;
- presenters are keyed by stable enemy identity and created/updated/disposed correctly;
- current default world still visibly presents one Wolf at the expected authored place/lifecycle;
- existing attack feedback, Wolf presentation and quest/reward feedback still work;
- runtime accessors and affected harnesses read the collection honestly rather than guessing `enemies[0]` as "the Wolf";
- no stale singular-state header/comments remain where the reason changed;
- no E1 console errors.

Final evidence:

- targeted tests PASS;
- `node --test test/*.test.mjs` PASS;
- `git diff --check` PASS;
- protected hosted `unit` PASS on exact final head;
- runtime bundle / relevant hosted check PASS;
- `play-fight` PASS or any red classified against base using the workflow stop boundary;
- `drive-two-clients` PASS or causally reconciled;
- `drive-marks` / equivalent Wolf reward path PASS;
- `drive-first-level-up` PASS so E1 has not broken P2's real authored path;
- Beacon/Warden regression seam PASS because E1 must not break transfer/body continuity;
- running-game capture/inspection confirms the default one-Wolf experience remains materially unchanged;
- exact final SHA.

The full browser matrix is diagnostic, not automatically a blocker. After C3, follow `docs/WORKFLOW.md`'s final-checkpoint stop boundary: classify causality, fix only proven E1 regressions, then hand off.

## Acceptance invariants

At minimum, tests should establish:

### Identity/state

- every ordinary enemy has a valid stable identity;
- duplicate identity in one authoritative collection is rejected;
- identity survives snapshot encode/decode;
- serialization/reordering cannot silently retarget an event;
- removing one enemy does not mutate another;
- respawning one enemy preserves the intended entity identity and does not reset another.

### Combat

- one-Wolf Level-1 and P2 fight behavior is preserved;
- a swing among two eligible enemies lands on exactly one deterministic target;
- an out-of-range/non-facing enemy is not selected merely because its identity sorts first;
- two enemies can damage/chase independently;
- one enemy's hit/death mode does not drive another presenter's mode;
- co-op events identify the correct enemy life.

### Rewards/progression

- Wolf Lantern mark behavior remains unchanged in the default path;
- two distinct Wolf deaths can be distinguished by enemy identity/life rather than a single global Wolf state;
- one Lantern unlock still creates exactly one 100-XP fact;
- no XP is awarded merely because E1 introduced generic enemy identity.

### Network/client

- malformed/duplicate enemy IDs are rejected;
- server snapshot and browser decode agree on the same identified collection;
- presenter registry tracks by enemy identity, not array position;
- collection removal disposes the correct presenter;
- default runtime has the same effective one-Wolf content count after E1.

## Running-game acceptance posture

E1 is an architectural conversion with deliberately minimal visual change.

Running-game acceptance therefore asks:

1. does the normal game boot and play with the same one-Wolf encounter and visual presentation;
2. do attack/hurt/death/respawn feedback still track the correct Wolf;
3. does the P2 Lantern -> level-up path still work;
4. can client collection/presenter behavior be independently proven for multiple IDs without shipping extra population.

Do not add a second production Wolf merely to make a screenshot demonstrate plurality. Prefer unit/integration fixture evidence or a bounded test-only runtime seam. Do not add a public debug mode solely for this acceptance unless the Director explicitly reforecasts it.

Machine evidence can prove identity/state behavior. Any changed running-game appearance must still be human-inspected before visual PASS.

## Stop / reforecast conditions

Stop and report rather than broaden if:

- live `main` or the E1 branch unexpectedly moves before semantic work begins;
- another semantic writer appears on this branch;
- implementation starts adding default-world enemy count/density;
- a new enemy archetype/asset becomes necessary;
- Warden must be absorbed into the collection to proceed;
- preserving Lantern rewards requires redesigning the reward economy rather than adapting identity-bearing Wolf defeats;
- progression/gear/loot work starts entering the branch;
- a new player-targeting mechanic or manual target selector appears necessary;
- client presentation requires new art/provider work;
- broad world/geography changes become necessary;
- a genuinely new Owner product decision is required.

A protocol version bump caused solely by the honest collection wire shape is **not** by itself a reforecast; it is expected E1 integration work if required.

## Side-quest destinations

- enemy density/levels/nameplates/leash/safe recovery -> **E2** / #47;
- combat XP + level-gap decay + loot seam -> **R1**;
- Spriggan/Magmahorn/Graveflame runtime behavior -> **E3** / #47;
- candidate asset recovery/material/motion/performance -> **A3** / PR #57 / #47;
- gear reward content -> **G1/G2** / #44;
- final opening pacing -> **V1**;
- general tooling/baseline debt -> separate engineering issue only if materially worth preserving.

## Worker topology / permissions

For this package:

- one fresh non-project **GPT-5.6 Sol XHigh** chat is the single semantic writer;
- the Production Director remains read-only during active worker execution;
- no Claude continuation is planned;
- do not invoke Codex merely for a second opinion. Escalate to Codex only if an actually necessary execution/tooling surface is unavailable in the fresh Chat environment and report that need before broadening;
- after explicit Sol handoff, Director independently audits exact checkpoint/final SHAs and may make only bounded deterministic audit corrections inside locked E1 scope.

Authorized worker actions:

- edit only the E1 branch;
- implement C1/C2/C3;
- add/modify targeted tests and bounded harness evidence;
- commit/push exact checkpoints;
- update the E1 PR with checkpoint SHAs/evidence;
- report side quests without implementing them.

Not authorized:

- merge/close the PR;
- write to `main`;
- force-push/rewrite shared history;
- start G1/E2/R1/E3/A3 on this branch;
- paid/provider/Meshy work;
- production asset promotion;
- silent scope expansion.

## Final worker report

Return `GQ-WORKER-REPORT v1` containing:

- `Task-ID: PROG-E1-ENEMY-COLLECTION-FOUNDATION`;
- exact starting branch SHA before semantic edits;
- exact C1 SHA + evidence;
- exact C2 SHA + evidence;
- exact C3/final SHA;
- DONE / BLOCKED / FAILED;
- changed-file summary;
- authoritative collection shape and identity law;
- protocol shape/version decision and rationale;
- targeting/tie-break rule;
- default-world enemy count confirmation;
- one-Wolf behavioral preservation evidence;
- multi-enemy independence/identity evidence;
- Lantern Mark + Lantern XP preservation evidence;
- online/offline equivalence evidence;
- exact targeted/full unit results;
- `git diff --check`;
- exact-head hosted CI;
- runtime harness/capture evidence;
- all remaining FAIL/UNKNOWN items;
- side quests routed but not implemented;
- confirmation that no Owner-only action was performed.
