# Progression P2 — First Hero Level-Up Vertical

> **STATUS: COMPLETE — merged to `main` via PR #56 (`8e247b2a395e1fe0a2d53ba8eb66d7e55340b8d4`).**
> This brief is a historical dispatch record. It no longer authorizes work, and its file-ownership
> and evidence expectations describe the state at dispatch time, not current `main`.

**Task-ID:** `PROG-P2-FIRST-HERO-LEVEL-UP`  
**Package size:** **L — Vertical**  
**Worker:** **Claude Execute — single semantic write-worker**  
**Director:** ChatGPT / GalaQuest Production Director  
**Repository:** `Galashots/galaquest-public`  
**Starting public fixed point:** `main@ee2c5e60a29c6c2e6572ad3d0d0b8d36aff33885`  
**Branch:** `feat/progression-p2-first-hero-level-up`  
**Owning product records:** #43 Hero XP/levels + #41 kid-readable POWER  
**Program plan:** `docs/briefs/PROGRESSION_PROGRAM_DECOMPOSITION_V0.md`  
**Governing design:** `docs/product/PROGRESSION_CONTRACT_V0.md`

## Objective

Ship the first complete Hero-level payoff:

`earn a bounded authored XP reward -> XP meter completes -> LEVEL UP -> max HP and real damage increase -> POWER jumps -> the stronger Hero is actually used by both current combat engines`

P2 is deliberately one **L vertical** rather than separate stat and UI PRs because the player outcome is singular: a Hero level must both **change the game** and **feel exciting**.

At P2 completion, a normal fresh profile can reach Level 2 through one existing nonrepeatable progression beat, survive/reconnect with that XP durably, see Level/XP/POWER on the ordinary HUD, see scalable health rather than a fixed four-heart ceiling, and experience a first-pass level-up celebration whose numbers correspond to real combat strength.

P2 is **not** the full first-15-minute progression loop. Later packages add combat XP, learning XP/rewards, armor, enemy levels/population, additional gear events, the Level-5 special, and final pacing.

## Locked package contract

`first real Hero level-up -> L -> canonical Hero stats + current-fight normalization + one authored XP source + POWER + scalable health/level presentation -> no armor/enemy expansion/learning/pets/special attack -> three exact-SHA checkpoints -> targeted + unit + running-game acceptance -> side quests routed to existing program packages`

New work stays outside this branch unless it is necessary to make the first Hero level-up mechanically real and player-readable. A discovery that adds a new product outcome, asset/provider work, enemy architecture, random loot, learning, or a new ability triggers reforecast rather than silent expansion.

## Owner-locked product facts

Preserve the current product authorities:

- Hero progression is the primary source of power.
- Every Hero level increases **maximum HP** and **Hero damage**.
- Levels can continue upward without a baked-in low technical cap; roughly Levels 1–20 are the current intentional balance band.
- Level 2 should eventually land roughly 2–3 minutes into active progression; P2 proves the first real award/ceremony but does not freeze full opening pacing.
- POWER is derived from real strength, is deterministic/monotone, and is **never** an input to combat, XP, drops, persistence, or adjudication.
- POWER appears compactly on the ordinary HUD and prominently on the Hero/equipment surface.
- Level-up is the strongest routine progression ceremony.
- The fixed four-heart ceiling is superseded as a progression constraint.
- Death remains low-friction and does not remove XP/gear/progression.
- Existing live server adjudication remains authoritative; local-first/offline recovery remains supported under the V0 trust posture.

## P2 combat/stat normalization

The current `3 HP / 1 damage` resolution cannot express repeated level gains. P2 converts the current fights to a higher-resolution integer scale while preserving the established Level-1 behavioral promises.

### Canonical Hero values

Create one pure shared Hero-stat authority (for example `public/src/progression/heroStats.js`; exact naming may follow repo conventions) with these P2 V0 values:

- **Level-1 base max HP:** `30`
- **Max HP gained per Hero level:** `+5`
- `maxHpForLevel(L) = 30 + 5 * (L - 1)`
- **Hero damage gained per level after Level 1:** `+2`
- Current equipped weapon supplies the Level-1 weapon damage baseline.
- `resolvedHeroDamage = equippedWeaponDamage + 2 * (L - 1)`

Level is read through the P1 authority in `progression/levels.js`; do not derive it independently.

Representative states:

| State | Max HP | Resolved damage |
|---|---:|---:|
| L1 + Starter Sword | 30 | 10 |
| L2 + Starter Sword | 35 | 12 |
| L5 + Starter Sword | 50 | 18 |
| L1 + Wildwood Blade | 30 | 20 |
| L2 + Wildwood Blade | 35 | 22 |

