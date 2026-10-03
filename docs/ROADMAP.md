# Roadmap

One game, built in small playable steps. Each step ends with something new a child can see and do, and
a short playtest. `docs/VISION.md` says *what* we're building; this file says *in what order*.

## Done

- **Rescue (2026-10).** Cut the repo down to the farm game. The Unity project, the old action-adventure
  client, the multiplayer server and the old process docs are on the `archive/pre-rescue` branch.
- **First session.** Plant, water, harvest, sell to Pip, buy the Sprout armor set, hatch and name a
  creature, feed it, collection book, two age bands. Spec: `docs/CONTRACT.md`.

## 1. Make it easy to grow (next)

Goal: adding content means adding data, and adding a system doesn't mean editing one giant file.

- **Split `game/src/rules/game.js`** (≈650 lines) into one module per system: farm, market, eggs,
  creatures, armor, goals. `game.js` becomes a thin facade.
- **Move hard-coded content into `game/content/`.** Things like the second-egg creature, the sun-crest
  feed count and the gift threshold are constants in code today.
- **Data-driven goals.** The first-session beat sheet becomes an ordered list in content; after it ends,
  the goal chip picks the best next step from what's available (ripe crop, open order, egg ready, …).
  This keeps "always an obvious next step" true as the game grows.
- **Save migrations.** One versioned save with a migration per version, so new features never wipe
  progress.

## 2. Deeper farm loop

- Land **breeding v1** (open PR: pair two creatures to make an egg) and **Pip's Garden Festival**
  (open PR), rebuilt on the new layout.
- More crops (quick basic crops, slow rare crops) and more creatures, all as data.
- Creatures visibly transform as they're fed (stages, not just a crest).
- A second armor set, plus forging armor from crops.
- **Child playtest** against `docs/CONTRACT.md` §6.

## 3. Learning layer

- **Homework board:** real schoolwork as the best-paying job, plus homework-only armor. Content loaded
  from a private source, never committed here.
- **Timer acceleration:** answer questions to speed up eggs and rare crops, with limits.

## 4. Expeditions

- Short trips with the Hero plus two creatures, **turn-based** battles, elements and roles.
- Rewards: rare materials, eggs, armor.

## 5. Together

- Visit a sibling's farm, trade and gift creatures, co-op expeditions. This is the first point where a
  server is needed; the old one is on the archive branch for reference.

## How we work

- One PR per step-sized change. Tests and the screenshot check pass before merge.
- Ideas and bugs go in GitHub issues framed for the farm game.
