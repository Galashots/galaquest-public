# GalaQuest Progression Contract v0

**Status:** Draft for scrutiny and future decomposition. Owner-level direction below is settled; numeric tuning and implementation shape remain reviewable until a later acceptance/ratchet.

**Fixed point:** `main@3ac2fab889c1da9e02727363a16470c7fbe39a26`

**Related product records:** #35 Pet Companions v1, #43 Hero XP/levels, #44 meaningful gear, #47 enemy variety, #41 kid-readable POWER growth.

## Purpose

This contract prevents Hero levels, gear, pets, enemies, rewards, learning, and kid-facing POWER from independently inventing incompatible progression economies. It is the shared design authority for decomposing the current progression push into bounded implementation packages after review.

It does **not** authorize a giant implementation PR, paid asset generation, or silent expansion into deferred systems. `docs/product/PRODUCT_VISION.md` remains the Owner-level product authority; GitHub Issues remain lifecycle/backlog authority; this file owns the shared progression design constraints and v0 tuning targets.

## Decision classes

- **OWNER-LOCKED** — explicit Owner decision. Implementation must preserve it unless the Owner changes direction.
- **V0 TARGET** — proposed measurable target, architecture interpretation, or tuning envelope. Reviewers may challenge it without reopening the Owner decision it serves.
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

**OWNER-LOCKED:** An actively progressing new player should approximately reach Level 4-5 within the first 15 minutes and experience multiple satisfying level-ups, multiple meaningful gear improvements, repeated visible POWER increases, several enemy types/levels, at least one meaningful learning interaction that materially helps progression, and at least one aspirational reward they cannot yet obtain.

**V0 TARGETS:**

- Level 2 should normally occur within roughly 2-3 minutes of active progression.
- Levels 1-5 are deliberately fast; after Level 5, the curve begins lengthening.
- Subject to the qualified gear inventory, the first 15 minutes should aim for roughly 4-8 gear reward events and about 4-6 actual useful upgrades. This is a playtest/tuning target, not a requirement to manufacture low-value items or UI spam to hit a quota.
- Several equipped rewards should visibly change the Hero once qualified armor assets are integrated.
- A child in an active combat area should rarely spend long stretches unable to find a reachable ordinary enemy; safe/social spaces remain intentionally calmer.

Before implementation tuning is frozen, build a simple authored-beat budget for the opening 15 minutes: list the actual progression, learning, combat, and gear-award beats available and prove that the proposed XP/reward schedule can reach the promise without requiring degenerate grinding. Do not infer this from percentages alone.

## 3. Hero level architecture

**OWNER-LOCKED:** Hero progression is the primary source of power. The system should be architected so levels can continue upward without a baked-in low technical cap, while only a finite early range is deliberately balanced at any one time.

For v0, deliberately balance and test roughly Levels 1-20. Behaviour beyond the balanced range must remain finite, monotone, and representable, but it is not content-complete merely because the formulas can return numbers.

Every Hero level grants:

- more maximum HP; and
- more Hero damage.

Selected milestone levels may also grant a small movement-speed increase, but movement speed must have an explicit cap so progression does not make controls increasingly unstable.

There is one special-attack slot. The first special attack should unlock around Level 5. Do not promise a new attack every five levels and do not grow a mobile-unfriendly hotbar. Future design should allow the player to choose which unlocked special occupies that slot.

### Scalable stat-resolution prerequisite

The current fixed-point combat uses tiny integer values (`HERO_MAX_HP = 3`, `HERO_MAX_HP_CEILING = 4`, starter damage 1). That resolution cannot express repeated per-level HP/damage growth plus modest two-stat gear contributions.

The current progression decision therefore **supersedes the old fixed four-heart ceiling as a future progression constraint**. The four-heart UI was correct for the pre-leveling fight, but it cannot remain the maximum body size once every level grants HP. Implementation decomposition must include a scalable HP/stat representation and a scalable player-facing health display. The exact presentation (bar, number, bounded pips plus numeric value, or another kid-readable treatment) remains a visual-design decision and requires running-game acceptance.

**V0 TARGET:** Prefer integer-scaled combat values with enough resolution for small upgrades over introducing floating-point combat state merely to escape the 3/4-point ceiling.

For levels outside the deliberately balanced band, property tests should at least sample representative high levels (for example 20, 100, and 1000) and prove that XP thresholds, Hero stats, and displayed POWER remain finite and monotone. POWER formatting must have a defined compact form once raw numbers exceed ordinary digit lengths.

