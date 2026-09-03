# GalaQuest product vision

This file records **settled Owner-level product direction** that should survive a new chat, agent, branch,
or month. It is intentionally short. Candidate ideas, observations, evidence, and unresolved questions
belong in GitHub Issues under the product-memory system defined in `docs/product/PRODUCT_SYSTEM.md`.

Do not promote an agent suggestion, research note, or one-off playtest reaction into this file without an
Owner decision. When direction changes, replace or explicitly supersede the old statement rather than
leaving two current answers.

## Core promise

GalaQuest is a **fun-first, MMO-inspired action-adventure**. A child should want to play because the game
feels exciting, rewarding, collectible, social, and full of things worth discovering — not because they
were told it is educational.

Curriculum learning is embedded inside the actions required to progress. Learning should support the
fantasy and the reward loop rather than interrupting it with a separate "school mode" whenever practical.

## Engagement north star

Prefer loops that repeatedly create this feeling:

`want something -> do a meaningful activity -> visibly become stronger/richer/cooler -> show or use it -> discover the next thing worth wanting`

High-value engagement ingredients include:

- obvious power growth and kid-readable progression;
- collecting, rarity, discovery, and ownership;
- companions and other things players can become attached to;
- multiplayer presence, cooperation, generosity, comparison, and healthy flexing;
- spectacle, satisfying feedback, and moments that feel surprisingly powerful or cool;
- reasons to return that come from unfinished goals, new discoveries, relationships, and mastery.

Retention should come from satisfying play and meaningful goals, not deliberately manipulative dark
patterns.

## Learning philosophy

Hide the vegetables without hiding the learning outcome from the adults designing the game.

Prefer learning that is required to achieve something the player already wants: winning, unlocking,
upgrading, exploring, helping another player, solving a world problem, or earning a desirable reward.
The educational layer should be measured and intentional even when the child experiences it simply as
part of the adventure.

Meaningful learning should be one of the strongest progression/reward sources, but it should not be
trivially farmable. Ordinary combat may still award repeatable XP so grinding remains legitimate MMO play,
while authored progression and learning provide stronger and more reliable advancement. Badly outleveled
combat should not remain an optimal leveling strategy merely because the player can defeat it instantly.

## Current coordinated progression direction

The current major gameplay/progression direction is a coordinated push across **Hero XP/levels**, **meaningful visible gear progression**, **pet companions**, and **supporting enemy variety** in the existing playable slice. These systems should be designed against one shared progression/scaling and reward contract rather than independently inventing unrelated number economies. This shared design does not imply one giant implementation PR; delivery should use bounded PRs and checkpoints where appropriate.

The Hero is the primary source of power. Early levels should arrive very quickly, then lengthen gradually. Every Hero level should increase HP and damage; selected milestone levels may add bounded movement-speed growth. GalaQuest should keep one special-attack slot rather than growing a large hotbar, with the first special attack arriving around Level 5 and future design allowing the player to choose what occupies that slot.

GalaQuest uses a prominent kid-facing **POWER** value. POWER is derived from real underlying strength but may exaggerate magnitude for excitement. It should make upgrades and Hero growth immediately legible without becoming the source of combat stats. Early progression should remain Hero-dominant, with gear making a meaningful secondary contribution and pets a smaller contribution until their systems deepen.

Gear should be frequent and readable, use familiar rarity language, create repeated visible upgrade moments,
and visibly transform the Hero as qualified assets become available. Quests/progression/learning provide
reliable upgrades; ordinary enemies may drop gear at a comparatively low rate. Clear upgrades should
present an explicit before/after choice rather than silently auto-equipping.

Enemy progression follows a classic fixed-world MMO model rather than universal player-level scaling: old
enemies remain weak and eventually become trivial as the Hero grows, while stronger enemies and content
provide forward challenge. The world needs enough ordinary enemy population for the player to repeatedly
feel that growth. Enemy nameplates should clearly communicate name, level, health, and dangerous level gaps;
high-level threats may be visible early but must not be able to repeatedly farm newly respawned children.

Enemy variety exists to make becoming stronger observable and to support the progression loop. Fresh 2026-09-02 child-play evidence now establishes that the repeated current map is also part of the engagement bottleneck. GalaQuest should pursue **fast-paced expansion into clearly distinct destinations/levels** alongside visible armor and enemy variety rather than simply enlarging one seamless map. The current preferred design lead is an MMO-like persistent hub connected to bounded adventure zones/scenes with quick transitions and little empty traversal; the exact level/teleport structure remains to be proven through bounded Unity work. See #46 and #131.

## Current pet direction

Pets remain a major engagement surface because they can combine attachment, collection, identity, visible power, progression, rarity, and eventually social play.

Settled direction for the first pet system:

- a starter pet should be available essentially immediately once the real starter system is built;
- the player chooses **one of three starters**;
- **Fox** = fast/aggressive soft archetype;
- **Bear** = protector/tank soft archetype;
- **Frog** = magic/ranged soft archetype with a signature tongue poke;
- pets should feel like meaningful companions, not only stat cards;
- the player can **own many and equip one**;
- children should be able to name pets;
- pets should eventually have nameplates and a small party-style health presence;
- first-pass pet combat contribution is modest and does not require a separate pet-level grind.

The current wolf companion is a placeholder for the future Fox. New paid pet model generation/rig-tuning is
deferred until the Hero/gear progression spine is functioning and a separate asset-production package is
authorized.

Pet rarity economy, eggs/hatching, trading/gifting, broader social/economic systems, corpse/body-return death
friction, and transmog remain product candidates until separately decided and recorded through the
product-memory system.

## Current asset-use direction

Before generating a fresh armor library, inventory the armor/gear GLBs already in project custody and qualify
them for provenance, fit, materials, runtime performance, and running-game appearance. Integrate assets that
actually pass those gates. Cheap retexturing/material variants of strong meshes are a valid way to create
additional loot variety. Use the resulting inventory/gap count to size any later paid asset-production push.

## Decision discipline

- **This file answers:** what has the Owner actually decided about the product?
- **GitHub product Issues answer:** what ideas, signals, initiatives, evidence, and unresolved decisions
  are currently alive?
- **`PROGRESSION_CONTRACT_V0.md` answers:** what shared design constraints and provisional tuning shape the current progression push?
- **Pull requests answer:** what implementation is being proposed or validated now?
- **Chats answer:** what are we thinking about right now? Chats are not durable product authority.