### Existing weapon normalization

Retune the current weapon definitions from tiny hit-counter values to the same integer combat scale:

- Starter Sword: `10` damage at Level 1;
- Wildwood Blade: `20` damage at Level 1.

The weapon catalogue remains the authority for item-specific weapon damage. The Hero-stat authority adds level-derived Hero damage afterward. Do not restate item values in server/client/UI code.

This deliberately preserves the existing Wildwood Blade promise at Level 1: a fresh wolf still takes three Starter hits and two Wildwood hits.

### Current encounter normalization

Normalize existing enemy damage/HP without changing AI, timing, reach, cadence, phases, movement, aggro, or authored behavior:

- Wolf max HP: `30`;
- Wolf landed-bite damage: `10`;
- Warden max HP: `120`;
- Warden landed-attack damage: `10`.

Required Level-1 invariants after normalization:

- fresh Wolf: **3** Starter hits to defeat;
- fresh Wolf: **2** Wildwood hits to defeat;
- base L1 Hero: **3** Wolf bites to down;
- fresh Warden: **12** Starter hits to defeat;
- fresh Warden: **6** Wildwood hits to defeat;
- base L1 Hero: **3** landed Warden attacks to down.

Those are preservation invariants, not permission to retune attack timing or AI around them.

### Wren charm normalization

The existing Wren charm currently represents one additional heart on a 3-heart body. On the normalized P2 scale, preserve that established survivability meaning as:

- Wren charm max-HP bonus: **+10 HP**.

The charm stacks with level-derived HP. Therefore a Level-1 charmed Hero has 40 max HP and a Level-2 charmed Hero has 45.

Do not retain `HERO_MAX_HP_CEILING = 4` as a hidden cap. Remove/retire obsolete ceiling assumptions in code, markup, tests, and comments that P2 supersedes. Follow GQ-002: when the reason changes, stale headers/comments change in the same commit.

### Combat purity/seam

`combat/` and the Beacon rules must continue consuming a **resolved numeric Hero damage and max HP** from outside progression/item authority. They must not import the item catalogue, XP journal, POWER, DOM, or mutable progression state.

If the existing per-tick field name `weaponDamage` becomes misleading once it carries level-resolved Hero damage, rename the seam coherently rather than leaving a stale lie. Do not duplicate the damage law in both fight engines.

## Canonical POWER v0

Create one pure shared POWER authority (for example `public/src/progression/power.js`) using the resolved real combat stats.

### Real-strength scalar

For P2, generalized Hero readiness is the product of normalized survivability and normalized resolved damage relative to the fixed Level-1 Starter benchmark:

`realStrength = (maxHp / LEVEL_1_BASE_MAX_HP) * (resolvedHeroDamage / LEVEL_1_STARTER_DAMAGE)`

where both denominators are imported from their owning progression/item authority rather than restated literals.

### Display transform

P2's initial kid-facing presentation is:

`POWER = round(1000 * realStrength)`

Therefore, absent charm/other gear:

- L1 + Starter -> **POWER 1,000**;
- L2 + Starter -> **POWER 1,400**;
- L1 + Wildwood -> **POWER 2,000**.

This is a V0 presentation law, not combat input. Later armor/pet packages extend the underlying resolved real stats/strength inputs; they do not read POWER back into the game.

### Required POWER properties

Tests must prove:

- deterministic for the same state;
- strictly/non-decreasing when max HP or resolved damage increases and the other input does not decrease;
- finite through representative Levels 20, 100, 1000;
- Level-1 Starter benchmark remains 1,000;
- Level-2 Starter benchmark remains 1,400 under the P2 stat law;
- a stronger same-level weapon does not lower POWER;
- charm increasing HP does not lower POWER;
- no combat/reward/persistence module imports POWER as an authority.

Add a single pure compact formatter for high values used by every POWER presentation. At ordinary values use readable grouping (`1,400`). At larger values use a stable compact form (`12.4K`, `3.2M`, etc.) rather than letting Level 1000 create an uncontrolled digit wall. Keep full numeric value available to tests/comparison logic; formatting is presentation only.

## First real XP source

P2 adds exactly **one** live XP source to prove the level-up vertical.

Use the existing first-time **Lantern unlock** as the P2 authored progression award:

- when a profile first earns `lantern-unlocked`, also earn one `xp-earned` fact worth **100 XP**;
- `100` is intentionally the P1 Level-2 threshold;
- the XP fact requires a stable deterministic identity derived from the Lantern completion identity/source fact, never a timestamp, random second opinion, array index, or mutable total;
- online award remains server-adjudicated;
- the offline/local path must produce the same logical one-time progression result under the V0 local-first model;
- replay, reconnect, duplicate Lantern handling, and client/server fact union must not award the 100 XP twice.