## 4. XP, learning, adjudication, and pacing

**OWNER-LOCKED:** XP should come primarily from authored progression/quests, meaningful learning, and combat. Learning should be one of the strongest XP/reward sources, but it must not be trivially farmable. Ordinary combat grinding is legitimate MMO play, but it should be materially less efficient than meaningful progression and learning.

The Owner's combat-grinding decision does **not** require badly outleveled enemies to remain useful forever. Under the fixed-world model, appropriately leveled ordinary mobs may provide repeatable XP; rewards from heavily outleveled mobs should decay to negligible or zero so old-content one-shots demonstrate power without becoming the optimal leveling strategy.

Exploration/discovery may primarily reward other things rather than becoming another large XP faucet.

### Reward-basis invariants

1. No infinitely repeatable reward source may be expressed as a fixed percentage of the **player's own** current-level requirement. That would cancel the intended slowing level curve and reward farming trivial content.
2. Combat XP is derived from the **enemy/content level** plus a level-gap modifier. The exact table is V0 tuning, but it must decay materially as the Hero outlevels the enemy and reach negligible/zero reward at a bounded gap.
3. Finite authored progression and first-time/nonfarmable learning beats may be budgeted as fractions of the Hero's current/next level because their durable completion identity prevents infinite repetition.
4. Every nonrepeatable progression or learning award requires a stable durable completion identity. Do not key completion to an array index, local counter, or wall-clock timestamp.
5. XP remains a derived fold of append-only facts; do not add a mutable stored XP total that can drift from the event history.

The exact XP threshold table and reward table are deliberately not locked in this draft. Before decomposition reaches tuning work, define one pure/data-driven progression table/function rather than distributing thresholds across UI, server, combat, and tests.

### Learning is in the first vertical

At the fixed point there is no dedicated curriculum/learning runtime module. The first-15-minute promise nevertheless includes one meaningful learning interaction by explicit Owner decision. Decomposition must therefore account for a real bounded learning/reward package rather than treating learning as already-available content. The first version does not need a giant school subsystem; it must prove one fun-first learning interaction with durable completion identity and a material progression reward.

### V0 trust/adjudication posture

The existing profile architecture deliberately supports same-device/offline recovery using client-attested durable facts. V0 should preserve that local-first continuity unless the Owner later chooses a competitive threat model.

For the first progression vertical:

- online live combat and server-observable claims remain server-adjudicated;
- offline-earned progression may be represented by client-attested profile facts and remains distinguishable by origin;
- "not farmable" means the ordinary game loop does not offer an obvious repeat exploit to an honest player; it does **not** claim adversarial cheat-proofing against a modified client;
- before social competition, trading, or meaningful cross-device status depends on XP, revisit whether signed/server-bounded progression is required.

This trust posture is a V0 architecture assumption, not permission to weaken live server adjudication.

## 5. Real strength versus displayed POWER

**OWNER-LOCKED:** GalaQuest has a prominent kid-facing `POWER` number. It is derived from real underlying strength but deliberately exaggerated for excitement. It is a presentation/result value, not the source of combat stats.

POWER should appear:

- persistently in a compact HUD treatment beside Hero level/progress;
- prominently on the Hero/equipment surface; and
- dramatically during an equipment upgrade, including a readable before -> delta -> after moment.

Example presentation intent:

`POWER 1,420 -> +560 -> 1,980`

### POWER invariants

1. Combat must not read POWER and then derive HP/damage from it. Real stats come first; POWER comes afterward.
2. A genuinely stronger loadout under the same comparison conditions must not display lower POWER.
3. POWER must be deterministic for the same Hero/loadout/pet state.
4. Presentation exaggeration may enlarge absolute values and differences but must preserve ordering.
5. Recommended Power may guide content difficulty but is normally advisory rather than a hard gate.
6. POWER must never become the authoritative input for XP awards, drop rolls, durable writes, or combat adjudication.
7. The real-strength budget is measured in **real-strength space**, never by reading contribution percentages back out of displayed POWER.
8. Recommended Power for an encounter must be derived by mapping that encounter's canonical real-strength target through the **same** presentation transform used for the Hero. Do not hand-author round POWER thresholds that drift from the combat model.

### Strength-budget interpretation

**OWNER-LOCKED:** In the mature early-game composition, perceived/real progression should be Hero-dominant, approximately Hero 70%, gear 20%, pet 10%. These are design-budget proportions, not mandatory literal coefficients.

Use a fixed benchmark attribution rule rather than ambiguous free-form counterfactuals. For a benchmark Hero state, compare:

