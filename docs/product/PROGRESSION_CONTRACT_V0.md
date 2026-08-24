# GalaQuest Progression Contract v0

**Status:** Draft for scrutiny and future decomposition. Owner-level direction below is settled; numeric tuning and implementation shape remain reviewable until a later acceptance/ratchet.

**Fixed point:** `main@3ac2fab889c1da9e02727363a16470c7fbe39a26`

**Related product records:** #35 Pet Companions v1, #43 Hero XP/levels, #44 meaningful gear, #47 enemy variety, #41 kid-readable Power growth.

## Purpose

This contract prevents Hero levels, gear, pets, enemies, rewards, and kid-facing Power from independently inventing incompatible progression economies. It is the shared design authority for decomposing the current progression push into bounded implementation packages after review.

It does **not** authorize a giant implementation PR, paid asset generation, or silent expansion into deferred systems. `docs/product/PRODUCT_VISION.md` remains the Owner-level product authority; GitHub Issues remain lifecycle/backlog authority; this file owns the shared progression design constraints and v0 tuning targets.

## Decision classes

- **OWNER-LOCKED** — explicit Owner decision. Implementation must preserve it unless the Owner changes direction.
- **V0 TARGET** — proposed measurable target or tuning envelope. Reviewers may challenge it without reopening the Owner decision it serves.
- **DEFERRED** — deliberately outside the first progression vertical.

## 1. Product outcome

**OWNER-LOCKED:** GalaQuest progression is a Hero-first MMO power fantasy. The child should repeatedly experience:

`want something -> do a meaningful activity -> visibly become stronger/cooler -> use that strength -> see the next thing worth wanting`

The current priority order is:

1. Hero visibly improves.
2. Earn/equip cool armor and visibly transform.
3. See a clear aspirational next reward.
4. Encounter several meaningfully different enemies.
5. Fox/Bear/Frog eventually contribute beside the Hero.

Pets remain important, but the Hero/gear spine comes first.

## 2. First-15-minute promise

**OWNER-LOCKED:** An actively progressing new player should approximately reach Level 4-5 within the first 15 minutes and experience multiple satisfying level-ups, multiple meaningful gear improvements, repeated visible Power increases, several enemy types/levels, at least one meaningful learning interaction that materially helps progression, and at least one aspirational reward they cannot yet obtain.

**V0 TARGETS:**

- Level 2 should normally occur within roughly 2-3 minutes of active progression.
- Levels 1-5 are deliberately fast; after Level 5, the curve begins lengthening.
- The first 15 minutes should contain roughly 4-8 gear reward events, with about 4-6 actual useful upgrades as a useful initial tuning target rather than a hard quota.
- Several equipped rewards should visibly change the Hero once qualified armor assets are integrated.
- A child in an active combat area should rarely spend long stretches unable to find a reachable ordinary enemy; safe/social spaces remain intentionally calmer.

## 3. Hero level architecture

**OWNER-LOCKED:** Hero progression is the primary source of power. The system should be architected so levels can continue upward without a baked-in low technical cap, while only a finite early range is deliberately balanced at any one time.

For v0, deliberately balance and test roughly Levels 1-20. Behaviour beyond the balanced range must remain mathematically well-formed but is not content-complete merely because the formula can return a number.

Every Hero level grants:

- more maximum HP; and
- more Hero damage.

Selected milestone levels may also grant a small movement-speed increase, but movement speed must have an explicit cap so progression does not make controls increasingly unstable.

There is one special-attack slot. The first special attack should unlock around Level 5. Do not promise a new attack every five levels and do not grow a mobile-unfriendly hotbar. Future design should allow the player to choose which unlocked special occupies that slot.

## 4. XP and pacing

**OWNER-LOCKED:** XP should come primarily from authored progression/quests, meaningful learning, and combat. Learning should be one of the strongest XP/reward sources, but it must not be trivially farmable.

Ordinary respawning enemies may always provide some XP, so grinding remains legitimate MMO play, but ordinary mob grinding should be materially less efficient than meaningful progression and learning.

Exploration/discovery may primarily reward other things rather than becoming another large XP faucet.

**V0 TARGETS:** Prefer reward budgets expressed as a fraction of the current level rather than scattered absolute values until the first playable reward inventory is counted. A useful starting envelope is:

- major authored progression/quest beat: about 20-40% of the current level;
- meaningful first-time/nonfarmable learning beat: about 20-40%;
- elite/boss or major combat beat: about 10-20%;
- ordinary repeatable mob: about 2-6%.

The exact XP table is deliberately not locked in this draft. Decomposition should create one pure/data-driven progression table or function rather than distributing thresholds across UI, server, combat, and tests.

