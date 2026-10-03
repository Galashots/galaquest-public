# Product vision

Settled Owner direction for **Hatch & Harvest** (the GalaQuest farm game). Only the Owner changes this
file. When direction changes, replace the old statement; don't keep two current answers.

The pre-rescue version of this file, with full decision history, is on the `archive/pre-rescue` branch
(`docs/product/PRODUCT_VISION.md`).

## Core promise

A **fun-first creature-collecting farm adventure** for children. They should want to play because
something is always growing, something is about to hatch, there's something cool to wear, and a sibling
to show it to — not because they were told it's educational.

## The loop

`plant and harvest -> feed creatures / buy or forge gear / sell at market -> creatures grow and visibly
transform, the Hero looks cooler -> breed for eggs and hatch new creatures -> short expedition for rare
rewards -> back to the farm`

The feeling to repeat: **want something -> do something meaningful -> visibly get stronger, richer or
cooler -> show it off -> discover the next thing worth wanting.**

## Principles

- **Always an obvious next step.** The goal chip and arrow make the next useful action unmistakable at
  every moment. This is a hard requirement: confusion becomes boredom fast for these players.
- **The farm feeds everything.** Crops are the root resource: creature food, forging materials, and goods
  to sell. New systems plug into the farm economy instead of inventing unrelated currencies.
- **Visible gear, lots of it.** Armor visibly changes the Hero. It comes from the market, forging,
  expeditions, and the homework board.
- **Less combat, better combat.** Combat is occasional, short, and turn-based.
- **Fast before vast.** Prove one small, complete loop before building systems for dozens of things.
- **Player-facing value wins.** Every playtest should contain new things a child can see and do.
- **No dark patterns.** No premium currency, no pay-to-skip, no ads. Wait timers pace the loop; the only
  accelerators are play and learning. (See `CONTRACT.md` §7 for the full "never" list.)

## Platform

- **three.js in the browser**, plain ES modules, no build step, no npm dependencies.
- **iPad Safari first.** Everything is touch-operable, readable at tablet size, and inside an iPad memory
  budget. Desktop is supported for development.
- Unity is not used. The old Unity project is on the `archive/pre-rescue` branch.

## Learning

Hide the vegetables, not the learning outcome.

- Learning is required to get something the player already wants: hatch an egg sooner, grow a rare
  crop, earn gear.
- **Homework board:** a farm job board where real schoolwork is the best-paying job, including
  homework-only armor. Content comes from the Owner. **Children's classwork and profile data never go in
  this public repository.**
- **Timer acceleration:** eggs and rare crops have long timers; answering learning questions shortens
  them. Bounded so easy questions can't be farmed to skip the loop.
- Learning is personalised by child and subject, not maths-only.

## Creatures

Creatures are the heart of the game: attachment, collection, identity, visible growth, rarity, breeding.

- Many creatures, each with an **element** and a **rarity**.
- Players own many and bring two on expeditions.
- Creatures level up by being **fed farm crops** and **visibly transform** as they grow.
- **Breeding:** pair two creatures to make an egg; eggs hatch on the farm on a timer.
- Children name their creatures. They should feel like companions, not stat cards.

## Combat (later)

- **Turn-based team battles:** the Hero plus two creatures.
- Readable turn order and a few clear actions per turn.
- Kid-readable element strengths and weaknesses; team roles (attacker, tank, support) matter.
- Battles happen on short expeditions for rare materials, eggs and armor — never the only way to progress.

## Social (later)

Each player has their own farm and collection. Players can **visit** each other's farms, **trade**, and go
on **co-op expeditions**. It must favour generosity and healthy showing-off, and be safe for young
children (no open chat with strangers).

## Assets

- Reuse and recolour strong existing models before generating new ones.
- No paid Meshy (or other provider) spend without explicit Owner authorization for that specific work.
- Every shipped asset has a provenance entry in `ASSET-LICENSES.md`.