1. Level-1/base Hero with starter equipment and no pet;
2. the benchmark-level Hero with the same starter equipment and no pet — **Hero contribution**;
3. the same benchmark Hero with the benchmark gear loadout and no pet — **gear contribution**;
4. the same benchmark Hero/loadout with the benchmark pet — **pet contribution**.

Tune the incremental real-strength gains across those steps toward the intended shares. Use the same order and benchmark whenever comparing revisions so the budget is testable instead of changing with attribution method.

Because the first Hero/gear vertical deliberately precedes real pet combat integration, its operational v0 budget is approximately **78% Hero / 22% gear / 0% pet** after renormalizing the eventual 70/20/10 target. When the pet term becomes real, retune toward 70/20/10 rather than double-counting Hero progression through pet scaling.

### V0 POWER model to scrutinize

Compute a canonical real-strength scalar from real combat inputs first, then map it through a strictly monotone presentation curve. A presentation exponent or another monotone transform may make displayed growth more dramatic without changing combat.

The exact real-strength scalar and display transform remain provisional. They must satisfy the invariants above and remain finite over the supported architectural level range.

**V0 sidegrade rule:** POWER is the game's official single-number estimate of generalized combat readiness. Two-stat deltas remain visible on the equip comparison. An item that improves one stat but reduces overall POWER is a legitimate sidegrade, not a hidden "upgrade"; the UI should not label it as strictly better merely because one stat rose.

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

Duplicate equipment is avoided for now. Drop selection must be ownership-aware **before** promising a gear reward; do not roll a duplicate and silently make the drop disappear. If no eligible unowned item exists, the source should use an explicitly designed non-gear fallback or suppress the gear roll rather than lying to the player.

The repository already has durable coin/shard facts and a spend sink. If duplicate conversion is selected later, extend the existing economy rather than minting a parallel currency merely for salvage.

Early visual mismatch between individually stronger pieces is acceptable. A transmog/cosmetic layer is a much-later candidate, not a blocker for the first loot loop.

Level requirements are reserved primarily for special/high-end gear rather than every ordinary item.

### Ceremony collision rule

Hero level-up remains the strongest routine celebration. Do not stack a gear modal over a level-up ceremony. Slot-first-fills, large rarity jumps, or signature rewards may receive a larger explicit equip moment; routine upgrades should use a persistent/non-blocking comparison prompt so frequent loot does not turn progression into menu interruption.

## 7. Armor asset strategy

**OWNER-LOCKED:** Before a fresh armor-generation push, inventory the existing armor/gear GLB bank and qualify every candidate for provenance/licensing, actual custody, Hero fit, materials, runtime cost, attachment behaviour, and running-game appearance.

Integrate every existing armor asset that genuinely passes those gates; do not force a bad asset into production merely because the bytes exist.

Cheap retexturing/material variants of strong meshes are explicitly desirable as legitimate loot variants when they read well and materially improve content density.

After the existing bank is understood, use the gap count to size a fresh asset-production push. New paid Meshy/provider work remains separately Owner-authorized.

The first aspirational reward should be selected after this inventory. Current Owner instinct is a mixture of outrageous armor, a badass weapon, and/or a visibly ultra-geared figure rather than a pet-first aspiration.

### Dependency rule

The armor inventory may run in parallel with generic gear mechanics, but it is a **hard predecessor** to freezing the first-15-minute gear-content count, final slot-content plan, and aspirational reward. Do not promise 4-6 distinct useful visual upgrades until the qualified inventory proves enough content exists.

The current Hero screen exposes `weapon`, `shield`, `helmet`, `shoulders`, and `chest`; treat that slot vocabulary as provisional until the inventory/decomposition pass resolves Issue #44's Body/Armor-versus-Shoulders concern. Do not let current markup silently become permanent product taxonomy.

## 8. Enemy/world progression

**OWNER-LOCKED:** Use a classic WoW-like fixed-world progression philosophy rather than universal player-level scaling.

- Old enemies remain at their authored strength and become trivial as the Hero outlevels them.
- A Hero far above an old enemy should be able to destroy it extremely quickly.
- New zones/encounters/enemy bands provide the advancing challenge.
- Selected elites/bosses may remain meaningful longer.
- The existing world should gain substantially more ordinary combat population so becoming stronger has enough targets to demonstrate against.

Enemies should visibly communicate name, level, and health. Initial hierarchy can remain simple: ordinary enemies plus elite/boss-class threats.

