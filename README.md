# Hatch & Harvest (GalaQuest)

A creature-collecting farm game for children, built for iPad Safari. Plant and harvest crops, sell to Pip
at the market, dress up your Hero, and hatch, name and raise creatures.

three.js, plain ES modules, **no build step and no npm dependencies.**

## Play

```bash
node server.mjs
```

Open `http://localhost:5201/`. The server also prints a Wi-Fi address you can open on an iPad.

## Test

```bash
node --test 'test/**/*.test.mjs'   # unit tests
node tools/screenshot.mjs          # iPad-size screenshots in tmp/screenshots/, fails on browser errors
```

Needs Node 24+. The screenshot tool needs Chrome or Chromium (set `CHROME=/path/to/chrome` if it isn't
found).

## What's where

| Path | What it is |
| --- | --- |
| `game/` | The game: `index.html`, `src/` (rules, render, ui), `content/` (data), `assets/`, `vendor/` (three.js) |
| `test/` | Unit tests (`node --test`) |
| `tools/screenshot.mjs` | Headless iPad screenshots and a browser-error check |
| `server.mjs` | Tiny static server |
| `docs/VISION.md` | What we're building (Owner decisions) |
| `docs/ROADMAP.md` | What's next |
| `docs/CONTRACT.md` | The first-session experience spec |
| `AGENTS.md` | Rules for anyone working here, human or AI |

## History

The repo used to hold a Unity project, a real-time action-adventure client and a multiplayer server.
They were archived in October 2026 when the project committed to the farm game. Everything is still on
the `archive/pre-rescue` branch.

## Licence

All rights reserved, except where stated. See `NOTICE` and `ASSET-LICENSES.md`.