The Lantern + XP relationship must be recoverably idempotent. A transient ordering/write failure must not create a normal state where a newly-earned Lantern is permanently present but its deterministic P2 XP can never be recovered. Use the smallest solution consistent with the append-only fact architecture (batching or deterministic repair are both valid if properly tested).

### Scope meaning of this XP source

This is a bounded **authored progression XP** proof, not the game's combat-XP law.

Do not award XP per mark, per wolf kill, per hit, per Warden attack, or per respawn. R1 owns repeatable combat XP and level-gap decay. L1 owns meaningful learning awards. V1 owns final opening pacing/tuning.

## Player-facing state

### Ordinary HUD

The persistent HUD must communicate, at a glance and without covering the playfield:

- `LV 1` / current Hero level;
- current-level XP progress;
- compact `POWER 1,000`-style value;
- scalable current/max HP.

Replace the fixed heart-pip ceiling with a scalable health treatment. The P2 target is:

`heart/health icon + thick readable health bar + numeric current / max HP`

Example:

`❤ 30 / 30`

The exact styling must fit the existing GalaQuest visual language and protect the playfield. Do not create twenty heart icons as level rises.

Hit/heal/down feedback must continue to read correctly against the new health treatment.

### Hero/equipment surface

The Hero/equipment screen should prominently show current Hero Level and POWER and must not lie about normalized weapon damage. Existing weapon comparison may continue to be simple, but values must reflect the canonical current stat/item authorities rather than old `1 / 2 DAMAGE` assumptions.

The dramatic **equipment** before/delta/after POWER ceremony remains G1; P2 only needs the current Hero/equipment surface to be truthful and ready for that later moment.

## Level-up ceremony

When a live XP fact crosses a level threshold after initial profile hydration, present a short, nonblocking first-pass ceremony substantially stronger than an ordinary toast.

For the P2 L1 -> L2 proof, communicate at least:

- **LEVEL UP!**
- new Level: `2`;
- max HP increase: `+5`;
- damage increase: `+2`;
- POWER before / delta / after: `1,000 -> +400 -> 1,400` for a fresh Starter state.

The exact composition may use glow, scale, light, screen treatment, existing feedback language, and sound where the repo already has appropriate infrastructure. Do not require elaborate final VFX or new art/assets.

The XP meter must visibly complete and roll into the new level rather than teleporting to an unrelated number.

### Ceremony idempotency

Do **not** replay a level-up ceremony merely because an already-earned XP fact is hydrated from local storage or a server welcome on page load/reconnect. Ceremony is for a live transition observed in the current session.

If one award crosses more than one threshold in a future test or fixture, the state must end at the canonical resulting level; P2 need not build an elaborate multi-level cinematic queue unless the real P2 100-XP path requires it.

### Reduced motion

If the existing UI honors reduced-motion preferences, preserve that behavior. Essential Level/HP/POWER information must remain legible when motion is reduced; animation is enhancement, not the only communication channel.

## Runtime/stat authority

Online server and offline fallback must derive the same Hero level/stats from the same canonical pure authorities.

At minimum:

- total XP is folded from durable facts; no mutable XP total is introduced;
- Level comes from P1 `levelStateForXp`/the same authority;
- max HP comes from level + current durable body bonuses such as Wren's charm;
- resolved Hero damage comes from current weapon + level bonus;
- both Wolf and Beacon/Warden combat consume the same Hero maxHP/damage law;
- POWER is derived only after those real stats exist;
- reconnect/profile recovery reproduces the same Level/stats/POWER without replaying ceremony.

Do not create separate client/server stat formulas.

## Expected write surface

Expected production surfaces include, as required by the implementation:

- **new or equivalent pure authority:** `public/src/progression/heroStats.js`;
- **new or equivalent pure authority:** `public/src/progression/power.js`;
- `public/src/progression/items.js` for normalized existing weapon values only;
- `public/src/progression/levels.js` only if a P2 caller/API gap requires it; do not fork the XP law;
- `public/src/progression/facts.js` only if needed for the live XP fact path;
- `net/rewardStore.mjs` / `net/gameServer.mjs` for derived XP/stat lookup and the one Lantern XP award;
- `public/src/net/protocol.js` only for the minimum additive live XP/event/state shape actually required;
- `public/src/combat/encounter.js` and `public/src/world/beaconSiege.js` for numeric normalization / resolved Hero-damage consumption while preserving purity;
- `public/src/main.js` for offline/state/UI integration;
- `public/index.html`, existing CSS/UI modules, `public/src/progression/heroScreen.js` (the file P2 actually created), feedback modules as necessary for Level/XP/POWER/health/ceremony;
- targeted tests under `test/`;
- one bounded runtime harness/capture path under `tools/runtime-test/` if no existing harness can deterministically prove the real level-up path.