High-level danger may be visible before the child can defeat it, but the UI must clearly communicate "this is trouble" through level/nameplate treatment such as strong red danger language.

### Safety invariants

1. A respawning child must not return directly into an unavoidable repeat kill from the enemy that downed them. V0 must guarantee a safe recovery using authored respawn relocation/checkpointing, temporary protection, enemy reset/leash, or a proven combination. This outcome is mandatory, not an optional menu.
2. Ordinary roaming enemies need an explicit leash/territory/engagement bound so pursuit terminates.
3. High-level threats may be visible early, but safe spawn spaces and encounter placement must prevent them from repeatedly farming newly respawned children.

**V0 TARGET:** In combat-focused stretches, maintain enough ordinary population that the player normally has another visible/reachable target within a short traversal rather than walking minutes between demonstrations of power.

### Architectural prerequisite

At the fixed point, ordinary enemy state is singular end-to-end: the core encounter holds one `wolf`, the wire shape decodes one `wolf`, and the village patrol is several positions for that one enemy rather than a population. More mobs are therefore not merely content tuning.

Before density, per-mob drop rates, or multi-enemy XP pacing can be tuned honestly, decomposition must create a bounded package that turns the singular enemy model into a scalable enemy-collection/identity architecture across authoritative state, protocol, client presentation/prediction, and tests. This package is a prerequisite for later population/density tuning, even if Hero-level mechanics can progress independently in parallel.

## 9. Death and recovery

**OWNER-LOCKED for the first vertical:** Death is low-friction. The player keeps XP, gear, and durable progression and quickly returns to play.

The current fixed-point respawn restores HP in place after a short delay and does not use the stored `heroSpawn` location. That is incompatible with the high-level-danger direction once multiple enemies exist and must be corrected as part of the enemy/safety architecture before dangerous high-level mobs are introduced.

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

When pet combat is introduced, its contribution may depend on Hero progression for encounter tuning, but the canonical POWER/stat calculation must count the resulting pet contribution once. Do not add a Hero-level term and then add the same Hero scaling again as an independent pet bonus.

**DEFERRED:** Do not begin the paid Fox/Bear/Frog model-generation and rig-tuning push until the Hero/gear progression spine is functioning and the asset-production package is separately authorized.

## 11. Reward presentation priority

**OWNER-LOCKED celebration hierarchy:**

1. Hero level-up is the strongest routine progression celebration.
2. Equipping an upgrade and seeing POWER rise is next.

Level progress should have a satisfying meter and clear glow/light/sound treatment from the first useful version. More elaborate flashes/VFX may be layered later rather than blocking foundational progression implementation.

## 12. Fixed-point implementation reality

At `main@3ac2fab889c1da9e02727363a16470c7fbe39a26`, decomposition must plan from these actual seams rather than the desired future system:

- **XP:** `xp-earned` exists in the client/profile fact vocabulary and folds into an `xp` total, but the server reward store does not accept `xp-earned`, no production source currently mints it, and client-profile restore can therefore reach a store rejection if XP facts are introduced without completing the server/store path. XP is a partial foundation, not a finished persistence feature.
- **Fact restore:** profile restore writes client-attested facts in a loop. An XP/store mismatch can fail mid-restore, so the XP persistence package must make accepted profile-fact types consistent end-to-end and make the restore operation atomic or otherwise prove it cannot leave a partial accepted set after a rejected batch.
- **Gear:** ownership/equip persistence and real weapon damage differences already exist. The Hero screen exposes five slots, but only weapon items are currently defined; non-weapon slot vocabulary remains provisional under §7.
- **Economy:** durable `coin-earned` and `shard-earned` facts and an existing village spend sink already exist. Future salvage/duplicate conversion should extend this economy rather than creating a second one.
- **Companion:** the companion implementation is explicitly a temporary wolf-based checkpoint; there is no real starter choice, naming, pet combat contribution, pet health, or pet nameplate yet.
- **Enemies:** authoritative combat state and wire protocol model one ordinary `wolf`, not a population. Dedicated enemy code is effectively Wolf plus Warden, with Warden presentation partly procedural. Multi-enemy population is architecture work, not asset swapping.
- **Respawn:** current combat respawn restores HP in place; safe relocation/protection is not yet implemented.
- **Movement:** `character/speed.js` is the shared client/server speed law and the server also clamps to the current run-speed ceiling. Any level-based speed milestone must change the shared law/clamp and client prediction together or it will be cancelled/desynchronized.
- **Learning:** no dedicated learning/curriculum runtime module exists at this fixed point. The first vertical must add one bounded learning interaction rather than assuming a system is already available.

