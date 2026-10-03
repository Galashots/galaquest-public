# Roadmap

One game, built in small playable steps. Each step ends with something new a child can see and do, and
a short playtest. `docs/VISION.md` says *what* we're building; this file says *in what order*.

## Done

- **Rescue (2026-10).** Cut the repo down to the farm game. The Unity project, the old action-adventure
  client, the multiplayer server and the old process docs are on the `archive/pre-rescue` branch.
- **First session.** Plant, water, harvest, sell to Pip, buy the Sprout armor set, hatch and name a
  creature, feed it, collection book, two age bands. Spec: `docs/CONTRACT.md`.
- **Easy to grow (2026-10).** Rules split into one module per system; content is data (tutorial,
  market, rewards, feeding growth); any number of eggs and creatures; the free-play goal chip picks
  from a priority list; versioned saves with migrations. See "Adding things" in `AGENTS.md`.
- **Pip's Garden Festival.** Free-play orders build bunting, flowers, lanterns and a banner, then a
  Water egg prize, all as reward entries with a progress line at the market.

## 1. Deeper farm loop (next)

- Land **breeding v1** (pair two creatures to make an egg), rebuilt on the new layout.
- More crops (quick basic crops, slow rare crops) and more creatures, all as data.
- Creatures visibly transform as they're fed (stages, not just a crest).
- A second armor set, plus forging armor from crops.
- **Child playtest** against `docs/CONTRACT.md` §6.

## 2. Learning layer

- **Homework board:** real schoolwork as the best-paying job, plus homework-only armor. Content loaded
  from a private source, never committed here.
- **Timer acceleration:** answer questions to speed up eggs and rare crops, with limits.

## 3. Expeditions

- Short trips with the Hero plus two creatures, **turn-based** battles, elements and roles.
- Rewards: rare materials, eggs, armor.

## 4. Together

- Visit a sibling's farm, trade and gift creatures, co-op expeditions. This is the first point where a
  server is needed; the old one is on the archive branch for reference.

## How we work

- One PR per step-sized change. Tests and the screenshot check pass before merge.
- Ideas and bugs go in GitHub issues framed for the farm game.
