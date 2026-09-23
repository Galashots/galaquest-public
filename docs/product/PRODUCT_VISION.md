# GalaQuest product vision

This file records **settled Owner-level product direction** that should survive a new chat, agent, branch,
or month. It is intentionally short. Candidate ideas, observations, evidence, and unresolved questions
belong in GitHub Issues under the product-memory system defined in `docs/product/PRODUCT_SYSTEM.md`.

Do not promote an agent suggestion, research note, or one-off playtest reaction into this file without an
Owner decision. When direction changes, replace or explicitly supersede the old statement rather than
leaving two current answers.

## Core promise

GalaQuest is a **fun-first creature-collecting farm adventure**. A child should want to play because there
is always something growing, something about to hatch, something cool to wear, and a friend or sibling to
show it to — not because they were told it is educational.

> **Owner decision 2026-09-23 — farm pivot.** This supersedes the earlier identity of a "fun-first,
> MMO-inspired action-adventure" and its real-time-combat-first north star. The pivot takes effect **after**
> the Emberworks "Relight the Forge" finale (#192) ships; Emberworks is finished under the current systems
> rather than rebuilt. Evidence: the primary child players' strongest hooks in comparable games are
> collecting, how things look, and breeding/hatching — not battles; repetitive "go around and kill stuff"
> play is an explicit dislike; farming and buying/selling were well received in early prototypes; and
> confusion about what to do next quickly becomes boredom.

Curriculum learning is embedded inside the actions required to progress. Learning should support the
fantasy and the reward loop rather than interrupting it, and real schoolwork should be the single best-paying
job in the game (see **Learning philosophy**).

## Engagement north star

Prefer loops that repeatedly create this feeling:

`want something -> do a meaningful activity -> visibly become stronger/richer/cooler -> show or use it -> discover the next thing worth wanting`

The core loop that delivers it:

`plant and harvest -> feed creatures / forge gear / sell at market -> creatures grow and visibly transform, the Hero looks cooler -> breed for eggs and hatch new creatures -> take the team on a short expedition for rare rewards -> back to the farm`

High-value engagement ingredients include:

- collecting, rarity, discovery, and ownership — many creatures, many armor pieces;
- things that visibly change as they grow: creatures, the Hero's armor, the farm;
- companions players become attached to, name, and raise;
- multiplayer presence, cooperation, trading, generosity, and healthy flexing;
- spectacle, satisfying feedback, and moments that feel surprisingly powerful or cool;
- reasons to return that come from unfinished goals — a crop to harvest, an egg to hatch, a set to complete.

Retention should come from satisfying play and meaningful goals, not deliberately manipulative dark
patterns. **GalaQuest has no premium currency and no pay-to-skip.** Wait timers exist to pace the loop, and
the only accelerators are play and learning.

## Current production north star

**Always an obvious next step, always something growing, something to hatch, and something cool to wear.**

Use these principles to judge near-term player-facing work:

- **Always an obvious next step.** A goal tracker, markers, or equivalent guidance must make the next useful
  action unmistakable at every moment. This is a hard requirement, not polish: an unclear next step is the
  fastest route to boredom for the target players.
- **The farm feeds everything.** Crops are the root resource: pet food that levels creatures, materials for
  forging gear, and goods to sell for coins. New systems should plug into the farm economy rather than inventing
  unrelated currencies.
- **Visible gear, lots of it.** Armor and equipment must visibly transform the Hero. Armor comes from all four
  sources: the market, forging from farm and expedition materials, expedition rewards, and homework-board-only
  pieces. The production pipeline should make it cheap to qualify, fit, vary, and ship more armor.
- **Less combat, better combat.** Combat is a smaller, occasional part of play and uses **team turn-based
  battles** (see **Combat direction**). Expeditions are short destinations with a clear reward purpose, not
  the main activity.
- **Exploit creative ownership — as a treat.** Child/player-invented creatures, gear, or places may
  occasionally become real game content when they are good and production-qualifiable. This is an occasional
  reward, not a regular content pipeline or an in-game creator platform.
- **Fast before vast.** Prove one small, complete loop before building the system for dozens of crops,
  creatures, or destinations.
- **Player-facing proof beats infrastructure completion.** Engineering foundations matter because they enable
  better play. The next deliberate child playtest should contain meaningful new player-visible value.

### First post-Emberworks slice

The first slice after Emberworks is **farm + egg + market, with no battles yet**: plant and harvest a few
crops, sell them at a market, buy a visible armor piece, and hatch a first egg — with the goal tracker
guiding every step. Deliver it through bounded PRs; this is not permission for one giant implementation
package.

## Platform

**iPad first.** The primary play device is an iPad running the Unity WebGL build in Safari. Player-facing
work must be touch-operable (no hover-only or keyboard-only interactions), readable at tablet size, and
within an iPad Safari performance and memory budget. Desktop remains a supported development and play
surface.

## Learning philosophy

Hide the vegetables without hiding the learning outcome from the adults designing the game.

Prefer learning that is required to achieve something the player already wants: hatching an egg sooner,
growing a rare crop, unlocking or earning gear, helping another player, or solving a world problem. The
educational layer should be measured and intentional even when the child experiences it simply as part of
the farm.

Two settled learning surfaces:

- **Homework board.** A job board on the farm where real schoolwork is the best-paying job in the game,
  including homework-only armor. Homework content is supplied by the Owner (or the Director on the Owner's
  behalf) from each child's actual classwork. Children's classwork and profile data are private: they must
  never be committed to this public repository, and #148 owns the learning-content and public-safe source
  boundary.
- **Timer acceleration.** Eggs and rare crops have longer timers; basic crops are quick. Answering learning
  questions shortens the long timers. This is the in-game replacement for the paid speed-ups common in the
  genre.

Meaningful learning should be one of the strongest progression/reward sources, but it should not be
trivially farmable — acceleration and homework rewards need bounds so the loop cannot be skipped by
repeating easy questions.

## Combat direction

> **Owner decision 2026-09-23.** After Emberworks, combat moves from real-time action to **team turn-based
> battles**. This supersedes the real-time "fight more than Wolves" framing, the single special-attack slot,
> and the fixed-world enemy-farming model for post-Emberworks content.

- The player's team is **the Hero plus two creatures**.
- Turn order is readable (for example a visible turn-order bar), with a small number of clear actions per
  turn.
- Creatures have **elements** with kid-readable strengths and weaknesses, and team roles (attacker, tank,
  support/control) matter.
- Battles happen on short expeditions for rewards — rare materials, eggs, and armor — and are never the only
  way to progress.

The shared progression/scaling contract (`PROGRESSION_CONTRACT_V0.md`) was written for real-time combat.
The POWER value, Hero leveling, and gear contribution remain useful ideas, but their tuning must be
re-decided against turn-based team combat and farm-fed creature leveling before post-Emberworks combat is
built. Until then, that contract applies to Emberworks only.

## Current creature direction

Creatures (pets) are the central engagement surface: attachment, collection, identity, visible power,
progression, rarity, breeding, and social play.

Settled direction:

- **Many creatures.** The roster mixes the three starter animals with wilder **elemental monsters**
  discovered later, each with an element and a rarity.
- The player chooses **one of three starters**: **Fox** = fast/aggressive, **Bear** = protector/tank,
  **Frog** = magic/ranged with a signature tongue poke.
- Players **own many and bring two** into a battle team.
- Creatures level up by being **fed crops from the farm**, and **visibly transform** as they grow.
- **Breeding:** pair two creatures to produce an **egg**; eggs **hatch on the farm** on a timer (shortened
  by learning, see above).
- Children can name their creatures; creatures should feel like companions, not only stat cards.

The current wolf companion is a placeholder for the future Fox. For the Emberworks opening, the green/red
worm companions remain a scope-specific override and do not replace the starter direction. New paid creature
model generation remains subject to the Meshy/provider spend rule in `AGENTS.md`.

## Social direction

> **Owner decision 2026-09-23.** Each player has **their own farm and collection**. Players can **visit**
> each other's farms, **trade**, and go on **co-op expeditions** together.

Trading and visiting should favour generosity and healthy showing-off and must stay safe for young
children (no open chat with strangers is implied by this direction). Corpse/body-return death friction and
transmog remain product candidates until separately decided.

## Scope and sequencing

1. **Now:** finish Emberworks "Relight the Forge" (#192) within the selected **Hub/Camp + Emberworks** scope
   under the current systems. Sunroot is not selected.
2. **Next:** the first post-Emberworks slice (farm + egg + market, goal tracker, no battles).
3. **Then:** turn-based team expeditions, breeding depth, homework board, and sibling visiting/trading, each
   as separately framed bounded packages.

Learning in every scope must be personalized by profile/subject rather than treated as math-only; #148 owns
the learning-content and public-safe source boundary. These decisions define direction and sequencing, not a
newly dispatched package.

## Current asset-use direction

Before generating a fresh armor library, inventory the armor/gear GLBs already in project custody and qualify
them for provenance, fit, materials, runtime performance, and running-game appearance. Integrate assets that
actually pass those gates. Cheap retexturing/material variants of strong meshes are a valid way to create
additional loot variety. Use the resulting inventory/gap count to size any later paid asset-production push.

Asset tooling should increasingly optimize for **content throughput**: once a class of asset is qualified,
make it easier to move additional gear, creatures, crops, farm props, NPCs, and environment pieces through the
same proven source-custody, optimization, Unity-import, prefab, and visual-review lane without weakening
provenance or running-game acceptance. iPad Safari runtime budgets are part of qualification.

## Decision discipline

- **This file answers:** what has the Owner actually decided about the product?
- **GitHub product Issues answer:** what ideas, signals, initiatives, evidence, and unresolved decisions
  are currently alive?
- **`PROGRESSION_CONTRACT_V0.md` answers:** what shared design constraints and provisional tuning shape the current progression push?
- **Pull requests answer:** what implementation is being proposed or validated now?
- **Chats answer:** what are we thinking about right now? Chats are not durable product authority.