This is expected ownership, not permission for unrelated cleanup in those files.

## Explicitly out of scope

Do **not** implement in P2:

- ordinary/repeatable combat XP;
- enemy-level XP gap tables;
- enemy levels/nameplates/population/collection architecture;
- any new enemy asset or AI behavior;
- armor/non-weapon gear definitions, stats, fit, visuals, drops, rarity, or loot tables;
- big equipment-upgrade POWER ceremony;
- learning/curriculum interaction or learning XP;
- Level-5 special attack or special-attack UI;
- movement-speed milestone progression;
- pets or pet POWER contribution;
- Recommended Power encounter UI;
- randomized item rolls, duplicate conversion, salvage, crafting;
- new world geography;
- Meshy/provider work or asset generation;
- final first-15-minute balance;
- unrelated refactors/cleanup.

## Checkpoint plan

P2 is one L PR with **three exact-SHA checkpoints**. The worker may continue to the next checkpoint after locally proving the current one unless a stop/reforecast condition is hit; each checkpoint must remain identifiable by its own pushed commit SHA and evidence so the Director can audit the history independently.

### P2-C1 — Stat + POWER authority

Must establish:

- canonical Hero-stat module;
- normalized Starter/Wildwood + Wolf/Warden values;
- normalized Wren charm bonus;
- canonical POWER module + formatter;
- Level-1 preservation/property tests;
- no player-facing UI or XP source required yet.

Checkpoint evidence:

- targeted tests PASS;
- full unit gate PASS;
- `git diff --check` PASS;
- exact pushed C1 SHA recorded in PR/report.

### P2-C2 — Durable real level-up path

Must establish:

- Lantern first-time unlock -> deterministic one-time `xp-earned: 100`;
- client/server/offline/reconnect idempotency;
- Level -> maxHP/damage wired into both current fights;
- no mutable XP total;
- no ceremony replay on hydration;
- protocol/state additions remain additive/minimal where practical.

Checkpoint evidence:

- targeted integration/persistence/combat tests PASS;
- full unit gate PASS;
- deterministic proof that one Lantern unlock yields one Level-2 profile and replay remains Level 2 with unchanged total XP;
- exact pushed C2 SHA recorded.

### P2-C3 — Player-facing payoff / final

Must establish:

- ordinary HUD Level + XP progress + POWER + scalable health;
- Hero/equipment Level + POWER and truthful normalized weapon stats;
- first-pass Level-up ceremony;
- running-game evidence from the real P2 award path;
- representative layout acceptance including the repo's relevant landscape/portrait surfaces and reduced-motion treatment where applicable.

Final evidence:

- targeted tests PASS;
- `node --test test/*.test.mjs` PASS;
- `git diff --check` PASS;
- affected local running-game harnesses PASS;
- fresh runtime captures for before / level-up / after state;
- no console errors attributable to P2;
- protected hosted `unit` PASS on the exact PR merge result/head evidence as GitHub provides it;
- broader browser matrix or Director relay run if the Director judges the final changed surface warrants it;
- exact final SHA.

Checkpoint PASS is not merge authorization.

## Acceptance tests / invariants

At minimum add/strengthen tests proving:

### Hero stats

- L1 base maxHP 30;
- each level adds exactly 5 maxHP;
- Starter L1 damage 10;
- Wildwood L1 damage 20;
- each level adds exactly 2 resolved Hero damage for the same equipped weapon;
- charm adds 10 maxHP at any tested level;
- representative Levels 20/100/1000 remain finite, monotone, safe/representable under supported numeric limits.

### Level-1 encounter preservation

- Wolf Starter kill count 3;
- Wolf Wildwood kill count 2;
- Wolf base-Hero down count 3 landed bites;
- Warden Starter kill count 12;
- Warden Wildwood kill count 6;
- Warden base-Hero down count 3 landed attacks;
- attack cadence/reach/timing tests remain unchanged unless only expected numeric assertions need normalization.

### XP award

- first Lantern unlock creates exactly one 100-XP fact;
- same completion/replay does not add another;
- reconnect/profile union does not double count;
- offline/local equivalent remains one logical award;
- 100 total XP resolves to Level 2 through P1 authority;
- hydration of existing Level-2 state does not fire a live level-up ceremony.

### POWER