Anti-farm design for learning should prefer durable completion identity, authored limits, changing challenges, or diminishing repeat credit over arbitrary cooldown spam.

## 5. Real strength versus displayed POWER

**OWNER-LOCKED:** GalaQuest has a prominent kid-facing `POWER` number. It is derived from real underlying strength but deliberately exaggerated for excitement. It is a presentation/result value, not the source of combat stats.

POWER should appear:

- persistently in a compact HUD treatment beside Hero level/progress;
- prominently on the Hero/equipment surface; and
- dramatically during an equipment upgrade, including a readable before -> delta -> after moment.

Example presentation intent:

`POWER 1,420 -> +560 -> 1,980`

**Hard invariants:**

1. Combat must not read POWER and then derive HP/damage from it. Real stats come first; POWER comes afterward.
2. A genuinely stronger loadout under the same comparison conditions must not display lower POWER.
3. POWER must be deterministic for the same Hero/loadout/pet state.
4. Presentation exaggeration may enlarge absolute values and differences but must preserve ordering.
5. Recommended Power may guide content difficulty but is normally advisory rather than a hard gate.

**OWNER-LOCKED strength budget:** In the early game, perceived/real progression should be Hero-dominant, approximately Hero 70%, gear 20%, pet 10%. These are design-budget proportions, not mandatory literal coefficients.

**V0 MODEL TO SCRUTINIZE:** Compute real combat strength from canonical combat inputs first, then map that strength through a monotone presentation curve. One viable approach is:

- compute a baseline Hero strength from level-derived HP/damage and bounded milestone modifiers;
- compute the counterfactual gain from equipped gear;
- compute the counterfactual gain from the equipped pet/support effect;
- tune content so the early-game contribution shares remain approximately 70/20/10;
- transform total real strength through an exponent greater than 1 to make displayed POWER grow more dramatically while preserving ordering.

The exact combat-strength scalar and display exponent are intentionally provisional and should be red-teamed before implementation.

## 6. Gear and loot contract

**OWNER-LOCKED:** Gear is frequent, readable, and visibly rewarding. Early gear should normally use no more than two simple stats per item. Familiar rarity language is acceptable and preferred:

`Common -> Uncommon -> Rare -> Epic -> Legendary`

Higher rarity should increasingly receive stronger visual treatment, not only larger numbers.

Gear acquisition follows a hybrid model:

- quests/progression/learning provide the reliable "for sure" upgrades;
- ordinary enemies have a fairly low chance to drop equipment;
- significant drops may receive visible world presentation;
- minor rewards do not all need physical loot objects.

When a clear upgrade is found, do not silently auto-equip it. Present an obvious `EQUIP NOW?` comparison with the stat and POWER change, preserving player agency while maximizing the upgrade moment.

Duplicate equipment is avoided for now. A later currency/material economy may convert duplicates rather than storing multiples.

Early visual mismatch between individually stronger pieces is acceptable. A transmog/cosmetic layer is a much-later candidate, not a blocker for the first loot loop.

Level requirements are reserved primarily for special/high-end gear rather than every ordinary item.

## 7. Armor asset strategy

**OWNER-LOCKED:** Before a fresh armor-generation push, inventory the existing armor/gear GLB bank and qualify every candidate for provenance/licensing, actual custody, Hero fit, materials, runtime cost, attachment behaviour, and running-game appearance.

Integrate every existing armor asset that genuinely passes those gates; do not force a bad asset into production merely because the bytes exist.

Cheap retexturing/material variants of strong meshes are explicitly desirable as legitimate loot variants when they read well and materially improve content density.

After the existing bank is understood, use the gap count to size a fresh asset-production push. New paid Meshy/provider work remains separately Owner-authorized.

The first aspirational reward should be selected after this inventory. Current Owner instinct is a mixture of outrageous armor, a badass weapon, and/or a visibly ultra-geared figure rather than a pet-first aspiration.

## 8. Enemy/world progression

**OWNER-LOCKED:** Use a classic WoW-like fixed-world progression philosophy rather than universal player-level scaling.

- Old enemies remain at their authored strength and become trivial as the Hero outlevels them.
- A Hero far above an old enemy should be able to destroy it extremely quickly.
- New zones/encounters/enemy bands provide the advancing challenge.
- Selected elites/bosses may remain meaningful longer.
- The existing world should gain substantially more ordinary combat population so becoming stronger has enough targets to demonstrate against.

Enemies should visibly communicate name, level, and health. Initial hierarchy can remain simple: ordinary enemies plus elite/boss-class threats.

High-level danger may be visible before the child can defeat it, but the UI must clearly communicate "this is trouble" through level/nameplate treatment such as strong red danger language.