### Existing purity boundaries that decomposition must respect

- `public/src/combat/` is a pure rules layer. Progression/item catalogues and random drop generation do not belong inside it; derived Hero stats should arrive through the existing command/event seam.
- `world/zones/` data is import-free by test contract; enemy/content authority must not be smuggled into zone files through new imports.
- Probabilistic drop rolls must be performed outside the pure combat rules and the resulting outcome passed through an explicit command/event/reward seam.
- Canonical XP/level/stat and POWER derivation modules should be pure/importable from both server and client surfaces where both need the same answer.

Re-audit these seams from live `main` at the start of each implementation package; this section is a fixed-point observation, not permanent authority.

## 13. Decomposition constraints

Do not decompose this contract by subsystem in a way that loses the player-facing loop. Each implementation package should remain bounded under `docs/WORKFLOW.md`, but the sequence must preserve a shared tuning authority and converge on the first-15-minute promise.

Before implementation begins, decomposition must identify at minimum:

- one canonical Hero level/XP/stat tuning seam;
- one canonical POWER derivation seam;
- one canonical gear definition/stat seam;
- one reward-award seam that can serve guaranteed rewards and probabilistic sources without putting randomness inside pure combat rules;
- one enemy level/stat/archetype authority plus scalable enemy identity/collection state;
- one durable learning-completion identity and learning-award seam;
- one acceptance path that proves the whole early progression loop in a running game.

Asset inventory/qualification may run as a separate production lane, but it must not silently become gameplay implementation or authorize provider spend. It is a hard predecessor to freezing gear-content counts and the first aspirational reward.

### Package-order dependencies, not final decomposition

The following dependencies are already strong enough to record before package sizing:

- scalable stat resolution and health presentation precede honest level/gear tuning;
- XP persistence/type consistency precedes awarding XP in production;
- scalable enemy identity/collection architecture precedes enemy-density, multi-mob drop-rate, and realistic combat-XP tuning;
- armor inventory/qualification precedes final gear-content counts and aspirational reward selection;
- the bounded learning interaction is required before the first-15-minute vertical can be accepted;
- the paid pet asset push is not a predecessor for the Hero/gear vertical.

These dependency statements do not mean one giant prerequisite PR. The actual S/M/L decomposition follows only after this contract is accepted.

## 14. Acceptance model for the progression vertical

Do not turn every V0 target into a brittle CI threshold. Use three layers:

1. **Mechanical/property acceptance** — unit/property tests for monotone XP thresholds, finite stats, POWER monotonicity/determinism, level-gap XP decay, no duplicate item grants, and shared client/server derivations.
2. **Scripted runtime acceptance** — a deterministic or seeded opening scenario proving that the required systems can produce several level-ups, gear changes, enemy-level interactions, learning reward, safe death/recovery, and POWER changes without contradictions.
3. **Human running-game acceptance** — a timed child-facing opening playtest against the approximate 15-minute target, judging pacing, ceremony density, readability, fun, and whether the next desirable thing is obvious. The 4-8 reward / 4-6 useful-upgrade target is tuned here; missing it is evidence to adjust the economy/content, not permission to weaken unrelated mechanical gates.

## 15. Review status after independent scrutiny

An independent exact-head review of the first draft correctly identified several material gaps: player-level-scaled repeatable XP would create trivial-enemy farming; ordinary enemy state is singular rather than population-ready; respawn safety was optional rather than guaranteed; XP exists only as a partial fact/store seam; movement-speed milestones collide with the shared speed clamp; the POWER contribution budget needed a defined measurement space; asset inventory is a predecessor to gear-content promises; and the contract was not discoverable from the repository startup hierarchy.

Those are incorporated above. The review also surfaced three apparent Owner conflicts. They resolve as follows:

- **Four-heart ceiling vs. per-level HP:** the current progression grill is the later and more specific Owner decision. Per-level HP growth stands; the old four-heart ceiling becomes a pre-progression implementation constraint to replace when the stat/HUD package lands.
- **Repeatable mob XP vs. trivial old enemies:** grinding remains legitimate, but outleveled-content reward decays to negligible/zero. The Owner chose modest combat grinding, not permanent usefulness of every Level-2 wolf.
- **Learning in the first vertical:** learning remains in-scope by explicit Owner decision. Its absence from current code changes package sizing; it does not defer the promise.

The contract is ready for a final Director/Owner sanity pass before S/M/L decomposition once the planning PR's required unit/guidance gate remains green at its revised head.