- L1 Starter = 1,000;
- L2 Starter = 1,400;
- L1 Wildwood = 2,000;
- higher real maxHP/damage cannot lower POWER;
- values/formatting remain finite/legible through representative high levels;
- POWER is not imported as a combat/persistence/reward authority.

### UI/runtime

- health bar/numeric display follows authoritative current/max HP;
- Level and XP meter derive from the same level-state authority;
- level-up ceremony values match the actual before/after Hero stats and POWER;
- existing hit/heal/down/respawn feedback still functions;
- no fixed four-heart ceiling remains in shipped presentation/tests.

## Running-game acceptance path

Use the real authored P2 path, not a fake DOM-only level toggle.

A bounded deterministic harness may seed the profile to the legitimate state immediately before the first Lantern unlock, then complete the actual final qualifying action in the running game and capture:

1. **before:** Level 1, XP 0/100, POWER 1,000 for fresh Starter state, authoritative health;
2. **transition:** XP completion + visible LEVEL UP treatment;
3. **after:** Level 2, correct new-level XP state, 35 max HP, 12 Starter damage-equivalent state, POWER 1,400.

If the current authored flow makes another exact legitimate setup cheaper than seeding two Marks, use the smallest real-state fixture consistent with existing harness rules. Follow GQ-008: use the game's own guest-id rules and confirm the seeded identity/state before trusting assertions.

Machine measurements may reject overlap/clipping/state errors but may not visually accept the result. Running-game captures must be opened/inspected by a human before P2 visual gate PASS.

## Stop / reforecast conditions

Stop and report rather than broaden if:

- live `main` or the task branch unexpectedly moves before semantic work begins;
- another semantic writer is active on this branch;
- implementing P2 requires enemy-collection architecture or new enemy content;
- the one Lantern XP source cannot be made durable/idempotent without a broad persistence redesign beyond this vertical;
- a protocol-version migration is required rather than bounded additive state/event work;
- combat normalization requires changing AI/timing/reach/behavior rather than numeric stat scale;
- new art/audio/provider work becomes necessary to make the ceremony acceptable;
- a second XP source appears necessary to prove P2;
- adding armor, learning, pets, special attack, movement milestones, or Recommended Power becomes tempting;
- the package grows into final 15-minute tuning rather than first level-up proof;
- a genuine new Owner decision is required.

## Side-quest destinations

- repeatable combat XP / level-gap decay -> **R1** / #47 as appropriate;
- armor/gear POWER deltas and equip ceremony -> **G1/G2** / #44;
- enemy levels/nameplates/population/safety -> **E1/E2** / #47;
- selected enemy asset qualification -> **A3** / #47;
- meaningful learning XP -> **L1**;
- Level-5 special / speed milestone -> **M1**;
- pet contribution / 70-20-10 retune -> #35 future pet package;
- final opening pacing -> **V1**;
- low-value cleanup -> leave out.

## Worker topology / permissions

- Claude Execute is the **only semantic writer** on `feat/progression-p2-first-hero-level-up` during P2.
- Terra/Codex is not a P2 writer; any future A3 work is a separate branch/package.
- Director remains read-only while Claude is actively writing.
- After explicit worker handoff, Director independently refreshes/audits exact SHAs and may make only bounded deterministic corrections inside locked P2 scope, with disclosure/revalidation.

Authorized for Claude Execute:

- work only on the P2 branch;
- implement this brief through C1/C2/C3;
- add/modify targeted tests and one bounded runtime harness if needed;
- commit and push checkpoint/final states;
- update the P2 PR with checkpoint SHAs and evidence;
- run local tests/runtime checks;
- report side quests without implementing them.

Not authorized:

- merge/close the PR;
- write to `main`;
- force-push/rewrite shared history;
- start E1/G1/A3 or another package on this branch;
- paid/provider/Meshy work;
- production promotion;
- silent scope expansion.

## Worker report

Return `GQ-WORKER-REPORT v1` containing:

- `Task-ID: PROG-P2-FIRST-HERO-LEVEL-UP`;
- exact starting branch SHA before semantic edits;
- exact C1 SHA and evidence;
- exact C2 SHA and evidence;
- exact final/C3 SHA;
- DONE / BLOCKED / FAILED;
- changed-file summary;
- exact targeted-test results;
- exact full unit result;
- `git diff --check` result;
- runtime harness/capture evidence and paths;
- explicit before/after Level/XP/HP/damage/POWER values observed;
- explicit Level-1 wolf/Warden preservation evidence;
- explicit reconnect/replay/hydration evidence;
- unresolved UNKNOWNs;
- side quests routed but not implemented;
- confirmation no Owner-only action was performed.