High-level enemies must not be allowed to repeatedly farm children. Placement, aggro radius, leashing/territory, safe respawn areas, and/or brief respawn protection should prevent repeated unavoidable deaths without making dangerous enemies visually toothless.

**V0 TARGET:** In combat-focused stretches, maintain enough ordinary population that the player normally has another visible/reachable target within a short traversal rather than walking minutes between demonstrations of power.

## 9. Death and recovery

**OWNER-LOCKED for the first vertical:** Death is low-friction. The player keeps XP, gear, and durable progression and quickly returns to play.

**DEFERRED:** A later body/corpse-return mechanic may add mild friction after the core loop is proven. XP loss, gear durability loss, and harsh currency penalties are not part of v0.

## 10. Pet contract and sequencing

**OWNER-LOCKED:** Pets are meaningful companions but remain secondary to the Hero/gear spine in this progression push.

- The current wolf companion is a placeholder and must eventually be replaced by a purpose-built Fox model.
- Fox = fast/aggressive flavour; Bear = protector/tank flavour; Frog = magic/ranged flavour with a tongue-poke signature.
- These are soft archetypes rather than rigid class roles.
- Pet combat contribution is modest initially.
- No separate pet XP/level grind in the first progression push; pet effectiveness may scale modestly from Hero progression.
- Children should be able to name pets.
- Pets should have visible nameplates and a small party-style health presence.
- Reaching zero health should produce a temporary tired/down state with automatic recovery rather than harsh pet death/loss.
- Broad nameplate language should eventually cover players, pets, NPCs, and enemies while managing clutter contextually.

**DEFERRED:** Do not begin the paid Fox/Bear/Frog model-generation and rig-tuning push until the Hero/gear progression spine is functioning and the asset-production package is separately authorized.

## 11. Reward presentation priority

**OWNER-LOCKED celebration hierarchy:**

1. Hero level-up is the strongest routine progression celebration.
2. Equipping an upgrade and seeing POWER rise is next.

Level progress should have a satisfying meter and clear glow/light/sound treatment from the first useful version. More elaborate flashes/VFX may be layered later rather than blocking foundational progression implementation.

## 12. Current-main seams to preserve

At the fixed point named above, the repo already contains useful foundations that decomposition should extend rather than rebuild:

- durable profile facts already include `xp-earned` and fold to an `xp` total;
- gear ownership/equip persistence and real weapon damage differences already exist;
- the Hero screen already exposes equipment structure with non-weapon placeholder slots;
- the companion implementation is explicitly a temporary wolf-based checkpoint;
- current dedicated enemy implementations are shallow enough that enemy variety/population is still a real supporting need.

Re-audit these seams from live `main` at the start of each implementation package; this section is a fixed-point observation, not permanent authority.

## 13. Decomposition constraints

Do not decompose this contract by subsystem in a way that loses the player-facing loop. Each implementation package should remain bounded under `docs/WORKFLOW.md`, but the sequence must preserve a shared tuning authority and converge on the first-15-minute promise.

Before implementation begins, decomposition must identify at minimum:

- one canonical Hero level/XP/stat tuning seam;
- one canonical POWER derivation seam;
- one canonical gear definition/stat seam;
- one reward-award seam shared by guaranteed and probabilistic sources;
- one enemy level/stat/archetype authority;
- one acceptance path that proves the whole early progression loop in a running game.

Asset inventory/qualification may run as a separate production lane, but it must not silently become gameplay implementation or authorize provider spend.

## 14. Review questions before decomposition

A fresh independent reviewer should attempt to disprove this draft by checking:

1. Can the 70/20/10 Hero/gear/pet intent coexist with frequent exciting loot, or will gear feel mathematically trivial?
2. Can POWER exaggerate growth while remaining deterministic, monotone, and honest enough for Recommended Power?
3. Do the XP-source ranges create an obvious optimal grind that bypasses authored/learning progression?
4. Can the first 15-minute reward density be achieved with current/qualified assets without turning every event into UI spam?
5. Does fixed-world enemy leveling create enough low-level power fantasy while preserving forward challenge?
6. Do danger telegraphs and aggro/leash rules prevent high-level enemies from repeatedly killing new players without removing the thrill of seeing them?
7. Are level growth, gear stats, enemy stats, and Power calculated from one coherent set of canonical numbers rather than circular or duplicated formulas?
8. Which implementation package should own the first vertical slice without becoming an XL PR?

A reviewer may recommend different v0 formulas, ranges, or package boundaries. Any recommendation that changes an OWNER-LOCKED statement must be surfaced explicitly as an Owner reforecast rather than silently incorporated.
