# Working on Hatch & Harvest

This repo holds one game: **Hatch & Harvest**, a three.js creature-collecting farm game for children,
played on iPad Safari. Read `docs/VISION.md` for what we're building and `docs/ROADMAP.md` for what's
next.

## Layout

- `game/` — the game. Open `game/index.html`; everything it loads lives here.
  - `game/content/` — crops, creatures, armor, offers, dialog. **New content goes here as data.**
  - `game/src/rules/` — pure game rules. No DOM, no three.js. All unit-tested.
  - `game/src/render/` — the three.js diorama.
  - `game/src/ui/` — the DOM touch UI.
  - `game/src/main.js` — wires rules, render and UI together.
- `test/` — `node --test` unit tests.
- `tools/screenshot.mjs` — boots the game in headless Chromium at iPad sizes and saves PNGs.
- `docs/` — vision, roadmap, and the first-session experience contract (`CONTRACT.md`).

## Commands

```bash
node server.mjs                     # play at http://localhost:5201/
node --test 'test/**/*.test.mjs'    # unit tests
node tools/screenshot.mjs           # iPad screenshots in tmp/screenshots/ + browser error check
```

Node 24+. There are no npm dependencies and no build step. Keep it that way: don't add packages.

## Rules

1. **Work on a branch and open a PR.** Never push straight to `main`. One clear goal per PR.
2. **Keep tests green and honest.** Run the unit tests and the screenshot check before pushing. Don't
   weaken or skip a test to get green.
3. **Rules stay pure.** Game logic goes in `game/src/rules/` with tests. Rendering and UI only read
   state and call rules.
4. **Content is data.** Adding a crop, creature or armor piece should mean editing `game/content/`,
   not game code.
5. **Look at it.** For any visible change, take screenshots and look at them before handing off. The
   Owner's eyes on the running game are the final judge of how it looks.
6. **iPad first.** Touch only (no hover or keyboard-only actions), readable at tablet size, light on
   memory.
7. **Kid-safe.** Follow `docs/CONTRACT.md` §7 (no premium currency, no guilt text, no fail sounds, no
   analytics or network calls beyond static files). Never commit children's names, classwork or
   profile data.
8. **Assets.** Record every new shipped asset in `ASSET-LICENSES.md`. **No paid Meshy or other
   provider spend without the Owner's explicit OK for that specific work.**
9. **Owner decides product direction.** Suggestions go in PRs or issues; only the Owner edits
   `docs/VISION.md`.

## Old material

The Unity project, the old action-adventure client, the multiplayer server and the old process docs
were removed in the rescue. They are all on the `archive/pre-rescue` branch. To bring something back:
`git checkout origin/archive/pre-rescue -- <path>`.
